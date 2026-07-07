# Canvas View (M13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `⌶ Tabs ⇄ ▦ Canvas` workspace mode where every session is a draggable card (status + CNVS-style activity log) on a pan/zoom canvas — with gestures that never touch React rendering (hard no-lag requirement).

**Architecture:** One world `<div>` carrying `translate+scale`; cards absolutely positioned in world coordinates. During gestures, transforms are written directly to DOM nodes via refs (rAF-batched); React state is committed once on gesture end. Activity feed is a pure TS fold over the JSONL lines the frontend already receives (`onLogLine`) — zero Rust changes. Spec: `docs/superpowers/specs/2026-07-07-canvas-view-design.md`.

**Tech Stack:** React 19 + TypeScript (strict), vitest (`// @vitest-environment jsdom` pragma per test file that touches localStorage), plain CSS files per component (`--ck-*` theme vars), Tauri 2 webview (macOS WKWebView: trackpad pinch arrives as `wheel` with `ctrlKey`).

**Working directory:** `/Users/theerametsaengsin/Work/claude-cockpit/.worktrees/wren` (branch `wren`). Run tests with `npm test` (vitest run), typecheck+build with `npm run build`.

**Codebase facts a fresh engineer needs:**
- `overviewItems(layout)` (`src/components/paneFlatten.ts`) = flat list `{ paneId, title, cwd, sessionId, tabId, tabIndex }` of every pane — the Dashboard's data source, reused as-is.
- Live status: `paneLastLineAt(paneId)` (`src/lib/terminalRegistry.ts`) + `deriveState({ lastLineAt }, now, 800)` (`src/lib/paneState.ts`) → "working"/"idle"; `waitingPanes.get(paneId)` (`src/lib/waiting.ts`) overrides with waiting + `waitingLabel(askedAt, now)`. The Dashboard polls this on a 400 ms `setInterval` — copy that pattern.
- Cost: `costOf(await sessionUsage(cwd, sessionId))` (`src/lib/pricing.ts`, `src/lib/costClient.ts`), polled every 3 s (Dashboard pattern).
- Every pane's JSONL lines reach the frontend in `useCompletionNotifier` (`src/hooks/useCompletionNotifier.ts`, the `onLogLine(paneId, (line) => ...)` callback) — this is where `waitingPanes.apply` already runs and where the activity store plugs in.
- `debounce(fn, ms)` (`src/lib/debounce.ts`) returns a debounced fn with `.cancel()`.
- Terminals live OUTSIDE React in `terminalRegistry`; hiding React containers with CSS never kills a session. `refit()` skips zero-sized hosts; each pane's ResizeObserver refits it when it becomes visible again — so hiding the whole Tabs stack while in canvas mode is safe.

---

### Task 1: `canvasMath.ts` — pure camera + placement math

**Files:**
- Create: `src/components/canvasMath.ts`
- Test: `src/components/canvasMath.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/canvasMath.test.ts
import { describe, it, expect } from "vitest";
import {
  clampZoom, screenToWorld, worldToScreen, zoomAt, panBy, isDrag,
  nextFreeCell, fitAll, prunePositions,
  ZOOM_MIN, ZOOM_MAX, CARD_W, CARD_H, CELL_W, CELL_H,
} from "./canvasMath";

const cam = { x: 100, y: 50, zoom: 2 };

describe("camera transforms", () => {
  it("screen↔world round-trips", () => {
    const s = { x: 400, y: 300 };
    const back = worldToScreen(screenToWorld(s, cam), cam);
    expect(back.x).toBeCloseTo(s.x);
    expect(back.y).toBeCloseTo(s.y);
  });
  it("zoomAt keeps the world point under the cursor fixed", () => {
    const s = { x: 400, y: 300 };
    const before = screenToWorld(s, cam);
    const after = screenToWorld(s, zoomAt(cam, s, 1.5));
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
  it("zoomAt clamps to [ZOOM_MIN, ZOOM_MAX]", () => {
    expect(zoomAt(cam, { x: 0, y: 0 }, 100).zoom).toBe(ZOOM_MAX);
    expect(zoomAt(cam, { x: 0, y: 0 }, 0.0001).zoom).toBe(ZOOM_MIN);
    expect(clampZoom(3)).toBe(ZOOM_MAX);
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
  });
  it("panBy shifts in screen space", () => {
    expect(panBy(cam, 10, -20)).toEqual({ x: 110, y: 30, zoom: 2 });
  });
});

describe("isDrag", () => {
  it("under the 5px threshold is a click", () => {
    expect(isDrag(4, -4)).toBe(false);
    expect(isDrag(6, 0)).toBe(true);
    expect(isDrag(0, -6)).toBe(true);
  });
});

describe("nextFreeCell", () => {
  it("starts at the origin and fills reading order", () => {
    expect(nextFreeCell([])).toEqual({ x: 0, y: 0 });
    expect(nextFreeCell([{ x: 0, y: 0 }])).toEqual({ x: CELL_W, y: 0 });
  });
  it("wraps to the next row after 4 columns", () => {
    const row0 = [0, 1, 2, 3].map((c) => ({ x: c * CELL_W, y: 0 }));
    expect(nextFreeCell(row0)).toEqual({ x: 0, y: CELL_H });
  });
  it("treats a dragged (off-grid) card as occupying its nearest cell", () => {
    // a card dragged a few px off the origin still blocks cell (0,0)
    expect(nextFreeCell([{ x: 12, y: -9 }])).toEqual({ x: CELL_W, y: 0 });
  });
});

describe("fitAll", () => {
  it("no cards → identity camera", () => {
    expect(fitAll([], { w: 800, h: 600 })).toEqual({ x: 0, y: 0, zoom: 1 });
  });
  it("a single card at the origin is centered at zoom 1", () => {
    const c = fitAll([{ x: 0, y: 0 }], { w: 800, h: 600 });
    expect(c.zoom).toBe(1);
    expect(c.x).toBeCloseTo((800 - CARD_W) / 2);
    expect(c.y).toBeCloseTo((600 - CARD_H) / 2);
  });
  it("spread-out cards zoom out until everything fits", () => {
    // spread chosen to fit WITHIN the zoom clamp: bbox 2240 wide → zoom ≈ 0.30 ≥ ZOOM_MIN.
    // (A pathological spread that needs < ZOOM_MIN just centers at 25% — clamp wins.)
    const c = fitAll([{ x: 0, y: 0 }, { x: 2000, y: 0 }], { w: 800, h: 600 });
    expect(c.zoom).toBeLessThan(1);
    expect(c.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
    // both edges on-screen: left edge of card 0 and right edge of card 1
    expect(0 * c.zoom + c.x).toBeGreaterThanOrEqual(0);
    expect((2000 + CARD_W) * c.zoom + c.x).toBeLessThanOrEqual(800);
  });
});

describe("prunePositions", () => {
  it("drops entries whose pane is gone", () => {
    const pos = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } };
    expect(prunePositions(pos, new Set(["b"]))).toEqual({ b: { x: 3, y: 4 } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/canvasMath.test.ts`
