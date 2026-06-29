# Ponytail level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-Pane "Ponytail level" (off/lite/full/ultra) toggle to Cockpit — like HR — that controls the [ponytail](https://github.com/DietrichGebert/ponytail) Claude Code plugin's code-minimization intensity per Session.

**Architecture:** Mirror HR. A per-Pane `PONYTAIL_DEFAULT_MODE` env is injected at `claude` launch (ponytail reads it at SessionStart); switching level kills+relaunches `claude --resume`. HR and ponytail are independent env axes merged by a new pure `paneLaunchEnv`. A Rust command detects whether the plugin is installed; the UI dims+nudges when it isn't. UI is an intensity-meter `PT` chip + dropdown in the Pane header.

**Tech Stack:** React 19 + TypeScript + Vite, xterm, Tauri (Rust), vitest.

**Design spec:** `docs/superpowers/specs/2026-06-30-ponytail-level-design.md`

**Note:** Every commit ends with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer (per CLAUDE.md). Commit commands below omit it for brevity — add it.

---

### Task 1: Ponytail client (type, metadata, install probe)

A constants + IO module, mirroring `headroomClient.ts` (no unit test — pure constants + an `invoke` wrapper).

**Files:**
- Create: `src/lib/ponytailClient.ts`

- [ ] **Step 1: Write the module**

```ts
// src/lib/ponytailClient.ts
import { invoke } from "@tauri-apps/api/core";

export type PonytailLevel = "off" | "lite" | "full" | "ultra";

/** Ordered low→high; the dropdown renders in this order. */
export const PONYTAIL_LEVELS: PonytailLevel[] = ["off", "lite", "full", "ultra"];

/** Per-level UI metadata: meter fill (0–3 cells) + one-line description. */
export const PONYTAIL_META: Record<PonytailLevel, { fill: number; desc: string }> = {
  off:   { fill: 0, desc: "ponytail off — Claude behaves normally" },
  lite:  { fill: 1, desc: "light — avoids over-engineering" },
  full:  { fill: 2, desc: "standard — YAGNI, stdlib first, no extra abstractions" },
  ultra: { fill: 3, desc: "strictest — the least code that still works" },
};

/** Whether the ponytail Claude Code plugin is installed (so PONYTAIL_DEFAULT_MODE
 *  actually does something). Reads ~/.claude/plugins/installed_plugins.json via Rust. */
export function ponytailInstalled(): Promise<boolean> {
  return invoke<boolean>("ponytail_installed");
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (the `invoke` import resolves; no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ponytailClient.ts
git commit -m "feat(ponytail): add ponytail client — level type, metadata, install probe"
```

---

### Task 2: `paneLaunchEnv` — merge HR + ponytail env (TDD)

The pure seam: given a Pane's HR-engaged state and ponytail level, produce the env to spawn `claude` with.

**Files:**
- Create: `src/lib/paneLaunchEnv.ts`
- Test: `src/lib/paneLaunchEnv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/paneLaunchEnv.test.ts
import { describe, it, expect } from "vitest";
import { paneLaunchEnv } from "./paneLaunchEnv";

const BASE = "http://127.0.0.1:8787";

describe("paneLaunchEnv", () => {
  it("pins PONYTAIL_DEFAULT_MODE=off when HR off and ponytail off (off is never omitted)", () => {
    expect(paneLaunchEnv({ headroomEngaged: false, ponytail: "off", headroomBaseUrl: BASE }))
      .toEqual({ PONYTAIL_DEFAULT_MODE: "off" });
  });
  it("carries the ponytail level when HR off and ponytail full", () => {
    expect(paneLaunchEnv({ headroomEngaged: false, ponytail: "full", headroomBaseUrl: BASE }))
      .toEqual({ PONYTAIL_DEFAULT_MODE: "full" });
  });
  it("adds ANTHROPIC_BASE_URL when HR engaged, alongside the pinned off level", () => {
    expect(paneLaunchEnv({ headroomEngaged: true, ponytail: "off", headroomBaseUrl: BASE }))
      .toEqual({ PONYTAIL_DEFAULT_MODE: "off", ANTHROPIC_BASE_URL: BASE });
  });
  it("merges both when HR engaged and ponytail ultra", () => {
    expect(paneLaunchEnv({ headroomEngaged: true, ponytail: "ultra", headroomBaseUrl: BASE }))
      .toEqual({ PONYTAIL_DEFAULT_MODE: "ultra", ANTHROPIC_BASE_URL: BASE });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/paneLaunchEnv.test.ts`
