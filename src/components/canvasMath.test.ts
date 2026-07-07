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
