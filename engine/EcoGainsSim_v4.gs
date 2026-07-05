/************************************************************************************************
 * EcoGainsSim_v4.gs — per-source simulation engine for EcoGainsSim_HC (SIMULATION_PLAN v3)
 * ---------------------------------------------------------------------------------------------
 * Brand-new engine based on EcoGainsSim.gs. One named function per source (D15); everything
 * numeric is read LIVE from the workbook (D12): config sheets, both calendars, data_* sheets.
 *
 * CUSTOM FUNCTIONS (per segment block, spills 25x11):
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_SIM(payer, segment))     // C<firstDataRow>
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_DIFF(payer, segment))    // O<firstDataRow>
 *   segment = '0-9' | '10-19' | '20-39' | '40-99' | '100+' | 'A. 0' (appendix, carried+annotated)
 *
 * MODEL PER SOURCE (see SIMULATION_PLAN.md §2 for specs and worked numbers):
 *   carried        Ads, Core, Other, Season Pass (Free), Team Event, Team Race, FlowerCoop,
 *                  IAPs, Flock Flurry                                → measured
 *   Saga           measured x per-resource ratio: HC from the per-segment HC columns; every
 *                  item (boosters/ULs) from the per-node item ladders on both sheets (v2 item
 *                  edits — e.g. zeroing ULs — now move the sim). Base-0 items carried.  [D9]
 *   Daily Gift     measured, HC x streak-weighted ladder ratio (c_day pair)
 *   leaderboard    Bomb/Chuck/Red Challenge, Level Race, Flash Race, Target Day (D3):
 *                  measured x T  (D pinned 1 — rank payouts are end-state)
 *   collection     HH, Bomb's Ballet, Jigsaw, Photoshoot: measured x D x T
 *   score event    Kite Festival: measured x D x T with the kite score curve
 *   Night Sky      CARRIED for now (= measured from data_gains, diff 0). The bottom-up rollout
 *                  sim (simNightSky, D13) exists below but is UNWIRED from SOURCES — its output
 *                  was judged wrong; rework pending. Re-enable via the SOURCES registry.
 *   Rainbow Maker  bottom-up survival-weighted (D6/D7): per cal_new instance,
 *                  Σ_k S_dur(ReqAccum_k) x reward_k x reach(inst); data_RM percentiles
 *   River Rush     calendar-driven branches (D4): no cal_new instances today → 0
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
 * With AUTO_REFRESH = true, the onEdit trigger below watches every input sheet and re-touches
 * the ECOGAINS_* formulas after each edit, forcing a fresh recalculation (all reads are live,
 * so the new values flow through). Set to false to disable; then refresh manually via the
 * EcoGainsSim ▸ Refresh simulations menu item. Note: calendar MERGE changes don't fire onEdit —
 * run Precompute calendars after editing merges (it refreshes the sims itself).
 ************************************************************************************************/

// TRUE: config/data/calendar edits automatically regenerate the simulated gains.
// FALSE: recalculation only via the menu (EcoGainsSim ▸ Refresh simulations) or argument edits.
var AUTO_REFRESH = true;

// ============================== LAYOUT & REGISTRY ============================================
var SHEET = 'EcoGainsSim_HC';
var PAYER_CELL = 'C3';
var SEG_CELL   = 'C4';   // fallback only
var CAL_CUR = 'cal_curr', CAL_NEW = 'cal_new';

var RESOURCES = ['HC','Slingshot','Shuffle','Comet','Red','Chuck','Bomb',
                 'UL Bomb','UL Chuck','UL Red','Unlimited Lives'];

// Sheet row order (must match EcoGainsSim_HC blocks; 25 rows, Saga between River Rush and SP).
var CATEGORY_ORDER = [
  'Ads','Bomb Challenge',"Bomb's Ballet",'Chuck Challenge','Core','Daily Gift','Daily Night Sky Prize',
  'Flock Flurry','Hatchling Hideaway','Jigsaw','Kite Festival','Level Race','Other','Photoshoot',
  'Red Challenge','River Rush','Saga','Season Pass (Free)','Target Day','Team Event','Team Race',
  'Flash Race','FlowerCoop','Rainbow Maker','IAPs'
];

