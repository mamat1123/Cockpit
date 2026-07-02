# Waiting State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect "session is blocked on an AskUserQuestion" from the tailed JSONL, surface it as the third `waiting` PaneState (chip + tab + Beacon + Mission Control), and fire a one-shot notification burst on entry.

**Architecture:** A pure per-line transition function + module-level store (`src/lib/waiting.ts`, mirroring `completion.ts`/`notifications.ts` conventions) fed by the existing per-pane `pane://log` listener in `useCompletionNotifier`. Consumers that today call `deriveState` compose `waiting` on top (waiting overrides the PTY heuristic). Zero Rust changes.

**Tech Stack:** TypeScript + React 19, vitest (jsdom), existing Tauri notification/toast/beacon plumbing.

**Spec:** `docs/superpowers/specs/2026-07-02-waiting-state-design.md`

---

### Task 1: Fixtures + pure parser/store (`waiting.ts`)

**Files:**
- Modify: `src/lib/__fixtures__/transcriptLines.ts` (append fixtures)
- Create: `src/lib/waiting.ts`
- Test: `src/lib/waiting.test.ts`

- [ ] **Step 1: Append ask/answer fixtures to `src/lib/__fixtures__/transcriptLines.ts`**

Shapes verified against real transcripts on this machine (2026-07-02): the ask is an assistant `tool_use` block named `AskUserQuestion`; a parallel block of the SAME API message is written as a separate JSONL record sharing `message.id`; the answer is a later user `tool_result` with the matching `tool_use_id`.

```ts
/** Assistant message calling AskUserQuestion — the session is now WAITING on the user.
 *  Shape verified against a real transcript (2026-07-02 schema check). */
export const ASSISTANT_ASK = JSON.stringify({
  parentUuid: "41d1a92f-820f-44d2-b374-1ce8f24eb703",
  isSidechain: false,
  message: {
    model: "claude-fable-5",
    id: "msg_ASK1",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_ASK1",
        name: "AskUserQuestion",
        input: { questions: [{ question: "Which auth method should the API use?", header: "Auth", options: [], multiSelect: false }] },
      },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 2, cache_read_input_tokens: 290000, output_tokens: 120 },
    diagnostics: null,
  },
  requestId: "req_ASK1",
  type: "assistant",
  uuid: "a1a1a1a1-0000-4000-8000-000000000001",
  timestamp: "2026-07-02T10:00:00.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** A parallel tool_use block of the SAME assistant message (same message.id), written as
 *  its own JSONL record — observed in a real log. Must NOT clear waiting. */
export const ASSISTANT_ASK_SIBLING = JSON.stringify({
  parentUuid: "a1a1a1a1-0000-4000-8000-000000000001",
  isSidechain: false,
  message: {
    model: "claude-fable-5",
    id: "msg_ASK1",
    type: "message",
    role: "assistant",
    content: [
      { type: "tool_use", id: "toolu_OTHER1", name: "mcp__designer__designer_session", input: { action: "status" } },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 2, cache_read_input_tokens: 290000, output_tokens: 40 },
    diagnostics: null,
  },
  requestId: "req_ASK1",
  type: "assistant",
  uuid: "a1a1a1a1-0000-4000-8000-000000000002",
  timestamp: "2026-07-02T10:00:00.300Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** The user answered the question — tool_result matching the ask's tool_use_id. Clears waiting. */
export const USER_ASK_ANSWER = JSON.stringify({
  parentUuid: "a1a1a1a1-0000-4000-8000-000000000001",
  isSidechain: false,
  promptId: "b2b2b2b2-0000-4000-8000-000000000001",
  type: "user",
  message: {
    role: "user",
    content: [{ tool_use_id: "toolu_ASK1", type: "tool_result", content: "User selected: JWT" }],
  },
  uuid: "a1a1a1a1-0000-4000-8000-000000000003",
  timestamp: "2026-07-02T10:01:50.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});

/** A sidechain (subagent) assistant line with a DIFFERENT message id — must NOT clear waiting. */
export const SIDECHAIN_ASSISTANT = JSON.stringify({
  parentUuid: "c3c3c3c3-0000-4000-8000-000000000001",
  isSidechain: true,
  message: {
    model: "claude-fable-5",
    id: "msg_SIDE1",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "subagent output" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 2, cache_read_input_tokens: 1000, output_tokens: 10 },
    diagnostics: null,
  },
  requestId: "req_SIDE1",
  type: "assistant",
  uuid: "a1a1a1a1-0000-4000-8000-000000000004",
  timestamp: "2026-07-02T10:00:30.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});
```

