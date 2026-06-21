import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

/** Returns the pending Update, or null when up-to-date / not in a Tauri context (dev browser). */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    return null; // no tauri runtime (dev browser) or network/endpoint error
  }
}

/** Download + install with progress, then relaunch. onProgress(downloaded, total|null). */
export async function downloadAndInstall(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((ev) => {
    if (ev.event === "Started") {
      total = ev.data.contentLength ?? null;
      onProgress?.(0, total);
    } else if (ev.event === "Progress") {
      downloaded += ev.data.chunkLength;
      onProgress?.(downloaded, total);
    } else if (ev.event === "Finished") {
      onProgress?.(total ?? downloaded, total);
    }
  });
  await relaunch();
}
