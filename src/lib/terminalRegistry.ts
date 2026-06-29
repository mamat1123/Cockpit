import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, killPty, onPtyOutput, onPtyExit } from "./ptyClient";
import { startLogtail, sessionExists } from "./logClient";
import { emitSend } from "./juiceBus";
import { type Theme, themeById, DEFAULT_THEME_ID } from "./themes";
import { headroomEnsure, HEADROOM_BASE_URL } from "./headroomClient";

let activeTheme: Theme = themeById(DEFAULT_THEME_ID);
let activeFontFamily = "Menlo, monospace";
let activeFontSize = 13;

/** Map a Cockpit theme onto an xterm ITheme. The background is ALWAYS transparent —
 *  window blur depends on the xterm viewport letting the desktop show through — so we
 *  never use t.bg here. Everything else (fg, cursor, selection, ANSI 16) tracks the theme. */
function xtermThemeOf(t: Theme): ITheme {
  return {
    background: "rgba(0,0,0,0)",
    foreground: t.text,
    cursor: t.accent,
    cursorAccent: t.bg,
    selectionBackground: t.accent + "44",
    selectionForeground: t.bright,
    black: t.surface2, red: t.red, green: t.green, yellow: t.yellow,
    blue: t.blue, magenta: t.magenta, cyan: t.cyan, white: t.text,
    brightBlack: t.muted, brightRed: t.red, brightGreen: t.green, brightYellow: t.yellow,
    brightBlue: t.blue, brightMagenta: t.magenta, brightCyan: t.cyan, brightWhite: t.bright,
  };
}

/** Switch every live terminal (and all future ones) to a new theme. xterm 6 applies
 *  `.options.theme` reactively, so a fresh ITheme on each entry recolors it in place. */
export function setTerminalTheme(t: Theme): void {
  activeTheme = t;
  const next = xtermThemeOf(t);
  for (const entry of registry.values()) entry.term.options.theme = next;
}

/** Switch every live terminal (and all future ones) to a new font family/size. Like
 *  setTerminalTheme this mutates xterm options IN PLACE — the PTY/session is never
 *  touched, so the running claude keeps its conversation. Changing glyph size reflows
 *  the grid, so we refit + resize (SIGWINCH) each visible pane (claude just redraws),
 *  skipping unsized panes (hidden tabs) exactly like refit() to avoid corrupting them. */
export function setTerminalFont(family: string, size: number): void {
  activeFontFamily = `${family}, monospace`;
  activeFontSize = size;
  for (const [paneId, e] of registry.entries()) {
    e.term.options.fontFamily = activeFontFamily;
    e.term.options.fontSize = size;
    if (e.hostEl.clientWidth === 0 || e.hostEl.clientHeight === 0) continue;
    try { e.fit.fit(); void resizePty(paneId, e.term.cols, e.term.rows); } catch { /* host detached mid-resize */ }
  }
}

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

/** Pane ids currently routed through the Headroom proxy (HR on). Maintained here so
 *  savings attribution knows which working panes are even candidates (only routed panes
 *  hit the proxy). Updated by acquireTerminal (initial flag) and setPaneHeadroom (toggle). */
const routed = new Set<string>();

/** Build + run the launch command for a pane, ensuring the Headroom proxy is up
 *  first when routing is on. Resumes if the session log already exists. */
async function launchClaude(paneId: string, cwd: string, sessionId: string, resume: boolean, headroom: boolean, cols: number, rows: number): Promise<void> {
  const flags = "--dangerously-skip-permissions";
  let launch = `claude ${flags} --session-id ${sessionId}`;
  if (resume) {
    try { if (await sessionExists(cwd, sessionId)) launch = `claude ${flags} --resume ${sessionId}`; } catch { /* not under tauri */ }
  }
  let env: Record<string, string> | null = null;
  if (headroom) {
    try {
      await headroomEnsure();
      env = { ANTHROPIC_BASE_URL: HEADROOM_BASE_URL };
    } catch { /* proxy down: fall back to direct so the pane is never stuck */ }
  }
  void spawnPty(paneId, cwd, cols, rows, launch, env);
}

/** Create (once) or return the persistent terminal for a pane. Spawns the PTY +
 *  `claude --session-id` and starts the logtail exactly once. */