Expected: FAIL — cannot import `paneLaunchEnv` (module/function missing).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/paneLaunchEnv.ts
import type { PonytailLevel } from "./ponytailClient";

/** The extra env a Pane's `claude` is launched with, merged from its toggles. HR and
 *  ponytail are independent axes that can both be on, so the env is the union of both.
 *  PONYTAIL_DEFAULT_MODE is ALWAYS set (incl. "off") so Cockpit's per-Pane level is
 *  authoritative — omitting it lets ponytail fall back to the user's global config / "full",
 *  which would make the chip lie. ANTHROPIC_BASE_URL is added only when HR actually engaged. */
export function paneLaunchEnv(opts: {
  headroomEngaged: boolean;
  ponytail: PonytailLevel;
  headroomBaseUrl: string;
}): Record<string, string> {
  const env: Record<string, string> = { PONYTAIL_DEFAULT_MODE: opts.ponytail };
  if (opts.headroomEngaged) env.ANTHROPIC_BASE_URL = opts.headroomBaseUrl;
  return env;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/paneLaunchEnv.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/paneLaunchEnv.ts src/lib/paneLaunchEnv.test.ts
git commit -m "feat(ponytail): paneLaunchEnv — merge HR + ponytail launch env"
```

---

### Task 3: Pane state — `ponytail` field + `setPonytail` + persistence (TDD)

**Files:**
- Modify: `src/layout/paneLayout.ts`
- Test: `src/layout/paneLayout.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/layout/paneLayout.test.ts` (after the existing `serialize/deserialize` imports at line ~166):

```ts
describe("ponytail level", () => {
  it("setPonytail sets the level on the target pane only", () => {
    let l = initLayout("/tmp/a");
    l = reduce(l, { type: "split" });
    const [p0, p1] = l.tabs[0].rows[0].panes;
    l = reduce(l, { type: "setPonytail", paneId: p0.id, level: "ultra" });
    const panes = l.tabs[0].rows[0].panes;
    expect(panes.find((p) => p.id === p0.id)!.ponytail).toBe("ultra");
    expect(panes.find((p) => p.id === p1.id)!.ponytail).toBeUndefined();
  });
  it("serialize omits ponytail when unset; deserialize defaults to off", () => {
    const l = initLayout("/tmp/a");
    const saved = serializeLayout(l, true);
    expect(saved.tabs[0].rows[0].panes[0].ponytail).toBeUndefined();
    expect(deserializeLayout(saved).tabs[0].rows[0].panes[0].ponytail).toBe("off");
  });
  it("serialize keeps a real level and round-trips it", () => {
    let l = initLayout("/tmp/a");
    const pid = l.tabs[0].rows[0].panes[0].id;
    l = reduce(l, { type: "setPonytail", paneId: pid, level: "full" });
    const saved = serializeLayout(l, true);
    expect(saved.tabs[0].rows[0].panes[0].ponytail).toBe("full");
    expect(deserializeLayout(saved).tabs[0].rows[0].panes[0].ponytail).toBe("full");
  });
  it("serialize omits ponytail when explicitly off", () => {
    let l = initLayout("/tmp/a");
    const pid = l.tabs[0].rows[0].panes[0].id;
    l = reduce(l, { type: "setPonytail", paneId: pid, level: "off" });
    expect(serializeLayout(l, true).tabs[0].rows[0].panes[0].ponytail).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/layout/paneLayout.test.ts`
Expected: FAIL — `setPonytail` not assignable to `Action` / `ponytail` not on `Pane`.

- [ ] **Step 3: Implement — edit `src/layout/paneLayout.ts`**

Add the type import at the top of the file (after the first line / with other imports):

```ts
import type { PonytailLevel } from "../lib/ponytailClient";
```

Extend `Pane` (line 1) and `SavedPane` (line 6):

```ts
export interface Pane { id: string; cwd: string; size: number; title: string; autoTitle: boolean; sessionId: string; resume?: boolean; headroom?: boolean; ponytail?: PonytailLevel }
```
```ts
export interface SavedPane { cwd: string; title: string; autoTitle: boolean; size: number; sessionId?: string; headroom?: boolean; ponytail?: PonytailLevel }
```

Add to the `Action` union (after the `setHeadroom` line):

```ts
  | { type: "setPonytail"; paneId: string; level: PonytailLevel };
```

In `serializeLayout`, the per-pane object — add after the headroom spread:

```ts
          ...(p.ponytail && p.ponytail !== "off" ? { ponytail: p.ponytail } : {}),
```

In `deserializeLayout`, the per-pane object — add after `headroom: !!p.headroom,`:

```ts
        ponytail: p.ponytail ?? "off",
```

Add the reducer case (after the `setHeadroom` case, before the closing `}` of the switch):

```ts
    case "setPonytail": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) => ({
          ...r,
          panes: r.panes.map((p) => (p.id === a.paneId ? { ...p, ponytail: a.level } : p)),
        })),
      }));
      return { ...l, tabs };
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/layout/paneLayout.test.ts`
Expected: PASS (all, including the 4 new ponytail tests).

- [ ] **Step 5: Commit**

```bash
git add src/layout/paneLayout.ts src/layout/paneLayout.test.ts
git commit -m "feat(ponytail): pane ponytail level — state, setPonytail, persistence"
```

---

### Task 4: Rust — detect the installed plugin

**Files:**
- Create: `src-tauri/src/ponytail.rs`
- Modify: `src-tauri/src/lib.rs:7` (mod decl) and `src-tauri/src/lib.rs:122` (handler list)

- [ ] **Step 1: Write `src-tauri/src/ponytail.rs` (impl + `#[cfg(test)]` tests together — Rust unit test is the failing-first check)**

