import { useState } from "react";
import "./PaneHeader.css";

const PopOutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 4h6v6" />
    <path d="M20 4 L11 13" />
    <path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
  </svg>
);
const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M6 6 L18 18 M18 6 L6 18" />
  </svg>
);

export function PaneHeader({ title, repo, working, onRename, onPopOut, onClose, dragHandleProps }: {
  title: string;
  repo: string;
  working: boolean;
  onRename: (title: string) => void;
  onPopOut: () => void;
  onClose: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
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
    <div className="pane-head" {...dragHandleProps}>
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
      {repo ? <span className="pane-head__repo">{repo}</span> : null}
      <span className={`pane-head__chip${working ? " is-working" : ""}`}>
        <span className="pane-head__dot" />
        <span className="pane-head__bars"><i /><i /><i /></span>
        <span className="pane-head__lbl">{working ? "working" : "idle"}</span>
      </span>
      <button className="pane-head__btn" onClick={onPopOut} aria-label="เปิดในแท็บใหม่" title="เปิดในแท็บใหม่"><PopOutIcon /></button>
      <button className="pane-head__btn pane-head__btn--x" onClick={onClose} aria-label="ปิด" title="ปิด"><CloseIcon /></button>
    </div>
  );
}
