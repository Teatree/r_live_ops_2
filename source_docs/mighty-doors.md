# Mighty Doors (Tower of Fortune) — Mechanics

**Type:** push-your-luck gamble ladder (stage-by-stage survival + voluntary cash-out) | **Sim category:** `Mighty Doors` (NOT YET ADDED to `CATEGORY_ORDER`) | **Status:** DESIGN ONLY — no config sheet, no calendar lane, no `data_gains` rows, not simulated | **Config sheets:** none yet (proposed `MD` / `MD_v2`) | **Design doc:** `design_pdfs/DRBL-Mighty Doors (DB Tower of Fortune)-010926-212845.pdf` (27p, added 2026-09-01)

> **Read this first.** Every other source in this folder documents something that already ran and left
> measured rows in `data_gains`. Mighty Doors has never shipped. Everything below is CONFIRMED from
> the design deck only — meaning "the deck says so", not "the game does so". No number here has been
> validated against telemetry, because there is none.

## What it is

A **push-your-luck** event. The player spends a **Ticket** to start a *run*. A run is a ladder of
**60 stages**; at each stage the player is shown **4 closed doors** and picks one. Most doors hold a
reward; one holds a **Pig** (the Failure outcome). Picking a reward door banks it into a temporary
prize pool and advances the player one stage. Picking the Pig **interrupts the run and puts every
reward accumulated so far at risk**.

At that point the player chooses:

- **End Run** — the run ends and **all accumulated rewards are lost**. (CONFIRMED, p7.)
- **Continue** — pay to resume. The Pig is removed from the stage, the player picks again from the
  remaining unopened doors, and *because only one Pig can exist per stage that pick is a guaranteed
  reward*. Accumulated rewards are preserved. (CONFIRMED, p8.)

At any point after a successful stage the player may **Cash Out**: end the run voluntarily and keep
everything banked. (CONFIRMED, p9.)

The player fantasy the deck states outright: *"I've already won some rewards… should I risk going
further for even better prizes?"* (p3).

**The business goal is explicitly monetization, not generosity** (p2, verbatim): *"Increase overall
monetization outside the core game economy"* and *"Create additional spending opportunities for
whales and highly engaged players"*. This matters for how the feature is modelled — see
§ Simulation notes.

## Stage structure

All values below are the **default configuration**; the deck states repeatedly that essentially every
parameter is LiveOps-configurable (pp.5, 10–11, 18, 22).

| Property | Default | Note |
|---|---|---|
| Total stages per run | **60** | configurable |
| Choices per stage | **4** | configurable per stage, min 2 max 4 — the primary difficulty dial |
| Failure outcomes per stage | **exactly 1** | hard rule: "Only one Failure outcome (Pig) can appear per stage" (p5, restated p19/p22) |
| Failure position | uniformly random among the choices | CONFIRMED p5 |
| Unselected doors | always revealed after the pick | including on Safe Stages (p5, p23) |
| Empty outcomes (no reward, no Pig) | **supported, off by default** | "Potentially yes" (p22) — frequency/placement configurable if enabled |

### Stage types

- **Stage 1** — always Safe. No Pig, all doors pay, progression guaranteed. (p5)
- **Standard stages** — default 3 reward doors + 1 Pig. (p5)
- **Safe stages** — **every 5th stage** (5, 10, 15, 20, 25 …). No Pig; rewards "typically more
  valuable than Standard Stages". (p6)
- **Milestone safe stages** — **stage 30 (Major)** and **stage 60 (Aspirational)**, carrying Special
  and Higher rewards. (p6)
- **Stage 60 completion** — all accumulated rewards are auto-claimed and the run ends. (p6)

**Derived (INFERRED, arithmetic on the defaults):** of the 60 stages, 1 is the safe opener, 12 are
every-5th safe stages (5…60), leaving **47 standard stages**, each survived with probability 3/4.
This single fact dominates the economics — see § Simulation notes.

### Reward tiers

