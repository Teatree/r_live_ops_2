/************************************************************************************************
 * EcoGainsSim_v4.gs — per-source simulation engine for EcoGainsSim_HC (SIMULATION_PLAN v3)
 * ---------------------------------------------------------------------------------------------
 * Brand-new engine based on EcoGainsSim.gs. One named function per source (D15); everything
 * numeric is read LIVE from the workbook (D12): config sheets, both calendars, data_* sheets.
 *
 * CUSTOM FUNCTIONS (per segment block, spills 25x19):
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_SIM(payer, segment))     // C<firstDataRow>
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_DIFF(payer, segment))    // O<firstDataRow>
 *   segment = '0-9' | '10-19' | '20-39' | '40-99' | '100+' | 'A. 0' (appendix, carried+annotated)
 *
 * MODEL PER SOURCE (see SIMULATION_PLAN.md §2 for specs and worked numbers):
 *   carried        Ads, Other, Team Event, Team Race, FlowerCoop, IAPs, Flock Flurry
 *                                                                    → measured
 *   Core           carried EXCEPT SPT (D17/D18): level completions pay difficulty-tiered SPT.
 *                  Anchor SYNTHESIZED (data_gains has no Core SPT rows): L x E, with
 *                  L = levels_completed_per_active_day x Σ p_day (33-day window) and E = the
 *                  difficulty-mix per-level SPT off the SP / SP_v2 panel, averaged over the
 *                  two season halves. meas = L x E_base, sim = L x E_v2 (behaviour constant).
 *   Season Pass    simulated since 2026-07-10 (D16 — SPT tier coupling): more/less SPT earned
 *                  across ALL sources moves the season-pass track tier reached, which scales the
 *                  Season Pass (Free) payout row. Per resource:
 *                    SIM = measured x cum_v2(T_sim)/cum_base(T_meas) x R_challenge x T
 *                  T_meas/T_sim = tier reached on the SP / SP_v2 'Cumul' points ladder by the
 *                  per-earner SPT+2xSPTx2 window totals (measured vs simulated; additive-
 *                  projection convention), scaled x seasonDays/33. cum = Σ tier rewards 1..T —
 *                  FREE track for NONPAYER, FREE+PAID for PAYER (assumption: the measured
 *                  '(Free)' row contains payers' paid-track claims too). R_challenge = SP_lb_v2 /
 *                  SP_lb rank-ladder pot ratio (zero-sum, Kite-style; no position telemetry —
 *                  Dream Pass rows are empty). D pinned 1; T from the 'Season Pass' calendar
 *                  lane. No anchor (measured 0 or cum_base 0): tiers GAINED add the absolute
 *                  SP_v2 rewards of tiers (T_meas, T_sim] (HYBRID — flagged); otherwise carry.
 *                  SP's own SPT contribution uses measured on BOTH sides (single pass, no
 *                  recursion). SP_v2/SP_lb_v2 missing → base sheets (ratios 1).
 *   Saga           measured x per-resource ratio: HC from the per-segment HC columns; every
 *                  item (boosters/ULs) from the per-node item ladders on both sheets (v3 item
 *                  edits — e.g. zeroing ULs — now move the sim). Base1 items carried.  [D9]
 *   Daily Gift     measured, HC x streak-weighted ladder ratio (c_day pair)
 *   leaderboard    Bomb/Chuck/Red Challenge, Level Race, Flash Race, Target Day (D4),
 *                  and Kite Festival (since 2027-07-06 — payouts are rank-based zero-sum per
 *                  league of 61, so duration doesn't move them; the old score-curve D is gone):
 *                  measured x R x T  (D pinned 2 — rank payouts are end-state).
 *                  R = reward-config ratio v2/base: the rank ladder priced at the measured
 *                  position_p25/50/75 (data_event_inst), per segment/payer/resource. Kite also
 *                  prices its score milestone (survival over final_balance percentiles).
 *   collection     HH, Bomb's Ballet, Jigsaw, Photoshoot: measured x R x D x T.
 *                  R = milestone ladder priced at survival over final_balance_p25/50/75:
 *                  E = Σ_k S(req_k) x rew_k, v2/base — reward AND requirement edits both flow.
 *                  (HH/Ph requirement axis = the v2 EventReach helper column, shared by both
 *                  sides — base sheets have no native cumulative req column.)
 *   Night Sky      bottom-up daily-reset sim (D13; re-wired 2026-07-06, NIGHT_SKY_REWIRE_PLAN
 *                  Option A): E_day = Σ_k S(CumStreakReq_k) x reward_k with survival S over the
 *                  data_streaks max_streak_per_day percentiles scaled by N = 1.25 (effective-
 *                  streak factor); window = E_day x Σ p_day. Measured is A/B-diluted → the DIFF
 *                  row is the ROLLOUT EFFECT (full-rollout sim minus diluted measured).
 *   Rainbow Maker  bottom-up survival-weighted (D6/D7): per cal_new instance,
 *                  Σ_k S_dur(ReqAccum_k) x reward_k x reach(inst); data_RM percentiles.
 *                  Split configs since 2026-07-10 (HARDCODED, see CLAUDE.md): start-sorted
 *                  instances #1-#3 read RM_1st, #4-#5 RM_2nd (SPTx2); fallback to RM.
 *   River Rush     calendar-driven branches (D4): no cal_new instances today → 0
 *   PACKS (D19)    the six card-collection pack tiers are SIMULATED-SIDE ONLY — data_gains has no
 *                  pack rows, so measured is 0 and the multiplicative model can never produce one.
 *                  Every source instead prices packs bottom-up on cal_new (packLane_):
 *                    packs = E_v2 x participation_rate x Σ_inst reach(inst)      (no D term)
 *                  reusing the SAME E the R ratio is built from. RM / Night Sky were already
 *                  bottom-up (packs flow via RES_MAP alone). Season Pass prices the whole reached
 *                  track. Team Event + Flock Flurry are CARRIED for every other resource but get
 *                  a pack overlay from their config sheets (PACK_ONLY_SPECS); Team Race, Ads and
 *                  IAPs have no config sheet → 0. A. 0 has no behaviour telemetry → 0.
 *
 * CALENDARS drive cadence + duration: merge = one instance (width = duration), lone filled
 * cell = one 1-day instance, neighbours never collapsed, day = column - 1, weekend =
 * (day-1)%7 in {2,3,4} (both calendars start Wednesday).
 *   T = Σ_new reach / Σ_cur reach, reach(inst) = 1 - Π_days(1 - p_day)
 *   D = curveShare(newDur) / curveShare(curDur)   (normalised at curDur)
 *   Removal semantics: a simulated event with no cal_new instances → SIMULATED 0.
 *   Fail-safes: if a calendar parses EMPTY (custom-function context problem) → carry measured
 *   (diff 0, "no change" — the Kite row is the canary: it must shrink). Menu fix below.
 *
 * MENU (robust calendar read): EcoGainsSim ▸ Precompute calendars — parses both calendars with
 * full permissions and writes them to a hidden 'cal_parsed' sheet; the engine prefers that
 * sheet when present. Re-run it after editing a calendar (or Clear to go back to live parsing).
 *
 * AUTO_REFRESH (regeneration switch): Google only re-runs a custom function when its ARGUMENTS
 * change, so config edits (e.g. c_saga_v2 rewards) don't regenerate the gains by themselves.
 * Every ECOGAINS_* formula therefore carries a trailing NONCE argument (sim_refresh!$A$1, a
 * hidden one-cell sheet); with AUTO_REFRESH = true the onEdit trigger below watches every input
 * sheet and bumps that nonce after each edit — one atomic write, all sim formulas re-run (all
 * reads are live, so the new values flow through). Formulas are NEVER cleared/re-set anymore
 * (the old clear→restore refresh is what periodically wiped them — see refreshSims_). Set to
 * false to disable; then refresh manually via the EcoGainsSim ▸ Refresh simulations menu item.
 * Note: calendar MERGE changes don't fire onEdit — run Precompute calendars after editing
 * merges (it refreshes the sims itself).
 ************************************************************************************************/

// TRUE: config/data/calendar edits automatically regenerate the simulated gains.
// FALSE: recalculation only via the menu (EcoGainsSim ▸ Refresh simulations) or argument edits.
var AUTO_REFRESH = true;

// ============================== LAYOUT & REGISTRY ============================================
var SHEET = 'EcoGainsSim_HC';
var PAYER_CELL = 'C3';
var SEG_CELL   = 'C4';   // fallback only
var CAL_CUR = 'cal_curr', CAL_NEW = 'cal_new';

// Append-only (19 since 2026-08-03, D19: the six card-collection PACK tiers. 13 since
// 2026-07-10: SPT + SPTx2 — season pass tokens; SPTx2 counts double toward season-pass tier
// progression but is displayed as its own column).
// Packs are SIMULATED-SIDE ONLY (D19/2): data_gains has no pack rows, so the measured anchor is
// 0 and `measured x R x D x T` can never produce one — every pack number comes from packLane_
// (bottom-up, cal_new). Consequence: the DIFF column for packs equals the simulated value.
var RESOURCES = ['HC','Slingshot','Shuffle','Comet','Red','Chuck','Bomb',
                 'UL Bomb','UL Chuck','UL Red','Unlimited Lives','SPT','SPTx2',
                 '1-star Pack','2-star Pack','3-star Pack','4-star Pack','5-star Pack','6-star Pack',
                 'ToF_Ticket'];

// The pack slice of RESOURCES, in tier order. Everything pack-specific keys off this.
var PACK_RES = ['1-star Pack','2-star Pack','3-star Pack','4-star Pack','5-star Pack','6-star Pack'];
function isPackRes_(r){ return PACK_RES.indexOf(r) !== -1; }

// Mighty Doors / Tower of Fortune entry currency (resource 20, appended 2026-09-02). Like the six
// pack tiers it has NO measured anchor - data_gains emits no ToF_Ticket rows - so every ticket
// number is priced bottom-up on cal_new by the same pack lane.
var TOF_TICKET = 'ToF_Ticket';
// Resources with a gain model but no SPEND telemetry, so their NET cell is blank rather than a
// number. Packs have no spend at all; tickets ARE spent (one per run) but the spend is internal to
// the ToF sim -- players consume them immediately, so a net cell could only ever restate 0. Blank
// says "no net position exists here", which is the honest reading; the sheet's net-delta formulas
// IFERROR it to blank, whereas a literal 0 would read as a real, measured zero.
function isGainsOnlyRes_(r){ return isPackRes_(r) || r === TOF_TICKET; }
// Resources the pack lane prices BOTTOM-UP. data_gains emits no rows for any of them, so the
// measured anchor is identically 0 and `measured x R x D x T` can never produce one -- the ratio R
// is meaningless when both sides are 0, and the carry rule then (correctly) carries the zero. The
// ticket joins the six pack tiers here for exactly that reason: a ToF_Ticket typed onto a _v2
// ladder has to reach the sim the same way a pack does, or it silently does nothing.
var BOTTOMUP_RES = PACK_RES.concat([TOF_TICKET]);

// Sheet row order. THIS LIST IS THE SPILL, POSITION BY POSITION: ECOGAINS_SIM returns one row per
// entry, in order, and the sheet's column-B labels are static text that is never checked against it.
// A label added to the sheet without a matching entry here therefore does not read blank - it
// SHIFTS every row below it onto the wrong source, silently. That is exactly what happened when
// 'Season Pass (Paid)', 'Col - Sets' and 'Col - Albums' were added to the workbook (2026-08-21):
// rows 26-32 each showed the NEXT source's numbers (Rainbow Maker's HC appeared under FlowerCoop,
// Rainbow Maker itself read 0) and the last three rows stayed empty. 28 rows now.
// If you add a row to the sheet, add it here at the same position, or the block silently mis-reads.
var CATEGORY_ORDER = [
  'Ads','Bomb Challenge',"Bomb's Ballet",'Chuck Challenge','Core','Daily Gift','Daily Night Sky Prize',
  'Flock Flurry','Hatchling Hideaway','Jigsaw','Kite Festival','Level Race','Other','Photoshoot',
  'Red Challenge','River Rush','Saga','Season Pass (Free)','Season Pass (Paid)','Target Day',
  'Team Event','Team Race','Flash Race','FlowerCoop','Rainbow Maker','IAPs',
  // 'ToF' sits between IAPs and Col - Sets because that is where the EcoGainsSim sheet puts its
  // label (row 34). Until it was added here the spill was 28 rows against 29 labels and the last
  // three were all wrong: ToF showed Col - Sets' numbers, Col - Sets showed Col - Albums', and
  // Col - Albums was blank. Nothing errored - exactly the 2026-08-21 failure described above.
  'ToF',
  'Col - Sets','Col - Albums'
];

// display segment -> data_gains label (D8: '0-9' anchors to B. 1-9; A. 0 = appendix, own label)
var SEG_TO_GAINS = {'0-9':'B. 1-9','10-19':'C. 10-19','20-39':'D. 20-39','40-99':'E. 40-99',
                    '100+':'F. 100+','A. 0':'A. 0'};

// category -> its own named simulator (D15). Unlisted => carried (= measured).
var SOURCES = {
  'ToF'                   : simToF,        // Mighty Doors / Tower of Fortune (2026-09-02)
  'Core'                  : simCore,
  'Saga'                  : simSaga,
  'Daily Gift'            : simDailyGift,
  'Daily Night Sky Prize' : simNightSky,   // re-enabled 2026-07-06 (NIGHT_SKY_REWIRE_PLAN)
  'Bomb Challenge'        : simBombChallenge,
  'Chuck Challenge'       : simChuckChallenge,
  'Red Challenge'         : simRedChallenge,
  'Level Race'            : simLevelRace,
  'Flash Race'            : simFlashRace,
  'Target Day'            : simTargetDay,
  'Hatchling Hideaway'    : simHatchlingHideaway,
  "Bomb's Ballet"         : simBombsBallet,
  'Jigsaw'                : simJigsaw,
  'Photoshoot'            : simPhotoshoot,
  'Kite Festival'         : simKiteFestival,
  'Rainbow Maker'         : simRainbowMaker,
  'River Rush'            : simRiverRush,
  'Season Pass (Free)'    : simSeasonPass,
  'Season Pass (Paid)'    : simSeasonPassPaid,   // the PAID track, split out 2026-08-21
  'Col - Sets'            : simColSets,          // card-collection SET completion rewards
  'Col - Albums'          : simColAlbums         // card-collection ALBUM completion rewards
};

// config/ladder column header -> engine resource name (shared by RM + NS readers)
// The 'N-star Dly' headers are the card-collection packs (D19). Every reward block on every
// config sheet already spans Coins..6-star Dly, so mapping them here is all it takes for
// rewCols_/rewRow_, readLadder_, the saga node reader and PBP's ladder readers to pick packs up.
var RES_MAP = {'Coins':'HC','HC Reward':'HC','Red':'Red','Chuck':'Chuck','Bomb':'Bomb',
               'Slingshot':'Slingshot','Shuffle':'Shuffle','Comet':'Comet',
               'Unlimited Lives':'Unlimited Lives','Unlimited Red':'UL Red',
               'Unlimited Chuck':'UL Chuck','Unlimited Bomb':'UL Bomb',
               'SPT':'SPT','SPT x2':'SPTx2',   // config sheets write 'SPT x2' with a space
               '1-star Dly':'1-star Pack','2-star Dly':'2-star Pack','3-star Dly':'3-star Pack',
               '4-star Dly':'4-star Pack','5-star Dly':'5-star Pack','6-star Dly':'6-star Pack',
               // ToF tickets are authored under their own name (no 'Dly' suffix) on every config
               // sheet. Without this entry rewCols_ skips the column and every ticket a designer
               // types reads 0 - silently, and indistinguishably from "none authored yet".
               'ToF_Ticket':'ToF_Ticket'};

// category -> calendar row label, for ECOGAINS_CAL_STATS (keep in sync with the per-source sim
// wiring above and with DAILY_CAL_LABEL in EcoGainsSim_Daily.gs). Categories not listed have no
// calendar schedule (always-on / non-calendar) and show blank stats.
var CAL_LABEL = {
  'Bomb Challenge':"Bomb's Challenge", 'Chuck Challenge':"Chuck's Challenge",
  'Red Challenge':"Red's Challenge", 'Level Race':'Level Race', 'Flash Race':'Flash Race',
  'Target Day':'Target Day', 'Kite Festival':'Kite Festival',
  'Hatchling Hideaway':'Hatchling Hideaway', "Bomb's Ballet":"Bomb's Ballet Show",
  'Jigsaw':'Jigsaw Puzzle', 'Photoshoot':'Photoshoot', 'Rainbow Maker':'Rainbow Maker',
  'River Rush':'River Rush', 'Daily Night Sky Prize':'Night Sky',
  'Season Pass (Free)':'Season Pass',   // season-long lane; T from cadence x reach, D pinned 1
  'Flock Flurry':'Flock Flurry',   // carried in the sim, but scheduled — stats show its cadence
  'ToF':'ToF'                      // one merged 33-day instance: the event is always-on
};

// ============================== CUSTOM FUNCTIONS =============================================
/** @customfunction */
function ECOGAINS_SIM(payer, segment){
  var p = String(payer   || readCell_(PAYER_CELL) || 'NONPAYER').trim();
  var s = String(segment || readCell_(SEG_CELL)   || '0-9').trim();
  var ctx = Context.get();
  return CATEGORY_ORDER.map(function(cat){ return rowToArray_(resultRow_(cat, s, p, ctx)); });
}
/** @customfunction */
function ECOGAINS_DIFF(payer, segment){
  var p = String(payer   || readCell_(PAYER_CELL) || 'NONPAYER').trim();
  var s = String(segment || readCell_(SEG_CELL)   || '0-9').trim();
  var ctx = Context.get();
  return CATEGORY_ORDER.map(function(cat){
    var res = resultRow_(cat, s, p, ctx), dat = measuredRow_(cat, s, p, ctx.ds);
    return RESOURCES.map(function(r){ return num(res[r]) - num(dat[r]); });
  });
}

/**
 * Calendar stats per category: [instance count, total event-days] for one calendar.
 * Spills 25 rows x 2 cols (matches the EcoGainsSim_HC block rows 8-32).
 * (19-resource layout since 2026-08-03: sim C..U, diff W..AO — the old AE8/AH8 anchors now sit
 * inside the widened diff block; place these clear of it:)
 *   AQ8: =ECOGAINS_CAL_STATS("cal_curr")   -> fills AQ (instances) + AR (event-days)
 *   AT8: =ECOGAINS_CAL_STATS("cal_new")    -> fills AT + AU
 * Event-days count REAL days (clipped instances count what actually fits in the window).
 * Non-calendar categories (Core, Saga, Daily Gift, Ads, Teams, ...) return blanks.
 * Auto-updates like the gains: refreshSims_ bumps the nonce argument every ECOGAINS_* formula
 * carries, and calendar merge edits are picked up via the Precompute calendars menu.
 * @customfunction
 */
function ECOGAINS_CAL_STATS(cal){
  var name = String(cal || '').trim();
  if (name !== CAL_CUR && name !== CAL_NEW)
    return [['Unknown calendar: ' + name + ' (use cal_curr / cal_new)']];
  var ctx = Context.get();
  var parsed = (name === CAL_CUR) ? ctx.calCur : ctx.calNew;
  return CATEGORY_ORDER.map(function(cat){
    var label = CAL_LABEL[cat];
    if (!label) return ['', ''];
    var insts = parsed[label] || [];
    var days = 0;
    insts.forEach(function(x){ days += ((x && x.days) || []).length; });
    return [insts.length, days];
  });
}

function resultRow_(cat, seg, payer, ctx){
  if (seg === 'A. 0' || seg === 'A.0') return appendixRow_(cat, payer, ctx);   // §3 block
  var fn = SOURCES[cat];
  var row = fn ? (fn(seg, payer, ctx, cat) || measuredRow_(cat, seg, payer, ctx.ds))
               : measuredRow_(cat, seg, payer, ctx.ds);                        // carried
  // D19: a carried source can still pay packs bottom-up (Team Event, Flock Flurry) — overlay the
  // six pack columns, leave every other resource exactly as the simulator/carry produced it.
  if (PACK_ONLY_SPECS[cat]){
    var packs = packOnlyRow_(cat, seg, payer, ctx);
    if (packs) row = overlayPacks_(copyRow_(row), packs);
  }
  return row;
}

// measured anchor. Core and Saga are separate rows (data_gains emits both) — no folding.
// Core SPT (D18): data_gains has no Core level-completion SPT rows, so when the raw SPT is 0
// the anchor is SYNTHESIZED (L x E_base — see coreSptSynth_). One choke point keeps every
// consumer consistent (DIFF, daily CURRENT, sptTotals_ measured side); the moment a data_gains
// re-pull delivers real Core SPT rows, the raw value takes back over (no double count).
// A. 0 stays raw (appendix — no behaviour telemetry, §3).
function measuredRow_(cat, seg, payer, ds){
  var row = ds.dataRow(cat, seg, payer);
  // Season Pass (Paid): SYNTHETIC anchor, same pattern as the D18 Core SPT one. data_gains has no
  // '(Paid)' category, so without this the measured side is 0 and the DIFF becomes the whole paid
  // track - the row would read as a brand-new source appearing from nowhere. Payers held the pass
  // LAST season too (Garry, 2026-08-21), so what actually changes is how far up the track they
  // climb: the anchor is the paid track up to the tier the MEASURED SPT reached, and the diff is
  // the movement. Intercepted here, the one choke point, so DIFF / daily / Sim per Segment agree.
  if (cat === 'Season Pass (Paid)'){
    var spSyn = spPaidSynth_(seg, payer, ds);
    if (spSyn) return spSyn;
  }
  // Night Sky as a NEW source (NS_ANCHORED = false): the old calendar is treated as not having run
  // it at all, so the measured anchor is zero and the whole simulated lane lands in the DIFF. Also
  // keeps it out of the measured SPT total, so the Season Pass tier does not credit a season that
  // never happened.
  if (!NS_ANCHORED && NS_SIMULATE && cat === 'Daily Night Sky Prize') return zeroRow_();
  if (cat === 'Core' && seg !== 'A. 0' && seg !== 'A.0' && !(num(row['SPT']) > 0)){
    var syn = coreSptSynth_(seg, payer, ds);
    if (syn){
      var o = {};
      RESOURCES.forEach(function(r){ o[r] = num(row[r]); });
      o['SPT'] = syn.meas;
      return o;
    }
  }
  return row;
}

// ============================== A. 0 APPENDIX (§3 — carried & annotated, not simulated) ======
// A.0 players have no behaviour/accrual/matchables data. Config-only changes are applied
// (Saga ratio; Daily Gift ratio with 0-9 weights as PROXY — flagged; Core SPT R_SPT, which is
// segment-uniform so needs no A.0 telemetry — D17); RR removal is universal; everything else
// (incl. Night Sky, Rainbow Maker and the Season Pass tier coupling — D16) carries its measured value.
function appendixRow_(cat, payer, ctx){
  var ds = ctx.ds, meas = measuredRow_(cat, 'A. 0', payer, ds);
  if (cat === 'River Rush') return zeroRow_();
  if (cat === 'Core'){
    var Rspt = coreSptR_(ctx);                            // config-only SPT ratio (segment-uniform)
    if (Rspt === 1) return meas;
    var oc = {}; RESOURCES.forEach(function(r){ oc[r] = num(meas[r]); });
    oc['SPT'] = num(oc['SPT']) * Rspt;
    return oc;
  }
  if (cat === 'Saga'){
    var ratio = sagaRatio_('0-9'), itemR = sagaItemRatios_();   // config-only ratios
    var out = {};
    RESOURCES.forEach(function(r){
      var m = num(meas[r]);
      out[r] = (r === 'HC') ? m * ratio : (itemR[r] != null ? m * itemR[r] : m);
    });
    return out;
  }
  if (cat === 'Daily Gift'){
    var R = dailyGiftRatio_(ds.beh('0-9', payer));        // 0-9 streaks as proxy (overstates A.0)
    var o = {}; RESOURCES.forEach(function(r){ o[r] = num(meas[r]); }); o['HC'] = num(o['HC']) * R;
    return o;
  }
  return meas;
}

// ============================== ALWAYS-ON SOURCES ============================================
// Core — SPT simulated (D17/D18), everything else carried. Level completions pay a difficulty-
// tiered SPT reward (Normal/Hard/Extreme, per season half) under an assumed level-difficulty
// mix, so editing those per-level rewards on SP_v2 moves the SPT earned:
//   SIM[SPT] = measured[SPT] x R_SPT     (D=T=1, always-on; Core is the game's main SPT faucet)
// R_SPT = coreSptR_ (E_v2/E_base, scalar; E halves-averaged since D18). measured[SPT] is the
// D18 SYNTHETIC anchor (L x E_base via measuredRow_) while data_gains carries no Core SPT rows,
// so SIM[SPT] = L x E_v2 in practice. chapter_complete / PlayerLevelUpChest rewards did not
// change, so every OTHER Core resource stays carried (and measured Core SPTx2 = 0). R=1 until
// SP_v2 is edited, then Core SPT AND the Season Pass tier (sptTotals_ sums resultRow_ per
// category) both move off the same edit.
function simCore(seg, payer, ctx){
  var meas = measuredRow_('Core', seg, payer, ctx.ds);
  var R = coreSptR_(ctx);
  if (R === 1) return meas;                               // panel absent / SP_v2 unedited -> carried
  var out = {};
  RESOURCES.forEach(function(r){ out[r] = num(meas[r]); });
  out['SPT'] = num(meas['SPT']) * R;
  return out;
}

