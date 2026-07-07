/************************************************************************************************
 * CalStats.gs — standalone calendar instance / event-day counts for the cal_new summary block.
 * ---------------------------------------------------------------------------------------------
 * DELIBERATELY SEPARATE from EcoGainsSim_v4.gs: this is the "instances / event-days per source"
 * summary that used to live on EcoGainsSim_HC (columns AB:AF via the old ECOGAINS_CAL_STATS).
 * Keeping it in its own file means edits/replacements of the main engine will NOT remove it.
 *
 * It REUSES two stable engine globals — Context (parsed cal_curr + cal_new) and CATEGORY_ORDER —
 * but keeps its OWN category->calendar-label map (CALSTATS_LABEL) so the mapping travels with this
 * file. Do NOT redefine any engine name here (all .gs files share one global namespace; a dup name
 * silently overrides the engine — see CLAUDE.md).
 *
 * PLACEMENT — cal_new, summary block at the bottom (headers already present):
 *   row 36:  E36 'old'              H36 'new'              K36 'diff'
 *   row 37:  E37 'instances'  F37 'event-days'   H37 'instances'  I37 'event-days'   K37 'instances'
 *   C38:C62: the 25 source labels, in CATEGORY_ORDER (== the order this function returns).
 *
 * Put ONE formula in E38:
 *     =ECOGAINS_CAL_COUNTS()
 * It spills 25 rows x 7 cols -> E38:K62, laid out to match the headers (G and J left blank):
 *     E = old instances   F = old event-days   [G blank]
 *     H = new instances    I = new event-days   [J blank]
 *     K = diff (% change in instance count, new vs old; "new" if old had none, blank if neither)
 *
 * "old" = cal_curr, "new" = cal_new. Non-scheduled categories (Ads, Core, Other, Season Pass,
 * Team Event/Race, FlowerCoop, IAPs) have no calendar label -> all cells blank (same as the old
 * ECOGAINS_CAL_STATS behaviour). Event-days count REAL days (a window-clipped instance counts only
 * the days that fall inside the 33-day grid).
 *
 * REFRESH: this function takes no arguments, so Google only re-runs it when the cell is re-touched.
 * The engine's refreshSims_ re-touches every ECOGAINS_ formula on REFRESH_SHEETS; add 'cal_new' to
 * that list (done in EcoGainsSim_v4.gs) so a calendar/input edit (or Precompute) refreshes E38 too.
 * Otherwise refresh manually: menu EcoGainsSim > Refresh simulations, or re-enter the E38 formula.
 ************************************************************************************************/

// category -> calendar row label. Own copy (kept in sync with the calendars, not with the engine).
// Matches EcoGainsSim_v4.gs CAL_LABEL; edit here if a calendar label changes.
var CALSTATS_LABEL = {
  'Bomb Challenge':"Bomb's Challenge", 'Chuck Challenge':"Chuck's Challenge",
  'Red Challenge':"Red's Challenge", 'Level Race':'Level Race', 'Flash Race':'Flash Race',
  'Target Day':'Target Day', 'Kite Festival':'Kite Festival',
  'Hatchling Hideaway':'Hatchling Hideaway', "Bomb's Ballet":"Bomb's Ballet Show",
  'Jigsaw':'Jigsaw Puzzle', 'Photoshoot':'Photoshoot', 'Rainbow Maker':'Rainbow Maker',
  'River Rush':'River Rush', 'Daily Night Sky Prize':'Night Sky', 'Flock Flurry':'Flock Flurry'
};

/**
 * Per-source instance + event-day counts for cal_curr (old) and cal_new (new), plus an instance
 * diff. Spills 25 rows x 7 cols; drop it at cal_new!E38 (see the header block for the layout).
 * @customfunction
 */
function ECOGAINS_CAL_COUNTS(){
  var ctx = Context.get();                 // engine's shared parsed calendars (prefers cal_parsed)
  var cur = ctx.calCur, nw = ctx.calNew;
  return CATEGORY_ORDER.map(function(cat){
    var label = CALSTATS_LABEL[cat];
    if (!label) return ['', '', '', '', '', '', ''];         // non-scheduled -> blank row
    var o = calstatsCount_(cur[label]), n = calstatsCount_(nw[label]);
    var diff;
    if (o.inst > 0)       diff = (n.inst >= o.inst ? '+' : '') + Math.round((n.inst - o.inst) / o.inst * 100) + '%';
    else if (n.inst > 0)  diff = 'new';                       // added on the new calendar
    else                  diff = '';                          // scheduled label, no instances either side
    return [o.inst, o.days, '', n.inst, n.days, '', diff];
  });
}

// {inst: instance count, days: total REAL event-days} for one event's parsed instance list.
function calstatsCount_(list){
  list = list || [];
  var days = 0;
  list.forEach(function(x){ days += ((x && x.days) || []).length; });
  return { inst: list.length, days: days };
}
