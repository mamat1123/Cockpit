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
