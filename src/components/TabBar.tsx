import { useEffect, useRef, useState } from "react";
import type { Layout, Tab } from "../layout/paneLayout";
import { paneLastLineAt } from "../lib/terminalRegistry";
import { deriveState } from "../lib/paneState";
import { waitingPanes } from "../lib/waiting";
import { UsageStrip } from "./UsageGauges";
import { NotificationBell } from "./NotificationBell";
import "./TabBar.css";

const svgProps = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

/** Mission Control — 2×2 grid of session cards (one live). */
const GridIcon = () => (
  <svg {...svgProps}>
    <rect x="3" y="3" width="8" height="8" rx="2" />
    <rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" stroke="none" />
    <rect x="3" y="13" width="8" height="8" rx="2" />
    <rect x="13" y="13" width="8" height="8" rx="2" />
  </svg>
);
/** Workspaces — stacked layers (saved layouts). */
const LayersIcon = () => (
  <svg {...svgProps}>
    <path d="M12 3 L21 8 L12 13 L3 8 Z" />
    <path d="M3 12 L12 17 L21 12" />
    <path d="M3 16 L12 21 L21 16" />
  </svg>
);
/** Open project — folder + new. */
const FolderPlusIcon = () => (
  <svg {...svgProps}>
    <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M12 11v6M9 14h6" />
  </svg>
);

function rawTabName(t: Tab): string {
  return t.title || t.rows.flatMap((r) => r.panes)[0]?.title || "shell";
}
function tabName(t: Tab): string {
  const base = rawTabName(t);
  return base.length > 24 ? base.slice(0, 24) + "…" : base;
}
const paneCount = (t: Tab): number => t.rows.reduce((n, r) => n + r.panes.length, 0);

/** Settings — gear. */
const SettingsIcon = () => (
  <svg {...svgProps}>
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);
/** Close — X, used for the per-tab close button. */
const CloseIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
    <path d="M6 6 L18 18 M18 6 L6 18" />
  </svg>
);

/** Shared state/behavior for a tab strip (horizontal list or vertical sidebar): the
 *  working/waiting poll, double-click rename with the focus-steal grace defense, and
 *  the close-confirm chip. Exactly one strip renders items at a time; `enabled` skips
 *  the poll when this strip's list is hidden (the top bar in sidebar mode). */
function useTabStrip(layout: Layout, onRenameTab: (tabId: string, title: string) => void, onCloseTab: (tabId: string) => void, enabled: boolean) {
  // per-tab aggregate working state (any pane in the tab thinking) — drives the dot/equalizer
  const [working, setWorking] = useState<Set<string>>(() => new Set());
  const [waiting, setWaiting] = useState<Set<string>>(() => new Set());
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const now = Date.now();
      const w = new Set<string>();
      const ask = new Set<string>();
      for (const t of layoutRef.current.tabs) {
        const panes = t.rows.flatMap((r) => r.panes);
        if (panes.some((p) => waitingPanes.get(p.id))) ask.add(t.id);
        if (panes.some((p) => deriveState({ lastLineAt: paneLastLineAt(p.id) }, now, 800) === "working")) w.add(t.id);
      }
      const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...b].every((x) => a.has(x));
      setWorking((prev) => (same(prev, w) ? prev : w));
      setWaiting((prev) => (same(prev, ask) ? prev : ask));
    }, 400);
    return () => clearInterval(id);
  }, [enabled]);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const graceUntilRef = useRef(0);
  useEffect(() => {
    if (!editingTabId) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    // Double-clicking a tab is two clicks + a dblclick. Both clicks call onSelect (below), which
    // schedules a double-rAF focusTerminal() to pull focus into the terminal once it's visible —
    // that steal can land a couple of frames AFTER this input has already mounted and focused. A
    // single re-assertion can't reliably win that race, and since onBlur commits immediately,
    // losing focus even once tears the input down before a later re-assertion could matter. So for
    // a short grace window after opening rename, reclaim focus every frame and (see onBlur below)
    // ignore blur entirely, instead of trying to win a one-shot race.
    graceUntilRef.current = performance.now() + 200;
    let raf = 0;
    const tick = () => {
      if (performance.now() >= graceUntilRef.current) return;
      // focus() only — select()ing here would re-select the whole draft on every reclaim,
      // so a steal+reclaim mid-typing would make the next keystroke overwrite everything
      // typed so far instead of just landing at the caret.
      if (document.activeElement !== el) el.focus();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editingTabId]);

  const commitRename = (tabId: string) => {
    setEditingTabId(null);
    onRenameTab(tabId, draft);
  };

  const [confirmingTabId, setConfirmingTabId] = useState<string | null>(null);
  useEffect(() => {
    if (!confirmingTabId) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".cockpit-tab.is-confirming")) setConfirmingTabId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [confirmingTabId]);

  const requestClose = (t: Tab) => {
    if (paneCount(t) > 1) setConfirmingTabId(t.id);
    else onCloseTab(t.id);
  };

  return {
    working, waiting,
    editingTabId, setEditingTabId, draft, setDraft, inputRef, graceUntilRef, commitRename,
    confirmingTabId, setConfirmingTabId, requestClose, onCloseTab,
  };
}
type TabStrip = ReturnType<typeof useTabStrip>;

