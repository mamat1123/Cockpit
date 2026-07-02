/** Tools whose tool_use blocks the turn on the user (CONTEXT.md "Working state" →
 *  waiting). Extend (e.g. ExitPlanMode) ONLY with a real-transcript fixture proving
 *  the shape — none exists in local logs as of 2026-07-02. */
const WAITING_TOOLS = new Set(["AskUserQuestion"]);

export interface Waiting {
  toolUseId: string;
  messageId: string;
  askedAt: number;   // ms epoch of the ask line's timestamp
  question: string;  // first question's text, "" when unreadable
}

function questionOf(block: any): string {
  const qs = block?.input?.questions;
  const q = Array.isArray(qs) ? qs[0]?.question : undefined;
  return typeof q === "string" ? q : "";
}

/** Pure transition: fold one transcript line into a pane's waiting state.
 *  Enter on an assistant tool_use named in WAITING_TOOLS. Stay through parallel blocks
 *  of the SAME assistant message (one API message is written as multiple records sharing
 *  message.id) and unrelated tool_results. Clear on the matching tool_result, a NEW
 *  assistant message id (the model moved on — e.g. the ask was interrupted), or a typed
 *  user prompt. Sidechain (subagent) lines never transition. */
export function nextWaiting(prev: Waiting | null, line: string): Waiting | null {
  let v: any;
  try { v = JSON.parse(line); } catch { return prev; }
  if (!v || typeof v !== "object" || v.isSidechain) return prev;
  if (v.type === "assistant") {
    const msg = v.message;
    const blocks: any[] = Array.isArray(msg?.content) ? msg.content : [];
    const ask = blocks.find((b) => b?.type === "tool_use" && WAITING_TOOLS.has(b.name));
    if (ask && typeof ask.id === "string" && typeof msg?.id === "string") {
      const ts = typeof v.timestamp === "string" ? Date.parse(v.timestamp) : NaN;
      if (Number.isNaN(ts)) return prev;
      return { toolUseId: ask.id, messageId: msg.id, askedAt: ts, question: questionOf(ask) };
    }
    if (prev && typeof msg?.id === "string" && msg.id !== prev.messageId) return null;
    return prev;
  }
  if (v.type === "user" && prev) {
    const c = v.message?.content;
    if (typeof c === "string") return null;
    if (Array.isArray(c) && c.some((b) => b?.type === "tool_result" && b.tool_use_id === prev.toolUseId)) return null;
    return prev;
  }
  return prev;
}

/** Chip copy for a waiting pane: "waiting", "waiting 4m", "waiting 3h". */
export function waitingLabel(askedAt: number, now: number): string {
  const m = Math.floor((now - askedAt) / 60_000);
  if (m < 1) return "waiting";
  if (m < 60) return `waiting ${m}m`;
  return `waiting ${Math.floor(m / 60)}h`;
}

/** Per-pane waiting tracker. `apply` returns the Waiting just ENTERED (a new ask) so the
 *  caller fires the one-shot burst exactly once per toolUseId. */
export function createWaitingStore() {
  const panes = new Map<string, Waiting>();
  return {
    apply(paneId: string, line: string): Waiting | null {
      const prev = panes.get(paneId) ?? null;
      const next = nextWaiting(prev, line);
      if (next === prev) return null;
      if (next) panes.set(paneId, next); else panes.delete(paneId);
      return next && next.toolUseId !== prev?.toolUseId ? next : null;
    },
    get(paneId: string): Waiting | null { return panes.get(paneId) ?? null; },
    clear(paneId: string): void { panes.delete(paneId); },
  };
}

/** App-wide singleton (in-memory, like the notifications store). */
export const waitingPanes = createWaitingStore();
