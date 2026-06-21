const KEY = "cockpit.settings.v1";

export interface Settings {
  /** Cockpit background opacity (0 = fully see-through to the macOS blur, 1 = opaque). */
  bgOpacity: number;
}

export const DEFAULT_SETTINGS: Settings = { bgOpacity: 0.62 };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* no localStorage / bad json — use defaults */ }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
