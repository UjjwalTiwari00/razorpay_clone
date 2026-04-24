import * as React from "react";
import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Snapshot of a single record - detached from the live PCF dataset. */
export interface RecordSnapshot {
  id: string;
  values: Record<string, unknown>;
}

interface TreeNode {
  label: string;
  path: string;
  children: TreeNode[];
  strategyName?: string;
  strategyId?: string;
}

interface Props {
  records: RecordSnapshot[];
  totalRows: number;
  maxLevels?: number;
  filterId?: string;
  filterName?: string;
  strategyTypeKey?: number;
  onSelectionChange?: (names: string[], ids: string[]) => void;
  onRefresh?: () => void;
}

interface SearchEntry {
  path: string;
  node: TreeNode;
  haystack: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const COL_PREFIX = "GBS_LEVEL_";
const PATH_SEP = "|||";

// ─────────────────────────────────────────────────────────────────────────────
// buildTree — Option B: Every strategy gets its own leaf node
// ─────────────────────────────────────────────────────────────────────────────

function buildTree(
  records: RecordSnapshot[],
  maxLevels: number,
  filterId: string,
  filterName: string,
  strategyTypeKey: number
): { roots: TreeNode[]; totalStrategies: number } {

  const cols = Array.from(
    { length: maxLevels },
    (_, i) => `${COL_PREFIX}${i + 1}`
  );

  const map = new Map<string, TreeNode>();
  
  // [OPTION B] Store ALL strategies per path — no data loss
  const leafStrategiesMap = new Map<string, { strategyName: string; strategyId: string }[]>();

  for (const rec of records) {
    if (filterId && rec.id !== filterId) continue;

    if (strategyTypeKey > 0) {
      const typeKeyVal = Number(rec.values["STRATEGY_TYPE_KEY"] ?? 0);
      if (typeKeyVal !== strategyTypeKey) continue;
    }

    if (filterName) {
      const level1Val = String(rec.values[`${COL_PREFIX}1`] ?? "").trim();
      if (level1Val.toLowerCase() !== filterName.toLowerCase()) continue;
    }

    const strategyName = String(rec.values["STRATEGY_NAME"] ?? "").trim();
    const strategyId   = String(rec.values["STRATEGY_ID"]   ?? "").trim();

    let parentPath = "";
    let lastPath   = "";

    for (const col of cols) {
      const raw = rec.values[col];
      const val = String(raw ?? "").trim();

      if (!val || val.toLowerCase() === "null") break;

      const path = parentPath ? `${parentPath}${PATH_SEP}${val}` : val;

      if (!map.has(path)) {
        map.set(path, { label: val, path, children: [] });
      }

      parentPath = path;
      lastPath   = path;
    }

    if (lastPath) {
      // [OPTION B] Append to array — every strategy preserved
      const existing = leafStrategiesMap.get(lastPath);
      if (existing) {
        existing.push({ strategyName, strategyId });
      } else {
        leafStrategiesMap.set(lastPath, [{ strategyName, strategyId }]);
      }
    }
  }

  // Assemble parent → child relationships
  const roots: TreeNode[] = [];
  map.forEach((node) => {
    const sep = node.path.lastIndexOf(PATH_SEP);
    if (sep === -1) {
      roots.push(node);
    } else {
      map.get(node.path.substring(0, sep))?.children.push(node);
    }
  });

  // [OPTION B] Count total strategies BEFORE exploding
  let totalStrategies = 0;
  leafStrategiesMap.forEach((strategies) => {
    totalStrategies += strategies.length;
  });

  // [OPTION B] EXPLODE: Convert multi-strategy nodes into individual child leaves
  leafStrategiesMap.forEach((strategies, path) => {
    const node = map.get(path);
    if (!node) return;

    if (strategies.length === 1) {
      // Single strategy — attach directly to the node
      node.strategyName = strategies[0].strategyName;
      node.strategyId   = strategies[0].strategyId;
    } else {
      // Multiple strategies — create individual child leaf for EACH strategy
      // The parent becomes a pure folder (no strategy data)
      node.strategyName = undefined;
      node.strategyId   = undefined;

      strategies.forEach((s, idx) => {
        const childPath = `${path}${PATH_SEP}__STRAT__${idx}__${s.strategyId}`;
        const childNode: TreeNode = {
          label: s.strategyName,
          path: childPath,
          children: [],
          strategyName: s.strategyName,
          strategyId: s.strategyId,
        };
        map.set(childPath, childNode);
        node.children.push(childNode);
      });
    }
  });

  return { roots, totalStrategies };
}

// ─────────────────────────────────────────────────────────────────────────────
// Search helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildSearchIndex(roots: TreeNode[]): SearchEntry[] {
  const index: SearchEntry[] = [];

