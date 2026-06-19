import { describe, it, expect } from "vitest";
import { deriveState, type LogSignal } from "./paneState";

const IDLE_MS = 2000;

describe("deriveState", () => {
  it("is idle before any log activity", () => {
    const sig: LogSignal = { lastLineAt: null };
    expect(deriveState(sig, 10_000, IDLE_MS)).toBe("idle");
  });
  it("is working right after a new log line", () => {
    const sig: LogSignal = { lastLineAt: 9_500 };
    expect(deriveState(sig, 10_000, IDLE_MS)).toBe("working");
  });
  it("goes idle once the gap since the last line exceeds the threshold", () => {
    const sig: LogSignal = { lastLineAt: 7_000 };
    expect(deriveState(sig, 10_000, IDLE_MS)).toBe("idle");
  });
});
