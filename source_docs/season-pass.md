# Season Pass (Dream Pass) — SPT track + Season Pass Challenge

Compiled 2026-07-10 from workbook `NEW_LIVEOPS_CALENDAR_ECO (10).xlsx` (`SP`, `SP_lb`, `data_gains`,
`data_event_inst`) and `design_pdfs/NESTABDB  Season Pass180526132518.pdf` (present, not yet mined
for mechanics beyond what the configs confirm). Simulated since 2026-07-10 per decision D16 —
`simSeasonPass` in `EcoGainsSim_v4.gs`, spec in `SIMULATION_PLAN.md` §2.17, methodology
`SIMULATION_METHODOLOGY.md` §6.11.

## Mechanics (CONFIRMED from config unless marked)

- **Season pass tokens (SPT / SPTx2)** are earned from events across the game and punch points
  into a 30-tier reward track. SPTx2 is the double-value token (INFERRED from naming; the engine
  weights it ×2 for tier progression, displays it as its own resource column).
- **The track (`SP` sheet):** title r1, track titles r2–3, headers r4, tiers r5–34, totals r35.
  Col A Tier, B `Incr real` (per-tier points), C `Cumul` (cumulative points: 10, 24, 44, …, 3,557).
  Cols D–W = FREE track rewards, X–AQ = PAID track rewards — both in the punch-card column set
  (`Coins | SPT | SPT x2 | Red | Chuck | Bomb | Slingshot | Shuffle | Comet | Unlimited Lives |
  Unlimited Red | Unlimited Chuck | Unlimited Bomb | Avatar | 1..6-star Dly`).
- **Track totals:** FREE — 130 Coins, 4 Red, 5 Chuck, 2 Bomb, 1 Slingshot, 2 Shuffle, 165 UL Lives
  min, 35 UL Red min, 15 UL Chuck min. PAID — 300 Coins, 4 Red, 3 Chuck, 5 Bomb, 4 Slingshot,
  4 Shuffle, 4 Comet, 600 UL Lives min, 50 UL Red min, 65 UL Chuck min, 35 UL Bomb min, 1 Avatar.
  **Both tracks pay 0 SPT / 0 SPTx2** — no feedback loop through the track config.
- **Season Pass Challenge (`SP_lb` sheet):** a rank leaderboard, Config Panel `Leaderboard Size`
  = 50 (B3), headers r6, ranks r7–21 (Rank 1..15 rewarded). Coins pot 1,700 (500/300/200/175/150
  then decreasing); SPT/SPTx2/booster/COOP columns all 0 in the current ladder.
- **Telemetry name:** `Dream Pass` in `data_event_inst` — but its rows are EMPTY (participation 0,
  position/balance percentiles blank except one stray row). No usable placement or progression
  telemetry today.

## Who grants SPT (measured, `data_gains` workbook (10))

Per-earner SPT over the 33-day window (NONPAYER, sum SPT + 2×SPTx2 across categories):
118.15 (0-9) / 173.18 / 223.26 / 318.65 / 338.92 (100+); PAYER 133–416. Contributing categories:
`Other` (largest single share, 36–152/earner, carried), Level Race, Kite Festival (rank ladder,
positions 1–25 of 60; `Ki_v2` cuts the pot 2,960→1,890), Flock Flurry (20/win, carried), River
Rush (removed in cal_new → its SPT deletes), Flash Race (its real payout; HC ≈ 0 is correct),
Bomb's Ballet, Target Day (0-amount rows), Team Event/Race, Season Pass (Free) itself (~3–9/earner
— likely the challenge bucketed under the category; the track pays no SPT), Daily Gift + IAPs +
Rainbow Maker (SPTx2).

## Simulation model (D16 — see §2.17 / §6.11 for the full spec)

`SIM[res] = measured[res] × cum_v2(T_sim)[res]/cum_base(T_meas)[res] × R_challenge[res] × T` (D=1),
where T_meas/T_sim = tier reached by the per-earner SPT window totals (measured vs simulated,
× seasonDays/33) on the `SP`/`SP_v2` Cumul ladder; cum = FREE track for NONPAYER, FREE+PAID for
PAYER; R_challenge = `SP_lb_v2`/`SP_lb` pot ratio (zero-sum). No anchor: tiers gained → add the
absolute `SP_v2` rewards of tiers (T_meas, T_sim]; otherwise carry. `SP_v2`/`SP_lb_v2` missing →
base sheets serve both sides. A. 0 fully carried. Worked (40-99 NP, workbook (10)): tier 8 → 6;
Chuck ×0.5, UL Lives ×0.8, Coins ×1, own SPT carried.

## Gaps / open questions

1. **Paid-track-in-measured (ASSUMPTION):** the measured category is labelled 'Season Pass (Free)'
   but PAYER rows are scaled with FREE+PAID cums, presuming the telemetry folds paid-track claims
   into the same category. Unverified — a Query-LLM split (free vs paid claims) would settle it.
2. **Dream Pass telemetry is empty** in `data_event_inst` — no position pricing for the challenge
   (pot ratio used instead) and no independent validation of the tier mapping. Re-request if fixed.
3. **Season length unknown:** `Season Length (days)` config labels on SP/SP_v2 (to be added
   Google-side) drive the points scaling; until then seasonDays = 33 (window = season). The
   `Dream Pass` `n_instances = 4` in the (empty) telemetry hints seasons may be ~8 days — worth
   confirming before trusting tier magnitudes.
4. **Measured SP SPT with a 0-SPT track:** ~3–9 SPT/earner sits under 'Season Pass (Free)' although
   the track pays none — presumed Season Pass Challenge payouts; carried on both sides.
5. **PBP:** the session sim tracks SPT/SPTx2 as event payouts only; season-pass tier claims are not
   simulated there.
6. **Repo SQL:** the SPT/SPTx2 CTEs in `resource_share_by_category_period_v2.sql` remain commented
   — the delivered `m_item` identifiers aren't recorded in the repo. Confirm before any re-run.
