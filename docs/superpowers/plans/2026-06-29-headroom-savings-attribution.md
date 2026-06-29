# Headroom Savings — Plan 2: Attribution Data Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute how many tokens / how much USD the Headroom proxy saved **per Session**, by tailing the proxy's request log and attributing each request to the one routed Session that was working when it happened (else an Unattributed bucket).

**Architecture:** A Rust tailer (modeled on `logtail.rs`) follows `~/.headroom/logs/cockpit-proxy.jsonl` and emits each new JSONL record to the webview. A TS store (modeled on `usageStore.ts`) samples which Headroom-routed panes are *working* over time, and when a proxy record arrives it attributes the record's savings to the unique routed+working pane at that record's timestamp — accumulating per-pane totals plus an **Unattributed** bucket. A minimal Dashboard readout makes it visible (full variant-B styling is Plan 3). The proxy log carries NO session id, so attribution is time-correlation by design (see ADR 0010 / the smoke-test findings note in the Plan 1 doc).

**Tech Stack:** Rust (Tauri command + file-tail thread), TypeScript/React (pub-sub store + hook), Vitest.

## Global Constraints

- **Real proxy-log JSONL fields** (verified live — do NOT assume `tokens_before`/`tokens_after`): each request line has `timestamp` (ISO-8601 string), `model`, `input_tokens_original`, `input_tokens_optimized`, `tokens_saved`, `savings_percent`, `cache_hit` (bool), plus others. Non-request lines may lack these — skip any line missing `tokens_saved`.
- **Proxy log path:** `~/.headroom/logs/cockpit-proxy.jsonl` (this is the `--log-file` Cockpit's `headroom_ensure` already passes). Resolve `~` from `$HOME`.
- **`cache` mode means `tokens_saved` is ~0 for most requests** — the win shows up as `cache_hit`. The readout shows BOTH `tokens_saved` and `cache_hit` count (decided 2026-06-29); do not present token-savings as the only metric.
- **Attribution rule** (from grill Q3/Q4): attribute a record to the **unique** Headroom-routed pane that was in its `working` state at the record's timestamp. If zero or two-plus routed panes were working then → the **Unattributed** bucket. Never guess.
- **Prices are USD per 1,000,000 tokens** (`pricing.ts` `DEFAULT_PRICES`). Value saved tokens at the model's `input` rate: `usd = tokensSaved * price.input / 1e6`.
- Existing patterns to follow exactly: `src-tauri/src/logtail.rs` (tail thread), `src/lib/usageStore.ts` (singleton pub-sub + `useXxx` hook), `src/lib/terminalRegistry.ts` working-state (`paneLastLineAt`, `anyPaneWorking`).
- Test runner: `npm test` (Vitest). Rust: `cargo build` in `src-tauri/`. PTY/tail/GUI bits are verified manually (steps say so).

---

### Task 1: Rust — tail the proxy log and emit records

A single file-tail thread that follows the proxy log and emits each new line to the webview.

**Files:**
- Create: `src-tauri/src/headroomlog.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod headroomlog;`, manage state, register 2 commands)

