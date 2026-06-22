// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadSettings, DEFAULT_NOTIFICATIONS } from "./settings";

// Mock localStorage since it's not available in all test environments
const mockStorage: { [key: string]: string } = {};
const mockLocalStorage = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
  removeItem: (key: string) => { delete mockStorage[key]; },
  length: 0,
  key: (index: number) => Object.keys(mockStorage)[index] ?? null,
};

// Replace global localStorage with our mock
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", { value: mockLocalStorage, writable: true });
} else {
  (global as any).localStorage = mockLocalStorage;
}

beforeEach(() => mockLocalStorage.clear());

describe("notification settings", () => {
  it("defaults: all notification switches on", () => {
    expect(loadSettings().notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(DEFAULT_NOTIFICATIONS).toEqual({ enabled: true, os: true, sound: true, toast: true, beacon: true });
  });
  it("merges partial stored notifications over defaults", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ notifications: { sound: false } }));
    const n = loadSettings().notifications;
    expect(n.sound).toBe(false);
    expect(n.enabled).toBe(true); // missing keys fall back to defaults
  });
  it("uses defaults when notifications is absent", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ themeId: "nord" }));
    expect(loadSettings().notifications).toEqual(DEFAULT_NOTIFICATIONS);
  });
});
