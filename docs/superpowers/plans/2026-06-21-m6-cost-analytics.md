# Claude Cockpit — M6: Cost Analytics (charts, all projects)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A "Cost" tab in Mission Control showing spend across ALL projects/sessions as ECharts charts — daily-spend bars, by-project bars, by-model donut, token-tier breakdown — with a period filter (Today / 7d / 30d / All) and a big total. Numbers match `claude /cost` (dedup by message id, cache tiers priced separately).

**Architecture:** Rust `cost_report()` scans every `~/.claude/projects/*/*.jsonl` incrementally (per-file offset cache + global message-id dedup) and returns flat `Bucket[]` = (date, project, model, usage-tokens). The frontend filters by period, groups (day/project/model/tier), prices via the existing editable table (`costOf`), and renders with `echarts` (already installed; a tiny `<EChart>` wrapper, no react-wrapper lib — React 19). Lives as a 2nd tab in the existing Dashboard overlay.

**Tech Stack:** Rust (serde_json, incremental scan) · React 19 + `echarts` ^6 · vitest + cargo test.

---

## Task 1: Rust — `cost_report` (all-projects, incremental, deduped)

**Files:** modify `src-tauri/src/cost.rs`, `src-tauri/src/lib.rs`.

- [ ] **Step 1:** In `src-tauri/src/cost.rs`, add `use std::collections::{HashMap, HashSet};` already present; ADD `use std::io::BufRead;` and `BufReader` (extend the existing `use std::io::{...}` to include `BufRead, BufReader`), and `use std::path::Path;` (extend the existing path import). Then refactor + add:

(a) Extract the tier reader (used by both commands) — add above `parse_turn_usage`:
```rust
/// Pull the 5 billable token tiers out of a `message.usage` JSON object.
fn usage_from(usage: &serde_json::Value) -> Usage {
    let g = |obj: &serde_json::Value, k: &str| obj.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let (w5m, w1h) = match usage.get("cache_creation") {
        Some(cc) if cc.is_object() => (g(cc, "ephemeral_5m_input_tokens"), g(cc, "ephemeral_1h_input_tokens")),
        _ => (g(usage, "cache_creation_input_tokens"), 0),
    };
    Usage {
        input: g(usage, "input_tokens"),
        output: g(usage, "output_tokens"),
        cache_read: g(usage, "cache_read_input_tokens"),
        cache_write5m: w5m,
        cache_write1h: w1h,
    }
}
```
   and change `parse_turn_usage` to reuse it — replace its body's tier extraction so it ends with `Some((id, model, usage_from(usage)))` (keep the id/model extraction; remove the inline `g`/`w5m`/`w1h` now that `usage_from` does it). The existing tests for `parse_turn_usage` must still pass unchanged.

