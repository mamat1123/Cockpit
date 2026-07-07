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
function CanvasCard({ it, now, cost, cardRef, onHeadPointerDown, onOpen }: {
  it: OverviewItem;
  now: number;
  cost: number;
  cardRef: (el: HTMLDivElement | null) => void;
  onHeadPointerDown: (e: React.PointerEvent) => void;
  onOpen: () => void;
}) {
  const termRef = useRef<HTMLDivElement>(null);
  // Borrow on mount, give back on unmount. borrowTerminal can miss when this card
  // mounts in the same commit that created the pane (TerminalPane acquires the
  // terminal one commit later) — retry per frame until it lands. returnTerminal is
  // a no-op after a real close (releaseTerminal disposed first), and re-parenting
  // a never-borrowed host back to its own container is harmless.
  // (Relies on: nothing remounts TerminalPane while its card is live — the slot
  // portal settles before our first retry rAF.)
  useLayoutEffect(() => {
    let raf = 0;
    const tryBorrow = () => {
      if (!borrowTerminal(it.paneId, termRef.current!)) raf = requestAnimationFrame(tryBorrow);
    };
    tryBorrow();
    return () => { cancelAnimationFrame(raf); returnTerminal(it.paneId); };
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

export function CanvasView({ layout, onJump, onFocusPane }: {
  layout: Layout;
  onJump: (tabId: string, paneId: string) => void;
  /** Sync LAYOUT focus (focusTab+focusPane) when a card is clicked/snapped —
   *  without this ⌘W would close whichever pane tabs mode last focused. */
  onFocusPane: (paneId: string) => void;
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

  // Prune ref-callback caches for closed panes (CockpitView does the same for slots).
  useEffect(() => {
    for (const id of Array.from(cardRefCbs.current.keys())) {
      if (!liveIds.has(id)) { cardRefCbs.current.delete(id); cardEls.current.delete(id); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

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
  // Double-press is detected manually (two un-moved clicks < 350 ms on the same
  // header): native dblclick can be silently retargeted away by setPointerCapture
  // in WKWebView, so we don't rely on it.
  const lastTap = useRef<{ paneId: string; at: number }>({ paneId: "", at: 0 });
  const endGesture = (allowClick: boolean) => {
    const g = gesture.current;
    if (!g || g.kind === "wheel") return;
    gesture.current = null;
    if (g.kind === "pan") setCamera(cameraRef.current);
    else if (g.moved) setPositions((p) => ({ ...p, [g.paneId]: g.live }));
    else if (allowClick) {
      onFocusPane(g.paneId);
      focusTerminal(g.paneId);
      const at = performance.now();
      if (lastTap.current.paneId === g.paneId && at - lastTap.current.at < 350) snapTo(g.paneId);
      lastTap.current = { paneId: g.paneId, at };
    }
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
    onFocusPane(paneId);
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
      onScroll={(e) => { e.currentTarget.scrollLeft = 0; e.currentTarget.scrollTop = 0; }}
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