- [ ] **Step 2: Write the failing test `src/lib/waiting.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { nextWaiting, waitingLabel, createWaitingStore } from "./waiting";
import {
  ASSISTANT_ASK, ASSISTANT_ASK_SIBLING, USER_ASK_ANSWER, SIDECHAIN_ASSISTANT,
  ASSISTANT_END_TURN, ASSISTANT_TOOL_USE, USER_LINE, USER_TOOL_RESULT, GARBAGE,
} from "./__fixtures__/transcriptLines";

const askedAt = Date.parse("2026-07-02T10:00:00.000Z");

describe("nextWaiting", () => {
  it("enters waiting on an AskUserQuestion tool_use", () => {
    expect(nextWaiting(null, ASSISTANT_ASK)).toEqual({
      toolUseId: "toolu_ASK1", messageId: "msg_ASK1", askedAt,
      question: "Which auth method should the API use?",
    });
  });
  it("stays waiting through a parallel block of the SAME assistant message", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, ASSISTANT_ASK_SIBLING)).toBe(w);
  });
  it("clears on the matching tool_result (the user answered)", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, USER_ASK_ANSWER)).toBeNull();
  });
  it("does NOT clear on an unrelated tool_result", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, USER_TOOL_RESULT)).toBe(w);
  });
  it("clears on a NEW assistant message id (model moved on / ask interrupted)", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, ASSISTANT_END_TURN)).toBeNull();
  });
  it("clears on a typed user prompt (user moved on)", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, USER_LINE)).toBeNull();
  });
  it("ignores sidechain (subagent) lines", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, SIDECHAIN_ASSISTANT)).toBe(w);
  });
  it("a non-waiting tool_use (Bash) never enters waiting", () => {
    expect(nextWaiting(null, ASSISTANT_TOOL_USE)).toBeNull();
  });
  it("garbage lines change nothing", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, GARBAGE)).toBe(w);
    expect(nextWaiting(null, GARBAGE)).toBeNull();
  });
});

describe("createWaitingStore", () => {
  it("returns the entered Waiting once and dedupes re-processing the same ask", () => {
    const store = createWaitingStore();
    expect(store.apply("p1", ASSISTANT_ASK)).toMatchObject({ toolUseId: "toolu_ASK1" });
    expect(store.apply("p1", ASSISTANT_ASK)).toBeNull();
    expect(store.get("p1")).toMatchObject({ toolUseId: "toolu_ASK1" });
  });
  it("clears on answer and on clear()", () => {
    const store = createWaitingStore();
    store.apply("p1", ASSISTANT_ASK);
    store.apply("p1", USER_ASK_ANSWER);
    expect(store.get("p1")).toBeNull();
    store.apply("p2", ASSISTANT_ASK);
    store.clear("p2");
    expect(store.get("p2")).toBeNull();
  });
  it("tracks panes independently", () => {
    const store = createWaitingStore();
    store.apply("p1", ASSISTANT_ASK);
    expect(store.get("p2")).toBeNull();
  });
});

describe("waitingLabel", () => {
  it("elides minutes under 1m", () => { expect(waitingLabel(0, 30_000)).toBe("waiting"); });
  it("shows minutes", () => { expect(waitingLabel(0, 4 * 60_000 + 5_000)).toBe("waiting 4m"); });
  it("shows hours past 60m", () => { expect(waitingLabel(0, 3 * 3_600_000 + 60_000)).toBe("waiting 3h"); });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/waiting.test.ts`
Expected: FAIL — `Cannot find module './waiting'` (or export errors).

- [ ] **Step 4: Create `src/lib/waiting.ts`**

