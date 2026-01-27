import { createRoot, type Handle } from "remix/component";
import { TypedEventTarget } from "remix/interaction";

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
  body: string;
  author: string;
  date: string;
  parents: string[];
  refs: string[];
  graph: GraphNode;
};

type ChangedFile = {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
};

type DiffData = {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  parents: string[];
  diffHtml: string;
  files: ChangedFile[];
};

type Theme = "light" | "dark";

// ============================================================================
// API
// ============================================================================

async function fetchRefs(signal?: AbortSignal): Promise<RefsData> {
  let res = await fetch("/api/refs", { signal });
  return res.json();
}

async function fetchCommits(
  ref?: string,
  search?: string,
  signal?: AbortSignal,
): Promise<{ commits: Commit[]; maxLane: number }> {
  let params = new URLSearchParams();
  if (ref) params.set("ref", ref);
  if (search) params.set("search", search);
  let res = await fetch(`/api/commits?${params}`, { signal });
  let data = await res.json();
  return { commits: data.commits, maxLane: data.maxLane };
}

async function fetchDiff(sha: string, signal?: AbortSignal): Promise<DiffData> {
  let res = await fetch(`/api/diff/${sha}`, { signal });
  return res.json();
}

// ============================================================================
// App Store
// ============================================================================

class AppStore extends TypedEventTarget<{
  refs: Event;
  filter: Event;
  selectedCommit: Event;
  fullscreenDiff: Event;
  theme: Event;
}> {
  refs: RefsData | null = null;
  filter = "all";
  search = "";
  selectedCommit: Commit | null = null;
  fullscreenDiff = false;
  theme: Theme = "light";

  setRefs(refs: RefsData) {
    this.refs = refs;
    this.dispatchEvent(new Event("refs"));
  }

  setFilter(filter: string) {
    this.filter = filter;
    this.dispatchEvent(new Event("filter"));
  }

  setSearch(search: string) {
    this.search = search;
    this.dispatchEvent(new Event("filter")); // same effect as filter change
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors.
    }
    applyTheme(theme);
    this.dispatchEvent(new Event("theme"));
  }

  selectCommit(commit: Commit) {
    this.selectedCommit = commit;
    this.dispatchEvent(new Event("selectedCommit"));
  }

  toggleFullscreenDiff(open: boolean) {
    document.startViewTransition(() => {
      this.fullscreenDiff = open;
      this.dispatchEvent(new Event("fullscreenDiff"));
    });
  }
}

// ============================================================================
// Styles
// ============================================================================

const THEME_STORAGE_KEY = "git-viewer-theme";

let lightPalette = {
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
  diffAddBg: "#dafbe1",
  diffDelBg: "#ffebe9",
  diffAddText: "#116329",
  diffDelText: "#a40e26",
};

let darkPalette = {
  bg: "#0b0f14",
  bgLight: "#111821",
  bgLighter: "#1a2431",
  border: "#283241",
  text: "#e6edf3",
  textMuted: "#9aa7b4",
  accent: "#7aa2ff",
  accentDim: "#0b1b33",
  green: "#3fb950",
  red: "#ff7b72",
  diffAddBg: "#132a1f",
  diffDelBg: "#2a1619",
  diffAddText: "#7ee787",
  diffDelText: "#ffa198",
};

let colors = lightPalette;

// Graph lane colors
let graphColorsLight = [
  "#0969da", // blue
  "#8250df", // purple
  "#bf3989", // pink
  "#cf222e", // red
  "#bc4c00", // orange
  "#4d2d00", // brown
  "#1a7f37", // green
  "#0550ae", // dark blue
];

let graphColorsDark = [
  "#7aa2ff", // blue
  "#b488ff", // purple
  "#ff8bd3", // pink
  "#ff7b72", // red
  "#f5b85b", // orange
  "#f2cc8f", // amber
  "#3fb950", // green
  "#5cc8ff", // cyan
];

let graphColors = graphColorsLight;

function loadTheme(): Theme {
  try {
    let stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Ignore storage errors and fall back to system.
  }
  let media = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
  return media && media.matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.body.style.backgroundColor =
    theme === "dark" ? darkPalette.bg : lightPalette.bg;
}

// ============================================================================
// App Component
// ============================================================================

