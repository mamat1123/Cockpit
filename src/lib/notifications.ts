export interface Completion {
  id: string; paneId: string; sessionId: string; tabId: string;
  name: string; project: string; at: number; seen: boolean;
}

const CAP = 50;

export function unseenByTab(entries: Completion[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) if (!e.seen) m.set(e.tabId, (m.get(e.tabId) ?? 0) + 1);
  return m;
}
export function totalUnseen(entries: Completion[]): number {
  return entries.reduce((n, e) => n + (e.seen ? 0 : 1), 0);
}

export function createNotificationStore() {
  let entries: Completion[] = []; // newest first
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((cb) => cb());
  let seq = 0;
  return {
    push(c: Omit<Completion, "id" | "seen">, seen: boolean): Completion {
      const entry: Completion = { ...c, id: `${c.paneId}:${c.at}:${++seq}`, seen };
      entries = [entry, ...entries].slice(0, CAP);
      emit();
      return entry;
    },
    list(): Completion[] { return entries; },
    markTabSeen(tabId: string) {
      let changed = false;
      entries = entries.map((e) => (e.tabId === tabId && !e.seen ? ((changed = true), { ...e, seen: true }) : e));
      if (changed) emit();
    },
    markAllSeen() {
      if (entries.some((e) => !e.seen)) { entries = entries.map((e) => ({ ...e, seen: true })); emit(); }
    },
    clear() { if (entries.length) { entries = []; emit(); } },
    subscribe(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}

/** App-wide singleton store (in-memory; cleared on restart). */
export const notifications = createNotificationStore();

import { useSyncExternalStore } from "react";
export function useNotifications() {
  const entries = useSyncExternalStore(notifications.subscribe, notifications.list);
  return { entries, total: totalUnseen(entries) };
}
