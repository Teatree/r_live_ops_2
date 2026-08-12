# Prompt — three companion result sets for the LiveOps v2 A/B read-out (players, balances, denominators)

Paste this to your query LLM **together with the query that produced
`resource_gains_by_source_detail_802C_9-day_total` and `resource_spend_by_sink_802C_9-day_total`**
(so it reuses the exact same window, cohort, arm assignment, segmentation and filters).

---

You wrote my existing LiveOps v2 A/B resource-gains and resource-spend exports (pasted below).
They gave me a complete **flow** ledger — every resource, from every source, into every sink — and
it answered most of what I asked. Three things it structurally cannot answer, because of how it is
grained, and I need three **new companion result sets** for them.

Everything below must reuse the *identical* player cohort, `ab_group` assignment, segment definition
and filters as those two queries. **Do not redefine any of those** — derive all three result sets
from the same base CTEs. Keep them as three separate queries/files; do not modify the existing
exports.

## Data cleaning — inherit it, do not re-invent it

**This is the single most important instruction in this document.** The exports I am working from
have already had filtering and data cleaning applied — some of it inside the pasted queries, some of
it in steps you have never seen. The three new result sets have to sit alongside those exports and
reconcile against them to the unit. If your cleaning differs from theirs by even one rule, every
comparison I make between the old and new data is silently wrong, and it will look like a finding
rather than a bug.

So:

1. **Take every cleaning and filtering rule from the pasted queries verbatim** — cohort definition,
   geo exclusions, orphan-account handling, `max_level` floor, amount caps, bot/QA/internal-account
   exclusions, refund or chargeback handling, de-duplication, null handling, and anything else they
   do. Reproduce them exactly, in the same order, even where a rule looks redundant or wrong to you.
   Do not "improve", simplify, tighten or modernise any of them.
2. **If a rule in the pasted queries looks like a bug, do not fix it — tell me about it** and apply
   it as-is anyway. I would rather have two datasets that agree and one known bug than two datasets
   that disagree for reasons nobody can find later.
3. **If you cannot tell from the pasted queries how something was cleaned** — most likely because it
   happened in a step outside them — **stop and ask me, rather than choosing a default.** Assume
   there is a rule you cannot see. A reasonable-looking guess here is the worst outcome available,
   because it produces plausible numbers that do not reconcile and gives no signal about why.
4. **List back, before the SQL, every cleaning rule you applied and where you got it from** (which
   pasted query, which line). That list is how I check you inherited the same rules I applied
   upstream; it matters as much to me as the queries themselves.

The one deliberate exception is the exclusion-rule symmetry described immediately below — that is a
change I am asking for explicitly, and it is the only place where you should depart from what the
existing exports do.

## The window — read this before writing anything

The existing exports cover **2026-07-26 … 2026-08-03** (9 days). These three result sets must run to
the **latest complete day available**, i.e. **2026-07-26 … 2026-08-10** inclusive (16 days) as of
writing. Exclude today (2026-08-11) — it is partial and would drag every per-day rate down.
If more days have landed by the time you run this, extend the end date to the newest complete day
and tell me what it was.

Emit a `window_tag` column on **every** row of all three result sets:

- `'D1_9'` for `event_date` in 2026-07-26 … 2026-08-03 — the original 9 days
- `'D10_PLUS'` for 2026-08-04 onward

and emit each aggregate **three times**: once per `window_tag`, plus a `'FULL'` row covering the
whole span. Do not pool the two periods into a single number without also giving me the split.

**Why the split matters.** I do not know whether the LiveOps calendar rolled over after 3 Aug. If a
different set of events is live in the later days, then those days are a different treatment and
pooling them would blur the exact effects I am measuring. The split lets me check that before
deciding to pool. It also keeps the `'D1_9'` rows reconcilable against the eleven existing exports —
which is what the acceptance checks below test, so **run those checks against the `'D1_9'` rows
specifically**.

If you can see from the event/config tables that the calendar or the arm split changed at some point
in this span, **say so and give me the date** — that is more useful than any column requested below.

One global change vs. the existing exports: wherever those queries apply the `hc_excluded_players`
rule, apply it **symmetrically to both arms** here, and emit the excluded-player count per
(segment, ab_group) as a column so I can see what the rule removed. In the existing exports it drops
~12% of the Variant's `F. 100+` and 0% of Control's, which makes those cells non-comparable.

---

## Result set A — `ab_player_dist`: distinct players and the distribution behind each cell

**Why I need it:** every column in the current exports counts *days* or *events* —
`player_days`, `gainer_days`, `spender_days`, `spend_events`. There is no distinct-player count
anywhere and no per-player distribution, so a mean is the only statistic available. At `F. 100+`
(~300 players/day) that is not enough: the single largest finding in my read-out rests on 33
spender-days that may be one or two accounts, and I could bound it by magnitude but never count it.

Grain: **segment × ab_group × resource × window_tag** (rolled over the window; no per-day rows).
Emit a row for every combination present in the gains or spend ledger, including zero cells.

