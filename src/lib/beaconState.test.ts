import { describe, it, expect } from "vitest";
import { buildBeaconState } from "./beaconState";
import type { Completion } from "./notifications";

const layout: any = { activeTabId: "t1", tabs: [
  { id: "t1", rows: [{ panes: [{ id: "p1", sessionId: "s1", title: "a", cwd: "/x/web" }] }] },
  { id: "t2", rows: [{ panes: [{ id: "p2", sessionId: "s2", title: "b", cwd: "/x/api" }] }] },
] };
const entry = (over: Partial<Completion>): Completion => ({ id: "1", paneId: "p2", sessionId: "s2", tabId: "t2", name: "b", project: "api", at: 1, seen: false, ...over });

describe("buildBeaconState", () => {
  it("marks working panes, counts unseen, and sorts unseen-first", () => {
    const st = buildBeaconState(layout, [entry({})], new Set(["p1"]), new Set());
    expect(st.working).toBe(1);
    expect(st.totalUnseen).toBe(1);
    expect(st.sessions[0].sessionId).toBe("s2"); // unseen first
    expect(st.sessions.find((s) => s.sessionId === "s1")!.status).toBe("working");
    expect(st.sessions.find((s) => s.sessionId === "s2")!.unseen).toBe(true);
  });
  it("a seen completion contributes no unseen", () => {
    const st = buildBeaconState(layout, [entry({ seen: true })], new Set(), new Set());
    expect(st.totalUnseen).toBe(0);
  });
  it("waiting outranks unseen and is counted", () => {
    const st = buildBeaconState(layout, [entry({})], new Set(), new Set(["p1"]));
    expect(st.waiting).toBe(1);
    expect(st.sessions[0].sessionId).toBe("s1"); // waiting first, above unseen s2
    expect(st.sessions[0].status).toBe("waiting");
  });
});
