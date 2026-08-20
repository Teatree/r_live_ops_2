# LiveOps 2.0 fixes — simulating changes ON TOP OF the variant

Separate, additive piece of work (2026-08-17). The existing `engine/`, `analysis/`, `harness/` and
`builders/` stack keeps running **unchanged** — it answers "v2 redesign vs Control". This folder
answers a different question:

> The variant is live. Given what it actually produced, what does a further change do?

## The three differences from the main stack

| | main stack (`engine/`) | this folder |
|---|---|---|
| baseline | pre-v2 live config, measured May, both arms | **the as-run variant** — variant-only data + base sheets holding the config it ran |
| change being priced | `*_v2` sheets | `*_v2` sheets (same as the main stack) |
| window | 33 days (the redesign plan) | **21 days** — the A/B test so far, 2026-07-27 → 2026-08-16 |
| measured anchor | `data_gains` from May, both arms blended | variant-only, over the same 21 days |
| resources | 19 (packs) in `engine/`, 13 in `engine/pre_collection/` | 13 (no packs) |

Everything else — the `measured × R × D × T` model, the calendar reader, the survival machinery, the
Season-Pass tier coupling, the D18 synthetic Core-SPT anchor — is deliberately identical. The whole
point is that only the *anchor* moves.

## Layout

```
liveops20_fixes/
  README.md                        this file — the spec, and the decisions behind it
  PROMPT_variant_data_request.md   hand this to the analytics LLM; it produces the variant-basis
                                   data_* sheets (and three new ones) and pushes them to the workbook
  engine/                          third engine copy, re-based: EcoGainsSim_v4.gs + _Daily + _PBP +
                                   simPerSegment. SIM_DAYS = 21, anchor = base sheets, proposal = _v2.
                                   Plus HCPerWin.gs (2026-08-18): standalone ECOGAINS_HC_PER_WIN(seg)
                                   — HC gain/spend per level win, per payer, from data_econ +
                                   data_seg_beh over the 21-day window (per-active-player basis;
                                   gain counts ALL HC inflows incl. purchases)
  _build_workbook.py               generates the complete variant-basis workbook (config layers,
                                   both calendars, empty data_* targets with exact headers, all
                                   display sheets) into display/
  _dump_mockdata.py                workbook -> mockdata json for the offline harness
  harness/                         _mock_run.js / _mock_daily.js / _mock_pbp.js for THIS engine
```

## Decisions (Garry, 2026-08-17 — 15 questions)

1. **Deliverable** — builder scripts emit a new workbook, not hand edits.
2. **Window** — 21 days, hardcoded (`SIM_DAYS`), day 1 = 2026-07-27. Revisit when the test extends.
3. **Config layers** — STANDARD pairing: `base` = the config the variant actually ran (the anchor),
   `_v2` = the proposal you author. **Revised 2026-08-18** (Garry): the original design shifted the
   pair up a layer so `_v3` was the authoring layer, which made editing a `_v2` reward silently do
   nothing — it moved anchor and proposal together, R stayed 1, diff stayed 0, no error anywhere.
   The remap is gone; there are no `_v3` sheets. What makes this stack variant-basis is the DATA and
   the base sheets, not a name shift.
4. **Calendars** — `cal_curr` = the as-run variant schedule, `cal_new` = the proposal.
5. **Folder** — `liveops20_fixes/` (no spaces), scripts + prompt + engine + harness.
6. **Engine** — third copy here; `engine/` and `engine/pre_collection/` untouched.
7. **Resources** — 13, matching workbook (16)/(17).
8. **Extra data asks** — Core-SPT (level-completion tokens), spend-by-action (the coin sink), NS
   per-round claim rates. These close the three blind spots the v2 analysis hit.
9. **Delivery** — the analytics LLM pushes straight to the new workbook's sheets, as today.
10. **Grain** — unchanged schema (per earner + `player_days`), variant-only, 21 days.
11. **Play-by-play** — fully re-based (window + anchor).
12. **Old pipeline** — untouched; this is additive.
13. **Sheet set** — everything the current workbook has.
14. **Segments** — the same six blocks (`A. 0` + the five bands).
15. **Verification** — conservation + identity gates (`_v2` ≡ base ⇒ every diff exactly 0), and the
    re-based engine must reproduce the current engine's numbers when pointed at the old inputs.

## Commands