Note that distinct-player counts are **not additive across `window_tag`** — the same player is
active in both periods, so `players` in the `'FULL'` row is smaller than the two period rows summed.
That is correct and is precisely why I need the `'FULL'` row computed independently rather than
added up.

| column | meaning |
|---|---|
| `segment`, `ab_group`, `resource`, `resource_category`, `unit` | same values/labels as the existing exports |
| `window_tag` | `D1_9` / `D10_PLUS` / `FULL` (see the window section above) |
| `players` | **distinct players** active in the window in this segment × arm (the denominator; identical across all resources of that key) |
| `gainers` | distinct players with gain > 0 of this resource in the window |
| `spenders` | distinct players with spend > 0 of this resource |
| `excluded_players` | distinct players removed by the exclusion rule for this key (see the symmetry note above) |
| `gain_total`, `spend_total` | window totals, so this set reconciles against the existing exports |
| `gain_per_gainer`, `spend_per_spender` | totals ÷ the distinct counts above — **not** ÷ gainer-days |
| `gain_p50/p75/p90/p99`, `spend_p50/p75/p90/p99` | per-player distribution over `players` (a player with no gain/spend contributes 0) |
| `net_p10/p50/p90` | per-player **net** distribution — compute each player's `gain − spend` first, **then** percentile. Do not difference the gain and spend percentiles. |
| `top1_share`, `top5_share`, `top10_share` | share of the segment's total spend (and a parallel set for gain) contributed by the top 1 / 5 / 10 **players**. This is the concentration measure I actually need — it tells me directly whether a cell is one whale. |
| `spend_events_per_spender` | `spend_events ÷ spenders` — purchases per buyer, distinct from the current rows-per-player-day |

**Acceptance checks** (verify before delivering):
- On the **`'D1_9'` rows only**: `gain_total` per (segment, ab_group, resource) must equal
  `amount_gained` in `resource_gains_by_source_detail_802C_9-day_total` summed over `source_detail`,
  to the unit. This is the check that proves the new queries and the old exports agree; it cannot
  work on the extended window, which has no counterpart export.
- `player_days ÷ players` must land in a plausible attendance range — at most 9 on the `'D1_9'`
  rows, at most the day-count of the period on the others. Anything above that means the cohort join
  is wrong.
- `gainers ≤ players` and `spenders ≤ players` in every row.

If percentiles over the full player set are expensive, `approx_percentile` is fine — flag which
columns are approximate.

---

## Result set B — `ab_balance_daily`: the stock behind the flows, and consumption of what has no sink

**Why I need it:** the current exports are pure flow. Net position (`gain − spend`) is not wealth,
and the one 100+ effect I expect to survive a rerun is **rationing** — fewer purchases per buyer at
an unchanged price — which is driven by balance, not by flow. I have no systematic balance read
across segments or across the nine days. Worse: **Unlimited Lives is +23.5% at 100+ with literally
zero rows in the spend ledger**, because it is granted in minutes and has no sink. It is the
resource carrying the single largest economic change in the test (the saga reward-mix swap), and I
cannot tell whether those minutes are used or expire unused.

**B1 — balances.** Grain: **event_date × segment × ab_group × resource**, every day in the window.
This one is already daily, so `window_tag` is just a label on each row — but keep it, so I can
group without re-deriving the date ranges. A balance series is most useful unpooled anyway: I want
to see the shape across all 16 days, including whether it flattens after 3 Aug.

| column | meaning |
|---|---|
| `event_date`, `segment`, `ab_group`, `resource`, `unit` | as above |
| `players` | distinct players active that day in that key |
| `balance_open_p25/p50/p75/p90`, `balance_close_p25/p50/p75/p90` | per-player balance at day start / day end. If only one snapshot per player-day exists, emit it once as `balance_eod_*` and say so. |
| `balance_mean`, `balance_zero_share` | mean balance, and the share of players sitting at a balance of 0 (the rationing signal — a rising zero-share with flat spend means players are constrained, not disinterested) |

Take balances from the daily aggregate table (the same place `hc_gain`/`hc_spend` come from), not by
cumulating `client_events` — I want the game's own balance, including anything the flow ledger
misses. If the two disagree, **emit both** (`balance_reported` vs `balance_derived`) rather than
picking one; the gap is itself informative.

**B2 — grant vs. consumption for the sinkless resources.** Grain:
**segment × ab_group × resource × window_tag**, restricted to `Unlimited Lives`, the three
`UL <bird>` resources, and `Dream Pass tokens` — every resource that appears in the gains ledger
with no corresponding sink rows.

| column | meaning |
|---|---|
| `granted` | total granted in the window (minutes for UL, tokens for Dream Pass) |
| `activated` / `consumed` | actually used — UL minutes that started ticking, tokens redeemed against a Season Pass tier |
| `expired_unused` | granted and never used before expiry or window end |
| `overlapped` | UL minutes granted while an existing UL timer was still running (i.e. granted on top of itself and worth nothing) — if this is derivable at all, it is the number I most want |
| `pct_consumed`, `pct_expired`, `pct_overlapped` | the three as shares of `granted` |

