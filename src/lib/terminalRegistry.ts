import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, killPty, onPtyOutput, onPtyExit } from "./ptyClient";
import { startLogtail, sessionExists } from "./logClient";
import { emitSend } from "./juiceBus";
import { type Theme, themeById, DEFAULT_THEME_ID } from "./themes";
import { waitingPanes } from "./waiting";
import { paneActivity } from "./activity";
import { headroomEnsure, HEADROOM_BASE_URL } from "./headroomClient";
import { resolveHeadroomRouting } from "./headroomRouting";
import { paneLaunchEnv } from "./paneLaunchEnv";
import type { PonytailLevel } from "./ponytailClient";
import type { AgentProvider } from "../layout/paneLayout";

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
  paneContainer: HTMLElement | null;
  lastLineAt: { current: number | null };
  lastInputAt: { current: number };
  lastResizeAt: { current: number };
  logtailSessionId?: string;
  logtailCwd?: string;
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

/** Pane ids ACTUALLY routed through the Headroom proxy (HR on AND the proxy came up).
 *  Maintained here so savings attribution knows which working panes are even candidates
 *  (only routed panes hit the proxy). Set from the real launch outcome — a pane whose
 *  proxy bring-up failed falls back to direct and is NOT added — by acquireTerminal
 *  (initial launch) and setPaneHeadroom (toggle). */
