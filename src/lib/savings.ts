import { loadPrices, type ModelPrice } from "./pricing";

export interface ProxyRecord { ts: number; model: string; tokensSaved: number; cacheHit: boolean; savingsPercent: number }
export interface WorkingSample { t: number; paneIds: string[] }
export interface Totals { tokensSaved: number; requests: number; cacheHits: number; usd: number }

const FALLBACK_MODEL = "claude-opus-4-8";

/** Parse one proxy-log JSONL line. Returns null for malformed JSON or non-request
 *  lines (those without a numeric `tokens_saved`). */
export function parseRecord(line: string): ProxyRecord | null {
  let v: Record<string, unknown>;
  try { v = JSON.parse(line); } catch { return null; }
  if (typeof v.tokens_saved !== "number") return null;
  // The proxy emits a NAIVE-LOCAL wall-clock timestamp (no `Z`, microseconds), e.g.
  // "2026-06-29T14:32:59.295294". Date.parse reads it as local — matching the webview's
  // Date.now() used for working-history samples (same machine). Do NOT append "Z": that
  // would reinterpret it as UTC and skew attribution by the local timezone offset.
  const tsRaw = typeof v.timestamp === "string" ? Date.parse(v.timestamp) : NaN;
  return {
    ts: Number.isNaN(tsRaw) ? 0 : tsRaw,
    model: typeof v.model === "string" ? v.model : FALLBACK_MODEL,
    tokensSaved: v.tokens_saved,
    cacheHit: v.cache_hit === true,
    savingsPercent: typeof v.savings_percent === "number" ? v.savings_percent : 0,
  };
}

/** USD value of saved tokens, priced at the model's input rate (prices are USD per 1M). */
export function savedUsd(tokensSaved: number, model: string, prices: Record<string, ModelPrice> = loadPrices()): number {
  const p = prices[model] ?? prices[FALLBACK_MODEL];
  const rate = p ? p.input : 5;
  return (tokensSaved * rate) / 1e6;
}

/** Attribute a record (at time `ts`) to the unique pane working at the nearest working
 *  sample. Ambiguous (0 or >=2 panes) or no sample within tolerance → null (Unattributed). */
export function attribute(ts: number, history: WorkingSample[], toleranceMs = 4000): string | null {
  let best: WorkingSample | null = null;
  let bestGap = Infinity;
  for (const s of history) {
    const gap = Math.abs(s.t - ts);
    if (gap < bestGap) { bestGap = gap; best = s; }
  }
  if (!best || bestGap > toleranceMs) return null;
  return best.paneIds.length === 1 ? best.paneIds[0] : null;
}

export function emptyTotals(): Totals {
  return { tokensSaved: 0, requests: 0, cacheHits: 0, usd: 0 };
}

export function addRecord(t: Totals, r: ProxyRecord, prices: Record<string, ModelPrice> = loadPrices()): Totals {
  return {
    tokensSaved: t.tokensSaved + r.tokensSaved,
    requests: t.requests + 1,
    cacheHits: t.cacheHits + (r.cacheHit ? 1 : 0),
    usd: t.usd + savedUsd(r.tokensSaved, r.model, prices),
  };
}

