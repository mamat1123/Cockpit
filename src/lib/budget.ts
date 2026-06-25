/**
 * Daily-budget pacing — pure, side-effect-free math so it's unit-testable.
 *
 * Goal: suggest how much of the WEEKLY rate-limit headroom to spend per day so the
 * weekly window runs down to ~empty exactly at its reset, instead of hitting the
 * wall early. We pace in % of the weekly limit (the authoritative number from the
 * account API); USD is a self-calibrated secondary for tangibility only.
 *
 * Model (decided in the grilling session — see docs/adr/0010):
 *  - Fixed-reset horizon: pace the remaining utilization down to `resetsAt`.
 *  - Burn-down: allowance recomputes each day → self-correcting (under-use today
 *    raises tomorrow's allowance; over-use lowers it).
 *  - Start-of-day baseline `uStart` is captured by the store; this module is pure.
 */

import { levelFor, type UsageLevel } from "./usage";

/** ≈ weekly $ value at 100% (Team Premium, calibrated from logs ~$2,200). Used until
 *  there's enough real spend this week to derive $/% empirically. */
export const DOLLARS_PER_PCT_FALLBACK = 22;
/** Below this weekly utilization the real $/% ratio is too noisy — use the fallback. */
export const DPP_MIN_SIGNAL_PCT = 10;
/** ≈ how many % of weekly one fully-maxed 5-hour block burns (calibrated ~16%). */
export const PCT_PER_5H_BLOCK = 16;
/** Above this daily allowance you physically can't spend it in one day (~3 maxed 5h blocks). */
export const MAX_DAILY_SPEND_PCT = 50;

const DAY_MS = 86_400_000;

function localMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole local calendar days from `now` through the reset day, inclusive of today (min 1). */
export function daysLeftUntil(resetsAt: string | null | undefined, now: number): number {
  if (!resetsAt) return 1;
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return 1;
  const diff = Math.round((localMidnight(t) - localMidnight(now)) / DAY_MS);
  return Math.max(1, diff + 1);
}

/** Today's suggested budget as % of the weekly limit: remaining headroom spread over days left. */
export function allowancePct(uStart: number, daysLeft: number): number {
  const remaining = Math.max(0, 100 - uStart);
  const days = Math.max(1, daysLeft);
  return remaining / days;
}

/** % of the weekly limit spent so far today (since the start-of-day baseline). Never negative. */
export function usedTodayPct(utilization: number, uStart: number): number {
  return Math.max(0, utilization - uStart);
}

/** How full today's budget bar is: spent ÷ allowance, ×100. Can exceed 100 (overspent → borrowing). */
export function budgetFillPct(usedToday: number, allowance: number): number {
  if (allowance <= 0) return usedToday > 0 ? 1000 : 0; // no budget but spending → way over
  return (usedToday / allowance) * 100;
}

/**
 * $/1% of weekly, calibrated from THIS week's real spend vs real utilization. Falls back
 * to a constant early in the week when utilization is too low for a stable ratio.
 */
export function dollarsPerPct(weekUsd: number, utilization: number): number {
  if (utilization >= DPP_MIN_SIGNAL_PCT && weekUsd > 0) return weekUsd / utilization;
  return DOLLARS_PER_PCT_FALLBACK;
}

/** "YYYY-MM-DD" (local) of the day the current weekly window opened — `resetsAt` minus 7 days.
 *  Used to filter cost buckets down to the current weekly window. */
export function weekWindowStartDate(resetsAt: string | null | undefined, now: number): string {
  const base = resetsAt ? Date.parse(resetsAt) : NaN;
  const t = Number.isNaN(base) ? now : base - 7 * DAY_MS;
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface BudgetInputs {
  utilization: number;        // current weekly utilization % (0–100), from the account API
  resetsAt: string | null;    // weekly window reset (ISO)
  uStart: number;             // start-of-local-day weekly utilization baseline
  now: number;
  weekUsd: number;            // REAL $ spent since the window opened (from cost logs)
  usedUsdToday: number;       // REAL $ spent today (from cost logs)
}

export interface Budget {
  daysLeft: number;
  allowancePct: number;       // today's budget (% of weekly)
  usedPct: number;            // spent today (% of weekly)
  remainingPct: number;       // allowance − used (can be < 0 when overspent)
  fillPct: number;            // day-bar fill: used ÷ allowance ×100 (can be > 100)
  level: UsageLevel;          // pace colour, derived from fillPct
  over: boolean;              // fillPct > 100 → borrowing from later days
  dollarsPerPct: number;
  allowanceUsd: number;       // estimated (pct × $/% )
  usedUsd: number;            // REAL $ today
  remainingUsd: number;       // max(0, allowanceUsd − usedUsd)
  blocksRemaining: number;    // remainingPct expressed in ~maxed-5h-blocks
  unspendable: boolean;       // allowance bigger than one day can physically burn
}

/** Compose the full budget view from raw inputs. Pure. */
export function computeBudget(i: BudgetInputs): Budget {
  const daysLeft = daysLeftUntil(i.resetsAt, i.now);
  const allowance = allowancePct(i.uStart, daysLeft);
  const used = usedTodayPct(i.utilization, i.uStart);
  const remainingPct = allowance - used;
  const fillPct = budgetFillPct(used, allowance);
  const dpp = dollarsPerPct(i.weekUsd, i.utilization);
  const allowanceUsd = allowance * dpp;
  return {
    daysLeft,
    allowancePct: allowance,
    usedPct: used,
    remainingPct,
    fillPct,
    level: levelFor(fillPct),
    over: fillPct > 100,
    dollarsPerPct: dpp,
    allowanceUsd,
    usedUsd: i.usedUsdToday,
    remainingUsd: Math.max(0, allowanceUsd - i.usedUsdToday),
    blocksRemaining: remainingPct / PCT_PER_5H_BLOCK,
    unspendable: allowance > MAX_DAILY_SPEND_PCT,
  };
}
