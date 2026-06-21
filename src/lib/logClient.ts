import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function startLogtail(paneId: string, cwd: string, sessionId: string) {
  return invoke("logtail_start", { paneId, cwd, sessionId });
}
export function stopLogtail(paneId: string) {
  return invoke("logtail_stop", { paneId });
}
/** Fires `onLine` for every new jsonl line; caller stamps the time. */
export function onLogLine(paneId: string, onLine: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>(`pane://log/${paneId}`, (e) => onLine(e.payload));
}
export function paneTopic(cwd: string, sessionId: string): Promise<string | null> {
  return invoke("pane_topic", { cwd, sessionId });
}
export function sessionExists(cwd: string, sessionId: string): Promise<boolean> {
  return invoke("session_exists", { cwd, sessionId });
}
