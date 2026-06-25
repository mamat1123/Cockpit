import { describe, it, expect } from "vitest";
import {
  daysLeftUntil, allowancePct, usedTodayPct, budgetFillPct,
  dollarsPerPct, weekWindowStartDate, computeBudget,
  DOLLARS_PER_PCT_FALLBACK,
} from "./budget";

const now = new Date(2026, 5, 25, 15, 0, 0).getTime();        // local Thu 25 Jun 15:00
const resetIn5 = new Date(2026, 5, 30, 9, 0, 0).toISOString(); // local 30 Jun 09:00 → 6 days incl today

describe("daysLeftUntil", () => {
  it("counts whole local days inclusive of today", () => {
    expect(daysLeftUntil(resetIn5, now)).toBe(6);
  });
  it("reset later today is 1 day", () => {
    expect(daysLeftUntil(new Date(2026, 5, 25, 23, 0, 0).toISOString(), now)).toBe(1);
  });
  it("falls back to 1 for missing/invalid", () => {
    expect(daysLeftUntil(null, now)).toBe(1);
    expect(daysLeftUntil("not-a-date", now)).toBe(1);
  });
});

describe("allowancePct", () => {
  it("spreads remaining headroom over days left", () => {
    expect(allowancePct(40, 6)).toBeCloseTo(10, 5);          // (100-40)/6
  });
  it("is 0 when already maxed", () => {
    expect(allowancePct(100, 6)).toBe(0);
  });
  it("is the whole remainder on the last day", () => {
    expect(allowancePct(40, 1)).toBe(60);
  });
});

describe("usedTodayPct (from the cost log, scaled onto the % axis)", () => {
  it("is utilization × today's share of this week's spend", () => {
    // 33% used this week; today is 111/2175 of that spend → 33 × 0.051 ≈ 1.68%
    expect(usedTodayPct(33, 111, 2175)).toBeCloseTo(1.684, 2);
  });
  it("moves with every dollar spent today (fine-grained, unlike the coarse weekly %)", () => {
    const a = usedTodayPct(33, 50, 2175);
    const b = usedTodayPct(33, 120, 2175);
    expect(b).toBeGreaterThan(a);
  });
  it("is 0 with no spend / no week data", () => {
    expect(usedTodayPct(33, 0, 2175)).toBe(0);
    expect(usedTodayPct(33, 111, 0)).toBe(0);
    expect(usedTodayPct(0, 111, 2175)).toBe(0);
  });
});

describe("budgetFillPct", () => {
  it("is spent ÷ allowance ×100", () => {
    expect(budgetFillPct(1.68, 11.45)).toBeCloseTo(14.67, 1);
  });
  it("exceeds 100 when overspent (borrowing from later days)", () => {
    expect(budgetFillPct(25, 11)).toBeGreaterThan(100);
  });
  it("spending with zero allowance reads as way-over", () => {
    expect(budgetFillPct(5, 0)).toBeGreaterThan(100);
  });
});

describe("dollarsPerPct", () => {
  it("derives $/% from real spend once there's signal", () => {
    expect(dollarsPerPct(2175, 33)).toBeCloseTo(65.9, 1);
  });
  it("uses the fallback when utilization is too low to be reliable", () => {
    expect(dollarsPerPct(2175, 2)).toBe(DOLLARS_PER_PCT_FALLBACK);
  });
  it("uses the fallback when there's no spend yet", () => {
    expect(dollarsPerPct(0, 50)).toBe(DOLLARS_PER_PCT_FALLBACK);
  });
});

describe("weekWindowStartDate", () => {
  it("is the reset date minus 7 days, local YYYY-MM-DD", () => {
    expect(weekWindowStartDate(resetIn5, now)).toBe("2026-06-23");
  });
});

describe("computeBudget (live scenario: util 33%, $111 today of $2175 this week)", () => {
  const b = computeBudget({ utilization: 33, resetsAt: resetIn5, now, weekUsd: 2175, usedUsdToday: 111 });
  it("paces the remaining headroom across the days left", () => {
    expect(b.daysLeft).toBe(6);
    expect(b.usedPct).toBeCloseTo(1.684, 2);
    expect(b.allowancePct).toBeCloseTo(11.45, 1);   // (100 - (33-1.68)) / 6
    expect(b.remainingPct).toBeCloseTo(9.76, 1);
  });
  it("fills the day bar by spent ÷ allowance — under budget → mint, not over", () => {
    expect(b.fillPct).toBeCloseTo(14.7, 0);
    expect(b.over).toBe(false);
    expect(b.level).toBe("mint");
  });
  it("self-calibrates $/% from real spend; today's $ is the REAL cost figure", () => {
    expect(b.dollarsPerPct).toBeCloseTo(65.9, 1);
    expect(b.usedUsd).toBe(111);
    expect(b.allowanceUsd).toBeCloseTo(754, -1);
    expect(b.remainingUsd).toBeCloseTo(643, -1);
  });
});

describe("computeBudget (overspent day)", () => {
  it("flags over and goes red once today's spend passes the allowance", () => {
    // util 40, today $900 of $2000 this week → used 40×0.45 = 18%; daysLeft 6 → allowance (100-22)/6 = 13 < 18
    const b = computeBudget({ utilization: 40, resetsAt: resetIn5, now, weekUsd: 2000, usedUsdToday: 900 });
    expect(b.usedPct).toBeCloseTo(18, 5);
    expect(b.over).toBe(true);
    expect(b.level).toBe("red");
    expect(b.remainingPct).toBeLessThan(0);
  });
});

describe("computeBudget (fresh day / no spend yet → bar at 0, not broken)", () => {
  it("shows a positive allowance and 0% used when nothing spent today", () => {
    const b = computeBudget({ utilization: 33, resetsAt: resetIn5, now, weekUsd: 2175, usedUsdToday: 0 });
    expect(b.usedPct).toBe(0);
    expect(b.fillPct).toBe(0);
    expect(b.allowancePct).toBeCloseTo((100 - 33) / 6, 1);
  });
});
