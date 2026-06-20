import { useState } from "react";
import "./PaneHeader.css";

export function PaneHeader({ title, working, onRename, onPopOut, onClose, dragProps }: {
  title: string;
  working: boolean;
  onRename: (title: string) => void;
  onPopOut: () => void;
  onClose: () => void;
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== title) onRename(t);
    else setDraft(title);
  };
  return (
    <div className="pane-head" {...dragProps}>
      {editing ? (
        <input
          className="pane-head__input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") { setDraft(title); setEditing(false); }
          }}
        />
      ) : (
        <span
          className="pane-head__name"
          onDoubleClick={() => { setDraft(title); setEditing(true); }}
          title="ดับเบิลคลิกเพื่อเปลี่ยนชื่อ"
        >
          {title}
        </span>
      )}
      <span className={`pane-head__chip${working ? " is-working" : ""}`}>
        <span className="pane-head__dot" />
        <span className="pane-head__bars"><i /><i /><i /></span>
        <span className="pane-head__lbl">{working ? "working" : "idle"}</span>
      </span>
      <button className="pane-head__btn" onClick={onPopOut} aria-label="เปิดในแท็บใหม่" title="เปิดในแท็บใหม่">↗</button>
      <button className="pane-head__btn" onClick={onClose} aria-label="ปิด" title="ปิด">✕</button>
    </div>
  );
}
