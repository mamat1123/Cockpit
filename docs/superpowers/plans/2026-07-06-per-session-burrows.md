# Per-Session Burrows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every fresh Session (new tab / split) runs in its own git worktree ("Burrow") on an animal-named branch ("Codename") cut off the Project's default branch; removed on close.

**Architecture:** A new Rust module `worktree.rs` shells out to `git` (reusing the `handoff.rs` subprocess pattern) to create/remove/inspect Burrows and to canonicalize a Burrow path back to its parent Project. The React reducer stays pure — `CockpitView` performs the async `create_burrow` *before* dispatching the create action and passes the resolved worktree path in. Cost/Project aggregation rolls Burrow cwds up to their parent Project. A Settings toggle (default ON) gates the feature.

**Tech Stack:** Tauri 2 (Rust), React 19 + TypeScript, Vitest (frontend unit), `cargo test` (Rust unit), git CLI (no git crate).

## Global Constraints

- Design of record: `docs/superpowers/specs/2026-07-06-per-session-burrows-design.md`; decision: `docs/adr/0011-per-session-burrows.md`; glossary: `CONTEXT.md` (**Burrow**, **Codename**, **Project**).
- Burrow location is always `<project-root>/.worktrees/<codename>` (already in `.gitignore`).
- Default branch resolution order: `origin/HEAD` → `main` → `master` → current `HEAD`.
- git is invoked via `std::process::Command::new("git")` — NO git crate is added to `Cargo.toml`.
- macOS-only app; POSIX absolute paths; the path separator is `/`.
- Frontend unit tests: `npx vitest run <file>`. Rust unit tests: `cargo test --manifest-path src-tauri/Cargo.toml <name>`.
- Commit style: Conventional Commits, committed directly to `main` (repo convention). End each commit message with the Co-Authored-By trailer used in `94b21b9`.
- The reducer `reduce()` in `src/layout/paneLayout.ts` MUST remain pure (no I/O, no git, no async).

---

### Task 1: Rust `worktree.rs` — module + git commands

**Files:**
- Create: `src-tauri/src/worktree.rs`
- Modify: `src-tauri/src/lib.rs:1-12` (add `mod worktree;`) and `src-tauri/src/lib.rs:106-135` (register commands)

**Interfaces:**
- Produces (plain fn): `pub fn project_root_of(cwd: &str) -> String` — strips a `/.worktrees/<seg>[/…]` suffix back to the Project root; returns `cwd` unchanged if it contains no `/.worktrees/`.
- Produces (commands):
  - `create_burrow(project_cwd: String) -> Result<Burrow, String>` where `Burrow { path, branch, codename, emoji }` (all `String`, serialized camelCase).
  - `remove_burrow(path: String, branch: String, force: bool) -> Result<(), String>`
  - `burrow_dirty(path: String) -> Result<DirtyState, String>` where `DirtyState { uncommitted: bool, unpushed: bool }` (camelCase).

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/worktree.rs` with ONLY the pure helpers under test plus a `tests` module:

```rust
/// Curated Codename pool: (animal, emoji). Single lowercase words.
const ANIMALS: &[(&str, &str)] = &[
    ("otter", "🦦"), ("panda", "🐼"), ("fox", "🦊"), ("lynx", "🐆"),
    ("heron", "🪶"), ("koala", "🐨"), ("gecko", "🦎"), ("moth", "🦋"),
    ("wren", "🐦"), ("bison", "🦬"), ("seal", "🦭"), ("crane", "🕊"),
    ("ibex", "🐐"), ("marten", "🦡"), ("quokka", "🐹"), ("tapir", "🐗"),
];

/// The Project root a cwd belongs to: strip a `/.worktrees/<name>[/…]` suffix.
pub fn project_root_of(cwd: &str) -> String {
    match cwd.find("/.worktrees/") {
        Some(idx) => cwd[..idx].to_string(),
        None => cwd.to_string(),
    }
}

/// First Codename in ANIMALS (offset by `start`) whose name is not in `taken`;
/// if all are taken, the first name suffixed `-2`, `-3`, … until free.
fn pick_codename(taken: &std::collections::HashSet<String>, start: usize) -> (String, String) {
    let n = ANIMALS.len();
    for i in 0..n {
        let (name, emoji) = ANIMALS[(start + i) % n];
        if !taken.contains(name) {
            return (name.to_string(), emoji.to_string());
        }
    }
    let (base, emoji) = ANIMALS[start % n];
    let mut k = 2;
    loop {
        let cand = format!("{base}-{k}");
        if !taken.contains(&cand) {
            return (cand, emoji.to_string());
        }
        k += 1;
    }
}

