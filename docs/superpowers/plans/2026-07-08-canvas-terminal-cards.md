# Canvas Terminal Cards (M13b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the canvas cards' activity-log body with each pane's REAL interactive xterm — type on the canvas, drag by header, double-click header to snap to 100 %, `↗` to open in Tabs.

**Architecture:** The live terminal host node is BORROWED into the card (`appendChild` — the proven pop-out mechanism) and RETURNED on unmount; nothing about the session, PTY, or React `TerminalPane` tree changes. Card geometry grows to 640×420; placement drops to 2 columns. Spec: `docs/superpowers/specs/2026-07-08-canvas-terminal-cards-design.md`.

**Working directory:** `/Users/theerametsaengsin/Work/claude-cockpit/.worktrees/wren` (branch `wren`). Gates: `npx tsc --noEmit`, `npm test` (vitest), `npm run build`.

**Codebase facts:**
- `terminalRegistry.ts`: `hostEl` is a `width/height:100%` div living either in a pane container (`attachTerminal`) or the hidden parking node (`parkTerminalNode`); `refit()` skips zero-sized hosts; `releaseTerminal` disposes on real close.
- `CanvasView.tsx` (M13 + review fixes) owns camera/positions/gestures; ticks pause during gestures; transforms are imperative-only.
- `paneFlatten.ts` exports `OverviewItem { paneId, title, cwd, sessionId, tabId, tabIndex }`.

---

### Task 1: canvasMath — card geometry + `centerOn`

**Files:**
- Modify: `src/components/canvasMath.ts`
- Test: `src/components/canvasMath.test.ts`

- [ ] **Step 1: Update the tests (TDD — change them FIRST)**

In `src/components/canvasMath.test.ts`:

1a. Replace the nextFreeCell wrap test:
```ts
  it("wraps to the next row after 4 columns", () => {
    const row0 = [0, 1, 2, 3].map((c) => ({ x: c * CELL_W, y: 0 }));
    expect(nextFreeCell(row0)).toEqual({ x: 0, y: CELL_H });
  });
```
with:
```ts
  it("wraps to the next row after 2 columns (terminal cards are wide)", () => {
    const row0 = [0, 1].map((c) => ({ x: c * CELL_W, y: 0 }));
    expect(nextFreeCell(row0)).toEqual({ x: 0, y: CELL_H });
  });
```

1b. The fitAll "single card centered" test currently uses an 800×600 viewport — with 640×420 cards that still fits at zoom 1 (640+120 ≤ 800, 420+120 ≤ 600), so it stays as-is. Verify this reasoning holds when tests run.

1c. Add `centerOn` to the import list from `./canvasMath` and append a new describe block at the end of the file:
```ts
describe("centerOn", () => {
  it("frames a card dead-center at 100%", () => {
    const c = centerOn({ x: 0, y: 0 }, { w: 800, h: 600 });
    expect(c).toEqual({ zoom: 1, x: 800 / 2 - CARD_W / 2, y: 600 / 2 - CARD_H / 2 });
    // the card's center lands at the viewport center
    expect((0 + CARD_W / 2) * c.zoom + c.x).toBeCloseTo(400);
    expect((0 + CARD_H / 2) * c.zoom + c.y).toBeCloseTo(300);
  });
  it("works for off-origin cards", () => {
    const c = centerOn({ x: 1000, y: -300 }, { w: 800, h: 600 });
    expect((1000 + CARD_W / 2) * c.zoom + c.x).toBeCloseTo(400);
    expect((-300 + CARD_H / 2) * c.zoom + c.y).toBeCloseTo(300);
  });
});
```

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `npm test -- src/components/canvasMath.test.ts`
Expected: FAIL — `centerOn` not exported; the 2-column wrap test fails against `PLACE_COLS = 4`.

- [ ] **Step 3: Update the implementation**

In `src/components/canvasMath.ts`:

3a. Replace the geometry constants block:
```ts
/** Card geometry used for placement/framing. CARD_H is nominal — real cards are
 *  content-sized, but placement/fit only need a stable footprint. */
export const CARD_W = 240;
export const CARD_H = 170;
export const CELL_W = CARD_W + 24;
export const CELL_H = CARD_H + 24;
const PLACE_COLS = 4;
```
with:
```ts
/** Card geometry used for placement/framing. M13b: a card IS a terminal window,
 *  so both dimensions are real (CanvasView renders cards at exactly this size). */
export const CARD_W = 640;
export const CARD_H = 420;
export const CELL_W = CARD_W + 24;
export const CELL_H = CARD_H + 24;
const PLACE_COLS = 2;
```

