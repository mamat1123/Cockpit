import type { Layout, Pane } from "../layout/paneLayout";

export interface FlatPane { pane: Pane; tabId: string }

/** Every pane across all tabs, in tab→row→pane order. PaneHost mounts one
 *  TerminalPane per entry (keyed by pane.id) regardless of which tab is active. */
export function flattenPanes(layout: Layout): FlatPane[] {
  return layout.tabs.flatMap((t) => t.rows.flatMap((r) => r.panes.map((pane) => ({ pane, tabId: t.id }))));
}

export interface OverviewItem { paneId: string; title: string; cwd: string; sessionId: string; tabId: string; tabIndex: number }

/** Flat list of all panes for the dashboard, each tagged with its 1-based tab number. */
export function overviewItems(layout: Layout): OverviewItem[] {
  return layout.tabs.flatMap((t, ti) =>
    t.rows.flatMap((r) =>
      r.panes.map((p) => ({ paneId: p.id, title: p.title, cwd: p.cwd, sessionId: p.sessionId, tabId: t.id, tabIndex: ti + 1 })),
    ),
  );
}
