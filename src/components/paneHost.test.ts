import { describe, it, expect } from "vitest";
import { flattenPanes, overviewItems } from "./paneFlatten";
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

describe("overviewItems", () => {
  it("lists every pane with its 1-based tab index", () => {
    let l = initLayout("/a");
    const p0 = l.tabs[0].rows[0].panes[0];
    l = reduce({ ...l, focusedPaneId: p0.id }, { type: "split" });
    l = reduce(l, { type: "newTab" });
    const items = overviewItems(l);
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ tabIndex: 1, tabId: l.tabs[0].id });
    expect(items[2].tabIndex).toBe(2);
    expect(typeof items[0].title).toBe("string");
    expect(typeof items[0].cwd).toBe("string");
    expect(items[0].paneId).toBe(l.tabs[0].rows[0].panes[0].id);
  });
});
