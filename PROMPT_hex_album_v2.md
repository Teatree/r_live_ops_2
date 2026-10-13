# Album data tables — corrected brief (supersedes the earlier album prompts)

We have since found the **production album SQL** that the live dashboards run
(`sqls/album_snaps_collected.sql`, `album_total_snaps_found_percentiles.sql`,
`album_set_completion.sql`, `album_card_rarity_per_envelope.sql`). Reading it against what you
built, and against what we asked for, turned up **eleven mismatches**. Most of them make your job
*smaller*, because the warehouse already has things we told you to build by hand.

Where this document and the earlier prompts disagree, **this one wins**.

---

## 1. `album_metrics_daily` DOES exist — stop rebuilding from raw events

You reported that `tmp_radekjanhuba.album_metrics_daily` "isn't visible from the Athena connection"
and rebuilt `album_actuals_player` from raw `DreamAlbum` rows in `client_events_view_event_progress`.

All four production queries read that table right now. So it exists and is in active use — this is
almost certainly a connection, catalog or permission problem on the notebook's side rather than a
missing table. **Please retry it** (and tell us the exact error if it still fails).

Why it matters: your rebuild is unvalidated against the dashboards everyone else reads, and the
table already carries breakdowns that are painful to reconstruct — envelope rarity, card rarity,
and pity probability among them.

Also available, and also in use:

- **`tmp_radekjanhuba.album_segmentation_daily`** — per player per day segmentation (see §2)
- **`hex_abgbproduction_174525b3.album_snaps`** — cards per album (see §7)

---

## 2. The segment we need already exists as a column: `level_completes_7d`

This is the big one. We asked you to rebuild a 7-day saga-completion average from
`client_events_view_level_summary`. **Don't** — `album_segmentation_daily` already has a
`level_completes_7d` column, and every production album query filters and splits on it.

```sql
SELECT event_date, event_id, player_id,
       CAST(level_completes_7d    AS varchar) AS level_completes_7d,
       CAST(spend_group           AS varchar) AS spend_group,
       CAST(spend_60d_percentile  AS varchar) AS spend_60d_percentile,
       CAST(spent_in_event        AS varchar) AS spent_in_event
FROM tmp_radekjanhuba.album_segmentation_daily
```

**Use `level_completes_7d` as `segment`.** That replaces everything in the previous prompt about
building the rolling average yourself, and it guarantees we are on the same axis as the dashboards.

> ⚠ **But verify the buckets before mapping.** The column *name* matches our axis; the bucket
> boundaries might not. Our labels are `0-9`, `10-19`, `20-39`, `40-99`, `100+`, cut on the 7-day
> **average completions per day** at `<10 / <20 / <40 / <100 / >=100`.
> **Please send us `SELECT DISTINCT level_completes_7d FROM album_segmentation_daily` with row
> counts** before you map anything. If the values are already those five labels, map straight
> across. If they are raw numbers or different bands, tell us and we will agree the mapping — do
> **not** relabel them to ours on a guess.

---

## 3. The payer flag: use the official spend column, don't recompute it

We told you to derive it from `player_daily.cumulative_money_spent`. The segmentation table carries
**`spend_group`**, **`spend_60d_percentile`** and **`spent_in_event`**, and the dashboards use
those.

**Please send `SELECT DISTINCT` + counts for `spend_group` and `spent_in_event`.** Our `payer_flag`
is binary — `PAYER` = paid anything at any point in the window, `NONPAYER` = never — so we need to
know which column collapses onto that, and how. Likely `spend_group`, but we are not guessing.

---

## 4. The denominator: ALL players in the cell, not the "qualified" ones

The production percentile query says:

> *Qualified players: those who have opened 2+ envelopes by the day (the intro envelope does not
> count); a player counts from the day they qualify.*

**That is not what we want.** Our simulation averages over **every** player in the cell, including
everyone who never touched the album. At ~6% engagement those two denominators differ by roughly
**16×**, so this single choice dwarfs every other number in the request.

So for our three tables: **mean and percentiles over all players in the cell**, zeros included. If
it is cheap, send the qualified-only version too as extra columns (`*_qualified`) — we would read
both — but the unsuffixed columns must be the all-players ones.

---

## 5. Cohort stability: fixed at day 1, and we know that differs from the dashboards

Two differences from the production queries, both deliberate on our side:

- They fix a player's segment to their **first day seen**; we asked for the **modal** segment.
- Their cohort **grows** through the season ("players seen so far … up to the day"); we asked you to
  **fix it at day 1**.

Our simulation runs a fixed cohort for the whole window — every simulated player exists from day 1
and is simply inactive on some days — so a growing denominator makes our comparison drift, and a
cumulative mean that *falls* on re-run reads as the data going backwards.

