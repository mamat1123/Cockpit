import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function startHeadroomLog(): Promise<void> { return invoke("headroom_log_start"); }
export function stopHeadroomLog(): Promise<void> { return invoke("headroom_log_stop"); }
export function onHeadroomLog(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>("headroom://log", (e) => cb(e.payload));
}
