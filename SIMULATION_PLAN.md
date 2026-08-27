# ABDB LiveOps Eco Sim — PER-SOURCE SIMULATION PLAN v3 (build-ready)

Verified against `NEW_LIVEOPS_CALENDAR_ECO__4_.xlsx` (46 sheets — `data_RM` now present; Saga re-run
landed in `data_gains`; BB and Flash Race config fixes persist; calendars unchanged), `EcoGainsSim.gs`,
`1__Rainbow_Maker_Sim.xlsx`. All labels, values, diffs below re-read from this file.

---

## 0. DECISIONS LOG (cumulative, current state)

| # | Item | Status |
|---|---|---|
| D1 | Flash Race ≈ 0 measured | ✔ Real (1h event, few winners). Anchor accepted; Level Race anchor stands. |
| D2 | Saga category | ✔ **DONE.** `source_sub1 = 'saga_progression'` added to the Saga branch; re-run landed. Conservation verified: old Core = new Core + new Saga exactly (0-9 NP: 88.16 = 19.88 + 68.28) — the saga HC had been sitting inside **Core** (not 'Other'). Saga HC/earner now: 68.28 / 142.94 / 246.47 / 527.45 / 899.31 (B→F, NONPAYER); A.0 = 0.72. |
| D3 | Target Day | ✔ Pure leaderboard today (milestones intentionally pay 0). Leaderboard path; the ~2× cadence result is correct. |
| D4 | River Rush | ✔ Removed from the new calendar → SIMULATED = 0, DIFF = −measured (always negative; up to −102.6 HC/earner @100+ NP). **Revised per review:** RR keeps a REAL simulator, not a hardcoded zero — it runs the calendar-driven path and outputs 0 *because* `cal_new` contains no RR instances. If RR instances or configs are added later, it re-simulates with no code change (see 2.12 branches). |
| D5 | Config-vs-calendar conflicts | ✔ Fixed in-sheet and re-verified in v4: `BB` 4→3; `Race_v2` Flash = 1d. Zero conflicts. |
| D6 | RM matchables | ✔ `data_RM` sheet present: `segment | payer_flag | avg_matchables_window | p10..p90_matchables_window`, 10 rows, values = matchables per player per ONE 4-day RM window. In-code fallback map deleted. |
| D7 | RM method | ✔ Survival-weighted milestone sum over the full percentile distribution (not p50 step). |
| D8 | 0-9 segment | ✔ **DECIDED (review):** every non-gains "0-9" dataset (behaviour, accrual, matchables) already describes **B. 1-9 players only** — A.0 players are excluded from those queries because they don't meaningfully play. So the simulated `0-9` segment anchors to `data_gains` label **`B. 1-9`** (no merge; `MERGE_0_9` concept dropped). **A. 0 is excluded from the simulation but NOT lost:** it gets its own carried-and-annotated appendix block (§3) so its gains stay accounted for. |
| D9 | Saga display row | ✔ NEW: Saga exists in the data but not in `EcoGainsSim_HC`. Add `'Saga'` to `CATEGORY_ORDER` (between `River Rush` and `Season Pass (Free)`) → 25 category rows per block (8–32; fits the 28-row block spacing with one spare row). `Core` row becomes pure carry; `Saga` row shows the nerf as its own line. |
| D10 | `c_saga_v2` r19 `#REF!` | ✔ Waived by request — excluded from the zero-formula-error gate (that sheet, that row only). |
| D11 | RM `Chest` column | ✔ Visual element only; the reward columns fully describe every milestone. Flag dropped. |
| D12 | Live-config principle | ✔ NEW (review): configs of these or other sources may still change. **Nothing numeric lives in code** — every function reads its config sheet, calendar, and `data_*` sheet at run time, so any config/calendar edit re-simulates automatically on recalc. |
| D13 | Night Sky | ↺ **SUPERSEDED by D22 (2026-08-05): NS is now ANCHORED on `NS` vs `NS_v2` (`measured × R × T`) — the "do NOT model it off the measured anchor" rule below no longer holds; the survival model survives only as the E term behind R.** Earlier: ⏸ **ON HOLD (2026-07-02): the bottom-up sim's output was judged wrong — NS is CARRIED again** (= data_gains measured, diff 0). `simNightSky` stays in `EcoGainsSim_v4.gs` but is commented out of the SOURCES registry; §2.16 remains the spec to rework against. Original decision: **SIMULATED, bottom-up** (was carried). NS runs as an A/B test today, so measured `Daily Night Sky Prize` is test-diluted — do NOT model it as a change off the measured anchor (no R×D×T). Instead price the configured ladder for the whole population, per the `1_DAY_NS_TD_5_Segs_V3` method: survival over the daily win-streak distribution × the segment's own ladder × expected active days. SIMULATED = full-rollout value; DIFF = sim − (diluted) measured = the rollout effect. Live config (`NS`==`NS_v2`, sheet "Night Sky (5 Segment)"): per segment, 3 rounds × 1 milestone, `Path`='Final' (no L/R branch), columns `Streak Req | Cum Streak Req | HC Reward` + booster columns. |
| D14 | Segmentation | ✔ NEW: two kinds of segmentation, handled differently. **Config-segmented** (the reward/requirement ladder itself differs per segment): `NS`/`NS_v2` (genuinely different ladders) and `c_saga_v2` (5-segment scheme, values currently identical) — their readers select the segment's own block. **Data-segmented** (one global config; per-(segment,payer) inputs): every source — measured anchors, weekday/weekend rates (T), accrual curves (Kite's D strongly segment-dependent), login-streak percentiles (Daily Gift), daily-max-streak percentiles (NS), matchables percentiles (RM). All other config sheets (`c_day`, `Race`, `Ki/HH/BB/J/Ph/TaD`, `RM`, `RR`, `SP`, `F`) are single-config — verified by scan on v5. |
| D15 | Modularity | ✔ NEW: **one named function per source** in the .gs (`simBombChallenge`, `simKite`, `simNightSky`, …), each a thin, readable module that declares its own inputs (calendar label, accrual key, config sheet) and delegates the math to shared helpers (`leaderboardSim_`, `collectionSim_`, survival CDF, reach). No duplicated math; per-source files read top-to-bottom. |
| D16 | SPT + Season Pass (2026-07-10) | ✔ **SPT and SPTx2 enter the resource universe** (13 resources, append-only; SPTx2 displayed separately, weighted ×2 in tier progression) across all four views incl. PBP (PBP: event payouts only, NO tier claims). **Season Pass (Free) leaves the carried family** → `simSeasonPass` tier coupling (§2.17): per-earner SPT window totals (measured vs simulated, Σ over all categories — additive-projection convention; SP's own SPT measured on BOTH sides = the recursion guard) × seasonDays/33 → tier on the `SP`/`SP_v2` Cumul ladder → row scales by cum-track-reward ratio through the reached tier (FREE for NONPAYER, **FREE+PAID for PAYER** — flagged assumption that the measured '(Free)' row holds payers' paid-track claims) × `SP_lb_v2`/`SP_lb` challenge POT ratio (zero-sum, Kite-style — Dream Pass telemetry is empty, no position pricing) × calendar T (`Season Pass` lane wired; D pinned 1). **No-anchor fallback:** tiers gained → ADD absolute `SP_v2` rewards of tiers (T_meas, T_sim] (hybrid, flagged); otherwise CARRY (never delete a measured value). `SP_v2`/`SP_lb_v2` missing → base sheets serve both sides (ratios 1). A. 0: fully carried. Season length: `Season Length (days)` config label on SP/SP_v2, default 33. |
| D17 | Core SPT (2026-07-14) | ✔ **Core leaves the fully-carried family for its SPT resource only.** Level completions pay a difficulty-tiered SPT reward (Normal/Hard/Extreme, live = 10/20/30) under an assumed level-difficulty **mix** (0.55/0.30/0.15 — an ASSUMPTION, flagged). `SIM[Core,SPT] = measured × R_SPT`, D=T=1 (always-on); `R_SPT = E_v2/E_base`, `E = Σ_d mix_d·reward_d` (`coreSptR_`/`coreSptE_`). Values + weights are **label-scanned** off the `SP`/`SP_v2` config panel (`Normal`/`Hard`/`Extreme` cells + `… (%)`; panel sits on the tier-ladder's unused A:B columns — `readSPTrack_` only reads C + D..AQ, so no collision); mix falls back to the `CORE_SPT_MIX` code constant (single shared set, not a per-side lever). Base = live rewards → `R_SPT=1` until `SP_v2` is edited (panel absent → `E_base=0` → R=1 = carried, the fail-safe). Every OTHER Core resource stays carried; measured Core SPTx2 = 0. Core is ~92% of the SPT faucet, so the same edit drives the **Season Pass tier** (`sptTotals_` sums `resultRow_` per category — automatic, no extra wiring). Views: 33-day/Daily/SPS via `simCore` (Daily/SPS inherit through `resultRow_`); PBP adds one aggregate day-end claim = wins × E_SPT (cal_curr off `SP`, cal_new off `SP_v2`). A. 0: scaled like any segment (config-only change). |
| D18 | Core SPT synthetic anchor + season halves (2026-07-30) | ✔ **The Core SPT anchor is SYNTHESIZED** — `data_gains` carries no Core SPT rows (user-confirmed live DOES pay level tokens; the export just can't see them), so D17's `measured × R` had no anchor and was inert. New: `L = levels_completed_per_active_day (data_seg_beh) × Σ p_day over the 33-day window`; `meas[Core,SPT] = L × E_base`, `SIM = meas × R_SPT = L × E_v2` (same L both sides — behaviour held constant, per the user's framing). Synthesized inside `measuredRow_` (single choke point → DIFF, daily CURRENT and `sptTotals_` measured side all consistent); **fires only while the raw data read is 0** — a future data_gains re-pull with real Core SPT rows takes over automatically, no double count. **E is now halves-averaged**: the panel's difficulty rows carry [2nd-half, 1st-half] reward cells (base 12/20/30 & 10/15/20; `SP_v2` halved 6/10/15 & 5/7/10) → `E = Σ mix_d × mean(halves)` (`readSPLabelPair_`; 50/50 — flagged: equal halves, uniform play; single-cell panels keep working). Workbook (13): E_base 15.05, E_v2 7.45, R 0.495. PBP inherits the averaging through the shared `coreSptE_` (claim now wins × 7.45 on cal_new). A. 0: NO synthesis (no behaviour telemetry — appendix stays at its raw anchor). Effect on §2.17: measured token totals now include the dominant Core faucet (e.g. 40-99 NP: 318 → 8,259), tiers cap/drop instead of exploding off the Rainbow Maker injection. |

---
| D19 | Card-collection PACKS enter the resource universe + card sim rewired (2026-08-03) | ✔ **Resources 13 → 19**: `1-star Pack`…`6-star Pack` appended (append-only rule). **Packs are SIMULATED-SIDE ONLY** — `data_gains` has no pack rows, so the measured anchor is 0 and `measured × R × D × T` is identically 0; DIFF therefore equals the simulated value (user decision: no synthetic measured anchor, unlike D18's Core SPT). Every source prices packs **bottom-up on cal_new** via `packLane_`: `packs = E_v2 × participation_rate × Σ reach(inst)`, no D term (a pack is a rank/milestone payout already priced through E). `rewardR_` was split into `rewardE_` (absolute E, both sides) + the ratio, so the pack lane reuses the EXACT pricing the R term uses — leaderboards at `position_p25/50/75`, collections at `S(req)` over `final_balance_p25/50/75`, Kite with its milestone term. **Carried sources pay packs too** (user decision "everything with a config sheet"): `Team Event` (TE, leaderboard + contribution blocks summed) and `Flock Flurry` (F) keep measured values for all 13 other resources and receive only a pack overlay (`PACK_ONLY_SPECS`, applied in `resultRow_`). `Team Race`/`Ads`/`IAPs` have no config sheet → 0; `A. 0` has no behaviour telemetry → 0. Season Pass prices the whole reached track (`cs × R_challenge × T`); RM/Night Sky were already bottom-up → packs flow through `RES_MAP` alone. **All pack ladder cells ship at 0** — the user authors them on the `1-star Dly`…`6-star Dly` columns that already exist on every config sheet. FLAGGED: `reach × participation_rate` mildly under-counts high-participation events (no joint estimator available); `Team Event` has no `data_event_inst` rows → flat rank average, the crudest pricing in the model. **NET blocks blank the pack columns** (`netGrid_`) — packs are gains-only, so a net pack position does not exist. Daily placement: `Team Event`/`Team Race`/`Flock Flurry` left the flat ÷33 family for their calendar lanes (window totals unchanged, distribution only). |
| D19b | Card sim (`CardOpenings.gs`) rewired onto real segments + `cal_new` (2026-08-03) | ✔ `EcoPackGains` and `PlayerBehavior` **deleted**. Acquisition now comes from `dailyPacksFor_(seg, payer)` in `EcoGainsSim_Daily.gs` (33×6 per-day grid, by source) instead of a private rate table + hardcoded `1/0/0/1…` schedule strings, so the card sim finally responds to the redesigned calendar. `SimOutput` selects **segment × payer** (`B2`/`D2`) — the real `data_seg_beh` keys — instead of "Mid-Core (Free)" archetypes; attendance is the deterministic expected `p_day` (weekday/weekend active rate), season = the 33-day window. Randomness is confined to the card DRAWS and the trailing-fraction pack grant, both seeded from `G2`; the trailing fraction is a **Bernoulli** so the granted count is unbiased (the old code always rounded up, inflating every source). **PackConfig reworked**: the per-pack rarity-probability grid is DELETED (it multiplied the snap-pool counts, applying rarity twice — the clash the user flagged); the SNAP POOL stays and becomes the authoritative pool with a CALCULATED `Initial Probability` column (formula off Qty Count). Draws are count-proportional without replacement, pool rebuilt on album advance; pack tier now differs only by `Cards/Open` + the pity table, which is **implemented for real** (it existed but was never read — semantics FLAGGED as an assumption: `PityProbabilities` indexed by card slot, last value reused past the end, restricted to highest-rarity-in-pool when `PityForceHighestRarity`). Chest purchasing moved from PlayerBehavior into a PackConfig panel and is also now read (min stars + linear urgency ramp, replacing a hardcoded 0.85-of-season greedy sweep). Per-card `Weight` in CardPoolConfig dropped from the draw (second rarity multiplier); `CHAPTER_WEIGHTS` and dry-streak pity kept. `AlbumConfig` unchanged (albums 2/3 reuse the same 72-card catalog with a fresh pool). **`onOpen` collision fixed** — CardOpenings' own menu was silently overriding the EcoGainsSim menu. New harness `_mock_cards.js`. |
| D20 | Windowed view: `EcoGainsSim_7Day.gs` (2026-08-03) | ✔ A second pair of custom functions, `ECOGAINS_SIM_7_DAY` / `ECOGAINS_DIFF_7_DAY`, with the SAME arguments and the SAME 25×19 spill as the full-window pair but covering only **cal_new days 6..13 inclusive — 8 days**, not 7 (the `_7_DAY` name is the user's; the `WIN7_FIRST_DAY`/`WIN7_LAST_DAY` constants are the truth). Plus `ECOGAINS_WINDOW_7_DAY` → `[first, last, count]` so a sheet can label its own window. **NOT a copy of the engine** (the user asked for one; a copy would redeclare every global and silently override the engine by load order — the documented Apps Script gotcha that has already bitten this project twice). The file declares 7 new names, all `WIN7_`/`win7`-prefixed, and calls the engine for everything else. **Method:** window totals are NOT re-simulated — it sums `dailySeries_` (EcoGainsSim_Daily.gs's claim-day allocation) over the days in range, on both sides, so `DIFF_7` compares the same 8 days of cal_new against the same 8 days of cal_curr and keeps its usual meaning. Straddling instances resolve by their placement rule: a leaderboard running days 4–9 counts IN FULL (rank rewards pay on the last day, which is inside), one running days 11–16 counts not at all; collections contribute only the accrual-curve share landing in range; always-on sources contribute their activity share; flat sources give 8/33. Window is an editable constant pair (user decision), clamped and order-tolerant. Harness `_mock_7day.js` (20 gates); the load-bearing one is CONSERVATION — widened to days 1..33 the windowed functions reproduce `ECOGAINS_SIM`/`ECOGAINS_DIFF` to ~5e-12 across every segment × payer × category × resource, which is what guarantees the view can never drift from the sim it slices. Sheet setup: reuse the EcoGainsSim_HC geometry (SIM at C, DIFF at W); `'EcoGainsSim_HC_7d'` pre-added to `REFRESH_SHEETS` (refreshSims_ skips names that don't exist). |
| D21 | Pack reward ladders authored + calibrated (2026-08-04) | ✔ The D19 pack lane was plumbing only — every ladder cell shipped 0. Values are now authored from the user's source × tier table, treated as a HARD WHITELIST (`WHITELIST` in `builders/_build_packrewards.py` fails the build on any off-table combination). **Team Race dropped** (no config sheet → engine prices it 0 anyway); **Level Race deliberately pack-free** though it shares `Race_v2` with the bird challenges (gated by `PACK_FREE_BLOCKS`); **6-star/Gold stays 0** (no source). **`NS_SIMULATE` flipped to true** (user call) so Night Sky packs flow — blast radius: every NS resource in all three views now moves, and the standing 'NS overestimates' flag is NOT resolved. Ladder grammar: one pack per star per row (qty∈{0,1}), tiers ACCUMULATE going up; `frac` sets how far down a tier reaches, `every` its sparsity, `from:'low'` anchors 1-star at the ENTRY end (without it, sampling a long ladder from the top skips early rows and segment 0-9 earns no 1-star packs at all). Spec: `builders/_pack_spec.json`, shared by `harness/_solve_packs.js` (calibration) and the builder (emit). **Calibration** (`_solve_packs.js`): packs priced through the real engine, opened through the real `CardOpenings.gs`, over a segment × ACTIVITY grid — `packLane_` returns one value per (segment, payer) but the targets are population percentiles, and segment shares alone cannot separate payer p25 from p50 (0-9 spans 0–51.8% of payers); within-segment `active_days` p25/p50/p75/p90 is the separator. **Structural findings:** (a) within a segment cards scale EXACTLY linearly with activity — progression depth is a segment-level constant — so the model's natural p25→p90 spread is ~11× against the ~14× the targets imply; (b) Season Pass tier is near activity-INDEPENDENT (0-9 payers sit at tier 9–10 whether they play 0.3× or 3× the mean), so the paid track can only ever be a flat per-segment bonus and cannot deliver an activity-graded payer uplift; (c) Season Pass packs are not reach-scaled (`cs × R × T`), so they pay a fixed bundle however little the player plays. Result at `scale` 0.65: free cards/wk ratios 1.58/1.18/0.87/0.97 and album-1 fill 29/57/74/91% vs targets 18/55/85/95%. Photoshoot prices at ~1% of the faucet regardless of authoring — its req ladder runs to 8,890 tokens against measured balances of 60–600 (flagged, possibly a wrong req axis). |
| D22 | Night Sky RE-ANCHORED on `NS` vs `NS_v2` (2026-08-05) | ✔ **Supersedes D13's "no measured anchor" rule.** User decision: the measured `Daily Night Sky Prize` rows were earned under the LIVE config, which is exactly what the `NS` sheet holds — so `NS` is the base and `NS_v2` the redesign, and NS is priced like every other configured source: **`SIMULATED = measured × R × T`**, `R[res] = E_v2[res]/E_base[res]`, `E[res] = Σₖ S(CumStreakReqₖ) × rewardₖ[res]`, D = 1 (1-day instances). The SAME survival curve S (data_streaks max-streak percentiles × `NS_STREAK_N` 1.25) prices both sides, so **requirement edits flow as well as reward edits**. Consequence the re-anchor exists for: `NS_v2 == NS` ⇒ R = 1 ⇒ sim = measured × T, and with both calendars running NS on all 33 days T = 1 ⇒ **diff exactly 0** (verified, workbook (14)). Missing `NS_v2` sheet / missing segment row → falls back to `NS` (R = 1), so the sheet works before the redesign is authored. Per-resource: `E_base = 0, E_v2 > 0` → no anchor → ADD the bottom-up `E_v2 × Σp_day` (e.g. an SPT reward typed into `NS_v2`, which then feeds `sptTotals_` and the Season Pass tier); both 0 → R = 1 → measured × T. **Packs** take the standard `packLane_` (`E_v2 × participation × Σreach`) rather than that addition, per D19 consistency. No `cal_new` NS instances → 0 (removal semantics). `A. 0` still intercepted by `appendixRow_` → carried. **PBP exception to note 9:** the ledger reads `NS` on cal_curr and `NS_v2` on cal_new (like c_saga/c_day/SP), so all views agree. `NS_SIMULATE` kept as the on/off for the whole lane (false → carried, T not applied, no PBP claims). **What the re-anchor gives up (accepted):** measured NS is A/B-diluted and both sides of R carry that dilution, so it cancels — the diff is now the CONFIG effect only and the old full-rollout "rollout effect" number is no longer produced by any sheet function. FLAGGED: this side-steps rather than answers the standing "bottom-up NS overestimates" question — the level is right by construction, but the ladder-climbing model behind R is the same unvalidated one. Mirrored into `engine/pre_collection/` (same change minus the pack overlay). |
| D23 | Night Sky runs TWO variants: weekend + weekday (2026-08-27) | ✔ User decision, from the `_LIVEOPS_CALENDAR` workbook. The redesign splits Night Sky into a **weekend** event and a **weekday** event. Identification is by SHEET: ⚙️ `NS_v2_weekday` is the weekday redesign ladder, and its existence makes ⚙️ `NS_v2` the **weekend** ladder by definition (in that workbook `NS_v2_weekday` is a verbatim copy of ⚙️ `NS`, i.e. weekdays keep the live config, but nothing in the engine depends on that). **The calendar cannot express this** — 🗓️ `cal_new` carries ONE `Night Sky` row filled on all 33 days, and a day-type is not a calendar row — so the two ladders are folded into ONE expected-per-active-day value, WEIGHTED by the expected active days of each day type: `E_v2[res] = (E_wd[res] x Σweekday p_day + E_we[res] x Σweekend p_day) / Σall p_day`, splitting the cal_new NS days with the engine's existing `isWeekend_` rule (Fri/Sat/Sun -> 15 of 33 days) and the segment's own weekday/weekend active rates. Being a weighted average of two per-active-day RATES it is the same kind of number the model already used, so **R = E_v2/E_base, the base-0 bottom-up addition and `packLane_` are untouched** and every window total stays conservative. In effect a weekend-only reward is paid at the weekend share of its face value (~41-46% by segment, not 15/33 = 45.5%, because activity rates differ by day type). The three day-resolving views use the ladders DIRECTLY and still sum to the blend: the daily view splits each resource's window total between day types then spreads each part prop p_day (`nsDayTypeRows_`), the PBP ledger reads `nsLadderForDay_(seg, day)` on cal_new (cal_curr keeps the single live `NS`), and the card sim's pack rungs read the ladder of the instance's own day. **Fallbacks:** missing `NS_v2_weekday` sheet / no block for the segment -> the blend collapses to `NS_v2` and the model is the D22 one bit for bit (deliberately NOT falling back to `NS`, which would make an absent sheet invent an economy difference); `NS_DAYTYPE_SPLIT = false` forces the same collapse. Mirrored into `engine/pre_collection/` (same change; that copy has no pack lane or provenance). Gated by 8 new `_mock_run` gates (day set, no-sheet collapse, identical-ladders no-op, the weight itself, the master switch, restore), 2 in `_mock_daily` (HC lands on weekend days only + the 33 days still reconcile with the 33-day row) and 4 in `_mock_pbp` (weekday/weekend/cal_curr/restore) — all injecting the weekday sheet themselves, so they hold on workbooks that predate the split. **FLAGGED:** the split is a RATE weighting, not a behavioural one — the same S and the same `data_streaks` percentiles price both ladders, so it models "the weekend ladder only runs on weekend days" but NOT "players build longer streaks over a weekend". |

## 1. SHARED MACHINERY

**Measured anchor.** `data_gains`, key `engagement_segment | payer_flag | category | resource` →
`amount_per_earner`. Display→gains segment map (D8): `'0-9'→'B. 1-9'`, `'10-19'→'C. 10-19'`,
`'20-39'→'D. 20-39'`, `'40-99'→'E. 40-99'`, `'100+'→'F. 100+'`; `'A. 0'` reserved for the appendix block
(§3). The query emits only amount>0 rows ⇒ **missing row = legitimate measured 0**. Categories (verified
in v4): `Core`, `Saga`, `Daily Gift`, `Bomb Challenge`, `Chuck Challenge`, `Red Challenge`, `Flash Race`,
`Level Race`, `Kite Festival`, `Hatchling Hideaway`, `Bomb's Ballet`, `Jigsaw`, `Photoshoot`,
`Target Day`, `River Rush`, `Rainbow Maker`, `Daily Night Sky Prize` (anchored on NS/NS_v2 per D22),
`Season Pass (Free)` (SPT tier coupling per D16, §2.17);
carried: `Ads`, `Other`, `Team Event`, `Team Race`, `FlowerCoop`, `IAPs`,
`Flock Flurry`. Resources (13 since D16, fixed order, append-only):
HC, Slingshot, Shuffle, Comet, Red, Chuck, Bomb, UL Bomb, UL Chuck, UL Red, Unlimited Lives,
SPT, SPTx2.

**Behaviour.** `data_seg_beh` (labels `0-9`…`100+` = B.1-9-based per D8, × {NONPAYER, PAYER}):
`weekday_active_rate` / `weekend_active_rate` (fractions), `login_streak_p50/p75/p90` (Daily Gift),
`daily_max_streak_p50/p75/p90` (Night Sky — longest single win-streak within a day).

**Survival function (shared helper).** S(x) = 1 − CDF(x) from a piecewise-linear CDF through the
available percentile points, linear tail beyond the last percentile at the preceding slope, capped at 1.
One implementation, three users: RM (matchables percentiles p10…p90), NS (daily-max-streak p50/p75/p90),
Daily Gift weights (login-streak p50/p75/p90).

**Daily events.** Sources that run every day (Night Sky 33×1d; Flock Flurry 18×1d, carried) are NOT
priced with modal-duration/T machinery. For a bottom-up daily source the window total is
`per-active-day expected value × Σ over the calendar's 1-day instances of p_day` — the instance list
still comes from the calendar, so if NS's presence ever changes in `cal_new`, the sim follows.

**Reach.** `reach(inst) = 1 − Π_days (1 − p_day)`; weekend = `(day−1)%7 ∈ {2,3,4}` (Fri/Sat/Sun; both
calendars start Wednesday — verified). `T = Σ_new reach / Σ_cur reach` over the instance sets below.

**Duration multiplier.** `D = share(newDur)/share(curDur)` from `cum_token_share_p50`
(`data_event_accrual`; Kite from `data_event_kite_accrual`), keyed event|payer|segment with `0-9`
fallback; modal durations. Rewrite fix: normalise at **curDur** (not the curve's max day — benign today
since share(curDur)=1.0 in every live case, wrong in general). Lengthening past observed range:
marginal-slope extrapolation capped at proportional, flagged (currently moot — only day-1-saturating
curves lengthen, D=1 there anyway).

**How the calendar drives cadence and duration (the pipeline, explicit).** The calendar sheets are the
single source of truth for WHEN and HOW LONG every event runs; nothing about scheduling comes from
configs. Per calendar (`cal_curr`, `cal_new`), the merge reader turns the grid B5:AH25 into a list of
instances, each carrying `{event label, start day, duration, exact day list}` — one instance per merged
range, one 1-day instance per standalone filled cell, adjacent same-event cells never collapsed. From
that list, per source and per (segment, payer):

1. **Cadence** = the instance list itself. Each instance contributes its own
   `reach = 1 − Π_days(1 − p_day)`, where each day in the instance is priced by its calendar position —
   weekend rate for Fri/Sat/Sun columns, weekday rate otherwise. So an instance's contribution rises with
   its duration (more days → more chance to participate) and with its weekend placement. Cadence is NOT a
   naive instance count: `T = Σ_new reach / Σ_cur reach` weighs every instance by duration and placement.
   That is why Flash Race moves (T=0.991) despite 15 instances on both sides — the slots shifted from a
   weekday/weekend mix to pure weekend — and why Red (3×2d) grows while Chuck (5×1d → 2×2d) shrinks.
2. **Duration** = the modal instance length of each calendar's list (7 for current Kite, 3 for new; 4→3
   for BB; etc.). curDur→newDur feeds `D = share(newDur)/share(curDur)` on the accrual curve, capturing
   how much of the eventual per-participant reward fits into the shorter/longer run. Clipped instances
   (e.g. HH's 2-day at the window edge) keep their REAL day list in the reach sum but do not distort the
   modal duration used for D.
3. Per-instance duration is also used directly where a source is priced bottom-up instead of anchored:
   Rainbow Maker evaluates each instance with the matchables distribution for ITS duration (4-day vs the
   clipped 2-day) and multiplies by that instance's own reach.

Net effect: an event's simulated total responds to all three calendar levers independently — how many
times it runs, how long each run is, and which days of the week each run occupies. Editing a merge in
either calendar re-parses on recalc (D12) and moves T, D, and RM's per-instance sums accordingly.

**Reward ratio R** (base-vs-`_v2` cell-diff on v4):

| Pair | Diff | R |
|---|---|---|
| `c_saga`→`c_saga_v2` | per-cycle HC 210→75 per 100 levels, all 5 segment columns identical | R_HC(Saga) = **0.357** |
| `c_day`→`c_day_v2` | d1 22→12, d4 27→17, d6 33→23; d7 stays 100 (Σ182→152) | streak-weighted per segment |
| `Race`→`Race_v2` | EventDuration 1→2 in r6 Red / r24 Chuck / r42 Bomb / r60 Level; Flash r78 = 1 | R = 1 |
| `Ki_v2` 7→3; `HH_v2` 3→4; `BB_v2` 4→3; `J_v2` 4→3; `Ph_v2` 4→3; `TaD_v2` 7→1 | duration only | R = 1 |
| `RR_v2`==`RR`; `NS_v2`==`NS`; `F_v2`==`F` | identical | carried / 2.12 |

**Calendar instance sets** (merge rule verified: merged range = one instance; filled unmerged cell = one
1-day instance; neighbours never collapsed; aliases `Mystery Puzzle`→`Jigsaw Puzzle`,
`Chuck's Flash Race`→`Flash Race`; day = column − 1):

| Label (exact) | cal_curr | cal_new |
|---|---|---|
| `Bomb's Challenge` | 4×1d @4,13,20,27 | 2×2d @13,15 |
| `Chuck's Challenge` | 5×1d @2,9,16,23,30 | 2×2d @6,8 |
| `Red's Challenge` | 4×1d @5,14,21,28 | 3×2d @1,27,29 |
| `Flash Race` | 15×1d @1,3,5,…,33 (alternating; 10we/5wd) | 15×1d @ weekend clusters (all we) |
| `Level Race` | 4×1d @4,13,20,27 | 2×2d @20,22 |
| `Kite Festival` | 2×7d @3,17 + 1×3d @31 — modal 7 | 5×3d @3,10,17,24,31 |
| `Hatchling Hideaway` | 4×3d + 1×2d @32 — modal 3 | 4×4d + 1×2d @1,6,13,20,27 — modal 4 |
| `Jigsaw Puzzle` | 2×4d + 1×3d — modal 4 | 3×3d @3,17,31 |
| `Photoshoot` | 1×4d @7 | 1×3d @24 |
| `Bomb's Ballet Show` | 1×4d @21 | 1×3d @10 |
| `Target Day` | 2×7d + 1×2d — modal 7 | 15×1d (Flash Race slots) |
| `Rainbow Maker` | — | 4×4d + 1×2d @1,6,13,20,27 |
| `River Rush` | — (runs off-grid today; measured>0) | — (removed) |
| `Night Sky` | 33×1d | 33×1d — SIMULATED anchored per 2.16/D22 (T = 1; instances feed Σ p_day for base-0 additions) |
| Flock 18×1d, Team/SP/offers | unchanged | carried |

**Accrual curves** (`0-9|NONPAYER` p50): Bomb/Chuck/Red/Flash/Flock/Target Day: share(1)=share(2)=1.00.
HH 0.18/0.71/**1.00**/1.00 (4d observed → 3→4 is interpolation, D=1). Bombs Ballet …0.94(3)/1.00(4).
Jigsaw …0.86(3)/1.00(4). Photoshoot …0.91(3)/1.00(4). River Rush 8d (idle unless RR returns to the
calendars). Kite: day3 0.315 (0-9 NP) … 0.704 (100+ NP); share(7)=1.0. **No curve for Level Race** (D=1
accepted — rank rewards). Accrual event names: `Bomb`,`Chuck`,`Red`,`Flash Race`,`Flock Flurry`,
`Hatchling Hideaway`,`Jigsaw`,`Photoshoot`,`Bombs Ballet` (no apostrophe),`Target Day`,`River Rush`;
kite sheet: `Kite Festival`.

Worked numbers below = `0-9|NONPAYER` (pWd 0.3292, pWe 0.3207); engine computes per (segment, payer),
reading everything live per D12.

---

## 2. PER-SOURCE SPECS

### 2.1 Core – Saga  [always-on; two display rows per D9]
1. **Type:** always-on progression; reward-ratio-only. Now TWO rows: `Core` (pure carry) and `Saga`
   (the nerf line).
2. **Inputs:** measured `Core` and `Saga` rows; `c_saga` rows 4–13 cols B/C (210 HC/100 lv) vs
   `c_saga_v2` rows 5–14 per-segment pairs (`0-9`→B/C … `100+`→J/K; 75/100 in all five). Read live
   (D12) — if the v2 ladder is edited, R recomputes.
3. **R:** R_HC(Saga) = Σv2/Σbase per segment (today 75/210 = **0.357** for all). Non-HC Saga resources
   carried. Core: R = 1 (nothing in `chapter_complete`/`PlayerLevelUpChest` changed).
4. **D:** 1. 5. **T:** 1.
6. **Formulas:** `Core_sim[res] = Core_meas[res]`; `Saga_sim[res] = Saga_meas[res] × (res=='HC' ? R_HC : 1)`.
   Headline diffs (NONPAYER, HC/earner): −43.9 / −91.9 / −158.5 / −339.2 / **−578.3** (0-9→100+) — the
   single largest negative line in the redesign, ahead of River Rush removal.
7. **Zero-handling:** Saga HC measured at every segment (68.28→899.31) and Core at every segment
   (19.88→416.61 NP) → a 0 in either row = stale-data/label bug. A.0's Saga (0.72) lives in the §3 block.
8. **Flags:** none remaining (D2 done; conservation verified; `#REF!` r19 waived per D10).
9. **Confidence:** HIGH.

### 2.2 Bomb Challenge  [leaderboard]
1. **Type:** top-10 rank ladder (200/100/50 HC + one booster per position, `Race` r39–55).
2. **Inputs:** measured `Bomb Challenge`; cal `Bomb's Challenge` 4×1d @4,13,20,27 → 2×2d @13,15;
   `Race_v2` r42 duration only.
3. **R:** 1. 4. **D:** 1 — rank payout is end-state; token curve saturates day 1 regardless.
5. **T:** Σ_cur = 0.3207+3×0.3292 = 1.308; Σ_new = 2×(1−0.6708²) = 1.100 → **T ≈ 0.84**.
6. **Formula:** `sim = meas × T`.
7. **Zero:** HC measured everywhere (1.42 A.0 → 65.85 F NP); 0 = bug; missing booster rows legit.
8. **Flags:** per-instance rank payout assumed duration-invariant. 9. **Confidence:** HIGH.

### 2.3 Bomb's Ballet  [collection]
1. **Type:** token-priced 15-level track + completion (HC at L5=25, L10=25, completion=50).
2. **Inputs:** measured `Bomb's Ballet`; cal `Bomb's Ballet Show` 1×4d@21 → 1×3d@10; accrual
   `Bombs Ballet`; `BB` 4 → `BB_v2` 3 (fixed, agrees with calendar).
3. **R:** 1. 4. **D:** share(3)/share(4) = **0.942** (0-9 NP), interpolation.
5. **T:** reach(3d @10–12, all we)/reach(4d @21–24) ≈ 0.687/0.799 = **0.86**.
6. **Formula:** `meas × D × T`. 7. **Zero:** HC everywhere (0.079 A.0→); 0 = bug.
8. **Flags:** none. 9. **Confidence:** HIGH.

### 2.4 Chuck Challenge  [leaderboard]
As 2.2. Cal `Chuck's Challenge` 5×1d (all weekdays; Σ1.646) → 2×2d @6,8 (Σ1.100): **T ≈ 0.67** — the
biggest challenge cadence loss. `Race` r21–37 ("Chunk's" sheet-label typo is cosmetic; keys are the
calendar label + accrual `Chuck`). Confidence HIGH.

### 2.5 Daily Gift  [always-on; reward-ratio only]
1. **Type:** streak-gated 7-day ladder.
2. **Inputs:** measured `Daily Gift`; `c_day` col B r4–10 [22,0,0,27,0,33,100] vs `c_day_v2`
   [12,0,0,17,0,23,100]; `login_streak_p50/p75/p90` per (segment, payer).
3. **R:** R_HC = Σ(wₙ·v2ₙ)/Σ(wₙ·baseₙ), wₙ = P(streak ≥ n) from the piecewise 3-point CDF. Worked
   (0-9 NP: percentiles 2/7/19 → weights [1,.75,.5,.45,.4,.35,.3]): **0.762** vs naive 0.835 — day-7's
   untouched 100 shields long streaks; low-streak segments eat the nerf. Non-HC carried.
4. **D:** 1. 5. **T:** 1.
6. **Formula:** `sim = meas; sim.HC ×= R_HC`.
7. **Zero:** biggest low-segment HC line (135.97 NP / 179.36 P @0-9); 0 = bug — the canary row.
8. **Flags:** 3-point CDF is crude (accepted). 9. **Confidence:** HIGH.

### 2.6 Hatchling Hideaway  [collection]
1. **Type:** 5 token gates (HC at gates 2/4/5 = 10/15/40).
2. **Inputs:** measured `Hatchling Hideaway`; cal 4×3d+1×2d → 4×4d+1×2d; accrual `Hatchling Hideaway`;
   `HH_v2` 3→4.
3. **R:** 1. 4. **D = 1.0** — share(3)=1.00 on the observed 4-day curve (median finishes by day 3);
   interpolation, not extrapolation.
5. **T:** ≈ (4×0.796+0.55)/(4×0.691+0.539) = **1.13** — all HH movement is reach.
6. **Formula:** `meas × T`. 7. **Zero:** HC everywhere (0.508 A.0→); 0 = bug.
8. **Flags:** if design expects day 4 to add track restarts/extra gates, the token-share curve can't see
   it. 9. **Confidence:** HIGH.

### 2.7 Jigsaw  [collection]
1. **Type:** 12 cumulative-token milestones (HC at m5/m9 = 25/25).
2. **Inputs:** measured `Jigsaw`; cal `Jigsaw Puzzle` (fold alias `Mystery Puzzle` BEFORE lookup;
   verified 3×3d only after aliasing) 2×4d+1×3d → 3×3d @3,17,31; accrual `Jigsaw`; `J_v2` 4→3.
3. **R:** 1. 4. **D = share(3)/share(4) = 0.856** (0-9 NP).
5. **T:** Σreach(3×3d)/Σ[2×reach(4d)+reach(3d)].
6. **Formula:** `meas × D × T`. 7. **Zero:** HC everywhere (0.374 A.0→); 0 = bug.
8. **Flags:** alias handling only. 9. **Confidence:** HIGH.

### 2.8 Kite Festival  [score event, league LB]
1. **Type:** streak-step scoring; HC in LB positions 1–5 (300/200/150/125/100), SPT to p25; one
   milestone @100 = 30min UL.
2. **Inputs:** measured `Kite Festival`; cal 2×7d+1×3d → 5×3d; KITE curve (`data_event_kite_accrual`,
   event_name `Kite Festival`); `Ki_v2` 7→3.
3. **R:** 1. 4. **D = share(3)/share(7): 0.315 (0-9 NP) … 0.704 (100+ NP)** — segment-dependence is the
   point (whales bank score early); interpolation.
5. **T:** cur 0.937+0.937+0.687 = 2.559; new 5×0.687 = 3.433 → **1.34** (≈1.24 @100+).
6. **Formula:** `meas × D × T` → net 0.42× @0-9, 0.87× @100+. Doubles as the calendar-reader sanity
   check: if Kite stops shrinking, `getMergedRanges` failed in the custom-function context.
7. **Zero:** HC at all 12 (seg,payer) pairs (0.21→38.05); 0 anywhere = bug.
8. **Flags:** score-share D applied to rank payouts assumes rank tracks relative score within a league —
   accepted. 9. **Confidence:** HIGH.

### 2.9 Level Race  [leaderboard]
1. **Type:** top-10 ladder identical to challenges (`Race` r57–73 "Level Challenge").
2. **Inputs:** measured `Level Race`; cal 4×1d @4,13,20,27 → 2×2d @20,22; `Race_v2` r60 duration only;
   no accrual curve.
3. **R:** 1. 4. **D:** 1 (no curve; also the right model for rank rewards — revisit only if durations
   get priced). 5. **T:** 1.100/1.308 = **0.84**.
6. **Formula:** `meas × T`. 7. **Zero:** HC 1.50 (A.0) → 89.96 (E NP) — biggest event coin line; 0 = bug.
8. **Flags:** anchor accepted per D1. 9. **Confidence:** HIGH.

### 2.10 Photoshoot  [collection]
1. **Type:** 30 token-priced items + endless lanes (HC sparse: items 9, 21 pay 25).
2. **Inputs:** measured `Photoshoot`; cal 1×4d@7 → 1×3d@24; accrual `Photoshoot`; `Ph_v2` 4→3.
3. **R:** 1. 4. **D = 0.905** (0-9 NP). 5. **T:** ≈ 0.687/0.799 = **0.86** — single-instance ratio,
   placement-sensitive by construction.
6. **Formula:** `meas × D × T`. 7. **Zero:** HC small but everywhere (0.063 A.0); 0 = bug.
8. **Flags:** n=1 both sides → T noisy. 9. **Confidence:** HIGH method / MEDIUM T stability.

### 2.11 Red Challenge  [leaderboard]
As 2.2. Cal `Red's Challenge` 4×1d @5,14,21,28 (Σ1.308) → **3**×2d @1,27,29 (Σ1.650): **T ≈ 1.26** —
the one challenge that grows. `Race_v2` r6 duration only. Confidence HIGH.

### 2.12 River Rush  [removed from cal_new; live simulator kept per D4/D12]
1. **Type:** collection/race hybrid (15 rounds, 5-player groups; `RR` config; 8-day accrual curve on
   file; `RR_v2`==`RR`).
2. **Method — calendar-driven branches, evaluated live:**
   (a) `cal_new` has 0 RR instances (**current state**) → `sim = 0` for all 11 resources.
       DIFF = 0 − measured = **always negative**: −0.11 (A.0, §3 block) / −2.76 / −16.0 / −36.2 / −67.5 /
       **−102.6** HC/earner (0-9→100+ NP) — exactly the "gains players were getting before, turned to 0"
       requirement.
   (b) RR instances exist in BOTH calendars → generic collection path `meas × D × T` with the existing
       8-day curve (nothing else to build).
   (c) RR instances in `cal_new` only (no cur anchor set) → carry measured × reach-scaled heuristic is
       NOT attempted; the row flags `NEEDS-ANCHOR` and carries measured, loudly — a cur-side reference
       is required before that configuration can be priced.
3. **Zero-handling:** SIMULATED = 0 is the spec under (a); a 0 in the CURRENT/measured column would be
   the bug. 4. **Confidence:** HIGH.

### 2.13 Target Day  [leaderboard — D3]
1. **Type:** milestones intentionally pay 0; rewards on the top-10 LB (200/100/50 HC + boosters).
2. **Inputs:** measured `Target Day`; cal 2×7d+1×2d → 15×1d (weekend clusters); `TaD_v2` 7→1.
3. **R:** 1. 4. **D:** 1 (rank-invariance; the saturating token curve is irrelevant now).
5. **T:** cur ≈ 0.937+0.937+0.539 = 2.412; new = 15×0.3207 = 4.811 → **T ≈ 1.99** — the ~2× is correct.
6. **Formula:** `meas × T`. 7. **Zero:** HC at all segments (0.31→13.66); 0 = bug.
8. **Flags:** in-sheet note only — 15 one-day boards = 15 top-3 chances vs 3 long boards;
   rank-invariance is weakest here but identical to the assumption already accepted for the challenges.
9. **Confidence:** MEDIUM-HIGH.

### 2.14 Flash Race  [leaderboard — anchor ≈0 per D1]
1. **Type:** 1h leaderboard; measured ≈0 everywhere is real.
2. **Inputs:** measured `Flash Race` (trace UL only); cal 15×1d both sides, slots move weekday→weekend;
   `Race_v2` r78 = 1 (fixed).
3. **R:** 1. 4. **D:** 1. 5. **T:** 15×0.3207 / (10×0.3207+5×0.3292) = **0.991 ≈ 1**.
6. **Formula:** `meas × T ≈ meas ≈ 0`.
7. **Zero:** ≈0 HC output is the correct answer — its real payout is SPT, tracked as its own column
   since D16 (the SPT column moves with T like any leaderboard resource).
8. **Flags:** none. 9. **Confidence:** HIGH.

### 2.15 Rainbow Maker  [new-additive; survival-weighted milestone sum — D6/D7]

> **2026-07-10 — per-instance config split (HARDCODED, user decision):** the 5 `cal_new`
> instances, start-sorted (the clipped 2-day instance = #1), read **`RM_1st` (#1–#3, no SPTx2)**
> / **`RM_2nd` (#4–#5, SPTx2)**; missing/unreadable split sheet → fallback `RM`. Map =
> `RM_INSTANCE_SHEETS` in `EcoGainsSim_v4.gs`. Point 1 below still describes the shared sheet
> LAYOUT (all three RM sheets are identical in structure); E_inst (point 4) now uses each
> instance's own ladder + EventDuration, and the daily view places per-instance rows (SPTx2 only
> on RM_2nd days). Un-hardcoding is an open TODO — see CLAUDE.md / METHODOLOGY §11.4.
1. **Ladder:** `RM` sheet, header r15 (`Milestone | Matchables Req | Req Accum | Chest | Coins | SPT |
   SPT x2 | Red | Chuck | Bomb | Slingshot | Shuffle | Comet`); 30 milestones, ReqAccum 160→352,260; HC
   at m2/9/12/18/24/27/30 = 10/20/35/50/100/250/1000. `Chest` = visual only (D11). No UL columns → UL
   resources structurally 0.
2. **Matchables:** `data_RM` (D6) — per (segment, payer): avg + p10/p25/p50/p75/p90 of matchables in one
   4-day window.
3. **Survival function:** per (segment, payer), piecewise-linear CDF through
   (0,0),(p10,.10),(p25,.25),(p50,.50),(p75,.75),(p90,.90); linear tail beyond p90 at the p75→p90 slope,
   capped at 1; S(x) = 1 − CDF(x).
4. **Per-instance expected reward:** `E_4d[res] = Σₖ S(ReqAccumₖ) × rewardₖ[res]`. The clipped 2-day
   instance uses the distribution scaled ×0.5 on the matchables axis (percentiles halved) — flagged
   linear-scaling assumption.
5. **Window total:** `RM[res] = Σ_instances E_dur(inst)[res] × reach(inst)`; instances = `cal_new`
   4×4d + 1×2d; Σreach ≈ 3.7 (0-9 NP).
6. **Anchor/diff:** measured `Rainbow Maker` rows are soft-launch traces (cat totals 15–45) — left in
   the diff, immaterial; diff ≈ full addition.
7. **Sanity:** the old p50-step reproduced +37 HC @0-9 NP and +333 @100+ NP from this exact data; the
   survival method lifts 0-9 NP to ≈ **+68 HC** (per-instance 10×S(460)≈9.4 + 20×S(8,610)≈6.3 +
   35×S(18,410)≈2.7 ≈ 18.4, × Σreach 3.7) — the right tail the median hides.
8. **Zero-handling:** m2 (10 HC) needs 460 matchables; even p10 clears it at every segment → RM HC = 0
   for any simulated segment = lookup/ladder-read bug, never economics. UL columns = structural 0.
9. **Flags & confidence:** TAIL SENSITIVITY — milestones past p90 are priced purely by extrapolation;
   m30 (1000 HC, ReqAccum 352,260) sits just past p90 for 100+ NP (343,988) → ≈ 87 HC/instance from the
   tail alone; conservative bound (S=0 beyond p90) shown alongside at validation. 2-day ×0.5 scaling is
   linear over a nonlinear curve. Confidence MEDIUM-HIGH.

### 2.16 Night Sky  [daily streak event; ANCHORED on NS vs NS_v2 per D22 — was bottom-up, D13;
###                    TWO redesign variants, weekend + weekday, per D23]

> **2026-08-27 DAY-TYPE SPLIT (D23) — refines, does not replace, D22.** The redesign now runs a
> **weekend** Night Sky and a **weekday** Night Sky. ⚙️ `NS_v2_weekday` is the weekday ladder, and
> its existence makes ⚙️ `NS_v2` the weekend one. Since `cal_new` cannot express a day-type (one
> `Night Sky` row, all 33 days), the two are blended into a single per-active-day value weighted by
> the expected active days of each type — `E_v2 = (E_wd × Σweekday p_day + E_we × Σweekend p_day) /
> Σall p_day`, split by `isWeekend_` (Fri/Sat/Sun, 15 of 33 days). R, the base-0 addition and
> `packLane_` are unchanged. A weekend-only reward is therefore paid at the weekend share of face
> value (~41–46% by segment). The daily view, the PBP ledger and the card sim's pack rungs resolve
> the ladder per DAY instead and still sum to the blend. No weekday sheet, or `NS_DAYTYPE_SPLIT =
> false` → the blend collapses to `NS_v2` and D22 is reproduced exactly. FLAGGED: it is a rate
> weighting, not a behavioural one — the same S prices both ladders, so it does not model players
> building longer streaks over a weekend.

> **2026-08-05 RE-ANCHOR (D22) — supersedes the "never an anchor" rule in points 2–4 below.** NS is
> now priced `SIMULATED = measured × R × T`, D = 1, with `R[res] = E_v2[res]/E_base[res]` and
> `E[res] = Σₖ S(CumStreakReqₖ) × rewardₖ[res]` — the SAME survival curve S prices both sides, so
> requirement edits flow as well as reward edits. `NS` is the base config (the measured rows were
> earned under it), `NS_v2` the redesign; `NS_v2` absent or a segment row missing → falls back to
> `NS` (R = 1). Workbook (14) ships `NS_v2` as a verbatim clone, and both calendars run NS on all
> 33 days (T = 1), so the NS diff is exactly 0 today — sim 14.07 / 43.51 / 86.85 / 180.67 / 201.74
> HC (NONPAYER) == measured. Per resource: `E_base = 0, E_v2 > 0` → no anchor → ADD `E_v2 × Σp_day`
> (SPT typed into `NS_v2` therefore reaches the Season Pass tier); packs instead take the standard
> `packLane_`. No `cal_new` NS instances → 0. PBP reads `NS` on cal_curr / `NS_v2` on cal_new.
> The bottom-up machinery below survives ONLY as `nsE_`/`nsEDay_` feeding R and those additions —
> the absolute full-rollout total is no longer produced by any sheet function, and the diff is the
> CONFIG effect with the A/B dilution cancelling out of the ratio (accepted trade, D22). FLAGGED:
> the "bottom-up NS overestimates actual gains" question is side-stepped, not answered.

> **2026-07-06 re-wire (`NIGHT_SKY_REWIRE_PLAN.md`, Option A) — still the model behind E, but its
> ABSOLUTE outputs quoted below were superseded by D22 above — supersedes points 2–4 below where
> they differ:** streak source is now **`data_streaks` `max_streak_per_day_p25/50/75/90`** (clean,
> un-A/B-diluted; p25 added), each percentile **× N = 1.25** (effective-streak factor from the
> standalone NS Excel study — a second streak of similar size / reset absorption). Cumulative
> gating kept (point 5's conservative choice, confirmed); honest — no free milestone. Current
> outputs (NONPAYER, simHC/window): 0-9 54.1, 10-19 260.1, 20-39 458.8, 40-99 943.8, 100+ 775.3;
> E_day monotonic 5.8 → 112.3 (the 100+ TOTAL dips below 40-99 because its measured Σ p_day is
> lower — data, not model). PBP prices NS identically (day-end claims; Sampled uses the trace's
> best run × N).
1. **Type:** daily-reset win-streak ladder, config-segmented (D14). Live config `NS` (== `NS_v2`),
   "Night Sky (5 Segment)": per engagement segment 3 rounds × 1 milestone, `Path`='Final', with
   `Cum Streak Req` and `HC Reward` + booster columns (Red/Chuck/Bomb/Slingshot/Shuffle…; SPT out of
   the 11-resource scope). Ladders per segment (CumReq → HC): 0-9: 2→0, 5→10, 10→15;
   10-19: 6→10, 13→30, 26→60; 20-39: 11→15, 26→50, 42→100; 40-99: 28→50, 60→120, 100→250;
   100+: 80→100, 175→300, 280→400.
2. **Inputs:** the segment's OWN ladder block from `NS`; `daily_max_streak_p50/p75/p90` from
   `data_seg_beh`; the `Night Sky` 33×1d instance list from `cal_new` (and `cal_curr` — identical).
   Measured `Daily Night Sky Prize` (A/B-diluted: 9.15 / 23.20 / 40.19 / 72.09 / 62.66 HC/earner NP)
   is the CURRENT column only — never an anchor.
3. **Method (per D13, mirrors `1_DAY_NS_TD_5_Segs_V3` upgraded to survival):**
   `E_day[res] = Σₖ S(CumStreakReqₖ) × rewardₖ[res]` with S from the daily-max-streak percentiles;
   `NS[res] = E_day[res] × Σ_days p_day` over the calendar's 1-day instances (18 wd + 15 we in the
   33-day window). One ladder clear per active day max (daily reset), no L/R branching in live config.
4. **Worked (NONPAYER):** 0-9: S(5)=.25, S(10)≈.06 → E_day ≈ 3.4 HC; Σp ≈ 9.3 → ≈ **+32 HC**/window
   (vs 9.15 measured → diff ≈ +23). 100+: S(80)≈.45, S(175)≈.10, S(280)=0 → E_day ≈ 76 HC; Σp ≈ 6.9 →
   ≈ **+524 HC**/window (vs 62.66 → diff ≈ +461) — full rollout is a very large whale-side HC injection.
5. **Streak-axis choice:** milestone k gated on `Cum Streak Req` vs the daily MAX streak — conservative
   (treats the ladder as one unbroken run within a day; matches the sequential `ns_calc` layout in the
   reference workbook). The optimistic alternative (per-milestone `Streak Req`, streaks chain across
   claims) is a one-line switch; decide at validation against A/B-arm telemetry if available.
6. **Zero-handling:** measured NS > 0 at every segment (it IS live for the test arm) — a 0 in the
   CURRENT column = data bug. SIMULATED 0 for a low segment is possible economics ONLY at 0-9 m1
   (0 HC milestone); any all-zero simulated NS row = ladder-read bug.
7. **Flags:** (a) diff mixes "rollout effect" with "A/B dilution of measured" — label the row in-sheet;
   (b) S(x) tail beyond p90 drives the 100+ number (same tail sensitivity as RM — print the
   S=0-beyond-p90 conservative bound next to it); (c) one-clear-per-day assumption; (d) booster columns
   priced with the same survival sums. 9. **Confidence:** MEDIUM (method HIGH, magnitude tail-sensitive).

### 2.17 Season Pass  [SPT tier coupling — D16, added 2026-07-10]
1. **Type:** always-on reward track; the ONLY source coupled to the rest of the sim — SPT earned
   everywhere drives its tier progression. Config: `SP` (30 tiers, `Cumul` 10→3,557; FREE cols D–W,
   PAID cols X–AQ; both tracks pay 0 SPT → no recursion via config) + `SP_lb` (Season Pass
   Challenge rank ladder, ranks 1–15 of a 50-league; coins pot 1,700, SPT pot 0). Redesign twins
   `SP_v2` / `SP_lb_v2`; engine falls back to base when absent.
2. **Inputs:** measured `Season Pass (Free)` row; SPT/SPTx2 `amount_per_earner` of EVERY category
   (measured + each category's simulated values); `Season Pass` calendar lane (2 instances/side,
   identical → T=1 today); `Season Length (days)` config label (default 33).
3. **SPT totals (additive-projection):** `SPT_x = Σ over categories of (SPT + 2×SPTx2)`. Worked
   (workbook (10), NONPAYER): meas 118.15 / 173.18 / 223.26 / 318.65 / 338.92 across segments;
   sim < meas everywhere (River Rush removal −21…−122, Kite ×0.638×1.31, Level Race ×T≈0.85).
   SP's own SPT (~3–9, likely the challenge bucketed under the category) enters measured on BOTH
   sides — the recursion guard.
4. **Tier:** `tier(SPT × seasonDays/33, Cumul)`, cap 30. Worked 40-99 NP: 318.65 → tier 8
   (⚠ only 1.65 pts above the tier-8 edge — checks must recompute, never hardcode); 224.44 → tier 6.
5. **Formula:** anchored `SIM = meas × cum_v2(T_sim)/cum_base(T_meas) × R_chal × T`, D=1; cum =
   FREE (NONPAYER) or FREE+PAID (PAYER — flagged assumption the measured row holds paid claims).
   `R_chal` = SP_lb_v2/SP_lb pot ratio (zero-sum; Dream Pass telemetry empty → no position pricing).
   No anchor: tiers gained → `meas + Σ SP_v2 rewards (T_meas, T_sim]` (hybrid, flagged); else carry.
6. **Worked (40-99 NP, tier 8→6, SP_v2 absent):** free cums Coins 20→20 (×1), Chuck 2→1 (×0.5),
   UL Lives 75→60 (×0.8), Red 1→1 (×1) — HC unchanged, boosters drop; own SPT carried (4.14).
7. **Zero:** all-equal row = coupling not running (check SP header row 4, `Season Pass` lane) —
   EXPECTED only if the tier genuinely doesn't move AND SP_v2 is absent/untouched. Own-SPT diff 0 = spec.
8. **Flags:** paid-track-in-measured assumption; additive fallback = the only hybrid outside RM/NS;
   seasonDays default 33 until config panels exist; Dream Pass telemetry empty; PBP tracks SPT as
   event payouts only (no tier claims); 'Other' holds the largest SPT share (36–152/earner) and is
   carried — tier movement is mostly an RR/Kite/Level-Race story.
9. **Confidence:** MEDIUM-HIGH (mechanics exact from config; the two flagged assumptions are the risk).

---

## 3. A. 0 APPENDIX BLOCK (accounted for, not simulated — D8)

A sixth display block (below the `100+` block, same 25-row layout, tagged `A. 0`) so A.0 gains are never
silently dropped. Treatment per source, chosen so every applied change needs NO behaviour data or is
config-only:
- **Saga:** HC × 0.357 (config-only ratio; measured 0.72/earner NP → −0.46).
- **Daily Gift:** HC × R using the 0-9 (B.1-9) streak weights as PROXY (no A.0 row in `data_seg_beh`),
  flagged: true A.0 streaks are shorter, so the true ratio is ≤ proxy — the block slightly overstates
  their remaining gains. Material: Daily Gift is 94.9 of A.0's ≈137 total HC/earner.
- **River Rush:** 0 (removal is universal; −0.11).
- **Rainbow Maker:** not applied (no A.0 matchables data; participation negligible) — flagged
  understatement.
- **Every timed event + carried category:** SIMULATED = measured, unchanged (no A.0 behaviour/accrual
  exists; their event gains are small: Bomb 1.42, Red 1.32, Chuck 1.21, Level 1.50, Kite 0.49, HH 0.51,
  TaD 0.31, Jigsaw 0.37, BB 0.079, Photoshoot 0.063).
The block header carries the annotation: "A. 0 excluded from simulation (no behavioural data — these
players don't meaningfully play); gains carried; config-only changes applied."

---

## 4. CODE STRUCTURE

**One named function per source (D15)** — `SOURCES` registry dispatches (unlisted → carried). Each
function is its own readable module: it declares its inputs (calendar label, accrual key, config sheet)
and calls shared helpers for the math — no duplicated formulas, no numeric constants in code (D12; the
RM matchables map is deleted; nothing replaces it in code).
- `simCore` (carry), `simSaga` (R_HC from live c_saga/c_saga_v2), `simDailyGift` (R from live c_day pair
  + streak weights).
- `simBombChallenge` / `simChuckChallenge` / `simRedChallenge` / `simLevelRace` / `simFlashRace` /
  `simTargetDay` — each wraps `leaderboardSim_(cat, calLabel)`: `meas × T`, D pinned 1 with comment.
- `simHatchlingHideaway` / `simBombsBallet` / `simJigsaw` / `simPhotoshoot` — each wraps
  `collectionSim_(cat, calLabel, accrKey)`: `meas × D × T`, token curve, D normalised at curDur.
- `simKiteFestival` — RE-CLASSIFIED 2026-07-06: `meas × R × T`, D pinned 1 (payouts are rank-based
  zero-sum per league of 60; the score-curve D is superseded — kite accrual stays PBP-only).
- **R term (2026-07-06, supersedes "R=1 for events"):** `rewardR_` prices every LB/collection
  ladder pair (base vs _v2) at the measured player distribution (`data_event_inst` rank quantiles /
  final-balance survival) — reward and requirement edits on _v2 sheets now move the sim.
- `simNightSky` — bottom-up per 2.16 (re-wired 2026-07-06): segment ladder from `NS` ×
  survival(`data_streaks` max-streak p25–p90 × NS_STREAK_N 1.25) × Σ p_day over the calendar's
  1-day instances. NOT anchored to measured (A/B test, D13); DIFF = rollout effect.
- `simRainbowMaker` — survival-weighted sum from `RM` + `data_RM` + cal_new instances.
- `simRiverRush` — the 2.12 branch logic (currently → 0 because cal_new has no instances).
- **Display changes (D9 + D8):** `CATEGORY_ORDER` gains `'Saga'` (25 rows, 8–32 per block; block anchors
  B6/B34/B62/B90/B118 unchanged); new `A. 0` appendix block appended below with its own spill call.
Shared: `measuredRow_` ('0-9'→'B. 1-9' direct map), `timingRatio_`/`reachSum_`, `accrualShare_`
(curDur normalisation), config readers, `parseCalendarInstances_` (verified, untouched),
`Context`/`DataStore.fromRanges` for the offline harness. Fallback if live install shows Kite not
shrinking: menu-precompute writes parsed instances to a hidden `cal_parsed` sheet; custom functions read
values. Assumption flags = static legend block on `EcoGainsSim_HC`.

---

## 5. RELEASE GATES

> **VALIDATION RESULTS (2026-07-02, `EcoGainsSim_v4.gs` offline vs workbook v5 data):** all gates pass
> with live-data values (plan estimates used slightly older rates): Bomb T=0.86, Chuck 0.69, Red 1.30,
> Level 0.86, Flash 0.99, TaD 1.81, HH 1.16 (D=1.00), Kite D=0.34 @0-9 / **0.57 @100+** (the plan's
> 0.704 was stale — `data_event_kite_accrual` p50 day-3 for 100+ NP is 0.5694), BB D=0.94, Jigsaw 0.86,
> Photoshoot 0.91, saga ratio 0.357, Daily Gift R=0.74 @0-9 NP, conservation exact (19.88+68.28=88.16).
> Headline sims (NONPAYER HC/earner): Saga diff −43.9 → −578.1; NS +32 @0-9 (bound 23.3) / +524 @100+
> (bound = same, ladder inside p90-tail cap); RM +59.7 @0-9 (bound 51.9) / +789 @100+ (bound 582 —
> tail-sensitive as flagged); RR diff = −measured everywhere (−2.76 → −102.6); A. 0 appendix: Saga
> −0.46, Daily Gift −24.9 (proxy), RR −0.11, all else carried. Precompute path (`cal_parsed`) verified
> bit-identical to live merge parsing with merges disabled.

1. Offline end-to-end on v5 data reproduces: Bomb T≈0.84, Chuck ≈0.67, Red ≈1.26, Level ≈0.84, Kite
   D 0.315 / net 0.42× @0-9 NP, TaD T≈1.99, Flash ≈0, HH T≈1.13, BB D≈0.94, Jigsaw D≈0.856,
   Photoshoot D≈0.905, Saga diff −43.9 @0-9 NP / −578.3 @100+ NP, RR diff = −measured everywhere,
   RM ≈ +68 HC @0-9 NP, NS ≈ +32 HC @0-9 NP / ≈ +524 @100+ NP (RM and NS both printed with their
   S=0-beyond-p90 conservative bounds alongside).
2. Conservation check: for every (segment, payer), new Core + new Saga measured = old Core measured
   (already verified on v4 for 0-9 NP: 19.88 + 68.28 = 88.16).
3. Zero formula errors on all shipped sheets, `c_saga_v2` r19 waived (D10).
4. §4B live-state checklist: segment tags exactly `0-9|10-19|20-39|40-99|100+|A. 0`, payer cell `C3`,
   `data_*` headers row 1, fresh exports.
5. Layout check after adding the Saga row + A.0 block: 25 category rows per block, no overlap with the
   next block anchor. Since D19 the blocks are 19 resources wide (sim C..U, diff W..AO; CAL_STATS
   anchors moved to AQ8/AT8). Daily blocks run on a pitch of len(RES)+1 = 20 from column D
   (D/X/AR/BL/CF/CZ); the PBP ledger is 30 columns (11 chrome + 19 resources). Every builder DERIVES
   these from len(RES) — hardcoded column letters are what rotted `_restore_formulas.py`.
6. **SPT gates (D16, `_mock_run.js`, all data-aware):** spill width 13; Kite SPT == measured ×
   R_SPT × T with R_SPT ≠ 1 (the real Ki_v2 SPT cut 2960→1890 — the SPT canary); SP_v2/SP_lb_v2
   absent → base fallback; SPT_sim < SPT_meas → tier drops → Season Pass row matches the coupling
   identity per resource (workbook (10): Chuck ×0.5, UL Lives ×0.8) with own SPT carried; synthetic
   SP_v2 Cumul ×0.5 → tier rises + additive path + full restore. Verified green 2026-07-10.
7. **Gate refresh (2026-08-03).** Three gates had rotted into asserting a workbook state that no
   longer exists (SP_v2/SP_lb_v2 ABSENT, RM_1st/RM_2nd ABSENT) and had been red for a generation.
   They now assert the real state AND exercise the fallback by temporarily removing the sheets
   (snapshot → mutate → assert → restore). The SPT tier gates moved off `40-99`: that segment
   exceeds the 30-tier ladder on BOTH sides, so `Tm == Ts == 30` and no tier movement is possible
   there — gates run on `SP_SEG = '10-19'` and a separate gate REPORTS which segments are
   cap-masked (open flag: Core SPT L calibration). All four harnesses green 2026-08-03.
9. **NS anchor gates (D22, `_mock_run.js` + `_mock_pbp.js`).** The old "NS_SIMULATE ON → diff
   moves" gate was retired: it asserted the bottom-up model and would red the moment `NS_v2` is an
   honest clone. What is gated now: the reconstruction identity (the NS row equals
   `measured × R × T` + base-0 additions for EVERY segment × resource, rebuilt from the engine's
   own `nsE_`/`timingRatio_`/`reachSum_`); `NS_v2 == NS ⇒ R == 1` everywhere and diff 0 (reported
   as R values instead once `NS_v2` is edited); `NS_v2` HC ×2 → NS row ×2; `NS_v2` reqs ×3 → NS row
   falls; SPT typed into `NS_v2` → added bottom-up at `E_v2 × Σp_day` AND visible to `sptTotals_`;
   a pack typed into `NS_v2` → `E_v2 × participation × Σreach` exactly; `NS_v2` sheet deleted →
   fallback to `NS`, sim == measured × T; no `cal_new` NS instances → all-zero row; `A. 0` carried;
   the `NS_SIMULATE` switch still carries when off. PBP: `NS_v2` HC ×3 moves the cal_new ledger ×3
   and leaves the cal_curr ledger untouched (the side-appropriate-ladder rule). All five harnesses
   green 2026-08-05.

8. **Pack gates (D19, `_mock_run.js` + `_mock_cards.js`):** spill width 19; every pack column 0
   while no ladder is authored; injecting a pack into `J_v2` moves ONLY Jigsaw's matching pack
   column and equals `E_v2 × participation × reach` exactly; injecting into `TE` moves Team Event's
   pack column while its 13 other resources stay carried; NET blocks keep pack cells blank (not 0);
   the PBP ledger is 30 wide and carries the six pack columns. Card sim: PackConfig block reader,
   count-proportional draw (no Gold drawn at Qty 0), pity, chest rules, determinism under a fixed
   seed, segment sensitivity (100+/PAYER > 0-9/NONPAYER), A. 0 → 0 packs, and namespace hygiene
   (no duplicate globals, exactly one `onOpen`).
