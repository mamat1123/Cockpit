export type PaneState = "idle" | "working" | "waiting";

/** Signals distilled from the log tail. `lastLineAt` = ms timestamp of the most
 *  recent jsonl line for this pane, or null if none seen yet. */
export interface LogSignal {
  lastLineAt: number | null;
}

/** working if the log grew within `idleMs`; otherwise idle. Pure + clock-injected. */
export function deriveState(sig: LogSignal, now: number, idleMs: number): PaneState {
  if (sig.lastLineAt == null) return "idle";
  return now - sig.lastLineAt < idleMs ? "working" : "idle";
}
