const KEY = "cockpit.settings.v1";

export interface NotificationSettings {
  enabled: boolean; os: boolean; sound: boolean; toast: boolean; beacon: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = { enabled: true, os: true, sound: true, toast: true, beacon: true };

/** Where the tab list docks. The top chrome (drag/usage/tools/bell) stays either way. */
export type TabBarPosition = "top" | "left";

export interface Settings {
  /** Cockpit background opacity (0 = fully see-through to the macOS blur, 1 = opaque). */
  bgOpacity: number;
  themeId: string;
  accent: string | null;
  /** Background blur radius in px applied via CGS (0 = no blur). */
  blurRadius: number;
  /** Terminal font family (primary name only; a `, monospace` fallback is appended on apply). */
  fontFamily: string;
  /** Terminal font size in px. */
  fontSize: number;
  /** Completion-notification switches (see CONTEXT.md). */
  notifications: NotificationSettings;
  /** Tab list orientation: horizontal top strip or 200px left sidebar. */
  tabBar: TabBarPosition;
  /** Create a git worktree ("Burrow") per new Session. See ADR 0011. */
  burrows: boolean;
}

export const DEFAULT_SETTINGS: Settings = { bgOpacity: 0.62, themeId: "amber-hud", accent: null, blurRadius: 24, fontFamily: "Menlo", fontSize: 13, notifications: DEFAULT_NOTIFICATIONS, tabBar: "top", burrows: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const m = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
      return {
        bgOpacity: m.bgOpacity,
        themeId: m.themeId,
        accent: m.accent,
        blurRadius: typeof m.blurRadius === "number" ? m.blurRadius : DEFAULT_SETTINGS.blurRadius,
        fontFamily: typeof m.fontFamily === "string" && m.fontFamily ? m.fontFamily : DEFAULT_SETTINGS.fontFamily,
        fontSize: typeof m.fontSize === "number" && m.fontSize > 0 ? m.fontSize : DEFAULT_SETTINGS.fontSize,
        notifications: { ...DEFAULT_NOTIFICATIONS, ...(m.notifications ?? {}) },
        tabBar: m.tabBar === "left" ? "left" : "top",
        burrows: typeof m.burrows === "boolean" ? m.burrows : true,
      };
    }
  } catch { /* no localStorage / bad json — use defaults */ }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