```rust
use std::fs;
use std::path::PathBuf;

/// Path to Claude Code's installed-plugins manifest, honoring CLAUDE_CONFIG_DIR.
fn installed_plugins_path() -> Option<PathBuf> {
    let base = match std::env::var("CLAUDE_CONFIG_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d),
        _ => PathBuf::from(std::env::var("HOME").ok()?).join(".claude"),
    };
    Some(base.join("plugins").join("installed_plugins.json"))
}

/// True if the manifest lists any plugin keyed `ponytail` or `ponytail@<marketplace>`.
/// installed_plugins.json shape: { "version": int, "plugins": { "<plugin>@<mkt>": [...] } }.
fn has_ponytail(json: &str) -> bool {
    let v: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return false,
    };
    match v.get("plugins").and_then(|p| p.as_object()) {
        Some(map) => map.keys().any(|k| k == "ponytail" || k.starts_with("ponytail@")),
        None => false,
    }
}

/// Whether the ponytail Claude Code plugin is installed.
#[tauri::command]
pub fn ponytail_installed() -> bool {
    installed_plugins_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| has_ponytail(&s))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::has_ponytail;

    #[test]
    fn detects_installed_ponytail() {
        let json = r#"{"version":1,"plugins":{"ponytail@ponytail":[{}],"superpowers@superpowers-dev":[{}]}}"#;
        assert!(has_ponytail(json));
    }
    #[test]
    fn absent_when_not_listed() {
        let json = r#"{"version":1,"plugins":{"superpowers@superpowers-dev":[{}]}}"#;
        assert!(!has_ponytail(json));
    }
    #[test]
    fn false_on_garbage() {
        assert!(!has_ponytail("not json"));
    }
}
```

