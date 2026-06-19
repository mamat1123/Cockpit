# 0005 — Cost computed from session logs x a maintained price table (incl. cache tiers)

Context: cost-by-project is a core feature, but Claude's session logs record TOKENS +
model, not dollars, and there is no per-session billing API to read. The logs also show
heavy prompt-cache usage with distinct pricing tiers (cache creation ~1.25-2x input,
cache read ~0.1x input).

Decision: compute cost locally = sum(tokens-by-type x model price), using a built-in,
user-editable model->price table that explicitly models cache-creation and cache-read
tiers — not just input/output.

Why it matters: correctness-critical and surprising. Costing only input+output tokens and
ignoring cache tiers would be wildly wrong for cache-heavy Claude Code usage. The price
table is also a maintenance burden — it must be updated when Anthropic changes prices, so
it is user-editable, not hardcoded and forgotten.