Six tiers, one per 10 stages: T1 1–10, T2 11–20, T3 21–30, T4 31–40, T5 41–50, T6 51–60. (p6)
Reward values rise with tier. **There are no hardcoded restrictions on which reward type may appear
in which tier** (p7, p25) — the deck's *example* (not a rule) is early tiers Coins/Boosters, mid
tiers Event Tokens/Unlimited Lives, late tiers cosmetics.

## Reward pool

CONFIRMED list (p7), mapped to the sim's 19 resources:

| Deck reward | Sim resource | Note |
|---|---|---|
| Coins | `HC` | |
| Boosters | `Red` / `Chuck` / `Bomb` | |
| Power-ups | `Slingshot` / `Shuffle` / `Comet` | |
| Unlimited Lives | `Unlimited Lives` | (and presumably `UL Red/Chuck/Bomb`) |
| Event Tokens | `SPT` (/ `SPTx2`) | season-pass tokens — feeds the Season Pass tier coupling (D16) |
| **Dream Album Envelopes** | `1-star Pack` … `6-star Pack` | **ties this event to the card collection and therefore to D26** |
| Album Badges | — | no sim resource; not modelled |
| Event Tickets | — | **no sim resource** — tickets are this feature's own entry currency |
| Avatars | — | cosmetic, no economy value in the model |
| Skins, Frames | — | listed as FUTURE |

Two of these matter structurally: **Event Tokens** push the Season Pass tier (both sides of
`sptTotals_`), and **Envelopes** put Mighty Doors on the pack lane, where the D26 season cutoff
applies to it like any other source.

## Failure, Continue, and the sink side

- Continue methods: **Premium Currency** now, **Rewarded Advertisement** flagged FUTURE. (p7)
- **Continue costs must escalate after each consecutive use within the same run**; the escalation
  curve is configurable. (p8, p24 — stated as a hard requirement, not a suggestion.)
- **No default limit** on continues per run; a configurable max is supported, and the final rule is
  "Decision Pending. Further definition required once the Continue economy is finalized." (p24)
- Analytics track *"Premium Currency Continues"*, *"Revenue Generated by the Feature"*, and
  *"Record total hard currency spent per session"* (pp.16–17).

**This makes Mighty Doors the first source in the model that is designed to be a net HC SINK for
engaged players**, not a faucet. Every existing simulated source only ever pays out. See
§ Simulation notes for why that breaks the current grid and what to do about it.

## Cash-Out

- **Variant A (default in the main body):** cash out after **every** successful stage. (p9, p19)
- **Variant B:** cash out only on Safe Stages. (p23)
- The deck contradicts itself on the A/B: the Questions section says an **A/B test is required** to
  pick the default and that the variant stays LiveOps-configurable afterwards (p23, p27), while an
  earlier answer flatly says the variant should **not** remain configurable (p19). Treat "A/B test
  pending, Variant A is the working default" as the position. FLAGGED.

## Entry, tickets and availability

- **1 Ticket per run** by default, configurable. (p9)
- **No ticket storage cap at all.** (p9, p19, p20)
- Ticket sources: **Daily Login rewards, Event rewards, Shop offers, special promotions, or any
  other LiveOps-defined source.** (p9) — i.e. tickets themselves become a reward other events must
  pay, including Mighty Doors itself ("Event Tickets" is in its own reward pool).
- Deployment: permanent feature / recurring LiveOps event / limited-time event, all configurable.
  Availability gated by LiveOps segmentation (player level, post-onboarding, targeted segments).
  (p9, p24)
- **Online-only**, server-validated. Run state is saved on force-close and the player is **forced**
  back into the run on reconnect. (pp.25–26)
- **Event end:** if online, the player is force-redirected to choose Cash Out or Continue. If offline
  or the app is closed, the server performs an **Auto Cash-Out** and delivers rewards to the Inbox.
  Conversion rates for that fallback are explicitly left to the Economy team, with the requirement
  that **pity-system thresholds cannot be bypassed**. (pp.20–21, p26)

## Calendar