/** One tab row — identical behavior in both orientations; `vertical` only switches CSS. */
function TabItem({ t, index, layout, attention, unseenByTab, vertical, strip, onSelect, onReorder }: {
  t: Tab;
  index: number;
  layout: Layout;
  attention: Set<string>;
  unseenByTab: Map<string, number>;
  vertical?: boolean;
  strip: TabStrip;
  onSelect: (tabId: string) => void;
  onReorder: (tabId: string, toIndex: number) => void;
}) {
  const active = t.id === layout.activeTabId;
  const isWorking = strip.working.has(t.id);
  const isWaiting = strip.waiting.has(t.id);
  const attn = attention.has(t.id) && !active;
  const editing = strip.editingTabId === t.id;
  const confirming = strip.confirmingTabId === t.id;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`cockpit-tab${vertical ? " cockpit-tab--v" : ""}${active ? " is-active" : ""}${attn ? " is-attention" : ""}${confirming ? " is-confirming" : ""}`}
      draggable={!editing}
      onClick={() => onSelect(t.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t.id); }
      }}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const fromId = e.dataTransfer.getData("text/plain");
        if (fromId && fromId !== t.id) onReorder(fromId, index);
      }}
    >
      {confirming ? (
        <span className="confirm-chip">
          {`Close ${paneCount(t)} sessions?`}
          <button className="confirm-chip__go" onClick={(e) => { e.stopPropagation(); strip.setConfirmingTabId(null); strip.onCloseTab(t.id); }}>Close</button>
          <button className="confirm-chip__cancel" onClick={(e) => { e.stopPropagation(); strip.setConfirmingTabId(null); }}>Cancel</button>
        </span>
      ) : (
      <>
      {isWaiting ? (
        <span className="cockpit-tab__ask" aria-hidden="true">?</span>
      ) : isWorking ? (
        <span className="cockpit-tab__eq" aria-hidden="true"><i /><i /><i /></span>
      ) : (
        <span className="cockpit-tab__dot" aria-hidden="true" />
      )}
      {editing ? (
        <input
          ref={strip.inputRef}
          className="cockpit-tab__input"
          value={strip.draft}
          onChange={(e) => strip.setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            // Ignore blur during the steal-defense grace window above — the tick loop is
            // already reclaiming focus every frame, so this blur is the race, not the user.
            if (performance.now() < strip.graceUntilRef.current) return;
            strip.commitRename(t.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); strip.commitRename(t.id); }
            else if (e.key === "Escape") { e.preventDefault(); strip.setEditingTabId(null); }
          }}
        />
      ) : (
        <span
          className="cockpit-tab__title"
          onDoubleClick={(e) => { e.stopPropagation(); strip.setDraft(rawTabName(t)); strip.setEditingTabId(t.id); }}
        >
          {tabName(t)}
        </span>
      )}
      <span className="cockpit-tab__meta">
        <span className="cockpit-tab__ct">{paneCount(t)}</span>
        <button
          className="cockpit-tab__x"
          aria-label="Close tab"
          title="Close tab"
          onClick={(e) => { e.stopPropagation(); strip.requestClose(t); }}
        >
          <CloseIcon />
        </button>
      </span>
      {!active && (unseenByTab.get(t.id) ?? 0) > 0 && (
        <span className="cockpit-tab__badge">{unseenByTab.get(t.id)}</span>
      )}
      </>
      )}
    </div>
  );
}

