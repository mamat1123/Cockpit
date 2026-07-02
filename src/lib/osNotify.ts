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

/** Fire the native macOS notification for a pane blocked on a question. Title carries
 *  the session name; body is the question itself so the user knows what's being asked
 *  before jumping over. */
export async function notifyWaiting(w: { name: string; question: string }, opts: { sound: boolean }): Promise<void> {
  if (!(await ensureNotifyPermission())) return;
  sendNotification({ title: `${w.name} is asking`, body: w.question || "waiting for your answer", ...(opts.sound ? { sound: "default" } : {}) });
}