```ts
/** Tools whose tool_use blocks the turn on the user (CONTEXT.md "Working state" →
 *  waiting). Extend (e.g. ExitPlanMode) ONLY with a real-transcript fixture proving
 *  the shape — none exists in local logs as of 2026-07-02. */
const WAITING_TOOLS = new Set(["AskUserQuestion"]);

export interface Waiting {
  toolUseId: string;
  messageId: string;
  askedAt: number;   // ms epoch of the ask line's timestamp
  question: string;  // first question's text, "" when unreadable
}

function questionOf(block: any): string {
  const qs = block?.input?.questions;
  const q = Array.isArray(qs) ? qs[0]?.question : undefined;
  return typeof q === "string" ? q : "";
}

/** Pure transition: fold one transcript line into a pane's waiting state.
 *  Enter on an assistant tool_use named in WAITING_TOOLS. Stay through parallel blocks
 *  of the SAME assistant message (one API message is written as multiple records sharing
 *  message.id) and unrelated tool_results. Clear on the matching tool_result, a NEW
 *  assistant message id (the model moved on — e.g. the ask was interrupted), or a typed
 *  user prompt. Sidechain (subagent) lines never transition. */
export function nextWaiting(prev: Waiting | null, line: string): Waiting | null {
  let v: any;
  try { v = JSON.parse(line); } catch { return prev; }
  if (!v || typeof v !== "object" || v.isSidechain) return prev;
  if (v.type === "assistant") {
    const msg = v.message;
    const blocks: any[] = Array.isArray(msg?.content) ? msg.content : [];
    const ask = blocks.find((b) => b?.type === "tool_use" && WAITING_TOOLS.has(b.name));
    if (ask && typeof ask.id === "string" && typeof msg?.id === "string") {
      const ts = typeof v.timestamp === "string" ? Date.parse(v.timestamp) : NaN;
      if (Number.isNaN(ts)) return prev;
      return { toolUseId: ask.id, messageId: msg.id, askedAt: ts, question: questionOf(ask) };
    }
    if (prev && typeof msg?.id === "string" && msg.id !== prev.messageId) return null;
    return prev;
  }
  if (v.type === "user" && prev) {
    const c = v.message?.content;
    if (typeof c === "string") return null;
    if (Array.isArray(c) && c.some((b) => b?.type === "tool_result" && b.tool_use_id === prev.toolUseId)) return null;
    return prev;
  }
  return prev;
}

/** Chip copy for a waiting pane: "waiting", "waiting 4m", "waiting 3h". */
export function waitingLabel(askedAt: number, now: number): string {
  const m = Math.floor((now - askedAt) / 60_000);
  if (m < 1) return "waiting";
  if (m < 60) return `waiting ${m}m`;
  return `waiting ${Math.floor(m / 60)}h`;
}

/** Per-pane waiting tracker. `apply` returns the Waiting just ENTERED (a new ask) so the
 *  caller fires the one-shot burst exactly once per toolUseId. */
export function createWaitingStore() {
  const panes = new Map<string, Waiting>();
  return {
    apply(paneId: string, line: string): Waiting | null {
      const prev = panes.get(paneId) ?? null;
      const next = nextWaiting(prev, line);
      if (next === prev) return null;
      if (next) panes.set(paneId, next); else panes.delete(paneId);
      return next && next.toolUseId !== prev?.toolUseId ? next : null;
    },
    get(paneId: string): Waiting | null { return panes.get(paneId) ?? null; },
    clear(paneId: string): void { panes.delete(paneId); },
  };
}

/** App-wide singleton (in-memory, like the notifications store). */
export const waitingPanes = createWaitingStore();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/waiting.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/waiting.ts src/lib/waiting.test.ts src/lib/__fixtures__/transcriptLines.ts
git commit -m "feat(waiting): pure AskUserQuestion waiting parser + per-pane store"
```

---

### Task 2: macOS notification (`notifyWaiting`)

**Files:**
- Modify: `src/lib/osNotify.ts`
- Test: `src/lib/osNotify.test.ts`

- [ ] **Step 1: Add failing tests to `src/lib/osNotify.test.ts`** (import `notifyWaiting` alongside `notifyCompletion`; append describe block)

```ts
describe("notifyWaiting", () => {
  it("sends title '<name> is asking' with the question as body", async () => {
    await notifyWaiting({ name: "fix-bug", question: "Which DB?" }, { sound: true });
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "fix-bug is asking", body: "Which DB?", sound: "default" }),
    );
  });
  it("falls back to a generic body when the question is empty", async () => {
    await notifyWaiting({ name: "fix-bug", question: "" }, { sound: false });
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ body: "waiting for your answer" }),
    );
    expect(sendNotification.mock.calls[0][0].sound).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/lib/osNotify.test.ts`
