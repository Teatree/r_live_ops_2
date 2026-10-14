/************************************************************************************************
 * EcoGainsSim_Daily.gs — per-day view of the 33-day simulation (EcoGainsSim_Daily sheet).
 * ---------------------------------------------------------------------------------------------
 * REQUIRES EcoGainsSim_v4.gs in the same project (uses Context, CATEGORY_ORDER, RESOURCES,
 * resultRow_, measuredRow_, reachOne_, isWeekend_, num).
 *
 * CUSTOM FUNCTION (six anchors on the sheet; the three GAIN blocks spill 33 days x 19 resources,
 * the three NET blocks stay 33 x 13 — packs have no spend model, D19/8):
 *   =LET(payer,$C$3, segment,$C$4, source,$C$5, ECOGAINS_DAILY(payer, segment, source, "CURRENT"))
 *   =LET(payer,$C$3, segment,$C$4, source,$C$5, ECOGAINS_DAILY(payer, segment, source, "NEW"))
 *   =LET(payer,$C$3, segment,$C$4, source,$C$5, ECOGAINS_DAILY(payer, segment, source, "DIFF"))
 *   =LET(...same..., ECOGAINS_DAILY(payer, segment, source, "SPEND"))    // NET blocks, see below
 *   =LET(...same..., ECOGAINS_DAILY(payer, segment, source, "CURNET"))
 *   =LET(...same..., ECOGAINS_DAILY(payer, segment, source, "NEWNET"))
 *   source = 'ALL' or one CATEGORY_ORDER name.
 *
 * NET BLOCKS (per EARNER, actual daily data): read the 'data_econ_daily' sheet
 * (segment | payer_flag | currency | day_index -> gain_per_earner_day / spend_per_earner_day,
 * window-earner denominator so days sum to the data_econ window totals):
 *   SPEND(day)  = actual spend that day
 *   CURNET(day) = actual gain(day) - actual spend(day)
 *   NEWNET(day) = actual gain(day) + [sim NEW(day) - sim CURRENT(day), all categories] - spend(day)
 *                 (spend held constant; the sim's day-shift is ADDED onto the actual gains, so the
 *                 33 days still sum to the window totals and net delta == the DIFF block)
 * NET blocks spill a 33x13 grid of '' (blank) when: source != ALL (spend is game-wide and cannot
 * be attributed to one source), data_econ_daily is missing / lacks the expected headers, or has no
 * rows for this (segment, payer). The '' cells are deliberate: the sheet's net-delta formulas
 * subtract these cells, and '' makes them error into their IFERROR blank instead of coercing to 0.
 *
 * ALLOCATION MODEL ("claim-day realistic") — window totals are the same numbers the main sim
 * produces (CURRENT = measured, anchored on cal_curr; NEW = simulated, anchored on cal_new);
 * this script only distributes them over the 33 calendar days, conserving totals exactly:
 *   flat        Ads, Other, FlowerCoop, IAPs, and any source with a nonzero total but no calendar
 *               instances (River Rush's CURRENT side runs off-grid) -> total / 33 every day.
 *               (Team Event / Team Race / Flock Flurry LEFT this family 2026-08-03, D19 — they
 *               pay packs now, so they are placed on their calendar lanes; see DAILY_LASTDAY.)
 *   Season Pass (Free) — since 2026-07-10 (D16): spread over its 'Season Pass' lane instances
 *               proportional to p_day (tier rewards are claimed continuously while playing —
 *               same treatment as Rainbow Maker; the lane covers all 33 days today).
 *   always-on   Core, Saga, Daily Gift -> spread over all 33 days proportional to p_day (the
 *               weekday/weekend active rate). Night Sky -> over its 33x1d instances, prop p_day.
 *   last-day    Bomb/Chuck/Red Challenge, Level Race, Flash Race, Target Day, Kite Festival —
 *               rank rewards are granted at instance END: the instance's slice lands on its
 *               final day. Instance slices split the source total proportional to reach(inst).
 *   marginal    Hatchling Hideaway, Bomb's Ballet, Jigsaw, Photoshoot — spread across instance
 *               days by the accrual curve's marginal share (share(d) - share(d-1)).
 *   RM          Rainbow Maker — no accrual curve: spread within each instance prop p_day
 *               (flagged assumption; milestones auto-claim while playing). NEW side uses the
 *               engine's PER-INSTANCE rows (RM_1st x3 / RM_2nd x2 split, 2026-07-10): each
 *               instance's own per-resource contribution lands on its days, so SPTx2 shows
 *               only on the RM_2nd instances (days 20-23 / 27-30 in the current cal_new).
 * DIFF = NEW(day) - CURRENT(day). Column totals therefore reconcile with ECOGAINS_SIM/_DIFF.
 ************************************************************************************************/

// Build stamp. Read back by ECOGAINS_BUILD() so "is the pasted code current?"
// is answerable from the sheet instead of from memory.
var DAILY_BUILD   = 'EcoGainsSim_Daily.gs D60  2026-10-14';


var DAILY_DAYS = 33;
var DAILY_ECON_SHEET = 'data_econ_daily';                 // actual per-day gain/spend (per earner)
var DAILY_NET_BLOCKS = { 'SPEND':1, 'CURNET':1, 'NEWNET':1 };
// D60 (2026-10-14): the measured side as its own blocks. DATA = data_econ_daily gains per earner
// per day; DATADIFF = DATA - NEW (data minus sim, positive = data above the sim). Both are
// game-wide (Source = ALL only) until a per-source daily feed exists.
var DAILY_DATA_BLOCKS = { 'DATA':1, 'DATADIFF':1 };

