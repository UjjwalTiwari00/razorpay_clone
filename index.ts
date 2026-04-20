import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { HierarchyTree as HierarchyTreeComponent } from "./HierarchyTree";

interface RecordSnapshot {
    id: string;
    values: Record<string, unknown>;
}

export class HierarchyTree
    implements ComponentFramework.StandardControl<IInputs, IOutputs>
{
    private container: HTMLDivElement;
    private root: ReturnType<typeof createRoot>;
    private notifyOutputChanged: () => void;
    private _context: ComponentFramework.Context<IInputs>;

    private selectedLeafNames: string = "";
    private selectedLeafIds: string = "";

    private accumulatedRecords: RecordSnapshot[] = [];
    private _seenIds: Set<string> = new Set();
    private _refreshVersion: number = 0;
    private _isPaging: boolean = false;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this.container = container;
        this.notifyOutputChanged = notifyOutputChanged;
        this.container.style.cssText = "width:100%; height:100%; box-sizing:border-box;";
        this.root = createRoot(container);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this._context = context;

        const dataset = context.parameters.tableGrid;

        // Still loading
        if (dataset.loading) {
            this.renderSpinner();
            return;
        }

        // Set max page size once
        if (dataset.paging?.pageSize !== 5000) {
            dataset.paging.setPageSize(5000);
        }

        // Accumulate new records
        for (const rid of dataset.sortedRecordIds) {
            if (this._seenIds.has(rid)) continue;

            const rec = dataset.records[rid];
            if (!rec) continue;

            const snap: RecordSnapshot = { id: rec.getRecordId(), values: {} };

            for (const col of dataset.columns) {
                try { snap.values[col.name] = rec.getValue(col.name); } catch {}
            }

            for (const col of ["STRATEGY_NAME", "STRATEGY_ID", "STRATEGY_TYPE_KEY", "PATH"]) {
                if (snap.values[col] === undefined) {
                    try { snap.values[col] = rec.getValue(col); } catch {}
                }
            }

            this._seenIds.add(rid);
            this.accumulatedRecords.push(snap);
        }

        // More pages coming — show spinner and load next
        if (dataset.paging?.hasNextPage) {
            this._isPaging = true;
            this.renderSpinner(`Loading... (${this.accumulatedRecords.length} rows)`);
            dataset.paging.loadNextPage();
            return;
        }

        // All pages done — render tree once
        this._isPaging = false;
        this.renderTree(context);
    }

    private renderTree(context: ComponentFramework.Context<IInputs>): void {
        this.root.render(
            React.createElement(HierarchyTreeComponent, {
                key: this._refreshVersion,
                records: this.accumulatedRecords,
                totalRows: this.accumulatedRecords.length,
                maxLevels: Number(context.parameters.maxLevels?.raw ?? 15),
                filterId: String(context.parameters.filterId?.raw ?? "").trim(),
                filterName: String(context.parameters.filterName?.raw ?? "").trim(),

                onSelectionChange: (names: string[], ids: string[]) => {
                    this.selectedLeafNames = names.join(",");
                    this.selectedLeafIds = ids.join(",");
                    this.notifyOutputChanged();
                },

                onRefresh: () => {
                    this._refreshVersion++;
                    this.accumulatedRecords = [];
                    this._seenIds = new Set();
                    this._isPaging = false;
                    this._context.parameters.tableGrid.refresh();
                },
            })
        );
    }

    private renderSpinner(message: string = "Loading data..."): void {
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
                        gap: 12,
                    },
                },
                React.createElement("style", null,
                    "@keyframes pcf-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }"
                ),
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
                React.createElement("span", { style: { fontSize: 13 } }, message)
            )
        );
    }

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