import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { reduce, emptyLayout, findPaneBySession, serializeLayout, deserializeLayout, type Layout, type BurrowInfo } from "../layout/paneLayout";
import { loadLast, saveLast, savePreset } from "../lib/persistence";
import { createBurrow, removeBurrow, burrowDirty } from "../lib/worktreeClient";
import { loadSettings, saveSettings } from "../lib/settings";
import { themeById, applyTheme } from "../lib/themes";
import { useKeybindings } from "../layout/useKeybindings";
import { TabBar, TabSidebar } from "./TabBar";
import { Juice } from "./Juice";
import { TabPanes } from "./TabPanes";
import { PaneHost } from "./PaneHost";
import { Dashboard } from "./Dashboard";
import { ProjectPicker } from "./ProjectPicker";
import { ProviderPicker, type ProviderPickerContext } from "./ProviderPicker";
import { WorkspacesMenu } from "./WorkspacesMenu";
import { SettingsMenu } from "./SettingsMenu";
import { UpdateModal } from "./UpdateModal";
import { BurrowCloseDialog, type BurrowToClose } from "./BurrowCloseDialog";
import { killPty } from "../lib/ptyClient";
import { stopLogtail } from "../lib/logClient";
import { releaseTerminal, focusTerminal, setTerminalTheme, setTerminalFont } from "../lib/terminalRegistry";
import { setWindowBlur } from "../lib/windowClient";
import { checkForUpdate, type Update } from "../lib/updateClient";
import { getVersion } from "@tauri-apps/api/app";
import { useCompletionNotifier } from "../hooks/useCompletionNotifier";
import { ToastHost } from "./ToastHost";
import { useNotifications, unseenByTab, notifications } from "../lib/notifications";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { buildBeaconState } from "../lib/beaconState";
import { paneLastLineAt } from "../lib/terminalRegistry";
import { deriveState } from "../lib/paneState";
import { waitingPanes } from "../lib/waiting";
import { startSavings } from "../lib/savingsStore";

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
      try { return deserializeLayout(last); } catch { /* fall through to an empty layout */ }
    }
    // No saved layout → start empty and let the ProjectPicker create the first pane
    // in a real folder (never a hardcoded default that may not exist on this machine).
    return emptyLayout();
  });
  const [attention, setAttention] = useState<Set<string>>(() => new Set());
  const addAttention = useCallback((tabId: string) => {
    setAttention((s) => (s.has(tabId) ? s : new Set(s).add(tabId)));
  }, []);
  useEffect(() => {
    setAttention((s) => { if (!s.has(layout.activeTabId)) return s; const n = new Set(s); n.delete(layout.activeTabId); return n; });
    notifications.markTabSeen(layout.activeTabId);
  }, [layout.activeTabId]);
  const [dashOpen, setDashOpen] = useState(false);
  // Open the picker immediately on a fresh start (empty layout) so the user always
  // begins by choosing a real folder rather than landing on a hardcoded default.
  const [pickerOpen, setPickerOpen] = useState(() => layout.tabs.length === 0);
  const [pendingCreation, setPendingCreation] = useState<ProviderPickerContext | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const { entries } = useNotifications();
  const unseen = unseenByTab(entries);
  const [update, setUpdate] = useState<Update | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [settings, setSettings] = useState(loadSettings);
  const patchSettings = useCallback((p: Partial<typeof settings>) => setSettings((s) => { const n = { ...s, ...p }; saveSettings(n); return n; }), []);
  const focusedPaneCwd = useCallback((): string => {
    for (const t of layout.tabs) for (const r of t.rows) for (const p of r.panes)
      if (p.id === layout.focusedPaneId) return p.cwd;
    return layout.tabs[0]?.rows[0]?.panes[0]?.cwd ?? "";
  }, [layout]);
  // Create a Burrow for `cwd` when the toggle is on; undefined ⇒ caller uses the plain cwd
  // (setting off, no folder, non-git repo, or git error — all fall back silently).
  const maybeBurrow = useCallback(async (cwd: string): Promise<BurrowInfo | undefined> => {
    if (!settings.burrows || !cwd) return undefined;
    try { return await createBurrow(cwd); }
    catch (e) { console.warn("[cockpit] burrow skipped:", e); return undefined; }
  }, [settings.burrows]);

  // Close orchestration: closing a pane/tab that carries a dirty Burrow pauses the
  // close and asks delete/keep/cancel; clean or non-Burrow panes close immediately.
  const [closingBurrows, setClosingBurrows] = useState<{ burrows: BurrowToClose[]; onConfirmDelete: () => void; onConfirmKeep: () => void } | null>(null);

  const burrowPanesIn = useCallback((predicate: (paneId: string) => boolean): BurrowToClose[] => {
    const out: BurrowToClose[] = [];
    for (const t of layout.tabs) for (const r of t.rows) for (const p of r.panes)
      if (p.isBurrow && p.burrowBranch && predicate(p.id))
        out.push({ paneId: p.id, codename: p.codename ?? p.title, path: p.cwd, branch: p.burrowBranch });
    return out;
  }, [layout]);

  // Remove every Burrow in `list` (force = keep-nothing) then run the layout change.
  const purgeAndClose = useCallback((list: BurrowToClose[], commit: () => void) => {
    commit();
    for (const b of list) void removeBurrow(b.path, b.branch, true);
  }, []);

  const closeWithBurrows = useCallback(async (list: BurrowToClose[], commit: () => void) => {
    if (list.length === 0) { commit(); return; }
    const dirties = await Promise.all(list.map((b) => burrowDirty(b.path).catch(() => ({ uncommitted: true, unpushed: false }))));
    const dirty = list.filter((_, i) => dirties[i].uncommitted || dirties[i].unpushed);
    if (dirty.length === 0) { purgeAndClose(list, commit); return; }
    setClosingBurrows({
      burrows: dirty,
      onConfirmDelete: () => purgeAndClose(list, commit),
      onConfirmKeep: commit, // close the layout, leave worktrees
    });
  }, [purgeAndClose]);

  const requestClosePane = useCallback((paneId: string) => {
    const list = burrowPanesIn((id) => id === paneId);
    void closeWithBurrows(list, () => { dispatch({ type: "focusPane", paneId }); dispatch({ type: "close" }); });
  }, [burrowPanesIn, closeWithBurrows]);

  const requestCloseTab = useCallback((tabId: string) => {
    const paneIds = new Set(layout.tabs.find((t) => t.id === tabId)?.rows.flatMap((r) => r.panes.map((p) => p.id)) ?? []);
    const list = burrowPanesIn((id) => paneIds.has(id));
    void closeWithBurrows(list, () => dispatch({ type: "closeTab", tabId }));
  }, [layout, burrowPanesIn, closeWithBurrows]);
  const theme = themeById(settings.themeId);
  useEffect(() => {
    applyTheme(theme, settings.accent);
    setTerminalTheme(settings.accent ? { ...theme, accent: settings.accent } : theme);
  }, [theme, settings.accent]);
  useEffect(() => { void setWindowBlur(settings.blurRadius); }, [settings.blurRadius]);
  // Live font change — mutates every open terminal in place; sessions are untouched (only a grid reflow).
  useEffect(() => { setTerminalFont(settings.fontFamily, settings.fontSize); }, [settings.fontFamily, settings.fontSize]);
  useEffect(() => {
    startSavings();
    getVersion().then(setAppVersion).catch(() => {});
    checkForUpdate().then((u) => { if (u) setUpdate(u); });
  }, []);
  const toggleDash = useCallback(() => setDashOpen((o) => !o), []);
  // ⌘T opens the picker (a tab must always start in a chosen folder), same as ⌘O / the + button.
  useKeybindings(dispatch, { onNewTab: () => setPickerOpen(true), onSplit: (down) => setPendingCreation(down ? { kind: "splitDown" } : { kind: "split" }), onToggleDashboard: toggleDash, onOpenProject: () => setPickerOpen(true), onOpenWorkspaces: () => setWsOpen(true), onOpenSettings: () => setSettingsOpen(true), onToggleBell: () => setBellOpen((o) => !o), onClose: () => requestClosePane(layout.focusedPaneId) });

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

  useCompletionNotifier(layout, settings);

  const selectTab = useCallback((tabId: string) => {
    dispatch({ type: "focusTab", tabId });
    const pid = layout.tabs.find((t) => t.id === tabId)?.rows[0]?.panes[0]?.id;
    if (pid) requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(pid)));
  }, [layout]);

  const jumpToSession = useCallback((sessionId: string) => {
    const hit = findPaneBySession(layout, sessionId);
    if (hit) {
      dispatch({ type: "focusTab", tabId: hit.tabId });
      dispatch({ type: "focusPane", paneId: hit.paneId });
      requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(hit.paneId)));
    }
  }, [layout]);

  // Drive beacon window visibility from settings.
  useEffect(() => {
    const visible = settings.notifications.enabled && settings.notifications.beacon;
    void invoke("set_beacon_visible", { visible });
  }, [settings.notifications.enabled, settings.notifications.beacon]);

  // Emit beacon snapshots on a light interval (covers working-state changes too)
  useEffect(() => {
    if (!(settings.notifications.enabled && settings.notifications.beacon)) return;
    const tick = () => {
      const now = Date.now();
      const working = new Set<string>();
      const waiting = new Set<string>();
      for (const t of layout.tabs) for (const r of t.rows) for (const p of r.panes) {
        if (waitingPanes.get(p.id)) waiting.add(p.id);
        else if (deriveState({ lastLineAt: paneLastLineAt(p.id) }, now, 800) === "working") working.add(p.id);
      }
      void emit("cockpit://beacon-state", buildBeaconState(layout, notifications.list(), working, waiting));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [layout, entries, settings.notifications.enabled, settings.notifications.beacon]);

  // Jump requests coming from the beacon window
  useEffect(() => {
    const un = listen<string>("cockpit://jump", (e) => jumpToSession(e.payload));
    return () => { un.then((f) => f()); };
  }, [jumpToSession]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: hexA(theme.bg, settings.bgOpacity) }}>
      <TabBar
        layout={layout}
        attention={attention}
        unseenByTab={unseen}
        bellOpen={bellOpen}
        onToggleBell={() => setBellOpen((o) => !o)}
        onJumpSession={(c) => { jumpToSession(c.sessionId); setBellOpen(false); }}
        onSelect={selectTab}
        showTabs={settings.tabBar !== "left"}
        onNewTab={() => setPickerOpen(true)}
        onReorder={(tabId, toIndex) => dispatch({ type: "moveTab", tabId, toIndex })}
        onRenameTab={(tabId, title) => dispatch({ type: "renameTab", tabId, title })}
        onCloseTab={(tabId) => requestCloseTab(tabId)}
        onOpenDashboard={() => setDashOpen(true)}
        onOpenPicker={() => setPickerOpen(true)}
        onOpenWorkspaces={() => setWsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {settings.tabBar === "left" && layout.tabs.length > 0 && (
          <TabSidebar
            layout={layout}
            attention={attention}
            unseenByTab={unseen}
            onSelect={selectTab}
            onReorder={(tabId, toIndex) => dispatch({ type: "moveTab", tabId, toIndex })}
            onRenameTab={(tabId, title) => dispatch({ type: "renameTab", tabId, title })}
            onCloseTab={(tabId) => requestCloseTab(tabId)}
          />
        )}
        <div style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
          {layout.tabs.length === 0 ? (
            <button className="cockpit-empty" onClick={() => setPickerOpen(true)}>
              <span className="cockpit-empty__icon" aria-hidden="true">⌘O</span>
              <span className="cockpit-empty__title">No project open</span>
              <span className="cockpit-empty__sub">Open a folder to start a Claude session</span>
            </button>
          ) : (
            layout.tabs.map((t) => (
              <TabPanes
                key={t.id}
                tab={t}
                active={t.id === layout.activeTabId}
                dispatch={dispatch}
                registerSlot={registerSlot}
              />
            ))
          )}
        </div>
      </div>
      <PaneHost layout={layout} slots={slots} dispatch={dispatch} onRequestClose={requestClosePane} />
      <Juice layout={layout} onAttention={addAttention} />
      <ToastHost onJump={(c) => jumpToSession(c.sessionId)} />
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
          onPick={(cwd) => { setPickerOpen(false); setPendingCreation({ kind: "newTab", cwd }); }}
        />
      )}
      {pendingCreation && (
        <ProviderPicker
          context={pendingCreation}
          onCancel={() => setPendingCreation(null)}
          onPick={async (provider) => {
            const pc = pendingCreation;
            setPendingCreation(null);
            if (!pc) return;
            // A z.ai pane launches via the `claude --glm` wrapper, which sources its creds
            // from ~/.claude/glm.env — no Cockpit-side token gate needed (the monitor token
            // in Settings is only for the usage gauge, a separate credential).
            if (pc.kind === "newTab") {
              const burrow = await maybeBurrow(pc.cwd);
              dispatch({ type: "newTab", cwd: pc.cwd, provider, burrow });
            } else {
              // split / splitDown: cut a fresh Burrow off the default branch, located via
              // the focused pane's cwd (which itself may be a Burrow — create_burrow resolves it).
              const burrow = await maybeBurrow(focusedPaneCwd());
              dispatch({ type: pc.kind, provider, burrow });
            }
          }}
        />
      )}
      {wsOpen && (
        <WorkspacesMenu
          onClose={() => setWsOpen(false)}
          onLoad={(saved) => { dispatch({ type: "loadLayout", saved }); setWsOpen(false); }}
          onSaveCurrent={(name, keepSessions) => savePreset(name, serializeLayout(layout, keepSessions))}
        />
      )}
      {settingsOpen && (
        <SettingsMenu
          settings={settings}
          onPatch={patchSettings}
          onClose={() => setSettingsOpen(false)}
          onUpdateFound={(u) => { setUpdate(u); setSettingsOpen(false); }}
        />
      )}
      {update && (
        <UpdateModal
          update={update}
          currentVersion={appVersion}
          onClose={() => setUpdate(null)}
        />
      )}
      {closingBurrows && (
        <BurrowCloseDialog
          burrows={closingBurrows.burrows}
          onDelete={() => { closingBurrows.onConfirmDelete(); setClosingBurrows(null); }}
          onKeep={() => { closingBurrows.onConfirmKeep(); setClosingBurrows(null); }}
          onCancel={() => setClosingBurrows(null)}
        />
      )}
    </div>
  );
}
