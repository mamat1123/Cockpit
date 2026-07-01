import { useEffect, useState } from "react";
import { useMultiUsage } from "./usageStore";
import { costReport, type Bucket } from "./costClient";
import { totalCost, filterByPeriod } from "./costAggregate";
import { computeBudget, weekWindowStartDate, type Budget } from "./budget";

/**
 * Daily-budget pacing, composed entirely on the frontend from data we already have:
 *  - weekly utilization % + reset time  ← useUsage()  (authoritative account-API read)
 *  - real $ spent (this week / today)   ← cost_report (fine-grained session-log cost)
 *
 * "Spent today" is derived from the cost log (not the coarse weekly %), so it moves per-turn
 * and needs no persisted baseline. Pure pacing math lives in ./budget; this hook only wires data.
 */
export function useBudget(): Budget | null {
  const usage = useMultiUsage().claude;
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // cost poll (slow — the budget moves at human speed)
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
  if (util == null) return null;

  const windowStart = weekWindowStartDate(resetsAt, now);
  const bs = buckets ?? [];
  const weekUsd = totalCost(bs.filter((b) => b.date >= windowStart));
  const usedUsdToday = totalCost(filterByPeriod(bs, "today", new Date(now)));

  return computeBudget({ utilization: util, resetsAt, now, weekUsd, usedUsdToday });
}
