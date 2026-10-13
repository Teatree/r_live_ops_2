# Follow-up: build all three album tables NOW, thin

> ### ⚠ PARTLY SUPERSEDED by `PROMPT_hex_album_v2.md` (2026-10-13)
> The production album SQL (`sqls/album_*.sql`) turned up eleven mismatches against this
> document. In particular: `album_metrics_daily` DOES exist, the segment we need is already a
> column (`album_segmentation_daily.level_completes_7d`) and must not be rebuilt by hand, the
> payer flag should come from `spend_group`, and `albumPct` should use
> `hex_abgbproduction_174525b3.album_snaps` rather than a hardcoded 72. **Send v2 instead of
> this file**; it lists what here is still correct. Updated 2026-10-13 after two more
> production queries landed: `album_daily_snaps.sql` is almost exactly the query we want
> (all players, zeros included, long per metric x breakdown, splits on `level_completes_7d`),
> and `star_balance_max` IS in `album_metrics_daily` after all.

Answers to your questions, in your order. **Short version: build all three tables today, even if
most of them are zeros or blanks.** A table that exists with zeros in it is useful to us — it proves
the plumbing and lets us wire the workbook — and a table that does not exist blocks work. Do not
wait a week for data.

The single rule that matters more than any number below: **a measured zero is `0`, an unmeasurable
value is EMPTY.** Those are different claims and our engine treats them differently — a blank is
skipped, a zero is plotted as a real zero. Where you cannot measure something, leave the cell empty
rather than writing 0, and never write a rounded-to-zero rate.

---

## 1. Radek's table is gone — your rebuild is the source of truth

Do not block on comparing against `tmp_radekjanhuba.album_metrics_daily`. It is not visible to us
either and the cells that referenced it are deleted. Your rebuild from
`client_events_view_event_progress` **is** the definition from now on. Please do keep the per-metric
derivation notes you wrote; they are now the only documentation of how these numbers are made.

## 2. Day 1 = the official calendar start, and pre-start activity folds INTO day 1

You are right that it looks wrong, and your instinct to flag it was correct. Here is the decision:

- **`day 1` is the first day of the official calendar window — 13 Oct.** Our whole model is indexed
  on the calendar (`cal_new`), and the chart's x-axis is "day of season". If your day 1 is 12 Oct
  and ours is 13 Oct, every curve is offset by one and nobody notices.
- **Do not drop the 12 Oct activity, and do not give it a day 0.** Every series is a *cumulative*
  total, so fold it into day 1: day 1's value = everything that happened up to and including the
  end of 13 Oct. Dropping it would understate every later day forever.
- **Please report** how many players and how many envelope opens landed before the calendar start.
  9.9k players with album rows before launch is interesting in its own right, and if it is an
  early-access cohort we want to know the size so a day-1 bump is not mistaken for a model error.

## 3. FIX the cohort at day 1 — do not let the denominator grow

This one matters a lot, so please change it:

> "Players who show up later in the season are back-filled into earlier days as zeros, so cell
> counts grow while the season runs."

That makes the day-5 mean **fall** every time you re-run, because late joiners add zeros to days
they were not there for. On a cumulative chart that reads as the data going backwards. It also makes
us non-comparable with our simulation, which runs a **fixed** cohort for the whole window — every
simulated player exists from day 1 and may simply be inactive on a given day.

So: **the cohort is the players in the segment as of day 1**, fixed for the rest of the season. A
player who installs on day 9 is not in it. Keep `players_in_cell` and `players_nonzero` as columns —
they are exactly the right diagnostics and we want them even though our reader ignores extra
columns.

If that turns out to be awkward to express, the fallback is: keep back-filling, but **also** send
`players_in_cell` per day so we can see the denominator moving. Fixed is much better.

## 4. Keep p95 and p98, jumpy or not

Keep them. You were right not to drop them. We would rather see a noisy p98 with a sample size
beside it than a silently absent column — and your note that everything up to p90 is 0 at ~6%
engagement is itself the finding: **those zeros are real** and should be sent as `0`, not blank.
That is the distinction in the rule at the top. Blank means "I could not measure this"; `0` means
"I measured it and it was zero".

