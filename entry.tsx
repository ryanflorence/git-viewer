import { createRoot, type Handle } from "remix/component";

// ============================================================================
// Types
// ============================================================================

type RefNode =
  | { type: "branch"; name: string; fullName: string; current?: boolean }
  | { type: "folder"; name: string; children: RefNode[] };

type RefsData = {
  local: RefNode[];
  remotes: { [remote: string]: RefNode[] };
  currentBranch: string;
};

type GraphNode = {
  lane: number;
  color: number;
  isFirstInLane: boolean;
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

type DiffData = {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  parents: string[];
  diffHtml: string;
};

// ============================================================================
// Global State
// ============================================================================

let state = {
  refs: null as RefsData | null,
  commits: [] as Commit[],
  maxLane: 0,
  selectedCommit: null as Commit | null,
  diff: null as DiffData | null,
  filter: "all" as string,
  search: "",
  loading: true,
};

let updateApp: () => void;

// ============================================================================
// API
// ============================================================================

async function fetchRefs(): Promise<RefsData> {
  let res = await fetch("/api/refs");
  return res.json();
}

async function fetchCommits(
  ref?: string,
  search?: string,
): Promise<{ commits: Commit[]; maxLane: number }> {
  let params = new URLSearchParams();
  if (ref) params.set("ref", ref);
  if (search) params.set("search", search);
  let res = await fetch(`/api/commits?${params}`);
  let data = await res.json();
  return { commits: data.commits, maxLane: data.maxLane };
}

async function fetchDiff(sha: string): Promise<DiffData> {
  let res = await fetch(`/api/diff/${sha}`);
  return res.json();
}

// ============================================================================
// Actions
// ============================================================================

async function setFilter(filter: string) {
  state.filter = filter;
  state.loading = true;
  updateApp();

  let ref =
    filter === "all"
      ? "all"
      : filter === "local"
        ? state.refs?.currentBranch
        : filter;
  let result = await fetchCommits(ref, state.search);
  state.commits = result.commits;
  state.maxLane = result.maxLane;
  state.loading = false;
  updateApp();
}

async function setSearch(search: string) {
  state.search = search;
  state.loading = true;
  updateApp();

  let ref =
    state.filter === "all"
      ? "all"
      : state.filter === "local"
        ? state.refs?.currentBranch
        : state.filter;
  let result = await fetchCommits(ref, search);
  state.commits = result.commits;
  state.maxLane = result.maxLane;
  state.loading = false;
  updateApp();
}

async function selectCommit(commit: Commit) {
  state.selectedCommit = commit;
  state.diff = null;
  updateApp();

  state.diff = await fetchDiff(commit.sha);
  updateApp();
}

// ============================================================================
// Styles
// ============================================================================

let colors = {
  bg: "#ffffff",
  bgLight: "#f6f8fa",
  bgLighter: "#eaeef2",
  border: "#d1d9e0",
  text: "#1f2328",
  textMuted: "#656d76",
  accent: "#0969da",
  accentDim: "#ddf4ff",
  green: "#1a7f37",
  red: "#cf222e",
};

// Graph lane colors
let graphColors = [
  "#0969da", // blue
  "#8250df", // purple
  "#bf3989", // pink
  "#cf222e", // red
  "#bc4c00", // orange
  "#4d2d00", // brown
  "#1a7f37", // green
  "#0550ae", // dark blue
];

// ============================================================================
// App Component
// ============================================================================

function App(handle: Handle) {
  updateApp = () => handle.update();

  // Initial load
  handle.queueTask(async () => {
    let [refs, commitsResult] = await Promise.all([
      fetchRefs(),
      fetchCommits("all"),
    ]);
    state.refs = refs;
    state.commits = commitsResult.commits;
    state.maxLane = commitsResult.maxLane;
    state.loading = false;
    handle.update();
  });

  return () => (
    <div
      css={{
        display: "flex",
        height: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: "13px",
      }}
    >
      <Sidebar />
      <MainPanel />
    </div>
  );
}

// ============================================================================
// Sidebar
// ============================================================================

function Sidebar() {
  return () => (
    <div
      css={{
        width: "200px",
        minWidth: "200px",
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        css={{
          padding: "12px",
          borderBottom: `1px solid ${colors.border}`,
          fontWeight: 600,
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: colors.textMuted,
        }}
      >
        Git Tree Viewer
      </div>
      <div css={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
        {state.refs && (
          <>
            <RefSection title="LOCAL" nodes={state.refs.local} />
            {Object.entries(state.refs.remotes).map(([remote, nodes]) => (
              <RefSection
                key={remote}
                title={remote.toUpperCase()}
                nodes={nodes}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function RefSection(handle: Handle) {
  let expanded = true;

  return ({ title, nodes }: { title: string; nodes: RefNode[] }) => (
    <div css={{ marginBottom: "8px" }}>
      <div
        css={{
          padding: "4px 12px",
          fontSize: "10px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: colors.textMuted,
          cursor: "pointer",
          "&:hover": { color: colors.text },
        }}
        on={{
          click: () => {
            expanded = !expanded;
            handle.update();
          },
        }}
      >
        {expanded ? "▼" : "▶"} {title}
      </div>
      {expanded && (
        <div css={{ paddingLeft: "8px" }}>
          {nodes.map(node => (
            <RefNodeItem key={node.name} node={node} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function RefNodeItem(handle: Handle) {
  let expanded = true;

  return ({ node, depth }: { node: RefNode; depth: number }) => {
    let paddingLeft = 12 + depth * 12;

    if (node.type === "folder") {
      return (
        <div>
          <div
            css={{
              padding: `3px 12px`,
              paddingLeft: `${paddingLeft}px`,
              cursor: "pointer",
              color: colors.textMuted,
              fontSize: "12px",
              "&:hover": { color: colors.text },
            }}
            on={{
              click: () => {
                expanded = !expanded;
                handle.update();
              },
            }}
          >
            {expanded ? "▼" : "▶"} {node.name}/
          </div>
          {expanded &&
            node.children.map(child => (
              <RefNodeItem key={child.name} node={child} depth={depth + 1} />
            ))}
        </div>
      );
    }

    let isSelected = state.filter === node.fullName;
    return (
      <div
        css={{
          padding: `3px 12px`,
          paddingLeft: `${paddingLeft}px`,
          cursor: "pointer",
          borderRadius: "3px",
          marginRight: "8px",
          background: isSelected ? colors.accentDim : "transparent",
          color: node.current ? colors.accent : colors.text,
          fontWeight: node.current ? 600 : 400,
          "&:hover": {
            background: isSelected ? colors.accentDim : colors.bgLighter,
          },
        }}
        on={{ click: () => setFilter(node.fullName) }}
      >
        {node.current && "● "}
        {node.name}
      </div>
    );
  };
}

// ============================================================================
// Main Panel (Commits + Diff)
// ============================================================================

function MainPanel() {
  return () => (
    <div
      css={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <CommitList />
      <DiffPanel />
    </div>
  );
}

// ============================================================================
// Commit List
// ============================================================================

function CommitList() {
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleSearch(value: string) {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => setSearch(value), 300);
  }

  return () => (
    <div
      css={{
        height: "40%",
        minHeight: "200px",
        display: "flex",
        flexDirection: "column",
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      {/* Filter bar */}
      <div
        css={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgLight,
        }}
      >
        <FilterButton label="All" filter="all" />
        <FilterButton label="Local" filter="local" />
        {state.refs && (
          <FilterButton
            label={state.refs.currentBranch}
            filter={state.refs.currentBranch}
          />
        )}
        <div css={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Search commits..."
          css={{
            width: "200px",
            padding: "4px 8px",
            border: `1px solid ${colors.border}`,
            borderRadius: "4px",
            background: colors.bg,
            color: colors.text,
            fontSize: "12px",
            "&:focus": { outline: "none", borderColor: colors.accent },
            "&::placeholder": { color: colors.textMuted },
          }}
          on={{
            input: e => handleSearch((e.target as HTMLInputElement).value),
          }}
        />
      </div>

      {/* Commit table */}
      <div css={{ flex: 1, overflow: "auto" }}>
        {state.loading ? (
          <div
            css={{
              padding: "20px",
              textAlign: "center",
              color: colors.textMuted,
            }}
          >
            Loading...
          </div>
        ) : (
          <table
            css={{
              width: "100%",
              borderCollapse: "collapse",
              tableLayout: "fixed",
              "& th, & td": {
                padding: "6px 12px",
                textAlign: "left",
                borderBottom: `1px solid ${colors.border}`,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
              "& th": {
                background: colors.bgLight,
                fontWeight: 600,
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: colors.textMuted,
                position: "sticky",
                top: 0,
              },
              "& tbody tr:hover": { background: colors.bgLighter },
            }}
          >
            <thead>
              <tr>
                <th>Subject</th>
                <th css={{ width: "150px" }}>Author</th>
                <th css={{ width: "150px" }}>Date</th>
                <th css={{ width: "80px" }}>SHA</th>
              </tr>
            </thead>
            <tbody>
              {state.commits.map(commit => (
                <CommitRow key={commit.sha} commit={commit} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FilterButton() {
  return ({ label, filter }: { label: string; filter: string }) => {
    let isActive = state.filter === filter;
    return (
      <button
        css={{
          padding: "4px 10px",
          border: `1px solid ${isActive ? colors.accent : colors.border}`,
          borderRadius: "4px",
          background: isActive ? colors.accentDim : "transparent",
          color: isActive ? colors.accent : colors.text,
          fontSize: "12px",
          cursor: "pointer",
          "&:hover": { borderColor: colors.accent },
        }}
        on={{ click: () => setFilter(filter) }}
      >
        {label}
      </button>
    );
  };
}

function CommitRow() {
  return ({ commit }: { commit: Commit }) => {
    let isSelected = state.selectedCommit?.sha === commit.sha;
    let { graph } = commit;

    // Calculate the rightmost lane used in this row's graph
    let maxUsedLane = graph.lane;
    for (let line of graph.lines) {
      maxUsedLane = Math.max(maxUsedLane, line.from, line.to);
    }
    let graphWidth = (maxUsedLane + 1) * 16 + 8;

    // Get the commit's lane color for badges
    let laneColor = graphColors[graph.color % graphColors.length];

    return (
      <tr
        css={{
          cursor: "pointer",
          background: isSelected ? colors.accentDim : "transparent",
        }}
        on={{ click: () => selectCommit(commit) }}
      >
        <td css={{ display: "flex", alignItems: "center" }}>
          {/* Inline graph */}
          <svg
            width={graphWidth}
            height="24"
            css={{ display: "block", flexShrink: 0 }}
          >
            {/* Draw lines */}
            {graph.lines.map((line, i) => {
              let x1 = line.from * 16 + 8;
              let x2 = line.to * 16 + 8;
              let color = graphColors[line.color % graphColors.length];

              // Check if this is the commit's own lane line
              let isOwnLaneLine =
                line.from === graph.lane && line.to === graph.lane;

              if (line.from === line.to) {
                // Straight vertical line
                if (isOwnLaneLine && graph.isFirstInLane) {
                  // Terminal commit - only draw from dot down
                  return (
                    <line
                      key={i}
                      x1={x1}
                      y1={12}
                      x2={x2}
                      y2={24}
                      stroke={color}
                      stroke-width="2"
                    />
                  );
                }
                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={0}
                    x2={x2}
                    y2={24}
                    stroke={color}
                    stroke-width="2"
                  />
                );
              } else {
                // Curved merge/branch line
                let midY = 12;
                return (
                  <path
                    key={i}
                    d={`M ${x1} 0 Q ${x1} ${midY}, ${(x1 + x2) / 2} ${midY} Q ${x2} ${midY}, ${x2} 24`}
                    fill="none"
                    stroke={color}
                    stroke-width="2"
                  />
                );
              }
            })}
            {/* Draw commit node */}
            <circle
              cx={graph.lane * 16 + 8}
              cy={12}
              r={4}
              fill={laneColor}
              stroke={colors.bg}
              stroke-width="1"
            />
          </svg>
          {/* Badges and subject */}
          <span
            css={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {commit.refs.map(ref => (
              <span
                key={ref}
                css={{
                  display: "inline-block",
                  padding: "1px 6px",
                  marginRight: "6px",
                  borderRadius: "3px",
                  background: laneColor,
                  color: "#fff",
                  fontSize: "10px",
                  fontWeight: 600,
                }}
              >
                {ref}
              </span>
            ))}
            {commit.subject}
          </span>
        </td>
        <td css={{ color: colors.textMuted }}>{commit.author}</td>
        <td css={{ color: colors.textMuted }}>{commit.date}</td>
        <td>
          <code css={{ color: colors.accent, fontSize: "11px" }}>
            {commit.shortSha}
          </code>
        </td>
      </tr>
    );
  };
}

// ============================================================================
// Diff Panel
// ============================================================================

function DiffPanel() {
  return () => {
    if (!state.selectedCommit) {
      return (
        <div
          css={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.textMuted,
            background: colors.bgLight,
          }}
        >
          Select a commit to view diff
        </div>
      );
    }

    return (
      <div
        css={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: colors.bgLight,
        }}
      >
        {/* Commit header */}
        <div
          css={{ padding: "12px", borderBottom: `1px solid ${colors.border}` }}
        >
          <div css={{ fontWeight: 600, marginBottom: "4px" }}>
            {state.selectedCommit.subject}
          </div>
          <div css={{ fontSize: "12px", color: colors.textMuted }}>
            <span>{state.selectedCommit.author}</span>
            <span css={{ margin: "0 8px" }}>•</span>
            <span>{state.selectedCommit.date}</span>
            <span css={{ margin: "0 8px" }}>•</span>
            <code css={{ color: colors.accent }}>
              {state.selectedCommit.shortSha}
            </code>
          </div>
        </div>

        {/* Diff content */}
        <div css={{ flex: 1, overflow: "auto" }}>
          {state.diff ? (
            <section
              css={{
                "& .d2h-wrapper": { background: "transparent" },
                "& .d2h-file-header": {
                  background: colors.bgLighter,
                  borderBottom: `1px solid ${colors.border}`,
                  padding: "8px 12px",
                },
                "& .d2h-file-name": { color: colors.text },
                "& .d2h-code-line": { padding: "0 8px" },
                "& .d2h-code-line-ctn": { color: colors.text },
                "& .d2h-ins": { background: "#dafbe1" },
                "& .d2h-del": { background: "#ffebe9" },
                "& .d2h-ins .d2h-code-line-ctn": { color: colors.green },
                "& .d2h-del .d2h-code-line-ctn": { color: colors.red },
                "& .d2h-code-linenumber": {
                  color: colors.textMuted,
                  borderRight: `1px solid ${colors.border}`,
                },
                "& .d2h-file-diff": {
                  borderBottom: `1px solid ${colors.border}`,
                },
                "& .d2h-diff-tbody": { position: "relative" },
              }}
              innerHTML={state.diff.diffHtml}
            />
          ) : (
            <div
              css={{
                padding: "20px",
                textAlign: "center",
                color: colors.textMuted,
              }}
            >
              Loading diff...
            </div>
          )}
        </div>
      </div>
    );
  };
}

// ============================================================================
// Mount
// ============================================================================

createRoot(document.body).render(<App />);