- [ ] **Step 2: Register the module + command in `src-tauri/src/lib.rs`**

After line 7 (`mod headroomlog;`) add:

```rust
mod ponytail;
```

In the `tauri::generate_handler![ ... ]` list (after `headroomlog::headroom_log_stop,` at line ~122) add:

```rust
            ponytail::ponytail_installed,
```

- [ ] **Step 3: Run the Rust unit test (verify the detector)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml has_ponytail ponytail`
Expected: 3 tests pass (`detects_installed_ponytail`, `absent_when_not_listed`, `false_on_garbage`).
(If `serde_json` is somehow not a dependency, `cargo` will error — add `serde_json = "1"` to `src-tauri/Cargo.toml` `[dependencies]`; it is normally already present via the JSON parsing in `cost.rs`.)

- [ ] **Step 4: Verify it compiles into the app**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Finished (no errors).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ponytail.rs src-tauri/src/lib.rs
git commit -m "feat(ponytail): ponytail_installed command — detect the Claude Code plugin"
```

---

### Task 5: Wire launch env + per-Pane relaunch (terminalRegistry)

Side-effectful PTY glue — verified by typecheck (mirrors how HR's glue was built).

**Files:**
- Modify: `src/lib/terminalRegistry.ts`

- [ ] **Step 1: Add imports** (after the existing `headroomClient` / `headroomRouting` imports near line 9–10)

```ts
import { paneLaunchEnv } from "./paneLaunchEnv";
import type { PonytailLevel } from "./ponytailClient";
```

- [ ] **Step 2: Replace `launchClaude`** — take a `{ headroom, ponytail }` opts object and build env via `paneLaunchEnv`

```ts
/** Build + run the launch command for a pane. Resolves HR routing (when on) and merges
 *  the HR + ponytail env via paneLaunchEnv. Resumes if the session log exists. Returns
 *  whether Headroom routing actually engaged (false = direct / proxy down). */
async function launchClaude(paneId: string, cwd: string, sessionId: string, resume: boolean, opts: { headroom: boolean; ponytail: PonytailLevel }, cols: number, rows: number): Promise<boolean> {
  const flags = "--dangerously-skip-permissions";
  let launch = `claude ${flags} --session-id ${sessionId}`;
  if (resume) {
    try { if (await sessionExists(cwd, sessionId)) launch = `claude ${flags} --resume ${sessionId}`; } catch { /* not under tauri */ }
  }
  const { engaged } = await resolveHeadroomRouting(opts.headroom, headroomEnsure, HEADROOM_BASE_URL);
  const env = paneLaunchEnv({ headroomEngaged: engaged, ponytail: opts.ponytail, headroomBaseUrl: HEADROOM_BASE_URL });
  void spawnPty(paneId, cwd, cols, rows, launch, env);
  return engaged;
}
```

- [ ] **Step 3: Update `acquireTerminal`** — add a `ponytail` parameter and pass the opts object

Change the signature:
```ts
export function acquireTerminal(paneId: string, cwd: string, sessionId: string, resume: boolean, headroom: boolean, ponytail: PonytailLevel): TermEntry {
```
Change the launch call (the `void launchClaude(...).then(...)` block):
```ts
  void launchClaude(paneId, cwd, sessionId, resume, { headroom, ponytail }, term.cols, term.rows)
    .then((engaged) => { if (engaged) routed.add(paneId); else routed.delete(paneId); });
```

- [ ] **Step 4: Update `setPaneHeadroom`** — add a `ponytail` parameter so toggling HR preserves the level

```ts
export async function setPaneHeadroom(paneId: string, cwd: string, sessionId: string, on: boolean, ponytail: PonytailLevel): Promise<boolean> {
  const e = registry.get(paneId);
  if (!e) return false;
  await killPty(paneId);
  e.term.write("\r\n[switching Headroom routing…]\r\n");
  const engaged = await launchClaude(paneId, cwd, sessionId, true, { headroom: on, ponytail }, e.term.cols, e.term.rows);
  if (engaged) routed.add(paneId); else routed.delete(paneId);
  if (on && !engaged) e.term.write("[Headroom proxy unavailable — staying on direct]\r\n");
  return engaged;
}
```

- [ ] **Step 5: Add `setPanePonytail`** (next to `setPaneHeadroom`)

```ts
/** Switch a LIVE pane's Ponytail level: kill its claude and relaunch with --resume so the
 *  conversation is preserved (PONYTAIL_DEFAULT_MODE is read at session start, so a restart is
 *  the only way to switch). Passes the pane's current HR state so routing is preserved. No
 *  failure path: env injection always succeeds; a missing plugin is gated by the UI. */
export async function setPanePonytail(paneId: string, cwd: string, sessionId: string, level: PonytailLevel, headroom: boolean): Promise<void> {
  const e = registry.get(paneId);
  if (!e) return;
  await killPty(paneId);
  e.term.write(`\r\n[switching ponytail → ${level}…]\r\n`);
  const engaged = await launchClaude(paneId, cwd, sessionId, true, { headroom, ponytail: level }, e.term.cols, e.term.rows);
  if (engaged) routed.add(paneId); else routed.delete(paneId);
}
```

- [ ] **Step 6: Typecheck** (consumers in Tasks 6–7 will satisfy the new signatures; this file alone should compile)

Run: `npx tsc --noEmit`
Expected: errors ONLY in `TerminalPane.tsx` / `PaneHost.tsx` (callers not yet updated). `terminalRegistry.ts` itself: no errors. (Those callers are fixed in Task 7; if you want a clean tsc now, do Tasks 6–7 then typecheck.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/terminalRegistry.ts
git commit -m "feat(ponytail): per-pane launch env + setPanePonytail relaunch"
```

---

### Task 6: PaneHeader — PT meter chip + dropdown + nudge

**Files:**
- Modify: `src/components/PaneHeader.tsx`
- Modify: `src/components/PaneHeader.css`

- [ ] **Step 1: Update imports + props in `PaneHeader.tsx`**

Change the React import (line 1) to include the hooks used by the dropdown:
```ts
import { useEffect, useRef, useState } from "react";
```
Add after the existing imports:
```ts
import { PONYTAIL_LEVELS, PONYTAIL_META, type PonytailLevel } from "../lib/ponytailClient";
```
Add to the `PaneHeader` props type (alongside `headroom`, `onToggleHeadroom`):
```ts
  ponytail: PonytailLevel;
  ponytailInstalled: boolean;
  onSetPonytail: (level: PonytailLevel) => void;
```
And add them to the destructured params list.

- [ ] **Step 2: Add dropdown state + click-outside + meter helper** (inside the component, after the existing `useState` lines)

```tsx
  const [ptOpen, setPtOpen] = useState(false);
  const ptWrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ptOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ptWrapRef.current && !ptWrapRef.current.contains(e.target as Node)) setPtOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ptOpen]);
  const meter = (fill: number) => (
    <span className="pane-head__pt-meter">{[0, 1, 2].map((i) => <i key={i} className={i < fill ? "on" : ""} />)}</span>
  );
