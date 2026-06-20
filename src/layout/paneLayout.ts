export interface Pane { id: string; cwd: string }
export interface Row { id: string; panes: Pane[] }
export interface Tab { id: string; rows: Row[] }
export interface Layout { tabs: Tab[]; activeTabId: string; focusedPaneId: string }

export type Action =
  | { type: "newTab" }
  | { type: "split" }       // split right: add a column in the focused pane's row
  | { type: "splitDown" }   // split down: add a new row after the focused pane's row
  | { type: "close" }
  | { type: "focusPane"; paneId: string }
  | { type: "focusTab"; tabId: string }
  | { type: "setCwd"; paneId: string; cwd: string };

let counter = 0;
const nextId = (p: string) => `${p}-${++counter}`;
const makePane = (cwd: string): Pane => ({ id: nextId("pane"), cwd });
const makeRow = (cwd: string): Row => ({ id: nextId("row"), panes: [makePane(cwd)] });

export function initLayout(cwd: string): Layout {
  const row = makeRow(cwd);
  const tab: Tab = { id: nextId("tab"), rows: [row] };
  return { tabs: [tab], activeTabId: tab.id, focusedPaneId: row.panes[0].id };
}

const activeTab = (l: Layout) => l.tabs.find((t) => t.id === l.activeTabId)!;
const allPanes = (t: Tab): Pane[] => t.rows.flatMap((r) => r.panes);
function focusedCwd(l: Layout): string {
  for (const t of l.tabs)
    for (const r of t.rows)
      for (const p of r.panes) if (p.id === l.focusedPaneId) return p.cwd;
  return l.tabs[0].rows[0].panes[0].cwd;
}

export function reduce(l: Layout, a: Action): Layout {
  switch (a.type) {
    case "newTab": {
      const row = makeRow(focusedCwd(l));
      const tab: Tab = { id: nextId("tab"), rows: [row] };
      return { tabs: [...l.tabs, tab], activeTabId: tab.id, focusedPaneId: row.panes[0].id };
    }
    case "split": {
      const pane = makePane(focusedCwd(l));
      const tabs = l.tabs.map((t) => {
        if (t.id !== l.activeTabId) return t;
        return {
          ...t,
          rows: t.rows.map((r) => {
            const idx = r.panes.findIndex((p) => p.id === l.focusedPaneId);
            if (idx < 0) return r;
            const panes = [...r.panes];
            panes.splice(idx + 1, 0, pane);
            return { ...r, panes };
          }),
        };
      });
      return { ...l, tabs, focusedPaneId: pane.id };
    }
    case "splitDown": {
      const row = makeRow(focusedCwd(l));
      const tabs = l.tabs.map((t) => {
        if (t.id !== l.activeTabId) return t;
        const rIdx = t.rows.findIndex((r) => r.panes.some((p) => p.id === l.focusedPaneId));
        if (rIdx < 0) return t;
        const rows = [...t.rows];
        rows.splice(rIdx + 1, 0, row);
        return { ...t, rows };
      });
      return { ...l, tabs, focusedPaneId: row.panes[0].id };
    }
    case "close": {
      const tab = activeTab(l);
      const total = l.tabs.reduce((n, t) => n + allPanes(t).length, 0);
      if (total === 1) return l; // never close the last pane anywhere
      const rows = tab.rows
        .map((r) => ({ ...r, panes: r.panes.filter((p) => p.id !== l.focusedPaneId) }))
        .filter((r) => r.panes.length > 0);
      if (rows.length === 0) {
        const remaining = l.tabs.filter((t) => t.id !== tab.id);
        const na = remaining[remaining.length - 1];
        return { tabs: remaining, activeTabId: na.id, focusedPaneId: na.rows[0].panes[0].id };
      }
      const tabs = l.tabs.map((t) => (t.id === tab.id ? { ...t, rows } : t));
      return { ...l, tabs, focusedPaneId: rows[0].panes[0].id };
    }
    case "focusPane":
      return { ...l, focusedPaneId: a.paneId };
    case "focusTab": {
      const t = l.tabs.find((x) => x.id === a.tabId)!;
      return { ...l, activeTabId: t.id, focusedPaneId: t.rows[0].panes[0].id };
    }
    case "setCwd": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) => ({
          ...r,
          panes: r.panes.map((p) => (p.id === a.paneId ? { ...p, cwd: a.cwd } : p)),
        })),
      }));
      return { ...l, tabs };
    }
  }
}
