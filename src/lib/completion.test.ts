import { describe, it, expect } from "vitest";
import { parseTurnEnd } from "./completion";
import { ASSISTANT_END_TURN, ASSISTANT_TOOL_USE, USER_LINE, GARBAGE } from "./__fixtures__/transcriptLines";

const at = Date.parse("2026-06-22T08:30:00.000Z");

describe("parseTurnEnd", () => {
  it("returns the timestamp for a fresh end_turn assistant line", () => {
    expect(parseTurnEnd(ASSISTANT_END_TURN, at + 1000)).toEqual({ at });
  });
  it("returns null for a tool_use (mid-loop) line", () => {
    expect(parseTurnEnd(ASSISTANT_TOOL_USE, at + 1000)).toBeNull();
  });
  it("returns null for a user line", () => {
    expect(parseTurnEnd(USER_LINE, at + 1000)).toBeNull();
  });
  it("returns null for a stale end_turn (backfill from a resumed session)", () => {
    expect(parseTurnEnd(ASSISTANT_END_TURN, at + 60_000)).toBeNull();
  });
  it("returns null for malformed JSON", () => {
    expect(parseTurnEnd(GARBAGE, at)).toBeNull();
  });
  it("treats stop_sequence and max_tokens as turn-end", () => {
    const mk = (sr: string) => JSON.stringify({ type: "assistant", timestamp: "2026-06-22T08:30:00.000Z", message: { stop_reason: sr } });
    expect(parseTurnEnd(mk("stop_sequence"), at + 100)).toEqual({ at });
    expect(parseTurnEnd(mk("max_tokens"), at + 100)).toEqual({ at });
  });
  it("returns null when stop_reason is missing or null (partial write)", () => {
    const line = JSON.stringify({ type: "assistant", timestamp: "2026-06-22T08:30:00.000Z", message: { stop_reason: null } });
    expect(parseTurnEnd(line, at + 100)).toBeNull();
  });
});
