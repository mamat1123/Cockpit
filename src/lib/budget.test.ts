import { describe, it, expect } from "vitest";
import {
  daysLeftUntil, allowancePct, usedTodayPct, budgetFillPct,
  dollarsPerPct, weekWindowStartDate, computeBudget,
  DOLLARS_PER_PCT_FALLBACK,
} from "./budget";

const now = new Date(2026, 5, 24, 15, 0, 0).getTime();        // local Wed 24 Jun 15:00
const resetIn2 = new Date(2026, 5, 26, 9, 0, 0).toISOString(); // local Fri 26 Jun 09:00 → 3 days incl today

describe("daysLeftUntil", () => {
  it("counts whole local days inclusive of today", () => {
    expect(daysLeftUntil(resetIn2, now)).toBe(3);
  });
  it("reset later today is 1 day", () => {
    expect(daysLeftUntil(new Date(2026, 5, 24, 23, 0, 0).toISOString(), now)).toBe(1);
  });
  it("falls back to 1 for missing/invalid", () => {
    expect(daysLeftUntil(null, now)).toBe(1);
    expect(daysLeftUntil("not-a-date", now)).toBe(1);
  });
});

describe("allowancePct", () => {
  it("spreads remaining headroom over days left", () => {
    expect(allowancePct(43, 3)).toBeCloseTo(19, 5);   // (100-43)/3
  });
  it("is 0 when already maxed", () => {
    expect(allowancePct(100, 3)).toBe(0);
  });
  it("is the whole remainder on the last day", () => {
    expect(allowancePct(40, 1)).toBe(60);
  });
});

describe("usedTodayPct", () => {
  it("is the rise since the start-of-day baseline", () => {
    expect(usedTodayPct(47, 43)).toBe(4);
  });
  it("never goes negative (e.g. after a weekly reset)", () => {
    expect(usedTodayPct(2, 80)).toBe(0);
  });
});

describe("budgetFillPct", () => {
  it("is spent ÷ allowance ×100", () => {
    expect(budgetFillPct(4, 19)).toBeCloseTo(21.05, 1);
  });
  it("exceeds 100 when overspent (borrowing from later days)", () => {
    expect(budgetFillPct(25, 19)).toBeGreaterThan(100);
  });
  it("spending with zero allowance reads as way-over", () => {
    expect(budgetFillPct(5, 0)).toBeGreaterThan(100);
  });
});

describe("dollarsPerPct", () => {
  it("derives $/% from real spend once there's signal", () => {
    expect(dollarsPerPct(1034, 47)).toBeCloseTo(22, 5);
  });
  it("uses the fallback when utilization is too low to be reliable", () => {
    expect(dollarsPerPct(1034, 5)).toBe(DOLLARS_PER_PCT_FALLBACK);
  });
  it("uses the fallback when there's no spend yet", () => {
    expect(dollarsPerPct(0, 50)).toBe(DOLLARS_PER_PCT_FALLBACK);
  });
});

describe("weekWindowStartDate", () => {
  it("is the reset date minus 7 days, local YYYY-MM-DD", () => {
    expect(weekWindowStartDate(resetIn2, now)).toBe("2026-06-19");
  });
});

describe("computeBudget (scenario from the mockups)", () => {
  const b = computeBudget({
    utilization: 47, resetsAt: resetIn2, uStart: 43, now,
    weekUsd: 1034, usedUsdToday: 90,
  });
  it("paces remaining headroom across the days left", () => {
    expect(b.daysLeft).toBe(3);
    expect(b.allowancePct).toBeCloseTo(19, 5);
    expect(b.usedPct).toBe(4);
    expect(b.remainingPct).toBeCloseTo(15, 5);
  });
  it("fills the day bar by spent ÷ allowance, under budget → mint, not over", () => {
    expect(b.fillPct).toBeCloseTo(21.05, 1);
    expect(b.over).toBe(false);
    expect(b.level).toBe("mint");
  });
  it("estimates $ from self-calibrated $/% but uses REAL $ for today's spend", () => {
    expect(b.dollarsPerPct).toBeCloseTo(22, 5);
    expect(b.allowanceUsd).toBeCloseTo(418, 0);
    expect(b.usedUsd).toBe(90);                 // passthrough of real cost
    expect(b.remainingUsd).toBeCloseTo(328, 0);
  });
  it("expresses remaining in ~5h-blocks and is spendable in a day", () => {
    expect(b.blocksRemaining).toBeCloseTo(0.94, 1);
    expect(b.unspendable).toBe(false);
  });
});

describe("computeBudget (overspent day)", () => {
  it("flags over and goes red when today's spend passes the allowance", () => {
    const b = computeBudget({ utilization: 70, resetsAt: resetIn2, uStart: 43, now, weekUsd: 1540, usedUsdToday: 600 });
    // allowance (100-43)/3 = 19; used 70-43 = 27 > 19 → over
    expect(b.over).toBe(true);
    expect(b.level).toBe("red");
    expect(b.remainingPct).toBeLessThan(0);
  });
});
