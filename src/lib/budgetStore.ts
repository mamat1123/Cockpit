import { useEffect, useState } from "react";
import { useUsage } from "./usageStore";
import { costReport, type Bucket } from "./costClient";
import { totalCost, filterByPeriod } from "./costAggregate";
import { computeBudget, weekWindowStartDate, type Budget } from "./budget";

/**
 * Daily-budget pacing, composed entirely on the frontend from data we already have:
 *  - weekly utilization % + reset time  ← useUsage() (the authoritative account API read)
 *  - real $ spent (this week / today)   ← cost_report (session-log cost, for the $ secondary)
 *  - a start-of-local-day utilization baseline, persisted in localStorage
 *
 * Pure pacing math lives in ./budget. This hook only wires data + manages the baseline.
 */

const KEY = "cockpit.budget.v1";

interface Baseline { date: string; uStart: number; resetsAt: string | null; lastUtil: number }

function localDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function readBaseline(): Baseline | null {
  try { const r = localStorage.getItem(KEY); return r ? (JSON.parse(r) as Baseline) : null; } catch { return null; }
}
function writeBaseline(b: Baseline): void {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* no localStorage — pacing degrades to current-util baseline */ }
}

/**
 * Resolve today's start-of-day utilization baseline, persisting it. Re-snapshots on a new
 * local day (using yesterday's last reading as the day-start), and on a detected weekly
 * reset (resetsAt changed, or utilization dropped). Side-effecting — call from an effect.
 */
export function resolveBaseline(util: number, resetsAt: string | null, now: number): number {
  const today = localDateStr(now);
  const prev = readBaseline();
  let uStart: number;
  if (!prev || prev.date !== today) {
    // new local day → best estimate of the day's start is yesterday's last reading
    uStart = prev && util >= prev.lastUtil ? prev.lastUtil : util;
  } else if (prev.resetsAt !== resetsAt || util < prev.uStart - 1) {
    // weekly window reset within the day → start fresh from the post-reset value
    uStart = util;
  } else {
    uStart = prev.uStart;
  }
  writeBaseline({ date: today, uStart, resetsAt, lastUtil: util });
  return uStart;
}

/** Live daily-budget view, or null until we have a weekly utilization reading. */
export function useBudget(): Budget | null {
  const usage = useUsage();
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [uStart, setUStart] = useState<number | null>(null);

  // cost poll (slow — the budget moves at human speed): real $ for the secondary readout
  useEffect(() => {
    let alive = true, inflight = false;
    const tick = async () => {
      if (inflight) return;
      inflight = true;
      try { const r = await costReport(); if (alive) setBuckets(r.buckets); } catch { /* keep last */ } finally { inflight = false; }
    };
    void tick();
    const id = setInterval(tick, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // minute clock so daysLeft and the local-day rollover stay current
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const week = usage.report?.sevenDay ?? null;
  const util = week?.utilization ?? null;
  const resetsAt = week?.resetsAt ?? null;
  const today = localDateStr(now);

  // (re)snapshot the start-of-day baseline when utilization, reset, or the local day changes
  useEffect(() => {
    if (util == null) return;
    setUStart(resolveBaseline(util, resetsAt, Date.now()));
  }, [util, resetsAt, today]);

  if (util == null || uStart == null) return null;

  const windowStart = weekWindowStartDate(resetsAt, now);
  const bs = buckets ?? [];
  const weekUsd = totalCost(bs.filter((b) => b.date >= windowStart));
  const usedUsdToday = totalCost(filterByPeriod(bs, "today", new Date(now)));

  return computeBudget({ utilization: util, resetsAt, uStart, now, weekUsd, usedUsdToday });
}
