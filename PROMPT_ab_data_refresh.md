# Data request — re-pull every `data_*` sheet onto the live A/B window (2026-10-29)

Hand this file to the analytics LLM. **§0 is shared by every sheet; §1–§13 are one sheet each.**
`data_col_daily`, `data_col_envelopes`, `data_tof_runs` and `data_tof_stages` are not in this
request — they are up to date.
To regenerate a single sheet, paste §0 plus that sheet's section — each section is written to stand
on its own. Paste the query you already wrote for that sheet alongside it (they are in `sqls/` or in
your Hex notebook), so the cohort, segmentation and filters are reused, not rebuilt.

Column names and key spellings are a **contract**: the simulation engine reads every sheet live, by
header name. If you cannot produce a column, leave it out and say so in the notes — never a proxy,
never a guessed value. A missing column makes the engine fall back to a known, logged assumption; a
wrong column is indistinguishable from a measurement.

### Follow-up to the delivery of 2026-10-29 (re-run on Tue 2026-10-13 → Wed 2026-10-28)

Thank you — every sheet now covers the test instead of August. The delivery kept the old schemas,
so these items are still open. Everything else below stands as written.

1. **`ab_variant` is missing on every sheet.** This delivery is `Variant A` (confirmed). Add the
   column, and the `Control` arm beside it, when you can.
2. **Starting on 2026-10-13 is fine — keep it** (it is the test start). This replaces §0.2's
   lead-in split: we cut at 2026-10-19 ourselves, by date. So every per-day sheet must carry
   `calendar_date`, and every totals sheet `window_start_date` and `data_through_date`.
3. **Still 13 resources and the old 24 categories.** No envelopes, no `ToF_Ticket`, no `ToF`,
   `Col - Sets`, `Col - Albums`, `Col - Chests` or `Season Pass (Paid)` rows (§0.4, §0.5). ToF and
   album rewards are currently inside `Other` (5.6% of coins at `0-9` rising to 17.8% at `100+`).
4. **`data_econ_daily` has no `calendar_date`**, and `data_econ_daily_by_source` still has empty
   `spend_total` / `spend_per_earner_day`.
5. **`data_rm_pace` was not re-run** (§7: per instance, `rm_config`, envelopes and tickets).
6. **`data_ns_rounds`** (new, thank you): `claims_total` is empty for some rounds (round 1 at
   `0-9`, round 2 at `40-99`) and `cum_streak_req` is empty everywhere — say whether those are real
   zeros or missing.

---

## §0 Shared rules — apply to every sheet below

### 0.1 Why everything is being re-pulled

