import { describe, it, expect } from "vitest";
import { createNotificationStore, unseenByTab, totalUnseen, type Completion } from "./notifications";

const base = { paneId: "p1", sessionId: "s1", tabId: "t1", name: "fix-bug", project: "web", at: 1000 };

describe("notification store", () => {
  it("push returns an entry with an id and the given seen flag; list is newest-first", () => {
    const s = createNotificationStore();
    const a = s.push({ ...base, at: 1 }, false);
    const b = s.push({ ...base, paneId: "p2", at: 2 }, false);
    expect(a.id).toBeTruthy();
    expect(s.list().map((e) => e.paneId)).toEqual(["p2", "p1"]);
    expect(b.seen).toBe(false);
  });
  it("markTabSeen flips seen for that tab only", () => {
    const s = createNotificationStore();
    s.push({ ...base, tabId: "t1" }, false);
    s.push({ ...base, tabId: "t2" }, false);
    s.markTabSeen("t1");
    expect(totalUnseen(s.list())).toBe(1);
    expect(unseenByTab(s.list()).get("t1") ?? 0).toBe(0);
    expect(unseenByTab(s.list()).get("t2")).toBe(1);
  });
  it("markAllSeen clears everything; clear empties the list", () => {
    const s = createNotificationStore();
    s.push(base, false); s.push({ ...base, tabId: "t2" }, false);
    s.markAllSeen();
    expect(totalUnseen(s.list())).toBe(0);
    s.clear();
    expect(s.list()).toEqual([]);
  });
  it("caps history at 50 entries", () => {
    const s = createNotificationStore();
    for (let i = 0; i < 60; i++) s.push({ ...base, at: i }, false);
    expect(s.list().length).toBe(50);
  });
  it("subscribe fires on push and unsubscribe stops it", () => {
    const s = createNotificationStore();
    let n = 0; const off = s.subscribe(() => n++);
    s.push(base, false); expect(n).toBe(1);
    off(); s.push(base, false); expect(n).toBe(1);
  });
});

describe("aggregation helpers", () => {
  it("unseenByTab counts only unseen, grouped by tab", () => {
    const e: Completion[] = [
      { id: "1", ...base, tabId: "t1", seen: false },
      { id: "2", ...base, tabId: "t1", seen: true },
      { id: "3", ...base, tabId: "t2", seen: false },
    ];
    const m = unseenByTab(e);
    expect(m.get("t1")).toBe(1);
    expect(m.get("t2")).toBe(1);
  });
});
