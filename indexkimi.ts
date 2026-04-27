import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { HierarchyTree as HierarchyTreeComponent, RecordSnapshot } from "./HierarchyTree";

export class HierarchyTree
  implements ComponentFramework.StandardControl<IInputs, IOutputs>
{
  private container: HTMLDivElement;
  private root: ReturnType<typeof createRoot>;
  private notifyOutputChanged: () => void;

  private selectedLeafNames: string = "";
  private selectedLeafIds: string = "";

  private _context: ComponentFramework.Context<IInputs>;
  private _isRefreshing: boolean = false;
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
    this._context = context;
    const dataset = context.parameters.tableGrid;

    if (dataset.loading) {
      this.renderLoading("Loading strategies...");
      return;
    }

    // ── NEW: Fetch single row, parse JSON from JSONDATA column ──
    const records: RecordSnapshot[] = [];
    
    for (const rid of dataset.sortedRecordIds) {
      const rec = dataset.records[rid];
      if (!rec) continue;

      // Parse the JSON array from the JSONDATA column
      const jsonData = rec.getValue("JSONDATA") as string;
      if (!jsonData) continue;

      try {
        const strategies = JSON.parse(jsonData) as Array<{
          STRATEGY_ID: string;
          STRATEGY_NAME: string;
          PATH: string;
        }>;

        for (const s of strategies) {
          records.push({
            id: s.STRATEGY_ID,
            values: {
              STRATEGY_ID: s.STRATEGY_ID,
              STRATEGY_NAME: s.STRATEGY_NAME,
              PATH: s.PATH,
            },
          });
        }
      } catch {
        console.error("Failed to parse JSONDATA:", jsonData);
      }
    }

    this._renderTree(context, records);
  }

  // ─────────────────────────────────────────────────────────
  private _renderTree(
    context: ComponentFramework.Context<IInputs>,
    allRecords: RecordSnapshot[]
  ): void {
    const strategyTypeKey = Number(
      context.parameters.strategyTypeKey?.raw ?? 0
    );

    this.root.render(
      React.createElement(HierarchyTreeComponent, {
        key: this._refreshVersion,
        records: allRecords,
        totalRows: allRecords.length,
        maxLevels: Number(context.parameters.maxLevels?.raw ?? 15),
        filterId: String(context.parameters.filterId?.raw ?? "").trim(),
        filterName: String(context.parameters.filterName?.raw ?? "").trim(),
        strategyTypeKey: strategyTypeKey,
        onSelectionChange: (names: string[], ids: string[]) => {
          this.selectedLeafNames = names.join(",");
          this.selectedLeafIds = ids.join(",");
          this.notifyOutputChanged();
        },
        onRefresh: () => {
          if (this._isRefreshing) return;
          this._isRefreshing = true;
          this._refreshVersion++;
          this.renderLoading("Refreshing...");
          this._context.parameters.tableGrid.refresh();
        },
      })
    );
  }

  // ─────────────────────────────────────────────────────────
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
        React.createElement("span", { style: { fontSize: 13 } }, message)
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