## 5. Build `data_col_envelopes` now, with `participation_rate` EMPTY

Build it from `client_events_view_item_gain` with what exists. You correctly spotted the trap, so:

- **Leave `participation_rate` completely empty** for every source. Do not write 0, and do not
  write a rate computed from 56 grant rows. An empty cell means "unknown" to us; a 0 would make our
  engine price that event at *full* participation, which is the ~40× error we warned about.
- Send the rows you do have — 56 grants across six sources is a thin but real table, and it tells
  us the source-name vocabulary, which is worth having now.
- **The day-1 starter envelope not being logged as a grant is a finding worth writing down.** It
  means `envelopes_received` and `envelopes_opened` cannot reconcile for day 1 by construction.
  Note it rather than papering over it.
- Map these source names for us:

| Your string | Our source name |
|---|---|
| `saga_progression` | `Core/Saga` |
| `daily_reward` | `Daily Gift` |
| `tower_of_fortune_event` | `Tower of Fortune` |
| `kite_festival_event` | `Kite Festival` |
| `dream_album_event` | **tell us what this is** — an envelope granted by the album itself? |
| `single_collection` | **tell us what this is** |

`Dream Heist` is Night Sky in our model — if no grants appear under it, send no rows for it rather
than a zero row. Same for Season Pass.

## 6. Build `data_col_season` now, with the chest columns EMPTY

No chest logging means `chests_bought_bronze_mean`, `chests_bought_silver_mean` and
`chests_bought_gold_mean` are **empty**. Not zero — empty. Same for `stars_spent_mean` if you only
have it as an inferred drop in balance; if you do send an inferred figure, name the column
`stars_spent_inferred_mean` instead so it cannot be mistaken for a measurement.

Everything else in that table you can already fill from the same per-player result you built for the
daily table, so please do.

## 7. Pack tier mapping — confirmed, with a check you can run

Your guess is right and it is the only sensible ordering:

| Game string | Our `pack_tier` | Cards per envelope |
|---|---|---|
| `common` | `1-star Pack` | 2 |
| `uncommon` | `2-star Pack` | 3 |
| `rare` | `3-star Pack` | 4 |
| `epic` | `4-star Pack` | 5 |
| `legendary` | `5-star Pack` | 6 |

Five names, five tiers, ascending. (We retired a 6th tier, so **if a sixth rarity name ever appears
in the logs, flag it** rather than folding it into `legendary`.)

**A check that validates the mapping rather than assuming it:** cards drawn ÷ envelopes opened, per
tier, should come out near the right-hand column above — 2 for `common`, rising to 6 for
`legendary`. If that ratio is flat, or inverted, the mapping is wrong. Worth running once.

Note also: our **card rarities** are a separate six-value scale (1★–6★) and are not the same thing
as these five envelope tiers. If the logs use the same words for both, keep them apart.

## 8. Cadence

Daily re-run is ideal. We only need the three tables re-exported; nothing downstream caches.

---

## Two things about our side that de-risk this for you

- **Our reader is header-driven.** It finds columns by name, so **column order does not matter and
  extra columns are ignored.** Send `players_in_cell`, `players_nonzero`, `event_id`, anything else
  you find useful — it costs us nothing.
- **`status` must read `MEASURED` on every row**, including rows that are entirely zeros. Our sheets
  currently hold placeholder rows marked `FAKE`, and `MEASURED` is the switch that tells the engine
  your data is real. A row of real zeros marked `MEASURED` is meaningful; the same row marked `FAKE`
  is ignored.

## What "thin is fine" means concretely

Send the three tables with:

- `data_col_daily` — however many days exist (1 today, 2 tomorrow). Zeros where measured zero.
- `data_col_season` — all 10 rows, chest and inferred columns empty.
- `data_col_envelopes` — only the rows that exist, `participation_rate` empty throughout.

We will wire the workbook against them today and the numbers will fill in on their own as the season
runs.