const routed = new Set<string>();

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Build + run the launch command for a Claude pane. Resolves HR routing (when on) and merges
 *  the HR + ponytail env via paneLaunchEnv (PONYTAIL_DEFAULT_MODE is always set, incl.
 *  "off", so Cockpit's per-pane level is authoritative). Resumes if the session log
 *  exists. Returns whether Headroom routing actually engaged (false = direct / proxy down,
 *  which falls back to direct so the pane is never stuck).
 *
 *  `glm` launches through the user's `claude --glm` zsh wrapper — the claude binary on the
 *  GLM (z.ai) backend, configured in ~/.claude/glm.env. The wrapper adds
 *  --dangerously-skip-permissions itself and pins ANTHROPIC_BASE_URL to z.ai, so Headroom
 *  routing never engages for a glm pane.
 *
 *  `promptPath` (a Codex→Claude handoff) seeds the first turn: its file is cat'd into the
 *  launch as the opening prompt when NOT resuming. */
async function launchClaude(paneId: string, cwd: string, sessionId: string, resume: boolean, promptPath: string | undefined, opts: { headroom: boolean; ponytail: PonytailLevel; glm?: boolean }, cols: number, rows: number): Promise<boolean> {
  const bin = opts.glm ? "claude --glm" : "claude --dangerously-skip-permissions";
  let launch = `${bin} --session-id ${sessionId}`;
  if (resume) {
    try { if (await sessionExists(cwd, sessionId)) launch = `${bin} --resume ${sessionId}`; } catch { /* not under tauri */ }
  } else if (promptPath) {
    launch = `${launch} "$(cat ${shellQuote(promptPath)})"`;
  }
  const { engaged } = opts.glm
    ? { engaged: false }
    : await resolveHeadroomRouting(opts.headroom, headroomEnsure, HEADROOM_BASE_URL);
  const env = paneLaunchEnv({ headroomEngaged: engaged, ponytail: opts.ponytail, headroomBaseUrl: HEADROOM_BASE_URL });
  void spawnPty(paneId, cwd, cols, rows, launch, env);
  return engaged;
}

async function launchCodex(paneId: string, cwd: string, promptPath: string | undefined, cols: number, rows: number): Promise<boolean> {
  const flags = "--dangerously-bypass-approvals-and-sandbox";
  const launch = promptPath
    ? `codex ${flags} --cd ${shellQuote(cwd)} "$(cat ${shellQuote(promptPath)})"`
    : `codex ${flags} --cd ${shellQuote(cwd)}`;
  await spawnPty(paneId, cwd, cols, rows, launch, null);
  return false;
}

async function launchAgent(
  paneId: string,
  cwd: string,
  sessionId: string,
  resume: boolean,
  opts: { provider: AgentProvider; headroom: boolean; ponytail: PonytailLevel; codexPromptPath?: string; claudePromptPath?: string },
  cols: number,
  rows: number,
): Promise<boolean> {
  if (opts.provider === "codex") return launchCodex(paneId, cwd, opts.codexPromptPath, cols, rows);
  return launchClaude(paneId, cwd, sessionId, resume, opts.claudePromptPath, { headroom: opts.headroom, ponytail: opts.ponytail, glm: opts.provider === "zai" }, cols, rows);
}

/** Create (once) or return the persistent terminal for a pane. Spawns the PTY +
 *  selected agent and starts Claude logtail when applicable. */
export function acquireTerminal(paneId: string, cwd: string, sessionId: string, resume: boolean, opts: { provider: AgentProvider; headroom: boolean; ponytail: PonytailLevel; codexPromptPath?: string; claudePromptPath?: string }): TermEntry {
  const existing = registry.get(paneId);
  if (existing) {
    if (opts.provider !== "codex" && (existing.logtailSessionId !== sessionId || existing.logtailCwd !== cwd)) {
      existing.logtailSessionId = sessionId;
      existing.logtailCwd = cwd;
      void startLogtail(paneId, cwd, sessionId);
    }
    return existing;
  }

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
    if (e.metaKey && !e.ctrlKey && !e.altKey && ["t", "d", "w", "g"].includes(e.key.toLowerCase())) {
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
  onPtyExit(paneId, () => { waitingPanes.clear(paneId); term.write(`\r\n[${opts.provider} exited]\r\n`); });
  term.onData((data) => {
    lastInputAt.current = Date.now();
    if (data.includes("\r")) emitSend();
    void writePty(paneId, data);
  });

  void launchAgent(paneId, cwd, sessionId, resume, opts, term.cols, term.rows)
    .then((engaged) => { if (engaged) routed.add(paneId); else routed.delete(paneId); });
  // z.ai panes run the claude binary, so their session jsonl feeds the same logtail
  // (auto-title, waiting detection, notifications). Only codex has no claude log.
  if (opts.provider !== "codex") void startLogtail(paneId, cwd, sessionId);

  const entry: TermEntry = {
    term,
    hostEl,
    fit,
    paneContainer: null,
    lastLineAt,
    lastInputAt,
    lastResizeAt,
    logtailSessionId: opts.provider !== "codex" ? sessionId : undefined,
    logtailCwd: opts.provider !== "codex" ? cwd : undefined,
  };
  registry.set(paneId, entry);
  return entry;
}

/** Move the persistent terminal into `container` and refit. appendChild MOVES the
 *  existing node, so the terminal's buffer/scrollback survive across tab moves. */
export function attachTerminal(paneId: string, container: HTMLElement) {
  const e = registry.get(paneId);
  if (!e) return;
  e.paneContainer = container;
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

/** Move a pane's LIVE terminal into a canvas card (the pop-out appendChild dance —
 *  session, PTY and scrollback are untouched; only the host node moves). Refits to
 *  the card grid. Never steals focus. Returns false when the pane has no registry
 *  entry YET — a card can mount in the same commit that created its pane, and
 *  TerminalPane only acquires the terminal one commit later (slots round-trip
 *  through state) — so the caller must retry until this returns true. */
export function borrowTerminal(paneId: string, container: HTMLElement): boolean {
  const e = registry.get(paneId);
  if (!e) return false;
  container.appendChild(e.hostEl);
  refit(paneId);
  return true;
}

/** Give a borrowed terminal back to the pane container recorded by the last
 *  attachTerminal. The refit there is skipped while the tab stack is hidden
 *  (zero-size guard) — the reveal refit catches up. Parks if the container is gone.
 *  NOTE: paneContainer cannot go stale-but-connected today only because the
 *  pane-mutation UI (drag re-slot / pop-out) is unreachable while canvas mode is
 *  showing — if a future feature moves panes FROM canvas, re-derive the container. */
export function returnTerminal(paneId: string) {
  const e = registry.get(paneId);
  if (!e) return;
  if (e.paneContainer?.isConnected) {
    e.paneContainer.appendChild(e.hostEl);
    refit(paneId);
  } else {
    parkTerminalNode(paneId);
  }
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
  waitingPanes.clear(paneId);
  paneActivity.clear(paneId);
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

/** Toggle Headroom routing for a LIVE pane: kill its claude and relaunch with --resume
 *  so the conversation is preserved (ANTHROPIC_BASE_URL is fixed at process start, so a
 *  restart is the only way to switch routing). Returns whether routing actually engaged:
 *  when turning ON but the proxy can't start, the relaunch falls back to direct, this says
 *  so in the pane and returns false — the caller bounces the toggle back to off so the UI
 *  never shows ON while silently going direct. */
export async function setPaneHeadroom(paneId: string, cwd: string, sessionId: string, on: boolean, ponytail: PonytailLevel): Promise<boolean> {
  const e = registry.get(paneId);
  if (!e) return false;
  await killPty(paneId);
  e.term.write("\r\n[switching Headroom routing…]\r\n");
  const engaged = await launchClaude(paneId, cwd, sessionId, true, undefined, { headroom: on, ponytail }, e.term.cols, e.term.rows);
  if (engaged) routed.add(paneId); else routed.delete(paneId);
  if (on && !engaged) e.term.write("[Headroom proxy unavailable — staying on direct]\r\n");
  return engaged;
}

/** Switch a LIVE pane's Ponytail level: kill its claude and relaunch with --resume so the
 *  conversation is preserved (PONYTAIL_DEFAULT_MODE is read at session start, so a restart is
 *  the only way to switch). Passes the pane's current HR state so routing is preserved, and
 *  the provider so a z.ai pane relaunches on the GLM backend. No failure path: env injection
 *  always succeeds; a missing plugin is gated by the UI. */
export async function setPanePonytail(paneId: string, cwd: string, sessionId: string, level: PonytailLevel, headroom: boolean, provider: AgentProvider = "claude"): Promise<void> {
  const e = registry.get(paneId);
  if (!e) return;
  await killPty(paneId);
  e.term.write(`\r\n[switching ponytail → ${level}…]\r\n`);
  const engaged = await launchClaude(paneId, cwd, sessionId, true, undefined, { headroom, ponytail: level, glm: provider === "zai" }, e.term.cols, e.term.rows);
  if (engaged) routed.add(paneId); else routed.delete(paneId);
}

/** Switch a LIVE pane between the Anthropic and GLM (z.ai) claude backends: kill its claude
 *  and relaunch with --resume so the conversation continues on the other backend (both run
 *  the claude binary, so the session transcript is shared). Headroom can only re-engage on
 *  the Anthropic side; glm panes always run direct. */
export async function setPaneProvider(paneId: string, cwd: string, sessionId: string, provider: AgentProvider, ponytail: PonytailLevel, headroom: boolean): Promise<void> {
  const e = registry.get(paneId);
  if (!e) return;
  await killPty(paneId);
  e.term.write(`\r\n[switching provider → ${provider}…]\r\n`);
  const engaged = await launchClaude(paneId, cwd, sessionId, true, undefined, { headroom, ponytail, glm: provider === "zai" }, e.term.cols, e.term.rows);
  if (engaged) routed.add(paneId); else routed.delete(paneId);
}
