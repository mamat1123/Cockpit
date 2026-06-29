import { useEffect, useState } from "react";
import { getPresets, deletePreset } from "../lib/persistence";
import { layoutHasSessions, type SavedLayout } from "../layout/paneLayout";
import "./WorkspacesMenu.css";

export function WorkspacesMenu({ onLoad, onSaveCurrent, onClose }: {
  onLoad: (saved: SavedLayout) => void;
  onSaveCurrent: (name: string, keepSessions: boolean) => void;
  onClose: () => void;
}) {
  const [presets, setPresets] = useState<Record<string, SavedLayout>>({});
  const [name, setName] = useState("");
  const [keepSessions, setKeepSessions] = useState(false);
  const refresh = () => setPresets(getPresets());
  useEffect(() => { refresh(); }, []);
  const names = Object.keys(presets).sort();
  const save = () => { const n = name.trim(); if (!n) return; onSaveCurrent(n, keepSessions); setName(""); refresh(); };

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
        <div className="ws__mode">
          <div className="ws__seg" role="radiogroup" aria-label="What to save">
            <button
              className={"ws__segbtn" + (keepSessions ? "" : " is-active")}
              role="radio" aria-checked={!keepSessions} onClick={() => setKeepSessions(false)}
            >
              <span className="ws__segt">Layout</span>
              <span className="ws__segs">fresh terminals</span>
            </button>
            <button
              className={"ws__segbtn" + (keepSessions ? " is-active" : "")}
              role="radio" aria-checked={keepSessions} onClick={() => setKeepSessions(true)}
            >
              <span className="ws__segt">Layout + sessions</span>
              <span className="ws__segs">stay connected</span>
            </button>
          </div>
          <p className="ws__hint">
            {keepSessions
              ? "Reopens connected to the terminals running now."
              : "Reopens these panes with fresh terminals."}
          </p>
        </div>
        <div className="ws__list">
          {names.length === 0 ? (
            <p className="ws__empty">No workspaces yet. Arrange your panes, then save one above.</p>
          ) : (
            names.map((n) => (
              <div key={n} className="ws__row">
                <button className="ws__load" onClick={() => onLoad(presets[n])}>
                  <span className="ws__name">
                    {n}
                    {layoutHasSessions(presets[n]) && <span className="ws__live"><i />live</span>}
                  </span>
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