Every `data_*` sheet in the workbook except the collection/ToF ones still describes the **pre-test
window, Tue 2026-08-11 → Sat 2026-09-13**, before albums, envelopes and Tower of Fortune existed.
The A/B test **"A/B Test - Dream Album (Collections) + Mighty Doors (Tower of Fortune)"** has been
live since **Tue 2026-10-13** with two arms, `Control` and `Variant A`. Both arms run the same event
calendar; `Variant A` adds albums, envelopes and Tower of Fortune and re-balances several event
ladders (for example its Rainbow Maker coin payout is roughly half of `Control`'s from 2026-10-13).

The model now has to answer "what has the economy gained **so far** in the test, and what would it
have gained under the redesign over the same days". That needs every sheet on the A/B window,
**per arm**, with dates, and with envelopes and ToF tickets as ordinary resources.

### 0.2 Window — the dates we care about

The simulation compares calendars from **Mon 2026-10-19** onward (the first column of our calendar
grid that is counted). The test itself started six days earlier, on Tue 2026-10-13, so the days in
between are delivered separately as a lead-in, never as part of the window.

| period | dates | used for |
|---|---|---|
| **Window** | **Mon 2026-10-19 → yesterday.** On 2026-10-29 that is **Mon 2026-10-19 → Wed 2026-10-28, 10 days** | every sheet, every row |
| **Window end** | **Sun 2026-11-15** (day 28). The window grows by one day per re-pull and **stops here** — never pull a date after 2026-11-15 | the cap on `data_through_date` |
| Lead-in | Tue 2026-10-13 → Sun 2026-10-18 (6 days: test running, before the window) | **only** the `period = 'lead_in'` rows of §11 and §12 |
| Pre-period | Wed 2026-10-07 → Mon 2026-10-12 (6 days: before the test) | **only** the `period = 'pre'` rows of §12, and the segmentation run-up |

The album season is Tue 2026-10-13 → Mon 2026-11-09; the album sheet (§13) keeps its own season
dates. Nothing from August or September in any sheet.

| column | rule |
|---|---|
| `window_start_date` | **2026-10-19** (Hex input `{{ window_start_date_input }}`). Constant on every row |
| `data_through_date` | the last **complete** day: `LEAST(yesterday, 2026-11-15)`. Never today. Constant on every row |
| `days_available` | `data_through_date − window_start_date + 1` (10 on 2026-10-29, 28 at most). Constant on every row |
| `day_index` | `date_diff('day', window_start_date, calendar_date) + 1` → 2026-10-19 is day 1, 2026-11-15 is day 28; lead-in days are 0 … −5, pre-period days −6 … −11 |
| `calendar_date` | the date of that day, on every per-day row |
| `period` | on the per-day sheets (§11, §12): `window`, `lead_in` or `pre` |
| segmentation | the modal tier is computed over the **window** days only; its 7-day rolling run-up reads from 2026-10-13 |

Every sheet is a **"to date" pull**: it will be re-run every few days with the same SQL and only
`data_through_date` moving. Parameterise the end date as `LEAST(yesterday, 2026-11-15)` so the file
re-runs unchanged. Players count from **2026-10-19**; a player active only in the lead-in is not in
any window population.

### 0.3 Cohort and keys

- **Arm:** column **`ab_variant`** on every row, exactly `Control` or `Variant A`. Use the same
  assignment the production A/B dashboard uses for this test; name the table and the assignment
  rule in the notes. Players assigned after 2026-10-19 count from their assignment day (state how
  many). Players seen in both arms: exclude and report the count.
- **`segment`:** `0-9`, `10-19`, `20-39`, `40-99`, `100+` — the **modal** 7-day saga play-rate tier
  of `data_seg_beh` (same CASE, same thresholds, `ORDER BY seg_days DESC, seg_rank DESC`), computed
  over the A/B window. Not `player_profile_level`, not `avg_levels_7d_bucket`, not first-day-seen.
  No `A. 0` rows. **Exception:** `data_gains` keeps its own spelling (`B. 1-9` … `F. 100+`) — the
  engine maps it.
- **`payer_flag`:** `NONPAYER` / `PAYER`, lifetime, same as `data_seg_beh`.
- **Standard filters:** `t_geo NOT IN ('FI','PL')`, orphans excluded (`reporting.orphans`),
  `max_level > 200`, the same amount bands per currency as the existing queries.
- **Population:** every sheet that has a per-player mean also carries **`players_in_cell`** (distinct
  players of that `ab_variant` × `segment` × `payer_flag` in the window). One account counts once.

### 0.4 Resources — the 19 names, in this order (the engine's 20 minus the retired 6-star tier)

`HC`, `Slingshot`, `Shuffle`, `Comet`, `Red`, `Chuck`, `Bomb`, `UL Bomb`, `UL Chuck`, `UL Red`,
`Unlimited Lives`, `SPT`, `SPTx2`, `1-star Pack`, `2-star Pack`, `3-star Pack`, `4-star Pack`,
`5-star Pack`, `ToF_Ticket`

| resource | unit and source |
|---|---|
| `HC` | coins only, from **`player_daily.hc_gain` / `hc_spend`** — never summed from `client_events`, whose 0–9999 cap silently zeroes large grants |
| boosters | counts, pre-level + in-level |
| `UL *`, `Unlimited Lives` | minutes |
| `SPT` | Season Pass tokens (count) |
| `SPTx2` | **minutes** of the 2× token buff — a timer, not a token |
| `1-star Pack` … `5-star Pack` | **envelopes granted** (count). Tier from the official breakdown string: `EnvelopeCommon` → `1-star Pack`, `EnvelopeUncommon` → `2-star`, `EnvelopeRare` → `3-star`, `EnvelopeEpic` → `4-star`, `EnvelopeLegendary` → `5-star`. The 6-star tier is retired: emit none |
| `ToF_Ticket` | Tower of Fortune tickets granted (count) |

Where a sheet has spend: envelopes spent = **opened**, tickets spent = **consumed by a run**.

`Control` has no envelopes or tickets. Emit no rows for them there — absent is the truth, not 0.

### 0.5 Source → category mapping

`category` must be one of the engine's names:

`Ads`, `Bomb Challenge`, `Bomb's Ballet`, `Chuck Challenge`, `Core`, `Daily Gift`,
`Daily Night Sky Prize`, `Flock Flurry`, `Hatchling Hideaway`, `Jigsaw`, `Kite Festival`,
`Level Race`, `Other`, `Photoshoot`, `Red Challenge`, `River Rush`, `Saga`, `Season Pass (Free)`,
`Season Pass (Paid)`, `Target Day`, `Team Event`, `Team Race`, `Flash Race`, `FlowerCoop`,
`Rainbow Maker`, `IAPs`, `ToF`, `Col - Sets`, `Col - Albums`, `Col - Chests`

Keep the CASE your `resource_share_by_category_period_v2` query already uses (`red_event` → Red
Challenge, `dreamheist_event` → Daily Night Sky Prize, `ArcheryArena` → Target Day, `FlockRush` →
Flock Flurry, `team_collection` → Team Event, `team_versus` / `team_versus_contribution` /
`race_event` → Team Race (**check this one**: in the live data `race_event` pays daily Fri–Sun —
Oct 16–18 and 23–25 — exactly like our Chuck's Flash Race lane, while Team Race pays on Mondays; if
it is Flash Race, map it to `Flash Race` and say so), `saga_progression` → Saga, `player_level_up` → Core, `ad_chest` → Ads,
`wager_event` → Level Race, …) and **add these branches**:

| raw source | category |
|---|---|
| `tower_of_fortune_event` | `ToF` |
| `dream_album_event` — set-completion rewards | `Col - Sets` |
| `dream_album_event` — album-completion rewards | `Col - Albums` |
| `album/open_big_reward_chest` and any other star-chest grant | `Col - Chests` |
| `dream_pass_event` — **paid** track rewards | `Season Pass (Paid)` (free track stays `Season Pass (Free)`) |

**Identify, do not guess**, these raw sources and say which calendar event each one is:
`single_collection`, `special_event`, `event_progress`, `dream_peak`, `reds_club`, `league_reward`.
Until you are sure, they stay in `Other`. Our calendar also runs **Mystery Puzzle**, **Top Players
Leaderboard** and **Top Teams Leaderboard** — tell us which raw source carries each.

Deliver one **mapping audit table** in the notes, shared by all sheets: `source_raw`, `category`,
and its share of each resource's total, per arm. Everything that fell to `Other` must be visible
there.

### 0.6 Values

- `status = MEASURED` on every row. Never `FAKE`.
- A measured zero is `0`. A day you have not got yet is **absent**. A column you cannot produce is
  **omitted**. A zero draws a collapse; a missing value draws nothing.
- Rates near zero: **4+ decimal places**, or deliver numerator and denominator. A participation rate
  exported as `0.0` reads as "no telemetry" and the engine then prices full participation (~40× high).
- No forward fill, back fill, interpolation, sampling, `LIMIT` or `APPROX_` on totals.

### 0.7 Checks every sheet must pass (report the numbers)

1. **Keys unique** on the grain stated in the section.
2. **Arms balanced:** `players_in_cell` per arm, ten cells side by side, and the arm ratio per cell.
   A ratio that differs strongly between cells means the assignment or a filter is uneven.
3. **Population guard:** the ten `players_in_cell` per arm against §2's `unique_players` for the
   same arm. A uniform offset is fine; a spread across cells above ~3× means the segment axis is
   not ours (an earlier album pull bucketed on `player_profile_level` and ran 0.0× at `0-9` to 32×
   at `100+`).
4. **Re-pull stability:** a day already delivered must not move by more than 1% on the next pull
   (late events excepted — flag them).
5. **Cross-check against the dashboard:** for `40-99`, your per-arm daily totals by source should
   reproduce the production dashboard's `free_gain_by_source` / `total_gain` for the same test,
   variant and date (coins and boosters). Report the largest gap.

### 0.8 Deliverable, for every sheet

The SQL (labelled blocks, parameterised on `{{ window_start_date_input }}` and `LEAST(yesterday, 2026-11-15)`), the CSV, the
row count, `days_available`, a `HEADER_NOTES` entry in the style of `daily_gains.sql`, and a notes
block: source tables, exact dates, denominators, the §0.7 numbers, any column omitted and why,
anything that looked wrong. **Paste each result into its own sheet with exactly the name in the
section title, headers on row 1, data from row 2, and nothing else on the sheet.**

---

## §1 `data_gains` — per-source gains so far, per arm

**Wrong today.** Window Aug 11 → Sep 13 (its `player_days` equal the sum of `data_econ_daily`'s
daily actives over those 34 days, every cell). 13 resources: no envelopes, no `ToF_Ticket`. 24
categories: no `Season Pass (Paid)`, `ToF`, `Col - Sets`, `Col - Albums`. No arm. Its cohort is about
a seventh of `data_seg_beh`'s (14,895 HC earners at `B. 1-9 NONPAYER` against 107,126 players).

**Grain:** `ab_variant` × `engagement_segment` × `payer_flag` × `resource` × `category`, totals over
`window_start_date` → `data_through_date`. Non-zero rows only (a missing row is a measured zero —
the engine relies on that).

**Columns:** every column the sheet has today, unchanged in name and meaning (`engagement_segment`,
`payer_flag`, `resource`, `unit`, `category`, `resource_earners`, `recipients`,
`recipient_rate_pct`, `pct_of_resource_pool`, `mean_share_all_earners_pct`, `category_amount`,
`resource_pool_amount`, `amount_per_earner`, `amount_per_recipient`, `category_amount_uncorrected`,
`resource_pool_amount_uncorrected`, `amount_per_earner_uncorrected`, `player_days`), then **appended**:

| new column | meaning |
|---|---|
| `ab_variant` | §0.3 |
| `players_in_cell` | §0.3 |
| `window_start_date`, `data_through_date`, `days_available` | §0.2 |

`resource_earners` stays the window-level count of players with gain > 0 of that resource from any
source; `amount_per_earner = category_amount ÷ resource_earners`.

**Specific checks.** Σ over categories of `category_amount` = §9's `gain_per_earner × resource_earners` for the same
arm/cell/resource (±1%). `Col - Sets`, `Col - Albums`, `Col - Chests`, `ToF` and all envelope rows
appear in `Variant A` only.

## §2 `data_seg_beh` — population and activity, per arm

**Wrong today.** 33-day pre-test window. No arm. Two stray blocks pasted onto the sheet below the
data (O13:W22 and G27:Z37 — another copy of the activity table in a different layout).
`sessions_per_active_day` is still the placeholder flagged `[F1]`.

**Grain:** `ab_variant` × `segment` × `payer_flag` (20 rows). Every existing column, same names and
meanings, with one change: every "over 33 days" becomes **over `days_available`** (active-day
percentiles are counted out of the days in the window). Appended: `ab_variant`, `window_start_date`,
`data_through_date`, `days_available`.

Keep `active_days_p95` and `active_days_p98` — the card simulation draws each player's attendance
off the whole curve. `weekday_active_rate` / `weekend_active_rate`: weekend = **Fri, Sat, Sun**.

**Specific checks.** `unique_players` here is the denominator §0.7.3 compares every other sheet
against — report it per arm. Nothing else on the sheet but the 20 rows.

## §3 `data_event_inst` — participation and finishing positions, per event, per arm

**Wrong today.** Pre-test window. No arm. Missing events that are on the live calendar: Team Race,
Team Event, Mystery Puzzle, Top Players Leaderboard, Top Teams Leaderboard, Tower of Fortune. Carries
River Rush and Photoshoot, which are on neither calendar now. `Dream Pass` has `participation_rate`
0 in all ten cells and River Rush in one (§0.6: "0.0" reads as no telemetry).

**Grain:** `ab_variant` × `event_name` × `segment` × `payer_flag`, over instances that **ended** in
the window. Keep today's `event_name` spellings (`Bomb`, `Chuck`, `Red`, `Bombs Ballet`, `Dream
Heist`, `Dream Pass`, `Flash Race`, `Flock Flurry`, `Hatchling Hideaway`, `Jigsaw`, `Kite Festival`,
`Level Race`, `Milestone` for Rainbow Maker, `Target Day`); new events as `Team Race`, `Team Event`,
`Mystery Puzzle`, `Top Players Leaderboard`, `Top Teams Leaderboard`, `Tower of Fortune`.

**Columns:** every existing column, then appended:

| new column | meaning |
|---|---|
| `ab_variant`, `players_in_cell`, `window_start_date`, `data_through_date`, `days_available` | §0 |
| `instance_length_days` | calendar dates one instance spans (modal), as `event_accrual_curve_31d_v2` counts it |
| `first_instance_start`, `last_instance_end` | dates |
| `instances_running` | instances started but not ended by `data_through_date` (not in the stats) |
| `position_p10`, `position_p90` | leaderboard rank percentiles beside the existing p25/p50/p75 |
| `envelopes_per_participant_mean`, `tickets_per_participant_mean` | envelopes (all tiers) and ToF tickets per participant per instance |

**Specific check.** Kite Festival is an opt-in league: report its `participation_rate` and
`opt_in_rate` per cell to 4 decimals. The model currently assumes 0.35 against a pre-test 1–3%.

## §4 `data_event_accrual` — token accrual curves inside an instance, per arm

**Wrong today.** Pre-test. Rainbow Maker (`Milestone`) only at 5 dates (4-day instances); Hatchling
only 5; Bomb's Ballet and Jigsaw 4–5; River Rush 8 (not on any calendar now). No Kite (it sits in its
own sheet with the wrong length, §5), no Team Race, Team Event, Mystery Puzzle, Top Players / Top
Teams leaderboards.

**Grain:** `ab_variant` × `event_name` × `segment` × `payer_flag` × `instance_length_days` ×
`event_day`, over instances that ended in the window. **Add Kite Festival here** (3-day instances)
with the same columns. Same columns as today plus `ab_variant`, `window_start_date`,
`data_through_date`, `days_available`.

If an event has not completed an instance in the window, deliver its most recent completed
instances from before 2026-10-19 (test days first, 2026-10-13 onward) with `period = 'pre_ab'` in an appended `period` column (`window`
otherwise), rather than leaving it out. Do not synthesise lengths that never ran — the redesign
uses 2-day Rainbow Maker, 2-day Bomb's Ballet / Jigsaw and 3-day Hatchling; if any of those ran,
those rows matter most.

## §5 `data_event_kite_accrual` — retire into §4

**Wrong today.** Every row is an 8-day instance; Kite Festival is 3 days on the live calendar and 3 or
2 days on the redesign. `cum_levels_share_mean` is empty. Deliver Kite inside §4 and **empty this
sheet to its header row** (the engine reads it only for the play-by-play view and falls back to §4).

## §6 `data_RM` — Rainbow Maker matchables, per instance, per arm

**Wrong today.** Window totals from the pre-test window, not per instance. The engine now prices
Rainbow Maker on the live matchables in §7 and reads this sheet only as a fallback.

**Grain:** `ab_variant` × `segment` × `payer_flag` × `instance_start_date`. Columns: `segment`,
`payer_flag`, `avg_matchables_window`, `p10_matchables_window` … `p90_matchables_window` (same names
as today, now **per instance, at its end**), then appended `ab_variant`, `instance_start_date`,
`instance_end_date`, `rm_config`, `participants`, `players_in_cell`, `window_start_date`,
`data_through_date`, `days_available`. `rm_config` is §7's.

## §7 `data_rm_pace` — Rainbow Maker claim pace, per instance, per config, per arm

**Wrong today.** "Instances that ended in the last 60 days" mixes the pre-test period with the test
and both arms. Only 4-day (5-date) instances. No split between the two Rainbow Maker configs. No
envelope or `ToF_Ticket` rows (13 resources + `ALL`). No dates.

**The two configs.** Rainbow Maker runs two ladders in a season: **`RM_1st`** (first half of the
season, no `SPTx2`) and **`RM_2nd`** (second half, pays `SPTx2`). Every instance must say which one
it ran, from the event's own config identifier or asset; if neither is logged, classify by whether
the instance paid any `SPTx2` and say so.

**Grain:** `ab_variant` × `segment` × `payer_flag` × `instance_start_date` × `instance_day` ×
`resource`. Every instance that was **running on any day from 2026-10-19 to `data_through_date`**,
complete or not, plus the instance that ran Mon 2026-10-12 → Thu 2026-10-15 (the only Rainbow Maker
of the test before the window; mark it `period = 'lead_in'` in an appended `period` column, `window`
otherwise). A running instance carries its days so far.

**Columns:** every existing column, same meaning, now per instance rather than pooled, then appended:

| new column | meaning |
|---|---|
| `ab_variant`, `players_in_cell`, `window_start_date`, `data_through_date`, `days_available` | §0 |
| `instance_start_date`, `instance_end_date`, `calendar_date` | dates; `calendar_date` is the date of `instance_day` |
| `rm_config` | `RM_1st` or `RM_2nd` |
| `instance_complete` | `TRUE` once its last day is ≤ `data_through_date` |
| `claimed_per_participant` | amount of `resource` claimed by the end of `instance_day`, per participant |

`resource` adds the five envelope tiers and `ToF_Ticket` to today's list. Keep `cum_matchables_mean`
and `cum_matchables_p25/p50/p75`, and **add `cum_matchables_p10` and `cum_matchables_p90`** — the
pricing curve currently has to invent the tails.

**Specific checks.** On the last day of a complete instance `cum_pooled_share` = 1 −
`claimed_after_end_share`. Σ over instances of `claimed_per_participant × participants` reproduces
§1's `Rainbow Maker` rows for the same arm/cell/resource within ±5%.

## §8 `data_streaks` — in-day win streaks, per arm

**Wrong today.** Pre-test window, small pre-test cohort (14,987 players at `0-9 NONPAYER`), no arm.

**Grain:** `ab_variant` × `segment` × `payer_flag`. Same columns, appended `ab_variant`,
`players_in_cell`, `window_start_date`, `data_through_date`, `days_available`.

## §9 `data_econ` — gain, spend and net per currency, per arm

**Wrong today.** Aug 11 → Sep 13 (identical to the 2026-09-14 CSV). 13 currencies. No arm.

**Grain:** `ab_variant` × `segment` × `payer_flag` × `currency` over the window. Same columns, the 19
§0.4 names in `currency`, appended `ab_variant`, `players_in_cell`, `window_start_date`,
`data_through_date`, `days_available`, and **`hc_balance_start_p25/p50/p75/p90`** (coin balance on
the day before the window) beside the existing end-of-window `hc_balance_*`.

## §10 `data_econ_daily` — no new pull

The August daily baseline (Aug 11 → Sep 13, 13 currencies). It stays as the pre-test reference and
the engine's fallback. **Do not regenerate it**; §12 replaces it for the test.

## §11 `data_econ_daily_by_source` — per day, per source, per arm

**Wrong today.** Aug 11 → Sep 13, `calendar_tag = cal_curr`. `spend_total` and
`spend_per_earner_day` are empty in all 64,804 rows. 13 currencies. No ToF, album or
`Season Pass (Paid)` sources. No arm.

**Grain:** `ab_variant` × `segment` × `payer_flag` × `source` × `currency` × `day_index`, every
complete day of the window, **plus the six lead-in days** (2026-10-13 → 2026-10-18, `day_index`
0 … −5, `period = 'lead_in'`). The lead-in rows use the same denominators as the window rows; they
tell us what players had already earned when the window opened. `source` = the §0.5 categories; `currency` = the §0.4 resources.

**Columns:** `segment`, `payer_flag`, `source`, `currency`, `day_index`, `calendar_date`, `dow`,
`period`, `ab_variant`, `players_in_cell`, `active_players_day`, `resource_earners`, `window_start_date`,
`data_through_date`, `days_available`, `status`, `gain_total`, `gain_per_earner_day`,
`gain_per_active_player_day`, `recipients_day`, `spend_total`, `spend_per_earner_day`.

**Fixed denominators** — this is the change that matters most:

- `resource_earners` = distinct players of the cell with gain > 0 of that currency from any source
  over the **whole window to date**. It is one number per (arm, cell, currency) per pull and
  identical to §1's `resource_earners` — then the days and sources add up to §1's
  `amount_per_earner`.
- `gain_per_active_player_day` = `gain_total ÷ active_players_day` — depends on that day only and
  never moves between pulls.

Spend is not attributable to a source for most currencies: put it on `source = 'ALL'` rows (one per
arm/cell/currency/day) and leave it empty on the source rows. Emit `0` for a complete day with no
gain; never a row for an incomplete day.

**Specific check.** Σ over sources and days of `gain_per_earner_day` = §1 `amount_per_earner` summed
over categories, per arm/cell/currency (±1%).

## §12 `data_econ_daily_live` — per day, all sources, per arm

**Wrong today.** The sheet is empty: it was cleared to remove 62,984 August rows that had been pasted
under the live rows. The last delivery it held was 1,820 rows = 10 cells × 13 currencies × 14 days,
Tue 2026-10-13 → Mon 2026-10-26 (counted from the test start, not from our window), with both arms pooled (the earlier brief said "no A/B cohort
filter"; that is reversed now), no envelopes or `ToF_Ticket` (the "extras" were not delivered), and
a `resource_earners_window` that is one number per pull, so every `*_per_earner_day` value was
revised on each re-pull.

**Grain:** `ab_variant` × `segment` × `payer_flag` × `currency` × `day_index`. The columns of the
earlier delivery, unchanged in name (`segment`, `payer_flag`, `currency`, `day_index`,
`calendar_date`, `dow`, `gain_total`, `spend_total`, `players_in_cell`, `active_players_day`,
`resource_earners_window`, `gain_per_active_player_day`, `spend_per_active_player_day`,
`gain_per_earner_day`, `spend_per_earner_day`, `days_available`, `window_start_date`, `status`),
plus `ab_variant` and `data_through_date`, with the 19 §0.4 names in `currency`.

- `resource_earners_window` = exactly §11's `resource_earners` for the same pull.
- **Also emit the lead-in and the pre-period** in an appended `period` column: Tue 2026-10-13 → Sun
  2026-10-18 as `day_index` 0 … −5 (`lead_in`), and Wed 2026-10-07 → Mon 2026-10-12 as `day_index`
  −6 … −11 (`pre`); `window` otherwise. Before the test both arms ran the same game, so the `pre`
  rows should match within noise; that is our check that the arms are comparable, and the baseline
  the test effect is measured against.
- Your output replaces the whole sheet: header on row 1, your rows from row 2, nothing else.

## §13 `data_col_season` — season to date (Variant A)

**Wrong today.** Nothing on the sheet says how far into the season the pull is: `season_days` reads
28, and `active_days_mean` (12.4–13.9) did not move between the last two deliveries while
`data_col_daily` grew from 2 to 16 days. `chests_bought_bronze/silver/gold_mean` are empty.
`envelopes_opened_mean` still exceeds `envelopes_received_mean` in all ten cells, by 0.40–0.88
(17.25 against 16.38 at `0-9 NONPAYER`) — a player cannot open an envelope they did not receive, so
at least one grant (probably a start-of-season envelope) is missing from "received".

**Columns:** as delivered, plus `ab_variant` (= `Variant A`), `season_start_date`,
`season_end_date`, `data_through_date` (the same day as `data_col_daily`'s last `day`),
`days_available`; `album1_completion_rate` to 4 decimals beside `album1_completers` (both exist —
keep them); `active_days_mean` counted over `days_available`; `envelopes_received_mean` and its
percentiles recomputed to include every grant; the three `chests_bought_*_mean` filled (or omitted
and said so). State the season's official start and end dates; we expect Tue 2026-10-13 → Mon
2026-11-09 — if they differ, that is a finding.

---

## Priority, if you cannot do everything at once

1. §11 `data_econ_daily_by_source` and §1 `data_gains` — the per-source anchor for "so far".
2. §2 `data_seg_beh` and §12 `data_econ_daily_live` — population, attendance and the daily check.
3. §7 `data_rm_pace` and §13 `data_col_season` — Rainbow Maker's two configs and the album as-of date.
4. Everything else.
