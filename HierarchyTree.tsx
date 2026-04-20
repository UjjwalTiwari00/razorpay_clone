import * as React from "react";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";

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

function buildTree(
  records: RecordSnapshot[],
  filterId: string,
  filterName: string,
  strategyTypeKey: number
): TreeNode[] {
  const map = new Map<string, TreeNode>();

  for (const rec of records) {
    if (filterId && rec.id !== filterId) continue;

    if (strategyTypeKey > 0) {
      const typeKeyVal = Number(rec.values["STRATEGY_TYPE_KEY"]) || 0;
      if (typeKeyVal !== strategyTypeKey) continue;
    }

    const pathStr = String(rec.values["PATH"] ?? "").trim();
    const strategyName = String(rec.values["STRATEGY_NAME"] ?? "").trim();
    const strategyId = String(rec.values["STRATEGY_ID"] ?? "").trim();

    if (!pathStr || !strategyName || !strategyId) continue;

    const segments = pathStr.split("|||").map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) continue;

    if (filterName && segments[0].toLowerCase() !== filterName.toLowerCase()) continue;

    // Build parent nodes
    let parentPath = "";
    for (const segment of segments) {
      const currentPath = parentPath ? `${parentPath}|||${segment}` : segment;
      if (!map.has(currentPath)) {
        map.set(currentPath, { label: segment, path: currentPath, children: [] });
      }
      parentPath = currentPath;
    }

    // Unique leaf node
    const leafPath = `${pathStr}|||${strategyId}`;
    if (!map.has(leafPath)) {
      map.set(leafPath, {
        label: strategyName,
        path: leafPath,
        children: [],
        strategyName,
        strategyId,
      });
    }
  }

  // Link parents and children
  const roots: TreeNode[] = [];
  map.forEach((node) => {
    const sep = node.path.lastIndexOf("|||");
    if (sep === -1) {
      roots.push(node);
    } else {
      const parent = map.get(node.path.substring(0, sep));
      if (parent) parent.children.push(node);
    }
  });

  return roots;
}

