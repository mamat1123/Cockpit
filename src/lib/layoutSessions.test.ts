import { describe, expect, it, vi } from "vitest";
import type { Layout } from "../layout/paneLayout";
import { resolveLayoutSessionIds } from "./layoutSessions";

function sampleLayout(): Layout {
  return {
    tabs: [{
      id: "tab-1",
      title: "Work",
      rows: [{
        id: "row-1",
        size: 1,
        panes: [
          { id: "pane-1", cwd: "/repo", size: 1, title: "Claude", autoTitle: true, sessionId: "old" },
          { id: "pane-2", cwd: "/repo", size: 1, title: "Codex", autoTitle: true, sessionId: "codex-old", provider: "codex" },
        ],
      }],
    }],
    activeTabId: "tab-1",
    focusedPaneId: "pane-1",
  };
}

describe("resolveLayoutSessionIds", () => {
  it("updates stale Claude-family pane session ids", async () => {
    const layout = sampleLayout();
    const resolve = vi.fn(async (cwd: string, sessionId: string) => (
      cwd === "/repo" && sessionId === "old" ? "new" : sessionId
    ));

    const next = await resolveLayoutSessionIds(layout, resolve);

    expect(next.tabs[0].rows[0].panes[0].sessionId).toBe("new");
    expect(layout.tabs[0].rows[0].panes[0].sessionId).toBe("old");
    expect(next.activeTabId).toBe("tab-1");
    expect(next.focusedPaneId).toBe("pane-1");
  });

  it("skips Codex panes because they do not use Claude jsonl session logs", async () => {
    const layout = sampleLayout();
    const resolve = vi.fn(async () => "new");

    const next = await resolveLayoutSessionIds(layout, resolve);

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith("/repo", "old");
    expect(next.tabs[0].rows[0].panes[1].sessionId).toBe("codex-old");
  });

  it("keeps the original layout when the resolver cannot determine a newer id", async () => {
    const layout = sampleLayout();
    const resolve = vi.fn(async () => null);

    const next = await resolveLayoutSessionIds(layout, resolve);

    expect(next).toBe(layout);
  });

  it("keeps the original session id when the resolver fails", async () => {
    const layout = sampleLayout();
    const resolve = vi.fn(async () => {
      throw new Error("tauri unavailable");
    });

    const next = await resolveLayoutSessionIds(layout, resolve);

    expect(next.tabs[0].rows[0].panes[0].sessionId).toBe("old");
  });
});
