import { invoke } from "@tauri-apps/api/core";

export type PonytailLevel = "off" | "lite" | "full" | "ultra";

/** Ordered low→high; the dropdown renders in this order. */
export const PONYTAIL_LEVELS: PonytailLevel[] = ["off", "lite", "full", "ultra"];

/** Per-level UI metadata: meter fill (0–3 cells) + one-line description. */
export const PONYTAIL_META: Record<PonytailLevel, { fill: number; desc: string }> = {
  off: { fill: 0, desc: "ponytail off — Claude behaves normally" },
  lite: { fill: 1, desc: "light — avoids over-engineering" },
  full: { fill: 2, desc: "standard — YAGNI, stdlib first, no extra abstractions" },
  ultra: { fill: 3, desc: "strictest — the least code that still works" },
};

/** Whether the ponytail Claude Code plugin is installed (so PONYTAIL_DEFAULT_MODE
 *  actually does something). Reads ~/.claude/plugins/installed_plugins.json via Rust. */
export function ponytailInstalled(): Promise<boolean> {
  return invoke<boolean>("ponytail_installed");
}