function findMatches(nodes: TreeNode[], q: string) {
  const matchPaths = new Set<string>();
  const expandPaths = new Set<string>();
  const matchList: string[] = [];

  const walk = (node: TreeNode) => {
    const label = node.children.length === 0 && node.strategyName ? node.strategyName : node.label;
    if (label.toLowerCase().includes(q)) {
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

const Node: React.FC<NodeProps> = React.memo(({
  node, depth, checked, onCheck, highlight,
  isLast, parentLines, matchPaths, expandPaths,
  activeMatchPath, scrollRef,
}) => {
  const [userOpen, setUserOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const INDENT = 16;
  const forceOpen = expandPaths.has(node.path);
  const open = userOpen || forceOpen;
  const isMatch = matchPaths.has(node.path);
  const isActiveMatch = activeMatchPath === node.path;
  const displayLabel = !hasChildren && node.strategyName ? node.strategyName : node.label;
  const leaves = leafPaths(node);
  const checkState = leaves.every(p => checked.has(p)) ? "checked" : "unchecked";

  const renderLabel = () => {
    if (!highlight) return displayLabel;
    const idx = displayLabel.toLowerCase().indexOf(highlight);
    if (idx === -1) return displayLabel;
    return (
      <>
        {displayLabel.slice(0, idx)}
        <mark style={{ background: "#FFF176", borderRadius: 2 }}>
          {displayLabel.slice(idx, idx + highlight.length)}
        </mark>
        {displayLabel.slice(idx + highlight.length)}
      </>
    );
  };

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
          background: isActiveMatch ? "#D4E8FC" : isMatch ? "#EEF4FB" : "transparent",
          borderLeft: isMatch ? "3px solid #0078D4" : "3px solid transparent",
          transition: "background 0.2s ease",
        }}
        onMouseEnter={e => { if (!isMatch) e.currentTarget.style.background = "#EEF4FB"; }}
        onMouseLeave={e => {
          if (!isMatch) e.currentTarget.style.background = "transparent";
          else if (isActiveMatch) e.currentTarget.style.background = "#D4E8FC";
          else e.currentTarget.style.background = "#EEF4FB";
        }}
      >
        <span style={{ width: depth * INDENT, flexShrink: 0 }} />

        {Array.from({ length: depth }).map((_, i) => (
          <span key={i} style={{
            position: "absolute", left: i * INDENT + 8,
            top: 0, bottom: 0, width: 1,
            background: parentLines[i] ? "#C8C6C4" : "transparent",
            pointerEvents: "none",
          }} />
        ))}

        {depth > 0 && (
          <>
            <span style={{
              position: "absolute", left: (depth - 1) * INDENT + 8,
              top: 0, height: isLast ? "50%" : "100%", width: 1,
              background: "#C8C6C4", pointerEvents: "none",
            }} />
            <span style={{
              position: "absolute", left: (depth - 1) * INDENT + 8,
              top: "50%", width: INDENT - 7, height: 1,
              background: "#C8C6C4", pointerEvents: "none",
            }} />
          </>
        )}

        {hasChildren && (
          <span
            onClick={e => { e.stopPropagation(); setUserOpen(o => !o); }}
            style={{
              width: 16, height: 16, display: "flex", alignItems: "center",
              justifyContent: "center", flexShrink: 0, marginRight: 5,
              border: "1px solid #C8C6C4", borderRadius: 2,
              background: "#fff", position: "relative", zIndex: 1,
            }}
          >
            {open ? "−" : "+"}
          </span>
        )}

        <input
          type="checkbox"
          checked={checkState === "checked"}
          style={{ width: 13, height: 13, marginRight: 6, flexShrink: 0, cursor: "pointer", accentColor: "#0078D4" }}
          onChange={e => { e.stopPropagation(); onCheck(node, e.target.checked); }}
        />

        <span
          onClick={() => hasChildren && setUserOpen(o => !o)}
          style={{
            fontSize: 12, color: "#201F1E", fontFamily: "Segoe UI, sans-serif",
            whiteSpace: "nowrap", flex: 1, lineHeight: "28px", textAlign: "left",
          }}
        >
          {renderLabel()}
        </span>
      </div>

      {hasChildren && open && (
        <ul style={{ margin: 0, padding: 0 }}>
          {node.children.map((child, idx) => {
            const childParentLines = [...parentLines, !isLast];
            if (depth > 0 && isLast) childParentLines[depth - 1] = true;
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
});

export const HierarchyTree: React.FC<Props> = ({
  records, totalRows,
  filterId = "", filterName = "", strategyTypeKey = 0,
  onSelectionChange, onRefresh,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery(value), 300);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const tree = useMemo(
    () => buildTree(records, filterId, filterName, strategyTypeKey),
    [records, filterId, filterName, strategyTypeKey]
  );

  const { matchPaths, expandPaths, matchList } = useMemo(
    () => query ? findMatches(tree, query.toLowerCase()) : { matchPaths: new Set<string>(), expandPaths: new Set<string>(), matchList: [] as string[] },
    [tree, query]
  );

  useEffect(() => setCurrentMatchIdx(0), [query, matchList.length]);

  useEffect(() => {
    if (matchList.length > 0 && scrollRef.current) {
      const t = setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
      return () => clearTimeout(t);
    }
  }, [currentMatchIdx, matchList]);

  const activeMatchPath = matchList.length > 0 ? matchList[currentMatchIdx] ?? null : null;

  const goToNext = useCallback(() => setCurrentMatchIdx(p => (p + 1) % matchList.length), [matchList.length]);
  const goToPrev = useCallback(() => setCurrentMatchIdx(p => (p - 1 + matchList.length) % matchList.length), [matchList.length]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && matchList.length > 0) {
      e.preventDefault();
      e.shiftKey ? goToPrev() : goToNext();
    }
  }, [matchList.length, goToNext, goToPrev]);

  useEffect(() => {
    if (!onSelectionChange) return;
    const names: string[] = [], ids: string[] = [];
    const collect = (node: TreeNode) => {
      if (node.children.length === 0 && checked.has(node.path)) {
        names.push(node.strategyName ?? node.label);
        ids.push(node.strategyId ?? "");
      }
      node.children.forEach(collect);
    };
    tree.forEach(collect);
    onSelectionChange(names, ids);
  }, [checked, tree, onSelectionChange]);

  const handleCheck = useCallback((node: TreeNode, isChecked: boolean) => {
    setChecked(prev => {
      const next = new Set(prev);
      leafPaths(node).forEach(p => isChecked ? next.add(p) : next.delete(p));
      return next;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    setChecked(new Set());
    setQuery("");
    setInputValue("");
    onRefresh();
    setTimeout(() => setIsRefreshing(false), 3000);
  }, [isRefreshing, onRefresh]);

  if (totalRows === 0) {
    return (
      <div style={{ padding: 24, color: "#A19F9D", fontSize: 12, textAlign: "center", fontFamily: "Segoe UI, sans-serif" }}>
        No data available.
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: "Segoe UI, sans-serif", height: "100%", display: "flex",
      flexDirection: "column", background: "#FFFFFF", border: "1px solid #EDEBE9",
      borderRadius: 4, overflow: "hidden", position: "relative",
    }}>
      <style>{`@keyframes pcf-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Search bar */}
      <div style={{ padding: "10px 12px", background: "#F3F2F1", flexShrink: 0, borderBottom: "1px solid #EDEBE9" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              type="text"
              placeholder="Search hierarchy..."
              value={inputValue}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              style={{
                width: "100%", padding: "5px 10px 5px 28px",
                border: "1px solid #C8C6C4", borderRadius: 4,
                fontSize: 12, boxSizing: "border-box", outline: "none", color: "#201F1E",
              }}
            />
            {inputValue && (
              <span
                onClick={() => { setInputValue(""); setQuery(""); }}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "#605E5C", fontSize: 14 }}
              >×</span>
            )}
          </div>

          {onRefresh && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh data"
              style={{
                width: 30, height: 30, border: "1px solid #C8C6C4", borderRadius: 4,
                background: isRefreshing ? "#F3F2F1" : "#fff",
                cursor: isRefreshing ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", color: "#0078D4",
              }}
            >
              <span style={{ display: "inline-block", animation: isRefreshing ? "pcf-spin 1s linear infinite" : "none" }}>↻</span>
            </button>
          )}
        </div>

        {query && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: matchList.length > 0 ? "#605E5C" : "#A4262C", minWidth: 50, textAlign: "center" }}>
              {matchList.length > 0 ? `${currentMatchIdx + 1} / ${matchList.length}` : "No matches"}
            </span>
            {matchList.length > 1 && (
              <>
                <button onClick={goToPrev}>▲</button>
                <button onClick={goToNext}>▼</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
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

      {/* Selection footer */}
      {checked.size > 0 && (
        <div style={{
          borderTop: "1px solid #EDEBE9", padding: "8px 16px", background: "#F3F2F1",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: "#605E5C" }}>
            {checked.size} item{checked.size !== 1 ? "s" : ""} selected
          </span>
          <span onClick={() => setChecked(new Set())} style={{ fontSize: 12, color: "#0078D4", cursor: "pointer", fontWeight: 600 }}>
            Clear all
          </span>
        </div>
      )}
    </div>
  );
};