import { describe, it, expect } from "vitest";
import { paneLaunchEnv } from "./paneLaunchEnv";

const BASE = "http://127.0.0.1:8787";

describe("paneLaunchEnv", () => {
  it("pins PONYTAIL_DEFAULT_MODE=off when HR off and ponytail off (off is never omitted)", () => {
    expect(paneLaunchEnv({ headroomEngaged: false, ponytail: "off", headroomBaseUrl: BASE }))
      .toEqual({ PONYTAIL_DEFAULT_MODE: "off" });
  });
  it("carries the ponytail level when HR off and ponytail full", () => {
    expect(paneLaunchEnv({ headroomEngaged: false, ponytail: "full", headroomBaseUrl: BASE }))
      .toEqual({ PONYTAIL_DEFAULT_MODE: "full" });
  });
  it("adds ANTHROPIC_BASE_URL when HR engaged, alongside the pinned off level", () => {
    expect(paneLaunchEnv({ headroomEngaged: true, ponytail: "off", headroomBaseUrl: BASE }))
      .toEqual({ PONYTAIL_DEFAULT_MODE: "off", ANTHROPIC_BASE_URL: BASE });
  });
  it("merges both when HR engaged and ponytail ultra", () => {
    expect(paneLaunchEnv({ headroomEngaged: true, ponytail: "ultra", headroomBaseUrl: BASE }))
      .toEqual({ PONYTAIL_DEFAULT_MODE: "ultra", ANTHROPIC_BASE_URL: BASE });
  });
});
