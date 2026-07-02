// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, DEFAULT_SETTINGS } from "./settings";

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

beforeEach(() => mockLocalStorage.clear());

describe("tab bar position setting", () => {
  it("defaults to top", () => {
    expect(DEFAULT_SETTINGS.tabBar).toBe("top");
    expect(loadSettings().tabBar).toBe("top");
  });
  it("backfills 'top' for stored blobs that predate the field", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ themeId: "nord" }));
    expect(loadSettings().tabBar).toBe("top");
  });
  it("round-trips 'left' and rejects unknown values", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ tabBar: "left" }));
    expect(loadSettings().tabBar).toBe("left");
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ tabBar: "bottom" }));
    expect(loadSettings().tabBar).toBe("top");
  });
});
