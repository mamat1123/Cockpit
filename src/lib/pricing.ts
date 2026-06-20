export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number }

// USD per 1M tokens. cache write 5m = 1.25x input, 1h = 2x input, read = 0.1x input.
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "claude-opus-4-8":   { input: 5,  output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-7":   { input: 5,  output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-6":   { input: 5,  output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-sonnet-4-6": { input: 3,  output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  "claude-haiku-4-5":  { input: 1,  output: 5,  cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },
  "claude-fable-5":    { input: 10, output: 50, cacheRead: 1.0, cacheWrite5m: 12.5, cacheWrite1h: 20 },
};
const FALLBACK = DEFAULT_PRICES["claude-opus-4-8"];

const KEY = "cockpit.prices.v1";
export function loadPrices(): Record<string, ModelPrice> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PRICES, ...JSON.parse(raw) };
  } catch { /* no localStorage / bad json — use defaults */ }
  return DEFAULT_PRICES;
}
export function savePrices(p: Record<string, ModelPrice>) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** USD for a per-model usage map. */
export function costOf(usageByModel: Record<string, Usage>, table: Record<string, ModelPrice> = loadPrices()): number {
  let usd = 0;
  for (const [model, u] of Object.entries(usageByModel)) {
    const p = table[model] ?? FALLBACK;
    usd += (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead
          + u.cacheWrite5m * p.cacheWrite5m + u.cacheWrite1h * p.cacheWrite1h) / 1e6;
  }
  return usd;
}
