import { describe, it, expect } from "vitest";
import { initLayout, emptyLayout, reduce, type Layout } from "./paneLayout";

const CWD = "/Users/theerametsaengsin/Work/mee-tang/app";
const panesOf = (l: Layout, i = 0) => l.tabs[i].rows.flatMap((r) => r.panes);

describe("paneLayout (rows model)", () => {
  it("starts with one tab, one row, one pane", () => {
    const l = initLayout(CWD);
    expect(l.tabs.length).toBe(1);
    expect(l.tabs[0].rows.length).toBe(1);
    expect(l.tabs[0].rows[0].panes.length).toBe(1);
    expect(l.focusedPaneId).toBe(l.tabs[0].rows[0].panes[0].id);
  });
  it("split adds a column in the focused pane's row + focuses it", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    expect(l.tabs[0].rows.length).toBe(1);
    expect(l.tabs[0].rows[0].panes.length).toBe(2);
    expect(l.focusedPaneId).toBe(l.tabs[0].rows[0].panes[1].id);
  });
  it("splitDown adds a new row after the focused row + focuses it", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });
    expect(l.tabs[0].rows.length).toBe(2);
    expect(l.tabs[0].rows[1].panes.length).toBe(1);
    expect(l.focusedPaneId).toBe(l.tabs[0].rows[1].panes[0].id);
  });
  it("new panes inherit the focused pane's cwd", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "setCwd", paneId: l.focusedPaneId, cwd: "/tmp/x" });
    l = reduce(l, { type: "splitDown" });
    expect(panesOf(l).find((p) => p.id === l.focusedPaneId)!.cwd).toBe("/tmp/x");
  });
  it("close removes the focused pane and drops an emptied row", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });
    l = reduce(l, { type: "close" });
    expect(l.tabs[0].rows.length).toBe(1);
  });
  it("closing the last pane of a tab removes the tab", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab" });
    l = reduce(l, { type: "close" });
    expect(l.tabs.length).toBe(1);
    expect(l.activeTabId).toBe(l.tabs[0].id);
  });
  it("never closes the very last pane", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "close" });
    expect(l.tabs.length).toBe(1);
    expect(l.tabs[0].rows[0].panes.length).toBe(1);
  });
  it("panes and rows start with size 1", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    expect(l.tabs[0].rows[0].panes.every((p) => p.size === 1)).toBe(true);
    expect(l.tabs[0].rows.every((r) => r.size === 1)).toBe(true);
  });
  it("moveTab reorders tabs, keeping active", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab" });
    const [t1, t2] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "moveTab", tabId: t2, toIndex: 0 });
    expect(l.tabs.map((t) => t.id)).toEqual([t2, t1]);
    expect(l.activeTabId).toBe(t2);
  });
  it("setPaneSizes updates the row's pane weights", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    const rowId = l.tabs[0].rows[0].id;
    l = reduce(l, { type: "setPaneSizes", rowId, sizes: [2, 1] });
    expect(l.tabs[0].rows[0].panes.map((p) => p.size)).toEqual([2, 1]);
  });
  it("setRowSizes updates the tab's row weights", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });
    const tabId = l.tabs[0].id;
    l = reduce(l, { type: "setRowSizes", tabId, sizes: [3, 1] });
    expect(l.tabs[0].rows.map((r) => r.size)).toEqual([3, 1]);
  });
  it("a pane has a default title from its cwd basename", () => {
    const l = initLayout(CWD);
    expect(l.tabs[0].rows[0].panes[0].title).toBe("app");
  });
  it("renamePane sets a custom title", () => {
    let l = initLayout(CWD);
    const id = l.focusedPaneId;
    l = reduce(l, { type: "renamePane", paneId: id, title: "frontend" });
    expect(l.tabs[0].rows[0].panes[0].title).toBe("frontend");
  });
  it("popOut moves a pane into a brand-new active tab", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    const moved = l.focusedPaneId;
    l = reduce(l, { type: "popOut", paneId: moved });
    expect(l.tabs.length).toBe(2);
    expect(l.tabs[0].rows[0].panes.length).toBe(1);
    expect(l.tabs[1].rows[0].panes.map((p) => p.id)).toEqual([moved]);
    expect(l.activeTabId).toBe(l.tabs[1].id);
    expect(l.focusedPaneId).toBe(moved);
  });
  it("movePaneAfter reorders within a row", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    const [A, B] = l.tabs[0].rows[0].panes.map((p) => p.id);
    l = reduce(l, { type: "movePaneAfter", paneId: A, targetPaneId: B });
    expect(l.tabs[0].rows[0].panes.map((p) => p.id)).toEqual([B, A]);
  });
  it("movePaneAfter across rows moves the pane and drops the emptied row", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });
    const A = l.tabs[0].rows[0].panes[0].id;
    const B = l.tabs[0].rows[1].panes[0].id;
    l = reduce(l, { type: "movePaneAfter", paneId: B, targetPaneId: A });
    expect(l.tabs[0].rows.length).toBe(1);
    expect(l.tabs[0].rows[0].panes.map((p) => p.id)).toEqual([A, B]);
  });
  it("autoTitlePane updates the title while auto-naming is on", () => {
    let l = initLayout(CWD);
    const id = l.focusedPaneId;
    l = reduce(l, { type: "autoTitlePane", paneId: id, title: "fix crypto bug" });
    expect(l.tabs[0].rows[0].panes[0].title).toBe("fix crypto bug");
  });
  it("a manual renamePane stops further auto-naming", () => {
    let l = initLayout(CWD);
    const id = l.focusedPaneId;
    l = reduce(l, { type: "renamePane", paneId: id, title: "frontend" });
    l = reduce(l, { type: "autoTitlePane", paneId: id, title: "should be ignored" });
    expect(l.tabs[0].rows[0].panes[0].title).toBe("frontend");
  });
  it("newTab can open in a specific cwd", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/Users/x/Work/other" });
    const tab = l.tabs[l.tabs.length - 1];
    expect(tab.rows[0].panes[0].cwd).toBe("/Users/x/Work/other");
    expect(l.activeTabId).toBe(tab.id);
  });
  it("newTab without cwd inherits the focused pane's cwd", () => {
    const l = reduce(initLayout(CWD), { type: "newTab" });
    expect(l.tabs[l.tabs.length - 1].rows[0].panes[0].cwd).toBe(CWD);
  });
  it("openSession adds a tab whose pane resumes the given session", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "openSession", cwd: "/Users/x/Work/foo", sessionId: "sess-123" });
    const tab = l.tabs[l.tabs.length - 1];
    const pane = tab.rows[0].panes[0];
    expect(l.activeTabId).toBe(tab.id);
    expect(pane.cwd).toBe("/Users/x/Work/foo");
    expect(pane.sessionId).toBe("sess-123");
    expect(pane.resume).toBe(true);
  });
  it("openCodexHandoff inserts a codex pane next to the source pane", () => {
    let l = initLayout(CWD);
    const source = l.focusedPaneId;
    const fromSessionId = l.tabs[0].rows[0].panes[0].sessionId;
    l = reduce(l, {
      type: "openCodexHandoff",
      sourcePaneId: source,
      cwd: CWD,
      promptPath: "/tmp/handoff.md",
      fromSessionId,
      title: "fix crypto bug",
    });
    const panes = l.tabs[0].rows[0].panes;
    expect(panes.length).toBe(2);
    expect(panes[1].provider).toBe("codex");
    expect(panes[1].codexPromptPath).toBe("/tmp/handoff.md");
    expect(panes[1].handoffFromSessionId).toBe(fromSessionId);
    expect(l.focusedPaneId).toBe(panes[1].id);
  });

  it("openClaudeHandoff targets z.ai when provider is zai", () => {
    let l = initLayout(CWD);
    const source = l.focusedPaneId;
    l = reduce(l, {
      type: "openClaudeHandoff",
      sourcePaneId: source,
      cwd: CWD,
      promptPath: "/tmp/handoff.md",
      title: "port the parser",
      provider: "zai",
    });
    const panes = l.tabs[0].rows[0].panes;
    expect(panes.length).toBe(2);
    expect(panes[1].provider).toBe("zai");
    expect(panes[1].claudePromptPath).toBe("/tmp/handoff.md");
    expect(panes[1].title).toBe("zai: port the parser");
    expect(l.focusedPaneId).toBe(panes[1].id);
  });

  it("openClaudeHandoff defaults to a claude pane when no provider given", () => {
    let l = initLayout(CWD);
    const source = l.focusedPaneId;
    l = reduce(l, { type: "openClaudeHandoff", sourcePaneId: source, cwd: CWD, promptPath: "/tmp/h.md" });
    const panes = l.tabs[0].rows[0].panes;
    expect(panes[1].provider).toBe("claude");
  });

  it("setProvider flips a pane's provider in place, keeping session + toggles", () => {
    let l = initLayout(CWD);
    const paneId = l.focusedPaneId;
    l = reduce(l, { type: "setHeadroom", paneId, on: true });
    const before = l.tabs[0].rows[0].panes[0];
    l = reduce(l, { type: "setProvider", paneId, provider: "zai" });
    const after = l.tabs[0].rows[0].panes[0];
    expect(after.id).toBe(before.id);
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.provider).toBe("zai");
    expect(after.headroom).toBe(true); // preserved so switching back to Claude restores it
    // and back again
    l = reduce(l, { type: "setProvider", paneId, provider: "claude" });
    expect(l.tabs[0].rows[0].panes[0].provider).toBe("claude");
  });
});