  function walk(node: TreeNode) {
    const parts = node.path.split(PATH_SEP);
    const displayLabel =
      node.children.length === 0 && node.strategyName
        ? node.strategyName
        : node.label;

    const texts = [
      displayLabel,
      node.strategyName ?? "",
      node.strategyId   ?? "",
      ...parts,
    ];

    index.push({
      path: node.path,
      node,
      haystack: texts
        .join(" ")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim(),
    });

    node.children.forEach(walk);
  }

  roots.forEach(walk);
  return index;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree helpers
// ─────────────────────────────────────────────────────────────────────────────

function leafPaths(node: TreeNode): string[] {
  if (node.children.length === 0) return [node.path];
  return node.children.flatMap(leafPaths);
}

function getCheckState(
  node: TreeNode,
  checked: Set<string>
): "checked" | "unchecked" | "indeterminate" {
  const leaves = leafPaths(node);
  const checkedCount = leaves.filter((p) => checked.has(p)).length;
  if (checkedCount === 0) return "unchecked";
  if (checkedCount === leaves.length) return "checked";
  return "indeterminate";
}

// ─────────────────────────────────────────────────────────────────────────────
// Node component
// ─────────────────────────────────────────────────────────────────────────────

interface NodeProps {
  node: TreeNode;
  depth: number;
  checked: Set<string>;
  onCheck: (node: TreeNode, isChecked: boolean) => void;
  highlight?: string;
  isLast: boolean;
  parentLines: boolean[];
  matchPaths: Set<string>;
  expandPaths: Set<string>;
  activeMatchPath: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const INDENT = 16;

const Node: React.FC<NodeProps> = React.memo(
  ({
    node,
    depth,
    checked,
    onCheck,
    highlight,
    isLast,
    parentLines,
    matchPaths,
    expandPaths,
    activeMatchPath,
    scrollRef,
  }) => {
    const [userOpen, setUserOpen] = useState(depth === 0);
    const hasChildren = node.children.length > 0;
    const checkState  = getCheckState(node, checked);

    const forceOpen     = expandPaths.has(node.path);
    const open          = userOpen || forceOpen;
    const isMatch       = matchPaths.has(node.path);
    const isActiveMatch = activeMatchPath === node.path;

    // [OPTION B] Leaf nodes show strategyName; folder nodes show label
    const displayLabel =
      !hasChildren && node.strategyName ? node.strategyName : node.label;

    const checkboxRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
      if (checkboxRef.current) {
        checkboxRef.current.indeterminate = checkState === "indeterminate";
      }
    }, [checkState]);

    const renderLabel = () => {
      if (!highlight) return displayLabel;
      const idx = displayLabel.toLowerCase().indexOf(highlight);
      if (idx === -1) return displayLabel;
      return (
        <>
          {displayLabel.slice(0, idx)}
          <mark
            style={{ background: "#FEF176", padding: "0 0px", borderRadius: 2 }}
          >
            {displayLabel.slice(idx, idx + highlight.length)}
          </mark>
          {displayLabel.slice(idx + highlight.length)}
        </>
      );
    };

    const rowBg =
      isActiveMatch ? "#D4E8FC" : isMatch ? "#EEF4FB" : "transparent";
    const leftBorder = isMatch
      ? "3px solid #0078D4"
      : "3px solid transparent";

    return (
      <li style={{ listStyle: "none", margin: 0, padding: 0, position: "relative" }}>
        <div
          ref={isActiveMatch ? scrollRef : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            height: 28,
            paddingRight: 6,
            borderRadius: 4,
            cursor: "pointer",
            position: "relative",
            background: rowBg,
            borderLeft: leftBorder,
            transition: "background 0.2s ease",
          }}
          onMouseEnter={(e) => {
            if (!isMatch) e.currentTarget.style.background = "#EEF4FB";
          }}
          onMouseLeave={(e) => {
            if (!isMatch) e.currentTarget.style.background = "transparent";
            else if (isActiveMatch)
              e.currentTarget.style.background = "#D4E8FC";
            else e.currentTarget.style.background = "#EEF4FB";
          }}
        >
          {/* Vertical connector lines from ancestors */}
          {Array.from({ length: depth }).map((_, i) => (
            <span
              key={i}
              style={{
                position: "absolute",
                left: i * INDENT + 8,
                top: 0,
                bottom: 0,
                width: 1,
                background: parentLines[i] ? "#C8C6C4" : "transparent",
                pointerEvents: "none",
              }}
            />
          ))}

