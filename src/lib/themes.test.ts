import { describe, it, expect } from "vitest";
import { THEMES, themeById, DEFAULT_THEME_ID } from "./themes";
describe("themes", () => {
  it("has 10 themes, all complete hex palettes", () => {
    expect(THEMES.length).toBe(10);
    const keys = ["bg","surface","surface2","text","bright","muted","dim","border","accent","idle","blue","green","red","yellow","magenta","cyan"] as const;
    for (const t of THEMES) for (const k of keys) expect(t[k]).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
  it("themeById falls back to the first theme", () => {
    expect(themeById("nope").id).toBe(DEFAULT_THEME_ID);
    expect(themeById("nord").name).toBe("Nord");
  });
});
