# Prompt — extend the economy query to produce `data_econ` (per-earner + per-active-player gain/spend/net)

Paste this to your query LLM **together with your current `data_seg_beh` query** (so it reuses the
exact same window, cohort, segmentation and filters). **v2 (2026-07-09):** adds four per-EARNER
columns — the downstream sheet now consumes those; the per-active-player columns are retained for
continuity/analysis.

---

You wrote my existing `data_seg_beh` query (pasted below). I need a **new companion result set,
`data_econ`**, that reuses the *identical* analysis window, player cohort, segmentation and filters
as `data_seg_beh` — do not redefine any of those; derive `data_econ` from the same base CTEs.

## Output: `data_econ` — one row per (segment, payer_flag, currency)

Grain: **segment × payer_flag × currency**. Emit a row for every combination (even when a currency
has 0 spend — emit 0, don't drop it).

| column | meaning |
|---|---|
| `segment` | same labels as `data_seg_beh.segment`: `0-9`, `10-19`, `20-39`, `40-99`, `100+` (and `A. 0` if you emit it there) |
| `payer_flag` | `NONPAYER` / `PAYER`, same as `data_seg_beh` |
| `currency` | **exactly** one of: `HC`, `Slingshot`, `Shuffle`, `Comet`, `Red`, `Chuck`, `Bomb`, `UL Bomb`, `UL Chuck`, `UL Red`, `Unlimited Lives` (map your internal codes to these strings) |
| `gain_per_active_player` | total of that currency **gained** over the window ÷ **unique active players in the segment** (the same `unique_players` denominator as `data_seg_beh`) |
| `spend_per_active_player` | total of that currency **spent/consumed** over the window ÷ the same `unique_players` |
| `net_per_active_player` | `gain_per_active_player - spend_per_active_player` |
| `resource_earners` | distinct players with **gain > 0** of this currency in the window, in this segment × payer tier — the **same definition as `data_gains.resource_earners`** ("Distinct players who earned >0 of this resource in this segment x payer tier"), so the two sheets reconcile |
| `gain_per_earner` | total of that currency gained over the window ÷ `resource_earners` |
| `spend_per_earner` | total of that currency spent over the window ÷ `resource_earners` — **same gainer denominator, NOT distinct spenders**, so gain and spend are directly nettable on one basis |
| `net_per_earner` | `gain_per_earner - spend_per_earner` |
| `gain_p25/p50/p75/p90` | per-player gain distribution (percentiles over players, 0 for non-gainers) |
| `spend_p25/p50/p75/p90` | per-player spend distribution |
| `net_p25/p50/p75/p90` | per-player **net** distribution (compute each player's gain−spend first, THEN percentile) |

**Two bases, deliberately:**
- The `*_per_active_player` columns divide segment totals by `unique_players` (all active players
  in the window) — kept for continuity with the previous version of this sheet.
- The `*_per_earner` columns divide the SAME totals by `resource_earners` (players who gained >0 of
  that currency). **These are what the downstream sheet now uses**, because its gains block is per
  earner too. Note the deliberate choice: spend is also divided by the *gainer* count — a player who
  spends the currency without gaining any in the window sits in the numerator but not the
  denominator (slightly inflates per-earner spend; accepted so gain and spend net cleanly).
- The percentiles stay over the full active-player population (players with no gain/spend
  contribute 0), unchanged from v1.

**Acceptance check** (please verify before delivering): per (segment, payer_flag, currency),
`gain_per_earner` should be ≈ the sum over categories of `data_gains.amount_per_earner` for that
same key. Small gaps are expected (the `data_gains` query drops cells with fewer than 50 earners),
but the two should agree within a few percent for the big cells.

## Units (match the game/sim conventions)
- `HC` = **coins only**.
- `Slingshot`, `Shuffle`, `Comet`, `Red`, `Chuck`, `Bomb` = **booster counts** (pre-level + in-level boosters).
- `UL Bomb`, `UL Chuck`, `UL Red`, `Unlimited Lives` = **minutes** of the unlimited version (not counts).
- "Spent" = actually consumed/used (boosters used in levels, UL minutes activated, coins spent on
  continues/lives/shop). "Gained" = granted/awarded from any source.

## Project gotchas — apply all of these (same as the other economy queries)
- Schema `abgbproduction_174525b3_gdpr`.
- **HC must come from `player_daily.hc_gain` / `hc_spend`** (or the equivalent daily-aggregate
  columns) — do **NOT** sum HC from `client_events` currency amounts: those are capped at 0–9999 and
  silently zero large grants.
- Standard cohort filters, identical to `data_seg_beh`: geo `NOT IN ('FI','PL')`, exclude orphan
  accounts, `max_level > 200`, and the same 0–9999 amount cap handling per currency.
- Cast `processdate` to INT for partition pruning.
- No `COUNT(DISTINCT)` inside a window function; `event_tokens` is a MAP on the level-summary view.
- Keep `unique_players` computed the same way as in `data_seg_beh` so the two sheets reconcile.

## Deliverable
A single SQL query returning `data_econ` with the columns above, plus (if your export step uses one)
the `HEADER_NOTES` doc-string describing each column. Keep it a **separate** query/file from
`data_seg_beh`; don't modify `data_seg_beh` itself.

---

### Why this shape (for my downstream sheet)
`Sim per Segment` will show, per currency × segment × payer: `current_spend`, `current_net`,
`new_net`, `net_diff`, all **per earner**. It computes `new_net = gain_per_earner +
(simulated_gains − current_gains) − spend_per_earner` — i.e. **spend is held constant** (we are NOT
modelling how config changes shift spend), and the absolute simulated-minus-current gain movement
comes from my sim engine and is ADDED on (not applied as a ratio — my engine models only part of
the total faucet). So I only need the **current** per-earner gain and spend from you; the
projection is done in the sheet. An "overall" row weights the segments by `resource_earners` for
the net columns (hence that column must be emitted) and by `unique_players` for the gains columns.
