const KEY = "cockpit.settings.v1";

export interface Settings {
  /** Cockpit background opacity (0 = fully see-through to the macOS blur, 1 = opaque). */
  bgOpacity: number;
  themeId: string;
  accent: string | null;
  /** Background blur radius in px applied via CGS (0 = no blur). */
  blurRadius: number;
}

export const DEFAULT_SETTINGS: Settings = { bgOpacity: 0.62, themeId: "amber-hud", accent: null, blurRadius: 24 };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const m = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings & { blur?: unknown };
      return { bgOpacity: m.bgOpacity, themeId: m.themeId, accent: m.accent, blurRadius: typeof m.blurRadius === "number" ? m.blurRadius : DEFAULT_SETTINGS.blurRadius };
    }
  } catch { /* no localStorage / bad json — use defaults */ }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
