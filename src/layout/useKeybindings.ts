import { useEffect } from "react";
import type { Action } from "./paneLayout";

/** Cmd+T new tab (picks a folder first), Cmd+D split, Cmd+Shift+D split-down, Cmd+W close, Cmd+0 dashboard, Cmd+O open project, Cmd+E workspaces, Cmd+, settings. */
export function useKeybindings(
  dispatch: (a: Action) => void,
  opts: { onNewTab?: () => void; onSplit?: (down: boolean) => void; onToggleDashboard?: () => void; onOpenProject?: () => void; onOpenWorkspaces?: () => void; onOpenSettings?: () => void; onToggleBell?: () => void; onClose?: () => void } = {},
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      // A new tab must open in a chosen folder, so ⌘T routes through the picker
      // (falls back to an instant in-place tab only if no handler is wired).
      if (k === "t") { e.preventDefault(); if (opts.onNewTab) opts.onNewTab(); else dispatch({ type: "newTab" }); }
      else if (k === "d") { e.preventDefault(); if (opts.onSplit) opts.onSplit(e.shiftKey); else dispatch({ type: e.shiftKey ? "splitDown" : "split" }); }
      else if (k === "w") { e.preventDefault(); if (opts.onClose) opts.onClose(); else dispatch({ type: "close" }); }
      else if (k === "0") { e.preventDefault(); opts.onToggleDashboard?.(); }
      else if (k === "o") { e.preventDefault(); opts.onOpenProject?.(); }
      else if (k === "e") { e.preventDefault(); opts.onOpenWorkspaces?.(); }
      else if (k === ",") { e.preventDefault(); opts.onOpenSettings?.(); }
      else if (k === "b") { e.preventDefault(); opts.onToggleBell?.(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatch, opts.onNewTab, opts.onSplit, opts.onToggleDashboard, opts.onOpenProject, opts.onOpenWorkspaces, opts.onOpenSettings, opts.onToggleBell, opts.onClose]);
}