(b) Add helpers + the report:
```rust
fn label_from_cwd(cwd: &str) -> String {
    let segs: Vec<&str> = cwd.split('/').filter(|s| !s.is_empty()).collect();
    match segs.len() {
        0 => "—".to_string(),
        1 => segs[0].to_string(),
        n => format!("{}/{}", segs[n - 2], segs[n - 1]),
    }
}

fn first_cwd_label(path: &Path) -> Option<String> {
    let f = std::fs::File::open(path).ok()?;
    for line in BufReader::new(f).lines().map_while(Result::ok).take(40) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(cwd) = v.get("cwd").and_then(|x| x.as_str()) {
                return Some(label_from_cwd(cwd));
            }
        }
    }
    None
}

/// (message_id, model, usage, date) for a usage-bearing line; date = YYYY-MM-DD from `timestamp`.
fn parse_turn_full(line: &str) -> Option<(String, String, Usage, String)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let msg = v.get("message")?;
    let usage = msg.get("usage")?;
    let id = msg.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let model = msg.get("model").and_then(|x| x.as_str()).unwrap_or("unknown").to_string();
    let date = v.get("timestamp").and_then(|x| x.as_str())
        .map(|s| s.chars().take(10).collect::<String>()).unwrap_or_default();
    Some((id, model, usage_from(usage), date))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket { pub date: String, pub project: String, pub model: String, pub usage: Usage }

struct FileState { offset: u64, project: String }

#[derive(Default)]
struct ReportState {
    files: HashMap<PathBuf, FileState>,
    seen: HashSet<String>,
    agg: HashMap<(String, String, String), Usage>, // (date, project, model) -> tokens
}

#[derive(Default)]
pub struct CostReportManager(pub Mutex<ReportState>);

/// Cost buckets across ALL projects. Incremental per file (offset cache) + global
/// message-id dedup, so repeated calls only parse newly-appended bytes.
#[tauri::command]
pub fn cost_report(mgr: State<CostReportManager>) -> Vec<Bucket> {
    let home = match std::env::var_os("HOME") { Some(h) => PathBuf::from(h), None => return vec![] };
    let root = home.join(".claude").join("projects");
    let mut st = mgr.0.lock().unwrap();

    let dirs = match std::fs::read_dir(&root) { Ok(d) => d, Err(_) => return vec![] };
    for d in dirs.flatten() {
        let dpath = d.path();
        if !dpath.is_dir() { continue; }
        let files = match std::fs::read_dir(&dpath) { Ok(f) => f, Err(_) => continue };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) != Some("jsonl") { continue; }
            let len = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);

            if !st.files.contains_key(&p) {
                let project = first_cwd_label(&p)
                    .unwrap_or_else(|| dpath.file_name().and_then(|s| s.to_str()).unwrap_or("—").to_string());
                st.files.insert(p.clone(), FileState { offset: 0, project });
            }
            let (offset, project) = { let fs = &st.files[&p]; (fs.offset, fs.project.clone()) };
            let start = if len < offset { 0 } else { offset }; // shrink → re-read; dedup prevents double count

            if len > start {
                if let Ok(mut fh) = std::fs::File::open(&p) {
                    if fh.seek(SeekFrom::Start(start)).is_ok() {
                        let mut buf = String::new();
                        if fh.take(len - start).read_to_string(&mut buf).is_ok() {
                            if let Some(idx) = buf.rfind('\n') {
                                for line in buf[..idx].lines() {
                                    if let Some((id, model, usage, date)) = parse_turn_full(line) {
                                        if !id.is_empty() && !st.seen.insert(id) { continue; }
                                        let e = st.agg.entry((date, project.clone(), model)).or_default();
                                        e.input += usage.input; e.output += usage.output; e.cache_read += usage.cache_read;
                                        e.cache_write5m += usage.cache_write5m; e.cache_write1h += usage.cache_write1h;
                                    }
                                }
                                st.files.get_mut(&p).unwrap().offset = start + (idx + 1) as u64;
                            }
                        }
                    }
                }
            }
        }
    }
    st.agg.iter().map(|((date, project, model), usage)| Bucket {
        date: date.clone(), project: project.clone(), model: model.clone(), usage: usage.clone(),
    }).collect()
}
```

- [ ] **Step 2: tests** — add to the existing `#[cfg(test)] mod tests`:
```rust
    #[test]
    fn label_from_cwd_takes_last_two_segments() {
        assert_eq!(label_from_cwd("/Users/x/Work/mee-tang/app"), "mee-tang/app");
        assert_eq!(label_from_cwd("/solo"), "solo");
    }

    #[test]
    fn parse_turn_full_extracts_date() {
        let line = r#"{"timestamp":"2026-06-21T10:20:30.000Z","message":{"id":"a","model":"m","usage":{"input_tokens":5,"output_tokens":1,"cache_read_input_tokens":0}}}"#;
        let (id, model, u, date) = parse_turn_full(line).unwrap();
        assert_eq!(id, "a"); assert_eq!(model, "m"); assert_eq!(u.input, 5); assert_eq!(date, "2026-06-21");
    }
```

- [ ] **Step 3: register in `src-tauri/src/lib.rs`:** add `.manage(cost::CostReportManager::default())` next to the other `.manage(...)`; add `cost::cost_report,` to `tauri::generate_handler![...]`.

- [ ] **Step 4:** `cd src-tauri && cargo test` → all pass (incl. 2 new). `cargo build` → exit 0.
- [ ] **Step 5: commit** — `feat(core): cost_report — deduped cost buckets across all projects (date/project/model)`

---

## Task 2: Frontend — client + pure aggregation (TDD) + EChart wrapper

**Files:** modify `src/lib/costClient.ts`; create `src/lib/costAggregate.ts` (+ `costAggregate.test.ts`); create `src/components/EChart.tsx`.

- [ ] **Step 1: `costClient.ts`** — add the Bucket type + command:
```ts
export interface Bucket { date: string; project: string; model: string; usage: Usage }
export function costReport(): Promise<Bucket[]> { return invoke("cost_report"); }
```
(`Usage` is already imported from `./pricing` in this file.)