// how each source's window total is placed on days (anything not listed = flat)
var DAILY_ALWAYS  = { 'Core':1, 'Saga':1, 'Daily Gift':1 };
// Team Event / Team Race / Flock Flurry joined the last-day family 2026-08-03 (D19): they now pay
// packs, which are rank rewards granted at instance END, so they can no longer sit in the flat
// family. Their non-pack (carried) resources move with them — window totals are unchanged, only
// the per-day distribution: flat-over-33 -> placed on their actual calendar instances.
var DAILY_LASTDAY = { 'Bomb Challenge':1, 'Chuck Challenge':1, 'Red Challenge':1, 'Level Race':1,
                      'Flash Race':1, 'Target Day':1, 'Kite Festival':1,
                      'Team Event':1, 'Team Race':1, 'Flock Flurry':1 };
var DAILY_MARGINAL = { 'Hatchling Hideaway':'Hatchling Hideaway', "Bomb's Ballet":'Bombs Ballet',
                       'Jigsaw':'Jigsaw', 'Photoshoot':'Photoshoot' };
var DAILY_PDAY_INST = { 'Rainbow Maker':1, 'Daily Night Sky Prize':1 };

// ============================== DAY PLACEMENT MODEL (D60, 2026-10-14) =========================
// MEASURED BEFORE IT WAS BUILT. harness/_probe_daily_alloc.js and _probe_daily_alloc_toggles.js
// scored every candidate rule against the real 33-day data_econ_daily, one at a time
// (analysis/out/daily_alloc_toggles.json, TV = share of a resource's mass sitting on the wrong
// day). The pre-D60 allocation misplaced 19.6% (HC 13.9%); the rules below take the measured
// combination to 12.1% (HC 9.6%, against an HC noise floor of 6.7%), 116 of 130 cell x resource
// series improving, every window total conserved to the bit. Two ideas that LOOKED right were
// measured and dropped: a geometric attendance "collect" kernel (the data shows NO +2/+3 tail
// after a close; a symmetric box scored the same, so it was de-lumping a population average, not
// modelling collection) and Season Pass on tier-crossing days (+32% WORSE on both dumps - a
// mean-player crossing model is a 7-tooth comb against a smooth population average).
// See DAILY_REWIRE_PLAN.md.
//
//   'settle'  (1) RANK-FAMILY LUMPS LAND THE DATE AFTER THE GRID CELL. A 1-day calendar cell is a
//                 2-date event (user-confirmed 2026-10-14; data_event_accrual carries
//                 instance_length_days = 2 for every leaderboard the grid draws as one cell), so
//                 the board closes and pays on the NEXT date. Team Race shows it in all ten cells:
//                 Sunday closes 5/12/19/26 read 0.83-0.94x of the mean on the close day and
//                 1.15-1.23x the Monday after. Authored per category on the optional 'sim_settle'
//                 sheet (DAILY_SETTLE_SHEET); default DAILY_SETTLE_DEFAULT for every DAILY_LASTDAY
//                 family, 0 for everything else.
//             (2) AN AUTHORED LAG VECTOR de-lumps a settled payout over +0 / +1 / +2 days. It is
//                 the IDENTITY until the grant-vs-balance lag data exists to fit it (change #4 of
//                 the approved plan): the totals cannot identify its width, so nothing is guessed.
//             (3) CONTINUOUS-TRACK LANES (DAILY_TRACK: both Season Pass rows) spread prop
//                 SUM p_day over the lane's days instead of splitting by reach. cal_curr draws the
//                 pass as [1..30]+[31..33]; splitting by reach handed the 3-day stub ~39% of the
//                 window, so days 31-33 carried 4.7-7.3x the per-day HC of days 1-30.
//             (4) THE MARGINAL FAMILY READS cum_token_share_MEAN, not p50 - the median player's
//                 progress (1.0 on day 1 of every 2-day event) is not the cohort's share of
//                 tokens (0.81-0.96). accrualD_ keeps p50: that is the D multiplier's own
//                 validated choice and this does not move it.
//   'legacy'  bit-identical to the pre-D60 engine, random stream and all (gated).
//
// EARN DAY vs BALANCE DAY. data_econ_daily records the day a reward reached the BALANCE, so the
// daily view places on balance day. The 7-day A/B window is compared on the day a reward is
// EARNED (user decision 2026-10-14), so EcoGainsSim_7Day.gs asks for opts.earnDay and the settle
// and lag stages are skipped there. Days 1..33 sum to the same window total either way.
var DAILY_ALLOC_MODEL    = 'settle';
var DAILY_SETTLE_SHEET   = 'sim_settle';     // optional: source | settle_days | lag_0 | lag_1 | lag_2
var DAILY_SETTLE_DEFAULT = 1;                // days after the grid cell, every DAILY_LASTDAY family
var DAILY_TRACK = { 'Season Pass (Free)':1, 'Season Pass (Paid)':1 };

// category -> calendar row label (same wiring as the per-source sims in EcoGainsSim_v4.gs)
var DAILY_CAL_LABEL = {
  'Bomb Challenge':"Bomb's Challenge", 'Chuck Challenge':"Chuck's Challenge",
  'Red Challenge':"Red's Challenge", 'Level Race':'Level Race', 'Flash Race':'Flash Race',
  'Target Day':'Target Day', 'Kite Festival':'Kite Festival',
  'Hatchling Hideaway':'Hatchling Hideaway', "Bomb's Ballet":"Bomb's Ballet Show",
  'Jigsaw':'Jigsaw Puzzle', 'Photoshoot':'Photoshoot', 'Rainbow Maker':'Rainbow Maker',
  'River Rush':'River Rush', 'Daily Night Sky Prize':'Night Sky',
  // BOTH season-pass rows sit on the SAME lane. '(Paid)' was split out of '(Free)' on 2026-08-21
  // and added to CATEGORY_ORDER / SOURCES in the v4 engine, but not here - so it fell through to
  // dayWeights_'s no-instances branch and its whole window total was spread FLAT over all 33 days.
  // At 20-39 PAYER that painted 125 HC of diff as 3.79 on every single day, including days the
  // pass lane does not even cover (it runs 30d@1), which reads as "the redesign changed a day
  // where nothing happened". A missing map entry is silent: nothing errors, the window total is
  // still right, only the placement is wrong.
  'Season Pass (Free)':'Season Pass', 'Season Pass (Paid)':'Season Pass',
  'Team Event':'Team Event', 'Team Race':'Team Race', 'Flock Flurry':'Flock Flurry',   // D19
  'ToF':'ToF'                       // always-on: one merged 33-day instance on cal_new row 22
};

