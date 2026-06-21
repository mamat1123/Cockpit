import { describe, it, expect } from "vitest";
import { filterByPeriod, byProject, byModel, byDay, totalCost, tierTokens } from "./costAggregate";
import type { Bucket } from "./costClient";

const U = (input: number, output = 0) => ({ input, output, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
const data: Bucket[] = [
  { date: "2026-06-20", project: "mee-tang/app", model: "claude-opus-4-8", session: "x", usage: U(1e6) },     // $5
  { date: "2026-06-21", project: "mee-tang/app", model: "claude-opus-4-8", session: "x", usage: U(0, 1e6) },   // $25
  { date: "2026-06-21", project: "ai-trading-bot", model: "claude-haiku-4-5", session: "x", usage: U(1e6) },   // $1
];

describe("costAggregate", () => {
  it("totalCost sums all priced tiers", () => { expect(totalCost(data)).toBeCloseTo(31, 2); });
  it("byProject groups + sorts desc", () => {
    const p = byProject(data);
    expect(p[0]).toMatchObject({ name: "mee-tang/app", usd: 30 });
    expect(p[1]).toMatchObject({ name: "ai-trading-bot", usd: 1 });
  });
  it("byModel groups", () => {
    expect(byModel(data).find((m) => m.name === "claude-opus-4-8")!.usd).toBeCloseTo(30, 2);
  });
  it("byDay is chronological", () => {
    expect(byDay(data).map((d) => d.name)).toEqual(["2026-06-20", "2026-06-21"]);
  });
  it("filterByPeriod keeps only on/after the cutoff", () => {
    const only21 = filterByPeriod(data, "today", new Date("2026-06-21T12:00:00Z"));
    expect(only21.every((b) => b.date === "2026-06-21")).toBe(true);
    expect(filterByPeriod(data, "all", new Date("2026-06-21T12:00:00Z")).length).toBe(3);
  });
  it("tierTokens sums token tiers", () => {
    expect(tierTokens(data)).toMatchObject({ input: 2e6, output: 1e6 });
  });
});

import { bySession } from "./costAggregate";

describe("bySession", () => {
  it("groups cost by session id, sorted desc", () => {
    const U = (input: number) => ({ input, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
    const data = [
      { date: "2026-06-21", project: "p", model: "claude-opus-4-8", session: "s1", usage: U(2e6) }, // $10
      { date: "2026-06-21", project: "p", model: "claude-opus-4-8", session: "s2", usage: U(1e6) }, // $5
    ];
    const r = bySession(data);
    expect(r[0]).toMatchObject({ name: "s1", usd: 10 });
    expect(r[1]).toMatchObject({ name: "s2", usd: 5 });
  });
});
