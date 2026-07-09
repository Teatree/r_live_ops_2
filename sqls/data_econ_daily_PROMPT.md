# Prompt — per-DAY economy query producing `data_econ_daily` (per-earner daily gain/spend)

Paste this to your query LLM **together with your current `data_seg_beh` query AND the `data_econ`
query it already wrote** (so it reuses the exact same window, cohort, segmentation, filters and
currency mapping — and so the daily numbers reconcile with the window totals).

---

You wrote my `data_seg_beh` and `data_econ` queries (pasted below). I need a **new companion result
set, `data_econ_daily`** — the same economy gain/spend as `data_econ`, but broken down **per day of
the analysis window**. Reuse the *identical* window, player cohort, segmentation, filters and
currency mapping; derive it from the same base CTEs — do not redefine any of those.

## Output: `data_econ_daily` — one row per (segment, payer_flag, currency, day_index)

Grain: **segment × payer_flag × currency × day_index**. `day_index` runs **1..33**, where day 1 =
the FIRST calendar day of the same analysis window as `data_seg_beh` (the window starts on a
Wednesday). Emit a row for **every** combination — all 33 days × all 11 currencies per (segment,
payer_flag) — with 0s where nothing was gained/spent; do NOT drop empty rows.

| column | meaning |
|---|---|
| `segment` | same labels as `data_econ.segment`: `0-9`, `10-19`, `20-39`, `40-99`, `100+` |
| `payer_flag` | `NONPAYER` / `PAYER`, same as `data_econ` |
| `currency` | **exactly** the same 11 strings as `data_econ`: `HC`, `Slingshot`, `Shuffle`, `Comet`, `Red`, `Chuck`, `Bomb`, `UL Bomb`, `UL Chuck`, `UL Red`, `Unlimited Lives` |
| `day_index` | 1..33; day N = window_start_date + (N − 1) |
| `gain_total` | raw total of that currency **gained** on that day by the segment × payer cohort |
| `spend_total` | raw total **spent/consumed** on that day |
| `resource_earners` | the **WINDOW-level** earner count for this (segment, payer_flag, currency) — distinct players with gain > 0 of the currency **anywhere in the 33-day window**. Constant across the 33 day rows of a key, and **identical to `data_econ.resource_earners`** |
| `gain_per_earner_day` | `gain_total ÷ resource_earners` |
| `spend_per_earner_day` | `spend_total ÷ resource_earners` |
| `net_per_earner_day` | `gain_per_earner_day − spend_per_earner_day` |

**The denominator is the WINDOW earner count, not that day's participants.** This is deliberate: it
makes the 33 daily rows additive.

**Invariant — verify before delivering:** for every (segment, payer_flag, currency),
`Σ over the 33 days of gain_per_earner_day == data_econ.gain_per_earner` (and the same for spend),
up to rounding. If it doesn't hold, the day attribution or the denominator is wrong.

## Units (identical to `data_econ`)
- `HC` = **coins only**.
- `Slingshot`, `Shuffle`, `Comet`, `Red`, `Chuck`, `Bomb` = **booster counts** (pre-level + in-level).
- `UL Bomb`, `UL Chuck`, `UL Red`, `Unlimited Lives` = **minutes** of the unlimited version.
- "Spent" = actually consumed/used; "Gained" = granted/awarded from any source.

## Project gotchas — apply all of these (same as the other economy queries)
- Schema `abgbproduction_174525b3_gdpr`.
- **HC must come from `player_daily.hc_gain` / `hc_spend`** — conveniently already daily-grained; do
  **NOT** sum HC from `client_events` currency amounts (0–9999 cap silently zeroes large grants).
- Standard cohort filters, identical to `data_seg_beh`: geo `NOT IN ('FI','PL')`, exclude orphan
  accounts, `max_level > 200`, and the same 0–9999 amount-cap handling per currency.
- Cast `processdate` to INT for partition pruning (the daily grain makes this matter even more).
- No `COUNT(DISTINCT)` inside a window function; `event_tokens` is a MAP on the level-summary view.
- Segment assignment is the player's **window-level (modal) segment**, same as `data_seg_beh` — do
  NOT re-segment per day.

## Deliverable
A single SQL query returning `data_econ_daily` with the columns above, plus (if your export step
uses one) the `HEADER_NOTES` doc-string describing each column. Keep it a **separate** query/file;
don't modify `data_seg_beh` or `data_econ`.

---

### Why this shape (for my downstream sheet)
My `EcoGainsSim_Daily` sheet shows, per day × currency: `actual spend`, `current net`, `new net`,
`net Δ` — all **per earner**. It computes `current_net(day) = gain_per_earner_day −
spend_per_earner_day` and `new_net(day) = gain_per_earner_day + simulated_gain_shift(day) −
spend_per_earner_day`, where the simulated per-day gain shift comes from my sim engine — i.e.
**spend is held constant** and only the *current* actual daily gain/spend comes from you. The
window-earner denominator is what lets the 33 days sum exactly to the `data_econ` window totals.