// Saga — reward-ratio per resource:
//   HC:      measured x (Σ c_saga_v2 HC [segment column] / Σ c_saga HC)   — per-segment
//   items:   measured x (v2 item-ladder per-level total / base item-ladder per-level total)
//            from the per-node item columns (SPT..Unlimited Bomb) on both config sheets.
//            v2's item ladder is one "all segs" set. Zeroing an item in v2 -> ratio 0 -> sim 0.
//   A resource present in only ONE ladder's header, or with base total 0, cannot be scaled off
//   the measured anchor -> carried unchanged (a base-0 -> v2-positive addition needs bottom-up).
function simSaga(seg, payer, ctx){
  var meas = measuredRow_('Saga', seg, payer, ctx.ds);
  var hcRatio = sagaRatio_(seg), itemR = sagaItemRatios_();
  var out = {};
  RESOURCES.forEach(function(r){
    var m = num(meas[r]);
    if (r === 'HC'){ out[r] = m * hcRatio; return; }
    out[r] = (itemR[r] != null) ? m * itemR[r] : m;
  });
  return out;
}
function sagaRatio_(seg){
  var baseAvg = sagaCycleAvg_(readSagaBase_(seg)), v2Avg = sagaCycleAvg_(readSagaV2_(seg));
  return (baseAvg && baseAvg > 0 && v2Avg != null) ? v2Avg/baseAvg : 1;
}
function sagaItemRatios_(){
  var base = readSagaItems_('c_saga'), v2 = readSagaItems_('c_saga_v2'), out = {};
  for (var r in base){
    if (v2[r] == null) continue;                 // column missing in v2 -> carry, don't zero
    if (base[r] > 0) out[r] = v2[r] / base[r];
    // base 0: no anchor to scale -> carry (even if v2 adds the item; flagged in the header doc)
  }
  return out;
}

// Daily Gift — reward-ratio only: HC x streak-weighted (c_day_v2 / c_day) ladder ratio.
function simDailyGift(seg, payer, ctx){
  var out = measuredRow_('Daily Gift', seg, payer, ctx.ds);
  out['HC'] = num(out['HC']) * dailyGiftRatio_(ctx.ds.beh(seg, payer));
  return overlayPacks_(out, dailyGiftBottomUp_(seg, payer, ctx));
}

// The daily gift's BOTTOM-UP lane (2026-09-02). Every resource with no measured anchor -- the six
// pack tiers and ToF_Ticket -- has to be priced off the ladder rather than scaled from data_gains,
// which emits no rows for any of them. Without this a ticket typed onto the daily gift produces
// nothing at all, and the daily gift is one of the sources meant to pay them.
//
//   E_cycle[res] = SUM_{n=1..7} reward_n[res] x S(n-1)      one 7-day gift cycle
//   window[res]  = E_cycle[res] x (SUM_d p_day) / 7         cycles the player actually completes
//
// S is the same login-streak survival dailyGiftRatio_ prices HC with, so a reward on gift day 6 is
// discounted by how rarely this segment reaches a 6-day streak -- the reason the deep gift days are
// worth much less than their face value. Priced off c_day_v2, like every other _v2 ladder: a value
// typed on the BASE sheet describes the current design and never reaches the redesign's numbers.
// FLAGGED: the cycle count assumes streaks restart cleanly every 7 active days; the ladder itself
// is segment-blind (one 'all segs' variant), so only S varies by segment.
function dailyGiftBottomUp_(seg, payer, ctx){
  var out = {};
  BOTTOMUP_RES.forEach(function(r){ out[r] = 0; });
  var v = sheetVals_('c_day_v2');
  if (!v.length) return out;
  var beh = ctx.ds.beh(seg, payer);
  var S = survival_([[num(beh.login_streak_p50),.5],[num(beh.login_streak_p75),.75],
                     [num(beh.login_streak_p90),.9]]);
  if (!S) return out;
  // The sheet stacks several 'Day | Coins | ... | ToF_Ticket' variant blocks; find each header and
  // read the seven rows under it. Blocks are alternatives, so they are AVERAGED, not summed.
  var blocks = [];
  for (var r = 0; r < v.length; r++){
    var row = v[r] || [];
    for (var c = 0; c < row.length; c++){
      if (String(row[c]).trim() !== 'Day') continue;
      var cols = {};
      for (var c2 = c; c2 < row.length; c2++){
        var res = RES_MAP[String(row[c2] || '').trim()];
        if (res && cols[res] == null) cols[res] = c2;
      }
      var any = false;
      BOTTOMUP_RES.forEach(function(rr){ if (cols[rr] != null) any = true; });
      if (any) blocks.push({ hdr: r, cols: cols });
      break;
    }
  }
  if (!blocks.length) return out;
  var pDaySum = 0;
  for (var d = 1; d <= DAILY_DAYS; d++) pDaySum += isWeekend_(d) ? num(beh.weekend_active_rate)
                                                                 : num(beh.weekday_active_rate);
  var cycles = pDaySum / 7;
  blocks.forEach(function(b){
    for (var n = 1; n <= 7; n++){
      var rr = v[b.hdr + n];
      if (!rr) break;
      var w = S(n - 1);
      BOTTOMUP_RES.forEach(function(res){
        if (b.cols[res] == null) return;
        out[res] += num(rr[b.cols[res]]) * w * cycles / blocks.length;
      });
    }
  });
  return out;
}
function dailyGiftRatio_(beh){
  var base = readDayLadder_('c_day'), v2 = readDayLadder_('c_day_v2');
  if (laddersEqual_(base, v2)) return 1;
  var S = survival_([[num(beh.login_streak_p50),.5],[num(beh.login_streak_p75),.75],[num(beh.login_streak_p90),.9]]);
  if (!S) return 1;
  var sOld = 0, sNew = 0;
  for (var n = 1; n <= 7; n++){ var w = S(n - 1);        // w_n = P(login streak >= n)
    sOld += num(base[n-1]) * w; sNew += num(v2[n-1]) * w; }
  return sOld > 0 ? sNew/sOld : 1;
}

// ============================== LEADERBOARD SOURCES (measured x R x T; D pinned 1) ===========
// Rank payouts are end-state — extra duration barely changes what a given rank pays, so D = 1
// and the calendars carry cadence x reach (T); reward-config edits flow through R (below).
function simBombChallenge (seg, payer, ctx){ return leaderboardSim_('Bomb Challenge',  "Bomb's Challenge",  seg, payer, ctx); }
function simChuckChallenge(seg, payer, ctx){ return leaderboardSim_('Chuck Challenge', "Chuck's Challenge", seg, payer, ctx); }
function simRedChallenge  (seg, payer, ctx){ return leaderboardSim_('Red Challenge',   "Red's Challenge",   seg, payer, ctx); }
function simLevelRace     (seg, payer, ctx){ return leaderboardSim_('Level Race',      'Level Race',        seg, payer, ctx); }
function simFlashRace     (seg, payer, ctx){ return leaderboardSim_('Flash Race',      'Flash Race',        seg, payer, ctx); }
// Target Day (D3): milestones intentionally pay 0 today — it is a pure leaderboard event.
function simTargetDay     (seg, payer, ctx){ return leaderboardSim_('Target Day',      'Target Day',        seg, payer, ctx); }

function leaderboardSim_(cat, calLabel, seg, payer, ctx){
  return timedCore_(cat, calLabel, seg, payer, ctx, function(){ return 1; });
}

// ============================== COLLECTION SOURCES (measured x R x D x T) ====================
function simHatchlingHideaway(seg, payer, ctx){ return collectionSim_('Hatchling Hideaway', 'Hatchling Hideaway',  'Hatchling Hideaway', seg, payer, ctx, false); }
function simBombsBallet      (seg, payer, ctx){ return collectionSim_("Bomb's Ballet",      "Bomb's Ballet Show",  'Bombs Ballet',       seg, payer, ctx, false); }
function simJigsaw           (seg, payer, ctx){ return collectionSim_('Jigsaw',             'Jigsaw Puzzle',       'Jigsaw',             seg, payer, ctx, false); }
function simPhotoshoot       (seg, payer, ctx){ return collectionSim_('Photoshoot',         'Photoshoot',          'Photoshoot',         seg, payer, ctx, false); }
// Kite — re-classified 2026-07-06 (user decision): payouts are rank-based and zero-sum per
// league of 60 (fixed pot, no bots in the data; the single score milestone at req 100 pays no
// HC and is trivially reached), so duration change does NOT shrink per-instance payouts.
// D pinned 1 like the other leaderboards; the old score-curve D (0.32-0.70) no longer applies.
// NOTE this flips the parse canary: the Kite row must now GROW (x T ≈ 1.28), not shrink.
function simKiteFestival     (seg, payer, ctx){ return leaderboardSim_('Kite Festival',     'Kite Festival',       seg, payer, ctx); }

function collectionSim_(cat, calLabel, accrKey, seg, payer, ctx, kite){
  return timedCore_(cat, calLabel, seg, payer, ctx, function(curDur, newDur){
    return (curDur === newDur) ? 1 : accrualD_(ctx.ds, accrKey, curDur, newDur, seg, payer, kite);
  });
}

// River Rush (D4/2.12) — a REAL simulator on the same calendar-driven path. Today cal_new has
// no RR instances → branch (a) fires and SIMULATED = 0 (DIFF = -measured). If RR returns to
// both calendars it re-prices via the generic collection path with its 8-day curve, no code change.
function simRiverRush(seg, payer, ctx){
  return collectionSim_('River Rush', 'River Rush', 'River Rush', seg, payer, ctx, false);
}

// Shared timed core. Branches (uniform for every calendar-driven source):
//   parse failed (either calendar empty)     -> carry measured  (fail-safe; Kite canary detects)
//   no cal_new instances                     -> 0               (removed from the new calendar)
//   cal_new only (no anchor-side instances)  -> carry measured  (NEEDS-ANCHOR — cannot be priced)
//   both sides                               -> measured x R x D x T
function timedCore_(cat, calLabel, seg, payer, ctx, dFn){
  var meas = measuredRow_(cat, seg, payer, ctx.ds);
  if (!ctx.calCurOk || !ctx.calNewOk) return meas;
  var cur = ctx.calCur[calLabel] || [], nw = ctx.calNew[calLabel] || [];
  if (!nw.length) return zeroRow_();                     // removed from the new calendar (packs too)
  if (!cur.length) return meas;
  var T = timingRatio_(cur, nw, seg, payer, ctx.ds);
  var D = dFn(modalDur_(cur), modalDur_(nw));
  var E = rewardE_(cat, seg, payer, ctx.ds);             // absolute ladder payout, both sides
  var R = {};
  if (E) RESOURCES.forEach(function(r){
    var b = num(E.eBase[r]);
    if (b > 1e-9) R[r] = num(E.eV2[r]) / b;              // base 0 -> carry (no anchor)
  });
  var out = {};
  RESOURCES.forEach(function(r){
    out[r] = num(meas[r]) * ((R[r] != null) ? R[r] : 1) * D * T;
  });
  return overlayPacks_(out, packLane_(calLabel, seg, payer, ctx, E && E.eV2, E && E.inst, cat));
}

// ============================== PACK LANE (D19 — bottom-up, simulated side only) ==============
// Card-collection packs have NO measured anchor: data_gains emits no pack rows, so `measured x R
// x D x T` is identically 0 for every pack column. Each source therefore prices its packs
// bottom-up on cal_new:
//
//   packs[res] = E_v2[res] x participation x Σ_{inst in cal_new} reach(inst)
//
//   E_v2         the SAME expected ladder payout the R ratio is built from (rank quantiles for
//                leaderboards, survival-weighted milestones for collections), reused verbatim —
//                so a pack typed into a _v2 ladder row is priced exactly like a coin on that row.
//   participation data_event_inst participation_rate — E is priced CONDITIONAL on taking part.
//   reach(inst)  the same 1 - Π(1 - p_day) used by T.
//
// D is deliberately NOT applied: a pack grant is a rank/milestone payout already priced through E.
// FLAGGED (SIMULATION_METHODOLOGY §): reach and participation_rate both encode activity, so their
// product mildly under-counts high-participation events; no joint estimator is available.
// FLAGGED: no participation telemetry -> priced at full participation (1.0).
// ---- participation, and when a MEASURED rate is the wrong number ---------------------------
// data_event_inst measures how many players opted into the event AS IT RAN. For an opt-in event a
// redesign can move that number a long way, and no measurement of the new design exists - it is an
// assumption, and assumptions belong on the sheet, not buried in a rate column.
//
// Kite Festival is the case in point: measured opt-in is 1-3% (0.0241 at 20-39 PAYER) because you
// have to join a league. At that rate the card sim grants a Kite pack in ~8% of runs, so a pack
// typed onto every one of the 60 Ki_v2 rank rows looks like it does nothing at all. The redesign
// assumes a far more visible event, so the pack lane is priced at PACK_PARTICIPATION instead (0.75 on 2026-09-01, lowered to 0.35 the same day - 75% read as implausibly high for an opt-in league).
//
// Resolution order (first hit wins):
//   1. a 'Participation' label on the source's _v2 config sheet, value in the cell to its right -
//      authored, so it can be changed without touching code
//   2. PACK_PARTICIPATION below - a FLAGGED design assumption, not a measurement
//   3. the measured data_event_inst participation_rate
//   4. 1.0 when there is no telemetry at all
//
// Note (3) and (4) are not distinguishable when the rate reads exactly 0: a rounded export turns a
// real 0.024 into 0.0 and the lane then prices at FULL participation, ~40x too high. Authoring the
// number removes that trap for the sources that carry one.
//
// SCOPE: participation enters the PACK LANE ONLY. rewardR_ is a v2/base ratio, so participation
// cancels out of it - changing this moves Kite's pack columns and nothing else about Kite.
var PACK_PARTICIPATION = { 'Kite Festival': 0.35 };   // redesign assumption (measured: ~0.01-0.03)

function packParticipation_(cat, inst){
  var spec = LB_R_SPECS[cat] || COLL_R_SPECS[cat] || PACK_ONLY_SPECS[cat];
  var sheet = spec && (spec.v2 || spec.sheet);
  if (sheet){
    var raw = readSPLabel_(sheet, 'Participation');     // generic label scan, any sheet
    var x = parseFloat(raw);
    if (raw !== null && raw !== '' && isFinite(x) && x >= 0) return x;
  }
  if (PACK_PARTICIPATION[cat] != null) return num(PACK_PARTICIPATION[cat]);
  var p = inst ? num(inst.participation_rate) : 0;
  return (p > 0) ? p : 1;                                // no telemetry -> full participation
}

// ---- SEASON CUTOFF for ENVELOPES (D26, 2026-09-01) -------------------------------------------
// The card-collection SEASON is shorter than the 33-day calendar window: it runs to
// SEASON_LAST_DAY, and after that no source hands out envelopes (the six *-star Pack resources)
// because there is no album left to put them in. NOTHING ELSE STOPS — HC, SPT, SPTx2, boosters and
// Unlimited Lives are paid on all 33 days exactly as before, so this is a pack-lane change and not
// a shorter simulation. Packs are simulated-side only (data_gains has no pack rows, so the measured
// anchor is 0), which makes this inherently a cal_new-side rule with no measured counterpart.
//
// Two rules, both from the user (2026-09-01):
//   * an instance ENTIRELY past the cutoff pays no envelopes at all — it drops out of the pack
//     lane's reach sum, so the window total itself shrinks;
//   * an instance STRADDLING the cutoff pays its envelopes IN FULL ("events cut in the middle
//     still give the full reward") — reach is NOT clipped — but any envelope whose landing day
//     would fall past the cutoff lands on SEASON_LAST_DAY instead, so the card sim never opens a
//     pack after the album has closed.
// Season Pass is exempt: its track is climbed during the season, so it pays its whole reached
// ladder even though the calendar draws a second pass instance past the cutoff.
var SEASON_LAST_DAY = 29;     // last day the collection season is live (calendar window is 33)
var SEASON_CUTOFF   = true;   // false -> pre-D26 behaviour: envelopes on all 33 days
var SEASON_EXEMPT_LANES = { 'Season Pass': 1 };

// True when any day of the instance falls inside the season. Deliberately ANY, not ALL: a straddler
// is in-season and pays in full.
function instInSeason_(inst){
  if (!SEASON_CUTOFF) return true;
  var d = (inst && inst.days) || [];
  for (var i = 0; i < d.length; i++) if (d[i] <= SEASON_LAST_DAY) return true;
  return false;
}

// The instances of one calendar lane that still pay envelopes.
function seasonInsts_(list, calLabel){
  if (!SEASON_CUTOFF || SEASON_EXEMPT_LANES[calLabel]) return list || [];
  return (list || []).filter(instInSeason_);
}

// Envelope landing day: past the cutoff, settle on the season's last day rather than vanish.
function seasonDay_(d){
  return (SEASON_CUTOFF && d > SEASON_LAST_DAY) ? SEASON_LAST_DAY : d;
}

function packLane_(calLabel, seg, payer, ctx, eV2, inst, cat){
  var out = {};
  BOTTOMUP_RES.forEach(function(r){ out[r] = 0; });
  if (!eV2 || !ctx.calNewOk) return out;
  var all = ctx.calNew[calLabel] || [];
  if (!all.length) return out;
  // D26: instances wholly outside the COLLECTION season pay no envelopes, so they leave the reach
  // sum and the pack total drops. Straddlers stay, at their FULL unclipped reach.
  //
  // The ticket is NOT an envelope. ToF is its own always-on event with no relationship to the album
  // season, so a ticket on a source's ladder keeps paying after the album closes -- it gets the
  // UNFILTERED reach. Caught by the D26 gate, which asserts the cutoff moves pack columns and
  // nothing else: writing the whole bottom-up set off one season-filtered reach made ToF_Ticket
  // move with it, drifting a non-pack total by 1.32.
  var nw = seasonInsts_(all, calLabel);
  var beh = ctx.ds.beh(seg, payer);
  var pWd = num(beh.weekday_active_rate), pWe = num(beh.weekend_active_rate);
  var reachPack = nw.length ? reachSum_(nw, pWd, pWe) : 0;
  var reachAll  = reachSum_(all, pWd, pWe);
  if (!(reachAll > 0)) return out;
  var part = packParticipation_(cat, inst);
  BOTTOMUP_RES.forEach(function(r){
    out[r] = num(eV2[r]) * part * (isPackRes_(r) ? reachPack : reachAll);
  });
  return out;
}

// ============================== PACK RUNGS (2026-08-20) =====================================
// packLane_ answers "how many packs per window, on average". The card sim needs the structure
// UNDERNEATH that average: which discrete outcomes ONE instance can produce, and with what
// probability. Without it the card sim could only accumulate fractions until they crossed 1, which
// produced two visible wrongs in the live log:
//   * Target Day granted "rank 4", "rank 2" and "rank 1" on the SAME day. A leaderboard instance
//     pays exactly ONE rank, so those three outcomes are mutually exclusive.
//   * Packs bunched into the last week and busy days came up empty, because each (source, tier)
//     kept its own separate accumulator and a 0.3/day source needs four days to emit anything.
//
// Returns, for ONE instance of one source:
//   { participation: p, groups: [ { exclusive: bool, rungs: [{label, p, packs:{tier:count}}] } ] }
//     exclusive true  -> at most ONE rung fires (a rank ladder: you finish in a single place)
//     exclusive false -> each rung fires independently with probability rung.p (milestone ladder)
// The card sim draws participation x reach(inst) first, then the rungs. Expectation is unchanged:
//   leaderboard  E = part x reach x SUM_i (1/n) x packs_i    == packLane_ (E IS the quantile mean)
//   milestone    E = part x reach x SUM_k S(req_k) x packs_k == packLane_
// so window totals still agree with the gains model cell for cell.
function packRungs_(cat, seg, payer, ctx, instOrdinal){
  var ds = ctx.ds;
  function packsOf(rew){
    var o = null;
    PACK_RES.forEach(function(r){ if (num(rew[r]) > 0){ o = o || {}; o[r] = num(rew[r]); } });
    return o;
  }
  function mk(part, exclusive, rungs){
    // maxReq is taken over the WHOLE ladder, before the pack filter. Taking it after would rescale
    // the axis to whichever rungs happen to pay packs: a Rainbow Maker rung at req 5,310 out of a
    // 352,260 ladder would score progress 1.0 if it were the only pack-payer, and land on the
    // instance's LAST day instead of near its start.
    var maxReq = 0;
    rungs.forEach(function(x){ if (num(x.req) > maxReq) maxReq = num(x.req); });
    rungs.forEach(function(x){
      x.progress = (maxReq > 0 && num(x.req) > 0) ? Math.min(1, num(x.req) / maxReq) : 1;
    });
    rungs = rungs.filter(function(x){ return x.packs && x.p > 0; });
    if (!rungs.length) return null;
    // progress is the rung's place on the requirement axis, 0..1: a cumulative ladder is climbed IN
    // ORDER, so Rainbow Maker rung 1 (160 matchables against a median of ~83,000) is cleared almost
    // immediately while rung 23 takes most of the event. Without it every rung was placed uniformly
    // across the instance days, which is what could put the first milestone on the LAST day.
    return { participation: part, groups: [{ exclusive: exclusive, rungs: rungs }] };
  }

  var lb = LB_R_SPECS[cat];
  if (lb){
    var inst = ds.eventInst(lb.inst, seg, payer);
    var pos = inst ? [inst.position_p25, inst.position_p50, inst.position_p75]
                       .map(function(p){ return Math.max(1, Math.round(num(p))); })
                       .filter(function(p){ return p > 0; }) : [];
    if (!pos.length) return null;                      // no rank telemetry -> leave it to packLane_
    var v = sheetVals_(lb.v2);
    // The SAME ladder + rank CDF lbE_ prices E from, so the card sim's discrete draw and the gains
    // model's expectation reconcile by construction (see lbRankDist_).
    var rdk = lbRankDist_(lb.v2, lb, inst), ladder = rdk.ladder;
    var rungs;
    if (LB_RANK_MODEL === 'cdf' && rdk.dist){
      rungs = rdk.dist.map(function(d){
        return { label: 'rank ' + d.rank, p: d.p, packs: packsOf(ladder[d.rank] || {}) };
      });
    } else {
      rungs = pos.map(function(pp){
        return { label: 'rank ' + pp, p: 1 / pos.length, packs: packsOf(ladder[pp] || {}) };
      });
    }
    var part = packParticipation_(cat, inst);
    var res = mk(part, true, rungs);    // EXCLUSIVE: one finishing rank per instance

    // Kite also pays a SCORE MILESTONE, which lbE_ folds into the same E the pack lane is priced
    // from. Leaving it out here would have made the card sim quietly pay less than the gains model
    // the moment a pack was typed on that row (it pays none today, so nothing changes yet). It is a
    // separate, NON-exclusive outcome: you keep your finishing rank and clear the score gate too.
    if (lb.ms && inst){
      var Sk = survival_([[num(inst.final_balance_p25),.25],[num(inst.final_balance_p50),.5],
                          [num(inst.final_balance_p75),.75]]);
      if (Sk){
        var mCols = rewCols_(v, lb.ms.hdr, lb.ms.c0, lb.ms.c1), msRungs = [];
        for (var mr = lb.ms.r0; mr <= lb.ms.r1; mr++){
          var mreq = num(v[mr] && v[mr][lb.ms.reqC]);
          if (!(mreq > 0)) continue;
          msRungs.push({ label: 'score milestone (req ' + mreq + ')', p: Sk(mreq),
                         req: mreq, packs: packsOf(rewRow_(v, mr, mCols)) });
        }
        msRungs = msRungs.filter(function(x){ return x.packs && x.p > 0; });
        if (msRungs.length){
          msRungs.forEach(function(x){ x.progress = 1; });   // banked by the end of the instance
          if (res) res.groups.push({ exclusive: false, rungs: msRungs });
          else res = { participation: part,
                       groups: [{ exclusive: false, rungs: msRungs }] };
        }
      }
    }
    return res;
  }

  var coll = COLL_R_SPECS[cat];
  if (coll){
    var ci = ds.eventInst(coll.inst, seg, payer);
    var S = ci ? survival_([[num(ci.final_balance_p25),.25],[num(ci.final_balance_p50),.5],
                            [num(ci.final_balance_p75),.75]]) : null;
    if (!S) return null;
    var reqs = collReqs_(coll);
    if (!reqs.length) return null;
    var vr = (coll.reqFrom === 'own') ? collReqs_(coll, true) : reqs;
    var cv = sheetVals_(coll.v2), ccols = rewCols_(cv, coll.hdr, coll.c0, coll.c1);
    var crungs = [], lastReq = 0;
    for (var i = 0; i < vr.length; i++){
      var req = vr[i];
      if (!(req > 0)) continue;
      lastReq = req;
      crungs.push({ label: 'milestone #' + (i + 1) + ' (req ' + req + ')', p: S(req),
                    req: req, packs: packsOf(rewRow_(cv, coll.r0 + i, ccols)) });
    }
    if (coll.completionRow != null && lastReq > 0)
      crungs.push({ label: 'completion bonus (req ' + lastReq + ')', p: S(lastReq),
                    req: lastReq, packs: packsOf(rewRow_(cv, coll.completionRow, ccols)) });
    var cpart = packParticipation_(cat, ci);
    return mk(cpart, false, crungs);   // cumulative ladder: rungs fire independently
  }

  if (cat === 'Daily Night Sky Prize'){
    var st = ds.nsStreak(seg, payer);
    var Sn = st ? survival_([[st.p25*NS_STREAK_N,.25],[st.p50*NS_STREAK_N,.50],
                             [st.p75*NS_STREAK_N,.75],[st.p90*NS_STREAK_N,.90]]) : null;
    if (!Sn) return null;
    // D23: each NS instance is ONE day, so it runs exactly one of the two variants — resolve the
    // ladder off that day rather than off the blend. Averaged over the 33 instances the card sim
    // therefore draws the same packs the blended packLane_ prices.
    var nsInsts = ((ctx.calNew && ctx.calNew['Night Sky']) || []).slice()
                    .sort(function(x, y){ return x.start - y.start; });
    var nsDay = nsInsts.length
      ? nsInsts[Math.max(0, Math.min(instOrdinal || 0, nsInsts.length - 1))].start : 1;
    var nrungs = nsLadderForDay_(seg, nsDay).map(function(ms, k){
      return { label: 'round ' + (k + 1) + ' (cum streak req ' + ms.req + ')' +
                      (isWeekend_(nsDay) ? ' [weekend]' : ' [weekday]'), p: Sn(ms.req),
               req: ms.req, packs: packsOf(ms.rew) };
    });
    var ni = ds.eventInst('Night Sky', seg, payer);
    var npart = packParticipation_(cat, ni);
    return mk(npart, false, nrungs);
  }

  if (cat === 'Rainbow Maker'){
    var pct = ds.rmPct(seg, payer);
    if (!pct) return null;
    var insts = rmSortedInsts_(ctx.calNew);
    var idx = Math.max(0, Math.min(instOrdinal || 0, Math.max(0, insts.length - 1)));
    var cfg = rmConfigFor_(idx);
    if (!cfg.ladder.length) return null;
    // the same duration-scaled matchables axis simRainbowMaker uses, so the two agree per instance
    var dur = insts[idx] ? insts[idx].dur : cfg.cfgDur;
    var scale = Math.min(1, dur / cfg.cfgDur);
    var Sr = survival_([[pct.p10*scale,.10],[pct.p25*scale,.25],[pct.p50*scale,.50],
                        [pct.p75*scale,.75],[pct.p90*scale,.90]]);
    if (!Sr) return null;
    var rrungs = cfg.ladder.map(function(ms, k){
      return { label: 'milestone #' + (k + 1) + ' (req accum ' + ms.req + ')', p: Sr(ms.req),
               req: ms.req, packs: packsOf(ms.rew) };
    });
    return mk(1, false, rrungs);                       // RM has no participation telemetry
  }

  var po = PACK_ONLY_SPECS[cat];
  if (po){
    var pi = ds.eventInst(po.inst, seg, payer);
    var ppos = pi ? [pi.position_p25, pi.position_p50, pi.position_p75]
                      .map(function(p){ return Math.round(num(p)); })
                      .filter(function(p){ return p > 0; }) : [];
    var groups = [];
    po.blocks.forEach(function(blk, bi){
      var bv = sheetVals_(po.sheet), bcols = rewCols_(bv, blk.hdr, blk.c0, blk.c1);
      var byPos = {}, n = 0;
      for (var r2 = blk.r0; r2 <= blk.r1; r2++){ byPos[r2 - blk.r0 + 1] = rewRow_(bv, r2, bcols); n++; }
      var tag = (po.blocks.length > 1) ? 'block ' + (bi + 1) + ': ' : '';
      var use = ppos.length ? ppos
                            : (function(){ var a = []; for (var q = 1; q <= n; q++) a.push(q); return a; })();
      var suffix = ppos.length ? '' : ' (flat rank avg, no position data)';
      var bdist = (LB_RANK_MODEL === 'cdf' && ppos.length) ? rankDist_(pi, n) : null;   // matches packBlockE_
      var g = bdist
        ? bdist.map(function(d){
            return { label: tag + 'rank ' + d.rank, p: d.p, packs: packsOf(byPos[d.rank] || {}) };
          }).filter(function(x){ return x.packs; })
        : use.map(function(pp){
            return { label: tag + 'rank ' + pp + suffix, p: 1 / use.length, packs: packsOf(byPos[pp] || {}) };
          }).filter(function(x){ return x.packs; });
      // Each BLOCK is its own exclusive draw: a Team Event participant places once on the team
      // leaderboard AND once on the contribution ladder, so both groups fire.
      if (g.length) groups.push({ exclusive: true, rungs: g });
    });
    if (!groups.length) return null;
    var ppart = packParticipation_(cat, pi);
    return { participation: ppart, groups: groups };
  }
  return null;
}