```

- [ ] **Step 3: Add the PT control JSX** — place it right after the closing `</span>` of the existing `pane-head__hr-wrap`

```tsx
      <span className="pane-head__pt-wrap" ref={ptWrapRef}>
        <button
          className={`pane-head__pt lvl-${ponytail}${ponytailInstalled ? "" : " is-disabled"}`}
          onClick={() => setPtOpen((o) => !o)}
          title={ponytailInstalled ? `Ponytail level: ${ponytail}` : "ponytail plugin ยังไม่ลง"}
          aria-haspopup="menu"
          aria-expanded={ptOpen}
        >
          <span className="pane-head__pt-lbl">PT</span>
          {meter(PONYTAIL_META[ponytail].fill)}
          <span className="pane-head__pt-car">▾</span>
        </button>
        {ptOpen && ponytailInstalled && (
          <span className="pane-head__pt-menu" role="menu">
            {PONYTAIL_LEVELS.map((l) => (
              <button
                key={l}
                className={`pane-head__pt-item lvl-${l}${l === ponytail ? " is-sel" : ""}`}
                role="menuitemradio"
                aria-checked={l === ponytail}
                onClick={() => { setPtOpen(false); if (l !== ponytail) onSetPonytail(l); }}
              >
                <span className="pane-head__pt-item-top">{meter(PONYTAIL_META[l].fill)}<b>{l}</b></span>
                <span className="pane-head__pt-item-desc">{PONYTAIL_META[l].desc}</span>
              </button>
            ))}
          </span>
        )}
        {ptOpen && !ponytailInstalled && (
          <span className="pane-head__pt-menu pane-head__pt-nudge" role="dialog">
            <span className="pane-head__pt-nudge-h">ต้องลง ponytail plugin ก่อน</span>
            <code className="pane-head__pt-nudge-cmd">/plugin marketplace add DietrichGebert/ponytail</code>
            <code className="pane-head__pt-nudge-cmd">/plugin install ponytail@ponytail</code>
            <span className="pane-head__pt-nudge-foot">รันใน Claude Code แล้ว toggle ใหม่</span>
          </span>
        )}
      </span>
