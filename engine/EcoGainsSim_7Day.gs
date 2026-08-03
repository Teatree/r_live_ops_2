/************************************************************************************************
 * EcoGainsSim_7Day.gs — the same simulation, restricted to a slice of the calendar window.
 * ---------------------------------------------------------------------------------------------
 * CUSTOM FUNCTIONS (identical arguments and identical spill shape to the full-window pair —
 * 25 categories x 19 resources):
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_SIM_7_DAY(payer, segment, sim_refresh!$A$1))
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_DIFF_7_DAY(payer, segment, sim_refresh!$A$1))
 *
 * WINDOW: days 6..13 INCLUSIVE of cal_new — that is **8 calendar days**, not 7. The names keep
 * the "_7_DAY" spelling you asked for; the constants below are the truth. Day 1 is a Wednesday,
 * so this runs Monday (day 6) through the following Monday (day 13). Edit the two constants and
 * re-paste to move the window; set them to 1 and 33 and these functions become exactly
 * ECOGAINS_SIM / ECOGAINS_DIFF (there is a harness gate asserting precisely that).
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS NOT A COPY OF EcoGainsSim_v4.gs
 *
 * You asked for a copy. A literal copy would break the project: every .gs file in an Apps Script
 * project shares ONE global namespace, so a second file declaring RESOURCES, Context, timedCore_,
 * onOpen, ... would silently override the engine's versions by load order. That exact bug has bit
 * this project twice already (calParseTest.gs overriding parseCalendarInstances_, and
 * CardOpenings.gs overriding onOpen — see CLAUDE.md "Apps Script gotchas").
 *
 * So this file declares only what is genuinely new (six names, all prefixed) and calls the engine
 * for everything else. The behaviour you asked for is identical, and it can never drift from the
 * full-window sim because it IS the full-window sim, summed over fewer days.
 *
 * REQUIRES EcoGainsSim_v4.gs AND EcoGainsSim_Daily.gs in the same project. Uses their Context,
 * CATEGORY_ORDER, RESOURCES, PAYER_CELL, SEG_CELL, DAILY_DAYS, dailySeries_, rowToArray_,
 * readCell_ and num.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW THE WINDOW IS APPLIED (decision: "whatever is RECEIVED in the window")
 *
 * The window totals are NOT re-simulated. This reuses EcoGainsSim_Daily.gs's claim-day allocation
 * — the same machinery the EcoGainsSim_Daily sheet renders — and simply sums the days in range:
 *
 *   SIM_7  [cat][res] = Σ_{day = FIRST..LAST}  dailySeries_(cat, ..., isNew = true) [day][res]
 *   DIFF_7 [cat][res] = SIM_7 − Σ_{same days}  dailySeries_(cat, ..., isNew = false)[day][res]
 *
 * so both sides are measured on the SAME days (an 8-day slice of the redesigned calendar against
 * the same 8 days of the current one) and DIFF_7 keeps the meaning it has in the full sim.
 *
 * What that means for events straddling the window edge — the placement rules are Daily's, so:
 *   leaderboards  pay on their instance's LAST day, so an instance running days 4..9 counts in
 *                 FULL (it paid on day 9, inside the window); one running days 11..16 counts NOT
 *                 AT ALL (it pays on day 16, outside).
 *   collections   spread across their instance days by the accrual curve's marginal share, so a
 *                 straddling instance contributes only the share that lands on days 6..13.
 *   always-on     Core / Saga / Daily Gift spread over all 33 days ∝ the weekday/weekend active
 *                 rate, so they contribute this window's share of activity.
 *   Rainbow Maker per-instance rows placed on their own days (RM_1st/RM_2nd split respected).
 *   Season Pass   spread ∝ active rate over its season-long lane.
 *   flat          Ads / Other / FlowerCoop / IAPs are total/33 per day → 8/33 of the window.
 *   PACKS         follow their source's placement (D19), so leaderboard packs land whole on the
 *                 instance's last day.
 *
 * Because this is a pure restriction of the daily allocation, the per-category column sums over
 * the FULL 33 days reconcile with ECOGAINS_SIM / ECOGAINS_DIFF to ~1e-13.
 *
 * ---------------------------------------------------------------------------------------------
 * SHEET SETUP
 *  - Put the two anchors on a sheet laid out like EcoGainsSim_HC (25 category rows per segment
 *    block, 19 resource columns). The spill shape is identical, so the HC display sheet's
 *    geometry works as-is: SIM at column C, DIFF at column W.
 *  - Add that sheet's name to REFRESH_SHEETS in EcoGainsSim_v4.gs so the nonce bump reaches it
 *    ('EcoGainsSim_HC_7d' is already listed there — rename the sheet to that, or edit the list).
 *    refreshSims_ skips sheet names that do not exist, so an unused entry is harmless.
 *  - Keep the trailing sim_refresh!$A$1 nonce argument on every formula, exactly as the
 *    full-window functions do. These functions ignore the extra argument; its only job is to
 *    change so Google re-runs them.
 ************************************************************************************************/