// Per-source pack PROVENANCE: which ladder row paid each pack tier, for the card sim's log.
//   returns { '3-star Pack': [{label:'rank 2', weight:0.4}, ...], ... }   (v2 ladder only)
// Only the _v2 side is described, because packLane_ prices packs off eV2 alone — a pack typed into
// a base sheet is never granted (it has no route into the sim at all), which is worth knowing.
// Day-independent by construction: a source's ladder is the same on every instance, so the caller
// attaches this once per source rather than per day.
function packProvFor_(cat, seg, payer, ctx){
  var ds = ctx.ds, prov = {};
  var lb = LB_R_SPECS[cat], coll = COLL_R_SPECS[cat];
  if (lb || coll){
    var spec = lb || coll, inst = ds.eventInst(spec.inst, seg, payer);
    if (lb){
      var pos = inst ? [inst.position_p25, inst.position_p50, inst.position_p75]
                         .map(function(p){ return Math.max(1, Math.round(num(p))); })
                         .filter(function(p){ return p > 0; }) : [];
      lbE_(lb.v2, lb, pos, inst, prov);
    } else {
      var S = inst ? survival_([[num(inst.final_balance_p25),.25],[num(inst.final_balance_p50),.5],
                                [num(inst.final_balance_p75),.75]]) : null;
      var reqs = S ? collReqs_(coll) : [];
      if (S && reqs.length)
        collE_(coll.v2, coll, reqs.own ? collReqs_(coll, true) : reqs, S, prov);
    }
    return prov;
  }
  if (cat === 'Daily Night Sky Prize'){
    var st = ds.nsStreak(seg, payer);
    var Sn = st ? survival_([[st.p25*NS_STREAK_N,.25],[st.p50*NS_STREAK_N,.50],
                             [st.p75*NS_STREAK_N,.75],[st.p90*NS_STREAK_N,.90]]) : null;
    if (Sn){
      // D23: describe BOTH variants, each at its share of the window's active days, so the log
      // says which day type paid a pack rather than attributing all of them to one ladder.
      var nsSh = nsDayTypeSplit_(seg, payer, ds, ctx);
      var nsWd = nsWeekdayLadder_(seg);
      nsEDayProv_(readNSLadder_(seg, NS_V2_SHEET), Sn, prov, nsWd ? nsSh.we : 1,
                  nsWd ? ' [weekend]' : '');
      if (nsWd) nsEDayProv_(nsWd, Sn, prov, nsSh.wd, ' [weekday]');
    }
    return prov;
  }
  if (cat === 'Rainbow Maker'){
    var pct = ds.rmPct(seg, payer);
    if (!pct) return prov;
    var cfg = rmConfigFor_(0);
    var Sr = survival_([[pct.p10,.10],[pct.p25,.25],[pct.p50,.50],[pct.p75,.75],[pct.p90,.90]]);
    if (Sr) cfg.ladder.forEach(function(ms, k){
      var sv = Sr(ms.req);
      for (var res in ms.rew)
        provAdd_(prov, res, 'milestone #' + (k + 1) + ' (req accum ' + ms.req + ')', ms.rew[res] * sv);
    });
    return prov;
  }
  var po = PACK_ONLY_SPECS[cat];
  if (po){
    var pinst = ds.eventInst(po.inst, seg, payer);
    var ppos = pinst ? [pinst.position_p25, pinst.position_p50, pinst.position_p75]
                         .map(function(p){ return Math.round(num(p)); })
                         .filter(function(p){ return p > 0; }) : [];
    po.blocks.forEach(function(blk, bi){
      packBlockE_(po.sheet, blk, ppos, prov, po.blocks.length > 1 ? 'block ' + (bi + 1) + ':' : '',
                  pinst);
    });
  }
  return prov;
}

// Writes the six pack columns of `packs` over `row`, leaving every other resource untouched.
function overlayPacks_(row, packs){
  if (!packs) return row;
  BOTTOMUP_RES.forEach(function(r){ row[r] = num(packs[r]); });
  return row;
}
function copyRow_(row){ var o = {}; RESOURCES.forEach(function(r){ o[r] = num(row[r]); }); return o; }

// ---- pack-only sources (D19/3) -------------------------------------------------------------
// Team Event and Flock Flurry are CARRIED in the gains model (no simulator, no _v2 sheet), but
// they do have a config sheet with the pack columns and a calendar lane — so their pack columns
// are simulated bottom-up while every other resource stays measured.
//   TE  — 'Team Event' sheet: a 7-place Team Leaderboard block AND a 3-place Contribution
//         Rewards block; a participant is paid from both, so the two are SUMMED.
//   F   — 'Flock Flurry' sheet: one 5-position goal ladder.
// Team Race has a calendar lane but NO config sheet -> no packs (same rule as Ads / IAPs).
// 0-based row/col indices into sheetVals_(); reward blocks span Coins..6-star Dly (c0..c1).
var PACK_ONLY_SPECS = {
  'Team Event'  : {sheet:'TE', cal:'Team Event',   inst:'Team Event',
                   blocks:[{hdr:14, r0:15, r1:21, c0:1, c1:21},    // Team Leaderboard, 1st..7th
                           {hdr:24, r0:25, r1:27, c0:1, c1:21}]},  // Contribution Rewards, 1st..3rd
  'Flock Flurry': {sheet:'F',  cal:'Flock Flurry', inst:'Flock Flurry',
                   blocks:[{hdr:9,  r0:10, r1:14, c0:1, c1:21}]}   // Goals and Rewards, pos 1..5
};

// Expected payout of one rank ladder block. With measured rank quantiles -> their mean payout
// (same treatment as lbE_). WITHOUT rank telemetry -> a FLAT ladder average (pot / rank count):
// the crudest pricing in the model, because it assumes every rank is equally likely.
// Team Event has no data_event_inst rows, so it always takes the flat path — FLAGGED.
function packBlockE_(sheetName, blk, positions, prov, blkName, inst){
  var v = sheetVals_(sheetName), cols = rewCols_(v, blk.hdr, blk.c0, blk.c1);
  var rows = [], byPos = {};
  for (var r = blk.r0; r <= blk.r1; r++){
    if (!v[r] || !rowHasContent_(v[r], blk.c0, blk.c1)) continue;   // see lbLadder_: a missing row
    var rew = rewRow_(v, r, cols);                                  // is not a rank, and inventing
    rows.push(rew);                                                 // one dilutes the flat average
    byPos[rows.length] = rew;         // ladders are position-ordered ('1st','2nd',... or 1,2,3)
  }
  var E = zeroRow_(), res;
  var tag = blkName ? blkName + ' ' : '';
  // Same rank CDF the LB_R_SPECS sources use — Flock Flurry has position telemetry and is a rank
  // ladder like any other. Team Event has no data_event_inst rows at all, so it keeps the flat
  // rank average below (still the crudest pricing in the model).
  var bd = (LB_RANK_MODEL === 'cdf' && inst) ? rankDist_(inst, rows.length) : null;
  if (bd){
    bd.forEach(function(d){
      var rew = byPos[d.rank];
      if (!rew || !(d.p > 0)) return;
      for (var r2 in rew){
        E[r2] = num(E[r2]) + rew[r2] * d.p;
        provAdd_(prov, r2, tag + 'rank ' + d.rank, rew[r2] * d.p);
      }
    });
    return E;
  }
  if (positions && positions.length){
    positions.forEach(function(p){
      var rew = byPos[p] || {};
      for (res in rew){
        E[res] = num(E[res]) + rew[res] / positions.length;
        provAdd_(prov, res, tag + 'rank ' + p, rew[res] / positions.length);
      }
    });
  } else if (rows.length){
    rows.forEach(function(rew, i){
      for (res in rew){
        E[res] = num(E[res]) + rew[res] / rows.length;
        provAdd_(prov, res, tag + 'rank ' + (i + 1) + ' (flat rank avg, no position data)',
                 rew[res] / rows.length);
      }
    });
  }
  return E;
}

// Pack row for a pack-only source, or null when it cannot be priced (sheet/calendar missing).
function packOnlyRow_(cat, seg, payer, ctx){
  var spec = PACK_ONLY_SPECS[cat];
  if (!spec || !ctx.calNewOk) return null;
  if (!(ctx.calNew[spec.cal] || []).length) return null;
  var inst = ctx.ds.eventInst(spec.inst, seg, payer);
  var pos = inst ? [inst.position_p25, inst.position_p50, inst.position_p75]
                     .map(function(p){ return Math.round(num(p)); })
                     .filter(function(p){ return p > 0; }) : [];
  var E = zeroRow_();
  spec.blocks.forEach(function(blk){
    var e = packBlockE_(spec.sheet, blk, pos, null, '', inst);
    BOTTOMUP_RES.forEach(function(r){ E[r] = num(E[r]) + num(e[r]); });
  });
  return packLane_(spec.cal, seg, payer, ctx, E, inst, cat);
}

// ============================== MIGHTY DOORS / TOWER OF FORTUNE (ToF) ========================
// A push-your-luck ladder. The player spends ONE ToF_Ticket to start a run; each stage offers
// `Choices` doors of which `Pig Slots` end the run. Surviving banks the stage's reward into a
// temporary pot; **dying loses the whole pot** (source_docs/mighty-doors.md:20, deck p7). After any
// successful stage the player may Cash Out and keep everything (Variant A, p9/p19; Variant B is
// safe-stages-only, p23). Meeting a pig, they may pay COINS to continue and retry that stage.
//
// This is the first source in the model that SPENDS a resource, and the first whose payout is
// gated on a decision rather than on reach. It needs a real state machine, so unlike every other
// source it is not `measured x R x D x T` -- there is no measured anchor (data_gains has no ToF
// rows) and no anchor is possible for an event that has never run. It is priced bottom-up:
//
//   SIMULATED[res] = E[banked reward per run][res]  x  runs over the window
//
// ---- the run: a forward walk over (stage, continues used) ----------------------------------
// State is (s, k): about to attempt stage s, having already bought k continues this run. k has to
// be in the state because the continue PRICE escalates with it (50 -> 1890 on the current ladder)
// and because affordability depends on what is left of the wallet.
//
//   attempt stage s:  survive H(s)            -> (s+1, k),  or BANK if s is the cash-out stage
//                     die   (1-H(s)) -> continue p_c(k) -> (s, k+1)   [retry the SAME stage]
//                                    -> stop   (1-p_c)   -> run over, pot LOST
//
// Retrying the same stage is the honest reading of "continue": you paid to undo the pig, not to
// skip ahead. The old sheet blended survive-and-revive into one number, which cannot price an
// escalating ladder because it never knows which rung you are on.
//
// ---- p_c: willingness x affordability -------------------------------------------------------
// `Continue p` on the MD sheet is the segment's baseline willingness AFTER meeting a pig. Real
// wallets are small -- data_econ hc_balance_p50 runs 74..223 coins against a ladder that starts at
// 50 -- so willingness alone would let a 0-9 player buy the 1,890 rung as readily as the 50 one.
//
//   p_c(k) = ContinueP_seg x A( balance_k / cost_{k+1} )
//   A(r)   = 0                      when r < 1     (cannot afford it: a hard floor)
//          = (r - 1) / (r - 1 + h)  otherwise      (h = headroom at half willingness)
//
// h is TOF_AFFORD_H below. At h = 1 a player holding twice the price continues at half their
// baseline willingness. A(r) rises to 1 as the wallet outgrows the price, so a whale is governed by
// willingness alone and a broke player by the wallet alone, which is the behaviour we want at both
// ends. FLAGGED: A is an assumption, not a measurement -- no telemetry exists for an event that has
// never run. It is a single knob and the harness prints it on every run.
//
// The walk is repeated at each hc_balance percentile (p25/p50/p75/p90 from data_econ) and averaged,
// the same way collections average a milestone ladder over the progress percentiles. Using p50
// alone would erase the tail that actually reaches the deep rungs: at h = 1 the median player in
// every segment can afford rung 1-2, while p90 reaches rung 4-5.
//
// PAYERS GET ONE TOP-UP (user decision 2026-09-02): exactly once per run, a payer who cannot afford
// the next continue buys coins and takes it anyway at full willingness. Without it the model says
// payers continue LESS than non-payers, because measured payer balances are LOWER in every segment
// (they spend what they buy: 100+ PAYER p50 = 74 vs NONPAYER 107). The top-up is a third state
// dimension, which is why the walk carries `t`.
//
// ---- runs: the ticket budget ----------------------------------------------------------------
// Tickets are EARNED, not recharged (deck p9: Daily Login, event rewards, shop offers; no storage
// cap). So the number of runs is not a config number -- it is whatever the rest of the calendar
// pays out. Each day the player banks the ToF_Ticket their other sources granted that day, and
// spends what they have, up to `Runs per Active Day`:
//
//   balance += tickets earned that day (every source except ToF itself, per-day, on cal_new)
//   runs(d)  = p_day x min(RunsPerActiveDay, balance / TicketsPerRun)
//   balance -= runs(d) x TicketsPerRun  +  runs(d) x E[tickets ToF itself pays back per run]
//
// Carrying the balance forward is what makes a ticket typed into a WEEK 1 daily gift show up as a
// run in week 1, and one typed into a week-4 event show up only at the end. Expected (fractional)
// runs rather than drawn ones, matching the deterministic-attendance convention the pack lane uses.
// ToF's own ticket payout feeds back into the balance on the day it is earned; the walk is forward
// in time so that terminates.
var TOF_CAT        = 'ToF';
// 'ToF' is the sheet's final name; 'MD' is what it was called while it was being built. Both are
// accepted so the engine keeps working either side of the rename in the live workbook.
var TOF_SHEET_NAMES = ['ToF', 'MD'];
function tofSheetVals_(){
  for (var i = 0; i < TOF_SHEET_NAMES.length; i++){
    var v = sheetVals_(TOF_SHEET_NAMES[i]);
    if (v && v.length) return v;
  }
  return [];
}
var TOF_AFFORD_H   = 1;      // headroom at half willingness (user-approved 2026-09-02; was 4)
var TOF_BAL_PCTS   = ['hc_balance_p25','hc_balance_p50','hc_balance_p75','hc_balance_p90'];
var TOF_PAYER_TOPUPS = 1;    // one purchased continue per run, PAYER only

// Row index of an MD block, found by its column-A bar label (prefix match at a word boundary, the
// same resolution loadPackConfig_ uses) so inserting a row above it cannot break the reader.
function mdBlock_(v, label){
  for (var r = 0; r < v.length; r++){
    var a = String((v[r] || [])[0] == null ? '' : v[r][0]).trim();
    if (a === label) return r;
    if (a.indexOf(label) === 0 && (a.length === label.length || /[^A-Za-z0-9]/.test(a.charAt(label.length))))
      return r;
  }
  return -1;
}
// The HEADER row of a block, found by the label its first column carries. Blocks carry a variable
// number of explanatory note rows between the bar and the header -- STAGES has three, CONTINUE COST
// has two notes plus two input rows -- so any fixed offset from the bar reads a note as the header
// and the whole block comes back empty. That is how the regenerated sheet first read as "no stage
// ladder at all": bar+1 landed on prose.
function mdHeaderRow_(v, barRow, firstColLabel){
  for (var r = barRow + 1; r < v.length && r < barRow + 25; r++){
    var a = String((v[r] || [])[0] == null ? '' : v[r][0]).trim();
    if (a.indexOf(firstColLabel) === 0) return r;
  }
  return -1;
}
// label -> value from a two-column parameter block (RUN CONFIG).
function mdParam_(v, r0, label){
  for (var r = r0 + 1; r < v.length; r++){
    var a = String((v[r] || [])[0] == null ? '' : v[r][0]).trim();
    if (a === '') break;
    if (a === label) return v[r][1];
  }
  return null;
}

// The whole MD config, read once per execution. Returns null when the sheet is absent or has no
// stage ladder, which is how a workbook without Mighty Doors keeps working: ToF then carries.
var _tofCfgCache = null;
function tofConfig_(){
  if (_tofCfgCache !== null) return _tofCfgCache;
  var v = tofSheetVals_();
  if (!v.length) return (_tofCfgCache = false);

  var rc = mdBlock_(v, 'RUN CONFIG');
  var cfg = { ticketsPerRun: 1, cashOutVariant: 'A', variantBSafeOnly: false };
  if (rc >= 0){
    var tp = num(mdParam_(v, rc, 'Tickets per Run'));
    if (tp > 0) cfg.ticketsPerRun = tp;
    var cv = String(mdParam_(v, rc, 'Cash-Out Variant') || 'A').trim().toUpperCase();
    cfg.cashOutVariant = (cv === 'B') ? 'B' : 'A';
    cfg.variantBSafeOnly = (cfg.cashOutVariant === 'B');
  }

  // ---- stage ladder ----
  var sb = mdBlock_(v, 'STAGES');
  if (sb < 0) return (_tofCfgCache = false);
  var hdr = mdHeaderRow_(v, sb, 'Stage');
  if (hdr < 0) return (_tofCfgCache = false);
  var cols = {}, c;
  for (c = 0; c < (v[hdr] || []).length; c++){
    var h = String(v[hdr][c] == null ? '' : v[hdr][c]).trim();
    if (h) cols[h] = c;
  }
  var rewCols = {};
  for (var hh in cols){ var res = RES_MAP[hh]; if (res && rewCols[res] == null) rewCols[res] = cols[hh]; }
  var stages = [];
  for (var r = hdr + 1; r < v.length; r++){
    var sn = num(v[r] && v[r][cols['Stage']]);
    if (!(sn > 0)) break;
    var rew = {};
    for (var res2 in rewCols){ var amt = num(v[r][rewCols[res2]]); if (amt) rew[res2] = amt; }
    stages.push({ n: sn,
                  type: String(v[r][cols['Type']] || '').trim(),
                  H:    num(v[r][cols['Survive p']]),
                  I:    (cols['P(reward | survived)'] != null) ? num(v[r][cols['P(reward | survived)']]) : 1,
                  rew:  rew });
  }
  if (!stages.length) return (_tofCfgCache = false);
  cfg.stages = stages;

  // ---- continue cost ladder (the rung prices ARE the cap: no price, no continue) ----
  // Find the ladder's HEADER row by its label rather than assuming a fixed offset from the bar: the
  // block carries a variable number of note rows and now two input rows (growth multiplier, growth
  // cap rung) between the two. An offset would have silently read the notes as rungs.
  var cc = mdBlock_(v, 'CONTINUE COST');
  cfg.costs = [];
  cfg.costRowsExpected = 0;
  if (cc >= 0){
    var ch = mdHeaderRow_(v, cc, 'Continue #');
    if (ch >= 0){
      for (var r2 = ch + 1; r2 < v.length; r2++){
        if (!(num(v[r2] && v[r2][0]) > 0)) break;        // ladder ends at the first non-rung row
        cfg.costRowsExpected++;
        var cost = num(v[r2][1]);
        // A rung whose price is a FORMULA with no cached value reads 0 offline (Sheets-native
        // formulas do not survive an openpyxl round trip). Stop rather than treat it as free: a
        // 0-cost continue would be bought by everyone, forever. The count above lets the harness
        // report the truncation instead of it passing unnoticed.
        if (!(cost > 0)) break;
        cfg.costs.push(cost);
      }
    }
  }

  // ---- per-segment behaviour ----
  var sbh = mdBlock_(v, 'SEGMENT BEHAVIOUR');
  cfg.beh = {};
  if (sbh >= 0){
    var bh = mdHeaderRow_(v, sbh, 'Segment'), bc = {};
    if (bh < 0) bh = sbh + 1;
    for (c = 0; c < (v[bh] || []).length; c++){
      var b = String(v[bh][c] == null ? '' : v[bh][c]).trim();
      if (b) bc[b] = c;
    }
    // 'Continue p' was the hand-built sheet's header; the builder writes 'Continue Take-Up'. Accept
    // either, or MAX's take-up reads 0 and the ceiling case silently never continues.
    var contC = (bc['Continue Take-Up'] != null) ? bc['Continue Take-Up'] : bc['Continue p'];
    var balC  = null;
    for (var bn in bc) if (String(bn).indexOf('Coin Balance') === 0) balC = bc[bn];
    for (var r3 = bh + 1; r3 < v.length; r3++){
      var segName = String((v[r3] || [])[0] == null ? '' : v[r3][0]).trim();
      if (segName === '') break;
      // The explanatory note rows under the block also carry text in column A with no blank row
      // between, so "stop at the first empty cell" swallowed all five of them as segments named
      // after their own prose. A segment row is one whose take-up cell holds a NUMBER.
      if (contC == null || typeof v[r3][contC] !== 'number') continue;
      cfg.beh[segName] = {
        continueP:   num(v[r3][contC]),
        cashOut:     num(v[r3][bc['Cash-Out Stage']]),
        runsPerDay:  num(v[r3][bc['Runs per Active Day']]),
        maxContinues: (bc['Max Continues per Run'] != null) ? num(v[r3][bc['Max Continues per Run']]) : 0,
        balance:     (balC != null) ? num(v[r3][balC]) : 0
      };
    }
  }
  return (_tofCfgCache = cfg);
}

