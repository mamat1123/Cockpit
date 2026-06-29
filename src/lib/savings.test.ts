import { describe, it, expect } from "vitest";
import { parseRecord, savedUsd, attribute, emptyTotals, addRecord, savingsRows } from "./savings";

const PRICES = { "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 } };

describe("parseRecord", () => {
  it("maps the real proxy fields + parses the ISO timestamp to ms", () => {
    const line = JSON.stringify({
      timestamp: "2026-06-29T04:01:13Z", model: "claude-opus-4-8",
      input_tokens_original: 1000, input_tokens_optimized: 600,
      tokens_saved: 400, savings_percent: 40, cache_hit: true,
    });
    const r = parseRecord(line)!;
    expect(r.ts).toBe(Date.parse("2026-06-29T04:01:13Z"));
    expect(r.model).toBe("claude-opus-4-8");
    expect(r.tokensSaved).toBe(400);
    expect(r.cacheHit).toBe(true);
    expect(r.savingsPercent).toBe(40);
  });
  it("returns null for a line with no tokens_saved field", () => {
    expect(parseRecord(JSON.stringify({ type: "livez", timestamp: "2026-06-29T04:01:13Z" }))).toBeNull();
  });
  it("returns null for malformed JSON", () => {
    expect(parseRecord("not json")).toBeNull();
  });
  it("returns null when tokens_saved is a string, not a number", () => {
    expect(parseRecord(JSON.stringify({ timestamp: "2026-06-29T04:01:13Z", model: "claude-opus-4-8", tokens_saved: "400" }))).toBeNull();
  });
  it("parses the real naive-local proxy timestamp (no Z, microseconds) as local time", () => {
    const line = JSON.stringify({
      timestamp: "2026-06-29T14:32:59.295294", model: "claude-opus-4-8",
      tokens_saved: 0, cache_hit: true, savings_percent: 0,
    });
    const r = parseRecord(line)!;
    expect(r.ts).toBe(Date.parse("2026-06-29T14:32:59.295294"));
    expect(Number.isNaN(r.ts)).toBe(false);
    expect(r.ts).toBeGreaterThan(0);
  });
});

describe("savedUsd", () => {
  it("values saved tokens at the model's input rate (USD per 1M)", () => {
    expect(savedUsd(400_000, "claude-opus-4-8", PRICES)).toBeCloseTo(2.0, 6); // 400k * $5/1M
  });
  it("falls back to opus pricing for an unknown model", () => {
    expect(savedUsd(1_000_000, "mystery-model", PRICES)).toBeCloseTo(5.0, 6);
  });
});

describe("attribute", () => {
  const hist = [
    { t: 1000, paneIds: ["A"] },
    { t: 2000, paneIds: ["A", "B"] },
    { t: 3000, paneIds: [] },
  ];
  it("attributes to the unique working pane at the nearest sample", () => {
    expect(attribute(1100, hist)).toBe("A");
  });
  it("returns null when two panes were working (ambiguous)", () => {
    expect(attribute(2000, hist)).toBeNull();
  });
  it("returns null when no pane was working", () => {
    expect(attribute(3000, hist)).toBeNull();
  });
  it("returns null when no sample is within tolerance", () => {
    expect(attribute(999_999, hist, 2000)).toBeNull();
  });
  it("returns null for empty history", () => {
    expect(attribute(1000, [])).toBeNull();
  });
});

describe("addRecord / emptyTotals", () => {
  it("accumulates tokens, requests, cache hits, and usd", () => {
    let t = emptyTotals();
    t = addRecord(t, { ts: 1, model: "claude-opus-4-8", tokensSaved: 400_000, cacheHit: true, savingsPercent: 40 }, PRICES);
    t = addRecord(t, { ts: 2, model: "claude-opus-4-8", tokensSaved: 0, cacheHit: false, savingsPercent: 0 }, PRICES);
    expect(t.requests).toBe(2);
    expect(t.tokensSaved).toBe(400_000);
    expect(t.cacheHits).toBe(1);
    expect(t.usd).toBeCloseTo(2.0, 6);
  });
});

describe("savingsRows", () => {
  const t = (tokensSaved: number, requests: number, cacheHits: number, usd: number) =>
    ({ tokensSaved, requests, cacheHits, usd });

  it("joins pane title/cwd from meta and computes cache-hit rate", () => {
    const out = savingsRows(
      { "pane-1": t(100, 4, 2, 0.5) },
      { "pane-1": { title: "akurax-api", cwd: "/Users/x/akurax-api" } },
    );
    expect(out.rows[0].title).toBe("akurax-api");
    expect(out.rows[0].cwd).toBe("/Users/x/akurax-api");
    expect(out.rows[0].cacheRate).toBeCloseTo(0.5, 6); // 2/4
  });

  it("labels a pane missing from meta as a closed session, cwd empty", () => {
    const out = savingsRows({ "pane-9": t(0, 1, 0, 0) }, {});
    expect(out.rows[0].title).toBe("(closed session)");
    expect(out.rows[0].cwd).toBe("");
  });

  it("cacheRate is 0 when there are no requests (no divide-by-zero)", () => {
    const out = savingsRows({ "pane-1": t(0, 0, 0, 0) }, {});
    expect(out.rows[0].cacheRate).toBe(0);
  });

  it("sorts rows by usd desc, then requests desc", () => {
    const out = savingsRows(
      { a: t(0, 1, 0, 0.1), b: t(0, 9, 0, 0.1), c: t(0, 1, 0, 5.0) },
      {},
    );
    expect(out.rows.map((r) => r.paneId)).toEqual(["c", "b", "a"]);
  });

  it("sums summary totals across panes", () => {
    const out = savingsRows(
      { a: t(100, 2, 1, 0.5), b: t(50, 3, 2, 0.25) },
      {},
    );
    expect(out.totalTokensSaved).toBe(150);
    expect(out.totalRequests).toBe(5);
    expect(out.totalCacheHits).toBe(3);
    expect(out.totalUsd).toBeCloseTo(0.75, 6);
  });

  it("empty byPane → empty rows + zero totals", () => {
    const out = savingsRows({}, {});
    expect(out.rows).toEqual([]);
    expect(out.totalUsd).toBe(0);
  });
});
