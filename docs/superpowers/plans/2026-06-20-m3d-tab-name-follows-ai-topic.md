# Claude Cockpit — M3d: Tab/pane name follows the AI topic

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A pane's name (and therefore its tab's name) auto-updates to reflect what the Claude session in that terminal is about — derived from the first natural-language user message in that cwd's newest Claude session log — until the user manually renames it (manual name then sticks).

**Why first-user-message (not summary):** Surveyed 99 real session logs → **0** contain `summary` entries, so we use the first substantive `user` message instead (skipping `<…>` command-wrappers and tool_results). It's near the top of the file, so reading is cheap.

**Architecture:** Rust command `pane_topic(cwd)` reads the newest `*.jsonl` for that cwd and returns the first user-message text (≤60 chars). Reducer gains `Pane.autoTitle` + `autoTitlePane` action; `renamePane` clears `autoTitle`. `TerminalPane` polls `pane_topic` every 6s and dispatches `autoTitlePane`. `TabBar` derives the tab label from the first pane's `title`.

**Tech Stack:** Rust (serde_json — already a dep) · React/TS · vitest + cargo test

**Known caveats (document, don't fix in v1):** panes sharing a cwd resolve to the same newest log → same topic; a freshly-opened pane shows the *previous* session's topic until a new `claude` run writes a newer log.

---

## Task 1: Rust `pane_topic` command (+ test)

**Files:** modify `src-tauri/src/logtail.rs`, `src-tauri/src/lib.rs`.

- [ ] **Step 1 — add a testable parser + command to `logtail.rs`** (after `newest_session_file`):
```rust
/// Collapse whitespace to single spaces and cap at 60 chars (… suffix if cut).
fn truncate_topic(s: &str) -> String {
    let one_line = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let max = 60;
    if one_line.chars().count() <= max {
        one_line
    } else {
        let mut out: String = one_line.chars().take(max).collect();
        out.push('…');
        out
    }
}

/// First natural-language user message in a session log, or None.
/// Skips `<…>` command-wrappers, tool_results, and blanks.
pub fn first_user_topic(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        let content = v.get("message").and_then(|m| m.get("content"));
        let text = match content {
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            Some(serde_json::Value::Array(arr)) => arr.iter().find_map(|b| {
                if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                    b.get("text").and_then(|t| t.as_str()).map(str::to_string)
                } else {
                    None
                }
            }),
            _ => None,
        };
        if let Some(t) = text {
            let t = t.trim();
            if t.is_empty() || t.starts_with('<') {
                continue;
            }
            return Some(truncate_topic(t));
        }
    }
    None
}

#[tauri::command]
pub fn pane_topic(cwd: String) -> Option<String> {
    let home = dirs_home()?;
    let path = newest_session_file(&project_log_dir(&home, &cwd))?;
    first_user_topic(&path)
}
```

- [ ] **Step 2 — test** (add to the `#[cfg(test)] mod tests` block):
```rust
    #[test]
    fn first_user_topic_skips_wrappers_and_collapses_ws() {
        let dir = std::env::temp_dir().join(format!("cockpit-topic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let content = concat!(
            "{\"type\":\"summary\",\"summary\":\"ignore me\"}\n",
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"<local-command-caveat>skip\"}]}}\n",
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"  Fix the   crypto\\n pricing bug  \"}}\n"
        );
        std::fs::write(&path, content).unwrap();
        assert_eq!(first_user_topic(&path).as_deref(), Some("Fix the crypto pricing bug"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn first_user_topic_truncates_long_text() {
        let dir = std::env::temp_dir().join(format!("cockpit-topic2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let long = "a ".repeat(80);
        std::fs::write(&path, format!("{{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"{}\"}}}}\n", long)).unwrap();
        let got = first_user_topic(&path).unwrap();
        assert!(got.ends_with('…'));
        assert_eq!(got.chars().count(), 61); // 60 + ellipsis
        std::fs::remove_dir_all(&dir).ok();
    }
```

- [ ] **Step 3 — register the command** in `src-tauri/src/lib.rs` `generate_handler!`: add `logtail::pane_topic,` to the macro list (after `logtail::logtail_stop`).

- [ ] **Step 4 — verify & commit**: `cd src-tauri && cargo test` → all pass (incl. 2 new). `cargo build` clean.
  - **Commit on `main`, NO AI/Claude attribution, NO Co-Authored-By**: `feat(core): pane_topic command — first user message of newest session log`

---

## Task 2: reducer — `autoTitle` + `autoTitlePane` (TDD)

**Files:** modify `src/layout/paneLayout.ts`, `src/layout/paneLayout.test.ts`.

- [ ] **Step 1 — failing tests** (append inside the existing `describe`):
```ts
  it("autoTitlePane updates the title while auto-naming is on", () => {
    let l = initLayout(CWD);
    const id = l.focusedPaneId;
    l = reduce(l, { type: "autoTitlePane", paneId: id, title: "fix crypto bug" });
    expect(l.tabs[0].rows[0].panes[0].title).toBe("fix crypto bug");
  });
  it("a manual renamePane stops further auto-naming", () => {
    let l = initLayout(CWD);
    const id = l.focusedPaneId;
    l = reduce(l, { type: "renamePane", paneId: id, title: "frontend" });
    l = reduce(l, { type: "autoTitlePane", paneId: id, title: "should be ignored" });
    expect(l.tabs[0].rows[0].panes[0].title).toBe("frontend");
  });
```

- [ ] **Step 2** — `npm run test` → 2 new fail.

- [ ] **Step 3 — implement**:
  - Add `autoTitle: boolean` to the `Pane` interface.
  - `makePane`: add `autoTitle: true`.
  - Extend `Action` union: `| { type: "autoTitlePane"; paneId: string; title: string }`.
  - In the `renamePane` case, when mapping the matched pane set BOTH fields: `{ ...p, title: a.title, autoTitle: false }`.
  - Add a new case mirroring `renamePane` but guarded:
```ts
    case "autoTitlePane": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) => ({
          ...r,
          panes: r.panes.map((p) =>
            p.id === a.paneId && p.autoTitle ? { ...p, title: a.title } : p,
          ),
        })),
      }));
      return { ...l, tabs };
    }
```

- [ ] **Step 4** — `npm run test` → all pass; `npx tsc --noEmit` clean.
  - **Commit (same attribution rule)**: `feat(layout): autoTitle flag + autoTitlePane action`

---

## Task 3: frontend wiring — poll topic, dispatch, show on tab

**Files:** modify `src/lib/logClient.ts`, `src/components/TerminalPane.tsx`, `src/components/TabPanes.tsx`, `src/components/TabBar.tsx`.

- [ ] **Step 1 — `logClient.ts`**: add
```ts
export function paneTopic(cwd: string): Promise<string | null> {
  return invoke("pane_topic", { cwd });
}
```
(`invoke` is already imported there; if not, `import { invoke } from "@tauri-apps/api/core";`.)

- [ ] **Step 2 — `TerminalPane.tsx`**: add prop `onAutoTitle: (title: string) => void;` to the props type. Keep `onAutoTitle` fresh via a ref so the poll effect doesn't resubscribe each render. Add `import { paneTopic } from "../lib/logClient";` and, near the other refs:
```tsx
  const onAutoTitleRef = useRef(onAutoTitle);
  onAutoTitleRef.current = onAutoTitle;
```
Add a SECOND `useEffect` (separate from the PTY effect), keyed on `[cwd]`:
```tsx
  useEffect(() => {
    let alive = true;
    let last = "";
    const poll = async () => {
      try {
        const t = await paneTopic(cwd);
        if (alive && t && t !== last) {
          last = t;
          onAutoTitleRef.current(t);
        }
      } catch {
        /* not running under Tauri / no log yet — ignore */
      }
    };
    const first = setTimeout(poll, 1200);
    const id = setInterval(poll, 6000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [cwd]);
```

- [ ] **Step 3 — `TabPanes.tsx`**: on the `<TerminalPane>` element add
```tsx
              onAutoTitle={(t) => dispatch({ type: "autoTitlePane", paneId: p.id, title: t })}
```
(keep all existing props incl. `dragProps`).

- [ ] **Step 4 — `TabBar.tsx`**: replace `tabTitle` so the label comes from the first pane's `title` (which now auto-follows the topic):
```ts
function tabTitle(t: Tab): string {
  const panes = t.rows.flatMap((r) => r.panes);
  const base = panes[0]?.title || "shell";
  const name = base.length > 28 ? base.slice(0, 28) + "…" : base;
  return panes.length > 1 ? `${name} · ${panes.length}` : name;
}
```

- [ ] **Step 5** — `npx tsc --noEmit` clean; `npm run test` green (19+2 = 21). Do NOT run `npm run tauri dev`.
  - **Commit (same attribution rule)**: `feat(ui): tab + pane name follow the AI topic from the session log`

---

## Task 4: GUI verification (owner)

- [ ] `npm run tauri dev`:
1. Open a pane in a repo, run `claude`, type a first prompt like "fix the login bug". Within ~6s the **pane header name** and the **tab label** change from the folder name to "fix the login bug" (≤60 chars, whitespace collapsed).
2. Double-click the header name → rename to "frontend". The auto-naming **stops** — it stays "frontend" even as you keep chatting.
3. A second pane in a different repo gets its own topic independently. Tab with >1 pane shows `topic · N`.
4. Regressions: resize works; pop-out ↗; drag-to-reposition; working/idle; Cmd+T/D/Shift+D/W.

Report pass/fail.

- [ ] **Wrap-up**: update `SPEC.md`; commit `docs: M3d done — name follows AI topic`.

---

## Self-review
**Spec coverage:** topic source = first user message of newest log (Task 1); auto-update + manual-override (Task 2); poll + wire to tab/header (Task 3). Rust + reducer TDD'd; UI owner-verified.
**Placeholder scan:** none — every step has concrete code.
**Type/name consistency:** `pane_topic`/`paneTopic` (Rust cmd ↔ client), `autoTitlePane`/`autoTitle` (action ↔ field) consistent across reducer, TerminalPane, TabPanes. `first_user_topic` factored out so it's unit-testable without `HOME`.
**Caveats:** shared-cwd panes share a topic; fresh pane shows previous session's topic until a newer log exists (documented above).