// Affordability factor. r = wallet / price of the next continue.
function tofAfford_(r){
  if (!(r >= 1)) return 0;                       // cannot pay for it at all
  var h = num(TOF_AFFORD_H) > 0 ? num(TOF_AFFORD_H) : 1;
  return (r - 1) / (r - 1 + h);
}

// ONE run, walked forward over (stage, continues, top-up used), at ONE starting wallet.
// Returns { bank: {res: expected banked amount}, spend: coins, pBank: probability the run pays }.
function tofRunOnce_(cfg, beh, balance0, payer){
  var stages = cfg.stages, costs = cfg.costs;
  var nStages = stages.length;
  var cashOutN = (beh.cashOut > 0) ? beh.cashOut : stages[nStages - 1].n;
  // The ladder length is the cap: once the authored rungs run out no continue is offered and the
  // run ends. `Max Continues per Run` can lower it; 0/blank means "whatever the ladder allows".
  var kMax = costs.length;
  if (beh.maxContinues > 0) kMax = Math.min(kMax, beh.maxContinues);
  var topMax = (String(payer).toUpperCase() === 'PAYER') ? TOF_PAYER_TOPUPS : 0;

  // P[k][t] = probability of being about to attempt the CURRENT stage with k continues bought and
  // t top-ups used. Walking stage by stage keeps this to a (kMax+1) x (topMax+1) grid.
  var P = [], k, t;
  for (k = 0; k <= kMax; k++){ P.push([]); for (t = 0; t <= topMax; t++) P[k].push(0); }
  P[0][0] = 1;
  var spend = 0, pBank = 0;

  for (var si = 0; si < nStages; si++){
    var st = stages[si];
    if (st.n > cashOutN) break;
    var H = st.H;
    // Resolve deaths at this stage first: a continue retries the SAME stage, so this is an inner
    // loop over k until the ladder is exhausted (each retry can itself end in a pig).
    var alive = [];
    for (k = 0; k <= kMax; k++){ alive.push([]); for (t = 0; t <= topMax; t++) alive[k].push(0); }
    for (k = 0; k <= kMax; k++) for (t = 0; t <= topMax; t++){
      var p0 = P[k][t];
      if (!(p0 > 0)) continue;
      var kk = k, tt = t, mass = p0;
      // survive right away
      alive[kk][tt] += mass * H;
      var dead = mass * (1 - H);
      while (dead > 1e-15 && kk < kMax){
        var price = costs[kk];                     // cost of continue #(kk+1)
        var wallet = balance0 - tofCumCost_(costs, kk);
        var a = tofAfford_(price > 0 ? wallet / price : 0);
        var usedTop = false;
        if (a <= 0 && tt < topMax){ a = 1; usedTop = true; }   // payer buys coins, once
        var pc = beh.continueP * a;
        if (!(pc > 0)) break;
        var bought = dead * pc;
        spend += bought * price;
        kk += 1; if (usedTop) tt += 1;
        alive[kk][tt] += bought * H;               // retry the stage and survive it
        dead = bought * (1 - H);                   // ...or meet another pig
      }
      // whatever is still `dead` walked away: pot lost, contributes nothing
    }
    if (st.n === cashOutN){
      for (k = 0; k <= kMax; k++) for (t = 0; t <= topMax; t++) pBank += alive[k][t];
      P = alive;
      break;
    }
    P = alive;
  }

  // Banked reward = the whole ladder up to the cash-out stage, paid only if the run banked.
  var bank = {};
  RESOURCES.forEach(function(r){ bank[r] = 0; });
  for (var i2 = 0; i2 < nStages; i2++){
    var s2 = stages[i2];
    if (s2.n > cashOutN) break;
    for (var res in s2.rew) if (bank[res] != null) bank[res] += s2.rew[res] * s2.I * pBank;
  }
  return { bank: bank, spend: spend, pBank: pBank };
}
function tofCumCost_(costs, k){
  var s = 0;
  for (var i = 0; i < k && i < costs.length; i++) s += costs[i];
  return s;
}

// One run averaged over the wallet percentiles in data_econ. Returns the same shape as
// tofRunOnce_, plus the per-percentile detail the harness and the MD sheet report.
function tofRun_(seg, payer, ds){
  var cfg = tofConfig_();
  if (!cfg) return null;
  var beh = cfg.beh[seg];
  if (!beh || !(beh.continueP >= 0)) return null;
  // An authored 'Coin Balance override' REPLACES the measured percentiles for that segment -- that
  // is the whole point of it, and it is how MAX gets a wallet no real player has. Blank (0) means
  // use data_econ, which is the normal case for the five real segments.
  var bals = (beh.balance > 0) ? [beh.balance] : tofBalances_(seg, payer);
  if (!bals.length) bals = [0];
  var out = { bank: {}, spend: 0, pBank: 0, byBalance: [] };
  RESOURCES.forEach(function(r){ out.bank[r] = 0; });
  bals.forEach(function(b){
    var one = tofRunOnce_(cfg, beh, b, payer);
    RESOURCES.forEach(function(r){ out.bank[r] += num(one.bank[r]) / bals.length; });
    out.spend += one.spend / bals.length;
    out.pBank += one.pBank / bals.length;
    out.byBalance.push({ balance: b, pBank: one.pBank, spend: one.spend });
  });
  return out;
}

// Wallet percentiles for one (segment, payer), read straight off data_econ rather than threaded
// through DataStore: build()'s signature is positional and every harness calls fromRanges() with
// exactly seven ranges, so widening it would break them all for one column family.
var _tofBalCache = {};
function tofBalances_(seg, payer){
  var key = seg + '|' + payer;
  if (_tofBalCache[key] !== undefined) return _tofBalCache[key];
  var v = sheetVals_('data_econ'), out = [];
  if (v.length){
    var h = headerIndex_(v[0]);
    if (h['segment'] != null && h['payer_flag'] != null){
      for (var i = 1; i < v.length; i++){
        var r = v[i];
        if (String(r[h['segment']]).trim() !== seg) continue;
        if (String(r[h['payer_flag']]).trim() !== payer) continue;
        var cur = String(h['currency'] != null ? r[h['currency']] : 'HC').trim().toUpperCase();
        if (cur !== 'HC' && cur !== 'COINS') continue;
        TOF_BAL_PCTS.forEach(function(p){
          if (h[p] == null) return;
          var x = num(r[h[p]]);
          if (x > 0) out.push(x);
        });
        if (out.length) break;
      }
    }
  }
  return (_tofBalCache[key] = out);
}

// Per-day ToF_Ticket income from EVERY OTHER source on cal_new. Excludes ToF itself, both because
// its own payout is fed back inside the day walk and because dailySeries_('ToF') would re-enter
// this function -- the one genuine recursion risk in the wiring.
var _tofIncomeCache = {};
function tofTicketIncome_(seg, payer, ctx){
  var key = seg + '|' + payer;
  if (_tofIncomeCache[key]) return _tofIncomeCache[key];
  var days = [], d;
  for (d = 0; d < DAILY_DAYS; d++) days.push(0);
  CATEGORY_ORDER.forEach(function(cat){
    if (cat === TOF_CAT) return;
    var series = dailySeries_(cat, seg, payer, ctx, true);
    for (var i = 0; i < DAILY_DAYS; i++) days[i] += num(series[i][TOF_TICKET]);
  });
  return (_tofIncomeCache[key] = days);
}

// Runs over the window: walk the days, bank the tickets earned, spend what the player is willing
// and able to spend. Returns { runs, perDay[], ticketsEarned, ticketsLeft }.
function tofRunBudget_(seg, payer, ctx, ticketsBackPerRun){
  var cfg = tofConfig_();
  if (!cfg) return null;
  var beh = cfg.beh[seg];
  if (!beh) return null;
  var insts = (ctx.calNewOk && ctx.calNew[TOF_CAT]) || [];
  if (!insts.length) return { runs: 0, perDay: [], ticketsEarned: 0, ticketsLeft: 0, noLane: true };
  var live = {};
  insts.forEach(function(inst){
    ((inst && inst.days) || []).forEach(function(dd){ if (dd >= 1 && dd <= DAILY_DAYS) live[dd] = 1; });
  });
  var b = ctx.ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)) return { runs: 0, perDay: [], ticketsEarned: 0, ticketsLeft: 0 };
  var income = tofTicketIncome_(seg, payer, ctx);
  var perRun = (cfg.ticketsPerRun > 0) ? cfg.ticketsPerRun : 1;
  var cap = (beh.runsPerDay > 0) ? beh.runsPerDay : Infinity;
  var bal = 0, runs = 0, earned = 0, perDay = [];
  for (var day = 1; day <= DAILY_DAYS; day++){
    bal += income[day - 1];
    earned += income[day - 1];
    var r = 0;
    if (live[day]){
      var pDay = isWeekend_(day) ? pWe : pWd;
      r = pDay * Math.min(cap, bal / perRun);
      bal -= r * perRun;
      bal += r * num(ticketsBackPerRun);       // ToF pays tickets back into its own pool
      earned += r * num(ticketsBackPerRun);
      runs += r;
    }
    perDay.push(r);
  }
  return { runs: runs, perDay: perDay, ticketsEarned: earned, ticketsLeft: bal };
}

// The ToF row. Bottom-up: expected banked reward per run x runs the ticket budget allows.
// Coins SPENT on continues are reported on the row's own HC as a NEGATIVE, because for this source
// the spend is not game-wide -- it is the price of the reward sitting next to it, and a ToF row
// that showed only the payout would read as free money.
// RE-ENTRANCY. ToF's run count depends on ticket income, which is a per-day walk over every OTHER
// source; Season Pass is one of those, and simSeasonPass calls sptTotals_, which sums the SPT
// faucet across ALL categories -- ToF included, because ToF banks SPT. So asking for the ToF row
// asks for the ToF row, and the stack overflows. The cycle is real, not a wiring slip: ToF both
// consumes the calendar's output and contributes to it.
//
// Broken by making the INNER call return zeros: while ToF's own inputs are being computed, ToF
// contributes no SPT to the Season Pass tier that prices them. That very slightly understates the
// tier used to value ToF's tickets -- second order, since ToF is one source among 28 and the tier
// ladder is coarse -- and it is the only resolution that terminates without a second full pass.
// FLAGGED here rather than buried: if ToF ever becomes a large SPT faucet, revisit.
var _tofInFlight = false;
function simToF(seg, payer, ctx, cat){
  if (_tofInFlight) return zeroRow_();
  var cfg = tofConfig_();
  if (!cfg) return null;                                   // no MD sheet -> carry (measured 0)
  var run = tofRun_(seg, payer, ctx.ds);
  if (!run) return null;
  var budget;
  _tofInFlight = true;
  try { budget = tofRunBudget_(seg, payer, ctx, num(run.bank[TOF_TICKET])); }
  finally { _tofInFlight = false; }
  if (!budget || !(budget.runs > 0)) return zeroRow_();     // no lane / no tickets -> nothing
  var out = zeroRow_();
  RESOURCES.forEach(function(r){ out[r] = num(run.bank[r]) * budget.runs; });
  out['HC'] = num(out['HC']) - run.spend * budget.runs;     // continues are a coin SINK
  return out;
}

// ---- the MD sheet's read-out -----------------------------------------------------------------
// The run is a walk over (stage, continues, top-ups) at four wallet percentiles. That is not
// something to re-implement in spreadsheet formulas -- it would be a 60 x 11 x 2 x 4 grid per
// segment, unreadable and a second source of truth for rules that already exist here. So MD stays
// what every other config sheet is: authored inputs, with the SIM blocks spilled by the engine.
//
//   =ECOGAINS_TOF(payer, "RUN",       sim_refresh!$A$1)   runs, P(bank), spend, tickets per segment
//   =ECOGAINS_TOF(payer, "REWARD",    sim_refresh!$A$1)   banked reward per run, per resource
//   =ECOGAINS_TOF(payer, "GAINSPEND", sim_refresh!$A$1)   per stage: gain (raw and expected) vs spend
//
// The trailing argument is the refresh NONCE every ECOGAINS_* formula carries. Google only re-runs
// a custom function when its ARGUMENTS change, so without it an edit to the ToF ladder would leave
// a stale spill on the sheet. It is read by nothing.
//
// The segment columns are whatever SEGMENT BEHAVIOUR authors, so adding the MAX player there adds
// a column here with no code change.
/** @customfunction */
function ECOGAINS_TOF(payer, block, nonce){
  var p = String(payer || 'NONPAYER').trim();
  var blk = String(block || 'RUN').trim().toUpperCase();
  var cfg = tofConfig_();
  if (!cfg) return [['MD sheet not found or has no STAGES block']];
  var ctx = Context.get(), segs = [];
  for (var sname in cfg.beh) segs.push(sname);
  if (!segs.length) return [['SEGMENT BEHAVIOUR is empty']];

  if (blk === 'RUN'){
    var out = [['Segment','Runs in window','P(run pays)','Coins spent per run','Coins spent in window',
                'Tickets earned','Tickets unspent']];
    segs.forEach(function(sg){
      var run = tofRun_(sg, p, ctx.ds);
      if (!run){ out.push([sg,0,0,0,0,0,0]); return; }
      // MAX is a ceiling case, not an engagement segment: data_seg_beh has no row for it, so there
      // are no activity rates to price reach with and no ticket income to bank. Its PER-RUN numbers
      // are the point of it -- what the deep ladder is worth and what it costs to get there -- so
      // the window columns are blank rather than a fabricated 0, which would read as "MAX earns
      // nothing" instead of "this question does not apply to MAX".
      var beh = ctx.ds.beh(sg, p);
      var hasRates = num(beh.weekday_active_rate) > 0 || num(beh.weekend_active_rate) > 0;
      if (!hasRates){ out.push([sg, '', run.pBank, run.spend, '', '', '']); return; }
      var b = tofRunBudget_(sg, p, ctx, num(run.bank[TOF_TICKET])) || {runs:0,ticketsEarned:0,ticketsLeft:0};
      out.push([sg, b.runs, run.pBank, run.spend, run.spend * b.runs,
                b.ticketsEarned, b.ticketsLeft]);
    });
    return out;
  }
  if (blk === 'REWARD'){
    var rows = [['Resource'].concat(segs)];
    RESOURCES.forEach(function(res){
      var line = [res];
      segs.forEach(function(sg){
        var run = tofRun_(sg, p, ctx.ds);
        line.push(run ? num(run.bank[res]) : 0);
      });
      rows.push(line);
    });
    return rows;
  }
  if (blk === 'GAINSPEND'){
    // Per stage, per segment: what the ladder holds if you get there (RAW), what it is worth once
    // the chance of getting there and banking it is priced in (EXP), and what reaching it cost in
    // continues. RAW is the design view; EXP is the economy view; the gap between them IS the
    // house edge. Diff is absolute coins, not a ratio -- a ratio against a small spend runs to
    // five figures and no chart survives it.
    var head = ['Stage','Type'];
    segs.forEach(function(sg){ head.push(sg + ' gain (raw)', sg + ' gain (exp)', sg + ' spend', sg + ' net (exp - spend)'); });
    var grid = [head], stages = cfg.stages;
    var pre = segs.map(function(sg){ return tofStageCurve_(sg, p, ctx); });
    for (var i = 0; i < stages.length; i++){
      var line = [stages[i].n, stages[i].type];
      for (var k = 0; k < segs.length; k++){
        var c = pre[k];
        var raw = c ? c.raw[i] : 0, ex = c ? c.exp[i] : 0, sp = c ? c.spend[i] : 0;
        line.push(raw, ex, sp, (ex === '' || sp === '') ? '' : ex - sp);
      }
      grid.push(line);
    }
    return grid;
  }
  return [['Unknown block: ' + blk + ' (use RUN / REWARD / GAINSPEND)']];
}

// Cumulative curves along the ladder for one (segment, payer), in coin-equivalent value.
//   raw[i]   value of stages 1..i, unconditional -- "what the ladder holds if you get here"
//   exp[i]   raw[i] x P(reach stage i AND go on to bank) -- what a run is actually worth there
//   spend[i] expected coins spent on continues getting to stage i
// Rewards are valued through item_vals, so SPT and boosters count rather than coins alone: on the
// current ladder coins are 385 of 1591 units, so a coins-only view would miss three quarters of
// what the event pays.
function tofStageCurve_(seg, payer, ctx){
  var cfg = tofConfig_();
  if (!cfg) return null;
  var beh = cfg.beh[seg];
  if (!beh) return null;
  var stages = cfg.stages, vals = itemVals_();
  var cashOutN = (beh.cashOut > 0) ? beh.cashOut : stages[stages.length - 1].n;
  var raw = [], exp = [], spend = [], cum = 0;
  // One walk per stage is O(n^2) but n is 60 and the sheet asks for this once per segment.
  for (var i = 0; i < stages.length; i++){
    var st = stages[i], v = 0;
    for (var res in st.rew) v += st.rew[res] * st.I * num(vals[res]);
    cum += v;
    raw.push(cum);
    // Past this segment's cash-out stage the run does not exist: they stop before it. Carrying the
    // last spend forward would draw a flat negative net across 40 stages nobody plays, which reads
    // as "the deep ladder loses you money" when in fact it is never reached. '' so the chart stops.
    if (st.n > cashOutN){ exp.push(''); spend.push(''); continue; }
    var probe = { continueP: beh.continueP, cashOut: st.n, runsPerDay: beh.runsPerDay,
                  maxContinues: beh.maxContinues, balance: beh.balance };
    var bals = tofBalances_(seg, payer);
    if (!bals.length) bals = [beh.balance > 0 ? beh.balance : 0];
    var pB = 0, sp = 0;
    bals.forEach(function(b){
      var one = tofRunOnce_(cfg, probe, b, payer);
      pB += one.pBank / bals.length;
      sp += one.spend / bals.length;
    });
    exp.push(cum * pB);
    spend.push(sp);
  }
  return { raw: raw, exp: exp, spend: spend };
}

// Coin-equivalent price per resource, from the item_vals sheet (row 2 = names, row 3 = coins).
// A resource missing from that table is worth 0 -- true of the packs, COOP Token and Avatar today.
var _itemValsCache = null;
function itemVals_(){
  if (_itemValsCache) return _itemValsCache;
  var v = sheetVals_('item_vals'), out = {};
  if (v.length >= 3){
    for (var c = 0; c < v[1].length; c++){
      var name = String(v[1][c] == null ? '' : v[1][c]).trim();
      if (!name) continue;
      var res = RES_MAP[name] || name;
      out[res] = num(v[2][c]);
    }
  }
  return (_itemValsCache = out);
}

// ============================== REWARD-CONFIG RATIO R (added 2026-07-06) =====================
// Reward AND requirement edits on the _v2 config sheets now move the sim: R[res] = E_v2 / E_base,
// where E = the ladder's expected payout for this (segment, payer) under the MEASURED player
// distribution (data_event_inst). Base sheets carry the config that generated the measured
// anchor, so R = 1 until a _v2 reward/requirement is edited (project fact: _v2 initially changed
// only EventDuration). Rules:
//   - E priced per resource. E_base = 0 with E_v2 > 0 -> no anchor to scale -> CARRIED (R = 1),
//     same rule as Saga items. (This is why adding NEW milestone rewards to TaD_v2 won't flow:
//     TaD milestones pay 0 in base config — that rework needs a bottom-up score-reach model.)
//   - Leaderboards: E = mean of the ladder payout at position_p25/50/75 (three-quantile
//     approximation of the rank distribution). No position data -> pot-ratio fallback
//     (Σ ladder v2 / Σ ladder base — segment-blind, cruder).
//   - Collections: E = Σ_k S(req_k) x rew_k with S = survival over final_balance_p25/50/75.
//     J / BB read each sheet's own native req column (req edits flow fully). HH / Ph have no
//     native cumulative req column on the base sheet -> BOTH sides use the v2 EventReach helper
//     column as the req axis (reward edits flow; req edits only re-weight, flagged).
//   - Kite: leaderboard E + the score-milestone term S(Score Req) x rew (survival over
//     final_balance = banked score).
// All row/col indices below are 0-based into sheetVals_() and were verified against workbook (6);
// base and _v2 sheets share the same layout (v2 adds helper columns on the right).
var LB_R_SPECS = {
  'Red Challenge'   : {base:'Race', v2:'Race_v2', hdr:8,  r0:9,  r1:18, c0:1, c1:21, inst:'Red'},
  'Chuck Challenge' : {base:'Race', v2:'Race_v2', hdr:26, r0:27, r1:36, c0:1, c1:21, inst:'Chuck'},
  'Bomb Challenge'  : {base:'Race', v2:'Race_v2', hdr:44, r0:45, r1:54, c0:1, c1:21, inst:'Bomb'},
  'Level Race'      : {base:'Race', v2:'Race_v2', hdr:62, r0:63, r1:72, c0:1, c1:21, inst:'Level Race'},
  'Flash Race'      : {base:'Race', v2:'Race_v2', hdr:80, r0:81, r1:90, c0:1, c1:21, inst:'Flash Race'},
  'Target Day'      : {base:'TaD',  v2:'TaD_v2',  hdr:34, r0:35, r1:54, c0:2, c1:22, inst:'Target Day'},
  'Kite Festival'   : {base:'Ki',   v2:'Ki_v2',   hdr:25, r0:26, r1:85, c0:2, c1:22, inst:'Kite Festival',
                       ms:{hdr:21, r0:22, r1:22, reqC:1, c0:2, c1:22}}
};
var COLL_R_SPECS = {
  'Jigsaw'             : {base:'J',  v2:'J_v2',  hdr:9,  r0:10, r1:21, reqC:1,  reqFrom:'own',
                          c0:2, c1:22, inst:'Jigsaw'},
  'Hatchling Hideaway' : {base:'HH', v2:'HH_v2', hdr:10, r0:11, r1:15, reqC:47, reqFrom:'v2',
                          reqR0:4, c0:1, c1:21, inst:'Hatchling Hideaway'},
  "Bomb's Ballet"      : {base:'BB', v2:'BB_v2', hdr:7,  r0:8,  r1:22, reqC:1,  reqFrom:'own',
                          c0:2, c1:22, completionRow:23, inst:'Bombs Ballet'},
  'Photoshoot'         : {base:'Ph', v2:'Ph_v2', hdr:23, r0:24, r1:53, reqC:46, reqFrom:'v2',
                          reqR0:4, c0:7, c1:27, inst:'Photoshoot'}
};

// Absolute expected ladder payout for a source, both sides. Split out of rewardR_ (D19) because
// the pack lane needs E_v2 in ABSOLUTE units — packs have no measured anchor, so the v2/base
// ratio the rest of the model uses is meaningless for them.
// Returns {inst, eBase, eV2} or null (source not priceable -> carry / no packs).
function rewardE_(cat, seg, payer, ds){
  var lb = LB_R_SPECS[cat], coll = COLL_R_SPECS[cat];
  if (!lb && !coll) return null;
  var inst = ds.eventInst((lb || coll).inst, seg, payer);
  if (lb){
    var pos = inst ? [inst.position_p25, inst.position_p50, inst.position_p75]
                       .map(function(p){ return Math.max(1, Math.round(num(p))); })
                       .filter(function(p){ return p > 0; }) : [];
    return { inst: inst, eBase: lbE_(lb.base, lb, pos, inst), eV2: lbE_(lb.v2, lb, pos, inst) };
  }
  var S = inst ? survival_([[num(inst.final_balance_p25),.25],[num(inst.final_balance_p50),.5],
                            [num(inst.final_balance_p75),.75]]) : null;
  if (!S) return null;                                     // no progress distribution -> carry
  var reqs = collReqs_(coll);
  if (!reqs.length) return null;
  return { inst: inst,
           eBase: collE_(coll.base, coll, reqs, S),
           eV2:   collE_(coll.v2,   coll, reqs.own ? collReqs_(coll, true) : reqs, S) };
}