describe("sessionId", () => {
  it("gives each pane a unique uuid sessionId", () => {
    const l0 = initLayout("/x");
    const p0 = l0.tabs[0].rows[0].panes[0];
    expect(p0.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const l1 = reduce({ ...l0, focusedPaneId: p0.id }, { type: "split" });
    const ids = l1.tabs[0].rows[0].panes.map((p) => p.sessionId);
    expect(new Set(ids).size).toBe(2);
  });

  it("can update a live pane's session id without replacing the pane", () => {
    const l0 = initLayout("/x");
    const p0 = l0.tabs[0].rows[0].panes[0];
    const l1 = reduce(l0, { type: "setSessionId", paneId: p0.id, sessionId: "new-session" });
    const p1 = l1.tabs[0].rows[0].panes[0];
    expect(p1.id).toBe(p0.id);
    expect(p1.sessionId).toBe("new-session");
    expect(l1.focusedPaneId).toBe(p0.id);
  });
});

import { serializeLayout, deserializeLayout, layoutHasSessions } from "./paneLayout";

describe("serialize/deserialize", () => {
  it("round-trips structure + cwd/size, fresh ids", () => {
    let l = initLayout(CWD);
    l = reduce({ ...l, focusedPaneId: l.tabs[0].rows[0].panes[0].id }, { type: "split" });
    l = reduce(l, { type: "newTab", cwd: "/two" });
    const saved = serializeLayout(l, false);
    const back = deserializeLayout(saved);
    expect(back.tabs.length).toBe(2);
    expect(back.tabs[0].rows[0].panes.length).toBe(2);
    expect(back.tabs[1].rows[0].panes[0].cwd).toBe("/two");
    expect(back.tabs[0].id).not.toBe(l.tabs[0].id);
  });
  it("drops sessionId (fresh) when keepSessions=false → resume false", () => {
    const l = initLayout(CWD);
    const back = deserializeLayout(serializeLayout(l, false));
    const p = back.tabs[0].rows[0].panes[0];
    expect(p.resume).toBe(false);
    expect(p.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.sessionId).not.toBe(l.tabs[0].rows[0].panes[0].sessionId);
  });
  it("keeps sessionId + resume when keepSessions=true", () => {
    const l = initLayout(CWD);
    const orig = l.tabs[0].rows[0].panes[0].sessionId;
    const back = deserializeLayout(serializeLayout(l, true));
    const p = back.tabs[0].rows[0].panes[0];
    expect(p.sessionId).toBe(orig);
    expect(p.resume).toBe(true);
  });
  it("round-trips codex provider metadata but not the transient prompt path", () => {
    let l = initLayout(CWD);
    const source = l.focusedPaneId;
    const fromSessionId = l.tabs[0].rows[0].panes[0].sessionId;
    l = reduce(l, { type: "openCodexHandoff", sourcePaneId: source, cwd: CWD, promptPath: "/tmp/handoff.md", fromSessionId });
    const codex = l.tabs[0].rows[0].panes[1];
    const saved = serializeLayout(l, true);
    expect(saved.tabs[0].rows[0].panes[1].provider).toBe("codex");
    const back = deserializeLayout(saved);
    const p = back.tabs[0].rows[0].panes[1];
    expect(p.provider).toBe("codex");
    expect(p.handoffFromSessionId).toBe(fromSessionId);
    expect(p.codexPromptPath).toBeUndefined();
    expect(p.sessionId).toBe(codex.sessionId);
  });
  it("loadLayout action replaces the whole layout", () => {
    const saved = serializeLayout(initLayout("/x"), false);
    const l2 = reduce(initLayout(CWD), { type: "loadLayout", saved });
    expect(l2.tabs[0].rows[0].panes[0].cwd).toBe("/x");
  });
});

describe("layoutHasSessions", () => {
  it("is true for a layout saved with sessions", () => {
    expect(layoutHasSessions(serializeLayout(initLayout(CWD), true))).toBe(true);
  });
  it("is false for a layout saved without sessions", () => {
    expect(layoutHasSessions(serializeLayout(initLayout(CWD), false))).toBe(false);
  });
});

describe("headroom flag", () => {
  it("setHeadroom toggles the flag on the target pane only", () => {
    let l = initLayout("/tmp/a");
    l = reduce(l, { type: "split" });
    const [p0, p1] = l.tabs[0].rows[0].panes;
    l = reduce(l, { type: "setHeadroom", paneId: p0.id, on: true });
    const panes = l.tabs[0].rows[0].panes;
    expect(panes.find((p) => p.id === p0.id)!.headroom).toBe(true);
    expect(panes.find((p) => p.id === p1.id)!.headroom).toBeFalsy();
  });

  it("round-trips headroom through serialize/deserialize", () => {
    let l = initLayout("/tmp/a");
    const pid = l.tabs[0].rows[0].panes[0].id;
    l = reduce(l, { type: "setHeadroom", paneId: pid, on: true });
    const saved = serializeLayout(l, true);
    expect(saved.tabs[0].rows[0].panes[0].headroom).toBe(true);
    const back = deserializeLayout(saved);
    expect(back.tabs[0].rows[0].panes[0].headroom).toBe(true);
  });
});

describe("tab title", () => {
  it("renameTab sets a custom title on the target tab only", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/two" });
    const [t0, t1] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "renameTab", tabId: t0, title: "frontend" });
    expect(l.tabs.find((t) => t.id === t0)!.title).toBe("frontend");
    expect(l.tabs.find((t) => t.id === t1)!.title).toBeUndefined();
  });
  it("renameTab with an empty/whitespace title clears the override", () => {
    let l = initLayout(CWD);
    const id = l.tabs[0].id;
    l = reduce(l, { type: "renameTab", tabId: id, title: "frontend" });
    l = reduce(l, { type: "renameTab", tabId: id, title: "   " });
    expect(l.tabs[0].title).toBeUndefined();
  });
  it("round-trips a tab title through serialize/deserialize", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "renameTab", tabId: l.tabs[0].id, title: "frontend" });
    const back = deserializeLayout(serializeLayout(l, true));
    expect(back.tabs[0].title).toBe("frontend");
  });
  it("serialize omits title when unset", () => {
    const l = initLayout(CWD);
    expect(serializeLayout(l, true).tabs[0].title).toBeUndefined();
  });
});

