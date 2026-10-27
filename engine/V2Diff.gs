/************************************************************************************************
 * V2Diff.gs — menu tool: mark old-vs-new config differences in RED text.
 * ---------------------------------------------------------------------------------------------
 * Runs from the spreadsheet UI (menu EcoGainsSim > "Mark v2 config diffs (red)"), NOT as a cell
 * formula — a custom function cannot set formatting; a menu-run function can. Standalone file so
 * main-engine edits won't remove it. The menu ITEMS are registered in EcoGainsSim_v4.gs onOpen()
 * (same pattern as 'Fill Sim per Segment' -> SimPerSegmentFill.gs).
 *
 * For every config sheet that has a _v2 twin, it compares the base (OLD) sheet against _v2 (NEW)
 * and paints each CHANGED cell's text red on the _v2 sheet.
 *
 * "Ignore the local sims" — two rules do that automatically:
 *   1. It compares only inside the BASE sheet's used range (A1..last cell). The _v2 sheets bolt
 *      their helper / local-sim blocks on to the RIGHT of that range (EventReach helpers, rank
 *      helpers, etc.) — those columns are never compared.
 *   2. It skips any cell that is a FORMULA on either sheet (the inline sims are formula-driven,
 *      e.g. the image-render blocks and the Ki/NS/Ph formula columns).
 * What's left is the hand-entered config (rewards, requirements, durations, day values). A red
 * cell = that value was changed (or added) in _v2 vs base.
 *
 * ALL pairs are compared, including c_saga / c_saga_v2 (the two are now cell-aligned, so the
 * generic diff works — the saga HC changes get marked like any other config edit). If a future
 * _v2 is ever a structural rewrite again, add its base name to V2DIFF_STRUCTURAL_SKIP below.
 *
 * PAIR LIST (D66, 2026-10-27): the pairs are DERIVED FROM THE WORKBOOK at run time - every sheet
 * named `X_v2` whose base `X` exists is a pair - unioned with the static V2DIFF_PAIRS below, so a
 * config sheet that gains a _v2 twin (PackConfig, AlbumConfig, ToF, Ki_Tr, RM_1st, RM_2nd ...) is
 * diffed with no code change. Two sheets whose names do not follow that rule are mapped by hand:
 *   NS_v2_weekday  <-  NS_weekday when the workbook has it (the live WEEKDAY ladder, D61d),
 *                      else NS (the pre-D61d reading). Against NS it showed 18 red cells on
 *                      LIVE_OPS_V3 that were the weekday design, not edits; against NS_weekday, 0.
 * A CONFIG_PAIRED registry (the liveops20_fixes engine defines one) still takes precedence,
 * read at run time because menu handlers run after every file has loaded.
 *
 * Re-run any time. It is non-destructive: it preserves every other cell's existing font colour and
 * only turns changed cells red. Use "Clear v2 config diff marks" to reset the compared region's
 * text to black (note: that resets ALL font colours in the config region, intentional ones too).
 ************************************************************************************************/

// base sheet -> _v2 sheet. Every config sheet with a _v2 twin (static fallback; see header).
var V2DIFF_PAIRS = [
  ['c_saga','c_saga_v2'], ['c_day','c_day_v2'], ['RR','RR_v2'], ['J','J_v2'],
  ['HH','HH_v2'], ['BB','BB_v2'], ['Ki','Ki_v2'], ['NS','NS_v2'],
  // D23: the redesign runs two Night Skies. 'NS_v2' is the WEEKEND ladder and 'NS_v2_weekday' the
  // weekday one, so BOTH are diffed against the same live 'NS' base — that is what makes it
  // visible at a glance that the weekday sheet is (or is no longer) a copy of the live config.
  ['NS','NS_v2_weekday'],
  ['Ph','Ph_v2'],
  ['F','F_v2'], ['Race','Race_v2'], ['TaD','TaD_v2'],
  ['SP','SP_v2'], ['SP_lb','SP_lb_v2'],  // season pass track + challenge (D16)
  ['RM_1st','RM_1st_v2'], ['RM_2nd','RM_2nd_v2']   // RM anchored pairs (2026-08-18)
];

// The hand-mapped twins: a _v2 sheet whose base is not simply its name minus '_v2'. Each entry
// lists the base candidates in order of preference; the first one the workbook has wins.
var V2DIFF_TWINS = { 'NS_v2_weekday': ['NS_weekday', 'NS'] };

// [ [base, base_v2], ... ]: the CONFIG_PAIRED registry when present; else every `X_v2` sheet in
// the workbook whose `X` exists, plus the hand-mapped twins, plus the static list (deduplicated,
// static order first so the pop-up reads the same way it always has).
function v2diffPairs_(){
  if (typeof CONFIG_PAIRED !== 'undefined' && CONFIG_PAIRED)
    return Object.keys(CONFIG_PAIRED).map(function(b){ return [b, b + '_v2']; });
  var names = {};
  try {
    SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function(sh){ names[sh.getName()] = true; });
  } catch (e){ return V2DIFF_PAIRS; }                     // no workbook to read -> the static list
  var out = [], seen = {};
  function add(b, v){ var k = b + '>' + v; if (seen[k]) return; seen[k] = true; out.push([b, v]); }
  // a twin's _v2 sheet must not ALSO be paired with a base the static list names for it
  var twinned = {};
  Object.keys(V2DIFF_TWINS).forEach(function(v){
    if (!names[v]) return;
    for (var i = 0; i < V2DIFF_TWINS[v].length; i++)
      if (names[V2DIFF_TWINS[v][i]]){ add(V2DIFF_TWINS[v][i], v); twinned[v] = true; break; }
  });
  V2DIFF_PAIRS.forEach(function(p){ if (!twinned[p[1]]) add(p[0], p[1]); });
  Object.keys(names).forEach(function(n){
    if (n.length > 3 && n.slice(-3) === '_v2' && names[n.slice(0, -3)] && !twinned[n]) add(n.slice(0, -3), n);
  });
  return out;
}
// base sheets whose _v2 is a structural rewrite (not cell-aligned) -> skip the cell diff.
// Empty now: c_saga was re-aligned with c_saga_v2, so it is compared like every other pair.
var V2DIFF_STRUCTURAL_SKIP = [];
var V2DIFF_RED = '#FF0000';