function rewardR_(cat, seg, payer, ds){
  var E = rewardE_(cat, seg, payer, ds);
  if (!E) return null;
  var R = {};
  RESOURCES.forEach(function(r){
    var b = num(E.eBase[r]), v = num(E.eV2[r]);
    if (b > 1e-9) R[r] = v / b;                            // base 0 -> carry (no anchor)
  });
  return R;
}

// expected ladder payout per resource at the measured rank quantiles (leaderboards).
// Ladder rows are position-ordered; a missing/0 pos cell falls back to the ordinal (Ki_v2's
// formula-numbered rows). Positions past the ladder pay nothing. No positions -> pot total
// (both sides get the same treatment, so the ratio degrades to the pot ratio).
// ---- pack provenance (D19 follow-up, 2026-08-18) --------------------------------------------
// The E builders below sum every ladder row into one expected payout, which is all the R ratio and
// packLane_ need. The card sim's day-by-day log needs the opposite: WHICH ladder row paid a pack —
// the rank, the milestone index, the Night Sky round. So each builder optionally records its
// per-row contribution for PACK resources only (coins would be a large and useless collection).
// Weights are the un-scaled E contributions: packLane_'s participation x reach factors are common
// to every row of a source, so they cancel when the card sim picks a row proportionally.
function provAdd_(prov, res, label, amt){
  if (!prov || !isPackRes_(res) || !(amt > 0)) return;
  (prov[res] = prov[res] || []).push({ label: label, weight: amt });
}

// ============================== RANK DISTRIBUTION (2026-09-02) ==============================
// A leaderboard used to be priced at the MEAN payout over exactly three integer ranks —
// position_p25/p50/p75, weight 1/3 each. That is not a distribution, it is three atoms, and on a
// top-heavy ladder it fails in both directions at once:
//   * HARD ZERO where no quantile lands in the paying band. Flash Race pays a pack at rank 1 only;
//     `20-39` has p25/p50/p75 = 2/3/4, so the model said that player wins none of 15 races in 33
//     days — not "rarely", never. Same for Red/Chuck/Bomb/Level Race at `0-9` (ranks 5/10/14 vs a
//     ladder that pays 1-3), and Bomb at `10-19`.
//   * OVER-GRANT where one does. `40-99` Flash Race drew rank 1 with p = 1/3 on EVERY instance
//     (~5 outright wins a season), and integer quantiles collide at the top: `100+` Red draws
//     [1,1,2], so rank 1 carried weight 2/3.
// Both are the same defect, so both are fixed by giving the rank axis a real CDF: piecewise-LINEAR
// IN RANK through (0,0), (p25,.25), (p50,.5), (p75,.75), (N,1), then P(rank=k) = F(k) - F(k-1).
//
// Why piecewise-linear and not a fitted lognormal/beta: the anchors are all the evidence there is,
// and a parametric fit VIOLATES them. `100+` Red has p25 = p50 = 1, i.e. at least half of that
// segment's finishes are 1st; a lognormal least-squares fit through those points returns P(1) =
// 0.33, contradicting a fact the data states outright. The linear CDF honours every anchor exactly
// and assumes nothing else. It is also the conservative choice at the top, which is the direction
// that matters here: `40-99` Flash Race rank 1 goes 0.333 -> 0.25, `100+` Red rank 1 goes 0.667 ->
// 0.50. The zeros become small positives; the over-grants come down.
//
// KNOWN BIAS, flagged: real rank distributions are unimodal, so on a segment whose p25 is deep
// (`0-9`, p25 = 5) the true density at rank 1 is below the [1, p25] average and this model reads a
// little high there — 0.25/p25 = 0.05 per instance against a true value that is probably lower. It
// is bounded by construction (a quarter of the mass, spread over p25 ranks) and it replaces an
// exact 0, so the absolute error is small either way. If it reads high, that is the knob.
//
// N (bracket size) barely matters: it only sets where the 25% ABOVE p75 sits, which is past the end
// of every paying ladder and contributes 0 to E. That is deliberate — it defuses a live data
// conflict rather than depending on it. The `Race` sheet declares LBSize 10 for Red/Chuck/Bomb, but
// data_event_inst has p75 = 16-17 for those events at `0-9`, so the sheet is stale (Level Challenge
// declares 20 and Flash Race 7, both consistent with their p75). FLAGGED — worth a re-export.
//
// Set LB_RANK_MODEL = 'quantiles' to restore the old three-atom sampler; nothing else changes.
var LB_RANK_MODEL = 'cdf';                       // 'cdf' (2026-09-02) | 'quantiles' (pre-D27)

// Config-panel label scoped to ONE ladder block: the nearest match ABOVE the block's header row.
// Race carries five `LBSize` rows, one per event, and a whole-sheet scan (readSPLabel_) collapses
// all five onto Red's.
function blockLabel_(sheetName, hdrRow, label){
  var v = sheetVals_(sheetName), want = String(label).trim().toLowerCase();
  for (var r = Math.min(hdrRow, v.length - 1); r >= 0; r--){
    var row = v[r] || [];
    for (var c = 0; c < row.length; c++)
      if (String(row[c]).trim().toLowerCase() === want) return (row[c + 1] == null ? '' : row[c + 1]);
  }
  return null;
}
function lbSize_(sheetName, hdrRow){
  var labels = ['LBSize', 'leagueGroupSize'];    // Race / Ki; TaD declares neither
  for (var i = 0; i < labels.length; i++){
    var raw = blockLabel_(sheetName, hdrRow, labels[i]), x = parseFloat(raw);
    if (raw !== null && raw !== '' && isFinite(x) && x > 0) return Math.round(x);
  }
  return 0;                                      // -> caller falls back to the ladder's length
}

// The measured rank quantiles as CDF anchors. Integer ranks TIE at the top (`100+` Red reads
// [1,1,2]); a discrete quantile p_q is the smallest rank with F(rank) >= q, so a tie means the mass
// is already banked there and the HIGHEST q wins. A quantile that is absent drops with its own q
// rather than shifting the others onto the wrong probability.
function rankAnchors_(inst){
  if (!inst) return [];
  var raw = [[num(inst.position_p25), 0.25], [num(inst.position_p50), 0.50],
             [num(inst.position_p75), 0.75]], out = [];
  for (var i = 0; i < raw.length; i++){
    if (!(raw[i][0] > 0)) continue;
    var r = Math.max(1, Math.round(raw[i][0])), last = out[out.length - 1];
    if (last && last.r === r) last.q = Math.max(last.q, raw[i][1]);
    else out.push({ r: r, q: raw[i][1] });
  }
  return out;
}

// [{rank, p}] over ranks 1..N, or null with no rank telemetry.
function rankDist_(inst, nMax){
  var a = rankAnchors_(inst);
  if (!a.length) return null;
  var N = Math.max(num(nMax) || 0, a[a.length - 1].r + 1);   // N > p75, or the tail has nowhere to go
  var pts = [{ r: 0, q: 0 }].concat(a);
  if (pts[pts.length - 1].q < 1) pts.push({ r: N, q: 1 });
  function F(x){
    if (x <= 0) return 0;
    if (x >= N) return 1;
    for (var i = 1; i < pts.length; i++){
      if (x <= pts[i].r){
        var lo = pts[i - 1], hi = pts[i];
        return (hi.r === lo.r) ? hi.q : lo.q + (hi.q - lo.q) * (x - lo.r) / (hi.r - lo.r);
      }
    }
    return 1;
  }
  var out = [], prev = 0;
  for (var k = 1; k <= N; k++){ var f = F(k); out.push({ rank: k, p: f - prev }); prev = f; }
  return out;
}

// The rank ladder of one leaderboard block, keyed by finishing position.
// A row that DOES NOT EXIST is not a rung. LB_R_SPECS declares Flash Race as rows 81..90 but the
// `Race` sheet ends at 87 and the ladder is 7 places (LBSize 7, numberOfPositions 7), so the
// ordinal fallback below — which is there for Ki_v2's formula-numbered position cells — was
// inventing ranks 8, 9 and 10 out of three missing rows. Harmless while a leaderboard was priced at
// three quantile atoms (all of them <= 7, so the phantoms were never looked up); once the rank axis
// became a distribution they took 12.5% of the mass and paid nothing for it, quietly understating
// every Flash Race resource that pays below rank 4. Caught by the flat-ladder invariance gate in
// _mock_cards.js section 2b.
function lbLadder_(sheetName, spec){
  var v = sheetVals_(sheetName), cols = rewCols_(v, spec.hdr, spec.c0, spec.c1), ladder = {};
  for (var r = spec.r0; r <= spec.r1; r++){
    var row = v[r];
    if (!row) continue;                                  // spec over-reads the end of the sheet
    var pos = Math.round(num(row[0]));
    if (!(pos > 0)){
      if (!rowHasContent_(row, spec.c0, spec.c1)) continue;   // blank filler row, not a rung
      pos = r - spec.r0 + 1;                             // Ki_v2: position cell is an uncached formula
    }
    ladder[pos] = rewRow_(v, r, cols);
  }
  return ladder;
}
// Any non-blank cell across the block's reward span. Blank ('' / null / missing) only — a rung that
// legitimately pays nothing is all ZEROS, which is content.
function rowHasContent_(row, c0, c1){
  for (var c = c0; c <= c1; c++)
    if (String(row[c] == null ? '' : row[c]).trim() !== '') return true;
  return false;
}
// Ladder + rank CDF for one block. SHARED by lbE_ (the gains model) and packRungs_ (the card sim)
// so the two cannot describe different games: E = SUM_k P(k) x ladder[k] is exactly what the card
// sim's exclusive draw pays in expectation.
function lbRankDist_(sheetName, spec, inst){
  var ladder = lbLadder_(sheetName, spec), maxRank = 0;
  for (var k in ladder) if (+k > maxRank) maxRank = +k;
  return { ladder: ladder,
           dist: rankDist_(inst, Math.max(lbSize_(sheetName, spec.hdr), maxRank)) };
}

function lbE_(sheetName, spec, positions, inst, prov){
  var v = sheetVals_(sheetName);
  var rd = lbRankDist_(sheetName, spec, inst), ladder = rd.ladder;
  var E = zeroRow_();
  if (LB_RANK_MODEL === 'cdf' && rd.dist){
    rd.dist.forEach(function(d){
      var rew = ladder[d.rank];
      if (!rew || !(d.p > 0)) return;
      for (var res in rew){
        E[res] = num(E[res]) + rew[res] * d.p;
        provAdd_(prov, res, 'rank ' + d.rank, rew[res] * d.p);
      }
    });
  } else if (positions.length){
    positions.forEach(function(p){
      var rew = ladder[p] || {};
      for (var res in rew){
        E[res] = num(E[res]) + rew[res] / positions.length;
        provAdd_(prov, res, 'rank ' + p, rew[res] / positions.length);
      }
    });
  } else {
    for (var p2 in ladder) for (var res2 in ladder[p2]){
      E[res2] = num(E[res2]) + ladder[p2][res2];
      provAdd_(prov, res2, 'rank ' + p2 + ' (pot avg, no position data)', ladder[p2][res2]);
    }
  }
  if (spec.ms && inst){                                    // Kite score milestone term
    var S = survival_([[num(inst.final_balance_p25),.25],[num(inst.final_balance_p50),.5],
                       [num(inst.final_balance_p75),.75]]);
    if (S){
      var mCols = rewCols_(v, spec.ms.hdr, spec.ms.c0, spec.ms.c1);
      for (var mr = spec.ms.r0; mr <= spec.ms.r1; mr++){
        var req = num(v[mr] && v[mr][spec.ms.reqC]);
        if (!(req > 0)) continue;
        var mRew = rewRow_(v, mr, mCols), s = S(req);
        for (var res3 in mRew){
          E[res3] = num(E[res3]) + mRew[res3] * s;
          provAdd_(prov, res3, 'score milestone (req ' + req + ')', mRew[res3] * s);
        }
      }
    }
  }
  return E;
}

// requirement axis for a collection pair. reqFrom 'own': each sheet's native req column (v2Side
// switches sheets). reqFrom 'v2': the v2 helper column serves BOTH sides (base has none).
function collReqs_(spec, v2Side){
  var name = (spec.reqFrom === 'own' && !v2Side) ? spec.base : spec.v2;
  var v = sheetVals_(name), reqs = [], n = spec.r1 - spec.r0 + 1;
  var row0 = (spec.reqR0 != null) ? spec.reqR0 : spec.r0;
  for (var i = 0; i < n; i++) reqs.push(num(v[row0 + i] && v[row0 + i][spec.reqC]));
  reqs.own = (spec.reqFrom === 'own');
  return reqs.some(function(x){ return x > 0; }) ? reqs : [];
}

// survival-weighted milestone payout per resource (collections). The completion row (BB) is
// gated at the LAST milestone's requirement.
function collE_(sheetName, spec, reqs, S, prov){
  var v = sheetVals_(sheetName), cols = rewCols_(v, spec.hdr, spec.c0, spec.c1);
  var E = zeroRow_(), lastReq = 0;
  for (var i = 0; i < reqs.length; i++){
    var req = reqs[i];
    if (!(req > 0)) continue;
    lastReq = req;
    var rew = rewRow_(v, spec.r0 + i, cols), s = S(req);
    for (var res in rew){
      E[res] = num(E[res]) + rew[res] * s;
      provAdd_(prov, res, 'milestone #' + (i + 1) + ' (req ' + req + ')', rew[res] * s);
    }
  }
  if (spec.completionRow != null && lastReq > 0){
    var cRew = rewRow_(v, spec.completionRow, cols), cs = S(lastReq);
    for (var res2 in cRew){
      E[res2] = num(E[res2]) + cRew[res2] * cs;
      provAdd_(prov, res2, 'completion bonus (req ' + lastReq + ')', cRew[res2] * cs);
    }
  }
  return E;
}

// Reward columns of one block. The c0..c1 span is authored per spec and deliberately narrow: the
// _v2 sheets carry HELPER columns (EventReach axes, requirement scratch) to the right of the reward
// block, and a scan to the end of the row would price them as resources.
//
// It also has to SELF-EXTEND, because every c1 in LB_R_SPECS / COLL_R_SPECS / PACK_ONLY_SPECS was
// authored against a 19-resource world. Appending ToF_Ticket as #20 put it exactly one column past
// c1 on all ten blocks, so the engine read every ladder as if the column were not there -- a ticket
// typed by a designer produced nothing at all, silently and identically to "none authored". Rather
// than bump ten hardcoded constants (and again for resource #21), keep consuming columns past c1
// for as long as the header keeps naming a RESOURCE. A helper column never does, so the walk stops
// at the block edge on its own.
function rewCols_(v, hdrRow, c0, c1){
  var cols = {}, row = v[hdrRow] || [];
  function take(c){
    var res = RES_MAP[String(row[c] || '').trim()];
    if (res && cols[res] == null) cols[res] = c;
    return !!res;
  }
  for (var c = c0; c <= c1; c++) take(c);
  for (var c2 = c1 + 1; c2 < row.length; c2++) if (!take(c2)) break;
  return cols;
}
function rewRow_(v, r, cols){
  var rew = {};
  for (var res in cols){ var amt = num(v[r] && v[r][cols[res]]); if (amt) rew[res] = amt; }
  return rew;
}

// ============================== NIGHT SKY (D13 bottom-up → D22 ANCHORED) =====================
// Config-segmented (D14): each segment has its OWN 3-milestone daily ladder, in 'NS' (live) and
// 'NS_v2' (redesign). Re-wired 2026-07-06 (NIGHT_SKY_REWIRE_PLAN, Option A) to a daily-reset,
// cumulative-gated bottom-up model; RE-ANCHORED 2026-08-05 (D22, user decision) so NS is priced
// the same way every other configured source is:
//
//   SIMULATED[res] = measured[res] x R[res] x T          (D = 1 — NS instances are 1-day)
//   R[res] = E_v2[res] / E_base[res],  E[res] = Σ_k S(CumStreakReq_k) x reward_k[res]
//
// with S = survival over the data_streaks max_streak_per_day p25/p50/p75/p90 percentiles, each
// scaled by NS_STREAK_N (same x-axis-scaling pattern as simRainbowMaker's duration scale). The
// SAME S prices both sides, so a REQUIREMENT edit in NS_v2 moves R just like a reward edit does.
// 'NS' is the anchor config by definition: the measured data_gains rows were earned under it, so
// NS_v2 == NS ⇒ R = 1 ⇒ SIMULATED = measured x T (and T = 1 while both calendars run NS daily) —
// identical configs give identical rewards, which is the point of the re-anchor.
//
// WHAT THE RE-ANCHOR GIVES UP (D22, accepted): measured NS is A/B-diluted (partial rollout). Both
// sides of R carry the same dilution, so it cancels — the DIFF is now the CONFIG effect only, and
// the old full-rollout "rollout effect" number is no longer produced by any sheet function. The
// bottom-up machinery survives only as nsE_/nsEDay_ feeding R and the base-0 additions below.
// FLAGGED: this also side-steps, rather than answers, the standing "the bottom-up NS sim
// overestimates actual NS gains" question — anchoring on measured makes the level right by
// construction, but the ladder-climbing model behind R is the same unvalidated one.
//
// Per-resource anchoring rules (project standard):
//   E_base > 0                -> ratio path (above).
//   E_base = 0, E_v2 > 0      -> no anchor; ADD the absolute bottom-up value E_v2 x Σp_day (a
//                                resource newly typed onto the NS ladder — e.g. SPT, which then
//                                feeds sptTotals_ and the Season Pass tier).
//   E_base = 0, E_v2 = 0      -> R = 1: measured x T (resources NS pays outside the ladder).
// No cal_new instances -> 0 (removal semantics, same as River Rush). 'A. 0' never reaches here
// (appendixRow_ intercepts it) so the appendix stays carried, as before.
var NS_STREAK_N = 1.25;   // effective-streak factor from the standalone NS Excel study: a player
                          // tends to land ~a second streak of similar size; absorbs streak resets.
var NS_V2_SHEET = 'NS_v2';   // redesign config; missing sheet / missing segment row -> 'NS' (R = 1)

// ---- WEEKDAY / WEEKEND Night Sky (D23, 2026-08-27) -----------------------------------------
// The redesign runs TWO Night Skies rather than one: a weekend variant and a weekday variant.
// The workbook expresses that as a second redesign sheet, 'NS_v2_weekday'; 'NS_v2' is then the
// WEEKEND ladder. (In the workbook that introduced this the weekday sheet is a verbatim copy of
// 'NS' — i.e. weekdays keep today's ladder and only the weekend one is re-authored — but nothing
// here depends on that: both sheets are read as ordinary ladders.)
//
// A day-type is NOT a calendar row, so it cannot be modelled by the calendar reader: cal_new
// carries ONE 'Night Sky' row filled on all 33 days. What separates the two variants is which of
// the 33 days each one runs on, so the two ladders are folded into ONE expected-per-active-day
// value, WEIGHTED by the expected active days of each day type:
//
//   E_v2[res] = ( E_wd[res] x Σ_weekday p_day  +  E_we[res] x Σ_weekend p_day )
//               ------------------------------------------------------------
//                        Σ_weekday p_day  +  Σ_weekend p_day
//
// with the weekend/weekday split taken over the cal_new Night Sky days through the engine's own
// isWeekend_ rule (Fri/Sat/Sun -> 15 of the 33 days), and p_day the segment's weekday/weekend
// active rate. Because the blend is a WEIGHTED AVERAGE of two per-active-day rates it is the same
// KIND of number nsEDay_ always returned, so every consumer downstream is unchanged and stays
// exactly conservative: R = E_v2/E_base, the base-0 bottom-up addition E_v2 x Σp_day, and
// packLane_'s E_v2 x participation x Σreach all keep their meaning and their totals.
// Equivalently: a weekend-only reward is paid at (weekend active days / all active days) of its
// face value, which is what "only available a certain number of days out of 33" means in a
// window-total model.
//
// The other three views read the SIDE-APPROPRIATE ladder per day instead of the blend, because
// they resolve individual days and can be exact: the daily view splits each NS resource's window
// total between the two day types in the same proportion (nsDayTypeSplit_), the PBP ledger reads
// nsLadderForDay_(seg, day), and the card sim's pack rungs read the ladder of the instance's own
// day. All three still sum to the blended window total.
//
// Missing 'NS_v2_weekday' sheet, or no block for this segment -> there is no weekday variant and
// 'NS_v2' runs every day: the blend collapses to E_v2 and the model is byte-identical to D22.
var NS_V2_WEEKDAY_SHEET = 'NS_v2_weekday';
// Master switch for the split. false -> 'NS_v2' is the only redesign ladder and every day reads
// it (the D22 behaviour), whatever 'NS_v2_weekday' happens to contain.
var NS_DAYTYPE_SPLIT = true;
// Night Sky master switch. Kept through the D22 re-anchor as an on/off for the whole NS lane:
//   true  (shipped) -> NS is simulated as measured x R x T in the 33-day, daily and SPS views,
//                      and the PBP sim claims NS milestones off the side-appropriate ladder.
//   false           -> NS is CARRIED (= measured from data_gains, diff 0); T is NOT applied
//                      either, and the PBP sim skips NS milestone claims.
var NS_SIMULATE = true;

// NS_ANCHORED (2026-08-21, Garry). Two DIFFERENT questions, and the older NS_SIMULATE flag answers
// neither of them the way it sounds:
//   NS_SIMULATE = false  -> NS is CARRIED. sim = measured, diff EXACTLY 0. That is "assume nothing
//                           about Night Sky changed", NOT "Night Sky is new".
//   NS_ANCHORED = true   -> the D22 model: sim = measured x R x T. The config CHANGE only.
//   NS_ANCHORED = false  -> NS is a NEW SOURCE: the measured anchor is forced to 0 and the row is
//                           priced bottom-up on cal_new (E_v2 x expected active days). The DIFF is
//                           then the WHOLE lane, which is what "there was no Night Sky in the old
//                           calendar, there is one in the new" actually means.
// Shipped false: this workbook adds Night Sky on top rather than re-configuring an existing one.
// Note this restores the pre-D22 pricing, and with it the standing caveat that the bottom-up NS
// model was never validated against actuals (it looked ~5x hot the last time anyone checked).
var NS_ANCHORED = false;
function simNightSky(seg, payer, ctx){
  var ds = ctx.ds, meas = measuredRow_('Daily Night Sky Prize', seg, payer, ds);
  if (!NS_SIMULATE) return meas;                         // flag off -> carried (see switch above)
  if (!ctx.calNewOk) return meas;
  var nw = ctx.calNew['Night Sky'] || [];
  if (!nw.length) return zeroRow_();                     // removed from the new calendar
  var E = nsE_(seg, payer, ds, ctx);   // eV2 = the weekday/weekend day-type blend (D23)
  if (!E) return meas;                                   // no ladder / no streak data -> carry
  var b = ds.beh(seg, payer);
  var T = timingRatio_(ctx.calCur['Night Sky'] || [], nw, seg, payer, ds);
  var days = reachSum_(nw, num(b.weekday_active_rate),   // 33x1d -> Σ p_day = expected active days
                       num(b.weekend_active_rate));
  var out = {};
  if (!NS_ANCHORED){
    // NEW SOURCE: nothing to scale, so every resource is the bottom-up value. measuredRow_ forces
    // the anchor to 0 for this lane (see below), so the DIFF is the whole thing.
    RESOURCES.forEach(function(r){ out[r] = num(E.eV2[r]) * days; });
  } else {
    RESOURCES.forEach(function(r){
      var base = num(E.eBase[r]), v2 = num(E.eV2[r]);
      out[r] = num(meas[r]) * (base > 1e-9 ? v2 / base : 1) * T;
      if (base <= 1e-9 && v2 > 0) out[r] += v2 * days;    // base-0 addition: no anchor -> bottom-up
    });
  }
  // Packs (D19) never have an anchor, so the base-0 addition above would price them without the
  // participation term every other source carries. Overlay the standard pack lane instead (D22).
  return overlayPacks_(out, packLane_('Night Sky', seg, payer, ctx, E.eV2,
                                      ds.eventInst('Night Sky', seg, payer),
                                      'Daily Night Sky Prize'));
}

// Expected per-DAY payout of the NS ladder, both sides, under one survival curve.
// Returns {eBase, eV2} or null when the segment has no streak distribution or no base ladder
// (either way there is nothing to anchor on -> callers carry measured).
function nsE_(seg, payer, ds, ctx){
  var st = ds.nsStreak(seg, payer);
  var S = st ? survival_([[st.p25*NS_STREAK_N,.25],[st.p50*NS_STREAK_N,.50],
                          [st.p75*NS_STREAK_N,.75],[st.p90*NS_STREAK_N,.90]]) : null;
  if (!S) return null;
  var base = readNSLadder_(seg, 'NS');
  if (!base.length) return null;
  var we = nsEDay_(readNSLadder_(seg, NS_V2_SHEET), S);        // 'NS_v2' = the WEEKEND ladder
  var wdLad = nsWeekdayLadder_(seg);                           // null -> no weekday variant
  var wd = wdLad ? nsEDay_(wdLad, S) : we;
  var sh = nsDayTypeSplit_(seg, payer, ds, ctx);
  var eV2 = zeroRow_();
  RESOURCES.forEach(function(r){ eV2[r] = num(wd[r]) * sh.wd + num(we[r]) * sh.we; });
  return { eBase: nsEDay_(base, S), eV2: eV2, eV2Weekday: wd, eV2Weekend: we,
           split: sh, hasWeekdayVariant: !!wdLad };
}

