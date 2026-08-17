# Follow-up round 6 — the config history you asked for, plus two integrity findings

Paste to the same query LLM.

---

All fourteen files export and load. Grid completeness is perfect everywhere I can check it:
`data_seg_beh` 10/10, `data_streaks` 10/10, `data_RM` 10/10, `data_econ` 130/130, `data_econ_daily`
2,730/2,730 (5 × 2 × 13 × 21), `data_core_spt` 40/40, `data_ns_rounds` 30/30, `data_event_inst`
170/170 — no missing cells, no duplicate keys, all five segments present in every sheet.
`player_days` reconciles against `data_seg_beh` to 0.00% in `data_ns_rounds` and `data_core_spt`, and
0.29% in `data_streaks`. Good.

Below: the config history you asked for, then two things worth a look.

## 1. The Night Sky config history — you already have it, it is my `NS` sheet

You are right that the ladder changed on 2026-08-14, and your observed pre-08-14 modal amounts match
my **pre-redesign** config exactly. So no archaeology needed:

| segment | R1 | R2 | R3 | | R1 | R2 | R3 |
|---|---|---|---|---|---|---|---|
| | **2026-07-27 → 08-13** | | | | **2026-08-14 → 08-16** | | |
| 1-9 | 0 | 10 | 15 | | 0 | 10 | 15 |
| 10-19 | 10 | 30 | 60 | | 10 | 35 | 70 |
| 20-39 | 15 | 50 | 100 | | 15 | 75 | 140 |
| 40-99 | 50 | 120 | 250 | | 60 | 160 | 300 |
| 100+ | 100 | 300 | 400 | | 125 | 350 | 500 |

That reproduces your observations: 1-9 → 10/15 (identical in both, which is why it never looked
odd), 10-19 → 10/30/60, 20-39 → 15/50/100, 40-99 → 50/120/250, 100+ → 100/…/250.

**`cum_streak_req` is not derivable from the event stream, as you found — here it is from config.**
It did *not* change on 08-14; only the coin amounts did:

| segment | R1 | R2 | R3 |
|---|---|---|---|
| 1-9 | 2 | 5 | 10 |
| 10-19 | 6 | 13 | 26 |
| 20-39 | 11 | 26 | 42 |
| 40-99 | 28 | 60 | 100 |
| 100+ | 80 | 175 | 280 |

Please make `round_map` date-ranged with those two tables and re-run. One consequence to keep in
mind: because the amounts differ between the two periods for 11 of the 15 (segment × round) cells, a
date-ranged map will also let you emit the two periods separately — if that is cheap, I would rather
have **two rows per cell (pre/post) than one blended row**, since the whole point of the sheet is to
calibrate against a specific ladder.

For reference, here is how much of the window the current sheet actually covers, which matches your
50% matched-claims figure:

- **Full 21 days (usable now):** 1-9 R2/R3, 10-19 R1, 20-39 R1 — the amounts are identical in both
  periods. These reconcile with my earlier A/B summary at 0.74–1.40×.
- **3 days only (understated ~7×):** everything else. The current numbers come out at 0.07–0.14× the
  A/B summary, which is exactly the 3/21 ratio — so the sheet is internally consistent, just
  truncated.

## 2. Rainbow Maker at 100+ — a second, independent proof it is wrong

I flagged this last round against the ladder ceiling. Two other sheets **in this same drop**
now confirm it without reference to any config:

`data_gains` carries no purchased currency at all (its `IAPs` rows are 0 in every cell), while
`data_econ` includes it. So `data_gains` totals must be **below** `data_econ` totals everywhere. They
are — by 1.5–3.3% for nonpayers and 22–39% for payers, exactly as purchased coins would predict —
**except at 100+, where `data_gains` is 17.0% (nonpayer) and 6.6% (payer) ABOVE `data_econ`.** That is
impossible for a free-only table.

Remove the Rainbow Maker rows and 100+ falls back in line with every other segment
(+17.0% → −32.8%, +6.6% → −51.6%). One category is carrying the entire anomaly.

## 3. A third thing at 100+, smaller: HC spend disagrees between two sheets

`data_spend_action` HC totals vs `data_econ` (`spend_per_earner × resource_earners`):

| segment | nonpayer | payer |
|---|---|---|
| 0-9 | −6.1% | −13.0% |
| 10-19 | −1.3% | −0.8% |
| 20-39 | −0.3% | +2.0% |
| 40-99 | −2.4% | −1.4% |
| **100+** | **+26.8%** | **+35.9%** |

Everything else sits within a few percent; only 100+ has spend_action *exceeding* econ. Given the
Rainbow Maker issue lands in the same segment, it may be one cohort-assignment bug rather than two
separate ones — worth checking whether some 100+ players are being counted twice, or assigned to
100+ in one query and elsewhere in another.

## 4. What I am NOT asking you to change

`data_gains` being free-only is correct for my purposes — my simulation models free faucets, so
please keep it that way. I only mention it because it is what makes the 100+ comparison above
conclusive.

Yes please to both of the items you offered: `payer_flag` on
`data_gains_ab_summary_wide`, and the within-tier SPT decline investigation.