Expected: FAIL — `notifyWaiting` is not exported.

- [ ] **Step 3: Implement in `src/lib/osNotify.ts`** (append)

```ts
/** Fire the native macOS notification for a pane blocked on a question. Title carries
 *  the session name; body is the question itself so the user knows what's being asked
 *  before jumping over. */
export async function notifyWaiting(w: { name: string; question: string }, opts: { sound: boolean }): Promise<void> {
  if (!(await ensureNotifyPermission())) return;
  sendNotification({ title: `${w.name} is asking`, body: w.question || "waiting for your answer", ...(opts.sound ? { sound: "default" } : {}) });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/osNotify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/osNotify.ts src/lib/osNotify.test.ts
git commit -m "feat(waiting): notifyWaiting macOS notification"
```

---

### Task 3: Toast payload kind + waiting toast rendering

**Files:**
- Modify: `src/lib/toastBus.ts`
- Modify: `src/components/ToastHost.tsx`
- Modify: `src/components/ToastHost.css` (append)

- [ ] **Step 1: Widen the bus payload in `src/lib/toastBus.ts`** (replace whole file)

```ts
import type { Completion } from "./notifications";
/** Toast payload: a Completion, or a waiting alert (kind:"waiting") reusing the same
 *  shape so jump-by-sessionId keeps working. Waiting toasts are NEVER pushed to the
 *  notifications ledger — waiting is a live state, not a Seen/Unseen event. */
export interface ToastItem extends Completion { kind?: "waiting"; question?: string }
type Cb = (t: ToastItem) => void;
const subs = new Set<Cb>();
export function onToast(cb: Cb): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export function emitToast(t: ToastItem): void { subs.forEach((cb) => cb(t)); }
```

- [ ] **Step 2: Render the waiting variant in `src/components/ToastHost.tsx`**

Replace the imports of `onToast`/`Completion`:

```ts
import { onToast, type ToastItem } from "../lib/toastBus";
import type { Completion } from "../lib/notifications";
```

Replace `interface Shown { c: Completion; key: number }` with:

```ts
interface Shown { c: ToastItem; key: number }
```

Replace the toast body markup (the `<span className="toast__check">…</span>` + `<span className="toast__tx">…</span>` block) with:

```tsx
<span className={`toast__check${c.kind === "waiting" ? " toast__check--ask" : ""}`} aria-hidden="true">{c.kind === "waiting" ? "?" : "✓"}</span>
<span className="toast__tx">
  <b>{c.kind === "waiting" ? `${c.name} is asking` : `${c.name} finished`}</b>
  <span>{c.kind === "waiting" ? (c.question || c.project) : c.project}</span>
</span>
```

(`onJump` prop stays `(c: Completion) => void` — `ToastItem extends Completion`.)

- [ ] **Step 3: Append to `src/components/ToastHost.css`**

```css
.toast__check--ask { color: var(--ck-yellow); }
```

- [ ] **Step 4: Verify compile + suite**