// The weekday redesign ladder for one segment, or null when there is no weekday variant.
// Deliberately NOT readNSLadder_: that helper falls back to 'NS', which would silently make an
// absent weekday sheet mean "weekdays keep the LIVE ladder" rather than "there is only one
// redesign ladder" — a real economy difference invented by a missing sheet.
function nsWeekdayLadder_(seg){
  if (!NS_DAYTYPE_SPLIT) return null;
  var l = nsLadderOn_(NS_V2_WEEKDAY_SHEET, seg);
  return l.length ? l : null;
}

// Share of the window's expected ACTIVE Night Sky days that falls on weekdays vs on the weekend,
// over the cal_new Night Sky slots ({wd, we} summing to 1). Shares, not counts, so the caller can
// multiply by whichever total it already holds (Sreach for the window sim, the resource's window
// total for the daily view) without double-counting. No calendar / no rate data -> the day COUNT
// split of the 33-day block, so the split degrades to "15 of 33 days are weekend" instead of
// collapsing to a single side.
function nsDayTypeSplit_(seg, payer, ds, ctx){
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)){ pWd = 1; pWe = 1; }
  try { ctx = ctx || Context.get(); } catch(e){ ctx = null; }
  var insts = (ctx && ctx.calNewOk && ctx.calNew['Night Sky']) || null;
  var wd = 0, we = 0;
  if (insts && insts.length){
    insts.forEach(function(inst){
      ((inst && inst.days) || []).forEach(function(d){
        if (isWeekend_(d)) we += pWe; else wd += pWd;
      });
    });
  } else {
    for (var d = 1; d <= 33; d++){ if (isWeekend_(d)) we += pWe; else wd += pWd; }
  }
  var tot = wd + we;
  if (!(tot > 0)) return { wd: 1, we: 0, weekdayDays: 0, weekendDays: 0 };
  return { wd: wd / tot, we: we / tot, weekdayDays: wd, weekendDays: we };
}

// The redesign ladder that applies on ONE cal_new day. Weekend days (isWeekend_: Fri/Sat/Sun)
// read 'NS_v2'; weekdays read 'NS_v2_weekday' when that sheet has a block for the segment.
function nsLadderForDay_(seg, day){
  if (!isWeekend_(day)){
    var wd = nsWeekdayLadder_(seg);
    if (wd) return wd;
  }
  return readNSLadder_(seg, NS_V2_SHEET);
}
// Provenance-only twin of nsEDay_: writes the pack rows one NS ladder pays, each scaled by that
// ladder's share `w` of the window's active days and tagged with its day type. Returns nothing —
// the E value itself always comes from nsEDay_, so the two can never disagree on the number.
function nsEDayProv_(ladder, S, prov, w, tag){
  (ladder || []).forEach(function(ms, k){
    var s = S(ms.req) * num(w);
    for (var res in ms.rew)
      provAdd_(prov, res, 'round ' + (k + 1) + ' (cum streak req ' + ms.req + ')' + (tag || ''),
               ms.rew[res] * s);
  });
}
function nsEDay_(ladder, S, prov){
  var E = zeroRow_();
  ladder.forEach(function(ms, k){
    var s = S(ms.req);
    for (var res in ms.rew){
      E[res] = num(E[res]) + ms.rew[res] * s;
      provAdd_(prov, res, 'round ' + (k + 1) + ' (cum streak req ' + ms.req + ')', ms.rew[res] * s);
    }
  });
  return E;
}

// ============================== RAINBOW MAKER (D6/D7 — bottom-up, survival-weighted) =========
// Per cal_new instance: E[res] = Σ_k S_dur(ReqAccum_k) x reward_k[res], where S_dur uses the
// data_RM matchables percentiles scaled by (instanceDur / configured EventDuration) — the
// clipped 2-day instance halves the matchables axis (flagged linear-scaling assumption).
// RM[res] = Σ instances E[res] x reach(inst). Measured rows are soft-launch traces (kept in diff).
//
// PER-INSTANCE CONFIG SPLIT (2026-07-10, user decision — HARDCODED, see the CLAUDE.md
// "Rainbow Maker split configs" note for the planned un-hardcoding): the 5 cal_new instances,
// ordered by START DAY (the clipped 2-day instance at days 1-2 counts as #1), use:
//   #1-#3 -> 'RM_1st' (no SPTx2)   ·   #4-#5 -> 'RM_2nd' (SPTx2 rewards)
// A split sheet that is missing or has no readable ladder falls back to 'RM' (keeps older
// workbook exports and the offline harness working). All four views share this mapping:
// the 33-day sim + Sim per Segment via simRainbowMaker/resultRow_, the daily view via
// rmInstanceRows_ (per-instance rows so SPTx2 lands only on RM_2nd instance days), the PBP
// session sim via rmConfigFor_ (day -> running instance -> its config).
var RM_INSTANCE_SHEETS = ['RM_1st', 'RM_1st', 'RM_1st', 'RM_2nd', 'RM_2nd'];

function rmSortedInsts_(cal){
  return ((cal && cal['Rainbow Maker']) || []).slice()
    .sort(function(x, y){ return x.start - y.start; });
}
// instance ordinal (0-based, start-sorted) -> {sheet, ladder, cfgDur}; fallback chain to 'RM'.
function rmConfigFor_(i){
  var name = RM_INSTANCE_SHEETS[Math.max(0, Math.min(i, RM_INSTANCE_SHEETS.length - 1))] || 'RM';
  // Prefer the _v2 ladder when one exists (2026-08-18). Every other source in the model is authored
  // on its _v2 sheet, and Rainbow Maker was the one exception: being bottom-up it read the BASE
  // ladder directly, so packs typed into RM_1st_v2 / RM_2nd_v2 were never read and RM paid nothing
  // at all. That is invisible rather than loud, because a bottom-up source with an empty ladder just
  // contributes zero. Base ladder stays the fallback, so a workbook without _v2 sheets is unchanged.
  var v2 = name + '_v2';
  if (readRMLadder_(v2).length) name = v2;
  var ladder = readRMLadder_(name);
  if (!ladder.length && name !== 'RM'){ name = 'RM'; ladder = readRMLadder_('RM'); }
  return { sheet: name, ladder: ladder, cfgDur: readRMDuration_(name) || 4 };
}

function simRainbowMaker(seg, payer, ctx){
  var meas = measuredRow_('Rainbow Maker', seg, payer, ctx.ds);
  if (!ctx.calNewOk) return meas;
  if (!rmSortedInsts_(ctx.calNew).length) return zeroRow_();
  var parts = rmInstanceRows_(seg, payer, ctx);
  if (!parts) return meas;                               // no ladder / no matchables -> carry
  var out = zeroRow_();
  parts.forEach(function(p){
    RESOURCES.forEach(function(r){ out[r] = num(out[r]) + num(p.row[r]); });
  });
  return out;
}

// Per-instance contributions over cal_new (start-sorted): [{inst, row}] — simRainbowMaker sums
// them; the daily view places each instance's OWN row on its days (so RM_2nd-only resources
// like SPTx2 never leak onto RM_1st instance days). Returns null when there is no matchables
// distribution or no readable ladder anywhere (callers carry measured, as before the split).
function rmInstanceRows_(seg, payer, ctx){
  var ds = ctx.ds, pct = ds.rmPct(seg, payer);
  if (!pct) return null;
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  var any = false;
  var parts = rmSortedInsts_(ctx.calNew).map(function(inst, i){
    var cfg = rmConfigFor_(i), row = zeroRow_();
    if (cfg.ladder.length){
      any = true;
      var scale = Math.min(1, inst.dur / cfg.cfgDur);
      var S = survival_([[pct.p10*scale,.10],[pct.p25*scale,.25],[pct.p50*scale,.50],
                         [pct.p75*scale,.75],[pct.p90*scale,.90]]);
      if (S){
        var reach = reachOne_(inst, pWd, pWe);
        cfg.ladder.forEach(function(ms){
          var s = S(ms.req);
          for (var res in ms.rew) row[res] = num(row[res]) + ms.rew[res] * s * reach;
        });
      }
    }
    return { inst: inst, row: row };
  });
  return any ? parts : null;
}

// ============================== SEASON PASS (D16 — SPT tier coupling) ========================
// More/less SPT earned across ALL sources moves the tier reached on the season-pass points
// ladder, which scales the Season Pass (Free) payout row. Anchored path per resource:
//   SIM = measured x cum_v2(T_sim)/cum_base(T_meas) x R_challenge x T_cal      (D pinned 1)
// T_meas/T_sim = spTier_ of the per-earner SPT + 2xSPTx2 window totals (measured vs simulated
// per-category sums — additive-projection convention, same as the NET blocks) scaled
// x seasonDays/33 onto the SP / SP_v2 'Cumul' ladder. cum = Σ tier rewards 1..T: FREE track for
// NONPAYER, FREE+PAID for PAYER (ASSUMPTION, flagged: the measured '(Free)' category is presumed
// to contain payers' paid-track claims — the telemetry label doesn't split tracks).
// R_challenge = SP_lb_v2/SP_lb rank-ladder POT ratio (zero-sum like Kite; the Dream Pass rows in
// data_event_inst are empty, so there is no position distribution to price at).
// No anchor (measured 0 or cum_base 0): tiers GAINED add the ABSOLUTE SP_v2 rewards of tiers
// (T_meas, T_sim] on top of measured (HYBRID — config absolutes on a measured row, flagged);
// no tier gain -> carry (never deletes a measured value; e.g. the row's own SPT is carried —
// the track pays no SPT).
// SP's own SPT contribution enters the totals as measured on BOTH sides (single pass — this IS
// the recursion guard; ctx._sptBusy is a defensive backstop). SP_v2 / SP_lb_v2 missing or empty
// -> the base sheet serves both sides (all ratios 1). Season length: 'Season Length (days)'
// config label on SP / SP_v2 (value in the cell to its right); absent -> 33 (window = season,
// flagged assumption).
function simSeasonPass(seg, payer, ctx){
  var meas = measuredRow_('Season Pass (Free)', seg, payer, ctx.ds);
  if (ctx._sptBusy) return meas;                       // defensive re-entry guard (see header)
  if (!ctx.calCurOk || !ctx.calNewOk) return meas;     // parse fail -> carry (canary catches)
  var cur = ctx.calCur['Season Pass'] || [], nw = ctx.calNew['Season Pass'] || [];
  if (!nw.length) return zeroRow_();                   // removed from the new calendar
  if (!cur.length) return meas;                        // no anchor-side instances -> carry
  var base = readSPTrack_('SP');
  if (!base.cum.length) return meas;                   // SP sheet unreadable -> carry
  var v2Name = spV2Sheet_('SP');
  var v2 = (v2Name === 'SP') ? base : readSPTrack_(v2Name);
  if (!v2.cum.length) v2 = base;
  var daysBase = readSPSeasonDays_('SP') || 33;        // no config panel yet -> season = window
  var daysV2   = (v2Name !== 'SP' && readSPSeasonDays_(v2Name)) || daysBase;
  var t  = sptTotals_(seg, payer, ctx);
  var Tm = spTier_(t.meas * daysBase / 33, base.cum);
  var Ts = spTier_(t.sim  * daysV2   / 33, v2.cum);
  // FREE TRACK ONLY, both sides. Until 2026-08-21 this row folded the PAID track in for payers,
  // because the workbook had a single 'Season Pass (Free)' row and the measured category was
  // assumed to contain payers' paid claims too. The sheet now carries a separate
  // 'Season Pass (Paid)' row, so keeping paid here as well would double-count it.
  var cb = spCumTo_(base, Tm, 'NONPAYER'), cs = spCumTo_(v2, Ts, 'NONPAYER');
  var Rlb = spChallengeR_();
  var T = timingRatio_(cur, nw, seg, payer, ctx.ds);   // D pinned 1 — tier rewards are end-state
  var out = {};
  RESOURCES.forEach(function(r){
    var m = num(meas[r]);
    if (m > 0 && num(cb[r]) > 0){                      // anchored: ratio path
      out[r] = m * (num(cs[r]) / num(cb[r])) * ((Rlb[r] != null) ? Rlb[r] : 1) * T;
    } else if (Ts > Tm){                               // no anchor: additive newly-unlocked tiers
      var add = 0;
      for (var i = Tm; i < Ts; i++) add += num(v2.free[i] && v2.free[i][r]);   // free track only
      out[r] = m + add;                                // HYBRID (absolute config values)
    } else {
      out[r] = m;                                      // no anchor, no tier gain -> carry
    }
  });
  // Packs (D19): no measured anchor at all, so neither the ratio path nor the newly-unlocked-tier
  // path applies — the player simply earns every pack on the track up to the tier they reach.
  // Priced off the whole reached track (season-cumulative by construction, so no per-instance
  // reach term) x the challenge pot ratio x calendar T.
  var packs = {};
  PACK_RES.forEach(function(r){
    packs[r] = num(cs[r]) * ((Rlb[r] != null) ? Rlb[r] : 1) * T;   // cs is free-track only now
  });
  return overlayPacks_(out, packs);
}

// ============================== SEASON PASS (PAID) — split out 2026-08-21 ====================
// The paid track as its OWN source row. It has NO measured anchor: data_gains emits only a
// 'Season Pass (Free)' category, so `measured x R` cannot produce it and the row is priced
// bottom-up off the config, exactly like the pack lane is:
//
//   SIM[res] = cum_paid_v2(T_sim)[res] x R_challenge x T          (D pinned 1)
//
// where cum_paid is the sum of the PAID column of every tier up to the one the player's simulated
// SPT reaches. NONPAYER earns nothing here by definition. Garry's call (2026-08-18): payers are
// assumed to hold the pass across both sides of the comparison, so the track is like-for-like and
// the purchase itself needs no simulating - what moves is how far up it they climb.
// The Free row was folding this in for payers until the sheet grew a separate row; it no longer
// does, so the two rows sum to what the single row used to show.
function simSeasonPassPaid(seg, payer, ctx){
  if (payer !== 'PAYER') return zeroRow_();            // no paid track without a purchase
  if (!ctx.calCurOk || !ctx.calNewOk) return zeroRow_();
  var cur = ctx.calCur['Season Pass'] || [], nw = ctx.calNew['Season Pass'] || [];
  if (!nw.length || !cur.length) return zeroRow_();
  var sp = spPaidTracks_();
  if (!sp) return zeroRow_();
  var t = sptTotals_(seg, payer, ctx);
  var Ts = spTier_(t.sim * sp.daysV2 / 33, sp.v2.cum);
  if (!(Ts > 0)) return zeroRow_();
  var Rlb = spChallengeR_();
  var T = timingRatio_(cur, nw, seg, payer, ctx.ds);
  var out = spPaidCum_(sp.v2, Ts);
  RESOURCES.forEach(function(r){
    out[r] = num(out[r]) * ((Rlb[r] != null) ? Rlb[r] : 1) * T;
  });
  return out;
}

// Cumulative PAID-track reward through tier T, per resource.
function spPaidCum_(track, T){
  var out = zeroRow_();
  for (var i = 0; i < T && i < track.paid.length; i++){
    var row = track.paid[i] || {};
    for (var r in row) out[r] = num(out[r]) + num(row[r]);
  }
  return out;
}

// Both SP tracks plus the season lengths, or null when the sheet is unreadable.
function spPaidTracks_(){
  var base = readSPTrack_('SP');
  if (!base.cum.length) return null;
  var v2Name = spV2Sheet_('SP');
  var v2 = (v2Name === 'SP') ? base : readSPTrack_(v2Name);
  if (!v2.cum.length) v2 = base;
  var daysBase = readSPSeasonDays_('SP') || 33;
  var daysV2 = (v2Name !== 'SP' && readSPSeasonDays_(v2Name)) || daysBase;
  return { base: base, v2: v2, daysBase: daysBase, daysV2: daysV2 };
}

// The MEASURED side of Season Pass (Paid): the paid track up to the tier the player's measured SPT
// reached, on the BASE config. Uses the same tier machinery as the simulated side, so the two are
// like-for-like and the DIFF is the movement rather than the whole track.
// Computes its OWN measured SPT total rather than borrowing one the simulated pass leaves behind.
// The first version read a module cache that sptTotals_ filled, which made the answer depend on
// whether anything had run first: ECOGAINS_DIFF happened to populate it, a bare measuredRow_ call
// did not, and the anchor silently read 0. An anchor that changes with call order is not an anchor.
function spPaidSynth_(seg, payer, ds){
  if (payer !== 'PAYER' || !ds) return null;
  var sp = spPaidTracks_();
  if (!sp) return null;
  var Tm = spTier_(measuredSptTotal_(seg, payer, ds) * sp.daysBase / 33, sp.base.cum);
  if (!(Tm > 0)) return zeroRow_();
  return spPaidCum_(sp.base, Tm);
}

// Per-earner MEASURED SPT + 2xSPTx2 across every category. The measured half of sptTotals_, pulled
// out so it needs only `ds` (no calendars, no ctx) and can therefore be reached from measuredRow_.
// Cached per (seg, payer) on the module, alongside the per-execution sheet cache.
var _measSptCache = {}, _measSptBusy = false;
function measuredSptTotal_(seg, payer, ds){
  var key = seg + '|' + payer;
  if (_measSptCache[key] != null) return _measSptCache[key];
  if (_measSptBusy) return 0;                          // re-entry via measuredRow_ -> contribute 0
  var total = 0;
  _measSptBusy = true;
  try {
    CATEGORY_ORDER.forEach(function(cat){
      if (cat === 'Season Pass (Paid)') return;        // the row being anchored; pays no SPT anyway
      var row = measuredRow_(cat, seg, payer, ds);
      total += num(row['SPT']) + 2 * num(row['SPTx2']);
    });
  } finally { _measSptBusy = false; }
  return (_measSptCache[key] = total);
}

// Season Pass packs, tier by tier, for the card sim's day-by-day log (2026-08-20).
// simSeasonPass prices SP packs as cs[res] x R_challenge x T, where cs is the cumulative reward of
// EVERY tier up to the one the player reaches. Those are not instance-shaped, so the card sim cannot
// draw them per instance like the other sources; but they are also not uncertain, because reaching
// the tier is what pays them. This returns one entry per tier that pays packs:
//   [ { tier, day, label, packs:{tierName:count} }, ... ]
// with the landing day placed linearly through the window at the point that tier is reached, so the
// log shows Season Pass packs arriving as the track is climbed rather than all on the final day.
// The sum over entries equals cs x R_challenge x T exactly, so the card sim's total still matches
// the Season Pass row in the gains model.
function spPackTiers_(seg, payer, ctx){
  var out = [];
  // 'A. 0' is the appendix segment: no behaviour telemetry, so nothing can price its reach.
  // packGrantPlan_ already refuses it (zero activity rates -> empty plan) and colRewardRow_ below
  // carries the same guard, but the Season Pass track is not instance-shaped and so slipped past
  // both - it pays every tier up to the one reached, with no reach term to be zero. A. 0 was
  // therefore handed 1-2 Season Pass packs out of an otherwise completely empty season, which is
  // exactly the tier coupling the appendix rules say is not applied to it (CLAUDE.md, D8/section 3).
  if (seg === 'A. 0' || seg === 'A.0') return out;
  if (!ctx || !ctx.calCurOk || !ctx.calNewOk) return out;
  var cur = ctx.calCur['Season Pass'] || [], nw = ctx.calNew['Season Pass'] || [];
  if (!nw.length || !cur.length) return out;
  var base = readSPTrack_('SP');
  if (!base.cum.length) return out;
  var v2Name = spV2Sheet_('SP');
  var v2 = (v2Name === 'SP') ? base : readSPTrack_(v2Name);
  if (!v2.cum.length) v2 = base;
  var daysBase = readSPSeasonDays_('SP') || 33;
  var daysV2 = (v2Name !== 'SP' && readSPSeasonDays_(v2Name)) || daysBase;
  var t = sptTotals_(seg, payer, ctx);
  var Ts = spTier_(t.sim * daysV2 / 33, v2.cum);
  if (!(Ts > 0)) return out;
  var Rlb = spChallengeR_();
  var T = timingRatio_(cur, nw, seg, payer, ctx.ds);
  var win = (typeof DAILY_DAYS !== 'undefined') ? DAILY_DAYS : 33;
  // ONE ENTRY PER TRACK PER TIER (2026-08-25). The two tracks used to be summed into a single
  // entry labelled '(free + paid track)', so every pack a payer earned was logged as
  // 'Season Pass (Free)' and the paid track was invisible in the day-by-day log even though the
  // gains grid showed it as its own row. They are different sources - the paid track is
  // purchase-gated - and a tier that pays on BOTH tracks is exactly the case that has to stay
  // legible, so they are emitted separately and land on the same day rather than being merged.
  // The per-track sums still add to the same cs value, so the card sim's totals continue to
  // reconcile with the Season Pass rows in the gains model.
  var tracks = [{ rows: v2.free, source: 'Season Pass (Free)', what: 'free track' }];
  if (payer === 'PAYER')
    tracks.push({ rows: v2.paid, source: 'Season Pass (Paid)', what: 'paid track' });
  for (var i = 0; i < Ts && i < v2.free.length; i++){
    // D26: the pass keeps its WHOLE reached ladder (the track is climbed during the season), but a
    // tier whose linear landing day falls past the collection season settles on the season's last
    // day — otherwise the card sim would open an envelope with no album left to file it in.
    var day = seasonDay_(Math.max(1, Math.min(win, Math.ceil(win * (i + 1) / Ts))));
    for (var k = 0; k < tracks.length; k++){
      var tr = tracks[k], packs = null, row = tr.rows[i];
      PACK_RES.forEach(function(r){
        var n = num(row && row[r]) * ((Rlb[r] != null) ? Rlb[r] : 1) * T;
        if (n > 0){ packs = packs || {}; packs[r] = n; }
      });
      if (!packs) continue;
      out.push({ tier: i + 1, day: day, packs: packs, source: tr.source,
                 label: 'season pass tier ' + (i + 1) + ' of ' + Ts + ' (' + tr.what + ')' });
    }
  }
  return out;
}

// ============================== COLLECTION SET / ALBUM REWARDS (2026-08-21) ==================
// Two source rows the workbook grew and the engine never produced. Completing a card SET, or a
// whole ALBUM, pays real currency out of the PackConfig SET REWARDS / ALBUM REWARDS blocks - the
// collection feature's own contribution to the faucet, separate from the packs that feed it.
//
// Neither has a measured anchor (data_gains has no such category), so both are priced BOTTOM-UP,
// the same rule the pack lane already follows. The chain is:
//
//   packs        SUM over every source of the six pack columns this segment earns  (= packLane_)
//   cards        SUM_tier packs[tier] x cardsPerOpen[tier]                          (PackConfig)
//   ownership    P(card c owned) = 1 - (1 - w_c)^cards,  w_c = its share of the SNAP POOL
//   set k done   PRODUCT over the cards of set k of P(owned)
//   album done   PRODUCT over EVERY card
//   gains        SUM_k P(set k done) x setReward_k   /   P(album done) x albumReward_1
//
// FLAGGED, and worth knowing before quoting these two rows:
//   - Draws are treated as INDEPENDENT with replacement over the pool. The card sim draws without
//     replacement inside a pack and depletes the pool as it goes, so this slightly UNDERSTATES how
//     fast a collection fills. The pool is ~817 copies against 2-7 cards per pack, so the error is
//     small, but it is one-directional.
//   - It ignores the card sim's chapter weighting, both pity mechanisms and star-chest purchases,
//     all of which pull completion EARLIER. These rows are therefore a floor, not a midpoint.
//   - Album rewards use tier 1 only: the model has no notion of looping into a second album.
// The card sim (menu > Simulate card pack openings) remains the exact, per-run answer; this is the
// closed-form expectation so the gains model can carry the two rows live.
function colRewardRow_(which, seg, payer, ctx){
  if (seg === 'A. 0' || seg === 'A.0') return zeroRow_();   // no behaviour telemetry -> no packs
  var cards = expectedCardsDrawn_(seg, payer, ctx);
  if (!(cards > 0)) return zeroRow_();
  var pool = colPool_();
  if (!pool || !pool.total) return zeroRow_();
  var pOwn = {};
  for (var key in pool.count)
    pOwn[key] = 1 - Math.pow(1 - (pool.count[key] / pool.total), cards);

  var out = zeroRow_();
  if (which === 'sets'){
    for (var sn in pool.bySet){
      var keys = pool.bySet[sn], p = 1;
      for (var i = 0; i < keys.length; i++) p *= num(pOwn[keys[i]]);
      if (!(p > 0)) continue;
      var rew = pool.setRewards['Set ' + sn];
      if (rew) for (var r in rew) out[r] = num(out[r]) + num(rew[r]) * p;
    }
    return out;
  }
  var pa = 1;
  for (var k2 in pOwn) pa *= num(pOwn[k2]);
  var arew = pool.albumReward;
  if (arew && pa > 0) for (var r2 in arew) out[r2] = num(out[r2]) + num(arew[r2]) * pa;
  return out;
}
function simColSets  (seg, payer, ctx){ return colRewardRow_('sets',   seg, payer, ctx); }
function simColAlbums(seg, payer, ctx){ return colRewardRow_('albums', seg, payer, ctx); }