/// Parse `git symbolic-ref` / branch-probe output into a default branch name.
/// Accepts `origin/main` (strips the remote) or a bare `main`.
fn default_from_symbolic(sym: &str) -> Option<String> {
    let t = sym.trim();
    if t.is_empty() || t.contains("fatal") { return None; }
    Some(t.rsplit('/').next().unwrap_or(t).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn root_strips_worktree_suffix() {
        assert_eq!(project_root_of("/Users/me/Cockpit/.worktrees/otter"), "/Users/me/Cockpit");
        assert_eq!(project_root_of("/Users/me/Cockpit/.worktrees/otter/src/x"), "/Users/me/Cockpit");
        assert_eq!(project_root_of("/Users/me/Cockpit"), "/Users/me/Cockpit");
    }

    #[test]
    fn codename_skips_taken_and_suffixes() {
        let taken: HashSet<String> = ["otter", "panda"].iter().map(|s| s.to_string()).collect();
        let (name, _) = pick_codename(&taken, 0);
        assert_eq!(name, "fox"); // otter+panda taken, next in order

        let all: HashSet<String> = ANIMALS.iter().map(|(n, _)| n.to_string()).collect();
        let (name2, _) = pick_codename(&all, 0);
        assert_eq!(name2, "otter-2"); // pool exhausted → suffix from ANIMALS[0]
    }

    #[test]
    fn default_branch_parsing() {
        assert_eq!(default_from_symbolic("origin/main"), Some("main".to_string()));
        assert_eq!(default_from_symbolic("master\n"), Some("master".to_string()));
        assert_eq!(default_from_symbolic("fatal: no such ref"), None);
        assert_eq!(default_from_symbolic(""), None);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml worktree`
Expected: FAIL — `worktree.rs` is not yet a module (`mod worktree;` missing), so it does not compile / tests not found.

- [ ] **Step 3: Wire the module and add the git-backed commands**

In `src-tauri/src/lib.rs`, add after line 12 (`mod handoff;`):

```rust
mod worktree;
```

Register in the `invoke_handler!` list (after `handoff::create_claude_handoff,` at line 134):

```rust
            worktree::create_burrow,
            worktree::remove_burrow,
            worktree::burrow_dirty,
```

Append to `src-tauri/src/worktree.rs` (below the `tests` module is fine; keep `#[cfg(test)]` last by inserting these ABOVE it):

```rust
use serde::Serialize;
use std::collections::HashSet;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Burrow { pub path: String, pub branch: String, pub codename: String, pub emoji: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyState { pub uncommitted: bool, pub unpushed: bool }

/// Run git in `cwd`; Ok(stdout) on success, Err(stderr) on failure.
fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git").args(args).current_dir(cwd).output()
        .map_err(|e| format!("git unavailable: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned().trim().to_string())
    }
}

/// The Project's default branch, tried in order: origin/HEAD, main, master, current HEAD.
fn default_branch(root: &str) -> String {
    if let Ok(s) = git(root, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) {
        if let Some(b) = default_from_symbolic(&s) { return b; }
    }
    for cand in ["main", "master"] {
        if git(root, &["rev-parse", "--verify", "--quiet", cand]).is_ok() {
            return cand.to_string();
        }
    }
    git(root, &["rev-parse", "--abbrev-ref", "HEAD"]).map(|s| s.trim().to_string()).unwrap_or_else(|_| "HEAD".to_string())
}

/// Existing branch names + `.worktrees/<name>` dirs under `root`, so a Codename never collides.
fn taken_names(root: &str) -> HashSet<String> {
    let mut set = HashSet::new();
    if let Ok(out) = git(root, &["for-each-ref", "--format=%(refname:short)", "refs/heads"]) {
        for line in out.lines() { let l = line.trim(); if !l.is_empty() { set.insert(l.to_string()); } }
    }
    if let Ok(rd) = std::fs::read_dir(std::path::Path::new(root).join(".worktrees")) {
        for e in rd.flatten() {
            if let Some(name) = e.file_name().to_str() { set.insert(name.to_string()); }
        }
    }
    set
}

/// Vary the Codename start index without a rand dep: nanos since epoch mod pool size.
fn start_offset() -> usize {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as usize).unwrap_or(0) % ANIMALS.len()
}

/// Create a Burrow: a worktree at `<root>/.worktrees/<codename>` on a new branch
/// `<codename>` cut off the default branch. `project_cwd` may itself be inside a Burrow.
#[tauri::command]
pub fn create_burrow(project_cwd: String) -> Result<Burrow, String> {
    let toplevel = git(&project_cwd, &["rev-parse", "--show-toplevel"])?.trim().to_string();
    if toplevel.is_empty() { return Err("not a git repository".into()); }
    let root = project_root_of(&toplevel);
    let base = default_branch(&root);
    let (codename, emoji) = pick_codename(&taken_names(&root), start_offset());
    let path = format!("{root}/.worktrees/{codename}");
    git(&root, &["worktree", "add", "-b", &codename, &path, &base])?;
    Ok(Burrow { path, branch: codename.clone(), codename, emoji })
}

/// Remove a Burrow's worktree and delete its branch (best-effort).
#[tauri::command]
pub fn remove_burrow(path: String, branch: String, force: bool) -> Result<(), String> {
    let root = project_root_of(&path);
    let mut args = vec!["worktree", "remove"];
    if force { args.push("--force"); }
    args.push(&path);
    git(&root, &args)?;
    let _ = git(&root, &["branch", "-D", &branch]); // branch delete is best-effort
    Ok(())
}

/// Whether a Burrow has uncommitted changes and/or commits not on the default branch.
#[tauri::command]
pub fn burrow_dirty(path: String) -> Result<DirtyState, String> {
    let uncommitted = !git(&path, &["status", "--porcelain"])?.trim().is_empty();
    let root = project_root_of(&path);
    let base = default_branch(&root);
    let ahead = git(&path, &["rev-list", "--count", &format!("{base}..HEAD")])
        .ok().and_then(|s| s.trim().parse::<u32>().ok()).unwrap_or(0);
    Ok(DirtyState { uncommitted, unpushed: ahead > 0 })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml worktree`
Expected: PASS (3 tests). Also run `cargo build --manifest-path src-tauri/Cargo.toml` — Expected: compiles (commands registered).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/worktree.rs src-tauri/src/lib.rs
git commit -m "feat(burrows): worktree.rs — create/remove/dirty commands + project_root_of

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Rust — roll Burrow cwds up to the parent Project in Cost/Project

**Files:**
- Modify: `src-tauri/src/cost.rs` (`list_projects` ~`266-292`, `cost_report` project keying ~`204-210`)
- Test: `src-tauri/src/cost.rs` `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: `crate::worktree::project_root_of` (Task 1).
- Effect: `list_projects` and `cost_report` group by `project_root_of(cwd)` so Burrows aggregate to their repo and Codenames never appear as separate Projects.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/cost.rs`:

```rust
    #[test]
    fn label_rolls_burrow_up_to_project() {
        // A Burrow cwd must label as its parent Project, not the Codename.
        let cwd = "/Users/me/Cockpit/.worktrees/otter";
        assert_eq!(label_from_cwd(&crate::worktree::project_root_of(cwd)), "Personal/Cockpit".rsplit('/').next().map(|_| "Cockpit".to_string()).unwrap());
    }
```

Note: `label_from_cwd` returns the last one-or-two path segments; for `/Users/me/Cockpit` that is `me/Cockpit`. Adjust the expected value to match `label_from_cwd`'s two-segment rule:

```rust
    #[test]
    fn label_rolls_burrow_up_to_project() {
        let cwd = "/Users/me/Cockpit/.worktrees/otter";
        let root = crate::worktree::project_root_of(cwd);
        assert_eq!(root, "/Users/me/Cockpit");
        assert_eq!(label_from_cwd(&root), "me/Cockpit");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml label_rolls_burrow_up`
Expected: FAIL — `crate::worktree::project_root_of` compiles (Task 1) but the roll-up is not yet applied in the report/list paths this test guards against regressions for; if `project_root_of` is missing it fails to compile. (If Task 1 is done, this test passes immediately for the helper — its purpose is to lock the contract; proceed to wire the call sites in Step 3.)

- [ ] **Step 3: Apply the roll-up at both call sites**

In `cost_report` (`src-tauri/src/cost.rs`), where the project label is computed (~line 204-208), wrap the cwd:

```rust
                let (cwd_opt, title_opt) = first_meta(&p);
                let cwd = cwd_opt.unwrap_or_default();
                let project = if cwd.is_empty() {
                    dpath.file_name().and_then(|s| s.to_str()).unwrap_or("—").to_string()
                } else { label_from_cwd(&crate::worktree::project_root_of(&cwd)) };
```

In `list_projects` (`src-tauri/src/cost.rs`), where each recorded cwd is pushed (~line 284-287), canonicalize before dedupe so Codenames collapse into one Project row:

```rust
            if let (Some(cwd), _) = first_meta(&path) {
                let cwd = crate::worktree::project_root_of(&cwd);
                let ms = mtime.duration_since(std::time::UNIX_EPOCH).map(|x| x.as_millis() as u64).unwrap_or(0);
                rows.push((cwd, ms));
            }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (existing cost tests + the new roll-up test).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cost.rs
git commit -m "feat(burrows): roll Burrow cwds up to parent Project in cost + picker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rust — pty_spawn falls back to the Project root when a Burrow is gone

**Files:**
- Modify: `src-tauri/src/pty.rs:74` (fallback before spawn)
- Test: `src-tauri/src/pty.rs` `tests`

**Interfaces:**
- Consumes: `crate::worktree::project_root_of`, existing `validate_cwd`.
- Effect: if the requested `cwd` does not validate but its `project_root_of` does, `pty_spawn` spawns there instead (resume-after-delete lands in the repo). Silent fallback (no toast in v1).

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/pty.rs` `tests`:

```rust
    #[test]
    fn resolve_falls_back_to_project_root() {
        // A missing Burrow path resolves to its (existing) parent project dir.
        let tmp = std::env::temp_dir();
        let root = tmp.to_string_lossy().into_owned();
        let gone = format!("{root}/.worktrees/otter"); // does not exist
        assert_eq!(resolve_spawn_cwd(&gone), root);
        // An existing path is returned canonicalized (unchanged parent).
        assert!(resolve_spawn_cwd(&root).len() > 0);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml resolve_falls_back`
Expected: FAIL — `resolve_spawn_cwd` is not defined.

- [ ] **Step 3: Add `resolve_spawn_cwd` and use it in `pty_spawn`**

Add near `validate_cwd` in `src-tauri/src/pty.rs`:

```rust
/// The cwd to actually spawn in: the requested path if it validates, else its
/// parent Project root (a removed Burrow → resume in the repo), else the request
/// unchanged (let the normal validate error surface).
pub fn resolve_spawn_cwd(cwd: &str) -> String {
    if validate_cwd(cwd).is_ok() { return cwd.to_string(); }
    let root = crate::worktree::project_root_of(cwd);
    if root != cwd && validate_cwd(&root).is_ok() { return root; }
    cwd.to_string()
}
```

In `pty_spawn`, replace line 74 (`let cwd = validate_cwd(&cwd)?;`) with:

```rust
    let cwd = validate_cwd(&resolve_spawn_cwd(&cwd))?;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml resolve_falls_back`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "feat(burrows): pty_spawn falls back to Project root for a removed Burrow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Frontend — `worktreeClient.ts`

**Files:**
- Create: `src/lib/worktreeClient.ts`

**Interfaces:**
- Produces: `Burrow`, `DirtyState` types; `createBurrow(projectCwd)`, `removeBurrow(path, branch, force)`, `burrowDirty(path)`.

- [ ] **Step 1: Write the client (thin invoke wrappers — no unit test; mirrors `ptyClient.ts`)**

Create `src/lib/worktreeClient.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export interface Burrow { path: string; branch: string; codename: string; emoji: string }
export interface DirtyState { uncommitted: boolean; unpushed: boolean }

/** Create a git worktree ("Burrow") for `projectCwd`; rejects if not a git repo. */
export function createBurrow(projectCwd: string): Promise<Burrow> {
  return invoke<Burrow>("create_burrow", { projectCwd });
}
export function removeBurrow(path: string, branch: string, force: boolean): Promise<void> {
  return invoke("remove_burrow", { path, branch, force });
}
export function burrowDirty(path: string): Promise<DirtyState> {
  return invoke<DirtyState>("burrow_dirty", { path });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/worktreeClient.ts
git commit -m "feat(burrows): worktreeClient (create/remove/dirty invoke wrappers)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Frontend — pane model + reducer carry the Burrow

**Files:**
- Modify: `src/layout/paneLayout.ts` (Pane `:5-19`, SavedPane `:24`, actions `:29-52`, `makePane`/`makeRow` `:57-58`, `newTab`/`split`/`splitDown` `:154-194`, `serializeLayout` `:79-97`, `deserializeLayout` `:105-124`)
- Test: `src/layout/paneLayout.test.ts`

**Interfaces:**
- Consumes: `Burrow` shape from Task 4 (redeclared locally as `BurrowInfo` to keep the layout module dependency-free).
- Produces: `Pane` gains `codename?`, `emoji?`, `burrowBranch?`, `isBurrow?`. Actions `newTab`/`split`/`splitDown` gain optional `burrow?: BurrowInfo`. A Burrow pane's `title` is `"<emoji> <codename>"` with `autoTitle: false`.

- [ ] **Step 1: Write the failing tests**

Add to `src/layout/paneLayout.test.ts`:

```ts
import { reduce, initLayout, serializeLayout, deserializeLayout, type BurrowInfo } from "./paneLayout";

const BURROW: BurrowInfo = { path: "/repo/.worktrees/otter", branch: "otter", codename: "otter", emoji: "🦦" };

describe("burrow panes", () => {
  it("newTab with a burrow spawns in the worktree path and titles as emoji+codename", () => {
    const l = reduce(initLayout("/repo"), { type: "newTab", cwd: "/repo", provider: "claude", burrow: BURROW });
    const pane = l.tabs[l.tabs.length - 1].rows[0].panes[0];
    expect(pane.cwd).toBe("/repo/.worktrees/otter");
    expect(pane.title).toBe("🦦 otter");
    expect(pane.autoTitle).toBe(false);
    expect(pane.isBurrow).toBe(true);
    expect(pane.burrowBranch).toBe("otter");
  });

  it("split with a burrow ignores the inherited cwd and uses the worktree", () => {
    const base = initLayout("/repo/.worktrees/panda");
    const l = reduce(base, { type: "split", provider: "claude", burrow: BURROW });
    const pane = l.tabs[0].rows[0].panes.find((p) => p.id === l.focusedPaneId)!;
    expect(pane.cwd).toBe("/repo/.worktrees/otter");
    expect(pane.isBurrow).toBe(true);
  });

  it("serialize→deserialize round-trips burrow fields", () => {
    const l = reduce(initLayout("/repo"), { type: "newTab", cwd: "/repo", burrow: BURROW });
    const back = deserializeLayout(serializeLayout(l, true));
    const pane = back.tabs[back.tabs.length - 1].rows[0].panes[0];
    expect(pane.isBurrow).toBe(true);
    expect(pane.codename).toBe("otter");
    expect(pane.emoji).toBe("🦦");
    expect(pane.burrowBranch).toBe("otter");
    expect(pane.title).toBe("🦦 otter");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/layout/paneLayout.test.ts`
Expected: FAIL — `BurrowInfo` export missing; `burrow` not accepted on actions.

- [ ] **Step 3: Implement the model + reducer changes**

In `src/layout/paneLayout.ts`:

Add to the `Pane` interface (after `provider?`):
```ts
  codename?: string;
  emoji?: string;
  burrowBranch?: string;
  isBurrow?: boolean;
```

Add to the `SavedPane` type (append fields before the closing `}`):
```ts
export interface SavedPane { cwd: string; title: string; autoTitle: boolean; size: number; sessionId?: string; headroom?: boolean; ponytail?: PonytailLevel; provider?: AgentProvider; handoffFromSessionId?: string; codename?: string; emoji?: string; burrowBranch?: string; isBurrow?: boolean }
```

Add the shared type near the top (after `AgentProvider`):
```ts
export interface BurrowInfo { path: string; branch: string; codename: string; emoji: string }
```

Add `burrow?` to the three create actions:
```ts
  | { type: "newTab"; cwd?: string; provider?: AgentProvider; burrow?: BurrowInfo }
  | { type: "split"; provider?: AgentProvider; burrow?: BurrowInfo }
  | { type: "splitDown"; provider?: AgentProvider; burrow?: BurrowInfo }
```

Replace `makePane` / `makeRow` (`:57-58`):
```ts
const makePane = (cwd: string, provider?: AgentProvider, burrow?: BurrowInfo): Pane => burrow
  ? { id: nextId("pane"), cwd: burrow.path, size: 1, title: `${burrow.emoji} ${burrow.codename}`, autoTitle: false, sessionId: crypto.randomUUID(), provider, codename: burrow.codename, emoji: burrow.emoji, burrowBranch: burrow.branch, isBurrow: true }
  : { id: nextId("pane"), cwd, size: 1, title: defaultTitle(cwd), autoTitle: true, sessionId: crypto.randomUUID(), provider };
const makeRow = (cwd: string, provider?: AgentProvider, burrow?: BurrowInfo): Row => ({ id: nextId("row"), panes: [makePane(cwd, provider, burrow)], size: 1 });
```

In the `newTab` case (`:154-163`), thread the burrow (its path wins as cwd):
```ts
    case "newTab": {
      const cwd = a.burrow?.path ?? a.cwd ?? focusedCwd(l);
      if (!cwd) return l;
      const row = makeRow(cwd, a.provider, a.burrow);
      const tab: Tab = { id: nextId("tab"), rows: [row] };
      return { tabs: [...l.tabs, tab], activeTabId: tab.id, focusedPaneId: row.panes[0].id };
    }
```

In `split` (`:164-181`), replace the `makePane` line:
```ts
      const pane = makePane(a.burrow?.path ?? focusedCwd(l), a.provider, a.burrow);
```

In `splitDown` (`:182-194`), replace the `makeRow` line:
```ts
      const row = makeRow(a.burrow?.path ?? focusedCwd(l), a.provider, a.burrow);
```

In `serializeLayout` (`:86-92`), persist the new fields (add inside the pane map object):
```ts
          ...(p.isBurrow ? { isBurrow: true, codename: p.codename, emoji: p.emoji, burrowBranch: p.burrowBranch } : {}),
```

In `deserializeLayout` (`:111-118`), restore them:
```ts
        codename: p.codename,
        emoji: p.emoji,
        burrowBranch: p.burrowBranch,
        isBurrow: !!p.isBurrow,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/layout/paneLayout.test.ts`
Expected: PASS (new burrow tests + all existing reducer tests).

- [ ] **Step 5: Commit**

```bash
git add src/layout/paneLayout.ts src/layout/paneLayout.test.ts
git commit -m "feat(burrows): pane model + reducer carry Burrow (path/codename/emoji/branch)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend — Settings toggle "New Session in its own Burrow"

**Files:**
- Modify: `src/lib/settings.ts` (`Settings` `:12-27`, `DEFAULT_SETTINGS` `:29`, `loadSettings` `:36-45`)
- Modify: `src/components/SettingsMenu.tsx` (add a toggle row near the Tab bar row, ~line 193)
- Test: `src/lib/settings.test.ts` (create)

**Interfaces:**
- Produces: `Settings.burrows: boolean` (default `true`), read by `CockpitView` in Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/lib/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, DEFAULT_SETTINGS } from "./settings";

beforeEach(() => localStorage.clear());

describe("settings.burrows", () => {
  it("defaults to true", () => {
    expect(DEFAULT_SETTINGS.burrows).toBe(true);
    expect(loadSettings().burrows).toBe(true);
  });
  it("backfills true for a saved payload that predates the field", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ themeId: "amber-hud" }));
    expect(loadSettings().burrows).toBe(true);
  });
  it("preserves an explicit false", () => {
    localStorage.setItem("cockpit.settings.v1", JSON.stringify({ burrows: false }));
    expect(loadSettings().burrows).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/settings.test.ts`
Expected: FAIL — `burrows` is not on `Settings`/`DEFAULT_SETTINGS`.

- [ ] **Step 3: Add the field**

In `src/lib/settings.ts`, add to the `Settings` interface (after `tabBar`):
```ts
  /** Create a git worktree ("Burrow") per new Session. See ADR 0011. */
  burrows: boolean;
```

Add to `DEFAULT_SETTINGS` (append before the closing brace):
```ts
, burrows: true
```

Add to the object returned inside `loadSettings` (after the `tabBar:` line):
```ts
        burrows: typeof m.burrows === "boolean" ? m.burrows : true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the toggle UI**

In `src/components/SettingsMenu.tsx`, after the Tab bar `settings__row` block (closes ~line 210, just before the notifications section), add a toggle row mirroring the notification-toggle markup at lines 264-268:

```tsx
          <div className="settings__row">
            <span className="settings__name">New Session in its own Burrow</span>
            <label className="settings__switch">
              <input className="settings__toggle" type="checkbox" checked={settings.burrows}
                onChange={(e) => onPatch({ burrows: e.target.checked })} />
            </label>
          </div>
```

(Match the exact wrapper classes used by the neighbouring rows; if the notification rows wrap the `<input>` differently, copy that wrapper verbatim so the switch styles apply.)

- [ ] **Step 6: Typecheck + verify toggle renders**

Run: `npx tsc --noEmit -p tsconfig.json` — Expected: no errors.
Run: `npm run dev`, open Settings (⌘,), confirm the "New Session in its own Burrow" toggle appears, defaults ON, and flipping it persists across reload (localStorage `cockpit.settings.v1` shows `"burrows":false`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/settings.ts src/lib/settings.test.ts src/components/SettingsMenu.tsx
git commit -m "feat(burrows): Settings toggle 'New Session in its own Burrow' (default on)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Frontend — create the Burrow before dispatching a new Session

**Files:**
- Modify: `src/components/CockpitView.tsx` (imports; the `ProviderPicker` `onPick` `:269-276`)

**Interfaces:**
- Consumes: `createBurrow` (Task 4), `Settings.burrows` (Task 6), reducer `burrow?` (Task 5).
- Effect: when the toggle is ON and the target folder is a git repo, `create_burrow` runs before dispatch and the pane opens in the worktree; on any error (non-git, git failure) it falls back to the original cwd (pre-feature behavior). Handoff / pop-out / resume paths are untouched (no `burrow` passed → no Burrow).

- [ ] **Step 1: Add imports**

In `src/components/CockpitView.tsx`, add after line 3:
```ts
import { createBurrow } from "../lib/worktreeClient";
import type { BurrowInfo } from "../layout/paneLayout";
```

- [ ] **Step 2: Add a focused-cwd reader + a Burrow helper inside `CockpitView`**

Add near the other `useCallback`s (e.g. after `patchSettings`, ~line 76):
```ts
  const focusedPaneCwd = useCallback((): string => {
    for (const t of layout.tabs) for (const r of t.rows) for (const p of r.panes)
      if (p.id === layout.focusedPaneId) return p.cwd;
    return layout.tabs[0]?.rows[0]?.panes[0]?.cwd ?? "";
  }, [layout]);

  // Create a Burrow for `cwd` when the toggle is on; undefined ⇒ caller uses the plain cwd
  // (setting off, no folder, non-git repo, or git error — all fall back silently).
  const maybeBurrow = useCallback(async (cwd: string): Promise<BurrowInfo | undefined> => {
    if (!settings.burrows || !cwd) return undefined;
    try { return await createBurrow(cwd); }
    catch (e) { console.warn("[cockpit] burrow skipped:", e); return undefined; }
  }, [settings.burrows]);
```

- [ ] **Step 3: Make `ProviderPicker.onPick` create the Burrow first**

Replace the `onPick` handler (`:269-276`) with:
```tsx
          onPick={async (provider) => {
            // A z.ai pane launches via `claude --glm` (creds from ~/.claude/glm.env) — no token gate.
            if (pendingCreation.kind === "newTab") {
              const burrow = await maybeBurrow(pendingCreation.cwd);
              dispatch({ type: "newTab", cwd: pendingCreation.cwd, provider, burrow });
            } else {
              // split / splitDown: cut a fresh Burrow off the default branch, located via
              // the focused pane's cwd (which itself may be a Burrow — create_burrow resolves it).
              const burrow = await maybeBurrow(focusedPaneCwd());
              dispatch({ type: pendingCreation.kind, provider, burrow });
            }
            setPendingCreation(null);
          }}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Manual verification (needs the app + a git repo)**

Run: `npm run tauri dev`. With the toggle ON:
1. ⌘O → pick a git repo → pick Claude. Expected: the pane title shows an emoji + animal (e.g. `🦦 otter`); a terminal opens; `git worktree list` in that repo shows `<repo>/.worktrees/otter`; the shell prompt cwd is the worktree.
2. ⌘D (split) → pick a provider. Expected: a second pane opens in a DIFFERENT Codename worktree off the default branch.
3. Open the Project picker again (⌘O). Expected: the repo appears ONCE by its real name — NOT `otter`/the Codenames (Task 2 roll-up).
4. Toggle OFF in Settings → ⌘O → pick repo. Expected: pane opens in the repo folder itself, no new worktree.
5. Pick a NON-git folder with the toggle ON. Expected: pane opens in the folder (console shows "burrow skipped"), no crash.

- [ ] **Step 6: Commit**

```bash
git add src/components/CockpitView.tsx
git commit -m "feat(burrows): create a Burrow before opening a new Session (toggle-gated, fallback-safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Frontend — remove the Burrow on close (with a dirty-work dialog)

**Files:**
- Create: `src/components/BurrowCloseDialog.tsx`
- Modify: `src/components/CockpitView.tsx` (close orchestration; wire `PaneHost` close, tab close, ⌘W)
- Modify: `src/components/PaneHost.tsx:57` (`onClose` → request handler prop)
- Modify: `src/layout/useKeybindings.ts:7,17` (add `onClose?` option)

**Interfaces:**
- Consumes: `burrowDirty`, `removeBurrow` (Task 4); `Pane.isBurrow/codename/burrowBranch/cwd` (Task 5).
- Produces: `CockpitView` handlers `requestClosePane(paneId)` and `requestCloseTab(tabId)` that replace direct `close`/`closeTab` dispatch on Burrow-bearing panes.

- [ ] **Step 1: Write the dialog component**

Create `src/components/BurrowCloseDialog.tsx`:

```tsx
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
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal burrow-close" onClick={(e) => e.stopPropagation()}>
        <h2>ปิด Session ที่มีงานค้าง</h2>
        <p>Burrow เหล่านี้มีการแก้ที่ยังไม่ commit หรือ commit ที่ยังไม่ push:</p>
        <ul>
          {burrows.map((b) => <li key={b.paneId}><code>{b.codename}</code> — <span>{b.path}</span></li>)}
        </ul>
        <div className="burrow-close__actions">
          <button className="danger" onClick={onDelete}>ลบทิ้ง</button>
          <button onClick={onKeep}>เก็บไว้</button>
          <button onClick={onCancel}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}
```

(Reuse whatever overlay/modal class the existing modals use — inspect `ProjectPicker.tsx` / `UpdateModal.tsx` and copy their outer class names so this matches. Add minimal styles to the nearest shared modal CSS if `burrow-close` needs them.)

- [ ] **Step 2: Add the close-orchestration state + handlers in `CockpitView`**

Add imports (top of `src/components/CockpitView.tsx`):
```ts
import { removeBurrow, burrowDirty } from "../lib/worktreeClient";
import { BurrowCloseDialog, type BurrowToClose } from "./BurrowCloseDialog";
```

Add state near the other `useState`s:
```ts
  const [closingBurrows, setClosingBurrows] = useState<{ burrows: BurrowToClose[]; commit: () => void } | null>(null);
```

Add helpers (after `maybeBurrow`):
```ts
  const burrowPanesIn = useCallback((predicate: (paneId: string) => boolean): BurrowToClose[] => {
    const out: BurrowToClose[] = [];
    for (const t of layout.tabs) for (const r of t.rows) for (const p of r.panes)
      if (p.isBurrow && p.burrowBranch && predicate(p.id))
        out.push({ paneId: p.id, codename: p.codename ?? p.title, path: p.cwd, branch: p.burrowBranch });
    return out;
  }, [layout]);

  // Remove every Burrow in `list` (force = keep-nothing) then run the layout change.
  const purgeAndClose = useCallback((list: BurrowToClose[], commit: () => void) => {
    commit();
    for (const b of list) void removeBurrow(b.path, b.branch, true);
  }, []);

  const closeWithBurrows = useCallback(async (list: BurrowToClose[], commit: () => void) => {
    if (list.length === 0) { commit(); return; }
    const dirties = await Promise.all(list.map((b) => burrowDirty(b.path).catch(() => ({ uncommitted: true, unpushed: false }))));
    const dirty = list.filter((_, i) => dirties[i].uncommitted || dirties[i].unpushed);
    if (dirty.length === 0) { purgeAndClose(list, commit); return; }
    setClosingBurrows({ burrows: dirty, commit: () => purgeAndClose(list, commit) });
  }, [purgeAndClose]);

  const requestClosePane = useCallback((paneId: string) => {
    const list = burrowPanesIn((id) => id === paneId);
    void closeWithBurrows(list, () => { dispatch({ type: "focusPane", paneId }); dispatch({ type: "close" }); });
  }, [burrowPanesIn, closeWithBurrows]);

  const requestCloseTab = useCallback((tabId: string) => {
    const paneIds = new Set(layout.tabs.find((t) => t.id === tabId)?.rows.flatMap((r) => r.panes.map((p) => p.id)) ?? []);
    const list = burrowPanesIn((id) => paneIds.has(id));
    void closeWithBurrows(list, () => dispatch({ type: "closeTab", tabId }));
  }, [layout, burrowPanesIn, closeWithBurrows]);
```

- [ ] **Step 3: Wire the close paths through the handlers**

- `useKeybindings` call (`:92`): add `onClose: () => requestClosePane(layout.focusedPaneId)` to the options object.
- `TabBar` props (`:194`) and `TabSidebar` props (`:209`): change `onCloseTab={(tabId) => dispatch({ type: "closeTab", tabId })}` to `onCloseTab={(tabId) => requestCloseTab(tabId)}`.
- `PaneHost` (`:232`): pass a new prop `onRequestClose={requestClosePane}`.
- Render the dialog before the closing `</div>` (after `UpdateModal`):
```tsx
      {closingBurrows && (
        <BurrowCloseDialog
          burrows={closingBurrows.burrows}
          onDelete={() => { closingBurrows.commit(); setClosingBurrows(null); }}
          onKeep={() => { closingBurrows.burrows.forEach(() => {}); /* keep worktrees */
            // Close the panes but leave the Burrows on disk:
            for (const b of closingBurrows.burrows) { dispatch({ type: "focusPane", paneId: b.paneId }); dispatch({ type: "close" }); }
            setClosingBurrows(null);
          }}
          onCancel={() => setClosingBurrows(null)}
        />
      )}
```

Note on "keep": the simplest correct behavior is to run the same layout change as delete but skip `removeBurrow`. Since `commit` also performs the close, implement Keep by closing the panes without purging — the per-pane close loop above handles the pane-close case; for tab-close, call the original `closeTab` instead. To avoid divergence, prefer storing BOTH callbacks in `closingBurrows`: `{ burrows, onConfirmDelete, onConfirmKeep }`. Refactor `closeWithBurrows` to set:
```ts
    setClosingBurrows({
      burrows: dirty,
      onConfirmDelete: () => purgeAndClose(list, commit),
      onConfirmKeep: commit, // close the layout, leave worktrees
    });
```
and update the dialog render to call `closingBurrows.onConfirmDelete()` / `closingBurrows.onConfirmKeep()`. Update the state type accordingly:
```ts
  const [closingBurrows, setClosingBurrows] = useState<{ burrows: BurrowToClose[]; onConfirmDelete: () => void; onConfirmKeep: () => void } | null>(null);
```

- [ ] **Step 4: Update `PaneHost` to route close through the prop**

In `src/components/PaneHost.tsx`, add `onRequestClose` to the component props (`:18-22`):
```ts
  onRequestClose: (paneId: string) => void;
```
and change the `TerminalPane` `onClose` (`:57`) to:
```tsx
              onClose={() => onRequestClose(pane.id)}
```

- [ ] **Step 5: Add the `onClose` option to `useKeybindings`**

In `src/layout/useKeybindings.ts`, add `onClose?: () => void;` to the `opts` type (`:7`), change the `w` branch (`:17`) to:
```ts
      else if (k === "w") { e.preventDefault(); if (opts.onClose) opts.onClose(); else dispatch({ type: "close" }); }
```
and add `opts.onClose` to the effect dependency array (`:26`).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Manual verification (app + git repo)**

Run: `npm run tauri dev`.
1. Open a Burrow Session (Task 7). In its terminal, do nothing (clean). Close the pane (✕ or ⌘W). Expected: pane closes, NO dialog, and `git worktree list` no longer shows that Codename; `git branch` no longer lists it.
2. Open a Burrow Session; in its terminal `touch dirty.txt`. Close the pane. Expected: the 3-button dialog lists that Codename. "ยกเลิก" → pane stays open + worktree intact. Reopen dialog, "เก็บไว้" → pane closes, worktree + branch still on disk. Recreate a dirty one, "ลบทิ้ง" → pane closes, worktree + branch gone.
3. Close a whole TAB containing a dirty Burrow pane → same dialog, same three outcomes.
4. Resume-after-delete: delete a Burrow via close, then quit + relaunch (or from the Cost view jump to that session). Expected: it resumes in the repo root (Task 3 fallback), not an error.

- [ ] **Step 8: Commit**

```bash
git add src/components/BurrowCloseDialog.tsx src/components/CockpitView.tsx src/components/PaneHost.tsx src/layout/useKeybindings.ts
git commit -m "feat(burrows): remove Burrow on close with a dirty-work dialog (delete/keep/cancel)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (against `2026-07-06-per-session-burrows-design.md`):
- Scope: newTab/split/splitDown get a Burrow — Task 5 (reducer) + Task 7 (orchestration). Handoff/popOut/openSession untouched — Task 7 passes no `burrow` there. ✓
- Branch off default branch at `.worktrees/<codename>` — Task 1 (`create_burrow`, `default_branch`). ✓
- Cost/Project roll-up — Task 2. ✓
- Cleanup on close + 3-way dialog — Task 8. ✓
- Resume after delete → Project root — Task 3. ✓
- Settings toggle default ON — Task 6. ✓
- UI variant 1 (emoji + Codename title) — Task 5 (`makePane` sets `"<emoji> <codename>"`, `autoTitle:false`); no PaneHeader change needed. ✓
- Non-git fallback — Task 7 (`maybeBurrow` catch) + Task 1 (`create_burrow` errors on non-repo). ✓
- Error handling never blocks pane creation — Task 7 catch → undefined → plain cwd. ✓

**Type consistency:** `Burrow`/`BurrowInfo` fields `{path,branch,codename,emoji}` match across Rust `create_burrow`, `worktreeClient.ts`, and `paneLayout.BurrowInfo`. `DirtyState {uncommitted,unpushed}` matches Rust ↔ client. `removeBurrow(path,branch,force)` / `burrowDirty(path)` signatures match call sites in Task 8. `project_root_of` defined once (Task 1), consumed by Tasks 2 and 3.

**Known scope notes (not gaps):**
- Resume-fallback toast is deferred — Task 3 falls back silently (spec called a toast "nice"; silent fallback satisfies "resume works"). If wanted, surface it later by returning the resolved cwd from `pty_spawn`.
- Burrow panes keep the Codename as their title (`autoTitle:false`) rather than adopting the session topic — this is the chosen variant-1 identity; if topic-naming is later wanted alongside the emoji, thread `pane.emoji` into `PaneHeader` instead.