/** @customfunction */
function ECOGAINS_DAILY(payer, segment, source, block){
  var p = String(payer   || 'NONPAYER').trim();
  var s = String(segment || '0-9').trim();
  var src = String(source || 'ALL').trim();
  var blk = String(block  || 'NEW').trim().toUpperCase();
  if (blk !== 'CURRENT' && blk !== 'NEW' && blk !== 'DIFF' && !DAILY_NET_BLOCKS[blk] && !DAILY_DATA_BLOCKS[blk])
    return [['Unknown block: ' + blk + " (use CURRENT / NEW / DIFF / DATA / DATADIFF / SPEND / CURNET / NEWNET)"]];
  if (src.toUpperCase() !== 'ALL' && CATEGORY_ORDER.indexOf(src) === -1)
    return [['Unknown source: ' + src]];

  if (DAILY_NET_BLOCKS[blk] || DAILY_DATA_BLOCKS[blk]){
    if (src.toUpperCase() !== 'ALL') return blankGrid_();  // the measured side is game-wide: ALL only
    var econ = econDaily_(s, p);
    if (!econ) return blankGrid_();                        // no data_econ_daily (yet) -> blank
    // INCOMPLETE PULLS BY DESIGN (D60): every data-anchored block is BLANK past the last day
    // the pull carries. A day with no row is 'not pulled yet', never 0 - a 0 there would read
    // as a collapse on DATA and as the whole simulated value on DATADIFF.
    if (blk === 'DATA')   return clipGrid_(netGrid_(econ.gain), econ.lastDay);
    if (blk === 'SPEND')  return clipGrid_(netGrid_(econ.spend), econ.lastDay);
    if (blk === 'CURNET') return clipGrid_(netGrid_(diffSeries_(econ.gain, econ.spend)), econ.lastDay);
    // NEWNET = actual net + the sim's per-day gain shift (NEW - CURRENT over all categories)
    var ctxN = Context.get(), curN = emptyDays_(), nwN = emptyDays_();
    CATEGORY_ORDER.forEach(function(cat){
      addSeries_(curN, dailySeries_(cat, s, p, ctxN, false));
      addSeries_(nwN,  dailySeries_(cat, s, p, ctxN, true ));
    });
    if (blk === 'DATADIFF') return clipGrid_(netGrid_(diffSeries_(econ.gain, nwN)), econ.lastDay);
    var net = diffSeries_(econ.gain, econ.spend);
    addSeries_(net, diffSeries_(nwN, curN));
    return clipGrid_(netGrid_(net), econ.lastDay);
  }

  var cats = (src.toUpperCase() === 'ALL') ? CATEGORY_ORDER : [src];

  var ctx = Context.get();
  var cur = emptyDays_(), nw = emptyDays_();
  cats.forEach(function(cat){
    addSeries_(cur, dailySeries_(cat, s, p, ctx, false));   // CURRENT: measured over cal_curr
    addSeries_(nw,  dailySeries_(cat, s, p, ctx, true ));   // NEW: simulated over cal_new
  });
  return daysToGrid_(blk === 'CURRENT' ? cur : blk === 'NEW' ? nw : diffSeries_(nw, cur));
}

