import type { Layout } from "../layout/paneLayout";
import { unseenByTab, type Completion } from "./notifications";

export interface BeaconSession {
  sessionId: string; name: string; project: string; tabId: string; tabIndex: number;
  status: "working" | "idle"; unseen: boolean;
}
export interface BeaconState { sessions: BeaconSession[]; totalUnseen: number; working: number }

const projectOf = (cwd: string) => cwd.split("/").filter(Boolean).pop() ?? "shell";

/** Pure snapshot for the Beacon: one row per pane, working flag from the live working
 *  set, unseen flag from the unseen Completions for that pane. Sorted unseen-first,
 *  then working, then idle. */
export function buildBeaconState(layout: Layout, entries: Completion[], workingPaneIds: Set<string>): BeaconState {
  const unseenPanes = new Set(entries.filter((e) => !e.seen).map((e) => e.paneId));
  const sessions: BeaconSession[] = [];
  layout.tabs.forEach((t, tabIndex) => {
    for (const r of t.rows) for (const p of r.panes) {
      sessions.push({
        sessionId: p.sessionId, name: p.title, project: projectOf(p.cwd),
        tabId: t.id, tabIndex: tabIndex + 1,
        status: workingPaneIds.has(p.id) ? "working" : "idle",
        unseen: unseenPanes.has(p.id),
      });
    }
  });
  const rank = (s: BeaconSession) => (s.unseen ? 0 : s.status === "working" ? 1 : 2);
  sessions.sort((a, b) => rank(a) - rank(b));
  const totalUnseen = [...unseenByTab(entries).values()].reduce((a, b) => a + b, 0);
  return { sessions, totalUnseen, working: sessions.filter((s) => s.status === "working").length };
}