Run: `npx tsc --noEmit && npx vitest run src/lib/toastBus.test.ts`
Expected: clean compile, existing toastBus tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/toastBus.ts src/components/ToastHost.tsx src/components/ToastHost.css
git commit -m "feat(waiting): waiting toast variant on the toast bus"
```

---

### Task 4: Wire detection into the per-pane log listener

**Files:**
- Modify: `src/hooks/useCompletionNotifier.ts`

- [ ] **Step 1: Feed every line to the waiting store and burst on fresh entry**

Add imports:

```ts
import { waitingPanes } from "../lib/waiting";
import { notifyWaiting } from "../lib/osNotify";
```

(`notifyCompletion` import stays; merge into one import statement.)

Inside the `onLogLine(paneId, (line) => { … })` callback, insert at the very TOP (before `parseTurnEnd` — the completion debounce must not swallow waiting):

```ts
const entered = waitingPanes.apply(paneId, line);
// ADR-0007 freshness gate: resume backfill may re-enter the STATE silently, never alerts.
if (entered && Date.now() - entered.askedAt < 8000) {
  const wctx = idxRef.current.get(paneId);
  const ws = settingsRef.current.notifications;
  if (wctx && ws.enabled) {
    if (ws.os) void notifyWaiting({ name: wctx.name, question: entered.question }, { sound: ws.sound });
    if (ws.toast) emitToast({
      kind: "waiting", question: entered.question,
      id: `${paneId}:${entered.askedAt}:waiting`, paneId,
      sessionId: wctx.sessionId, tabId: wctx.tabId, name: wctx.name, project: wctx.project,
      at: entered.askedAt, seen: true,
    });
  }
}
```

Also update the hook's doc comment first line to: `/** Detects Completions AND waiting (blocked-on-question) transitions from each live pane's transcript …`.

- [ ] **Step 2: Verify compile + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean; all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useCompletionNotifier.ts
git commit -m "feat(waiting): detect waiting from pane log stream + one-shot burst"
```

---

### Task 5: PaneState + pane chip (elapsed label) + pane frame

**Files:**
- Modify: `src/lib/paneState.ts:1`
- Modify: `src/components/TerminalPane.tsx`
- Modify: `src/components/PaneHeader.tsx`
- Modify: `src/components/PaneHeader.css` (append)
- Modify: `src/components/TerminalPane.css` (append)

- [ ] **Step 1: Widen the union in `src/lib/paneState.ts`**

```ts
export type PaneState = "idle" | "working" | "waiting";
```

(`deriveState` body unchanged — it still returns only idle/working; waiting is composed by consumers.)

- [ ] **Step 2: Compose waiting in `src/components/TerminalPane.tsx`**

Add import:

```ts
import { waitingPanes, waitingLabel } from "../lib/waiting";
```

Add state next to `const [state, setState] = useState<PaneState>("idle");`:

```ts
const [waitLabel, setWaitLabel] = useState<string | null>(null);
```

Replace the `const tick = setInterval(…)` block with:

```ts
const tick = setInterval(() => {
  const w = waitingPanes.get(paneId);
  const now = Date.now();
  setState(w ? "waiting" : deriveState({ lastLineAt: entry.lastLineAt.current }, now, 800));
  setWaitLabel(w ? waitingLabel(w.askedAt, now) : null);
}, 400);
```

Root div className — add the waiting hook:

```tsx
className={`cockpit-pane${state === "working" ? " is-working" : ""}${state === "waiting" ? " is-waiting" : ""}${focused ? " is-focused" : ""}${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}`}
```

PaneHeader call — replace `working={state === "working"}` with:

```tsx
state={state}
waitLabel={waitLabel}
```

- [ ] **Step 3: Chip in `src/components/PaneHeader.tsx`**

Props: replace `working: boolean;` with:

```ts
state: PaneState;
waitLabel: string | null;
```

and add the import:

```ts
import type { PaneState } from "../lib/paneState";
```

Destructure `state, waitLabel` instead of `working`. Replace the chip markup with:

```tsx
<span className={`pane-head__chip${state === "working" ? " is-working" : ""}${state === "waiting" ? " is-waiting" : ""}`}>
  <span className="pane-head__dot" />
  <span className="pane-head__bars"><i /><i /><i /></span>
  <span className="pane-head__lbl">{state === "waiting" ? (waitLabel ?? "waiting") : state}</span>
</span>
```

- [ ] **Step 4: Append to `src/components/PaneHeader.css`**

```css
.pane-head__chip.is-waiting { background: color-mix(in srgb, var(--ck-yellow) 16%, transparent); color: var(--ck-yellow);
  border-color: color-mix(in srgb, var(--ck-yellow) 55%, transparent); }
.pane-head__chip.is-waiting .pane-head__dot { animation: pane-wait 1.6s ease-in-out infinite; }
@keyframes pane-wait { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .pane-head__chip.is-waiting .pane-head__dot { animation: none; } }
```

- [ ] **Step 5: Append to `src/components/TerminalPane.css`**

```css
.cockpit-pane.is-waiting { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ck-yellow) 30%, transparent); }
```

- [ ] **Step 6: Verify compile + suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean; PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/paneState.ts src/components/TerminalPane.tsx src/components/PaneHeader.tsx src/components/PaneHeader.css src/components/TerminalPane.css
git commit -m "feat(waiting): third PaneState + amber chip with elapsed time"
```

---

### Task 6: Tab badge

**Files:**
- Modify: `src/components/TabBar.tsx`
- Modify: `src/components/TabBar.css` (append)

- [ ] **Step 1: Track waiting tabs in the existing poll**

Add import:

```ts
import { waitingPanes } from "../lib/waiting";
```

Add state next to `working`:

```ts
const [waiting, setWaiting] = useState<Set<string>>(() => new Set());
```

Replace the interval body with:

```ts
const id = setInterval(() => {
  const now = Date.now();
  const w = new Set<string>();
  const ask = new Set<string>();
  for (const t of layoutRef.current.tabs) {
    const panes = t.rows.flatMap((r) => r.panes);
    if (panes.some((p) => waitingPanes.get(p.id))) ask.add(t.id);
    if (panes.some((p) => deriveState({ lastLineAt: paneLastLineAt(p.id) }, now, 800) === "working")) w.add(t.id);
  }
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...b].every((x) => a.has(x));
  setWorking((prev) => (same(prev, w) ? prev : w));
  setWaiting((prev) => (same(prev, ask) ? prev : ask));
}, 400);
```

- [ ] **Step 2: Render the `?` indicator**

Inside the tab map, add `const isWaiting = waiting.has(t.id);` and replace the indicator conditional with:

```tsx
{isWaiting ? (
  <span className="cockpit-tab__ask" aria-hidden="true">?</span>
) : isWorking ? (
  <span className="cockpit-tab__eq" aria-hidden="true"><i /><i /><i /></span>
) : (
  <span className="cockpit-tab__dot" aria-hidden="true" />
)}
```

- [ ] **Step 3: Append to `src/components/TabBar.css`**

```css
.cockpit-tab__ask { flex: none; width: 13px; height: 13px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-size: 9.5px; font-weight: 800; color: var(--ck-bg); background: var(--ck-yellow); animation: cockpit-tab-ask 1.6s ease-in-out infinite; }
@keyframes cockpit-tab-ask { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .cockpit-tab__ask { animation: none; } }
```

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit && npm test` → clean, PASS.

```bash
git add src/components/TabBar.tsx src/components/TabBar.css
git commit -m "feat(waiting): tab waiting indicator"
```

---

### Task 7: Beacon (state builder + window)

**Files:**
- Modify: `src/lib/beaconState.ts`
- Test: `src/lib/beaconState.test.ts`
- Modify: `src/components/CockpitView.tsx` (beacon emitter)
- Modify: `src/beacon/Beacon.tsx`
- Modify: `src/beacon/Beacon.css` (append)

- [ ] **Step 1: Failing tests — update `src/lib/beaconState.test.ts`**

Pass `new Set()` as a 4th arg in the two existing `buildBeaconState` calls, and append:

```ts
it("waiting outranks unseen and is counted", () => {
  const st = buildBeaconState(layout, [entry({})], new Set(), new Set(["p1"]));
  expect(st.waiting).toBe(1);
  expect(st.sessions[0].sessionId).toBe("s1"); // waiting first, above unseen s2
  expect(st.sessions[0].status).toBe("waiting");
});
```

Run: `npx vitest run src/lib/beaconState.test.ts` → FAIL (arity/`waiting` missing).

- [ ] **Step 2: Implement in `src/lib/beaconState.ts`**

- `BeaconSession.status` type → `"working" | "idle" | "waiting"`.
- `BeaconState` → `{ sessions: BeaconSession[]; totalUnseen: number; working: number; waiting: number }`.
- Signature → `buildBeaconState(layout: Layout, entries: Completion[], workingPaneIds: Set<string>, waitingPaneIds: Set<string>): BeaconState`.
- Status per pane:

```ts
status: waitingPaneIds.has(p.id) ? "waiting" : workingPaneIds.has(p.id) ? "working" : "idle",
```

- Rank (waiting first):

```ts
const rank = (s: BeaconSession) => (s.status === "waiting" ? 0 : s.unseen ? 1 : s.status === "working" ? 2 : 3);
```

- Return:

```ts
return {
  sessions, totalUnseen,
  working: sessions.filter((s) => s.status === "working").length,
  waiting: sessions.filter((s) => s.status === "waiting").length,
};
```

- Update the doc comment: sorted waiting-first, then unseen, working, idle.

Run: `npx vitest run src/lib/beaconState.test.ts` → PASS.

- [ ] **Step 3: Emitter in `src/components/CockpitView.tsx`**

Add import `import { waitingPanes } from "../lib/waiting";`. In the beacon-snapshot `tick`, replace the working-set loop + emit with:

```ts
const working = new Set<string>();
const waiting = new Set<string>();
for (const t of layout.tabs) for (const r of t.rows) for (const p of r.panes) {
  if (waitingPanes.get(p.id)) waiting.add(p.id);
  else if (deriveState({ lastLineAt: paneLastLineAt(p.id) }, now, 800) === "working") working.add(p.id);
}
void emit("cockpit://beacon-state", buildBeaconState(layout, notifications.list(), working, waiting));
```

- [ ] **Step 4: Window in `src/beacon/Beacon.tsx`**

```ts
const EMPTY: BeaconState = { sessions: [], totalUnseen: 0, working: 0, waiting: 0 };
const mode = st.waiting > 0 ? "ask" : st.totalUnseen > 0 ? "done" : st.working > 0 ? "work" : "idle";
```

Bar contents:

```tsx
{mode === "ask" && <span className="beacon__ping beacon__ping--ask"><i /><b /></span>}
{mode === "done" && <span className="beacon__ping"><i /><b /></span>}
{mode === "work" && <span className="beacon__eq"><i /><i /><i /></span>}
{mode === "idle" && <span className="beacon__dot" />}
{mode !== "idle" && <span className="beacon__num">{mode === "ask" ? st.waiting : mode === "done" ? st.totalUnseen : st.working}</span>}
<span className="beacon__lbl">{mode === "ask" ? "waiting" : mode === "done" ? "done" : mode === "work" ? "working" : "idle"}</span>
```

Row class (waiting beats unseen):

```tsx
className={`beacon-row beacon-row--${s.status === "waiting" ? "waiting" : s.unseen ? "done" : s.status}`}
```

- [ ] **Step 5: Append to `src/beacon/Beacon.css`** (beacon window has no theme vars — keep fallbacks)

```css
.beacon--ask { --bn-ec: var(--ck-yellow, #E8B64C); --bn-eg: rgba(232, 182, 76, 0.5); animation: beacon-edge 1.6s ease-in-out infinite; }
.beacon--ask .beacon__num { color: var(--ck-yellow, #E8B64C); }
.beacon__ping--ask b { background: var(--ck-yellow, #E8B64C); box-shadow: 0 0 10px var(--ck-yellow, #E8B64C); }
.beacon__ping--ask i { border-color: var(--ck-yellow, #E8B64C); }
.beacon-row--waiting .beacon-row__mark { background: var(--ck-yellow, #E8B64C); box-shadow: 0 0 7px var(--ck-yellow, #E8B64C); }
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npm test` → clean, PASS.

```bash
git add src/lib/beaconState.ts src/lib/beaconState.test.ts src/components/CockpitView.tsx src/beacon/Beacon.tsx src/beacon/Beacon.css
git commit -m "feat(waiting): Beacon waiting mode + waiting-first rows"
```

---

### Task 8: Mission Control bays

**Files:**
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/Dashboard.css` (append)

- [ ] **Step 1: Compose waiting into the items**

Add import `import { waitingPanes, waitingLabel } from "../lib/waiting";`. Replace the `items` mapping + `workCount`:

```ts
const items = overviewItems(layout).map((it) => {
  const last = paneLastLineAt(it.paneId);
  const w = waitingPanes.get(it.paneId);
  return {
    ...it,
    working: !w && deriveState({ lastLineAt: last }, now, 800) === "working",
    waitLabel: w ? waitingLabel(w.askedAt, now) : null,
    when: ago(last, now),
  };
});
const workCount = items.filter((i) => i.working).length;
const waitCount = items.filter((i) => i.waitLabel != null).length;
```

Readout — insert after the working stat:

```tsx
<div className="cockpit-dash__stat is-ask"><b>{waitCount}</b><span>waiting</span></div>
```

Bay button className:

```tsx
className={`cockpit-bay${it.working ? " is-working" : ""}${it.waitLabel ? " is-waiting" : ""}`}
```

Badge text:

```tsx
{it.waitLabel ?? (it.working ? "working" : "idle")}
```

- [ ] **Step 2: Append to `src/components/Dashboard.css`**

```css
.cockpit-dash__stat.is-ask b { color: var(--ck-yellow); }
.cockpit-bay.is-waiting .cockpit-bay__rail { background: var(--ck-yellow); }
.cockpit-bay.is-waiting .cockpit-bay__badge { background: color-mix(in srgb, var(--ck-yellow) 14%, transparent); color: var(--ck-yellow); border-color: color-mix(in srgb, var(--ck-yellow) 50%, transparent); }
.cockpit-bay.is-waiting { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ck-yellow) 22%, transparent); }
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm test` → clean, PASS.

```bash
git add src/components/Dashboard.tsx src/components/Dashboard.css
git commit -m "feat(waiting): Mission Control waiting bays + stat"
```

---

### Task 9: Lifecycle clears (pty exit / pane close)

**Files:**
- Modify: `src/lib/terminalRegistry.ts`

- [ ] **Step 1: Clear waiting when the pane's process dies or the pane closes**

Add import `import { waitingPanes } from "./waiting";`. In `acquireTerminal`, replace the `onPtyExit` line with:

```ts
onPtyExit(paneId, () => { waitingPanes.clear(paneId); term.write(`\r\n[${opts.provider} exited]\r\n`); });
```

In `releaseTerminal`, add after `routed.delete(paneId);`:

```ts
waitingPanes.clear(paneId);
```

(Relaunches — HR/PT toggles — go through `killPty`, which fires pty exit → covered; a still-pending ask on `--resume` re-enters SILENTLY via the stale-timestamp gate.)

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npm test` → clean, PASS.

```bash
git add src/lib/terminalRegistry.ts
git commit -m "feat(waiting): clear waiting on pty exit and pane close"
```

---

### Task 10: Docs + final verification

**Files:**
- Modify: `CONTEXT.md` (Working state entry)
- Modify: `docs/feature-matrix.md` (new row)
- Modify: `SPEC.md` (status log)

- [ ] **Step 1: Update the `Working state` entry in `CONTEXT.md`** — replace the whole entry with:

```markdown
**Working state**:
A Session's live status: `working` (turn in progress), `idle` (turn finished, awaiting
you), or `waiting` (blocked mid-turn on a question YOU must answer — an AskUserQuestion
in the transcript; permissions are skipped, but questions still block). Waiting is a live
state, not a ledger event: one notification burst on entry, self-clears when answered.
Drives the per-pane status + ambient juice.
_Avoid_: busy, running, blocked (be specific: working vs idle vs waiting)
```

- [ ] **Step 2: Add a row to `docs/feature-matrix.md`** (after the "Completion notifications" row)

```markdown
| Waiting state (question detection) | Shipped after v0.9.0 | JSONL `AskUserQuestion` detection → amber chip/tab/Beacon/bays + one-shot toast/macOS alert. |
```

- [ ] **Step 3: Append a status block to `SPEC.md`**

```markdown
## Status — updated 2026-07-02

- **M11 — Waiting state**: panes detect "blocked on AskUserQuestion" from the tailed JSONL
  (enter on the tool_use; clear on matching tool_result / new assistant message id / typed
  prompt / pty exit; ADR-0007 freshness gate for resume backfill). Third PaneState value
  `waiting` overrides the PTY heuristic; amber chip with elapsed time, tab `?` indicator,
  Beacon "waiting" mode + waiting-first rows, Mission Control bays/stat, one-shot
  toast/macOS/chime burst through the existing notification switches. Claude-only (Codex
  panes keep the PTY heuristic). Spec: docs/superpowers/specs/2026-07-02-waiting-state-design.md.
```

- [ ] **Step 4: Full verification**

Run: `npm test` → all suites PASS.
Run: `npm run build` → tsc + vite build succeed.

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md docs/feature-matrix.md SPEC.md docs/superpowers/specs/2026-07-02-waiting-state-design.md docs/superpowers/plans/2026-07-02-waiting-state.md
git commit -m "docs(waiting): waiting state in glossary, feature matrix, SPEC status"
```
