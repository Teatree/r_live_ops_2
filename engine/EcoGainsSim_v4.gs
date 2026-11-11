/************************************************************************************************
 * EcoGainsSim_v4.gs — per-source simulation engine for EcoGainsSim_HC (SIMULATION_PLAN v3)
 * ---------------------------------------------------------------------------------------------
 * Brand-new engine based on EcoGainsSim.gs. One named function per source (D15); everything
 * numeric is read LIVE from the workbook (D12): config sheets, both calendars, data_* sheets.
 *
 * CUSTOM FUNCTIONS (per segment block, spills 25x19):
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_SIM(payer, segment))     // C<firstDataRow>
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_DIFF(payer, segment))    // O<firstDataRow>
 *   segment = any segment data_seg_beh carries - '0-9' | '10-19' | '20-39' | '40-99' | '100-249' | '250+' | 'ALL'
 *             ('100+' is read as '100-249', D94) - or 'A. 0' (appendix, carried+annotated)
 *
 * MODEL PER SOURCE (see SIMULATION_PLAN.md §2 for specs and worked numbers):
 *   carried        Ads, Other, Team Event, Team Race, FlowerCoop, IAPs
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
 *                  Flock Flurry (D91 - carried + a pack overlay before),
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
 *                  track. Team Event is CARRIED for every other resource but gets a pack overlay
 *                  from its config sheet (PACK_ONLY_SPECS; Flock Flurry was too until D91);
 *                  Team Race, Ads and IAPs have no config sheet → 0. A. 0 has no behaviour
 *                  telemetry → 0.
 *
 * CALENDARS drive cadence + duration: merge = one instance (width = duration), lone filled
 * cell = one 1-day instance, neighbours never collapsed, day = column - 1, weekend =
 * Fri/Sat/Sun counted from the weekday the calendar's own weekday-name row gives day 1 (D64;
 * it was a hardcoded Wednesday start).
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

// Build stamp. Read back by ECOGAINS_BUILD() so "is the pasted code current?"
// is answerable from the sheet instead of from memory.
var ENGINE_BUILD  = 'EcoGainsSim_v4.gs  D105  2026-11-11';


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
  'Col - Sets','Col - Albums',
  // D102 (2026-11-11): a NEW event, appended at the end (user decision) so every existing row keeps its
  // position. Fill all sims writes by label (D68) and adds this label under 'Col - Albums' itself (D102).
  'Mighty Ice Cream'
];

// display segment -> data_gains label (D8: '0-9' anchors to B. 1-9; A. 0 = appendix, own label).
// Kept as the list of labels a sheet may name; every LOOKUP goes through segCanon_ (D94) instead.
var SEG_TO_GAINS = {'0-9':'B. 1-9','10-19':'C. 10-19','20-39':'D. 20-39','40-99':'E. 40-99',
                    '100+':'F. 100+','100-249':'F. 100-249','250+':'G. 250+','ALL':'ALL','A. 0':'A. 0'};

// ============================== SEGMENTS (D94, 2026-11-05) ===================================
// LIVE_OPS_V3 (20) re-pulled every data_* sheet with two more segments and one renamed:
//   '100+'  is GONE  - the pull calls it '100-249' (data_gains: 'F. 100-249'). User decision: a
//           '100+' left on any sheet - a config block (c_saga, NS, ToF), a sim sheet's tag, a
//           dropdown, an older feed - MEANS 100-249. SEG_ALIAS says so once, for every reader.
//   '250+'  is new, split out of the old 100+. It has no config block of its own (yet): a config
//           reader that finds no '250+' block reads its PARENT's ('100-249', i.e. the '100+' block),
//           and a behaviour row the pull lacks for it falls back the same way (SEG_PARENT). Its
//           measured gains never fall back - a missing data_gains row is a measured 0.
//   'ALL'   is new and is NOT a sum of the others: it is the pull's own row for the whole
//           population, read like any segment (its own gains, activity, ranks, balances, streaks).
//           The exception is what is CONFIGURED per segment - the Saga coin ladder, the Night Sky
//           ladders, the ToF behaviour rows: an ALL player has no ladder, so those rows are the
//           pooled result of the member segments, each weighted by its players (mixRow_), and the
//           collection rows are the member segments' card seasons pooled (colSimSeasons_).
// One canonical spelling inside the engine (segCanon_), whatever a sheet or a pull writes; the
// labels the engine PRINTS are the ones data_seg_beh uses (segLabel_), so an older workbook keeps
// reading '100+' and (20) reads '100-249'. The member list is data_seg_beh's own rows (D12).
var SEG_ALL = 'ALL';
var SEG_ALIAS = { '100+': '100-249', '1-9': '0-9' };
var SEG_PARENT = { '250+': '100-249' };
// Sources whose ALL row is the member segments POOLED (mixRow_) instead of ALL's own average player:
//   Saga, Night Sky, ToF      configured per segment - an ALL player has no ladder / behaviour row
//   Season Pass (Free, Paid)  a TIER is a threshold each player crosses or not (user decision
//                             2026-11-05, measured on (20)): ALL's average player (1,728 tokens) sat
//                             just above a tier edge and dropped a whole tier on the redesign (Free
//                             -3.1%, Paid -7.8%) while no single segment crossed one (0.0%), and the
//                             modelled Paid track read 1,021 for the average player against 854 for
//                             the segments' average - one average player reaches tiers the low
//                             segments never do. Six segments describe the population better than one.
var SEG_MIX_CATS = { 'Saga': 1, 'Daily Night Sky Prize': 1, 'ToF': 1,
                     'Season Pass (Free)': 1, 'Season Pass (Paid)': 1 };
/** The engine's one spelling of a segment label: trimmed, data_gains' 'F. ' prefix dropped,
 *  aliases applied. '' for a blank. */
function segCanon_(x){
  var s = String(x == null ? '' : x).trim();
  if (!s) return '';
  if (s === 'A. 0' || s === 'A.0') return 'A. 0';
  var m = /^[A-Z]\.\s*(\S.*)$/.exec(s);                  // 'B. 1-9', 'F. 100-249', 'G. 250+'
  if (m) s = m[1].trim();
  if (/^all$/i.test(s)) return SEG_ALL;
  return SEG_ALIAS[s] || s;
}
function segIsAll_(seg){ return segCanon_(seg) === SEG_ALL; }
function segIsAppendix_(seg){ return segCanon_(seg) === 'A. 0'; }
/** The labels a CONFIG block for `seg` may carry, best first: its own spellings, then its parent's
 *  ('250+' -> '250+', '100-249', '100+'). ALL has none - its config is a mixture (segMembers_). */
function segCfgKeys_(seg){
  var out = [], seen = {}, cur = segCanon_(seg), hops = 0;
  function add(x){ if (x && !seen[x]){ seen[x] = 1; out.push(x); } }
  while (cur && hops++ < 4){
    add(cur);
    for (var a in SEG_ALIAS) if (SEG_ALIAS[a] === cur) add(a);
    cur = SEG_PARENT[cur];
  }
  return out;
}
/** Index into `labels` of the config block `seg` reads (segCfgKeys_ order), or -1. */
function segCfgPick_(labels, seg){
  var keys = segCfgKeys_(seg);
  for (var k = 0; k < keys.length; k++)
    for (var i = 0; i < labels.length; i++)
      if (String(labels[i] == null ? '' : labels[i]).trim() === keys[k]) return i;
  return -1;
}
/** The label the engine prints for a segment: data_seg_beh's own spelling of it, else canonical. */
function segLabel_(seg, ds){
  var c = segCanon_(seg);
  try { ds = ds || Context.get().ds; } catch (e){ ds = null; }
  var l = (ds && ds.segLabel) ? ds.segLabel(c) : null;
  return l || c;
}
/** The member segments of the population, canonical, in data_seg_beh's rank order: every segment
 *  the pull carries except ALL (and the appendix). */
function segMembers_(ds){
  try { ds = ds || Context.get().ds; } catch (e){ return []; }
  return ((ds && ds.segs) ? ds.segs() : []).filter(function(s){ return s !== SEG_ALL && s !== 'A. 0'; });
}
/** How many players stand behind one per-earner amount: the resource's earners where the export
 *  carries (category, resource) for the cell, else the cell's players (a bottom-up amount is per
 *  player). The weight a member segment's row takes in the ALL mixture. */
function segWeight_(ds, seg, payer, cat, r){
  var e = ds.hasGain(seg, payer, cat, r) ? ds.earners(seg, payer, r) : 0;
  return (e > 0) ? e : ds.players(seg, payer);
}
/** [{seg, w}] over the member segments of one payer flag, w = share of their players (sums to 1). */
function segMix_(payer, ds){
  var mem = segMembers_(ds), tot = 0, out = [];
  mem.forEach(function(s){ var n = ds.players(s, payer); if (n > 0){ out.push({ seg: s, w: n }); tot += n; } });
  out.forEach(function(x){ x.w = x.w / tot; });
  return out;
}
/** The segment whose per-segment CONFIG one simulated player is given (the play-by-play view): itself,
 *  except ALL - a single ALL player has to stand on one ladder, and that is the member segment whose
 *  7-day saga range holds ALL's own weekly saga pace (saga completions per active day x the active days
 *  of a week). On LIVE_OPS_V3 (20): ~32 a week at either payer flag -> the 20-39 ladders. */
function segCfgRep_(seg, payer, ds){
  var c = segCanon_(seg);
  if (c !== SEG_ALL) return c;
  try { ds = ds || Context.get().ds; } catch (e){ return c; }
  var b = ds.beh(SEG_ALL, payer) || {};
  var perDay = num(b.saga_completes_per_active_day) || num(b.levels_completed_per_active_day);
  var pace = perDay * (4 * num(b.weekday_active_rate) + 3 * num(b.weekend_active_rate));   // Fri/Sat/Sun = weekend
  var mem = segMembers_(ds), pick = mem.length ? mem[0] : c;
  mem.forEach(function(sg){ var m = /^(\d+)/.exec(sg); if (m && pace >= +m[1]) pick = sg; });
  return pick;
}
/** The MEASURED side of an ALL row of a pooled source: the export's own ALL amount wherever it carries
 *  one; where it is silent - a synthetic anchor (the paid Season Pass track, a bottom-up column) - the
 *  member segments' measured rows pooled per player, never the anchor of one average ALL player.
 *  `core`: the members' export-only rows (measuredRowCore_), as the anchor side asks for them. */
function mixMeasured_(cat, payer, ds, core){
  if (cat === 'Daily Night Sky Prize' && !nsAnchored_() && NS_SIMULATE) return zeroRow_();   // a NEW source has no current side
  var own = ds.dataRow(cat, SEG_ALL, payer), out = zeroRow_(), pooled = null;
  RESOURCES.forEach(function(r){
    if (num(own[r]) > 0){ out[r] = num(own[r]); return; }
    if (!pooled){
      pooled = zeroRow_();
      segMembers_(ds).forEach(function(sg){
        var m = core ? measuredRowCore_(cat, sg, payer, ds) : measuredRow_(cat, sg, payer, ds);
        RESOURCES.forEach(function(q){ pooled[q] += segWeight_(ds, sg, payer, cat, q) * num(m[q]); });
      });
    }
    var nA = segWeight_(ds, SEG_ALL, payer, cat, r);
    out[r] = (nA > 0) ? pooled[r] / nA : 0;
  });
  return out;
}
/** The ALL row of a source configured per segment: the member segments' rows pooled. Per resource
 *      ALL_new = ALL_measured x SUM_s N_s x new_s / SUM_s N_s x measured_s
 *  - the pooled change of the members applied to ALL's own measured level, so identical configs
 *  still give DIFF 0 - and, where no member has a measured amount (a bottom-up column the export
 *  does not carry), the pooled per-player amount SUM_s N_s x new_s / N_ALL. N = segWeight_.
 *  null when the pull has no member segment (the caller carries). */
function mixRow_(cat, payer, ctx){
  var ds = ctx.ds, mem = segMembers_(ds);
  if (!mem.length) return null;
  var measAll = measuredRow_(cat, SEG_ALL, payer, ds), nu = zeroRow_(), de = zeroRow_();
  mem.forEach(function(s){
    var x = resultRow_(cat, s, payer, ctx), m = measuredRow_(cat, s, payer, ds);
    RESOURCES.forEach(function(r){
      var n = segWeight_(ds, s, payer, cat, r);
      nu[r] += n * num(x[r]); de[r] += n * num(m[r]);
    });
  });
  var out = zeroRow_();
  RESOURCES.forEach(function(r){
    if (de[r] > 1e-12) out[r] = num(measAll[r]) * nu[r] / de[r];
    else if (nu[r] > 0){
      var nA = segWeight_(ds, SEG_ALL, payer, cat, r);
      out[r] = (nA > 0) ? nu[r] / nA : 0;
    }
  });
  return out;
}
/** The simulator of (category, segment): the source's own function, or the member mixture for ALL
 *  on a source configured per segment. */
function simFor_(cat, seg, payer, ctx){
  if (SEG_MIX_CATS[cat] && segIsAll_(seg)) return mixRow_(cat, payer, ctx);
  var fn = SOURCES[cat];
  return fn ? fn(seg, payer, ctx, cat) : null;
}

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
  'Flock Flurry'          : simFlockFlurry,      // D91: a leaderboard (carried + a pack overlay before)
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
  'Col - Albums'          : simColAlbums,        // card-collection ALBUM completion rewards
  'Mighty Ice Cream'      : simMightyIceCream    // D102: a new leaderboard, priced bottom-up
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
  'Flock Flurry':'Flock Flurry',   // a simulated leaderboard since D91 (carried + a pack overlay before)
  'ToF':'ToF',                     // one merged 33-day instance: the event is always-on
  'Mighty Ice Cream':'Mighty Ice Cream'   // D102
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
  seg = segCanon_(seg);                                                        // D94: one spelling inside
  if (seg === 'A. 0') return appendixRow_(cat, payer, ctx);                    // §3 block
  // D94: ALL on a source configured per segment is the member segments pooled - already final
  // (its members' rows carry the D82 anchoring), so it skips the overlays below
  if (seg === SEG_ALL && SEG_MIX_CATS[cat]) return mixRow_(cat, payer, ctx) || measuredRow_(cat, seg, payer, ctx.ds);
  var fn = SOURCES[cat];
  var row = fn ? (fn(seg, payer, ctx, cat) || measuredRow_(cat, seg, payer, ctx.ds))
               : measuredRow_(cat, seg, payer, ctx.ds);                        // carried
  // D19: a carried source can still pay packs bottom-up (Team Event, Flock Flurry) — overlay the
  // six pack columns, leave every other resource exactly as the simulator/carry produced it.
  if (PACK_ONLY_SPECS[cat]){
    var packs = packOnlyRow_(cat, seg, payer, ctx);
    if (packs) row = overlayPacks_(copyRow_(row), packs);
  }
  return exportAnchorBottomUp_(cat, seg, payer, ctx, row);   // D82
}

// measured anchor. Core and Saga are separate rows (data_gains emits both) — no folding.
// Core SPT (D18): data_gains has no Core level-completion SPT rows, so when the raw SPT is 0
// the anchor is SYNTHESIZED (L x E_base — see coreSptSynth_). One choke point keeps every
// consumer consistent (DIFF, daily CURRENT, sptTotals_ measured side); the moment a data_gains
// re-pull delivers real Core SPT rows, the raw value takes back over (no double count).
// A. 0 stays raw (appendix — no behaviour telemetry, §3).
function measuredRow_(cat, seg, payer, ds){
  seg = segCanon_(seg);                                  // D94
  if (seg === SEG_ALL && SEG_MIX_CATS[cat]) return mixMeasured_(cat, payer, ds, _baseSide);   // D94: pooled where the export is silent
  var row = measuredRowCore_(cat, seg, payer, ds);
  if (_baseSide || seg === 'A. 0') return row;
  // D61: the bottom-up columns of the MEASURED side (see PACK_ANCHORED). Only where the export is
  // silent on every one of them - a pull that one day carries real pack rows takes over by itself.
  if (cat === TOF_CAT){
    if (TOF_ANCHORED && !anyAmount_(row)){ var ts = tofSynth_(seg, payer); if (ts) return ts; }
    return row;
  }
  // D67: the collection rows - the card sim over cal_curr on the base ladders, resource by
  // resource wherever the export is silent (see COL_ANCHORED).
  if (COL_CATS[cat]){
    if (!COL_ANCHORED) return row;
    var cs = colSimSeasons_(seg, payer, null, 'cur');
    if (!cs) return row;
    var walkC = (cat === 'Col - Sets') ? cs.sets : cs.albums, outC = zeroRow_();
    RESOURCES.forEach(function(r){ outC[r] = (num(row[r]) > 0) ? num(row[r]) : num(walkC[r]); });
    return outC;
  }
  // D102: a NEW leaderboard - TODAY is its own walk over cal_curr wherever the export is silent
  if (NEW_LB[cat]){
    if (anyAmount_(row)) return row;
    var nl = newLbAnchor_(cat, seg, payer);
    return nl || row;
  }
  if (!PACK_ANCHORED || cat === 'Rainbow Maker' || bottomUpHasData_(row)) return row;
  var pk = (cat === 'Season Pass (Free)') ? spFreePacksSynth_(seg, payer, ds) : packAnchorRow_(cat, seg, payer);
  return pk ? overlayPacks_(copyRow_(row), pk) : row;
}

// The MEASURED side of Season Pass (Free)'s bottom-up columns: the base track's packs up to the
// tier the measured SPT reached - the free-track twin of spPaidSynth_, same tier machinery.
function spFreePacksSynth_(seg, payer, ds){
  var sp = spPaidTracks_();
  if (!sp) return null;
  var Tm = spTier_(measuredSptTotal_(seg, payer, ds) * sp.daysBase / windowDays_(), sp.base.cum);
  if (!(Tm > 0)) return null;
  var cb = spCumTo_(sp.base, Tm, 'NONPAYER'), out = {};
  BOTTOMUP_RES.forEach(function(r){ out[r] = num(cb[r]); });
  return out;
}

function measuredRowCore_(cat, seg, payer, ds){
  if (SEG_MIX_CATS[cat] && segIsAll_(seg)) return mixMeasured_(cat, payer, ds, true);         // D94
  // D86: a stand-in lane has no current side (Chuck's: cal_curr runs none - user rule)
  if (LANE_STANDIN[cat] && laneStandInActive_(cat)) return zeroRow_();
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
  if (!nsAnchored_() && NS_SIMULATE && cat === 'Daily Night Sky Prize') return zeroRow_();
  // Rainbow Maker (D29): the measured side is SYNTHESISED from cal_curr + the base ladder, because
  // data_gains has no RM rows to anchor on. Intercepted at this one choke point so the 33-day DIFF,
  // the daily CURRENT block, Sim per Segment and the measured SPT total all agree.
  if (cat === 'Rainbow Maker' && seg !== 'A. 0' && seg !== 'A.0'){
    var rmReal = false;
    RESOURCES.forEach(function(r){ if (num(row[r]) > 0) rmReal = true; });
    var rmSyn = rmSynth_(seg, payer, Context.get());
    if (rmSyn){
      if (!RM_REAL_DATA_WINS){
        if (rmReal) try { Logger.log('Rainbow Maker: data_gains HAS rows for ' + seg + '/' + payer +
              ' but RM_REAL_DATA_WINS is false, so the synthetic cal_curr anchor is used instead. ' +
              'Flip that flag to price the anchor off the export.'); } catch(e){}
        return rmSyn;
      }
      // D61: resource by resource - the export where it has a number, the walk where it is silent.
      var rmMerged = zeroRow_();
      RESOURCES.forEach(function(r){ rmMerged[r] = (num(row[r]) > 0) ? num(row[r]) : num(rmSyn[r]); });
      return rmMerged;
    }
  }
  // Core SPT = the level-completion faucet, plus the SPTx2 buff minutes every OTHER source paid
  // out (D54). The base half is the D18 synthetic anchor while data_gains carries no Core SPT
  // rows, and the raw value the moment a re-pull delivers them; the buff half is priced at the
  // SAME per-level E, because that is literally what the buff doubles. Returns the row untouched
  // when neither half moves, so a workbook with no SP panel stays bit-identical to before.
  if (cat === 'Core' && seg !== 'A. 0' && seg !== 'A.0'){
    var base = coreBaseSpt_(seg, payer, ds);
    var bonus = sptx2ToSpt_(sptx2MinutesMeas_(seg, payer, ds), seg, payer, ds, coreSptEBase_());
    if (base !== num(row['SPT']) || bonus !== 0){
      var o = {};
      RESOURCES.forEach(function(r){ o[r] = num(row[r]); });
      o['SPT'] = base + bonus;
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
  // River Rush: zero ONLY when it is genuinely removed, i.e. the old calendar ran it and the new one
  // does not. D34 - with neither calendar running it the event is absent from the comparison, so the
  // appendix carries like every other row rather than reporting the lane as a loss. (This line used
  // to zero unconditionally: "RR removal is universal", true while cal_curr still scheduled it.)
  if (cat === 'River Rush'){
    var rrCur = (ctx.calCurOk && (ctx.calCur['River Rush'] || []).length) || 0;
    var rrNew = (ctx.calNewOk && (ctx.calNew['River Rush'] || []).length) || 0;
    if (rrCur && !rrNew) return zeroRow_();
  }
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
  var ds = ctx.ds, meas = measuredRow_('Core', seg, payer, ds);
  var R = coreSptR_(ctx), eBase = coreSptEBase_();
  // Both halves re-priced on the v2 panel rather than scaling the finished measured row: the base
  // completions at E_v2, and the buff minutes at E_v2 too (D54). Building up from coreBaseSpt_ is
  // what stops the measured buff bonus inside meas['SPT'] being scaled a second time.
  var out = {};
  RESOURCES.forEach(function(r){ out[r] = num(meas[r]); });
  out['SPT'] = coreBaseSpt_(seg, payer, ds) * R
             + sptx2ToSpt_(sptx2MinutesSim_(seg, payer, ctx), seg, payer, ds, eBase * R);
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
  return addSagaBase0_(out, seg, payer, ctx);            // D79
}
// ---- Saga BASE-0 ADDITIONS (D79, 2026-10-30) -------------------------------------------------
// The chapter chests' items are scaled by the v2/base per-level ratio, so an item the base chests
// never pay - an envelope on a chapter chest - had no anchor and was carried at 0. It is priced
// bottom-up off the chapter ladder itself:
//     add[r] = (v2 items per level)[r] x saga completions in the window
//     saga completions = saga_completes_per_active_day x SUM p_day     (data_seg_beh; falls back to
//                        levels_completed_per_active_day when the pull lacks the saga column)
// Chapter progress is SAGA progress: a player in Dream Peak completes levels and opens no chapter.
// Packs included - Saga has no pack lane, and this is it. The anchor side (_baseSide) adds nothing,
// so identical chests still give DIFF 0. SAGA_BASE0_BOTTOMUP = false restores the carry.
var SAGA_BASE0_BOTTOMUP = true;
function sagaCompletions_(seg, payer, ctx){
  var b = ctx.ds.beh(seg, payer) || {};
  var per = num(b.saga_completes_per_active_day);
  if (!(per > 0)) per = num(b.levels_completed_per_active_day);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(per > 0) || (!(pWd > 0) && !(pWe > 0))) return 0;
  return per * pDaySum_(1, windowDays_(), pWd, pWe);
}
function addSagaBase0_(out, seg, payer, ctx){
  if (!SAGA_BASE0_BOTTOMUP || _baseSide) return out;
  var base = readSagaItems_('c_saga'), v2 = readSagaItems_('c_saga_v2'), L = -1;
  for (var r in v2){
    if (num(base[r]) > 1e-12 || !(num(v2[r]) > 0) || RESOURCES.indexOf(r) < 0) continue;
    if (L < 0) L = sagaCompletions_(seg, payer, ctx);
    out[r] = num(out[r]) + num(v2[r]) * L;
  }
  return out;
}
function sagaRatio_(seg){
  if (segIsAll_(seg)){
    // D94: no ALL ladder. Outside the mixture row (mixRow_) this is only a fallback: the members'
    // ratios weighted by their players (both payer flags).
    var ds, mem;
    try { ds = Context.get().ds; mem = segMembers_(ds); } catch (e){ mem = []; }
    var nu = 0, de = 0;
    mem.forEach(function(sg){
      var w = ds.players(sg, 'NONPAYER') + ds.players(sg, 'PAYER');
      nu += w * sagaRatio_(sg); de += w;
    });
    return (de > 0) ? nu / de : 1;
  }
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
  var v = sheetVals_(_baseSide ? 'c_day' : 'c_day_v2');          // D61: base sheet on the anchor side
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
function simChuckChallenge(seg, payer, ctx){
  return laneStandIn_('Chuck Challenge', seg, payer, ctx) || leaderboardSim_('Chuck Challenge', "Chuck's Challenge", seg, payer, ctx);
}
function simRedChallenge  (seg, payer, ctx){ return leaderboardSim_('Red Challenge',   "Red's Challenge",   seg, payer, ctx); }
function simLevelRace     (seg, payer, ctx){ return leaderboardSim_('Level Race',      'Level Race',        seg, payer, ctx); }
function simFlashRace     (seg, payer, ctx){ return leaderboardSim_('Flash Race',      'Flash Race',        seg, payer, ctx); }
// Target Day (D3): milestones intentionally pay 0 today — it is a pure leaderboard event.
function simTargetDay     (seg, payer, ctx){ return leaderboardSim_('Target Day',      'Target Day',        seg, payer, ctx); }
// Flock Flurry (D91): a 5-player flock board on F / F_v2 - see FLOCK_SIMULATED below LB_R_SPECS.
function simFlockFlurry   (seg, payer, ctx){ return leaderboardSim_('Flock Flurry',    'Flock Flurry',      seg, payer, ctx); }

function leaderboardSim_(cat, calLabel, seg, payer, ctx){
  return timedCore_(cat, calLabel, seg, payer, ctx, function(){ return 1; });
}

// ---- D102 (2026-11-11, user decisions): MIGHTY ICE CREAM, a NEW leaderboard priced bottom-up ---------
// A league of 60 paying 25 places (config sheet Mic_v2, builders/_build_mic.py, from the live server JSON).
// It has never run, so there is no data_gains row to anchor on and no data_event_inst row of its own:
//   * places: the measured places of the event named in Mic_v2's 'Places from' cell (Red's Challenge),
//     AS MEASURED (user decision: not rescaled to the 60-player board) - the rank CDF through Red's
//     p25 / p50 / p75 runs to LBSize 60, so the top quarter's tail spreads over the rest of the board.
//     Real 'Mighty Ice Cream' rows in data_event_inst take over by themselves (eventInstProxy_).
//   * every resource BOTTOM-UP (user decision): per instance on the calendar,
//         E[r] x participation x reach(instance)
//     E = SUM_k P(place k) x Mic_v2[k][r] (lbE_, the same pricing as every leaderboard's E), participation
//     = the borrowed event's measured participation_rate unless Mic_v2 carries a 'Participation' cell
//     (packParticipation_), reach = 1 - PROD(1 - p_day) (laneReach_). Envelopes / ToF tickets go through
//     packLane_ (the album cutoff applies). No D: a race pays by place, not by tokens.
//   * TODAY is the same walk over cal_curr on the base config ('Mic' if it exists, else Mic_v2), which is
//     0 while cal_curr runs none - and identical calendars + configs give DIFF 0, as for every source.
//   * once data_gains carries the event, the export is the level and the model the change (anchorOne_,
//     the D61 / D82 rule): redesign = export x walk(cal_new) / walk(cal_curr).
// Red's Challenge is NOT touched: it keeps its own lane, wherever its merges sit on the grid.
// The Wager mechanic (booster multipliers, booster spend) is not modelled.
var NEW_LB = { 'Mighty Ice Cream': { placesLabel: 'Places from', placesDefault: 'Red' } };
var _newLbAnchorCache = {};
function simMightyIceCream(seg, payer, ctx){ return newLbSim_('Mighty Ice Cream', seg, payer, ctx); }
/** The data_event_inst event a NEW leaderboard borrows its places from (null for any other event). */
function eventInstProxy_(ev){
  var n = NEW_LB[ev];
  if (!n) return EVENT_INST_PROXY[ev] || null;
  var spec = LB_R_SPECS[ev], raw = spec ? readSPLabel_(spec.v2, n.placesLabel) : null;
  var t = String(raw == null ? '' : raw).trim();
  return t || n.placesDefault;
}
/** The base-side sheet of a leaderboard spec: its own base, or - for a NEW event with no base sheet - the
 *  redesign's sheet (so a calendar that runs the event on both sides prices one config). */
function lbBaseSheet_(spec){
  if (!spec || !spec.newEvent) return spec && spec.base;
  var v = sheetVals_(spec.base);
  return (v && v.length) ? spec.base : spec.v2;
}
function newLbSim_(cat, seg, payer, ctx){
  var meas = measuredRowCore_(cat, seg, payer, ctx.ds);
  if (!ctx.calNewOk) return meas;
  var walk = newLbWalk_(cat, seg, payer, ctx);
  if (_baseSide || !anyAmount_(meas)) return walk;
  var cur = newLbAnchor_(cat, seg, payer);            // the export carries it: level from the data
  if (!cur) return walk;
  var out = zeroRow_();
  RESOURCES.forEach(function(r){ out[r] = anchorOne_(num(meas[r]), num(cur[r]), num(walk[r])); });
  return out;
}
/** Bottom-up payout of a NEW leaderboard over ctx.calNew (cal_curr on the anchor side). */
function newLbWalk_(cat, seg, payer, ctx){
  var out = zeroRow_(), lane = CAL_LABEL[cat] || cat, all = (ctx.calNewOk && ctx.calNew[lane]) || [];
  if (!all.length) return out;
  var E = rewardE_(cat, seg, payer, ctx.ds);
  if (!E) return out;
  var e = _baseSide ? E.eBase : E.eV2;
  var b = ctx.ds.beh(seg, payer), pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)) return out;              // no activity telemetry (A. 0): nothing to price
  // D103: a wager event's places are built per festival (its length and days set each player's bank chance)
  var spec = LB_R_SPECS[cat], sheet = _baseSide ? lbBaseSheet_(spec) : spec.v2;
  // D105: the instance row carries the cell, so the pack lane reads the same participation
  var instP = wagerInstFor_(cat, E.inst, seg, payer, sheet);
  var part = packParticipation_(cat, instP);
  var eOf = (WAGER_SPECS[cat] && WAGER_BOTTOMUP && wagerTable_(sheet, WAGER_SPECS[cat]))
    ? function(x){ var wx = wagerE_(cat, seg, payer, x, sheet); return wx ? wx.e : e; } : null;
  all.forEach(function(x){
    var q = laneReach_(lane, x, pWd, pWe, seg, payer), ex = eOf ? eOf(x) : e;
    RESOURCES.forEach(function(r){ if (BOTTOMUP_RES.indexOf(r) < 0) out[r] += part * q * num(ex[r]); });
  });
  return overlayPacks_(out, packLane_(lane, seg, payer, ctx, eOf || e, instP, cat));
}
/** D105: the data_event_inst row of a wager event with the cell attached (packParticipation_ reads it). */
function wagerInstFor_(cat, inst, seg, payer, sheet){
  if (!WAGER_SPECS[cat]) return inst;
  var o = {};
  for (var k in (inst || {})) o[k] = inst[k];
  o._wagerSeg = seg; o._wagerPayer = payer; o._wagerSheet = sheet;
  return o;
}
/** TODAY's side: the same walk over cal_curr on the base config, memoised per cell. */
function newLbAnchor_(cat, seg, payer){
  var key = cat + '|' + seg + '|' + payer;
  if (_newLbAnchorCache[key] !== undefined) return _newLbAnchorCache[key];
  var ctx;
  try { ctx = Context.get(); } catch (e){ return null; }
  if (!ctx || !ctx.calCurOk) return (_newLbAnchorCache[key] = null);
  var bctx = baseCtx_(ctx), row = null, was = _baseSide;
  _baseSide = true;
  try { row = newLbWalk_(cat, seg, payer, bctx); } finally { _baseSide = was; }
  return (_newLbAnchorCache[key] = row);
}

// ---- D103 (2026-11-11, user decisions): MIGHTY ICE CREAM's PLACES BOTTOM-UP (the wager) -------------
// design_pdfs/Mighty Ice Cream (Wager).md: every bird created in a level WON scores (Red 1, Chuck 2,
// Bomb 4 - the server's boosterMultipliers); after each win the player SUBMITS the running score or KEEPS
// GOING; a lost level resets it to 0; the leaderboard holds the submitted score; places pay at the close.
// D102 borrowed Red's Challenge's measured places; now the place is built from what decides it:
//   submit after k wins      k = the cell's measured max_streak_per_day_p50 (data_streaks) - the user's
//                            choice: players bank at their typical natural streak
//   bank chance in a festival  1 - (1 - S_day(k))^D, S_day = the measured share of active days whose
//                            longest win streak reaches k (data_streaks p25/p50/p75/p90), D = the
//                            participant's expected active days in THAT festival (SUM p_day / reach).
//                            Measured streaks, not a coin-flip model: at a 0.70 win rate an 18-win run
//                            would be ~0.2% per try, yet it is the 40-99 median daily maximum
//   points per win           Red + 2 x Chuck + 4 x Bomb birds per win; Red / Chuck = the Red's / Chuck's
//                            Challenge mean final balance / (wins per day x active days in that 2-day
//                            weekday challenge); Bomb = half of Chuck's (user decision; no Bomb rows)
//   spread between players   the banked score k x points x f, f = Red's balance quantiles / their mean
//                            (p25 / p50 / p75 + the linear tail) - FLAGGED: also carries activity spread
//   league                   59 opponents drawn from the member cells in proportion to their measured
//                            participants per festival (Red's avg_participants_per_instance); an opponent
//                            beats a score s with P(it banked and its score > s) (+ half the ties); the
//                            player's place = 1 + Binomial(LBSize - 1, that). A player who never banks is
//                            not on the board and is paid nothing.
// Every input is a cell on Mic_v2's 'Player behaviour (Wager)' table (formulas holding the measured
// defaults, overwritable). A blank or non-numeric cell (a formula with no cached value offline) reads the
// same default from the data here (wagerCell_), so the sheet and the engine compute one number.
// WAGER_BOTTOMUP = false (or no table) restores D102's measured-places pricing exactly.
var WAGER_BOTTOMUP = true;
var WAGER_SPECS = { 'Mighty Ice Cream': { hdrLabel: 'Submit after (wins)', redEv: 'Red', chuckEv: 'Chuck',
                    bombShare: 0.5, mult: { red: 1, chuck: 2, bomb: 4 },
                    lenLabel: 'Bird challenge length (days)', lenDefault: 2, nq: 40,
                    // D105: the MEASURED mode (see below)
                    scoreLabel: 'Top score p50', dataSheet: 'data_mic', nqScores: 100,
                    leagueLabel: 'League size (players per board)',
                    partLabel: 'Participation override (all segments)' } };

// ---- D105 (2026-11-11, user decisions): MIGHTY ICE CREAM ON ITS OWN DATA -------------------------------
// The event ran, and data_mic carries it (three stacked tables, each under its own 'Segment' header row):
// per segment the participation (participants / players ACTIVE during the event - user), the distribution
// of each participant's HIGHEST submitted score (avg, p25 / p50 / p75 / p90 / p95 / p98), and the
// segment's share of the participants on a leaderboard (pooled) with the average leaderboard size (16.3
// players - not the 60 of leagueGroupSize). No payer split: both payer rows read the segment.
// When Mic_v2's behaviour table carries 'Top score p50' (the D105 layout) the places are built from those
// MEASURED scores instead of the streak model of D103 / D104:
//   a participant's score     the cell's measured top-score distribution (piecewise linear through the
//                             percentiles from 0, the tail past the last one ending where the mean is the
//                             measured average), WAGER_SPECS.nqScores equal-weight quantiles; every
//                             participant is on the board (a participant is someone who submitted)
//   the league                LEAGUE seats - 1 opponents drawn by the member cells' opponent share; place =
//                             1 + Binomial(seats - 1, P(an opponent scored more)); a non-integer league
//                             size (16.3) is that mixture of the two whole sizes around it
//   participation             the cell's measured share (per festival, of the players online on its days),
//                             or the 'Participation override (all segments)' cell when it holds a number
// Every input is a cell on the table (formulas holding data_mic, overwritable); a blank cell reads the
// same number from data_mic here, so the sheet and the engine compute one thing. FLAGGED: the scores were
// measured on the festival as it ran (its length and days); every festival on cal_new uses them as they
// are. Not modelled: payer differences (none in the data), the boosters / +5 moves a streak sells.
var _micDataCache;
/** data_mic, by canonical segment: { seg: { 'participation': x, 'p50': x, 'pooled share': x, ... } } plus
 *  .league (the first 'Avg LB size'). Each stacked table is a 'Segment' header row and the rows under it;
 *  a value is taken from the FIRST table that has that column. null without the sheet. */
