import { describe, it, expect } from "vitest";
import { costOf, DEFAULT_PRICES } from "./pricing";

describe("costOf", () => {
  it("prices every tier per model (1M tokens each, opus)", () => {
    const usage = { "claude-opus-4-8": { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite5m: 1e6, cacheWrite1h: 1e6 } };
    // 5 + 25 + 0.5 + 6.25 + 10 = 46.75
    expect(costOf(usage, DEFAULT_PRICES)).toBeCloseTo(46.75, 2);
  });
  it("falls back to opus pricing for an unknown model", () => {
    const usage = { mystery: { input: 1e6, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } };
    expect(costOf(usage, DEFAULT_PRICES)).toBeCloseTo(5, 2);
  });
  it("sums across models and is zero for empty", () => {
    expect(costOf({}, DEFAULT_PRICES)).toBe(0);
  });
});
