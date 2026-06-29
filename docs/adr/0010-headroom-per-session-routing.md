# 0010 — Headroom routing: a per-Session toggle through a Cockpit-owned shared proxy

Context: Headroom is a local optimization proxy that compresses prompts to cut input tokens.
Today it's wired in durably via `headroom wrap` / a project `ANTHROPIC_BASE_URL` in
`.claude/settings.local.json`, which forces *every* Claude run in that folder through the
proxy — and silently breaks (the `Unable to connect to API (ConnectionRefused)` retry loop)
whenever the proxy isn't running. We want it as a first-class Cockpit feature instead: a
per-[[Session]] on/off the user controls, plus a visible readout of what each Session saved.

Three forces shape the design:
- `ANTHROPIC_BASE_URL` is read once at `claude` process start — you cannot redirect a
  running Session in or out of the proxy without relaunching it.
- Headroom buckets Savings by *project (cwd)* and lifetime only — there is **no native
  per-conversation bucket**, and Cockpit can't inject identifying headers into Claude's
  outbound requests.
- The owner often runs several Sessions in the *same* folder at once, so per-project
  attribution cannot tell those Sessions apart.

Decision:
- **Per-Session toggle, applied by relaunch.** Routing is a per-Session flag, off by
  default, toggled in the [[Pane]] header. Flipping it kills and relaunches that pane's
  `claude` with `--resume` (with or without the proxy env) — the conversation survives via
  the jsonl, the user eats a ~1–2s blip.
- **One Cockpit-owned shared proxy**, not one proxy per Session. Cockpit supervises a single
  `headroom proxy` as a managed child (lazy start, health-poll `/livez`, auto-restart;
  surface a clear status + a "switch to direct" fallback if it can't recover). A per-Session
  proxy fleet would give exact numbers but cost an extra ~150–600 MB Python process each.
- **`token` mode (REVISED 2026-06-29; originally `cache`).** We now run the proxy in `token`
  mode (compress/rewrite prior turns to cut tokens). The original decision was `cache` mode
  — reasoning that aggressive rewriting evicts Anthropic's prompt cache and pushes **USD Cost**
  up, so `cache` kept Cost and Savings moving together. **That reasoning assumed pay-per-token
  billing.** The owner is on a Claude *subscription*: there is no per-token USD bill, so the
  binding constraint is the **token-based rate-limit window** (the 5-hour / weekly Usage), not
  Cost. `token` mode cuts tokens → consumes less of that window (and fits more into context) —
  the saving that actually matters here; `cache` mode's cheaper-input benefit simply doesn't
  apply. Accepted trade-off: token-mode rewrites prior context so Claude sees a compressed
  view (a fidelity risk for precision/coding work), mitigated by CCR (`headroom_retrieve` pulls
  full detail back on demand). Per-Session `off/cache/token` selection was considered and
  deferred — a single `token` default is simpler and fits the subscription case.
- **Savings attributed by [[Working state]].** Cockpit reads the proxy's `--log-file`
  (per-request `tokens_before`/`tokens_after`) and pins each request to the one ON Session
  that was `working` at that timestamp. When zero or two-plus ON Sessions were working, the
  request lands in an **Unattributed** bucket rather than being guessed — per-Session totals
  stay conservative and honest.
- **Cockpit is the sole owner of routing.** The durable project-level `ANTHROPIC_BASE_URL`
  is removed; Cockpit injects the env per-pane only for ON Sessions. Claude run *outside*
  Cockpit in that folder no longer auto-routes (the user wraps it themselves if they want).

Why it matters: it turns a fragile, all-or-nothing, silently-breaking wrap into a
controllable per-Session feature whose failure mode is a visible status, not a cryptic
retry loop. The surprising call — a *shared* proxy (accepting ~80–90% attribution accuracy
to save RAM) — is a deliberate trade-off, not an oversight, and is expensive to reverse: it
reaches into PTY spawn, proxy supervision, and how the [[Savings]] number is computed and
trusted. (The proxy *mode* — `token` vs `cache` — was revised post-Plan-1; see the mode
bullet above and the Status note.)

## Status

Plan 1 (Routing Foundation) shipped: per-Pane toggle, env injection, a single
Cockpit-owned proxy (now `token` mode — see the revised mode bullet above) with lazy start +
TCP health-check + kill-on-exit, and relaunch-via-resume. **Deferred from this ADR's full
promise, tracked here so the gap is explicit, not lost:**
- **Mid-session auto-restart + status readout.** Plan 1 ensures the proxy on launch/toggle
  only. If the proxy dies *while* a routed Session is live, that Session sees the
  ConnectionRefused this feature exists to prevent until it is toggled/relaunched.
  `headroom_status` exists but no component polls it yet. → Plan 2/3.
- **A crashed Cockpit (not a clean exit) can still orphan a proxy** that the next launch
  adopts via the port-open check; only clean exit kills the child. → revisit if it bites.
- **Savings attribution + Dashboard readout** (the `--log-file` ingestion, Working-state
  correlation, Unattributed bucket, per-Session metrics) → Plans 2 and 3.

### Gotcha found in verification (don't regress)

The toggle relaunch (`--resume <pane.sessionId>`) silently degraded to a fresh
`--session-id` because the pane's transcript jsonl never existed. Root cause: **a pane
shell that inherits `CLAUDECODE` / `CLAUDE_CODE_*` makes its `claude` think it is a nested
CHILD session, which does not write a transcript** — so `sessionExists()` is always false
and resume (and Cost/Working state, which read the same jsonl) break. This bites whenever
Cockpit is launched from inside a Claude Code session (`npm run tauri dev`). `pty_spawn`
now strips `CLAUDE*`/`AI_AGENT` from the spawned shell. Keep that strip. (Also: `pty_kill`
must `.kill()` the child explicitly — portable-pty does not kill on drop on macOS — or
orphaned claudes collide on the same `--session-id` and fork to new ids.)