**Decision: fix the cohort at day 1, and fix each player's segment to their first day seen** (the
production rule, which is simpler than modal and stable from day 1). Please state in the notes that
this makes our tables **not** directly comparable to the production album dashboards, because the
denominators differ — that is a known, accepted cost, not something to reconcile.

---

## 6. Percentiles: we need p10 and p98 as well

Production reports **p25, p50, p75, p90, p95 + avg**. We need **p10, p25, p50, p75, p90, p95, p98 +
mean**, because our simulation reports exactly that set and we plot them against each other.

p10 and p98 are one more `APPROX_PERCENTILE` each. If p10 is 0 for every cell (likely at 6%
engagement) send the 0 — a measured zero is information. And keep your note about p95/p98 being
jumpy at small samples.

---

## 7. `albumPct`: use `album_snaps`, and let it pass 100

Three definitions are currently in play, all different:

| Where | Definition | Range |
|---|---|---|
| Production (`cards_found_pct`) | unique cards ÷ cards in **that** album × 100, cards-per-album from `hex_abgbproduction_174525b3.album_snaps`, with an `album` dimension | 0–100 per album |
| The old Hex notebook | `cum_value / 72.0 * 100`, hardcoded, no album dimension | 0–100 |
| **Our simulation** | albums completed × 100 **plus** progress through the current one | 0–∞ (130 = album 2 at 30%) |

**Fix:** take `cards_found_pct` for the album in progress and **add 100 per completed album**, using
the `albums_completed` measure. The card count comes from `album_snaps` — never hardcode 72, so a
config change cannot silently rescale the metric.

---

## 8. `balance` is not in `album_metrics_daily` — keep the raw field

`album_metrics_daily` has **`stars_gained`** (cumulative gains). Our `balance` metric is the stars a
player is **holding** at end of day, which goes **down** when they buy a chest. Those are different
series and only one of them is in the metrics table.

**Fix:** keep sourcing `balance` from the raw `album_stars_bal` field as you already did (last
reading of the day, carried forward). **And additionally** send `stars_gained` — it is what our
`data_col_season.stars_earned_mean` wants, and the difference between the two is the spend we
cannot otherwise see.

---

## 9. Envelope tiers: the official breakdown strings, reported not guessed

`album_metrics_daily` carries envelope rarity directly:

```
envelopes_opened   breakdown LIKE 'rarity:%'                      -- SUBSTR(breakdown, 8) = the rarity
snaps_gained       breakdown LIKE 'envelope:%|snap_rarity:%'      -- envelope rarity x card rarity
stars_gained       breakdown LIKE 'envelope:%'
```

**Please send `SELECT DISTINCT` on the parsed envelope rarity with opening counts.** We previously
agreed `common/uncommon/rare/epic/legendary → 1-star … 5-star`, and a new pull showed raw strings
like `EnvelopeCommon` / `EnvelopeRare` — so the vocabulary is probably right, but it should come
from the data and not from our table.

**The validation is now exact**, because `snaps_gained` crosses envelope rarity with card rarity:
cards per opened envelope, per tier, should come out **2, 3, 4, 5, 6** ascending. If it does, the
mapping is confirmed from the data alone.

---

## 10. Include `event_id`, and say which season it is

Every production query treats `event_id` as the season and always carries it as a column. Our tables
have no season dimension, and the last pull picked the season automatically ("the DreamAlbum event
with the most players in the last 35 days").

**Fix:** add `event_id` as an extra column on all three tables (our reader ignores columns it does
not know) and name the season and its date range in the notes. If two seasons ever overlap the
window, we would otherwise be averaging across both without knowing.

---

## 11. Card rarity is 1..6 — which matches us, and is worth one sanity line

Production reports `card_rarity` as `item = 1..6`. That matches our six card rarities (1★–6★)
exactly, and it is a **different scale from the five envelope tiers** — easy to conflate since both
are "rarity". Nothing to build for our three tables; just please keep them apart.

---

## Not a fix — an opportunity we did not know existed

`album_metrics_daily` logs **`pity_probability`** per opening, with items `'0.00'`, `'0.33'`, …

Our own config has a pity table of exactly `[0, 0.33, 0.66, 1.0]` on the 4-star envelope. We had
assumed the pity system was unmeasurable and deliberately excluded it from the model. If you can
send **openings by `pity_probability` value, per envelope tier**, as a fourth table or extra
columns, we can check the live pity ladder against the configured one for the first time. Low
priority next to the eleven above, but genuinely new information.

---

## Unchanged from the earlier prompts

Still correct, still wanted: the three table names and their column lists; `status = MEASURED` on
every row; **blank for unmeasurable, 0 for measured-zero**; `participation_rate` left **empty**;
chest columns empty; `players_in_cell` and `players_nonzero` kept; day 1 = the official calendar
start with pre-start activity folded into it; cumulative-not-daily; and omitting days you cannot
fill rather than sending zeros.