function micData_(sheetName){
  if (_micDataCache !== undefined) return _micDataCache;
  var v = sheetVals_(sheetName || 'data_mic');
  _micDataCache = null;
  if (!v || !v.length) return null;
  var out = { segs: {}, league: null };
  for (var r = 0; r < v.length; r++){
    if (String((v[r] || [])[0] == null ? '' : v[r][0]).trim().toLowerCase() !== 'segment') continue;
    var hdr = (v[r] || []).map(function(x){ return String(x == null ? '' : x).trim().toLowerCase(); });
    for (var r2 = r + 1; r2 < v.length; r2++){
      var row = v[r2] || [], sg = String(row[0] == null ? '' : row[0]).trim();
      if (!sg) break;
      var key = segCanon_(sg), o = (out.segs[key] = out.segs[key] || {});
      hdr.forEach(function(h, c){
        if (!h || c === 0 || o[h] !== undefined) return;
        var x = parseFloat(row[c]);
        if (isFinite(x)) o[h] = x;
        if (h === 'avg lb size' && isFinite(x) && out.league == null) out.league = x;
      });
      r = r2;
    }
  }
  return (_micDataCache = out);
}
/** One cell's data_mic row (its parent's when the segment has none). */
function micDataRow_(seg, sheetName){
  var d = micData_(sheetName);
  if (!d) return {};
  var c = segCanon_(seg), hops = 0;
  while (c && hops++ < 4){ if (d.segs[c]) return d.segs[c]; c = SEG_PARENT[c]; }
  return {};
}
/** n equal-weight quantiles of a top-score distribution given as percentiles + the mean. */
function micScoreQuantiles_(pcts, avg, n){
  var pts = [[0, 0]], mean = 0;
  pcts.forEach(function(p){
    var last = pts[pts.length - 1];
    if (p[0] > last[0] && p[1] > last[1]) pts.push(p);
  });
  if (pts.length < 2) return [];
  for (var i = 1; i < pts.length; i++) mean += (pts[i][1] - pts[i - 1][1]) * (pts[i][0] + pts[i - 1][0]) / 2;
  var z = pts[pts.length - 1], rest = 1 - z[1];
  if (rest > 1e-9){
    var top;
    if (avg > 0) top = Math.max(z[0], 2 * (avg - mean) / rest - z[0]);      // the tail ends where mean = avg
    else {
      var a = pts[pts.length - 2], slope = (z[1] - a[1]) / Math.max(1e-9, z[0] - a[0]);
      top = (slope > 0) ? z[0] + rest / slope : z[0];
    }
    pts.push([top, 1]);
  }
  var Q = function(u){
    for (var j = 1; j < pts.length; j++) if (u <= pts[j][1]){
      var lo = pts[j - 1], hi = pts[j];
      return lo[0] + (hi[0] - lo[0]) * (u - lo[1]) / Math.max(1e-12, hi[1] - lo[1]);
    }
    return pts[pts.length - 1][0];
  };
  var q = [];
  for (var k = 0; k < n; k++) q.push(Q((k + 0.5) / n));
  return q;
}
/** Players per board in the measured mode: the sheet's cell, else data_mic's average, else LBSize. */
function wagerLeague_(cat, sheet){
  var ws = WAGER_SPECS[cat], t = wagerNum_(readSPLabel_(sheet, ws.leagueLabel));
  if (t !== null && t >= 2) return t;
  var d = micData_(ws.dataSheet);
  if (d && d.league >= 2) return d.league;
  return Math.max(2, lbSize_(sheet, LB_R_SPECS[cat].hdr) || 60);
}
/** Participation of one cell in the measured mode (null in any other mode, or with no number at all). */
function wagerPart_(cat, seg, payer, sheet){
  var ws = WAGER_SPECS[cat];
  if (!ws || !WAGER_BOTTOMUP || !sheet) return null;
  var tab = wagerTable_(sheet, ws);
  if (!tab || tab.mode !== 'scores') return null;
  var o = wagerNum_(readSPLabel_(sheet, ws.partLabel));
  if (o !== null) return o;
  var c = wagerCell_(cat, seg, payer, sheet);
  return (c && c.part !== null) ? c.part : null;
}
// D104 (2026-11-11, user decision): a player who never reaches 'Submit after' in a festival does not go
// home empty-handed - they bank their BEST streak of the festival instead, so everyone who wins a level
// is on the board. Streak level j (1 <= j < k) carries P(best streak over the festival = j)
// = G(j) - G(j + 1), G(j) = 1 - (1 - S_day(j))^D; level k keeps G(k). FLAGGED: banking the best streak
// at its peak assumes the player knows it was their best (an optimistic fallback). The sheet label
// 'Fallback: bank best streak (1 = on, 0 = off)' overrides WAGER_FALLBACK; off = D103 to rounding.
var WAGER_FALLBACK = true, WAGER_FALLBACK_LABEL = 'Fallback: bank best streak (1 = on, 0 = off)';
var _wagerTabCache = {}, _wagerCellCache = {}, _wagerDistCache = {}, _wagerPoolCache = {};
/** The behaviour table of a wager sheet: { 'seg|PAYER': {k, red, chuck, bomb, weight} } (raw cells) or null. */
function wagerTable_(sheet, ws){
  if (_wagerTabCache[sheet] !== undefined) return _wagerTabCache[sheet];
  var v = sheetVals_(sheet) || [], hr = -1, h = {}, mode = null;
  for (var r = 0; r < v.length && hr < 0; r++){
    var row = v[r] || [];
    // the table starts in column A ('Segment'); the local sim's spill repeats some headers further right
    if (String(row[0] == null ? '' : row[0]).trim() !== 'Segment') continue;
    for (var c = 0; c < row.length; c++){
      var t = String(row[c]).trim();
      if (ws.scoreLabel && t === ws.scoreLabel){ hr = r; mode = 'scores'; break; }   // D105
      if (t === ws.hdrLabel){ hr = r; mode = 'streak'; break; }
    }
  }
  if (hr < 0) return (_wagerTabCache[sheet] = null);
  (v[hr] || []).forEach(function(x, i){ var k = String(x == null ? '' : x).trim(); if (k && h[k] === undefined) h[k] = i; });
  var need = (mode === 'scores')
    ? ['Segment', 'Payer', ws.scoreLabel]
    : ['Segment', 'Payer', ws.hdrLabel, 'Red birds per win', 'Chuck birds per win', 'Bomb birds per win', 'Opponent weight'];
  for (var i = 0; i < need.length; i++) if (h[need[i]] === undefined) return (_wagerTabCache[sheet] = null);
  var tab = {};
  for (var r2 = hr + 1; r2 < v.length; r2++){
    var x = v[r2] || [], sg = String(x[h['Segment']] == null ? '' : x[h['Segment']]).trim();
    if (!sg) break;
    var key = segCanon_(sg) + '|' + String(x[h['Payer']]).trim().toUpperCase();
    if (mode === 'scores'){
      var o = {};
      for (var hn in h) o[hn] = x[h[hn]];
      tab[key] = o;
    } else tab[key] = {
      k: x[h[ws.hdrLabel]], red: x[h['Red birds per win']], chuck: x[h['Chuck birds per win']],
      bomb: x[h['Bomb birds per win']], weight: x[h['Opponent weight']] };
  }
  Object.defineProperty(tab, 'mode', { value: mode, enumerable: false });
  return (_wagerTabCache[sheet] = tab);
}
/** D105: the cell of the MEASURED layout - each input the table's number, else data_mic's. */
var MIC_SCORE_COLS = [['Top score p25', 'p25', .25], ['Top score p50', 'p50', .5], ['Top score p75', 'p75', .75],
                      ['Top score p90', 'p90', .9], ['Top score p95', 'p95', .95], ['Top score p98', 'p98', .98]];
function wagerScoreCell_(cat, seg, payer, sheet, ws, row){
  var d = micDataRow_(seg, ws.dataSheet), typed = {};
  var pick = function(col, keys){
    var t = wagerNum_(row[col]);
    if (t !== null){ typed[col] = 1; return t; }
    for (var i = 0; i < keys.length; i++) if (d[keys[i]] !== undefined) return d[keys[i]];
    return null;
  };
  var part = pick('Participation (share of active)', ['participation']);
  var avg = pick('Avg top score', ['avg top score', 'avg']);
  var pcts = [];
  MIC_SCORE_COLS.forEach(function(sc){ var x = pick(sc[0], [sc[1]]); if (x !== null) pcts.push([x, sc[2]]); });
  var weight = pick('Opponent share', ['pooled share', 'share of a typical leaderboard (avg)']);
  var scores = micScoreQuantiles_(pcts, avg, ws.nqScores);
  return { measured: true, part: part, avg: avg, pcts: pcts, weight: num(weight), scores: scores,
           p50: (pcts.filter(function(p){ return p[1] === .5; })[0] || [null])[0], typed: typed };
}

function wagerNum_(raw){
  if (raw === '' || raw == null || typeof raw === 'boolean') return null;
  var x = Number(raw);
  return (isFinite(x) && x >= 0) ? x : null;
}
/** One cell's wager inputs: the table's value where it holds a number, else the measured default. */
function wagerCell_(cat, seg, payer, sheet){
  var key = cat + '|' + sheet + '|' + segCanon_(seg) + '|' + payer;
  if (_wagerCellCache[key] !== undefined) return _wagerCellCache[key];
  var ws = WAGER_SPECS[cat], ds = Context.get().ds, tab = wagerTable_(sheet, ws);
  if (!tab) return (_wagerCellCache[key] = null);
  var row = tab[segCanon_(seg) + '|' + payer] || {};
  if (tab.mode === 'scores') return (_wagerCellCache[key] = wagerScoreCell_(cat, seg, payer, sheet, ws, row));   // D105
  var st = ds.nsStreak(seg, payer) || {}, b = ds.beh(seg, payer) || {};
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  var L = num(readSPLabel_(sheet, ws.lenLabel)) || ws.lenDefault;
  var act = (pWd > 0) ? L * pWd / (1 - Math.pow(1 - pWd, L)) : 0;       // active days in a 2-day weekday challenge
  var wins = num(st.wins_per_day_mean);
  var perWin = function(ev){
    var e = ds.eventInst(ev, seg, payer);
    return (e && wins > 0 && act > 0) ? num(e.avg_final_token_balance) / (wins * act) : 0;
  };
  var typed = {};
  var pick = function(name, dflt){ var t = wagerNum_(row[name]); if (t !== null){ typed[name] = 1; return t; } return dflt(); };
  var k = pick('k', function(){ return num(st.max_streak_per_day_p50); });
  var red = pick('red', function(){ return perWin(ws.redEv); });
  var chuck = pick('chuck', function(){ return perWin(ws.chuckEv); });
  var share = wagerNum_(readSPLabel_(sheet, 'Bomb birds per win (share of Chuck)'));
  var bomb = pick('bomb', function(){ return ((share !== null) ? share : ws.bombShare) * chuck; });
  var ev = eventInstProxy_(cat) || ws.redEv, pe = ds.eventInst(ev, seg, payer) || {};
  var weight = pick('weight', function(){ return num(pe.avg_participants_per_instance); });
  var pts = ws.mult.red * red + ws.mult.chuck * chuck + ws.mult.bomb * bomb;
  // streak survival per active day (measured percentiles), the between-player spread (Red's balances)
  var Sday = survival_([[num(st.max_streak_per_day_p25), .25], [num(st.max_streak_per_day_p50), .5],
                        [num(st.max_streak_per_day_p75), .75], [num(st.max_streak_per_day_p90), .9]]);
  var re = ds.eventInst(ws.redEv, seg, payer) || {};
  var f = wagerSpread_([[num(re.final_balance_p25), .25], [num(re.final_balance_p50), .5], [num(re.final_balance_p75), .75]], ws.nq);
  var fb = wagerNum_(readSPLabel_(sheet, WAGER_FALLBACK_LABEL));
  var fallback = (fb !== null) ? fb > 0 : WAGER_FALLBACK;
  return (_wagerCellCache[key] = { k: k, red: red, chuck: chuck, bomb: bomb, pts: pts, weight: weight,
    Sday: Sday, f: f, pWd: pWd, pWe: pWe, typed: typed, fallback: fallback });
}
/** nq multiplicative factors with mean 1: the quantiles of a distribution given as (value, cdf) points, the
 *  tail continued at the last segment's slope to cdf 1 (survival_'s shape). [1 x nq] when unusable. */
function wagerSpread_(points, nq){
  var pts = [[0, 0]];
  points.forEach(function(p){ if (p[0] > pts[pts.length - 1][0] && p[1] > pts[pts.length - 1][1]) pts.push(p); });
  var flat = []; for (var i = 0; i < nq; i++) flat.push(1);
  if (pts.length < 2) return flat;
  var a = pts[pts.length - 2], z = pts[pts.length - 1], slope = (z[1] - a[1]) / Math.max(1e-9, z[0] - a[0]);
  if (z[1] < 1 && slope > 0) pts.push([z[0] + (1 - z[1]) / slope, 1]);
  var Q = function(u){
    for (var j = 1; j < pts.length; j++) if (u <= pts[j][1]){
      var lo = pts[j - 1], hi = pts[j];
      return lo[0] + (hi[0] - lo[0]) * (u - lo[1]) / Math.max(1e-12, hi[1] - lo[1]);
    }
    return pts[pts.length - 1][0];
  };
  var q = [], m = 0;
  for (var i2 = 0; i2 < nq; i2++){ var x = Q((i2 + 0.5) / nq); q.push(x); m += x; }
  m /= nq;
  return (m > 0) ? q.map(function(x){ return x / m; }) : flat;
}
/** Banked-score model of one cell in one festival: { q: chance on the board, qk: chance to reach
 *  'Submit after', scores: [..], w: [..] (weights of the scores among those on the board, sum 1), D }. */
function wagerSide_(c, x){
  if (c && c.measured){                                // D105: a participant is someone who submitted
    var nm = c.scores.length;
    return { q: nm ? 1 : 0, qk: nm ? 1 : 0, D: 0, scores: c.scores, w: c.scores.map(function(){ return 1 / nm; }) };
  }
  if (!c || !x || !x.days || !x.days.length) return { q: 0, qk: 0, scores: [], w: [], D: 0 };
  var reach = reachOne_(x, c.pWd, c.pWe), sp = 0;
  x.days.forEach(function(d){ sp += isWeekend_(d) ? c.pWe : c.pWd; });
  var D = (reach > 0) ? sp / reach : 0;
  // G(j): P(the festival's best streak reaches j) - at least one of its D active days does
  var G = function(j){
    var s = (c.Sday && j > 0) ? Math.min(1, Math.max(0, c.Sday(j))) : 0;
    return (D > 0) ? 1 - Math.pow(1 - s, D) : 0;
  };
  var qk = (c.k > 0) ? G(c.k) : 0, lv = [];
  if (c.fallback && c.k > 0)                          // D104: below k, the best streak is banked
    for (var j = 1; j < c.k; j++){ var m = G(j) - G(Math.min(j + 1, c.k)); if (m > 0) lv.push([j, m]); }
  if (qk > 0) lv.push([c.k, qk]);
  var q = 0, scores = [], w = [], nf = c.f.length;
  lv.forEach(function(l){ q += l[1]; });
  lv.forEach(function(l){ c.f.forEach(function(fi){ scores.push(l[0] * c.pts * fi); w.push(l[1] / (q * nf)); }); });
  return { q: q, qk: qk, D: D, scores: scores, w: w };
}
/** The league's opponents in festival x, pooled: every banked score of every member cell, ascending, with
 *  its probability per seat (cell share x on the board x the score's weight). beat(s) = P(a seat beats s). */
function wagerPool_(cat, sheet, x){
  var dkey = (x.days || []).map(function(d){ return isWeekend_(d) ? 'e' : 'd'; }).join('');
  var key = cat + '|' + sheet + '|' + dkey;
  if (_wagerPoolCache[key] !== undefined) return _wagerPoolCache[key];
  var ds = Context.get().ds, opp = [], wsum = 0, ent = [];
  segMembers_(ds).forEach(function(sg){ ['NONPAYER', 'PAYER'].forEach(function(p){
    var c = wagerCell_(cat, sg, p, sheet);
    if (!c || !(c.weight > 0)) return;
    opp.push({ w: c.weight, side: wagerSide_(c, x) }); wsum += c.weight;
  }); });
  if (!(wsum > 0)) return (_wagerPoolCache[key] = null);
  opp.forEach(function(o){
    var sd = o.side, a = (o.w / wsum) * sd.q;
    for (var j = 0; j < sd.scores.length; j++) ent.push([sd.scores[j], a * sd.w[j]]);
  });
  ent.sort(function(u, v){ return u[0] - v[0]; });
  var val = [], wt = [];
  ent.forEach(function(e){
    if (val.length && val[val.length - 1] === e[0]) wt[wt.length - 1] += e[1];
    else { val.push(e[0]); wt.push(e[1]); }
  });
  var above = new Array(val.length + 1); above[val.length] = 0;     // above[i] = weight of val[i..]
  for (var i = val.length - 1; i >= 0; i--) above[i] = above[i + 1] + wt[i];
  var beat = function(s){
    var lo = 0, hi = val.length;                       // first index with val >= s
    while (lo < hi){ var mid = (lo + hi) >> 1; if (val[mid] < s) lo = mid + 1; else hi = mid; }
    var t = (lo < val.length && val[lo] === s) ? above[lo + 1] + 0.5 * wt[lo] : above[lo];
    return Math.min(1, Math.max(0, t));
  };
  return (_wagerPoolCache[key] = { beat: beat });
}
/** Place distribution of a (seg, payer) player in festival x: { dist: [{rank, p}] (mass = bank chance),
 *  q, n } or null when the table is missing. */
function wagerRankDist_(cat, seg, payer, x, sheet){
  var ws = WAGER_SPECS[cat];
  if (!ws || !WAGER_BOTTOMUP) return null;
  var dkey = (x.days || []).map(function(d){ return isWeekend_(d) ? 'e' : 'd'; }).join('');
  var key = cat + '|' + sheet + '|' + segCanon_(seg) + '|' + payer + '|' + dkey;
  if (_wagerDistCache[key] !== undefined) return _wagerDistCache[key];
  var me = wagerCell_(cat, seg, payer, sheet);
  if (!me) return (_wagerDistCache[key] = null);
  var spec = LB_R_SPECS[cat];
  var N = Math.max(2, lbSize_(sheet, spec.hdr) || 60), n = N - 1;
  // D105: the measured league size (16.3 on the live event), a mixture of the two whole sizes around it
  var nLo = n, nHi = n, fHi = 0;
  if (me.measured){
    var L = wagerLeague_(cat, sheet) - 1;
    nLo = Math.floor(L); nHi = Math.ceil(L); fHi = L - nLo; N = nHi + 1;
  }
  var pool = wagerPool_(cat, sheet, x);
  if (!pool) return (_wagerDistCache[key] = null);
  var mine = wagerSide_(me, x), acc = [];
  for (var k = 0; k < N; k++) acc.push(0);
  mine.scores.forEach(function(s, i){
    var B = pool.beat(s), k2;
    if (!me.measured){
      var pm = binomPmf_(n, B);
      for (k2 = 0; k2 <= n; k2++) acc[k2] += pm[k2] * mine.w[i];
      return;
    }
    var pl = binomPmf_(nLo, B), ph = (fHi > 0) ? binomPmf_(nHi, B) : null;
    for (k2 = 0; k2 <= nLo; k2++) acc[k2] += (1 - fHi) * pl[k2] * mine.w[i];
    if (ph) for (k2 = 0; k2 <= nHi; k2++) acc[k2] += fHi * ph[k2] * mine.w[i];
  });
  var dist = acc.map(function(p, i){ return { rank: i + 1, p: mine.q * p }; });
  return (_wagerDistCache[key] = { dist: dist, q: mine.q, n: N, cell: me, side: mine });
}
function binomPmf_(n, p){
  var out = [], i;
  if (p <= 0){ for (i = 0; i <= n; i++) out.push(i === 0 ? 1 : 0); return out; }
  if (p >= 1){ for (i = 0; i <= n; i++) out.push(i === n ? 1 : 0); return out; }
  var lq = Math.log(1 - p), lp = Math.log(p), lc = 0;      // log C(n, i), built up
  for (i = 0; i <= n; i++){
    if (i > 0) lc += Math.log(n - i + 1) - Math.log(i);
    out.push(Math.exp(lc + i * lp + (n - i) * lq));
  }
  return out;
}
/** Expected reward per festival ENTERED from the wager place distribution: { e: row, dist } or null. */
function wagerE_(cat, seg, payer, x, sheet){
  var wd = wagerRankDist_(cat, seg, payer, x, sheet);
  if (!wd) return null;
  var ladder = lbLadder_(sheet, LB_R_SPECS[cat]), E = zeroRow_();
  wd.dist.forEach(function(d){
    var rew = ladder[d.rank];
    if (!rew || !(d.p > 0)) return;
    for (var r in rew) E[r] = num(E[r]) + rew[r] * d.p;
  });
  return { e: E, dist: wd };
}

/** @customfunction
 *  Mighty Ice Cream's local sim (Mic_v2): one row per segment for `payer`, a festival of Mic_v2's
 *  EventDuration starting on a weekday - inputs, bank chance, places, paid share and payout per festival
 *  entered. Re-runs when the behaviour table is edited (Mic_v2 is a watched sheet). */
function ECOGAINS_MIC(payer, nonce){
  var cat = 'Mighty Ice Cream', spec = LB_R_SPECS[cat];
  var p = String(payer || 'NONPAYER').trim().toUpperCase();
  try {
    var ctx = Context.get(), ds = ctx.ds, sheet = spec.v2;
    if (!wagerTable_(sheet, WAGER_SPECS[cat])) return [["No 'Player behaviour (Wager)' table on " + sheet]];
    var dur = Math.max(1, Math.round(num(readSPLabel_(sheet, 'EventDuration')) || 2)), start = 1;
    for (var d = 1; d <= 14; d++){ var ok = true; for (var j = 0; j < dur; j++) if (isWeekend_(d + j)) ok = false; if (ok){ start = d; break; } }
    var x = mkInst_(start, dur), ladder = lbLadder_(sheet, spec), npaid = 0;
    for (var kk in ladder) if (+kk > npaid) npaid = +kk;
    if (wagerTable_(sheet, WAGER_SPECS[cat]).mode === 'scores') return micLocalSim_(cat, p, sheet, x, ladder, npaid, ds);   // D105
    var out = [['Segment', 'Submit after (wins)', 'Points per win', 'Banked score (median on the board)',
                'Chance to reach Submit after', 'Chance on the board', 'Place p25', 'Place p50', 'Place p75',
                'Chance of a paid place', 'Coins per festival entered', 'SPT per festival entered', 'Reward at the p50 place']];
    var segs = segMembers_(ds).concat(ds.segs().indexOf(SEG_ALL) >= 0 ? [SEG_ALL] : []);
    segs.forEach(function(sg){
      var w = wagerE_(cat, sg, p, x, sheet);
      if (!w){ out.push([segLabel_(sg, ds), 'n/a']); return; }
      var c = w.dist.cell, dist = w.dist.dist, cum = 0, pl = {}, paid = 0;
      dist.forEach(function(dd){
        cum += dd.p; if (dd.rank <= npaid) paid += dd.p;
        [.25, .5, .75].forEach(function(t){ if (pl[t] === undefined && cum >= t - 1e-12) pl[t] = dd.rank; });
      });
      var place = function(t){ return (pl[t] === undefined) ? 'not on board' : pl[t]; };
      var p50 = pl[.5], rw = (p50 !== undefined) ? (ladder[p50] || {}) : null, txt = '';
      if (!rw) txt = 'nothing (not on the board)';
      else {
        var parts = [];
        for (var r in rw) if (num(rw[r]) > 0) parts.push(r + ' ' + rw[r]);
        txt = parts.length ? parts.join(', ') : 'nothing (place ' + p50 + ' pays nothing)';
      }
      var sd = w.dist.side, ord = sd.scores.map(function(v, i){ return [v, sd.w[i]]; })
        .sort(function(u, v){ return u[0] - v[0]; }), med = 0, cw = 0;
      for (var oi = 0; oi < ord.length; oi++){ cw += ord[oi][1]; if (cw >= 0.5 - 1e-12){ med = ord[oi][0]; break; } }
      out.push([segLabel_(sg, ds), c.k, c.pts, med, sd.qk, w.dist.q, place(.25), place(.5), place(.75), paid,
                num(w.e['HC']), num(w.e['SPT']), txt]);
    });
    return out;
  } catch (e){ return [['ECOGAINS_MIC error: ' + e.message]]; }
}

/** D105: the local sim of the MEASURED layout - per segment, one festival: participation, the measured top
 *  score, the places on a board of the league size, the paid share, coins / SPT and the item_vals VALUE per
 *  festival entered, the value per player online (x participation), the reward at the median place. */
function micLocalSim_(cat, p, sheet, x, ladder, npaid, ds){
  var out = [['Segment', 'Participation (share of active)', 'Top score p50', 'Avg top score', 'Place p25', 'Place p50',
              'Place p75', 'Chance of a paid place', 'Coins per festival entered', 'SPT per festival entered',
              'Value per festival entered (item_vals)', 'Value per player online (x Participation)', 'Reward at the p50 place']];
  var segs = segMembers_(ds).concat(ds.segs().indexOf(SEG_ALL) >= 0 ? [SEG_ALL] : []);
  segs.forEach(function(sg){
    var w = wagerE_(cat, sg, p, x, sheet);
    if (!w){ out.push([segLabel_(sg, ds), 'n/a']); return; }
    var c = w.dist.cell, cum = 0, pl = {}, paid = 0;
    w.dist.dist.forEach(function(dd){
      cum += dd.p; if (dd.rank <= npaid) paid += dd.p;
      [.25, .5, .75].forEach(function(t){ if (pl[t] === undefined && cum >= t - 1e-12) pl[t] = dd.rank; });
    });
    var place = function(t){ return (pl[t] === undefined) ? 'not on board' : pl[t]; };
    var p50 = pl[.5], rw = (p50 !== undefined) ? (ladder[p50] || {}) : null, txt = '';
    if (!rw) txt = 'nothing (not on the board)';
    else {
      var parts = [];
      for (var r in rw) if (num(rw[r]) > 0) parts.push(r + ' ' + rw[r]);
      txt = parts.length ? parts.join(', ') : 'nothing (place ' + p50 + ' pays nothing)';
    }
    var val = micValue_(w.e), part = wagerPart_(cat, sg, p, sheet);
    out.push([segLabel_(sg, ds), (part === null) ? '' : part, (c.p50 === null) ? '' : c.p50, (c.avg === null) ? '' : c.avg,
              place(.25), place(.5), place(.75), paid, num(w.e['HC']), num(w.e['SPT']), val,
              (part === null) ? '' : val * part, txt]);
  });
  return out;
}
/** Coin value of a reward row at item_vals row 3 (envelopes priced; ToF tickets at the 'ToF_Value' cell). */
function micValue_(row){
  var vals = itemVals_(), s = 0;
  RESOURCES.forEach(function(r){ s += num(row[r]) * num(r === TOF_TICKET ? vals['ToF_Value'] : vals[r]); });
  return s;
}

// ---- D86 (2026-11-02, user decision): Chuck's Challenge stands in for two of Red's ----------------
// The redesign runs Red's Challenge twice instead of four times and adds Chuck's Challenge twice
// (cal_curr: no Chuck's; cal_new: two). The user's rule, hardcoded: the two lanes pay the same
// rewards, so what Red's loses moves to Chuck's. CURRENT Chuck's is 0 (measuredRowCore_), and NEW
// Chuck's is Red's NEW payout per instance x Chuck's instances, reach-weighted:
//     Chuck_new = Red_new x SUM reach(Chuck, cal_new) / SUM reach(Red, cal_new)
// On today's calendars both lanes run Mon-Tue, so this is exactly Red's CURRENT - NEW. Priced off
// Red's own simulated row (D82 anchoring included), so a Race_v2 edit to Red's rewards moves Chuck's
// the SAME way - a literal "Red's loss" would pay Chuck's MORE when Red's rewards are cut.
// FLAGGED: the export carries one real Chuck's payout (Wed Oct 28: the Oct 26-27 instance, which
// cal_curr draws as Bomb's Challenge). The rule drops it from both sides. The card sim keeps
// pricing Chuck's own Race_v2 ladder per instance. Active only while cal_curr runs NO instance of the
// lane (a cal_curr that schedules Chuck's prices it the anchored way, so an older workbook is
// untouched). LANE_STANDIN = {} restores the plain pricing.
var LANE_STANDIN = { 'Chuck Challenge': { like: 'Red Challenge' } };
/** True when `cat` is a stand-in lane on these calendars: a rule exists and cal_curr runs none of it. */
function laneStandInActive_(cat, ctx){
  if (!LANE_STANDIN[cat]) return false;
  if (!ctx){ try { ctx = Context.get(); } catch (e){ return false; } }
  if (!ctx || !ctx.calCurOk || !ctx.calNewOk) return false;
  return !(ctx.calCur[CAL_LABEL[cat]] || []).length;
}
function laneStandIn_(cat, seg, payer, ctx){
  var rule = LANE_STANDIN[cat];
  if (!rule || !laneStandInActive_(cat, ctx)) return null;
  var lane = CAL_LABEL[cat], likeLane = CAL_LABEL[rule.like];
  var b = ctx.ds.beh(seg, payer), pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)){ pWd = 1; pWe = 1; }
  var mine = reachSum_(ctx.calNew[lane] || [], pWd, pWe);
  if (!(mine > 0)) return zeroRow_();                       // the anchor side: cal_curr runs none
  var theirs = reachSum_(ctx.calNew[likeLane] || [], pWd, pWe), src, f;
  if (theirs > 0){ src = resultRow_(rule.like, seg, payer, ctx); f = mine / theirs; }
  else {
    // the redesign drops the lane it stands in for: price per instance off its CURRENT payout
    var cur = reachSum_(ctx.calCur[likeLane] || [], pWd, pWe);
    if (!(cur > 0)) return zeroRow_();
    src = measuredRow_(rule.like, seg, payer, ctx.ds); f = mine / cur;
  }
  var out = zeroRow_();
  RESOURCES.forEach(function(r){ out[r] = num(src[r]) * f; });
  return out;
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

// ---- D81 (2026-10-30): a changed duration moves the PLAYERS' TOKENS, not the rewards -----------------
// A collection event that runs D x as long (accrual share, data_event_accrual) leaves each player with
// D x the tokens. The old model multiplied the measured rewards by D and, separately, priced the _v2
// requirements against the FULL-length balance - so 'shorter and easier, same completion %' read as a
// change: the first milestones (claimed by nearly everyone either way) were cut by 30% on Jigsaw 3 -> 2
// days, and rungs near the top of the distribution were paid up to 9x as often (Jigsaw milestone 6 at
// 10-19 NONPAYER: 1.7% of players on the 3-day event, 15.1% priced for the 2-day one, ~0-2% in fact).
// Now the redesign side's milestones are reached on the survival of the SHORTER balance, S(req / D),
// and the measured rewards are not multiplied by D: R = E_v2(S(./D)) / E_base(S). The same survival
// drives the pack lane, the base-0 additions and the card sim's rungs, so they all see one event.
// Identical durations -> D = 1 -> bit-identical. A lane with no progress distribution keeps the old
// multiplier. COLL_D_PACE = false restores the old model exactly.
var COLL_D_PACE = true;
/** The pace D of a collection lane for one cell (1 when the durations match or the lane is not a
 *  priced collection). The anchor side runs with calNew := calCur, so it is always 1 there. */
function collPace_(cat, seg, payer, ctx){
  var coll = COLL_R_SPECS[cat];
  if (!COLL_D_PACE || !coll || !ctx || !ctx.calCurOk || !ctx.calNewOk) return 1;
  var lane = CAL_LABEL[cat] || cat;
  var cur = ctx.calCur[lane] || [], nw = ctx.calNew[lane] || [];
  if (!cur.length || !nw.length) return 1;
  var cd = modalDur_(cur), nd = modalDur_(nw);
  return (cd === nd) ? 1 : accrualD_(ctx.ds, coll.inst, cd, nd, seg, payer, false);
}
/** S(x / pace): the survival of a balance scaled by pace. */
function pacedSurv_(S, pace){
  if (!S || !(pace > 0) || pace === 1) return S;
  return function(x){ return S(x / pace); };
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
  // NEITHER calendar runs it (D34, 2026-09-03) -> CARRY, do not zero. "Removed from the new
  // calendar" is only meaningful against an old calendar that ran it; when both are empty the event
  // is simply absent from this comparison, and zeroing the row reported the whole measured lane as a
  // LOSS. River Rush is the case: data_gains still carries its historical rows, cal_curr does not
  // schedule it and neither does cal_new, and the grid was showing -measured on every resource as
  // though the redesign had cut it. Same principle as RM_ANCHORED / NS_ANCHORED 'auto': the
  // calendars decide, and a source neither of them runs is not a change.
  if (!nw.length && !cur.length) return meas;
  if (!nw.length) return zeroRow_();                     // removed from the new calendar (packs too)
  if (!cur.length) return meas;
  var T = timingRatio_(cur, nw, seg, payer, ctx.ds, calLabel);   // D100: lane-aware reach
  var D = dFn(modalDur_(cur), modalDur_(nw));
  // D81: a collection lane takes D through the players' balance (the redesign side's survival) instead
  // of as a reward multiplier - when its progress distribution exists to carry it
  var pace = (COLL_D_PACE && COLL_R_SPECS[cat] && D !== 1) ? D : 1;
  var E = rewardE_(cat, seg, payer, ctx.ds, null, pace);   // absolute ladder payout, both sides
  if (pace !== 1 && E) D = 1;
  // D73: instances running a variant config are priced on their own sheet, reach-weighted
  var VE = E ? laneVariantE_(cat, cur, nw, seg, payer, ctx, E, pace) : null;
  if (VE) E = VE;
  var R = {};
  if (E) RESOURCES.forEach(function(r){
    var b = num(E.eBase[r]);
    if (b > 1e-9) R[r] = num(E.eV2[r]) / b;              // base 0 -> carry (no anchor)
  });
  var out = {};
  RESOURCES.forEach(function(r){
    out[r] = num(meas[r]) * ((R[r] != null) ? R[r] : 1) * D * T;
  });
  if (E) addBase0_(out, calLabel, seg, payer, ctx, E, VE, cat);      // D79
  // D61: on the anchor side the pack E is the BASE ladder's; calNew is cal_curr there already.
  var side = _baseSide ? 'eBase' : 'eV2';
  return overlayPacks_(out, packLane_(calLabel, seg, payer, ctx,
    E && (VE ? function(inst){ return VE.perInst(inst, side); } : E[side]), E && E.inst, cat));
}

// ---- BASE-0 ADDITIONS (D79, 2026-10-30) ---------------------------------------------------------
// R = E_v2 / E_base, so a resource the BASE ladder never pays (E_base = 0) has nothing to scale and
// was CARRIED: SPT typed onto a Hatchling, Jigsaw, Target Day or challenge ladder moved no number,
// and that is the lever the 50/50 SPT split pulls (10 of the 13 event lanes pay no SPT today).
// Those resources are now priced the way envelopes always were - bottom-up on cal_new:
//     add[r] = E_v2[r] x participation x SUM_inst reach(inst)            (no D, no season cutoff)
// E_v2 is the ladder expectation R is built from (rank distribution / milestone survival), so an SPT
// on a rung is priced exactly like a coin on it, and participation is the pack lane's
// (packParticipation_). Only where E_base[r] = 0: a resource the base pays keeps measured x R x D x
// T. The anchor side (_baseSide) adds nothing - its E IS the base - so identical configs still give
// DIFF 0. The six envelopes and ToF_Ticket stay with packLane_. BASE0_BOTTOMUP = false restores
// the carry exactly.
var BASE0_BOTTOMUP = true;
function addBase0_(out, calLabel, seg, payer, ctx, E, VE, cat){
  if (!BASE0_BOTTOMUP || _baseSide || !E || !ctx.calNewOk) return out;
  var res = RESOURCES.filter(function(r){
    return BOTTOMUP_RES.indexOf(r) < 0 && !(num(E.eBase[r]) > 1e-9) && num(E.eV2[r]) > 1e-9;
  });
  if (!res.length) return out;
  var all = ctx.calNew[calLabel] || [];
  if (!all.length) return out;
  var b = ctx.ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  var part = packParticipation_(cat, E.inst);
  all.forEach(function(x){
    var e = VE ? VE.perInst(x, 'eV2') : E.eV2, q = laneReach_(calLabel, x, pWd, pWe, seg, payer);
    res.forEach(function(r){ out[r] = num(out[r]) + part * q * num(e && e[r]); });
  });
  return out;
}

// D73: E of a lane whose instances run different configs. Each side is the reach-weighted mean of
// its instances' E (cal_curr on the base sheets, cal_new on the _v2 ones), so R = blend_v2 /
// blend_base and measured x R x T carries each new instance at its own config. A side with no
// variant instance keeps E exactly. Returns null when neither calendar has a variant instance.
function laneVariantE_(cat, cur, nw, seg, payer, ctx, E, pace){
  if (!hasVariant_(cur) && !hasVariant_(nw)) return null;
  var b = ctx.ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  var byVar = { '': E };
  var eOf = function(v){
    if (byVar[v] === undefined) byVar[v] = rewardE_(cat, seg, payer, ctx.ds, v, pace) || E;
    return byVar[v];
  };
  var blend = function(list, side){
    if (!hasVariant_(list)) return E[side];
    var acc = zeroRow_(), w = 0;
    list.forEach(function(x){
      var r = laneReach_(CAL_LABEL[cat], x, pWd, pWe, seg, payer), e = eOf(x.variant || '')[side];
      w += r;
      RESOURCES.forEach(function(res){ acc[res] = num(acc[res]) + r * num(e[res]); });
    });
    if (!(w > 0)) return E[side];
    RESOURCES.forEach(function(res){ acc[res] = acc[res] / w; });
    return acc;
  };
  return { inst: E.inst, eBase: blend(cur, 'eBase'), eV2: blend(nw, 'eV2'),
           perInst: function(x, side){ return eOf((x && x.variant) || '')[side]; } };
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
  // D105: a wager event on its own data - the cell's measured participation (or the override cell)
  if (inst && inst._wagerSeg != null && WAGER_SPECS[cat]){
    var wp = wagerPart_(cat, inst._wagerSeg, inst._wagerPayer, inst._wagerSheet);
    if (wp !== null) return wp;
  }
  // D61: the authored 'Participation' label is read off the BASE sheet on the anchor side.
  var sheet = spec && (_baseSide ? ((spec.newEvent ? lbBaseSheet_(spec) : spec.base) || spec.sheet) : (spec.v2 || spec.sheet));   // D103
  if (sheet){
    var raw = readSPLabel_(sheet, 'Participation');     // generic label scan, any sheet
    var x = parseFloat(raw);
    if (raw !== null && raw !== '' && isFinite(x) && x >= 0) return x;
  }
  // D100: Kite's opt-in among ACTIVE players, measured off the join grant (kite_joiners)
  if (KITE_JOIN && cat === KITE_JOIN_CAT && inst){
    var kj = kiteJoin_(inst.segment, inst.payer_flag);
    if (kj && kj.optinActive > 0) return kj.optinActive;
  }
  if (PACK_PARTICIPATION[cat] != null) return num(PACK_PARTICIPATION[cat]);
  var p = inst ? num(inst.participation_rate) : 0;
  return (p > 0) ? p : 1;                                // no telemetry -> full participation
}

