/** Pure helpers for rendering Usage — kept side-effect-free so they're unit-testable. */

export type UsageLevel = "mint" | "amber" | "red";

/** Colour band for a utilization %: mint < 55, amber 55–80, red > 80. */
export function levelFor(pct: number): UsageLevel {
  if (pct > 80) return "red";
  if (pct >= 55) return "amber";
  return "mint";
}

/** Clamp a utilization to a sane 0–100 integer for the bar width / label. */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Human reset countdown from an ISO timestamp: "2d 9h" / "4h 15m" / "12m" / "now".
 * Returns "—" when there's nothing to show (no/!valid timestamp).
 */
export function formatReset(resetsAt: string | null | undefined, now: number = Date.now()): string {
  if (!resetsAt) return "—";
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return "—";
  let s = Math.floor((t - now) / 1000);
  if (s <= 0) return "now";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/** Local wall-clock "HH:MM" a reset ISO timestamp lands at. "—" when missing/invalid. */
export function formatResetClock(resetsAt: string | null | undefined): string {
  if (!resetsAt) return "—";
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return "—";
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
