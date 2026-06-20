import { describe, it, expect } from "vitest";
import { initLayout, reduce, type Layout } from "./paneLayout";

const CWD = "/Users/theerametsaengsin/Work/mee-tang/app";
const panesOf = (l: Layout, i = 0) => l.tabs[i].rows.flatMap((r) => r.panes);

describe("paneLayout (rows model)", () => {
  it("starts with one tab, one row, one pane", () => {
    const l = initLayout(CWD);
    expect(l.tabs.length).toBe(1);
    expect(l.tabs[0].rows.length).toBe(1);
    expect(l.tabs[0].rows[0].panes.length).toBe(1);
    expect(l.focusedPaneId).toBe(l.tabs[0].rows[0].panes[0].id);
  });
  it("split adds a column in the focused pane's row + focuses it", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    expect(l.tabs[0].rows.length).toBe(1);
    expect(l.tabs[0].rows[0].panes.length).toBe(2);
    expect(l.focusedPaneId).toBe(l.tabs[0].rows[0].panes[1].id);
  });
  it("splitDown adds a new row after the focused row + focuses it", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });
    expect(l.tabs[0].rows.length).toBe(2);
    expect(l.tabs[0].rows[1].panes.length).toBe(1);
    expect(l.focusedPaneId).toBe(l.tabs[0].rows[1].panes[0].id);
  });
  it("new panes inherit the focused pane's cwd", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "setCwd", paneId: l.focusedPaneId, cwd: "/tmp/x" });
    l = reduce(l, { type: "splitDown" });
    expect(panesOf(l).find((p) => p.id === l.focusedPaneId)!.cwd).toBe("/tmp/x");
  });
  it("close removes the focused pane and drops an emptied row", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });
    l = reduce(l, { type: "close" });
    expect(l.tabs[0].rows.length).toBe(1);
  });
  it("closing the last pane of a tab removes the tab", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab" });
    l = reduce(l, { type: "close" });
    expect(l.tabs.length).toBe(1);
    expect(l.activeTabId).toBe(l.tabs[0].id);
  });
  it("never closes the very last pane", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "close" });
    expect(l.tabs.length).toBe(1);
    expect(l.tabs[0].rows[0].panes.length).toBe(1);
  });
});
