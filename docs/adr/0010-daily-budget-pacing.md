# 0010 — Daily-budget pacing: paced in % of the weekly window, USD self-calibrated

Context: users on capped plans (e.g. Team Premium) hit the *weekly* Usage window and get
blocked for days. They want a per-day "how much can I spend today and still last to reset"
number. The naive framings are all wrong: tokens-per-day swings wildly with cache mix (cache
reads are ~50× cheaper than fresh input, and Claude Code re-reads cached context every turn,
so 80–95% of "tokens" are nearly free); a dollar ceiling is undisclosed and changes whenever
Anthropic adjusts limits (the 5-hour cap doubled May 2026). The one authoritative, blocking
number we already read ([ADR 0009]) is the weekly `utilization` %.

Decision: pace the **Daily budget in % of the weekly window**, not tokens or dollars.
- `allowance% = (100 − uStart) ÷ daysLeft`, where `daysLeft` is whole local days through
  `resets_at` inclusive, recomputed daily → **burn-down** so under/over-use self-corrects.
- **"Spent today" comes from the fine-grained cost log, NOT the coarse weekly %.** Weekly
  utilization is integer-stepped over a large budget (~$6.6k cost-weighted at 100%), so a
  day's spend barely moves it — a naive `util − startOfDayUtil` reads ~0 and looks frozen
  (the bug that shipped in the first cut). Instead: `usedToday% = utilization × (today's $ ÷
  this week's $)` — today's share of the week's spend scaled onto the authoritative %-axis.
  `uStart` is then *derived* (`util − usedToday%`), so **no persisted baseline is needed** —
  which also removes the cold-start problem and a class of localStorage bugs.
- The day gauge mirrors the 5h/weekly gauges (fill = spent ÷ allowance) but **may exceed 100%**:
  it's a self-set pacing target, not a hard limit. Past 100% it reads red = *overspend*
  (borrowing from later days), which is the signal that prevents hitting the weekly wall early.
- **USD is a self-calibrated secondary**, shown with "≈". `$/1% = real weekly spend ÷ real
  utilization` (both already in hand: Cost from [ADR 0005], utilization from [ADR 0009]),
  falling back to ~$22/1% until there's enough spend this week for a stable ratio. *Today's*
  spent-USD uses the real cost-log figure, not the estimate.
- **Fixed-reset horizon**: although the weekly window is rolling (ADR 0009 / CONTEXT), pacing
  treats `resets_at` as a clean finish line (utilization assumed to snap toward 0 there). The
  single `resets_at` the API returns makes this the only horizon with a meaningful "per day".
- **Frontend-only** — no Rust. A `useBudget()` hook composes `useUsage()` + `cost_report` and
  the pure math in `src/lib/budget.ts`; no new command, so it can't regress the data layer.

Why it matters / consequences: a future reader sees a third "day" gauge that looks identical to
the 5h/weekly ones but behaves differently — it can pass 100% and it tracks a target the *user*
sets, not one Anthropic enforces (hence the glossary distinction Daily budget vs Usage window).
The USD readout is deliberately an estimate; if Anthropic changes limits, the self-calibration
re-derives `$/%` from the user's own week without a code change. Pacing accuracy degrades
gracefully: if the cockpit wasn't open at local midnight the baseline is the first reading of
the day (slightly overstates today's spend) and the burn-down absorbs it the next day. Usage is
per OAuth token, so with two accounts (`claude --me`) the budget reflects whichever account is
active. The even-split denominator is `activeDaysLeft` (all days for v1) so a future
"only count days I actually code" weighting can drop in without reshaping the math.
