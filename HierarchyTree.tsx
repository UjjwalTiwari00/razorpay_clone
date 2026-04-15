import * as React from "react";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";

/** Snapshot of a single record – detached from the live PCF dataset. */
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

const COL_PREFIX = "GBS_LEVEL_";

interface Props {
  records: RecordSnapshot[];
  totalRows: number;
  maxLevels?: number;
  filterId?: string;
  filterName?: string;
  strategyTypeKey?: number;
  isLoadingMore?: boolean;
  onSelectionChange?: (names: string[], ids: string[]) => void;
  onRefresh?: () => void; // ✅ Refresh callback from index.tsx
}

// ─────────────────────────────────────────────────────────────
// buildTree — kept identical to your original, just cleaned up
// ─────────────────────────────────────────────────────────────
function buildTree(
  records: RecordSnapshot[],
  maxLevels: number,
  filterId: string,
  filterName: string,
  strategyTypeKey: number
): TreeNode[] {
  const cols = Array.from({ length: maxLevels }, (_, i) => `${COL_PREFIX}${i + 1}`);
  const map = new Map<string, TreeNode>();
  const leafDataMap = new Map<string, { strategyName: string; strategyId: string }>();

  for (const rec of records) {
    // — Filter by record ID —
    if (filterId && rec.id !== filterId) continue;

    // — Filter by STRATEGY_TYPE_KEY —
    if (strategyTypeKey > 0) {
      const typeKeyVal = Number(rec.values["STRATEGY_TYPE_KEY"] ?? 0);
      if (typeKeyVal !== strategyTypeKey) continue;
    }

    // — Filter by Level 1 name —
    if (filterName) {
      const level1Val = String(rec.values[`${COL_PREFIX}1`] ?? "").trim();
      if (level1Val.toLowerCase() !== filterName.toLowerCase()) continue;
    }

    const strategyName = String(rec.values["STRATEGY_NAME"] ?? "").trim();
    const strategyId   = String(rec.values["STRATEGY_ID"]   ?? "").trim();

    let parentPath = "";
    let lastPath = "";

    for (const col of cols) {
      const raw = rec.values[col];
      const val = String(raw ?? "").trim();
      if (!val || val.toLowerCase() === "null") continue;

      const path = parentPath ? `${parentPath}|||${val}` : val;
      if (!map.has(path)) map.set(path, { label: val, path, children: [] });
      parentPath = path;
      lastPath = path;
    }

    if (lastPath) {
      leafDataMap.set(lastPath, { strategyName, strategyId });
    }
  }

  // — Assemble parent→child relationships —
  const roots: TreeNode[] = [];
  map.forEach((node) => {
    const sep = node.path.lastIndexOf("|||");
    if (sep === -1) roots.push(node);
    else map.get(node.path.substring(0, sep))?.children.push(node);
  });

  // — Attach leaf metadata in single pass (no extra traversal) —
  map.forEach((node, path) => {
    if (node.children.length === 0) {
      const data = leafDataMap.get(path);
      if (data) {
        node.strategyName = data.strategyName;
        node.strategyId   = data.strategyId;
      }
    }
  });

  return roots;
}

// ─────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────
function findMatches(
  nodes: TreeNode[],
  q: string
): { matchPaths: Set<string>; expandPaths: Set<string>; matchList: string[] } {
  const matchPaths  = new Set<string>();
  const expandPaths = new Set<string>();
  const matchList: string[] = [];

  const walk = (node: TreeNode) => {
    const displayLabel =
      node.children.length === 0 && node.strategyName
        ? node.strategyName
        : node.label;

    if (displayLabel.toLowerCase().includes(q)) {
      matchPaths.add(node.path);
      matchList.push(node.path);
      const parts = node.path.split("|||");
      let ancestor = "";
      for (let i = 0; i < parts.length - 1; i++) {
        ancestor = ancestor ? `${ancestor}|||${parts[i]}` : parts[i];
        expandPaths.add(ancestor);
      }
    }
    node.children.forEach(walk);
  };

  nodes.forEach(walk);
  return { matchPaths, expandPaths, matchList };
}

