import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function spawnPty(paneId: string, cwd: string, cols: number, rows: number, launch: string | null, env?: Record<string, string> | null) {
  return invoke("pty_spawn", { paneId, cwd, cols, rows, launch, env: env ?? null });
}

export function killPty(paneId: string) {
  return invoke("pty_kill", { paneId });
}

export function writePty(paneId: string, data: string) {
  return invoke("pty_write", { paneId, data });
}

export function resizePty(paneId: string, cols: number, rows: number) {
  return invoke("pty_resize", { paneId, cols, rows });
}

export function onPtyOutput(paneId: string, cb: (chunk: string) => void): Promise<UnlistenFn> {
  return listen<string>(`pty://output/${paneId}`, (e) => cb(e.payload));
}

export function onPtyExit(paneId: string, cb: () => void): Promise<UnlistenFn> {
  return listen(`pty://exit/${paneId}`, () => cb());
}
