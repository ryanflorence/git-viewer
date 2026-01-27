import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import { createRouter } from "remix/fetch-router";
import { createRequestListener } from "remix/node-fetch-server";
import { staticFiles } from "remix/static-middleware";
import { html as diff2html, parse as parseDiff } from "diff2html";

let exec = promisify(execCallback);

// Parse repo directory from command line arguments
let repoDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

// Validate that the directory exists and is a git repository
if (!fs.existsSync(repoDir)) {
  console.error(`Error: Directory does not exist: ${repoDir}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(repoDir, ".git"))) {
  console.error(`Error: Not a git repository: ${repoDir}`);
  process.exit(1);
}

// Types
type RefNode =
  | { type: "branch"; name: string; fullName: string; current?: boolean }
  | { type: "folder"; name: string; children: RefNode[] };

type RefsResponse = {
  local: RefNode[];
  remotes: { [remote: string]: RefNode[] };
  currentBranch: string;
};

type GraphNode = {
  lane: number;
  color: number;
  isFirstInLane: boolean; // true if no line should come from above
  lines: { from: number; to: number; color: number }[];
};

type Commit = {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  parents: string[];
  refs: string[];
  graph: GraphNode;
};

type CommitsResponse = {
  commits: Commit[];
  maxLane: number;
};

type DiffResponse = {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  parents: string[];
  diffHtml: string;
};

// Git helpers
async function git(args: string): Promise<string> {
  let { stdout } = await exec(`git ${args}`, {
    cwd: repoDir,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function getCurrentBranch(): Promise<string> {
  return git("rev-parse --abbrev-ref HEAD");
}

async function getRefs(): Promise<RefsResponse> {
  let currentBranch = await getCurrentBranch();

  // Get local branches
  let localOutput = await git('branch --format="%(refname:short)"');
  let localBranches = localOutput
    ? localOutput.split("\n").filter(Boolean)
    : [];

  // Get remote branches
  let remoteOutput = await git('branch -r --format="%(refname:short)"');
  let remoteBranches = remoteOutput
    ? remoteOutput.split("\n").filter(Boolean)
    : [];

  // Build tree for local branches
  let local = buildTree(localBranches, currentBranch);

  // Group remote branches by remote name, then build tree for each
  let remotesByOrigin: { [remote: string]: string[] } = {};
  for (let branch of remoteBranches) {
    let [remote, ...rest] = branch.split("/");
    let branchName = rest.join("/");
    if (!remotesByOrigin[remote]) {
      remotesByOrigin[remote] = [];
    }
    remotesByOrigin[remote].push(branchName);
  }

  let remotes: { [remote: string]: RefNode[] } = {};
  for (let [remote, branches] of Object.entries(remotesByOrigin)) {
    remotes[remote] = buildTree(branches);
  }

  return { local, remotes, currentBranch };
}

function buildTree(branches: string[], currentBranch?: string): RefNode[] {
  let root: RefNode[] = [];

  // Sort branches: non-prefixed first, then by name
  let sorted = [...branches].sort((a, b) => {
    let aHasSlash = a.includes("/");
    let bHasSlash = b.includes("/");
    if (aHasSlash !== bHasSlash) return aHasSlash ? 1 : -1;
    return a.localeCompare(b);
  });

  for (let branch of sorted) {
    let parts = branch.split("/");
    insertIntoTree(root, parts, branch, currentBranch);
  }

  return root;
}

function insertIntoTree(
  nodes: RefNode[],
  parts: string[],
  fullName: string,
  currentBranch?: string,
): void {
  let [first, ...rest] = parts;

  if (rest.length === 0) {
    // Leaf node - it's a branch
    nodes.push({
      type: "branch",
      name: first,
      fullName,
      current: fullName === currentBranch,
    });
    return;
  }

  // Find or create folder
  let folder = nodes.find(
    (n): n is RefNode & { type: "folder" } =>
      n.type === "folder" && n.name === first,
  );

  if (!folder) {
    folder = { type: "folder", name: first, children: [] };
    nodes.push(folder);
  }

  insertIntoTree(folder.children, rest, fullName, currentBranch);
}

async function getCommits(
  ref?: string,
  search?: string,
): Promise<CommitsResponse> {
  let format = "%H%x00%h%x00%s%x00%an%x00%ai%x00%P%x00%D";
  let args = `log --format="${format}" -n 500`;

  if (ref && ref !== "all") {
    args += ` ${ref}`;
  } else {
    args += " --all";
  }

  let output = await git(args);
  let lines = output ? output.split("\n").filter(Boolean) : [];

  let rawCommits = lines.map(line => {
    let [sha, shortSha, subject, author, date, parents, refs] =
      line.split("\x00");
    return {
      sha,
      shortSha,
      subject,
      author,
      date: formatDate(date),
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      refs: refs ? parseRefs(refs) : [],
    };
  });

  // Filter by search if provided
  let filteredCommits = rawCommits;
  if (search) {
    let query = search.toLowerCase();
    filteredCommits = rawCommits.filter(
      c =>
        c.subject.toLowerCase().includes(query) ||
        c.author.toLowerCase().includes(query) ||
        c.sha.toLowerCase().includes(query),
    );
  }

  // Compute graph lanes
  let { commits, maxLane } = computeGraph(filteredCommits);

  return { commits, maxLane };
}

// Graph colors (cycle through these)
let graphColors = [0, 1, 2, 3, 4, 5, 6, 7];

function computeGraph(rawCommits: Omit<Commit, "graph">[]): {
  commits: Commit[];
  maxLane: number;
} {
  // lanes[i] = sha of commit that "owns" lane i, or null if free
  let lanes: (string | null)[] = [];
  let shaToLane = new Map<string, number>();
  let shaToColor = new Map<string, number>();
  // Track which commits were assigned lanes by parents (not first in lane)
  let shaAssignedByParent = new Set<string>();
  let colorIndex = 0;
  let maxLane = 0;

  let commits: Commit[] = [];

  for (let raw of rawCommits) {
    let { sha, parents } = raw;

    // Find or assign lane for this commit
    let lane = shaToLane.get(sha);
    let isFirstInLane = !shaAssignedByParent.has(sha);
    if (lane === undefined) {
      // New branch head - find first free lane
      lane = lanes.findIndex(l => l === null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
      shaToLane.set(sha, lane);
      shaToColor.set(sha, graphColors[colorIndex++ % graphColors.length]);
      isFirstInLane = true;
    }

    // This commit now occupies its lane
    lanes[lane] = sha;
    maxLane = Math.max(maxLane, lane);

    let color = shaToColor.get(sha) ?? 0;
    let graphLines: { from: number; to: number; color: number }[] = [];

    // Draw continuing lines for all active lanes (except our own - handled separately)
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && i !== lane) {
        // This lane continues through
        let laneColor = shaToColor.get(lanes[i]!) ?? 0;
        graphLines.push({ from: i, to: i, color: laneColor });
      }
    }

    // Handle parents
    if (parents.length === 0) {
      // Root commit - lane ends, no line below
      lanes[lane] = null;
    } else if (parents.length === 1) {
      // Single parent - pass lane to parent
      let parent = parents[0];
      let existingParentLane = shaToLane.get(parent);
      if (existingParentLane !== undefined) {
        // Parent already has a lane (merge target) - draw line to it and free our lane
        graphLines.push({ from: lane, to: existingParentLane, color });
        lanes[lane] = null;
      } else {
        // Parent inherits our lane
        shaToLane.set(parent, lane);
        shaToColor.set(parent, color);
        shaAssignedByParent.add(parent);
        lanes[lane] = parent;
        graphLines.push({ from: lane, to: lane, color });
      }
    } else {
      // Merge commit - first parent inherits lane, others get/use their lanes
      let firstParent = parents[0];
      let existingFirstLane = shaToLane.get(firstParent);
      if (existingFirstLane !== undefined) {
        graphLines.push({ from: lane, to: existingFirstLane, color });
        lanes[lane] = null;
      } else {
        shaToLane.set(firstParent, lane);
        shaToColor.set(firstParent, color);
        shaAssignedByParent.add(firstParent);
        lanes[lane] = firstParent;
        graphLines.push({ from: lane, to: lane, color });
      }

      // Other parents
      for (let i = 1; i < parents.length; i++) {
        let parent = parents[i];
        let parentLane = shaToLane.get(parent);
        if (parentLane !== undefined) {
          // Draw merge line
          let parentColor = shaToColor.get(parent) ?? 0;
          graphLines.push({ from: lane, to: parentLane, color: parentColor });
        } else {
          // Allocate new lane for this parent
          let newLane = lanes.findIndex(l => l === null);
          if (newLane === -1) {
            newLane = lanes.length;
            lanes.push(null);
          }
          let newColor = graphColors[colorIndex++ % graphColors.length];
          shaToLane.set(parent, newLane);
          shaToColor.set(parent, newColor);
          shaAssignedByParent.add(parent);
          lanes[newLane] = parent;
          maxLane = Math.max(maxLane, newLane);
          graphLines.push({ from: lane, to: newLane, color: newColor });
        }
      }
    }

    commits.push({
      ...raw,
      graph: { lane, color, isFirstInLane, lines: graphLines },
    });
  }

  return { commits, maxLane };
}

function parseRefs(refs: string): string[] {
  if (!refs.trim()) return [];
  return refs
    .split(",")
    .map(r => r.trim())
    .filter(r => r && !r.startsWith("tag:"))
    .map(r => r.replace("HEAD -> ", ""));
}

function formatDate(date: string): string {
  let d = new Date(date);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function getDiff(sha: string): Promise<DiffResponse> {
  let format = "%H%x00%h%x00%s%x00%an%x00%ai%x00%P";
  let metaOutput = await git(`show --format="${format}" -s ${sha}`);
  let [fullSha, shortSha, subject, author, date, parents] =
    metaOutput.split("\x00");

  let diffOutput = await git(`show --format="" ${sha}`);

  let diffHtml = diff2html(parseDiff(diffOutput), {
    drawFileList: false,
    outputFormat: "line-by-line",
    matching: "lines",
  });

  return {
    sha: fullSha,
    shortSha,
    subject,
    author,
    date: formatDate(date),
    parents: parents ? parents.split(" ").filter(Boolean) : [],
    diffHtml,
  };
}

// Resolve the package directory (where index.html and bundled JS live)
let packageDir = import.meta.dirname;

// Router
let router = createRouter({
  middleware: [staticFiles(packageDir)],
});

router.get("/", () => {
  return Response.redirect("/index.html", 302);
});

router.get("/api/refs", async () => {
  try {
    let refs = await getRefs();
    return Response.json(refs);
  } catch (error) {
    console.error("Error getting refs:", error);
    return Response.json({ error: "Failed to get refs" }, { status: 500 });
  }
});

router.get("/api/commits", async ({ url }) => {
  try {
    let ref = url.searchParams.get("ref") || undefined;
    let search = url.searchParams.get("search") || undefined;
    let commits = await getCommits(ref, search);
    return Response.json(commits);
  } catch (error) {
    console.error("Error getting commits:", error);
    return Response.json({ error: "Failed to get commits" }, { status: 500 });
  }
});

router.get("/api/diff/:sha", async ({ params }) => {
  try {
    let diff = await getDiff(params.sha);
    return Response.json(diff);
  } catch (error) {
    console.error("Error getting diff:", error);
    return Response.json({ error: "Failed to get diff" }, { status: 500 });
  }
});

// Server
let server = http.createServer(
  createRequestListener(async request => {
    return await router.fetch(request);
  }),
);

server.listen(44100, () => {
  console.log(`Git Tree Viewer running at http://localhost:44100`);
  console.log(`Repository: ${repoDir}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
