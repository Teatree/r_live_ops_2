# Hex notebook to build: **TOWER OF FORTUNE / Mighty Doors actuals**

Hand this whole file to the analytics LLM. It describes one Hex notebook whose job is to produce
**two output tables, named exactly as written here**, which get exported to two sheets of the same
name in our simulation workbook.

> **Read this first — it is different from the album request.** The existing
> `tof_simulation_notebook` contains **no warehouse queries at all**. It is a pure forward
> simulation: a million synthetic players, two behavioural parameters drawn from power laws, and a
> hand-typed table of per-stage pig probabilities and reward options. Nothing in it is measured.
>
> So this notebook is being built from scratch, and **step 1 is discovery**: find out what the
> warehouse actually records about Tower of Fortune runs. Treat the schema below as what we want,
> not as something you can assume exists. If a column cannot be sourced, leave it out and say so —
> a missing column leaves our engine on a documented assumption, whereas a proxy is
> indistinguishable from a measurement and will move balancing decisions.

The event is called **Tower of Fortune** in our model and **Mighty Doors** in the design docs.
Check both names, plus whatever internal event id the `client_events_view_event_progress` view
carries for it, the same way the album notebook resolves its event ids.

---

## The two tables (these names are a contract)

| Table / sheet | Grain | Rows (expected) |
|---|---|---|
| `data_tof_runs` | `segment × payer_flag` | exactly 10 |
| `data_tof_stages` | `stage_n × door_outcome` | ~60–70 |

## Key spellings — a mismatch makes a whole table read as zero

| Column | Allowed values |
|---|---|
| `segment` | `0-9`, `10-19`, `20-39`, `40-99`, `100+` — bucket on profile level at event entry, exactly as the album notebook's `level_bucket` does |
| `payer_flag` | `PAYER`, `NONPAYER` — `cumulative_money_spent > 0` before the event start |
| `door_outcome` | `reward`, `pig`, `empty` |
| `status` | `MEASURED` on every row |

Reuse the album notebook's proven building blocks for the keys: event start day from
`MIN(event_start_time)` on `client_events_view_event_progress`; profile level via
`MIN_BY(player_profile_level, o_ts)`; payer flag via `MAX_BY(cumulative_money_spent, …)` on
`player_daily` preferring the last reading **before** the event start. Those three are the same for
every event and are already correct — do not re-derive them differently here.

---

## Table 1 — `data_tof_runs`

One row per `segment` × `payer_flag` (10 rows).

| Column | Meaning |
|---|---|
| `segment`, `payer_flag` | keys |
| `runs_played_mean` | ToF runs **started** per player over the window |
| `runs_banked_mean` | runs that ended in a successful cash-out per player |
| `bank_rate` | banked ÷ played. Give it 4 decimals |
| `mean_stage_reached` | mean deepest stage reached, **across all runs including the ones that died** — a run that met a pig at stage 3 is exactly what pulls this down and is the reason to look at it |
| `stage_reached_p50`, `stage_reached_p90` | the distribution of how deep runs get |
| `continues_bought_mean` | continues purchased per player |
| `coins_spent_continues_mean` | coins spent on continues per player. **We need this separately** — it is a sink, and we currently double-count it in one place |
| `topups_bought_mean` | mid-run coin top-up purchases per player (if the game offers them) |
| `tickets_earned_mean` | entry tickets received per player, from **all** sources |
| `tickets_unspent_mean` | tickets still held at the end of the window |
| `cashout_stage_p50` | the stage players actually **choose** to cash out at. This is the headline number for us (see below) |
| `status` | `MEASURED` |

> **Why `cashout_stage_p50` matters most.** Our model reads a **fixed authored cash-out stage per
> segment** off a config sheet — currently stage 10 for every real segment, which is an assumption
> nobody has checked. The colleagues' simulation instead has players decide adaptively from a
> drawn coin budget. Both cannot be right. One measured median cash-out stage per segment settles
> which shape to use, and is worth more to us than every other column in this table combined.

---

## Table 2 — `data_tof_stages`

One row per `stage_n` × `door_outcome`. **Long format. Emit every stage 1..N even where almost
nobody reached it** — a zero `picks` is information ("reached by nobody"), a missing stage row is a
hole in the schema.

| Column | Meaning |
|---|---|
| `stage_n` | 1-based stage number |
| `stage_type` | `Safe (Start)`, `Standard`, `Safe`, `Milestone` — exactly as the ToF sheet spells them — or your own labels, listed in the notes |
| `doors_shown` | how many doors were presented at that stage |
| `door_outcome` | `reward`, `pig`, `empty` |
| `picks` | times a door of that outcome was chosen |
| `pick_share` | picks ÷ all picks at that stage |
| `survive_rate` | share of players who survived that stage |
| `status` | `MEASURED` |

Not segmented, on purpose: we model the door distribution as a property of the event, not of the
player. If it does differ by segment, that is a finding worth a note.

Our authored ladder has **no `empty` doors at all** — 140 doors over 35 stages, 113 `reward` and 27
`pig`. So if the logs only ever show those two outcomes that is agreement, not a gap; an `empty`
appearing would be a config change worth flagging.

> **What we are checking with this table.** Our model derives survival from the authored door
> layout — `survive = 1 − pigs / non-empty doors` — so a stage with one pig behind four doors is a
> 75% survival. The colleagues' notebook instead hardcodes a per-stage pig probability table with
> values of 0%, 25%, 33% and 50%, and makes every 5th stage pig-free. **Those two disagree**, and
> `pick_share` + `survive_rate` per stage is what tells us which matches the live game. If the
> live pig rate is a flat 1-in-4 by door count, our derivation is right; if it steps 25→33→50 with
> depth, theirs is.

---

## Warehouse notes and standard filters

Same conventions as every economy query in this project (`Event_Eco_Investigation_Context.md`):
`geo NOT IN ('FI','PL')`, exclude orphan accounts, `max_level > 200`; **derive coins from
`player_daily.hc_gain`**, never from the event payload — `client_events` currency amounts carry a
0–9999 cap that silently zeroes large grants, which would hit `coins_spent_continues_mean`
precisely because continue costs climb to 2,000 each. Athena/Trino: cast `processdate` to `INT`
for partition pruning; no `COUNT(DISTINCT)` inside a window; `ARBITRARY()` is non-deterministic.

Window: the collection season is **28 days**; use the same window the album pull uses so the two
tables describe the same players.

## Three traps we have already been bitten by

1. **A rate that rounds to `0.0`** is indistinguishable from "no telemetry" and makes our reader
   price at full rate. `bank_rate` and `pick_share` need 4+ decimals, or send numerator and
   denominator.
2. **Counts must be players, not rows.** State the denominator for every `*_mean` column — and say
   whether it is all players in the cell, or only those who played ToF at all. We want **all
   players in the cell** (the same denominator the album tables use), so a cell where only 5% touch
   ToF should show a small `runs_played_mean`, not a large one.
3. **No one-sided exclusions.** If a filter drops players unevenly across segments, say so.

## Deliverable

Both tables as named above, each as its own Hex output, plus the SQL, row counts, and a notes block
covering: **which tables and columns you found for ToF at all** (this is the discovery step — tell
us what exists, even the parts you did not use); the exact date window; any column you could not
produce and why; the player denominators; the stage-type labels you used; and whether the door
distribution looked segment-dependent.

If ToF telemetry turns out not to be instrumented per stage, say that plainly. "Runs and cash-outs
exist, per-door picks do not" is a useful answer and we will keep the authored door layout — what
we cannot use is a per-stage table reconstructed from an assumption.