describe("closeTab", () => {
  it("removes the target tab and its panes", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/two" });
    const [t0, t1] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "closeTab", tabId: t0 });
    expect(l.tabs.map((t) => t.id)).toEqual([t1]);
  });
  it("is a no-op when it's the only remaining tab", () => {
    let l = initLayout(CWD);
    const id = l.tabs[0].id;
    l = reduce(l, { type: "closeTab", tabId: id });
    expect(l.tabs.map((t) => t.id)).toEqual([id]);
  });
  it("reassigns activeTabId + focusedPaneId to the tab that slides into its slot", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/two" });
    l = reduce(l, { type: "newTab", cwd: "/three" });
    const [t0, t1, t2] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "focusTab", tabId: t1 });
    l = reduce(l, { type: "closeTab", tabId: t1 });
    expect(l.tabs.map((t) => t.id)).toEqual([t0, t2]);
    expect(l.activeTabId).toBe(t2);
    expect(l.focusedPaneId).toBe(l.tabs[1].rows[0].panes[0].id);
  });
  it("leaves activeTabId alone when closing a background tab", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/two" });
    const [t0, t1] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "focusTab", tabId: t0 });
    l = reduce(l, { type: "closeTab", tabId: t1 });
    expect(l.tabs.map((t) => t.id)).toEqual([t0]);
    expect(l.activeTabId).toBe(t0);
  });
});

