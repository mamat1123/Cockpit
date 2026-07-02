import type { Completion } from "./notifications";
/** Toast payload: a Completion, or a waiting alert (kind:"waiting") reusing the same
 *  shape so jump-by-sessionId keeps working. Waiting toasts are NEVER pushed to the
 *  notifications ledger — waiting is a live state, not a Seen/Unseen event. */
export interface ToastItem extends Completion { kind?: "waiting"; question?: string }
type Cb = (t: ToastItem) => void;
const subs = new Set<Cb>();
export function onToast(cb: Cb): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export function emitToast(t: ToastItem): void { subs.forEach((cb) => cb(t)); }
