# source_docs — Resource-Source Mechanics Reference

One .md per resource source in the ABDB economy simulation (see `../HAND_OFF.md` for the sim model). Each file: mechanics, reward ladders with real numbers, duration/cadence (cal_curr vs cal_new), R×D×T simulation notes, sources, and gaps — with CONFIRMED vs INFERRED claims marked. Compiled 2026-07-02 from the project PDFs, `NEW_LIVEOPS_CALENDAR_ECO.xlsx`, `1. Rainbow_Maker_Sim.xlsx`, `1_DAY_NS_TD_5_Segs_V3 (1).xlsx`, and prior context docs.

| File | Source | Type | Doc quality |
|---|---|---|---|
| core-saga.md | Core / Saga | always-on | good (configs + MVP PDF; no dedicated saga design doc) |
| daily-gift.md | Daily Gift | always-on | good (configs; design details inferred) |
| bomb-challenge.md | Bomb Challenge | leaderboard | thin PDF (2p) + Race config block |
| chuck-challenge.md | Chuck Challenge | leaderboard | INFERRED from Bomb doc + Race config block |
| red-challenge.md | Red Challenge | leaderboard | INFERRED from Bomb doc + Race config block |
| flash-race.md | Flash Race | leaderboard | redesign deck p36 + Race config block |
| flock-flurry.md | Flock Flurry (Flock Rush) | leaderboard (1-hour sprint) | full PDF + F configs + inst/gains data (added 2026-07-03) |
| level-race.md | Level Race | leaderboard | redesign deck p25-26 + Race config block |
| kite-festival.md | Kite Festival | score leaderboard | 1-page PDF + Ki configs |
| bombs-ballet.md | Bomb's Ballet | collection | full PDF + BB configs |
| hatchling-hideaway.md | Hatchling Hideaway | collection/interactive | full PDF + HH configs |
| jigsaw.md | Jigsaw (Mystery Puzzle/Box) | collection | good (2021 Valentine's origin PDF added 2026-07-04 + redesign deck p47-48 + J configs) |
| photoshoot.md | Photoshoot | collection | full PDF + Ph configs |
| target-day.md | Target Day (Archery Arena) | milestone/score (SPECIAL) | PDF + TaD configs — but milestone rewards are all zeros in config |
| rainbow-maker.md | Rainbow Maker | milestone/matchables (NEW) | full PDF + dedicated sim workbook |
| river-rush.md | River Rush | streak-competitive (carried stub) | full PDF + RR configs + prior context |
| season-pass.md | Season Pass (Dream Pass) | always-on SPT track + challenge LB (simulated via D16 tier coupling) | SP/SP_lb configs + data_gains SPT rows (added 2026-07-10); design PDF present, thinly mined |

## Cross-cutting facts established while compiling

- **`Race`/`Race_v2` = "All LB Challenges"**: five config blocks (Red's, "Chunk's" [sic], Bomb's Challenge, Level Challenge, Flash Race). **2026-07-10:** the base sheet's Flash Race + Level Challenge blocks were regenerated from the REAL live server configs (`builders/_build_race.py` → `display/Race_v1.xlsx`): Flash = league of 7, coins 100/50/25 + boosters + SPT 50/50/50/50/45/40/40 (ranks 8–10 zeroed); Level's mapped values (CherryBomb→Comet, Hammer→Slingshot, flagged) came out IDENTICAL to the old generic ladder, only LBSize 10→20. The bird challenges keep the generic ladder (pos1 200 HC + Comet; pos2 100 HC + Shuffle; pos3 50 HC + Shuffle; pos4-5 Shuffle; pos6-10 Slingshot; LBSize 10) — their live configs not yet provided, so #7 below is only PARTIALLY resolved. `_v2` still holds the pre-update content (EventDuration 2/2/2/2/1 + the old generic Flash ladder) — ⚠ re-duplicate it from the new base or R_SPT(Flash)=0.
- Every checked `_v2` config changes ONLY `EventDuration` (R=1 for events) — re-confirmed programmatically for BB, HH, Ki, Ph, TaD, Race; RR_v2==RR exactly (0 diffs).
- Redesign principles (deck pp.3-10): weekday/weekend differentiation, alternating same-mechanic events, event synergy — events balanced as served groups, not in isolation.

## Consolidated flags / open questions needing user input

> **Status update (2026-07-02, workbook `NEW_LIVEOPS_CALENDAR_ECO (4).xlsx`):** #2 FIXED (data_gains re-run: Saga now carries its own HC; engine v3 gives Saga its own simulated row, Core carried). #4 partially fixed (`Race_v2` Flash Race duration back to 1; SPT question stands). #5 FIXED (BB config 4→3 matches calendars). #3 partially addressed (`data_RM` sheet added with per-window percentiles — but the engine reads a sheet named `RM_matchables` with a `matchables` column, so it still falls back to the built-in 3-day map; also "window" naming supports per-window, engine assumes per-instance). #1 still open (TaD milestone rewards still all zeros). New in (4): `c_saga_v2` has `#REF!` errors in its "% of not nerfed" row; the HC sheet's 0-9 SIM formula hardcoded `"1-9"` (fixed in `EcoGainsSim_HC_v3.xlsx`).

1. **Target Day milestone rewards missing**: TaD/TaD_v2 hold a 20-milestone ladder (100→23,500 score) with ALL reward cells = 0, and no "milestones 26+" ladder exists anywhere — the planned score-curve fix is blocked on the real live ladder. Also curDur is ambiguous: 7d (calendar) vs 2d (data) vs 1d (PDF).
2. **Core/Saga nerf may not bite in the sim**: measured `Saga` (SagaPath) per-earner ≈ 0 while `chapter_complete` carries the HC at the c_saga ladder rate; `simCoreSaga` applies the 0.357 v2 ratio only to the ≈0 Saga row → the −64% nerf produces almost no simulated delta. Decide which measured rows the ratio should scale.
3. **Rainbow Maker p50 mismatch**: engine's fallback matchables map equals the 3-DAY column of `Sim Per Segment` but is applied to the 4-day ladder; 4-day p50s lift mid segments 1–3 milestones. Also per-instance vs per-window still unconfirmed (naming hints per-instance).
4. **Flash Race pays SPT, not HC** — RESOLVED 2026-07-10 (D16): SPT/SPTx2 are now resources 12–13 and Flash Race's SPT flows through its leaderboard T like any other resource (HC ≈ 0 stays correct). The Race_v2 duration=2 contradiction stands (presumed uniform-sheet artifact; calendar wins). NEW Season Pass questions (see season-pass.md): paid-track-in-measured assumption; Dream Pass telemetry empty; season length unknown (default 33d); measured SP SPT with a 0-SPT track; repo SQL SPT item identifiers unrecorded.
5. **Bomb's Ballet duration three-way conflict**: config 3→4d, calendars 4d→3d, measured instance 5d.
6. **Hatchling Hideaway token config conflict**: PDF says 1/3/5 tokens (Normal/Hard/Extreme), config says 1/2/3.
7. **Challenge/LB ladder authenticity**: the shared "All LB Challenges" ladder may be a modeling simplification — unverified against live config.
8. **Level Race has no accrual curve** (D forced to 1) and no data_event_inst rows — existing project TODO.
9. **File discrepancies vs HAND_OFF**: folder has `NEW_LIVEOPS_CALENDAR_ECO.xlsx` (not `_b`); `match3_query_learnings.md` and `TestCalendarParse.gs` are not in this directory.
10. **No design doc found at all for**: Chuck/Red Challenge (inferred from Bomb doc), saga chest ladder & daily-gift cycle rules (inferred from sim workbooks). Kite's 1-page PDF outsources rewards/streak-restoration to missing links (restoration = potential unmodeled HC sink).