// 33-day series for one source on one side. isNew: true -> simulated totals + cal_new.
// opts.earnDay (D60): place on the EARN day - skip settle and lag. The 7-day view asks for it.
function dailySeries_(cat, seg, payer, ctx, isNew, opts){
  var ds = ctx.ds;
  var W = isNew ? resultRow_(cat, seg, payer, ctx) : measuredRow_(cat, seg, payer, ds);
  var days = emptyDays_();
  if (!hasAmount_(W)) return days;
  // Rainbow Maker NEW side: split configs (RM_1st x3 / RM_2nd x2, hardcoded 2026-07-10) make
  // the instances pay DIFFERENT per-resource rows — place each instance's OWN contribution
  // (from the engine's per-instance breakdown) on its days prop p_day, so RM_2nd-only
  // resources (SPTx2) never land on RM_1st instance days. Sums stay exactly the 33-day RM row.
  // parts == null (carried: no matchables/ladder) falls through to the generic placement.
  //
  // BOTH SIDES since D60b (2026-10-14). The CURRENT side used to fall through to the generic
  // placement (reach split, p_day inside each instance) while NEW placed per instance, so on two
  // IDENTICAL calendars with identical ladders the two sides put RM's HC on different days - up to
  // 10 HC/day apart at 0-9 NONPAYER with equal window totals - and the daily DIFF showed a change
  // where nothing had changed. The measured side IS the same per-instance walk over cal_curr on the
  // BASE ladder (rmSynth_, D29), so its parts place the CURRENT side exactly as the NEW parts place
  // the NEW side. They are used only when they reproduce the row W (i.e. the synthetic anchor is the
  // measured side); when data_gains rows win (RM_REAL_DATA_WINS) or cal_curr has no RM, the generic
  // placement stays, because then the parts are not what the row is made of.
  if (cat === 'Rainbow Maker'){
    var parts = isNew ? rmInstanceRows_(seg, payer, ctx)
                      : (ctx.calCurOk ? rmInstanceRows_(seg, payer, ctx, { cal: ctx.calCur, useBase: true }) : null);
    if (parts && parts.length && !isNew){
      var tot = {}, same = true;
      parts.forEach(function(p){ RESOURCES.forEach(function(r){ tot[r] = num(tot[r]) + num(p.row[r]); }); });
      RESOURCES.forEach(function(r){ if (Math.abs(num(tot[r]) - num(W[r])) > 1e-9) same = false; });
      if (!same) parts = null;
    }
    if (parts && parts.length){
      var bb = ds.beh(seg, payer);
      var qWd = num(bb.weekday_active_rate), qWe = num(bb.weekend_active_rate);
      if (!(qWd > 0) && !(qWe > 0)){ qWd = 1; qWe = 1; }
      parts.forEach(function(p){
        var dl = (p.inst && p.inst.days) || [];
        if (!dl.length) return;
        var wts = dl.map(function(day){ return isWeekend_(day) ? qWe : qWd; });
        var sum = 0; wts.forEach(function(x){ sum += x; });
        // D26: this branch places days itself, so it has to honour the envelope cutoff on its own —
        // RM instance #5 straddles it in the current cal_new. Packs from an instance wholly outside
        // the season are skipped (packLane_ already dropped them from the window total, so keeping
        // them here would break conservation); packs from a straddler are kept IN FULL and settle
        // on the season's last day. Every non-pack resource keeps its natural day.
        // D26 on BOTH sides (D60b): the envelope season is a property of the game, not of a calendar,
        // so a cal_curr that runs the same season folds its packs onto SEASON_LAST_DAY the same way.
        var packOut = !instInSeason_(p.inst);
        dl.forEach(function(day, j){
          if (day < 1 || day > DAILY_DAYS) return;
          var w = sum > 0 ? wts[j] / sum : 1 / dl.length;
          RESOURCES.forEach(function(r){
            if (!isPackRes_(r)){ days[day - 1][r] += num(p.row[r]) * w; return; }
            if (packOut) return;
            days[seasonDay_(day) - 1][r] += num(p.row[r]) * w;
          });
        });
      });
      return days;
    }
  }
  // Night Sky NEW side: the redesign runs a WEEKEND ladder ('NS_v2') and a WEEKDAY one
  // ('NS_v2_weekday'), so a resource's window total is not spread over the 33 days in one
  // proportion — it is split between the two day types first, per resource, and only then spread
  // within each type prop p_day. Shares come from the same day-type blend the window sim priced
  // the total with (E_wd x Σweekday p_day vs E_we x Σweekend p_day), so the 33 days still sum to
  // exactly the 33-day NS row for every resource, including packs and the carried resources whose
  // E is 0 on both sides (those fall back to the plain p_day split, i.e. the pre-D23 behaviour).
  if (isNew && cat === 'Daily Night Sky Prize' && typeof nsE_ === 'function'){
    var nsRows = nsDayTypeRows_(W, seg, payer, ctx);
    if (nsRows) return nsRows;
  }
  var label = DAILY_CAL_LABEL[cat];
  var insts = label ? ((isNew ? ctx.calNew : ctx.calCur)[label] || []) : [];
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)){ pWd = 1; pWe = 1; }        // no rate data -> even weighting

  var weights = dayWeights_(cat, insts, pWd, pWe, ds, seg, payer, opts);
  // D26: the six envelope resources follow a DIFFERENT day distribution from the other 13 — the
  // collection season ends at SEASON_LAST_DAY, so packs are placed only on in-season instances and
  // any pack landing past the cutoff settles on its last day. Everything else keeps the full
  // 33-day placement, because only envelopes stop being rewarded.
  var packW = isNew ? packDayWeights_(cat, insts, pWd, pWe, ds, seg, payer, opts) : weights;
  for (var d = 0; d < DAILY_DAYS; d++){
    if (!weights[d] && !packW[d]) continue;
    RESOURCES.forEach(function(r){
      var w = isPackRes_(r) ? packW[d] : weights[d];
      if (w) days[d][r] += num(W[r]) * w;
    });
  }
  return days;
}

// Day weights for the ENVELOPE resources (D26). Same placement rules as dayWeights_, but built on
// the in-season instances only and with any weight past the cutoff folded onto SEASON_LAST_DAY.
// Folding rather than dropping is what makes a straddler pay in full: the instance survives the
// filter, so its whole share is still distributed — just never onto a day after the album closed.
// An instance wholly past the cutoff is already gone from packLane_'s reach sum, so dropping it
// here keeps the per-day series summing to the (reduced) window total.
function packDayWeights_(cat, insts, pWd, pWe, ds, seg, payer, opts){
  if (typeof SEASON_CUTOFF === 'undefined' || !SEASON_CUTOFF)
    return dayWeights_(cat, insts, pWd, pWe, ds, seg, payer, opts);
  var lane = DAILY_CAL_LABEL[cat];
  var live = seasonInsts_(insts, lane);
  if (insts.length && !live.length){                    // every instance is outside the season
    var zero = []; for (var i = 0; i < DAILY_DAYS; i++) zero.push(0);
    return zero;
  }
  var w = dayWeights_(cat, live, pWd, pWe, ds, seg, payer, opts);
  var out = [], d;
  for (d = 0; d < DAILY_DAYS; d++) out.push(0);
  for (d = 0; d < DAILY_DAYS; d++)
    if (w[d]) out[seasonDay_(d + 1) - 1] += w[d];
  return out;
}

