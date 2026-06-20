import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, onPtyOutput, onPtyExit } from "./ptyClient";
import { startLogtail } from "./logClient";

/** A pane's terminal lives OUTSIDE React. React only remounts a thin wrapper when a
 *  pane moves tabs (a portal-container change remounts — verified); if the xterm lived
 *  in that subtree it would be destroyed and respawn an empty shell (the "pop-out =
 *  black screen" bug). Instead we keep one persistent xterm + host <div> per pane here
 *  and MOVE the host node into whatever container is currently mounted via appendChild,
 *  which relocates the live node (buffer, scrollback, PTY) intact. */
export interface TermEntry {
  term: Terminal;
  hostEl: HTMLDivElement;
  fit: FitAddon;
  lastLineAt: { current: number | null };
  lastInputAt: { current: number };
  lastResizeAt: { current: number };
}

let parking: HTMLDivElement | null = null;
function parkingNode(): HTMLDivElement {
  if (!parking) {
    parking = document.createElement("div");
    parking.setAttribute("data-cockpit-parking", "");
    Object.assign(parking.style, {
      position: "fixed", left: "0", top: "0", width: "0", height: "0",
      overflow: "hidden", visibility: "hidden", pointerEvents: "none",
    });
    document.body.appendChild(parking);
  }
  return parking;
}

const registry = new Map<string, TermEntry>();

/** Create (once) or return the persistent terminal for a pane. Spawns the PTY +
 *  `claude --session-id` and starts the logtail exactly once. */
export function acquireTerminal(paneId: string, cwd: string, sessionId: string): TermEntry {
  const existing = registry.get(paneId);
  if (existing) return existing;

  const hostEl = document.createElement("div");
  Object.assign(hostEl.style, { width: "100%", height: "100%" });
  parkingNode().appendChild(hostEl);

  const term = new Terminal({ fontFamily: "Menlo, monospace", fontSize: 13, cursorBlink: true });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(hostEl);
  term.attachCustomKeyEventHandler((e) => {
    if (e.metaKey && !e.ctrlKey && !e.altKey && ["t", "d", "w"].includes(e.key.toLowerCase())) {
      return false;
    }
    return true;
  });

  const lastLineAt = { current: null as number | null };
  const lastInputAt = { current: 0 };
  const lastResizeAt = { current: 0 };

  onPtyOutput(paneId, (chunk) => {
    term.write(chunk);
    const now = Date.now();
    if (now - lastInputAt.current > 150 && now - lastResizeAt.current > 500) {
      lastLineAt.current = now;
    }
  });
  onPtyExit(paneId, () => term.write("\r\n[claude exited]\r\n"));
  term.onData((data) => {
    lastInputAt.current = Date.now();
    void writePty(paneId, data);
  });

  void spawnPty(paneId, cwd, term.cols, term.rows, `claude --session-id ${sessionId}`);
  void startLogtail(paneId, cwd, sessionId);

  const entry: TermEntry = { term, hostEl, fit, lastLineAt, lastInputAt, lastResizeAt };
  registry.set(paneId, entry);
  return entry;
}

/** Move the persistent terminal into `container` and refit. appendChild MOVES the
 *  existing node, so the terminal's buffer/scrollback survive across tab moves. */
export function attachTerminal(paneId: string, container: HTMLElement) {
  const e = registry.get(paneId);
  if (!e) return;
  container.appendChild(e.hostEl);
  refit(paneId);
  e.term.focus();
}

/** Detach the terminal to a hidden parking node, keeping it alive, so React can
 *  remove its (now empty) container without destroying the terminal. */
export function parkTerminalNode(paneId: string) {
  const e = registry.get(paneId);
  if (e) parkingNode().appendChild(e.hostEl);
}

export function refit(paneId: string) {
  const e = registry.get(paneId);
  if (!e) return;
  try {
    e.fit.fit();
    void resizePty(paneId, e.term.cols, e.term.rows);
    e.term.refresh(0, e.term.rows - 1);
  } catch {
    /* container not laid out yet — a later refit will catch up */
  }
}

/** Permanently dispose a pane's terminal (only on real close, never on a move). */
export function releaseTerminal(paneId: string) {
  const e = registry.get(paneId);
  if (!e) return;
  e.term.dispose();
  e.hostEl.remove();
  registry.delete(paneId);
}
