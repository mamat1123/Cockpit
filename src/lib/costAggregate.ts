import type { Bucket } from "./costClient";
import { costOf, type Usage } from "./pricing";

export type Period = "today" | "7d" | "30d" | "all";

const iso = (d: Date) => d.toISOString().slice(0, 10);
function cutoff(period: Period, now: Date): string | null {
  if (period === "all") return null;
  const d = new Date(now);
  if (period !== "today") d.setUTCDate(d.getUTCDate() - (period === "7d" ? 6 : 29));
  return iso(d);
}
export function filterByPeriod(buckets: Bucket[], period: Period, now = new Date()): Bucket[] {
  const c = cutoff(period, now);
  return c ? buckets.filter((b) => b.date >= c) : buckets;
}

const empty = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
const addU = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m, cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
});
function usageByModel(buckets: Bucket[]): Record<string, Usage> {
  const m: Record<string, Usage> = {};
  for (const b of buckets) m[b.model] = addU(m[b.model] ?? empty(), b.usage);
  return m;
}

export interface Slice { name: string; usd: number }
function groupCost(buckets: Bucket[], key: (b: Bucket) => string): Slice[] {
  const groups = new Map<string, Bucket[]>();
  for (const b of buckets) { const a = groups.get(key(b)) ?? []; a.push(b); groups.set(key(b), a); }
  return [...groups.entries()].map(([name, bs]) => ({ name, usd: costOf(usageByModel(bs)) })).sort((a, b) => b.usd - a.usd);
}

export const byProject = (b: Bucket[]): Slice[] => groupCost(b, (x) => x.project);
export const byModel = (b: Bucket[]): Slice[] => groupCost(b, (x) => x.model);
export const bySession = (b: Bucket[]): Slice[] => groupCost(b, (x) => x.session);
export const byDay = (b: Bucket[]): Slice[] => groupCost(b, (x) => x.date).sort((a, b) => a.name.localeCompare(b.name));
export const totalCost = (b: Bucket[]): number => costOf(usageByModel(b));

export interface TierTokens { cacheRead: number; input: number; cacheWrite: number; output: number }
export function tierTokens(buckets: Bucket[]): TierTokens {
  const t: TierTokens = { cacheRead: 0, input: 0, cacheWrite: 0, output: 0 };
  for (const b of buckets) {
    t.cacheRead += b.usage.cacheRead; t.input += b.usage.input;
    t.cacheWrite += b.usage.cacheWrite5m + b.usage.cacheWrite1h; t.output += b.usage.output;
  }
  return t;
}