// ---- KITE JOINERS (D100, 2026-11-10, user decisions) ----------------------------------------
// Kite is opt-in, and the model had no measurement of who opts in: the pack lane priced it at the
// D25 guess 0.35, and a shorter festival lost exactly the players the WHOLE segment's daily activity
// says would miss its missing day (reach = 1 - PROD(1 - p_day)) - joiners or not. data_event_inst's
// opt_in_rate reads 2.5% in every cell (another denominator) and cannot be used.
// The by-source feed measures both. Kite pays its Unlimited Lives grant once per festival, at score
// 100 - the moment a player joins - so its daily recipients ARE the joiners by join day. The menu run
// (fillKiteJoiners_, inside Compute export scale) pools them over cal_curr's complete Kite festivals
// into the small KITE_JOIN_SHEET table; the engine reads only that table.
//   opt-in among active players = joiners per festival / players_in_cell / the festival's reach
//       (the pack lane multiplies by reach itself, so the measured rate is divided by it once)
//   join weights u_1..u_L0 = each day's share of joiners divided by that day's activity rate
//       (activity-free, so a festival on other weekdays re-weights them by its own days - user
//        decision: weekend festivals adjust by weekend activity)
// A festival SHORTER than the measured length L0 reaches
//     reach(the L0-day festival from the same start) x (K + KITE_JOIN_SHIFT x (1 - K))
//     K = SUM_{i<=dur} u_i p_day(i) / SUM_{i<=L0} u_i p_day(i)
// i.e. it keeps the joiners who would have joined by its last day, plus half of the rest (user
// decision: half of the late joiners join earlier when the festival is shorter - an assumption).
// A festival as long as L0 or longer, or cut by the window edge, keeps the plain reach (bit-identical
// to D99 on a calendar of measured-length festivals). Lost joiners take an average share of every
// rank's rewards (user decision: the rank distribution is unchanged). A cell with fewer than
// KITE_JOIN_MIN joiners per festival reads its parent's row (250+ -> 100-249); a 'Participation' label
// on Ki_v2 still overrides the measured opt-in. No table, or KITE_JOIN = false -> D99 exactly.
// NOT applied: the card sim's own attendance draw (D48) - its per-player reach of a short festival is
// still activity-based; only its Kite opt-in moves.
var KITE_JOIN = true;
var KITE_JOIN_SHEET = 'kite_joiners';
var KITE_JOIN_CAT = 'Kite Festival', KITE_JOIN_LANE = 'Kite Festival';
var KITE_JOIN_RES = 'Unlimited Lives';      // the score-100 join grant
var KITE_JOIN_SHIFT = 0.5;
var KITE_JOIN_MIN = 30;
var _kiteJoinTab;                           // undefined = not read yet (resetModuleCaches_)
function kiteJoinTab_(){
  if (_kiteJoinTab !== undefined) return _kiteJoinTab;
  _kiteJoinTab = null;
  var v = sheetVals_(KITE_JOIN_SHEET);
  if (!v || !v.length) return null;
  var hr = -1, h = {};
  for (var r = 0; r < v.length && hr < 0; r++){
    var hh = {};
    (v[r] || []).forEach(function(x, i){ var k = String(x == null ? '' : x).trim(); if (k && hh[k] == null) hh[k] = i; });
    if (hh['segment'] != null && hh['payer_flag'] != null && hh['opt_in_active'] != null){ hr = r; h = hh; }
  }
  if (hr < 0) return null;
  var uCols = [];
  Object.keys(h).forEach(function(k){ var m = /^u(\d+)$/.exec(k); if (m) uCols.push([+m[1], h[k]]); });
  uCols.sort(function(a, b){ return a[0] - b[0]; });
  if (!uCols.length) return null;
  var rows = {};
  for (var i = hr + 1; i < v.length; i++){
    var x = v[i] || [], sg = segCanon_(x[h['segment']]), py = String(x[h['payer_flag']] == null ? '' : x[h['payer_flag']]).trim().toUpperCase();
    if (!sg || !py) break;
    rows[sg + '|' + py] = { joiners: num(x[h['joiners_per_instance']]), optin: num(x[h['opt_in']]),
                            reach: num(x[h['reach_measured']]), optinActive: num(x[h['opt_in_active']]),
                            u: uCols.map(function(c){ return num(x[c[1]]); }) };
  }
  return (_kiteJoinTab = { rows: rows, L0: uCols.length });
}
/** The kite_joiners row a cell reads: its own when it has KITE_JOIN_MIN joiners per festival, else its
 *  parent's (SEG_PARENT); null without a table. */
function kiteJoin_(seg, payer){
  var tab = kiteJoinTab_();
  if (!KITE_JOIN || !tab) return null;
  var c = segCanon_(seg), py = String(payer == null ? '' : payer).trim().toUpperCase(), hops = 0;
  while (c && hops++ < 4){
    var row = tab.rows[c + '|' + py];
    if (row && row.joiners >= KITE_JOIN_MIN) return row;
    c = SEG_PARENT[c];
  }
  return null;
}
/** Reach of one instance of `lane` for a cell: the D100 joiner curve for a short Kite festival, the
 *  plain reach otherwise. */
function laneReach_(lane, x, pWd, pWe, seg, payer){ return laneReachDetail_(lane, x, pWd, pWe, seg, payer).reach; }
/** laneReach_ with its parts, for the Kite explainer (KiteExplain.gs): {reach, plain, applied, K, keep,
 *  refReach, L0}. applied = false -> reach is the plain reach (K / keep / refReach null). */
function laneReachDetail_(lane, x, pWd, pWe, seg, payer){
  var plain = reachOne_(x, pWd, pWe), out = { reach: plain, plain: plain, applied: false, K: null, keep: null, refReach: null, L0: null };
  if (!KITE_JOIN || lane !== KITE_JOIN_LANE || seg == null || !x) return out;
  var J = kiteJoin_(seg, payer), L0 = J ? J.u.length : 0;
  out.L0 = L0 || null;
  if (!J || x.clipStart || x.clipEnd || !(num(x.dur) < L0)) return out;
  var all = 0, kept = 0;
  for (var i = 0; i < L0; i++){
    var w = num(J.u[i]) * (isWeekend_(num(x.start) + i) ? pWe : pWd);
    all += w; if (i < num(x.dur)) kept += w;
  }
  if (!(all > 0)) return out;
  var K = kept / all, keep = K + KITE_JOIN_SHIFT * (1 - K), ref = reachOne_(mkInst_(num(x.start), L0), pWd, pWe);
  out.applied = true; out.K = K; out.keep = keep; out.refReach = ref; out.reach = ref * keep;
  return out;
}
function laneReachSum_(lane, list, pWd, pWe, seg, payer){
  var s = 0;
  (list || []).forEach(function(x){ s += laneReach_(lane, x, pWd, pWe, seg, payer); });
  return s;
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
var SEASON_LAST_DAY = 28;     // last day the collection season is live (calendar window is 33) -- VILLE - UPDATED TO 28
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
  var reachPack = nw.length ? laneReachSum_(calLabel, nw, pWd, pWe, seg, payer) : 0;   // D100
  var reachAll  = laneReachSum_(calLabel, all, pWd, pWe, seg, payer);
  if (!(reachAll > 0)) return out;
  var part = packParticipation_(cat, inst);
  if (typeof eV2 === 'function'){
    // D73: instances on different configs - each pays its own E at its own reach
    var accP = {}, accA = {};
    BOTTOMUP_RES.forEach(function(r){ accP[r] = 0; accA[r] = 0; });
    nw.forEach(function(x){ var e = eV2(x) || {}, q = laneReach_(calLabel, x, pWd, pWe, seg, payer);
      BOTTOMUP_RES.forEach(function(r){ accP[r] += num(e[r]) * q; }); });
    all.forEach(function(x){ var e = eV2(x) || {}, q = laneReach_(calLabel, x, pWd, pWe, seg, payer);
      BOTTOMUP_RES.forEach(function(r){ accA[r] += num(e[r]) * q; }); });
    BOTTOMUP_RES.forEach(function(r){ out[r] = part * (isPackRes_(r) ? accP[r] : accA[r]); });
    return out;
  }
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
/************************************************************************************************
 * SYNTHETIC PLAYER PROFILES (2026-09-09, D49)
 * ---------------------------------------------------------------------------------------------
 * `prof` is an optional overlay on top of a REAL (segment, payer) row: the data is still read from
 * data_seg_beh and the _v2 config sheets exactly as it always was, and the profile forces only the
 * OUTCOMES a measured curve gives a player some of the time. null - which is every existing caller
 * - leaves both helpers below as identities, so nothing that does not ask for a profile changes.
 *
 * The one profile that exists is MAX (see PLAYER_PROFILES in CardOpenings.gs): the ceiling player,
 * who attends every day, finishes first in every leaderboard, clears every milestone rung and owns
 * the whole Season Pass track. He is a BOUND, not a forecast - nobody plays like that - and he is
 * only ever run as an extra column beside the ten measured permutations, never mixed into them.
 ************************************************************************************************/
/** A milestone/collection/streak rung's probability, forced to certainty by an all-rungs profile. */
function profP_(prof, p){ return (prof && prof.allRungs) ? 1 : num(p); }
/** An event's opt-in rate, forced by a profile that takes part in everything. */
function profPart_(prof, part){ return (prof && prof.optIn != null) ? num(prof.optIn) : part; }
/** The top authored rank on a ladder - what a player who always finishes first is paid. Returns
 *  null for an empty ladder, which the callers turn into "this source pays this profile nothing". */
function topRankOf_(ladder){
  var best = null;
  for (var k in ladder) if (best === null || +k < best) best = +k;
  return best;
}

// D90 (2026-11-02): THE ANCHOR SIDE'S RUNGS COME OFF THE BASE LADDERS. packRungs_ read the _v2 sheets
// whatever the side, so every card-sim batch that runs "cal_curr on the base ladders" (D67's measured
// side of Col - Sets / Col - Albums, D89's calibration pass and current season) was in fact the REDESIGN's
// ladders on the current calendar - Night Sky's base round 1 pays no envelope and round 3 a 3-star, and the
// anchor batch drew the redesign's 1-star and 1-star + 4-star instead. Found by the D89 calibration, whose
// model side granted no Night Sky 3-star at all. Now, on _baseSide: leaderboards read spec.base (a
// variant its base twin, D73), collections the base sheet with the base requirement axis, Night Sky NS /
// NS_weekday by day type (D61d), Rainbow Maker the base RM_1st / RM_2nd. The simulated side is untouched.
// PACK_RUNGS_BASE = false restores the v2-only read.
var PACK_RUNGS_BASE = true;
function packRungs_(cat, seg, payer, ctx, instOrdinal, prof){
  var ds = ctx.ds;
  var baseRungs = PACK_RUNGS_BASE && (typeof _baseSide !== 'undefined') && _baseSide;
  function packsOf(rew){
    var o = null;
    PACK_RES.forEach(function(r){ if (num(rew[r]) > 0){ o = o || {}; o[r] = num(rew[r]); } });
    return o;
  }
  // ToF_Ticket on the same rung (D31, 2026-09-03). The ticket is not an envelope, so it never goes
  // into `packs` - the card sim would try to OPEN it. It rides alongside as its own number, drawn
  // on the same rung event: a player who reaches Jigsaw milestone #2 is handed the 2 tickets that
  // rung pays, not a slice of the population average.
  function tkOf(rew){ return num(rew[TOF_TICKET]); }
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
    // A rung that pays ONLY tickets is still a rung. Keeping it does not change any rung's own
    // probability (the exclusive walk accumulates each rung's own p), so pack expectations are
    // untouched - it only means the ticket-paying rows now exist to be drawn.
    rungs = rungs.filter(function(x){ return (x.packs || x.tickets > 0) && x.p > 0; });
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
    // D73: the instance's own config when it runs a variant (the plan's start-sorted ordinal)
    var lbLane = (typeof DAILY_CAL_LABEL !== 'undefined' && DAILY_CAL_LABEL[cat]) || CAL_LABEL[cat];
    var lbInsts = ((ctx.calNew && ctx.calNew[lbLane]) || []).slice().sort(function(x, y){ return x.start - y.start; });
    var lbI = lbInsts[Math.max(0, Math.min(instOrdinal || 0, lbInsts.length - 1))];
    if (lbI && lbI.variant) lb = variantSpec_(lb, lbI.variant);
    var lbSheet = (baseRungs && lb.base) ? lbBaseSheet_(lb) : lb.v2;     // D90; D102: a new event's base
    var v = sheetVals_(lbSheet);
    // The SAME ladder + rank CDF lbE_ prices E from, so the card sim's discrete draw and the gains
    // model's expectation reconcile by construction (see lbRankDist_).
    var rdk = lbRankDist_(lbSheet, lb, inst), ladder = rdk.ladder;
    if (WAGER_SPECS[cat] && WAGER_BOTTOMUP && lbI){                 // D103: the wager's own places
      var wdk = wagerRankDist_(cat, seg, payer, lbI, lbSheet);
      if (wdk) rdk = { ladder: ladder, dist: wdk.dist };
    }
    var rungs;
    if (prof && prof.rankTop){
      // FIRST PLACE, every time. The ladder's TOP AUTHORED rank at probability 1 - deliberately not
      // the top PAYING rank: if rank 1 pays no envelope while rank 5 does, a player who always wins
      // gets none from this source. That is a finding about the ladder, and papering over it here
      // would hide it behind a number nobody could reproduce from the sheet.
      var top = topRankOf_(ladder), tw = (top == null) ? {} : (ladder[top] || {});
      rungs = [{ label: 'rank ' + (top == null ? 1 : top) + ' (always first)', p: 1,
                 packs: packsOf(tw), tickets: tkOf(tw) }];
    } else if (LB_RANK_MODEL === 'cdf' && rdk.dist){
      rungs = rdk.dist.map(function(d){
        var rw = ladder[d.rank] || {};
        return { label: 'rank ' + d.rank, p: d.p, packs: packsOf(rw), tickets: tkOf(rw) };
      });
    } else {
      rungs = pos.map(function(pp){
        var rw2 = ladder[pp] || {};
        return { label: 'rank ' + pp, p: 1 / pos.length, packs: packsOf(rw2), tickets: tkOf(rw2) };
      });
    }
    var part = profPart_(prof, packParticipation_(cat, wagerInstFor_(cat, inst, seg, payer, lbSheet)));   // D105
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
          var mrw = rewRow_(v, mr, mCols);
          msRungs.push({ label: 'score milestone (req ' + mreq + ')', p: profP_(prof, Sk(mreq)),
                         req: mreq, packs: packsOf(mrw), tickets: tkOf(mrw) });
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
    S = pacedSurv_(S, collPace_(cat, seg, payer, ctx));      // D81: the rungs of the event as it runs
    var reqs = collReqs_(coll);
    if (!reqs.length) return null;
    var vr = baseRungs ? reqs : collReqsV2_(coll, reqs);     // D84; D90: the base axis on the anchor side
    var cv = sheetVals_(baseRungs ? coll.base : coll.v2), ccols = rewCols_(cv, coll.hdr, coll.c0, coll.c1);
    var crungs = [], lastReq = 0;
    for (var i = 0; i < vr.length; i++){
      var req = vr[i];
      if (!(req > 0)) continue;
      lastReq = req;
      var crw = rewRow_(cv, coll.r0 + i, ccols);
      crungs.push({ label: 'milestone #' + (i + 1) + ' (req ' + req + ')', p: profP_(prof, S(req)),
                    req: req, packs: packsOf(crw), tickets: tkOf(crw) });
    }
    if (coll.completionRow != null && lastReq > 0)
      crungs.push({ label: 'completion bonus (req ' + lastReq + ')', p: profP_(prof, S(lastReq)),
                    req: lastReq, packs: packsOf(rewRow_(cv, coll.completionRow, ccols)),
                    tickets: tkOf(rewRow_(cv, coll.completionRow, ccols)) });
    var cpart = profPart_(prof, packParticipation_(cat, ci));
    return mk(cpart, false, crungs);   // cumulative ladder: rungs fire independently
  }

  if (cat === 'Daily Night Sky Prize' && segIsAll_(seg)){
    // D94: an ALL player has no ladder. Their Night Sky rungs are every member segment's rounds, each at
    // that segment's own streak survival and opt-in, times the segment's share of the players - so the
    // expected envelopes are the pooled population's. (One real player is in one segment; an 'ALL'
    // player is the average of them - flagged, the same approximation as the ALL row itself.)
    var allRungs = [];
    segMix_(payer, ds).forEach(function(x){
      var one = packRungs_(cat, x.seg, payer, ctx, instOrdinal, prof);
      if (!one) return;
      (one.groups || []).forEach(function(g){
        (g.rungs || []).forEach(function(rg){
          allRungs.push({ label: rg.label + ' [' + segLabel_(x.seg, ds) + ']', p: num(rg.p) * num(one.participation) * x.w,
                          req: rg.req, progress: rg.progress, packs: rg.packs, tickets: rg.tickets });
        });
      });
    });
    return allRungs.length ? { participation: 1, groups: [{ exclusive: false, rungs: allRungs }] } : null;
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
    var nsLad = baseRungs ? nsBaseLadderForDay_(seg, nsDay) : nsLadderForDay_(seg, nsDay);   // D90
    var nrungs = nsLad.map(function(ms, k){
      return { label: 'round ' + (k + 1) + ' (cum streak req ' + ms.req + ')' +
                      (isWeekend_(nsDay) ? ' [weekend]' : ' [weekday]'), p: profP_(prof, Sn(ms.req)),
               req: ms.req, packs: packsOf(ms.rew), tickets: tkOf(ms.rew) };
    });
    var ni = ds.eventInst('Night Sky', seg, payer);
    var npart = profPart_(prof, packParticipation_(cat, ni));
    return mk(npart, false, nrungs);
  }

  if (cat === 'Rainbow Maker'){
    var pct = ds.rmPct(seg, payer);
    if (!pct && !rmLive_(seg, payer)) return null;       // D77
    var insts = rmSortedInsts_(ctx.calNew);
    var idx = Math.max(0, Math.min(instOrdinal || 0, Math.max(0, insts.length - 1)));
    var rinst = insts[idx] || null;
    var cfg = rmConfigForInst_(rinst, baseRungs);             // D90: the base RM_1st / RM_2nd on the anchor side
    if (!cfg.ladder.length) return null;
    // D72: the same in-window rung probability simRainbowMaker prices (cut-offs included), so the
    // card sim and the gains model agree per instance
    var rgeo = rmGeo_(ctx, ctx.calNew, cfg);
    var Pr = rmRungP_(rinst || { start: 1, dur: rgeo.Dm }, cfg, pct, seg, payer, ds, 1, windowDays_(), rgeo);
    if (!Pr) return null;
    var rrungs = cfg.ladder.map(function(ms, k){
      return { label: 'milestone #' + (k + 1) + ' (req accum ' + ms.req + ')', p: profP_(prof, Pr(ms.req, 'ALL')),
               req: ms.req, packs: packsOf(ms.rew), tickets: tkOf(ms.rew) };
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
      var g = (prof && prof.rankTop)
        ? [{ label: tag + 'rank 1 (always first)', p: 1,
             packs: packsOf(byPos[1] || {}), tickets: tkOf(byPos[1] || {}) }]
            .filter(function(x){ return x.packs || x.tickets > 0; })
        : bdist
        ? bdist.map(function(d){
            var bw = byPos[d.rank] || {};
            return { label: tag + 'rank ' + d.rank, p: d.p, packs: packsOf(bw), tickets: tkOf(bw) };
          }).filter(function(x){ return x.packs || x.tickets > 0; })
        : use.map(function(pp){
            var bw2 = byPos[pp] || {};
            return { label: tag + 'rank ' + pp + suffix, p: 1 / use.length, packs: packsOf(bw2), tickets: tkOf(bw2) };
          }).filter(function(x){ return x.packs || x.tickets > 0; });
      // Each BLOCK is its own exclusive draw: a Team Event participant places once on the team
      // leaderboard AND once on the contribution ladder, so both groups fire.
      if (g.length) groups.push({ exclusive: true, rungs: g });
    });
    if (!groups.length) return null;
    var ppart = profPart_(prof, packParticipation_(cat, pi));
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
        collE_(coll.v2, coll, collReqsV2_(coll, reqs), pacedSurv_(S, collPace_(cat, seg, payer, ctx)), prov);   // D84
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
    var cfg = rmConfigForInst_(rmSortedInsts_(ctx.calNew)[0] || null);
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

// ============================== THE ANCHOR SIDE OF WHAT THE EXPORT CANNOT SEE (D61, 2026-10-14) ==
// data_gains has no pack rows, no ToF_Ticket rows and no ToF category, so the measured side of
// every one of those read 0 by construction and the DIFF showed them as additions - even on a
// workbook whose two calendars and every config are IDENTICAL, where the user rightly expects a
// DIFF of exactly nothing. The D29 answer for Rainbow Maker is generalised here (user decision,
// 2026-10-14): SYNTHESISE the measured side by running the source's own simulator over cal_curr
// with the BASE config, and keep only the bottom-up columns of what comes back.
//
//   measured[packs, ticket] = the source's sim, with calNew := calCur and every pack E read off
//                             the BASE ladder (eBase, c_day, Ki rather than Ki_v2 ...)
//   simulated               = unchanged: the same sim over cal_new on the _v2 config
//
// So identical calendars + identical ladders give DIFF 0 on every pack column, and an edit moves
// exactly what it edits. `_baseSide` is the switch the pack-pricing call sites consult (timedCore_,
// Night Sky, Daily Gift, packParticipation_); the anchor run clones ctx with calNew := calCur.
// Recursion is cut at measuredRow_: while an anchor run is in flight every measured row is the
// plain export, which is what the inner sim needs anyway.
// PACK_ANCHORED = false restores the pre-D61 measured side (0 packs) bit for bit; the simulated
// side is untouched either way (gated).
var PACK_ANCHORED = true;
var _baseSide = false;
var _packAnchorCache = {};
// Sources anchored their own way (RM: D29/D61 merge; ToF: tofSynth_; Season Pass: the track up to
// the measured tier) or that pay no pack at all.
var PACK_ANCHOR_SKIP = { 'Rainbow Maker':1, 'ToF':1, 'Season Pass (Free)':1, 'Season Pass (Paid)':1,
                         'Core':1, 'Saga':1, 'River Rush':1, 'Col - Sets':1, 'Col - Albums':1,
                         'Mighty Ice Cream':1 };   // D102: anchors itself (newLbSim_)

/** ctx with cal_curr on BOTH calendar slots, its own SPT memo, flagged as the anchor side. */
function baseCtx_(ctx){
  var c = {};
  for (var k in ctx) c[k] = ctx[k];
  c.calNew = ctx.calCur; c.calNewOk = ctx.calCurOk;
  c._spt = {}; c._sptBusyKeys = {}; c._x2min = {}; c._baseSide = true;   // fresh bags: never shared with the live side
  return c;
}
function bottomUpHasData_(row){
  for (var i = 0; i < BOTTOMUP_RES.length; i++) if (num(row[BOTTOMUP_RES[i]]) > 0) return true;
  return false;
}
function anyAmount_(row){
  for (var i = 0; i < RESOURCES.length; i++) if (num(row[RESOURCES[i]]) !== 0) return true;
  return false;
}
/** The bottom-up columns of `cat` on the anchor side, or null when it cannot be priced. */
function packAnchorRow_(cat, seg, payer){
  if (!PACK_ANCHORED || _baseSide || PACK_ANCHOR_SKIP[cat]) return null;
  var key = cat + '|' + seg + '|' + payer;
  if (_packAnchorCache[key] !== undefined) return _packAnchorCache[key];
  var fn = SOURCES[cat], pack = PACK_ONLY_SPECS[cat];
  if (!fn && !pack) return (_packAnchorCache[key] = null);
  var ctx;
  try { ctx = Context.get(); } catch (e){ return null; }
  if (!ctx || !ctx.calCurOk) return (_packAnchorCache[key] = null);
  var bctx = baseCtx_(ctx), row = null;
  _baseSide = true;
  try { row = pack ? packOnlyRow_(cat, seg, payer, bctx) : simFor_(cat, seg, payer, bctx); }   // D94: ALL = its members pooled
  finally { _baseSide = false; }
  if (!row) return (_packAnchorCache[key] = null);
  var out = {};
  BOTTOMUP_RES.forEach(function(r){ out[r] = num(row[r]); });
  return (_packAnchorCache[key] = out);
}
function copyRow_(row){ var o = {}; RESOURCES.forEach(function(r){ o[r] = num(row[r]); }); return o; }

// ---- D82 (2026-11-01): what the export measures is the LEVEL, the model is the CHANGE ----------
// Where data_gains carries a source's envelopes / ToF tickets (LIVE_OPS_V3 (8) carries all six tiers
// and the ticket), the MEASURED side is that export (measuredRow_), while the simulated side was the
// bottom-up ladder walk in absolute terms. The two are different instruments, so with the SAME
// calendar and the SAME configs the DIFF was not zero: Target Day 5-star 1.89 in the data against
// 0.18 from its ladder, 3-/4-/5-star -20/-24/-78% overall, tickets +17%. The Rainbow Maker rule of D61
// is applied to them: per resource, simulated = export x model_new / model_cur, where model_cur is the
// same walk over cal_curr on the base config (packAnchorRow_ - the measured side's own synthetic when
// the export is silent). A tier the base never paid but the export shows is export + the redesign's
// addition; a tier the export shows as 0 while the base walk pays it stays 0 (the data wins); a tier
// neither pays is the redesign's addition. Only when the export carries the category's bottom-up
// columns at all (bottomUpHasData_ - the same test measuredRow_ uses), so a pull without them is
// bit-identical. Rainbow Maker and ToF anchor themselves (simRainbowMaker, simToF); the card sim keeps
// drawing at the model's level (both sides, common seeds - D67). EXPORT_ANCHORED = false restores the
// pre-D82 simulated side exactly.
var EXPORT_ANCHORED = true;
function anchorOne_(m, c, n){
  if (c > 1e-9) return m * n / c;           // the export level x the model's change
  if (m > 0) return m + n;                  // the base walk never paid it: the export plus the addition
  return n;                                 // neither the data nor the base: an addition
}
function exportAnchorBottomUp_(cat, seg, payer, ctx, row){
  if (!EXPORT_ANCHORED || _baseSide || !row || seg === 'A. 0' || seg === 'A.0') return row;
  if (PACK_ANCHOR_SKIP[cat] && cat !== 'Season Pass (Free)') return row;
  var exp = measuredRowCore_(cat, seg, payer, ctx.ds);
  if (!bottomUpHasData_(exp)) return row;
  var anc = (cat === 'Season Pass (Free)') ? spFreePacksSynth_(seg, payer, ctx.ds) : packAnchorRow_(cat, seg, payer);
  if (!anc) return row;
  var out = copyRow_(row);
  BOTTOMUP_RES.forEach(function(r){ out[r] = anchorOne_(num(exp[r]), num(anc[r]), num(row[r])); });
  return out;
}

// ---- pack-only sources (D19/3) -------------------------------------------------------------
// Team Event is CARRIED in the gains model (no simulator, no _v2 sheet), but it does have a config
// sheet with the pack columns and a calendar lane — so its pack columns are simulated bottom-up
// while every other resource stays measured.
//   TE  — 'Team Event' sheet: a 7-place Team Leaderboard block AND a 3-place Contribution
//         Rewards block; a participant is paid from both, so the two are SUMMED.
// Flock Flurry ('F', one 5-position goal ladder) was the second one until D91 made it a simulated
// leaderboard (FLOCK_SIMULATED, below LB_R_SPECS); FLOCK_PACK_ONLY_SPEC is its D19 entry.
// Team Race has a calendar lane but NO config sheet -> no packs (same rule as Ads / IAPs).
// 0-based row/col indices into sheetVals_(); reward blocks span Coins..6-star Dly (c0..c1).
var PACK_ONLY_SPECS = {
  'Team Event'  : {sheet:'TE', cal:'Team Event',   inst:'Team Event',
                   blocks:[{hdr:14, r0:15, r1:21, c0:1, c1:21},    // Team Leaderboard, 1st..7th
                           {hdr:24, r0:25, r1:27, c0:1, c1:21}]}   // Contribution Rewards, 1st..3rd
};
var FLOCK_PACK_ONLY_SPEC = {sheet:'F',  cal:'Flock Flurry', inst:'Flock Flurry',
                            blocks:[{hdr:9,  r0:10, r1:14, c0:1, c1:21}]};   // Goals and Rewards, pos 1..5

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
// ---- the REDESIGN's ToF sheet (D79, 2026-10-30) ------------------------------------------------
// The engine read the ToF sheet only, so every edit to ToF_v2 moved nothing (flagged since D61).
// The simulated side now reads ToF_v2 when the workbook has one - the rule every other source
// follows - and the anchor side keeps the base sheet: _baseSide (D61's base batches, the D67 card
// batch) and the measured ToF anchor (tofSynth_, which raises _tofBaseDepth while it walks). The
// SEGMENT BEHAVIOUR block is part of the sheet, so each side also reads its own take-up, cash-out
// and runs-per-day assumptions. Identical sheets give identical rows; a missing ToF_v2 falls back
// to ToF. TOF_V2_CONFIG = false restores the base-only read.
var TOF_V2_CONFIG = true, TOF_V2_SHEET = 'ToF_v2';
var _tofBaseDepth = 0;
function tofSide_(){ return (!TOF_V2_CONFIG || _baseSide || _tofBaseDepth > 0) ? 'base' : 'v2'; }
function tofSheetVals_(){
  if (tofSide_() === 'v2'){
    var v2 = sheetVals_(TOF_V2_SHEET);
    if (v2 && v2.length) return v2;
  }
  for (var i = 0; i < TOF_SHEET_NAMES.length; i++){
    var v = sheetVals_(TOF_SHEET_NAMES[i]);
    if (v && v.length) return v;
  }
  return [];
}
var TOF_AFFORD_H   = 1;      // headroom at half willingness (user-approved 2026-09-02; was 4)
var TOF_BAL_PCTS   = ['hc_balance_p25','hc_balance_p50','hc_balance_p75','hc_balance_p90'];
var TOF_PAYER_TOPUPS = 1;    // one purchased continue per run, PAYER only
// false (D34, shipped): the ToF row is a GAINS row like every other row in the grid, and the
// continue spend is reported on the ToF sheet's RUN block instead. true nets the spend into the
// row's own HC, which is what it did until 2026-09-03.
var TOF_SPEND_IN_ROW = false;

// Row index of an MD block, found by its column-A bar label (prefix match at a word boundary, the
// same resolution loadPackConfig_ uses) so inserting a row above it cannot break the reader.
//
// Matching is CASE-INSENSITIVE and ignores a trailing plural, because a bar is a title someone
// types and titles get tidied. The live workbook renamed 'CONTINUE COST' to 'CONTINUE COSTs'
// (2026-09-02) and the word-boundary rule rejected it -- the 's' is alphanumeric, so it read as a
// different block. The continue ladder then came back EMPTY, which is not an error state anywhere
// in the model: no rungs means no continue is ever offered, so every segment's spend went to 0 and
// P(run pays) collapsed, with nothing on the sheet saying why. One renamed word, silently.
function mdBlock_(v, label){
  var want = mdNormLabel_(label);
  for (var r = 0; r < v.length; r++){
    var a = mdNormLabel_((v[r] || [])[0]);
    if (a === want) return r;
    if (a.indexOf(want) === 0 && (a.length === want.length || /[^a-z0-9]/.test(a.charAt(want.length))))
      return r;
  }
  return -1;
}
// lower-cased, trimmed, trailing plural dropped ('CONTINUE COSTs' -> 'continue cost').
function mdNormLabel_(x){
  var s = String(x == null ? '' : x).trim().toLowerCase();
  return /[a-z]s$/.test(s) ? s.slice(0, -1) : s;
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
var _tofCfgCache = {};                                    // D79: one config per side (tofSide_)
function tofConfig_(){
  var _side = tofSide_();
  if (!_tofCfgCache) _tofCfgCache = {};                    // a harness still nulls the old scalar memo
  if (_tofCfgCache[_side] !== undefined) return _tofCfgCache[_side];
  var v = tofSheetVals_();
  if (!v.length) return (_tofCfgCache[_side] = false);

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
  if (sb < 0) return (_tofCfgCache[_side] = false);
  var hdr = mdHeaderRow_(v, sb, 'Stage');
  if (hdr < 0) return (_tofCfgCache[_side] = false);
  var cols = {}, c;
  for (c = 0; c < (v[hdr] || []).length; c++){
    var h = String(v[hdr][c] == null ? '' : v[hdr][c]).trim();
    if (h) cols[h] = c;
  }
  var rewCols = {};
  for (var hh in cols){ var res = RES_MAP[hh]; if (res && rewCols[res] == null) rewCols[res] = cols[hh]; }

  // ---- SLOT MODEL (2026-09-09) --------------------------------------------------------------
  // The STAGES block used to be one row per stage carrying 'Survive p' and 'P(reward | survived)'.
  // It is now one row per SLOT: each stage lists the doors the player is shown, and each door is a
  // 'card type' of reward / pig / empty. The player picks one at random from the doors that are
  // actually presented, so:
  //
  //   nonEmpty = slots whose type is not 'empty'      (what the player sees: 2, 3 or 4 doors)
  //   H        = P(survive) = 1 - pigs / nonEmpty
  //   rew      = the reward GIVEN SURVIVAL = the arithmetic MEAN of the reward slots
  //
  // `rew` is conditional on purpose. tofRunOnce_ pays the pot as `rew x I x pBank` and pBank is
  // already P(survived to cash-out), so pricing the stage unconditionally here would apply survival
  // twice and shrink every banked pot by a factor of H per stage. I is pinned to 1: the old
  // "survived but got nothing" probability is now expressed directly, as a reward slot whose
  // amounts are all zero.
  //
  // The sheet's own 'p' column is NOT read (user decision): the choice is uniform over the doors
  // presented, so p is derived as 1/nonEmpty and cannot drift from the slot rows beside it. The
  // 'Empty Slots' column is vestigial and likewise ignored - emptiness is already stated by the
  // slot's own type.
  if (cols['card type'] == null)
    throw new Error("ToF STAGES has no 'card type' column. This engine reads the SLOT layout " +
                    '(one row per door, card type = reward / pig / empty). A sheet still on the ' +
                    "old one-row-per-stage layout ('Survive p' / 'P(reward | survived)') must be " +
                    'rebuilt to the slot layout - the old reader was removed 2026-09-09.');

  var stages = [], order = [], byN = {};
  for (var r = hdr + 1; r < v.length; r++){
    var sn = num(v[r] && v[r][cols['Stage']]);
    if (!(sn > 0)) break;
    var kind = String(v[r][cols['card type']] == null ? '' : v[r][cols['card type']]).trim().toLowerCase();
    // Closed set. An unrecognised word becomes 'empty' - it contributes nothing and is logged -
    // rather than silently becoming a payable door.
    if (kind !== 'reward' && kind !== 'pig' && kind !== 'empty'){
      try { Logger.log('ToF stage ' + sn + ': unrecognised card type "' + kind + '" - treated as ' +
                       'empty. Expected reward / pig / empty.'); } catch(e){}
      kind = 'empty';
    }
    var rew2 = {};
    for (var res2 in rewCols){ var amt = num(v[r][rewCols[res2]]); if (amt) rew2[res2] = amt; }
    // Defensive: only a reward door can pay. A number left on a pig or empty row by a half-cleared
    // copy-paste is dropped, and said out loud once per stage so the drop is never invisible.
    if (kind !== 'reward'){
      var stray = false;
      for (var sres in rew2) { stray = true; break; }
      if (stray){
        try { Logger.log('ToF stage ' + sn + ': a "' + kind + '" slot carries reward amounts - ' +
                         'ignored. Only reward slots pay.'); } catch(e){}
        rew2 = {};
      }
    }
    if (byN[sn] == null){
      byN[sn] = { n: sn, type: String(v[r][cols['Type']] || '').trim(), slots: [] };
      order.push(sn);
    }
    byN[sn].slots.push({ kind: kind, rew: rew2 });
  }

  order.forEach(function(sn){
    var s = byN[sn], nonEmpty = 0, pigs = 0, rewSlots = [];
    s.slots.forEach(function(sl){
      if (sl.kind === 'empty') return;
      nonEmpty++;
      if (sl.kind === 'pig') pigs++; else rewSlots.push(sl.rew);
    });
    // A stage with no door at all cannot be played. Auto-survive with no reward, and say so: the
    // alternative readings (skip the stage, or kill every run) both change the ladder silently.
    if (nonEmpty === 0){
      try { Logger.log('ToF stage ' + sn + ': every slot is empty - no door to pick. Treated as ' +
                       'auto-survive paying nothing.'); } catch(e){}
      stages.push({ n: s.n, type: s.type, H: 1, I: 1, rew: {}, nonEmpty: 0, pigs: 0 });
      return;
    }
    if (nonEmpty < 2)
      try { Logger.log('ToF stage ' + sn + ': only ' + nonEmpty + ' door is presented (the design ' +
                       'minimum is 2), so that outcome is certain.'); } catch(e){}
    var H = 1 - pigs / nonEmpty;
    var rew = {};
    if (rewSlots.length){
      rewSlots.forEach(function(rw){
        for (var res in rw) rew[res] = num(rew[res]) + num(rw[res]);
      });
      for (var res3 in rew) rew[res3] = rew[res3] / rewSlots.length;   // MEAN, given survival
    }
    // `doors` is the slot list with the empties removed, in sheet order - EXACTLY what the player
    // is shown. The gains model never needs it (it works in expectations), but the card sim walks a
    // run door by door and has to pick a real one, so the structure is kept rather than collapsed
    // into H and a mean. Both models then read the same rows: there is no second ladder to drift.
    var doors = [];
    s.slots.forEach(function(sl){ if (sl.kind !== 'empty') doors.push(sl); });
    stages.push({ n: s.n, type: s.type, H: H, I: 1, rew: rew,
                  nonEmpty: nonEmpty, pigs: pigs, doors: doors });
  });

  if (!stages.length) return (_tofCfgCache[_side] = false);
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

  // A ToF sheet with no readable continue ladder is a real configuration, but it is almost never
  // the intended one: it silently means nobody ever continues, so spend is 0 everywhere and P(run
  // pays) is the bare survival product. Say so in the log rather than letting the zeros speak.
  if (!cfg.costs.length)
    try { Logger.log('ToF: no CONTINUE COST rungs were read - no continue will ever be bought, ' +
                     'so every segment reports 0 coins spent. Check the block bar and the ' +
                     '"Continue #" header, and that rung prices are values rather than ' +
                     'uncached formulas.'); } catch(e){}

  // ---- per-segment behaviour ----
  var sbh = mdBlock_(v, 'SEGMENT BEHAVIOUR');
  cfg.beh = {}; cfg.behBy = {};
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
      var behRow = {
        continueP:   num(v[r3][contC]),
        cashOut:     num(v[r3][bc['Cash-Out Stage']]),
        runsPerDay:  num(v[r3][bc['Runs per Active Day']]),
        maxContinues: (bc['Max Continues per Run'] != null) ? num(v[r3][bc['Max Continues per Run']]) : 0,
        balance:     (balC != null) ? num(v[r3][balC]) : 0
      };
      cfg.beh[segName] = behRow;
      // D94: the same row under its own payer flag, when the block has a Payer column (tofBeh_)
      if (bc['Payer'] != null){
        var pf = String(v[r3][bc['Payer']] == null ? '' : v[r3][bc['Payer']]).trim().toUpperCase();
        if (pf) cfg.behBy[segName + '|' + pf] = behRow;
      }
    }
  }
  return (_tofCfgCache[_side] = cfg);
}

// ---- which SEGMENT BEHAVIOUR row a (segment, payer) reads (D94, 2026-11-05) ---------------------
// Rows are found by the segment's config labels (segCfgKeys_): its own spelling, an alias ('100-249'
// reads a row called '100+'), then its parent's ('250+' reads the 100+ row until it is given one).
// ALL has no row unless one is authored: it reads the member segments' rows averaged by their
// players - an ASSUMPTION, used by the card sim's ALL player and the anchor walk (the ALL ToF row of
// the gains grid is the member segments pooled, mixRow_).
// TOF_BEH_BY_PAYER (default FALSE = the engine as it has always run): the block carries one row per
// (segment, payer) since the D53 layout, but cfg.beh is keyed by segment alone, so the LAST row of a
// segment - the PAYER one - is what every player of it reads, non-payers included (continue take-up
// 0.08 for a 0-9 non-payer where the sheet authors 0.05). true reads each payer flag's own row.
// FLAGGED, not switched on: it moves every non-payer ToF number, and nobody asked for that here.
var TOF_BEH_BY_PAYER = false;
function tofBeh_(cfg, seg, payer){
  if (!cfg || !cfg.beh) return null;
  var keys = segCfgKeys_(seg), pf = String(payer == null ? '' : payer).trim().toUpperCase();
  // a row name that is not a segment at all (the MAX ceiling row) is read as written
  var raw = String(seg == null ? '' : seg).trim();
  if (keys.indexOf(raw) < 0) keys.unshift(raw);
  for (var k = 0; k < keys.length; k++){
    if (TOF_BEH_BY_PAYER && pf && cfg.behBy && cfg.behBy[keys[k] + '|' + pf]) return cfg.behBy[keys[k] + '|' + pf];
    if (cfg.beh[keys[k]]) return cfg.beh[keys[k]];
  }
  if (!segIsAll_(seg)) return null;
  cfg._allBeh = cfg._allBeh || {};
  if (cfg._allBeh[pf] !== undefined) return cfg._allBeh[pf];
  var ds, mix;
  try { ds = Context.get().ds; mix = segMix_(pf || 'NONPAYER', ds); } catch (e){ mix = []; }
  var acc = { continueP: 0, cashOut: 0, runsPerDay: 0, maxContinues: 0, balance: 0 }, wsum = 0;
  mix.forEach(function(x){
    var b = tofBeh_(cfg, x.seg, pf);
    if (!b) return;
    for (var f in acc) acc[f] += x.w * num(b[f]);
    wsum += x.w;
  });
  if (!(wsum > 0)) return (cfg._allBeh[pf] = null);
  for (var f2 in acc) acc[f2] = acc[f2] / wsum;
  // stages, run counts and continue caps are whole numbers on the sheet
  acc.cashOut = Math.round(acc.cashOut); acc.maxContinues = Math.round(acc.maxContinues);
  return (cfg._allBeh[pf] = acc);
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
  var beh = tofBeh_(cfg, seg, payer);                       // D94
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
      // D94: canonical segment match; a cell the pull has no wallet for reads its parent's (250+ -> 100-249)
      var want = segCanon_(seg), hops = 0;
      while (want && !out.length && hops++ < 4){
        for (var i = 1; i < v.length; i++){
          var r = v[i];
          if (segCanon_(r[h['segment']]) !== want) continue;
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
        want = SEG_PARENT[want];
      }
    }
  }
  return (_tofBalCache[key] = out);
}

