/************************************************************************************************
 * EcoGainsSim_Daily.gs — per-day view of the 33-day simulation (EcoGainsSim_Daily sheet).
 * ---------------------------------------------------------------------------------------------
 * REQUIRES EcoGainsSim_v4.gs in the same project (uses Context, CATEGORY_ORDER, RESOURCES,
 * resultRow_, measuredRow_, reachOne_, isWeekend_, num).
 *
 * CUSTOM FUNCTION (three anchors on the sheet, each spilling 33 days x 11 resources):
 *   =LET(payer,$C$3, segment,$C$4, source,$C$5, ECOGAINS_DAILY(payer, segment, source, "CURRENT"))
 *   =LET(payer,$C$3, segment,$C$4, source,$C$5, ECOGAINS_DAILY(payer, segment, source, "NEW"))
 *   =LET(payer,$C$3, segment,$C$4, source,$C$5, ECOGAINS_DAILY(payer, segment, source, "DIFF"))
 *   source = 'ALL' or one CATEGORY_ORDER name.
 *
 * ALLOCATION MODEL ("claim-day realistic") — window totals are the same numbers the main sim
 * produces (CURRENT = measured, anchored on cal_curr; NEW = simulated, anchored on cal_new);
 * this script only distributes them over the 33 calendar days, conserving totals exactly:
 *   flat        Ads, Other, Season Pass (Free), Team Event, Team Race, FlowerCoop, IAPs, and any
 *               source with a nonzero total but no calendar instances (River Rush's CURRENT side
 *               runs off-grid) -> total / 33 every day.
 *   always-on   Core, Saga, Daily Gift -> spread over all 33 days proportional to p_day (the
 *               weekday/weekend active rate). Night Sky -> over its 33x1d instances, prop p_day.
 *   last-day    Bomb/Chuck/Red Challenge, Level Race, Flash Race, Target Day, Kite Festival —
 *               rank rewards are granted at instance END: the instance's slice lands on its
 *               final day. Instance slices split the source total proportional to reach(inst).
 *   marginal    Hatchling Hideaway, Bomb's Ballet, Jigsaw, Photoshoot — spread across instance
 *               days by the accrual curve's marginal share (share(d) - share(d-1)).
 *   RM          Rainbow Maker — no accrual curve: spread within each instance prop p_day
 *               (flagged assumption; milestones auto-claim while playing).
 * DIFF = NEW(day) - CURRENT(day). Column totals therefore reconcile with ECOGAINS_SIM/_DIFF.
 ************************************************************************************************/

var DAILY_DAYS = 33;

// how each source's window total is placed on days (anything not listed = flat)
var DAILY_ALWAYS  = { 'Core':1, 'Saga':1, 'Daily Gift':1 };
var DAILY_LASTDAY = { 'Bomb Challenge':1, 'Chuck Challenge':1, 'Red Challenge':1, 'Level Race':1,
                      'Flash Race':1, 'Target Day':1, 'Kite Festival':1 };
var DAILY_MARGINAL = { 'Hatchling Hideaway':'Hatchling Hideaway', "Bomb's Ballet":'Bombs Ballet',
                       'Jigsaw':'Jigsaw', 'Photoshoot':'Photoshoot' };
var DAILY_PDAY_INST = { 'Rainbow Maker':1, 'Daily Night Sky Prize':1 };

// category -> calendar row label (same wiring as the per-source sims in EcoGainsSim_v4.gs)
var DAILY_CAL_LABEL = {
  'Bomb Challenge':"Bomb's Challenge", 'Chuck Challenge':"Chuck's Challenge",
  'Red Challenge':"Red's Challenge", 'Level Race':'Level Race', 'Flash Race':'Flash Race',
  'Target Day':'Target Day', 'Kite Festival':'Kite Festival',
  'Hatchling Hideaway':'Hatchling Hideaway', "Bomb's Ballet":"Bomb's Ballet Show",
  'Jigsaw':'Jigsaw Puzzle', 'Photoshoot':'Photoshoot', 'Rainbow Maker':'Rainbow Maker',
  'River Rush':'River Rush', 'Daily Night Sky Prize':'Night Sky'
};

/** @customfunction */
function ECOGAINS_DAILY(payer, segment, source, block){
  var p = String(payer   || 'NONPAYER').trim();
  var s = String(segment || '0-9').trim();
  var src = String(source || 'ALL').trim();
  var blk = String(block  || 'NEW').trim().toUpperCase();
  if (blk !== 'CURRENT' && blk !== 'NEW' && blk !== 'DIFF')
    return [['Unknown block: ' + blk + " (use CURRENT / NEW / DIFF)"]];
  if (src.toUpperCase() !== 'ALL' && CATEGORY_ORDER.indexOf(src) === -1)
    return [['Unknown source: ' + src]];
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
function dailySeries_(cat, seg, payer, ctx, isNew){
  var ds = ctx.ds;
  var W = isNew ? resultRow_(cat, seg, payer, ctx) : measuredRow_(cat, seg, payer, ds);
  var days = emptyDays_();
  if (!hasAmount_(W)) return days;
  var label = DAILY_CAL_LABEL[cat];
  var insts = label ? ((isNew ? ctx.calNew : ctx.calCur)[label] || []) : [];
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)){ pWd = 1; pWe = 1; }        // no rate data -> even weighting

  var weights = dayWeights_(cat, insts, pWd, pWe, ds, seg, payer);
  for (var d = 0; d < DAILY_DAYS; d++){
    if (!weights[d]) continue;
    RESOURCES.forEach(function(r){ days[d][r] += num(W[r]) * weights[d]; });
  }
  return days;
}

// normalized weight per day (sums to 1) implementing the placement rules above.
function dayWeights_(cat, insts, pWd, pWe, ds, seg, payer){
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

// weight of each day WITHIN one instance (sums to 1 over inst.days)
function innerWeights_(cat, inst, pDay, ds, seg, payer){
  var days = (inst && inst.days) || [], n = days.length, out = [], j;
  if (!n) return out;
  if (DAILY_LASTDAY[cat]){
    for (j = 0; j < n; j++) out.push(j === n-1 ? 1 : 0);
    return out;
  }
  if (DAILY_MARGINAL[cat]){
    var curve = ds.accrualCurve(DAILY_MARGINAL[cat], seg, payer, false);
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
