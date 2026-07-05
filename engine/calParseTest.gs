/************************************************************************************************
 * calParseTest.gs — verification harness for the calendar merge parser.
 * ---------------------------------------------------------------------------------------------
 * THE RULE: timing is read from the MERGES, and neighbours are NEVER collapsed.
 *   • each MERGED range           = ONE instance, duration = its column width
 *   • each filled, NON-merged cell = ONE 1-day instance
 *   • column -> window day:        day = column_index - 1   (col B = day 1 ... col AH = day 33)
 *
 * IMPORTANT: this file deliberately defines NO parser and NO calendar constants of its own —
 * it calls parseCalendarInstances_ from EcoGainsSim_v4.gs. Apps Script files share one global
 * namespace, so an earlier version of this harness that re-declared parseCalendarInstances_
 * (returning {start, end, dur} without a days list) silently OVERRODE the engine's parser and
 * broke the sims (zero reach / 'Cannot read properties of undefined (reading length)').
 * If you ever see that again, check for duplicate function names across project files.
 *
 * HOW TO RUN:
 *   A) Put  =TEST_CAL_NEW()  (or =TEST_CAL_CURR()) in an empty cell -> spills a table
 *      (event | instances | durations | window days).
 *   B) From the editor, Run writeCalNewTest() -> writes the same table to sheet 'cal_new_test'.
 * Note: the engine prefers the hidden 'cal_parsed' sheet when present (menu ▸ Precompute
 * calendars), so this test shows exactly what the sims will use.
 ************************************************************************************************/

/** @customfunction */
function TEST_CAL_NEW(){ return calParseTable_('cal_new'); }
/** @customfunction */
function TEST_CAL_CURR(){ return calParseTable_('cal_curr'); }

function writeCalNewTest(){
  var table = calParseTable_('cal_new');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('cal_new_test') || ss.insertSheet('cal_new_test');
  sh.clearContents();
  sh.getRange(1, 1, table.length, table[0].length).setValues(table);
  sh.getRange(1, 1, 1, table[0].length).setFontWeight('bold');
}

// Builds the display table from the ENGINE's parser output ({start, dur, days[]} instances).
function calParseTable_(sheetName){
  var inst = parseCalendarInstances_(sheetName);            // EcoGainsSim_v4.gs
  var out = [['event', 'instances', 'durations (days)', 'window days']];
  Object.keys(inst).sort().forEach(function(name){
    var arr = inst[name].slice().sort(function(a, b){ return a.start - b.start; });
    var durs = arr.map(function(x){ return x.dur; })
                  .filter(function(v, i, a){ return a.indexOf(v) === i; })
                  .sort(function(a, b){ return a - b; });
    var days = arr.map(function(x){
      var end = x.start + x.dur - 1;
      return x.start === end ? ('d' + x.start) : ('d' + x.start + '-' + end);
    }).join(', ');
    out.push([name, arr.length, durs.join(' / '), days]);
  });
  return out;
}
