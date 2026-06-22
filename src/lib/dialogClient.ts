import { open } from "@tauri-apps/plugin-dialog";

/** Open the native folder picker and return the chosen absolute path, or null if
 *  the user cancelled (or we're not running under Tauri, e.g. plain vite dev). */
export async function pickFolder(): Promise<string | null> {
  try {
    const sel = await open({ directory: true, multiple: false, title: "Choose a project folder" });
    return typeof sel === "string" ? sel : null;
  } catch {
    return null;
  }
}
