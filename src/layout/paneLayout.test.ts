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
  it("panes and rows start with size 1", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    expect(l.tabs[0].rows[0].panes.every((p) => p.size === 1)).toBe(true);
    expect(l.tabs[0].rows.every((r) => r.size === 1)).toBe(true);
  });
  it("moveTab reorders tabs, keeping active", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab" });
    const [t1, t2] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "moveTab", tabId: t2, toIndex: 0 });
    expect(l.tabs.map((t) => t.id)).toEqual([t2, t1]);
    expect(l.activeTabId).toBe(t2);
  });
  it("setPaneSizes updates the row's pane weights", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    const rowId = l.tabs[0].rows[0].id;
    l = reduce(l, { type: "setPaneSizes", rowId, sizes: [2, 1] });
    expect(l.tabs[0].rows[0].panes.map((p) => p.size)).toEqual([2, 1]);
  });
  it("setRowSizes updates the tab's row weights", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });
    const tabId = l.tabs[0].id;
    l = reduce(l, { type: "setRowSizes", tabId, sizes: [3, 1] });
    expect(l.tabs[0].rows.map((r) => r.size)).toEqual([3, 1]);
  });
  it("a pane has a default title from its cwd basename", () => {
    const l = initLayout(CWD);
    expect(l.tabs[0].rows[0].panes[0].title).toBe("app");
  });
  it("renamePane sets a custom title", () => {
    let l = initLayout(CWD);
    const id = l.focusedPaneId;
    l = reduce(l, { type: "renamePane", paneId: id, title: "frontend" });
    expect(l.tabs[0].rows[0].panes[0].title).toBe("frontend");
  });
  it("popOut moves a pane into a brand-new active tab", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    const moved = l.focusedPaneId;
    l = reduce(l, { type: "popOut", paneId: moved });
    expect(l.tabs.length).toBe(2);
    expect(l.tabs[0].rows[0].panes.length).toBe(1);
    expect(l.tabs[1].rows[0].panes.map((p) => p.id)).toEqual([moved]);
    expect(l.activeTabId).toBe(l.tabs[1].id);
    expect(l.focusedPaneId).toBe(moved);
  });
  it("movePaneAfter reorders within a row", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    const [A, B] = l.tabs[0].rows[0].panes.map((p) => p.id);
    l = reduce(l, { type: "movePaneAfter", paneId: A, targetPaneId: B });
    expect(l.tabs[0].rows[0].panes.map((p) => p.id)).toEqual([B, A]);
  });
  it("movePaneAfter across rows moves the pane and drops the emptied row", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });
    const A = l.tabs[0].rows[0].panes[0].id;
    const B = l.tabs[0].rows[1].panes[0].id;
    l = reduce(l, { type: "movePaneAfter", paneId: B, targetPaneId: A });
    expect(l.tabs[0].rows.length).toBe(1);
    expect(l.tabs[0].rows[0].panes.map((p) => p.id)).toEqual([A, B]);
  });
  it("autoTitlePane updates the title while auto-naming is on", () => {
    let l = initLayout(CWD);
    const id = l.focusedPaneId;
    l = reduce(l, { type: "autoTitlePane", paneId: id, title: "fix crypto bug" });
    expect(l.tabs[0].rows[0].panes[0].title).toBe("fix crypto bug");
  });
  it("a manual renamePane stops further auto-naming", () => {
    let l = initLayout(CWD);
    const id = l.focusedPaneId;
    l = reduce(l, { type: "renamePane", paneId: id, title: "frontend" });
    l = reduce(l, { type: "autoTitlePane", paneId: id, title: "should be ignored" });
    expect(l.tabs[0].rows[0].panes[0].title).toBe("frontend");
  });
});