3b. Append after `panBy`:
```ts
/** Camera at 100 % zoom with the given card dead-center in the viewport — the
 *  "I'm going to really type now" snap (only 100 % has sharp text and accurate
 *  xterm mouse selection under the CSS-transformed world). */
export function centerOn(pos: Pt, view: { w: number; h: number }): Camera {
  return { zoom: 1, x: view.w / 2 - (pos.x + CARD_W / 2), y: view.h / 2 - (pos.y + CARD_H / 2) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/canvasMath.test.ts`
Expected: PASS (14 tests). Then `npx tsc --noEmit` — CanvasView still compiles (it only consumes the constants).

- [ ] **Step 5: Commit**

```bash
git add src/components/canvasMath.ts src/components/canvasMath.test.ts
git commit -m "feat(canvas): terminal-card geometry (640x420, 2 cols) + centerOn snap math"
```

---

### Task 2: terminalRegistry — borrow/return

**Files:**
- Modify: `src/lib/terminalRegistry.ts`

Pure DOM glue on the proven pop-out mechanism — gate is typecheck + full suite (no new unit tests; jsdom can't meaningfully exercise appendChild-move + refit).

- [ ] **Step 1: Record the pane container**

2a. In the `TermEntry` interface, add after `hostEl`:
```ts
  paneContainer: HTMLElement | null;
```
2b. In `acquireTerminal`, the entry literal `{ term, hostEl, fit, lastLineAt, lastInputAt, lastResizeAt }` gains `paneContainer: null`:
```ts
  const entry: TermEntry = { term, hostEl, fit, paneContainer: null, lastLineAt, lastInputAt, lastResizeAt };
```
2c. In `attachTerminal`, record the container (first line inside the `if (e)`-guarded body, before `container.appendChild(e.hostEl);`):
```ts
  e.paneContainer = container;
```

- [ ] **Step 2: Add borrow/return**

Append after `parkTerminalNode`:
```ts
/** Move a pane's LIVE terminal into a canvas card (the pop-out appendChild dance —
 *  session, PTY and scrollback are untouched; only the host node moves). Refits to
 *  the card grid. Never steals focus. */
export function borrowTerminal(paneId: string, container: HTMLElement) {
  const e = registry.get(paneId);
  if (!e) return;
  container.appendChild(e.hostEl);
  refit(paneId);
}

/** Give a borrowed terminal back to the pane container recorded by the last
 *  attachTerminal. The refit there is skipped while the tab stack is hidden
 *  (zero-size guard) — the reveal refit catches up. Parks if the container is gone. */
export function returnTerminal(paneId: string) {
  const e = registry.get(paneId);
  if (!e) return;
  if (e.paneContainer?.isConnected) {
    e.paneContainer.appendChild(e.hostEl);
    refit(paneId);
  } else {
    parkTerminalNode(paneId);
  }
}
```

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit && npm test`
Expected: clean; all suites green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/terminalRegistry.ts
git commit -m "feat(canvas): borrowTerminal/returnTerminal — move live xterms into canvas cards"
```

---

### Task 3: CanvasView — terminal cards

**Files:**
- Rewrite: `src/components/CanvasView.tsx` (full replacement below)
- Rewrite: `src/components/CanvasView.css` (full replacement below)

- [ ] **Step 1: Replace `src/components/CanvasView.tsx` with exactly:**

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Layout } from "../layout/paneLayout";
import { overviewItems, type OverviewItem } from "./paneFlatten";
import { paneLastLineAt, focusTerminal, borrowTerminal, returnTerminal } from "../lib/terminalRegistry";
import { deriveState } from "../lib/paneState";
import { waitingPanes, waitingLabel } from "../lib/waiting";
import { sessionUsage } from "../lib/costClient";
import { costOf } from "../lib/pricing";
import { loadCanvasState, saveCanvasState } from "../lib/persistence";
import { debounce } from "../lib/debounce";
import {
  type Camera, type Pt, clampZoom, zoomAt, panBy, isDrag, nextFreeCell, fitAll, prunePositions, centerOn, CARD_W, CARD_H,
} from "./canvasMath";
import "./CanvasView.css";