Expected: FAIL — cannot resolve `./canvasMath`.

- [ ] **Step 3: Write the implementation**

```ts
// src/components/canvasMath.ts
/** Pure math for the Canvas view (M13). The world layer renders as
 *  `transform: translate(camera.x, camera.y) scale(camera.zoom)` with
 *  transform-origin 0 0, so: screen = world × zoom + camera. */

export interface Pt { x: number; y: number }
export interface Camera { x: number; y: number; zoom: number }

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
/** Card geometry used for placement/framing. CARD_H is nominal — real cards are
 *  content-sized, but placement/fit only need a stable footprint. */
export const CARD_W = 240;
export const CARD_H = 170;
export const CELL_W = CARD_W + 24;
export const CELL_H = CARD_H + 24;
const PLACE_COLS = 4;

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}
export function screenToWorld(s: Pt, c: Camera): Pt {
  return { x: (s.x - c.x) / c.zoom, y: (s.y - c.y) / c.zoom };
}
export function worldToScreen(w: Pt, c: Camera): Pt {
  return { x: w.x * c.zoom + c.x, y: w.y * c.zoom + c.y };
}
/** Zoom by `factor` keeping the world point under screen point `s` fixed. */
export function zoomAt(c: Camera, s: Pt, factor: number): Camera {
  const zoom = clampZoom(c.zoom * factor);
  const w = screenToWorld(s, c);
  return { zoom, x: s.x - w.x * zoom, y: s.y - w.y * zoom };
}
export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { ...c, x: c.x + dx, y: c.y + dy };
}
/** A pointer that moved past the threshold is a drag, not a click. */
export function isDrag(dx: number, dy: number, threshold = 5): boolean {
  return Math.abs(dx) > threshold || Math.abs(dy) > threshold;
}
/** First free grid cell in reading order (PLACE_COLS columns). A card occupies the
 *  cell its origin rounds to, so hand-dragged cards still block their neighborhood. */
export function nextFreeCell(taken: Pt[]): Pt {
  const cellOf = (p: Pt) => `${Math.round(p.x / CELL_W)},${Math.round(p.y / CELL_H)}`;
  const used = new Set(taken.map(cellOf));
  for (let row = 0; ; row++) {
    for (let col = 0; col < PLACE_COLS; col++) {
      const p = { x: col * CELL_W, y: row * CELL_H };
      if (!used.has(cellOf(p))) return p;
    }
  }
}
/** Frame every card: fit the padded bounding box in the viewport, never zooming IN past 1. */
export function fitAll(pts: Pt[], view: { w: number; h: number }, pad = 60): Camera {
  if (pts.length === 0) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxX = Math.max(...pts.map((p) => p.x)) + CARD_W;
  const maxY = Math.max(...pts.map((p) => p.y)) + CARD_H;
  const bw = maxX - minX, bh = maxY - minY;
  const zoom = clampZoom(Math.min((view.w - pad * 2) / bw, (view.h - pad * 2) / bh, 1));
  return { zoom, x: (view.w - bw * zoom) / 2 - minX * zoom, y: (view.h - bh * zoom) / 2 - minY * zoom };
}
/** Drop stored positions whose pane is gone so the persisted blob never grows. */
export function prunePositions(pos: Record<string, Pt>, live: Set<string>): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  for (const [id, p] of Object.entries(pos)) if (live.has(id)) out[id] = p;
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/canvasMath.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/canvasMath.ts src/components/canvasMath.test.ts
git commit -m "feat(canvas): camera + placement math for the canvas view"
```

---

### Task 2: `activity.ts` — tool_use fold + per-pane ring buffer

**Files:**
- Create: `src/lib/activity.ts`
- Modify: `src/lib/__fixtures__/transcriptLines.ts` (append one fixture)
- Test: `src/lib/activity.test.ts`

- [ ] **Step 1: Append the multi-block fixture to `transcriptLines.ts`**

Append at the end of `src/lib/__fixtures__/transcriptLines.ts`:

