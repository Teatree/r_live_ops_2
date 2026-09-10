/************************************************************************************************
 * SimFill.gs - run every ECOGAINS_* spill ONCE, in one execution, and write the answers as values.
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS (measured, 2026-09-10).
 *
 * "Exceeded maximum execution time (line 0)" on a recalculation is not a slow engine, it is the
 * custom-function EXECUTION MODEL. Google gives a custom function 30 seconds, and - this is the
 * part that bites - every invocation is its OWN execution with its OWN cold cache. Context,
 * DataStore and _sheetValsCache are memoized per execution, so they are rebuilt from scratch for
 * every formula on the sheet.
 *
 * On the 2026-09-10 collections workbook:
 *   ONE ECOGAINS_SIM reads 43 sheets, about 137,000 cells, before it computes anything.
 *   The workbook carries 48 ECOGAINS_* formulas.
 *   A full recalculation is therefore ~2,060 getDataRange().getValues() round trips and ~6.6
 *   MILLION cell reads - to produce 48 answers that between them need those 43 sheets ONCE.
 * In Node, where a sheet read is free, one warm ECOGAINS_SIM is ~600ms. In Apps Script the sheet
 * I/O dominates and each formula is doing all of it alone, which is why the failure is not "one
 * formula is slow" but "most of them time out at once, and which ones is different every run".
 *
 * THE FIX IS THE EXECUTION MODEL, NOT THE ARITHMETIC. A menu run gets SIX minutes, and everything
 * inside it shares one cache. The same 48 answers then cost 43 sheet reads instead of 2,060 - a
 * ~48x cut in the only thing that was over budget. Nothing about the model, the numbers or the
 * layout changes: this file calls the SAME custom functions with the SAME arguments the sheet
 * asks for, and writes what they return into the same cells.
 *
 * WHAT IT DOES NOT DO. It does not re-derive the arguments from a layout constant. Each formula is
 * READ, its ECOGAINS_ call is located, its arguments are resolved against the sheet exactly as
 * written (including LET bindings), and anything this file cannot parse with certainty is SKIPPED
 * and named in the toast - the formula is left alone rather than replaced by a number computed
 * from a guess. That is the whole safety story: an unparseable formula stays live and loud.
 *
 * REVERSIBLE. Every fill snapshots the formula it replaced into document properties, so
 * `Restore sim formulas` puts the workbook back exactly as it was. refreshSims_ keeps its own
 * snapshot too, and its MANIFEST HEAL cannot fight this one: heal only restores a formula into a
 * cell that is EMPTY, and a filled anchor holds a value.
 *
 * MENU: EcoGainsSim > Fill all sims (values, no formulas) / Restore sim formulas.
 *
 * FLAGGED, because it crosses a house rule. "Formulas reference data sheets - never bake static
 * values into sheets" is about INPUTS, and it still holds: nothing here touches a config or data
 * sheet. These are computed OUTPUTS, and the workbook already writes three other simulation
 * outputs exactly this way (fillSimPerSegment, SimulateCardCloud, SimulateAlbumCompletion). The
 * cost is real and worth stating plainly: after a fill the numbers no longer follow a config edit
 * on their own. Edit, then run the fill again - the toast prints the timestamp so a stale block
 * is visible rather than merely wrong.
 ************************************************************************************************/

// Build stamp, read back by ECOGAINS_BUILD() like every other engine file.
var SIMFILL_BUILD = 'SimFill.gs          D52  2026-09-10';

/**
 * The sheets to scan. REFRESH_SHEETS (EcoGainsSim_v4.gs) is the list refreshSims_ already
 * maintains, so a sheet added there is filled here without a second edit - but it is NOT enough
 * on its own, for a reason worth writing down:
 *
 *   REFRESH_SHEETS starts with `SHEET`, which is the constant 'EcoGainsSim_HC'. The collections
 *   workbook calls that sheet 'EcoGainsSim' (no suffix). refreshSims_ skips sheets it cannot
 *   find, so on that workbook the main 33-day sim sheet is in NEITHER the MIGRATION pass nor the
 *   MANIFEST HEAL - its formulas still re-run (the nonce bump is workbook-wide) but a deleted
 *   anchor there never comes back and a nonce-less formula there is never migrated. Found
 *   2026-09-10 while building this file; left as a finding rather than silently renamed, because
 *   which name is right is a workbook question.
 *
 * So the list is UNIONED with every sheet the workbook actually has whose name starts with
 * 'EcoGainsSim'. That is derived from the workbook instead of hardcoded per workbook, which is
 * what stops this file from inheriting the same blind spot.
 */
