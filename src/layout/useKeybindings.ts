import { useEffect } from "react";
import type { Action } from "./paneLayout";

/** Cmd+T new tab, Cmd+D split, Cmd+Shift+D split-down, Cmd+W close, Cmd+0 dashboard. */
export function useKeybindings(dispatch: (a: Action) => void, onToggleDashboard?: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); dispatch({ type: "newTab" }); }
      else if (k === "d") { e.preventDefault(); dispatch({ type: e.shiftKey ? "splitDown" : "split" }); }
      else if (k === "w") { e.preventDefault(); dispatch({ type: "close" }); }
      else if (k === "0") { e.preventDefault(); onToggleDashboard?.(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatch, onToggleDashboard]);
}