```
python liveops20_fixes/_build_workbook.py            # -> display/LiveOps20_variant_basis.xlsx (78 sheets)
python liveops20_fixes/_load_data.py [--zip <drop.zip>]   # load the analytics CSVs + write the data_basis sheet
python liveops20_fixes/_dump_mockdata.py             # -> harness/_mockdata_variant.json (--borrow-data for a shell)
node   liveops20_fixes/harness/_mock_identity.js     # engine gates: reproduction, identity, conservation, layers
node   liveops20_fixes/harness/_check_built_workbook.js  # the generated workbook + engine, end to end
```

Both harnesses are GREEN as of 2026-08-17. What they prove:

- **Reproduction** — with `LAYER_REMAP = false`, `SIM_DAYS = 33` and the Wednesday weekend rule
  restored, this engine is **bit-identical to `engine/pre_collection` across all 2,306 cells**. The
  re-base introduced no drift; every difference you see later is a config difference.
- **Identity** — each `_v2` cloned from its base and `cal_new` = `cal_curr` ⇒ every anchored, carried
  and scheduled source diffs **exactly 0**. Only sources cut from the calendar move (removal
  semantics), by design.
- **Conservation** — the daily grids integrate to the 21-day totals to 8e-16.
- **Authoring works** — the necessary partner to the identity gate: editing `c_day_v2` moves the
  Daily Gift row, its diff stops being zero, and nothing unrelated moves with it. Without this, an
  engine that simply returned zeros would pass the identity gate.

## Order of work

1. `PROMPT_variant_data_request.md` → analytics LLM → variant `data_*` sheets. **Blocking.**
2. `_build_workbook.py` → import `display/LiveOps20_variant_basis.xlsx` as a NEW Google workbook,
   paste the four `.gs` files from `liveops20_fixes/engine/`, run **EcoGainsSim ▸ Precompute
   calendars**, then give that workbook's ID to the analytics LLM with the prompt.
3. Garry checks the base sheets match the config the variant ran, then authors `*_v2` proposals.
4. Re-run both harnesses before quoting any number.

## Data status (drop 4, `liveops_sim_tables_20260817_200757.zip`) — COMPLETE bar one sheet

Twelve of thirteen sheets in, all on the `Variant A` cohort over 2026-07-27 → 2026-08-16.
`data_RM`, `data_core_spt` (40 rows) and `data_spend_action` (158 rows) all landed and match their
requested schemas. Only **`data_ns_rounds`** is outstanding, blocked on the `m_round_current`
indexing ambiguity — the reply prompt gives a derivation that avoids the ambiguity entirely
(attribute claims to rounds by their HC amount, which is unique per round within a segment).

**May-vs-now sanity check (2026-08-17).** Compared the new variant data against the May snapshot and
against the independent 9-day A/B export. Verdict: **normal deviation everywhere except one cell.**

- Behaviour is essentially unchanged: levels/active-day +1.4% median, levels played +1.9%, minutes
  +1.6%, sessions and saga completes within 1%, win rate +2.1%, gift claim rate +0.7%; streaks within 8%.
- The HC faucet reproduces the A/B export for the middle segments (10-19 +2.2%, 20-39 +2.4%,
  40-99 −1.1% per active player-day).
- `active_days_mean` −22% with active *rates* +22–27% is the 21-vs-33-day window, not a real change.
- The large category moves (saga UL +105%, NS coins +234%, Target Day +251%, Chuck +431%, daily gift
  −21%) are the v2 redesign behaving as designed and match the A/B read-out.
- **BROKEN: Rainbow Maker coins at 100+.** 2,627.7 coins per recipient (PAYER) against a hard ceiling
  of 3 instances × 660 coins for a full ladder clear = **1,980** — 133% of the maximum possible. The
  same drop says the median 100+ participant reaches 12,451 of the 352,260 matchables a full clear
  needs (3.5%), and coins-per-recipient tracks ladder progress smoothly in the other four segments
  (0.3%→29, 0.7%→41, 1.2%→53, 1.9%→100), which predicts ~180–250 at 3.5%, not 1,749. Sent back for
  re-pull; **do not use RM coin numbers at 100+ until it returns.**
- Open question sent back: `payer_rate_pct` fell from 31–38% (May, whole population) to 18–22%
  (variant cohort). Internally consistent, so probably cohort composition rather than a bug.

**Two things this drop changed about the model:**

1. **The D18 synthetic Core-SPT anchor has stood down by itself.** `data_gains` now carries ten
   Core × SPT rows, so `measuredRow_` uses the measured value and stops synthesising `L × E_base`.
   That guess is retired for this workbook.
