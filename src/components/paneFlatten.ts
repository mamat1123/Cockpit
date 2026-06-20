import type { Layout, Pane } from "../layout/paneLayout";

export interface FlatPane { pane: Pane; tabId: string }

/** Every pane across all tabs, in tab→row→pane order. PaneHost mounts one
 *  TerminalPane per entry (keyed by pane.id) regardless of which tab is active. */
export function flattenPanes(layout: Layout): FlatPane[] {
  return layout.tabs.flatMap((t) => t.rows.flatMap((r) => r.panes.map((pane) => ({ pane, tabId: t.id }))));
}