// Night Sky per-day rows under the D23 weekday/weekend split. Returns a 33-entry day array whose
// per-resource sums are EXACTLY the window row W, or null when there is nothing to split by (no
// NS ladder/streak data, no weekday variant, no cal_new NS days) so the caller keeps the generic
// placement. Per resource: the weekend share of the total is
//     E_we[res] x Σweekend p_day / ( E_wd[res] x Σweekday p_day + E_we[res] x Σweekend p_day )
// which is the same weighting nsE_ used to build the window total; a resource with E = 0 on both
// sides (carried, or paid outside the ladder) has no ladder opinion and falls back to the day
// split itself, which reproduces the plain p_day spread.
function nsDayTypeRows_(W, seg, payer, ctx){
  var ds = ctx.ds;
  var E = nsE_(seg, payer, ds, ctx);
  if (!E || !E.hasWeekdayVariant) return null;
  var insts = (ctx.calNewOk && ctx.calNew['Night Sky']) || [];
  if (!insts.length) return null;
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)){ pWd = 1; pWe = 1; }
  // D26: envelopes and everything else use DIFFERENT day sets. Night Sky runs a 1-day instance on
  // all 33 days, so its four instances past the collection season still pay HC and boosters but no
  // packs — split the days once for the 13 normal resources and once for the six envelope ones.
  var all = nsSplitDays_(insts, pWd, pWe);
  if (!all.wdDays.length || !all.weDays.length) return null;  // one day type only -> nothing to split
  var pk = nsSplitDays_(seasonInsts_(insts, 'Night Sky'), pWd, pWe);
  var days = emptyDays_();
  RESOURCES.forEach(function(r){
    var tot = num(W[r]);
    if (!tot) return;
    var S = isPackRes_(r) ? pk : all;
    if (!S.wdDays.length && !S.weDays.length) return;   // no in-season NS day -> no envelopes
    var mWd = num(E.eV2Weekday[r]) * S.sumWd, mWe = num(E.eV2Weekend[r]) * S.sumWe;
    var shWe = (mWd + mWe > 1e-12) ? mWe / (mWd + mWe)
                                   : (S.sumWd + S.sumWe > 0 ? S.sumWe / (S.sumWd + S.sumWe) : 0);
    place(S.weDays, S.weW, S.sumWe, tot * shWe);
    place(S.wdDays, S.wdW, S.sumWd, tot * (1 - shWe));
    // No day clamp here: the envelope day set (pk) is already filtered to in-season instances, and
    // Night Sky instances are single days, so a pack day can never exceed the cutoff. Clamping
    // unconditionally would fold the NON-pack resources of days 30-33 onto the last day too, which
    // is exactly the D23 'HC lands on weekend days only' gate's failure mode.
    function place(dl, wl, sum, amt){
      if (!dl.length || !amt) return;
      dl.forEach(function(d, j){
        days[d - 1][r] += amt * (sum > 0 ? wl[j] / sum : 1 / dl.length);
      });
    }
  });
  return days;
}

// Split a Night Sky instance list into its weekday and weekend days, carrying the p_day weight and
// its running sum for each. Factored out of nsDayTypeRows_ so the envelope resources can be split
// over the in-season instances while the other resources keep the full 33-day set (D26).
function nsSplitDays_(insts, pWd, pWe){
  var S = { wdDays: [], weDays: [], wdW: [], weW: [], sumWd: 0, sumWe: 0 };
  (insts || []).forEach(function(inst){
    ((inst && inst.days) || []).forEach(function(d){
      if (d < 1 || d > DAILY_DAYS) return;
      if (isWeekend_(d)){ S.weDays.push(d); S.weW.push(pWe); S.sumWe += pWe; }
      else              { S.wdDays.push(d); S.wdW.push(pWd); S.sumWd += pWd; }
    });
  });
  return S;
}

// normalized weight per day (sums to 1) implementing the placement rules above.
function dayWeights_(cat, insts, pWd, pWe, ds, seg, payer, opts){
  var w = placeWeights_(cat, insts, pWd, pWe, ds, seg, payer);
  if (DAILY_ALLOC_MODEL !== 'settle' || (opts && opts.earnDay)) return w;
  if (DAILY_ALWAYS[cat] || !insts.length) return w;      // nothing settles on an always-on or off-grid lane
  var sc = settleFor_(cat);
  if (!sc.offset && sc.lag.length <= 1) return w;
  var shifted = lagShift_(w, sc.offset, sc.lag), s = 0, d;
  for (d = 0; d < DAILY_DAYS; d++) s += shifted[d];
  // Every lump fell past day 33 (a single instance closing on the window's last day): keep the
  // earn-day placement rather than spreading the lump flat, which normalize_ would otherwise do.
  return (s > 0) ? normalize_(shifted) : w;
}

// WHERE the mass is EARNED, per category: the pre-D60 dayWeights_ with one addition, the
// continuous-track branch. Everything the 'settle' model does on top is a shift of this vector.
function placeWeights_(cat, insts, pWd, pWe, ds, seg, payer){
  var w = [], d;
  for (d = 0; d < DAILY_DAYS; d++) w.push(0);
  function pDay(day){ return isWeekend_(day) ? pWe : pWd; }

  if (DAILY_ALWAYS[cat]){                                    // every day, prop p_day
    for (d = 1; d <= DAILY_DAYS; d++) w[d-1] = pDay(d);
    return normalize_(w);
  }
  if (!insts.length){                                        // flat (non-calendar / off-grid)
    for (d = 0; d < DAILY_DAYS; d++) w[d] = 1;
    return normalize_(w);
  }
  // D60 (3): a continuous track is climbed on every day the lane is open, so its total is spread
  // prop p_day over the UNION of the lane's days - no per-instance reach split, because the
  // instances are not separate events, they are one track the calendar happens to draw in pieces.
  if (DAILY_TRACK[cat] && DAILY_ALLOC_MODEL === 'settle'){
    var open = {};
    insts.forEach(function(inst){
      ((inst && inst.days) || []).forEach(function(day){ if (day >= 1 && day <= DAILY_DAYS) open[day] = 1; });
    });
    for (d = 1; d <= DAILY_DAYS; d++) if (open[d]) w[d-1] = pDay(d);
    return normalize_(w);
  }
  // timed: split the total across instances prop reach, then place within each instance
  var reaches = insts.map(function(inst){ return reachOne_(inst, pWd, pWe); });
  var sumR = 0; reaches.forEach(function(x){ sumR += x; });
  insts.forEach(function(inst, i){
    var instShare = sumR > 0 ? reaches[i]/sumR : 1/insts.length;
    var inner = innerWeights_(cat, inst, pDay, ds, seg, payer);
    ((inst && inst.days) || []).forEach(function(day, j){
      if (day >= 1 && day <= DAILY_DAYS) w[day-1] += instShare * inner[j];
    });
  });
  return normalize_(w);
}

