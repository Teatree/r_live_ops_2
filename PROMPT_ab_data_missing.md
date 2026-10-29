# Data request — what the 2026-10-29 delivery is still missing

Paste this to the analytics LLM on its own. It is self-contained; `PROMPT_ab_data_refresh.md` is the
full specification behind it, if you need more detail on any item.

---

Thank you for the last delivery. Every sheet now covers the A/B test instead of August. You re-ran
your existing queries over the new dates, so the sheets kept their old columns. This message lists
exactly what is still missing. **Keep everything you already deliver as it is**; add only what is
below.

**If you cannot produce an item, do not drop it silently.** Leave it out, and give one line in
the checklist at the end saying why: no telemetry, a table you cannot reach, a definition you are
unsure of. A missing column is fine. A missing column with no explanation looks like it was
forgotten.

## 1. Facts that are settled

- **Arm:** this delivery is the **`Variant A`** arm of "A/B Test - Dream Album (Collections) +
  Mighty Doors (Tower of Fortune)". Keep it. The `Control` arm is wanted too, as second priority,
  in the same sheets with the same queries.
- **Dates:** keep the start at **Tue 2026-10-13** (the test start). End = the last complete day,
  `LEAST(yesterday, 2026-11-15)`. Never include today.
- **Segments, payer flag, filters:** unchanged from your current queries.

## 2. Columns every sheet needs

| column | rule |
|---|---|
| `ab_variant` | `Variant A` (or `Control`) on every row |
| `window_start_date` | 2026-10-13 on every row |
| `data_through_date` | the last complete day in the pull, on every row |
| `days_available` | `data_through_date − window_start_date + 1`, on every row |
| `calendar_date` | on every **per-day** row (every sheet with a `day_index` or `day` column) |

We use these to cut the data at Mon 2026-10-19, where our comparison starts. Without them we
cannot tell which days a total covers.

## 3. Envelopes and Tower of Fortune tickets as resources

Today `data_gains`, `data_econ`, `data_econ_daily` and `data_econ_daily_by_source` carry 13
resources. Add six, with the same row shape as the others:

| resource | what to count | where to find it |
|---|---|---|
| `1-star Pack` … `5-star Pack` | envelopes **granted** (count). Tier from the breakdown string: `EnvelopeCommon` = 1-star, `EnvelopeUncommon` = 2-star, `EnvelopeRare` = 3-star, `EnvelopeEpic` = 4-star, `EnvelopeLegendary` = 5-star | the same envelope grant events your `data_col_envelopes` query already reads (strings like `meta/kite_festival_event/EnvelopeRare`) |
| `ToF_Ticket` | Tower of Fortune tickets **granted** (count) | the ticket grants behind `tickets_earned_mean` in your `data_tof_runs` query |

On sheets with spend: envelopes spent = opened, tickets spent = consumed by a run.

## 4. Source categories

`data_gains` and `data_econ_daily_by_source` still use the old 24 categories. Tower of Fortune and
album rewards are currently counted inside `Other` (5.6% of coins at `0-9`, 17.8% at `100+`). Add
these branches to your CASE:

| raw source | category |
|---|---|
| `tower_of_fortune_event` | `ToF` |
| `dream_album_event`, set-completion rewards | `Col - Sets` |
| `dream_album_event`, album-completion rewards | `Col - Albums` |
| `album/open_big_reward_chest` and any other star-chest grant | `Col - Chests` |
| `dream_pass_event`, **paid** track rewards | `Season Pass (Paid)` (the free track stays `Season Pass (Free)`) |

Two mapping questions — answer them; do not change the mapping until you are sure:

- **`race_event`** is mapped to `Team Race`, but it pays daily Fri–Sun (Oct 16–18, Oct 23–25), like
  our Chuck's Flash Race. Team Race pays on Mondays. Which event is it?
- Which raw source carries **Mystery Puzzle**, **Top Players Leaderboard** and **Top Teams
  Leaderboard**, and what are `single_collection`, `special_event`, `event_progress` and
  `dream_peak`?

Add a short table to your notes: each raw source that lands in `Other`, with its share of each
resource.

## 5. Per sheet

| sheet | missing |
|---|---|
| `data_gains` | §2 columns (no `calendar_date` — it is a totals sheet), plus `players_in_cell`. §3 resources, §4 categories |
| `data_econ_daily_by_source` | §2 columns. §3 resources, §4 categories. `spend_total` / `spend_per_earner_day` are empty in every row: put spend on rows with `source = 'ALL'` (one per cell, currency and day) |
| `data_econ_daily` | `calendar_date` and `dow`. §2 columns. §3 resources |
| `data_econ` | §2 columns, §3 resources |
| `data_seg_beh` | §2 columns. Say whether `active_days_*` are counted out of 16 days (the window) or another number. Clear the stray table pasted below the 10 data rows |
| `data_event_inst` | §2 columns. Events on the calendar but missing from the sheet: Team Race, Team Event, Mystery Puzzle, Top Players Leaderboard, Top Teams Leaderboard, Tower of Fortune |
| `data_event_accrual` | §2 columns. Team Race, Team Event and Mystery Puzzle are missing |
| `data_streaks`, `data_RM`, `data_core_spt` | §2 columns |
| `data_rm_pace` | **Not re-run** — still the pooled last-60-days pull. Needed: one row per instance (`instance_start_date`, `instance_end_date`, `calendar_date`), every instance running from 2026-10-13 on (including the one that started Mon 2026-10-12). `rm_config` = `RM_1st` or `RM_2nd`, the ladder the instance ran: from its config id, else by whether it paid any `SPTx2`, and say which. `claimed_per_participant` per resource. §3 resources. `cum_matchables_p10` and `cum_matchables_p90` beside the existing p25/p50/p75 |
| `data_ns_rounds` | `claims_total` is empty for some rounds (round 1 at `0-9`, round 2 at `40-99`), and `cum_streak_req` is empty everywhere. Real zeros, or missing? |
| `data_col_season` | §2 columns, so we know which day the season figures are as of. `envelopes_opened_mean` exceeds `envelopes_received_mean` in all ten cells (by 0.40–0.88): which grant is missing from "received"? `chests_bought_bronze/silver/gold_mean` are empty |
| `data_econ_daily_live` | Not needed any more: `data_econ_daily` replaces it. Skip it |

## 6. Reply with this checklist

One line per item, so nothing gets lost:

| # | item | status | note |
|---|---|---|---|
| 1 | §2 columns on every sheet | done / partly / cannot | which sheets, and why not |
| 2 | §3 envelope resources | | |
| 3 | §3 `ToF_Ticket` | | |
| 4 | §4 new categories | | |
| 5 | §4 `race_event` answer | | |
| 6 | §4 Mystery Puzzle / Top Players / Top Teams / unknown sources | | |
| 7 | `data_econ_daily_by_source` spend | | |
| 8 | `data_econ_daily` dates | | |
| 9 | `data_seg_beh` active-day basis + clean-up | | |
| 10 | `data_event_inst` missing events | | |
| 11 | `data_event_accrual` missing events | | |
| 12 | `data_rm_pace` re-run | | |
| 13 | `data_ns_rounds` gaps | | |
| 14 | `data_col_season` as-of date, received vs opened, chests | | |
| 15 | `Control` arm | | |

Priority, if not everything fits: items 2, 3, 4 and 1 first (envelopes, tickets, categories and
dates in `data_gains` and `data_econ_daily_by_source`), then 12, then the rest.
