import { invoke } from "@tauri-apps/api/core";
import type { BlurMaterial } from "./settings";

export async function setWindowEffect(material: BlurMaterial): Promise<void> {
  try { await invoke("set_window_effect", { material }); } catch { /* non-tauri / dev browser — ignore */ }
}