```ts
/** Assistant message with PARALLEL tool_use blocks (Edit + Read) written as one
 *  record — the activity feed must surface both. Same real shape as ASSISTANT_TOOL_USE. */
export const ASSISTANT_EDIT = JSON.stringify({
  parentUuid: "5f02189c-45db-4fc7-8b22-4b5f65f7b65e",
  isSidechain: false,
  message: {
    model: "claude-fable-5",
    id: "msg_EDIT1",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_EDIT1",
        name: "Edit",
        input: { file_path: "/Users/example/project/src/components/CanvasView.tsx", old_string: "a", new_string: "b" },
      },
      {
        type: "tool_use",
        id: "toolu_READ1",
        name: "Read",
        input: { file_path: "/Users/example/project/src/components/dragMath.ts" },
      },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 2, cache_read_input_tokens: 290000, output_tokens: 90 },
    diagnostics: null,
  },
  requestId: "req_EDIT1",
  type: "assistant",
  uuid: "d4d4d4d4-0000-4000-8000-000000000001",
  timestamp: "2026-07-07T04:00:00.000Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/example/project",
  sessionId: "ad31a042-e0c0-48d9-9392-850df5077453",
  version: "2.1.185",
  gitBranch: "main",
});
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/activity.test.ts
import { describe, it, expect } from "vitest";
import { activityOf, createActivityStore } from "./activity";
import {
  ASSISTANT_TOOL_USE, ASSISTANT_ASK, ASSISTANT_EDIT, ASSISTANT_END_TURN,
  SIDECHAIN_ASSISTANT, USER_TOOL_RESULT, GARBAGE,
} from "./__fixtures__/transcriptLines";

describe("activityOf", () => {
  it("parses a Bash tool_use into a command detail", () => {
    expect(activityOf(ASSISTANT_TOOL_USE)).toEqual([{
      toolUseId: "toolu_REDACTED", tool: "Bash", detail: "ls .",
      at: Date.parse("2026-06-22T09:54:36.932Z"),
    }]);
  });
  it("parses parallel blocks and shortens file tools to the basename", () => {
    const acts = activityOf(ASSISTANT_EDIT);
    expect(acts).toHaveLength(2);
    expect(acts[0]).toMatchObject({ tool: "Edit", detail: "CanvasView.tsx" });
    expect(acts[1]).toMatchObject({ tool: "Read", detail: "dragMath.ts" });
  });
  it("parses AskUserQuestion to its first question", () => {
    expect(activityOf(ASSISTANT_ASK)[0]).toMatchObject({
      tool: "AskUserQuestion", detail: "Which auth method should the API use?",
    });
  });
  it("returns [] for text-only, user, sidechain, and garbage lines", () => {
    expect(activityOf(ASSISTANT_END_TURN)).toEqual([]);
    expect(activityOf(USER_TOOL_RESULT)).toEqual([]);
    expect(activityOf(SIDECHAIN_ASSISTANT)).toEqual([]);
    expect(activityOf(GARBAGE)).toEqual([]);
  });
});

describe("createActivityStore", () => {
  it("keeps the newest `cap` entries, newest first", () => {
    const store = createActivityStore(3);
    store.apply("p1", ASSISTANT_TOOL_USE); // Bash
    store.apply("p1", ASSISTANT_EDIT);     // Edit + Read (2 entries)
    store.apply("p1", ASSISTANT_ASK);      // AskUserQuestion → 4 total, capped at 3
    const acts = store.get("p1");
    expect(acts.map((a) => a.tool)).toEqual(["AskUserQuestion", "Edit", "Read"]);
  });
  it("dedupes re-processed lines by toolUseId (resume backfill)", () => {
    const store = createActivityStore(3);
    store.apply("p1", ASSISTANT_TOOL_USE);
    store.apply("p1", ASSISTANT_TOOL_USE);
    expect(store.get("p1")).toHaveLength(1);
  });
  it("panes are independent and clear() empties one", () => {
    const store = createActivityStore(3);
    store.apply("p1", ASSISTANT_TOOL_USE);
    store.apply("p2", ASSISTANT_ASK);
    store.clear("p1");
    expect(store.get("p1")).toEqual([]);
    expect(store.get("p2")).toHaveLength(1);
  });
  it("ignores replayed lines whose entries were already evicted (full-file re-tail)", () => {
    const store = createActivityStore(3);
    store.apply("p1", ASSISTANT_TOOL_USE); // Bash — will be evicted by the next two lines
    store.apply("p1", ASSISTANT_EDIT);     // Edit + Read
    store.apply("p1", ASSISTANT_ASK);      // AskUserQuestion → Bash evicted
    // logtail_start always re-reads from offset 0 → the whole file replays:
    store.apply("p1", ASSISTANT_TOOL_USE);
    store.apply("p1", ASSISTANT_EDIT);
    store.apply("p1", ASSISTANT_ASK);
    expect(store.get("p1").map((a) => a.tool)).toEqual(["AskUserQuestion", "Edit", "Read"]);
  });
});
```

Note on ordering: within one line, blocks are content-ordered oldest→newest; the buffer is newest-first ACROSS lines but preserves block order WITHIN a line (so `Edit, Read` — not `Read, Edit` — sit under the newer `AskUserQuestion`).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- src/lib/activity.test.ts`
Expected: FAIL — cannot resolve `./activity`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/activity.ts
/** CNVS-style activity feed: the last few tool actions per pane, folded from the same
 *  JSONL lines that feed waiting.ts (the frontend already receives every line via
 *  onLogLine — no Rust involved). Pure parse + a per-pane ring-buffer store. */

export interface ActivityEntry {
  toolUseId: string;
  tool: string;
  detail: string; // "" when the tool has no summarizable input
  at: number;     // ms epoch of the line's timestamp
}

const FILE_TOOLS = new Set(["Edit", "Write", "Read", "NotebookEdit"]);

function detailOf(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (name === "Bash") {
    const c = typeof inp?.command === "string" ? inp.command : "";
    return c.replace(/\s+/g, " ").trim().slice(0, 40);
  }
  if (FILE_TOOLS.has(name)) {
    const p = typeof inp?.file_path === "string" ? inp.file_path : "";
    return p.split("/").filter(Boolean).pop() ?? "";
  }
  if (name === "Task") {
    return typeof inp?.description === "string" ? inp.description.slice(0, 40) : "";
  }
  if (name === "AskUserQuestion") {
    const qs = inp?.questions;
    const q = Array.isArray(qs) ? qs[0]?.question : undefined;
    return typeof q === "string" ? q.slice(0, 40) : "";
  }
  return "";
}

/** Tool actions in one transcript line ([] for anything else). Sidechain (subagent)
 *  lines are skipped — the card narrates the MAIN thread, like the pane header does. */
export function activityOf(line: string): ActivityEntry[] {
  let v: any;
  try { v = JSON.parse(line); } catch { return []; }
  if (!v || typeof v !== "object" || v.isSidechain || v.type !== "assistant") return [];
  const at = typeof v.timestamp === "string" ? Date.parse(v.timestamp) : NaN;
  if (Number.isNaN(at)) return [];
  const blocks: any[] = Array.isArray(v.message?.content) ? v.message.content : [];
  return blocks
    .filter((b) => b?.type === "tool_use" && typeof b.name === "string" && typeof b.id === "string")
    .map((b) => ({ toolUseId: b.id, tool: b.name, detail: detailOf(b.name, b.input), at }));
}

/** Per-pane ring buffer of the newest `cap` entries, newest line first (block order
 *  preserved within a line). Dedupes by toolUseId against everything the pane has EVER
 *  seen — not just the visible window — because logtail re-tails files from offset 0,
 *  and a full-file replay must not resurrect evicted entries as "newest". */
export function createActivityStore(cap = 3) {
  const panes = new Map<string, { entries: ActivityEntry[]; seen: Set<string> }>();
  return {
    apply(paneId: string, line: string): void {
      const parsed = activityOf(line);
      if (!parsed.length) return;
      let pane = panes.get(paneId);
      if (!pane) { pane = { entries: [], seen: new Set() }; panes.set(paneId, pane); }
      const fresh = parsed.filter((e) => !pane.seen.has(e.toolUseId));
      if (!fresh.length) return;
      for (const e of fresh) pane.seen.add(e.toolUseId);
      pane.entries = [...fresh, ...pane.entries].slice(0, cap);
    },
    get(paneId: string): ActivityEntry[] { return panes.get(paneId)?.entries ?? []; },
    clear(paneId: string): void { panes.delete(paneId); },
  };
}

/** App-wide singleton (in-memory, like waitingPanes). */
export const paneActivity = createActivityStore();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/activity.test.ts`
Expected: PASS (8 tests). Also run `npm test -- src/lib/waiting.test.ts src/lib/completion.test.ts` — the fixture append must not break existing suites.

