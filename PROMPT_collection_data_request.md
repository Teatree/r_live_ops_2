# Data request — card collection, envelopes and Tower of Fortune (2026-10-07)

Hand this whole file to the analytics LLM. It asks for **four tables**. Each one becomes a
`data_*` sheet in the collection workbook and is read live by the simulation engine, so the
**column names and key spellings below are a contract**, not a suggestion.

If the warehouse cannot produce a column, **return the table without it and say so in the notes** —
do not substitute a proxy silently, and do not invent a value. A missing column makes the engine
fall back to its current modelled assumption, which is a known, logged state. A wrong column is
indistinguishable from a measurement and will move balancing decisions.

---

## What this is for (so you can judge substitutions)

We simulate the economy of Angry Birds Dream Blast per **segment × payer** over a 33-day calendar
window, comparing the live calendar against a redesigned one. The card-collection feature (albums,
sets, envelopes, star chests) and Tower of Fortune are the only sources with **no measured anchor**
in our existing `data_gains` export: it has no envelope rows, no set/album reward rows and no ToF
rows. We are therefore modelling them bottom-up from config, which means we cannot tell whether the
*level* is right — only the direction of a change.

These four tables are the anchor. With them, a change to the album/pack/ToF configs is priced as
`measured × ratio`, the same way every other event in the model already works.

**Collection season = 28 days.** The album is intended to last exactly as long as the season. If the
live season in the data is not 28 days, that is itself a finding — report the actual window.

---

## Standard filters (match our existing economy queries)

From `Event_Eco_Investigation_Context.md`, applied by every economy query in this project:

- `geo NOT IN ('FI','PL')`
- exclude orphan accounts
- `max_level > 200`
- amounts capped to the 0–9999 band **and** — important — `client_events` currency amounts have a
  0–9999 cap that silently zeroes large grants, so **derive coins from `player_daily.hc_gain`**,
  never from the event payload.
- Athena/Trino: cast `processdate` to `INT` for partition pruning; no `COUNT(DISTINCT)` inside a
  window; `ARBITRARY()` is non-deterministic; **Night Sky is logged as _Dream Heist_**;
  `event_tokens` is a `MAP` on the level-summary view.

## Key spellings (a mismatch makes a whole table read as zero)

| Column | Allowed values |
|---|---|
| `segment` | `0-9`, `10-19`, `20-39`, `40-99`, `100+` — the merged labels, **not** `B. 1-9` style |
| `payer_flag` | `NONPAYER`, `PAYER` |
| `pack_tier` | `1-star Pack` … `5-star Pack` (the 6-star tier was retired; omit it) |
| `status` | `MEASURED` on every row you return |

Three traps we have already been bitten by — please guard them explicitly:

1. **A rate that rounds to `0.0` is indistinguishable from "no telemetry"**, and both make our
   reader price at *full* participation (~40× too high). If a participation or completion rate is
   genuinely near zero, return it with **4+ decimal places**, or return the raw numerator and
   denominator instead.
2. **Counts must be players, not rows.** Our last export split spend by sink, so one account
   counted N times. State the denominator for every `*_mean` column.
3. **No one-sided exclusions.** A previous export dropped 0% of one arm and 12% of the other, which
   made the two non-comparable. If any filter drops players unevenly across segments, say so.

---

## Table 1 — `data_col_season`
**Grain:** one row per `segment` × `payer_flag` (10 rows). Season-level, whole collection season.

| Column | Meaning |
|---|---|
| `segment`, `payer_flag` | keys, spelled as above |
| `unique_players` | distinct players in the cell over the season — the denominator for every mean |
| `season_days` | length of the collection season in days, as observed |
| `envelopes_received_mean` | envelopes granted per player (all sources, all tiers) |
| `envelopes_opened_mean` | envelopes actually opened per player — we want both, they differ |
| `envelopes_received_p25/p50/p75/p90` | per-player distribution; the spread drives our reach model |
| `cards_drawn_mean` | cards received per player |
| `new_cards_mean`, `duplicate_cards_mean` | split of the above |
| `new_card_share` | new ÷ drawn. We currently *assume* 0.42; this replaces that assumption |
| `sets_completed_mean` | sets completed per player |
| `album1_completion_rate` | share of players in the cell finishing album 1 inside the season |
| `album1_completion_day_p50` | median day they finished (blank if the cell rarely finishes) |
| `albums_completed_mean` | albums completed per player (can exceed 1 — album 2+ exists) |
| `stars_earned_mean`, `stars_spent_mean`, `star_balance_end_mean` | the star chain |
| `chests_bought_bronze/silver/gold_mean` | chests purchased per player, by tier |
| `active_days_mean` | active days per player in the window, same definition as our `data_seg_beh` |
| `status` | `MEASURED` |

