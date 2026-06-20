export interface Pane { id: string; cwd: string }
export interface Tab { id: string; panes: Pane[] }
export interface Layout { tabs: Tab[]; activeTabId: string; focusedPaneId: string }

export type Action =
  | { type: "newTab" }
  | { type: "split" }
  | { type: "close" }
  | { type: "focusPane"; paneId: string }
  | { type: "focusTab"; tabId: string }
  | { type: "setCwd"; paneId: string; cwd: string };

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

export function initLayout(cwd: string): Layout {
  const pane: Pane = { id: nextId("pane"), cwd };
  const tab: Tab = { id: nextId("tab"), panes: [pane] };
  return { tabs: [tab], activeTabId: tab.id, focusedPaneId: pane.id };
}

const activeTab = (l: Layout) => l.tabs.find((t) => t.id === l.activeTabId)!;
const focusedCwd = (l: Layout) =>
  activeTab(l).panes.find((p) => p.id === l.focusedPaneId)?.cwd ?? l.tabs[0].panes[0].cwd;

export function reduce(l: Layout, a: Action): Layout {
  switch (a.type) {
    case "newTab": {
      const pane: Pane = { id: nextId("pane"), cwd: focusedCwd(l) };
      const tab: Tab = { id: nextId("tab"), panes: [pane] };
      return { tabs: [...l.tabs, tab], activeTabId: tab.id, focusedPaneId: pane.id };
    }
    case "split": {
      const pane: Pane = { id: nextId("pane"), cwd: focusedCwd(l) };
      const tabs = l.tabs.map((t) =>
        t.id === l.activeTabId ? { ...t, panes: [...t.panes, pane] } : t,
      );
      return { ...l, tabs, focusedPaneId: pane.id };
    }
    case "close": {
      const tab = activeTab(l);
      if (l.tabs.length === 1 && tab.panes.length === 1) return l;
      if (tab.panes.length === 1) {
        const remaining = l.tabs.filter((t) => t.id !== tab.id);
        const newActive = remaining[remaining.length - 1];
        return { tabs: remaining, activeTabId: newActive.id, focusedPaneId: newActive.panes[0].id };
      }
      const idx = tab.panes.findIndex((p) => p.id === l.focusedPaneId);
      const panes = tab.panes.filter((p) => p.id !== l.focusedPaneId);
      const survivor = panes[Math.min(idx, panes.length - 1)];
      const tabs = l.tabs.map((t) => (t.id === tab.id ? { ...t, panes } : t));
      return { ...l, tabs, focusedPaneId: survivor.id };
    }
    case "focusPane":
      return { ...l, focusedPaneId: a.paneId };
    case "focusTab": {
      const t = l.tabs.find((x) => x.id === a.tabId)!;
      return { ...l, activeTabId: t.id, focusedPaneId: t.panes[0].id };
    }
    case "setCwd": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        panes: t.panes.map((p) => (p.id === a.paneId ? { ...p, cwd: a.cwd } : p)),
      }));
      return { ...l, tabs };
    }
  }
}
