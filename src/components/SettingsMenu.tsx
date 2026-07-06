import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { THEMES, themeById } from "../lib/themes";
import { MONO_FONTS, FONT_SIZE_MIN, FONT_SIZE_MAX } from "../lib/fonts";
import { DEFAULT_SETTINGS, type Settings } from "../lib/settings";
import { checkForUpdate, type Update } from "../lib/updateClient";
import { ensureNotifyPermission } from "../lib/osNotify";
import { saveZaiToken, zaiTokenConfigured } from "../lib/usageClient";
import "./SettingsMenu.css";

export function SettingsMenu({ settings, onPatch, onClose, onUpdateFound }: {
  settings: Settings;
  onPatch: (p: Partial<Settings>) => void;
  onClose: () => void;
  onUpdateFound: (u: Update) => void;
}) {
  const [version, setVersion] = useState("");
  const [checkState, setCheckState] = useState<"idle" | "checking" | "uptodate">("idle");
  const [zaiToken, setZaiToken] = useState("");
  const [zaiConfigured, setZaiConfigured] = useState<boolean | null>(null);
  const [zaiSaving, setZaiSaving] = useState(false);
  const [zaiError, setZaiError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => { getVersion().then(setVersion).catch(() => setVersion("")); }, []);
  useEffect(() => { zaiTokenConfigured().then(setZaiConfigured).catch(() => setZaiConfigured(false)); }, []);

  async function check() {
    setCheckState("checking");
    const u = await checkForUpdate();
    if (u) { onUpdateFound(u); } else { setCheckState("uptodate"); }
  }

  async function saveZai() {
    setZaiSaving(true);
    setZaiError("");
    try {
      await saveZaiToken(zaiToken);
      setZaiToken("");
      setZaiConfigured(await zaiTokenConfigured());
    } catch (e) {
      setZaiError(e instanceof Error ? e.message : String(e));
    } finally {
      setZaiSaving(false);
    }
  }

  const accentValue = settings.accent ?? themeById(settings.themeId).accent;
  // Keep the current family selectable even if it's a custom one not in the curated list.
  const fontOptions = MONO_FONTS.includes(settings.fontFamily) ? MONO_FONTS : [settings.fontFamily, ...MONO_FONTS];

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
            <span className="settings__name">Terminal font</span>
            <span className="settings__desc">font family for all terminal panes (changes live, sessions keep running)</span>
          </div>
          <div className="settings__control">
            <select
              className="settings__select"
              value={settings.fontFamily}
              onChange={(e) => onPatch({ fontFamily: e.target.value })}
              aria-label="Terminal font family"
            >
              {fontOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">Font size</span>
            <span className="settings__desc">terminal text size in pixels</span>
          </div>
          <div className="settings__control">
            <input
              className="settings__range"
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={settings.fontSize}
              onChange={(e) => onPatch({ fontSize: parseInt(e.target.value, 10) })}
              aria-label="Font size"
            />
            <span className="settings__val">{settings.fontSize}px</span>
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
            <span className="settings__desc">how much the desktop behind the cockpit is blurred (Ghostty-style)</span>
          </div>
          <div className="settings__control">
            <input
              className="settings__range"
              type="range"
              min={0}
              max={80}
              step={1}
              value={settings.blurRadius}
              onChange={(e) => onPatch({ blurRadius: parseInt(e.target.value, 10) })}
              aria-label="Window blur radius"
            />
            <span className="settings__val">{settings.blurRadius === 0 ? "Off" : `${settings.blurRadius}px`}</span>
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">Tab bar</span>
            <span className="settings__desc">dock the tab list along the top or the left edge</span>
          </div>
          <div className="settings__control">
            <div className="settings__seg" role="radiogroup" aria-label="Tab bar position">
              {(["top", "left"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  className={`settings__seg-btn${settings.tabBar === pos ? " is-active" : ""}`}
                  role="radio"
                  aria-checked={settings.tabBar === pos}
                  onClick={() => onPatch({ tabBar: pos })}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">New Session in its own Burrow</span>
            <span className="settings__desc">create a git worktree per new Session so it can work in isolation</span>
          </div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" checked={settings.burrows}
              onChange={(e) => onPatch({ burrows: e.target.checked })}
              aria-label="New Session in its own Burrow" />
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">z.ai monitor token</span>
            <span className="settings__desc">shows the z.ai (GLM Coding Plan) usage gauge — token from your own z.ai account, saved in macOS Keychain</span>
          </div>
          <div className="settings__control settings__control--column">
            <div className="settings__zai-row">
              <input
                className="settings__zai-input"
                type="password"
                placeholder={zaiConfigured ? "•••••••• (configured)" : "paste monitor token"}
                value={zaiToken}
                onChange={(e) => setZaiToken(e.target.value)}
                aria-label="z.ai monitor token"
              />
              <button
                type="button"
                className="settings__btn"
                onClick={saveZai}
                disabled={zaiSaving || (zaiToken.trim() === "" && !zaiConfigured)}
              >
                {zaiSaving ? "saving…" : zaiToken.trim() === "" && zaiConfigured ? "clear" : "save"}
              </button>
            </div>
            <span className={`settings__zai-status${zaiConfigured ? " is-on" : ""}`} aria-live="polite">
              {zaiError ? `⚠ ${zaiError}` : zaiConfigured === null ? "…" : zaiConfigured ? "✓ configured" : "not configured"}
            </span>
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">Updates</span>
            <span className="settings__desc">ตรวจหาเวอร์ชันใหม่จาก GitHub</span>
          </div>
          <div className="settings__control">
            <span className="settings__updstatus">
              {version && `v${version}`}
              {checkState === "uptodate" && <span className="settings__upddone"> ✓ ใช้เวอร์ชันล่าสุดแล้ว</span>}
            </span>
            <button type="button" className="settings__btn" onClick={check} disabled={checkState === "checking"}>
              {checkState === "checking" ? "กำลังตรวจ…" : "ตรวจหาอัปเดต"}
            </button>
          </div>
        </div>

        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">Notify when a session finishes</span>
            <span className="settings__desc">alert you the moment Claude hands a turn back to you</span>
          </div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" checked={settings.notifications.enabled}
              onChange={(e) => onPatch({ notifications: { ...settings.notifications, enabled: e.target.checked } })}
              aria-label="Enable completion notifications" />
          </div>
        </div>
        <div className="settings__row settings__row--sub">
          <div className="settings__label"><span className="settings__name">macOS notification</span></div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" disabled={!settings.notifications.enabled} checked={settings.notifications.os}
              onChange={async (e) => { if (e.target.checked) await ensureNotifyPermission(); onPatch({ notifications: { ...settings.notifications, os: e.target.checked } }); }}
              aria-label="macOS notification" />
          </div>
        </div>
        <div className="settings__row settings__row--sub2">
          <div className="settings__label"><span className="settings__name">Play sound</span></div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" disabled={!settings.notifications.enabled || !settings.notifications.os} checked={settings.notifications.sound}
              onChange={(e) => onPatch({ notifications: { ...settings.notifications, sound: e.target.checked } })}
              aria-label="Play notification sound" />
          </div>
        </div>
        <div className="settings__row settings__row--sub">
          <div className="settings__label"><span className="settings__name">In-app toast</span></div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" disabled={!settings.notifications.enabled} checked={settings.notifications.toast}
              onChange={(e) => onPatch({ notifications: { ...settings.notifications, toast: e.target.checked } })}
              aria-label="In-app toast" />
          </div>
        </div>
        <div className="settings__row settings__row--sub">
          <div className="settings__label"><span className="settings__name">Floating beacon</span></div>
          <div className="settings__control">
            <input className="settings__toggle" type="checkbox" disabled={!settings.notifications.enabled} checked={settings.notifications.beacon}
              onChange={(e) => onPatch({ notifications: { ...settings.notifications, beacon: e.target.checked } })}
              aria-label="Floating beacon" />
          </div>
        </div>

        <div className="settings__foot">
          <button type="button" className="settings__reset" onClick={() => onPatch(DEFAULT_SETTINGS)}>Reset all</button>
        </div>
      </div>
    </div>
  );
}
