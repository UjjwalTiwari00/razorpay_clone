import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { HierarchyTree as HierarchyTreeComponent } from "./HierarchyTree";

/** Snapshot of a single record's column values – detached from the live dataset. */
interface RecordSnapshot {
    id: string;
    values: Record<string, unknown>;
}

export class HierarchyTree
    implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container: HTMLDivElement;
    private root: ReturnType<typeof createRoot>;
    private notifyOutputChanged: () => void;

    private selectedLeafNames: string = "";
    private selectedLeafIds: string = "";

    // — Accumulator for paged loading —
    private accumulatedRecords: RecordSnapshot[] = [];
    private _seenIds: Set<string> = new Set();
    private isLoadingPages: boolean = false;
    private pageCount: number = 0;

    // — Refresh guard —
    private _context: ComponentFramework.Context<IInputs>;
    private _isRefreshing: boolean = false;

    // ─────────────────────────────────────────────
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

    // ─────────────────────────────────────────────
    public updateView(context: ComponentFramework.Context<IInputs>): void {
        // Always store latest context so onRefresh callback can use it
        this._context = context;

        // Reset refresh guard — a new updateView means the refresh completed
        this._isRefreshing = false;

        const dataset = context.parameters.tableGrid;

        // Guard 1: dataset still loading → show spinner, wait
        if (dataset.loading) {
            this.renderLoading("Loading data...");
            return;
        }

        // Guard 2: Always reset accumulator at the START of a fresh load cycle
        //sushil
        if (!this.isLoadingPages) {
            this.accumulatedRecords = [];
            this._seenIds = new Set();
            this.pageCount = 0;
        }

        // — Set a large page size —
        if (dataset.paging && dataset.paging.pageSize !== 5000) {
            dataset.paging.setPageSize(5000);
        }

        // — Snapshot current page's records (deduplicated by record ID) —
        const currentIds = dataset.sortedRecordIds;
        const prevCount = this.accumulatedRecords.length;
        const currentPageSize = currentIds.length;

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
        const newRecordsAdded = this.accumulatedRecords.length > prevCount;

        // — Load next page if available —
        const shouldLoadMore =
            dataset.paging &&
            dataset.paging.hasNextPage &&
            newRecordsAdded;

        if (shouldLoadMore) {
            this.isLoadingPages = true;
            // Progressive render: show tree with rows loaded so far
            this._renderTree(context, this.accumulatedRecords, true);
            dataset.paging.loadNextPage(); // triggers another updateView
            return;
        }

        // — All pages loaded — final render —
        this.isLoadingPages = false;
        this._renderTree(context, this.accumulatedRecords, false);
    }

    // ─────────────────────────────────────────────
    /** Render the tree component with the given records */
    //sushil
    private _refreshVersion: number = 0;
    private _renderTree(
        context: ComponentFramework.Context<IInputs>,
        allRecords: RecordSnapshot[],
        isLoadingMore: boolean
    ): void {
        const strategyTypeKey = Number(
            context.parameters.strategyTypeKey?.raw ?? 0
        );
       
        this.root.render(
            React.createElement(HierarchyTreeComponent, {
                /*records: allRecords,*/
                //sushil
                key: this._refreshVersion,   //  ONLY changes on refresh
                records: [...allRecords], //  new reference
                totalRows: allRecords.length,
                maxLevels: Number(context.parameters.maxLevels?.raw ?? 15),
                filterId: String(context.parameters.filterId?.raw ?? "").trim(),
                filterName: String(context.parameters.filterName?.raw ?? "").trim(),
                strategyTypeKey: strategyTypeKey,
                isLoadingMore: isLoadingMore,
                onSelectionChange: (names: string[], ids: string[]) => {
                    this.selectedLeafNames = names.join(",");
                    this.selectedLeafIds = ids.join(",");
                    this.notifyOutputChanged();
                },
                // ✅ Refresh button callback — re-fetches SQL, triggers updateView
                //onRefresh: () => {
                //  // Guard: prevent double-tap / parallel refresh
                //  if (this._isRefreshing) return;
                //  this._isRefreshing = true;
                //  this._context.parameters.tableGrid.refresh();
                //},
                //sushil
                onRefresh: () => {
                    if (this._isRefreshing) return;
                    this._isRefreshing = true;

                    // ✅ increment version (IMPORTANT)
                    this._refreshVersion++;

                    this.accumulatedRecords = [];
                    this._seenIds = new Set();
                    this.pageCount = 0;
                    this.isLoadingPages = false;

                    this._context.parameters.tableGrid.refresh();
                },
            })
        );
    }

    // ─────────────────────────────────────────────
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

    // ─────────────────────────────────────────────
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