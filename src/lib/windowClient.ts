import { invoke } from "@tauri-apps/api/core";

export async function setWindowBlur(radius: number): Promise<void> {
  try { await invoke("set_window_blur", { radius: Math.max(0, Math.round(radius)) }); } catch { /* non-tauri / dev browser — ignore */ }
}
