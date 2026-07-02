# Vertical Tab Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Tab bar: top / left` setting; left mode docks the tab list in a 200 px sidebar while the top chrome (drag/usage/tools/bell) stays put.

**Architecture:** Add `tabBar` to `Settings`. Refactor `TabBar.tsx` behavior-preserving into a shared `useTabStrip` hook + `TabItem` component; `TabBar` keeps the top chrome and renders the horizontal list only when `showTabs`; a new `TabSidebar` export renders the same `TabItem`s vertically. `CockpitView` wraps the content area in a flex row and mounts the sidebar in left mode.

**Tech Stack:** TypeScript + React 19, vitest (jsdom). Zero Rust changes.

**Spec:** `docs/superpowers/specs/2026-07-03-vertical-tab-bar-design.md`

---

### Task 1: `tabBar` setting (TDD)

**Files:**
- Test: `src/lib/settings.tabbar.test.ts` (new)
- Modify: `src/lib/settings.ts`

- [ ] **Step 1: Write the failing test** (mirrors the localStorage mock in `settings.notifications.test.ts`)

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, DEFAULT_SETTINGS } from "./settings";

const mockStorage: { [key: string]: string } = {};
const mockLocalStorage = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
  removeItem: (key: string) => { delete mockStorage[key]; },
  length: 0,
  key: (index: number) => Object.keys(mockStorage)[index] ?? null,
};
Object.defineProperty(window, "localStorage", { value: mockLocalStorage, writable: true });

beforeEach(() => mockLocalStorage.clear());

describe("tab bar position setting", () => {
  it("defaults to top", () => {
    expect(DEFAULT_SETTINGS.tabBar).toBe("top");
    expect(loadSettings().tabBar).toBe("top");
  });
  it("backfills 'top' for stored blobs that predate the field", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ themeId: "nord" }));
    expect(loadSettings().tabBar).toBe("top");
  });
  it("round-trips 'left' and rejects unknown values", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ tabBar: "left" }));
    expect(loadSettings().tabBar).toBe("left");
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ tabBar: "bottom" }));
    expect(loadSettings().tabBar).toBe("top");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/lib/settings.tabbar.test.ts`
Expected: FAIL — `tabBar` missing from Settings.

- [ ] **Step 3: Implement in `src/lib/settings.ts`**

Add after the `NotificationSettings` block:

```ts
/** Where the tab list docks. The top chrome (drag/usage/tools/bell) stays either way. */
export type TabBarPosition = "top" | "left";
```

Add to the `Settings` interface (after `notifications`):

```ts
  /** Tab list orientation: horizontal top strip or 200px left sidebar. */
  tabBar: TabBarPosition;
```

Extend `DEFAULT_SETTINGS` with `tabBar: "top"`, and in `loadSettings`'s returned object add:

```ts
        tabBar: m.tabBar === "left" ? "left" : "top",
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/settings.tabbar.test.ts && npx tsc --noEmit` — the tsc run will FAIL until `DEFAULT_SETTINGS` consumers compile; here only settings.ts changed so both should pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts src/lib/settings.tabbar.test.ts
git commit -m "feat(tabs): tabBar top/left setting with backfill"
```

---

### Task 2: TabBar refactor — shared `TabItem`/`useTabStrip` + `TabSidebar`

**Files:**
- Modify: `src/components/TabBar.tsx` (behavior-preserving refactor + new export)
- Modify: `src/components/TabBar.css` (append)

- [ ] **Step 1: Rewrite `src/components/TabBar.tsx`**

Keep every import, icon component, and helper (`rawTabName`, `tabName`, `paneCount`) verbatim. Replace the body from `export function TabBar` down with the following structure (the JSX inside `TabItem` is the existing per-tab map body moved verbatim — only `strip.`-prefixing its state and adding the `cockpit-tab--v` class):

