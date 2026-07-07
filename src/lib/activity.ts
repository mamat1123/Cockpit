/** CNVS-style activity feed: the last few tool actions per pane, folded from the same
 *  JSONL lines that feed waiting.ts (the frontend already receives every line via
 *  onLogLine — no Rust involved). Pure parse + a per-pane ring-buffer store. */

export interface ActivityEntry {
  toolUseId: string;
  tool: string;
  detail: string; // "" when the tool has no summarizable input
  at: number;     // ms epoch of the line's timestamp
}

const FILE_TOOLS = new Set(["Edit", "Write", "Read", "NotebookEdit"]);

function detailOf(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (name === "Bash") {
    const c = typeof inp?.command === "string" ? inp.command : "";
    return c.replace(/\s+/g, " ").trim().slice(0, 40);
  }
  if (FILE_TOOLS.has(name)) {
    const p = typeof inp?.file_path === "string" ? inp.file_path : "";
    return p.split("/").filter(Boolean).pop() ?? "";
  }
  if (name === "Task") {
    return typeof inp?.description === "string" ? inp.description.slice(0, 40) : "";
  }
  if (name === "AskUserQuestion") {
    const qs = inp?.questions;
    const q = Array.isArray(qs) ? qs[0]?.question : undefined;
    return typeof q === "string" ? q.slice(0, 40) : "";
  }
  return "";
}

/** Tool actions in one transcript line ([] for anything else). Sidechain (subagent)
 *  lines are skipped — the card narrates the MAIN thread, like the pane header does. */
export function activityOf(line: string): ActivityEntry[] {
  let v: any;
  try { v = JSON.parse(line); } catch { return []; }
  if (!v || typeof v !== "object" || v.isSidechain || v.type !== "assistant") return [];
  const at = typeof v.timestamp === "string" ? Date.parse(v.timestamp) : NaN;
  if (Number.isNaN(at)) return [];
  const blocks: any[] = Array.isArray(v.message?.content) ? v.message.content : [];
  return blocks
    .filter((b) => b?.type === "tool_use" && typeof b.name === "string" && typeof b.id === "string")
    .map((b) => ({ toolUseId: b.id, tool: b.name, detail: detailOf(b.name, b.input), at }));
}

/** Per-pane ring buffer of the newest `cap` entries, newest line first (block order
 *  preserved within a line). Dedupes by toolUseId against everything the pane has EVER
 *  seen — not just the visible window — because logtail re-tails files from offset 0,
 *  and a full-file replay must not resurrect evicted entries as "newest". */
export function createActivityStore(cap = 3) {
  const panes = new Map<string, { entries: ActivityEntry[]; seen: Set<string> }>();
  return {
    apply(paneId: string, line: string): void {
      const parsed = activityOf(line);
      if (!parsed.length) return;
      let pane = panes.get(paneId);
      if (!pane) { pane = { entries: [], seen: new Set() }; panes.set(paneId, pane); }
      const fresh = parsed.filter((e) => !pane.seen.has(e.toolUseId));
      if (!fresh.length) return;
      for (const e of fresh) pane.seen.add(e.toolUseId);
      pane.entries = [...fresh, ...pane.entries].slice(0, cap);
    },
    get(paneId: string): ActivityEntry[] { return panes.get(paneId)?.entries ?? []; },
    clear(paneId: string): void { panes.delete(paneId); },
  };
}

/** App-wide singleton (in-memory, like waitingPanes). */
export const paneActivity = createActivityStore();