2. **The SP-panel assumption is measurably wrong.** Measured per-level SPT is 9.77 at 1-9 falling to
   5.90 at 100+, against the panel's segment-uniform 15.05 — 1.5–2.5× hot, and varying 1.65× across
   segments where the engine uses one scalar (`coreSptR_`). The measured difficulty mix is ~71/14/15
   → ~77/11/11, not the assumed 55/30/15. `coreSptR_` should be re-based on `data_core_spt`; until
   it is, any `_v2` proposal that touches per-level SPT is priced off the wrong table.
   Open question sent back: per-level SPT falls with engagement *within* a tier too (Normal
   7.66 → 4.73), which mix shift cannot explain — possibly a cap.

`data_spend_action` independently confirms the sink finding from the v2 analysis: every
`level_movesplus` rung costs exactly 100 HC/event and `level_movesplus5` alone is 75–84% of HC spend.
It is HC-only — `currency_use` carries no booster sink.

## Data status (drop 3, `liveops_sim_tables_20260817_193956.zip`) — superseded

**All eight delivered sheets are on the variant cohort (`Variant A`, 2026-07-27 → 2026-08-16).**
Each verdict below is computed by a self-contained test in `_load_data.py` — nothing depends on
remembering a previous drop — and is written into the workbook's `data_basis` first tab.

| sheet | basis | evidence |
|---|---|---|
| `data_gains` | VARIANT ✓ | HC totals tie to the summary's `Variant A` column to 0.00% |
| `data_seg_beh` | VARIANT ✓ | 510,866 player-days = 1.00× the variant cohort |
| `data_streaks` | VARIANT ✓ | 510,075 player-days = 1.0× `data_seg_beh` (was 9.5×) |
| `data_econ`, `data_econ_daily` | VARIANT ✓ | 66,439 HC earners = 0.6× `data_gains`; 21 `day_index` values |
| `data_event_inst` | VARIANT ✓ | max participation 0.69 of the cohort |
| `data_event_accrual` | VARIANT ✓ | max participation 0.63 per instance |
| `data_event_kite_accrual` | VARIANT ✓ | max participation 0.52 per instance |
| `data_RM` | **missing** | Rainbow Maker falls back to carried measured — RM proposals are inert |
| `data_core_spt`, `data_spend_action`, `data_ns_rounds` | missing | the three new asks |

Drop history: drop 1 was whole-population and 33-day throughout; drop 2 fixed `data_gains` and
`data_seg_beh` only (the other six came back byte-identical); drop 3 fixed the remaining six.

**Watch the participation check.** It divides by `n_instances` on the accrual sheets, because
`n_participants` there is pooled across every instance in the window — Night Sky runs ~90 instances,
so a raw ratio flags correct data as whole-population. That bug was in the checker, not the data.

**What is still not simulatable:** Rainbow Maker (no `data_RM`), and the three blind spots the new
sheets were meant to close — Core-SPT stays synthetic, there is still no sink model, and the Night
Sky reach curve is still uncalibrated.

## Rainbow Maker: carried (2026-08-17) → ANCHORED (2026-08-18, Garry's call)

The carried decision rested on "no RM change is planned". That premise died on 2026-08-18: Garry
authored RM reward edits (coins +5 on milestones 2 and 9, the m6 slingshot→red and m8
slingshot→chuck swaps, identical on both ladders) and asked for them to be priced **with T pinned —
the same schedule on both sides, not read from cal_new**. So RM is now ANCHORED, the same shape as
Night Sky in D22:

    SIM[res] = measured[res] x R[res],   R[res] = E_v2[res] / E_base[res]

with E = the reach-weighted expected ladder payout over ONE instance list — the as-run `cal_curr`
RM lane — priced by the same data_RM survival on both sides. Ladder pairs: `RM_1st`/`RM_1st_v2`,
`RM_2nd`/`RM_2nd_v2` (a missing or empty `_v2` falls back to base ⇒ R = 1, the standard
"unauthored = unchanged" convention). Switches: `RM_SIMULATE = false` + `RM_ANCHORED = true`;
`RM_SIMULATE = true` still restores the old bottom-up model (the reproduction gate uses it),
both false = the 2026-08-17 carried behaviour.

What the anchoring does and does not price:

- **Ladder edits flow** (rewards on any rung); requirement edits flow too (same survival, shifted).
- **Cadence does NOT flow, by design**: fewer/shorter cal_new RM instances leave the row untouched
  (T pinned 1). Full removal from cal_new still zeroes the row (removal semantics kept).
  A `_v2` EventDuration edit does not flow either — the survival axis is scaled by the BASE config
  duration on both sides (duration is a schedule lever, pinned with T).
