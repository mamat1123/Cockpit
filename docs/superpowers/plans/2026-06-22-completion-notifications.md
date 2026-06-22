# Completion Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the user across five surfaces (macOS notification, sound, in-app toast, tab badge, and an always-on-top Beacon window) the moment a Claude Session finishes its turn.

**Architecture:** A Completion is detected from each pane's already-streaming jsonl transcript (`onLogLine`) by spotting an assistant message that ended the turn (`stop_reason: "end_turn"`), with a freshness guard so resumed-session backfill never fires. A `useCompletionNotifier` hook in the main window owns detection and pushes to an in-memory notification store; the store drives the bell, tab badges, toast, OS notification, and a second always-on-top Tauri window (the Beacon) that mirrors state over Tauri events and jumps back on click.

**Tech Stack:** React 19, TypeScript, Vitest + jsdom, Tauri 2 (Rust), `@tauri-apps/plugin-notification`, xterm.js (existing).

## Global Constraints

- **Branch first:** currently on `main`. Create and work on `feat/completion-notifications`. Commit per task.
- **Theme tokens, not hex:** all component colors use the existing CSS vars from `applyTheme` (`themes.ts`): `--ck-accent` (amber/working), `--ck-idle` (mint/done), `--ck-bg`, `--ck-surface`, `--ck-surface-2`, `--ck-text`, `--ck-bright`, `--ck-muted`, `--ck-dim`, `--ck-border`. Never hardcode `#F5A623` etc. **Sole exception:** the Beacon window (Task 11) does not run `applyTheme`, so it uses `var(--ck-*, <amber-hud fallback>)` — the token first, an amber-hud hex only as the fallback. This is intentional and scoped to `Beacon.css`; nowhere else may hardcode hex.
- **Do not touch** the existing working/idle signal (`paneState.ts`, the polling in `Juice.tsx` and `TabBar.tsx`) — Completion detection is additive (ADR 0007).
- **Tests:** Vitest, files named `*.test.ts` next to source, `npm test` runs `vitest run` (see `package.json`).
- **Notification settings are nested:** `sound` only applies when `os` is on; the master `enabled` gates all.
- **No history persistence:** the notification store is in-memory only.
- Spec: `docs/superpowers/specs/2026-06-22-completion-notifications-design.md`. Decisions: ADR 0007, ADR 0008. Glossary: `CONTEXT.md`.

---

### Task 1: Transcript schema spike + capture fixtures

Confirm the real shape of a Claude Code transcript line before building the parser (the risk ADR 0007 calls out). Capture real lines as test fixtures.

**Files:**
- Create: `src/lib/__fixtures__/transcriptLines.ts`

- [ ] **Step 1: Find a real session log and inspect an assistant turn-end line**

Run:
```bash
ls -t ~/.claude/projects/*/*.jsonl | head -1
```
Then inspect the last assistant lines of that file:
```bash
F=$(ls -t ~/.claude/projects/*/*.jsonl | head -1); grep '"type":"assistant"' "$F" | tail -3 | python3 -m json.tool 2>/dev/null | head -60 || (grep '"type":"assistant"' "$F" | tail -1)
```
Confirm and write down: (a) the `type` value for assistant lines, (b) where `stop_reason` lives (expected: `message.stop_reason`), (c) the values seen (`end_turn`, `tool_use`, etc.), (d) the `timestamp` field name and format (expected ISO 8601 at top level).

- [ ] **Step 2: Capture representative lines into a fixtures file**

Using the real shapes confirmed above, create `src/lib/__fixtures__/transcriptLines.ts`. If the real shape differs from below, use the REAL shape and note the difference in a comment.

```ts
// Representative Claude Code transcript lines, captured from a real session log
// on 2026-06-22 (Task 1 spike). Used by completion.test.ts.
// `timestamp` is ISO 8601; `message.stop_reason` distinguishes turn-end from mid-loop.

/** Assistant message that ENDED the turn — this is a Completion. */
export const ASSISTANT_END_TURN = JSON.stringify({
  type: "assistant",
  timestamp: "2026-06-22T08:30:00.000Z",
  message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] },
});

/** Assistant message mid-loop (about to call a tool) — NOT a Completion. */
export const ASSISTANT_TOOL_USE = JSON.stringify({
  type: "assistant",
  timestamp: "2026-06-22T08:30:00.000Z",
  message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", name: "Bash", input: {} }] },
});

/** A user line — NOT a Completion. */
export const USER_LINE = JSON.stringify({
  type: "user",
  timestamp: "2026-06-22T08:29:00.000Z",
  message: { role: "user", content: "fix the bug" },
});

/** Malformed / non-JSON line. */
export const GARBAGE = "not json {";
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/__fixtures__/transcriptLines.ts
git commit -m "chore: capture Claude transcript fixtures for completion parser (schema spike)"
```

---

### Task 2: `parseTurnEnd` — the Completion detector core

**Files:**
- Create: `src/lib/completion.ts`
- Test: `src/lib/completion.test.ts`

**Interfaces:**
- Consumes: fixtures from Task 1.
- Produces: `parseTurnEnd(line: string, nowMs: number, freshnessMs?: number): { at: number } | null` — returns `{ at }` (ms epoch of the turn end) when `line` is a *fresh* assistant turn-end, else `null`. Default `freshnessMs = 8000`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseTurnEnd } from "./completion";
import { ASSISTANT_END_TURN, ASSISTANT_TOOL_USE, USER_LINE, GARBAGE } from "./__fixtures__/transcriptLines";

const at = Date.parse("2026-06-22T08:30:00.000Z");