**No lane exists yet** in `cal_curr` or `cal_new`. Nothing in the current 33-day window carries this
event, so it contributes 0 to every existing sheet. A lane label (proposed `Mighty Doors`) and
instances must be drawn before the simulation can place it.

Duration is a configurable event length (p10 lists "Duration of the event" as a LiveOps parameter);
the deck gives no default. **UNKNOWN — blocking for `T`.**

## Simulation notes

> Nothing here is implemented. This section states how the event *should* be modelled and why; the
> step-by-step build plan lives with the decision that eventually adds it.

**1. It is an ADD, not a change.** Mighty Doors has never run, so `data_gains` has no rows for it and
`measuredRow_` returns 0. `SIMULATED = measured × R × D × T` is therefore identically 0 and can never
produce a number — exactly the situation D19 packs and Rainbow Maker are in. The value must be built
**bottom-up** from the config, and `DIFF` equals the simulated value because the baseline is a true
zero. This is the one case where the project's "change, not add" rule (see `CLAUDE.md`) does *not*
apply: there is no prior player experience to synthesise an anchor from, unlike `spPaidSynth_` or
`coreSptSynth_`.

**2. The payout is governed by a survival curve, and the curve is brutal.** Expected run value is

> `E[run] = Σ_stages s  P(reach s) × E[reward | s]`

where `P(reach s)` is the product of per-stage survival probabilities, `3/4` on a standard stage and
`1` on a safe one. With the default 47 standard stages, surviving to stage 60 unaided is
`0.75^47 ≈ 1.3 × 10⁻⁶`. Expected standard stages cleared before the first Pig is `p/(1−p) = 3`.
**The median run therefore dies in the single-digit stages, and virtually all realised value comes
from Tier 1.** Any model that averages the 60-stage ladder, or that reasons from the milestone
rewards at stages 30 and 60, will overestimate the faucet by orders of magnitude. This is the same
failure mode as the still-undiagnosed ~5× Night Sky bottom-up overestimate (see `night-sky.md`), and
it is the single biggest modelling risk in this event.

**3. Two player decisions sit inside the expectation, and the model has never had one.** Every other
simulated source pays on *reach* — a monotone function of effort or luck. Here the payout depends on
(a) **when the player cashes out** and (b) **whether they pay to continue**. Both are choices, both
are unobserved, and the second means **the player's HC balance feeds back into their HC income**.
There is no precedent for this anywhere in the engine. Both must enter as explicit, named, editable
assumptions rather than being buried in a formula.

**4. It is a coin SINK as well as a faucet, and the grid cannot express that.** `resultRow_` produces
gains; the NET blocks get spend from `data_econ_daily`, which will have no rows for an event that has
not shipped. A continue costs HC. The honest options are to model the gains and report the continue
sink alongside as a separate figure, or to let the row carry a negative HC. Given the v3 economy
finding that **~94.5% of coin spend is the flat 100-coin continue** (see
`../reports/LiveOps_v3_economy_playbook.html`), a second large, escalating coin sink is arguably the
most economically interesting thing about this feature and should not be left out of the read-out.

**5. Runs per player is an input, not a derivation.** The faucet scales linearly with how many runs a
player gets, which is set by ticket supply — and tickets come from Daily Login, other events, the
shop, and Mighty Doors itself. None of that is configured yet. `runs_per_player` must be an authored
assumption on the config sheet, printed on every harness run the way `PACK_PARTICIPATION` is (D25).

**6. Envelopes route through the existing pack lane.** Because the reward pool includes Dream Album
Envelopes, Mighty Doors pays into `packLane_` like every other configured source, and the D26 season
cutoff applies to it unchanged: instances wholly past `SEASON_LAST_DAY` pay no envelopes, straddlers
pay in full with the landing day clamped.

**7. Event Tokens reach the Season Pass.** SPT paid here flows through `sptTotals_` into the tier
coupling (D16), so Mighty Doors will move the Season Pass row on both sides. Expect a second-order
effect on top of the first-order one.

## Config sheet

