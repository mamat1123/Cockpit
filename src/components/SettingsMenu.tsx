import { useEffect } from "react";
import { THEMES, themeById } from "../lib/themes";
import { DEFAULT_SETTINGS, type Settings, type BlurMaterial } from "../lib/settings";
import "./SettingsMenu.css";

const BLUR_OPTIONS: { value: BlurMaterial; label: string }[] = [
  { value: "none", label: "None" },
  { value: "hudWindow", label: "HUD" },
  { value: "fullScreenUI", label: "Full-screen UI" },
  { value: "sidebar", label: "Sidebar" },
  { value: "underWindowBackground", label: "Under-window" },
];

export function SettingsMenu({ settings, onPatch, onClose }: {
  settings: Settings;
  onPatch: (p: Partial<Settings>) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const accentValue = settings.accent ?? themeById(settings.themeId).accent;

  return (
    <div className="settings" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings__panel" role="dialog" aria-label="Settings">
        <div className="settings__head">
          <h3>Settings</h3>
          <span className="settings__hint">esc to close</span>
        </div>

        <div className="settings__block">
          <div className="settings__label">
            <span className="settings__name">Theme</span>
            <span className="settings__desc">color palette for the cockpit and terminals</span>
          </div>
          <div className="settings__grid">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings__swatch${settings.themeId === t.id ? " is-active" : ""}`}
                onClick={() => onPatch({ themeId: t.id })}
                aria-pressed={settings.themeId === t.id}
                aria-label={t.name}
              >
                <span className="settings__swatch-preview" style={{ background: t.bg, borderColor: t.border }}>
                  <span className="settings__swatch-dots">
                    <span style={{ background: t.accent }} />
                    <span style={{ background: t.idle }} />
                    <span style={{ background: t.blue }} />
                  </span>
                  <span className="settings__swatch-text" style={{ background: t.text }} />
                  <span className="settings__swatch-text settings__swatch-text--short" style={{ background: t.muted }} />
                </span>
                <span className="settings__swatch-name">{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">Accent override</span>
            <span className="settings__desc">overrides the theme accent color everywhere</span>
          </div>
          <div className="settings__control">
            {settings.accent !== null && (
              <button type="button" className="settings__link" onClick={() => onPatch({ accent: null })}>Reset</button>
            )}
            <input
              className="settings__color"
              type="color"
              value={accentValue}
              onChange={(e) => onPatch({ accent: e.target.value })}
              aria-label="Accent override"
            />
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">Background opacity</span>
            <span className="settings__desc">how much the desktop blur shows through the terminals</span>
          </div>
          <div className="settings__control">
            <input
              className="settings__range"
              type="range"
              min={0.2}
              max={1}
              step={0.01}
              value={settings.bgOpacity}
              onChange={(e) => onPatch({ bgOpacity: parseFloat(e.target.value) })}
              aria-label="Background opacity"
            />
            <span className="settings__val">{Math.round(settings.bgOpacity * 100)}%</span>
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">Window blur</span>
            <span className="settings__desc">macOS vibrancy material behind the cockpit</span>
          </div>
          <div className="settings__control">
            <select
              className="settings__select"
              value={settings.blur}
              onChange={(e) => onPatch({ blur: e.target.value as BlurMaterial })}
              aria-label="Window blur"
            >
              {BLUR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="settings__foot">
          <button type="button" className="settings__reset" onClick={() => onPatch(DEFAULT_SETTINGS)}>Reset all</button>
        </div>
      </div>
    </div>
  );
}