describe("parseTurnEnd", () => {
  it("returns the timestamp for a fresh end_turn assistant line", () => {
    expect(parseTurnEnd(ASSISTANT_END_TURN, at + 1000)).toEqual({ at });
  });
  it("returns null for a tool_use (mid-loop) line", () => {
    expect(parseTurnEnd(ASSISTANT_TOOL_USE, at + 1000)).toBeNull();
  });
  it("returns null for a user line", () => {
    expect(parseTurnEnd(USER_LINE, at + 1000)).toBeNull();
  });
  it("returns null for a stale end_turn (backfill from a resumed session)", () => {
    expect(parseTurnEnd(ASSISTANT_END_TURN, at + 60_000)).toBeNull();
  });
  it("returns null for malformed JSON", () => {
    expect(parseTurnEnd(GARBAGE, at)).toBeNull();
  });
  it("treats stop_sequence and max_tokens as turn-end", () => {
    const mk = (sr: string) => JSON.stringify({ type: "assistant", timestamp: "2026-06-22T08:30:00.000Z", message: { stop_reason: sr } });
    expect(parseTurnEnd(mk("stop_sequence"), at + 100)).toEqual({ at });
    expect(parseTurnEnd(mk("max_tokens"), at + 100)).toEqual({ at });
  });
  it("returns null when stop_reason is missing or null (partial write)", () => {
    const line = JSON.stringify({ type: "assistant", timestamp: "2026-06-22T08:30:00.000Z", message: { stop_reason: null } });
    expect(parseTurnEnd(line, at + 100)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- completion`
Expected: FAIL — `parseTurnEnd is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/completion.ts
const TURN_END = new Set(["end_turn", "stop_sequence", "max_tokens"]);

/** Detect a *fresh* assistant turn-end in a transcript line. Returns `{ at }` (ms epoch
 *  of the turn end) or null. Stale lines (older than `freshnessMs`) are rejected so a
 *  resumed session's backfilled history never fires a Completion (ADR 0007). */
export function parseTurnEnd(line: string, nowMs: number, freshnessMs = 8000): { at: number } | null {
  let v: any;
  try { v = JSON.parse(line); } catch { return null; }
  if (!v || v.type !== "assistant") return null;
  const sr = v.message?.stop_reason;
  if (typeof sr !== "string" || !TURN_END.has(sr)) return null;
  const ts = typeof v.timestamp === "string" ? Date.parse(v.timestamp) : NaN;
  if (Number.isNaN(ts)) return null;
  if (nowMs - ts >= freshnessMs) return null;
  return { at: ts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- completion`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/completion.ts src/lib/completion.test.ts
git commit -m "feat: parseTurnEnd — detect a fresh Completion from a transcript line"
```

---

### Task 3: Notification store + unseen aggregation

**Files:**
- Create: `src/lib/notifications.ts`
- Test: `src/lib/notifications.test.ts`

**Interfaces:**
- Produces:
  - `interface Completion { id: string; paneId: string; sessionId: string; tabId: string; name: string; project: string; at: number; seen: boolean }`
  - `createNotificationStore()` → `{ push, list, markTabSeen, markAllSeen, clear, subscribe }`
    - `push(c: Omit<Completion, "id" | "seen">, seen: boolean): Completion`
    - `list(): Completion[]` (newest first, capped 50)
    - `markTabSeen(tabId: string): void`
    - `markAllSeen(): void`
    - `clear(): void`
    - `subscribe(cb: () => void): () => void`
  - `unseenByTab(entries: Completion[]): Map<string, number>`
  - `totalUnseen(entries: Completion[]): number`
  - A module singleton `notifications = createNotificationStore()`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createNotificationStore, unseenByTab, totalUnseen, type Completion } from "./notifications";

const base = { paneId: "p1", sessionId: "s1", tabId: "t1", name: "fix-bug", project: "web", at: 1000 };

describe("notification store", () => {
  it("push returns an entry with an id and the given seen flag; list is newest-first", () => {
    const s = createNotificationStore();
    const a = s.push({ ...base, at: 1 }, false);
    const b = s.push({ ...base, paneId: "p2", at: 2 }, false);
    expect(a.id).toBeTruthy();
    expect(s.list().map((e) => e.paneId)).toEqual(["p2", "p1"]);
    expect(b.seen).toBe(false);
  });
  it("markTabSeen flips seen for that tab only", () => {
    const s = createNotificationStore();
    s.push({ ...base, tabId: "t1" }, false);
    s.push({ ...base, tabId: "t2" }, false);
    s.markTabSeen("t1");
    expect(totalUnseen(s.list())).toBe(1);
    expect(unseenByTab(s.list()).get("t1") ?? 0).toBe(0);
    expect(unseenByTab(s.list()).get("t2")).toBe(1);
  });
  it("markAllSeen clears everything; clear empties the list", () => {
    const s = createNotificationStore();
    s.push(base, false); s.push({ ...base, tabId: "t2" }, false);
    s.markAllSeen();
    expect(totalUnseen(s.list())).toBe(0);
    s.clear();
    expect(s.list()).toEqual([]);
  });
  it("caps history at 50 entries", () => {
    const s = createNotificationStore();
    for (let i = 0; i < 60; i++) s.push({ ...base, at: i }, false);
    expect(s.list().length).toBe(50);
  });
  it("subscribe fires on push and unsubscribe stops it", () => {
    const s = createNotificationStore();
    let n = 0; const off = s.subscribe(() => n++);
    s.push(base, false); expect(n).toBe(1);
    off(); s.push(base, false); expect(n).toBe(1);
  });
});

describe("aggregation helpers", () => {
  it("unseenByTab counts only unseen, grouped by tab", () => {
    const e: Completion[] = [
      { id: "1", ...base, tabId: "t1", seen: false },
      { id: "2", ...base, tabId: "t1", seen: true },
      { id: "3", ...base, tabId: "t2", seen: false },
    ];
    const m = unseenByTab(e);
    expect(m.get("t1")).toBe(1);
    expect(m.get("t2")).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- notifications`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/notifications.ts
export interface Completion {
  id: string; paneId: string; sessionId: string; tabId: string;
  name: string; project: string; at: number; seen: boolean;
}

const CAP = 50;

export function unseenByTab(entries: Completion[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) if (!e.seen) m.set(e.tabId, (m.get(e.tabId) ?? 0) + 1);
  return m;
}
export function totalUnseen(entries: Completion[]): number {
  return entries.reduce((n, e) => n + (e.seen ? 0 : 1), 0);
}

export function createNotificationStore() {
  let entries: Completion[] = []; // newest first
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((cb) => cb());
  let seq = 0;
  return {
    push(c: Omit<Completion, "id" | "seen">, seen: boolean): Completion {
      const entry: Completion = { ...c, id: `${c.paneId}:${c.at}:${++seq}`, seen };
      entries = [entry, ...entries].slice(0, CAP);
      emit();
      return entry;
    },
    list(): Completion[] { return entries; },
    markTabSeen(tabId: string) {
      let changed = false;
      entries = entries.map((e) => (e.tabId === tabId && !e.seen ? ((changed = true), { ...e, seen: true }) : e));
      if (changed) emit();
    },
    markAllSeen() {
      if (entries.some((e) => !e.seen)) { entries = entries.map((e) => ({ ...e, seen: true })); emit(); }
    },
    clear() { if (entries.length) { entries = []; emit(); } },
    subscribe(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}

/** App-wide singleton store (in-memory; cleared on restart). */
export const notifications = createNotificationStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- notifications`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications.ts src/lib/notifications.test.ts
git commit -m "feat: in-memory notification store + unseen aggregation"
```

---

### Task 4: Notification settings

**Files:**
- Modify: `src/lib/settings.ts`
- Test: `src/lib/settings.notifications.test.ts`

**Interfaces:**
- Produces: `interface NotificationSettings { enabled: boolean; os: boolean; sound: boolean; toast: boolean; beacon: boolean }`; `Settings.notifications: NotificationSettings`; `DEFAULT_NOTIFICATIONS`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, DEFAULT_NOTIFICATIONS } from "./settings";

beforeEach(() => localStorage.clear());

describe("notification settings", () => {
  it("defaults: all notification switches on", () => {
    expect(loadSettings().notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(DEFAULT_NOTIFICATIONS).toEqual({ enabled: true, os: true, sound: true, toast: true, beacon: true });
  });
  it("merges partial stored notifications over defaults", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ notifications: { sound: false } }));
    const n = loadSettings().notifications;
    expect(n.sound).toBe(false);
    expect(n.enabled).toBe(true); // missing keys fall back to defaults
  });
  it("uses defaults when notifications is absent", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ themeId: "nord" }));
    expect(loadSettings().notifications).toEqual(DEFAULT_NOTIFICATIONS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- settings.notifications`
Expected: FAIL — `notifications` undefined / `DEFAULT_NOTIFICATIONS` not exported.

- [ ] **Step 3: Implement — extend `settings.ts`**

In `src/lib/settings.ts`:

Add the interface + default (after the `Settings` interface):
```ts
export interface NotificationSettings {
  enabled: boolean; os: boolean; sound: boolean; toast: boolean; beacon: boolean;
}
export const DEFAULT_NOTIFICATIONS: NotificationSettings = { enabled: true, os: true, sound: true, toast: true, beacon: true };
```

Add `notifications` to the `Settings` interface:
```ts
  fontSize: number;
  /** Completion-notification switches (see CONTEXT.md). */
  notifications: NotificationSettings;
```

Add it to `DEFAULT_SETTINGS`:
```ts
export const DEFAULT_SETTINGS: Settings = { bgOpacity: 0.62, themeId: "amber-hud", accent: null, blurRadius: 24, fontFamily: "Menlo", fontSize: 13, notifications: DEFAULT_NOTIFICATIONS };
```

In `loadSettings`, add notifications to the returned object (inside the `if (raw)` block, merging over defaults):
```ts
        fontSize: typeof m.fontSize === "number" && m.fontSize > 0 ? m.fontSize : DEFAULT_SETTINGS.fontSize,
        notifications: { ...DEFAULT_NOTIFICATIONS, ...(m.notifications ?? {}) },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- settings.notifications` then `npm test`
Expected: PASS; whole suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts src/lib/settings.notifications.test.ts
git commit -m "feat: add nested notification settings with safe defaults"
```

---

### Task 5: Install the notification plugin + `osNotify` wrapper

**Files:**
- Modify: `package.json` (npm dep), `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`
- Create: `src/lib/osNotify.ts`
- Test: `src/lib/osNotify.test.ts`

**Interfaces:**
- Produces:
  - `ensureNotifyPermission(): Promise<boolean>`
  - `notifyCompletion(c: Completion, opts: { sound: boolean }): Promise<void>`

- [ ] **Step 1: Add the plugin (deps + registration + capability)**

```bash
npm install @tauri-apps/plugin-notification
cd src-tauri && cargo add tauri-plugin-notification && cd ..
```

In `src-tauri/src/lib.rs`, register the plugin (add a line in the builder chain next to the other `.plugin(...)` calls):
```rust
        .plugin(tauri_plugin_notification::init())
```

In `src-tauri/capabilities/default.json`, add to `permissions`:
```json
    "notification:default"
```

- [ ] **Step 2: Write the failing test (gating logic with a mocked plugin)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendNotification = vi.fn();
const isPermissionGranted = vi.fn();
const requestPermission = vi.fn();
vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification, isPermissionGranted, requestPermission }));

import { notifyCompletion } from "./osNotify";
import type { Completion } from "./notifications";

const c: Completion = { id: "1", paneId: "p", sessionId: "s", tabId: "t", name: "fix-bug", project: "web", at: 1, seen: false };

beforeEach(() => { sendNotification.mockReset(); isPermissionGranted.mockReset(); requestPermission.mockReset(); isPermissionGranted.mockResolvedValue(true); });

describe("notifyCompletion", () => {
  it("sends with title=name, body=project", async () => {
    await notifyCompletion(c, { sound: false });
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "fix-bug", body: "web" }));
  });
  it("omits sound when sound:false, includes it when sound:true", async () => {
    await notifyCompletion(c, { sound: false });
    expect(sendNotification.mock.calls[0][0].sound).toBeUndefined();
    sendNotification.mockReset(); isPermissionGranted.mockResolvedValue(true);
    await notifyCompletion(c, { sound: true });
    expect(sendNotification.mock.calls[0][0].sound).toBe("default");
  });
  it("requests permission when not granted, and does not send if denied", async () => {
    isPermissionGranted.mockResolvedValue(false); requestPermission.mockResolvedValue("denied");
    await notifyCompletion(c, { sound: true });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- osNotify`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/osNotify.ts`**

```ts
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import type { Completion } from "./notifications";

/** Resolve a usable permission, requesting once if needed. */
export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch { return false; }
}

/** Fire the native macOS notification for a Completion. Title = session name,
 *  body = project. `sound` attaches the system sound (the only sound — no Web Audio). */
export async function notifyCompletion(c: Completion, opts: { sound: boolean }): Promise<void> {
  if (!(await ensureNotifyPermission())) return;
  sendNotification({ title: c.name, body: c.project, ...(opts.sound ? { sound: "default" } : {}) });
}
```

- [ ] **Step 5: Run test + build to verify**

Run: `npm test -- osNotify`
Expected: PASS.
Run: `npm run build`
Expected: TypeScript compiles, vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src/lib/osNotify.ts src/lib/osNotify.test.ts
git commit -m "feat: notification plugin + osNotify wrapper (permission + gated sound)"
```

---

### Task 6: `useCompletionNotifier` — wire detection to surfaces

Subscribe to each live pane's transcript lines, detect Completions, and fan out to the store, OS notification, and toast bus.

**Files:**
- Create: `src/lib/toastBus.ts`, `src/lib/toastBus.test.ts`
- Create: `src/hooks/useCompletionNotifier.ts`
- Modify: `src/components/CockpitView.tsx`

**Interfaces:**
- Consumes: `parseTurnEnd` (Task 2), `notifications` store (Task 3), `notifyCompletion` (Task 5), `onLogLine` (`logClient.ts`), `Layout` (`paneLayout.ts`), `loadSettings`/`Settings`.
- Produces:
  - `toastBus`: `onToast(cb: (c: Completion) => void): () => void`, `emitToast(c: Completion): void`.
  - `useCompletionNotifier(layout: Layout, settings: Settings): void` — a React hook (no return).

- [ ] **Step 1: Write the failing test for the toast bus**

```ts
import { describe, it, expect } from "vitest";
import { onToast, emitToast } from "./toastBus";
import type { Completion } from "./notifications";

const c: Completion = { id: "1", paneId: "p", sessionId: "s", tabId: "t", name: "n", project: "pr", at: 1, seen: false };

describe("toastBus", () => {
  it("delivers to subscribers and unsubscribes", () => {
    let got: Completion | null = null;
    const off = onToast((x) => (got = x));
    emitToast(c); expect(got).toBe(c);
    got = null; off(); emitToast(c); expect(got).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- toastBus`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `toastBus.ts`**

```ts
import type { Completion } from "./notifications";
type Cb = (c: Completion) => void;
const subs = new Set<Cb>();
export function onToast(cb: Cb): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export function emitToast(c: Completion): void { subs.forEach((cb) => cb(c)); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- toastBus`
Expected: PASS.

- [ ] **Step 5: Implement `useCompletionNotifier.ts`**

```ts
import { useEffect, useRef } from "react";
import type { Layout } from "../layout/paneLayout";
import type { Settings } from "../lib/settings";
import { onLogLine } from "../lib/logClient";
import { parseTurnEnd } from "../lib/completion";
import { notifications, type Completion } from "../lib/notifications";
import { notifyCompletion } from "../lib/osNotify";
import { emitToast } from "../lib/toastBus";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface PaneCtx { sessionId: string; tabId: string; name: string; project: string }
const projectOf = (cwd: string) => cwd.split("/").filter(Boolean).pop() ?? "shell";

function paneIndex(layout: Layout): Map<string, PaneCtx> {
  const m = new Map<string, PaneCtx>();
  for (const t of layout.tabs) for (const r of t.rows) for (const p of r.panes)
    m.set(p.id, { sessionId: p.sessionId, tabId: t.id, name: p.title, project: projectOf(p.cwd) });
  return m;
}

/** Detects Completions from each live pane's transcript and fans them out to the
 *  store, the OS notification, and the toast bus. Listeners are added/removed as panes
 *  appear/disappear. Settings + active tab are read via refs so changing them doesn't
 *  re-subscribe every listener. */
export function useCompletionNotifier(layout: Layout, settings: Settings): void {
  const idx = paneIndex(layout);
  const idxRef = useRef(idx); idxRef.current = idx;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const activeTabRef = useRef(layout.activeTabId); activeTabRef.current = layout.activeTabId;
  const debounce = useRef<Map<string, number>>(new Map());

  // Stable set of currently-listened pane ids
  const listeners = useRef<Map<string, UnlistenFn>>(new Map());

  useEffect(() => {
    const live = new Set(idx.keys());
    // add listeners for new panes
    for (const paneId of live) {
      if (listeners.current.has(paneId)) continue;
      let unlisten: UnlistenFn = () => {};
      let disposed = false;
      onLogLine(paneId, (line) => {
        const hit = parseTurnEnd(line, Date.now());
        if (!hit) return;
        // debounce burst per pane (~300ms)
        const prev = debounce.current.get(paneId) ?? 0;
        const now = Date.now();
        if (now - prev < 300) return;
        debounce.current.set(paneId, now);

        const ctx = idxRef.current.get(paneId);
        if (!ctx) return;
        const s = settingsRef.current.notifications;
        if (!s.enabled) return;
        const seen = ctx.tabId === activeTabRef.current;
        const entry: Completion = notifications.push(
          { paneId, sessionId: ctx.sessionId, tabId: ctx.tabId, name: ctx.name, project: ctx.project, at: hit.at },
          seen,
        );
        if (s.os) void notifyCompletion(entry, { sound: s.sound });
        if (s.toast) emitToast(entry);
      }).then((fn) => { if (disposed) fn(); else unlisten = fn; });
      listeners.current.set(paneId, () => { disposed = true; unlisten(); });
    }
    // remove listeners for gone panes
    for (const [paneId, off] of listeners.current) {
      if (!live.has(paneId)) { off(); listeners.current.delete(paneId); debounce.current.delete(paneId); }
    }
  }, [idx]);

  // cleanup on unmount
  useEffect(() => () => { for (const off of listeners.current.values()) off(); listeners.current.clear(); }, []);
}
```

- [ ] **Step 6: Mount the hook in `CockpitView.tsx`**

After the existing settings/layout hooks (e.g. just before the `return`), add:
```tsx
  useCompletionNotifier(layout, settings);
```
And the import at the top:
```tsx
import { useCompletionNotifier } from "../hooks/useCompletionNotifier";
```

- [ ] **Step 7: Verify build + suite**

Run: `npm run build && npm test`
Expected: compiles; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/toastBus.ts src/lib/toastBus.test.ts src/hooks/useCompletionNotifier.ts src/components/CockpitView.tsx
git commit -m "feat: useCompletionNotifier wires Completion detection to store + OS noti + toast"
```

---

### Task 7: In-app toast

**Files:**
- Create: `src/components/ToastHost.tsx`, `src/components/ToastHost.css`
- Modify: `src/components/CockpitView.tsx`

**Interfaces:**
- Consumes: `onToast` (Task 6), `Completion`, `focusTerminal` (`terminalRegistry.ts`).
- Produces: `<ToastHost onJump={(c: Completion) => void} />`.

- [ ] **Step 1: Implement `ToastHost.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { onToast } from "../lib/toastBus";
import type { Completion } from "../lib/notifications";
import "./ToastHost.css";

interface Shown { c: Completion; key: number }
const TTL = 5000;

export function ToastHost({ onJump }: { onJump: (c: Completion) => void }) {
  const [items, setItems] = useState<Shown[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  useEffect(() => onToast((c) => {
    const key = ++seq.current;
    setItems((prev) => [{ c, key }, ...prev].slice(0, 3));
    const t = window.setTimeout(() => dismiss(key), TTL);
    timers.current.set(key, t);
  }), []);

  const dismiss = (key: number) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
    const t = timers.current.get(key); if (t) { clearTimeout(t); timers.current.delete(key); }
  };
  const pause = (key: number) => { const t = timers.current.get(key); if (t) { clearTimeout(t); timers.current.delete(key); } };
  const resume = (key: number) => { timers.current.set(key, window.setTimeout(() => dismiss(key), TTL)); };

  return (
    <div className="toasts" aria-live="polite">
      {items.map(({ c, key }) => (
        <button key={key} className="toast" onMouseEnter={() => pause(key)} onMouseLeave={() => resume(key)}
                onClick={() => { onJump(c); dismiss(key); }}>
          <span className="toast__check" aria-hidden="true">✓</span>
          <span className="toast__tx">
            <b>{c.name} finished</b>
            <span>{c.project}</span>
          </span>
          <span className="toast__jump">Jump ↗</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement `ToastHost.css`**

```css
.toasts { position: absolute; bottom: 16px; right: 16px; z-index: 40; display: flex; flex-direction: column; gap: 8px; }
.toast { display: flex; align-items: center; gap: 12px; max-width: 300px; padding: 11px 14px;
  background: var(--ck-surface); border: 1px solid var(--ck-border); border-left: 3px solid var(--ck-idle);
  border-radius: 10px; box-shadow: 0 16px 40px -14px rgba(0,0,0,0.8); cursor: pointer; text-align: left;
  color: var(--ck-text); animation: toast-in 160ms ease-out; }
@keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.toast__check { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--ck-idle) 16%, transparent); color: var(--ck-idle); font-size: 14px; flex: none; }
.toast__tx { min-width: 0; display: flex; flex-direction: column; }
.toast__tx b { font-size: 12.5px; color: var(--ck-bright); font-weight: 600; }
.toast__tx span { font-size: 10.5px; color: var(--ck-muted); }
.toast__jump { font-size: 11.5px; color: var(--ck-accent); margin-left: auto; white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
```

- [ ] **Step 3: Mount in `CockpitView.tsx`**

Add the import:
```tsx
import { ToastHost } from "./ToastHost";
```
Add a reusable jump helper and render `<ToastHost>` next to `<Juice .../>` (inside the root div). Add this jump function in the component body (it reuses the dashboard jump pattern):
```tsx
  const jumpToSession = useCallback((sessionId: string) => {
    const hit = findPaneBySession(layout, sessionId);
    if (hit) {
      dispatch({ type: "focusTab", tabId: hit.tabId });
      dispatch({ type: "focusPane", paneId: hit.paneId });
      requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(hit.paneId)));
    }
  }, [layout]);
```
Render (after `<Juice ... />`):
```tsx
      <ToastHost onJump={(c) => jumpToSession(c.sessionId)} />
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 5: Manual check + commit**

Run `npm run tauri dev`, run a Claude prompt in a pane, let it finish — a toast slides in bottom-right; clicking it focuses that pane.
```bash
git add src/components/ToastHost.tsx src/components/ToastHost.css src/components/CockpitView.tsx
git commit -m "feat: in-app completion toast (bottom-right, click to jump)"
```

---

### Task 8: Notification bell + tab badges

**Files:**
- Create: `src/components/NotificationBell.tsx`, `src/components/NotificationBell.css`
- Modify: `src/components/TabBar.tsx`, `src/components/TabBar.css`, `src/components/CockpitView.tsx`, `src/layout/useKeybindings.ts`

**Interfaces:**
- Consumes: `notifications` store, `unseenByTab`, `totalUnseen`, `Completion`, relative-time formatting.
- Produces:
  - `useNotificationEntries(): { entries: Completion[]; total: number }` (a `useSyncExternalStore` hook over the singleton).
  - `<NotificationBell open, onToggle, onJump, onMarkAllRead />`.
  - `TabBar` gains props `unseenByTab: Map<string, number>`, `bellOpen: boolean`, `onToggleBell`, `bellTotal: number`, `onJumpSession`, `onMarkAllRead`.

- [ ] **Step 1: Add a store-subscription hook to `notifications.ts`**

Append to `src/lib/notifications.ts`:
```ts
import { useSyncExternalStore } from "react";
export function useNotifications() {
  const entries = useSyncExternalStore(notifications.subscribe, notifications.list);
  return { entries, total: totalUnseen(entries) };
}
```

- [ ] **Step 2: Implement `NotificationBell.tsx`**

```tsx
import { useNotifications, notifications, type Completion } from "../lib/notifications";
import "./NotificationBell.css";

const rel = (at: number, now: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

const BellIcon = ({ unread }: { unread: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    {unread && <circle cx="18" cy="5" r="3.2" fill="currentColor" stroke="none" />}
  </svg>
);

export function NotificationBell({ open, onToggle, onJump }: {
  open: boolean; onToggle: () => void; onJump: (c: Completion) => void;
}) {
  const { entries, total } = useNotifications();
  const now = Date.now();
  return (
    <div className="bell-wrap">
      <button className={`cockpit-tool${total > 0 ? " bell--unread" : ""}`} onClick={onToggle}
              aria-label="Notifications (Cmd+B)" title="Notifications (⌘B)">
        <BellIcon unread={total > 0} />
        {total > 0 && <span className="bell-bubble">{total}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-panel__head">
            <h3>Notifications</h3>
            <button onClick={() => notifications.markAllSeen()}>Mark all read</button>
          </div>
          {entries.length === 0 ? (
            <div className="bell-panel__empty">No completions yet</div>
          ) : entries.map((c) => (
            <button key={c.id} className={`bell-notif${c.seen ? " seen" : ""}`} onClick={() => onJump(c)}>
              <span className="bell-notif__mark" aria-hidden="true" />
              <span className="bell-notif__meta">
                <span className="bell-notif__ttl">{c.name} finished</span>
                <span className="bell-notif__sub">{c.project}</span>
              </span>
              <span className="bell-notif__when">{rel(c.at, now)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement `NotificationBell.css`**

```css
.bell-wrap { position: relative; display: inline-flex; }
.cockpit-tool.bell--unread { color: var(--ck-bright); }
.bell-bubble { position: absolute; top: 2px; right: 1px; font-size: 9.5px; font-weight: 700; line-height: 1;
  color: var(--ck-bg); background: var(--ck-idle); min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid var(--ck-surface); }
.bell-panel { position: absolute; top: 38px; right: 0; width: 320px; z-index: 50; background: var(--ck-surface);
  border: 1px solid var(--ck-border); border-radius: 12px; box-shadow: 0 20px 50px -16px rgba(0,0,0,0.8); overflow: hidden; }
.bell-panel__head { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-bottom: 1px solid var(--ck-border); }
.bell-panel__head h3 { margin: 0; font-size: 12.5px; color: var(--ck-bright); font-weight: 600; }
.bell-panel__head button { font-size: 11.5px; color: var(--ck-muted); background: none; border: none; cursor: pointer; }
.bell-panel__head button:hover { color: var(--ck-accent); }
.bell-panel__empty { padding: 26px 14px; text-align: center; color: var(--ck-dim); font-size: 12px; }
.bell-notif { display: flex; gap: 11px; align-items: center; width: 100%; padding: 11px 14px; border-bottom: 1px solid var(--ck-border);
  background: color-mix(in srgb, var(--ck-idle) 5%, transparent); border-left: 2px solid var(--ck-idle); text-align: left; cursor: pointer; color: var(--ck-text); }
.bell-notif:last-child { border-bottom: none; }
.bell-notif.seen { background: none; border-left-color: transparent; }
.bell-notif:hover { background: var(--ck-surface-2); }
.bell-notif__mark { width: 7px; height: 7px; border-radius: 50%; background: var(--ck-idle); flex: none; box-shadow: 0 0 7px var(--ck-idle); }
.bell-notif.seen .bell-notif__mark { background: var(--ck-dim); box-shadow: none; }
.bell-notif__meta { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.bell-notif__ttl { font-size: 12.5px; color: var(--ck-bright); }
.bell-notif__sub { font-size: 10.5px; color: var(--ck-muted); }
.bell-notif__when { font-size: 10.5px; color: var(--ck-dim); white-space: nowrap; }
```

- [ ] **Step 4: Add the bell + tab badge to `TabBar.tsx`**

Add to the `TabBar` props (destructure) `unseenByTab`, `bellOpen`, `onToggleBell`, `onJumpSession`:
```tsx
}: {
  layout: Layout;
  attention: Set<string>;
  unseenByTab: Map<string, number>;
  bellOpen: boolean;
  onToggleBell: () => void;
  onJumpSession: (c: import("../lib/notifications").Completion) => void;
  onSelect: (tabId: string) => void;
  // ...existing props unchanged...
```
Import the bell at the top:
```tsx
import { NotificationBell } from "./NotificationBell";
```
Render the badge inside each tab button, right after the `cockpit-tab__ct` span:
```tsx
              <span className="cockpit-tab__ct">{paneCount(t)}</span>
              {!active && (unseenByTab.get(t.id) ?? 0) > 0 && (
                <span className="cockpit-tab__badge">{unseenByTab.get(t.id)}</span>
              )}
```
Render the bell button in the tools cluster, between the Workspaces button and the Settings button:
```tsx
        <button className="cockpit-tool" onClick={onOpenWorkspaces} aria-label="Workspaces (Cmd+E)" title="Workspaces (⌘E)"><LayersIcon /></button>
        <NotificationBell open={bellOpen} onToggle={onToggleBell} onJump={onJumpSession} />
        <button className="cockpit-tool" onClick={onOpenSettings} aria-label="Settings (Cmd+,)" title="Settings (⌘,)"><SettingsIcon /></button>
```

- [ ] **Step 5: Add the badge style to `TabBar.css`**

```css
.cockpit-tab__badge { font-size: 10.5px; font-weight: 600; line-height: 1; color: var(--ck-bg); background: var(--ck-idle);
  min-width: 16px; height: 16px; padding: 0 5px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 0 10px color-mix(in srgb, var(--ck-idle) 45%, transparent); }
```

- [ ] **Step 6: Wire bell state + markTabSeen in `CockpitView.tsx`**

Add bell open state:
```tsx
  const [bellOpen, setBellOpen] = useState(false);
```
Subscribe to the store to compute `unseenByTab` for the TabBar (re-render on change):
```tsx
  const { entries } = useNotifications();
  const unseen = unseenByTab(entries);
```
Imports:
```tsx
import { useNotifications, unseenByTab, notifications } from "../lib/notifications";
```
Extend the existing active-tab effect (`CockpitView.tsx:48-50`) to also mark that tab's completions seen:
```tsx
  useEffect(() => {
    setAttention((s) => { if (!s.has(layout.activeTabId)) return s; const n = new Set(s); n.delete(layout.activeTabId); return n; });
    notifications.markTabSeen(layout.activeTabId);
  }, [layout.activeTabId]);
```
Pass the new props to `<TabBar>`:
```tsx
        unseenByTab={unseen}
        bellOpen={bellOpen}
        onToggleBell={() => setBellOpen((o) => !o)}
        onJumpSession={(c) => { jumpToSession(c.sessionId); setBellOpen(false); }}
```

- [ ] **Step 7: Add ⌘B keybinding**

In `src/layout/useKeybindings.ts`, extend the opts type (add `onToggleBell`):
```ts
  opts: { onNewTab?: () => void; onToggleDashboard?: () => void; onOpenProject?: () => void; onOpenWorkspaces?: () => void; onOpenSettings?: () => void; onToggleBell?: () => void } = {},
```
Add a handler after the `","` branch:
```ts
      else if (k === ",") { e.preventDefault(); opts.onOpenSettings?.(); }
      else if (k === "b") { e.preventDefault(); opts.onToggleBell?.(); }
```
Add `opts.onToggleBell` to the effect's dependency array:
```ts
  }, [dispatch, opts.onNewTab, opts.onToggleDashboard, opts.onOpenProject, opts.onOpenWorkspaces, opts.onOpenSettings, opts.onToggleBell]);
```
Then in `CockpitView.tsx`, add `onToggleBell` to the existing `useKeybindings(...)` options object:
```tsx
  useKeybindings(dispatch, { onNewTab: () => setPickerOpen(true), onToggleDashboard: toggleDash, onOpenProject: () => setPickerOpen(true), onOpenWorkspaces: () => setWsOpen(true), onOpenSettings: () => setSettingsOpen(true), onToggleBell: () => setBellOpen((o) => !o) });
```
(⌘B is allowed through xterm by the same path as the existing ⌘O/⌘E/⌘, shortcuts — `attachCustomKeyEventHandler` only blocks ⌘T/D/W — so no terminal-side change is needed.)

- [ ] **Step 8: Verify build + suite**

Run: `npm run build && npm test`
Expected: compiles; tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/NotificationBell.tsx src/components/NotificationBell.css src/components/TabBar.tsx src/components/TabBar.css src/components/CockpitView.tsx src/layout/useKeybindings.ts src/lib/notifications.ts
git commit -m "feat: notification bell + per-tab unseen badges (Cmd+B)"
```

---

### Task 9: Settings UI — Notifications section

**Files:**
- Modify: `src/components/SettingsMenu.tsx`, `src/components/SettingsMenu.css`

**Interfaces:**
- Consumes: `settings.notifications`, `onPatch` (existing `patchSettings`), `ensureNotifyPermission`.

The existing `SettingsMenu` uses rows of the form `settings__row > settings__label(.settings__name + .settings__desc) + settings__control`. There are no checkbox controls yet, so add a small `.settings__toggle` checkbox and a `.settings__row--sub` indent.

- [ ] **Step 1: Add the import**

At the top of `src/components/SettingsMenu.tsx`:
```tsx
import { ensureNotifyPermission } from "../lib/osNotify";
```

- [ ] **Step 2: Add the Notifications block**

Insert this block immediately before `<div className="settings__foot">` (after the Updates row). It matches the existing `settings__row` markup; each toggle patches `notifications` as a whole object so other keys are preserved. The master gates the sub-rows; the sound sub-row also depends on `os`:
```tsx
        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">Notify when a session finishes</span>
            <span className="settings__desc">alert you the moment Claude hands a turn back to you</span>
          </div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" checked={settings.notifications.enabled}
              onChange={(e) => onPatch({ notifications: { ...settings.notifications, enabled: e.target.checked } })}
              aria-label="Enable completion notifications" />
          </div>
        </div>
        <div className="settings__row settings__row--sub">
          <div className="settings__label"><span className="settings__name">macOS notification</span></div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" disabled={!settings.notifications.enabled} checked={settings.notifications.os}
              onChange={async (e) => { if (e.target.checked) await ensureNotifyPermission(); onPatch({ notifications: { ...settings.notifications, os: e.target.checked } }); }}
              aria-label="macOS notification" />
          </div>
        </div>
        <div className="settings__row settings__row--sub2">
          <div className="settings__label"><span className="settings__name">Play sound</span></div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" disabled={!settings.notifications.enabled || !settings.notifications.os} checked={settings.notifications.sound}
              onChange={(e) => onPatch({ notifications: { ...settings.notifications, sound: e.target.checked } })}
              aria-label="Play notification sound" />
          </div>
        </div>
        <div className="settings__row settings__row--sub">
          <div className="settings__label"><span className="settings__name">In-app toast</span></div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" disabled={!settings.notifications.enabled} checked={settings.notifications.toast}
              onChange={(e) => onPatch({ notifications: { ...settings.notifications, toast: e.target.checked } })}
              aria-label="In-app toast" />
          </div>
        </div>
        <div className="settings__row settings__row--sub">
          <div className="settings__label"><span className="settings__name">Floating beacon</span></div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" disabled={!settings.notifications.enabled} checked={settings.notifications.beacon}
              onChange={(e) => onPatch({ notifications: { ...settings.notifications, beacon: e.target.checked } })}
              aria-label="Floating beacon" />
          </div>
        </div>
```

- [ ] **Step 3: Add the toggle + sub-row styles to `SettingsMenu.css`**

```css
.settings__toggle { width: 16px; height: 16px; accent-color: var(--ck-accent); cursor: pointer; }
.settings__toggle:disabled { opacity: 0.4; cursor: default; }
.settings__row--sub { padding-left: 20px; }
.settings__row--sub2 { padding-left: 38px; }
```

- [ ] **Step 4: Verify build + manual check**

Run: `npm run build`, then `npm run tauri dev` → open Settings (⌘,) → toggle the switches; confirm enabling macOS notification prompts for permission once.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsMenu.tsx src/components/SettingsMenu.css
git commit -m "feat: Notifications settings section (nested switches + permission prompt)"
```

---

### Task 10: Beacon — Rust window + jump command + build wiring

**Files:**
- Create: `beacon.html`, `src-tauri/capabilities/beacon.json`
- Modify: `vite.config.ts`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: a second window labelled `beacon`; command `beacon_jump(session_id: String)`; event `cockpit://jump` (payload = session id) emitted to the main window; the Beacon listens for `cockpit://beacon-state`.

- [ ] **Step 1: Add the beacon HTML entry**

Create `beacon.html` (sibling of `index.html`):
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Beacon</title></head>
  <body style="margin:0;background:transparent">
    <div id="beacon-root"></div>
    <script type="module" src="/src/beacon/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Add beacon as a second Vite build input**

In `vite.config.ts`, add a `build.rollupOptions.input` map:
```ts
  build: {
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        beacon: new URL("./beacon.html", import.meta.url).pathname,
      },
    },
  },
```
(Merge into the existing `defineConfig` object; keep all current settings.)

- [ ] **Step 3: Create the beacon window + command in `lib.rs`**

Add the command (near the other `#[tauri::command]`s):
```rust
use tauri::{Emitter, Manager};

#[tauri::command]
fn beacon_jump(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    app.emit("cockpit://jump", session_id).map_err(|e| e.to_string())
}
```
Register it in `generate_handler![ ... , beacon_jump]`.

Create the beacon window in a `.setup(...)` closure on the builder (add before `.run(...)`). The window starts at the collapsed size; the Beacon UI resizes it when its list opens (Task 11):
```rust
        .setup(|app| {
            use tauri::{WebviewWindowBuilder, WebviewUrl, Manager, WindowEvent};
            let mut b = WebviewWindowBuilder::new(app, "beacon", WebviewUrl::App("beacon.html".into()))
                .title("")
                .inner_size(230.0, 64.0)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false);
            // Make the beacon a child of the main window so it closes with it (lifecycle B).
            if let Some(main) = app.get_webview_window("main") {
                b = b.parent(&main)?;
            }
            let beacon = b.build()?;
            let _ = beacon.set_visible_on_all_workspaces(true);
            // top-right of the primary monitor with a margin
            if let Ok(Some(mon)) = beacon.primary_monitor() {
                let sz = mon.size();
                let pos = mon.position();
                let _ = beacon.set_position(tauri::PhysicalPosition::new(
                    pos.x + sz.width as i32 - 250, pos.y + 40,
                ));
            }
            // Lifecycle B: closing the main Cockpit window quits the whole app (beacon
            // included). macOS otherwise keeps a windowless app alive, so make it explicit.
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |e| {
                    if matches!(e, WindowEvent::CloseRequested { .. }) { handle.exit(0); }
                });
            }
            Ok(())
        })
```
(`b.parent(&main)?` makes the beacon an owned/child window — Tauri 2 API. If your installed Tauri version names it differently, consult `WebviewWindowBuilder` docs and adjust; the goal is "beacon closes with main".)

- [ ] **Step 4: Add the beacon capability**

Create `src-tauri/capabilities/beacon.json`:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "beacon",
  "description": "Capability for the floating beacon window",
  "windows": ["beacon"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:window:allow-start-dragging",
    "core:window:allow-set-position",
    "core:window:allow-set-size",
    "core:window:allow-show",
    "core:window:allow-set-focus"
  ]
}
```

- [ ] **Step 5: Verify it builds and the window appears**

Run: `npm run tauri dev`
Expected: a small transparent always-on-top window appears top-right (it will be blank until Task 11). The app still launches normally. If the window doesn't appear, check the dev console for capability errors and adjust `beacon.json`.

- [ ] **Step 6: Commit**

```bash
git add beacon.html vite.config.ts src-tauri/src/lib.rs src-tauri/capabilities/beacon.json
git commit -m "feat: beacon window (2nd always-on-top window) + beacon_jump command"
```

---

### Task 11: Beacon UI + state sync

**Files:**
- Create: `src/beacon/main.tsx`, `src/beacon/Beacon.tsx`, `src/beacon/Beacon.css`
- Create: `src/lib/beaconState.ts`, `src/lib/beaconState.test.ts`
- Modify: `src/components/CockpitView.tsx`

**Interfaces:**
- Produces:
  - `interface BeaconSession { sessionId: string; name: string; project: string; tabId: string; tabIndex: number; status: "working" | "idle"; unseen: boolean }`
  - `interface BeaconState { sessions: BeaconSession[]; totalUnseen: number; working: number }`
  - `buildBeaconState(layout: Layout, entries: Completion[], workingPaneIds: Set<string>): BeaconState` (pure, tested).
  - Event `cockpit://beacon-state` (main → beacon, payload `BeaconState`).

- [ ] **Step 1: Write the failing test for `buildBeaconState`**

```ts
import { describe, it, expect } from "vitest";
import { buildBeaconState } from "./beaconState";
import type { Completion } from "./notifications";

const layout: any = { activeTabId: "t1", tabs: [
  { id: "t1", rows: [{ panes: [{ id: "p1", sessionId: "s1", title: "a", cwd: "/x/web" }] }] },
  { id: "t2", rows: [{ panes: [{ id: "p2", sessionId: "s2", title: "b", cwd: "/x/api" }] }] },
] };
const entry = (over: Partial<Completion>): Completion => ({ id: "1", paneId: "p2", sessionId: "s2", tabId: "t2", name: "b", project: "api", at: 1, seen: false, ...over });

describe("buildBeaconState", () => {
  it("marks working panes, counts unseen, and sorts unseen-first", () => {
    const st = buildBeaconState(layout, [entry({})], new Set(["p1"]));
    expect(st.working).toBe(1);
    expect(st.totalUnseen).toBe(1);
    expect(st.sessions[0].sessionId).toBe("s2"); // unseen first
    expect(st.sessions.find((s) => s.sessionId === "s1")!.status).toBe("working");
    expect(st.sessions.find((s) => s.sessionId === "s2")!.unseen).toBe(true);
  });
  it("a seen completion contributes no unseen", () => {
    const st = buildBeaconState(layout, [entry({ seen: true })], new Set());
    expect(st.totalUnseen).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- beaconState`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `beaconState.ts`**

```ts
import type { Layout } from "../layout/paneLayout";
import { unseenByTab, type Completion } from "./notifications";

export interface BeaconSession {
  sessionId: string; name: string; project: string; tabId: string; tabIndex: number;
  status: "working" | "idle"; unseen: boolean;
}
export interface BeaconState { sessions: BeaconSession[]; totalUnseen: number; working: number }

const projectOf = (cwd: string) => cwd.split("/").filter(Boolean).pop() ?? "shell";

/** Pure snapshot for the Beacon: one row per pane, working flag from the live working
 *  set, unseen flag from the unseen Completions for that pane. Sorted unseen-first,
 *  then working, then idle. */
export function buildBeaconState(layout: Layout, entries: Completion[], workingPaneIds: Set<string>): BeaconState {
  const unseenPanes = new Set(entries.filter((e) => !e.seen).map((e) => e.paneId));
  const sessions: BeaconSession[] = [];
  layout.tabs.forEach((t, tabIndex) => {
    for (const r of t.rows) for (const p of r.panes) {
      sessions.push({
        sessionId: p.sessionId, name: p.title, project: projectOf(p.cwd),
        tabId: t.id, tabIndex: tabIndex + 1,
        status: workingPaneIds.has(p.id) ? "working" : "idle",
        unseen: unseenPanes.has(p.id),
      });
    }
  });
  const rank = (s: BeaconSession) => (s.unseen ? 0 : s.status === "working" ? 1 : 2);
  sessions.sort((a, b) => rank(a) - rank(b));
  const totalUnseen = [...unseenByTab(entries).values()].reduce((a, b) => a + b, 0);
  return { sessions, totalUnseen, working: sessions.filter((s) => s.status === "working").length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- beaconState`
Expected: PASS.

- [ ] **Step 5: Implement the Beacon UI — `src/beacon/Beacon.tsx`**

```tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import type { BeaconState } from "../lib/beaconState";
import "./Beacon.css";

const EMPTY: BeaconState = { sessions: [], totalUnseen: 0, working: 0 };

export function Beacon() {
  const [st, setSt] = useState<BeaconState>(EMPTY);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const un = listen<BeaconState>("cockpit://beacon-state", (e) => setSt(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  // Resize the OS window to fit: a fixed large transparent window would capture clicks
  // over whatever is behind it. Collapsed = just the bar; open = bar + list (max 8 rows).
  useEffect(() => {
    const rows = st.sessions.length;
    const listH = rows === 0 ? 50 : Math.min(rows, 8) * 42 + 10;
    const h = open ? 60 + listH : 60;
    void getCurrentWindow().setSize(new LogicalSize(230, h));
  }, [open, st.sessions.length]);

  // Draggable + persisted position (localStorage is shared across same-origin windows).
  // Rust positions it top-right on first run; a saved position overrides on next launch.
  useEffect(() => {
    const w = getCurrentWindow();
    const saved = localStorage.getItem("cockpit.beacon.pos");
    if (saved) { try { const { x, y } = JSON.parse(saved); void w.setPosition(new PhysicalPosition(x, y)); } catch { /* ignore */ } }
    const un = w.onMoved(({ payload }) => localStorage.setItem("cockpit.beacon.pos", JSON.stringify({ x: payload.x, y: payload.y })));
    return () => { un.then((f) => f()); };
  }, []);

  const jump = (sessionId: string) => { void invoke("beacon_jump", { sessionId }); setOpen(false); };
  const mode = st.totalUnseen > 0 ? "done" : st.working > 0 ? "work" : "idle";

  return (
    <div className="beacon-root">
      <button className={`beacon beacon--${mode}`} data-tauri-drag-region onClick={() => setOpen((o) => !o)}>
        {mode === "done" && <span className="beacon__ping"><i /><b /></span>}
        {mode === "work" && <span className="beacon__eq"><i /><i /><i /></span>}
        {mode === "idle" && <span className="beacon__dot" />}
        {st.totalUnseen > 0 && <span className="beacon__num">{st.totalUnseen}</span>}
        {st.totalUnseen > 0 ? <span className="beacon__lbl">done</span>
          : st.working > 0 ? <span className="beacon__lbl">{st.working} working</span> : null}
      </button>
      {open && (
        <div className="beacon-list">
          {st.sessions.length === 0 ? <div className="beacon-list__empty">No sessions</div>
            : st.sessions.map((s) => (
            <button key={s.sessionId} className={`beacon-row beacon-row--${s.unseen ? "done" : s.status}`} onClick={() => jump(s.sessionId)}>
              <span className="beacon-row__mark" />
              <span className="beacon-row__meta"><span className="beacon-row__nm">{s.name}</span>
                <span className="beacon-row__sub">{s.project} · tab {s.tabIndex}</span></span>
              <span className="beacon-row__jmp">↗</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Implement `src/beacon/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Beacon } from "./Beacon";

ReactDOM.createRoot(document.getElementById("beacon-root")!).render(
  <React.StrictMode><Beacon /></React.StrictMode>,
);
```

- [ ] **Step 7: Implement `src/beacon/Beacon.css`**

```css
:root { color-scheme: dark; }
.beacon-root { font-family: -apple-system, system-ui, sans-serif; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; padding: 6px; }
.beacon { display: inline-flex; align-items: center; gap: 9px; height: 36px; padding: 0 14px 0 12px; border-radius: 18px;
  background: color-mix(in srgb, var(--ck-bg, #14161B) 82%, transparent); backdrop-filter: blur(14px);
  border: 1px solid var(--ck-border, #262A33); color: var(--ck-bright, #EDEFF3); cursor: pointer;
  box-shadow: 0 8px 28px -6px rgba(0,0,0,0.7); }
.beacon--done { border-color: color-mix(in srgb, var(--ck-idle, #3ECF8E) 60%, transparent); animation: beacon-pulse 1.6s ease-in-out infinite; }
.beacon--work { border-color: color-mix(in srgb, var(--ck-accent, #F5A623) 50%, transparent); }
@keyframes beacon-pulse { 0%,100% { box-shadow: 0 8px 28px -6px rgba(0,0,0,0.7), 0 0 16px color-mix(in srgb, var(--ck-idle,#3ECF8E) 18%, transparent); }
  50% { box-shadow: 0 8px 28px -6px rgba(0,0,0,0.7), 0 0 32px color-mix(in srgb, var(--ck-idle,#3ECF8E) 50%, transparent); } }
.beacon__ping { position: relative; width: 11px; height: 11px; }
.beacon__ping b { position: absolute; inset: 1px; border-radius: 50%; background: var(--ck-idle, #3ECF8E); box-shadow: 0 0 10px var(--ck-idle, #3ECF8E); }
.beacon__ping i { position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid var(--ck-idle, #3ECF8E); animation: beacon-rad 1.6s cubic-bezier(0,0,.2,1) infinite; }
@keyframes beacon-rad { 0% { transform: scale(.6); opacity: .9; } 80%,100% { transform: scale(2.6); opacity: 0; } }
.beacon__num { font-weight: 700; font-size: 14px; color: var(--ck-idle, #3ECF8E); font-variant-numeric: tabular-nums; }
.beacon__lbl { font-size: 12px; color: var(--ck-text, #C8CDD6); }
.beacon__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ck-dim, #565d68); opacity: .6; }
.beacon__eq { display: inline-flex; gap: 2px; align-items: flex-end; height: 11px; }
.beacon__eq i { width: 2px; background: var(--ck-accent, #F5A623); border-radius: 1px; }
.beacon__eq i:nth-child(1){height:5px}.beacon__eq i:nth-child(2){height:11px}.beacon__eq i:nth-child(3){height:7px}
.beacon-list { width: 220px; max-height: 336px; overflow-y: auto; background: color-mix(in srgb, var(--ck-bg,#14161B) 95%, transparent); backdrop-filter: blur(14px);
  border: 1px solid var(--ck-border,#262A33); border-radius: 12px; box-shadow: 0 18px 44px -14px rgba(0,0,0,0.8); }
.beacon-list__empty { padding: 18px; text-align: center; color: var(--ck-dim,#565d68); font-size: 12px; }
.beacon-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 13px; background: none; border: none; cursor: pointer; text-align: left; color: var(--ck-text,#C8CDD6); }
.beacon-row:hover { background: var(--ck-surface-2,#20242d); }
.beacon-row__mark { width: 8px; height: 8px; border-radius: 50%; background: var(--ck-dim,#565d68); flex: none; }
.beacon-row--done .beacon-row__mark { background: var(--ck-idle,#3ECF8E); box-shadow: 0 0 7px var(--ck-idle,#3ECF8E); }
.beacon-row--working .beacon-row__mark { background: var(--ck-accent,#F5A623); }
.beacon-row__meta { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.beacon-row__nm { font-size: 12.5px; color: var(--ck-bright,#EDEFF3); }
.beacon-row__sub { font-size: 10px; color: var(--ck-muted,#6B7280); }
.beacon-row__jmp { color: var(--ck-dim,#565d68); }
.beacon-row:hover .beacon-row__jmp { color: var(--ck-accent,#F5A623); }
```
NOTE: the Beacon window does not run `applyTheme`, so every color uses `var(--ck-*, <fallback>)` where the fallback is the amber-hud default — that is why the fallbacks are present. Syncing live theme tokens into the beacon window is a deliberate follow-up, out of scope here.

- [ ] **Step 8: Emit beacon state + handle jump in `CockpitView.tsx`**

Add an effect that emits `cockpit://beacon-state` whenever layout, entries, or working set changes, and a listener for `cockpit://jump`. Compute the working set the same way the rest of the app does (poll the registry):
```tsx
import { emit, listen } from "@tauri-apps/api/event";
import { buildBeaconState } from "../lib/beaconState";
import { paneLastLineAt } from "../lib/terminalRegistry";
import { deriveState } from "../lib/paneState";
```
```tsx
  // Emit beacon snapshots on a light interval (covers working-state changes too)
  useEffect(() => {
    if (!settings.notifications.beacon) return;
    const tick = () => {
      const now = Date.now();
      const working = new Set<string>();
      for (const t of layout.tabs) for (const r of t.rows) for (const p of r.panes)
        if (deriveState({ lastLineAt: paneLastLineAt(p.id) }, now, 800) === "working") working.add(p.id);
      void emit("cockpit://beacon-state", buildBeaconState(layout, notifications.list(), working));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [layout, entries, settings.notifications.beacon]);

  // Jump requests coming from the beacon window
  useEffect(() => {
    const un = listen<string>("cockpit://jump", (e) => jumpToSession(e.payload));
    return () => { un.then((f) => f()); };
  }, [jumpToSession]);
```

- [ ] **Step 9: Verify build + suite + manual**

Run: `npm run build && npm test`
Expected: compiles; tests pass.
Run: `npm run tauri dev` → the Beacon shows idle; run a Claude prompt → while working it shows amber "1 working"; on finish it pulses mint "1 done"; click it → the session list appears; click a row → main Cockpit comes forward and focuses that pane.

- [ ] **Step 10: Commit**

```bash
git add src/beacon/ src/lib/beaconState.ts src/lib/beaconState.test.ts src/components/CockpitView.tsx
git commit -m "feat: beacon UI + state sync (pulse/list/jump over Tauri events)"
```

---

### Task 12: Full GUI verification

No new code — confirm the whole feature end-to-end against the spec. Fix any defect in the owning task and re-commit.

- [ ] **Step 1: Detection accuracy (ADR 0007)**
  - Run a prompt with a long quiet step (e.g. ask Claude to run a slow command). Confirm **no** notification fires mid-turn; exactly **one** fires when the turn actually ends.
  - Resume the app with existing sessions (relaunch) — confirm **no** flood of notifications from backfilled history.

- [ ] **Step 2: Each surface**
  - macOS notification appears (test with Cockpit in the background); clicking it focuses Cockpit.
  - Sound plays when "Play sound" is on; silent when off.
  - Toast appears on every completion; click jumps.
  - Background-tab badge increments and clears when you open that tab; active tab never badges.
  - Bell bubble counts total unseen; panel lists completions; "Mark all read" clears; ⌘B toggles.

- [ ] **Step 3: Beacon (ADR 0008)**
  - Floats over another app (switch to a browser; it stays visible and pulses on completion).
  - Click → list grouped/sorted unseen-first; click a row jumps to the session.
  - Toggle "Floating beacon" off in Settings → the beacon stops updating/hides; on → returns.
  - Closing the main Cockpit window quits the app (beacon closes too).
  - Note the actual behavior over a *native-fullscreen* app (the ADR 0008 caveat) in the PR description.

- [ ] **Step 4: Settings persistence**
  - Toggle switches, relaunch, confirm they persist (localStorage). Master off suppresses all surfaces.

- [ ] **Step 5: Final commit (if any fixes were made)**

```bash
git commit -am "fix: completion-notifications GUI verification fixes"
```

---

## Self-review notes (for the implementer)

- The biggest risk lives in Task 1/2 — if the real transcript schema differs from the fixtures, update the fixtures AND `parseTurnEnd` together, keeping the tests green.
- Tasks 1–6 and 11(state) are pure/unit-tested; Tasks 7–11(UI) and 9 rely on `npm run build` + manual GUI checks (no DOM/Tauri test harness exists in this repo).
- Keep the existing working/idle polling untouched; the beacon reuses `deriveState` read-only for its working indicator.
