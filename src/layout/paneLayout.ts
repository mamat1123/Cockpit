export interface Pane { id: string; cwd: string; size: number; title: string; autoTitle: boolean; sessionId: string; resume?: boolean }
export interface Row { id: string; panes: Pane[]; size: number }
export interface Tab { id: string; rows: Row[] }
export interface Layout { tabs: Tab[]; activeTabId: string; focusedPaneId: string }

export type Action =
  | { type: "newTab" }
  | { type: "split" }       // split right: add a column in the focused pane's row
  | { type: "splitDown" }   // split down: add a new row after the focused pane's row
  | { type: "close" }
  | { type: "focusPane"; paneId: string }
  | { type: "focusTab"; tabId: string }
  | { type: "setCwd"; paneId: string; cwd: string }
  | { type: "moveTab"; tabId: string; toIndex: number }
  | { type: "setRowSizes"; tabId: string; sizes: number[] }
  | { type: "setPaneSizes"; rowId: string; sizes: number[] }
  | { type: "renamePane"; paneId: string; title: string }
  | { type: "autoTitlePane"; paneId: string; title: string }
  | { type: "popOut"; paneId: string }
  | { type: "movePaneAfter"; paneId: string; targetPaneId: string }
  | { type: "openSession"; cwd: string; sessionId: string };

let counter = 0;
const nextId = (p: string) => `${p}-${++counter}`;
const defaultTitle = (cwd: string) => cwd.split("/").filter(Boolean).pop() ?? "shell";
const makePane = (cwd: string): Pane => ({ id: nextId("pane"), cwd, size: 1, title: defaultTitle(cwd), autoTitle: true, sessionId: crypto.randomUUID() });
const makeRow = (cwd: string): Row => ({ id: nextId("row"), panes: [makePane(cwd)], size: 1 });

export function findPaneBySession(l: Layout, sessionId: string): { tabId: string; paneId: string } | null {
  for (const t of l.tabs) for (const r of t.rows) for (const p of r.panes)
    if (p.sessionId === sessionId) return { tabId: t.id, paneId: p.id };
  return null;
}

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

function removePane(tabs: Tab[], paneId: string): { tabs: Tab[]; pane: Pane | null } {
  let pane: Pane | null = null;
  const out = tabs
    .map((t) => ({
      ...t,
      rows: t.rows
        .map((r) => {
          const hit = r.panes.find((p) => p.id === paneId);
          if (hit) pane = hit;
          return { ...r, panes: r.panes.filter((p) => p.id !== paneId) };
        })
        .filter((r) => r.panes.length > 0),
    }))
    .filter((t) => t.rows.length > 0);
  return { tabs: out, pane };
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
    case "moveTab": {
      const from = l.tabs.findIndex((t) => t.id === a.tabId);
      if (from < 0) return l;
      const tabs = [...l.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(Math.max(0, Math.min(a.toIndex, tabs.length)), 0, moved);
      return { ...l, tabs };
    }
    case "setRowSizes": {
      const tabs = l.tabs.map((t) =>
        t.id === a.tabId && a.sizes.length === t.rows.length
          ? { ...t, rows: t.rows.map((r, i) => ({ ...r, size: a.sizes[i] })) }
          : t,
      );
      return { ...l, tabs };
    }
    case "setPaneSizes": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) =>
          r.id === a.rowId && a.sizes.length === r.panes.length
            ? { ...r, panes: r.panes.map((p, i) => ({ ...p, size: a.sizes[i] })) }
            : r,
        ),
      }));
      return { ...l, tabs };
    }
    case "renamePane": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) => ({
          ...r,
          panes: r.panes.map((p) => (p.id === a.paneId ? { ...p, title: a.title, autoTitle: false } : p)),
        })),
      }));
      return { ...l, tabs };
    }
    case "autoTitlePane": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) => ({
          ...r,
          panes: r.panes.map((p) =>
            p.id === a.paneId && p.autoTitle ? { ...p, title: a.title } : p,
          ),
        })),
      }));
      return { ...l, tabs };
    }
    case "popOut": {
      const { tabs, pane } = removePane(l.tabs, a.paneId);
      if (!pane) return l;
      const tab: Tab = { id: nextId("tab"), rows: [{ id: nextId("row"), panes: [pane], size: 1 }] };
      return { tabs: [...tabs, tab], activeTabId: tab.id, focusedPaneId: pane.id };
    }
    case "openSession": {
      const pane: Pane = { id: nextId("pane"), cwd: a.cwd, size: 1, title: defaultTitle(a.cwd), autoTitle: true, sessionId: a.sessionId, resume: true };
      const tab: Tab = { id: nextId("tab"), rows: [{ id: nextId("row"), panes: [pane], size: 1 }] };
      return { tabs: [...l.tabs, tab], activeTabId: tab.id, focusedPaneId: pane.id };
    }
    case "movePaneAfter": {
      if (a.paneId === a.targetPaneId) return l;
      const { tabs, pane } = removePane(l.tabs, a.paneId);
      if (!pane) return l;
      let destTabId = l.activeTabId;
      const out = tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) => {
          const idx = r.panes.findIndex((p) => p.id === a.targetPaneId);
          if (idx < 0) return r;
          destTabId = t.id;
          const panes = [...r.panes];
          panes.splice(idx + 1, 0, pane);
          return { ...r, panes };
        }),
      }));
      if (!out.some((t) => t.rows.some((r) => r.panes.some((p) => p.id === a.paneId)))) return l;
      return { ...l, tabs: out, activeTabId: destTabId, focusedPaneId: pane.id };
    }
  }
}