```

- [ ] **Step 4: Add styles to `src/components/PaneHeader.css`** (append)

```css
/* Ponytail level chip + dropdown */
.pane-head__pt-wrap { position: relative; display: inline-flex; }
.pane-head__pt { display: inline-flex; align-items: center; gap: 5px; font: 600 10px var(--ck-mono, ui-monospace, monospace);
  letter-spacing: .05em; color: var(--ck-muted); background: transparent; border: 1px solid var(--ck-border);
  border-radius: 999px; padding: 2px 7px; cursor: pointer; transition: .16s; }
.pane-head__pt:hover { color: var(--ck-text); }
.pane-head__pt.is-disabled { opacity: .45; }
.pane-head__pt-car { font-size: 8px; opacity: .6; }
.pane-head__pt-meter { display: inline-flex; gap: 2px; align-items: center; }
.pane-head__pt-meter i { width: 3px; height: 8px; border-radius: 1px; background: var(--ck-surface-2); }
.pane-head__pt-meter i.on { background: currentColor; }
.pane-head__pt.lvl-lite  { color: color-mix(in srgb, var(--ck-green) 75%, var(--ck-text)); border-color: color-mix(in srgb, var(--ck-green) 32%, transparent); background: color-mix(in srgb, var(--ck-green) 7%, transparent); }
.pane-head__pt.lvl-full  { color: var(--ck-green); border-color: color-mix(in srgb, var(--ck-green) 45%, transparent); background: color-mix(in srgb, var(--ck-green) 9%, transparent); }
.pane-head__pt.lvl-ultra { color: var(--ck-accent); border-color: color-mix(in srgb, var(--ck-accent) 50%, transparent); background: color-mix(in srgb, var(--ck-accent) 11%, transparent); }

.pane-head__pt-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 50;
  display: flex; flex-direction: column; gap: 2px; min-width: 220px; padding: 5px;
  background: var(--ck-surface-2); border: 1px solid var(--ck-border); border-radius: 8px;
  box-shadow: 0 10px 30px -10px rgba(0,0,0,.6); font: 11px var(--ck-mono, ui-monospace, Menlo, monospace); }
