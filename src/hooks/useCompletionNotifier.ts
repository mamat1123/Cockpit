import { useEffect, useRef } from "react";
import type { Layout } from "../layout/paneLayout";
import type { Settings } from "../lib/settings";
import { onLogLine } from "../lib/logClient";
import { parseTurnEnd } from "../lib/completion";
import { notifications, type Completion } from "../lib/notifications";
import { notifyCompletion } from "../lib/osNotify";
import { emitToast } from "../lib/toastBus";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface PaneCtx { sessionId: string; tabId: string; name: string; project: string }
const projectOf = (cwd: string) => cwd.split("/").filter(Boolean).pop() ?? "shell";

function paneIndex(layout: Layout): Map<string, PaneCtx> {
  const m = new Map<string, PaneCtx>();
  for (const t of layout.tabs) for (const r of t.rows) for (const p of r.panes)
    m.set(p.id, { sessionId: p.sessionId, tabId: t.id, name: p.title, project: projectOf(p.cwd) });
  return m;
}

/** Detects Completions from each live pane's transcript and fans them out to the
 *  store, the OS notification, and the toast bus. Listeners are added/removed as panes
 *  appear/disappear. Settings + active tab are read via refs so changing them doesn't
 *  re-subscribe every listener. */
export function useCompletionNotifier(layout: Layout, settings: Settings): void {
  const idx = paneIndex(layout);
  const idxRef = useRef(idx); idxRef.current = idx;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const activeTabRef = useRef(layout.activeTabId); activeTabRef.current = layout.activeTabId;
  const debounce = useRef<Map<string, number>>(new Map());

  // Stable set of currently-listened pane ids
  const listeners = useRef<Map<string, UnlistenFn>>(new Map());

  useEffect(() => {
    const live = new Set(idx.keys());
    // add listeners for new panes
    for (const paneId of live) {
      if (listeners.current.has(paneId)) continue;
      let unlisten: UnlistenFn = () => {};
      let disposed = false;
      onLogLine(paneId, (line) => {
        const hit = parseTurnEnd(line, Date.now());
        if (!hit) return;
        // debounce burst per pane (~300ms)
        const prev = debounce.current.get(paneId) ?? 0;
        const now = Date.now();
        if (now - prev < 300) return;
        debounce.current.set(paneId, now);

        const ctx = idxRef.current.get(paneId);
        if (!ctx) return;
        const s = settingsRef.current.notifications;
        if (!s.enabled) return;
        const seen = ctx.tabId === activeTabRef.current;
        const entry: Completion = notifications.push(
          { paneId, sessionId: ctx.sessionId, tabId: ctx.tabId, name: ctx.name, project: ctx.project, at: hit.at },
          seen,
        );
        if (s.os) void notifyCompletion(entry, { sound: s.sound });
        if (s.toast) emitToast(entry);
      }).then((fn) => { if (disposed) fn(); else unlisten = fn; });
      listeners.current.set(paneId, () => { disposed = true; unlisten(); });
    }
    // remove listeners for gone panes
    for (const [paneId, off] of listeners.current) {
      if (!live.has(paneId)) { off(); listeners.current.delete(paneId); debounce.current.delete(paneId); }
    }
  }, [idx]);

  // cleanup on unmount
  useEffect(() => () => { for (const off of listeners.current.values()) off(); listeners.current.clear(); }, []);
}
