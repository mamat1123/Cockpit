import { describe, it, expect } from "vitest";
import { activityOf, createActivityStore } from "./activity";
import {
  ASSISTANT_TOOL_USE, ASSISTANT_ASK, ASSISTANT_EDIT, ASSISTANT_END_TURN,
  SIDECHAIN_ASSISTANT, USER_TOOL_RESULT, GARBAGE,
} from "./__fixtures__/transcriptLines";

describe("activityOf", () => {
  it("parses a Bash tool_use into a command detail", () => {
    expect(activityOf(ASSISTANT_TOOL_USE)).toEqual([{
      toolUseId: "toolu_REDACTED", tool: "Bash", detail: "ls .",
      at: Date.parse("2026-06-22T09:54:36.932Z"),
    }]);
  });
  it("parses parallel blocks and shortens file tools to the basename", () => {
    const acts = activityOf(ASSISTANT_EDIT);
    expect(acts).toHaveLength(2);
    expect(acts[0]).toMatchObject({ tool: "Edit", detail: "CanvasView.tsx" });
    expect(acts[1]).toMatchObject({ tool: "Read", detail: "dragMath.ts" });
  });
  it("parses AskUserQuestion to its first question", () => {
    expect(activityOf(ASSISTANT_ASK)[0]).toMatchObject({
      tool: "AskUserQuestion", detail: "Which auth method should the API use?",
    });
  });
  it("returns [] for text-only, user, sidechain, and garbage lines", () => {
    expect(activityOf(ASSISTANT_END_TURN)).toEqual([]);
    expect(activityOf(USER_TOOL_RESULT)).toEqual([]);
    expect(activityOf(SIDECHAIN_ASSISTANT)).toEqual([]);
    expect(activityOf(GARBAGE)).toEqual([]);
  });
});

describe("createActivityStore", () => {
  it("keeps the newest `cap` entries, newest first", () => {
    const store = createActivityStore(3);
    store.apply("p1", ASSISTANT_TOOL_USE); // Bash
    store.apply("p1", ASSISTANT_EDIT);     // Edit + Read (2 entries)
    store.apply("p1", ASSISTANT_ASK);      // AskUserQuestion → 4 total, capped at 3
    const acts = store.get("p1");
    expect(acts.map((a) => a.tool)).toEqual(["AskUserQuestion", "Edit", "Read"]);
  });
  it("dedupes re-processed lines by toolUseId (resume backfill)", () => {
    const store = createActivityStore(3);
    store.apply("p1", ASSISTANT_TOOL_USE);
    store.apply("p1", ASSISTANT_TOOL_USE);
    expect(store.get("p1")).toHaveLength(1);
  });
  it("ignores replayed lines whose entries were already evicted (full-file re-tail)", () => {
    const store = createActivityStore(3);
    store.apply("p1", ASSISTANT_TOOL_USE); // Bash — will be evicted by the next two lines
    store.apply("p1", ASSISTANT_EDIT);     // Edit + Read
    store.apply("p1", ASSISTANT_ASK);      // AskUserQuestion → Bash evicted
    // logtail_start always re-reads from offset 0 → the whole file replays:
    store.apply("p1", ASSISTANT_TOOL_USE);
    store.apply("p1", ASSISTANT_EDIT);
    store.apply("p1", ASSISTANT_ASK);
    expect(store.get("p1").map((a) => a.tool)).toEqual(["AskUserQuestion", "Edit", "Read"]);
  });
  it("panes are independent and clear() empties one", () => {
    const store = createActivityStore(3);
    store.apply("p1", ASSISTANT_TOOL_USE);
    store.apply("p2", ASSISTANT_ASK);
    store.clear("p1");
    expect(store.get("p1")).toEqual([]);
    expect(store.get("p2")).toHaveLength(1);
  });
});
