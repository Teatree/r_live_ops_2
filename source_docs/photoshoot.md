# Photoshoot — Mechanics

**Type:** solo collection (token shop) event | **Sim category:** collection (`simCollection`) | **Calendar name:** Photoshoot | **Accrual source:** `data_event_accrual`, key `Photoshoot` | **Config sheets:** Ph / Ph_v2

## What it is

Photoshoot (design name: **Bird Vacation Photoshoot**) is a **solo collection event**: players earn event tokens from levels and spend them to **buy outfits and accessories for Red, Chuck and Bomb**, dressing the birds for a themed vacation photo (PDF pp.1, 3). The design PDF calls it "week-long", but the live config and both calendars run it at **4 days** (see Duration). Completing the full wardrobe unlocks a shareable **photo mode** (save/share, filters, particles) plus an **endless "bonus rewards" shop** that converts further tokens into boosters (PDF p.4). Skins are seasonal — Summer, Fall, Winter, Spring, with fresh backgrounds and items per season (PDF p.5; screenshots on pp.1–3 show a Halloween skin).

In the live-ops calendar it is a **LOW INTENSITY** side event, rotating with Jigsaw Puzzle, Mystery Puzzle and Bomb's Ballet; Photoshoot instances land in **Kite Festival weeks** (2026 calendar PDF). Analytics-wise it is strongly engagement-amplifying: **~156× HC ratio between segment 100+ and 1-9** *(established project fact)*. The **Ph sheet is also the project's style reference** for design/config sheets.

## Player-facing mechanics (core loop)

1. **Play levels → earn tokens.** **Only first-try wins reward tokens** (PDF p.3, bold "Important" — "this encourages careful play"). Token drops are shown pre-level ("Win to collect", p.2 screenshot).
2. **Streak multiplier:** consecutive first-try wins escalate the token multiplier through **×1 → ×2 → ×4 → ×6 → ×10** (Ph rows 15–21; PDF p.2 screenshot "x1 x2 x4 x6 x10", p.5 config screenshot `streakMultipliers: 1, 2, 4, 6, 10`). **Failing a level resets the multiplier and there is no way to restore it** (PDF p.7, Player Support Notes — loss-aversion is an explicit design goal, p.5).
3. **Spend tokens on wardrobe items.** Each bird has 3 categories — **Headgear, Body, Accessories** — with 3 items each: 9 per bird, 27 wearable items total (PDF p.3), plus a 10th set of 3 **photo finishes** (filter / particles / add-text) for **30 purchasable items** (Ph row 9 `numberOfItems = 30`; PDF item table pp.6–7 lists set 10 as "Photo filters"). Items can be mixed and matched.
4. **Tiered unlock progression** (10 sets): sets unlock by **total items already bought** — thresholds 0, 2, 4, 6, 8, 10, 13, 16, 20, 25 (PDF item table pp.6–7, "Items needed to Unlock Set"; Ph column E). Order: Red's Headgear → Red's Body → Chuck's HG → Bomb's HG → Chuck's Body → Bomb's Body → Chuck's Acc → Bomb's Acc → Red's Acc → Photo finishes. Prices escalate within and across sets "to encourage steady progress"; the threshold pattern "guides you to dress all three birds evenly" (PDF p.3). `lastTierUnlockRequirement = TRUE`, `manualRewardClaiming = FALSE` (Ph rows 6–7).
5. **Completion → photo mode:** photo filters, special effects (e.g. summer sand particles), **Save Photo** (to device) and **Share Photo** (social) (PDF p.4).
6. **Endless shop:** after all items are collected, a shop of **endless "bonus" rewards** (boosters instead of clothes) opens (PDF p.4, warning box; screenshot shows "Bonus Rewards 11/11" with prices 840/830/940). Config: **3 lanes × 15 rewards** (`numberOfEndlessLanes = 3`, `endlessRewardsPerLane = 15`, Ph rows 11–12).
7. **Support facts** (PDF pp.7–8): lost tokens are restored via the admin-tool **Progress** field; lost multiplier is compensated with **30 min Unlimited Lives** (below ×4) or **1 h Unlimited Lives** (×4 and above) — the multiplier itself cannot be restored.