- [ ] **Step 2: failing test `src/lib/costAggregate.test.ts`:**
```ts
import { describe, it, expect } from "vitest";
import { filterByPeriod, byProject, byModel, byDay, totalCost, tierTokens } from "./costAggregate";
import type { Bucket } from "./costClient";

const U = (input: number, output = 0) => ({ input, output, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
const data: Bucket[] = [
  { date: "2026-06-20", project: "mee-tang/app", model: "claude-opus-4-8", usage: U(1e6) },       // $5
  { date: "2026-06-21", project: "mee-tang/app", model: "claude-opus-4-8", usage: U(0, 1e6) },     // $25
  { date: "2026-06-21", project: "ai-trading-bot", model: "claude-haiku-4-5", usage: U(1e6) },     // $1
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
```

- [ ] **Step 3:** run → fail. **Step 4: implement `src/lib/costAggregate.ts`:**
```ts
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
```

- [ ] **Step 5: `src/components/EChart.tsx`** (tiny wrapper; init once, setOption on change, resize):
```tsx
import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export function EChart({ option, height = 200 }: { option: echarts.EChartsOption; height?: number | string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, []);
  useEffect(() => { chart.current?.setOption(option, true); }, [option]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}
```

- [ ] **Step 6:** vitest green (was 33 → +6 ≈ 39), `npx tsc --noEmit` clean.
- [ ] **Step 7: commit** — `feat(lib): cost report client + period/group aggregation + EChart wrapper`

---

## Task 3: CostView (ECharts) + Mission Control "Cost" tab

**Files:** create `src/components/CostView.tsx`, `src/components/CostView.css`; modify `src/components/Dashboard.tsx` + `Dashboard.css`.

- [ ] **Step 1: `CostView.tsx`:**
```tsx
import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import { costReport, type Bucket } from "../lib/costClient";
import { filterByPeriod, byProject, byModel, byDay, totalCost, tierTokens, type Period } from "../lib/costAggregate";
import { EChart } from "./EChart";
import "./CostView.css";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" }, { id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }, { id: "all", label: "All" },
];
const usd = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(3) : n.toFixed(2)}`;
const PALETTE = ["#F5A623", "#3ECF8E", "#7C9CFF", "#5a6472", "#c06ad6"];
const axis = { axisLine: { lineStyle: { color: "#262A33" } }, axisLabel: { color: "#565d68", fontSize: 10 }, axisTick: { show: false } };
const tip = { backgroundColor: "#181B22", borderColor: "#262A33", textStyle: { color: "#C8CDD6", fontFamily: "ui-monospace, Menlo, monospace" } };
const base = { backgroundColor: "transparent", textStyle: { fontFamily: "ui-monospace, Menlo, monospace" }, animationDuration: 600, animationEasing: "cubicOut" as const };