describe("empty layout (no project open yet)", () => {
  it("emptyLayout has zero tabs", () => {
    const l = emptyLayout();
    expect(l.tabs).toEqual([]);
    expect(l.activeTabId).toBe("");
    expect(l.focusedPaneId).toBe("");
  });
  it("newTab WITH a cwd opens the first tab from empty", () => {
    const l = reduce(emptyLayout(), { type: "newTab", cwd: "/Users/x/Work/proj" });
    expect(l.tabs.length).toBe(1);
    expect(l.tabs[0].rows[0].panes[0].cwd).toBe("/Users/x/Work/proj");
    expect(l.activeTabId).toBe(l.tabs[0].id);
    expect(l.focusedPaneId).toBe(l.tabs[0].rows[0].panes[0].id);
  });
  it("newTab WITHOUT a cwd is a no-op on empty (nothing to inherit — must pick a folder)", () => {
    const l = reduce(emptyLayout(), { type: "newTab" });
    expect(l.tabs).toEqual([]);
  });
  it("split / splitDown / close are no-ops on empty", () => {
    expect(reduce(emptyLayout(), { type: "split" }).tabs).toEqual([]);
    expect(reduce(emptyLayout(), { type: "splitDown" }).tabs).toEqual([]);
    expect(reduce(emptyLayout(), { type: "close" }).tabs).toEqual([]);
  });
});