**Entry requirements (Ph rows 4–5):** `requiredPlayerLevel = 1`, `requiredSagaLevel = 17` (vs Kite's 42 — Photoshoot reaches much earlier players). `assetBundle = event-photoshoot-generic`. The admin screenshot (PDF p.7) shows a live instance Mon 20 Oct 2025 01:05 UTC → Fri 24 Oct 2025 01:00 UTC — a 4-day run, corroborating the config duration.

## Reward structure (actual ladder from config — table)

From sheet **Ph** of `NEW_LIVEOPS_CALENDAR_ECO.xlsx` (rows 24–54). **Ladders are identical between Ph and Ph_v2** — the only diff in the whole sheet pair is `EventDuration (days)`: **Ph = 4, Ph_v2 = 3** (cell B3). The PDF p.5 config screenshot (`itemPrices`, `streakMultipliers`, endless prices 840/830/800…) corroborates the sheet where legible. Prices are **per item** (tokens); the last item of each set also pays a **resource bonus** (all-zero columns omitted; UL amounts assumed minutes, as elsewhere).

| Set (unlock @ items owned) | Item 1 | Item 2 | Item 3 | Resource bonus on set completion (attached to item 3) |
|---|---|---|---|---|
| 1. Red's Headgear (0) | 80 | 130 | 155 | 1 × Chuck |
| 2. Red's Body (2) | 80 | 130 | 160 | 30 × Unlimited Lives |
| 3. Chuck's Headgear (4) | 80 | 135 | 165 | 25 × Coins |
| 4. Bomb's Headgear (6) | 165 | 230 | 265 | 30 × UL Lives + 15 × UL Red |
| 5. Chuck's Body (8) | 180 | 250 | 300 | 1 × Red |
| 6. Bomb's Body (10) | 180 | 260 | 300 | 30 × UL Lives + 15 × UL Chuck |
| 7. Chuck's Accessories (13) | 300 | 375 | 410 | 25 × Coins |
| 8. Bomb's Accessories (16) | 385 | 475 | 500 | 60 × UL Lives + 15 × UL Bomb |
| 9. Red's Accessories (20) | 400 | 480 | 520 | 1 × Shuffle |
| 10. Photo finishes (25) | 600 (filter) | 600 (particles) | 600 (add text) | 50 × Coins + 1 × Bomb + 120 × UL Lives |

**Full-clear cost: 8,890 tokens** (sum of all 30 prices). Full-clear resource totals: **100 HC, 1 Red, 1 Chuck, 1 Bomb, 1 Shuffle, 270 min Unlimited Lives, 15 UL Red, 15 UL Chuck, 15 UL Bomb** — no Slingshot or Comet in the main ladder (those appear only in the endless shop).

**Endless shop (rows 56–108): 3 themed lanes × 15 rewards**, prices 800–1,110 tokens each (lane totals ≈ 13,130 / 13,680 / 14,030; ≈ 40,840 tokens to exhaust all 45):

- **Lane 1 — pre-level boosters + coins:** Red ×2/1/3/2, Chuck ×1/2/3/2, Bomb ×1/1/1/3/5, Coins 25/50 (e.g. #13: 1,110 tokens → 5 Bomb).
- **Lane 2 — in-level boosters + coins:** Slingshot ×1/2/1/2, Shuffle ×2/2/3/2/1, Comet ×1/1/2/2, Coins 25/35.
- **Lane 3 — unlimited boosters + coins:** UL Red 10/15/10, UL Chuck 10/15/15, UL Bomb 10/10/15, UL Lives 15/30/30/60, Coins 30/50.

*(The PDF p.5 bottom screenshot shows the design spreadsheet for exactly these three tracks — "Track 1 (Pre-level Boosters)", "Track 2 (Power-Up)", "Track 3 (UL + ULPB)".)*

**Token math vs measured balances** (`data_event_inst`, key `Photoshoot`, 1 instance): `avg_final_token_balance` ranges 181/124 (segment 0-9 NP/P — ≈2 items) through 1,035/623 (20-39) to **3,626/2,267 for 100+** — i.e. even the top segment on average reaches only ~set 7 of the 8,890-token full clear; the endless shop is for the extreme tail. Participation: 0.55/0.61 (0-9) rising to ~0.92–0.95 (20-39+); opt-in 0.90–0.96 everywhere; recipient_rate 0.18–0.20 (0-9) rising to 0.66–0.76 (top segments).

## Duration & cadence

| Source | Value |
|---|---|
| Design PDF pp.1, 5 | "week-long" (twice) — **contradicted by every operational source** |
| Ph config (`EventDuration (days)`, B3) | **4** |
| Ph_v2 config (only diff vs Ph) | **3** |
| 2026 live-ops calendar PDF | "Photoshoot, 4 days" |
| Admin-tool screenshot (PDF p.7) | 20→24 Oct 2025 = 4 days |
| Measured analytics (`data_event_accrual`, `instance_length_days`) | **5** (likely 4d event + claim day — *inferred*) |

**Scheduling:**

- **cal_curr** (33-day window, day 1 = Wednesday): **1 instance**, starting **day 7 (Tuesday)** (cell H17), in the side-event rotation Jigsaw d1 → **Photoshoot d7** → Jigsaw d14 → Bomb's Ballet d21 → Jigsaw d29. Duration 4d (config + 2026 calendar; not encoded in the cell).
- **cal_new** (same window): **1 × 3d**, starting **day 24 (Friday)** (cell Y17), rotation Mystery Puzzle d3 → Bomb's Ballet d10 → Jigsaw d17 → **Photoshoot d24** → Mystery Puzzle d31 — co-starting with a Kite Festival 3d instance. Matches the established "cal_new 1×3d (shortening)".
- **2026 live-ops calendar:** "Photoshoot, 4 days" appears **10 times in ~39 weeks** (≈ every 4 weeks), always in the LOW INTENSITY row of **Kite Festival weeks** (Jigsaw/Mystery Puzzle fill the other Kite weeks; Bomb's Ballet + Hatchling Hideaway run in River Rush weeks). One entry in the Beacon screenshot (PDF p.5) is labeled "Photoshoot 4d - Increased Token…" — at least one boosted-token variant has been scheduled.

## Resources paid

Of the 11 sim resources (main ladder / endless shop):

| Resource | Main ladder (full clear) | Endless shop |
|---|---|---|
| HC (Coins) | 100 (25+25+50) | 25–50 per coin node (×2 per lane) |
| Red (pre-level) | 1 | up to 8 (lane 1) |
| Chuck (pre-level) | 1 | up to 8 (lane 1) |
| Bomb (pre-level) | 1 | up to 11 (lane 1) |
| Slingshot | — | up to 6 (lane 2) |
| Shuffle | 1 | up to 10 (lane 2) |
| Comet | — | up to 6 (lane 2) |
| Unlimited Lives | 270 min | up to 135 min (lane 3) |
| UL Red | 15 min | up to 35 min (lane 3) |
| UL Chuck | 15 min | up to 40 min (lane 3) |
| UL Bomb | 15 min | up to 35 min (lane 3) |

No SPT, COOP tokens, avatars or star-daily rewards (all-zero columns). The primary "reward" for most of the ladder is **cosmetic** (wardrobe items); resource payout is concentrated at set completions — so per-player payout depends heavily on how deep the token balance reaches (see token math), which is why per-segment truncation matters more than means.

## Simulation notes

- **COLLECTION-type event.** Sim formula: `simCollection(cat)` = `measured × R × D × T` with **R = 1** (ladder verified byte-identical between Ph and Ph_v2 — only `EventDuration` differs, 4 → 3) *(established: "measured × R(=1) × D × T … Works.")*.
- **D — duration multiplier** from `data_event_accrual`, key **`Photoshoot`**: cal_new runs 1×3d vs current 4d — a **shortening**, i.e. reliable interpolation on the measured curve (unlike lengthening cases). Mean `cum_token_share` at day 3 is remarkably flat across segments: **0.727–0.735 (NONPAYER 0-9…100+), 0.723–0.746 (PAYER)**; day-4 shares are 0.980–0.984 everywhere (day 5 of the measured 5-day instance adds ≤2%). So D ≈ **0.73 raw** (day-3 share of the 5d instance) or ≈ **0.74** if normalized to the 4-day operational duration (day3/day4) — the engine normalizes cum_share to 1 at the current instance length per the established D definition; the measured instance (5d) vs calendar duration (4d) mismatch makes the normalization anchor worth a one-time check.
- **Measured base is a single instance** (`n_instances = 1`, `instance_length_days = 5`, ~52k–102k active-window players per segment) — no instance-to-instance variance data.
- **Engagement amplification ~156×** (HC ratio 100+ vs 1-9) *(established)* — mechanically driven by (a) participation 0.55 → 0.94 across segments, and (b) ladder truncation: resource bonuses sit at set completions, and low segments average ~2 items while top segments reach set 7+.
- **First-try-only + ×10 streak multiplier** makes token income super-linear in player skill/progression — the same mechanic family as Kite's win-streak scores; this is the structural reason both events amplify top-segment gains.
- Payout is **deterministic given a final token balance** (fixed prices, fixed set order enforced by unlock thresholds, no RNG, auto-claim) — the ladder can be truncated at the measured balance directly.
- The Ph sheet doubles as the **style reference** for all design/config sheets in this project (layout: Config Panel block → mechanics tables → reward grid with the 11-resource + SPT/COOP/Avatar/star-daily column set).

## Sources

| Fact | Source |
|---|---|
| Concept, dress-up loop, token collection, UI | Design PDF pp.1–2 |
| First-try-only tokens; 9 items/bird (27); categories; tiered unlocks; even-dressing guidance | PDF p.3 |
| Photo mode (save/share, filters, particles); endless bonus shop; "rewards & endless rewards in Beacon LiveOps Calendar" | PDF p.4 |
| Loss-aversion rationale; seasonal themes; "runs for one week" claim | PDF p.5 |
| Config screenshot (requiredSagaLevel 17, itemPrices, streakMultipliers 1/2/4/6/10, manualRewardClaiming false, endless prices 840/830/800); 3-track endless design sheet; Beacon calendar w/ "Photoshoot 4d" | PDF p.5 screenshots |
| Item table: 10 sets, unlock thresholds 0–25 | PDF pp.6–7 |
| Support: Progress field token restore; multiplier comp (30 min UL below ×4, 1 h UL above); multiplier not restorable; live 4-day instance Oct 2025 | PDF pp.7–8 |
| EventDuration 4; saga 17; 30 items; 10 tiers; 3×15 endless; itemLevelUnlocks; multiplier table | `NEW_LIVEOPS_CALENDAR_ECO.xlsx` sheet Ph rows 3–21 |
| 30-item priced ladder + resource bonuses | sheet Ph rows 24–54 |
| Endless lanes 1–3 (prices + contents) | sheet Ph rows 56–108 |
| Ph vs Ph_v2: only diff = duration 4 → 3 (B3) | programmatic full-sheet diff |
| cal_curr Photoshoot day 7 (Tue, H17); cal_new day 24 (Fri, Y17) | sheets cal_curr / cal_new row 17 |
| 2026 cadence: 10× "Photoshoot, 4 days", low intensity, Kite weeks | `current_live_ops_calendar_2026.pdf` (multiple pages) |
| Accrual curve (day-3 ≈0.73, day-4 ≈0.98, 5d instance, n=1) | sheet data_event_accrual, key 'Photoshoot' |
| Participation / opt-in / recipient rates; avg_final_token_balance 124–3,626 | sheet data_event_inst, key 'Photoshoot' |
| Sim formula (R=1, D, T), cal_new 1×3d, ~156× amplification, style-reference status | project HAND_OFF (established facts) |

## Gaps & open questions

1. **"Week-long" vs 4 days:** the design PDF says week-long twice, but config, both calendars and the Oct-2025 admin screenshot all say 4 days (v2: 3). The PDF is presumably stale; treat 4d as current. (Unlike Bomb's Ballet, config and calendar **agree** here — both shorten to 3d.)
2. **Base tokens per first-try win are not documented anywhere** — the ECO sheet has no `tokensPerLevel`, and the PDF screenshot values are illegible. Full clear = 8,890 tokens in 4 days; without the per-win base (× multiplier up to ×10) the required clears can't be derived.
3. **Streak multiplier tier advancement rule** (how many consecutive wins per tier step) is not documented — the p.2 screenshot shows a "0/2" progress pip under the multiplier bar, suggesting 2 wins per step, unconfirmed.
4. **Endless-lane consumption model:** whether players buy lanes in parallel, in fixed order, or pick freely ("11/11" counter in p.4 screenshot suggests per-lane sequential) — matters only for the extreme tail (>8,890 tokens), which averages suggest is negligible.
5. **`itemLevelUnlocks = 0,1,1,…`** (Ph row 13) semantics unclear vs the item-count thresholds (0,2,4,…) shown in the PDF table — possibly a different unlock dimension (per-set level gating); not used in the sim.
6. **Accrual curve from a single 5-day instance** applied to a 3-day event assumes no behavioral compression (players front-loading when the timer is shorter); n_instances = 1 means no variance estimate. Also the 5d measured vs 4d operational duration leaves the D normalization anchor (day-3 share ≈0.73 raw vs ≈0.74 day3/day4) worth a one-time check in the engine.
7. **"Increased Token" variant:** the Beacon screenshot shows at least one "Photoshoot 4d - Increased Token…" instance — a token-boosted variant would shift the measured balances/truncation depth; which variant the analytics instance was is unknown.
8. **`avg_final_token_balance` semantics** (tokens earned vs unspent leftover) undocumented; interpreted here as earned-tokens proxy, consistent with its use for ladder truncation elsewhere in the project.
9. **Cosmetic value leakage:** most ladder spend buys cosmetics, not resources — the sim only tracks the 11 resources, so Photoshoot's economy impact is properly limited to the set-completion bonuses (already how `data_gains` measures it); no action needed, just noting the design's resource density is low vs e.g. Bomb's Ballet.
