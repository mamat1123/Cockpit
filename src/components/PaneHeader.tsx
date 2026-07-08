import { useEffect, useRef, useState } from "react";
import { usePaneSavings } from "../lib/savingsStore";
import { PONYTAIL_LEVELS, PONYTAIL_META, type PonytailLevel } from "../lib/ponytailClient";
import type { AgentProvider } from "../layout/paneLayout";
import type { PaneState } from "../lib/paneState";
import { PROVIDERS, providerMeta } from "../lib/providers";
import { ProviderIcon } from "./icons/ProviderIcons";
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

export function PaneHeader({ paneId, title, repo, state, waitLabel, headroom, ponytail, provider, ponytailInstalled, onRename, onPopOut, onClose, onToggleHeadroom, onSetPonytail, onSelectProvider, dragHandleProps }: {
  paneId: string;
  title: string;
  repo: string;
  state: PaneState;
  waitLabel: string | null;
  headroom: boolean;
  ponytail: PonytailLevel;
  provider: AgentProvider;
  ponytailInstalled: boolean;
  onRename: (title: string) => void;
  onPopOut: () => void;
  onClose: () => void;
  onToggleHeadroom: () => void;
  onSetPonytail: (level: PonytailLevel) => void;
  onSelectProvider: (provider: AgentProvider) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const [editing, setEditing] = useState(false);
  const sv = usePaneSavings(paneId);
  const rate = sv.requests > 0 ? Math.round((sv.cacheHits / sv.requests) * 100) : 0;
  const [draft, setDraft] = useState(title);
  const [ptOpen, setPtOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const ptWrapRef = useRef<HTMLSpanElement>(null);
  const providerWrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ptOpen && !providerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ptWrapRef.current && !ptWrapRef.current.contains(e.target as Node)) setPtOpen(false);
      if (providerWrapRef.current && !providerWrapRef.current.contains(e.target as Node)) setProviderOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ptOpen, providerOpen]);
  const activeProvider = providerMeta(provider);
  const meter = (fill: number) => (
    <span className="pane-head__pt-meter">{[0, 1, 2].map((i) => <i key={i} className={i < fill ? "on" : ""} />)}</span>
  );
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
      <span className={`pane-head__chip${state === "working" ? " is-working" : ""}${state === "waiting" ? " is-waiting" : ""}`}>
        <span className="pane-head__dot" />
        <span className="pane-head__bars"><i /><i /><i /></span>
        <span className="pane-head__lbl">{state === "waiting" ? (waitLabel ?? "waiting") : state}</span>
      </span>
      <span className="pane-head__provider-wrap" ref={providerWrapRef}>
        <button
          className={`pane-head__provider provider-${provider}`}
          onClick={() => setProviderOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={providerOpen}
          title={`Provider: ${activeProvider.label}`}
        >
          <span className="pane-head__provider-mark"><ProviderIcon id={provider} /></span>
          <span className="pane-head__provider-car">▾</span>
        </button>
        {providerOpen && (
          <span className="pane-head__provider-menu" role="menu">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`pane-head__provider-item provider-${p.id}${p.id === provider ? " is-sel" : ""}`}
                role="menuitemradio"
                aria-checked={p.id === provider}
                disabled={!p.enabled || p.id === provider}
                onClick={() => {
                  if (!p.enabled || p.id === provider) return;
                  setProviderOpen(false);
                  onSelectProvider(p.id);
                }}
              >
                <span className="pane-head__provider-item-mark"><ProviderIcon id={p.id} /></span>
                <span className="pane-head__provider-item-copy">
                  <b>{p.label}</b>
                  <small>{p.enabled ? p.description : "coming soon"}</small>
                </span>
              </button>
            ))}
          </span>
        )}
      </span>
      {provider === "claude" && <span className="pane-head__hr-wrap">
        <button
          className={`pane-head__hr${headroom ? " is-on" : ""}`}
          onClick={onToggleHeadroom}
          title={headroom ? "Headroom: เปิด (กดเพื่อปิด)" : "Headroom: ปิด (กดเพื่อเปิด)"}
          aria-pressed={headroom}
        >
          <span className="pane-head__hr-sw" /><span className="pane-head__hr-lbl">HR</span>
        </button>
        <span className="pane-head__hr-pop" role="tooltip">
          <span className="pane-head__hr-pop-h">Headroom · {headroom ? "on" : "off"}</span>
          {sv.requests === 0 ? (
            <span className="pane-head__hr-pop-empty">{headroom ? "no activity yet" : "routing off"}</span>
          ) : (
            <>
              <span className="pane-head__hr-pop-row"><b>{sv.cacheHits}/{sv.requests}</b> cache hits <i>({rate}%)</i></span>
              <span className="pane-head__hr-pop-row"><b>{sv.tokensSaved.toLocaleString()}</b> tokens saved</span>
              <span className="pane-head__hr-pop-row"><b>${sv.usd.toFixed(2)}</b> est. saved</span>
            </>
          )}
          <span className="pane-head__hr-pop-foot">since app start</span>
        </span>
      </span>}
      {/* PT works on any claude-binary pane (incl. z.ai/GLM); HR above stays claude-only
          because the GLM wrapper pins ANTHROPIC_BASE_URL. */}
      {provider !== "codex" && <span className="pane-head__pt-wrap" ref={ptWrapRef}>
        <button
          className={`pane-head__pt lvl-${ponytail}${ponytailInstalled ? "" : " is-disabled"}`}
          onClick={() => setPtOpen((o) => !o)}
          title={ponytailInstalled ? `Ponytail level: ${ponytail}` : "ponytail plugin ยังไม่ลง"}
          aria-haspopup="menu"
          aria-expanded={ptOpen}
        >
          <span className="pane-head__pt-lbl">PT</span>
          {meter(PONYTAIL_META[ponytail].fill)}
          <span className="pane-head__pt-car">▾</span>
        </button>
        {ptOpen && ponytailInstalled && (
          <span className="pane-head__pt-menu" role="menu">
            {PONYTAIL_LEVELS.map((l) => (
              <button
                key={l}
                className={`pane-head__pt-item lvl-${l}${l === ponytail ? " is-sel" : ""}`}
                role="menuitemradio"
                aria-checked={l === ponytail}
                onClick={() => { setPtOpen(false); if (l !== ponytail) onSetPonytail(l); }}
              >
                <span className="pane-head__pt-item-top">{meter(PONYTAIL_META[l].fill)}<b>{l}</b></span>
                <span className="pane-head__pt-item-desc">{PONYTAIL_META[l].desc}</span>
              </button>
            ))}
          </span>
        )}
        {ptOpen && !ponytailInstalled && (
          <span className="pane-head__pt-menu pane-head__pt-nudge" role="dialog">
            <span className="pane-head__pt-nudge-h">ต้องลง ponytail plugin ก่อน</span>
            <code className="pane-head__pt-nudge-cmd">/plugin marketplace add DietrichGebert/ponytail</code>
            <code className="pane-head__pt-nudge-cmd">/plugin install ponytail@ponytail</code>
            <span className="pane-head__pt-nudge-foot">รันใน Claude Code แล้ว toggle ใหม่</span>
          </span>
        )}
      </span>}
      <button className="pane-head__btn" onClick={onPopOut} aria-label="เปิดในแท็บใหม่" title="เปิดในแท็บใหม่"><PopOutIcon /></button>
      <button className="pane-head__btn pane-head__btn--x" onClick={onClose} aria-label="ปิด" title="ปิด"><CloseIcon /></button>
    </div>
  );
}