// ---- menu entry point: mark the diffs ----
function markV2ConfigDiffs(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var total = 0, changed = [], zero = [], missing = [], unauthored = [], skipped = [];
  v2diffPairs_().forEach(function(pair){
    var base = pair[0], v2 = pair[1];
    if (V2DIFF_STRUCTURAL_SKIP.indexOf(base) !== -1){ skipped.push(base); return; }
    var bs = ss.getSheetByName(base), vs = ss.getSheetByName(v2);
    if (bs && !vs){ unauthored.push(v2); return; }   // no _v2 twin = unauthored (normal state)
    if (!bs){ missing.push(base + '/' + v2); return; }

    var brange = bs.getDataRange();                       // OLD sheet's used extent
    var rows = Math.min(brange.getNumRows(), vs.getMaxRows());
    var cols = Math.min(brange.getNumColumns(), vs.getMaxColumns());
    var bv = brange.getValues(), bf = brange.getFormulas();
    var vrange = vs.getRange(1, 1, rows, cols);
    var vv = vrange.getValues(), vf = vrange.getFormulas();
    var colors = vrange.getFontColors();                  // keep existing colours; only diffs -> red

    var n = 0;
    for (var r = 0; r < rows; r++){
      for (var c = 0; c < cols; c++){
        if (bf[r][c] !== '' || vf[r][c] !== '') continue; // ignore local sims / helpers (formulas)
        if (!v2diffEqual_(bv[r][c], vv[r][c])){ colors[r][c] = V2DIFF_RED; n++; }
      }
    }
    if (n){ vrange.setFontColors(colors); changed.push([v2, n]); total += n; }
    else zero.push(v2);
  });

  // build the end-of-run pop-up: which sheets changed and how many changes each (+ total).
  changed.sort(function(a, b){ return b[1] - a[1]; });
  var lines = ['Marked ' + total + ' change(s) across ' + changed.length + ' sheet(s):', ''];
  if (changed.length)
    changed.forEach(function(x){ lines.push('  • ' + x[0] + ':  ' + x[1]); });
  else
    lines.push('  (no config changes found)');
  if (zero.length)       lines.push('', 'No changes: ' + zero.join(', '));
  if (unauthored.length) lines.push('No _v2 twin (unauthored): ' + unauthored.join(', '));
  if (skipped.length)    lines.push('Skipped (structural rewrite): ' + skipped.join(', '));
  if (missing.length)    lines.push('Missing base sheet(s): ' + missing.join(', '));

  lines.push('', 'Pairs are derived from the workbook: every X_v2 with a base X' +
             (typeof V2DIFF_TWINS !== 'undefined' ? ', NS_v2_weekday against ' +
              (v2diffPairs_().filter(function(p){ return p[1] === 'NS_v2_weekday'; }).map(function(p){ return p[0]; })[0] || '(absent)') : '') + '.');
  var ui = SpreadsheetApp.getUi();
  ui.alert('v2 config diff — old vs new', lines.join('\n'), ui.ButtonSet.OK);
}

// ---- menu entry point: clear the marks (reset compared region text to black) ----
function clearV2ConfigDiffs(){
  var ss = SpreadsheetApp.getActiveSpreadsheet(), cleared = 0;
  v2diffPairs_().forEach(function(pair){
    if (V2DIFF_STRUCTURAL_SKIP.indexOf(pair[0]) !== -1) return;
    var bs = ss.getSheetByName(pair[0]), vs = ss.getSheetByName(pair[1]);
    if (!bs || !vs) return;
    var brange = bs.getDataRange();
    var rows = Math.min(brange.getNumRows(), vs.getMaxRows());
    var cols = Math.min(brange.getNumColumns(), vs.getMaxColumns());
    vs.getRange(1, 1, rows, cols).setFontColor('#000000');
    cleared++;
  });
  ss.toast('Reset config-region text to black on ' + cleared + ' _v2 sheet(s).', 'v2 config diff', 6);
}

// two cell values are "equal" for config purposes: numeric compare with tolerance, else trimmed
// string compare; blank ('' / null) treated the same.
function v2diffEqual_(a, b){
  var na = v2diffNorm_(a), nb = v2diffNorm_(b);
  if (typeof na === 'number' && typeof nb === 'number') return Math.abs(na - nb) < 1e-9;
  return na === nb;
}
function v2diffNorm_(x){
  if (x === '' || x === null || x === undefined) return '';
  if (typeof x === 'number') return x;
  if (Object.prototype.toString.call(x) === '[object Date]') return x.getTime();
  return String(x).trim();
}
