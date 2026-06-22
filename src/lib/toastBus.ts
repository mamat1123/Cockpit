import type { Completion } from "./notifications";
type Cb = (c: Completion) => void;
const subs = new Set<Cb>();
export function onToast(cb: Cb): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export function emitToast(c: Completion): void { subs.forEach((cb) => cb(c)); }