- The 100+ measured coin over-count cancels inside R's shape but the diff still scales off the
  measured level (`diff = measured x (R-1)`), so **RM 100+ coin diffs inherit the over-count**
  until the re-pull lands.
- The RM_INSTANCE_SHEETS ordinal map (#1–#3 → RM_1st, #4–#5 → RM_2nd) now applies to the as-run
  lane. FLAGGED: the data (analytics ceiling framing + the AS_RUN seed) says **3 instances × 4d**
  ran in the window, which maps everything to RM_1st; the live workbook's lanes are drawn with 4
  instances (2+4+4+4d), whose #4 reads RM_2nd. With today's edits identical on both ladders the two
  readings move R[HC] by < 0.012, so the choice barely matters — but confirm the as-run lane from
  the LiveOps config before trusting SPTx2.

Gates (all green 2026-08-18): `_mock_identity.js` section F proves the anchored path is silent with
`_v2` clones, loud on an RM_1st_v2 coin edit, and **indifferent to a cal_new cadence edit**;
`_check_built_workbook.js` proves a fresh workbook ships neutral RM `_v2` twins (16 pairs) and
passes measured through. `EcoGainsSim_Daily.gs` still reads `RM_SIMULATE` at run time: anchored
mode places the single (measured x R) row by the generic p_day rule — conservation holds; the PBP
sim reads the `_v2` ladder on the cal_new side only, like NS.

## Two things that need your decision

**1. ~~Rainbow Maker should be re-anchored.~~ RESOLVED twice** — carried 2026-08-17 ("no RM change
planned"), then **re-anchored 2026-08-18** when Garry authored RM edits (see the section above).
The workbook-side wiring was completed 2026-08-18 (verified on the `(2)` export): `RM_1st_v2` /
`RM_2nd_v2` exist and carry the proposal, both base sheets are byte-identical to the as-run `(1)`
export, and the cached EcoGainsSim grid shows measured x R — the offline replication reproduces the
grid's RM sim cells exactly.

**2. The weekend rule changed, and it matters.** The 33-day plan calendars start on a Wednesday;
this window starts **Monday 2026-07-27**, so Fri/Sat/Sun are days 5, 6, 7 rather than 3, 4, 5. That is
now derived from one constant (`SIM_DAY_ONE_DOW = 1`) and gated against the real weekday of
`SIM_DAY_ONE`. If the window start ever moves, change that constant — a wrong weekend mapping
silently mis-weights every reach, and therefore every `T`, and skews the synthetic Core-SPT anchor.

## What the engine changes actually were

Deliberately minimal — all in `liveops20_fixes/engine/`. Note there is **no config-layer change**:
the sheet pairing is the standard `(base, base_v2)` every other copy uses. The variant basis comes
from the inputs.

1. **Modelling switches**, each documented at its definition: `RM_SIMULATE = false` +
   `RM_ANCHORED = true` (Rainbow Maker anchored since 2026-08-18 — see its section below),
   `JIGSAW_SIMULATE = false` (Jigsaw carried), `RIVER_RUSH_ZERO = true` (River Rush zero on
   both sides — the measured side via `measuredRow_`, the one choke point every consumer reads).
2. **`SIM_DAYS = 21`** replacing the literal 33 in the Core-SPT day loop, the Season-Pass season
   scaling and the calendar's last column. `DAILY_DAYS` and `PBP_DAYS` are separate declarations
   (Apps Script load order) and the harness gates that all three agree.
3. **`isWeekend_`** derived from `SIM_DAY_ONE_DOW` instead of assuming a Wednesday start.
4. **Auto-refresh covers the `_v2` sheets** — `refreshSims_`'s watch list is derived from the config
   registries (`CONFIG_PAIRED` / `CONFIG_SINGLE`) rather than hand-typed, so a config sheet cannot be
   added to the model and forgotten. Built lazily on first `onEdit`: those registries are declared
   later in the file, and a top-level IIFE would read them as `undefined` and silently produce an
   empty watch list — correct-looking source, dead behaviour.

## Known gap to close when the data arrives

`cal_curr` is supposed to be the **as-run** variant schedule, but the exports in hand only cover
2026-08-02 → 08-10 at event-day grain, so the as-run days for the rest of the 21-day window are not
derivable from data we already have. The builder therefore takes the as-run schedule from a small
editable table (`AS_RUN_SCHEDULE` in `_build_workbook.py`), seeded from `cal_new` plus the
divergences the sim-vs-actual work already established (Jigsaw ran ~Aug 7–10 against a plan of days
17–19; Bomb's Ballet ended ~Aug 2 against a plan of days 10–12). Confirm those from the LiveOps
config before trusting the `T` term.