```tsx
/** Shared state/behavior for a tab strip (horizontal list or vertical sidebar): the
 *  working/waiting poll, double-click rename with the focus-steal grace defense, and
 *  the close-confirm chip. `enabled` skips the poll when the strip renders no items
 *  (top bar in sidebar mode). */
function useTabStrip(layout: Layout, onRenameTab: (tabId: string, title: string) => void, onCloseTab: (tabId: string) => void, enabled: boolean) {
  const [working, setWorking] = useState<Set<string>>(() => new Set());
  const [waiting, setWaiting] = useState<Set<string>>(() => new Set());
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const now = Date.now();
      const w = new Set<string>();
      const ask = new Set<string>();
      for (const t of layoutRef.current.tabs) {
        const panes = t.rows.flatMap((r) => r.panes);
        if (panes.some((p) => waitingPanes.get(p.id))) ask.add(t.id);
        if (panes.some((p) => deriveState({ lastLineAt: paneLastLineAt(p.id) }, now, 800) === "working")) w.add(t.id);
      }
      const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...b].every((x) => a.has(x));
      setWorking((prev) => (same(prev, w) ? prev : w));
      setWaiting((prev) => (same(prev, ask) ? prev : ask));
    }, 400);
    return () => clearInterval(id);
  }, [enabled]);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const graceUntilRef = useRef(0);
  useEffect(() => {
    if (!editingTabId) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    // (existing focus-steal grace comment moves here verbatim)
    graceUntilRef.current = performance.now() + 200;
    let raf = 0;
    const tick = () => {
      if (performance.now() >= graceUntilRef.current) return;
      if (document.activeElement !== el) el.focus();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editingTabId]);

  const commitRename = (tabId: string) => {
    setEditingTabId(null);
    onRenameTab(tabId, draft);
  };

  const [confirmingTabId, setConfirmingTabId] = useState<string | null>(null);
  useEffect(() => {
    if (!confirmingTabId) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".cockpit-tab.is-confirming")) setConfirmingTabId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [confirmingTabId]);

  const requestClose = (t: Tab) => {
    if (paneCount(t) > 1) setConfirmingTabId(t.id);
    else onCloseTab(t.id);
  };

  return {
    working, waiting,
    editingTabId, setEditingTabId, draft, setDraft, inputRef, graceUntilRef, commitRename,
    confirmingTabId, setConfirmingTabId, requestClose, onCloseTab,
  };
}
type TabStrip = ReturnType<typeof useTabStrip>;

/** One tab row — identical behavior in both orientations; `vertical` only switches CSS. */
function TabItem({ t, index, layout, attention, unseenByTab, vertical, strip, onSelect, onReorder }: {
  t: Tab;
  index: number;
  layout: Layout;
  attention: Set<string>;
  unseenByTab: Map<string, number>;
  vertical?: boolean;
  strip: TabStrip;
  onSelect: (tabId: string) => void;
  onReorder: (tabId: string, toIndex: number) => void;
}) {
  const active = t.id === layout.activeTabId;
  const isWorking = strip.working.has(t.id);
  const isWaiting = strip.waiting.has(t.id);
  const attn = attention.has(t.id) && !active;
  const editing = strip.editingTabId === t.id;
  const confirming = strip.confirmingTabId === t.id;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`cockpit-tab${vertical ? " cockpit-tab--v" : ""}${active ? " is-active" : ""}${attn ? " is-attention" : ""}${confirming ? " is-confirming" : ""}`}
      draggable={!editing}
      onClick={() => onSelect(t.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t.id); }
      }}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const fromId = e.dataTransfer.getData("text/plain");
        if (fromId && fromId !== t.id) onReorder(fromId, index);
      }}
    >
      {confirming ? (
        <span className="confirm-chip">
          {`Close ${paneCount(t)} sessions?`}
          <button className="confirm-chip__go" onClick={(e) => { e.stopPropagation(); strip.setConfirmingTabId(null); strip.onCloseTab(t.id); }}>Close</button>
          <button className="confirm-chip__cancel" onClick={(e) => { e.stopPropagation(); strip.setConfirmingTabId(null); }}>Cancel</button>
        </span>
      ) : (
      <>
      {isWaiting ? (
        <span className="cockpit-tab__ask" aria-hidden="true">?</span>
      ) : isWorking ? (
        <span className="cockpit-tab__eq" aria-hidden="true"><i /><i /><i /></span>
      ) : (
        <span className="cockpit-tab__dot" aria-hidden="true" />
      )}
      {editing ? (
        <input
          ref={strip.inputRef}
          className="cockpit-tab__input"
          value={strip.draft}
          onChange={(e) => strip.setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            // Ignore blur during the steal-defense grace window above — the tick loop is
            // already reclaiming focus every frame, so this blur is the race, not the user.
            if (performance.now() < strip.graceUntilRef.current) return;
            strip.commitRename(t.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); strip.commitRename(t.id); }
            else if (e.key === "Escape") { e.preventDefault(); strip.setEditingTabId(null); }
          }}
        />
      ) : (
        <span
          className="cockpit-tab__title"
          onDoubleClick={(e) => { e.stopPropagation(); strip.setDraft(rawTabName(t)); strip.setEditingTabId(t.id); }}
        >
          {tabName(t)}
        </span>
      )}
      <span className="cockpit-tab__meta">
        <span className="cockpit-tab__ct">{paneCount(t)}</span>
        <button
          className="cockpit-tab__x"
          aria-label="Close tab"
          title="Close tab"
          onClick={(e) => { e.stopPropagation(); strip.requestClose(t); }}
        >
          <CloseIcon />
        </button>
      </span>
      {!active && (unseenByTab.get(t.id) ?? 0) > 0 && (
        <span className="cockpit-tab__badge">{unseenByTab.get(t.id)}</span>
      )}
      </>
      )}
    </div>
  );
}

export function TabBar({ layout, attention, unseenByTab, bellOpen, showTabs = true, onToggleBell, onJumpSession, onSelect, onReorder, onRenameTab, onCloseTab, onOpenDashboard, onOpenPicker, onOpenWorkspaces, onOpenSettings }: {
  layout: Layout;
  attention: Set<string>;
  unseenByTab: Map<string, number>;
  bellOpen: boolean;
  /** false = the tab list lives in the TabSidebar; only the chrome renders here. */
  showTabs?: boolean;
  onToggleBell: () => void;
  onJumpSession: (c: import("../lib/notifications").Completion) => void;
  onSelect: (tabId: string) => void;
  onNewTab: () => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenDashboard: () => void;
  onOpenPicker: () => void;
  onOpenWorkspaces: () => void;
  onOpenSettings: () => void;
}) {
  const strip = useTabStrip(layout, onRenameTab, onCloseTab, showTabs);
  return (
    <div className="cockpit-tabs">
      {showTabs && (
        <div className="cockpit-tabs__list">
          {layout.tabs.map((t, i) => (
            <TabItem key={t.id} t={t} index={i} layout={layout} attention={attention} unseenByTab={unseenByTab} strip={strip} onSelect={onSelect} onReorder={onReorder} />
          ))}
        </div>
      )}
      <div className="cockpit-tabs__drag" data-tauri-drag-region></div>
      <UsageStrip />
      <div className="cockpit-tabs__tools">
        <button className="cockpit-tool" onClick={onOpenDashboard} aria-label="Mission Control (Cmd+0)" title="Mission Control (⌘0)"><GridIcon /></button>
        <button className="cockpit-tool" onClick={onOpenWorkspaces} aria-label="Workspaces (Cmd+E)" title="Workspaces (⌘E)"><LayersIcon /></button>
        <NotificationBell open={bellOpen} onToggle={onToggleBell} onJump={onJumpSession} />
        <button className="cockpit-tool" onClick={onOpenSettings} aria-label="Settings (Cmd+,)" title="Settings (⌘,)"><SettingsIcon /></button>
        <button className="cockpit-tool cockpit-tool--add" onClick={onOpenPicker} aria-label="Open project (Cmd+O)" title="Open project (⌘O)"><FolderPlusIcon /></button>
      </div>
    </div>
  );
}

/** Left-docked vertical tab list (settings.tabBar === "left"); the top bar keeps the
 *  drag region / usage / tools and hides its horizontal list via showTabs={false}. */
export function TabSidebar({ layout, attention, unseenByTab, onSelect, onReorder, onRenameTab, onCloseTab }: {
  layout: Layout;
  attention: Set<string>;
  unseenByTab: Map<string, number>;
  onSelect: (tabId: string) => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onCloseTab: (tabId: string) => void;
}) {
  const strip = useTabStrip(layout, onRenameTab, onCloseTab, true);
  return (
    <nav className="cockpit-side" aria-label="Tabs">
      {layout.tabs.map((t, i) => (
        <TabItem key={t.id} t={t} index={i} layout={layout} attention={attention} unseenByTab={unseenByTab} vertical strip={strip} onSelect={onSelect} onReorder={onReorder} />
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Append to `src/components/TabBar.css`**

```css
/* ── left-docked tab sidebar (settings.tabBar = "left") ── */
.cockpit-side {
  width: 200px; flex: none; display: flex; flex-direction: column; align-items: stretch;
  overflow-y: auto; overflow-x: hidden;
  background: color-mix(in srgb, var(--ck-surface) 72%, transparent);
  border-right: 1px solid var(--ck-border);
}
.cockpit-tab--v { max-width: none; width: 100%; flex: none; height: 38px; padding: 0 12px; border-right: 0; border-bottom: 1px solid var(--ck-surface-2); }
.cockpit-tab--v .cockpit-tab__title { flex: 1; text-align: left; }
.cockpit-tab--v.is-active::before,
.cockpit-tab--v.is-attention::before { top: 0; bottom: 0; left: 0; right: auto; width: 2px; height: auto; }
.cockpit-tab--v.is-active::before { box-shadow: 1px 0 10px var(--ck-accent); }
.cockpit-tab--v.is-confirming { max-width: none; height: auto; padding: 8px 12px; }
.cockpit-tab--v .confirm-chip { flex-wrap: wrap; white-space: normal; }
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm test` → clean, all PASS (refactor is behavior-preserving; no TabBar tests exist).

```bash
git add src/components/TabBar.tsx src/components/TabBar.css
git commit -m "refactor(tabs): shared TabItem/useTabStrip + vertical TabSidebar"
```

---

### Task 3: CockpitView wiring

**Files:**
- Modify: `src/components/CockpitView.tsx`

- [ ] **Step 1: Mount the sidebar**

Change the import: `import { TabBar, TabSidebar } from "./TabBar";`

Extract the tab-select handler above the `return` (it's now needed twice):

```ts
  const selectTab = useCallback((tabId: string) => {
    dispatch({ type: "focusTab", tabId });
    const pid = layout.tabs.find((t) => t.id === tabId)?.rows[0]?.panes[0]?.id;
    if (pid) requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(pid)));
  }, [layout]);
