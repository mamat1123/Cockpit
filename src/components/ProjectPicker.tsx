import { useEffect, useMemo, useState } from "react";
import { listProjects, type Project } from "../lib/projectsClient";
import "./ProjectPicker.css";

interface Row { cwd: string; label: string; sub: string; typed?: boolean }

function rel(ms: number, now: number): string {
  if (!ms) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ProjectPicker({ onPick, onClose }: { onPick: (cwd: string) => void; onClose: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const now = Date.now();
  useEffect(() => { listProjects().then(setProjects).catch(() => {}); }, []);

  const rows: Row[] = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const typed = q.trim().startsWith("/")
      ? [{ cwd: q.trim(), label: "Open path", sub: q.trim(), typed: true }]
      : [];
    const matched = projects
      .filter((p) => !ql || p.label.toLowerCase().includes(ql) || p.cwd.toLowerCase().includes(ql))
      .map((p) => ({ cwd: p.cwd, label: p.label, sub: `${p.cwd}  ·  ${rel(p.lastUsed, now)}` }));
    return [...typed, ...matched];
  }, [projects, q, now]);

  useEffect(() => { setSel(0); }, [q]);
  const pick = (i: number) => { const r = rows[i]; if (r) onPick(r.cwd); };

  return (
    <div className="picker" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="picker__panel" role="dialog" aria-label="Open project">
        <input
          className="picker__input"
          autoFocus
          placeholder="Open project — type to filter, or paste an absolute path…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
          }}
        />
        <div className="picker__list">
          {rows.length === 0 ? (
            <p className="picker__empty">No recent projects. Paste an absolute path to open one.</p>
          ) : (
            rows.map((r, i) => (
              <button
                key={r.cwd + i}
                className={`picker__row${i === sel ? " is-sel" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(i)}
              >
                <span className="picker__label">{r.typed ? "↳ " : ""}{r.label}</span>
                <span className="picker__sub">{r.sub}</span>
              </button>
            ))
          )}
        </div>
        <div className="picker__foot"><kbd>↑↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> cancel</div>
      </div>
    </div>
  );
}