describe("ponytail level", () => {
  it("setPonytail sets the level on the target pane only", () => {
    let l = initLayout("/tmp/a");
    l = reduce(l, { type: "split" });
    const [p0, p1] = l.tabs[0].rows[0].panes;
    l = reduce(l, { type: "setPonytail", paneId: p0.id, level: "ultra" });
    const panes = l.tabs[0].rows[0].panes;
    expect(panes.find((p) => p.id === p0.id)!.ponytail).toBe("ultra");
    expect(panes.find((p) => p.id === p1.id)!.ponytail).toBeUndefined();
  });
  it("serialize omits ponytail when unset; deserialize defaults to off", () => {
    const l = initLayout("/tmp/a");
    const saved = serializeLayout(l, true);
    expect(saved.tabs[0].rows[0].panes[0].ponytail).toBeUndefined();
    expect(deserializeLayout(saved).tabs[0].rows[0].panes[0].ponytail).toBe("off");
  });
  it("serialize keeps a real level and round-trips it", () => {
    let l = initLayout("/tmp/a");
    const pid = l.tabs[0].rows[0].panes[0].id;
    l = reduce(l, { type: "setPonytail", paneId: pid, level: "full" });
    const saved = serializeLayout(l, true);
    expect(saved.tabs[0].rows[0].panes[0].ponytail).toBe("full");
    expect(deserializeLayout(saved).tabs[0].rows[0].panes[0].ponytail).toBe("full");
  });
  it("serialize omits ponytail when explicitly off", () => {
    let l = initLayout("/tmp/a");
    const pid = l.tabs[0].rows[0].panes[0].id;
    l = reduce(l, { type: "setPonytail", paneId: pid, level: "off" });
    expect(serializeLayout(l, true).tabs[0].rows[0].panes[0].ponytail).toBeUndefined();
  });
});