function App(handle: Handle<AppStore>) {
  let store = new AppStore();
  handle.context.set(store);

  store.setTheme(loadTheme());

  handle.on(store, {
    theme: () => handle.update(),
  });

  // Load refs
  handle.queueTask(async signal => {
    let refs = await fetchRefs(signal);
    store.setRefs(refs);
  });

  return () => {
    colors = store.theme === "dark" ? darkPalette : lightPalette;
    graphColors = store.theme === "dark" ? graphColorsDark : graphColorsLight;

    return (
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
  };
}

// ============================================================================
// Sidebar
// ============================================================================

function Sidebar(handle: Handle) {
  let store = handle.context.get(App);

  handle.on(store, {
    refs: () => handle.update(),
  });

  return () => (
    <div
      css={{
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        css={{
          padding: "12px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: colors.textMuted,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        Git Tree Viewer
      </div>
      <div css={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
        {store.refs && (
          <>
            <RefSection title="LOCAL" nodes={store.refs.local} />
            {Object.entries(store.refs.remotes).map(([remote, nodes]) => (
              <RefSection
                key={remote}
                title={remote.toUpperCase()}
                nodes={nodes}
                initialExpanded={false}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function RefSection(handle: Handle) {
  let expanded: boolean | null = null;

  return ({
    title,
    nodes,
    initialExpanded = true,
  }: {
    title: string;
    nodes: RefNode[];
    initialExpanded?: boolean;
  }) => {
    if (expanded === null) expanded = initialExpanded;
    return (
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
  };
}

function RefNodeItem(handle: Handle) {
  let store = handle.context.get(App);
  let expanded = true;

  handle.on(store, {
    filter: () => handle.update(),
  });

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
              whiteSpace: "nowrap",
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

    let isSelected = store.filter === node.fullName;
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
          whiteSpace: "nowrap",
          "&:hover": {
            background: isSelected ? colors.accentDim : colors.bgLighter,
          },
        }}
        on={{ click: () => store.setFilter(node.fullName) }}
      >
        {node.current && (
          <span css={{ fontSize: "8px", marginRight: "4px" }}>●</span>
        )}
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

function CommitList(handle: Handle) {
  let store = handle.context.get(App);
  let commits: Commit[] = [];
  let loading = true;

  async function loadCommits(signal: AbortSignal) {
    loading = true;
    handle.update();

    let ref =
      store.filter === "all"
        ? "all"
        : store.filter === "local"
          ? store.refs?.currentBranch
          : store.filter;
    let result = await fetchCommits(ref, store.search, signal);
    commits = result.commits;
    loading = false;
    handle.update();
  }

  handle.on(store, {
    refs(_, signal) {
      loadCommits(signal);
    },
    filter(_, signal) {
      loadCommits(signal);
    },
  });

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
          padding: "7.5px 12px",
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgLight,
        }}
      >
        <FilterButton label="All" filter="all" />
        <FilterButton label="Local" filter="local" />
        {store.refs && (
          <FilterButton
            label={store.refs.currentBranch}
            filter={store.refs.currentBranch}
          />
        )}
        <div css={{ flex: 1 }} />
        <ThemeToggle />
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
            input: e => store.setSearch(e.currentTarget.value),
          }}
        />
      </div>

      {/* Commit table */}
      <div css={{ flex: 1, overflow: "auto" }}>
        {loading && commits.length === 0 ? (
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
              {commits.map(commit => (
                <CommitRow key={commit.sha} commit={commit} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ThemeToggle(handle: Handle) {
  let store = handle.context.get(App);

  handle.on(store, {
    theme: () => handle.update(),
  });

  return () => {
    let isDark = store.theme === "dark";
    return (
      <button
        aria-label="Toggle theme"
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        css={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 10px",
          border: `1px solid ${colors.border}`,
          borderRadius: "999px",
          background: colors.bg,
          color: colors.text,
          fontSize: "12px",
          cursor: "pointer",
          "&:hover": {
            borderColor: colors.accent,
            background: colors.bgLighter,
          },
        }}
        on={{ click: () => store.setTheme(isDark ? "light" : "dark") }}
      >
        {isDark ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.5-7.5-1.5 1.5M8 16l-1.5 1.5M16 16l1.5 1.5M8 8 6.5 6.5" />
          </svg>
        )}
        <span>{isDark ? "Dark" : "Light"}</span>
      </button>
    );
  };
}

function FilterButton(handle: Handle) {
  let store = handle.context.get(App);

  handle.on(store, {
    filter: () => handle.update(),
  });

  return ({ label, filter }: { label: string; filter: string }) => {
    let isActive = store.filter === filter;
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
        on={{ click: () => store.setFilter(filter) }}
      >
        {label}
      </button>
    );
  };
}

function CommitRow(handle: Handle) {
  let store = handle.context.get(App);

  handle.on(store, {
    selectedCommit: () => handle.update(),
  });

  return ({ commit }: { commit: Commit }) => {
    let isSelected = store.selectedCommit?.sha === commit.sha;
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
        on={{ click: () => store.selectCommit(commit) }}
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

function DiffPanel(handle: Handle) {
  let store = handle.context.get(App);
  let diff: DiffData | null = null;
  let diffContentRef: HTMLElement;

  handle.on(store, {
    async selectedCommit(_, signal) {
      if (!store.selectedCommit) {
        diff = null;
        handle.update();
        return;
      }

      diff = null;
      handle.update();

      diff = await fetchDiff(store.selectedCommit.sha, signal);
      handle.update();
    },
    fullscreenDiff() {
      handle.update();
    },
  });

  function scrollToFile(path: string | null) {
    if (!diffContentRef || !path) return;
    let fileHeaders = diffContentRef.querySelectorAll(".d2h-file-header");
    for (let header of fileHeaders) {
      let nameEl = header.querySelector(".d2h-file-name");
      if (nameEl?.textContent?.includes(path)) {
        header.scrollIntoView({ block: "start" });
        break;
      }
    }
  }

  return () => {
    let isFullscreen = store.fullscreenDiff;

    if (!store.selectedCommit) {
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
          viewTransitionName: "diff-panel",
          ...(isFullscreen
            ? {
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 100,
              }
            : {}),
        }}
      >
        {/* Commit header */}
        <div
          css={{
            padding: "12px",
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            background: colors.bgLight,
          }}
        >
          <div css={{ flex: 1, minWidth: 0 }}>
            <div css={{ fontWeight: 600, marginBottom: "4px" }}>
              {store.selectedCommit.subject}
            </div>
            <div css={{ fontSize: "12px", color: colors.textMuted }}>
              <span>{store.selectedCommit.author}</span>
              <span css={{ margin: "0 8px" }}>•</span>
              <span>{store.selectedCommit.date}</span>
              <span css={{ margin: "0 8px" }}>•</span>
              <code css={{ color: colors.accent }}>
                {store.selectedCommit.shortSha}
              </code>
              {diff && (
                <>
                  <span css={{ margin: "0 8px" }}>•</span>
                  <span>
                    {diff.files.length} file
                    {diff.files.length !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </div>
            {store.selectedCommit.body && (
              <div
                css={{
                  marginTop: "8px",
                  whiteSpace: "pre-wrap",
                  fontSize: "12px",
                  lineHeight: "1.4",
                }}
              >
                {store.selectedCommit.body}
              </div>
            )}
          </div>
          {diff && (
            <button
              css={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                border: `1px solid ${colors.border}`,
                borderRadius: "4px",
                background: colors.bg,
                color: colors.text,
                fontSize: "12px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                "&:hover": {
                  background: colors.bgLighter,
                  borderColor: colors.accent,
                },
              }}
              on={{ click: () => store.toggleFullscreenDiff(!isFullscreen) }}
            >
              {isFullscreen ? (
                <>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M4 14h6v6m10-10h-6V4m0 6 7-7M3 21l7-7" />
                  </svg>
                  Collapse
                </>
              ) : (
                <>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                  Expand
                </>
              )}
            </button>
          )}
        </div>

        {/* Content area with sidebar and diff */}
        <div css={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* File sidebar */}
          {diff && diff.files.length > 0 && (
            <div
              css={{
                borderRight: `1px solid ${colors.border}`,
                display: "flex",
                flexDirection: "column",
                background: colors.bg,
                overflow: "hidden",
              }}
            >
              <div
                css={{
                  padding: "8px 12px",
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: colors.textMuted,
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                Changed Files
              </div>
              <div css={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
                {diff.files.map(file => (
                  <FileListItem
                    key={file.path}
                    file={file}
                    onSelect={() => scrollToFile(file.path)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Diff content */}
          <div css={{ flex: 1, overflow: "auto" }}>
            {diff ? (
              <section
                connect={node => (diffContentRef = node)}
                class={store.theme === "dark" ? "d2h-dark-color-scheme" : ""}
                css={{
                  "& .d2h-wrapper": { background: "transparent" },
                  "& .d2h-file-header": {
                    background: colors.bgLighter,
                    borderBottom: `1px solid ${colors.border}`,
                    padding: "8px 12px",
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                  },
                  "& .d2h-file-name": { color: colors.text },
                  "& .d2h-code-line": {
                    padding: "0 8px",
                    background: colors.bg,
                  },
                  "& .d2h-code-line-ctn": { color: colors.text },
                  "& .d2h-ins": { background: colors.diffAddBg },
                  "& .d2h-del": { background: colors.diffDelBg },
                  "& .d2h-ins .d2h-code-line-ctn": {
                    color: colors.diffAddText,
                  },
                  "& .d2h-del .d2h-code-line-ctn": {
                    color: colors.diffDelText,
                  },
                  "& .d2h-code-linenumber": {
                    color: colors.textMuted,
                    background: colors.bgLight,
                    borderRight: `1px solid ${colors.border}`,
                  },
                  "& .d2h-code-line-prefix": { color: colors.textMuted },
                  "& .d2h-emptyplaceholder": { background: colors.bgLight },
                  "& .d2h-info": {
                    background: colors.bgLight,
                    color: colors.textMuted,
                  },
                  "& .d2h-file-diff": {
                    borderBottom: `1px solid ${colors.border}`,
                  },
                  "& .d2h-diff-tbody": { position: "relative" },
                }}
                innerHTML={diff.diffHtml}
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
      </div>
    );
  };
}

// ============================================================================
// File List Item
// ============================================================================

function FileListItem() {
  return ({ file, onSelect }: { file: ChangedFile; onSelect: () => void }) => {
    let displayName = file.path.split("/").pop() ?? file.path;
    let fullPath = file.path;

    return (
      <div
        css={{
          padding: "6px 12px",
          cursor: "pointer",
          "&:hover": {
            background: colors.bgLighter,
          },
        }}
        on={{ click: onSelect }}
      >
        <div
          css={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span
            css={{
              display: "flex",
              alignItems: "center",
              gap: "2px",
              fontSize: "10px",
              fontWeight: 500,
              minWidth: "50px",
            }}
          >
            {file.additions > 0 && (
              <span css={{ color: colors.green }}>+{file.additions}</span>
            )}
            {file.deletions > 0 && (
              <span css={{ color: colors.red }}>-{file.deletions}</span>
            )}
          </span>
          <span
            css={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "12px",
            }}
            title={fullPath}
          >
            {file.isNew && (
              <span
                css={{
                  display: "inline-block",
                  padding: "1px 4px",
                  marginRight: "6px",
                  borderRadius: "3px",
                  background: colors.green,
                  color: "#fff",
                  fontSize: "9px",
                  fontWeight: 600,
                }}
              >
                NEW
              </span>
            )}
            {file.isDeleted && (
              <span
                css={{
                  display: "inline-block",
                  padding: "1px 4px",
                  marginRight: "6px",
                  borderRadius: "3px",
                  background: colors.red,
                  color: "#fff",
                  fontSize: "9px",
                  fontWeight: 600,
                }}
              >
                DEL
              </span>
            )}
            {file.isRenamed && (
              <span
                css={{
                  display: "inline-block",
                  padding: "1px 4px",
                  marginRight: "6px",
                  borderRadius: "3px",
                  background: colors.accent,
                  color: "#fff",
                  fontSize: "9px",
                  fontWeight: 600,
                }}
              >
                REN
              </span>
            )}
            {displayName}
          </span>
        </div>
        {fullPath !== displayName && (
          <div
            css={{
              fontSize: "10px",
              color: colors.textMuted,
              marginTop: "2px",
              marginLeft: "58px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {fullPath}
          </div>
        )}
      </div>
    );
  };
}

// ============================================================================
// Mount
// ============================================================================

createRoot(document.body).render(<App />);
