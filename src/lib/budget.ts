/**
 * Daily-budget pacing — pure, side-effect-free math so it's unit-testable.
 *
 * Goal: suggest how much of the WEEKLY rate-limit headroom to spend per day so the weekly
 * window runs down to ~empty exactly at its reset, instead of hitting the wall early.
 *
 * Model (decided in the grilling session — see docs/adr/0010):
 *  - Pace in % of the weekly limit (authoritative `utilization` from the account API).
 *  - Fixed-reset horizon: spread the remaining headroom over the days left until `resetsAt`.
 *  - Burn-down: allowance recomputes each day → self-correcting.
 *  - "Spent today" comes from the FINE-GRAINED cost log, not from the coarse weekly %:
 *    weekly utilization is integer-stepped over a large budget, so a day's spend barely
 *    moves it — the cost log moves per-turn and captures the whole local day regardless of
 *    when the cockpit was opened. We scale it onto the authoritative %-axis:
 *      usedToday% = utilization × (today's $ ÷ this week's $)
 *    i.e. today's share of the week's spend, expressed against the real weekly %.
 *    This removes the need for any persisted start-of-day baseline.
 */

import { levelFor, type UsageLevel } from "./usage";

/** Rough $/1% of weekly, used only for the $ readout before this week has enough spend to
 *  self-calibrate. The % pacing does NOT depend on it. */
export const DOLLARS_PER_PCT_FALLBACK = 55;
/** Below this weekly utilization the real $/% ratio is too noisy for the $ readout — use the fallback. */
export const DPP_MIN_SIGNAL_PCT = 5;
/** ≈ how many % of weekly one fully-maxed 5-hour block burns (rough, for the "≈N blocks" hint). */
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
  return remaining / Math.max(1, daysLeft);
}

/**
 * % of the weekly limit spent so far today, derived from the fine-grained cost log:
 * today's share of this week's spend, scaled by the authoritative weekly utilization.
 * Robust (needs no $/% calibration), moves per-turn, counts the whole local day.
 */
export function usedTodayPct(utilization: number, usedUsdToday: number, weekUsd: number): number {
  if (weekUsd <= 0 || utilization <= 0 || usedUsdToday <= 0) return 0;
  return Math.max(0, utilization * (usedUsdToday / weekUsd));
}

/** How full today's budget bar is: spent ÷ allowance, ×100. Can exceed 100 (overspent → borrowing). */
export function budgetFillPct(usedToday: number, allowance: number): number {
  if (allowance <= 0) return usedToday > 0 ? 1000 : 0;
  return (usedToday / allowance) * 100;
}

/** $/1% of weekly, self-calibrated from this week's real spend vs real utilization; fallback early week. */
export function dollarsPerPct(weekUsd: number, utilization: number): number {
  if (utilization >= DPP_MIN_SIGNAL_PCT && weekUsd > 0) return weekUsd / utilization;
  return DOLLARS_PER_PCT_FALLBACK;
}

/** "YYYY-MM-DD" (local) of the day the current weekly window opened — `resetsAt` minus 7 days. */
export function weekWindowStartDate(resetsAt: string | null | undefined, now: number): string {
  const base = resetsAt ? Date.parse(resetsAt) : NaN;
  const t = Number.isNaN(base) ? now : base - 7 * DAY_MS;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface BudgetInputs {
  utilization: number;   // current weekly utilization % (0–100), authoritative, from the account API
  resetsAt: string | null;
  now: number;
  weekUsd: number;       // REAL cost-weighted $ spent since the window opened (from cost logs)
  usedUsdToday: number;  // REAL cost-weighted $ spent today (from cost logs)
}

export interface Budget {
  daysLeft: number;
  allowancePct: number;    // today's budget (% of weekly)
  usedPct: number;         // spent today (% of weekly)
  remainingPct: number;    // allowance − used (can be < 0 when overspent)
  fillPct: number;         // day-bar fill: used ÷ allowance ×100 (can be > 100)
  level: UsageLevel;       // pace colour, derived from fillPct
  over: boolean;           // fillPct > 100 → borrowing from later days
  dollarsPerPct: number;
  allowanceUsd: number;    // estimated (allowancePct × $/%)
  usedUsd: number;         // REAL $ today
  remainingUsd: number;    // max(0, allowanceUsd − usedUsd)
  blocksRemaining: number; // remainingPct expressed in ~maxed-5h-blocks
  unspendable: boolean;    // allowance bigger than one day can physically burn
}

/** Compose the full budget view from live inputs. Pure — no storage, no clock reads. */
export function computeBudget(i: BudgetInputs): Budget {
  const daysLeft = daysLeftUntil(i.resetsAt, i.now);
  const used = usedTodayPct(i.utilization, i.usedUsdToday, i.weekUsd);
  const uStart = Math.max(0, i.utilization - used);          // back out start-of-day util
  const allowance = allowancePct(uStart, daysLeft);
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