// Total packs this (segment, payer) earns across EVERY source, converted to cards. Mirrors the
// sptTotals_ pattern - summed off resultRow_ so it picks up every lane's pack overlay - with the
// same re-entry guard, because the two collection rows are themselves inside CATEGORY_ORDER.
function expectedCardsDrawn_(seg, payer, ctx){
  ctx._colCards = ctx._colCards || {};
  var key = seg + '|' + payer;
  if (ctx._colCards[key] != null) return ctx._colCards[key];
  if (ctx._colBusy) return 0;                       // re-entry: contribute nothing to our own input
  var packs = zeroRow_();
  ctx._colBusy = true;
  try {
    CATEGORY_ORDER.forEach(function(cat){
      if (cat === 'Col - Sets' || cat === 'Col - Albums') return;
      var row = resultRow_(cat, seg, payer, ctx);
      PACK_RES.forEach(function(r){ packs[r] = num(packs[r]) + num(row[r]); });
    });
  } finally { ctx._colBusy = false; }
  var per = colCardsPerOpen_(), cards = 0;
  PACK_RES.forEach(function(r){ cards += num(packs[r]) * num(per[r]); });
  return (ctx._colCards[key] = cards);
}

// 'N-star Pack' -> cards per open, from the PackConfig PACK DEFINITIONS block.
function colCardsPerOpen_(){
  var v = sheetVals_('PackConfig'), out = {}, start = -1;
  for (var r = 0; r < v.length; r++)
    if (String((v[r] || [])[0]).trim() === 'PACK DEFINITIONS'){ start = r; break; }
  if (start < 0) return out;
  for (var r2 = start + 1; r2 < v.length; r2++){
    var lab = String((v[r2] || [])[0]).trim();
    if (/^[A-Z][A-Z &]{4,}$/.test(lab)) break;                       // next block label
    var m = lab.match(/^(\d+)[-\s]*star/i);
    if (m && num(v[r2][1]) > 0) out[m[1] + '-star Pack'] = Math.round(num(v[r2][1]));
  }
  return out;
}

// The card pool as the gains model needs it: per-card copy counts, the cards of each set, and the
// two reward tables. Rarity names are reconciled positionally, exactly as CardOpenings.gs does, so
// AlbumConfig's '6-star' and PackConfig's 'Gold' remain the same tier here too.
function colPool_(){
  var pv = sheetVals_('PackConfig'), av = sheetVals_('AlbumConfig');
  if (!pv.length || !av.length) return null;
  function block(label){
    var b = -1;
    for (var r = 0; r < pv.length; r++)
      if (String((pv[r] || [])[0]).trim() === label){ b = r; break; }
    if (b < 0) return [];
    var out = [];
    for (var r2 = b + 1; r2 < pv.length; r2++){
      var lab = String((pv[r2] || [])[0]).trim();
      if (/^[A-Z][A-Z &]{4,}$/.test(lab)) break;
      if (lab) out.push(pv[r2]);
    }
    return out;
  }
  var order = [], qty = {};
  block('RARITY DEFINITIONS').forEach(function(row){
    var n = String(row[0]).trim();
    if (n && !isNaN(parseFloat(row[1]))) order.push(n);
  });
  if (!order.length) return null;
  block('SNAP POOL').forEach(function(row){
    var n = String(row[0]).trim();
    if (order.indexOf(n) >= 0 && num(row[1]) > 0) qty[n] = num(row[1]);
  });
  function resolve(raw){
    var t = String(raw == null ? '' : raw).trim();
    if (order.indexOf(t) >= 0) return t;
    var m = t.match(/^(\d+)\s*[-\s]?\s*(?:star|★|\*)?$/i);
    if (m){ var i = Number(m[1]) - 1; if (i >= 0 && i < order.length) return order[i]; }
    return null;
  }
  var byRarity = {}, cards = [];
  for (var r3 = 2; r3 < av.length; r3++){
    var row3 = av[r3];
    if (!row3 || !/^CARD/i.test(String(row3[0]))) continue;
    var rar = resolve(row3[4]);
    if (!rar) continue;
    var c = { key: String(row3[1]) + ' ' + rar, rarity: rar, setNum: Math.round(num(row3[2])) };
    cards.push(c);
    (byRarity[rar] = byRarity[rar] || []).push(c);
  }
  if (!cards.length) return null;
  var count = {}, total = 0, bySet = {};
  for (var rar2 in byRarity){
    var q = num(qty[rar2]);
    if (!(q > 0)) continue;                       // a rarity with no pool stock cannot be drawn
    var list = byRarity[rar2], baseN = Math.floor(q / list.length), rem = q - baseN * list.length;
    list.forEach(function(c2, i){
      count[c2.key] = (i < rem) ? baseN + 1 : baseN;
      total += count[c2.key];
    });
  }
  cards.forEach(function(c3){
    if (count[c3.key] == null) return;            // rarity had no stock -> unreachable, excluded
    (bySet[c3.setNum] = bySet[c3.setNum] || []).push(c3.key);
  });
  // reward tables, mapped onto engine resource names via RES_MAP
  function rewards(label){
    var out = {};
    block(label).forEach(function(row){
      var id = String(row[0]).trim();
      if (!id || isNaN(parseFloat(row[1]))) return;
      var rew = {};
      COL_REWARD_COLS.forEach(function(rc){
        var res = RES_MAP[rc.name];
        if (res && num(row[rc.col]) > 0) rew[res] = num(rew[res]) + num(row[rc.col]);
      });
      out[id] = rew;
    });
    return out;
  }
  var setR = rewards('SET REWARDS'), albR = rewards('ALBUM REWARDS');
  return { count: count, total: total, bySet: bySet, setRewards: setR,
           albumReward: albR['Album 1'] || null };
}
// The 21-column reward block every config sheet shares (Coins .. 6-star Dly), by OFFSET from the
// row's id cell. Mirrors REWARD_COLUMNS in CardOpenings.gs; kept here so the gains engine does not
// depend on the card sim's file being present.
var COL_REWARD_COLS = [
  {col:1,name:'Coins'},{col:2,name:'SPT'},{col:3,name:'SPT x2'},{col:4,name:'Red'},
  {col:5,name:'Chuck'},{col:6,name:'Bomb'},{col:7,name:'Slingshot'},{col:8,name:'Shuffle'},
  {col:9,name:'Comet'},{col:10,name:'Unlimited Lives'},{col:11,name:'Unlimited Red'},
  {col:12,name:'Unlimited Chuck'},{col:13,name:'Unlimited Bomb'},{col:15,name:'Avatar'},
  {col:16,name:'1-star Dly'},{col:17,name:'2-star Dly'},{col:18,name:'3-star Dly'},
  {col:19,name:'4-star Dly'},{col:20,name:'5-star Dly'},{col:21,name:'6-star Dly'}
];

// Per-earner SPT window totals, measured vs simulated, summed over every category (additive-
// projection convention). Cached on ctx: computed once per execution, shared by the SIM and
// DIFF spills. 'Season Pass (Free)' itself contributes measured to BOTH sides (no recursion).
function sptTotals_(seg, payer, ctx){
  ctx._spt = ctx._spt || {};
  var key = seg + '|' + payer;
  if (ctx._spt[key]) return ctx._spt[key];
  var ds = ctx.ds, meas = 0, sim = 0;
  ctx._sptBusy = true;
  try {
    CATEGORY_ORDER.forEach(function(cat){
      // measuredRow_ (not raw ds.gains) so the D18 synthetic Core SPT anchor enters the
      // measured total too — both sides then price the same level-completion faucet.
      var mrow = measuredRow_(cat, seg, payer, ds);
      var mSPT = num(mrow['SPT']), mX2 = num(mrow['SPTx2']);
      meas += mSPT + 2 * mX2;
      // The Season Pass rows and the two collection rows are all priced OFF this total, so they
      // must not be inside it: Free contributes measured on both sides (the original recursion
      // guard) and the other three contribute nothing at all. Without this the tier the player
      // reaches would depend on the rewards that tier itself pays.
      if (cat === 'Season Pass (Free)'){ sim += mSPT + 2 * mX2; return; }
      if (cat === 'Season Pass (Paid)' || cat === 'Col - Sets' || cat === 'Col - Albums') return;
      var row = resultRow_(cat, seg, payer, ctx);
      sim += num(row['SPT']) + 2 * num(row['SPTx2']);
    });
  } finally { ctx._sptBusy = false; }
  return (ctx._spt[key] = { meas: meas, sim: sim });
}

// '<base>_v2' when that sheet exists and is non-empty, else the base sheet (ratios degrade to 1).
function spV2Sheet_(base){
  var v2 = base + '_v2';
  return sheetVals_(v2).length ? v2 : base;
}

// SP / SP_v2 track: header = the row whose col C is 'Cumul' (Tier | Incr real | Cumul | D..W FREE |
// X..AQ PAID); tier rows below it until Cumul stops being numeric (the 'Total' row has Cumul = NA).
// The header is LOCATED, not fixed at row 4 — a config panel prepended above the ladder (D17: the
// 'Season Length (days)' + level-difficulty block) shifts every ladder row down, and a fixed offset
// would then read the panel as an empty ladder (tier 0 -> Season Pass silently carried). Column
// layout is stable, so the reward-column offsets (D..W free, X..AQ paid) stay fixed. The two tracks
// repeat the same reward headers ('Coins', 'SPT', ...), so each range maps through rewCols_
// separately — a single whole-row scan would collapse them onto the first (free) match.
// 0-based column where the SP header's reward names start repeating = the first PAID column.
// Scans right from the free block's first reward column (3) for the first header that has already
// been seen; that is where the second track begins. Returns the historic 23 when nothing repeats,
// so a sheet with only a free track keeps its old behaviour.
function spPaidStart_(v, hdr){
  var row = v[hdr] || [], seen = {};
  for (var c = 3; c < row.length; c++){
    var name = String(row[c] == null ? '' : row[c]).trim();
    if (!name) continue;
    if (seen[name]) return c;
    seen[name] = true;
  }
  return 23;
}

function readSPTrack_(sheetName){
  var v = sheetVals_(sheetName);
  var out = { cum: [], free: [], paid: [] };
  if (!v.length) return out;
  var hdr = -1;
  for (var i = 0; i < v.length; i++)
    if (String((v[i] || [])[2]).trim().toLowerCase() === 'cumul'){ hdr = i; break; }
  if (hdr < 0) return out;                                  // no ladder found -> caller carries
  // The two tracks repeat the same reward headers, so the split is found by locating where the
  // header run STARTS OVER rather than by pinning D..W / X..AQ. Retiring a pack tier means
  // deleting a reward column, which slides the paid block one to the left; with fixed ranges the
  // paid track then loses its first column ('Coins') to the free range and silently reads 0 -
  // a whole track's coin payout gone with no error anywhere. Falls back to the historic
  // 3..22 / 23..42 offsets if the headers never repeat (single-track sheet).
  var split = spPaidStart_(v, hdr);
  var fCols = rewCols_(v, hdr, 3, split - 1), pCols = rewCols_(v, hdr, split, v[hdr].length - 1);
  for (var r = hdr + 1; r < v.length; r++){
    var c = num(v[r] && v[r][2]);
    if (!(c > 0)) break;
    out.cum.push(c);
    out.free.push(rewRow_(v, r, fCols));
    out.paid.push(rewRow_(v, r, pCols));
  }
  return out;
}

// value in the cell to the RIGHT of an exact (case-insensitive) label anywhere on the sheet;
// null if the label is absent, '' if it exists but the neighbour is blank. Label-scan (not a
// fixed cell) = placement-independent, so the SP config panel can sit anywhere — including on
// top of the tier-ladder's unused Tier/Incr columns (A:B), which the ladder reader ignores.
function readSPLabel_(sheetName, label){
  var v = sheetVals_(sheetName), want = String(label).trim().toLowerCase();
  for (var r = 0; r < v.length; r++){
    var row = v[r] || [];
    for (var c = 0; c < row.length; c++){
      if (String(row[c]).trim().toLowerCase() === want) return (row[c + 1] == null ? '' : row[c + 1]);
    }
  }
  return null;
}
// the TWO cells right of a label: [neighbour, neighbour+1] — the SP difficulty panel keeps the
// 2nd-half reward in the first and the 1st-half reward in the second (D18). null = label absent.
function readSPLabelPair_(sheetName, label){
  var v = sheetVals_(sheetName), want = String(label).trim().toLowerCase();
  for (var r = 0; r < v.length; r++){
    var row = v[r] || [];
    for (var c = 0; c < row.length; c++){
      if (String(row[c]).trim().toLowerCase() === want)
        return [row[c + 1] == null ? '' : row[c + 1], row[c + 2] == null ? '' : row[c + 2]];
    }
  }
  return null;
}
// 'Season Length (days)' config value; absent -> 0 (caller defaults to 33).
function readSPSeasonDays_(sheetName){ return num(readSPLabel_(sheetName, 'Season Length (days)')); }

// ---- Core SPT (D17/D18): expected SPT per level completion, priced off the SP / SP_v2 panel --
// Level completions pay a difficulty-tiered SPT reward (Normal/Hard/Extreme) under a fixed mix.
//   R_SPT = E_v2 / E_base,  E = Σ_d mix_d x reward_d
// reward_d: each difficulty label row carries TWO cells — [2nd-half reward, 1st-half reward]
// (the '1st season half' header sits beside the 'Season Length (days)' value) — averaged 50/50
// (D18, flagged: assumes equal-length halves and uniform play across the season). A panel
// without the 1st-half column prices off the single cell (pre-D18 layout keeps working).
// mix_d (an ASSUMPTION — not measured) from the '<Difficulty> (%)' cell, else the fallback
// constant below. Mix is a single SHARED set (read from the base SP sheet, applied to both
// sides — not a per-side lever, per the design call); tweak it here or in the panel. Uniform
// across segments/payers -> one scalar, cached on ctx.
// Base E=0 (panel absent) -> R=1 (Core carried, exactly as before the panel exists).
var CORE_SPT_MIX = { 'Normal': 0.55, 'Hard': 0.30, 'Extreme': 0.15 };   // fallback if panel omits '(%)' cells
var CORE_SPT_DIFFICULTIES = ['Normal', 'Hard', 'Extreme'];

function coreSptR_(ctx){
  if (ctx && ctx._coreSptR != null) return ctx._coreSptR;
  var mix = coreSptMix_('SP');
  var eBase = coreSptE_('SP', mix);
  var v2 = spV2Sheet_('SP');
  var eV2 = (v2 === 'SP') ? eBase : coreSptE_(v2, mix);
  var R = (eBase > 1e-9) ? eV2 / eBase : 1;
  if (ctx) ctx._coreSptR = R;
  return R;
}
// expected SPT per level completion on a given SP sheet: Σ mix_d x mean(2nd-half, 1st-half
// reward) — the per-difficulty halves average (D18); single-cell panels use that cell alone.
function coreSptE_(sheetName, mix){
  var E = 0;
  CORE_SPT_DIFFICULTIES.forEach(function(d){
    var pair = readSPLabelPair_(sheetName, d);
    if (!pair) return;
    var h2 = pair[0], h1 = pair[1];
    var has1 = (h1 != null && h1 !== '' && !isNaN(parseFloat(h1)));
    E += num(mix[d]) * (has1 ? (num(h2) + num(h1)) / 2 : num(h2));
  });
  return E;
}

// D18 (2026-07-30, user decision): SYNTHETIC Core SPT anchor. data_gains carries NO Core SPT
// rows (the level-completion token faucet is invisible to the export), so the measured side is
// built bottom-up from behaviour telemetry:
//   L    = levels_completed_per_active_day (data_seg_beh) x Σ p_day over the 33-day window
//   meas = L x E_base (SP panel, halves-averaged)   ->   sim = meas x R_SPT = L x E_v2
// (same L on both sides — behaviour held constant; only the per-level pricing moves.)
// Missing behaviour row or E_base = 0 (no panel) -> null (Core SPT stays carried at raw data).
function coreSptSynth_(seg, payer, ds){
  var b = ds.beh(seg, payer);
  var lvl = num(b.levels_completed_per_active_day);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(lvl > 0) || (pWd <= 0 && pWe <= 0)) return null;
  var eBase = coreSptE_('SP', coreSptMix_('SP'));
  if (!(eBase > 1e-9)) return null;
  var days = 0;                                   // expected active days over the 33-day window
  for (var d = 1; d <= 33; d++) days += isWeekend_(d) ? pWe : pWd;
  var L = lvl * days;
  return { meas: L * eBase, L: L };
}
// difficulty mix from the '<Difficulty> (%)' cells; any missing -> the fallback constant.
function coreSptMix_(sheetName){
  var mix = {};
  CORE_SPT_DIFFICULTIES.forEach(function(d){
    var raw = readSPLabel_(sheetName, d + ' (%)');
    mix[d] = (raw == null || raw === '') ? CORE_SPT_MIX[d] : num(raw);
  });
  return mix;
}

// Highest 1-based tier whose cumulative points requirement is met; 0 below tier 1, capped at
// the ladder length (a maxed track gains nothing from extra SPT).
function spTier_(points, cum){
  var t = 0;
  for (var i = 0; i < cum.length; i++){ if (cum[i] <= points) t = i + 1; else break; }
  return t;
}

// Σ tier rewards 1..T per resource. FREE track only for NONPAYER; FREE+PAID for PAYER.
function spCumTo_(track, T, payer){
  var out = zeroRow_();
  for (var i = 0; i < T && i < track.free.length; i++){
    var f = track.free[i], p = track.paid[i], r;
    for (r in f) out[r] = num(out[r]) + f[r];
    if (payer === 'PAYER' && p) for (r in p) out[r] = num(out[r]) + p[r];
  }
  return out;
}

// Season Pass Challenge reward-config ratio: SP_lb_v2 / SP_lb rank-ladder POT totals per
// resource (zero-sum league, Kite-style — no Dream Pass position telemetry to price at).
// Base pot 0 -> R = 1 (no anchor -> carry; v2-only additions are flagged in the docs).
function spChallengeR_(){
  var v2Name = spV2Sheet_('SP_lb'), R = {};
  if (v2Name === 'SP_lb') return R;                    // no v2 sheet -> all ratios 1
  var b = readSPLbLadder_('SP_lb'), v = readSPLbLadder_(v2Name);
  RESOURCES.forEach(function(r){
    if (num(b[r]) > 1e-9) R[r] = num(v[r]) / num(b[r]);
  });
  return R;
}

// SP_lb / SP_lb_v2: headers row 6 (0-based 5: Rank | Coins | SPT | ...), rank rows 7+ until the
// first blank Rank cell. Returns the per-resource pot (Σ over ranks) via RES_MAP columns.
function readSPLbLadder_(sheetName){
  var v = sheetVals_(sheetName), pot = zeroRow_();
  if (!v.length) return pot;
  var cols = rewCols_(v, 5, 1, 21);
  for (var r = 6; r < v.length; r++){
    if (!v[r] || v[r][0] == null || String(v[r][0]).trim() === '') break;
    var rew = rewRow_(v, r, cols);
    for (var res in rew) pot[res] = num(pot[res]) + rew[res];
  }
  return pot;
}

// ============================== SHARED MATH ==================================================
// T = Σ_new reach / Σ_cur reach. Both 0 (no rate data) -> 1 (fail-safe: carry, don't zero).
function timingRatio_(cur, nw, seg, payer, ds){
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  var sc = reachSum_(cur, pWd, pWe), sn = reachSum_(nw, pWd, pWe);
  if (sc <= 0 && sn <= 0) return 1;
  return sc > 0 ? sn/sc : 1;
}
function reachSum_(list, pWd, pWe){
  var s = 0;
  (list || []).forEach(function(inst){ s += reachOne_(inst, pWd, pWe); });
  return s;
}
function reachOne_(inst, pWd, pWe){
  if (!inst || !inst.days || !inst.days.length) return 0;
  var q = 1;
  inst.days.forEach(function(d){ q *= (1 - (isWeekend_(d) ? pWe : pWd)); });
  return 1 - q;
}
function isWeekend_(day){ var m = (day-1) % 7; return m === 2 || m === 3 || m === 4; } // Fri/Sat/Sun

function modalDur_(list){
  if (!list || !list.length) return 0;
  var c = {}; list.forEach(function(x){ c[x.dur] = (c[x.dur]||0) + 1; });
  var best = 0, bc = -1;
  for (var d in c) if (c[d] > bc){ bc = c[d]; best = +d; }
  return best;
}

// D = curveShare(newDur) / curveShare(curDur) — normalised at the CURRENT duration.
// Lengthening past the observed range: marginal-slope extrapolation capped at proportional.
function accrualD_(ds, ev, curDur, newDur, seg, payer, kite){
  var curve = ds.accrualCurve(ev, seg, payer, kite);
  if (!curve.length) return 1;
  var maxDay = curve[curve.length-1].day, maxShare = curve[curve.length-1].share || 1;
  function raw(d){
    if (d <= 0) return 0;
    if (d >= maxDay){
      var prev = curve.length > 1 ? curve[curve.length-2] : {day:0, share:0};
      var marg = (maxShare - prev.share) / Math.max(1, maxDay - prev.day);
      return Math.min(maxShare + (d - maxDay)*marg, maxShare * d/maxDay);
    }
    for (var i = 1; i < curve.length; i++){
      if (d <= curve[i].day){
        var a = curve[i-1], c = curve[i];
        return a.share + (c.share - a.share) * (d - a.day) / Math.max(1e-9, c.day - a.day);
      }
    }
    return maxShare;
  }
  var base = raw(curDur);
  return base > 0 ? raw(newDur)/base : 1;
}

// Survival S(x) = 1 - CDF(x); CDF piecewise-linear through (0,0) + the given (x, p) points,
// linear tail beyond the last point at the preceding slope, capped at 1. Shared by
// Rainbow Maker (p10..p90), Night Sky (daily-max-streak) and Daily Gift (login-streak weights).
function survival_(points){
  var pts = [[0,0]];
  points.forEach(function(p){ if (p[0] > pts[pts.length-1][0]) pts.push(p); });
  if (pts.length < 2 || !(pts[pts.length-1][0] > 0)) return null;   // no usable distribution
  var la = pts[pts.length-2], lb = pts[pts.length-1];
  var tail = (lb[1] - la[1]) / Math.max(1e-9, lb[0] - la[0]);
  function cdf(x){
    if (x <= 0) return 0;
    for (var i = 1; i < pts.length; i++){
      if (x <= pts[i][0]){
        var a = pts[i-1], b = pts[i];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / Math.max(1e-9, b[0] - a[0]);
      }
    }
    return Math.min(1, lb[1] + (x - lb[0]) * tail);
  }
  return function(x){ return Math.max(0, 1 - cdf(x)); };
}

// ============================== CONTEXT / DATA STORE =========================================
var Context = (function(){
  var _c = null;
  return { get: function(){
    if (_c) return _c;
    var calCur = sanitizeCal_(parseCalendarInstances_(CAL_CUR));
    var calNew = sanitizeCal_(parseCalendarInstances_(CAL_NEW));
    _c = { ds: DataStore.get(), calCur: calCur, calNew: calNew,
           calCurOk: hasKeys_(calCur), calNewOk: hasKeys_(calNew) };
    return _c;
  }};
})();

// Defensive: Apps Script files share ONE global namespace, so another project file defining
// parseCalendarInstances_ (e.g. a test harness returning {start, end, dur} without a days list)
// silently overrides ours. Normalize whatever shape comes back so every instance has
// {start, dur, days[]}; a missing days array would otherwise zero every reach / crash the
// daily allocator.
function sanitizeCal_(cal){
  for (var ev in cal){
    cal[ev] = (cal[ev] || []).map(function(x){
      if (x && x.days && x.days.length) return x;
      var dur = Math.max(1, num(x && x.dur));
      var start = (x && x.start != null) ? num(x.start)
                : (x && x.end   != null) ? num(x.end) - dur + 1 : 1;
      return mkInst_(start, dur);
    });
  }
  return cal;
}

