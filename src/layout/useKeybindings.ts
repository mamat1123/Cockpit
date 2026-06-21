import { useEffect } from "react";
import type { Action } from "./paneLayout";

/** Cmd+T new tab, Cmd+D split, Cmd+Shift+D split-down, Cmd+W close, Cmd+0 dashboard, Cmd+O open project, Cmd+E workspaces. */
export function useKeybindings(
  dispatch: (a: Action) => void,
  opts: { onToggleDashboard?: () => void; onOpenProject?: () => void; onOpenWorkspaces?: () => void } = {},
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); dispatch({ type: "newTab" }); }
      else if (k === "d") { e.preventDefault(); dispatch({ type: e.shiftKey ? "splitDown" : "split" }); }
      else if (k === "w") { e.preventDefault(); dispatch({ type: "close" }); }
      else if (k === "0") { e.preventDefault(); opts.onToggleDashboard?.(); }
      else if (k === "o") { e.preventDefault(); opts.onOpenProject?.(); }
      else if (k === "e") { e.preventDefault(); opts.onOpenWorkspaces?.(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatch, opts.onToggleDashboard, opts.onOpenProject, opts.onOpenWorkspaces]);
}