const GRID = 20; // px between background dots at zoom 1

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
  | { kind: "card"; paneId: string; startX: number; startY: number; origin: Pt; live: Pt; moved: boolean };

/** One session card: header (drag handle · status · open-in-Tabs), the pane's REAL
 *  xterm (borrowed live host node — the pop-out appendChild dance), cost footer. */
function CanvasCard({ it, now, cost, cardRef, onHeadPointerDown, onHeadDoubleClick, onOpen }: {
  it: OverviewItem;
  now: number;
  cost: number;
  cardRef: (el: HTMLDivElement | null) => void;
  onHeadPointerDown: (e: React.PointerEvent) => void;
  onHeadDoubleClick: () => void;
  onOpen: () => void;
}) {
  const termRef = useRef<HTMLDivElement>(null);
  // Borrow on mount, give back on unmount. returnTerminal is a no-op after a real
  // close (releaseTerminal disposed first) and parks if the pane container is gone.
  useLayoutEffect(() => {
    borrowTerminal(it.paneId, termRef.current!);
    return () => returnTerminal(it.paneId);
  }, [it.paneId]);
  const w = waitingPanes.get(it.paneId);
  const working = !w && deriveState({ lastLineAt: paneLastLineAt(it.paneId) }, now, 800) === "working";
  return (
    <div
      ref={cardRef}
      className={`cockpit-cv__card${working ? " is-working" : ""}${w ? " is-waiting" : ""}`}
      style={{ width: CARD_W, height: CARD_H }}
      onPointerDown={(e) => e.stopPropagation()} // inside a card is never a canvas pan
    >
      <div
        className="cockpit-cv__head"
        onPointerDown={onHeadPointerDown}
        onDoubleClick={onHeadDoubleClick}
        title="drag to move · double-click = 100%"
      >
        <span className="cockpit-cv__name">{it.title}</span>
        <span className="cockpit-cv__path">{shortCwd(it.cwd)} · tab {it.tabIndex}</span>
        <span className="cockpit-cv__state">{w ? `? ${waitingLabel(w.askedAt, now)}` : working ? "● working" : "● idle"}</span>
        <button className="cockpit-cv__open" title="Open in Tabs" onPointerDown={(e) => e.stopPropagation()} onClick={onOpen}>↗</button>
      </div>
      <div ref={termRef} className="cockpit-cv__term" />
      <div className="cockpit-cv__foot">
        <span>{fmt(cost)}</span>
        <span>{ago(paneLastLineAt(it.paneId), now)}</span>
      </div>
    </div>
  );
}

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
  // Flush the pending save on unmount — a mode flip inside the debounce window must
  // not lose the last drag/pan. cameraRef is fresher than state mid-wheel-settle.
  const persistRef = useRef({ positions, liveIds });
  persistRef.current = { positions, liveIds };
  useEffect(() => () => {
    const { positions, liveIds } = persistRef.current;
    saveCanvasState({ camera: cameraRef.current, positions: prunePositions(positions, liveIds) });
  }, []);

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
      // Wheel over a terminal scrolls ITS scrollback, not the canvas — except
      // pinch/⌘-wheel, which stays a camera zoom everywhere.
      if (!(e.ctrlKey || e.metaKey) && (e.target as HTMLElement).closest?.(".cockpit-cv__term")) return;
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
  const onHeadPointerDown = (paneId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    rootRef.current?.setPointerCapture(e.pointerId);
    const origin = placed[paneId] ?? { x: 0, y: 0 };
    gesture.current = { kind: "card", paneId, startX: e.clientX, startY: e.clientY, origin, live: origin, moved: false };
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
  // must never activate a card — only a real header click focuses its terminal.
  const endGesture = (allowClick: boolean) => {
    const g = gesture.current;
    if (!g || g.kind === "wheel") return;
    gesture.current = null;
    if (g.kind === "pan") setCamera(cameraRef.current);
    else if (g.moved) setPositions((p) => ({ ...p, [g.paneId]: g.live }));
    else if (allowClick) focusTerminal(g.paneId);
  };
  const onPointerUp = () => endGesture(true);
  const onPointerCancel = () => endGesture(false);

  // Double-click a header → 100 % zoom centered on that card (sharp text +
  // accurate xterm mouse selection only exist at zoom 1).
  const snapTo = (paneId: string) => {
    const r = rootRef.current;
    const p = placed[paneId];
    if (!r || !p) return;
    const cam = centerOn(p, { w: r.clientWidth, h: r.clientHeight });
    cameraRef.current = cam;
    setCamera(cam);
    focusTerminal(paneId);
  };

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
        {items.map((it) => (
          <CanvasCard
            key={it.paneId}
            it={it}
            now={now}
            cost={costs[it.paneId] ?? 0}
            cardRef={registerCard(it.paneId)}
            onHeadPointerDown={onHeadPointerDown(it.paneId)}
            onHeadDoubleClick={() => snapTo(it.paneId)}
            onOpen={() => onJump(it.tabId, it.paneId)}
          />
        ))}
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

- [ ] **Step 2: Replace `src/components/CanvasView.css` with exactly:**

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
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: var(--ck-surface);
  border: 1px solid var(--ck-border);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
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

.cockpit-cv__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ck-border);
  cursor: grab;
}
.cockpit-cv__head:active { cursor: grabbing; }
.cockpit-cv__name { flex: none; max-width: 40%; font-weight: 600; color: var(--ck-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cockpit-cv__path { flex: 1; font-size: 10px; color: var(--ck-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cockpit-cv__state { flex: none; font-size: 11px; color: var(--ck-idle); }
.is-working .cockpit-cv__state { color: var(--ck-accent); }
.is-waiting .cockpit-cv__state { color: var(--ck-yellow); }
.cockpit-cv__open {
  flex: none;
  font-size: 12px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 5px;
  color: var(--ck-muted);
  background: transparent;
  border: 1px solid var(--ck-border);
  cursor: pointer;
}
.cockpit-cv__open:hover { color: var(--ck-bright); }

/* The borrowed live xterm host (a width/height:100% div) fills this box. Text
 * selection must work INSIDE the terminal even though cards are unselectable. */
.cockpit-cv__term {
  flex: 1;
  min-height: 0;
  margin: 6px 8px 0;
  user-select: text;
  -webkit-user-select: text;
}

.cockpit-cv__foot { display: flex; justify-content: space-between; padding: 6px 10px; font-size: 10px; color: var(--ck-muted); }

.cockpit-cv__hud { position: absolute; left: 10px; bottom: 10px; display: flex; gap: 6px; align-items: center; }
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

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all clean/green. Notes: `paneActivity` is intentionally no longer imported here (the feed stays alive for future zoomed-out LOD — see spec); `.cockpit-cv__log`/`__act` styles are intentionally gone.

- [ ] **Step 4: Commit**

```bash
git add src/components/CanvasView.tsx src/components/CanvasView.css
git commit -m "feat(canvas): terminal cards — live interactive xterms on the canvas (M13b)"
```

---

### Task 4: verify + SPEC status

- [ ] **Step 1: Full gate** — `npm test && npm run build` clean.
- [ ] **Step 2: GUI verification** (tauri dev is already running with HMR; user drives):
  1. Cards now show the REAL terminals; typing into a card works; output streams live.
  2. Drag by header only; clicking/selecting text inside a terminal never pans the canvas or moves the card.
  3. Wheel over a terminal scrolls scrollback; wheel over background pans; pinch zooms everywhere.
  4. Double-click header → 100 % centered; text sharp; mouse selection accurate at 100 %.
  5. `↗` opens the pane in Tabs mode; terminal is back in its pane, correctly fitted (borrow→return→reveal refit), scrollback intact; ⌘G forth and back repeatedly — no black screens, no dead sessions.
  6. No-lag: pan/zoom continuously while a session streams into a visible card.
  7. Close a pane while in canvas (⌘W or from Tabs) — card disappears, no console errors.
- [ ] **Step 3: Append SPEC status block** (M13b shipped) and commit:

```markdown
- **M13b — Canvas terminal cards**: cards are now real interactive terminals (640×420):
  the live xterm host node is borrowed into the card and returned on exit (pop-out
  appendChild mechanism; session/PTY untouched). Drag by header; header click focuses;
  double-click header snaps to 100 % centered (sharp text + accurate selection); ↗ opens
  in Tabs; wheel over a terminal scrolls scrollback (pinch/⌘ still zooms the canvas).
  Activity-log card body removed (feed retained for future LOD).
  Spec: docs/superpowers/specs/2026-07-08-canvas-terminal-cards-design.md.
```

```bash
git add SPEC.md
git commit -m "docs(canvas): SPEC status — M13b terminal cards"
```
