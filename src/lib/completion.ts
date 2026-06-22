const TURN_END = new Set(["end_turn", "stop_sequence", "max_tokens"]);

/** Detect a *fresh* assistant turn-end in a transcript line. Returns `{ at }` (ms epoch
 *  of the turn end) or null. Stale lines (older than `freshnessMs`) are rejected so a
 *  resumed session's backfilled history never fires a Completion (ADR 0007). */
export function parseTurnEnd(line: string, nowMs: number, freshnessMs = 8000): { at: number } | null {
  let v: any;
  try { v = JSON.parse(line); } catch { return null; }
  if (!v || v.type !== "assistant") return null;
  const sr = v.message?.stop_reason;
  if (typeof sr !== "string" || !TURN_END.has(sr)) return null;
  const ts = typeof v.timestamp === "string" ? Date.parse(v.timestamp) : NaN;
  if (Number.isNaN(ts)) return null;
  if (nowMs - ts >= freshnessMs) return null;
  return { at: ts };
}