// Per-day ToF_Ticket income from EVERY OTHER source on cal_new. Excludes ToF itself, both because
// its own payout is fed back inside the day walk and because dailySeries_('ToF') would re-enter
// this function -- the one genuine recursion risk in the wiring.
// `skip` (D31): categories to leave OUT - the card sim draws those per rung and would otherwise
// count them twice. The ENGINE never passes it, so the ToF run budget still sees the whole faucet.
var _tofIncomeCache = {};
// `measured` (D61): the ticket income of the MEASURED side - dailySeries_ isNew = false - for the
// anchor run; cached under its own key so the two sides never read each other's stream.
function tofTicketIncome_(seg, payer, ctx, skip, measured){
  var key = seg + '|' + payer + (measured ? '|meas' : '');
  if (!skip && _tofIncomeCache[key]) return _tofIncomeCache[key];
  var days = [], d;
  for (d = 0; d < DAILY_DAYS; d++) days.push(0);
  CATEGORY_ORDER.forEach(function(cat){
    if (cat === TOF_CAT) return;
    if (skip && skip[cat]) return;
    // D67: set / album rewards carry no ToF_Ticket (the reward block has no ticket column), so the
    // two collection rows contribute nothing here - and asking for them would run a whole card-sim
    // batch from inside the ToF cycle, where the Season Pass tier is the noToF one (D62).
    if (COL_CATS[cat]) return;
    var series = dailySeries_(cat, seg, payer, ctx, !measured);
    for (var i = 0; i < DAILY_DAYS; i++) days[i] += num(series[i][TOF_TICKET]);
  });
  if (skip) return days;                    // partial sum - never cached under the plain key
  return (_tofIncomeCache[key] = days);
}

