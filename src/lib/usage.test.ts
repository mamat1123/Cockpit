import { describe, it, expect } from "vitest";
import { levelFor, clampPct, formatReset, formatResetClock } from "./usage";

describe("levelFor", () => {
  it("bands at 55 and 80", () => {
    expect(levelFor(0)).toBe("mint");
    expect(levelFor(54.9)).toBe("mint");
    expect(levelFor(55)).toBe("amber");
    expect(levelFor(80)).toBe("amber");
    expect(levelFor(80.1)).toBe("red");
    expect(levelFor(100)).toBe("red");
  });
});

describe("clampPct", () => {
  it("rounds and clamps to 0–100", () => {
    expect(clampPct(34.4)).toBe(34);
    expect(clampPct(34.6)).toBe(35);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(140)).toBe(100);
    expect(clampPct(NaN)).toBe(0);
  });
});

describe("formatReset", () => {
  const now = Date.parse("2026-06-22T12:00:00Z");
  it("formats hours+minutes within a day", () => {
    expect(formatReset("2026-06-22T16:15:00Z", now)).toBe("4h 15m");
  });
  it("formats days+hours beyond a day", () => {
    expect(formatReset("2026-06-24T21:00:00Z", now)).toBe("2d 9h");
  });
  it("formats minutes-only under an hour", () => {
    expect(formatReset("2026-06-22T12:12:00Z", now)).toBe("12m");
  });
  it("says 'now' once elapsed", () => {
    expect(formatReset("2026-06-22T11:59:00Z", now)).toBe("now");
  });
  it("returns dash for missing/invalid", () => {
    expect(formatReset(null, now)).toBe("—");
    expect(formatReset("nope", now)).toBe("—");
  });
});

describe("formatResetClock", () => {
  it("formats local HH:MM, padded", () => {
    const at = new Date(2026, 5, 22, 16, 5, 0).toISOString(); // local 22 Jun 16:05
    expect(formatResetClock(at)).toBe("16:05");
  });
  it("pads midnight hour and minute", () => {
    const at = new Date(2026, 5, 22, 0, 0, 0).toISOString();
    expect(formatResetClock(at)).toBe("00:00");
  });
  it("returns dash for missing/invalid", () => {
    expect(formatResetClock(null)).toBe("—");
    expect(formatResetClock("nope")).toBe("—");
  });
});
