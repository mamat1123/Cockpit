import { useEffect, useRef, useState } from "react";
import type { AgentProvider } from "../layout/paneLayout";
import { PROVIDERS } from "../lib/providers";
import { ProviderIcon } from "./icons/ProviderIcons";
import "./ProviderPicker.css";

export type ProviderPickerContext =
  | { kind: "newTab"; cwd: string }
  | { kind: "split" }
  | { kind: "splitDown" };

function hintFor(context: ProviderPickerContext): string {
  if (context.kind === "newTab") return `New tab · ${context.cwd}`;
  if (context.kind === "split") return "Split pane →";
  return "Split pane ↓";
}

export function ProviderPicker({ context, onPick, onCancel }: {
  context: ProviderPickerContext;
  onPick: (provider: AgentProvider) => void;
  onCancel: () => void;
}) {
  const enabled = PROVIDERS.filter((p) => p.enabled);
  const [focusIdx, setFocusIdx] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { panelRef.current?.focus(); }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, enabled.length - 1)); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); onPick(enabled[focusIdx].id); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= enabled.length) { e.preventDefault(); setFocusIdx(n - 1); onPick(enabled[n - 1].id); }
  };

  return (
    <div className="provider-picker" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        className="provider-picker__panel"
        role="dialog"
        aria-label="Start with which provider?"
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <p className="provider-picker__title">Start with which provider?</p>
        <p className="provider-picker__hint">{hintFor(context)}</p>
        <div className="provider-picker__row">
          {PROVIDERS.map((p) => {
            const idx = enabled.findIndex((ep) => ep.id === p.id);
            const isFocused = p.enabled && idx === focusIdx;
            return (
              <button
                key={p.id}
                type="button"
                className={`provider-picker__card provider-${p.id}${isFocused ? " is-focused" : ""}`}
                disabled={!p.enabled}
                onClick={() => { if (p.enabled) onPick(p.id); }}
                onMouseEnter={() => { if (p.enabled) setFocusIdx(idx); }}
              >
                <span className="provider-picker__mark"><ProviderIcon id={p.id} /></span>
                <span className="provider-picker__label">{p.label}</span>
                {p.enabled ? (
                  <span className="provider-picker__key">{idx + 1}</span>
                ) : (
                  <span className="provider-picker__soon">Soon</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="provider-picker__foot">
          <span>← → select · enter confirm</span>
          <span>esc cancel</span>
        </div>
      </div>
    </div>
  );
}
