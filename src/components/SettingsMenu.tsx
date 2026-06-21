import { useEffect } from "react";
import "./SettingsMenu.css";

export function SettingsMenu({ bgOpacity, onBgOpacity, onClose }: {
  bgOpacity: number;
  onBgOpacity: (v: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="settings" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings__panel" role="dialog" aria-label="Settings">
        <div className="settings__head">
          <h3>Settings</h3>
          <span className="settings__hint">esc to close</span>
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
              value={bgOpacity}
              onChange={(e) => onBgOpacity(parseFloat(e.target.value))}
              aria-label="Background opacity"
            />
            <span className="settings__val">{Math.round(bgOpacity * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
