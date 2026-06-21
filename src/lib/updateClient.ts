import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

// The repo is private, so both the manifest (public gist) and the release-asset
// binary are fetched through the GitHub asset API with a read-only token. The
// token is injected at build time from `.env.local` (VITE_UPDATER_TOKEN, gitignored)
// and never committed. `Accept: application/octet-stream` is what the asset API
// needs to return raw bytes; the gist host simply ignores it. These headers ride
// along on both the manifest check and the subsequent download.
const UPDATER_TOKEN = ((import.meta.env.VITE_UPDATER_TOKEN as string | undefined) ?? "").trim();
const updaterHeaders: Record<string, string> | undefined = UPDATER_TOKEN
  ? { Authorization: `Bearer ${UPDATER_TOKEN}`, Accept: "application/octet-stream" }
  : undefined;

/** Returns the pending Update, or null when up-to-date / not in a Tauri context (dev browser). */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check(updaterHeaders ? { headers: updaterHeaders } : undefined);
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
