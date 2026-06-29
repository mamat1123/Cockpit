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
- **`cache` mode, not `token` mode.** We run the proxy in `cache` mode (freeze prior turns
  for prefix-cache hits) even though `token` mode would show larger Savings. Aggressive
  rewriting wins on Savings but evicts Anthropic's prompt cache, which can push **Cost up**
  — and Cockpit shows Cost right next to Savings (see 0005). `cache` keeps the two numbers
  moving the same direction.
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
retry loop. The two surprising calls — a *shared* proxy (accepting ~80–90% attribution
accuracy to save RAM) and `cache` over `token` (accepting smaller Savings to protect Cost)
— are deliberate trade-offs, not oversights, and both are expensive to reverse: they reach
into PTY spawn, proxy supervision, and how the [[Savings]] number is computed and trusted.