- [ ] **Step 6: Commit**

```bash
git add src/lib/activity.ts src/lib/activity.test.ts src/lib/__fixtures__/transcriptLines.ts
git commit -m "feat(canvas): activity feed — tool_use fold + per-pane ring buffer"
```

---

### Task 3: persistence — viewMode + canvas state

**Files:**
- Modify: `src/lib/persistence.ts` (append)
- Test: `src/lib/persistence.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/persistence.test.ts` (file already has the `// @vitest-environment jsdom` pragma and a `beforeEach` that clears localStorage — add inside the top-level scope):

```ts
import { loadViewMode, saveViewMode, loadCanvasState, saveCanvasState, type CanvasState } from "./persistence";

describe("canvas persistence", () => {
  it("viewMode defaults to tabs and round-trips canvas", () => {
    expect(loadViewMode()).toBe("tabs");
    saveViewMode("canvas");
    expect(loadViewMode()).toBe("canvas");
    saveViewMode("tabs");
    expect(loadViewMode()).toBe("tabs");
  });
  it("viewMode ignores a corrupt stored value", () => {
    localStorage.setItem("cockpit.viewMode.v1", "sideways");
    expect(loadViewMode()).toBe("tabs");
  });
  it("canvas state round-trips and defaults to null", () => {
    expect(loadCanvasState()).toBeNull();
    const s: CanvasState = { camera: { x: 10, y: -5, zoom: 1.5 }, positions: { p1: { x: 0, y: 0 } } };
    saveCanvasState(s);
    expect(loadCanvasState()).toEqual(s);
  });
  it("canvas state survives corrupt JSON as null", () => {
    localStorage.setItem("cockpit.canvas.v1", "{nope");
    expect(loadCanvasState()).toBeNull();
  });
});
```

