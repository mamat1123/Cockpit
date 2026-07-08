import "./BurrowCloseDialog.css";

export interface BurrowToClose { paneId: string; codename: string; path: string; branch: string }

/** Shown when closing panes whose Burrow has uncommitted/unpushed work.
 *  Three outcomes: delete the worktrees, keep them, or cancel the close. */
export function BurrowCloseDialog({ burrows, onDelete, onKeep, onCancel }: {
  burrows: BurrowToClose[];
  onDelete: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="burrow-close" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="burrow-close__panel" role="dialog" aria-label="ปิด Session ที่มีงานค้าง">
        <div className="burrow-close__head">
          <h3>ปิด Session ที่มีงานค้าง</h3>
        </div>
        <div className="burrow-close__body">
          <p className="burrow-close__hint">Burrow เหล่านี้มีการแก้ที่ยังไม่ commit หรือ commit ที่ยังไม่ push:</p>
          <ul className="burrow-close__list">
            {burrows.map((b) => (
              <li key={b.paneId} className="burrow-close__item">
                <code>{b.codename}</code> — <span className="burrow-close__path">{b.path}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="burrow-close__actions">
          <button type="button" className="burrow-close__btn burrow-close__btn--danger" onClick={onDelete}>ลบทิ้ง</button>
          <button type="button" className="burrow-close__btn" onClick={onKeep}>เก็บไว้</button>
          <button type="button" className="burrow-close__btn" onClick={onCancel}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}