var DataStore = (function(){
  var _cache = null;
  function build(gainsVals, behVals, accVals, kiteVals, rmVals, streaksVals, instVals){
    var gh = headerIndex_(gainsVals[0] || []), gMap = {};
    for (var i = 1; i < gainsVals.length; i++){ var r = gainsVals[i];
      if (!r[gh['engagement_segment']]) continue;
      gMap[[r[gh['engagement_segment']], r[gh['payer_flag']], r[gh['category']], r[gh['resource']]].join('|')]
        = num(r[gh['amount_per_earner']]); }
    var bh = headerIndex_(behVals[0] || []), bMap = {};
    for (var j = 1; j < behVals.length; j++){ var b = behVals[j];
      if (!b[bh['segment']]) continue;
      var o = {}; for (var nm in bh) o[nm] = b[bh[nm]];
      bMap[[b[bh['segment']], b[bh['payer_flag']]].join('|')] = o; }
    function accIndex(vals){
      if (!vals || !vals.length) return {};
      var h = headerIndex_(vals[0]), m = {};
      for (var k = 1; k < vals.length; k++){ var r = vals[k], ev = r[h['event_name']];
        if (!ev) continue;
        var key = [ev, r[h['payer_flag']], r[h['segment']]].join('|');
        (m[key] = m[key] || []).push({day: num(r[h['event_day']]), share: num(r[h['cum_token_share_p50']])}); }
      for (var kk in m) m[kk].sort(function(a,b){ return a.day - b.day; });
      return m; }
    var aMap = accIndex(accVals), kMap = accIndex(kiteVals);
    var rh = headerIndex_(rmVals[0] || []), rMap = {};
    for (var q = 1; q < rmVals.length; q++){ var w = rmVals[q];
      if (!w[rh['segment']]) continue;
      rMap[[w[rh['segment']], w[rh['payer_flag']]].join('|')] = {
        p10: num(w[rh['p10_matchables_window']]), p25: num(w[rh['p25_matchables_window']]),
        p50: num(w[rh['p50_matchables_window']]), p75: num(w[rh['p75_matchables_window']]),
        p90: num(w[rh['p90_matchables_window']]) }; }
    var th = headerIndex_((streaksVals || [])[0] || []), tMap = {};
    for (var t = 1; t < (streaksVals || []).length; t++){ var s = streaksVals[t];
      if (!s[th['segment']]) continue;
      tMap[[s[th['segment']], s[th['payer_flag']]].join('|')] = {
        p25: num(s[th['max_streak_per_day_p25']]), p50: num(s[th['max_streak_per_day_p50']]),
        p75: num(s[th['max_streak_per_day_p75']]), p90: num(s[th['max_streak_per_day_p90']]) }; }
    var eh = headerIndex_((instVals || [])[0] || []), eMap = {};
    for (var e = 1; e < (instVals || []).length; e++){ var x = instVals[e];
      if (!x[eh['event_name']]) continue;
      var eo = {}; for (var en in eh) eo[en] = x[eh[en]];
      eMap[[x[eh['event_name']], x[eh['segment']], x[eh['payer_flag']]].join('|')] = eo; }
    return {
      gains: function(seg, payer, cat, res){ return num(gMap[[SEG_TO_GAINS[seg]||seg, payer, cat, res].join('|')]); },
      dataRow: function(cat, seg, payer){ var o = {}, self = this;
        RESOURCES.forEach(function(r){ o[r] = self.gains(seg, payer, cat, r); }); return o; },
      beh: function(seg, payer){ return bMap[[seg, payer].join('|')] || {}; },
      nsStreak: function(seg, payer){ return tMap[[seg, payer].join('|')] || null; },
      eventInst: function(ev, seg, payer){ return eMap[[ev, seg, payer].join('|')] || null; },
      rmPct: function(seg, payer){ return rMap[[seg, payer].join('|')] || null; },
      accrualCurve: function(ev, seg, payer, kite){ var m = kite ? kMap : aMap;
        return m[[ev, payer, seg].join('|')] || m[[ev, payer, '0-9'].join('|')] || []; }
    };
  }
  return {
    get: function(){
      if (_cache) return _cache;
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      _cache = build(vals_(ss,'data_gains'), vals_(ss,'data_seg_beh'), vals_(ss,'data_event_accrual'),
                     vals_(ss,'data_event_kite_accrual'), vals_(ss,'data_RM'), vals_(ss,'data_streaks'),
                     vals_(ss,'data_event_inst'));
      return _cache;
    },
    fromRanges: function(g,b,a,k,rm,st,ei){ return build(g,b,a,k,rm,st,ei); }
  };
  function vals_(ss, name){ var sh = ss.getSheetByName(name); return sh ? sh.getDataRange().getValues() : []; }
})();

// ============================== CALENDAR READER ==============================================
// Verified rule: merged range = ONE instance (duration = column width); filled non-merged cell
// = ONE 1-day instance; neighbours never collapsed; day = column - 1 (B = day 1 .. AH = day 33).
var CAL_FIRST_ROW = 5, CAL_LAST_ROW = 25, CAL_FIRST_COL = 2, CAL_LAST_COL = 34;   // grid B5:AH25
var CAL_ALIAS = { 'Mystery Puzzle':'Jigsaw Puzzle', 'Mystery Box':'Jigsaw Puzzle',
                  "Chuck's Flash Race":'Flash Race' };
var CAL_PARSED_SHEET = 'cal_parsed';

// Engine entry point: prefer the precomputed hidden sheet (values — always readable in the
// custom-function context); fall back to live merge parsing.
function parseCalendarInstances_(sheetName){
  var pre = readPrecomputedCal_(sheetName);
  if (pre) return pre;
  return parseCalendarLive_(sheetName);
}

function parseCalendarLive_(sheetName){
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh) return {};
  var rng = sh.getRange(CAL_FIRST_ROW, CAL_FIRST_COL,
                        CAL_LAST_ROW - CAL_FIRST_ROW + 1, CAL_LAST_COL - CAL_FIRST_COL + 1);
  var vals = rng.getValues(), merges = [];
  try { merges = rng.getMergedRanges() || []; } catch(e){ merges = []; }
  var inst = {}, covered = {};
  function add(name, c1, c2){
    name = calNorm_(name);
    (inst[name] = inst[name] || []).push(mkInst_(c1 - 1, c2 - c1 + 1));   // day = col - 1
  }
  merges.forEach(function(m){
    var r1 = m.getRow(), c1 = m.getColumn(), nc = m.getNumColumns(), nr = m.getNumRows(), c2 = c1 + nc - 1;
    var v = vals[r1 - CAL_FIRST_ROW][c1 - CAL_FIRST_COL];
    if (v !== '' && v != null && String(v).trim() !== '') add(v, c1, c2);
    for (var r = r1; r < r1 + nr; r++) for (var c = c1; c <= c2; c++) covered[r + ',' + c] = true;
  });
  for (var i = 0; i < vals.length; i++) for (var j = 0; j < vals[i].length; j++){
    var r = CAL_FIRST_ROW + i, c = CAL_FIRST_COL + j, v = vals[i][j];
    if (covered[r + ',' + c]) continue;
    if (v !== '' && v != null && String(v).trim() !== '') add(v, c, c);
  }
  return inst;
}
function calNorm_(v){ var s = String(v).replace(/\n/g, ' ').trim(); return CAL_ALIAS[s] || s; }
function mkInst_(start, dur){
  var days = []; for (var d = start; d < start + dur; d++) days.push(d);
  return { start: start, dur: dur, days: days };
}

// ---- menu-precompute (the robust fix for custom-function merge reading) ----
function onOpen(){
  SpreadsheetApp.getUi().createMenu('EcoGainsSim')
    .addItem('Precompute calendars', 'precomputeCalendars')
    .addItem('Clear calendar precompute', 'clearCalendarPrecompute')
    .addItem('Refresh simulations', 'refreshSims_')
    .addItem('Fill Sim per Segment', 'fillSimPerSegment')   // SimPerSegmentFill.gs
    .addSeparator()
    .addItem('Simulate card pack openings', 'SimulatePackOpenings')   // CardOpenings.gs
    .addItem('Simulate card cloud (all segments)', 'SimulateCardCloud')   // CardOpenings.gs
    .addSeparator()
    .addItem('Mark v2 config diffs (red)', 'markV2ConfigDiffs')   // V2Diff.gs
    .addItem('Clear v2 config diff marks', 'clearV2ConfigDiffs')  // V2Diff.gs
    .addToUi();
}
// NOTE: this is the project's ONLY onOpen. All .gs files in an Apps Script project share one
// global namespace, so a second onOpen() in another file silently overrides this one and the
// menu disappears (CardOpenings.gs used to define its own 'Sim' menu — removed 2026-08-03, D19).
// Add menu items here; never declare onOpen anywhere else.

// ---- auto-refresh (AUTO_REFRESH switch) ----
// Every sheet the engine reads; a user edit on any of them re-touches the sim formulas.
var REFRESH_WATCH = ['c_saga','c_saga_v2','c_day','c_day_v2','RM','RM_1st','RM_2nd','RM_1st_v2','RM_2nd_v2','NS','NS_v2','NS_v2_weekday','Race','Race_v2',
  'J','J_v2','HH','HH_v2','BB','BB_v2','Ki','Ki_v2','Ph','Ph_v2','TaD','TaD_v2','RR','RR_v2',
  'F','F_v2','TE','SP','SP_v2','SP_lb','SP_lb_v2','cal_curr','cal_new',CAL_PARSED_SHEET,   // TE: D19 pack lane
  'data_gains','data_seg_beh','data_event_accrual','data_event_kite_accrual','data_RM',
  'data_streaks','data_event_inst',
  // NET inputs: data_econ_daily feeds ECOGAINS_DAILY's NET blocks (live custom function);
  // data_econ only feeds the menu-run Sim per Segment fill — watching it is harmless, but an edit
  // there still needs menu > Fill Sim per Segment to re-run.
  'data_econ','data_econ_daily',
  // ToF reads its own config sheet, the coin-price table and the wallet percentiles; an edit to
  // any of them has to re-run the spill like any other config edit.
  'ToF','MD','item_vals'];

// Simple trigger: fires on every USER edit (programmatic edits don't re-trigger it).
function onEdit(e){
  if (!AUTO_REFRESH) return;
  try {
    var name = e && e.range ? e.range.getSheet().getName() : null;
    if (name && REFRESH_WATCH.indexOf(name) === -1) return;
    refreshSims_();
  } catch(err){}
}

// Forces regeneration WITHOUT ever clearing a formula (Google only re-runs a custom function
// when its ARGUMENTS change): every ECOGAINS_* call carries a trailing "nonce" argument that
// references sim_refresh!$A$1 (a hidden one-cell sheet), and refreshSims_ just writes a new
// timestamp there — ONE atomic write, every sim formula re-runs, nothing to restore.
//
// WHY (history of the disappearing formulas): the old refresh cleared every ECOGAINS_ formula,
// flushed, then restored. onEdit is a SIMPLE trigger with a ~30s hard kill that does NOT run
// `finally` blocks, and partially-committed writes survive the kill — so a kill mid-restore left
// some or all formulas blank (the classic signature: EcoGainsSim_Daily kept D9 but lost
// everything from P9 right; cal_new lost E38). The nonce model has NO cleared state to lose:
// a kill at any point leaves every formula intact.
//
// Self-maintenance in the scan below:
//   - MIGRATION: any ECOGAINS_ formula still missing the nonce ref is rewritten once with it
//     appended (the rewrite itself forces that cell to re-run). Freshly imported display sheets
//     or hand-retyped formulas are picked up automatically.
//   - #REF REPAIR: if sim_refresh was ever deleted, refs decay to '#REF!$A$1' — they're mapped
//     back to the recreated sheet.
//   - MANIFEST HEAL: every scan snapshots the sim formulas (document properties); a formula that
//     is later found MISSING (cell has no formula and no value) is put back from the snapshot.
//     Deliberately deleting an anchor therefore un-deletes on the next refresh — that's wanted
//     (the anchors are the product); after RESTRUCTURING a sheet, run one refresh so the
//     snapshot follows the new layout before relying on it.
// cal_new: ECOGAINS_CAL_COUNTS (CalStats.gs). 'EcoGainsSim_HC_7d': the windowed view
// (EcoGainsSim_7Day.gs) — listed pre-emptively; refreshSims_ skips names that don't exist.
var REFRESH_SHEETS = [SHEET, 'EcoGainsSim_Daily', 'EcoGainsSim_HC_7d', 'cal_new'];
var SIM_NONCE_SHEET = 'sim_refresh';
var SIM_NONCE_REF = SIM_NONCE_SHEET + '!$A$1';

/** Append the nonce ref as a last argument of the ECOGAINS_* call (quote-aware paren match). */
function withNonce_(f){
  if (f.indexOf('#REF!$A$1') !== -1) f = f.split('#REF!$A$1').join(SIM_NONCE_REF); // sheet was deleted+recreated
  if (f.indexOf(SIM_NONCE_REF) !== -1) return f;
  var m = /ECOGAINS_[A-Z_]+\s*\(/.exec(f);
  if (!m) return f;
  var open = m.index + m[0].length - 1, depth = 0, inStr = false;
  for (var i = open; i < f.length; i++){
    var ch = f.charAt(i);
    if (inStr){ if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '(') depth++;
    else if (ch === ')'){
      if (--depth === 0){
        var noArgs = f.slice(open + 1, i).replace(/\s/g, '') === '';
        return f.slice(0, i) + (noArgs ? '' : ', ') + SIM_NONCE_REF + f.slice(i);
      }
    }
  }
  return f; // unbalanced (shouldn't happen) — leave untouched
}

function refreshSims_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(100)) return;                 // another refresh is already running
  try {
    // the nonce sheet must exist BEFORE any formula references it
    var ns = ss.getSheetByName(SIM_NONCE_SHEET);
    if (!ns){
      ns = ss.insertSheet(SIM_NONCE_SHEET);
      ns.getRange('B1').setValue('refresh nonce, bumped by refreshSims_ so ECOGAINS_* re-run. Do not delete this sheet.');
      try { ns.hideSheet(); } catch(e){}
    }

    var props = PropertiesService.getDocumentProperties();
    REFRESH_SHEETS.forEach(function(name){
      var sh = ss.getSheetByName(name);
      if (!sh) return;
      var grid = sh.getDataRange().getFormulas();
      var live = {};                                            // "r,c" -> formula
      for (var r = 0; r < grid.length; r++)
        for (var c = 0; c < grid[r].length; c++)
          if (grid[r][c] && grid[r][c].indexOf('ECOGAINS_') !== -1)
            live[(r + 1) + ',' + (c + 1)] = grid[r][c];

      // MANIFEST HEAL: restore snapshot formulas that went missing (empty cell only —
      // never overwrite a value someone typed or a spill that moved in)
      var key = 'simFormulas.' + name, storedRaw = props.getProperty(key);
      if (storedRaw){
        JSON.parse(storedRaw).forEach(function(t){              // t = [row, col, formula]
          var id = t[0] + ',' + t[1];
          if (live[id]) return;
          var rng = sh.getRange(t[0], t[1]);
          if (rng.getFormula() === '' && rng.getValue() === ''){
            live[id] = withNonce_(t[2]);
            rng.setFormula(live[id]);
          }
        });
      }

      // MIGRATION: ensure every sim formula carries the nonce argument
      Object.keys(live).forEach(function(id){
        var f2 = withNonce_(live[id]);
        if (f2 !== live[id]){
          var rc = id.split(',');
          sh.getRange(Number(rc[0]), Number(rc[1])).setFormula(f2);
          live[id] = f2;
        }
      });

      // snapshot for the next heal
      props.setProperty(key, JSON.stringify(Object.keys(live).map(function(id){
        var rc = id.split(',');
        return [Number(rc[0]), Number(rc[1]), live[id]];
      })));
    });

    // the actual refresh: one atomic write — every formula's nonce argument changes
    ns.getRange('A1').setValue(new Date());
  } finally {
    lock.releaseLock();
  }
}
function precomputeCalendars(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = [['calendar','event','start','dur']];
  [CAL_CUR, CAL_NEW].forEach(function(cal){
    var inst = parseCalendarLive_(cal);
    Object.keys(inst).forEach(function(ev){
      inst[ev].forEach(function(x){ rows.push([cal, ev, x.start, x.dur]); });
    });
  });
  var sh = ss.getSheetByName(CAL_PARSED_SHEET) || ss.insertSheet(CAL_PARSED_SHEET);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  try { sh.hideSheet(); } catch(e){}
  if (AUTO_REFRESH) refreshSims_();   // merge edits don't fire onEdit — refresh here instead
}
function clearCalendarPrecompute(){
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(CAL_PARSED_SHEET);
  if (sh) ss.deleteSheet(sh);
}
function readPrecomputedCal_(calName){
  var v = sheetVals_(CAL_PARSED_SHEET);
  if (!v || v.length < 2) return null;
  var h = headerIndex_(v[0]), inst = {}, found = false;
  for (var i = 1; i < v.length; i++){
    if (String(v[i][h['calendar']]) !== calName) continue;
    found = true;
    var ev = String(v[i][h['event']]);
    (inst[ev] = inst[ev] || []).push(mkInst_(num(v[i][h['start']]), num(v[i][h['dur']])));
  }
  return found ? inst : null;
}

// ============================== CONFIG READERS ===============================================
// Header-driven saga ladder reader (workbook (15) layout change, 2026-08-13: each per-segment
// block gained a RewardChestId column between 'Levels Req' and 'HC Reward', and the BASE sheet
// is now segmented like the v2 sheet). Finds the header row ('Node' + 'Levels Req'), picks the
// block whose segment label (row above the header) matches seg — first block when no label
// matches (the old single-ladder base layout) — and pairs that block's 'Levels Req' with the
// next 'HC Reward' to its right, so pair and triple layouts both parse. The old fixed-column
// readers silently read chest IDs as HC on the (15) sheets (Saga R exploded to x7-10).
function readSagaLadder_(sheetName, seg){
  var v = sheetVals_(sheetName);
  if (!v) return null;
  var hr = -1;
  for (var r = 0; r < v.length; r++){
    var row = v[r] || [], hasNode = false, hasReq = false;
    for (var i = 0; i < row.length; i++){
      var s = String(row[i] == null ? '' : row[i]).trim();
      if (s === 'Node') hasNode = true;
      if (s === 'Levels Req') hasReq = true;
    }
    if (hasNode && hasReq){ hr = r; break; }
  }
  if (hr < 0) return null;
  var hdr = v[hr] || [], above = v[hr - 1] || [];
  var reqCols = [];
  for (var c = 0; c < hdr.length; c++)
    if (String(hdr[c] == null ? '' : hdr[c]).trim() === 'Levels Req') reqCols.push(c);
  var pick = null;
  if (seg != null){
    for (var k = 0; k < reqCols.length; k++){
      var lbl = String(above[reqCols[k]] == null ? '' : above[reqCols[k]]).trim() ||
                String(above[reqCols[k] - 1] == null ? '' : above[reqCols[k] - 1]).trim();
      if (lbl === seg){ pick = reqCols[k]; break; }
    }
  }
  if (pick == null) pick = reqCols[0];
  var hcCol = -1;
  for (var c2 = pick + 1; c2 < hdr.length; c2++){
    var s2 = String(hdr[c2] == null ? '' : hdr[c2]).trim();
    if (s2 === 'HC Reward'){ hcCol = c2; break; }
    if (s2 === 'Levels Req') break;                // ran into the next segment block
  }
  if (hcCol < 0) return null;
  var out = [];
  for (var r2 = hr + 1; r2 < v.length; r2++){
    var row2 = v[r2];
    if (!row2 || row2[0] == null || row2[0] === '' || isNaN(parseFloat(row2[0]))) break;
    out.push([num(row2[pick]), num(row2[hcCol])]);
  }
  return out.length ? out : null;
}
function readSagaBase_(seg){ return readSagaLadder_('c_saga', seg); }
function readSagaV2_(seg){ return readSagaLadder_('c_saga_v2', seg); }
function sagaCycleAvg_(l){
  if (!l || !l.length) return null;
  var hc = 0, lv = 0; l.forEach(function(n){ lv += n[0]; hc += n[1]; });
  return lv > 0 ? hc/lv : null;
}
// Per-level item totals from a saga config sheet's per-node item columns. Finds the header row
// (contains both 'Node' and 'Levels Req'), maps item columns via RES_MAP (HC excluded — the HC
// ratio is per-segment via readSagaBase_/readSagaV2_), reads node rows until the first blank.
// Returns {resource: totalItems / totalLevels}.
function readSagaItems_(sheetName){
  var v = sheetVals_(sheetName), hr = -1, h = {};
  for (var r = 0; r < v.length; r++){
    var idx = {};
    (v[r] || []).forEach(function(x, i){ if (x != null && x !== '') idx[String(x).trim()] = i; });
    if (idx['Node'] != null && idx['Levels Req'] != null){ hr = r; h = idx; break; }
  }
  if (hr < 0) return {};
  var cols = {};                                   // resource -> column (first match wins)
  for (var name in RES_MAP){
    var res = RES_MAP[name];
    if (res === 'HC') continue;
    if (h[name] != null && cols[res] == null) cols[res] = h[name];
  }
  var out = {}, lv = 0;
  for (var res2 in cols) out[res2] = 0;
  for (var r2 = hr + 1; r2 < v.length; r2++){
    var row = v[r2];
    if (!row || row[0] == null || row[0] === '' || isNaN(parseFloat(row[0]))) break;
    lv += num(row[h['Levels Req']]);
    for (var res3 in cols) out[res3] += num(row[cols[res3]]);
  }
  if (!(lv > 0)) return {};
  for (var res4 in out) out[res4] = out[res4] / lv;
  return out;
}
// c_day / c_day_v2: 7-day HC ladder, days r4..r10 col B.
function readDayLadder_(name){
  var v = sheetVals_(name), out = [];
  for (var r = 3; r < v.length && out.length < 7; r++){ if (v[r][0] == null || v[r][0] === '') break;
    out.push(num(v[r][1])); }
  return out;
}
// RM config sheets (RM / RM_1st / RM_2nd share one layout): EventDuration in the config panel;
// ladder under the 'Milestone' header row. sheetName optional -> 'RM' (pre-split behavior).
function readRMDuration_(sheetName){
  var v = sheetVals_(sheetName || 'RM');
  for (var r = 0; r < Math.min(v.length, 12); r++)
    if (String(v[r][0]) === 'EventDuration') return num(v[r][1]);
  return 0;
}
function readRMLadder_(sheetName){ return readLadder_(sheetVals_(sheetName || 'RM'), 'Req Accum'); }

// NS sheet (config-segmented, D14): per-segment blocks — a cell in col A holding the segment
// label, then a header row ('Round' ...), then milestone rows. Gate = 'Cum Streak Req'.
// Per-segment NS ladder off 'NS' (anchor config) or 'NS_v2' (redesign). A missing sheet, a
// missing segment row, or an unreadable ladder falls back to 'NS' — which yields R = 1 for that
// segment rather than a zero, so an unauthored NS_v2 reads as "config unchanged" (D22).
function readNSLadder_(seg, sheetName){
  var name = sheetName || 'NS';
  var ladder = nsLadderOn_(name, seg);
  if (!ladder.length && name !== 'NS') ladder = nsLadderOn_('NS', seg);
  return ladder;
}
function nsLadderOn_(sheetName, seg){
  var v = sheetVals_(sheetName);
  for (var r = 0; r < v.length; r++){
    if (String(v[r][0]).trim() !== String(seg)) continue;
    return readLadder_(v.slice(r + 1), 'Cum Streak Req');
  }
  return [];
}

// Generic ladder reader: finds the header row containing reqCol, maps reward columns through
// RES_MAP, reads rows until the first blank first-cell. Returns [{req, rew:{res:amount}}].
function readLadder_(v, reqCol){
  var hr = -1, h = {};
  for (var r = 0; r < v.length; r++){
    var idx = {};
    (v[r] || []).forEach(function(x, i){ if (x != null && x !== '') idx[String(x).trim()] = i; });
    if (idx[reqCol] != null){ hr = r; h = idx; break; }
  }
  if (hr < 0) return [];
  var out = [];
  for (var r2 = hr + 1; r2 < v.length; r2++){
    var row = v[r2];
    if (!row || row[0] == null || row[0] === '' || isNaN(parseFloat(row[0]))) break;
    var rew = {};
    for (var col in RES_MAP){
      if (h[col] != null && num(row[h[col]])) rew[RES_MAP[col]] = num(row[h[col]]);
    }
    out.push({ req: num(row[h[reqCol]]), rew: rew });
  }
  return out;
}

// ============================== HELPERS ======================================================
function zeroRow_(){ var o = {}; RESOURCES.forEach(function(r){ o[r] = 0; }); return o; }
function hasKeys_(o){ for (var k in o) return true; return false; }
function laddersEqual_(a, b){
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (num(a[i]) !== num(b[i])) return false;
  return true;
}
function rowToArray_(o){ return RESOURCES.map(function(r){ return num(o[r]); }); }
function headerIndex_(row){
  var m = {}; (row || []).forEach(function(h, i){ if (h != null && h !== '') m[String(h)] = i; });
  return m;
}
function num(x){ var n = parseFloat(x); return isNaN(n) ? 0 : n; }
function readCell_(a1){
  try { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET).getRange(a1).getValue(); }
  catch(e){ return null; }
}
// Per-execution cache. sheetVals_ is called MANY times per run (rewardR_ re-reads every config
// sheet for each category x payer x segment) — without this, fillSimPerSegment did ~300 full-sheet
// reads, incl. the heavy Ph_v2 reach-sim, every run. Config/data sheets don't change mid-run, so
// caching by name is safe; the cache is a module global that resets each script execution.
var _sheetValsCache = {};
function sheetVals_(name){
  if (_sheetValsCache[name] !== undefined) return _sheetValsCache[name];
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  return (_sheetValsCache[name] = sh ? sh.getDataRange().getValues() : []);
}
