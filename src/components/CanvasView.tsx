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