If `overlapped` is not derivable from the event stream, say so explicitly rather than approximating
it — I would rather have a documented hole than a number I trust wrongly.

---

## Result set C — `ab_denominators`: engagement and revenue on the same cohort

**Why I need it:** `amount_per_active_player_day` is my unit throughout, so **every conclusion in
the read-out is conditional on the denominator being stable between arms** — and I have no way to
check that from the exports themselves. If the Variant changed who is active, or how often, then a
per-player-day figure moving is ambiguous between "the economy changed" and "the population did".
Separately: I can currently say what the Variant did to the faucet, but not whether that was
*good*. A hard-currency faucet cut that holds retention and revenue flat is a success; the same cut
that costs 2% D7 is not, and nothing in the eleven files distinguishes them.

Grain: **event_date × segment × ab_group**, plus one total row per segment × arm × `window_tag`
(flagged with a separate `is_total` boolean — do not overload `event_date` with a `'TOTAL'` string,
it breaks the date parsing downstream).

This is the result set where the extended window earns its keep: `d7_retention` needs seven days
after assignment to exist at all, so on the original 9-day window it was only measurable for the
earliest-assigned players. Report retention per **assignment cohort** and mark any cohort whose
observation period is incomplete as null, not zero — a partially-observed D7 that silently reads
low is worse than a missing one.

| column | meaning |
|---|---|
| `players_active`, `players_assigned` | active that day, and total assigned to the arm in that segment — **both**, so I can see activation rate, not just behaviour among the active |
| `activation_rate` | `players_active ÷ players_assigned` |
| `d1_retention`, `d3_retention`, `d7_retention` | measured from arm assignment date, not from install |
| `sessions_per_active`, `session_minutes_per_active` | engagement depth |
| `levels_attempted_per_active`, `levels_completed_per_active`, `level_win_rate` | the progression read — this also tells me whether the completion buckets are migrating |
| `bucket_at_assignment` | the segment the player occupied at arm assignment, so this set can be re-cut on a **frozen** cohort (completion bucket is an outcome the Variant changed; the existing exports segment on the current bucket, which is self-selected) |
| `iap_revenue`, `iap_revenue_per_active`, `payers`, `conversion_rate`, `arppu` | the revenue read on the same cohort and window |
| `hc_purchased_per_active` | HC acquired via IAP specifically, split out from the free faucet — the existing exports carry `amount_gained_free` / `amount_gained_paid` but I want it on this cohort basis too |

**Acceptance check:** `players_active` per (event_date, segment, ab_group) must reconcile with
`segment_players` in the daily exports **for the dates those exports cover**, and summing it over
2026-07-26 … 2026-08-03 must reproduce `player_days` in the 9-day totals. If it does not, the two
queries disagree about who is active and I need to know that before anything else.

---

## Project gotchas — apply all of these (same as the other economy queries)

These are a **floor, not the list**. They are the rules I happen to know to write down; the pasted
queries are the authority, and where the two differ, the pasted queries win. Applying everything
here and nothing else is not sufficient — see the data-cleaning section above.

- Schema `abgbproduction_174525b3_gdpr`.
- **HC must come from `player_daily.hc_gain` / `hc_spend`** (or the equivalent daily-aggregate
  columns) — do **NOT** sum HC from `client_events` currency amounts: those are capped at 0–9999 and
  silently zero large grants. This applies to the balance columns in B1 too.
- Standard cohort filters, identical to the existing A/B exports: geo `NOT IN ('FI','PL')`, exclude
  orphan accounts, `max_level > 200`.
- Cast `processdate` to INT for partition pruning.
- No `COUNT(DISTINCT)` inside a window function. `ARBITRARY()` is non-deterministic — do not use it
  where the result must be stable. `event_tokens` is a MAP on the level-summary view.
- Night Sky is logged as **Dream Heist** (`dreamheist_event`).
- Keep segment labels byte-identical to the existing exports (`A. 0`, `B. 1-9`, `C. 10-19`,
  `D. 20-39`, `E. 40-99`, `F. 100+`) so everything joins.

## Deliverable

In this order:

1. **The cleaning-rule list first**, before any SQL — every filtering/cleaning rule you applied and
   which pasted query you took it from, plus anything you had to ask me about. See the data-cleaning
   section; this is not a formality, it is how I verify the new data is comparable to the old.
2. **Three separate SQL queries** — `ab_player_dist`, `ab_balance_daily` (B1 + B2, two queries if
   cleaner), `ab_denominators` — each with the `HEADER_NOTES` doc-string describing every column, in
   the same style as the existing exports.
3. **Per result set, which requested columns you could not produce and why** (missing table, no
   expiry event logged, cost). A documented hole is worth more to me than a plausible-looking
   substitute, because I will otherwise build an argument on top of it.