export function acquireTerminal(paneId: string, cwd: string, sessionId: string, resume: boolean, headroom: boolean): TermEntry {
  if (headroom) routed.add(paneId); else routed.delete(paneId);
  const existing = registry.get(paneId);
  if (existing) return existing;

  const hostEl = document.createElement("div");
  Object.assign(hostEl.style, { width: "100%", height: "100%" });
  parkingNode().appendChild(hostEl);

  const term = new Terminal({
    fontFamily: activeFontFamily,
    fontSize: activeFontSize,
    cursorBlink: true,
    allowTransparency: true,
    theme: xtermThemeOf(activeTheme),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(hostEl);
  term.attachCustomKeyEventHandler((e) => {
    if (e.metaKey && !e.ctrlKey && !e.altKey && ["t", "d", "w"].includes(e.key.toLowerCase())) {
      return false;
    }
    // Shift+Enter → newline, not submit. Send ESC+CR — the same sequence Option+Enter
    // and `/terminal-setup` produce — which claude interprets as "insert newline".
    // preventDefault() is REQUIRED: xterm's _keyDown bails on a false custom-handler
    // return WITHOUT calling preventDefault, so the keystroke still reaches the hidden
    // textarea and leaks a second \r via the input event → claude submits anyway.
    if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      void writePty(paneId, "\x1b\r");
      return false; // suppress xterm's own \r; preventDefault suppresses the textarea leak
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
    if (data.includes("\r")) emitSend();
    void writePty(paneId, data);
  });

  void launchClaude(paneId, cwd, sessionId, resume, headroom, term.cols, term.rows);
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
  // Skip while the host is unsized (its tab is display:none, or not laid out yet).
  // Fitting to 0 would resize the PTY to a tiny grid and corrupt the running TUI;
  // the refit on tab-activation / ResizeObserver catches up once it's visible again.
  if (e.hostEl.clientWidth === 0 || e.hostEl.clientHeight === 0) return;
  try {
    e.fit.fit();
    void resizePty(paneId, e.term.cols, e.term.rows);
    e.term.refresh(0, e.term.rows - 1);
  } catch {
    /* not laid out yet — a later refit will catch up */
  }
}

/** Permanently dispose a pane's terminal (only on real close, never on a move). */
export function releaseTerminal(paneId: string) {
  const e = registry.get(paneId);
  if (!e) return;
  e.term.dispose();
  e.hostEl.remove();
  registry.delete(paneId);
  routed.delete(paneId);
}

/** Live activity timestamp for a pane (last meaningful PTY output), or null. */
export function paneLastLineAt(paneId: string): number | null {
  return registry.get(paneId)?.lastLineAt.current ?? null;
}

/** True if ANY live pane emitted output within `graceMs` — i.e. a turn is in progress.
 *  Used by the usage store to fetch right after a turn finishes (working→idle edge). */
export function anyPaneWorking(now: number, graceMs = 1000): boolean {
  for (const e of registry.values()) {
    const t = e.lastLineAt.current;
    if (t != null && now - t < graceMs) return true;
  }
  return false;
}

/** Headroom-routed panes that emitted output within `graceMs` (i.e. working now).
 *  The candidate set for attributing a proxy savings record to a Session. */
export function routedWorkingPaneIds(now: number, graceMs = 2000): string[] {
  const out: string[] = [];
  for (const id of routed) {
    const t = registry.get(id)?.lastLineAt.current;
    if (t != null && now - t < graceMs) out.push(id);
  }
  return out;
}

/** Focus a pane's terminal so keystrokes go straight to it (e.g. after a dashboard
 *  jump or programmatic tab switch, where no click lands inside the xterm). */
export function focusTerminal(paneId: string) {
  registry.get(paneId)?.term.focus();
}

/** Toggle Headroom routing for a LIVE pane: kill its claude and relaunch with
 *  --resume so the conversation is preserved (ANTHROPIC_BASE_URL is fixed at
 *  process start, so a restart is the only way to switch routing). */
export async function setPaneHeadroom(paneId: string, cwd: string, sessionId: string, on: boolean): Promise<void> {
  const e = registry.get(paneId);
  if (!e) return;
  await killPty(paneId);
  if (on) routed.add(paneId); else routed.delete(paneId);
  e.term.write("\r\n[switching Headroom routing…]\r\n");
  await launchClaude(paneId, cwd, sessionId, true, on, e.term.cols, e.term.rows);
}