function leafPaths(node: TreeNode): string[] {
  if (node.children.length === 0) return [node.path];
  return node.children.flatMap(leafPaths);
}

function collectLeafData(node: TreeNode): { name: string; id: string }[] {
  if (node.children.length === 0) {
    return [{ name: node.strategyName ?? node.label, id: node.strategyId ?? "" }];
  }
  return node.children.flatMap(collectLeafData);
}

function getCheckState(node: TreeNode, checked: Set<string>): "checked" | "unchecked" {
  const leaves = leafPaths(node);
  return leaves.every((p) => checked.has(p)) ? "checked" : "unchecked";
}

// ─────────────────────────────────────────────────────────────
// Node component — React.memo prevents re-render when props unchanged
// ─────────────────────────────────────────────────────────────
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
    const hasChildren  = node.children.length > 0;
    const checkState   = getCheckState(node, checked);
    const INDENT       = 16;

    const forceOpen    = expandPaths.has(node.path);
    const open         = userOpen || forceOpen;
    const isMatch      = matchPaths.has(node.path);
    const isActiveMatch = activeMatchPath === node.path;

    const displayLabel =
      !hasChildren && node.strategyName ? node.strategyName : node.label;

    const renderLabel = () => {
      if (!highlight) return displayLabel;
      const idx = displayLabel.toLowerCase().indexOf(highlight);
      if (idx === -1) return displayLabel;
      return (
        <>
          {displayLabel.slice(0, idx)}
          <mark style={{ background: "#FFF176", padding: "0 0px", borderRadius: 2 }}>
            {displayLabel.slice(idx, idx + highlight.length)}
          </mark>
          {displayLabel.slice(idx + highlight.length)}
        </>
      );
    };

    const rowBg = isActiveMatch
      ? "#D4E8FC"
      : isMatch
      ? "#EEF4FB"
      : "transparent";

    const leftBorder = isMatch ? "3px solid #0078D4" : "3px solid transparent";

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
            else if (isActiveMatch) e.currentTarget.style.background = "#D4E8FC";
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

          {/* L-shaped connector for this node */}
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

          {/* Expand/collapse toggle */}
          {hasChildren && (
            <span
              onClick={(e) => { e.stopPropagation(); setUserOpen((o) => !o); }}
              style={{
                width: 16, height: 16,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, marginRight: 5,
                border: "1px solid #C8C6C4", borderRadius: 2,
                background: "#fff", position: "relative", zIndex: 1,
              }}
            >
              {open ? "−" : "+"}
            </span>
          )}

          {/* Checkbox */}
          <input
            type="checkbox"
            checked={checkState === "checked"}
            style={{
              width: 13, height: 13, marginRight: 6,
              flexShrink: 0, cursor: "pointer", accentColor: "#0078D4",
            }}
            onChange={(e) => { e.stopPropagation(); onCheck(node, e.target.checked); }}
          />

          {/* Label */}
          <span
            onClick={() => hasChildren && setUserOpen((o) => !o)}
            style={{
              fontSize: 12, color: "#201F1E",
              fontFamily: "Segoe UI, sans-serif",
              whiteSpace: "nowrap", flex: 1,
              lineHeight: "28px", textAlign: "left",
            }}
          >
            {renderLabel()}
          </span>
        </div>

        {/* Children */}
        {hasChildren && open && (
          <ul style={{ margin: 0, padding: 0 }}>
            {node.children.map((child, idx) => {
              const childParentLines = [...parentLines, !isLast];
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

// ─────────────────────────────────────────────────────────────
// Main HierarchyTree component
// ─────────────────────────────────────────────────────────────
export const HierarchyTree: React.FC<Props> = ({
  records,
  totalRows,
  maxLevels = 15,
  filterId = "",
  filterName = "",
  strategyTypeKey = 0,
  isLoadingMore = false,
  onSelectionChange,
  onRefresh,
}) => {
  const [inputValue, setInputValue]           = useState("");
  const [query, setQuery]                     = useState("");
  const [checked, setChecked]                 = useState<Set<string>>(new Set());
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const [isRefreshingUI, setIsRefreshingUI]   = useState(false);
  const scrollRef  = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery(value), 300);
  }, []);

  // Clear debounce on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Clear search when data starts loading
  useEffect(() => {
    if (isLoadingMore) {
      setQuery("");
      setInputValue("");
      if (debounceRef.current) clearTimeout(debounceRef.current);
    }
  }, [isLoadingMore]);

  // Clear refresh spinner when data arrives
  useEffect(() => {
    if (!isLoadingMore) setIsRefreshingUI(false);
  }, [isLoadingMore, records.length]);

  // Build tree — only recomputes when actual data/filters change
  //const tree = useMemo(
  //  () => buildTree(records, maxLevels, filterId, filterName, strategyTypeKey),
  //  [records, maxLevels, filterId, filterName, strategyTypeKey]
    //);

    //sushil changes
    const tree = useMemo(
        () => buildTree(records, maxLevels, filterId, filterName, strategyTypeKey),
        [records.length, maxLevels, filterId, filterName, strategyTypeKey]
    );
  // Search matches
  const { matchPaths, expandPaths, matchList } = useMemo(() => {
    if (!query) return { matchPaths: new Set<string>(), expandPaths: new Set<string>(), matchList: [] as string[] };
    return findMatches(tree, query.toLowerCase());
  }, [tree, query]);

  // Reset match index when query changes
  useEffect(() => { setCurrentMatchIdx(0); }, [query, matchList.length]);

  // Auto-scroll to active match
  useEffect(() => {
    if (matchList.length > 0 && scrollRef.current) {
      const timer = setTimeout(() => {
        scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentMatchIdx, matchList]);

  const activeMatchPath = matchList.length > 0 ? matchList[currentMatchIdx] ?? null : null;

  const goToNextMatch = useCallback(() => {
    setCurrentMatchIdx((prev) => (prev + 1) % matchList.length);
  }, [matchList.length]);

  const goToPrevMatch = useCallback(() => {
    setCurrentMatchIdx((prev) => (prev - 1 + matchList.length) % matchList.length);
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

  // Notify Canvas App when selection changes
  useEffect(() => {
    if (!onSelectionChange) return;
    const names: string[] = [];
    const ids: string[]   = [];
    const collectSelected = (node: TreeNode) => {
      if (node.children.length === 0 && checked.has(node.path)) {
        names.push(node.strategyName ?? node.label);
        ids.push(node.strategyId ?? "");
      }
      node.children.forEach(collectSelected);
    };
    tree.forEach(collectSelected);
    onSelectionChange(names, ids);
  }, [checked]);

  // Handle checkbox
  const handleCheck = useCallback((node: TreeNode, isChecked: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      leafPaths(node).forEach((p) => (isChecked ? next.add(p) : next.delete(p)));
      return next;
    });
  }, []);

  // Handle refresh button click
  const handleRefresh = useCallback(() => {
    if (!onRefresh || isRefreshingUI) return;
    setIsRefreshingUI(true);
    setChecked(new Set());   // clear selection on refresh
    setQuery("");
    setInputValue("");
      onRefresh(); 
      setTimeout(() => {
          setIsRefreshingUI(false);
      }, 3000);
    // calls context.parameters.tableGrid.refresh()
  }, [onRefresh, isRefreshingUI]);

  if (totalRows === 0 && !isLoadingMore) {
    return (
      <div style={{ padding: 24, color: "#A19F9D", fontSize: 12, textAlign: "center", fontFamily: "Segoe UI, sans-serif" }}>
        No data available.
      </div>
    );
  }

  const checkedCount  = checked.size;
  const treeNodeCount = tree.length;

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
      {/* ── Search + Refresh bar ── */}
      <div style={{ padding: "10px 12px", background: "#F3F2F1", flexShrink: 0, borderBottom: "1px solid #EDEBE9" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>

          {/* Search input */}
          <div style={{ position: "relative", flex: 1 }}>
            <input
              type="text"
              placeholder={isLoadingMore ? "Search available after loading..." : "Search hierarchy..."}
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              disabled={isLoadingMore}
              style={{
                width: "100%",
                padding: "5px 10px 5px 28px",
                border: "1px solid #C8C6C4",
                borderRadius: 4,
                fontSize: 12,
                boxSizing: "border-box",
                outline: "none",
                fontFamily: "Segoe UI, sans-serif",
                color: isLoadingMore ? "#A19F9D" : "#201F1E",
              }}
            />
            {/* Search icon */}
            <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#605E5C", fontSize: 13 }}>
              🔍
            </span>
            {/* Clear button */}
            {inputValue && !isLoadingMore && (
              <span
                onClick={() => { setInputValue(""); setQuery(""); if (debounceRef.current) clearTimeout(debounceRef.current); }}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "#605E5C", fontSize: 14 }}
              >
                ✕
              </span>
            )}
          </div>

          {/* ✅ Refresh button */}
          {onRefresh && (
            <button
              onClick={handleRefresh}
                          /*disabled={isRefreshingUI || isLoadingMore}*/
                          disabled={isRefreshingUI}
                         
              title="Refresh data"
              style={{
                width: 30,
                  height: 30,
                  opacity: isLoadingMore ? 0.6 : 1,
                border: "1px solid #C8C6C4",
                borderRadius: 4,
                background: isRefreshingUI ? "#F3F2F1" : "#fff",
                cursor: isRefreshingUI || isLoadingMore ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
                flexShrink: 0,
                color: "#0078D4",
                transition: "background 0.2s",
              }}
            >
              {isRefreshingUI ? (
                <span style={{ display: "inline-block", animation: "pcf-spin 1s linear infinite" }}>↻</span>
              ) : (
                "↻"
              )}
            </button>
          )}
        </div>

        {/* Match counter + prev/next */}
        {query && !isLoadingMore && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: matchList.length > 0 ? "#605E5C" : "#A4262C", whiteSpace: "nowrap", minWidth: 50, textAlign: "center" }}>
              {matchList.length > 0
                ? `${currentMatchIdx + 1} / ${matchList.length}`
                : "No matches"}
            </span>
            {matchList.length > 1 && (
              <>
                <button onClick={goToPrevMatch} title="Previous match (Shift+Enter)"
                  style={{ width: 24, height: 24, border: "1px solid #C8C6C4", borderRadius: 3, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                  ▲
                </button>
                <button onClick={goToNextMatch} title="Next match (Enter)"
                  style={{ width: 24, height: 24, border: "1px solid #C8C6C4", borderRadius: 3, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                  ▼
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Tree ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        <ul style={{ margin: 0, padding: 0, width: "max-content", minWidth: "100%" }}>
          {tree.map((node, idx) => (
            <Node
              key={node.path}
              node={node}
              depth={0}
              checked={checked}
              onCheck={handleCheck}
              highlight={(!isLoadingMore && query) ? query.toLowerCase() : undefined}
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

      {/* ── Selection footer ── */}
      {checkedCount > 0 && (
        <div style={{ borderTop: "1px solid #EDEBE9", padding: "8px 16px", background: "#F3F2F1", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: "#605E5C" }}>
            {checkedCount} item{checkedCount !== 1 ? "s" : ""} selected
          </span>
          <span
            onClick={() => setChecked(new Set())}
            style={{ fontSize: 12, color: "#0078D4", cursor: "pointer", fontWeight: 600 }}
          >
            Clear all
          </span>
        </div>
      )}

      {/* ── Bottom loading indicator while paging ── */}
      {isLoadingMore && (
        <div style={{ borderTop: "1px solid #EDEBE9", padding: "6px 16px", background: "#FAF9F8", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ width: 14, height: 14, border: "2px solid #EDEBE9", borderTop: "2px solid #0078D4", borderRadius: "50%", animation: "pcf-spin 1s linear infinite", flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: "#605E5C", fontFamily: "Segoe UI, sans-serif" }}>
            Loading more rows… {totalRows.toLocaleString()} loaded so far
          </span>
          <style>{"@keyframes pcf-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }"}</style>
        </div>
      )}
    </div>
  );
};