export function TabBar({ layout, attention, unseenByTab, bellOpen, showTabs = true, viewMode, onSetViewMode, onToggleBell, onJumpSession, onSelect, onReorder, onRenameTab, onCloseTab, onOpenDashboard, onOpenPicker, onOpenWorkspaces, onOpenSettings }: {
  layout: Layout;
  attention: Set<string>;
  unseenByTab: Map<string, number>;
  bellOpen: boolean;
  /** false = the tab list lives in the TabSidebar; only the chrome renders here. */
  showTabs?: boolean;
  viewMode: "tabs" | "canvas";
  onSetViewMode: (v: "tabs" | "canvas") => void;
  onToggleBell: () => void;
  onJumpSession: (c: import("../lib/notifications").Completion) => void;
  onSelect: (tabId: string) => void;
  onNewTab: () => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenDashboard: () => void;
  onOpenPicker: () => void;
  onOpenWorkspaces: () => void;
  onOpenSettings: () => void;
}) {
  const strip = useTabStrip(layout, onRenameTab, onCloseTab, showTabs);
  return (
    <div className="cockpit-tabs">
      {showTabs && (
        <div className="cockpit-tabs__list">
          {layout.tabs.map((t, i) => (
            <TabItem key={t.id} t={t} index={i} layout={layout} attention={attention} unseenByTab={unseenByTab} strip={strip} onSelect={onSelect} onReorder={onReorder} />
          ))}
        </div>
      )}
      <div className="cockpit-tabs__drag" data-tauri-drag-region></div>
      <UsageStrip />
      <div className="cockpit-tabs__tools">
        <div className="cockpit-mode" role="group" aria-label="View mode (Cmd+G)" title="View mode (⌘G)">
          <button className={`cockpit-mode__btn${viewMode === "tabs" ? " on" : ""}`} onClick={() => onSetViewMode("tabs")}>⌶ Tabs</button>
          <button className={`cockpit-mode__btn${viewMode === "canvas" ? " on" : ""}`} onClick={() => onSetViewMode("canvas")}>▦ Canvas</button>
        </div>
        <button className="cockpit-tool" onClick={onOpenDashboard} aria-label="Mission Control (Cmd+0)" title="Mission Control (⌘0)"><GridIcon /></button>
        <button className="cockpit-tool" onClick={onOpenWorkspaces} aria-label="Workspaces (Cmd+E)" title="Workspaces (⌘E)"><LayersIcon /></button>
        <NotificationBell open={bellOpen} onToggle={onToggleBell} onJump={onJumpSession} />
        <button className="cockpit-tool" onClick={onOpenSettings} aria-label="Settings (Cmd+,)" title="Settings (⌘,)"><SettingsIcon /></button>
        <button className="cockpit-tool cockpit-tool--add" onClick={onOpenPicker} aria-label="Open project (Cmd+O)" title="Open project (⌘O)"><FolderPlusIcon /></button>
      </div>
    </div>
  );
}

/** Left-docked vertical tab list (settings.tabBar === "left"); the top bar keeps the
 *  drag region / usage / tools and hides its horizontal list via showTabs={false}. */
export function TabSidebar({ layout, attention, unseenByTab, onSelect, onReorder, onRenameTab, onCloseTab }: {
  layout: Layout;
  attention: Set<string>;
  unseenByTab: Map<string, number>;
  onSelect: (tabId: string) => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onCloseTab: (tabId: string) => void;
}) {
  const strip = useTabStrip(layout, onRenameTab, onCloseTab, true);
  return (
    <nav className="cockpit-side" aria-label="Tabs">
      {layout.tabs.map((t, i) => (
        <TabItem key={t.id} t={t} index={i} layout={layout} attention={attention} unseenByTab={unseenByTab} vertical strip={strip} onSelect={onSelect} onReorder={onReorder} />
      ))}
    </nav>
  );
}
