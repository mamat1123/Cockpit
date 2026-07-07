// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { saveLast, loadLast, getPresets, savePreset, deletePreset, loadViewMode, saveViewMode, loadCanvasState, saveCanvasState, type CanvasState } from "./persistence";
import type { SavedLayout } from "../layout/paneLayout";

const fake: SavedLayout = { activeTabIndex: 0, tabs: [{ rows: [{ size: 1, panes: [{ cwd: "/a", title: "a", autoTitle: true, size: 1 }] }] }] };

describe("persistence", () => {
  beforeEach(() => localStorage.clear());
  it("saveLast/loadLast round-trip", () => { saveLast(fake); expect(loadLast()).toEqual(fake); });
  it("loadLast is null when empty", () => { expect(loadLast()).toBeNull(); });
  it("savePreset / getPresets / deletePreset", () => {
    savePreset("work", fake);
    expect(getPresets().work).toEqual(fake);
    deletePreset("work");
    expect(getPresets().work).toBeUndefined();
  });
});

describe("canvas persistence", () => {
  beforeEach(() => localStorage.clear());

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
