import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function startLogtail(paneId: string, cwd: string) {
  return invoke("logtail_start", { paneId, cwd });
}
export function stopLogtail(paneId: string) {
  return invoke("logtail_stop", { paneId });
}
/** Fires `onLine` for every new jsonl line; caller stamps the time. */
export function onLogLine(paneId: string, onLine: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>(`pane://log/${paneId}`, (e) => onLine(e.payload));
}
export function paneTopic(cwd: string): Promise<string | null> {
  return invoke("pane_topic", { cwd });
}