`display/MD_v1.xlsx` (sheet **`MD`**, built by `builders/_build_mightydoors.py`; duplicate the
imported sheet as `MD_v2`). Rewards are defined **per node** in the shared 21-column grammar, the
same way `RM_1st_v2` defines milestones and `HH_v2` defines gates -- 60 rows, one per stage. Tier
survives only as a derived reference column.

**Slot composition, not slot position.** A node declares how many doors it has and how many are
Pig / Reward / Empty. Which door hides the Pig is a runtime draw (p5: the Failure outcome "can
appear randomly in any of the available choice positions") and is deliberately NOT configurable.
A `Slots OK?` column self-checks that the three add up to `Choices`; if they do not, every
survival number below is meaningless and nothing else on the sheet would say so. Empty slots are
not failures -- they end the stage with no reward and no loss -- which is why `Survive p` and
`P(reward | survived)` are two separate derived columns, and why the cumulative-reward helper
weights each node by the latter.

Behaviour is per segment (continue take-up, cash-out stage, runs per active day), because this
event has no accrual to separate player types with. The sheet carries the standard
`Player Reach Simulation (per event day) - SIMULATED` block at AH1, the same one HH_v2, BB_v2,
J_v2, Ph_v2 and both RM sheets carry.

## Flags / open questions

1. **Cash-out policy is completely unknown** and it is the largest single lever on the payout. A
   player who cashes out at stage 5 every run and one who never cashes out have wildly different
   expected income from the same config. BLOCKING — needs a stated assumption, ideally a
   distribution over stop-stages rather than a single policy.
2. **Continue take-up is unknown**, and it determines both the sink size and how deep runs get. The
   deck itself defers it: "Decision Pending. Further definition required once the Continue economy
   is finalized" (p24).
3. **No reward values exist anywhere.** The deck names the pool and the tier structure but gives not
   a single number. Until an `MD` config sheet is authored with real ladder values, every resource
   reads 0 — which is correct, not a plumbing failure (same convention as the D19/D21 pack ladders).
4. **Continue cost and its escalation curve are unspecified.** Required to escalate, curve
   undefined.
5. **Event duration and cadence are unspecified**, so `T` cannot be computed and no calendar lane can
   be drawn.
6. **Ticket supply is unspecified**, so runs per player is unconstrained. Note the deck explicitly
   removes every storage cap, which means tickets can be hoarded across events and spent in a burst —
   a run-rate the model would not predict from a per-day grant rate.
7. **Cash-Out variant contradiction** between p19 ("should the variant remain configurable?" → "No")
   and pp.23/27 (A/B test, stays configurable). Unresolved in the deck itself.
8. **Album Badges and Event Tickets have no sim resource.** Tickets in particular are a real economy
   object here (they gate participation) but sit outside the 19-resource universe. Decide whether to
   model ticket flow at all or treat runs-per-player as the primitive.
9. **Auto Cash-Out conversion rates** are unspecified and explicitly assigned to the Economy team —
   including the constraint that pity thresholds must not be bypassable, which implies a link to the
   card collection's pity system.
10. **Empty outcomes** are "potentially yes" (p22) but described as supported and configurable in the
    main body (p5). If enabled they change the survival/EV maths materially. Assume OFF until told.

## Sources

- `design_pdfs/DRBL-Mighty Doors (DB Tower of Fortune)-010926-212845.pdf` — 27 pages, the sole
  source for this document. Structure: Overview/Goals (p2), Entry & Surfacing (p3), Terminology
  (pp.3–4), Stage Structure (pp.5–6), Rewards (pp.6–7), Failure & Continue (pp.7–8), Cash-Out
  (pp.8–9), Entry System & Availability (pp.9–10), Difficulty & Risk Curve (p10), UX/Screens
  (pp.11–15), Analytics (pp.16–17), Audio (pp.17–18), Questions (pp.18–27).
- Figma prototype linked at p15 (not accessed).
- Cross-references: `card-collection.md` (envelopes, pity), `season-pass.md` (Event Tokens → SPT
  tier coupling), `night-sky.md` (the bottom-up overestimate precedent).
