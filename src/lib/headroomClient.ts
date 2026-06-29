import { invoke } from "@tauri-apps/api/core";

export const HEADROOM_BASE_URL = "http://127.0.0.1:8787";

/** Start the Cockpit-managed Headroom proxy if needed; resolves true when reachable. */
export function headroomEnsure(): Promise<boolean> {
  return invoke<boolean>("headroom_ensure");
}

/** Non-blocking liveness probe of the proxy. */
export function headroomStatus(): Promise<boolean> {
  return invoke<boolean>("headroom_status");
}