function simFillSheets_(ss){
  var out = (typeof REFRESH_SHEETS !== 'undefined') ? REFRESH_SHEETS.slice()
          : ['EcoGainsSim', 'EcoGainsSim_Daily', 'cal_new', 'ToF', 'MD'];
  function add(n){ if (n && out.indexOf(n) < 0) out.push(n); }
  ['EcoGainsSim', 'EcoGainsSim_so_far', 'EcoGainsSim_HC_7d', 'EcoGainsSim_PlybyPly'].forEach(add);
  try {
    if (ss && typeof ss.getSheets === 'function')
      ss.getSheets().forEach(function(sh){
        var n = sh.getName();
        if (String(n).indexOf('EcoGainsSim') === 0) add(n);
      });
  } catch (e){
    Logger.log('SimFill: could not enumerate sheets (' + e + ') - using the curated list only.');
  }
  return out;
}

// Document-property key prefix for THIS file's snapshot. Deliberately not the one refreshSims_
// uses ('simFormulas.'): that one is rewritten on every refresh, and a restore has to work from
// what the FILL replaced, whenever the fill happened.
var SIMFILL_PROP = 'simFill.';

// Stop and write what is done rather than dying mid-write at the 6-minute kill. Same budget the
// card sim uses, same reason: half a sheet that looks finished is worse than a short one that
// says so.
var SIMFILL_BUDGET_MS = 300000;

// Optional, authored on the sheet: put this label in any cell of a filled sheet and the run
// stamps the cell to its right. Same authored-label-then-value pattern as 'Album % output cell'
// and 'Participation' - an input on the sheet beats a constant in this file. Absent -> nothing is
// written and nothing complains.
var SIMFILL_STAMP_LABEL = 'Sim fill stamp';

// ============================== formula parsing ==============================================
// Small on purpose. Every ECOGAINS_ formula in this workbook is one of three shapes:
//   =ECOGAINS_X(arg, "LITERAL", sim_refresh!$A$1)
//   =LET(name, $B$3, name2, $A$5, ECOGAINS_X(name, name2, sim_refresh!$A$1))
//   =ECOGAINS_X(sim_refresh!$A$1)
// and every argument is a string literal, a number, or an ABSOLUTE reference. The parser handles
// exactly that and refuses anything else - a wrong value written confidently is the failure mode
// worth engineering against here, not an unsupported shape.

