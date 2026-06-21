import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { reduce, initLayout, findPaneBySession, serializeLayout, deserializeLayout, type Layout } from "../layout/paneLayout";
import { loadLast, saveLast, savePreset } from "../lib/persistence";
import { loadSettings, saveSettings } from "../lib/settings";
import { themeById, applyTheme } from "../lib/themes";
import { useKeybindings } from "../layout/useKeybindings";
import { TabBar } from "./TabBar";
import { Juice } from "./Juice";
import { TabPanes } from "./TabPanes";
import { PaneHost } from "./PaneHost";
import { Dashboard } from "./Dashboard";
import { ProjectPicker } from "./ProjectPicker";
import { WorkspacesMenu } from "./WorkspacesMenu";
import { SettingsMenu } from "./SettingsMenu";
import { killPty } from "../lib/ptyClient";
import { stopLogtail } from "../lib/logClient";
import { releaseTerminal, focusTerminal, setTerminalTheme } from "../lib/terminalRegistry";
import { setWindowBlur } from "../lib/windowClient";

const DEFAULT_CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

function livePaneIds(l: Layout): Set<string> {
  return new Set(l.tabs.flatMap((t) => t.rows.flatMap((r) => r.panes.map((p) => p.id))));
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h;
  const n = parseInt(f, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function CockpitView() {
  const [layout, dispatch] = useReducer(reduce, null, () => {
    const last = loadLast();
    if (last && last.tabs && last.tabs.length > 0) {
      try { return deserializeLayout(last); } catch { /* fall through to a fresh layout */ }
    }
    return initLayout(DEFAULT_CWD);
  });
  const [attention, setAttention] = useState<Set<string>>(() => new Set());
  const addAttention = useCallback((tabId: string) => {
    setAttention((s) => (s.has(tabId) ? s : new Set(s).add(tabId)));
  }, []);
  useEffect(() => {
    setAttention((s) => { if (!s.has(layout.activeTabId)) return s; const n = new Set(s); n.delete(layout.activeTabId); return n; });
  }, [layout.activeTabId]);
  const [dashOpen, setDashOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const patchSettings = useCallback((p: Partial<typeof settings>) => setSettings((s) => { const n = { ...s, ...p }; saveSettings(n); return n; }), []);
  const theme = themeById(settings.themeId);
  useEffect(() => {
    applyTheme(theme, settings.accent);
    setTerminalTheme(settings.accent ? { ...theme, accent: settings.accent } : theme);
  }, [theme, settings.accent]);
  useEffect(() => { void setWindowBlur(settings.blurRadius); }, [settings.blurRadius]);
  const toggleDash = useCallback(() => setDashOpen((o) => !o), []);
  useKeybindings(dispatch, { onToggleDashboard: toggleDash, onOpenProject: () => setPickerOpen(true), onOpenWorkspaces: () => setWsOpen(true), onOpenSettings: () => setSettingsOpen(true) });

  // Auto-restore: persist the layout (with session ids) shortly after each change.
  useEffect(() => {
    const id = setTimeout(() => saveLast(serializeLayout(layout, true)), 600);
    return () => clearTimeout(id);
  }, [layout]);

  const [slots, setSlots] = useState<Record<string, HTMLElement>>({});
  // `registerSlot(paneId)` returns a STABLE ref callback (cached per pane). A fresh
  // inline `ref={(el) => ...}` each render would make React detach+reattach the ref
  // every render — and since the callback calls setState, that's an infinite loop
  // ("Maximum update depth exceeded"). Caching keeps the ref identity stable so React
  // only invokes it on real mount/unmount.
  const slotCbs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const registerSlot = useCallback((paneId: string) => {
    const m = slotCbs.current;
    let cb = m.get(paneId);
    if (!cb) {
      cb = (el: HTMLElement | null) =>
        setSlots((prev) => {
          if (el) { if (prev[paneId] === el) return prev; return { ...prev, [paneId]: el }; }
          if (!(paneId in prev)) return prev;
          const next = { ...prev }; delete next[paneId]; return next;
        });
      m.set(paneId, cb);
    }
    return cb;
  }, []);

  // Kill the PTY + logtail of panes that were actually removed (closed), NOT panes
  // that merely moved tabs (those are still live in the layout, just re-slotted).
  const prevIds = useRef(livePaneIds(layout));
  useEffect(() => {
    const now = livePaneIds(layout);
    for (const id of prevIds.current) {
      if (!now.has(id)) { void killPty(id); void stopLogtail(id); slotCbs.current.delete(id); releaseTerminal(id); }
    }
    prevIds.current = now;
  }, [layout]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: hexA(theme.bg, settings.bgOpacity) }}>
      <TabBar
        layout={layout}
        attention={attention}
        onSelect={(tabId) => {
          dispatch({ type: "focusTab", tabId });
          const pid = layout.tabs.find((t) => t.id === tabId)?.rows[0]?.panes[0]?.id;
          if (pid) requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(pid)));
        }}
        onNewTab={() => dispatch({ type: "newTab" })}
        onReorder={(tabId, toIndex) => dispatch({ type: "moveTab", tabId, toIndex })}
        onOpenDashboard={() => setDashOpen(true)}
        onOpenPicker={() => setPickerOpen(true)}
        onOpenWorkspaces={() => setWsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {layout.tabs.map((t) => (
          <TabPanes
            key={t.id}
            tab={t}
            active={t.id === layout.activeTabId}
            dispatch={dispatch}
            registerSlot={registerSlot}
          />
        ))}
      </div>
      <PaneHost layout={layout} slots={slots} dispatch={dispatch} />
      <Juice layout={layout} onAttention={addAttention} />
      {dashOpen && (
        <Dashboard
          layout={layout}
          onClose={() => setDashOpen(false)}
          onJump={(tabId, paneId) => {
            dispatch({ type: "focusTab", tabId });
            dispatch({ type: "focusPane", paneId });
            setDashOpen(false);
            // focus the xterm after the tab becomes visible so you can type immediately
            requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(paneId)));
          }}
          onJumpSession={(sessionId, cwd) => {
            const hit = findPaneBySession(layout, sessionId);
            if (hit) {
              dispatch({ type: "focusTab", tabId: hit.tabId });
              dispatch({ type: "focusPane", paneId: hit.paneId });
              requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(hit.paneId)));
            } else {
              dispatch({ type: "openSession", cwd, sessionId });
            }
            setDashOpen(false);
          }}
        />
      )}
      {pickerOpen && (
        <ProjectPicker
          onClose={() => setPickerOpen(false)}
          onPick={(cwd) => { dispatch({ type: "newTab", cwd }); setPickerOpen(false); }}
        />
      )}
      {wsOpen && (
        <WorkspacesMenu
          onClose={() => setWsOpen(false)}
          onLoad={(saved) => { dispatch({ type: "loadLayout", saved }); setWsOpen(false); }}
          onSaveCurrent={(name) => savePreset(name, serializeLayout(layout, false))}
        />
      )}
      {settingsOpen && (
        <SettingsMenu
          settings={settings}
          onPatch={patchSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