// display segment -> data_gains label (D8: '0-9' anchors to B. 1-9; A. 0 = appendix, own label)
var SEG_TO_GAINS = {'0-9':'B. 1-9','10-19':'C. 10-19','20-39':'D. 20-39','40-99':'E. 40-99',
                    '100+':'F. 100+','A. 0':'A. 0'};

// category -> its own named simulator (D15). Unlisted => carried (= measured).
var SOURCES = {
  'Core'                  : simCore,
  'Saga'                  : simSaga,
  'Daily Gift'            : simDailyGift,
  // 'Daily Night Sky Prize' : simNightSky,   // DISABLED: bottom-up rollout sim is wrong today —
  //   NS is CARRIED (= data_gains measured, diff 0) until the model is reworked. Re-enable by
  //   uncommenting this line.
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
  'River Rush'            : simRiverRush
};

// config/ladder column header -> engine resource name (shared by RM + NS readers)
var RES_MAP = {'Coins':'HC','HC Reward':'HC','Red':'Red','Chuck':'Chuck','Bomb':'Bomb',
               'Slingshot':'Slingshot','Shuffle':'Shuffle','Comet':'Comet',
               'Unlimited Lives':'Unlimited Lives','Unlimited Red':'UL Red',
               'Unlimited Chuck':'UL Chuck','Unlimited Bomb':'UL Bomb'};

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
  'Flock Flurry':'Flock Flurry'   // carried in the sim, but scheduled — stats show its cadence
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
 *   AB8: =ECOGAINS_CAL_STATS("cal_curr")   -> fills AB (instances) + AC (event-days)
 *   AE8: =ECOGAINS_CAL_STATS("cal_new")    -> fills AE + AF
 * Event-days count REAL days (clipped instances count what actually fits in the window).
 * Non-calendar categories (Core, Saga, Daily Gift, Ads, Teams, ...) return blanks.
 * Auto-updates like the gains: refreshSims_ re-touches every ECOGAINS_* formula, and calendar
 * merge edits are picked up via the Precompute calendars menu.
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
  if (!fn) return measuredRow_(cat, seg, payer, ctx.ds);                       // carried
  return fn(seg, payer, ctx, cat) || measuredRow_(cat, seg, payer, ctx.ds);
}

// measured anchor. Core and Saga are separate rows (data_gains emits both) — no folding.
function measuredRow_(cat, seg, payer, ds){ return ds.dataRow(cat, seg, payer); }

