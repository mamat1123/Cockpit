import type { Layout } from "../layout/paneLayout";
import { unseenByTab, type Completion } from "./notifications";

export interface BeaconSession {
  sessionId: string; name: string; project: string; tabId: string; tabIndex: number;
  status: "working" | "idle" | "waiting"; unseen: boolean;
}
export interface BeaconState { sessions: BeaconSession[]; totalUnseen: number; working: number; waiting: number }

const projectOf = (cwd: string) => cwd.split("/").filter(Boolean).pop() ?? "shell";

/** Pure snapshot for the Beacon: one row per pane, waiting/working from the live pane
 *  sets, unseen flag from the unseen Completions for that pane. Sorted waiting-first
 *  (a blocked session needs you NOW), then unseen, working, idle. */
export function buildBeaconState(layout: Layout, entries: Completion[], workingPaneIds: Set<string>, waitingPaneIds: Set<string>): BeaconState {
  const unseenPanes = new Set(entries.filter((e) => !e.seen).map((e) => e.paneId));
  const sessions: BeaconSession[] = [];
  layout.tabs.forEach((t, tabIndex) => {
    for (const r of t.rows) for (const p of r.panes) {
      sessions.push({
        sessionId: p.sessionId, name: p.title, project: projectOf(p.cwd),
        tabId: t.id, tabIndex: tabIndex + 1,
        status: waitingPaneIds.has(p.id) ? "waiting" : workingPaneIds.has(p.id) ? "working" : "idle",
        unseen: unseenPanes.has(p.id),
      });
    }
  });
  const rank = (s: BeaconSession) => (s.status === "waiting" ? 0 : s.unseen ? 1 : s.status === "working" ? 2 : 3);
  sessions.sort((a, b) => rank(a) - rank(b));
  const totalUnseen = [...unseenByTab(entries).values()].reduce((a, b) => a + b, 0);
  return {
    sessions, totalUnseen,
    working: sessions.filter((s) => s.status === "working").length,
    waiting: sessions.filter((s) => s.status === "waiting").length,
  };
}
