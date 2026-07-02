import { describe, it, expect } from "vitest";
import { nextWaiting, waitingLabel, createWaitingStore } from "./waiting";
import {
  ASSISTANT_ASK, ASSISTANT_ASK_SIBLING, USER_ASK_ANSWER, SIDECHAIN_ASSISTANT,
  ASSISTANT_END_TURN, ASSISTANT_TOOL_USE, USER_LINE, USER_TOOL_RESULT, GARBAGE,
} from "./__fixtures__/transcriptLines";

const askedAt = Date.parse("2026-07-02T10:00:00.000Z");

describe("nextWaiting", () => {
  it("enters waiting on an AskUserQuestion tool_use", () => {
    expect(nextWaiting(null, ASSISTANT_ASK)).toEqual({
      toolUseId: "toolu_ASK1", messageId: "msg_ASK1", askedAt,
      question: "Which auth method should the API use?",
    });
  });
  it("stays waiting through a parallel block of the SAME assistant message", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, ASSISTANT_ASK_SIBLING)).toBe(w);
  });
  it("clears on the matching tool_result (the user answered)", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, USER_ASK_ANSWER)).toBeNull();
  });
  it("does NOT clear on an unrelated tool_result", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, USER_TOOL_RESULT)).toBe(w);
  });
  it("clears on a NEW assistant message id (model moved on / ask interrupted)", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, ASSISTANT_END_TURN)).toBeNull();
  });
  it("clears on a typed user prompt (user moved on)", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, USER_LINE)).toBeNull();
  });
  it("ignores sidechain (subagent) lines", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, SIDECHAIN_ASSISTANT)).toBe(w);
  });
  it("a non-waiting tool_use (Bash) never enters waiting", () => {
    expect(nextWaiting(null, ASSISTANT_TOOL_USE)).toBeNull();
  });
  it("garbage lines change nothing", () => {
    const w = nextWaiting(null, ASSISTANT_ASK);
    expect(nextWaiting(w, GARBAGE)).toBe(w);
    expect(nextWaiting(null, GARBAGE)).toBeNull();
  });
});

describe("createWaitingStore", () => {
  it("returns the entered Waiting once and dedupes re-processing the same ask", () => {
    const store = createWaitingStore();
    expect(store.apply("p1", ASSISTANT_ASK)).toMatchObject({ toolUseId: "toolu_ASK1" });
    expect(store.apply("p1", ASSISTANT_ASK)).toBeNull();
    expect(store.get("p1")).toMatchObject({ toolUseId: "toolu_ASK1" });
  });
  it("clears on answer and on clear()", () => {
    const store = createWaitingStore();
    store.apply("p1", ASSISTANT_ASK);
    store.apply("p1", USER_ASK_ANSWER);
    expect(store.get("p1")).toBeNull();
    store.apply("p2", ASSISTANT_ASK);
    store.clear("p2");
    expect(store.get("p2")).toBeNull();
  });
  it("tracks panes independently", () => {
    const store = createWaitingStore();
    store.apply("p1", ASSISTANT_ASK);
    expect(store.get("p2")).toBeNull();
  });
});

describe("waitingLabel", () => {
  it("elides minutes under 1m", () => { expect(waitingLabel(0, 30_000)).toBe("waiting"); });
  it("shows minutes", () => { expect(waitingLabel(0, 4 * 60_000 + 5_000)).toBe("waiting 4m"); });
  it("shows hours past 60m", () => { expect(waitingLabel(0, 3 * 3_600_000 + 60_000)).toBe("waiting 3h"); });
});
