import { describe, it, expect } from "vitest";
import { flattenPanes } from "./paneFlatten";
import { initLayout, reduce } from "../layout/paneLayout";

describe("flattenPanes", () => {
  it("lists every pane across all tabs with its tab id, stable order", () => {
    let l = initLayout("/x");
    const p0 = l.tabs[0].rows[0].panes[0];
    l = reduce({ ...l, focusedPaneId: p0.id }, { type: "split" }); // 2 panes, 1 tab
    l = reduce(l, { type: "newTab" });                            // +1 tab, +1 pane
    const flat = flattenPanes(l);
    expect(flat.length).toBe(3);
    expect(new Set(flat.map((f) => f.pane.id)).size).toBe(3);
    expect(flat.every((f) => typeof f.tabId === "string")).toBe(true);
  });
});
