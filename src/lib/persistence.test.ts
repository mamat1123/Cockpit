// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { saveLast, loadLast, getPresets, savePreset, deletePreset } from "./persistence";
import type { SavedLayout } from "../layout/paneLayout";

const fake: SavedLayout = { activeTabIndex: 0, tabs: [{ rows: [{ size: 1, panes: [{ cwd: "/a", title: "a", autoTitle: true, size: 1 }] }] }] };

describe("persistence", () => {
  beforeEach(() => localStorage.clear());
  it("saveLast/loadLast round-trip", () => { saveLast(fake); expect(loadLast()).toEqual(fake); });
  it("loadLast is null when empty", () => { expect(loadLast()).toBeNull(); });
  it("savePreset / getPresets / deletePreset", () => {
    savePreset("work", fake);
    expect(getPresets().work).toEqual(fake);
    deletePreset("work");
    expect(getPresets().work).toBeUndefined();
  });
});
