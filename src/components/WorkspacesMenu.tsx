import { useEffect, useState } from "react";
import { getPresets, deletePreset } from "../lib/persistence";
import type { SavedLayout } from "../layout/paneLayout";
import "./WorkspacesMenu.css";

export function WorkspacesMenu({ onLoad, onSaveCurrent, onClose }: {
  onLoad: (saved: SavedLayout) => void;
  onSaveCurrent: (name: string) => void;
  onClose: () => void;
}) {
  const [presets, setPresets] = useState<Record<string, SavedLayout>>({});
  const [name, setName] = useState("");
  const refresh = () => setPresets(getPresets());
  useEffect(() => { refresh(); }, []);
  const names = Object.keys(presets).sort();
  const save = () => { const n = name.trim(); if (!n) return; onSaveCurrent(n); setName(""); refresh(); };

  return (
    <div className="ws" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ws__panel" role="dialog" aria-label="Workspaces">
        <div className="ws__save">
          <input
            className="ws__input" autoFocus placeholder="Save current layout as…" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") onClose(); }}
          />
          <button className="ws__savebtn" onClick={save} disabled={!name.trim()}>Save</button>
        </div>
        <div className="ws__list">
          {names.length === 0 ? (
            <p className="ws__empty">No workspaces yet. Arrange your panes, then save one above.</p>
          ) : (
            names.map((n) => (
              <div key={n} className="ws__row">
                <button className="ws__load" onClick={() => onLoad(presets[n])}>
                  <span className="ws__name">{n}</span>
                  <span className="ws__meta">{presets[n].tabs.reduce((a, t) => a + t.rows.reduce((b, r) => b + r.panes.length, 0), 0)} panes · {presets[n].tabs.length} tabs</span>
                </button>
                <button className="ws__del" title="Delete" onClick={() => { deletePreset(n); refresh(); }}>✕</button>
              </div>
            ))
          )}
        </div>
        <div className="ws__foot">load a workspace to switch · current sessions close</div>
      </div>
    </div>
  );
}
