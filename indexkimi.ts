import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { HierarchyTree as HierarchyTreeComponent } from "./HierarchyTree";

/** Snapshot of a single record's column values – detached from the live PCF dataset. */
export interface RecordSnapshot {
  id: string;
  values: Record<string, unknown>;
}

export class HierarchyTree
  implements ComponentFramework.StandardControl<IInputs, IOutputs>
{
  private container: HTMLDivElement;
  private root: ReturnType<typeof createRoot>;
  private notifyOutputChanged: () => void;

  private selectedLeafNames: string = "";
  private selectedLeafIds: string = "";

  // ── Accumulator for paged loading ──
  private accumulatedRecords: RecordSnapshot[] = [];
  private isLoadingPages: boolean = false;
  private pageCount: number = 0;
  private _initialLoadComplete: boolean = false;

  // ── Refresh guard ──
  private _context: ComponentFramework.Context<IInputs>;
  private _isRefreshing: boolean = false;

  // ── First-load delay: wait 7s for SQL table to populate ──
  private _firstLoadDelayDone: boolean = false;
  private _waitingForDelay: boolean = false;

  // ── Forces a full React remount on refresh ──
  private _refreshVersion: number = 0;

  // ─────────────────────────────────────────────────────────
  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    _state: ComponentFramework.Dictionary,
    container: HTMLDivElement
  ): void {
    this.container = container;
    this.notifyOutputChanged = notifyOutputChanged;
    this.container.style.cssText =
      "width:100%; height:100%; box-sizing:border-box;";
    this.root = createRoot(container);
  }

  // ─────────────────────────────────────────────────────────
  public updateView(context: ComponentFramework.Context<IInputs>): void {
    // Always store latest context so onRefresh callback can use it
    this._context = context;

    const dataset = context.parameters.tableGrid;

    // ── Guard 0: FIRST LOAD – wait 7 seconds for SQL table to populate ──
    if (!this._firstLoadDelayDone) {
      if (!this._waitingForDelay) {
        this._waitingForDelay = true;
        this.renderLoading("Waiting for data source to be ready... Please wait.");
        setTimeout(() => {
          this._firstLoadDelayDone = true;
          this._waitingForDelay = false;
          // Now fetch fresh data from the (now-populated) SQL table
          this._context.parameters.tableGrid.refresh();
        }, 7000);
      }
      return; // ignore all updateView calls during the wait
    }

    // ── Guard 1: dataset still loading → show spinner, wait ──
    if (dataset.loading) {
      this.renderLoading("Loading all strategies... Please wait.");
      return;
    }

    // ── Guard 2: Reset accumulator on cold start or refresh (NOT during paging) ──
    if (
      (!this._initialLoadComplete && !this.isLoadingPages) ||
      this._isRefreshing
    ) {
      this.accumulatedRecords = [];
      this.pageCount = 0;
      this.isLoadingPages = false;
    }

    // ── Set a large page size ──
    if (dataset.paging && dataset.paging.pageSize !== 5000) {
      dataset.paging.setPageSize(5000);
    }

    // ── Snapshot current page's records (every row = 1 unique strategy) ──
    const currentIds = dataset.sortedRecordIds;

    for (const rid of currentIds) {
      const rec = dataset.records[rid];
      if (!rec) continue;

      const recId = rec.getRecordId();
      const snap: RecordSnapshot = { id: recId, values: {} };

      // Grab every column the dataset exposes
      for (const col of dataset.columns) {
        try {
          snap.values[col.name] = rec.getValue(col.name);
        } catch {
          /* column not available */
        }
      }

      // Explicitly capture columns needed for tree/output that may not
      // appear in dataset.columns but ARE accessible via getValue()
      const extraCols = ["STRATEGY_NAME", "STRATEGY_ID", "STRATEGY_TYPE_KEY"];
      for (let i = 1; i <= 15; i++) extraCols.push(`GBS_LEVEL_${i}`);

      for (const colName of extraCols) {
        if (snap.values[colName] === undefined) {
          try {
            snap.values[colName] = rec.getValue(colName);
          } catch {
            /* column not available */
          }
        }
      }

      this.accumulatedRecords.push(snap);
    }

    this.pageCount++;

    // ── Load next page if available ──
    if (dataset.paging && dataset.paging.hasNextPage) {
      this.isLoadingPages = true;
      this.renderLoading(
        `Loading all strategies... ${this.accumulatedRecords.length.toLocaleString()} rows loaded so far. Please wait.`
      );
      dataset.paging.loadNextPage(); // triggers another updateView
      return;
    }

    // ── All pages loaded – final render with complete data ──
    this.isLoadingPages = false;
    this._initialLoadComplete = true;
    this._isRefreshing = false;
    this._renderTree(context, this.accumulatedRecords);
  }

  // ─────────────────────────────────────────────────────────
  private _renderTree(
    context: ComponentFramework.Context<IInputs>,
    allRecords: RecordSnapshot[]
  ): void {
    // const strategyTypeKey = Number(
    //   context.parameters.strategyTypeKey?.raw ?? 0
    // );

    const filterId = String(context.parameters.filterId?.raw ?? "").trim();
    const filterName = String(context.parameters.filterName?.raw ?? "").trim();
    const maxLevels = Number(context.parameters.maxLevels?.raw ?? 15);

    // [FIX] Count records that will actually produce a tree node
    let validRecordCount = 0;
    for (const rec of allRecords) {
      if (filterId && rec.id !== filterId) continue;
      // if (strategyTypeKey > 0) {
      //   const typeKey = Number(rec.values["STRATEGY_TYPE_KEY"] ?? 0);
      //   if (typeKey !== strategyTypeKey) continue;
      // }
      if (filterName) {
        const level1 = String(rec.values["GBS_LEVEL_1"] ?? "").trim();
        if (level1.toLowerCase() !== filterName.toLowerCase()) continue;
      }
      // Check if at least one level is non-null
      let hasLevel = false;
      for (let i = 1; i <= maxLevels; i++) {
        const val = String(rec.values[`GBS_LEVEL_${i}`] ?? "").trim();
        if (val && val.toLowerCase() !== "null") {
          hasLevel = true;
          break;
        }
      }
      if (hasLevel) validRecordCount++;
    }

    this.root.render(
      React.createElement(HierarchyTreeComponent, {
        key: this._refreshVersion, // ONLY changes on refresh – forces full remount
        records: [...allRecords],  // new array reference every render
        totalRows: validRecordCount, // [FIX] Accurate count, not raw array length
        maxLevels,
        filterId,
        filterName,
        // strategyTypeKey,
        onSelectionChange: (names: string[], ids: string[]) => {
          this.selectedLeafNames = names.join(",");
          this.selectedLeafIds = ids.join(",");
          this.notifyOutputChanged();
        },
        onRefresh: () => {
          // Guard: prevent double-tap / parallel refresh
          if (this._isRefreshing) return;

          this._isRefreshing = true;

          // ✅ Force full React remount
          this._refreshVersion++;

          // ✅ FULL memory reset (same as control init)
          this.accumulatedRecords = [];
          this.pageCount = 0;
          this.isLoadingPages = false;
          this._initialLoadComplete = false;

          // ✅ Render immediately with loading spinner
          this.renderLoading("Refreshing data, please wait...");

          // ✅ Trigger fresh SQL + paging from page 1
          this._context.parameters.tableGrid.refresh();
        },
      })
    );
  }

  // ─────────────────────────────────────────────────────────
  /** Show a loading indicator while pages are still coming in */
  private renderLoading(message: string): void {
    this.root.render(
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            fontFamily: "Segoe UI, sans-serif",
            color: "#605E5C",
            gap: "12px",
            background: "#FFFFFF",
            border: "1px solid #EDEBE9",
            borderRadius: 4,
          },
        },
        React.createElement("div", {
          style: {
            width: 32,
            height: 32,
            border: "3px solid #EDEBE9",
            borderTop: "3px solid #0078D4",
            borderRadius: "50%",
            animation: "pcf-spin 1s linear infinite",
          },
        }),
        React.createElement(
          "style",
          null,
          "@keyframes pcf-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }"
        ),
        React.createElement(
          "span",
          { style: { fontSize: 13 } },
          message
        )
      )
    );
  }

  // ─────────────────────────────────────────────────────────
  public getOutputs(): IOutputs {
    return {
      selectedLeafNames: this.selectedLeafNames,
      selectedLeafIds: this.selectedLeafIds,
    };
  }

  public destroy(): void {
    this.root.unmount();
  }
}