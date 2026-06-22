/** Curated monospace families offered in Settings. The stored value is the primary
 *  family NAME only; `setTerminalFont` appends a `, monospace` fallback so missing
 *  glyphs (e.g. Thai) still resolve through the system fallback (Thonburi on macOS). */
export const MONO_FONTS: string[] = [
  "Menlo",
  "SF Mono",
  "Monaco",
  "Andale Mono",
  "Courier New",
  "JetBrainsMono NFM",
  "GeistMono Nerd Font Propo",
];

/** Allowed terminal font sizes (px). */
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 22;
