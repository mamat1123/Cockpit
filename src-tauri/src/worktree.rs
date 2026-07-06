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