**Interfaces:**
- Produces: command `headroom_log_start() -> Result<(), String>` — idempotent; starts a thread tailing `~/.headroom/logs/cockpit-proxy.jsonl`, emitting each new non-empty line on the `headroom://log` event. From the CURRENT end of the file (don't replay history on start).
- Produces: command `headroom_log_stop()`.
- Produces: `pub struct HeadroomLogManager(pub Mutex<Option<Arc<AtomicBool>>>)` with `Default`.
- Produces: event name `headroom://log` (payload = one JSONL line string).

- [ ] **Step 1: Write `headroomlog.rs`**

Create `src-tauri/src/headroomlog.rs`:

```rust
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct HeadroomLogManager(pub Mutex<Option<Arc<AtomicBool>>>);

fn log_path() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(|h| PathBuf::from(h).join(".headroom/logs/cockpit-proxy.jsonl"))
}

/// Tail the proxy log from its CURRENT end, emitting each new line on `headroom://log`.
/// Idempotent: a second call stops the previous tailer first.
#[tauri::command]
pub fn headroom_log_start(app: AppHandle, mgr: State<HeadroomLogManager>) -> Result<(), String> {
    if let Some(prev) = mgr.0.lock().unwrap().take() {
        prev.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    *mgr.0.lock().unwrap() = Some(stop.clone());
    let path = log_path().ok_or("no HOME dir")?;

    std::thread::spawn(move || {
        // Start at the current end so we only attribute requests from this session on.
        let mut offset: u64 = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        while !stop.load(Ordering::Relaxed) {
            if let Ok(meta) = std::fs::metadata(&path) {
                let len = meta.len();
                // The proxy may rotate/recreate the file (len shrinks) — reset to its start.
                if len < offset {
                    offset = 0;
                }
                if len > offset {
                    if let Ok(mut f) = std::fs::File::open(&path) {
                        let _ = f.seek(SeekFrom::Start(offset));
                        for line in BufReader::new(&mut f).lines().map_while(Result::ok) {
                            if !line.trim().is_empty() {
                                let _ = app.emit("headroom://log", line);
                            }
                        }
                        offset = len;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn headroom_log_stop(mgr: State<HeadroomLogManager>) {
    if let Some(stop) = mgr.0.lock().unwrap().take() {
        stop.store(true, Ordering::Relaxed);
    }
}
```

- [ ] **Step 2: Register in lib.rs**

In `src-tauri/src/lib.rs`: add `mod headroomlog;` next to the other `mod` lines; add `.manage(headroomlog::HeadroomLogManager::default())` to the `.manage(...)` chain; add `headroomlog::headroom_log_start,` and `headroomlog::headroom_log_stop,` to the `generate_handler![...]` list.

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`
Expected: compiles clean (warnings only if pre-existing in other modules).

- [ ] **Step 4: Manual verification (tail can't be unit-tested headlessly)**

1. `npm run tauri dev`; in devtools console: `await window.__TAURI__.core.invoke('headroom_ensure'); await window.__TAURI__.core.invoke('headroom_log_start')`.
2. `window.__TAURI__.event.listen('headroom://log', e => console.log('HRLOG', e.payload))`.
3. Toggle a pane's HR on and send a prompt → console logs `HRLOG {...}` JSONL lines.
Note the result in the commit message; do NOT fake an automated test for the tail thread.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/headroomlog.rs src-tauri/src/lib.rs
git commit -m "feat(headroom): tail the proxy request log + emit records to the webview"
```

---

### Task 2: TS — `headroomLogClient.ts`

**Files:**
- Create: `src/lib/headroomLogClient.ts`

**Interfaces:**
- Consumes: commands `headroom_log_start` / `headroom_log_stop` (Task 1), event `headroom://log` (Task 1).
- Produces: `startHeadroomLog(): Promise<void>`, `stopHeadroomLog(): Promise<void>`, `onHeadroomLog(cb: (line: string) => void): Promise<UnlistenFn>`.

- [ ] **Step 1: Write the client**

Create `src/lib/headroomLogClient.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function startHeadroomLog(): Promise<void> { return invoke("headroom_log_start"); }
export function stopHeadroomLog(): Promise<void> { return invoke("headroom_log_stop"); }
export function onHeadroomLog(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>("headroom://log", (e) => cb(e.payload));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/headroomLogClient.ts
git commit -m "feat(headroom): headroomLogClient wrapper"
```

---

### Task 3: TS — `savings.ts` pure core (parse + value + attribute + aggregate) [TDD]

The testable heart: parse a proxy record, value its savings, attribute it to a pane by time, and fold it into totals. All pure, all unit-tested.

**Files:**
- Create: `src/lib/savings.ts`
- Test: `src/lib/savings.test.ts`

**Interfaces:**
- Consumes: `loadPrices`, `type ModelPrice` from `./pricing`.
- Produces:
  - `interface ProxyRecord { ts: number; model: string; tokensSaved: number; cacheHit: boolean; savingsPercent: number }`
  - `interface WorkingSample { t: number; paneIds: string[] }`
  - `interface Totals { tokensSaved: number; requests: number; cacheHits: number; usd: number }`
  - `parseRecord(line: string): ProxyRecord | null`
  - `savedUsd(tokensSaved: number, model: string, prices?: Record<string, ModelPrice>): number`
  - `attribute(ts: number, history: WorkingSample[], toleranceMs?: number): string | null`
  - `emptyTotals(): Totals`
  - `addRecord(t: Totals, r: ProxyRecord, prices?: Record<string, ModelPrice>): Totals`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/savings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseRecord, savedUsd, attribute, emptyTotals, addRecord } from "./savings";

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
});

describe("savedUsd", () => {
  it("values saved tokens at the model's input rate (USD per 1M)", () => {
    expect(savedUsd(400_000, "claude-opus-4-8", PRICES)).toBeCloseTo(2.0, 6); // 400k * $5/1M
  });
  it("falls back to opus pricing for an unknown model", () => {
    expect(savedUsd(1_000_000, "mystery-model", PRICES)).toBeGreaterThan(0);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- savings`
Expected: FAIL — module `./savings` has no such exports.

- [ ] **Step 3: Implement `savings.ts`**

Create `src/lib/savings.ts`:

```typescript
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- savings`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/savings.ts src/lib/savings.test.ts
git commit -m "feat(savings): pure proxy-record parse + value + time-attribution + totals"
```

---

### Task 4: TS — `routedWorkingPaneIds` in the terminal registry

The attribution candidate set: panes that are BOTH Headroom-routed AND currently working. Only routed panes hit the proxy, so only they can own a proxy record.

**Files:**
- Modify: `src/lib/terminalRegistry.ts` (track a routed-pane set; add an exported selector)

**Interfaces:**
- Consumes: nothing new.
- Produces: `routedWorkingPaneIds(now: number, graceMs?: number): string[]` — pane ids that are Headroom-routed and emitted output within `graceMs`.

- [ ] **Step 1: Track the routed set**

In `src/lib/terminalRegistry.ts`, add a module-level set near the `registry` map:

```typescript
/** Pane ids currently routed through the Headroom proxy (HR on). Maintained here so
 *  savings attribution knows which working panes are even candidates (only routed panes
 *  hit the proxy). Updated by acquireTerminal (initial flag) and setPaneHeadroom (toggle). */
const routed = new Set<string>();
```

In `acquireTerminal`, right after `if (existing) return existing;` is passed (i.e., at the top where it sets up a new pane) AND on every call, reconcile the flag — simplest: at the start of `acquireTerminal`, add:

```typescript
  if (headroom) routed.add(paneId); else routed.delete(paneId);
```

In `setPaneHeadroom`, after computing it relaunches, set the flag from `on`:

```typescript
  if (on) routed.add(paneId); else routed.delete(paneId);
```

In `releaseTerminal`, add `routed.delete(paneId);` next to `registry.delete(paneId)`.

- [ ] **Step 2: Add the selector**

Add near `anyPaneWorking`:

```typescript
/** Headroom-routed panes that emitted output within `graceMs` (i.e. working now).
 *  The candidate set for attributing a proxy savings record to a Session. */
export function routedWorkingPaneIds(now: number, graceMs = 2000): string[] {
  const out: string[] = [];
  for (const id of routed) {
    const t = registry.get(id)?.lastLineAt.current;
    if (t != null && now - t < graceMs) out.push(id);
  }
  return out;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` (expect only pre-existing unrelated noise; `terminalRegistry.ts` clean) and `npm test` (existing suites still pass).

- [ ] **Step 4: Commit**

```bash
git add src/lib/terminalRegistry.ts
git commit -m "feat(terminal): track routed panes + routedWorkingPaneIds selector for attribution"
```

---

### Task 5: TS — `savingsStore.ts` (sample working history, ingest records, accumulate)

The live store: samples the routed+working set on a tick into a short history, listens to proxy records, attributes + accumulates per-pane totals + Unattributed, and exposes a hook.

**Files:**
- Create: `src/lib/savingsStore.ts`

**Interfaces:**
- Consumes: `startHeadroomLog`, `onHeadroomLog` (Task 2); `routedWorkingPaneIds` (Task 4); `parseRecord`, `attribute`, `emptyTotals`, `addRecord`, `type Totals`, `type WorkingSample` (Task 3).
- Produces: `interface SavingsState { byPane: Record<string, Totals>; unattributed: Totals }`, `useSavings(): SavingsState`.

- [ ] **Step 1: Write the store**

Create `src/lib/savingsStore.ts`:

```typescript
import { useEffect, useState } from "react";
import { startHeadroomLog, onHeadroomLog } from "./headroomLogClient";
import { routedWorkingPaneIds } from "./terminalRegistry";
import { parseRecord, attribute, emptyTotals, addRecord, type Totals, type WorkingSample } from "./savings";

export interface SavingsState { byPane: Record<string, Totals>; unattributed: Totals }

let state: SavingsState = { byPane: {}, unattributed: emptyTotals() };
const subs = new Set<(s: SavingsState) => void>();
function emit() { const snap = state; for (const fn of subs) fn(snap); }

// Rolling history of which routed panes were working, sampled on a tick. A proxy record
// is attributed against the sample nearest its own timestamp (handles tail latency).
const history: WorkingSample[] = [];
const HISTORY_MS = 120_000;
const SAMPLE_MS = 500;

let started = false;
function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  setInterval(() => {
    const now = Date.now();
    history.push({ t: now, paneIds: routedWorkingPaneIds(now) });
    while (history.length && now - history[0].t > HISTORY_MS) history.shift();
  }, SAMPLE_MS);

  void startHeadroomLog();
  void onHeadroomLog((line) => {
    const r = parseRecord(line);
    if (!r) return;
    const paneId = attribute(r.ts || Date.now(), history);
    if (paneId) {
      state = { ...state, byPane: { ...state.byPane, [paneId]: addRecord(state.byPane[paneId] ?? emptyTotals(), r) } };
    } else {
      state = { ...state, unattributed: addRecord(state.unattributed, r) };
    }
    emit();
  });
}

/** Subscribe a component to the live per-Session savings totals. */
export function useSavings(): SavingsState {
  const [s, setS] = useState<SavingsState>(state);
  useEffect(() => {
    start();
    subs.add(setS);
    setS(state);
    return () => { subs.delete(setS); };
  }, []);
  return s;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — `savingsStore.ts` must be clean (pre-existing unrelated noise ok).

- [ ] **Step 3: Commit**

```bash
git add src/lib/savingsStore.ts
git commit -m "feat(savings): live store — sample working history, attribute proxy records, accumulate"
```

---

### Task 6: Minimal Dashboard "Savings" readout (verification surface)

A small, real readout so the data layer is visible and verifiable end-to-end. Full variant-B styling/per-Session-title join is Plan 3 — keep this minimal but functional.

**Files:**
- Modify: `src/components/Dashboard.tsx` (render a minimal Savings block from `useSavings()`)

**Interfaces:**
- Consumes: `useSavings()` (Task 5).

- [ ] **Step 1: Read the file first**

Read `src/components/Dashboard.tsx` to see how it composes sections (it hosts `CostView`). Mirror that structure — add a sibling block, do not restructure.

- [ ] **Step 2: Add the readout**

In `src/components/Dashboard.tsx`, import `useSavings` and render a block that lists, for each paneId in `byPane`, a row with `tokensSaved.toLocaleString()` tokens · `cacheHits`/`requests` cache hits · `$usd.toFixed(2)`, plus an "Unattributed" row from `unattributed`. Use the existing dashboard section/heading classes (read them in Step 1); a plain `<table>`/`<div>` list is fine for this verification pass. Show a "No Headroom activity yet" line when `requests` are all zero.

- [ ] **Step 3: Build + tests**

Run: `npm run build` (must be clean) and `npm test` (existing suites pass; the 3 pre-existing `persistence.test.ts` failures are unrelated — note, don't fix).

- [ ] **Step 4: Manual verification (full pipeline)**

1. `npm run tauri dev`; open a pane, toggle HR on, send a few prompts (let turns finish).
2. Open the Dashboard → the Savings block shows that pane's row with rising `requests` and `cache hits` (tokens_saved likely ~0 in cache mode — expected).
3. Open a SECOND pane (HR on) and prompt both at once → some requests land in **Unattributed** (concurrent working).

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard.tsx
git commit -m "feat(savings): minimal per-Session savings readout in the Dashboard"
```

---

## Self-Review

- **Spec coverage:** Tail proxy log → Task 1. Real field names → Global Constraints + Task 3 `parseRecord`. Attribute to unique working routed pane / Unattributed → Task 3 `attribute` + Task 4 `routedWorkingPaneIds` + Task 5 store. Per-Session totals (tokens, requests, cache hits, $) → Task 3 `Totals`/`addRecord` + Task 6 readout. cache-mode shows BOTH cache_hit + tokens_saved → Task 6. $ via input rate (USD/1M) → Task 3 `savedUsd`. **Deferred to Plan 3:** full variant-B per-Session table joined with pane titles/cwd, styling, savings_percent display, history/time-range.
- **Placeholder scan:** Tasks 1–5 carry full code. Task 6 Step 2 is prose ("mirror the dashboard section structure") because the exact JSX depends on `Dashboard.tsx` classes not yet read — flagged with "read the file first", not a silent TODO.
- **Type consistency:** `ProxyRecord`/`WorkingSample`/`Totals`, `parseRecord`/`savedUsd`/`attribute`/`emptyTotals`/`addRecord`, `routedWorkingPaneIds`, `SavingsState`/`useSavings`, event `headroom://log`, commands `headroom_log_start`/`headroom_log_stop` — consistent across tasks. `attribute` tolerance default 4000ms; history sample 500ms / 120s retention.

## Follow-on

- **Plan 3 — Dashboard polish:** join `byPane` keys → pane title/cwd from the layout, full variant-B table (tokens · %lost · ≈$ · #requests · cache-hit rate) beside Cost, the Unattributed row styled, and a one-time hint that token-level savings need `token` mode. Decide retention/reset (per-app-run vs persisted).