// The window, INCLUSIVE on both ends, in calendar days (day 1 = the first column of cal_new, a
// Wednesday). 6..13 = 8 days, Monday through the following Monday.
// Set to 1 and 33 to reproduce the full-window ECOGAINS_SIM / ECOGAINS_DIFF exactly.
var WIN7_FIRST_DAY = 6;
var WIN7_LAST_DAY  = 13;

/**
 * Per-source simulated gains for the window, on cal_new. Same arguments, same 25 x 19 spill and
 * same category/resource order as ECOGAINS_SIM — just fewer days.
 * @customfunction
 */
function ECOGAINS_SIM_7_DAY(payer, segment){
  var p = String(payer   || readCell_(PAYER_CELL) || 'NONPAYER').trim();
  var s = String(segment || readCell_(SEG_CELL)   || '0-9').trim();
  var ctx = Context.get();
  return CATEGORY_ORDER.map(function(cat){
    return rowToArray_(win7Row_(cat, s, p, ctx, true));
  });
}

/**
 * Simulated minus measured for the SAME days (new calendar vs current calendar over the window).
 * Same arguments and spill shape as ECOGAINS_DIFF.
 * @customfunction
 */
function ECOGAINS_DIFF_7_DAY(payer, segment){
  var p = String(payer   || readCell_(PAYER_CELL) || 'NONPAYER').trim();
  var s = String(segment || readCell_(SEG_CELL)   || '0-9').trim();
  var ctx = Context.get();
  return CATEGORY_ORDER.map(function(cat){
    var nw  = win7Row_(cat, s, p, ctx, true);
    var cur = win7Row_(cat, s, p, ctx, false);
    return RESOURCES.map(function(r){ return num(nw[r]) - num(cur[r]); });
  });
}

// Resolved window bounds, clamped to the calendar and ordered. Returns {a, b} 1-based inclusive.
// Guards against a mis-typed constant silently producing an empty or out-of-range window.
function win7Bounds_(){
  var a = Math.round(num(WIN7_FIRST_DAY)), b = Math.round(num(WIN7_LAST_DAY));
  if (!(a > 0)) a = 1;
  if (!(b > 0)) b = DAILY_DAYS;
  if (a > b){ var t = a; a = b; b = t; }                  // tolerate reversed bounds
  return { a: Math.max(1, a), b: Math.min(DAILY_DAYS, b) };
}

// One category's per-resource total over the window, on one side.
// isNew: true -> simulated over cal_new; false -> measured over cal_curr.
function win7Row_(cat, seg, payer, ctx, isNew){
  var days = dailySeries_(cat, seg, payer, ctx, isNew);
  var w = win7Bounds_(), out = {};
  RESOURCES.forEach(function(r){ out[r] = 0; });
  for (var d = w.a; d <= w.b; d++){
    var o = days[d - 1];
    if (!o) continue;
    RESOURCES.forEach(function(r){ out[r] = num(out[r]) + num(o[r]); });
  }
  return out;
}

/**
 * The window actually in force, as a one-row label — handy next to the block so nobody has to
 * open the script to find out which days a sheet is showing.
 * Spills 1 x 3: [first day, last day, day count].
 * @customfunction
 */
function ECOGAINS_WINDOW_7_DAY(){
  var w = win7Bounds_();
  return [[w.a, w.b, w.b - w.a + 1]];
}