          {/* L-shaped connector */}
          {depth > 0 && (
            <>
              <span
                style={{
                  position: "absolute",
                  left: (depth - 1) * INDENT + 8,
                  top: 0,
                  height: isLast ? "50%" : "100%",
                  width: 1,
                  background: "#C8C6C4",
                  pointerEvents: "none",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: (depth - 1) * INDENT + 8,
                  top: "50%",
                  width: INDENT - 7,
                  height: 1,
                  background: "#C8C6C4",
                  pointerEvents: "none",
                }}
              />
            </>
          )}

          <span style={{ width: depth * INDENT, flexShrink: 0 }} />

          {/* Expand / Collapse button */}
          {hasChildren && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setUserOpen((o) => !o);
              }}
              style={{
                width: 16,
                height: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginRight: 5,
                border: "1px solid #C8C6C4",
                borderRadius: 2,
                background: "#fff",
                position: "relative",
                zIndex: 1,
                userSelect: "none",
              }}
            >
              {open ? "−" : "+"}
            </span>
          )}

          {/* Checkbox */}
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={checkState === "checked"}
            style={{
              width: 13,
              height: 13,
              marginRight: 6,
              flexShrink: 0,
              cursor: "pointer",
              accentColor: "#0078D4",
            }}
            onChange={(e) => {
              e.stopPropagation();
              onCheck(node, e.target.checked);
            }}
          />

          {/* Label */}
          <span
            onClick={() => hasChildren && setUserOpen((o) => !o)}
            style={{
              fontSize: 12,
              color: "#201F1E",
              fontFamily: "Segoe UI, sans-serif",
              whiteSpace: "nowrap",
              flex: 1,
              lineHeight: "28px",
              textAlign: "left",
              userSelect: "none",
            }}
          >
            {renderLabel()}
          </span>
        </div>

        {/* Children */}
        {hasChildren && open && (
          <ul style={{ margin: 0, padding: 0 }}>
            {node.children.map((child, idx) => {
              const childParentLines = [...parentLines];
              if (depth > 0 && !isLast) childParentLines[depth - 1] = true;

              return (
                <Node
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  checked={checked}
                  onCheck={onCheck}
                  highlight={highlight}
                  isLast={idx === node.children.length - 1}
                  parentLines={childParentLines}
                  matchPaths={matchPaths}
                  expandPaths={expandPaths}
                  activeMatchPath={activeMatchPath}
                  scrollRef={scrollRef}
                />
              );
            })}
          </ul>
        )}
      </li>
    );
  }
);

Node.displayName = "Node";

// ─────────────────────────────────────────────────────────────────────────────
// HierarchyTree – main export
// ─────────────────────────────────────────────────────────────────────────────

