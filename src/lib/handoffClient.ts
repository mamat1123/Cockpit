import { invoke } from "@tauri-apps/api/core";

export interface CodexHandoff {
  promptPath: string;
  title: string | null;
  cwd: string;
  sourceSessionId: string;
  excerptCount: number;
  omittedCount: number;
}

interface RawCodexHandoff {
  prompt_path: string;
  title: string | null;
  cwd: string;
  source_session_id: string;
  excerpt_count: number;
  omitted_count: number;
}

export async function createCodexHandoff(cwd: string, sessionId: string): Promise<CodexHandoff> {
  const raw = await invoke<RawCodexHandoff>("create_codex_handoff", { cwd, sessionId });
  return {
    promptPath: raw.prompt_path,
    title: raw.title,
    cwd: raw.cwd,
    sourceSessionId: raw.source_session_id,
    excerptCount: raw.excerpt_count,
    omittedCount: raw.omitted_count,
  };
}
