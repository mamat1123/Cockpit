import { describe, it, expect } from "vitest";
import { initLayout, reduce } from "./paneLayout";

const DEFAULT_CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

describe("paneLayout", () => {
  it("starts with one tab + one pane", () => {
    const l = initLayout(DEFAULT_CWD);
    expect(l.tabs.length).toBe(1);
    expect(l.tabs[0].panes.length).toBe(1);
    expect(l.focusedPaneId).toBe(l.tabs[0].panes[0].id);
  });

  it("newTab adds a tab with one pane and focuses it", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "newTab" });
    expect(l.tabs.length).toBe(2);
    expect(l.activeTabId).toBe(l.tabs[1].id);
    expect(l.focusedPaneId).toBe(l.tabs[1].panes[0].id);
  });

  it("split adds a pane to the active tab, inheriting focused cwd, and focuses it", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "setCwd", paneId: l.focusedPaneId, cwd: "/tmp/x" });
    l = reduce(l, { type: "split" });
    expect(l.tabs[0].panes.length).toBe(2);
    const created = l.tabs[0].panes[1];
    expect(created.cwd).toBe("/tmp/x");
    expect(l.focusedPaneId).toBe(created.id);
  });

  it("close removes the focused pane and refocuses a sibling", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "split" });
    const survivor = l.tabs[0].panes[0].id;
    l = reduce(l, { type: "close" });
    expect(l.tabs[0].panes.length).toBe(1);
    expect(l.focusedPaneId).toBe(survivor);
  });

  it("closing the last pane of a tab removes the tab", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "newTab" });
    l = reduce(l, { type: "close" });
    expect(l.tabs.length).toBe(1);
    expect(l.activeTabId).toBe(l.tabs[0].id);
  });

  it("never closes the very last pane (keeps at least one)", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "close" });
    expect(l.tabs.length).toBe(1);
    expect(l.tabs[0].panes.length).toBe(1);
  });
});