/** Split on top-level commas: ignores commas inside quotes and inside nested parentheses. */
function simFillSplit_(s){
  var out = [], depth = 0, inStr = false, start = 0;
  for (var i = 0; i < s.length; i++){
    var ch = s.charAt(i);
    if (inStr){ if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0){ out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map(function(x){ return x.trim(); });
}

/** `NAME(...)` at the head of an expression -> { name, args: 'inner text' }, or null. */
function simFillCallOf_(expr){
  var m = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(expr.trim());
  if (!m) return null;
  var s = expr.trim(), open = m[0].length - 1, depth = 0, inStr = false;
  for (var i = open; i < s.length; i++){
    var ch = s.charAt(i);
    if (inStr){ if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0){
      // Trailing text after the closing paren means this is an expression, not a bare call
      // (`ECOGAINS_SIM(...) * 2`), which this file will not evaluate.
      if (s.slice(i + 1).trim() !== '') return null;
      return { name: m[1].toUpperCase(), args: s.slice(open + 1, i) };
    }
  }
  return null;
}

/**
 * The ECOGAINS_ call a formula ultimately makes, with its argument EXPRESSIONS already resolved
 * through any surrounding LET bindings. Returns { name, args:[expr,...] } or null.
 * LET nests, so this recurses; anything that is not a LET or an ECOGAINS_ call is refused.
 */
function simFillTarget_(expr, binds){
  binds = binds || {};
  var call = simFillCallOf_(expr);
  if (!call) return null;
  if (call.name === 'LET'){
    var parts = simFillSplit_(call.args);
    if (parts.length < 3 || parts.length % 2 === 0) return null;   // pairs + one body
    var b = {};
    for (var k in binds) b[k] = binds[k];
    for (var i = 0; i + 1 < parts.length - 1; i += 2)
      b[parts[i].trim()] = parts[i + 1];
    return simFillTarget_(parts[parts.length - 1], b);
  }
  if (!/^ECOGAINS_[A-Z0-9_]+$/.test(call.name)) return null;
  var raw = call.args.replace(/\s/g, '') === '' ? [] : simFillSplit_(call.args);
  // THE NONCE IS DROPPED, not resolved. Every ECOGAINS_ formula carries a trailing
  // sim_refresh!$A$1 whose only job is to change so Google re-runs the function - no engine
  // function reads it. Resolving it would make the fill depend on a hidden one-cell sheet
  // existing, and refuse a perfectly good anchor when it does not.
  var nonceRe = new RegExp('^' + ((typeof SIM_NONCE_SHEET !== 'undefined') ? SIM_NONCE_SHEET
                                                                           : 'sim_refresh') + '!');
  while (raw.length && nonceRe.test(raw[raw.length - 1].trim())) raw.pop();
  var args = raw.map(function(a){
    // A bare identifier that names a LET binding resolves to that binding's expression. Bindings
    // can reference earlier bindings, so follow the chain (bounded - a cycle is not a formula).
    var x = a, hops = 0;
    while (binds[x] !== undefined && hops++ < 20) x = binds[x].trim();
    return x;
  });
  return { name: call.name, args: args };
}

/**
 * One argument expression -> its VALUE. Literals resolve here; a reference is read off the
 * spreadsheet. `dfltSheet` is the sheet the formula lives on, for a reference with no sheet name.
 * Returns { ok:true, value } or { ok:false, why }. Never guesses.
 */
function simFillResolve_(ss, dfltSheet, expr){
  var s = String(expr == null ? '' : expr).trim();
  if (s === '') return { ok: true, value: '' };
  if (/^".*"$/.test(s)) return { ok: true, value: s.slice(1, -1).replace(/""/g, '"') };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { ok: true, value: Number(s) };
  if (/^(TRUE|FALSE)$/i.test(s)) return { ok: true, value: /^TRUE$/i.test(s) };
  // Sheet!A1 / 'Sheet name'!A1 / A1 - ONE cell. A range would spill into the argument, which none
  // of these functions take, so it is refused rather than silently reduced to its first cell.
  var m = /^(?:('([^']|'')+')|([A-Za-z0-9_ .\-]+))!(.+)$/.exec(s);
  var shName = dfltSheet, a1 = s;
  if (m){
    shName = (m[1] ? m[1].slice(1, -1).replace(/''/g, "'") : m[3]);
    a1 = m[4];
  }
  a1 = a1.trim();
  if (!/^\$?[A-Za-z]{1,3}\$?\d{1,7}$/.test(a1))
    return { ok: false, why: 'not a single-cell reference: ' + s };
  var sh = ss.getSheetByName(shName);
  if (!sh) return { ok: false, why: 'no sheet "' + shName + '" for ' + s };
  // The $ signs are dropped before the read. getRange accepts them, but they carry no meaning to
  // a one-off lookup (absolute vs relative only matters when a formula is COPIED), and stripping
  // them keeps this working against any A1 parser that is stricter than Sheets'.
  try { return { ok: true, value: sh.getRange(a1.replace(/\$/g, '')).getValue() }; }
  catch (e){ return { ok: false, why: 'could not read ' + s + ' (' + e + ')' }; }
}

/** The global function behind an ECOGAINS_ name, or null. Guarded the same way
 *  requireCompanions_ is: all .gs files share one namespace, so a file that was not re-pasted
 *  shows up only as a bare "not defined" at the point of use. The name is already known to match
 *  /^ECOGAINS_[A-Z0-9_]+$/, so nothing else can reach the eval. */
function simFillFn_(name){
  if (!/^ECOGAINS_[A-Z0-9_]+$/.test(name)) return null;
  try { var f = eval(name); return (typeof f === 'function') ? f : null; }
  catch (e){ return null; }
}

// ============================== the anchors ==================================================

/**
 * Every ECOGAINS_ anchor on a sheet: the live formulas, UNION the two snapshots.
 *
 * The union is what makes a second fill work at all. After the first run the cells hold values,
 * so a formula scan finds nothing and a scan-only implementation would quietly report "0 anchors"
 * and do nothing - which looks exactly like success. The snapshots are the memory of where the
 * formulas were.
 */
function simFillAnchors_(ss, sheetName, props){
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  var found = {};                                   // "r,c" -> formula text
  var grid = sh.getDataRange().getFormulas();
  for (var r = 0; r < grid.length; r++)
    for (var c = 0; c < grid[r].length; c++)
      if (grid[r][c] && grid[r][c].indexOf('ECOGAINS_') !== -1)
        found[(r + 1) + ',' + (c + 1)] = grid[r][c];
  [SIMFILL_PROP, 'simFormulas.'].forEach(function(prefix){
    var raw = props.getProperty(prefix + sheetName);
    if (!raw) return;
    try {
      JSON.parse(raw).forEach(function(t){                       // t = [row, col, formula]
        var id = t[0] + ',' + t[1];
        if (!found[id]) found[id] = t[2];
      });
    } catch (e){
      Logger.log('SimFill: unreadable snapshot ' + prefix + sheetName + ' (' + e + ') - ignored.');
    }
  });
  return Object.keys(found).map(function(id){
    var rc = id.split(',');
    return { sheet: sheetName, row: Number(rc[0]), col: Number(rc[1]), formula: found[id] };
  }).sort(function(a, b){ return a.row - b.row || a.col - b.col; });
}

/** Whatever a custom function returned, as a rectangular grid of primitives. A ragged return is
 *  padded rather than refused - setValues demands a rectangle and the engine's rows are uniform,
 *  so padding here can only ever affect a shape that would otherwise throw. */
function simFillGrid_(v){
  if (v == null) return [['']];
  if (!(v instanceof Array)) return [[v]];
  if (!v.length) return [['']];
  var rows = (v[0] instanceof Array) ? v : [v];
  var w = 0;
  rows.forEach(function(r){ if (r.length > w) w = r.length; });
  if (!w) return [['']];
  return rows.map(function(r){
    var out = [];
    for (var i = 0; i < w; i++){
      var x = (r[i] === undefined || r[i] === null) ? '' : r[i];
      // A Date or an object would land on the sheet as something unreadable; the engine returns
      // only numbers and strings, so anything else is a bug worth seeing as text.
      out.push((typeof x === 'object') ? String(x) : x);
    }
    return out;
  });
}

// ============================== the run ======================================================

/**
 * MENU: EcoGainsSim > Fill all sims (values, no formulas).
 *
 * COMPUTE EVERYTHING FIRST, THEN WRITE. A failure while computing therefore leaves the workbook
 * untouched - it does not leave half the blocks as values and half as formulas, which is the one
 * state that would be hard to reason about afterwards. The snapshot is written before the first
 * cell changes, so `Restore sim formulas` works even if the run is killed mid-write.
 */
function fillAllSims(){
  var t0 = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getDocumentProperties();
  var sheets = simFillSheets_(ss);
  var jobs = [], skipped = [], stoppedAt = '';

  // ---- 1. collect every anchor, and snapshot the formulas BEFORE anything is replaced --------
  sheets.forEach(function(name){
    var anchors = simFillAnchors_(ss, name, props);
    if (!anchors.length) return;
    props.setProperty(SIMFILL_PROP + name, JSON.stringify(anchors.map(function(a){
      return [a.row, a.col, a.formula];
    })));
    anchors.forEach(function(a){ jobs.push(a); });
  });
  if (!jobs.length){
    var none = 'No ECOGAINS_ formula found on ' + sheets.join(', ') + ', and no snapshot of one. ' +
               'Nothing to fill.';
    Logger.log(none);
    try { SpreadsheetApp.getActive().toast(none, 'Fill all sims', 10); } catch (e){}
    return 0;
  }

  // ---- 2. compute. ONE execution, so Context / DataStore / _sheetValsCache are built once -----
  var done = [];
  for (var i = 0; i < jobs.length; i++){
    var elapsed = new Date().getTime() - t0;
    if (i > 0 && elapsed + (elapsed / i) > SIMFILL_BUDGET_MS){
      stoppedAt = (jobs.length - i) + ' of ' + jobs.length + ' not computed';
      Logger.log('SimFill TIME BUDGET: stopping after ' + i + ' of ' + jobs.length + ' anchors (' +
                 Math.round(elapsed / 1000) + 's).');
      break;
    }
    var j = jobs[i], at = j.sheet + '!R' + j.row + 'C' + j.col;
    var tgt = simFillTarget_(String(j.formula).replace(/^=/, ''));
    if (!tgt){ skipped.push(at + ' (formula shape not supported)'); continue; }
    var fn = simFillFn_(tgt.name);
    if (!fn){ skipped.push(at + ' (' + tgt.name + ' is not in this project - re-paste its .gs)'); continue; }
    var args = [], bad = null;
    for (var k = 0; k < tgt.args.length; k++){
      var rv = simFillResolve_(ss, j.sheet, tgt.args[k]);
      if (!rv.ok){ bad = rv.why; break; }
      args.push(rv.value);
    }
    if (bad){ skipped.push(at + ' (' + bad + ')'); continue; }
    var grid;
    try {
      grid = simFillGrid_(fn.apply(null, args));
    } catch (e){
      // A throwing formula is a real finding - the live cell would show the same error - so it is
      // reported and its formula LEFT IN PLACE rather than replaced by a stale value.
      skipped.push(at + ' (' + tgt.name + ' threw: ' + e + ')');
      continue;
    }
    done.push({ job: j, grid: grid, fn: tgt.name });
  }

  // ---- 3. write. Clear the anchor first so the old spill collapses, then lay the grid down. ----
  var cells = 0;
  done.forEach(function(d){
    var sh = ss.getSheetByName(d.job.sheet);
    if (!sh) return;
    sh.getRange(d.job.row, d.job.col).clearContent();
    sh.getRange(d.job.row, d.job.col, d.grid.length, d.grid[0].length).setValues(d.grid);
    cells += d.grid.length * d.grid[0].length;
  });

  var stampTxt = 'values filled ' + stamp_() + ' by Fill all sims (NOT live formulas)';
  simFillStamp_(ss, sheets, stampTxt);

  var secs = ((new Date().getTime() - t0) / 1000).toFixed(1);
  var msg = done.length + ' of ' + jobs.length + ' sim blocks filled as values (' +
            cells.toLocaleString() + ' cells) in ' + secs + 's' +
            (stoppedAt ? '  --  STOPPED EARLY on the time budget: ' + stoppedAt +
                         '. Run it again to finish.' : '') +
            (skipped.length ? '  --  ' + skipped.length + ' LEFT AS FORMULAS: ' +
                              skipped.join('; ') : '') +
            '  |  these blocks no longer follow a config edit - re-run this after every edit. ' +
            'EcoGainsSim > Restore sim formulas puts them back.';
  Logger.log(msg);
  try { SpreadsheetApp.getActive().toast(msg, 'Fill all sims', 15); } catch (e){}
  return done.length;
}

/**
 * MENU: EcoGainsSim > Restore sim formulas.
 * Puts every anchor this file replaced back, from the snapshot, and bumps the nonce so they run.
 * Deliberately UNCONDITIONAL: the cell holds a filled value, so waiting for it to be empty (the
 * rule refreshSims_'s heal follows) would restore nothing at all.
 */
function restoreSimFormulas(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getDocumentProperties();
  var n = 0, sheets = [];
  simFillSheets_(ss).forEach(function(name){
    var raw = props.getProperty(SIMFILL_PROP + name);
    if (!raw) return;
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var list;
    try { list = JSON.parse(raw); } catch (e){ return; }
    list.forEach(function(t){
      // Clear the filled block's top-left first: setFormula onto a cell whose neighbours hold the
      // previous fill's values leaves those values sitting under the new spill.
      var rng = sh.getRange(t[0], t[1]);
      rng.clearContent();
      rng.setFormula(t[2]);
      n++;
    });
    if (list.length) sheets.push(name);
  });
  // Bump the nonce so the restored formulas actually run. Guarded: refreshSims_ creates the nonce
  // sheet and takes a document lock, and neither failing is a reason to report a restore that DID
  // happen as an error - the formulas are back either way, they just may need one manual edit to
  // fire.
  if (typeof refreshSims_ === 'function' && n){
    try { refreshSims_(); }
    catch (e){ Logger.log('SimFill: formulas restored, but refreshSims_ failed (' + e +
                          ') - touch any input cell to make them run.'); }
  }
  var msg = n
    ? (n + ' sim formulas restored on ' + sheets.join(', ') + '. They are live again, which also ' +
       'means the 30-second custom-function limit is back.')
    : ('No fill snapshot found - nothing to restore. (Run Fill all sims first, or the formulas ' +
       'were never replaced.)');
  Logger.log(msg);
  try { SpreadsheetApp.getActive().toast(msg, 'Restore sim formulas', 12); } catch (e){}
  return n;
}

/** Write the run stamp beside every authored SIMFILL_STAMP_LABEL on the filled sheets. Optional
 *  by design: no label anywhere -> nothing written, nothing logged as a problem. */
function simFillStamp_(ss, sheets, text){
  sheets.forEach(function(name){
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var v;
    try { v = sh.getDataRange().getValues(); } catch (e){ return; }
    for (var r = 0; r < v.length; r++)
      for (var c = 0; c < v[r].length; c++)
        if (String(v[r][c] == null ? '' : v[r][c]).trim() === SIMFILL_STAMP_LABEL)
          sh.getRange(r + 1, c + 2).setValue(text);
  });
}