// The authored settle / lag table, read off the optional DAILY_SETTLE_SHEET by HEADER (trimmed,
// case-insensitive): source | settle_days | lag_0 | lag_1 | lag_2. A blank settle_days keeps the
// default; blank lag cells keep the identity. Missing sheet -> every category on its default, so
// a workbook that never imports the sheet still runs the measured rule. No numbers live here
// except the two defaults above (D12).
var _settleCache = null;
function settleConfig_(){
  if (_settleCache !== null) return _settleCache;
  var out = {}, v = sheetVals_(DAILY_SETTLE_SHEET);
  if (!v || v.length < 2) return (_settleCache = out);
  var h = {}, c;
  for (c = 0; c < (v[0] || []).length; c++){
    var hd = String(v[0][c] == null ? '' : v[0][c]).trim().toLowerCase();
    if (hd && h[hd] == null) h[hd] = c;
  }
  if (h['source'] == null) return (_settleCache = out);
  for (var i = 1; i < v.length; i++){
    var r = v[i] || [], cat = String(r[h['source']] == null ? '' : r[h['source']]).trim();
    if (!cat) continue;
    var o = { offset: null, lag: null };
    if (h['settle_days'] != null && r[h['settle_days']] !== '' && r[h['settle_days']] != null)
      o.offset = Math.round(num(r[h['settle_days']]));
    var lag = [], any = false, sum = 0;
    ['lag_0', 'lag_1', 'lag_2'].forEach(function(k){
      var x = (h[k] != null) ? r[h[k]] : '';
      var val = (x !== '' && x != null) ? Math.max(0, num(x)) : 0;
      if (x !== '' && x != null) any = true;
      lag.push(val); sum += val;
    });
    if (any && sum > 0) o.lag = lag.map(function(x){ return x / sum; });
    out[cat] = o;
  }
  return (_settleCache = out);
}

/** {offset, lag} for one category under the 'settle' model: the authored row if there is one,
 *  else DAILY_SETTLE_DEFAULT for a rank family and 0 for everything else, with the identity lag. */
function settleFor_(cat){
  var cfg = settleConfig_()[cat] || {};
  var off = (cfg.offset != null) ? cfg.offset : (DAILY_LASTDAY[cat] ? DAILY_SETTLE_DEFAULT : 0);
  return { offset: off, lag: cfg.lag || [1] };
}

/** Shift a day-weight vector by `offset` days and spread each day's mass over `lag` (k = 0,1,2
 *  further days). Mass that leaves the window is DROPPED here and the caller renormalises, so the
 *  window total is conserved and a lump settling on day 34 is carried by the days that remain
 *  (the user's conservation decision, 2026-10-13: never a 34th row, never a fold onto day 33). */
function lagShift_(w, offset, lag){
  var out = [], d, k;
  for (d = 0; d < DAILY_DAYS; d++) out.push(0);
  for (d = 0; d < DAILY_DAYS; d++){
    if (!w[d]) continue;
    for (k = 0; k < lag.length; k++){
      if (!lag[k]) continue;
      var t = d + offset + k;
      if (t >= 0 && t < DAILY_DAYS) out[t] += w[d] * lag[k];
    }
  }
  return out;
}

// weight of each day WITHIN one instance (sums to 1 over inst.days)
function innerWeights_(cat, inst, pDay, ds, seg, payer){
  var days = (inst && inst.days) || [], n = days.length, out = [], j;
  if (!n) return out;
  if (DAILY_LASTDAY[cat]){
    for (j = 0; j < n; j++) out.push(j === n-1 ? 1 : 0);
    return out;
  }
  if (DAILY_MARGINAL[cat]){
    // D60 (4): the MEAN curve under the settle model; p50 under legacy (bit-identical). A v4 that
    // predates accrualCurveMean (not re-pasted) falls back to p50 rather than failing.
    var curve = (DAILY_ALLOC_MODEL === 'settle' && typeof ds.accrualCurveMean === 'function')
      ? ds.accrualCurveMean(DAILY_MARGINAL[cat], seg, payer)
      : ds.accrualCurve(DAILY_MARGINAL[cat], seg, payer, false);
    if (curve.length){
      for (j = 1; j <= n; j++) out.push(Math.max(0, curveRaw_(curve, j) - curveRaw_(curve, j-1)));
      return normalize_(out);
    }
  }
  // RM / NS / marginal-without-curve: prop p_day within the instance
  for (j = 0; j < n; j++) out.push(pDay(days[j]));
  return normalize_(out);
}