export const HierarchyTree: React.FC<Props> = ({
  records,
  totalRows,
  maxLevels = 15,
  filterId = "",
  filterName = "",
  strategyTypeKey = 0,
  onSelectionChange,
  onRefresh,
}) => {
  const [inputValue, setInputValue]       = useState("");
  const [query, setQuery]                 = useState("");
  const [checked, setChecked]             = useState<Set<string>>(new Set());
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const [isRefreshingUI, setIsRefreshingUI]   = useState(false);
  const [forceClear, setForceClear]           = useState(false);

  const scrollRef  = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Debounce search input ──
  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery(value), 300);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Handle refresh UI reset ──
  useEffect(() => {
    if (forceClear && records.length > 0) {
      setForceClear(false);
      setIsRefreshingUI(false);
    }
  }, [records.length, forceClear]);

  // ── Build tree — Option B returns {roots, totalStrategies} ──
  const { roots: tree, totalStrategies: actualTotalRows } = useMemo(
    () =>
      forceClear
        ? { roots: [] as TreeNode[], totalStrategies: 0 }
        : buildTree(records, maxLevels, filterId, filterName, strategyTypeKey),
    [records, maxLevels, filterId, filterName, strategyTypeKey, forceClear]
  );

  // ── Pre-build search index ──
  const searchIndex = useMemo(() => buildSearchIndex(tree), [tree]);

  // ── Search matches ──
  const { matchPaths, expandPaths, matchList } = useMemo(() => {
    if (!query)
      return {
        matchPaths:  new Set<string>(),
        expandPaths: new Set<string>(),
        matchList:   [] as string[],
      };
    
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    
    let matches = searchIndex.filter((entry) =>
      words.every((w) => entry.haystack.includes(w))
    );

    // Sort by relevance: exact → startsWith → contains
    matches = matches.sort((a, b) => {
      const aName = (a.node.strategyName || a.node.label).toLowerCase();
      const bName = (b.node.strategyName || b.node.label).toLowerCase();

      if (aName === q && bName !== q) return -1;
      if (bName === q && aName !== q) return 1;
      if (aName.startsWith(q) && !bName.startsWith(q)) return -1;
      if (bName.startsWith(q) && !aName.startsWith(q)) return 1;
      return 0;
    });

    const matchList = matches.map((m) => m.path);
    const matchPaths = new Set(matchList);
    const expandPaths = new Set<string>();

    for (const path of matchList) {
      const parts = path.split(PATH_SEP);
      let ancestor = "";
      for (let i = 0; i < parts.length - 1; i++) {
        ancestor = ancestor ? `${ancestor}${PATH_SEP}${parts[i]}` : parts[i];
        expandPaths.add(ancestor);
      }
    }

    return { matchPaths, expandPaths, matchList };
  }, [searchIndex, query]);

  // ── Reset match index when query or result count changes ──
  useEffect(() => {
    setCurrentMatchIdx(0);
  }, [query, matchList.length]);

  // ── Auto-scroll to active match ──
  useEffect(() => {
    if (matchList.length > 0 && scrollRef.current) {
      const timer = setTimeout(() => {
        scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentMatchIdx, matchList]);

  const activeMatchPath =
    matchList.length > 0 ? (matchList[currentMatchIdx] ?? null) : null;

  const goToNextMatch = useCallback(() => {
    setCurrentMatchIdx((prev) => (prev + 1) % matchList.length);
  }, [matchList.length]);

  const goToPrevMatch = useCallback(() => {
    setCurrentMatchIdx(
      (prev) => (prev - 1 + matchList.length) % matchList.length
    );
  }, [matchList.length]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && matchList.length > 0) {
        e.preventDefault();
        if (e.shiftKey) goToPrevMatch();
        else goToNextMatch();
      }
    },
    [matchList.length, goToNextMatch, goToPrevMatch]
  );

  // ── Notify parent on selection change ──
  // [OPTION B] Every leaf node is an individual strategy — count is exact
  useEffect(() => {
    if (!onSelectionChange) return;

    const names: string[] = [];
    const ids:   string[] = [];

    const collectSelected = (node: TreeNode) => {
      // [OPTION B] Only true leaves (no children) are selectable strategies
      if (node.children.length === 0 && checked.has(node.path)) {
        names.push(node.strategyName ?? node.label);
        ids.push(node.strategyId ?? "");
        return;
      }
      node.children.forEach(collectSelected);
    };

    tree.forEach(collectSelected);
    onSelectionChange(names, ids);
  }, [checked, tree, onSelectionChange]);

  // ── Handle checkbox toggle ──
  const handleCheck = useCallback((node: TreeNode, isChecked: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      leafPaths(node).forEach((p) =>
        isChecked ? next.add(p) : next.delete(p)
      );
      return next;
    });
  }, []);

  // ── Handle refresh button ──
  const handleRefresh = useCallback(() => {
    if (!onRefresh || isRefreshingUI) return;

    setIsRefreshingUI(true);
    setForceClear(true);
    setChecked(new Set());
    setQuery("");
    setInputValue("");
    setCurrentMatchIdx(0);

    if (onSelectionChange) onSelectionChange([], []);

    onRefresh();
  }, [onRefresh, isRefreshingUI, onSelectionChange]);

  // ─────────────────────────────────────────────────────────
  // Loading / empty states
  // ─────────────────────────────────────────────────────────

  if (forceClear || isRefreshingUI) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          fontFamily: "Segoe UI, sans-serif",
          color: "#605E5C",
          gap: 12,
          background: "#FFFFFF",
          border: "1px solid #EDEBE9",
          borderRadius: 4,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: "3px solid #EDEBE9",
            borderTop: "3px solid #0078D4",
            borderRadius: "50%",
            animation: "pcf-spin 1s linear infinite",
          }}
        />
        <span style={{ fontSize: 13 }}>Refreshing data, please wait...</span>
        <style>{`
          @keyframes pcf-spin {
            0%   { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // [OPTION B] Use actualTotalRows from buildTree, not the prop
  const displayTotalRows = actualTotalRows;

  if (displayTotalRows === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: "#A19F9D",
          fontSize: 12,
          textAlign: "center",
          fontFamily: "Segoe UI, sans-serif",
        }}
      >
        No data available.
      </div>
    );
  }

  const checkedCount = checked.size;

  // ─────────────────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────────────────
  return (
    <div
      style={{
        fontFamily: "Segoe UI, sans-serif",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#FFFFFF",
        border: "1px solid #EDEBE9",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      {/* ── Top bar: Refresh button ── */}
      <div style={{ flexShrink: 0, borderBottom: "1px solid #EDEBE9" }}>
        <div
          style={{
            padding: "2px 4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {onRefresh && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshingUI}
              title="Refresh Book Structure"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 4,
                border: "1px solid #0078D4",
                background: isRefreshingUI ? "#E5F1FB" : "#0078D4",
                color: isRefreshingUI ? "#605E5C" : "#FFFFFF",
                cursor: isRefreshingUI ? "not-allowed" : "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  animation: isRefreshingUI
                    ? "pcf-spin 1s linear infinite"
                    : "none",
                }}
              >
                ⟳
              </span>
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* ── Header: title + row count ── */}
      <div
        style={{
          padding: "2px 4px",
          borderBottom: "1px solid #C7E0F4",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "#004578",
            fontFamily: "Open Sans, Segoe UI, sans-serif",
            margin: "2px 0",
          }}
        >
          Book Structure
        </h2>
        <span style={{ fontSize: 11, color: "#605E5C", fontFamily: "Segoe UI, sans-serif" }}>
          {displayTotalRows.toLocaleString()} strategies loaded
        </span>
      </div>

      {/* ── Search bar ── */}
      <div
        style={{
          padding: "6px 8px",
          borderBottom: "1px solid #EDEBE9",
          flexShrink: 0,
        }}
      >
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ position: "relative", flex: 1 }}>
            {/* Search icon */}
            <span
              style={{
                position: "absolute",
                left: 8,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#A19F9D",
                fontSize: 13,
                pointerEvents: "none",
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Search hierarchies..."
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              style={{
                width: "100%",
                padding: "5px 28px 5px 28px",
                border: "1px solid #C8C6C4",
                borderRadius: 4,
                fontSize: 12,
                boxSizing: "border-box",
                outline: "none",
                fontFamily: "Segoe UI, sans-serif",
                color: "#201F1E",
              }}
            />
            {/* Clear button */}
            {inputValue && (
              <span
                onClick={() => {
                  setInputValue("");
                  setQuery("");
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                }}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  cursor: "pointer",
                  color: "#605E5C",
                  fontSize: 14,
                }}
              >
                ×
              </span>
            )}
          </div>
        </div>

        {/* Match counter + navigation */}
        {query && (
          <div
            style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}
          >
            <span
              style={{
                fontSize: 11,
                color: matchList.length > 0 ? "#605E5C" : "#A4262C",
                whiteSpace: "nowrap",
                minWidth: 50,
                textAlign: "center",
              }}
            >
              {matchList.length > 0
                ? `${currentMatchIdx + 1} / ${matchList.length}`
                : "No matches"}
            </span>
            {matchList.length > 1 && (
              <>
                <button
                  onClick={goToPrevMatch}
                  title="Previous match (Shift+Enter)"
                  style={navBtnStyle}
                >
                  ↑
                </button>
                <button
                  onClick={goToNextMatch}
                  title="Next match (Enter)"
                  style={navBtnStyle}
                >
                  ↓
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Tree ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 6px" }}>
        <ul style={{ margin: 0, padding: 0, width: "max-content", minWidth: "100%" }}>
          {tree.map((node, idx) => (
            <Node
              key={node.path}
              node={node}
              depth={0}
              checked={checked}
              onCheck={handleCheck}
              highlight={query ? query.toLowerCase() : undefined}
              isLast={idx === tree.length - 1}
              parentLines={[]}
              matchPaths={matchPaths}
              expandPaths={expandPaths}
              activeMatchPath={activeMatchPath}
              scrollRef={scrollRef}
            />
          ))}
        </ul>
      </div>

      {/* ── Footer: selection summary ── */}
      {checkedCount > 0 && (
        <div
          style={{
            borderTop: "1px solid #EDEBE9",
            padding: "8px 16px",
            background: "#F3F2F1",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: "#605E5C" }}>
            {checkedCount.toLocaleString()} item{checkedCount !== 1 ? "s" : ""} selected
          </span>
          <span
            onClick={() => setChecked(new Set())}
            style={{
              fontSize: 12,
              color: "#0078D4",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Clear all
          </span>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Style helpers
// ─────────────────────────────────────────────────────────────────────────────

const navBtnStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 11,
  border: "1px solid #C8C6C4",
  borderRadius: 3,
  background: "#fff",
  cursor: "pointer",
  fontFamily: "Segoe UI, sans-serif",
  lineHeight: 1.4,
};