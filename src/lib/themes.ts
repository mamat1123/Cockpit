export interface Theme {
  id: string; name: string;
  bg: string; surface: string; surface2: string;
  text: string; bright: string; muted: string; dim: string; border: string;
  accent: string; idle: string;
  blue: string; green: string; red: string; yellow: string; magenta: string; cyan: string;
}

export const THEMES: Theme[] = [
  { id:"amber-hud",  name:"Amber HUD",         bg:"#14161B", surface:"#181B22", surface2:"#20242d", text:"#C8CDD6", bright:"#EDEFF3", muted:"#6B7280", dim:"#565d68", border:"#262A33", accent:"#F5A623", idle:"#3ECF8E", blue:"#7C9CFF", green:"#3ECF8E", red:"#ff6b6b", yellow:"#F5A623", magenta:"#c06ad6", cyan:"#56b6c2" },
  { id:"tokyo-night", name:"Tokyo Night",      bg:"#1a1b26", surface:"#1f2335", surface2:"#292e42", text:"#a9b1d6", bright:"#c0caf5", muted:"#565f89", dim:"#414868", border:"#2a2e42", accent:"#7aa2f7", idle:"#9ece6a", blue:"#7aa2f7", green:"#9ece6a", red:"#f7768e", yellow:"#e0af68", magenta:"#bb9af7", cyan:"#7dcfff" },
  { id:"nord",        name:"Nord",             bg:"#2e3440", surface:"#3b4252", surface2:"#434c5e", text:"#d8dee9", bright:"#eceff4", muted:"#616e88", dim:"#4c566a", border:"#434c5e", accent:"#88c0d0", idle:"#a3be8c", blue:"#81a1c1", green:"#a3be8c", red:"#bf616a", yellow:"#ebcb8b", magenta:"#b48ead", cyan:"#88c0d0" },
  { id:"catppuccin",  name:"Catppuccin Mocha", bg:"#1e1e2e", surface:"#181825", surface2:"#313244", text:"#cdd6f4", bright:"#ffffff", muted:"#6c7086", dim:"#45475a", border:"#313244", accent:"#cba6f7", idle:"#a6e3a1", blue:"#89b4fa", green:"#a6e3a1", red:"#f38ba8", yellow:"#f9e2af", magenta:"#f5c2e7", cyan:"#94e2d5" },
  { id:"dracula",     name:"Dracula",          bg:"#282a36", surface:"#21222c", surface2:"#44475a", text:"#f8f8f2", bright:"#ffffff", muted:"#6272a4", dim:"#4d5066", border:"#44475a", accent:"#bd93f9", idle:"#50fa7b", blue:"#8be9fd", green:"#50fa7b", red:"#ff5555", yellow:"#f1fa8c", magenta:"#ff79c6", cyan:"#8be9fd" },
  { id:"gruvbox",     name:"Gruvbox Dark",     bg:"#282828", surface:"#32302f", surface2:"#3c3836", text:"#ebdbb2", bright:"#fbf1c7", muted:"#928374", dim:"#665c54", border:"#3c3836", accent:"#fe8019", idle:"#b8bb26", blue:"#83a598", green:"#b8bb26", red:"#fb4934", yellow:"#fabd2f", magenta:"#d3869b", cyan:"#8ec07c" },
  { id:"rose-pine",   name:"Rosé Pine",        bg:"#191724", surface:"#1f1d2e", surface2:"#26233a", text:"#e0def4", bright:"#ffffff", muted:"#6e6a86", dim:"#524f67", border:"#26233a", accent:"#ebbcba", idle:"#9ccfd8", blue:"#31748f", green:"#9ccfd8", red:"#eb6f92", yellow:"#f6c177", magenta:"#c4a7e7", cyan:"#9ccfd8" },
  { id:"solarized",   name:"Solarized Dark",   bg:"#002b36", surface:"#073642", surface2:"#0a4250", text:"#839496", bright:"#93a1a1", muted:"#586e75", dim:"#475b62", border:"#0a4250", accent:"#268bd2", idle:"#859900", blue:"#268bd2", green:"#859900", red:"#dc322f", yellow:"#b58900", magenta:"#d33682", cyan:"#2aa198" },
  { id:"synthwave",   name:"Synthwave '84",    bg:"#262335", surface:"#2a2139", surface2:"#34294f", text:"#f4eee4", bright:"#ffffff", muted:"#848bbd", dim:"#5a5475", border:"#34294f", accent:"#ff7edb", idle:"#72f1b8", blue:"#36f9f6", green:"#72f1b8", red:"#fe4450", yellow:"#fede5d", magenta:"#ff7edb", cyan:"#36f9f6" },
  { id:"matrix",      name:"Matrix",           bg:"#0b0f0b", surface:"#0e140e", surface2:"#16241a", text:"#7dd87d", bright:"#c8ffc8", muted:"#4a704a", dim:"#345234", border:"#16301a", accent:"#39ff14", idle:"#39ff14", blue:"#00d9ff", green:"#39ff14", red:"#ff5f56", yellow:"#d7ff00", magenta:"#ff5fff", cyan:"#00ffd9" },
];

export const DEFAULT_THEME_ID = "amber-hud";
export function themeById(id: string): Theme { return THEMES.find((t) => t.id === id) ?? THEMES[0]; }

/** Write a theme's tokens (with optional accent override) onto the document root. */
export function applyTheme(theme: Theme, accent?: string | null): void {
  const r = document.documentElement.style;
  const set: Record<string, string> = {
    "--ck-bg": theme.bg, "--ck-surface": theme.surface, "--ck-surface-2": theme.surface2,
    "--ck-text": theme.text, "--ck-bright": theme.bright, "--ck-muted": theme.muted, "--ck-dim": theme.dim,
    "--ck-border": theme.border, "--ck-accent": accent || theme.accent, "--ck-idle": theme.idle,
    "--ck-blue": theme.blue, "--ck-green": theme.green, "--ck-red": theme.red,
    "--ck-yellow": theme.yellow, "--ck-magenta": theme.magenta, "--ck-cyan": theme.cyan,
  };
  for (const [k, v] of Object.entries(set)) r.setProperty(k, v);
}