.pane-head__pt-item { display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  background: transparent; border: 0; border-radius: 6px; padding: 6px 8px; cursor: pointer; text-align: left; color: var(--ck-muted); }
.pane-head__pt-item:hover { background: color-mix(in srgb, var(--ck-text) 8%, transparent); }
.pane-head__pt-item.is-sel { background: color-mix(in srgb, var(--ck-green) 10%, transparent); }
.pane-head__pt-item-top { display: flex; align-items: center; gap: 7px; }
.pane-head__pt-item-top b { font-weight: 700; text-transform: uppercase; letter-spacing: .06em; font-size: 10px; }
.pane-head__pt-item-desc { color: var(--ck-dim); font-size: 10px; }
.pane-head__pt-item.lvl-lite  { color: color-mix(in srgb, var(--ck-green) 75%, var(--ck-text)); }
.pane-head__pt-item.lvl-full  { color: var(--ck-green); }
.pane-head__pt-item.lvl-ultra { color: var(--ck-accent); }

.pane-head__pt-nudge { gap: 5px; }
.pane-head__pt-nudge-h { color: var(--ck-bright); font-weight: 600; }
.pane-head__pt-nudge-cmd { display: block; background: var(--ck-bg); border: 1px solid var(--ck-border); border-radius: 5px;
  padding: 3px 6px; color: var(--ck-green); user-select: all; font-size: 10.5px; }
.pane-head__pt-nudge-foot { color: var(--ck-dim); font-size: 9.5px; }
```

- [ ] **Step 5: Commit** (typecheck happens in Task 7 once callers pass the new props)

```bash
git add src/components/PaneHeader.tsx src/components/PaneHeader.css
git commit -m "feat(ponytail): PaneHeader PT meter chip + level dropdown + install nudge"
```

---

### Task 7: Wire TerminalPane + PaneHost

**Files:**
- Modify: `src/components/TerminalPane.tsx`
- Modify: `src/components/PaneHost.tsx`

- [ ] **Step 1: `TerminalPane.tsx` — imports + props + install probe**

Add imports:
```ts
import { ponytailInstalled, type PonytailLevel } from "../lib/ponytailClient";
```
(Ensure `useState` and `useEffect` are imported — they already are.)

Add to the props type + destructure: `ponytail?: PonytailLevel;` and `onSetPonytail: (l: PonytailLevel) => void;`

Add install-probe state inside the component (near the `useState` for `state`):
```tsx
  const [ptInstalled, setPtInstalled] = useState(false);
  useEffect(() => { ponytailInstalled().then(setPtInstalled).catch(() => {}); }, []);
```

- [ ] **Step 2: `TerminalPane.tsx` — pass level to the terminal + header**

In the acquire effect, update the `acquireTerminal` call:
```tsx
    const entry = acquireTerminal(paneId, cwd, sessionId, !!resume, !!headroom, ponytail ?? "off");
```
In the `<PaneHeader ... />` JSX, add the three props (next to `headroom` / `onToggleHeadroom`):
```tsx
        ponytail={ponytail ?? "off"}
        ponytailInstalled={ptInstalled}
        onSetPonytail={onSetPonytail}
```

- [ ] **Step 3: `PaneHost.tsx` — imports**

Add `setPanePonytail` to the terminalRegistry import and import the level type:
```ts
import { setPaneHeadroom, setPanePonytail } from "../lib/terminalRegistry";
import type { PonytailLevel } from "../lib/ponytailClient";
```
(Adjust the existing `terminalRegistry` import line to include `setPanePonytail`.)

- [ ] **Step 4: `PaneHost.tsx` — pass level + handlers to `<TerminalPane />`**

Update the existing `onToggleHeadroom` handler to pass the pane's level:
```tsx
              onToggleHeadroom={() => {
                const next = !pane.headroom;
                dispatch({ type: "setHeadroom", paneId: pane.id, on: next });
                void setPaneHeadroom(pane.id, pane.cwd, pane.sessionId, next, pane.ponytail ?? "off").then((engaged) => {
                  if (next && !engaged) dispatch({ type: "setHeadroom", paneId: pane.id, on: false });
                });
              }}