describe("provider selection on creation", () => {
  it("newTab creates its pane with the given provider", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: CWD, provider: "codex" });
    expect(panesOf(l, 1)[0].provider).toBe("codex");
  });

  it("split creates its new pane with the given provider", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split", provider: "codex" });
    expect(panesOf(l)[1].provider).toBe("codex");
  });

  it("splitDown creates its new pane with the given provider", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown", provider: "codex" });
    expect(l.tabs[0].rows[1].panes[0].provider).toBe("codex");
  });

  it("omitting provider on split leaves it unset, same as before this feature", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    expect(panesOf(l)[1].provider).toBeUndefined();
  });
});

describe("provider switching", () => {
  it("setProvider changes the target pane only", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    const [p0, p1] = panesOf(l);
    l = reduce(l, { type: "setProvider", paneId: p0.id, provider: "zai" });
    expect(panesOf(l).find((p) => p.id === p0.id)!.provider).toBe("zai");
    expect(panesOf(l).find((p) => p.id === p1.id)!.provider).toBeUndefined();
  });

  it("a zai pane round-trips through serialize/deserialize", () => {
    let l = initLayout(CWD);
    const pid = panesOf(l)[0].id;
    l = reduce(l, { type: "setProvider", paneId: pid, provider: "zai" });
    const saved = serializeLayout(l, true);
    expect(saved.tabs[0].rows[0].panes[0].provider).toBe("zai");
    expect(deserializeLayout(saved).tabs[0].rows[0].panes[0].provider).toBe("zai");
  });
});

import type { BurrowInfo } from "./paneLayout";

const BURROW: BurrowInfo = { path: "/repo/.worktrees/otter", branch: "otter", codename: "otter", emoji: "🦦" };

describe("burrow panes", () => {
  it("newTab with a burrow spawns in the worktree path and titles as emoji+codename", () => {
    const l = reduce(initLayout("/repo"), { type: "newTab", cwd: "/repo", provider: "claude", burrow: BURROW });
    const pane = l.tabs[l.tabs.length - 1].rows[0].panes[0];
    expect(pane.cwd).toBe("/repo/.worktrees/otter");
    expect(pane.title).toBe("🦦 otter");
    expect(pane.autoTitle).toBe(false);
    expect(pane.isBurrow).toBe(true);
    expect(pane.burrowBranch).toBe("otter");
  });

  it("split with a burrow ignores the inherited cwd and uses the worktree", () => {
    const base = initLayout("/repo/.worktrees/panda");
    const l = reduce(base, { type: "split", provider: "claude", burrow: BURROW });
    const pane = l.tabs[0].rows[0].panes.find((p) => p.id === l.focusedPaneId)!;
    expect(pane.cwd).toBe("/repo/.worktrees/otter");
    expect(pane.isBurrow).toBe(true);
  });

  it("serialize→deserialize round-trips burrow fields", () => {
    const l = reduce(initLayout("/repo"), { type: "newTab", cwd: "/repo", burrow: BURROW });
    const back = deserializeLayout(serializeLayout(l, true));
    const pane = back.tabs[back.tabs.length - 1].rows[0].panes[0];
    expect(pane.isBurrow).toBe(true);
    expect(pane.codename).toBe("otter");
    expect(pane.emoji).toBe("🦦");
    expect(pane.burrowBranch).toBe("otter");
    expect(pane.title).toBe("🦦 otter");
  });
});
