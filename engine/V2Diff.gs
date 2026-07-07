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
 * Re-run any time. It is non-destructive: it preserves every other cell's existing font colour and
 * only turns changed cells red. Use "Clear v2 config diff marks" to reset the compared region's
 * text to black (note: that resets ALL font colours in the config region, intentional ones too).
 ************************************************************************************************/

// base sheet -> _v2 sheet. Every config sheet with a _v2 twin.
var V2DIFF_PAIRS = [
  ['c_saga','c_saga_v2'], ['c_day','c_day_v2'], ['RR','RR_v2'], ['J','J_v2'],
  ['HH','HH_v2'], ['BB','BB_v2'], ['Ki','Ki_v2'], ['NS','NS_v2'], ['Ph','Ph_v2'],
  ['F','F_v2'], ['Race','Race_v2'], ['TaD','TaD_v2']
];
// base sheets whose _v2 is a structural rewrite (not cell-aligned) -> skip the cell diff.
// Empty now: c_saga was re-aligned with c_saga_v2, so it is compared like every other pair.
var V2DIFF_STRUCTURAL_SKIP = [];
var V2DIFF_RED = '#FF0000';

// ---- menu entry point: mark the diffs ----
function markV2ConfigDiffs(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var total = 0, changed = [], zero = [], missing = [], skipped = [];
  V2DIFF_PAIRS.forEach(function(pair){
    var base = pair[0], v2 = pair[1];
    if (V2DIFF_STRUCTURAL_SKIP.indexOf(base) !== -1){ skipped.push(base); return; }
    var bs = ss.getSheetByName(base), vs = ss.getSheetByName(v2);
    if (!bs || !vs){ missing.push(base + '/' + v2); return; }

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
  if (zero.length)    lines.push('', 'No changes: ' + zero.join(', '));
  if (skipped.length) lines.push('Skipped (structural rewrite): ' + skipped.join(', '));
  if (missing.length) lines.push('Missing sheet(s): ' + missing.join(', '));

  var ui = SpreadsheetApp.getUi();
  ui.alert('v2 config diff — old vs new', lines.join('\n'), ui.ButtonSet.OK);
}

// ---- menu entry point: clear the marks (reset compared region text to black) ----
function clearV2ConfigDiffs(){
  var ss = SpreadsheetApp.getActiveSpreadsheet(), cleared = 0;
  V2DIFF_PAIRS.forEach(function(pair){
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
