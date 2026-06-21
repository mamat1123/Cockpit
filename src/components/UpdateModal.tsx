import { useEffect, useState } from "react";
import { downloadAndInstall, type Update } from "../lib/updateClient";
import "./UpdateModal.css";

type State = "idle" | "installing" | "error";

export function UpdateModal({ update, currentVersion, onClose }: {
  update: Update;
  currentVersion: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null }>({ downloaded: 0, total: null });
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state !== "installing") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, state]);

  async function install() {
    setState("installing");
    setError("");
    setProgress({ downloaded: 0, total: null });
    try {
      await downloadAndInstall(update, (downloaded, total) => setProgress({ downloaded, total }));
      // success -> app relaunches, no further UI needed
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  const notes = update.body?.trim();
  const installing = state === "installing";
  const { downloaded, total } = progress;
  const pct = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  return (
    <div className="upd" onMouseDown={(e) => { if (e.target === e.currentTarget && !installing) onClose(); }}>
      <div className="upd__panel" role="dialog" aria-label="Update available">
        <div className="upd__head">
          <h3>มีอัปเดตใหม่</h3>
          {!installing && <span className="upd__hint">esc to close</span>}
        </div>

        <div className="upd__body">
          <div className="upd__versions">
            <span className="upd__ver upd__ver--old">v{currentVersion || "?"}</span>
            <span className="upd__arrow">→</span>
            <span className="upd__ver upd__ver--new">v{update.version}</span>
          </div>

          {notes && (
            <div className="upd__notes" aria-label="Release notes">{notes}</div>
          )}

          {installing && (
            <div className="upd__progress" aria-label="Download progress">
              {pct !== null ? (
                <>
                  <div className="upd__bar"><div className="upd__bar-fill" style={{ width: `${pct}%` }} /></div>
                  <span className="upd__pct">{pct}%</span>
                </>
              ) : (
                <>
                  <div className="upd__bar upd__bar--indeterminate"><div className="upd__bar-fill" /></div>
                  <span className="upd__pct">กำลังดาวน์โหลด…</span>
                </>
              )}
            </div>
          )}

          {state === "error" && (
            <div className="upd__error" role="alert">{error || "การติดตั้งล้มเหลว"}</div>
          )}
        </div>

        <div className="upd__foot">
          {state === "error" ? (
            <>
              <button type="button" className="upd__btn" onClick={onClose}>ภายหลัง</button>
              <button type="button" className="upd__btn upd__btn--primary" onClick={install}>ลองอีกครั้ง</button>
            </>
          ) : (
            <>
              <button type="button" className="upd__btn" onClick={onClose} disabled={installing}>ภายหลัง</button>
              <button type="button" className="upd__btn upd__btn--primary" onClick={install} disabled={installing}>
                {installing ? "กำลังติดตั้ง…" : "ติดตั้ง & รีสตาร์ท"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
