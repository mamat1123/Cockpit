import type { SavedLayout } from "../layout/paneLayout";

const LAST = "cockpit.lastLayout.v1";
const PRESETS = "cockpit.presets.v1";

export function saveLast(s: SavedLayout): void {
  try { localStorage.setItem(LAST, JSON.stringify(s)); } catch { /* ignore */ }
}
export function loadLast(): SavedLayout | null {
  try { const r = localStorage.getItem(LAST); return r ? (JSON.parse(r) as SavedLayout) : null; } catch { return null; }
}
export function getPresets(): Record<string, SavedLayout> {
  try { const r = localStorage.getItem(PRESETS); return r ? (JSON.parse(r) as Record<string, SavedLayout>) : {}; } catch { return {}; }
}
export function savePreset(name: string, s: SavedLayout): void {
  const all = getPresets(); all[name] = s;
  try { localStorage.setItem(PRESETS, JSON.stringify(all)); } catch { /* ignore */ }
}
export function deletePreset(name: string): void {
  const all = getPresets(); delete all[name];
  try { localStorage.setItem(PRESETS, JSON.stringify(all)); } catch { /* ignore */ }
}

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