export function CostView() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [period, setPeriod] = useState<Period>("7d");
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const b = await costReport(); if (alive) setBuckets(b); } catch { /* not under tauri */ } };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const f = useMemo(() => filterByPeriod(buckets, period), [buckets, period]);
  const total = totalCost(f);
  const days = byDay(f), projects = byProject(f), models = byModel(f), tiers = tierTokens(f);
  const projectCount = new Set(f.map((b) => b.project)).size;

  const dailyOpt: echarts.EChartsOption = {
    ...base, grid: { left: 46, right: 14, top: 16, bottom: 24 },
    tooltip: { trigger: "axis", ...tip, valueFormatter: (v) => usd(+(v as number)) },
    xAxis: { type: "category", data: days.map((d) => d.name.slice(5)), ...axis },
    yAxis: { type: "value", axisLabel: { color: "#565d68", fontSize: 10, formatter: (v: number) => `$${v}` }, splitLine: { lineStyle: { color: "#1a1e26" } } },
    series: [{ type: "bar", data: days.map((d) => +d.usd.toFixed(4)),
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "#F5A623" }, { offset: 1, color: "#c9851d" }]), borderRadius: [4, 4, 0, 0] },
      animationDelay: (i: number) => i * 28 }],
  };
  const projOpt: echarts.EChartsOption = {
    ...base, grid: { left: 4, right: 56, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: "axis", ...tip, valueFormatter: (v) => usd(+(v as number)) },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: projects.map((p) => p.name).reverse(), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#C8CDD6", fontSize: 11.5 } },
    series: [{ type: "bar", data: projects.map((p) => +p.usd.toFixed(4)).reverse(), barWidth: 10,
      itemStyle: { color: "#F5A623", borderRadius: [0, 5, 5, 0] },
      label: { show: true, position: "right", formatter: (p: { value: number }) => usd(+p.value), color: "#EDEFF3", fontSize: 11 } }],
  };
  const modelOpt: echarts.EChartsOption = {
    ...base, color: PALETTE,
    tooltip: { trigger: "item", ...tip, valueFormatter: (v) => usd(+(v as number)) },
    legend: { orient: "vertical", right: 4, top: "center", textStyle: { color: "#C8CDD6", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }, icon: "roundRect" },
    series: [{ type: "pie", radius: ["56%", "82%"], center: ["32%", "50%"], data: models.map((m) => ({ name: m.name.replace("claude-", ""), value: +m.usd.toFixed(4) })),
      label: { show: false }, itemStyle: { borderColor: "#0E1014", borderWidth: 2 } }],
  };

  const tierTotal = tiers.cacheRead + tiers.input + tiers.cacheWrite + tiers.output || 1;
  const pct = (n: number) => (n / tierTotal) * 100;

  return (
    <div className="cost">
      <div className="cost__head">
        <div>
          <p className="cost__eyebrow">Total spend · {PERIODS.find((p) => p.id === period)!.label.toLowerCase()}</p>
          <div className="cost__total">{usd(total)}</div>
          <p className="cost__sub">across {projectCount} project{projectCount === 1 ? "" : "s"}</p>
        </div>
        <div className="cost__tabs">
          {PERIODS.map((p) => (
            <button key={p.id} className={period === p.id ? "on" : ""} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="cost__card">
        <h4>Daily spend</h4>
        <EChart option={dailyOpt} height={180} />
      </div>

      <div className="cost__grid">
        <div className="cost__card"><h4>By project</h4><EChart option={projOpt} height={Math.max(120, projects.length * 30)} /></div>
        <div className="cost__card"><h4>By model</h4><EChart option={modelOpt} height={150} /></div>
      </div>

      <div className="cost__card">
        <h4>Where the tokens go</h4>
        <div className="cost__stack">
          <span style={{ width: `${pct(tiers.cacheRead)}%`, background: "#3a4150" }} />
          <span style={{ width: `${pct(tiers.input)}%`, background: "#5a6472" }} />
          <span style={{ width: `${pct(tiers.cacheWrite)}%`, background: "#7C9CFF" }} />
          <span style={{ width: `${pct(tiers.output)}%`, background: "#F5A623" }} />
        </div>
        <div className="cost__tiers">
          <span><i style={{ background: "#3a4150" }} />cache read {pct(tiers.cacheRead).toFixed(0)}%</span>
          <span><i style={{ background: "#5a6472" }} />input {pct(tiers.input).toFixed(0)}%</span>
          <span><i style={{ background: "#7C9CFF" }} />cache write {pct(tiers.cacheWrite).toFixed(0)}%</span>
          <span><i style={{ background: "#F5A623" }} />output {pct(tiers.output).toFixed(0)}%</span>
        </div>
      </div>
      <p className="cost__foot">Computed from ~/.claude logs · deduped by message id · matches /cost · prices editable</p>
    </div>
  );
}
```

- [ ] **Step 2: `CostView.css`** (HUD; reuse the cockpit palette):
```css
.cost { color: #C8CDD6; font-family: ui-monospace, Menlo, monospace; }
.cost__head { display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap; padding-bottom: 18px; margin-bottom: 18px; border-bottom: 1px solid #262A33; }
.cost__eyebrow { margin: 0 0 8px; font-size: 10px; letter-spacing: 0.28em; text-transform: uppercase; color: #6B7280; }
.cost__total { font-size: clamp(34px, 6vw, 52px); font-weight: 700; line-height: 0.9; color: #EDEFF3; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.cost__sub { margin: 9px 0 0; font-size: 12px; color: #6B7280; }
.cost__tabs { margin-left: auto; display: flex; gap: 2px; background: #181B22; border: 1px solid #262A33; border-radius: 9px; padding: 3px; }
.cost__tabs button { font-family: inherit; font-size: 12px; color: #6B7280; background: transparent; border: 0; border-radius: 6px; padding: 7px 13px; cursor: pointer; }
.cost__tabs button.on { background: #F5A623; color: #1a1206; font-weight: 700; }
.cost__tabs button:not(.on):hover { color: #C8CDD6; }
.cost__card { background: #0E1014; border: 1px solid #262A33; border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; }
.cost__card h4 { margin: 0 0 10px; font-size: 12.5px; font-weight: 700; color: #EDEFF3; }
.cost__grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; }
@media (max-width: 760px) { .cost__grid { grid-template-columns: 1fr; } }
.cost__stack { display: flex; height: 28px; border-radius: 7px; overflow: hidden; border: 1px solid #262A33; }
.cost__stack span { height: 100%; }
.cost__tiers { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; font-size: 11.5px; color: #6B7280; }
.cost__tiers span { display: flex; align-items: center; gap: 7px; }
.cost__tiers i { width: 10px; height: 10px; border-radius: 3px; }
.cost__foot { margin-top: 18px; color: #565d68; font-size: 11px; }
```

- [ ] **Step 3: Dashboard tab.** In `Dashboard.tsx`: add `import { CostView } from "./CostView";` and a view state `const [view, setView] = useState<"sessions" | "cost">("sessions");`. In the `.cockpit-dash__ribbon`, AFTER `.cockpit-dash__brand`, insert a tab switcher:
```tsx
        <div className="cockpit-dash__viewtabs">
          <button className={view === "sessions" ? "on" : ""} onClick={() => setView("sessions")}>Sessions</button>
          <button className={view === "cost" ? "on" : ""} onClick={() => setView("cost")}>Cost</button>
        </div>
```
  Wrap the existing readout (`.cockpit-dash__readout`) and the `.cockpit-dash__grid` so they render only when `view === "sessions"`; when `view === "cost"`, render `<CostView />` instead of the grid (the readout can stay sessions-only). Keep all session logic intact.

- [ ] **Step 4: `Dashboard.css`** — add the viewtabs style:
```css
.cockpit-dash__viewtabs { display: flex; gap: 2px; background: #181B22; border: 1px solid #262A33; border-radius: 9px; padding: 3px; }
.cockpit-dash__viewtabs button { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #6B7280; background: transparent; border: 0; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
.cockpit-dash__viewtabs button.on { background: #F5A623; color: #1a1206; font-weight: 700; }
.cockpit-dash__viewtabs button:not(.on):hover { color: #C8CDD6; }
```
  (Place the viewtabs between the brand and the readout; the readout keeps `margin-left:auto` so it stays right-aligned in Sessions view.)

- [ ] **Step 5:** `npx tsc --noEmit` clean; `npm test` green; `npm run build` (vite) succeeds (echarts bundles). Do NOT run tauri dev.
- [ ] **Step 6: commit** — `feat(ui): Cost analytics tab in Mission Control (ECharts daily/project/model/tier)`

---

## Task 4: GUI verification (owner)

- [ ] `npm run tauri dev` (Rust changed → recompiles):
1. ⌘0 → Mission Control → click **Cost** tab. Charts render with real data across all your repos: daily-spend bars (animate up), by-project bars, by-model donut, tier breakdown. Big total matches the period.
2. Switch period Today / 7d / 30d / All → all charts + total update.
3. Sanity: the All total ≈ sum of your sessions' `/cost`; per-project bars look right.
4. Switch back to **Sessions** tab → bays still work; jump/focus/pop-out/drag/resize unaffected.

Report pass/fail + whether totals look right.

- [ ] **Wrap-up:** update SPEC.md (cost analytics done); commit `docs: M6 cost analytics done`.

---

## Self-review
**Spec coverage:** all-projects cost (Task 1 scan), charts (Task 3 ECharts), period filter + groupings priced via editable table (Task 2), tab in Mission Control (Task 3). Dedup + cache-tier pricing preserved (reuses `usage_from` + `costOf`).
**Placeholder scan:** none.
**Type consistency:** Rust `Bucket{date,project,model,usage}` (camelCase) == TS `Bucket`; `cost_report()` == `costReport()`; `Period`, `Slice`, `TierTokens`, `byDay/byProject/byModel/totalCost/tierTokens` consistent CostView↔costAggregate; `EChart{option,height}`.
**Perf:** incremental per-file offset + global dedup → repeat calls cheap; first call parses all logs once (acceptable on open; refresh every 5s only reads new bytes).
**Known caveats:** date = UTC date slice of `timestamp` (period buckets are UTC-day, can differ from local near midnight); server-tool (web search/fetch) costs still omitted; price editor UI still future.
