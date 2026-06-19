# 0004 — Tauri (Rust core + web frontend), not Electron

Context: terminal-first makes this a terminal-heavy app. Electron has the most
battle-tested terminal stack (node-pty + xterm.js, all-TS) and matches the user's daily
TS/React/Node skillset, so it would ship fastest. Tauri is lighter and more native-feeling
but needs Rust glue (portable-pty, process lifecycle, log-tailing, IPC to the webview) —
the user's least-fluent area.

Decision: Tauri. Rust core for PTY / process / log-tail; web frontend (React/Vite/Tailwind
+ xterm.js) for the UI. Chosen deliberately over the lower-risk Electron path.

Why it matters: a deliberate deviation from the obvious (ship-fastest) choice — the user
prefers the lighter, native-feel app and accepts the Rust glue as the main effort. The
Rust <-> webview IPC + portable-pty integration is the highest-risk piece; spike it first.