(If the existing `beforeEach(localStorage.clear)` lives inside the `describe("persistence")` block, add `beforeEach(() => localStorage.clear());` inside the new describe too.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/persistence.test.ts`
Expected: FAIL — no exported member `loadViewMode`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/persistence.ts`:

```ts
const VIEWMODE = "cockpit.viewMode.v1";
const CANVAS = "cockpit.canvas.v1";

export type ViewMode = "tabs" | "canvas";
export interface CanvasState {
  camera: { x: number; y: number; zoom: number };
  positions: Record<string, { x: number; y: number }>;
}

export function saveViewMode(v: ViewMode): void {
  try { localStorage.setItem(VIEWMODE, v); } catch { /* ignore */ }
}
export function loadViewMode(): ViewMode {
  try { return localStorage.getItem(VIEWMODE) === "canvas" ? "canvas" : "tabs"; } catch { return "tabs"; }
}
export function saveCanvasState(s: CanvasState): void {
  try { localStorage.setItem(CANVAS, JSON.stringify(s)); } catch { /* ignore */ }
}
export function loadCanvasState(): CanvasState | null {
  try { const r = localStorage.getItem(CANVAS); return r ? (JSON.parse(r) as CanvasState) : null; } catch { return null; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/persistence.test.ts`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/persistence.ts src/lib/persistence.test.ts
git commit -m "feat(canvas): persist view mode, card positions, and camera"
```

---

### Task 4: feed the activity store + clear on pane close

**Files:**
- Modify: `src/hooks/useCompletionNotifier.ts` (2 lines)
- Modify: `src/lib/terminalRegistry.ts` (2 lines)

No new tests — pure glue into two existing call sites; the store logic was tested in Task 2.

- [ ] **Step 1: Feed the store in `useCompletionNotifier.ts`**

Add the import next to the `waitingPanes` import:

```ts
import { paneActivity } from "../lib/activity";
```

In the `onLogLine(paneId, (line) => {` callback, add as the FIRST line of the body (before `const entered = waitingPanes.apply(paneId, line);`):

```ts
        paneActivity.apply(paneId, line);
```

- [ ] **Step 2: Clear on real close in `terminalRegistry.ts`**

Add the import next to the `waitingPanes` import:

```ts
import { paneActivity } from "./activity";
```

In `releaseTerminal(paneId)`, add after `waitingPanes.clear(paneId);`:

```ts
  paneActivity.clear(paneId);
```

- [ ] **Step 3: Typecheck + full test run**

Run: `npx tsc --noEmit && npm test`
Expected: clean typecheck, all suites PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCompletionNotifier.ts src/lib/terminalRegistry.ts
git commit -m "feat(canvas): wire activity feed into log tail + pane lifecycle"
```

---

### Task 5: `CanvasView` component + CSS

**Files:**
- Create: `src/components/CanvasView.tsx`
- Create: `src/components/CanvasView.css`

All gesture-testable logic already lives in `canvasMath.ts` (Task 1); this component is imperative DOM plumbing verified by typecheck now and GUI in Task 7 (matches the codebase norm — no component render tests).

**The one perf rule, stated once:** world/card transforms are NEVER set from JSX. They are written imperatively (initial mount, gesture frames, and a layout effect that re-stamps committed state). That way the 400 ms status re-render can't fight a live gesture, and a gesture frame costs one GPU composite.

- [ ] **Step 1: Write `src/components/CanvasView.tsx`**

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Layout } from "../layout/paneLayout";
import { overviewItems } from "./paneFlatten";
import { paneLastLineAt } from "../lib/terminalRegistry";
import { deriveState } from "../lib/paneState";
import { waitingPanes, waitingLabel } from "../lib/waiting";
import { paneActivity } from "../lib/activity";
import { sessionUsage } from "../lib/costClient";
import { costOf } from "../lib/pricing";
import { loadCanvasState, saveCanvasState } from "../lib/persistence";
import { debounce } from "../lib/debounce";
import {
  type Camera, type Pt, clampZoom, zoomAt, panBy, isDrag, nextFreeCell, fitAll, prunePositions, CARD_W,
} from "./canvasMath";
import "./CanvasView.css";

const GRID = 20; // px between background dots at zoom 1

const TOOL_ICONS: Record<string, string> = {
  Bash: "⚙", Edit: "✎", Write: "✎", NotebookEdit: "✎", Read: "→",
  Grep: "⌕", Glob: "⌕", Task: "⛓", AskUserQuestion: "?",
};
const iconOf = (tool: string) => TOOL_ICONS[tool] ?? "•";

function ago(last: number | null, now: number): string {
  if (last == null) return "—";
  const s = Math.round((now - last) / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `~${s}s ago`;
  return `${Math.round(s / 60)}m idle`;
}
const fmt = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(3) : n.toFixed(2)}`;
const shortCwd = (cwd: string) => cwd.split("/").filter(Boolean).slice(-2).join("/");

type Gesture =
  | { kind: "wheel" } // trackpad pan/pinch in flight — pauses ticks like any other gesture
  | { kind: "pan"; startX: number; startY: number; cam: Camera }
  | { kind: "card"; paneId: string; tabId: string; startX: number; startY: number; origin: Pt; live: Pt; moved: boolean };

export function CanvasView({ layout, onJump }: {
  layout: Layout;
  onJump: (tabId: string, paneId: string) => void;
}) {
  const items = overviewItems(layout);
  const itemsKey = items.map((i) => i.paneId).join(",");
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const cardRefCbs = useRef(new Map<string, (el: HTMLDivElement | null) => void>());

  // Committed truth lives in React state (drives persistence + the HUD zoom %);
  // the LIVE value during a gesture lives in refs and is written straight to the
  // DOM — React renders zero times per gesture frame (the no-lag requirement).
  // persistence.ts deliberately doesn't validate shapes (house style), so guard
  // the loaded blob here: a malformed camera would poison every transform (1/zoom).
  const [initial] = useState(() => {
    const s = loadCanvasState();
    if (!s || typeof s.camera?.x !== "number" || typeof s.camera?.y !== "number" || typeof s.camera?.zoom !== "number") return null;
    const positions: Record<string, Pt> = {};
    for (const [id, p] of Object.entries(s.positions ?? {})) {
      if (typeof p?.x === "number" && typeof p?.y === "number") positions[id] = { x: p.x, y: p.y };
    }
    return { camera: { ...s.camera, zoom: clampZoom(s.camera.zoom) }, positions };
  });
  const [camera, setCamera] = useState<Camera>(() => initial?.camera ?? { x: 0, y: 0, zoom: 1 });
  const [positions, setPositions] = useState<Record<string, Pt>>(() => initial?.positions ?? {});
  const cameraRef = useRef(camera);
  const gesture = useRef<Gesture | null>(null);
  const raf = useRef(0);

  // Derive this render's positions: prune closed panes (ghosts would mislead
  // fit-all and block free cells) and auto-place new ones. Derived synchronously
  // so this very render can stamp them; committed after via a FUNCTIONAL update
  // so a drag commit queued in the same frame is never clobbered.
  const liveIds = new Set(items.map((i) => i.paneId));
  const placed: Record<string, Pt> = prunePositions(positions, liveIds);
  let dirty = Object.keys(placed).length !== Object.keys(positions).length;
  for (const it of items) {
    if (!placed[it.paneId]) { placed[it.paneId] = nextFreeCell(Object.values(placed)); dirty = true; }
  }
  useEffect(() => {
    if (!dirty) return;
    setPositions((p) => {
      const next = prunePositions(p, liveIds);
      for (const it of items) if (!next[it.paneId]) next[it.paneId] = nextFreeCell(Object.values(next));
      return next;
    });
  });

  const applyCamera = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = cameraRef.current;
      const w = worldRef.current, r = rootRef.current;
      if (!w || !r) return;
      w.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.zoom})`;
      // The dot grid pans/zooms with the world. If this background repaint ever
      // shows in profiling, the fallback is a static grid: delete these 2 lines.
      r.style.backgroundPosition = `${c.x}px ${c.y}px`;
      r.style.backgroundSize = `${GRID * c.zoom}px ${GRID * c.zoom}px`;
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Re-stamp committed camera + positions after every render (cheap: a handful of
  // style writes). Skips the card being dragged so a stray render can't yank it.
  useLayoutEffect(() => { cameraRef.current = camera; applyCamera(); }, [camera, applyCamera]);
  useLayoutEffect(() => {
    const g = gesture.current;
    for (const it of items) {
      const el = cardEls.current.get(it.paneId);
      const p = placed[it.paneId];
      if (el && p && !(g?.kind === "card" && g.paneId === it.paneId)) {
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
    }
  });

  // First-run framing: fire once, as soon as there is anything to frame — even if
  // the canvas mounted empty and panes arrived later. A restored session with real
  // card positions keeps its saved camera instead.
  const framed = useRef(initial != null && Object.keys(initial.positions).length > 0);
  useLayoutEffect(() => {
    if (framed.current || items.length === 0) return;
    const r = rootRef.current;
    if (!r) return;
    framed.current = true;
    const cam = fitAll(Object.values(placed), { w: r.clientWidth, h: r.clientHeight });
    cameraRef.current = cam;
    setCamera(cam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  // Status tick + cost poll — the Dashboard's exact cadence, but paused while a
  // gesture is live so a re-render never lands mid-drag.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { if (!gesture.current) setNow(Date.now()); }, 400);
    return () => clearInterval(id);
  }, []);
  const [costs, setCosts] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    const fetchAll = async () => {
      const pairs = await Promise.all(overviewItems(layout).map(async (it) => {
        try { return [it.paneId, costOf(await sessionUsage(it.cwd, it.sessionId))] as const; }
        catch { return [it.paneId, 0] as const; }
      }));
      if (alive && !gesture.current) setCosts(Object.fromEntries(pairs));
    };
    void fetchAll();
    const id = setInterval(() => void fetchAll(), 3000);
    return () => { alive = false; clearInterval(id); };
  }, [layout]);

  // Persist camera + live positions (pruned of closed panes), debounced like saveLast.
  useEffect(() => {
    const live = new Set(items.map((i) => i.paneId));
    const id = setTimeout(() => saveCanvasState({ camera, positions: prunePositions(positions, live) }), 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, positions, itemsKey]);

  // Wheel = pan; pinch (wheel+ctrlKey in WKWebView) or ⌘wheel = zoom at cursor.
  // Native listener: React's onWheel can be passive, and preventDefault is required.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const commit = debounce(() => {
      if (gesture.current?.kind === "wheel") gesture.current = null;
      setCamera(cameraRef.current);
    }, 150);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // A pointer gesture owns the canvas — ignore concurrent wheel input (a zoom
      // mid-card-drag would rescale the drag's cumulative delta and jump the card).
      if (gesture.current && gesture.current.kind !== "wheel") return;
      gesture.current = { kind: "wheel" }; // wheel IS a gesture: pauses ticks/polls
      const c = cameraRef.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        // Clamp per-event delta so a notched mouse wheel (±120/notch) doesn't jump 3x.
        const factor = Math.exp(Math.max(-50, Math.min(50, -e.deltaY)) * 0.01);
        cameraRef.current = zoomAt(c, { x: e.clientX - rect.left, y: e.clientY - rect.top }, factor);
      } else {
        cameraRef.current = panBy(c, -e.deltaX, -e.deltaY);
      }
      applyCamera();
      commit();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel); commit.cancel(); };
  }, [applyCamera]);

  const registerCard = useCallback((paneId: string) => {
    const m = cardRefCbs.current;
    let cb = m.get(paneId);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) cardEls.current.set(paneId, el);
        else cardEls.current.delete(paneId);
      };
      m.set(paneId, cb);
    }
    return cb;
  }, []);

  const onBgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    rootRef.current?.setPointerCapture(e.pointerId);
    gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, cam: cameraRef.current };
  };
  const onCardPointerDown = (paneId: string, tabId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    rootRef.current?.setPointerCapture(e.pointerId);
    const origin = placed[paneId] ?? { x: 0, y: 0 };
    gesture.current = { kind: "card", paneId, tabId, startX: e.clientX, startY: e.clientY, origin, live: origin, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.kind === "wheel") return;
    // Belt-and-braces: if the up was lost (rare WebKit capture edge cases), a
    // buttons-less move ends the gesture — otherwise ticks stay paused forever.
    if (e.buttons === 0) { endGesture(false); return; }
    // Cumulative delta from a FIXED origin (the dragMath.ts lesson) — never advance the start point.
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    if (g.kind === "pan") {
      cameraRef.current = panBy(g.cam, dx, dy);
      applyCamera();
    } else {
      if (!g.moved && !isDrag(dx, dy)) return; // still a click until the threshold breaks
      g.moved = true;
      const z = cameraRef.current.zoom;
      g.live = { x: g.origin.x + dx / z, y: g.origin.y + dy / z };
      const el = cardEls.current.get(g.paneId);
      if (el) el.style.transform = `translate(${g.live.x}px, ${g.live.y}px)`;
    }
  };
  // Shared gesture end. A CANCEL (or a lost pointerup detected via buttons===0)
  // must never activate a card — only a real click jumps.
  const endGesture = (allowClick: boolean) => {
    const g = gesture.current;
    if (!g || g.kind === "wheel") return;
    gesture.current = null;
    if (g.kind === "pan") setCamera(cameraRef.current);
    else if (g.moved) setPositions((p) => ({ ...p, [g.paneId]: g.live }));
    else if (allowClick) onJump(g.tabId, g.paneId);
  };
  const onPointerUp = () => endGesture(true);
  const onPointerCancel = () => endGesture(false);

  const fitView = () => {
    const r = rootRef.current;
    if (!r) return;
    const cam = fitAll(Object.values(placed), { w: r.clientWidth, h: r.clientHeight });
    cameraRef.current = cam;
    setCamera(cam);
  };

  return (
    <div
      ref={rootRef}
      className="cockpit-cv"
      onPointerDown={onBgPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div ref={worldRef} className="cockpit-cv__world">
        {items.map((it) => {
          const w = waitingPanes.get(it.paneId);
          const working = !w && deriveState({ lastLineAt: paneLastLineAt(it.paneId) }, now, 800) === "working";
          const acts = paneActivity.get(it.paneId);
          return (
            <div
              key={it.paneId}
              ref={registerCard(it.paneId)}
              className={`cockpit-cv__card${working ? " is-working" : ""}${w ? " is-waiting" : ""}`}
              style={{ width: CARD_W }}
              onPointerDown={onCardPointerDown(it.paneId, it.tabId)}
            >
              <div className="cockpit-cv__head">
                <span className="cockpit-cv__name">{it.title}</span>
                <span className="cockpit-cv__state">{w ? `? ${waitingLabel(w.askedAt, now)}` : working ? "● working" : "● idle"}</span>
              </div>
              <div className="cockpit-cv__path">{shortCwd(it.cwd)} · tab {it.tabIndex}</div>
              {acts.length > 0 && (
                <div className="cockpit-cv__log">
                  {acts.map((a) => (
                    <div key={a.toolUseId} className="cockpit-cv__act">{iconOf(a.tool)} {a.tool}{a.detail ? ` · ${a.detail}` : ""}</div>
                  ))}
                </div>
              )}
              <div className="cockpit-cv__foot">
                <span>{fmt(costs[it.paneId] ?? 0)}</span>
                <span>{ago(paneLastLineAt(it.paneId), now)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="cockpit-cv__hud">
        <span className="cockpit-cv__zoom">{Math.round(camera.zoom * 100)}%</span>
        <button className="cockpit-cv__fit" onClick={fitView} onPointerDown={(e) => e.stopPropagation()}>⌖ fit all</button>
      </div>
      {items.length === 0 && <div className="cockpit-cv__empty">No sessions — ⌘O to open a project</div>}
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/CanvasView.css`**

```css
.cockpit-cv {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: grab;
  /* dot grid; position/size are driven per-frame from applyCamera() */
  background-image: radial-gradient(circle, color-mix(in srgb, var(--ck-text) 8%, transparent) 1px, transparent 1px);
  background-size: 20px 20px;
  touch-action: none; /* we own pan/zoom — stop the webview from scrolling */
}
.cockpit-cv:active { cursor: grabbing; }

.cockpit-cv__world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.cockpit-cv__card {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--ck-surface);
  border: 1px solid var(--ck-border);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  font-size: 12px;
  color: var(--ck-text);
}
.cockpit-cv__card.is-working { border-color: var(--ck-accent); }
.cockpit-cv__card.is-waiting {
  border-color: var(--ck-yellow);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ck-yellow) 18%, transparent), 0 6px 20px rgba(0, 0, 0, 0.35);
}

.cockpit-cv__head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.cockpit-cv__name { font-weight: 600; color: var(--ck-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cockpit-cv__state { flex: none; font-size: 11px; color: var(--ck-idle); }
.is-working > .cockpit-cv__head > .cockpit-cv__state { color: var(--ck-accent); }
.is-waiting > .cockpit-cv__head > .cockpit-cv__state { color: var(--ck-yellow); }
.cockpit-cv__path { margin-top: 2px; font-size: 10px; color: var(--ck-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cockpit-cv__log {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--ck-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  line-height: 1.8;
  color: var(--ck-text);
}
.cockpit-cv__act { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cockpit-cv__foot { display: flex; justify-content: space-between; margin-top: 8px; font-size: 10px; color: var(--ck-muted); }

.cockpit-cv__hud { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 6px; align-items: center; }
.cockpit-cv__zoom,
.cockpit-cv__fit {
  font-size: 11px;
  color: var(--ck-muted);
  background: var(--ck-surface);
  border: 1px solid var(--ck-border);
  border-radius: 6px;
  padding: 3px 9px;
}
.cockpit-cv__fit { cursor: pointer; }
.cockpit-cv__fit:hover { color: var(--ck-text); }

.cockpit-cv__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--ck-muted);
  font-size: 13px;
  pointer-events: none;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (The component isn't rendered anywhere yet — that's Task 6.)

- [ ] **Step 4: Commit**

```bash
git add src/components/CanvasView.tsx src/components/CanvasView.css
git commit -m "feat(canvas): CanvasView — pan/zoom world, draggable session cards, HUD"
```

---

### Task 6: wire it in — CockpitView, TabBar toggle, ⌘G

**Files:**
- Modify: `src/components/CockpitView.tsx`
- Modify: `src/components/TabBar.tsx` + `src/components/TabBar.css`
- Modify: `src/components/TabBar.test.tsx` (new required props)
- Modify: `src/layout/useKeybindings.ts`
- Modify: `src/lib/terminalRegistry.ts` (swallow ⌘G in xterm)

- [ ] **Step 1: `useKeybindings.ts` — add ⌘G**

Update the doc comment to `..., Cmd+, settings, Cmd+G canvas.`, add to the opts type:

```ts
onToggleCanvas?: () => void;
```

Add the handler after the `","` branch:

```ts
      else if (k === "g") { e.preventDefault(); opts.onToggleCanvas?.(); }
```

Add `opts.onToggleCanvas` to the effect's dependency array.

- [ ] **Step 2: `terminalRegistry.ts` — keep ⌘G out of the PTY**

In `attachCustomKeyEventHandler`, change the swallow list:

```ts
    if (e.metaKey && !e.ctrlKey && !e.altKey && ["t", "d", "w", "g"].includes(e.key.toLowerCase())) {
```

- [ ] **Step 3: `TabBar.tsx` — segmented mode toggle**

Add to the `TabBar` props (both the destructuring and the type):

```ts
  viewMode: "tabs" | "canvas";
  onSetViewMode: (v: "tabs" | "canvas") => void;
```

Inside `<div className="cockpit-tabs__tools">`, add as the FIRST child (before the Mission Control button):

```tsx
        <div className="cockpit-mode" role="group" aria-label="View mode (Cmd+G)" title="View mode (⌘G)">
          <button className={`cockpit-mode__btn${viewMode === "tabs" ? " on" : ""}`} onClick={() => onSetViewMode("tabs")}>⌶ Tabs</button>
          <button className={`cockpit-mode__btn${viewMode === "canvas" ? " on" : ""}`} onClick={() => onSetViewMode("canvas")}>▦ Canvas</button>
        </div>
```

Append to `TabBar.css`:

```css
.cockpit-mode {
  display: flex;
  align-items: center;
  background: var(--ck-bg);
  border: 1px solid var(--ck-border);
  border-radius: 6px;
  overflow: hidden;
  margin-right: 4px;
}
.cockpit-mode__btn {
  font-size: 11px;
  padding: 3px 10px;
  color: var(--ck-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
}
.cockpit-mode__btn.on { background: var(--ck-surface); color: var(--ck-bright); }
```

Fix `TabBar.test.tsx`: every `<TabBar ...>` render gains `viewMode="tabs" onSetViewMode={() => {}}`.

- [ ] **Step 4: `CockpitView.tsx` — mode state + render**

Add imports:

```ts
import { CanvasView } from "./CanvasView";
import { loadViewMode, saveViewMode, type ViewMode } from "../lib/persistence";
```

(`loadViewMode`/`saveViewMode` join the existing `persistence` import.)

Add state below `const [dashOpen, setDashOpen] = useState(false);`:

```tsx
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode);
  const setViewMode = useCallback((v: ViewMode) => { setViewModeState(v); saveViewMode(v); }, []);
  const toggleCanvas = useCallback(() => setViewMode(viewMode === "canvas" ? "tabs" : "canvas"), [viewMode, setViewMode]);
```

Add `onToggleCanvas: toggleCanvas` to the `useKeybindings(...)` opts object.

Add `viewMode={viewMode} onSetViewMode={setViewMode}` to the `<TabBar ...>` props.

Replace the tab-content region (currently `layout.tabs.length === 0 ? <button .../> : layout.tabs.map(...)` inside the `position: relative, flex: 1` div) with:

```tsx
          {layout.tabs.length === 0 ? (
            <button className="cockpit-empty" onClick={() => setPickerOpen(true)}>
              <span className="cockpit-empty__icon" aria-hidden="true">⌘O</span>
              <span className="cockpit-empty__title">No project open</span>
              <span className="cockpit-empty__sub">Open a folder to start a Claude session</span>
            </button>
          ) : (
            <>
              {/* Canvas mode HIDES the tab stack (display:none) — never unmounts it, so
                  terminal slots, PTYs and xterms are untouched; each pane's
                  ResizeObserver refits it on the way back. */}
              <div style={{ position: "absolute", inset: 0, display: viewMode === "canvas" ? "none" : undefined }}>
                {layout.tabs.map((t) => (
                  <TabPanes
                    key={t.id}
                    tab={t}
                    active={t.id === layout.activeTabId}
                    dispatch={dispatch}
                    registerSlot={registerSlot}
                  />
                ))}
              </div>
              {viewMode === "canvas" && (
                <CanvasView
                  layout={layout}
                  onJump={(tabId, paneId) => {
                    setViewMode("tabs");
                    dispatch({ type: "focusTab", tabId });
                    dispatch({ type: "focusPane", paneId });
                    requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(paneId)));
                  }}
                />
              )}
            </>
          )}
```

- [ ] **Step 5: Typecheck + full test run**

Run: `npx tsc --noEmit && npm test`
Expected: clean typecheck; all suites PASS (including the updated `TabBar.test.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/components/CockpitView.tsx src/components/TabBar.tsx src/components/TabBar.css src/components/TabBar.test.tsx src/layout/useKeybindings.ts src/lib/terminalRegistry.ts
git commit -m "feat(canvas): Tabs/Canvas mode toggle (segmented control + Cmd+G)"
```

---

### Task 7: verify end-to-end + SPEC status

**Files:**
- Modify: `SPEC.md` (append a status block)

- [ ] **Step 1: Full gate**

Run: `npm test && npm run build`
Expected: all tests PASS; `tsc && vite build` clean.

- [ ] **Step 2: GUI verification (`npm run tauri dev`)**

Checklist — every line must be seen working:
1. Toggle: segmented control click AND ⌘G flip Tabs ⇄ Canvas; the mode survives an app relaunch.
2. Terminals survive: enter canvas, wait 10 s, return to tabs → sessions still live, pane fits correctly (no squashed grid). Also: RESIZE the window while in canvas, then ⌘G back → grid refits (reveal-refit); with tab bar LEFT mode, select another tab in the sidebar while in canvas, ⌘G back → that tab renders fitted.
2b. Jumps exit canvas: while in canvas, click a toast/bell "jump" and a Mission Control bay → app returns to Tabs mode focused on that pane (never a silent no-op).
2c. Persist flush: drag a card and IMMEDIATELY ⌘G back to tabs, relaunch → the dragged position survived (unmount flush).
3. Pan (drag background + two-finger scroll), pinch/⌘scroll zoom toward cursor, clamped 25–200%; HUD % updates; "fit all" frames every card.
4. **No-lag check (the requirement):** with 4+ panes open and at least one WORKING, pan/zoom/drag continuously — no stutter while activity lines and status update. Include a 10 s continuous two-finger trackpad pan while a session streams (the wheel path must pause ticks). If the dot grid shows up as jank, apply the noted fallback (static grid) and re-verify. Also check card text stays sharp at 200% zoom (compositor raster-scale) — fallback: drop `will-change` from `.cockpit-cv__card` (keep it on `__world`).
5. Cards: green border while working, amber+glow while an AskUserQuestion is pending (with `waiting Xm`), activity log shows real tool lines (`⚙ Bash · …`), cost + last-active tick.
6. Drag a card, release → position sticks (and survives relaunch); click (no drag) → jumps to that pane in Tabs mode with the terminal focused.
7. New pane (⌘D split or new tab) appears in canvas auto-placed in a free cell; closing a pane removes its card.
8. ⌘G pressed while a terminal is focused does NOT leak a `g` into the shell.

- [ ] **Step 3: Append the SPEC status block**

Append to `SPEC.md`:

```markdown
## Status — updated 2026-07-07

- **M13 — Canvas view**: `⌶ Tabs ⇄ ▦ Canvas` workspace mode (segmented control + ⌘G).
  Sessions are draggable cards (status border, CNVS-style 3-line tool activity log,
  cost, last-active) on a pan/zoom canvas; click card → jump to its pane in Tabs mode.
  Hand-rolled engine: gestures write transforms to DOM refs per rAF, React commits on
  gesture end (no-lag requirement); status/cost polling pauses during gestures.
  `activity.ts` folds tool_use lines from the existing logtail (no Rust changes).
  Positions/camera/mode persisted. Spec: docs/superpowers/specs/2026-07-07-canvas-view-design.md.
```

- [ ] **Step 4: Commit**

```bash
git add SPEC.md
git commit -m "docs(canvas): SPEC status — M13 canvas view"
```

---

## Post-review deltas (applied during execution)

Code-review findings fixed on top of the planned code — the committed source is authoritative for these:

- **Task 5 / CanvasView** (commit `e494f53`): ghost positions pruned at derivation (`prunePositions` before auto-place, functional commit); wheel treated as a gesture (`{kind:"wheel"}` — pauses ticks, cleared by the 150 ms commit debounce); concurrent wheel ignored during pointer gestures; per-event zoom factor clamped (notched mouse); `endGesture(allowClick)` so pointercancel / lost-up never triggers a jump; first-run framing via `framed` ref fires on first pane arrival; rAF cancel on unmount.
- **Task 6 wiring** (commit `1afbaf5`): `TabPanes` gained a `revealed` prop re-firing the refit effect when the stack is re-revealed from canvas mode (WKWebView RO misses display:none→flex one level up); ALL jump paths (`jumpToSession`, Mission Control onJump/onJumpSession) now `setViewMode("tabs")` first; CanvasView flushes its debounced persist on unmount (camera from `cameraRef`); HUD moved bottom-left (Juice pill/toast collision); segmented buttons got `aria-pressed`.
- **Deferred to Task 7 GUI checks**: text sharpness at 200 % (will-change raster-scale fallback documented); momentum-scroll tail freezing status ≤ ~2 s is BY DESIGN (gesture pause).
- **Accepted v1 quirks** (explicitly not fixed): ⌘W closes the focused-but-invisible pane while in canvas; sidebar tab select while in canvas has no visible effect until ⌘G back; canvas toggle lit while layout is empty shows the empty-state, not the canvas.