## Table 2 — `data_col_envelopes`
**Grain:** one row per `segment` × `payer_flag` × `source` × `pack_tier`. **Long format.**
Emit only non-zero rows — a missing row means a measured zero, which is how our other tables work.

| Column | Meaning |
|---|---|
| `segment`, `payer_flag`, `pack_tier` | keys |
| `source` | the feature that granted it. Please use the in-game event names and list the raw strings you mapped from — our names are `Rainbow Maker`, `Night Sky` (*Dream Heist* in logs), `Season Pass`, `Target Day`, `Tower of Fortune`, `Hatchling Hideaway`, `Jigsaw`, `Bomb's Ballet`, `Kite Festival`, `Photoshoot`, `Team Event`, `Flock Flurry`, `Star Chest - Bronze/Silver/Gold` |
| `envelopes_mean` | envelopes of that tier from that source, per player in the cell |
| `envelopes_per_instance_mean` | same, divided by the number of instances of that event in the window |
| `instances` | how many times that event ran in the window |
| `participation_rate` | share of the cell that took part in that event at all. **This is the single most valuable column in the request** — see trap 1. Kite Festival is an opt-in league and we are currently guessing 0.35 against a measured 1–3%; a real rate per segment retires that guess |
| `status` | `MEASURED` |

## Table 3 — `data_tof_runs`
**Grain:** one row per `segment` × `payer_flag` (10 rows). Tower of Fortune = *Mighty Doors*.

| Column | Meaning |
|---|---|
| `segment`, `payer_flag` | keys |
| `runs_played_mean` | ToF runs started per player |
| `runs_banked_mean` | runs that ended in a successful cash-out |
| `bank_rate` | banked ÷ played |
| `mean_stage_reached`, `stage_reached_p50`, `stage_reached_p90` | how deep runs get |
| `continues_bought_mean` | continues purchased per player |
| `coins_spent_continues_mean` | coins spent on continues per player — this is a **sink**, and we currently double-count it in one place, so we need it separately |
| `topups_bought_mean` | coin top-ups bought mid-run per player |
| `tickets_earned_mean`, `tickets_unspent_mean` | the ticket ledger |
| `cashout_stage_p50` | the stage players actually choose to cash out at |
| `status` | `MEASURED` |

## Table 4 — `data_tof_stages`
**Grain:** one row per `stage_n` × `door_outcome`. **Long format**, all stages 1..N even where
nobody reached them (a zero `picks` is information; a missing stage is a hole).

| Column | Meaning |
|---|---|
| `stage_n` | 1-based stage number |
| `stage_type` | `Safe (Start)`, `Standard`, `Safe`, `Major Milestone` — or your own labels, listed in the notes |
| `doors_shown` | doors presented at that stage |
| `door_outcome` | `reward`, `pig`, `empty` |
| `picks` | times a door of that outcome was chosen |
| `pick_share` | picks ÷ all picks at that stage |
| `survive_rate` | share of players who survived that stage |
| `status` | `MEASURED` |

Not segmented on purpose — if the door distribution differs by segment, that is a finding worth a
note, but we model it as a property of the event.

---

## Deliverable

For each table: the SQL, the row count, and the table as CSV. Plus a short notes block covering

- the exact source tables and date window used;
- any column you could not produce, and why;
- the player denominators;
- the raw event-name strings you mapped to each `source`;
- anything that looked wrong on the way (a rate that is suspiciously round, a segment with almost
  no players, a filter that dropped one group harder than another).

We would rather have six solid columns and a clear note than twenty columns where three are proxies.