// cumulative share at day d on an accrual curve (same interpolation/extrapolation rules as
// accrualD_ in EcoGainsSim_v4.gs, whose raw() is closure-local — kept in sync here).
function curveRaw_(curve, d){
  if (d <= 0 || !curve.length) return 0;
  var maxDay = curve[curve.length-1].day, maxShare = curve[curve.length-1].share || 1;
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

// data_econ_daily reader: segment | payer_flag | currency | day_index ->
// gain_per_earner_day / spend_per_earner_day. Returns { gain: days[], spend: days[] }
// (33 x {resource: value}) or null when the sheet is missing, lacks the expected headers, or has
// no rows for this (segment, payer) — callers then spill the blank grid (fail-safe).
function econDaily_(seg, payer){
  var v = sheetVals_(DAILY_ECON_SHEET);
  if (!v.length) return null;
  var h = headerIndex_(v[0]);
  if (h['currency'] == null || h['day_index'] == null ||
      h['gain_per_earner_day'] == null || h['spend_per_earner_day'] == null) return null;
  var gain = emptyDays_(), spend = emptyDays_(), found = false, lastDay = 0;
  for (var i = 1; i < v.length; i++){ var r = v[i];
    if (String(r[h['segment']]).trim() !== seg || String(r[h['payer_flag']]).trim() !== payer) continue;
    var res = String(r[h['currency']]).trim();
    if (RESOURCES.indexOf(res) === -1) continue;
    var d = Math.round(num(r[h['day_index']]));
    if (d < 1 || d > DAILY_DAYS) continue;
    gain[d-1][res]  += num(r[h['gain_per_earner_day']]);
    spend[d-1][res] += num(r[h['spend_per_earner_day']]);
    found = true;
    if (d > lastDay) lastDay = d;                             // last day the pull carries
  }
  return found ? { gain: gain, spend: spend, lastDay: lastDay } : null;
}

// 33x13 grid of '' — the NET blocks' blank spill. MUST be '' text cells, not an empty/1x1 array:
// the display sheet's net-delta formulas subtract these cells, and truly-empty cells coerce to 0
// (net delta would read 0 instead of blank); '' makes the subtraction error into its IFERROR "".
// Rows past `lastDay` become '' text cells (the blankGrid_ convention): a day the pull has not
// reached yet is unknown, not zero, and the sheet's net-delta / total formulas IFERROR / COUNT
// their way around '' but would happily add a 0.
function clipGrid_(grid, lastDay){
  var cut = Math.max(0, Math.min(DAILY_DAYS, Math.round(num(lastDay))));
  return grid.map(function(row, d){ return (d < cut) ? row : row.map(function(){ return ''; }); });
}
function blankGrid_(){
  var out = [];
  for (var d = 0; d < DAILY_DAYS; d++){
    var row = [];
    for (var j = 0; j < RESOURCES.length; j++) row.push('');
    out.push(row);
  }
  return out;
}

// ---- card-collection bridge (D19) -----------------------------------------------------------
// Per-day expected PACK counts on cal_new for one (segment, payer), broken down by source.
// This is the seam CardOpenings.gs consumes: the card sim used to read its own EcoPackGains rate
// table and hardcoded '1/0/0/1...' schedule strings; it now takes the real simulated pack flow
// off the same engine path this sheet renders, so the two views can never disagree.
//   returns { total: [33][6], bySource: [{cat, days:[33][6], prov:{tier:[{label,weight}]}}, ...] }
// `prov` (2026-08-18) names the ladder row behind each pack tier — rank, milestone index, Night Sky
// round — so the card sim's day-by-day log can say WHY a pack was granted instead of only which
// source paid it. It is per-source, not per-day: a source's ladder is identical on every instance.
// Values are FRACTIONAL expectations (decision D19/13: deterministic attendance) — the caller
// accumulates them into discrete pack-open events.
function dailyPacksFor_(seg, payer, ctx){
  ctx = ctx || Context.get();
  var total = [], d, k;
  for (d = 0; d < DAILY_DAYS; d++) total.push(PACK_RES.map(function(){ return 0; }));
  var bySource = [];
  CATEGORY_ORDER.forEach(function(cat){
    var series = dailySeries_(cat, seg, payer, ctx, true);   // NEW side = simulated over cal_new
    var grid = [], any = false;
    for (var i = 0; i < DAILY_DAYS; i++){
      var row = PACK_RES.map(function(r){ var v = num(series[i][r]); if (v) any = true; return v; });
      grid.push(row);
      for (var j = 0; j < row.length; j++) total[i][j] += row[j];
    }
    if (any) bySource.push({ cat: cat, days: grid, prov: packProvFor_(cat, seg, payer, ctx) });
  });
  return { total: total, bySource: bySource };
}

// Per-INSTANCE discrete grant plan for packs (2026-08-20). dailyPacksFor_ above gives the card sim
// an EXPECTATION per day; this gives it the discrete events behind that expectation, so the log can
// say what actually happened on a given day instead of showing an accumulator crossing 1.
//
//   [ { cat, days[], dayW[], reach, participation, groups } , ... ]   one entry per cal_new instance
//
// The card sim draws Bernoulli(participation x reach) for the instance, then resolves each group
// (see packRungs_ in EcoGainsSim_v4.gs). Landing days use exactly the placement rules the daily view
// uses, so a rung's day distribution matches the per-day series it replaces:
//   last-day family  -> the instance's final day (rank rewards are granted at instance end)
//   marginal family  -> the accrual curve's marginal share across the instance days
//   everything else  -> proportional to p_day within the instance
// Season Pass is NOT instance-shaped (its packs come from the whole reached track), so it is handled
// separately in the card sim rather than here.
function packGrantPlan_(seg, payer, ctx, prof){
  ctx = ctx || Context.get();
  var ds = ctx.ds, b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  // A synthetic profile (D49) can force attendance. Everything else on this row - the accrual
  // curves, the day weights, the calendar - is still the real segment's, so an instance's SHAPE is
  // unchanged and only the probability of being there for it moves.
  if (prof && prof.attend != null){ pWd = num(prof.attend); pWe = num(prof.attend); }
  // NO 1/1 fallback here, unlike dailySeries_. That fallback exists so a segment without activity
  // rates still gets a DISTRIBUTION over days for a total it already has; this function decides
  // whether packs are earned at all. Handing a rate-less segment reach = 1 gave the 'A. 0' appendix
  // packs, which it must never get (no behaviour telemetry to price reach with) -- and packLane_
  // agrees: it bails on `!(reach > 0)`. Zero rates therefore means an empty plan.
  function pDay(d){ return isWeekend_(d) ? pWe : pWd; }

  var plan = [];
  CATEGORY_ORDER.forEach(function(cat){
    if (cat === 'Season Pass (Free)') return;               // whole-track, not per instance
    var label = DAILY_CAL_LABEL[cat];
    if (!label) return;
    var insts = (ctx.calNew[label] || []).slice()
                  .sort(function(x, y){ return x.start - y.start; });   // RM keys its ladder off this
    insts.forEach(function(inst, i){
      var rr = packRungs_(cat, seg, payer, ctx, i, prof);
      if (!rr) return;
      // D26: an instance wholly past the collection season grants no envelopes. The ordinal `i` is
      // still the UNFILTERED one, because Rainbow Maker keys RM_1st/RM_2nd off instance order —
      // filtering before the ordinal would silently re-point the split at the wrong config sheet.
      // ...but the ToF TICKET is not an envelope (packLane_ pays it on the UNFILTERED reach: ToF is
      // its own always-on event with no relationship to the album season). Dropping the instance
      // outright therefore silently lost its tickets too - Jigsaw's d31 instance and the four
      // post-cutoff Night Sky days, 2.2 of 23.7 season tickets at 20-39 PAYER. Keep the instance and
      // mark it: the card sim opens no envelopes from it, and still banks its tickets.
      var noPacks = !SEASON_EXEMPT_LANES[label] && !instInSeason_(inst);
      if (noPacks && !rungsPayTickets_(rr)) return;      // nothing left to grant -> drop it
      var reach = reachOne_(inst, pWd, pWe);       // NOT clipped: a straddler pays in full
      if (!(reach > 0)) return;
      var days = ((inst && inst.days) || []).filter(function(d){ return d >= 1 && d <= DAILY_DAYS; });
      if (!days.length) return;
      var w;
      if (DAILY_LASTDAY[cat]){
        w = days.map(function(_, j){ return j === days.length - 1 ? 1 : 0; });
      } else if (DAILY_MARGINAL[cat]){
        var curve = ds.accrualCurve(DAILY_MARGINAL[cat], seg, payer, false);
        if (curve.length){
          w = [];
          for (var j = 1; j <= days.length; j++)
            w.push(Math.max(0, curveRaw_(curve, j) - curveRaw_(curve, j - 1)));
        } else w = days.map(function(d){ return pDay(d); });
      } else {
        w = days.map(function(d){ return pDay(d); });
      }
      // D26: a straddler keeps its full ladder and its full day weights, but an envelope that would
      // land past the collection season settles on its last day. Clamping the day LIST (rather than
      // dropping rungs) is what keeps "cut in the middle still pays the full reward" true; repeated
      // days are harmless, the card sim indexes days/dayW in lockstep.
      // `days` is the envelope LANDING axis and is clamped by the season cutoff; `attDays` is the
      // instance's real, unclamped days. The card sim needs the real ones to ask "was this player
      // in the game while this instance was running" (D32) - testing a clamped day would ask about
      // day 29 for an instance that ran on day 31.
      plan.push({ cat: cat, days: days.map(function(d){ return seasonDay_(d); }),
                  attDays: days.slice(),
                  dayW: normalize_(w), reach: reach, noPacks: noPacks,
                  participation: rr.participation, groups: rr.groups });
    });
  });
  return plan;
}

// Does any rung of this instance pay a ToF_Ticket? An out-of-season instance is kept ONLY when the
// answer is yes; otherwise it has nothing left to grant and dropping it keeps the plan small.
function rungsPayTickets_(rr){
  var any = false;
  ((rr && rr.groups) || []).forEach(function(g){
    (g.rungs || []).forEach(function(x){ if (num(x.tickets) > 0) any = true; });
  });
  return any;
}

// ---- small helpers ----
function emptyDays_(){
  var out = [];
  for (var d = 0; d < DAILY_DAYS; d++){ var o = {}; RESOURCES.forEach(function(r){ o[r] = 0; }); out.push(o); }
  return out;
}
function addSeries_(into, add){
  for (var d = 0; d < DAILY_DAYS; d++) RESOURCES.forEach(function(r){ into[d][r] += add[d][r]; });
}
function diffSeries_(a, b){
  var out = emptyDays_();
  for (var d = 0; d < DAILY_DAYS; d++) RESOURCES.forEach(function(r){ out[d][r] = a[d][r] - b[d][r]; });
  return out;
}
function daysToGrid_(days){
  return days.map(function(o){ return RESOURCES.map(function(r){ return num(o[r]); }); });
}
// NET-block grid: same shape, but the six PACK columns are BLANK (D19/8). Packs are gains-only —
// there is no spend telemetry for them, so a numeric NET cell could only restate the gain and
// would read as "net pack position", which does not exist. '' (not 0) for the same reason
// blankGrid_ uses '': the sheet's net-Δ formulas subtract these cells and IFERROR them, so ''
// yields a blank Δ while 0 would yield a false 0.
function netGrid_(days){
  return days.map(function(o){
    return RESOURCES.map(function(r){ return isGainsOnlyRes_(r) ? '' : num(o[r]); });
  });
}
function normalize_(w){
  var s = 0, i;
  for (i = 0; i < w.length; i++) s += w[i];
  if (s <= 0) return w.map(function(){ return 1/w.length; });
  return w.map(function(x){ return x/s; });
}
function hasAmount_(row){
  for (var i = 0; i < RESOURCES.length; i++) if (num(row[RESOURCES[i]]) !== 0) return true;
  return false;
}
