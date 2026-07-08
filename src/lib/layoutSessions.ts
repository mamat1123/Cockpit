import type { Layout, Pane, Row, Tab } from "../layout/paneLayout";

export type CurrentSessionResolver = (cwd: string, sessionId: string) => Promise<string | null>;

async function resolvePaneSessionId(pane: Pane, resolve: CurrentSessionResolver): Promise<Pane> {
  if ((pane.provider ?? "claude") === "codex") return pane;
  try {
    const next = await resolve(pane.cwd, pane.sessionId);
    return next && next !== pane.sessionId ? { ...pane, sessionId: next } : pane;
  } catch {
    return pane;
  }
}

async function resolveRowSessionIds(row: Row, resolve: CurrentSessionResolver): Promise<Row> {
  const panes = await Promise.all(row.panes.map((pane) => resolvePaneSessionId(pane, resolve)));
  return panes.some((pane, index) => pane !== row.panes[index]) ? { ...row, panes } : row;
}

async function resolveTabSessionIds(tab: Tab, resolve: CurrentSessionResolver): Promise<Tab> {
  const rows = await Promise.all(tab.rows.map((row) => resolveRowSessionIds(row, resolve)));
  return rows.some((row, index) => row !== tab.rows[index]) ? { ...tab, rows } : tab;
}

export async function resolveLayoutSessionIds(layout: Layout, resolve: CurrentSessionResolver): Promise<Layout> {
  const tabs = await Promise.all(layout.tabs.map((tab) => resolveTabSessionIds(tab, resolve)));
  return tabs.some((tab, index) => tab !== layout.tabs[index]) ? { ...layout, tabs } : layout;
}