// ============================== A. 0 APPENDIX (§3 — carried & annotated, not simulated) ======
// A.0 players have no behaviour/accrual/matchables data. Config-only changes are applied
// (Saga ratio; Daily Gift ratio with 0-9 weights as PROXY — flagged); RR removal is universal;
// everything else (incl. Night Sky and Rainbow Maker) carries its measured value.
function appendixRow_(cat, payer, ctx){
  var ds = ctx.ds, meas = measuredRow_(cat, 'A. 0', payer, ds);
  if (cat === 'River Rush') return zeroRow_();
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
// Core — carried: chapter_complete / PlayerLevelUpChest rewards did not change.
function simCore(seg, payer, ctx){ return measuredRow_('Core', seg, payer, ctx.ds); }

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
  var baseAvg = sagaCycleAvg_(readSagaBase_()), v2Avg = sagaCycleAvg_(readSagaV2_(seg));
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

// ============================== LEADERBOARD SOURCES (measured x T; D pinned 1) ===============
// Rank payouts are end-state — extra duration barely changes what a given rank pays, so D = 1
// and the calendars carry all movement (cadence x reach).
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

// ============================== COLLECTION / SCORE SOURCES (measured x D x T) ================
function simHatchlingHideaway(seg, payer, ctx){ return collectionSim_('Hatchling Hideaway', 'Hatchling Hideaway',  'Hatchling Hideaway', seg, payer, ctx, false); }
function simBombsBallet      (seg, payer, ctx){ return collectionSim_("Bomb's Ballet",      "Bomb's Ballet Show",  'Bombs Ballet',       seg, payer, ctx, false); }
function simJigsaw           (seg, payer, ctx){ return collectionSim_('Jigsaw',             'Jigsaw Puzzle',       'Jigsaw',             seg, payer, ctx, false); }
function simPhotoshoot       (seg, payer, ctx){ return collectionSim_('Photoshoot',         'Photoshoot',          'Photoshoot',         seg, payer, ctx, false); }
// Kite — score event; D from the score-LAG curve is strongly segment-dependent (0.32 → 0.70).
function simKiteFestival     (seg, payer, ctx){ return collectionSim_('Kite Festival',      'Kite Festival',       'Kite Festival',      seg, payer, ctx, true ); }

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
//   both sides                               -> measured x D x T
function timedCore_(cat, calLabel, seg, payer, ctx, dFn){
  var meas = measuredRow_(cat, seg, payer, ctx.ds);
  if (!ctx.calCurOk || !ctx.calNewOk) return meas;
  var cur = ctx.calCur[calLabel] || [], nw = ctx.calNew[calLabel] || [];
  if (!nw.length) return zeroRow_();
  if (!cur.length) return meas;
  var T = timingRatio_(cur, nw, seg, payer, ctx.ds);
  var D = dFn(modalDur_(cur), modalDur_(nw));
  var out = {};
  RESOURCES.forEach(function(r){ out[r] = num(meas[r]) * D * T; });   // R = 1 (ladders unchanged)
  return out;
}

// ============================== NIGHT SKY (D13 — bottom-up; A/B test) ========================
// Config-segmented (D14): each segment has its OWN 3-milestone daily ladder in 'NS'.
// Daily-reset: E_day[res] = Σ_k S(CumStreakReq_k) x reward_k[res], S = survival over the
// daily_max_streak percentiles; window total = E_day x Σ p_day over the calendar's 1-day
// instances. Measured 'Daily Night Sky Prize' is A/B-diluted → CURRENT column only, never an
// anchor; DIFF = full-rollout value - diluted measured (labeled in-sheet).
function simNightSky(seg, payer, ctx){
  var ds = ctx.ds, meas = measuredRow_('Daily Night Sky Prize', seg, payer, ds);
  if (!ctx.calNewOk) return meas;
  var ladder = readNSLadder_(seg);
  var b = ds.beh(seg, payer);
  var S = survival_([[num(b.daily_max_streak_p50),.5],[num(b.daily_max_streak_p75),.75],[num(b.daily_max_streak_p90),.9]]);
  if (!ladder.length || !S) return meas;                 // no ladder / no streak data -> carry
  var eDay = zeroRow_();
  ladder.forEach(function(ms){
    var s = S(ms.req);
    for (var res in ms.rew) eDay[res] = num(eDay[res]) + ms.rew[res] * s;
  });
  var days = reachSum_(ctx.calNew['Night Sky'] || [],     // 33x1d -> Σ p_day = expected active days
                       num(b.weekday_active_rate), num(b.weekend_active_rate));
  var out = {};
  RESOURCES.forEach(function(r){ out[r] = num(eDay[r]) * days; });
  return out;
}

// ============================== RAINBOW MAKER (D6/D7 — bottom-up, survival-weighted) =========
// Per cal_new instance: E[res] = Σ_k S_dur(ReqAccum_k) x reward_k[res], where S_dur uses the
// data_RM matchables percentiles scaled by (instanceDur / configured EventDuration) — the
// clipped 2-day instance halves the matchables axis (flagged linear-scaling assumption).
// RM[res] = Σ instances E[res] x reach(inst). Measured rows are soft-launch traces (kept in diff).
function simRainbowMaker(seg, payer, ctx){
  var ds = ctx.ds, meas = measuredRow_('Rainbow Maker', seg, payer, ds);
  if (!ctx.calNewOk) return meas;
  var insts = ctx.calNew['Rainbow Maker'] || [];
  if (!insts.length) return zeroRow_();
  var ladder = readRMLadder_(), pct = ds.rmPct(seg, payer), cfgDur = readRMDuration_() || 4;
  if (!ladder.length || !pct) return meas;               // no ladder / no matchables -> carry
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  var out = zeroRow_();
  insts.forEach(function(inst){
    var scale = Math.min(1, inst.dur / cfgDur);
    var S = survival_([[pct.p10*scale,.10],[pct.p25*scale,.25],[pct.p50*scale,.50],
                       [pct.p75*scale,.75],[pct.p90*scale,.90]]);
    if (!S) return;
    var reach = reachOne_(inst, pWd, pWe);
    ladder.forEach(function(ms){
      var s = S(ms.req);
      for (var res in ms.rew) out[res] = num(out[res]) + ms.rew[res] * s * reach;
    });
  });
  return out;
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
  function build(gainsVals, behVals, accVals, kiteVals, rmVals){
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
    return {
      gains: function(seg, payer, cat, res){ return num(gMap[[SEG_TO_GAINS[seg]||seg, payer, cat, res].join('|')]); },
      dataRow: function(cat, seg, payer){ var o = {}, self = this;
        RESOURCES.forEach(function(r){ o[r] = self.gains(seg, payer, cat, r); }); return o; },
      beh: function(seg, payer){ return bMap[[seg, payer].join('|')] || {}; },
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
                     vals_(ss,'data_event_kite_accrual'), vals_(ss,'data_RM'));
      return _cache;
    },
    fromRanges: function(g,b,a,k,rm){ return build(g,b,a,k,rm); }
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
    .addToUi();
}

// ---- auto-refresh (AUTO_REFRESH switch) ----
// Every sheet the engine reads; a user edit on any of them re-touches the sim formulas.
var REFRESH_WATCH = ['c_saga','c_saga_v2','c_day','c_day_v2','RM','NS','NS_v2','Race','Race_v2',
  'J','J_v2','HH','HH_v2','BB','BB_v2','Ki','Ki_v2','Ph','Ph_v2','TaD','TaD_v2','RR','RR_v2',
  'F','F_v2','cal_curr','cal_new',CAL_PARSED_SHEET,
  'data_gains','data_seg_beh','data_event_accrual','data_event_kite_accrual','data_RM'];

// Simple trigger: fires on every USER edit (programmatic edits don't re-trigger it).
function onEdit(e){
  if (!AUTO_REFRESH) return;
  try {
    var name = e && e.range ? e.range.getSheet().getName() : null;
    if (name && REFRESH_WATCH.indexOf(name) === -1) return;
    refreshSims_();
  } catch(err){}
}

// Forces regeneration: clears and re-sets every ECOGAINS_* formula on the display sheets, which
// makes Sheets re-evaluate them (all engine reads are live, so fresh config/data flows through).
var REFRESH_SHEETS = [SHEET, 'EcoGainsSim_Daily'];
function refreshSims_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  REFRESH_SHEETS.forEach(function(name){
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var rng = sh.getDataRange(), formulas = rng.getFormulas(), targets = [];
    for (var r = 0; r < formulas.length; r++)
      for (var c = 0; c < formulas[r].length; c++)
        if (formulas[r][c] && formulas[r][c].indexOf('ECOGAINS_') !== -1)
          targets.push({ row: r + 1, col: c + 1, f: formulas[r][c] });
    if (!targets.length) return;
    targets.forEach(function(t){ sh.getRange(t.row, t.col).setFormula(''); });
    SpreadsheetApp.flush();
    targets.forEach(function(t){ sh.getRange(t.row, t.col).setFormula(t.f); });
  });
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
// c_saga: header r3, nodes r4+ (Node | Levels Req | HC Reward).
function readSagaBase_(){
  var v = sheetVals_('c_saga'), out = [];
  for (var r = 3; r < v.length; r++){ if (v[r][0] == null || v[r][0] === '') break;
    out.push([num(v[r][1]), num(v[r][2])]); }
  return out;
}
// c_saga_v2 (config-segmented, D14): 5 per-segment (Levels Req | HC Reward) column pairs.
function readSagaV2_(seg){
  var v = sheetVals_('c_saga_v2');
  var col = {'0-9':1, '10-19':3, '20-39':5, '40-99':7, '100+':9}[seg];
  if (col == null) return null;
  var out = [];
  for (var r = 4; r < v.length; r++){ if (v[r][0] == null || v[r][0] === '') break;
    out.push([num(v[r][col]), num(v[r][col+1])]); }
  return out;
}
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
// RM sheet: EventDuration in the config panel; ladder under the 'Milestone' header row.
function readRMDuration_(){
  var v = sheetVals_('RM');
  for (var r = 0; r < Math.min(v.length, 12); r++)
    if (String(v[r][0]) === 'EventDuration') return num(v[r][1]);
  return 0;
}
function readRMLadder_(){ return readLadder_(sheetVals_('RM'), 'Req Accum'); }

// NS sheet (config-segmented, D14): per-segment blocks — a cell in col A holding the segment
// label, then a header row ('Round' ...), then milestone rows. Gate = 'Cum Streak Req'.
function readNSLadder_(seg){
  var v = sheetVals_('NS');
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
function sheetVals_(name){
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : [];
}
