import { useNotifications, notifications, type Completion } from "../lib/notifications";
import "./NotificationBell.css";

const rel = (at: number, now: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

const BellIcon = ({ unread }: { unread: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    {unread && <circle cx="18" cy="5" r="3.2" fill="currentColor" stroke="none" />}
  </svg>
);

export function NotificationBell({ open, onToggle, onJump }: {
  open: boolean; onToggle: () => void; onJump: (c: Completion) => void;
}) {
  const { entries, total } = useNotifications();
  const now = Date.now();
  return (
    <div className="bell-wrap">
      <button className={`cockpit-tool${total > 0 ? " bell--unread" : ""}`} onClick={onToggle}
              aria-label="Notifications (Cmd+B)" title="Notifications (⌘B)">
        <BellIcon unread={total > 0} />
        {total > 0 && <span className="bell-bubble">{total}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-panel__head">
            <h3>Notifications</h3>
            <button onClick={() => notifications.markAllSeen()}>Mark all read</button>
          </div>
          {entries.length === 0 ? (
            <div className="bell-panel__empty">No completions yet</div>
          ) : entries.map((c) => (
            <button key={c.id} className={`bell-notif${c.seen ? " seen" : ""}`} onClick={() => onJump(c)}>
              <span className="bell-notif__mark" aria-hidden="true" />
              <span className="bell-notif__meta">
                <span className="bell-notif__ttl">{c.name} finished</span>
                <span className="bell-notif__sub">{c.project}</span>
              </span>
              <span className="bell-notif__when">{rel(c.at, now)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
