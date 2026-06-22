import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import type { Completion } from "./notifications";

/** Resolve a usable permission, requesting once if needed. */
export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch { return false; }
}

/** Fire the native macOS notification for a Completion. Title = session name,
 *  body = project. `sound` attaches the system sound (the only sound — no Web Audio). */
export async function notifyCompletion(c: Completion, opts: { sound: boolean }): Promise<void> {
  if (!(await ensureNotifyPermission())) return;
  sendNotification({ title: c.name, body: c.project, ...(opts.sound ? { sound: "default" } : {}) });
}
