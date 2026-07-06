// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, DEFAULT_SETTINGS } from "./settings";

// Mock localStorage: Node's native localStorage in the default "node" vitest
// environment has no working methods at all here (setItem/getItem/removeItem/
// clear are all `undefined`), matching the pattern already used in
// settings.notifications.test.ts and settings.tabbar.test.ts.
const mockStorage: { [key: string]: string } = {};
const mockLocalStorage = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
  removeItem: (key: string) => { delete mockStorage[key]; },
  length: 0,
  key: (index: number) => Object.keys(mockStorage)[index] ?? null,
};
Object.defineProperty(window, "localStorage", { value: mockLocalStorage, writable: true });

beforeEach(() => mockLocalStorage.removeItem("cockpit.settings.v1"));

describe("settings.burrows", () => {
  it("defaults to true", () => {
    expect(DEFAULT_SETTINGS.burrows).toBe(true);
    expect(loadSettings().burrows).toBe(true);
  });
  it("backfills true for a saved payload that predates the field", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ themeId: "amber-hud" }));
    expect(loadSettings().burrows).toBe(true);
  });
  it("preserves an explicit false", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ burrows: false }));
    expect(loadSettings().burrows).toBe(false);
  });
});