// Runs over the window: walk the days, bank the tickets earned, spend what the player is willing
// and able to spend. Returns { runs, perDay[], ticketsEarned, ticketsLeft }.
function tofRunBudget_(seg, payer, ctx, ticketsBackPerRun, measured){
  var cfg = tofConfig_();
  if (!cfg) return null;
  var beh = tofBeh_(cfg, seg, payer);                       // D94
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
  var income = tofTicketIncome_(seg, payer, ctx, null, measured);
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
// GAINS ONLY (D34, 2026-09-03, user decision). The row used to subtract the coins spent on
// continues from its own HC, on the reasoning that for this source the spend IS the price of the
// reward beside it. But EcoGainsSim is a GAINS model: every other row is a faucet, the NET blocks
// on the daily sheet are where spend lives, and one row quietly carrying a sink made the ToF HC
// column a different KIND of number from every other HC cell in the grid - not comparable down the
// column, and negative for segments that spend more than they bank.
// The spend has not been lost: ECOGAINS_TOF's RUN block still reports 'Coins spent per run' and
// 'Coins spent in window' per segment, which is where it belongs while the model is gains-only.
// TOF_SPEND_IN_ROW = true restores the old behaviour if the row ever needs to be a net position.
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

// ---- the cycle's inner level is a MODE, not an accident (D62, 2026-10-14) --------------------
// "While ToF is being computed, ToF contributes nothing" was implemented by guards: tofSynth_
// returned null in flight, simToF returned zeros, and the SPT totals summed whatever those gave.
// But the totals computed in that state were CACHED under the same key as the full ones, so which
// value stuck depended on which row a caller happened to ask for first. Core before ToF (the Core
// row's SPTx2-minutes read walks every measured row, which reaches the ToF anchor, whose ticket
// income reaches the Season Pass rows, whose tier reads the totals while ToF is still in flight)
// left 2960 in the cache at 20-39 PAYER; Season Pass before ToF left 3168 - one tier apart, a
// 175-coin swing in the paid row from evaluation order alone, which the D26 cutoff gate then read
// as a drift no sheet edit had caused. Now: the inner level is the `noToF` mode, every total in
// the cycle keys its cache on it, and the loops exclude the ToF row BY RULE on both sides while it
// is on. The full totals are only ever written by a computation that is not inside the cycle, so
// the order of asking cannot change what any row reads.
function tofCycleMode_(){ return (_tofInFlight || _tofSynthBusy) ? '|noToF' : ''; }

// Every module-level memo the engine keeps within one execution. Production never calls this (an
// execution starts empty); Context.reset() does, so an offline harness that mutates a sheet and
// sweeps again starts from exactly what a fresh recalculation would. A memo that outlives the
// state it was computed from is how the D26 cutoff gate read the 175 above (D62).
function resetModuleCaches_(){
  _rmLiveCache = null; _rmLiveCell = {};                 // D77: data_rm_pace matchables
  _variantSpecCache = {}; _calLaneSet = null;            // D73
  _rmPaceCache = null;                                   // D72: data_rm_pace memo
  _sheetValsCache = {}; _packAnchorCache = {}; _tofSynthCache = {}; _tofIncomeCache = {};
  _measSptCache = {}; _measSptBusyKeys = {}; _x2MinCache = {}; _x2MinBusyKeys = {};
  _tofBalCache = {}; _tofCfgCache = {}; _itemValsCache = null; _calDowCache = null; _calWinCache = null;
  _calGridDaysCache = null;                              // D79
  _expScaleTab = undefined;                              // D87: the export_scale table
  _kiteJoinTab = undefined;                              // D100: the kite_joiners table
  _newLbAnchorCache = {};                                // D102: a new leaderboard's TODAY walk
  _wagerTabCache = {}; _wagerCellCache = {}; _wagerDistCache = {}; _wagerPoolCache = {};   // D103/D104: the wager places
  _micDataCache = undefined;                             // D105: data_mic
  if (typeof _settleCache !== 'undefined') _settleCache = null;       // EcoGainsSim_Daily.gs
  if (typeof _econPick !== 'undefined') _econPick = null;            // D94 (EcoGainsSim_Daily.gs)
  if (typeof _colDailyCache !== 'undefined') _colDailyCache = null;   // CardOpenings.gs
  if (typeof _albumCalibCache !== 'undefined') _albumCalibCache = undefined;   // CardOpenings.gs (D89)
  if (typeof _albumBehCache !== 'undefined') _albumBehCache = undefined;       // CardOpenings.gs (D97)
  if (typeof _albumGainsCache !== 'undefined'){ _albumGainsCache = undefined; _albumFpMemo = undefined; }   // D89b
  if (typeof _segBehTopMemo !== 'undefined'){ _segBehTopMemo = undefined; _segBehTopLogged = false; }   // D93 (CardOpenings.gs)
  if (typeof DataStore !== 'undefined' && DataStore.reset) DataStore.reset();   // D67: the data_* memo too
}

// ---- the MEASURED side of the ToF row (D61, 2026-10-14) -------------------------------------
// data_gains has no ToF category, so the row's anchor was 0 and the DIFF carried the whole event
// as an addition - on a workbook whose cal_curr runs ToF on every day, exactly as cal_new does.
// The anchor is the same run budget walked over cal_curr (calNew := calCur), with the ticket
// income taken from the MEASURED side of every other source (dailySeries_ isNew = false, which
// now carries the anchored tickets), on the same ToF sheet the simulated side reads. Identical
// calendars therefore give DIFF 0; when a ToF_v2 sheet is wired into tofConfig_ the anchor keeps
// reading the base one. TOF_ANCHORED = false restores the pre-D61 anchor (0) bit for bit.
var TOF_ANCHORED = true;
var _tofSynthBusy = false, _tofSynthCache = {};
function tofSynth_(seg, payer){
  // D62: only its OWN re-entry stops it. The simulated ToF being in flight is no reason - the anchor
  // walks measured rows only - and a value that depended on the caller could not be cached.
  if (!TOF_ANCHORED || _tofSynthBusy) return null;
  var key = seg + '|' + payer;
  if (_tofSynthCache[key] !== undefined) return _tofSynthCache[key];
  var ctx;
  try { ctx = Context.get(); } catch (e){ return null; }
  if (!ctx || !ctx.calCurOk || !((ctx.calCur[TOF_CAT] || []).length)) return (_tofSynthCache[key] = null);
  // D79: the anchor is walked on the BASE ToF sheet (config, ladder, segment behaviour), never ToF_v2
  var cfg, run, budget;
  _tofBaseDepth++;
  try {
    cfg = tofConfig_();
    run = cfg ? tofRun_(seg, payer, ctx.ds) : null;
    if (run){
      _tofSynthBusy = true;
      try { budget = tofRunBudget_(seg, payer, baseCtx_(ctx), num(run.bank[TOF_TICKET]), true); }
      finally { _tofSynthBusy = false; }
    }
  } finally { _tofBaseDepth--; }
  if (!cfg) return (_tofSynthCache[key] = null);
  if (!run) return (_tofSynthCache[key] = null);
  if (!budget || !(budget.runs > 0)) return (_tofSynthCache[key] = zeroRow_());
  var out = zeroRow_();
  RESOURCES.forEach(function(r){ out[r] = num(run.bank[r]) * budget.runs; });
  if (SEASON_CUTOFF && budget.perDay && budget.perDay.length){        // D26, as in simToF
    var inSeason = 0, allRuns = 0;
    for (var di = 0; di < budget.perDay.length; di++){
      allRuns += num(budget.perDay[di]);
      if (di + 1 <= SEASON_LAST_DAY) inSeason += num(budget.perDay[di]);
    }
    var share = (allRuns > 0) ? inSeason / allRuns : 0;
    PACK_RES.forEach(function(r){ out[r] = num(out[r]) * share; });
  }
  if (TOF_SPEND_IN_ROW) out['HC'] = num(out['HC']) - run.spend * budget.runs;
  return (_tofSynthCache[key] = out);
}
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
  // D26 applies here too (2026-09-07). The ToF ladder pays ENVELOPES, and after SEASON_LAST_DAY
  // there is no album left to put a card in - every other source stops paying them, and this row
  // did not, because ToF was wired before the card sim could see it at all. The runs themselves do
  // not stop: ToF is always-on, and its coins, boosters, SPT and tickets keep paying on all 33
  // days. Only the six pack columns are scaled, by the share of the window's runs that fall inside
  // the season, which is exactly what the card sim now draws.
  if (SEASON_CUTOFF && budget.perDay && budget.perDay.length){
    var inSeason = 0, allRuns = 0;
    for (var di = 0; di < budget.perDay.length; di++){
      allRuns += num(budget.perDay[di]);
      if (di + 1 <= SEASON_LAST_DAY) inSeason += num(budget.perDay[di]);
    }
    var share = (allRuns > 0) ? inSeason / allRuns : 0;
    PACK_RES.forEach(function(r){ out[r] = num(out[r]) * share; });
  }
  // D34: gains only. The continue spend is reported on the ToF sheet, not netted into this row.
  if (TOF_SPEND_IN_ROW) out['HC'] = num(out['HC']) - run.spend * budget.runs;
  // D82: where the export measures ToF, it is the level and the walk is the change. The walk assumes a
  // cash-out the data does not show (stage 10 against a measured median of 6), so on the same calendar
  // and the same config it priced 0-9 NONPAYER at 62 coins where Variant A earned 15 - +4.6% of all
  // coins before any config moved, plus the Season Pass tier its extra SPT bought. tofSynth_ is the
  // same walk over cal_curr on the base ToF sheet with the measured ticket income.
  if (EXPORT_ANCHORED && !_baseSide && !TOF_SPEND_IN_ROW){
    var expT = measuredRowCore_(TOF_CAT, seg, payer, ctx.ds);
    if (anyAmount_(expT)){
      var ancT = tofSynth_(seg, payer);
      if (ancT){
        var outA = zeroRow_();
        RESOURCES.forEach(function(r){ outA[r] = anchorOne_(num(expT[r]), num(ancT[r]), num(out[r])); });
        out = outA;
      }
    }
  }
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
// The ladder a run WOULD hold at its cash-out stage, unconditionally: every stage reward summed
// with no survival probability applied. This is the number a designer reads off the STAGES block,
// and it is the honest companion to the expected value beside it -- the whole reason the reward
// block was misread as impossible. Stage 1 pays 10 Unlimited Lives and cannot be missed, so this
// column contains that 10; the expected column does not, because the deck End Run outcome loses the
// pot (design doc p7, CONFIRMED). expected = ladder x P(run banks), exactly.
function tofLadderRow_(cfg, cashOutN){
  var row = {}, vals = itemVals_(), coins = 0;
  RESOURCES.forEach(function(r){ row[r] = 0; });
  for (var i = 0; i < cfg.stages.length; i++){
    var st = cfg.stages[i];
    if (st.n > cashOutN) break;
    for (var res in st.rew){
      if (row[res] == null) continue;
      var amt = st.rew[res] * st.I;
      row[res] += amt;
      coins += amt * num(vals[res]);
    }
  }
  return { row: row, coins: coins };
}

// The cash-out stage actually modelled for a segment: the authored one, or the end of the ladder if
// it is blank. NOT a policy -- see the note on tofRunOnce_: the run banks at this stage and nowhere
// else, so a deeper stage is strictly harder to reach and pays strictly less in expectation.
function tofCashOutN_(cfg, seg, payer){
  var beh = tofBeh_(cfg, seg, payer);                       // D94
  if (!beh) return 0;
  return (beh.cashOut > 0) ? beh.cashOut : cfg.stages[cfg.stages.length - 1].n;
}

// Say out loud what the model does NOT do, once per read, rather than leaving it to be rediscovered
// from odd numbers. Two things bite here:
//  - Cash-Out Variant is an authored input that nothing reads. Variant A (the sheet default) means
//    cash out after every successful stage; the model always cashes out at the segment Cash-Out
//    Stage and only there. User decision 2026-09-03 (D37): keep the hard target, report it.
//  - a deep Cash-Out Stage therefore DESTROYS value. At the shipped ladder 100+ banks 1 run in
//    7,900 and MAX 1 in 2.7 million, so their reward-per-run columns are ~0 by construction.
function tofPolicyLog_(cfg, segs, payer, ctx){
  try {
    var deep = [];
    segs.forEach(function(sg){
      var run = tofRun_(sg, payer, ctx.ds);
      if (run && run.pBank < 0.01)
        deep.push(sg + ' (stage ' + tofCashOutN_(cfg, sg, payer) + ', P(bank) ' + run.pBank.toExponential(2) + ')');
    });
    Logger.log('ToF policy: the run banks ONLY at the segment Cash-Out Stage. The authored ' +
               'Cash-Out Variant (' + cfg.cashOutVariant + ') is NOT modelled - Variant A would ' +
               'allow cashing out after every successful stage, which this model never does.' +
               (deep.length ? ' Segments whose cash-out stage is deep enough to make reward per run ' +
                              'effectively zero: ' + deep.join(', ') + '.' : ''));
  } catch(e){}
}

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
    // 'P(run banks)', not 'P(run pays)': a run that meets a Pig and stops pays nothing at all, so
    // this is the probability the whole pot survives to the cash-out stage. The last three columns
    // exist because that probability was invisible next to the reward block and the numbers there
    // read as impossible - see tofLadderRow_. (D37, 2026-09-03.)
    tofPolicyLog_(cfg, segs, p, ctx);
    var out = [['Segment','Runs in window','P(run banks)','Coins spent per run','Coins spent in window',
                'Tickets earned','Tickets unspent',
                'Cash-out stage','Ladder value if banked (coins-eq)','Expected value banked (coins-eq)']];
    segs.forEach(function(sg){
      var run = tofRun_(sg, p, ctx.ds);
      var lad = tofLadderRow_(cfg, tofCashOutN_(cfg, sg, p));
      if (!run){ out.push([sg,0,0,0,0,0,0, tofCashOutN_(cfg, sg, p), lad.coins, 0]); return; }
      // MAX is a ceiling case, not an engagement segment: data_seg_beh has no row for it, so there
      // are no activity rates to price reach with and no ticket income to bank. Its PER-RUN numbers
      // are the point of it -- what the deep ladder is worth and what it costs to get there -- so
      // the window columns are blank rather than a fabricated 0, which would read as "MAX earns
      // nothing" instead of "this question does not apply to MAX".
      var beh = ctx.ds.beh(sg, p);
      var hasRates = num(beh.weekday_active_rate) > 0 || num(beh.weekend_active_rate) > 0;
      var tail = [tofCashOutN_(cfg, sg, p), lad.coins, lad.coins * run.pBank];
      if (!hasRates){ out.push([sg, '', run.pBank, run.spend, '', '', ''].concat(tail)); return; }
      var b = tofRunBudget_(sg, p, ctx, num(run.bank[TOF_TICKET])) || {runs:0,ticketsEarned:0,ticketsLeft:0};
      out.push([sg, b.runs, run.pBank, run.spend, run.spend * b.runs,
                b.ticketsEarned, b.ticketsLeft].concat(tail));
    });
    return out;
  }
  if (blk === 'REWARD'){
    // TWO columns per segment, because one was being read as the other. 'if banked' is the ladder
    // face value up to the cash-out stage - what the STAGES block promises, stage 1 included.
    // 'expected' is that x P(run banks), which is what the EcoGainsSim ToF row is built from
    // (x runs in window). The identity expected = if banked x P(run banks) is gated.
    var hdr = ['Resource'], pRow = ['P(run banks)'];
    var pre = segs.map(function(sg){
      return { run: tofRun_(sg, p, ctx.ds), lad: tofLadderRow_(cfg, tofCashOutN_(cfg, sg, p)) };
    });
    segs.forEach(function(sg, i){
      hdr.push(sg + ' if banked', sg + ' expected');
      pRow.push(pre[i].run ? pre[i].run.pBank : 0, '');
    });
    var rows = [hdr, pRow];
    RESOURCES.forEach(function(res){
      var line = [res];
      pre.forEach(function(x){
        line.push(num(x.lad.row[res]), x.run ? num(x.run.bank[res]) : 0);
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
    segs.forEach(function(sg){ head.push(sg + ' gain (raw)', sg + ' gain (exp)', sg + ' spend',
                                         sg + ' net (exp - spend)', sg + ' stage EV'); });
    var grid = [head], stages = cfg.stages;
    var pre = segs.map(function(sg){ return tofStageCurve_(sg, p, ctx); });
    for (var i = 0; i < stages.length; i++){
      var line = [stages[i].n, stages[i].type];
      for (var k = 0; k < segs.length; k++){
        var c = pre[k];
        var raw = c ? c.raw[i] : 0, ex = c ? c.exp[i] : 0, sp = c ? c.spend[i] : 0;
        // stage EV = this stage on its own, sum of p x reward, priced through item_vals. The three
        // columns beside it are all CUMULATIVE along the ladder; this one is not.
        var sev = c ? c.stageExp[i] : 0;
        line.push(raw, ex, sp, (ex === '' || sp === '') ? '' : ex - sp, sev);
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
  var beh = tofBeh_(cfg, seg, payer);                       // D94
  if (!beh) return null;
  var stages = cfg.stages, vals = itemVals_();
  var cashOutN = (beh.cashOut > 0) ? beh.cashOut : stages[stages.length - 1].n;
  var raw = [], exp = [], spend = [], stageExp = [], cum = 0;
  // One walk per stage is O(n^2) but n is 60 and the sheet asks for this once per segment.
  for (var i = 0; i < stages.length; i++){
    var st = stages[i], v = 0;
    for (var res in st.rew) v += st.rew[res] * st.I * num(vals[res]);
    cum += v;
    raw.push(cum);
    // THIS stage alone, unconditionally: what one visit to it is worth before you know whether the
    // door you opened was the pig. `v` is the payout GIVEN SURVIVAL, so H puts the death chance
    // back in - this is the sum-of-p-x-reward view, and it is deliberately NOT what the ladder
    // uses (the ladder is conditional; pBank supplies survival exactly once).
    stageExp.push(v * st.H);
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
  return { raw: raw, exp: exp, spend: spend, stageExp: stageExp };
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
                       ms:{hdr:21, r0:22, r1:22, reqC:1, c0:2, c1:22}},
  'Flock Flurry'    : {base:'F',    v2:'F_v2',    hdr:9,  r0:10, r1:14, c0:1, c1:21, inst:'Flock Flurry'},  // D91
  // D102: one Race-style block (builders/_build_mic.py), 25 places, columns Coins..ToF_Ticket. No base
  // sheet: lbBaseSheet_ reads Mic_v2 on the anchor side until a 'Mic' sheet exists. Places borrowed
  // (eventInstProxy_), priced bottom-up (newLbSim_).
  'Mighty Ice Cream': {base:'Mic',  v2:'Mic_v2',  hdr:8,  r0:9,  r1:33, c0:1, c1:22, inst:'Mighty Ice Cream',
                       newEvent:true}
};

// ---- D91 (2026-11-02): Flock Flurry is a simulated leaderboard ----------------------------------
// It was CARRIED with a pack overlay (D19): every resource stayed at the measured level except the
// envelope, which packLane_ priced on cal_new. The redesign runs it 12 days in the window instead of
// 16 (Mon / Thu / Sat against Mon-Thu), so the change summary showed the 2-star envelope down ~25% and
// nothing else - while the same instances also pay the SPT, the four boosters and the 60-minute
// Unlimited Lives join grant (data_gains carries all seven). Now it is priced like the other
// leaderboards: measured x R x T with D = 1, R off the rank ladder on F / F_v2 over the measured
// position quantiles (data_event_inst), so every resource follows the calendar and an F_v2 edit moves
// what it edits (the D19 overlay read the base F on both sides). Resources the ladder does not carry
// (the join grant) are measured x T. The envelope keeps its route (packLane_, D82-anchored on the
// export), now off F_v2. FLOCK_SIMULATED = false restores the D19 carry + overlay exactly.
var FLOCK_SIMULATED = true;
var FLOCK_LB_SPEC = LB_R_SPECS['Flock Flurry'];
/** Puts Flock Flurry on one route. Every consumer reads SOURCES / LB_R_SPECS / PACK_ONLY_SPECS, so
 *  moving the entry moves them all (the gains row, packParticipation_, the card sim's rungs, the
 *  pack provenance, the anchor side, the change summary's Model column). */
function flockRoute_(on){
  if (on){
    SOURCES['Flock Flurry'] = simFlockFlurry;
    LB_R_SPECS['Flock Flurry'] = FLOCK_LB_SPEC;
    delete PACK_ONLY_SPECS['Flock Flurry'];
  } else {
    delete SOURCES['Flock Flurry'];
    delete LB_R_SPECS['Flock Flurry'];
    PACK_ONLY_SPECS['Flock Flurry'] = FLOCK_PACK_ONLY_SPEC;
  }
}
if (!FLOCK_SIMULATED) flockRoute_(false);
var COLL_R_SPECS = {
  'Jigsaw'             : {base:'J',  v2:'J_v2',  hdr:9,  r0:10, r1:21, reqC:1,  reqFrom:'own',
                          c0:2, c1:22, inst:'Jigsaw'},
  'Hatchling Hideaway' : {base:'HH', v2:'HH_v2', hdr:10, r0:11, r1:15, reqC:47, reqFrom:'v2',
                          reqR0:4, reqLabel:'Cum tokens', c0:1, c1:21, inst:'Hatchling Hideaway'},
  "Bomb's Ballet"      : {base:'BB', v2:'BB_v2', hdr:7,  r0:8,  r1:22, reqC:1,  reqFrom:'own',
                          c0:2, c1:22, completionRow:23, inst:'Bombs Ballet'},
  'Photoshoot'         : {base:'Ph', v2:'Ph_v2', hdr:23, r0:24, r1:53, reqC:46, reqFrom:'v2',
                          reqR0:4, reqLabel:'Cum item price', c0:7, c1:27, inst:'Photoshoot'}
};

// Absolute expected ladder payout for a source, both sides. Split out of rewardR_ (D19) because
// the pack lane needs E_v2 in ABSOLUTE units — packs have no measured anchor, so the v2/base
// ratio the rest of the model uses is meaningless for them.
// Returns {inst, eBase, eV2} or null (source not priceable -> carry / no packs).
function rewardE_(cat, seg, payer, ds, variant, pace){
  var lb = LB_R_SPECS[cat], coll = COLL_R_SPECS[cat];
  if (!lb && !coll) return null;
  if (variant){ lb = variantSpec_(lb, variant); coll = variantSpec_(coll, variant); }   // D73
  var inst = ds.eventInst((lb || coll).inst, seg, payer);
  if (lb){
    var pos = inst ? [inst.position_p25, inst.position_p50, inst.position_p75]
                       .map(function(p){ return Math.max(1, Math.round(num(p))); })
                       .filter(function(p){ return p > 0; }) : [];
    return { inst: inst, eBase: lbE_(lbBaseSheet_(lb), lb, pos, inst), eV2: lbE_(lb.v2, lb, pos, inst) };   // D102
  }
  var S = inst ? survival_([[num(inst.final_balance_p25),.25],[num(inst.final_balance_p50),.5],
                            [num(inst.final_balance_p75),.75]]) : null;
  if (!S) return null;                                     // no progress distribution -> carry
  var reqs = collReqs_(coll);
  if (!reqs.length) return null;
  return { inst: inst,
           eBase: collE_(coll.base, coll, reqs, S),
           // D81: the redesign side reaches its milestones on the balance of ITS duration
           eV2:   collE_(coll.v2,   coll, collReqsV2_(coll, reqs), pacedSurv_(S, pace)) };   // D84
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
  var row0 = (spec.reqR0 != null) ? spec.reqR0 : spec.r0, reqC = spec.reqC;
  // D80 (2026-10-30): the helper column is found by its HEADER when the spec names one. LIVE_OPS_V3
  // moved both helper blocks one column right, so the fixed index read HH's per-board 'Tiles'
  // (16..64) instead of 'Cum tokens' (20..237.5) and Ph's milestone numbers instead of 'Cum item
  // price'. The label is searched on the rows above the first requirement; no hit -> spec.reqC.
  // D83 (2026-11-01): a reqFrom 'v2' pair reads the BASE sheet's own helper on the base side when the base
  // sheet carries one (same header). Without it a board edit on HH_v2 moved the base requirement too, so
  // 'easier boards' only re-weighted - and on a cell whose survival is near 0 the two near-zero sides
  // made a ratio that dropped a whole envelope (0-9 Hatchling 2-star 0.64 -> 0). No base helper: as before.
  if (spec.reqFrom === 'v2' && !v2Side && spec.reqLabel){
    var vb = sheetVals_(spec.base);
    if (vb && vb.length && reqLabelCell_(vb, spec.reqLabel, row0)){ v = vb; }
  }
  var hit = spec.reqLabel ? reqLabelCell_(v, spec.reqLabel, row0) : null;
  if (hit){ reqC = hit.c; row0 = hit.r + 1; }
  for (var i = 0; i < n; i++) reqs.push(num(v[row0 + i] && v[row0 + i][reqC]));
  reqs.own = (spec.reqFrom === 'own');
  return reqs.some(function(x){ return x > 0; }) ? reqs : [];
}

// D84 (2026-11-02): the redesign side's requirement axis. D83 let the BASE side of a reqFrom 'v2' pair read the base
// sheet's own helper, but the three pricing sites kept handing the base-side axis to the v2 side as well, so with a
// base helper present an edit to HH_v2's boards priced nothing at all (the calendar-rebalance boards of 2026-11-01
// moved no number). 'own' pairs and 'v2' pairs without a base helper are unchanged - their v2 axis is what they read.
function collReqsV2_(coll, reqs){
  if (coll.reqFrom === 'own') return collReqs_(coll, true);
  var v = collReqs_(coll, true);
  return v.length ? v : reqs;
}

/** {r, c} (0-based) of the first cell on rows 0..maxRow whose text starts with `label`, or null. */
function reqLabelCell_(v, label, maxRow){
  var want = String(label).toLowerCase();
  for (var r = 0; r <= Math.min(maxRow, v.length - 1); r++){
    var row = v[r] || [];
    for (var c = 0; c < row.length; c++)
      if (String(row[c] == null ? '' : row[c]).trim().toLowerCase().indexOf(want) === 0) return { r: r, c: c };
  }
  return null;
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
// The BASE weekday ladder (D61d, 2026-10-14). The live game runs two Night Sky ladders too, and the
// workbook authors them as NS (weekend) + NS_weekday (weekday); until D61d the engine read NS alone
// for the anchor while blending the two _v2 sheets for the redesign, so IDENTICAL ladders on the
// two sides still produced a Night Sky difference. Missing sheet / no block for the segment -> the
// base is one ladder on every day, exactly as before.
var NS_WEEKDAY_SHEET = 'NS_weekday';
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
// 'auto' (D30, 2026-09-03) — THE CALENDAR DECIDES, and it is now the shipped default.
// "Is Night Sky new?" is a fact written on cal_curr, not a preference: if the old calendar runs the
// event, the row is a CHANGE and has to be anchored; if it does not, the row is an ADD. A hardcoded
// flag answers that question once, for one workbook, and is then wrong for the next one - which is
// exactly what happened. COLLECTIONS_UNDER_NEW_CALENDAR (4) runs Night Sky on all 33 days of BOTH
// calendars with an NS_v2 ladder identical to NS, so the honest answer is "nothing changed, diff
// 0". With the flag pinned false the anchor was forced to zero and the whole bottom-up lane
// reported as an uplift: +38.5 HC at 0-9 PAYER, +287.5 at 20-39, against measured 24.8 and 149.0.
// That number was not a Night Sky finding, it was the flag.
// It also exposed the standing caveat in the worst possible place: bottom-up reads 93% above the
// measured lane at 20-39, so "the redesign adds HC" was really "the unvalidated model runs hot".
// true / false still force it, for a workbook where the calendar cannot answer.
// Same rule as RM_ANCHORED's cal_curr test, deliberately: one concept, two sources.
var NS_ANCHORED = 'auto';
function nsAnchored_(ctx){
  if (NS_ANCHORED !== 'auto') return !!NS_ANCHORED;
  try { ctx = ctx || Context.get(); } catch(e){ return false; }
  return !!(ctx && ctx.calCurOk && (ctx.calCur['Night Sky'] || []).length);
}
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
  if (!nsAnchored_(ctx)){
    // NEW SOURCE: nothing to scale, so every resource is the bottom-up value. measuredRow_ forces
    // the anchor to 0 for this lane (see below), so the DIFF is the whole thing.
    RESOURCES.forEach(function(r){ out[r] = num(E.eV2[r]) * days; });
  } else {
    RESOURCES.forEach(function(r){
      var base = num(E.eBase[r]), v2 = num(E.eV2[r]);
      out[r] = num(meas[r]) * (base > 1e-9 ? v2 / base : 1) * T;
      if (base <= 1e-9 && v2 > 0){                        // base-0 addition: no anchor of its own
        var ra = (BOTTOMUP_RES.indexOf(r) < 0) ? nsRungAdd_(r, E, meas, T, days) : null;
        out[r] += (ra != null) ? ra : v2 * days;          // D92: off its round's measured claims, else bottom-up
      }
    });
  }
  // Packs (D19) never have an anchor, so the base-0 addition above would price them without the
  // participation term every other source carries. Overlay the standard pack lane instead (D22).
  return overlayPacks_(out, packLane_('Night Sky', seg, payer, ctx, (_baseSide ? E.eBase : E.eV2),
                                      ds.eventInst('Night Sky', seg, payer),
                                      'Daily Night Sky Prize'));
}

// Expected per-DAY payout of the NS ladder, both sides, under one survival curve.
// Returns {eBase, eV2} or null when the segment has no streak distribution or no base ladder
// (either way there is nothing to anchor on -> callers carry measured).
function nsE_(seg, payer, ds, ctx){
  if (segIsAll_(seg)) return nsEAll_(payer, ds, ctx);      // D94
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
  // D61d: the base side blends the same way, over cal_curr's day types, when NS_weekday exists.
  var bWe = nsEDay_(base, S);
  var bWdLad = nsBaseWeekdayLadder_(seg);
  var bWd = bWdLad ? nsEDay_(bWdLad, S) : bWe;
  var bsh = bWdLad ? nsDayTypeSplit_(seg, payer, ds, ctx, 'cur') : sh;
  var eBase = zeroRow_();
  RESOURCES.forEach(function(r){ eBase[r] = num(bWd[r]) * bsh.wd + num(bWe[r]) * bsh.we; });
  var vWeLad = readNSLadder_(seg, NS_V2_SHEET);
  return { eBase: eBase, eV2: eV2, eV2Weekday: wd, eV2Weekend: we,
           eBaseWeekday: bWd, eBaseWeekend: bWe,
           split: sh, baseSplit: bsh, hasWeekdayVariant: !!wdLad, hasBaseWeekdayVariant: !!bWdLad,
           // D92: the rounds themselves, for pricing a reward added to one of them (nsRungAdd_)
           ladders: { S: S, bWe: base, bWd: bWdLad || base, vWe: vWeLad, vWd: wdLad || vWeLad, sh: sh, bsh: bsh } };
}

/** D94: ALL has no Night Sky ladder. Its per-active-day E is the member segments' E, each on its own
 *  ladder and its own streak survival, weighted by the Night Sky days its players play (players x the
 *  window's expected active days). The day-type split is ALL's own. `ladders` is null: the round-level
 *  pricing of D92 lives in the members' rows, which the ALL row pools (mixRow_). Used by the daily
 *  view's day-type placement and anything that asks ALL for an E; null when no member has one. */
function nsEAll_(payer, ds, ctx){
  var keys = ['eBase', 'eV2', 'eV2Weekday', 'eV2Weekend', 'eBaseWeekday', 'eBaseWeekend'];
  var acc = {}, wsum = 0, anyWd = false, anyBWd = false;
  keys.forEach(function(k){ acc[k] = zeroRow_(); });
  segMembers_(ds).forEach(function(sg){
    var E = nsE_(sg, payer, ds, ctx);
    if (!E) return;
    var b = ds.beh(sg, payer) || {};
    var w = ds.players(sg, payer) * pDaySum_(1, windowDays_(), num(b.weekday_active_rate), num(b.weekend_active_rate));
    if (!(w > 0)) return;
    keys.forEach(function(k){ RESOURCES.forEach(function(r){ acc[k][r] += w * num(E[k][r]); }); });
    wsum += w; anyWd = anyWd || E.hasWeekdayVariant; anyBWd = anyBWd || E.hasBaseWeekdayVariant;
  });
  if (!(wsum > 0)) return null;
  keys.forEach(function(k){ RESOURCES.forEach(function(r){ acc[k][r] = acc[k][r] / wsum; }); });
  var sh = nsDayTypeSplit_(SEG_ALL, payer, ds, ctx);
  return { eBase: acc.eBase, eV2: acc.eV2, eV2Weekday: acc.eV2Weekday, eV2Weekend: acc.eV2Weekend,
           eBaseWeekday: acc.eBaseWeekday, eBaseWeekend: acc.eBaseWeekend,
           split: sh, baseSplit: anyBWd ? nsDayTypeSplit_(SEG_ALL, payer, ds, ctx, 'cur') : sh,
           hasWeekdayVariant: anyWd, hasBaseWeekdayVariant: anyBWd, ladders: null };
}

// ---- D92 (2026-11-02): a reward ADDED to a Night Sky round is priced off what that round pays -----
// A resource the base ladder never pays (E_base = 0) has nothing to scale, so it was added bottom-up:
// E_v2 x the window's expected active days, i.e. at the streak model's OWN round reach. That model is
// the one D22 anchored away from, and on round 1 it runs above the data: the base ladder pays Unlimited
// Lives on round 1 and nowhere else, so measured lives / the model's lives is round 1's true reach over
// the model's - 0.61-0.80 per cell on LIVE_OPS_V3 (17). The 10 minutes of Unlimited Red / Chuck / Bomb
// typed onto round 1 of NS_v2 were therefore priced 25-64% high. Now, where the round a new reward sits
// on pays some resource EXCLUSIVELY in the base (on no other round of either base ladder) and the export
// carries it, the addition is that round's measured claims carried across:
//     add[r] = SUM_k measured[s_k] x E_v2,k[r] / E_base,k[s_k] x T
// - the anchored form measured x R x T at the round level (several such siblings: the mean of their
// claim factors). A round with no such sibling keeps the bottom-up price. Envelopes and tickets are never
// siblings (their measured side may be the model's own synthetic, D61) and are not added here (packLane_).
// FLAGGED: measured[s] is per earner of s - on round 1 that is ~every Night Sky player. NS_RUNG_ANCHOR =
// false restores the bottom-up addition exactly.
var NS_RUNG_ANCHOR = true;
/** E of one round for resource r per active Night Sky day: the weekend and weekday rows blended by day type. */
function nsRungE_(L, side, k, r){
  var we = (side === 'v2') ? L.vWe[k] : L.bWe[k], wd = (side === 'v2') ? L.vWd[k] : L.bWd[k];
  var sh = (side === 'v2') ? L.sh : L.bsh;
  return (we ? L.S(we.req) * num(we.rew[r]) : 0) * sh.we + (wd ? L.S(wd.req) * num(wd.rew[r]) : 0) * sh.wd;
}
/** The measured claim factor of base round k (measured[s] / E_base,k[s], the mean over the round's
 *  exclusive export-carried siblings), or null when the round has none. */
function nsRungClaims_(L, k, meas){
  var nb = Math.max(L.bWe.length, L.bWd.length), fs = [];
  var row = function(lad, j){ return (lad[j] && lad[j].rew) || {}; };
  RESOURCES.forEach(function(s){
    if (BOTTOMUP_RES.indexOf(s) >= 0 || !(num(meas[s]) > 0)) return;
    if (!(num(row(L.bWe, k)[s]) > 0) && !(num(row(L.bWd, k)[s]) > 0)) return;
    for (var j = 0; j < nb; j++) if (j !== k && (num(row(L.bWe, j)[s]) > 0 || num(row(L.bWd, j)[s]) > 0)) return;
    var eb = nsRungE_(L, 'base', k, s);
    if (eb > 1e-12) fs.push(num(meas[s]) / eb);
  });
  if (!fs.length) return null;
  return fs.reduce(function(a, x){ return a + x; }, 0) / fs.length;
}
/** The window amount of base-0 resource r on the redesign, round by round; null when no round of it has
 *  a measured sibling (the caller keeps E_v2 x days). */
function nsRungAdd_(r, E, meas, T, days){
  var L = E && E.ladders;
  if (!NS_RUNG_ANCHOR || !L) return null;
  var n = Math.max(L.vWe.length, L.vWd.length), add = 0, anchored = false;
  for (var k = 0; k < n; k++){
    var ev = nsRungE_(L, 'v2', k, r);
    if (!(ev > 0)) continue;
    var f = nsRungClaims_(L, k, meas);
    if (f == null) add += ev * days;
    else { add += f * ev * T; anchored = true; }
  }
  return anchored ? add : null;
}

// The BASE weekday ladder for one segment, or null when there is none (same rule as
// nsWeekdayLadder_: never fall back to NS, because an absent sheet means ONE base ladder).
function nsBaseWeekdayLadder_(seg){
  if (!NS_DAYTYPE_SPLIT) return null;
  var l = nsLadderOn_(NS_WEEKDAY_SHEET, seg);
  return l.length ? l : null;
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
// `which` (D61d): 'cur' reads cal_curr's Night Sky slots for the base-side blend; default cal_new.
function nsDayTypeSplit_(seg, payer, ds, ctx, which){
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)){ pWd = 1; pWe = 1; }
  try { ctx = ctx || Context.get(); } catch(e){ ctx = null; }
  var insts = (which === 'cur') ? ((ctx && ctx.calCurOk && ctx.calCur['Night Sky']) || null)
                                : ((ctx && ctx.calNewOk && ctx.calNew['Night Sky']) || null);
  var wd = 0, we = 0;
  if (insts && insts.length){
    insts.forEach(function(inst){
      ((inst && inst.days) || []).forEach(function(d){
        if (isWeekend_(d)) we += pWe; else wd += pWd;
      });
    });
  } else {
    for (var d = 1; d <= windowDays_(); d++){ if (isWeekend_(d)) we += pWe; else wd += pWd; }
  }
  var tot = wd + we;
  if (!(tot > 0)) return { wd: 1, we: 0, weekdayDays: 0, weekendDays: 0 };
  return { wd: wd / tot, we: we / tot, weekdayDays: wd, weekendDays: we };
}

// D90: the BASE ladder that applied on one cal_curr day - the weekday base sheet on a weekday when it has
// a block for the segment (D61d), NS otherwise. The card sim's anchor-side twin of nsLadderForDay_.
function nsBaseLadderForDay_(seg, day){
  if (!isWeekend_(day)){
    var wd = nsBaseWeekdayLadder_(seg);
    if (wd) return wd;
  }
  return nsLadderOn_('NS', seg);
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
// data_RM matchables percentiles scaled by (instanceDur / the MEASURED instance length, cal_curr's
// usual RM instance - D72; it was the sheet's EventDuration) - a 2-day instance halves the 4-day
// matchables axis (flagged linear-scaling assumption). A window-edge cut-off is priced at the claim
// pace instead (rmRungP_).
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
// D72 (2026-10-28): replaced by the window's HALVES - see rmHalfSheet_. Kept only as the two
// sheet names, so a workbook with different split sheets edits one line.
var RM_HALF_SHEETS = ['RM_1st', 'RM_2nd'];

function rmSortedInsts_(cal){
  return ((cal && cal['Rainbow Maker']) || []).slice()
    .sort(function(x, y){ return x.start - y.start; });
}
// D72: an instance starting on days 1..floor(N/2) of the counted window reads RM_1st, a later one
// RM_2nd (user decision 2026-10-28). Pre-window instances (start <= 0, the measured rescale's full
// view) are 1st half. The ordinal 3+2 split this replaces read the 6th..9th instance of a 9-instance
// calendar as RM_2nd whatever its date.
function rmHalfSheet_(inst){
  var half = Math.floor(windowDays_() / 2);
  return (inst && num(inst.start) > half) ? RM_HALF_SHEETS[1] : RM_HALF_SHEETS[0];
}
/** The config of ONE instance: {sheet, ladder, cfgDur}. */
function rmConfigForInst_(inst, useBase){ return rmConfigByName_(rmHalfSheet_(inst), useBase); }
// instance ordinal (0-based, start-sorted, on `cal` - cal_new by default) -> its config. Kept for the
// callers that hold an ordinal; it resolves the instance and asks rmConfigForInst_.
function rmConfigFor_(i, useBase, cal){
  var insts = rmSortedInsts_(cal || ((typeof Context !== 'undefined') ? Context.get().calNew : null));
  var inst = insts.length ? insts[Math.max(0, Math.min(i, insts.length - 1))] : null;
  return rmConfigForInst_(inst, useBase);
}
// name -> {sheet, ladder, cfgDur}; fallback chain to 'RM'.
// useBase (2026-09-03): read the BASE ladder and never the _v2 one. That is what prices the
// cal_curr side of the difference sim - the anchor has to describe the config the OLD calendar
// ran, or a reward edit would change both sides equally and cancel to nothing.
function rmConfigByName_(name, useBase){
  name = name || 'RM';
  if (useBase){
    var bl = readRMLadder_(name);
    if (!bl.length){ name = 'RM'; bl = readRMLadder_('RM'); }
    return { sheet: name, ladder: bl, cfgDur: readRMDuration_(name) || 4 };
  }
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

// ---- Rainbow Maker CUT-OFFS (D72, 2026-10-28) ----------------------------------------------
// An instance at an edge of the view being priced that is shorter than its full length is the
// visible part of a longer instance. `first`/`last` are the view's edges in window days (the window,
// or the whole grid for D71's full view). The full length is the CALENDAR's when the window clipped
// the instance (fullDur - the calendar has priority over the sheet's EventDuration), and the
// config's when the grid itself cuts it (nothing beyond the grid says how long it ran).
// Returns {side: 'start'|'end', k: days visible, L: full length} or null.
var RM_CUTOFF_PACE = true;
// D72c: lengths come from the CALENDARS, never from the sheet's EventDuration (the project rule:
// the calendar wins on duration). RM_1st says 4 and RM_2nd says 2 over the SAME ladder, so dividing
// by EventDuration priced a 2-day second-half instance as four days of matchables. false restores
// the EventDuration denominator.
var RM_MATCH_DAYS_FROM_CAL = true;
/** The length data_RM's matchables were collected over: cal_curr's usual Rainbow Maker instance on
 *  the whole grid (the calendar the data was earned under). EventDuration when there is none. */
function rmMatchDays_(ctx, cfg){
  if (RM_MATCH_DAYS_FROM_CAL && ctx){
    var m = modalDur_((ctx.calCurFull || ctx.calCur || {})['Rainbow Maker'] || []);
    if (m > 0) return m;
  }
  return num(cfg && cfg.cfgDur) || 4;
}
/** How long a cut-off instance on `cal` really runs: that calendar's usual Rainbow Maker length. */
function rmCalLen_(cal, cfg){
  if (RM_MATCH_DAYS_FROM_CAL){
    var m = modalDur_((cal || {})['Rainbow Maker'] || []);
    if (m > 0) return m;
  }
  return num(cfg && cfg.cfgDur) || 0;
}
/** {Dm, Lcal} for instances of `cal` - what rmRungP_ needs beyond the instance itself. */
function rmGeo_(ctx, cal, cfg){ return { Dm: rmMatchDays_(ctx, cfg), Lcal: rmCalLen_(cal, cfg) }; }
function rmCutoff_(inst, cfg, first, last, Lcal){
  if (!RM_CUTOFF_PACE || !inst) return null;
  var d = num(inst.dur), s = num(inst.start), e = s + d - 1;
  if (!(d > 0)) return null;
  var cs = num(inst.clipStart) > 0, ce = num(inst.clipEnd) > 0;
  var L = (cs || ce) ? (num(inst.fullDur) || num(Lcal) || num(cfg && cfg.cfgDur) || d)
                     : (num(Lcal) || num(cfg && cfg.cfgDur) || d);
  if (!(d < L)) return null;
  if (cs || (!ce && s === first)) return { side: 'start', k: d, L: L };
  if (ce || e === last) return { side: 'end', k: d, L: L };
  return null;
}
// The matchables pace: the share of an L-day instance's matchables collected by the end of its day
// t, off the measured curve ('Milestone' = Rainbow Maker in data_event_accrual, MEAN column). The
// curve runs over the dates its instances SPANNED - 5 for the 4-day event, the last a part day - so
// day t is curve date t when the curve is one longer than L (or as long), and the curve is
// stretched to L days otherwise (a 2-day instance against the 5-date curve). Linear when there is
// no curve - the pre-D72 assumption.
var RM_ACCR_EVENT = 'Milestone';
function rmMatchShare_(ds, seg, payer, t, L){
  if (!(t > 0)) return 0;
  if (t >= L) return 1;
  var c = (ds.accrualCurveMean ? ds.accrualCurveMean(RM_ACCR_EVENT, seg, payer)
                               : ds.accrualCurve(RM_ACCR_EVENT, seg, payer)) || [];
  if (!c.length) return t / L;
  var Lc = num(c[c.length - 1].day);
  var x = (Lc === L || Lc === L + 1) ? t : t * Math.max(1, Lc - 1) / L;
  var prevD = 0, prevS = 0;
  for (var i = 0; i < c.length; i++){
    var d = num(c[i].day), sh = num(c[i].share);
    if (x <= d) return prevS + (sh - prevS) * (x - prevD) / Math.max(1e-9, d - prevD);
    prevD = d; prevS = sh;
  }
  return 1;
}
// data_rm_pace (PROMPT_rm_claim_pace.md): the cumulative share of reward value CLAIMED by the end of
// each instance day. The prompt defines instance_length_days as the calendar DATES an instance spans
// (5 for the 4-day event, as data_event_accrual counts it), so an L-day instance reads the L+1 curve
// first and the L curve only when there is none - the other order would hand a 4-day cut-off the
// 3-day event's curve (4 dates). Rows marked FAKE are skipped - this
// feeds simulated values. Returns {L, share(res, day)} or null; share() returns null for a missing
// day so the caller can fall back resource -> ALL -> matchables curve.
// D75 (2026-10-28): a length the pull does not carry is read off the length it does carry,
// STRETCHED - instance day t of an L-day instance is the same fraction of the event elapsed as date
// t x (Ls - 1) / L of the Ls-date curve. LIVE_OPS_V3 (5)'s pull covers the 4-day event only (5
// dates) while every Rainbow Maker instance on the redesign is 2 days, so without this the cut-offs
// never read the claim data at all and fell back to the matchables curve - which the claim data
// contradicts (the model has 100+ players claiming ~half of the event's coins on day 1, the pull
// says 19%). An ASSUMPTION, flagged: a 2-day event is paced like a 4-day one compressed. false ->
// the exact-length rule only.
var RM_PACE_STRETCH = true;
var RM_PACE_SHEET = 'data_rm_pace';
/** D95: a data_rm_pace row of an instance that had not finished when the pull was taken. */
function rmPaceIncomplete_(r, h){
  if (h['instance_complete'] == null) return false;
  var x = r[h['instance_complete']];
  return x === false || /^(false|0|no)$/i.test(String(x == null ? '' : x).trim());
}
var _rmPaceCache = null;
function rmClaimPace_(seg, payer, L){
  if (!_rmPaceCache){
    _rmPaceCache = { tab: {} };
    var v = sheetVals_(RM_PACE_SHEET);
    if (v && v.length >= 2){
      var h = {};
      (v[0] || []).forEach(function(x, i){ var k = String(x == null ? '' : x).trim().toLowerCase(); if (k && h[k] == null) h[k] = i; });
      var need = ['segment', 'payer_flag', 'instance_length_days', 'instance_day', 'cum_pooled_share'];
      if (need.every(function(k){ return h[k] != null; })){
        // D95: LIVE_OPS_V3 (20)'s pull is PER INSTANCE (instance_id; three weekly events, two event ids
        // per arm) - several rows per (cell, length, day, resource). The last row used to win, i.e.
        // whichever instance the sheet happened to list last. Rows of one key are pooled, weighted by
        // their participants; an instance still running at the pull's last day is skipped. One row per
        // key (every older pull) is that row, bit for bit.
        var wsum = {};
        for (var i = 1; i < v.length; i++){
          var r = v[i];
          if (h['status'] != null && String(r[h['status']]).trim().toUpperCase() === 'FAKE') continue;
          if (rmPaceIncomplete_(r, h)) continue;
          var sg = segCanon_(r[h['segment']]), py = String(r[h['payer_flag']]).trim().toUpperCase();
          var len = Math.round(num(r[h['instance_length_days']])), day = Math.round(num(r[h['instance_day']]));
          if (!sg || !(len > 0) || !(day > 0) || String(r[h['cum_pooled_share']]).trim() === '') continue;
          var res = (h['resource'] != null && String(r[h['resource']]).trim()) ? String(r[h['resource']]).trim() : 'ALL';
          var key = sg + '|' + py + '|' + len;
          var t = (_rmPaceCache.tab[key] = _rmPaceCache.tab[key] || {});
          var w = (h['n_participants'] != null && num(r[h['n_participants']]) > 0) ? num(r[h['n_participants']]) : 1;
          var wk = key + '|' + res + '|' + day, tr = (t[res] = t[res] || {});
          if (wsum[wk] === undefined){ wsum[wk] = w; tr[day] = num(r[h['cum_pooled_share']]); }
          else { tr[day] = (tr[day] * wsum[wk] + num(r[h['cum_pooled_share']]) * w) / (wsum[wk] + w); wsum[wk] += w; }
        }
      }
    }
  }
  // D94: canonical segment; a cell the pull has no pace for reads its parent's (250+ -> 100-249)
  var cseg = segCanon_(seg), base = cseg + '|' + String(payer).toUpperCase() + '|', hop = 0;
  while (SEG_PARENT[cseg] && hop++ < 4 &&
         !Object.keys(_rmPaceCache.tab).some(function(k){ return k.indexOf(base) === 0; })){
    cseg = SEG_PARENT[cseg]; base = cseg + '|' + String(payer).toUpperCase() + '|';
  }
  var Lp = _rmPaceCache.tab[base + (L + 1)] ? L + 1 : (_rmPaceCache.tab[base + L] ? L : 0);
  if (!Lp && RM_PACE_STRETCH && L > 0){
    // the carried length closest to this instance (in event days: dates spanned - 1)
    var best = 0;
    Object.keys(_rmPaceCache.tab).forEach(function(k){
      if (k.indexOf(base) !== 0) return;
      var len = Number(k.slice(base.length));
      if (len > 1 && (!best || Math.abs((len - 1) - L) < Math.abs((best - 1) - L))) best = len;
    });
    if (!best) return null;
    var src = _rmPaceCache.tab[base + best], evDays = best - 1;
    var at = function(t, d){
      if (d <= 0) return 0;
      if (d >= best) return 1;
      return (t[d] != null) ? Math.max(0, Math.min(1, t[d])) : null;
    };
    return { L: L, stretchedFrom: best, share: function(res, day){
      var t = src[res];
      if (!t) return null;
      if (day <= 0) return 0;
      if (day >= L) return 1;
      var x = day * evDays / L, lo = Math.floor(x), hi = Math.ceil(x);
      var a = at(t, lo), b = at(t, hi);
      if (a == null || b == null) return null;
      return (lo === hi) ? a : a + (b - a) * (x - lo);
    } };
  }
  if (!Lp) return null;
  var tab = _rmPaceCache.tab[base + Lp];
  return { L: Lp, share: function(res, day){
    var t = tab[res];
    if (!t) return null;
    if (day <= 0) return 0;
    if (day >= Lp) return 1;
    return (t[day] != null) ? Math.max(0, Math.min(1, t[day])) : null;
  } };
}

function simRainbowMaker(seg, payer, ctx){
  var meas = measuredRow_('Rainbow Maker', seg, payer, ctx.ds);
  if (!ctx.calNewOk) return meas;
  if (!rmSortedInsts_(ctx.calNew).length) return zeroRow_();
  var parts = rmInstanceRows_(seg, payer, ctx);
  if (!parts) return meas;                               // no ladder / no matchables -> carry
  var walkNew = zeroRow_();
  parts.forEach(function(p){
    RESOURCES.forEach(function(r){ walkNew[r] = num(walkNew[r]) + num(p.row[r]); });
  });
  if (!RM_REAL_DATA_WINS) return walkNew;                // pre-D61: the walk IS the row
  // D61: anchored on the export, resource by resource (see RM_REAL_DATA_WINS). walkCur is the
  // same walk over cal_curr on the base ladder - the thing the measured side is made of where the
  // export is silent - so the ratio walkNew / walkCur is the model's own statement of what the
  // redesign changes, applied to the level the data measured.
  var walkCur = rmSynth_(seg, payer, ctx);
  if (!walkCur) return walkNew;                          // cal_curr does not run RM: an ADD, as before
  var data = ctx.ds.dataRow('Rainbow Maker', seg, payer), out = zeroRow_();
  RESOURCES.forEach(function(r){
    var m = num(data[r]), c = num(walkCur[r]), n = num(walkNew[r]);
    if (m > 0 && c > 1e-9)  out[r] = m * n / c;          // anchored
    else if (m > 0)         out[r] = m + n;              // export has it, the base ladder never paid it: additive
    else                    out[r] = n;                  // export silent (packs, tickets, traces): the walk, both sides
  });
  return out;
}

// The per-instance rows of ONE side, scaled so they sum to that side's row - what the daily view
// places day by day (D60b/D61). Under RM_REAL_DATA_WINS the row is the export-anchored number and
// the walk is only its SHAPE, so each resource is scaled walk -> row; a resource the walk does not
// carry at all (export has it, base ladder never paid it) is returned as `residual` for the caller
// to place generically. Scale 1 and no residual whenever the walk IS the row, which is every
// pre-D61 case - the caller then sees exactly the parts it always saw.
function rmDailyParts_(seg, payer, ctx, isNew){
  var parts = isNew ? rmInstanceRows_(seg, payer, ctx)
                    : (ctx.calCurOk ? rmInstanceRows_(seg, payer, ctx, { cal: ctx.calCur, useBase: true }) : null);
  if (!parts || !parts.length) return null;
  var target = isNew ? resultRow_('Rainbow Maker', seg, payer, ctx)
                     : measuredRow_('Rainbow Maker', seg, payer, ctx.ds);
  var walk = zeroRow_();
  parts.forEach(function(p){ RESOURCES.forEach(function(r){ walk[r] = num(walk[r]) + num(p.row[r]); }); });
  var scale = {}, residual = zeroRow_(), anyResid = false;
  RESOURCES.forEach(function(r){
    var w = num(walk[r]), t = num(target[r]);
    if (w > 1e-12) scale[r] = t / w;
    else { scale[r] = 0; if (Math.abs(t) > 1e-9){ residual[r] = t; anyResid = true; } }
  });
  var scaled = parts.map(function(p){
    var row = {};
    RESOURCES.forEach(function(r){ row[r] = num(p.row[r]) * scale[r]; });
    return { inst: p.inst, row: row };
  });
  return { parts: scaled, residual: anyResid ? residual : null };
}

// ---- Rainbow Maker on the LIVE matchables distribution (D77, 2026-10-28) --------------------
// data_RM was measured before the event existed and puts participants on 1.3-2.6x the milestones
// they actually claim. LIVE_OPS_V3 (8)'s data_rm_pace carries the event's OWN distribution: the
// cumulative matchables per participant at the end of each date of the measured instances
// (cum_matchables_p25 / p50 / p75 / mean), next to the milestones they had claimed by then. Walked
// up the ladder, it reproduces the measured milestones within 1.5 (data_RM: 1.3-2.6x off) and the
// claim pace within 9 pts on coins and 3 pts on SPT (data_RM: 12.6). When those columns are there:
//   an L-day instance          = the distribution at the end of its day L, read off the measured
//                                event: day d is date d, and the last day of an instance as long
//                                as the measured event is its final date (the closing hours).
//                                A 2-day instance is "the first two days of the 4-day event" - the
//                                same-play-rate assumption the model always made, now measured.
//   end cut-off (first k days) = the distribution at the end of day k
//   start cut-off (last k)     = the whole instance minus what was reached by day L - k
// The curve: piecewise linear through (0,0) (p25,.25) (p50,.5) (p75,.75) (top,1), top chosen so the
// distribution's mean is the measured mean (the pull stops at p75); a zero percentile is the share
// of participants with nothing yet. RM_CLAIM_CALIBRATE scales every rung by the cell's measured /
// modelled milestones at the end of the event (claiming is manual - ~5-18% of reached milestones
// are never claimed at the low segments); uniform, so it cancels in the export-anchored ratio and
// moves only the walk's own levels (packs, tickets). RM_LIVE_MATCHABLES = false -> data_RM and the
// pace curve, exactly as D72 / D75.
var RM_LIVE_MATCHABLES = true;
var RM_CLAIM_CALIBRATE = true;
var _rmLiveCache = null;
function rmLiveTab_(){
  if (_rmLiveCache) return _rmLiveCache;
  _rmLiveCache = {};
  var v = sheetVals_(RM_PACE_SHEET);
  if (!v || v.length < 2) return _rmLiveCache;
  var h = {};
  (v[0] || []).forEach(function(x, i){ var k = String(x == null ? '' : x).trim().toLowerCase(); if (k && h[k] == null) h[k] = i; });
  var need = ['segment', 'payer_flag', 'instance_length_days', 'instance_day',
              'cum_matchables_p25', 'cum_matchables_p50', 'cum_matchables_p75', 'cum_matchables_mean'];
  if (!need.every(function(k){ return h[k] != null; })) return _rmLiveCache;
  // D95: one record per (cell, length, day) AND instance (instance_id when the pull is per instance -
  // LIVE_OPS_V3 (20); '' otherwise, which is every older pull and exactly the old read), then the
  // instances pooled by their participants. The percentiles of a pool are not the mean of the
  // instances' percentiles - close here (the same event a week apart), FLAGGED.
  var byInst = {};
  for (var i = 1; i < v.length; i++){
    var r = v[i];
    if (h['status'] != null && String(r[h['status']]).trim().toUpperCase() === 'FAKE') continue;
    if (rmPaceIncomplete_(r, h)) continue;
    // the matchables are per (player, instance), the same on every resource row: read ALL, else the first
    var res = (h['resource'] != null) ? String(r[h['resource']]).trim() : 'ALL';
    var sg = segCanon_(r[h['segment']]), py = String(r[h['payer_flag']]).trim().toUpperCase();
    var len = Math.round(num(r[h['instance_length_days']])), day = Math.round(num(r[h['instance_day']]));
    if (!sg || !(len > 1) || !(day > 0) || String(r[h['cum_matchables_p50']]).trim() === '') continue;
    var iid = (h['instance_id'] != null) ? String(r[h['instance_id']] == null ? '' : r[h['instance_id']]).trim() : '';
    var bk = sg + '|' + py + '|' + len + '|' + day, slot = (byInst[bk] = byInst[bk] || { order: [], rec: {} });
    if (slot.rec[iid] && slot.rec[iid].res === 'ALL') continue;
    if (!slot.rec[iid]) slot.order.push(iid);
    slot.rec[iid] = { res: res, p25: num(r[h['cum_matchables_p25']]), p50: num(r[h['cum_matchables_p50']]),
               p75: num(r[h['cum_matchables_p75']]), mean: num(r[h['cum_matchables_mean']]),
               ms: (h['cum_milestones_claimed_mean'] != null) ? num(r[h['cum_milestones_claimed_mean']]) : null,
               w: (h['n_participants'] != null && num(r[h['n_participants']]) > 0) ? num(r[h['n_participants']]) : 1,
               seg: sg, py: py, len: len, day: day };
  }
  Object.keys(byInst).forEach(function(bk){
    var slot = byInst[bk], first = slot.rec[slot.order[0]], rec;
    if (slot.order.length === 1) rec = { res: first.res, p25: first.p25, p50: first.p50, p75: first.p75, mean: first.mean, ms: first.ms };
    else {
      rec = { res: 'ALL', p25: 0, p50: 0, p75: 0, mean: 0, ms: null };
      var ws = 0, msW = 0, msS = 0;
      slot.order.forEach(function(id){
        var x = slot.rec[id];
        rec.p25 += x.w * x.p25; rec.p50 += x.w * x.p50; rec.p75 += x.w * x.p75; rec.mean += x.w * x.mean; ws += x.w;
        if (x.ms != null){ msS += x.w * x.ms; msW += x.w; }
      });
      rec.p25 /= ws; rec.p50 /= ws; rec.p75 /= ws; rec.mean /= ws;
      if (msW > 0) rec.ms = msS / msW;
    }
    var key = first.seg + '|' + first.py, t = (_rmLiveCache[key] = _rmLiveCache[key] || {});
    (t[first.len] = t[first.len] || {})[first.day] = rec;
  });
  return _rmLiveCache;
}
/** The survival over one date's distribution: P(matchables >= x). */
function rmLiveSurv_(q){
  var top = Math.max(q.p75, 8 * q.mean - 2 * (q.p25 + q.p50 + q.p75));
  var pts = [[0, 0], [q.p25, .25], [q.p50, .5], [q.p75, .75], [top, 1]];
  return function(x){
    if (!(x > 0)) return 1;
    var cdf = 1;
    for (var i = 1; i < pts.length; i++){
      if (x <= pts[i][0]){
        var a = pts[i - 1], b = pts[i];
        cdf = (b[0] > a[0]) ? a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]) : a[1];
        // a zero-width step (p25 = 0): the share at 0 is the upper level of the step
        for (var j = i - 1; j >= 1 && pts[j][0] === a[0]; j--) cdf = Math.max(cdf, pts[j][1]);
        break;
      }
    }
    return Math.max(0, 1 - cdf);
  };
}
/** The quantile u of one date's distribution (the play-by-play view's luck). */
function rmLiveQuantile_(q, u){
  var top = Math.max(q.p75, 8 * q.mean - 2 * (q.p25 + q.p50 + q.p75));
  var pts = [[0, 0], [q.p25, .25], [q.p50, .5], [q.p75, .75], [top, 1]];
  for (var i = 1; i < pts.length; i++)
    if (u <= pts[i][1]) return pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * (u - pts[i - 1][1]) / Math.max(1e-12, pts[i][1] - pts[i - 1][1]);
  return top;
}
/** The live distribution of one cell, or null: { Ls, at(d, L), kappa }. at(d, L) is the date
 *  record at the end of day d of an L-day instance (null for d <= 0). */
var _rmLiveCell = {};
function rmLive_(seg, payer){
  if (!RM_LIVE_MATCHABLES) return null;
  var key = segCanon_(seg) + '|' + String(payer).toUpperCase();
  if (_rmLiveCell[key] !== undefined) return _rmLiveCell[key];
  // D94: canonical segment; a cell the pull has no distribution for reads its parent's (250+ -> 100-249)
  var t = rmLiveTab_()[key], pseg = segCanon_(seg), hop = 0;
  while (!t && SEG_PARENT[pseg] && hop++ < 4){ pseg = SEG_PARENT[pseg]; t = rmLiveTab_()[pseg + '|' + String(payer).toUpperCase()]; }
  if (!t) return (_rmLiveCell[key] = null);
  var Ls = 0;
  Object.keys(t).forEach(function(k){ if (+k > Ls) Ls = +k; });    // the longest measured instance
  var tab = t[Ls];
  if (!tab || !tab[Ls]) return (_rmLiveCell[key] = null);
  var at = function(d, L){
    if (!(d > 0)) return null;
    var dt = (d >= L && L >= Ls - 1) ? Ls : Math.min(d, Ls);
    return tab[dt] || null;
  };
  var kappa = 1;
  if (RM_CLAIM_CALIBRATE && tab[Ls].ms != null){
    var base = rmConfigByName_(RM_HALF_SHEETS[0], true).ladder, S = rmLiveSurv_(tab[Ls]), model = 0;
    base.forEach(function(ms){ model += S(ms.req); });
    if (model > 0) kappa = tab[Ls].ms / model;
  }
  return (_rmLiveCell[key] = { Ls: Ls, at: at, kappa: kappa });
}

// Per-instance contributions over cal_new (start-sorted): [{inst, row}] — simRainbowMaker sums
// them; the daily view places each instance's OWN row on its days (so RM_2nd-only resources
// like SPTx2 never leak onto RM_1st instance days). Returns null when there is no matchables
// distribution or no readable ladder anywhere (callers carry measured, as before the split).
// opts (2026-09-03): {cal, useBase} - which calendar's instances to price, and whether to read
// the BASE ladder instead of the _v2 one. Defaults are cal_new + _v2, i.e. exactly the simulated
// side this function has always produced, so every existing caller is unchanged.
function rmInstanceRows_(seg, payer, ctx, opts){
  var ds = ctx.ds, pct = ds.rmPct(seg, payer);
  if (!pct && !rmLive_(seg, payer)) return null;          // D77: the live distribution suffices
  var cal = (opts && opts.cal) || ctx.calNew, useBase = !!(opts && opts.useBase);
  // the edges of the view being priced: the window, or the whole grid (opts.full - D71's rescale)
  var w = (ctx && ctx.window) || calWindow_();
  var first = (opts && opts.full) ? 1 - num(w.offset) : 1;
  var last  = (opts && opts.full) ? calGridDays_() - num(w.offset) : num(w.days);
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  var any = false;
  var parts = rmSortedInsts_(cal).map(function(inst){
    var cfg = rmConfigForInst_(inst, useBase), row = zeroRow_();
    if (cfg.ladder.length){
      any = true;
      var P = rmRungP_(inst, cfg, pct, seg, payer, ds, first, last, rmGeo_(ctx, cal, cfg));
      if (P){
        var reach = reachOne_(inst, pWd, pWe);
        cfg.ladder.forEach(function(ms){
          for (var res in ms.rew) row[res] = num(row[res]) + ms.rew[res] * P(ms.req, res) * reach;
        });
      }
      // D26, applied to Rainbow Maker too (2026-10-28): an instance WHOLLY past the album's last day
      // pays no envelopes - every other source drops it from packLane_'s reach and the card sim
      // drops it from the plan, but RM's packs come from this walk, which never asked. Latent on the
      // 33-day grid (its last RM instance straddled day 28). Tickets and every other resource keep
      // paying; a straddler pays in full. Both sides, so identical calendars still cancel.
      if (!instInSeason_(inst)) PACK_RES.forEach(function(r){ row[r] = 0; });
    }
    return { inst: inst, row: row };
  });
  return any ? parts : null;
}
// P(req, res): the chance a player of this instance claims the rung at `req` INSIDE the view.
// The matchables axis is data_RM's percentiles x (length / Dm), Dm = the measured instance length.
//   interior instance  S(req) at scale dur / Dm
//   end cut-off        S(req) at scale (L / Dm) x the pace at day k
//   start cut-off      S_full(req) - S(req at scale (L / Dm) x the pace at day L - k)
// With data_rm_pace the CLAIM share replaces the matchables pace: P = S_full(req) x share.
// geo = {Dm, Lcal} (rmGeo_); omitted -> read off the live context's cal_new.
function rmRungP_(inst, cfg, pct, seg, payer, ds, first, last, geo){
  if (!geo){ var cx = Context.get(); geo = rmGeo_(cx, cx.calNew, cfg); }
  // D77: the live distribution, when the pull carries it (see rmLive_)
  var live = rmLive_(seg, payer);
  if (live){
    var cutL = rmCutoff_(inst, cfg, first, last, geo.Lcal), kap = live.kappa;
    var S = function(d, L){ var q = live.at(d, L); return q ? rmLiveSurv_(q) : function(){ return 0; }; };
    if (!cutL){ var Si = S(inst.dur, inst.dur); return function(req){ return kap * Si(req); }; }
    if (cutL.side === 'end'){ var Se = S(cutL.k, cutL.L); return function(req){ return kap * Se(req); }; }
    var Sw = S(cutL.L, cutL.L), Sb = S(cutL.L - cutL.k, cutL.L);
    return function(req){ return kap * Math.max(0, Sw(req) - Sb(req)); };
  }
  if (!pct) return null;
  var Dm = num(geo.Dm) || num(cfg.cfgDur) || 4;
  function S_(scale){
    return survival_([[pct.p10*scale,.10],[pct.p25*scale,.25],[pct.p50*scale,.50],
                      [pct.p75*scale,.75],[pct.p90*scale,.90]]);
  }
  var cut = rmCutoff_(inst, cfg, first, last, geo.Lcal);
  if (!cut){
    var S0 = S_(Math.min(1, inst.dur / Dm));
    return S0 ? function(req){ return S0(req); } : null;
  }
  var full = Math.min(1, cut.L / Dm);
  var Sfull = S_(full);
  if (!Sfull) return null;
  var pace = rmClaimPace_(seg, payer, cut.L);
  if (pace){
    // days before the window (start cut-off) or in it (end cut-off), in the pull's own day count
    var dIn = (cut.side === 'end') ? cut.k : cut.L - cut.k;
    return function(req, res){
      var sh = pace.share(res, dIn);
      if (sh == null) sh = pace.share('ALL', dIn);
      if (sh == null) sh = rmMatchShare_(ds, seg, payer, dIn, cut.L);
      return Sfull(req) * ((cut.side === 'end') ? sh : 1 - sh);
    };
  }
  if (cut.side === 'end'){
    var Se = S_(full * rmMatchShare_(ds, seg, payer, cut.k, cut.L));
    return Se ? function(req){ return Se(req); } : null;
  }
  var Sb = S_(full * rmMatchShare_(ds, seg, payer, cut.L - cut.k, cut.L));
  return function(req){ return Math.max(0, Sfull(req) - (Sb ? Sb(req) : 0)); };
}

// ---- RAINBOW MAKER: the DIFFERENCE SIM (D29, 2026-09-03) -----------------------------------
// Until now RM was priced bottom-up on cal_new and compared against a data_gains anchor that does
// not exist (the export carries soft-launch traces at best, and none at all in the current
// workbook). The row therefore always read as an ADD: sim minus zero, whatever the old calendar
// did. "Both calendars run Rainbow Maker, what does changing the rewards or the cadence do" was
// not a question the model could answer at all.
//
// It is answered the way Core SPT and Season Pass (Paid) already answer it: SYNTHESISE the
// measured side rather than inventing an anchor out of telemetry that was never exported.
//
//   measured[res] = SUM over cal_CURR instances of  SUM_k S_dur(ReqAccum_k) x reward_k[res] x reach
//                   priced on the BASE ladder (RM_1st / RM_2nd)
//   simulated[res] = the same walk over cal_NEW, priced on the _v2 ladder      (unchanged)
//
// So the DIFF is (new calendar, new rewards) - (old calendar, old rewards), and BOTH halves come
// out of the same bottom-up machinery. That is the point: the machinery's level error is the
// standing unvalidated thing about Rainbow Maker, and putting it on both sides makes it largely
// cancel, exactly as anchoring does for Night Sky. A reward edit on RM_*_v2 moves the sim side
// only; a cadence edit on either calendar moves the instances that side prices.
//
// User decisions (2026-09-03):
//   * anchor reads the BASE ladder, so reward AND cadence edits both show in the diff;
//   * cal_curr instances take the SAME positional RM_INSTANCE_SHEETS split as cal_new (#1-#3 the
//     1st-half sheet, #4+ the 2nd-half), start-sorted - wrong in the same way on both sides, so
//     it cancels;
//   * real data_gains rows do NOT silently take over: the changeover is a FLAG, below.
//   * the anchor DOES enter the measured SPT total (it reaches sptTotals_ through measuredRow_,
//     which is the one choke point), so the measured and simulated Season Pass tiers price the
//     same faucet. RM pays ~322 SPT a season in the current sim, so leaving it out would have
//     shown a Season Pass gain that was really an artefact of the anchor missing.
//
// NO cal_curr INSTANCES -> null -> the row stays exactly what it is today: an add, with the whole
// lane in the diff. That is the correct reading of a calendar that does not run the event, and it
// is why turning this on changes nothing about the current workbook.
var RM_ANCHORED = true;          // false -> pre-D29: measured comes from data_gains alone
// When data_gains carries real Rainbow Maker rows, do they replace the synthetic anchor?
// Shipped FALSE on 2026-09-03 (the changeover is a decision, not a side effect of a re-pull);
// flipped TRUE on 2026-10-14 (D61, user decision) once the export carried the live event:
// 40-99 PAYER HC 147 / SPT 897 measured against a synthetic 1,582 / 4,153 - the bottom-up walk
// overshoots the real event 4.6-10.8x, and that overshoot was the whole excess of the sim's SPT
// faucet over data_econ (2.3x at 0-9, 1.4x at 100+).
//
// WHAT 'WINS' MEANS - PER RESOURCE, never per row. The export can be silent on a resource for
// three different reasons (packs and tickets it cannot see; soft-launch traces, as on the ECO
// workbook where the RM rows are 0.02 SPTx2 and nothing else; a resource the base ladder does not
// pay), and in all of them the synthetic walk stays for THAT resource on BOTH sides. Where the
// export has a number:
//     measured[r] = export[r]
//     sim[r]      = export[r] x walk_new[r] / walk_cur[r]      (level from the data, change from
//                                                               the walk - the measured x R x T
//                                                               shape every anchored source has)
// so identical calendars with identical ladders give DIFF 0, and a reward or cadence edit moves
// the row by the walk's RATIO rather than its absolute level. See simRainbowMaker.
var RM_REAL_DATA_WINS = true;

function rmSynth_(seg, payer, ctx){
  if (!RM_ANCHORED || !ctx || !ctx.calCurOk) return null;
  if (!rmSortedInsts_(ctx.calCur).length) return null;      // old calendar does not run RM -> add
  var parts = rmInstanceRows_(seg, payer, ctx, { cal: ctx.calCur, useBase: true });
  if (!parts) return null;                                  // no matchables / no base ladder
  var out = zeroRow_();
  parts.forEach(function(p){
    RESOURCES.forEach(function(r){ out[r] = num(out[r]) + num(p.row[r]); });
  });
  return out;
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
  if (sptTotalsBusy_(ctx, seg, payer)) return meas;    // defensive re-entry guard (see header)
  if (!ctx.calCurOk || !ctx.calNewOk) return meas;     // parse fail -> carry (canary catches)
  var cur = ctx.calCur['Season Pass'] || [], nw = ctx.calNew['Season Pass'] || [];
  if (!nw.length) return zeroRow_();                   // removed from the new calendar
  if (!cur.length) return meas;                        // no anchor-side instances -> carry
  var base = readSPTrack_('SP');
  if (!base.cum.length) return meas;                   // SP sheet unreadable -> carry
  var v2Name = spV2Sheet_('SP');
  var v2 = (v2Name === 'SP') ? base : readSPTrack_(v2Name);
  if (!v2.cum.length) v2 = base;
  var daysBase = readSPSeasonDays_('SP') || windowDays_();   // no config panel yet -> season = window
  var daysV2   = (v2Name !== 'SP' && readSPSeasonDays_(v2Name)) || daysBase;
  var t  = sptTotals_(seg, payer, ctx);
  var Tm = spTier_(t.meas * daysBase / windowDays_(), base.cum);
  var Ts = spTier_(t.sim  * daysV2   / windowDays_(), v2.cum);
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
  var Ts = spTier_(t.sim * sp.daysV2 / windowDays_(), sp.v2.cum);
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
  var daysBase = readSPSeasonDays_('SP') || windowDays_();
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
  var Tm = spTier_(measuredSptTotal_(seg, payer, ds) * sp.daysBase / windowDays_(), sp.base.cum);
  if (!(Tm > 0)) return zeroRow_();
  return spPaidCum_(sp.base, Tm);
}

// Per-earner MEASURED SPT + 2xSPTx2 across every category. The measured half of sptTotals_, pulled
// out so it needs only `ds` (no calendars, no ctx) and can therefore be reached from measuredRow_.
// Cached per (seg, payer) on the module, alongside the per-execution sheet cache.
// D62: keyed on the ToF cycle mode like sptTotals_ - inside the ToF anchor's own ticket walk the
// total leaves the ToF row out by rule. Same-key re-entry (the Season Pass pack synths ask for the
// total while it is being summed) contributes 0: packs and tickets carry no SPT, so the total
// itself is unaffected, and the busy map is per key so the inner mode is never mistaken for it.
var _measSptCache = {}, _measSptBusyKeys = {};
function measuredSptTotal_(seg, payer, ds){
  var mode = tofCycleMode_(), noToF = !!mode;
  var key = seg + '|' + payer + mode;
  if (_measSptCache[key] != null) return _measSptCache[key];
  if (_measSptBusyKeys[key]) return 0;
  // Reached from inside the buff-minutes walk of the same key (the Core row's SPTx2 read walks
  // every measured row, and the Season Pass pack synths ask for this total on the way): Core's
  // SPT reads 0 minutes in there (the walk's own busy backstop), so this sum is short by the buff
  // conversion (105 at 20-39 PAYER). Serve it - the walk only wants the SPTx2 column, which packs
  // never touch - but never memo it, or the measured Season Pass tier is priced off it for good.
  var volatile = !!_x2MinBusyKeys[key];
  var total = 0;
  _measSptBusyKeys[key] = true;
  try {
    CATEGORY_ORDER.forEach(function(cat){
      if (cat === 'Season Pass (Paid)') return;        // the row being anchored; pays no SPT anyway
      if (noToF && cat === TOF_CAT) return;
      if (COL_CATS[cat]) return;                       // D67: priced off this tier, out of it (as in sptTotals_)
      var row = measuredRow_(cat, seg, payer, ds);
      total += sptScore_(row);
    });
  } finally { delete _measSptBusyKeys[key]; }
  return volatile ? total : (_measSptCache[key] = total);
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
function spPackTiers_(seg, payer, ctx, prof, Tforce){
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
  var daysBase = readSPSeasonDays_('SP') || windowDays_();
  var daysV2 = (v2Name !== 'SP' && readSPSeasonDays_(v2Name)) || daysBase;
  var t = sptTotals_(seg, payer, ctx);
  var Ts = spTier_(t.sim * daysV2 / windowDays_(), v2.cum);
  // A full-pass profile owns the WHOLE track rather than the tier its SPT income reaches. Set from
  // the ladder's own length, so a 30-tier pass and a 50-tier pass both work with no constant here.
  if (prof && prof.fullPass) Ts = v2.free.length;
  // D79: the card sim asks for the track at ONE player's own tier (CARD_SP_PER_PLAYER)
  if (Tforce != null) Ts = Math.max(0, Math.min(v2.free.length, Math.round(Tforce)));
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
// Neither has a measured anchor (data_gains has no such category), so both are simulated.
//
// UNTIL 2026-09-07 they were a CLOSED FORM: treat every card drawn as an independent lottery ticket
// over the SNAP POOL, multiply the per-card ownership probabilities to get P(set done), sum the set
// rewards against it. That formula ignored four things the card sim does, and all four make a
// collection fill FASTER:
//   * the PackConfig ALBUM SET SKEW, which deliberately aims draws at unfinished sets
//   * both pity mechanisms (force a rare card; force an unowned card after a dry streak)
//   * star chests, which buy extra envelopes with duplicate stars
//   * cards leave the pool when drawn - the formula put them back
// Its own comment called it "a floor, not a midpoint", and the gap was not small: at 40-99 PAYER
// 176 HC against the card sim's 378, and at 10-19 NONPAYER 0.2 against 25. The album row was worse
// than a floor - it multiplied ~72 ownership probabilities, which collapses to almost nothing, so
// it reported ZERO album rewards for every segment while the card sim finishes an album in 9.5% of
// 40-99 PAYER seasons (a 1,000-coin lump, so a mean of 95 with a median and a p90 of 0).
//
// So the formula is gone. These two rows now RUN THE CARD SIM - the same runOneCardSeason_ the menu
// uses - COL_SIM_SEASONS times per (segment, payer), and average what those seasons actually
// collected. There is no second model left to drift, which is the whole point: this is the third
// time a duplicated model has produced two disagreeing numbers on one workbook.
//
// COST, measured 2026-09-07: ~7ms per season in node, so 50 seasons is ~0.4s there and an estimated
// 3-7s inside a Sheets custom function (5-20x slower). 200 seasons would breach the 30-second
// custom-function limit at the slow end, which is why 50 is the ceiling rather than the ideal.
//
// PRECISION. Set completions are frequent, so that row is steady. ALBUM completions are a rare
// 1,000-coin jackpot (9.5% of seasons at 40-99 PAYER), and 50 seasons puts roughly +/-40% of
// relative error on that row. It is deterministic - a fixed seed, so the cell never changes when
// nothing changed - but it is an estimate, and a config edit smaller than that band will not be
// visible in the album row. FLAGGED for the user: the lever, if it ever matters, is reading the
// menu-run cloud sim's numbers (it can afford 200+ players) instead of running seasons here.
var COL_SIM_SEASONS = 50;
// FIXED, deliberately. A spreadsheet cell must not change value when nothing changed, and two
// calendars have to be compared on identical dice. Every segment reuses the same seed sequence, so
// the differences BETWEEN segments carry less sampling noise than their absolute levels do.
var COL_SIM_SEED    = 20260907;

// The card sim's reward names -> engine resource names. setRewardGains / albumRewardGains are keyed
// by the 21-column block's own labels ('Coins', 'SPT x2', '1-star Dly'), which RES_MAP translates.
// 'COOP Token' and 'Avatar' are not engine resources and drop out here, exactly as they do
// everywhere else.
function colGainsToRow_(gains){
  var out = zeroRow_();
  if (!gains) return out;
  for (var name in gains){
    var res = RES_MAP[name];
    if (res && out[res] != null) out[res] = num(out[res]) + num(gains[name]);
  }
  return out;
}

// COL_SIM_SEASONS seasons for one (segment, payer), averaged. Cached on ctx so the two rows share
// one batch: 'Col - Sets' and 'Col - Albums' are both asked for inside the same spill, and running
// the seasons twice would double the cost of every recalc for nothing.
//
// RE-ENTRANCY. cardSeasonPre_ walks every category (it needs each source's ticket income and the
// pack grant plan), and this function IS one of those categories - so asking for Col - Sets asks
// for Col - Sets. Broken the same way expectedCardsDrawn_ broke it: while the seasons are being
// set up, these two rows contribute zero. That very slightly understates the ticket income used to
// price ToF runs inside those seasons (collection rewards can carry tickets), which is second order
// and the only resolution that terminates without a second full pass.
// D67: `side` 'new' (default) runs the seasons over cal_new on the _v2 ladders - the simulated
// row; 'cur' runs the SAME seasons (same seeds, same PackConfig / AlbumConfig) over cal_curr on the
// base ladders - the measured row where the export is silent. Identical calendars and identical
// ladders therefore give two identical batches, and a calendar change is priced on common random
// numbers rather than on two independent noisy draws. The busy flag is module-level because the
// 'cur' run works on a CLONE of ctx (baseCtx_), and a flag on one object is invisible on the other.
var COL_ANCHORED = true;
var COL_CATS = { 'Col - Sets': 1, 'Col - Albums': 1 };
var _colSimBusy = false;
function colSimSeasons_(seg, payer, ctx, side){
  side = (side === 'cur') ? 'cur' : 'new';
  try { ctx = ctx || Context.get(); } catch (e){ return null; }
  if (!ctx) return null;
  ctx._colSim = ctx._colSim || {};
  seg = segCanon_(seg);                                 // D94
  var key = seg + '|' + payer + (side === 'cur' ? '|cur' : '');
  if (ctx._colSim[key] !== undefined) return ctx._colSim[key];
  if (_colSimBusy || ctx._colBusy) return null;        // re-entry: contribute nothing to our input
  // D94: ALL is not a cohort the card sim plays - album and set completion are threshold outcomes of
  // each segment's own activity, ranks and ladders, so the population's seasons are its member
  // segments' seasons pooled by their players (the album run's own 'All' rule, D89).
  if (seg === SEG_ALL){
    var mixA = segMix_(payer, ctx.ds), pooled = null, wA = 0;
    mixA.forEach(function(x){
      var one = colSimSeasons_(x.seg, payer, ctx, side);
      if (!one) return;
      pooled = pooled || { sets: zeroRow_(), albums: zeroRow_(), n: one.n, albumsPerSeason: 0, pooled: true };
      RESOURCES.forEach(function(r){ pooled.sets[r] += x.w * num(one.sets[r]); pooled.albums[r] += x.w * num(one.albums[r]); });
      pooled.albumsPerSeason += x.w * num(one.albumsPerSeason);
      wA += x.w;
    });
    if (pooled && wA > 0 && wA < 1 - 1e-9){               // a member with no seasons: over the ones that ran
      RESOURCES.forEach(function(r){ pooled.sets[r] /= wA; pooled.albums[r] /= wA; });
      pooled.albumsPerSeason /= wA;
    }
    return (ctx._colSim[key] = pooled);
  }
  // D89b: the album run's own seasons (calibrated, its player count) while saved under these inputs
  if (typeof albumGainsFor_ === 'function'){
    var saved = albumGainsFor_(seg, payer, side);
    if (saved) return (ctx._colSim[key] = saved);
  }
  if (side === 'cur' && !ctx.calCurOk) return (ctx._colSim[key] = null);
  // No card sim in the project (or an older workbook with no PackConfig worth reading) means there
  // is no card collection to pay out. Zero, and say so - not a formula nobody asked for.
  if (typeof runOneCardSeason_ !== 'function' || typeof loadPackConfig_ !== 'function'){
    try { Logger.log('Col - Sets / Col - Albums: CardOpenings.gs is not in this project, so the ' +
                     'two collection rows read 0. Paste it to simulate them.'); } catch(e){}
    return (ctx._colSim[key] = null);
  }
  var out = null, wasBase = _baseSide;
  _colSimBusy = true;
  try {
    // the measured side: cal_curr on both calendar slots, every pack ladder read off the BASE sheet.
    // D79: set BEFORE the configs load - the card sheets themselves are side-aware now (cardSheet_)
    var runCtx = ctx;
    if (side === 'cur'){ runCtx = baseCtx_(ctx); _baseSide = true; }
    var cfg = loadPackConfig_();
    var albumName = (typeof cardSheet_ === 'function') ? cardSheet_('AlbumConfig') : 'AlbumConfig';
    var album = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(albumName);
    if (!album) throw new Error("sheet '" + albumName + "' not found");
    var cat = loadCardCatalog_(cfg, album);
    var pre = cardSeasonPre_(seg, payer, runCtx);
    var n = (COL_SIM_SEASONS > 0) ? Math.round(COL_SIM_SEASONS) : 1;
    var sets = zeroRow_(), albums = zeroRow_(), albumsDone = 0;
    for (var i = 0; i < n; i++){
      var r = runOneCardSeason_(seg, payer, COL_SIM_SEED + i * 7919, cfg, cat, pre);
      var sr = colGainsToRow_(r.setRewardGains), ar = colGainsToRow_(r.albumRewardGains);
      RESOURCES.forEach(function(res){
        sets[res]   = num(sets[res])   + num(sr[res]);
        albums[res] = num(albums[res]) + num(ar[res]);
      });
      albumsDone += num(r.albumIdx);
    }
    RESOURCES.forEach(function(res){
      sets[res]   = num(sets[res])   / n;
      albums[res] = num(albums[res]) / n;
    });
    out = { sets: sets, albums: albums, n: n, albumsPerSeason: albumsDone / n };
  } catch (e){
    try { Logger.log('Col - Sets / Col - Albums could not be simulated (' + e.message +
                     ') - both rows read 0.'); } catch(e2){}
    out = null;
  } finally { _colSimBusy = false; _baseSide = wasBase; }
  return (ctx._colSim[key] = out);
}

function colRewardRow_(which, seg, payer, ctx){
  if (segIsAppendix_(seg)) return zeroRow_();               // no behaviour telemetry -> no packs
  var sim = colSimSeasons_(seg, payer, ctx, 'new');
  if (!sim) return zeroRow_();
  var walkNew = (which === 'sets') ? sim.sets : sim.albums;
  if (!COL_ANCHORED || _baseSide) return walkNew;
  // D67: where the export has a number it is the level, and the two batches are the change
  // (the RM rule, D61a). Where it is silent the walk stands on both sides.
  var data = ctx.ds.dataRow((which === 'sets') ? 'Col - Sets' : 'Col - Albums', seg, payer);
  if (!anyAmount_(data)) return walkNew;
  var cur = colSimSeasons_(seg, payer, ctx, 'cur');
  var walkCur = cur ? ((which === 'sets') ? cur.sets : cur.albums) : null;
  var out = zeroRow_();
  RESOURCES.forEach(function(r){
    var m = num(data[r]), c = walkCur ? num(walkCur[r]) : 0, n = num(walkNew[r]);
    if (m > 0 && c > 1e-9) out[r] = m * n / c;
    else if (m > 0)        out[r] = m + n;
    else                   out[r] = n;
  });
  return out;
}
function simColSets  (seg, payer, ctx){ return colRewardRow_('sets',   seg, payer, ctx); }
function simColAlbums(seg, payer, ctx){ return colRewardRow_('albums', seg, payer, ctx); }

// expectedCardsDrawn_, colCardsPerOpen_ and colPool_ lived here until 2026-09-07. They existed only
// to feed the closed-form collection estimate above, which has been replaced by running the card
// sim itself, so all three are gone rather than left as a second reader of PackConfig and
// AlbumConfig that nothing calls. COL_REWARD_COLS below is kept: it is the reward-block layout, and
// it is still read by the season-pass and pack lanes.

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
// D62: keyed on the ToF cycle mode. In `noToF` mode (ToF's own inputs are being built) the ToF
// row is left out on BOTH sides by rule, so the Season Pass rows inside ToF's ticket income are
// priced off a total that is the same whoever triggered it; the full total has its own key.
function sptTotals_(seg, payer, ctx){
  ctx._spt = ctx._spt || {};
  var mode = tofCycleMode_(), noToF = !!mode;
  var key = seg + '|' + payer + mode;
  if (ctx._spt[key]) return ctx._spt[key];
  ctx._sptBusyKeys = ctx._sptBusyKeys || {};
  if (ctx._sptBusyKeys[key]) return { meas: 0, sim: 0 };   // same-key re-entry: none by design (backstop)
  var ds = ctx.ds, meas = 0, sim = 0;
  ctx._sptBusyKeys[key] = true;
  try {
    CATEGORY_ORDER.forEach(function(cat){
      if (noToF && cat === TOF_CAT) return;
      // D67: the collection rows are priced OFF this tier, so they are out of it on BOTH sides.
      // Until D67 they were out of the simulated side only, which was invisible while their
      // measured side was a silent export (0) and would have lifted the measured tier by the
      // collection's own SPT the moment it was anchored.
      if (COL_CATS[cat]) return;
      // measuredRow_ (not raw ds.gains) so the D18 synthetic Core SPT anchor enters the
      // measured total too — both sides then price the same level-completion faucet.
      var mrow = measuredRow_(cat, seg, payer, ds);
      var mScore = sptScore_(mrow);
      meas += mScore;
      // The Season Pass rows and the two collection rows are all priced OFF this total, so they
      // must not be inside it: Free contributes measured on both sides (the original recursion
      // guard) and the other three contribute nothing at all. Without this the tier the player
      // reaches would depend on the rewards that tier itself pays.
      if (cat === 'Season Pass (Free)'){ sim += mScore; return; }
      if (cat === 'Season Pass (Paid)' || cat === 'Col - Sets' || cat === 'Col - Albums') return;
      var row = resultRow_(cat, seg, payer, ctx);
      sim += sptScore_(row);
    });
  } finally { delete ctx._sptBusyKeys[key]; }
  return (ctx._spt[key] = { meas: meas, sim: sim });
}
// True while the total THIS call would read is being computed (the keyed form of the old
// ctx._sptBusy backstop in simSeasonPass).
function sptTotalsBusy_(ctx, seg, payer){
  return !!(ctx._sptBusyKeys && ctx._sptBusyKeys[seg + '|' + payer + tofCycleMode_()]);
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
  var days = 0;                                   // expected active days over the window (D70)
  for (var d = 1; d <= windowDays_(); d++) days += isWeekend_(d) ? pWe : pWd;
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


// ---- SPTx2 = MINUTES OF DOUBLED LEVEL-COMPLETION SPT (D54, 2026-09-14) ----------------------
// SPTx2 is a BUFF TIMER, not a token count, and data_gains says so in its own "unit" column:
// SPT is "count", SPTx2 is "minutes" - filed alongside Unlimited Lives / UL Red / UL Bomb /
// UL Chuck, the other duration resources. While the buff runs, every level the player COMPLETES
// pays twice the SPT it normally would, so m minutes are worth one EXTRA E_SPT per completion
// that fits inside them:
//
//     extra SPT = (m / minutesPerLevel) x utilization x E_SPT
//
// Before this, sptTotals_ scored the column as "SPT + 2 x SPTx2" - multiplying MINUTES by two and
// adding them to a token count, which is dimensionally wrong rather than merely mis-tuned. That
// scoring is gone. The conversion happens once, and the result lands on CORE (user decision
// 2026-09-14) because Core is where the doubled completions actually happen: a buff granted by
// Rainbow Maker does not pay Rainbow Maker tokens, it pays the level-completion faucet twice.
// Consequence, deliberate: the granting source keeps its SPTx2 MINUTES in its own column and its
// SPT column does not move, while Core SPT carries every buff in the season pooled together.
//
// It reaches the Season Pass through the same door as every other SPT token: Core SPT is inside
// sptTotals_, so a bigger buff supply moves the tier and therefore the rewards the track pays.
//
// SPTX2_AS_MINUTES = false restores the pre-D54 "SPT + 2 x SPTx2" scoring exactly.
var SPTX2_AS_MINUTES  = true;
var SPTX2_UTILIZATION = 1.0;   // fallback when the SP panel carries no 'SPTx2 Utilization' cell

// Minutes one level completion takes, per segment x payer - MEASURED, not assumed:
//     minutes_per_active_day / levels_completed_per_active_day        (data_seg_beh)
// 4.55 min at 0-9 NONPAYER down to 1.96 at 100+ PAYER, so the same 5-minute buff buys 1.1 extra
// completions for a beginner and 2.6 for a whale. Pricing it per cell is the point: a flat number
// would hand both the same conversion when measurement says they are 2.3x apart.
// An authored 'Minutes per Level' cell on the SP panel overrides every cell when it is > 0.
// No behaviour telemetry (A. 0) -> 0, and the caller then converts nothing.
function minutesPerLevel_(seg, payer, ds){
  var ov = num(readSPLabel_('SP', 'Minutes per Level'));
  if (ov > 0) return ov;
  var b = ds.beh(seg, payer);
  var m = num(b.minutes_per_active_day), l = num(b.levels_completed_per_active_day);
  return (m > 0 && l > 0) ? m / l : 0;
}

// Share of granted buff minutes actually spent completing levels. ASSUMPTION, flagged: a buff
// claimed at a milestone and then abandoned mid-session is worth less than its face duration, and
// nothing in the export measures that. Authored on the SP panel as 'SPTx2 Utilization' so it can
// be dialled without touching code; absent -> SPTX2_UTILIZATION.
function sptx2Util_(){
  var raw = readSPLabel_('SP', 'SPTx2 Utilization');
  return (raw == null || raw === '') ? SPTX2_UTILIZATION : num(raw);
}

// minutes -> extra SPT at a given per-level price E. E is the SIDE-appropriate one: E_base on the
// measured side, E_v2 on the simulated side, so editing the per-level SPT rewards on SP_v2 moves
// what a buff minute is worth exactly as it moves what a plain completion is worth.
function sptx2ToSpt_(minutes, seg, payer, ds, E){
  if (!SPTX2_AS_MINUTES || !(minutes > 0) || !(E > 1e-9)) return 0;
  var mpl = minutesPerLevel_(seg, payer, ds);
  if (!(mpl > 0)) return 0;
  return (minutes / mpl) * sptx2Util_() * E;
}

// E_SPT per completion on the base panel - the measured-side price. E_v2 is this x coreSptR_.
function coreSptEBase_(){ return coreSptE_('SP', coreSptMix_('SP')); }

// Core SPT BEFORE any buff conversion: the raw data_gains value when a re-pull delivers one, else
// the D18 synthetic anchor. Split out so measuredRow_ and simCore share ONE definition of the
// base and neither has to subtract a bonus back out of a finished row.
function coreBaseSpt_(seg, payer, ds){
  var raw = num(ds.dataRow('Core', seg, payer)['SPT']);
  if (raw > 0) return raw;
  var syn = coreSptSynth_(seg, payer, ds);
  return syn ? syn.meas : 0;
}

// Every SPTx2 MINUTE the player is granted over the window. Two entry points, same rule, because
// the measured side has to be reachable from measuredRow_ (which has no ctx) exactly like
// measuredSptTotal_ is.
//
// The exclusions mirror sptTotals_ and are there for the same reason: Season Pass (Paid),
// Col - Sets and Col - Albums are priced OFF the tier this total feeds, so counting the buffs they
// themselves pay would make the tier depend on its own rewards. Season Pass (Free) contributes
// MEASURED to both sides (the standing recursion guard). CORE is read from the raw data row rather
// than through measuredRow_ / resultRow_, because Core is the row this total is about to be added
// to - going through the choke point would recurse. Core pays no SPTx2 today (measured 0), and
// reading it raw means a future real row still counts without reopening the cycle.
var _x2MinCache = {}, _x2MinBusyKeys = {};
function sptx2MinutesMeas_(seg, payer, ds){
  var mode = tofCycleMode_(), noToF = !!mode;          // D62: same keying as the SPT totals
  var key = seg + '|' + payer + mode;
  if (_x2MinCache[key] != null) return _x2MinCache[key];
  if (_x2MinBusyKeys[key]) return 0;                     // defensive backstop; no cycle by design
  var total = 0;
  _x2MinBusyKeys[key] = true;
  try {
    CATEGORY_ORDER.forEach(function(cat){
      if (cat === 'Season Pass (Paid)' || cat === 'Col - Sets' || cat === 'Col - Albums') return;
      if (noToF && cat === TOF_CAT) return;
      if (cat === 'Core'){ total += num(ds.dataRow('Core', seg, payer)['SPTx2']); return; }
      total += num(measuredRow_(cat, seg, payer, ds)['SPTx2']);
    });
  } finally { delete _x2MinBusyKeys[key]; }
  return (_x2MinCache[key] = total);
}
function sptx2MinutesSim_(seg, payer, ctx){
  ctx._x2min = ctx._x2min || {};
  var key = seg + '|' + payer;
  var mode = tofCycleMode_(), noToF = !!mode;          // D62
  key += mode;
  if (ctx._x2min[key] != null) return ctx._x2min[key];
  var ds = ctx.ds, total = 0;
  CATEGORY_ORDER.forEach(function(cat){
    if (cat === 'Season Pass (Paid)' || cat === 'Col - Sets' || cat === 'Col - Albums') return;
    if (noToF && cat === TOF_CAT) return;
    if (cat === 'Core'){ total += num(ds.dataRow('Core', seg, payer)['SPTx2']); return; }
    if (cat === 'Season Pass (Free)'){ total += num(measuredRow_(cat, seg, payer, ds)['SPTx2']); return; }
    total += num(resultRow_(cat, seg, payer, ctx)['SPTx2']);
  });
  return (ctx._x2min[key] = total);
}

// What one category row contributes to the season-pass point total. D54: the SPT value of every
// buff minute is already folded into Core's SPT row, so scoring SPTx2 again here would count it
// twice - and the "2 x" it used to be scored with was reading minutes as tokens anyway.
function sptScore_(row){
  return num(row['SPT']) + (SPTX2_AS_MINUTES ? 0 : 2 * num(row['SPTx2']));
}

// Highest 1-based tier whose cumulative points requirement is met; 0 below tier 1, capped at
// the ladder length (a maxed track gains nothing from extra SPT).
// ---- the Season Pass at ONE player's tier (D79, 2026-10-30) ---------------------------------------
// spPackTiers_ prices the track at the COHORT's mean tier, so every payer of a cell opened the same
// pass envelopes in the card sim whatever they played. A player's SPT is earned by playing, so the
// card sim now places each player on the track at their own total:
//     own SPT = cohort SPT x (own active days / the cohort's expected active days)
// and opens the envelopes of every tier up to that one (one table per possible tier, built here, so
// the season core stays pure). The gains model keeps the cohort's tier - the card sim's total no
// longer equals the Season Pass rows exactly, the same kind of gap D48 opened for multi-day reach.
// FLAGGED: SPT scales with active days only; a player who plays more levels per active day than the
// cohort's mean also earns more, and nothing measures that spread inside a cell.
function spTrackForCard_(seg, payer, ctx, prof){
  if (seg === 'A. 0' || seg === 'A.0' || (prof && prof.fullPass)) return null;
  if (!ctx || !ctx.calCurOk || !ctx.calNewOk) return null;
  if (!(ctx.calNew['Season Pass'] || []).length || !(ctx.calCur['Season Pass'] || []).length) return null;
  var sp = spPaidTracks_();
  if (!sp || !sp.v2.cum.length) return null;
  var b = ctx.ds.beh(seg, payer);
  var exp = pDaySum_(1, windowDays_(), num(b.weekday_active_rate), num(b.weekend_active_rate));
  if (!(exp > 0)) return null;
  var byTier = [];
  for (var T = 0; T <= sp.v2.cum.length; T++) byTier.push(spPackTiers_(seg, payer, ctx, prof, T));
  return { total: sptTotals_(seg, payer, ctx).sim * sp.daysV2 / windowDays_(), cum: sp.v2.cum,
           expDays: exp, byTier: byTier };
}
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
function timingRatio_(cur, nw, seg, payer, ds, lane){
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  // D100: `lane` (optional) prices each instance's reach by laneReach_ - the Kite joiner curve
  var sc = lane ? laneReachSum_(lane, cur, pWd, pWe, seg, payer) : reachSum_(cur, pWd, pWe);
  var sn = lane ? laneReachSum_(lane, nw, pWd, pWe, seg, payer) : reachSum_(nw, pWd, pWe);
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
// ---- the COUNTED WINDOW (D70, 2026-10-28) ------------------------------------------------------
// The grid is B5:AH25 - 33 columns - but which of them COUNT is read off the calendar's own
// day-number row (row 4): the FIRST column holding 1 is day 1, and the window runs over every
// contiguous numbered column from there (user decision 2026-10-28: number G4 = 1 .. AH4 = 28, black
// out and clear B:F, and the count starts on a Monday). The numbers may restart inside the run -
// today's sheets read 1..30 then 1, 2, 3 for the next Season Pass season - so the window is the
// numbered span, not the highest number. Columns before day 1 are PRE-WINDOW days: still
// parsed and kept in window coordinates (day <= 0) on ctx.calCurFull / ctx.calNewFull - cal_curr's
// are what the measured side is scaled to the window with (D71) - but clipped out of ctx.calCur /
// ctx.calNew, so out of every T, every total and every daily row. An instance that crosses a window
// edge keeps its in-window days and carries clipStart / clipEnd / fullDur.
// cal_new is the source of truth (the two calendars describe one window); cal_curr is checked for
// agreement and a mismatch is logged. No day-number row -> the whole grid, i.e. the pre-D70 engine.
var _calWinCache = null;
function calWindowOn_(sheetName){
  var v;
  try { v = sheetVals_(sheetName); } catch (e){ return null; }
  if (!v || !v.length) return null;
  for (var r = 0; r < Math.min(v.length, CAL_FIRST_ROW - 1); r++){
    var row = v[r] || [];
    for (var c = CAL_FIRST_COL - 1; c <= CAL_LAST_COL - 1 && c < row.length; c++){
      if (String(row[c] == null ? '' : row[c]).trim() === '' || num(row[c]) !== 1) continue;
      // every CONTIGUOUS numbered column from the first 1 counts - the numbers may restart (today's
      // sheets read 1..30 then 1, 2, 3: the next Season Pass season), which keeps the whole grid
      var n = 0;
      while (c + n <= CAL_LAST_COL - 1 && c + n < row.length &&
             String(row[c + n] == null ? '' : row[c + n]).trim() !== '' && isFinite(parseFloat(row[c + n]))) n++;
      if (n >= 7) return { col1: c + 1, days: n, offset: (c + 1) - CAL_FIRST_COL, row: r + 1 };
      break;                                               // a 1 that starts no run: not this row
    }
  }
  return null;
}
// ---- the GRID's length (D79, 2026-10-30) -------------------------------------------------------
// CAL_LAST_COL is the last column the reader CAN read: AI since D79, because the 28-day window of
// LIVE_OPS_V3 (8) runs H..AI, one column past the old AH limit, and the reader silently cut it to
// 27 days (and parsed every lane merged up to AI as one cell). The grid's LENGTH - what "the whole
// grid" means to the window (D70) and the export rescale (D71) - is the last column either calendar
// uses in its day-number row or grid, never less than the 33-day B..AH layout every older workbook
// has, so those stay bit-identical.
var CAL_GRID_MIN_DAYS = 33;
var _calGridDaysCache = null;
function calGridDays_(){
  if (_calGridDaysCache !== null) return _calGridDaysCache;
  var last = CAL_FIRST_COL + CAL_GRID_MIN_DAYS - 1;
  [CAL_CUR, CAL_NEW].forEach(function(n){
    var v;
    try { v = sheetVals_(n); } catch (e){ v = []; }
    for (var r = CAL_FIRST_ROW - 2; r <= CAL_LAST_ROW - 1 && r < (v || []).length; r++){
      var row = v[r] || [];
      for (var c = Math.min(row.length, CAL_LAST_COL) - 1; c >= last; c--)
        if (row[c] !== '' && row[c] != null && String(row[c]).trim() !== ''){ last = c + 1; break; }
    }
  });
  return (_calGridDaysCache = last - CAL_FIRST_COL + 1);
}
// ---- D89 (2026-11-02): a SECOND counted window, for the album season --------------------------------
// The comparison window is H..AI (Mon Oct 19 .. Sun Nov 15, row 4), but the live album season runs Tue
// Oct 13 .. Mon Nov 9 = B..AC, and the album data counts its days from Oct 13. To simulate the season as
// it actually ran (and check it against that data at the same day), the album completion run re-reads
// the calendars in that window. withWindow_ swaps the counted window for the length of one function:
// calWindow_, the date above day 1 and its weekday answer for the new day 1 (derived from the normal
// window's, so nothing has to be typed above column B), and every memo is dropped on the way in and
// on the way out. Nothing else in the engine changes.
var _winOverride = null;
function withWindow_(offset, days, fn){
  Context.reset();
  var w = calWindow_(), d1 = calDay1Date_(), dow = calDay1Dow_();
  var shift = offset - num(w.offset);
  var ov = { col1: CAL_FIRST_COL + offset, days: days, offset: offset, row: w.row,
             d1: (d1 != null) ? d1 + shift : null, dow: (((dow - 1 + shift) % 7) + 7) % 7 + 1 };
  try {
    Context.reset();
    _winOverride = ov;
    return fn(Context.get());
  } finally {
    _winOverride = null;
    Context.reset();
  }
}
function calWindow_(){
  if (_winOverride) return _winOverride;
  if (_calWinCache !== null) return _calWinCache;
  var nw = calWindowOn_(CAL_NEW), cur = calWindowOn_(CAL_CUR);
  var w = nw || cur || { col1: CAL_FIRST_COL, days: calGridDays_(), offset: 0, row: 0 };
  if (nw && cur && (nw.offset !== cur.offset || nw.days !== cur.days))
    try { Logger.log(CAL_NEW + ' numbers its window from column ' + nw.col1 + ' for ' + nw.days +
                     ' days but ' + CAL_CUR + ' from column ' + cur.col1 + ' for ' + cur.days +
                     ' - one window describes both calendars, so ' + CAL_NEW + ' is used. ' +
                     'Renumber row ' + cur.row + ' of ' + CAL_CUR + ' to match.'); } catch (e){}
  return (_calWinCache = w);
}
/** Days in the counted window (28 once row 4 is renumbered G = 1 .. AH = 28; 33 before). */
function windowDays_(){ return calWindow_().days; }
// grid day -> window day for a whole parsed calendar (no-op when the window starts at column B).
function windowShift_(cal, off){
  if (!off) return cal;
  var out = {};
  for (var ev in cal) out[ev] = (cal[ev] || []).map(function(x){
    var y = mkInst_(num(x.start) - off, num(x.dur));
    if (x.variant) y.variant = x.variant;                 // D73
    return y;
  });
  return out;
}
// The in-window part of every instance; an instance wholly outside drops, one that crosses an edge
// keeps its in-window days and says how many it lost at each end. Unclipped instances are passed
// through as the same objects, so a full-grid window is bit-identical to the pre-D70 engine.
function windowClip_(cal, n){
  var out = {};
  for (var ev in cal){
    var list = [];
    (cal[ev] || []).forEach(function(x){
      var s = num(x.start), e = s + num(x.dur) - 1, cs = Math.max(1, s), ce = Math.min(n, e);
      if (cs > ce) return;
      if (cs === s && ce === e){ list.push(x); return; }
      var y = mkInst_(cs, ce - cs + 1);
      y.clipStart = cs - s; y.clipEnd = e - ce; y.fullDur = num(x.dur);
      if (x.variant) y.variant = x.variant;               // D73
      list.push(y);
    });
    if (list.length) out[ev] = list;
  }
  return out;
}
// ---- the MEASURED side, rescaled to the window (D71, 2026-10-28) -------------------------------
// The export (data_gains) is a total over its own 33/34-day pull, which the model treats as
// cal_curr's whole grid. Once the window is shorter (D70), the measured side has to be the share of
// that total that falls inside it, or every CURRENT number is a 33-day total labelled 28-day and
// every always-on row carries ~18% that is not in the window. User decision 2026-10-28: rescale
// (keep the data, do not wait for a 28-day re-pull). Applied ONCE, to export amounts only, by the
// hook DataStore.gains reads - so measuredRow_, the RM real-data rule, the Core buff minutes and
// every other export consumer agree. Synthetic anchors are built on the window already.
var WINDOW_RESCALE = true;
// continuous lanes: one long instance (or one a day) whose payout follows activity, not reach
var WINDOW_PDAY_LANES = { 'Season Pass':1, 'Night Sky':1, 'ToF':1 };
// the collections' accrual key (the D of collectionSim_), so a clipped collection scales as its sim does
var WINDOW_ACCR = { 'Hatchling Hideaway':'Hatchling Hideaway', "Bomb's Ballet":'Bombs Ballet',
                    'Jigsaw':'Jigsaw', 'Photoshoot':'Photoshoot', 'River Rush':'River Rush' };
function windowIsWholeGrid_(w){ return !w || (!w.offset && w.days === calGridDays_()); }
/** Σ p_day over window days d0..d1 (window coordinates; pre-window days are <= 0). */
function pDaySum_(d0, d1, pWd, pWe){
  var s = 0;
  for (var d = d0; d <= d1; d++) s += isWeekend_(d) ? pWe : pWd;
  return s;
}
function windowScale_(cat, seg, payer, ctx, res){
  if (!WINDOW_RESCALE || !ctx || windowIsWholeGrid_(ctx.window)) return 1;
  ctx._wScale = ctx._wScale || {};
  // D72: Rainbow Maker scales PER RESOURCE by the base walk's own window share (cut-offs priced at
  // the claim pace - the first rungs are cheap, so a cut-off keeps more than its share of days)
  if (cat === 'Rainbow Maker' && res){
    var rk = cat + '|' + seg + '|' + payer + '|' + res;
    if (ctx._wScale[rk] != null) return ctx._wScale[rk];
    var rw = rmWindowShare_(seg, payer, ctx);
    if (rw && rw.full[res] > 1e-12) return (ctx._wScale[rk] = rw.win[res] / rw.full[res]);
    // a resource the base ladder never pays: falls through to the reach ratio below
  }
  var key = cat + '|' + seg + '|' + payer;
  if (ctx._wScale[key] != null) return ctx._wScale[key];
  var w = ctx.window, ds = ctx.ds, b = ds.beh(seg, payer) || {};
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)){ pWd = 1; pWe = 1; }      // no behaviour row (A. 0): day counts
  var gridFirst = 1 - w.offset, gridLast = calGridDays_() - w.offset;
  var lane = (typeof DAILY_CAL_LABEL !== 'undefined' && DAILY_CAL_LABEL[cat]) || CAL_LABEL[cat] || null;
  var full = (lane && ctx.calCurFull && ctx.calCurFull[lane]) || [];
  var win = (lane && ctx.calCur && ctx.calCur[lane]) || [];
  var s;
  if (full.length && !WINDOW_PDAY_LANES[lane]){
    var sf = reachSum_(full, pWd, pWe), sw = reachSum_(win, pWd, pWe);
    s = (sf > 0) ? sw / sf : 1;
    if (WINDOW_ACCR[cat] && win.length && modalDur_(full) !== modalDur_(win))
      s *= accrualD_(ds, WINDOW_ACCR[cat], modalDur_(full), modalDur_(win), seg, payer, false);
  } else if (full.length){
    var pf = 0, pw = 0;
    full.forEach(function(x){ (x.days || []).forEach(function(d){ var p = isWeekend_(d) ? pWe : pWd; pf += p; if (d >= 1 && d <= w.days) pw += p; }); });
    s = (pf > 0) ? pw / pf : 1;
  } else {
    var gf = pDaySum_(gridFirst, gridLast, pWd, pWe), gw = pDaySum_(1, w.days, pWd, pWe);
    s = (gf > 0) ? gw / gf : 1;
  }
  return (ctx._wScale[key] = s);
}
/** Rainbow Maker's base walk on cal_curr over the window and over the whole grid: {win, full} rows,
 *  or null when either side cannot be walked (no matchables / no ladder). */
function rmWindowShare_(seg, payer, ctx){
  ctx._rmWin = ctx._rmWin || {};
  var key = seg + '|' + payer;
  if (ctx._rmWin[key] !== undefined) return ctx._rmWin[key];
  var sum = function(parts){
    var o = zeroRow_();
    (parts || []).forEach(function(p){ RESOURCES.forEach(function(r){ o[r] = num(o[r]) + num(p.row[r]); }); });
    return o;
  };
  var pw = rmInstanceRows_(seg, payer, ctx, { cal: ctx.calCur, useBase: true });
  var pf = rmInstanceRows_(seg, payer, ctx, { cal: ctx.calCurFull, useBase: true, full: true });
  return (ctx._rmWin[key] = (pw && pf) ? { win: sum(pw), full: sum(pf) } : null);
}
/** The activity share of the window for a (segment, payer) - what a per-earner window total from
 *  the data (data_econ) is scaled by. */
function windowActivityScale_(seg, payer, ctx){
  // D79: the same pull as data_gains - scaled from its span when data_gains says what that is
  if (ctx && ctx.dataSpan) return spanScale_(seg, payer, ctx);
  return windowScale_('__activity__', seg, payer, ctx);
}

/** Both calendars in window coordinates: { calCur, calNew, calCurFull, calNewFull, window }. */
function windowCals_(rawCur, rawNew){
  var w = calWindow_();
  var curFull = windowShift_(rawCur, w.offset), newFull = windowShift_(rawNew, w.offset);
  return { window: w, calCurFull: curFull, calNewFull: newFull,
           calCur: windowClip_(curFull, w.days), calNew: windowClip_(newFull, w.days) };
}

// ---- the calendar's START WEEKDAY (D64, 2026-10-14) -------------------------------------------
// Every weekday/weekend split in the engine goes through isWeekend_, and until D64 it assumed each
// calendar starts on a Wednesday. The live calendar's day 1 is Tuesday 2026-10-13 (user), which put
// the weekend one day early in every view that uses the two activity rates - T, reach, Night Sky's
// day-type blend, the daily placement, the card sim's attendance. The calendar sheets have carried
// a weekday-name row all along (row 3: 'Wednesday', 'Thursday', ...); it is now the source. The
// first row of CAL_NEW whose day-1 cell is a weekday name and which carries at least seven of them
// names day 1; cal_curr is checked for agreement and logged when it differs (cal_new wins - the two
// describe the same window). No such row -> Wednesday, i.e. the pre-D64 rule, bit for bit.
// Memoised per execution (resetModuleCaches_ clears it), because isWeekend_ runs in every day loop.
var CAL_DAY1_DOW_DEFAULT = 3;                              // 1 = Monday .. 7 = Sunday: Wednesday
var DOW_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
var _calDowCache = null;
function dowIndex_(x){
  var s = String(x == null ? '' : x).trim().toLowerCase();
  if (!s) return 0;
  for (var i = 0; i < DOW_NAMES.length; i++)
    if (s === DOW_NAMES[i] || s === DOW_NAMES[i].slice(0, 3)) return i + 1;
  return 0;
}
// {dow, row} of the weekday-name row on one calendar sheet, or null.
function calDay1DowOn_(sheetName){
  var v;
  try { v = sheetVals_(sheetName); } catch (e){ return null; }
  if (!v || !v.length) return null;
  for (var r = 0; r < Math.min(v.length, 12); r++){
    var row = v[r] || [];
    var c0 = calWindow_().col1 - 1;                         // D70: the window's day-1 column (B before)
    var d1 = dowIndex_(row[c0]);
    if (!d1) continue;
    var n = 0, ok = true;
    for (var c = c0; c < row.length && c <= CAL_LAST_COL - 1; c++){
      var d = dowIndex_(row[c]);
      if (!d) break;
      if (d !== ((d1 - 1 + (c - c0)) % 7) + 1){ ok = false; break; }  // must run consecutively
      n++;
    }
    if (ok && n >= 7) return { dow: d1, row: r + 1 };
  }
  return null;
}
function calDay1Dow_(){
  if (_winOverride) return _winOverride.dow;
  if (_calDowCache !== null) return _calDowCache;
  var nw = calDay1DowOn_(CAL_NEW), cur = calDay1DowOn_(CAL_CUR);
  var dow = nw ? nw.dow : (cur ? cur.dow : CAL_DAY1_DOW_DEFAULT);
  if (nw && cur && nw.dow !== cur.dow)
    Logger.log(CAL_NEW + ' says day 1 is a ' + DOW_NAMES[nw.dow - 1] + ' but ' + CAL_CUR + ' says ' +
               DOW_NAMES[cur.dow - 1] + ' - the two calendars describe one window, so they should ' +
               'agree. Using ' + CAL_NEW + '. Retype the weekday row on the other sheet.');
  if (!nw && !cur)
    Logger.log('Neither calendar sheet carries a weekday-name row (e.g. Wednesday, Thursday, ... ' +
               'from column B), so day 1 is taken as a Wednesday (the pre-D64 rule).');
  return (_calDowCache = dow);
}
// Fri / Sat / Sun, counted from whatever weekday the calendar says day 1 is.
function isWeekend_(day){
  var k = (calDay1Dow_() - 1 + (day - 1)) % 7;
  if (k < 0) k += 7;                                     // D70: pre-window days are day <= 0
  return k + 1 >= 5;
}

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
    // D70: parsed in GRID days, then shifted to the counted window and clipped to it (windowCals_).
    var wc = windowCals_(calFoldVariants_(sanitizeCal_(parseCalendarInstances_(CAL_CUR))),
                         calFoldVariants_(sanitizeCal_(parseCalendarInstances_(CAL_NEW))));
    var calCur = wc.calCur, calNew = wc.calNew;
    // the per-day views size every array by DAILY_DAYS (EcoGainsSim_Daily.gs): it IS the window
    if (typeof DAILY_DAYS !== 'undefined') DAILY_DAYS = wc.window.days;
    _c = { ds: DataStore.get(), calCur: calCur, calNew: calNew,
           calCurFull: wc.calCurFull, calNewFull: wc.calNewFull, window: wc.window,
           calCurOk: hasKeys_(calCur), calNewOk: hasKeys_(calNew) };
    // D71: export amounts are read at the window's level (windowScale_); none on a whole-grid window
    // D79: an export that carries its own dates is scaled from THAT span to the window instead
    var _ctxRef = _c;
    _c.dataSpan = dataSpanInWindow_(_c.ds);
    // D87: per event where the export_scale table says the event's payout days match the feed
    _c.ds.scaleFn = _c.dataSpan ? function(cat, seg, payer, res){
                      var e = spanScaleEvent_(cat, seg, payer, res, _ctxRef);
                      return (e != null) ? e : spanScale_(seg, payer, _ctxRef); }
                  : windowIsWholeGrid_(wc.window) ? null
                  : function(cat, seg, payer, res){ return windowScale_(cat, seg, payer, _ctxRef, res); };
    return _c;
  },
  // Drop the memo, so the next get() re-reads the calendars and hands out a fresh per-execution
  // cache bag (_spt, _colCards, _colSim ... all live on the ctx object, so they go with it).
  // Nothing in production calls this - a custom function is a fresh execution and starts empty
  // anyway. It exists because the offline harnesses mutate a config sheet and then need the state a
  // real recalculation would start from, and their only other way to get it was to re-eval the
  // whole engine. That has to happen at module scope or the engine's `var`s become function-local
  // and the memo survives - a trap that has silently passed a gate with a zero anchor before.
  // D62: the module-level memos go too (resetModuleCaches_) - a sweep after a sheet mutation must
  // start from what a fresh execution starts from, or a memo computed under the old state leaks.
  reset: function(){ _c = null; resetModuleCaches_(); }};
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

// ---- the A/B ARM (D79, 2026-10-30) -----------------------------------------------------------
// The live A/B (Albums + ToF) is pulled as BOTH arms into the same data_* sheets, told apart by an
// ab_variant column (LIVE_OPS_V3 (7)/(8): data_gains, 2,627 Variant A rows after 1,771 Control).
// DataStore keys a row by (segment, payer, category, resource) and the last row wins, so two arms
// in one sheet mix silently: Variant A won only because its rows happened to come second, and any
// key Variant A lacks would have been read from Control. A sheet with an ab_variant column is read
// for ANCHOR_ARM alone (user decision 2026-10-29: the measured side is Variant A). A sheet without
// the column, or with no row of that arm, is read whole and the second case is logged - so every
// older pull behaves exactly as before. '' reads every row.
var ANCHOR_ARM = 'Variant A';
function armRows_(vals, name){
  if (!ANCHOR_ARM || !vals || vals.length < 2) return vals;
  var c = headerIndex_(vals[0] || [])['ab_variant'];
  if (c == null) return vals;
  var keep = [vals[0]];
  for (var i = 1; i < vals.length; i++)
    if (String(vals[i][c] == null ? '' : vals[i][c]).trim() === ANCHOR_ARM) keep.push(vals[i]);
  if (keep.length > 1) return keep;
  try { Logger.log((name || 'a data sheet') + ' has an ab_variant column but no ' + ANCHOR_ARM +
                   ' row - read whole (every arm). Set ANCHOR_ARM to the arm it carries.'); } catch (e){}
  return vals;
}

// ---- dates (D79) ------------------------------------------------------------------------------
/** Days since 1970-01-01 of a date as a pull or a sheet carries it: a Date, a 'YYYY-MM-DD...'
 *  string, epoch milliseconds (the A/B export writes window_start_date as 1791849600000) or seconds,
 *  or a Sheets serial day. null for anything else, including the small numbers of a day-index row. */
function dateDays_(x){
  if (x == null || x === '') return null;
  if (Object.prototype.toString.call(x) === '[object Date]')
    return isNaN(x.getTime()) ? null : Math.round(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86400000);
  var s = String(x).trim();
  if (/^\d+(\.\d+)?$/.test(s)){
    var n = parseFloat(s);
    if (n > 1e11) return Math.floor(n / 86400000);             // epoch milliseconds
    if (n > 1e8)  return Math.floor(n / 86400);                // epoch seconds
    if (n > 20000 && n < 80000) return Math.round(n) - 25569;  // Sheets serial (day 25569 = 1970-01-01)
    return null;
  }
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
}
/** The calendar date (dateDays_) of window day 1: a date typed in any row above the day-number row,
 *  in the column holding the 1 - cal_new first, then cal_curr (the D76 rule). null when none. */
function calDay1Date_(){
  if (_winOverride) return _winOverride.d1;
  var w = calWindow_();
  if (!w || !w.col1 || !w.row) return null;
  var names = [CAL_NEW, CAL_CUR];
  for (var k = 0; k < names.length; k++){
    var v;
    try { v = sheetVals_(names[k]); } catch (e){ continue; }
    for (var r = 0; r < w.row - 1 && r < (v || []).length; r++){
      var d = dateDays_((v[r] || [])[w.col1 - 1]);
      if (d != null) return d;
    }
  }
  return null;
}

// ---- the DATA SPAN (D79, 2026-10-30) ----------------------------------------------------------
// An A/B pull is a total over its OWN dates, not over cal_curr's grid: LIVE_OPS_V3 (8)'s data_gains
// covers Tue 2026-10-13 .. Wed 2026-10-28 (16 days; window_start_date / data_through_date on every
// row) while the window is Mon 2026-10-19 .. Sun 2026-11-15. D71 took every export as a whole-grid
// total and scaled it by the window's share of the grid - right for the August pull, ~2x low here
// (a 16-day total read as 34 days of play and cut to 28). When the dates are there, every export
// amount is scaled by the window's activity over the span's:
//     s = SUM p_day(window days 1..N) / SUM p_day(span days)
// the span placed in window coordinates by the date above day 1 (calDay1Date_; Oct 13 is window day
// -5 when day 1 is Oct 19). ACTIVITY, not reach: the span's pre-window days sit on columns B..G,
// which (8) carries as values without merges, so a lane-by-lane reach ratio would read every
// pre-window instance as one day long. FLAGGED: a lane whose instances fall unevenly between span
// and window (Team Race pays on Mondays: 2 payouts in the 16-day span, ~4 in the window, 1.75x by
// activity) is scaled at the activity rate. No date above day 1 -> the D71 rule, logged.
// DATA_SPAN_RESCALE = false restores D71 exactly.
var DATA_SPAN_RESCALE = true;
function dataSpanOf_(gainsVals){
  var h = headerIndex_((gainsVals || [])[0] || []);
  var cs = h['window_start_date'], ce = h['data_through_date'];
  if (cs == null || ce == null) return null;
  for (var i = 1; i < gainsVals.length; i++){
    var s = dateDays_(gainsVals[i][cs]), e = dateDays_(gainsVals[i][ce]);
    if (s != null && e != null && e >= s) return { start: s, end: e, days: e - s + 1 };
  }
  return null;
}
/** The export's span in window days {first, last, days}, or null (no dates, or no date above day 1). */
function dataSpanInWindow_(ds){
  if (!DATA_SPAN_RESCALE || !ds || !ds.span) return null;
  var d1 = calDay1Date_();
  if (d1 == null){
    try { Logger.log('data_gains carries its dates (' + ds.span.days + ' days) but no date is typed ' +
                     'above day 1 on ' + CAL_NEW + ' / ' + CAL_CUR + ', so the span cannot be placed: ' +
                     'the export is scaled by the D71 grid rule instead.'); } catch (e){}
    return null;
  }
  return { first: ds.span.start - d1 + 1, last: ds.span.end - d1 + 1, days: ds.span.days };
}
function spanScale_(seg, payer, ctx){
  ctx._spanScale = ctx._spanScale || {};
  var key = seg + '|' + payer;
  if (ctx._spanScale[key] != null) return ctx._spanScale[key];
  var b = ctx.ds.beh(seg, payer) || {}, sp = ctx.dataSpan;
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)){ pWd = 1; pWe = 1; }      // no behaviour row (A. 0): day counts
  var den = pDaySum_(sp.first, sp.last, pWd, pWe), numr = pDaySum_(1, ctx.window.days, pWd, pWe);
  return (ctx._spanScale[key] = (den > 0) ? numr / den : 1);
}

// ---- D87 (2026-11-02, user decision): the export is scaled to the window PER EVENT ---------------
// spanScale_ stretches the 16-day export to the 28-day window by activity (x1.75 at every cell, for
// every source). That is right for the always-on lanes and wrong for an event whose payouts did not
// fall in the export at its window cadence: the weekly events paid twice in the export and run four
// times in the window (Kite, Hatchling, Red's, Target Day, Team Event, Team Race read ~12% low),
// Rainbow Maker's export holds ~3 instances against 4 (x1.75 read it ~30% high). Per event instead:
//     scale = f x W / S'
//   f   share of the source's export that was GRANTED inside the window days the export covers
//       (window days 1..10 of the Oct 13-28 pull), off the by-source daily feed, pooled over cells
//   S'  cal_curr's instances (lead-in included) paid inside those days - reach x the instance's
//       payout days (the daily view's own placement: last day + settle for a rank event, the accrual
//       curve for a collection, the measured claim pace for Rainbow Maker)
//   W   cal_curr's instances in the window - the same reach sum T divides by, so NEW = the measured
//       per-instance payout x the redesign's instances, exactly the timed core's rule
// Only the window part of the export is used, so a lead-in drawn wrong on cal_curr cannot bias f.
// CHECKED, RESOURCE BY RESOURCE: the predicted payout days inside the window part are matched against
// the feed's own day profile of that resource (histogram intersection, +-1 day), trying the grant on
// the settle day and on the event day (Target Day pays its coins and envelopes the day after but its
// Unlimited Lives on the day; Kite pays lives at the start, ranks at the end). Below
// EXPORT_SCALE_MATCH the resource keeps x1.75 and the reason is reported (a lead-in instance that paid
// into day 1 but is missing from cal_curr, a daily trickle the calendar cannot see). A resource with
// too few recipient-days for a timing of its own is judged on the source's coins. The feed is 73k rows, so it is never read at recalc: the menu run
// Compute export scale pools it into the small EXPORT_SCALE_SHEET (fillExportScale), and a table whose
// days do not match data_gains' span is ignored. No table, or SPAN_PER_EVENT = false -> x1.75
// everywhere, bit-identical to D79.
var SPAN_PER_EVENT = true;
var EXPORT_SCALE_SHEET = 'export_scale';
var EXPORT_SCALE_FEED = 'data_econ_daily_by_source';
var EXPORT_SCALE_MATCH = 0.75;
var EXPORT_SCALE_MIN_REC = 100;                 // recipient-days below which a resource borrows f
var EXPORT_SCALE_NEAR = 2;                      // days around a predicted payout that still belong to it
var EXPORT_SCALE_REF = ['20-39', 'PAYER'];      // the cell the payout-day check is drawn for
// payout family per category: 'last' = rank lumps (instance end + settle), 'marg' = claims as the
// tokens accrue, 'rm' = Rainbow Maker's claim pace. Always-on and track lanes stay on activity.
var EXPORT_SCALE_FAMILY = { 'Bomb Challenge':'last', 'Chuck Challenge':'last', 'Red Challenge':'last',
  'Level Race':'last', 'Flash Race':'last', 'Target Day':'last', 'Kite Festival':'last',
  'Team Event':'last', 'Team Race':'last', 'Flock Flurry':'last', 'Mighty Ice Cream':'last',
  'Hatchling Hideaway':'marg', "Bomb's Ballet":'marg', 'Jigsaw':'marg', 'Photoshoot':'marg',
  'River Rush':'marg', 'Rainbow Maker':'rm' };
var _expScaleTab;                               // undefined = not read yet (resetModuleCaches_)
function exportScaleLane_(cat){
  return (typeof DAILY_CAL_LABEL !== 'undefined' && DAILY_CAL_LABEL[cat]) || CAL_LABEL[cat] || null;
}
/** The pooled feed table: { first, last, src: { cat: { res: { r: { days:{d: mass}, rec } }, best } } }
 *  or null (no sheet / no header). Day columns are 'd<window day>'. */
function exportScaleTab_(){
  if (_expScaleTab !== undefined) return _expScaleTab;
  var v = sheetVals_(EXPORT_SCALE_SHEET);
  _expScaleTab = null;
  if (!v || !v.length) return null;
  var hr = -1, h = {};
  for (var r = 0; r < v.length && hr < 0; r++){
    var row = v[r] || [], hh = {};
    row.forEach(function(x, i){ var k = String(x == null ? '' : x).trim(); if (k && hh[k] == null) hh[k] = i; });
    if (hh['source'] != null && hh['resource'] != null){ hr = r; h = hh; }
  }
  if (hr < 0) return null;
  var dayCols = [];
  Object.keys(h).forEach(function(k){ var m = /^d(-?\d+)$/.exec(k); if (m) dayCols.push([+m[1], h[k]]); });
  if (!dayCols.length) return null;
  dayCols.sort(function(a, b){ return a[0] - b[0]; });
  // D96: the days the FEED carries, when the stamp rows say (a table written before D96 does not: the
  // whole span, as it was read then)
  var feedFirst = dayCols[0][0], feedLast = dayCols[dayCols.length - 1][0];
  for (var rr = 0; rr < hr; rr++){
    var mrow = v[rr] || [];
    for (var cc = 0; cc + 1 < mrow.length; cc++){
      if (String(mrow[cc] == null ? '' : mrow[cc]).trim() !== 'feed days') continue;
      var fm = /^\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*$/.exec(String(mrow[cc + 1]));
      if (fm){ feedFirst = +fm[1]; feedLast = +fm[2]; }
    }
  }
  var src = {};
  for (var i = hr + 1; i < v.length; i++){
    var x = v[i] || [], cat = String(x[h['source']] == null ? '' : x[h['source']]).trim();
    var res = String(x[h['resource']] == null ? '' : x[h['resource']]).trim();
    if (!cat || !res) break;                   // the table ends at its first blank row
    var o = (src[cat] = src[cat] || { res: {}, best: null }), days = {};
    dayCols.forEach(function(dc){ days[dc[0]] = num(x[dc[1]]); });
    var rec = (h['recipients'] != null) ? num(x[h['recipients']]) : 0;
    o.res[res] = { days: days, rec: rec };
    if (!o.best || rec > o.res[o.best].rec) o.best = res;
  }
  return (_expScaleTab = { first: dayCols[0][0], last: dayCols[dayCols.length - 1][0], src: src,
                           feedFirst: feedFirst, feedLast: feedLast });
}
/** f: the share of (cat, res)'s export mass granted inside window days [o1, o2]; null when unknown.
 *  A resource with too few recipient-days to have a timing of its own borrows the source's best. */
function exportScaleF_(o, res, first, last, o1, o2){
  function fOf(r){
    var e = o.res[r];
    if (!e) return null;
    var all = 0, inn = 0;
    for (var d = first; d <= last; d++){ var m = num(e.days[d]); all += m; if (d >= o1 && d <= o2) inn += m; }
    return (all > 0) ? inn / all : null;
  }
  var mine = o.res[res];
  if (mine && mine.rec >= EXPORT_SCALE_MIN_REC){ var f = fOf(res); if (f != null) return f; }
  return o.best ? fOf(o.best) : null;
}
/** Where one instance's rewards are GRANTED: [[window day, weight], ...], weights summing to 1.
 *  `off` overrides the settle offset (null = the daily view's own settleFor_). */
function instPayoutDays_(cat, inst, seg, payer, ctx, pWd, pWe, off){
  var days = (inst && inst.days) || [], n = days.length, fam = EXPORT_SCALE_FAMILY[cat];
  if (!n) return [];
  var pDay = function(d){ return isWeekend_(d) ? pWe : pWd; };
  var inner = null, j;
  if (fam === 'rm'){
    var pace = rmClaimPace_(seg, payer, n);
    var cum = function(k){
      if (k <= 0) return 0;
      if (k >= n) return 1;
      var s = pace ? pace.share('ALL', k) : null;
      return (s != null) ? s : rmMatchShare_(ctx.ds, seg, payer, k, n);
    };
    inner = [];
    for (j = 0; j < n; j++) inner.push(Math.max(0, cum(j + 1) - cum(j)));
  } else if (typeof innerWeights_ === 'function'){
    inner = innerWeights_(cat, inst, pDay, ctx.ds, seg, payer);
  } else {
    inner = days.map(function(d, k){ return (fam === 'last') ? (k === n - 1 ? 1 : 0) : pDay(d); });
  }
  var tot = 0;
  inner.forEach(function(x){ tot += num(x); });
  if (!(tot > 0)) return [];
  var sc = exportSettle_(cat);
  if (off != null) sc = { offset: off, lag: sc.lag };
  var out = [];
  days.forEach(function(d, k){
    var w = num(inner[k]) / tot;
    if (!w) return;
    (sc.lag || [1]).forEach(function(l, m){ if (l) out.push([d + num(sc.offset) + m, w * l]); });
  });
  return out;
}
/** The daily view's settle rule for a category ({offset, lag}), or the rank-family default. */
function exportSettle_(cat){
  if (typeof settleFor_ === 'function' && (typeof DAILY_ALLOC_MODEL === 'undefined' || DAILY_ALLOC_MODEL === 'settle'))
    return settleFor_(cat);
  return { offset: (EXPORT_SCALE_FAMILY[cat] === 'last') ? 1 : 0, lag: [1] };
}
/** The grant offsets a resource's payouts are tried at: the settle day and the event day. */
function exportOffsets_(cat){
  var o = num(exportSettle_(cat).offset), out = [o];
  if (o !== 0) out.push(0); else if (EXPORT_SCALE_FAMILY[cat] === 'marg') out.push(1);
  return out;
}
/** The window part of the export, in window days, or null. */
function exportScaleOverlap_(ctx){
  if (!ctx || !ctx.dataSpan || !ctx.window) return null;
  var o1 = Math.max(1, ctx.dataSpan.first), o2 = Math.min(ctx.dataSpan.last, ctx.window.days);
  return (o2 >= o1) ? { o1: o1, o2: o2 } : null;
}
/** Predicted payout mass per window day inside [o1, o2] for one cell (reach x payout weights),
 *  with S' (its total) and W (cal_curr's window instances, the reach sum T divides by). */
function exportScaleProfile_(cat, seg, payer, ctx, o1, o2, off){
  var lane = exportScaleLane_(cat), b = ctx.ds.beh(seg, payer) || {};
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)){ pWd = 1; pWe = 1; }
  var prof = {}, S = 0;
  ((lane && ctx.calCurFull[lane]) || []).forEach(function(x){
    var r = reachOne_(x, pWd, pWe);
    if (!(r > 0)) return;
    instPayoutDays_(cat, x, seg, payer, ctx, pWd, pWe, off).forEach(function(pd){
      if (pd[0] < o1 || pd[0] > o2) return;
      prof[pd[0]] = num(prof[pd[0]]) + r * pd[1]; S += r * pd[1];
    });
  });
  var win = (lane && ctx.calCur[lane]) || [];
  return { prof: prof, S: S, W: reachSum_(win, pWd, pWe), n: win.length };
}
/** Histogram intersection of two day profiles over [o1, o2], each smoothed +-1 day (0..1). */
function profileMatch_(a, b, o1, o2){
  function shares(p){
    var t = 0, d, out = {};
    for (d = o1; d <= o2; d++) t += num(p[d]);
    if (!(t > 0)) return null;
    for (d = o1; d <= o2; d++){
      var s = 0, k = 0;
      for (var e = d - 1; e <= d + 1; e++) if (e >= o1 && e <= o2){ s += num(p[e]) / t; k++; }
      out[d] = s / k;
    }
    var z = 0;
    for (d = o1; d <= o2; d++) z += out[d];
    for (d = o1; d <= o2; d++) out[d] = out[d] / z;
    return out;
  }
  var sa = shares(a), sb = shares(b);
  if (!sa || !sb) return 0;
  var m = 0;
  for (var d = o1; d <= o2; d++) m += Math.min(sa[d], sb[d]);
  return m;
}
/** One check per (category, resource): does cal_curr's predicted payout calendar match the feed's own
 *  day profile of that resource inside the window part of the export, at the settle day or the event
 *  day? {ok, score, off, f, use, reason, predDays, feedDays}. Memoised on ctx. */
function exportScaleCheck_(cat, res, ctx){
  ctx._expChk = ctx._expChk || {};
  var key = cat + '|' + res;
  if (ctx._expChk[key]) return ctx._expChk[key];
  var out = { ok: false, score: 0, off: null, reason: '', f: null, use: null, predDays: [], feedDays: [] };
  var tab = exportScaleTab_(), ov = exportScaleOverlap_(ctx);
  if (!SPAN_PER_EVENT) out.reason = 'SPAN_PER_EVENT is off';
  else if (!EXPORT_SCALE_FAMILY[cat] || !exportScaleLane_(cat)) out.reason = 'always-on or track lane: activity is its rule';
  else if (!tab) out.reason = 'no ' + EXPORT_SCALE_SHEET + ' table (run EcoGainsSim > Compute export scale)';
  else if (!ctx.dataSpan || tab.first !== ctx.dataSpan.first || tab.last !== ctx.dataSpan.last)
    out.reason = EXPORT_SCALE_SHEET + ' covers days ' + tab.first + '..' + tab.last + ' but data_gains ' +
                 (ctx.dataSpan ? ctx.dataSpan.first + '..' + ctx.dataSpan.last : 'has no span') + ' - re-run Compute export scale';
  else if (!ov) out.reason = 'the export does not overlap the window';
  else if (!tab.src[cat]) out.reason = 'the feed has no rows for this source';
  // D96: a feed that starts after the export does cannot say what share of it the lead-in days hold
  else if (tab.feedFirst > tab.first)
    out.reason = 'the feed starts on day ' + tab.feedFirst + ', after the export (day ' + tab.first + ')';
  else if (Math.min(tab.last, tab.feedLast) < ov.o1)
    out.reason = 'the feed ends (day ' + tab.feedLast + ') before the window part of the export (days ' + ov.o1 + '..' + ov.o2 + ')';
  else {
    var o = tab.src[cat];
    var enough = function(r){ return o.res[r] && o.res[r].rec >= EXPORT_SCALE_MIN_REC; };
    out.use = enough(res) ? res : (enough('HC') ? 'HC' : o.best);
    // D96: the feed may END before the export does (LIVE_OPS_V3 (20): the feed runs to Nov 1, data_gains
    // to Nov 3). Its days are the only ones with a profile, so everything measured is measured on them -
    // fl = the last day the feed carries, c2 = the last WINDOW day it carries.
    var fl = Math.min(tab.last, tab.feedLast), c2 = Math.min(ov.o2, fl);
    var e = o.res[out.use], feed = {}, spanMass = 0, inMass = 0;
    for (var d = tab.first; d <= fl; d++){
      var m = num(e.days[d]); spanMass += m;
      if (d >= ov.o1 && d <= c2){ feed[d] = m; inMass += m; }
    }
    out.f = (spanMass > 0) ? inMass / spanMass : null;
    var top = function(p){
      var mx = 0, k, days = [];
      for (k in p) mx = Math.max(mx, num(p[k]));
      for (k in p) if (mx > 0 && num(p[k]) >= 0.25 * mx) days.push(+k);
      return days.sort(function(x, y){ return x - y; });
    };
    out.feedDays = top(feed);
    if (!(spanMass > 0)) out.reason = 'the feed pays nothing for this source';
    else if (inMass / spanMass < 0.05) out.reason = 'only ' + (100 * inMass / spanMass).toFixed(0) + '% of its export falls inside the window days';
    else {
      var best = null;
      exportOffsets_(cat).forEach(function(off){
        var pr = exportScaleProfile_(cat, EXPORT_SCALE_REF[0], EXPORT_SCALE_REF[1], ctx, ov.o1, ov.o2, off);
        if (!(pr.S > 0)) return;
        var sc = profileMatch_(pr.prof, feed, ov.o1, c2);
        if (!best || sc > best.score) best = { score: sc, off: off, prof: pr.prof, S: pr.S, inst: pr.n ? pr.W / pr.n : 0 };
      });
      if (!best) out.reason = 'cal_curr pays no instance inside window days ' + ov.o1 + '..' + ov.o2;
      else {
        out.score = best.score; out.off = best.off; out.predDays = top(best.prof);
        // f counts only the mass the calendar EXPLAINS: within EXPORT_SCALE_NEAR days of a predicted
        // payout (late claims belong to their instance; a spill from a lead-in instance cal_curr does
        // not draw does not - Hatchling's Oct 19 claims of the Oct 15-18 event read x2.4 without this)
        var near = function(d){ for (var k in best.prof) if (num(best.prof[k]) > 0 && Math.abs(d - k) <= EXPORT_SCALE_NEAR) return true; return false; };
        var expl = 0;
        for (var d2 = ov.o1; d2 <= c2; d2++) if (near(d2)) expl += num(feed[d2]);
        // D96: the export's window days the feed does not carry are taken to pay, per predicted
        // instance, what the carried window days did: rho = predicted payouts there / on the carried
        // days, and f = the explained mass x (1 + rho) over the export so completed. rho = 0 (a feed as
        // long as the export) is exactly the D87 form expl / spanMass.
        var Sc = 0, Su = 0;
        for (var pk in best.prof){ if (+pk <= c2) Sc += num(best.prof[pk]); else Su += num(best.prof[pk]); }
        var rho = (c2 < ov.o2 && Sc > 0) ? Su / Sc : 0;
        out.rho = rho; out.feedTo = c2;
        out.f = expl * (1 + rho) / (spanMass + expl * rho);
        out.ok = best.score >= EXPORT_SCALE_MATCH && best.S >= 0.5 * best.inst && (Sc > 0 || !(Su > 0));
        if (c2 < ov.o2 && !(Sc > 0) && Su > 0)
          out.reason = 'cal_curr pays inside the window part only on days the feed does not carry (' + (c2 + 1) + '..' + ov.o2 + ')';
        else
        if (best.score < EXPORT_SCALE_MATCH)
          out.reason = 'payout days disagree with the feed (match ' + (100 * best.score).toFixed(0) + '%: cal_curr pays on window days ' +
                       out.predDays.join(',') + ', the feed on days ' + out.feedDays.join(',') + ')';
        else if (!out.ok)
          out.reason = 'less than half an instance of cal_curr pays inside window days ' + ov.o1 + '..' + ov.o2 + ' - too little to scale on';
      }
    }
  }
  return (ctx._expChk[key] = out);
}
/** Rainbow Maker's W and S' per resource, off its own walk (the window instances priced as the timed
 *  core prices them, and every instance's claim share inside the window part of the export). */
function rmExportWS_(seg, payer, ctx, res, o1, o2, off){
  ctx._rmExpWS = ctx._rmExpWS || {};
  var key = seg + '|' + payer + '|' + off;
  var c = ctx._rmExpWS[key];
  if (c === undefined){
    c = null;
    var win = rmInstanceRows_(seg, payer, ctx, { cal: ctx.calCur, useBase: true });
    var full = rmInstanceRows_(seg, payer, ctx, { cal: ctx.calCurFull, useBase: true, full: true });
    if (win && full){
      var b = ctx.ds.beh(seg, payer) || {}, pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
      c = { W: zeroRow_(), S: zeroRow_() };
      win.forEach(function(p){ RESOURCES.forEach(function(r){ c.W[r] += num(p.row[r]); }); });
      full.forEach(function(p){
        var sh = 0;
        instPayoutDays_('Rainbow Maker', p.inst, seg, payer, ctx, pWd, pWe, off).forEach(function(pd){ if (pd[0] >= o1 && pd[0] <= o2) sh += pd[1]; });
        RESOURCES.forEach(function(r){ c.S[r] += num(p.row[r]) * sh; });
      });
    }
    ctx._rmExpWS[key] = c;
  }
  if (!c) return null;
  var r0 = (num(c.W[res]) > 0 && num(c.S[res]) > 0) ? res : 'HC';
  return { W: num(c.W[r0]), S: num(c.S[r0]) };
}
/** The per-event scale of one export amount, or null (-> the activity scale). */
function spanScaleEvent_(cat, seg, payer, res, ctx){
  if (!SPAN_PER_EVENT || !EXPORT_SCALE_FAMILY[cat]) return null;
  var chk = exportScaleCheck_(cat, res, ctx);
  if (!chk.ok || chk.f == null) return null;
  var ov = exportScaleOverlap_(ctx), ws;
  ctx._expWS = ctx._expWS || {};
  if (cat === 'Rainbow Maker') ws = rmExportWS_(seg, payer, ctx, res, ov.o1, ov.o2, chk.off);
  else {
    var k = cat + '|' + seg + '|' + payer + '|' + chk.off;
    ws = ctx._expWS[k] || (ctx._expWS[k] = exportScaleProfile_(cat, seg, payer, ctx, ov.o1, ov.o2, chk.off));
  }
  if (!ws || !(ws.S > 0)) return null;
  return chk.f * ws.W / ws.S;
}
/** The pooled feed as the EXPORT_SCALE_SHEET grid (pure: no sheet writes). Rows: the title, the stamp,
 *  a blank, the header, then one row per (source, resource) with its granted mass per window day of
 *  the export. null when the feed or the dates are missing. */
function exportScaleGrid_(ctx){
  ctx = ctx || Context.get();
  if (!ctx.dataSpan) return null;
  var v = sheetVals_(EXPORT_SCALE_FEED);
  if (!v || v.length < 2) return null;
  var h = headerIndex_(v[0] || []);
  if (h['source'] == null || h['currency'] == null || h['gain_total'] == null) return null;
  var d1 = calDay1Date_(), first = ctx.dataSpan.first, last = ctx.dataSpan.last, agg = {};
  var fMin = null, fMax = null;                            // D96: the days the feed itself carries
  for (var i = 1; i < v.length; i++){
    var r = v[i], cat = String(r[h['source']] == null ? '' : r[h['source']]).trim();
    if (!cat || cat === 'ALL') continue;
    var day = null;
    if (h['calendar_date'] != null && d1 != null){ var dd = dateDays_(r[h['calendar_date']]); if (dd != null) day = dd - d1 + 1; }
    if (day == null && h['day_index'] != null) day = Math.round(num(r[h['day_index']])) + first - 1;
    if (day == null || day < first || day > last) continue;
    if (fMin == null || day < fMin) fMin = day;
    if (fMax == null || day > fMax) fMax = day;
    var res = String(r[h['currency']]).trim();
    var o = ((agg[cat] = agg[cat] || {})[res] = agg[cat][res] || { days: {}, rec: 0 });
    o.days[day] = num(o.days[day]) + num(r[h['gain_total']]);
    if (h['recipients_day'] != null) o.rec += num(r[h['recipients_day']]);
  }
  var hdr = ['source', 'resource', 'recipients'];
  for (var d = first; d <= last; d++) hdr.push('d' + d);
  var grid = [['EXPORT SCALE - ' + EXPORT_SCALE_FEED + ' pooled over cells: granted amount per window day of the export (D87). ' +
               'Written by EcoGainsSim > Compute export scale; the engine reads this table, never the feed.'],
              ['export days', first + '..' + last, 'window days', '1..' + ctx.window.days, 'written', stampNow_(), 'build', ENGINE_BUILD,
               'feed days', (fMin == null ? first : fMin) + '..' + (fMax == null ? last : fMax)],
              [], hdr];
  Object.keys(agg).sort().forEach(function(cat){
    Object.keys(agg[cat]).sort().forEach(function(res){
      var o = agg[cat][res], row = [cat, res, Math.round(o.rec)];
      for (var d2 = first; d2 <= last; d2++) row.push(Math.round(num(o.days[d2]) * 1000) / 1000);
      grid.push(row);
    });
  });
  return grid;
}
/** What the per-event scale did, per (source, resource) the feed carries: the rows the menu run writes
 *  under the table. */
function exportScaleReport_(ctx){
  ctx = ctx || Context.get();
  var rows = [['source', 'resource', 'scale used', 'payout-day match', 'granted', 'f: share inside window days',
               'scale at ' + EXPORT_SCALE_REF.join(' '), 'scale range over cells', 'activity scale', 'reason']];
  var cells = [], tab = exportScaleTab_();
  segMembers_(ctx.ds).forEach(function(s){ ['NONPAYER', 'PAYER'].forEach(function(p){ cells.push([s, p]); }); });   // D94: the pull's own cells
  var act = ctx.dataSpan ? spanScale_(EXPORT_SCALE_REF[0], EXPORT_SCALE_REF[1], ctx) : 1;
  Object.keys(EXPORT_SCALE_FAMILY).forEach(function(cat){
    var resList = (tab && tab.src[cat]) ? Object.keys(tab.src[cat].res).sort() : ['HC'];
    resList.forEach(function(res){
      var chk = exportScaleCheck_(cat, res, ctx), sc = [];
      if (chk.ok) cells.forEach(function(c){ var e = spanScaleEvent_(cat, c[0], c[1], res, ctx); if (e != null) sc.push(e); });
      var ref = chk.ok ? spanScaleEvent_(cat, EXPORT_SCALE_REF[0], EXPORT_SCALE_REF[1], res, ctx) : null;
      var rng = sc.length ? Math.min.apply(null, sc).toFixed(2) + ' - ' + Math.max.apply(null, sc).toFixed(2) : '';
      rows.push([cat, res, (chk.ok && sc.length) ? 'per event' : 'activity', chk.score ? Math.round(chk.score * 100) / 100 : '',
                 (chk.off == null) ? '' : (chk.off === 0 ? 'on the day' : '+' + chk.off + ' day'),
                 (chk.f != null) ? Math.round(chk.f * 1000) / 1000 : '', (ref != null) ? Math.round(ref * 1000) / 1000 : '',
                 rng, Math.round(act * 1000) / 1000,
                 chk.ok ? [((chk.use && chk.use !== res) ? 'timed on ' + chk.use + ' (too few recipients of its own)' : ''),
                           (chk.rho > 0 ? 'the feed ends on day ' + chk.feedTo + ': the export\'s later window days are taken to pay like the carried ones (x' + (1 + chk.rho).toFixed(2) + ')' : '')]
                            .filter(function(x){ return x; }).join('; ')
                        : chk.reason]);
    });
  });
  return rows;
}
function stampNow_(){
  var d = new Date(), p = function(x){ return (x < 10 ? '0' : '') + x; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
/** MENU: EcoGainsSim > Compute export scale. Pools the by-source feed into EXPORT_SCALE_SHEET and
 *  writes the per-event report under it. Re-run after every data re-pull or cal_curr edit. */
function fillExportScale(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  _expScaleTab = undefined; Context.reset();
  var ctx = Context.get(), grid = exportScaleGrid_(ctx);
  if (!grid){
    var why = !ctx.dataSpan ? 'data_gains carries no window_start_date / data_through_date (or no date is typed above day 1)'
                            : "no usable '" + EXPORT_SCALE_FEED + "' sheet (source | currency | gain_total | calendar_date)";
    try { ss.toast('Export scale not computed: ' + why + '. The export keeps the activity scale.', 'Compute export scale', 12); } catch (e){}
    return null;
  }
  var sh = ss.getSheetByName(EXPORT_SCALE_SHEET) || ss.insertSheet(EXPORT_SCALE_SHEET);
  sh.clear();
  var w = grid.reduce(function(m, r){ return Math.max(m, r.length); }, 0);
  var pad = function(g, n){ return g.map(function(r){ var x = r.slice(); while (x.length < n) x.push(''); return x; }); };
  sh.getRange(1, 1, grid.length, w).setValues(pad(grid, w));
  delete _sheetValsCache[EXPORT_SCALE_SHEET]; _expScaleTab = undefined; Context.reset();
  var rep = exportScaleReport_(Context.get()), r0 = grid.length + 3;
  sh.getRange(r0 - 1, 1).setValue('WHAT THE ENGINE DID WITH IT (per event where the payout days match the feed, else the activity scale)');
  var w2 = rep.reduce(function(m, r){ return Math.max(m, r.length); }, 0);
  sh.getRange(r0, 1, rep.length, w2).setValues(pad(rep, w2));
  var n = rep.filter(function(r){ return r[2] === 'per event'; }).length;
  var kj = null;
  try { kj = fillKiteJoiners_(); } catch (e){ Logger.log('Kite joiners not computed (' + e + ') - Kite keeps its plain reach and the 0.35 opt-in.'); }
  try { ss.toast(n + ' of ' + (rep.length - 1) + ' source x resource amounts scaled per event; the rest keep the activity scale ' +
                 '(reasons on ' + EXPORT_SCALE_SHEET + ').' + (kj ? ' ' + kj : ''), 'Compute export scale', 10); } catch (e){}
  return rep;
}

// ---- D100: the kite_joiners table -------------------------------------------------------------
/** The KITE_JOIN_SHEET grid off the by-source feed (pure: no sheet writes), or null with the reason in
 *  .why. Measured festivals = cal_curr's Kite instances of the modal length that lie wholly inside the
 *  feed's days and are not cut by the grid's first column. */
function kiteJoinGrid_(ctx){
  ctx = ctx || Context.get();
  var fail = function(why){ var g = null; kiteJoinGrid_.why = why; return g; };
  kiteJoinGrid_.why = '';
  var d1 = calDay1Date_();
  if (d1 == null) return fail('no date above day 1 on the calendars');
  var v = sheetVals_(EXPORT_SCALE_FEED);
  if (!v || v.length < 2) return fail('no ' + EXPORT_SCALE_FEED + ' sheet');
  var h = headerIndex_(v[0] || []);
  var need = ['segment', 'payer_flag', 'source', 'currency', 'calendar_date', 'recipients_day', 'players_in_cell'];
  for (var k = 0; k < need.length; k++) if (h[need[k]] == null) return fail(EXPORT_SCALE_FEED + ' has no ' + need[k] + ' column');
  var rec = {}, players = {}, fMin = null, fMax = null;
  for (var i = 1; i < v.length; i++){
    var r = v[i], dd = dateDays_(r[h['calendar_date']]);
    if (dd == null) continue;
    var day = dd - d1 + 1;
    if (fMin == null || day < fMin) fMin = day;
    if (fMax == null || day > fMax) fMax = day;
    if (String(r[h['source']]).trim() !== KITE_JOIN_CAT || String(r[h['currency']]).trim() !== KITE_JOIN_RES) continue;
    var key = segCanon_(r[h['segment']]) + '|' + String(r[h['payer_flag']]).trim().toUpperCase();
    rec[key] = rec[key] || {};
    rec[key][day] = num(rec[key][day]) + num(r[h['recipients_day']]);
    players[key] = num(r[h['players_in_cell']]);
  }
  if (!Object.keys(rec).length) return fail('the feed has no ' + KITE_JOIN_CAT + ' / ' + KITE_JOIN_RES + ' rows');
  var gridFirst = 1 - num(ctx.window.offset);
  var cand = ((ctx.calCurFull || {})[KITE_JOIN_LANE] || []).filter(function(x){
    return !x.variant && num(x.start) > gridFirst && num(x.start) >= fMin && num(x.start) + num(x.dur) - 1 <= fMax; });
  var L0 = modalDur_(cand);
  var insts = cand.filter(function(x){ return num(x.dur) === L0; }).sort(function(a, b){ return a.start - b.start; });
  if (!insts.length || !(L0 > 1)) return fail('no complete ' + KITE_JOIN_LANE + ' festival of cal_curr inside the feed days ' + fMin + '..' + fMax);
  // the alignment the D78 lead rule gives is CHECKED: the join grant must peak on an instance's own days
  var shiftMass = function(s){ var m = 0; for (var kk in rec) insts.forEach(function(x){
    for (var j = 0; j < L0; j++) m += num(rec[kk][num(x.start) + j + s]); }); return m; };
  var shift = 0;
  [-1, 1].forEach(function(s){ if (shiftMass(s) > 1.05 * shiftMass(shift)) shift = s; });
  var ds = ctx.ds, rows = [];
  var order = (ds.segs ? ds.segs() : []).slice();
  Object.keys(rec).forEach(function(kk){ var s = kk.split('|')[0]; if (order.indexOf(s) < 0) order.push(s); });
  order.forEach(function(sg){
    ['NONPAYER', 'PAYER'].forEach(function(py){
      var kk = sg + '|' + py, rr = rec[kk];
      if (!rr) return;
      var b = ds.beh(sg, py) || {}, pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
      var J = 0, sh = [], pm = [], reach = 0, j;
      for (j = 0; j < L0; j++){ sh.push(0); pm.push(0); }
      insts.forEach(function(x){
        var n = [], t = 0;
        for (j = 0; j < L0; j++){ var c = num(rr[num(x.start) + j + shift]); n.push(c); t += c; }
        J += t / insts.length;
        for (j = 0; j < L0; j++){
          if (t > 0) sh[j] += n[j] / t / insts.length;
          pm[j] += (isWeekend_(num(x.start) + j) ? pWe : pWd) / insts.length;
        }
        reach += reachOne_(x, pWd, pWe) / insts.length;
      });
      var u = sh.map(function(s, jj){ return (pm[jj] > 0) ? s / pm[jj] : 0; }), us = 0;
      u.forEach(function(x){ us += x; });
      u = u.map(function(x){ return (us > 0) ? x / us : 0; });
      var optin = (players[kk] > 0) ? J / players[kk] : 0;
      var act = (reach > 0) ? Math.min(1, optin / reach) : 0;
      var r6 = function(x){ return Math.round(x * 1e6) / 1e6; };
      rows.push([segLabel_(sg, ds), py, players[kk], insts.length, r6(J), r6(optin), r6(reach), r6(act)]
                .concat(sh.map(r6), u.map(r6), [J >= KITE_JOIN_MIN ? 'own' : 'parent (fewer than ' + KITE_JOIN_MIN + ' joiners)']));
    });
  });
  var hdr = ['segment', 'payer_flag', 'players_in_cell', 'festivals', 'joiners_per_instance', 'opt_in', 'reach_measured', 'opt_in_active'];
  for (var a = 1; a <= L0; a++) hdr.push('s' + a);
  for (var b2 = 1; b2 <= L0; b2++) hdr.push('u' + b2);
  hdr.push('read as');
  return [['KITE JOINERS - ' + KITE_JOIN_CAT + ' ' + KITE_JOIN_RES + ' recipients (the score-100 join grant) per festival day, off ' +
           EXPORT_SCALE_FEED + ' (D100). s = share of joiners by festival day; u = s / that day\'s activity rate, normalised; ' +
           'opt_in_active = opt_in / reach_measured. Written by EcoGainsSim > Compute export scale.'],
          ['festivals (window days)', insts.map(function(x){ return x.start + '..' + (x.start + L0 - 1); }).join(', '),
           'length', L0, 'feed days', fMin + '..' + fMax, 'day shift', shift, 'written', stampNow_(), 'build', ENGINE_BUILD],
          [], hdr].concat(rows);
}
/** Writes KITE_JOIN_SHEET; returns a one-line summary (or the reason it could not). */
function fillKiteJoiners_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  _kiteJoinTab = undefined; Context.reset();
  var grid = kiteJoinGrid_(Context.get());
  if (!grid) return 'Kite joiners not computed: ' + kiteJoinGrid_.why + '.';
  var sh = ss.getSheetByName(KITE_JOIN_SHEET) || ss.insertSheet(KITE_JOIN_SHEET);
  sh.clear();
  var w = grid.reduce(function(m, r){ return Math.max(m, r.length); }, 0);
  sh.getRange(1, 1, grid.length, w).setValues(grid.map(function(r){ var x = r.slice(); while (x.length < w) x.push(''); return x; }));
  delete _sheetValsCache[KITE_JOIN_SHEET]; _kiteJoinTab = undefined; Context.reset();
  return 'Kite opt-in and join days measured on ' + grid[1][1] + ' (' + (grid.length - 4) + ' cells, ' + KITE_JOIN_SHEET + ').';
}

// ---- missing event telemetry (D79, 2026-10-30) ---------------------------------------------------
// data_event_inst carries no 'Bomb' rows on LIVE_OPS_V3 (8) - the A/B pull did not include
// bomb_event - so Bomb's Challenge had no rank distribution, and lbE_'s no-positions fallback prices
// a ladder at its POT: every rank paid to one player. On the absolute lanes that is not a ratio
// that cancels - it put 4.7 envelopes per player per window on the measured side (D61) and on the
// simulated side, against none in the export, and would have priced any SPT added to the ladder the
// same way. A missing event borrows the distribution of its sibling: Bomb's Challenge is the same
// 2-day rank event as Red's Challenge. FLAGGED - a proxy, not a measurement; a pull with real
// 'Bomb' rows takes over by itself (the proxy is read only when the event has no row).
var EVENT_INST_PROXY = { 'Bomb': 'Red' };

var DataStore = (function(){
  var _cache = null;
  function build(gainsVals, behVals, accVals, kiteVals, rmVals, streaksVals, instVals){
    // D79: the anchor arm only, wherever a pull carries both
    gainsVals = armRows_(gainsVals || [], 'data_gains'); behVals = armRows_(behVals || [], 'data_seg_beh');
    accVals = armRows_(accVals, 'data_event_accrual'); kiteVals = armRows_(kiteVals, 'data_event_kite_accrual');
    rmVals = armRows_(rmVals || [], 'data_RM'); streaksVals = armRows_(streaksVals, 'data_streaks');
    instVals = armRows_(instVals, 'data_event_inst');
    // D94: every map is keyed by the CANONICAL segment (segCanon_), so '100+' in one pull and
    // '100-249' in another are the same key, and data_gains' 'F. 100-249' needs no table.
    var gh = headerIndex_(gainsVals[0] || []), gMap = {}, gEarn = {}, gPlayers = {};
    for (var i = 1; i < gainsVals.length; i++){ var r = gainsVals[i];
      if (!r[gh['engagement_segment']]) continue;
      var gs = segCanon_(r[gh['engagement_segment']]);
      gMap[[gs, r[gh['payer_flag']], r[gh['category']], r[gh['resource']]].join('|')]
        = num(r[gh['amount_per_earner']]);
      // the pull's own population behind each amount (D88 / D94): earners of the resource, players of the cell
      if (gh['resource_earners'] != null) gEarn[[gs, r[gh['payer_flag']], r[gh['resource']]].join('|')] = num(r[gh['resource_earners']]);
      if (gh['players_in_cell'] != null) gPlayers[[gs, r[gh['payer_flag']]].join('|')] = num(r[gh['players_in_cell']]); }
    var bh = headerIndex_(behVals[0] || []), bMap = {}, segRows = [], segSeen = {};
    for (var j = 1; j < behVals.length; j++){ var b = behVals[j];
      if (!b[bh['segment']]) continue;
      var o = {}; for (var nm in bh) o[nm] = b[bh[nm]];
      var bs = segCanon_(b[bh['segment']]);
      bMap[[bs, b[bh['payer_flag']]].join('|')] = o;
      if (!segSeen[bs]){ segSeen[bs] = 1;
        segRows.push({ seg: bs, label: String(b[bh['segment']]).trim(),
                       rank: (bh['seg_rank'] != null && b[bh['seg_rank']] !== '') ? num(b[bh['seg_rank']]) : 1e6 + segRows.length }); } }
    segRows.sort(function(x, y){ return x.rank - y.rank; });
    // D94: a behaviour row the pull lacks for a split-out segment is read off its parent (250+ -> 100-249)
    function withParent(map, mk, seg){
      var c = segCanon_(seg), hops = 0;
      while (c && hops++ < 4){ var v = map[mk(c)]; if (v !== undefined) return v; c = SEG_PARENT[c]; }
      return undefined;
    }
    function accIndex(vals){
      if (!vals || !vals.length) return {};
      var h = headerIndex_(vals[0]), m = {};
      for (var k = 1; k < vals.length; k++){ var r = vals[k], ev = r[h['event_name']];
        if (!ev) continue;
        var key = [ev, r[h['payer_flag']], segCanon_(r[h['segment']])].join('|');
        (m[key] = m[key] || []).push({day: num(r[h['event_day']]), share: num(r[h['cum_token_share_p50']]),
          // D60: the MEAN column too (null when the pull predates it)
          shareMean: (h['cum_token_share_mean'] != null) ? num(r[h['cum_token_share_mean']]) : null}); }
      for (var kk in m) m[kk].sort(function(a,b){ return a.day - b.day; });
      return m; }
    var aMap = accIndex(accVals), kMap = accIndex(kiteVals);
    var rh = headerIndex_(rmVals[0] || []), rMap = {};
    for (var q = 1; q < rmVals.length; q++){ var w = rmVals[q];
      if (!w[rh['segment']]) continue;
      rMap[[segCanon_(w[rh['segment']]), w[rh['payer_flag']]].join('|')] = {
        p10: num(w[rh['p10_matchables_window']]), p25: num(w[rh['p25_matchables_window']]),
        p50: num(w[rh['p50_matchables_window']]), p75: num(w[rh['p75_matchables_window']]),
        p90: num(w[rh['p90_matchables_window']]) }; }
    var th = headerIndex_((streaksVals || [])[0] || []), tMap = {};
    for (var t = 1; t < (streaksVals || []).length; t++){ var s = streaksVals[t];
      if (!s[th['segment']]) continue;
      var to = { p25: num(s[th['max_streak_per_day_p25']]), p50: num(s[th['max_streak_per_day_p50']]),
        p75: num(s[th['max_streak_per_day_p75']]), p90: num(s[th['max_streak_per_day_p90']]) };
      for (var tn in th) if (to[tn] === undefined) to[tn] = s[th[tn]];   // D103: every column too (the wager reads them)
      tMap[[segCanon_(s[th['segment']]), s[th['payer_flag']]].join('|')] = to; }
    var eh = headerIndex_((instVals || [])[0] || []), eMap = {};
    for (var e = 1; e < (instVals || []).length; e++){ var x = instVals[e];
      if (!x[eh['event_name']]) continue;
      var eo = {}; for (var en in eh) eo[en] = x[eh[en]];
      eMap[[x[eh['event_name']], segCanon_(x[eh['segment']]), x[eh['payer_flag']]].join('|')] = eo; }
    return {
      // D71: the window rescale hook (null = none). Only EXPORT amounts pass through here.
      scaleFn: null,
      // D79: the dates the export covers ({start, end, days} in days since 1970), or null
      span: dataSpanOf_(gainsVals),
      gains: function(seg, payer, cat, res){
        var cs = segCanon_(seg);
        var v = num(gMap[[cs, payer, cat, res].join('|')]);       // never the parent's: a missing row is a measured 0
        return (v && this.scaleFn) ? v * this.scaleFn(cat, cs, payer, res) : v; },
      dataRow: function(cat, seg, payer){ var o = {}, self = this;
        RESOURCES.forEach(function(r){ o[r] = self.gains(seg, payer, cat, r); }); return o; },
      // D94: the pull's population behind an amount. hasGain: the export carries (category, resource) for
      // the cell; earners: the resource's earners there (0 = unknown); players: the cell's players
      // (data_gains' players_in_cell, else data_seg_beh's).
      hasGain: function(seg, payer, cat, res){ return num(gMap[[segCanon_(seg), payer, cat, res].join('|')]) > 0; },
      earners: function(seg, payer, res){ return num(gEarn[[segCanon_(seg), payer, res].join('|')]); },
      players: function(seg, payer){
        var cs = segCanon_(seg), n = num(gPlayers[[cs, payer].join('|')]);
        if (n > 0) return n;
        var b = bMap[[cs, payer].join('|')] || {};
        return num(b.players_in_cell) > 0 ? num(b.players_in_cell) : num(b.unique_players); },
      // D94: the segments data_seg_beh carries, canonical, in its rank order (ALL included when pulled),
      // and the label the pull itself uses for one
      segs: function(){ return segRows.map(function(x){ return x.seg; }); },
      segLabel: function(seg){ var c = segCanon_(seg);
        for (var i = 0; i < segRows.length; i++) if (segRows[i].seg === c) return segRows[i].label;
        return null; },
      beh: function(seg, payer){ return withParent(bMap, function(c){ return [c, payer].join('|'); }, seg) || {}; },
      // true when the pull has its OWN behaviour row for the cell (not the parent's)
      hasBeh: function(seg, payer){ return bMap[[segCanon_(seg), payer].join('|')] !== undefined; },
      nsStreak: function(seg, payer){ return withParent(tMap, function(c){ return [c, payer].join('|'); }, seg) || null; },
      eventInst: function(ev, seg, payer){
        var x = withParent(eMap, function(c){ return [ev, c, payer].join('|'); }, seg);
        if (x) return x;
        // D79: an event the pull has no rows for borrows a sibling's rank/progress distribution
        var px = eventInstProxy_(ev);                     // D102: a NEW leaderboard's 'Places from'
        return (px && withParent(eMap, function(c){ return [px, c, payer].join('|'); }, seg)) || null; },
      rmPct: function(seg, payer){ return withParent(rMap, function(c){ return [c, payer].join('|'); }, seg) || null; },
      accrualCurve: function(ev, seg, payer, kite){ var m = kite ? kMap : aMap;
        return withParent(m, function(c){ return [ev, payer, c].join('|'); }, seg) || m[[ev, payer, '0-9'].join('|')] || []; },
      // The MEAN column of the same curve (D60, 2026-10-14). cum_token_share_p50 is the median
      // PLAYER's progress - for every 2-day event it reads 1.0 on day 1 while the mean reads
      // 0.81-0.96 - whereas a day ALLOCATION of a cohort total needs the cohort's share of
      // tokens by day, which is the mean. accrualD_ (the D multiplier) keeps reading p50:
      // that is a separate, validated decision and this accessor must not move it.
      // Falls back to the p50 curve when the pull carries no mean column, so an older export
      // still places every instance.
      accrualCurveMean: function(ev, seg, payer){
        var c = this.accrualCurve(ev, seg, payer, false);
        if (!c.length || c[0].shareMean == null) return c;
        return c.map(function(pt){ return { day: pt.day, share: pt.shareMean }; }); }
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
    fromRanges: function(g,b,a,k,rm,st,ei){ return build(g,b,a,k,rm,st,ei); },
    // D67: dropped by resetModuleCaches_ (Context.reset), so a harness that mutates a data_* sheet
    // and resets reads the mutation - a memo that survives the reset served the OLD export.
    reset: function(){ _cache = null; }
  };
  function vals_(ss, name){ var sh = ss.getSheetByName(name); return sh ? sh.getDataRange().getValues() : []; }
})();

// ============================== CALENDAR READER ==============================================
// Verified rule: merged range = ONE instance (duration = column width); filled non-merged cell
// = ONE 1-day instance; neighbours never collapsed; day = column - 1 (B = day 1 .. AH = day 33).
var CAL_FIRST_ROW = 5, CAL_LAST_ROW = 25, CAL_FIRST_COL = 2, CAL_LAST_COL = 35;   // readable B5:AI25 (D79)
var CAL_ALIAS = { 'Mystery Puzzle':'Jigsaw Puzzle', 'Mystery Box':'Jigsaw Puzzle',
                  "Chuck's Flash Race":'Flash Race' };
// D102: labels matched LOOSELY - case, spaces and emoji ignored (only letters and digits compared) - so
// the calendar can carry 'MiC 🍦' (the user's label for Mighty Ice Cream, 2026-11-11), 'MIC' or
// 'Mighty Ice Cream' and every one is the same lane. Only the keys listed here; every other label is
// matched exactly, as before.
var CAL_ALIAS_LOOSE = { 'mic': 'Mighty Ice Cream', 'mightyicecream': 'Mighty Ice Cream' };
function calLooseKey_(s){ return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

// ---- calendar VARIANTS (D73, 2026-10-28) ----------------------------------------------------
// A calendar label '<lane> (<variant>)' - 'Kite Festival (2d)' - is an instance of <lane> running
// a different config. It is folded into the lane here, every instance carrying x.variant, so the
// cadence ratio, the daily view, CalStats and the card sim see ONE event with more instances, and
// pricing reads each instance's own sheet (variantSpec_). Only a label whose stem is a lane the
// engine prices is folded, and never a label that is itself a lane.
// D99 (2026-11-09): a QUALIFIER may follow the parenthesis - 'Kite Festival (2d) weekend' is the
// '2d' variant's 'weekend' config. x.variant then reads '2d|weekend' (VARIANT_QUAL_SEP), so every
// reader keyed on x.variant (laneVariantE_'s E cache, packRungs_, the play-by-play) prices the
// qualified instances apart; variantSpec_ maps it to <base>_<v>_v2_<q> (see there).
var CAL_VARIANT_RE = /^(.*\S)\s*\(\s*([^()]*\S)\s*\)\s*([^()]*?)\s*$/;
var VARIANT_QUAL_SEP = '|';
var _calLaneSet = null;
function calLaneKnown_(lab){
  if (!_calLaneSet){
    _calLaneSet = {};
    [CAL_LABEL, (typeof DAILY_CAL_LABEL !== 'undefined') ? DAILY_CAL_LABEL : {}].forEach(function(m){
      for (var k in m) _calLaneSet[m[k]] = true;
    });
  }
  return !!_calLaneSet[lab];
}
function calFoldVariants_(cal){
  var touched = {};
  Object.keys(cal || {}).forEach(function(lab){
    if (calLaneKnown_(lab)) return;
    var m = CAL_VARIANT_RE.exec(lab);
    if (!m || !calLaneKnown_(m[1])) return;
    var lane = m[1], v = m[2] + (m[3] ? VARIANT_QUAL_SEP + m[3].replace(/\s+/g, '_') : '');   // D99
    (cal[lab] || []).forEach(function(x){ x.variant = v; });
    cal[lane] = (cal[lane] || []).concat(cal[lab] || []);
    delete cal[lab];
    touched[lane] = true;
  });
  // start-sorted (stable), so an ordinal means the same instance to every reader
  Object.keys(touched).forEach(function(l){ cal[l].sort(function(a, b){ return a.start - b.start; }); });
  return cal;
}
/** true when any instance of the list runs a variant config. */
function hasVariant_(list){
  for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].variant) return true;
  return false;
}
/** The pricing spec of one variant: '<base>_<v>_v2' on the redesign side, '<base>_<v>' then '<base>'
 *  on the anchor side; a sheet that does not exist falls back to the lane's own (logged once).
 *  D99: a qualified variant '<v>|<q>' ('Kite Festival (2d) weekend') reads '<base>_<v>_v2_<q>'
 *  (Ki_2d_v2_weekend), else '<base>_<v>_<q>_v2', else the unqualified variant's '<base>_<v>_v2', else
 *  the lane's own; the anchor side '<base>_<v>_<q>', else '<base>_<v>', else '<base>'. */
var _variantSpecCache = {};
function variantSpec_(spec, variant){
  if (!spec || !variant) return spec;
  // only the sheet lookup is cached: several sources share a base sheet (Race) with different
  // row ranges, so the spec itself is cloned per call
  var b = spec.base || spec.sheet, key = b + '|' + variant;
  var nm = _variantSpecCache[key];
  if (!nm){
    var parts = String(variant).split(VARIANT_QUAL_SEP), v = parts[0], q = parts.slice(1).join('_');
    var v2c = q ? [b + '_' + v + '_v2_' + q, b + '_' + v + '_' + q + '_v2', b + '_' + v + '_v2'] : [b + '_' + v + '_v2'];
    var bvc = q ? [b + '_' + v + '_' + q, b + '_' + v] : [b + '_' + v];
    var pick = function(c){ for (var i = 0; i < c.length; i++) if (sheetVals_(c[i]).length > 0) return c[i]; return null; };
    var v2n = pick(v2c), bvn = pick(bvc);
    nm = _variantSpecCache[key] = { v2: v2n, bv: bvn, hasV2: !!v2n, hasB: !!bvn };
    if (!v2n || (q && v2n !== v2c[0])){ try { Logger.log('D73/D99: no sheet ' + v2c[0] + ' - variant (' + variant + ') of ' + b +
      ' priced on ' + (v2n || spec.v2 || spec.sheet)); } catch(e){} }
  }
  var o = {};
  for (var k in spec) o[k] = spec[k];
  if (spec.v2) o.v2 = nm.hasV2 ? nm.v2 : spec.v2;
  if (spec.base) o.base = nm.hasB ? nm.bv : spec.base;
  if (spec.sheet && !spec.v2) o.sheet = nm.hasV2 ? nm.v2 : spec.sheet;
  o.variant = variant;
  return o;
}
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
function calNorm_(v){
  var s = String(v).replace(/\n/g, ' ').trim();
  return CAL_ALIAS[s] || CAL_ALIAS_LOOSE[calLooseKey_(s)] || s;   // D102: the loose aliases
}
function mkInst_(start, dur){
  var days = []; for (var d = start; d < start + dur; d++) days.push(d);
  return { start: start, dur: dur, days: days };
}

// ---- menu-precompute (the robust fix for custom-function merge reading) ----

// ============================== IS THE PASTED CODE CURRENT? =================================
// Apps Script has no version number and no file list a script can read, and all .gs files share one
// global namespace - so a SECOND copy of a file silently overrides the first by load order, and a
// file that was never re-pasted looks exactly like one that was. Both failures present the same
// way: the sheet keeps showing the numbers it showed yesterday, and nothing anywhere says why.
//
// This asks the LIVE code what it is, two ways:
//   * the build stamp each file declares - which tells you which copy WON, not which copy exists
//   * feature probes read off Function.prototype.toString() and the live constants, which is the
//     only thing that cannot be faked by a stale duplicate: if colRewardRow_ does not mention
//     colSimSeasons_, the running definition is the old closed form whatever any stamp says
//
//   =ECOGAINS_BUILD(sim_refresh!$A$1)      or   menu EcoGainsSim > Check code versions
/** @customfunction */
function ECOGAINS_BUILD(nonce){
  var rows = [['What', 'Live', 'Expected', 'OK?']];
  function has(name){ try { return eval('typeof ' + name) !== 'undefined'; } catch(e){ return false; } }
  function src(name){ try { return eval(name).toString(); } catch(e){ return ''; } }
  function row(what, live, want){
    rows.push([what, String(live), String(want), (String(live) === String(want)) ? 'yes' : 'NO']);
  }

  rows.push(['--- build stamps (which COPY of each file won) ---', '', '', '']);
  ['ENGINE_BUILD', 'CARDSIM_BUILD', 'DAILY_BUILD', 'SPS_BUILD', 'CHANGESUM_BUILD', 'SIMFILL_BUILD', 'KITEX_BUILD'].forEach(function(v){
    rows.push([v, has(v) ? eval(v) : 'NOT IN THIS PROJECT', '', has(v) ? '' : 'NO']);
  });

  rows.push(['--- what the running code actually does ---', '', '', '']);
  // D41: the collection rows run the card sim instead of the closed form
  row('Col - Sets runs real seasons (D41)',
      has('colSimSeasons_') && src('colRewardRow_').indexOf('colSimSeasons_') >= 0, true);
  row('the closed form is gone (D41)', !has('expectedCardsDrawn_'), true);
  row('seasons per segment (D41)', has('COL_SIM_SEASONS') ? COL_SIM_SEASONS : 0, 50);
  // D40: the card sim plays ToF
  row('card sim plays ToF runs (D40)', has('cardTofConfig_'), true);
  row('ToF envelopes stop at the album close (D40)',
      src('simToF').indexOf('SEASON_LAST_DAY') >= 0, true);
  // D39/D38: the cadence block
  row('cadence rows (D39)', has('CADENCE_ROWS') ? CADENCE_ROWS.length : 0, 8);
  row('pack log columns (D31)', has('LOG_COLS') ? LOG_COLS.length : 0, 11);
  // D37/D36/D35
  row('ToF reward block is split (D37)', has('tofLadderRow_'), true);
  row('Sim per Segment partition is total (D36)', has('spsGroupOf_'), true);
  row('ToF is in the refresh list (D35)', REFRESH_SHEETS.indexOf('ToF') >= 0, true);
  row('categories (D102: Mighty Ice Cream appended)', CATEGORY_ORDER.length, 30);

  rows.push(['--- if any row says NO ---', '', '', '']);
  rows.push(['1. re-paste that file, then reload the spreadsheet tab', '', '', '']);
  rows.push(['2. if it still says NO, the project has TWO copies of it - delete the old one', '', '', '']);
  rows.push(['3. then run menu EcoGainsSim > Refresh simulations', '', '', '']);
  return rows;
}

// Same check, from the menu, for when the sheet itself is the thing that is not updating.
function checkCodeVersions(){
  var g = ECOGAINS_BUILD(0), bad = [];
  for (var i = 1; i < g.length; i++) if (String(g[i][3]) === 'NO') bad.push(g[i][0]);
  var msg = bad.length ? ('STALE: ' + bad.join(' | ')) : 'Every file is current.';
  Logger.log(g.map(function(r){ return r.join('  |  '); }).join('\n'));
  try { SpreadsheetApp.getActive().toast(msg, 'Check code versions', 15); } catch(e){}
  return msg;
}

function onOpen(){
  SpreadsheetApp.getUi().createMenu('EcoGainsSim')
    .addItem('Precompute calendars', 'precomputeCalendars')
    .addItem('Clear calendar precompute', 'clearCalendarPrecompute')
    .addItem('Refresh simulations', 'refreshSims_')
    .addItem('Check code versions', 'checkCodeVersions')
    .addItem('Fill Sim per Segment', 'fillSimPerSegment')   // SimPerSegmentFill.gs
    .addItem('Fill change summary', 'fillChangeSummary')     // ChangeSummary.gs (D85)
    .addItem('Compute export scale', 'fillExportScale')      // D87: the per-event export scale table
    // D52 (2026-09-10): the answer to "Exceeded maximum execution time (line 0)". A custom
    // function gets 30 seconds and its OWN cold cache, so all 48 ECOGAINS_ formulas rebuild
    // Context + DataStore + every sheet read independently (~2,060 getValues round trips for a
    // full recalc). These two run the same functions once, in one six-minute execution that
    // shares one cache, and write values. See SimFill.gs.
    .addItem('Fill all sims (values, no formulas)', 'fillAllSims')   // SimFill.gs
    .addItem('Restore sim formulas', 'restoreSimFormulas')           // SimFill.gs
    .addSeparator()
    .addItem('Simulate card pack openings', 'SimulatePackOpenings')   // CardOpenings.gs
    .addItem('Simulate card cloud (all segments)', 'SimulateCardCloud')   // CardOpenings.gs
    // D50: not a custom function. cardSeasonPre_ over the ten cells costs more than a custom
    // function's 30-second budget on its own, so this is a menu run with six minutes.
    .addItem('Album completion across the population', 'SimulateAlbumCompletion')   // CardOpenings.gs
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
var REFRESH_WATCH = ['c_saga','c_saga_v2','c_day','c_day_v2','RM','RM_1st','RM_2nd','RM_1st_v2','RM_2nd_v2','NS','NS_weekday','NS_v2','NS_v2_weekday','Race','Race_v2','Mic','Mic_v2',
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
  'ToF','MD','item_vals',
  // D88: every other sheet a sim reads - so the change summary / album summary STALE mark sees an edit to them
  'Ki_2d_v2','Ki_2d_v2_weekend','Ki_Tr','Ki_Tr_v2','ToF_v2','PackConfig','PackConfig_v2','AlbumConfig','AlbumConfig_v2',
  'export_scale','data_econ_daily_by_source','data_rm_pace','data_col_daily','data_col_envelopes','data_col_season',
  'data_col_beh',    // D97: the album players' own behaviour rows (the card sim's attendance)
  'kite_joiners',    // D100: Kite opt-in and join days
  'data_mic'];       // D105: the live Mighty Ice Cream results

// Simple trigger: fires on every USER edit (programmatic edits don't re-trigger it).
function onEdit(e){
  try {
    var name = e && e.range ? e.range.getSheet().getName() : null;
    if (name && REFRESH_WATCH.indexOf(name) === -1) return;
    // D88: the change summary holds values - mark it STALE whatever AUTO_REFRESH says
    if (name && typeof csMarkStale_ === 'function') csMarkStale_(name);
    if (typeof albumMarkStale_ === 'function' && name) albumMarkStale_(name);
    if (!AUTO_REFRESH) return;
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
// 'ToF' / 'MD' added 2026-09-03 (D35). The nonce BUMP re-runs any formula that references the
// nonce cell, so a ToF spill written by the builder was refreshing fine - but this list is what the
// MIGRATION and the MANIFEST HEAL walk, and the ToF sheet was on neither. A ToF formula typed by
// hand (or written before the nonce convention) therefore never had the nonce appended, which means
// it never re-ran again: Google only re-runs a custom function when its ARGUMENTS change. The block
// then sits on whatever it computed the first time while every other sheet moves, which reads as
// "Tickets earned does not update with EcoGains" - the two models agree exactly when both are live
// (checked segment by segment: 15.273 / 23.723 / 26.661 / 19.054 against the grid's ToF_Ticket sum).
// Listing it also means a deliberately deleted ToF anchor comes back on the next refresh, same as
// every other sim anchor.
var REFRESH_SHEETS = [SHEET, 'EcoGainsSim_Daily', 'EcoGainsSim_HC_7d', 'cal_new', 'ToF', 'MD',
                      'Kite_Explainer'];   // D101: ECOGAINS_KITE (KiteExplain.gs)
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
    var ev = calNorm_(v[i][h['event']]);          // D102: a cal_parsed written before an alias existed
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
    // D94: the block the segment's config labels name ('100-249' reads a '100+' block, '250+' its own
    // or its parent's - segCfgKeys_)
    var lbls = reqCols.map(function(rc){
      return String(above[rc] == null ? '' : above[rc]).trim() || String(above[rc - 1] == null ? '' : above[rc - 1]).trim();
    });
    var pk = segCfgPick_(lbls, seg);
    if (pk >= 0) pick = reqCols[pk];
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
  // D94: the block the segment's config labels name (segCfgKeys_: own spelling, alias, parent)
  var r = segCfgPick_(v.map(function(row){ return (row || [])[0]; }), seg);
  return (r >= 0) ? readLadder_(v.slice(r + 1), 'Cum Streak Req') : [];
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
  var v = sh ? sh.getDataRange().getValues() : [];
  // D79: a data_* pull carrying both A/B arms is read for the anchor arm only (armRows_)
  if (/^data_/i.test(String(name))) v = armRows_(v, name);
  return (_sheetValsCache[name] = v);
}