```
Add the ponytail prop + handler (next to the headroom props on `<TerminalPane`):
```tsx
              ponytail={pane.ponytail ?? "off"}
              onSetPonytail={(level: PonytailLevel) => {
                dispatch({ type: "setPonytail", paneId: pane.id, level });
                void setPanePonytail(pane.id, pane.cwd, pane.sessionId, level, !!pane.headroom);
              }}
```

- [ ] **Step 5: Typecheck the whole frontend**

Run: `npx tsc --noEmit`
Expected: exit 0 (all callers now match the new signatures).

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalPane.tsx src/components/PaneHost.tsx
git commit -m "feat(ponytail): wire PT level through TerminalPane + PaneHost"
```

---

### Task 8: Domain language (CONTEXT.md)

**Files:**
- Modify: `CONTEXT.md`

- [ ] **Step 1: Add the entry** (after the **Savings** entry at the end of the language section)

```markdown

**Ponytail level**:
A per-[[Pane]] setting (`off`/`lite`/`full`/`ultra`) controlling how aggressively the Session's
Claude minimizes code, via the **ponytail** Claude Code plugin's injected ruleset. A distinct axis
from **Headroom routing** (where requests go) and **Savings** (tokens the proxy removed). Fixed at
Session start (the plugin reads `PONYTAIL_DEFAULT_MODE` once); switched by relaunch, like Headroom
routing. Shown as the **PT** chip in the Pane header. Default `off`; Cockpit's per-Pane level
overrides any global ponytail config.
_Avoid_: lazy mode, ponytail mode (say Ponytail level); never conflate with Headroom routing.
```

- [ ] **Step 2: Commit**

```bash
git add CONTEXT.md
git commit -m "docs(ponytail): add Ponytail level to the domain language"
```

---

### Task 9: Full verification

- [ ] **Step 1: TypeScript** — Run: `npx tsc --noEmit` — Expected: exit 0.
- [ ] **Step 2: Frontend tests** — Run: `npm test` — Expected: all pass (incl. `paneLaunchEnv` 4 + the new ponytail-level reducer/persistence tests).
- [ ] **Step 3: Rust** — Run: `cargo test --manifest-path src-tauri/Cargo.toml ponytail` then `cargo check --manifest-path src-tauri/Cargo.toml` — Expected: 3 ponytail tests pass; check Finished.
- [ ] **Step 4: Manual (run the app)** — `npm run tauri dev`. With the ponytail plugin **not** installed: the `PT` chip is dim; clicking shows the install nudge. (Optional, if you install the plugin and restart the pane: picking a level writes `[switching ponytail → <level>…]`, the pane relaunches via `--resume`, and the chip shows the meter for that level.) HR + PT toggled together both survive each other's relaunch.
- [ ] **Step 5: Final commit if any fixes were needed during verification.**

---

## Self-review

- **Spec coverage:** domain (Task 8), mechanism/env+relaunch (Tasks 2,5), state+persistence (Task 3), shared `paneLaunchEnv` merge incl. off-pinning (Task 2), detect+nudge (Tasks 4,6,7), intensity-meter UI (Task 6), testing seams — `paneLaunchEnv` (Task 2), `setPonytail`/persistence (Task 3), `has_ponytail` (Task 4) — all covered.
- **Out-of-scope** (no Savings readout, no slash-inject, no auto-install, statusline-flag clobber accepted) carried from the spec; nothing in the plan adds them.
- **Type consistency:** `PonytailLevel` defined once (Task 1) and imported everywhere; `paneLaunchEnv` signature matches its caller in `launchClaude` (Task 5); `setPaneHeadroom`'s new `ponytail` param matches the `PaneHost` call (Task 7); `setPanePonytail` signature matches the `PaneHost` handler (Task 7); `ponytail_installed` command name matches the `invoke` in `ponytailClient.ts` (Tasks 1,4).
