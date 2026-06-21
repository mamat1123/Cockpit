type Cb = () => void;
const subs = new Set<Cb>();
/** Subscribe to "prompt sent" events; returns an unsubscribe fn. */
export function onSend(cb: Cb): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
/** Fire a "prompt sent" event (called when the user presses Enter in a pane). */
export function emitSend(): void { subs.forEach((cb) => cb()); }