```

In `<TabBar ...>`: replace the inline `onSelect={...}` with `onSelect={selectTab}` and add `showTabs={settings.tabBar !== "left"}`.

Replace the content-area block (`<div style={{ position: "relative", flex: 1, minHeight: 0 }}>…</div>`) with:

```tsx
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {settings.tabBar === "left" && layout.tabs.length > 0 && (
          <TabSidebar
            layout={layout}
            attention={attention}
            unseenByTab={unseen}
            onSelect={selectTab}
            onReorder={(tabId, toIndex) => dispatch({ type: "moveTab", tabId, toIndex })}
            onRenameTab={(tabId, title) => dispatch({ type: "renameTab", tabId, title })}
            onCloseTab={(tabId) => dispatch({ type: "closeTab", tabId })}
          />
        )}
        <div style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
          {layout.tabs.length === 0 ? (
            <button className="cockpit-empty" onClick={() => setPickerOpen(true)}>
              <span className="cockpit-empty__icon" aria-hidden="true">⌘O</span>
              <span className="cockpit-empty__title">No project open</span>
              <span className="cockpit-empty__sub">Open a folder to start a Claude session</span>
            </button>
          ) : (
            layout.tabs.map((t) => (
              <TabPanes
                key={t.id}
                tab={t}
                active={t.id === layout.activeTabId}
                dispatch={dispatch}
                registerSlot={registerSlot}
              />
            ))
          )}
        </div>
      </div>
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npm test` → clean, PASS.

```bash
git add src/components/CockpitView.tsx
git commit -m "feat(tabs): dock tab list left when tabBar setting is left"
```

---

### Task 4: Settings UI

**Files:**
- Modify: `src/components/SettingsMenu.tsx`
- Modify: `src/components/SettingsMenu.css` (append)

- [ ] **Step 1: Segmented control row** — insert after the "Window blur" `settings__row` (before the z.ai row):

```tsx
        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">Tab bar</span>
            <span className="settings__desc">dock the tab list along the top or the left edge</span>
          </div>
          <div className="settings__control">
            <div className="settings__seg" role="radiogroup" aria-label="Tab bar position">
              {(["top", "left"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  className={`settings__seg-btn${settings.tabBar === pos ? " is-active" : ""}`}
                  role="radio"
                  aria-checked={settings.tabBar === pos}
                  onClick={() => onPatch({ tabBar: pos })}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
        </div>
```

- [ ] **Step 2: Append to `src/components/SettingsMenu.css`**

```css
.settings__seg { display: inline-flex; border: 1px solid var(--ck-border); border-radius: 7px; overflow: hidden; }
.settings__seg-btn { appearance: none; -webkit-appearance: none; border: 0; margin: 0; padding: 5px 14px;
  font: 600 12px/1 ui-monospace, Menlo, monospace; color: var(--ck-muted); background: transparent; cursor: pointer; }
.settings__seg-btn + .settings__seg-btn { border-left: 1px solid var(--ck-border); }
.settings__seg-btn.is-active { color: var(--ck-accent); background: color-mix(in srgb, var(--ck-accent) 14%, transparent); }
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm test` → clean, PASS.

```bash
git add src/components/SettingsMenu.tsx src/components/SettingsMenu.css
git commit -m "feat(tabs): Tab bar top/left segmented control in Settings"
```

---

### Task 5: Docs + full verification

**Files:**
- Modify: `docs/feature-matrix.md`
- Modify: `SPEC.md`

- [ ] **Step 1: Feature-matrix row** (after the "Waiting state" row)

```markdown
| Vertical tab bar | Shipped after v0.10.1 | Settings → Tab bar: top / left; 200px sidebar keeps full tab behavior (rename/close/reorder/badges). |
```

- [ ] **Step 2: SPEC status** — append under the "Status — updated 2026-07-02" block:

```markdown
## Status — updated 2026-07-03

- **M12 — Vertical tab bar**: `Settings → Tab bar (top/left)`. Left mode docks the tab list
  in a 200px sidebar under the unchanged top chrome; TabBar refactored into a shared
  TabItem + useTabStrip so both orientations are one implementation (select, drag-reorder,
  rename with focus-steal defense, close+confirm, working/waiting/unseen indicators).
  Setting persisted with backfill. Spec: docs/superpowers/specs/2026-07-03-vertical-tab-bar-design.md.
```

- [ ] **Step 3: Full verification**

Run: `npm test` → all PASS. Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add docs/feature-matrix.md SPEC.md docs/superpowers/plans/2026-07-03-vertical-tab-bar.md
git commit -m "docs(tabs): vertical tab bar in feature matrix + SPEC status"
```
