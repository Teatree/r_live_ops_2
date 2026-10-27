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
 * THE THIRD SOURCE OF ANCHORS - THE SHEET'S OWN LABELS (D65, 2026-10-27). A live formula and a
 * properties snapshot are both things a workbook loses: the first fill turns every formula into
 * a value, and a COPY of the workbook (LIVE_OPS_V3) starts with empty document properties. The
 * fill then found "no ECOGAINS_ formula and no snapshot" and did nothing, while the sheet kept
 * showing numbers from whichever engine last filled it. So the display layouts are now READ off
 * the sheets themselves - the segment tag and 'Source | HC ...' header of each 33-day block, the
 * bar row and 'Day' column of the daily view, the SIM PART bars of the ToF sheet, the three bars
 * of the play-by-play sheet, the 'instances | event-days' summary on cal_new - and each anchor's
 * formula is rebuilt in the exact text the builder writes (builders/_build_*.py), so Restore puts
 * back a builder-identical formula and the fill's own parser reads it. Nothing is regenerated:
 * the fill writes the spill into the room the layout leaves and NOTHING else. A spill larger
 * than that room is CLIPPED to it and reported in the end-of-run pop-up (user decision) rather
 * than written over the next block. A sheet whose layout is not recognised is reported, not
 * guessed at. Which sheet gets which rule is decided by its NAME (SIMFILL_FAMILIES): the two
 * names each sheet has had in this project's workbooks are both listed.
 *
 * WRITTEN BY LABEL, NOT BY POSITION (D68, 2026-10-27). The engine returns its rows in
 * CATEGORY_ORDER (or day order) and its columns in RESOURCES order; a sheet built for an older
 * list (LIVE_OPS_V3's EcoGainsSim_so_far and cal_new summary: 25 sources, no 'Season Pass (Paid)'
 * between Season Pass (Free) and Target Day) took that grid one source off from Target Day down,
 * so its IAPs row showed Rainbow Maker. Each located anchor therefore carries a MAP - source label
 * -> sheet row, resource header -> sheet column (day number -> row on the daily view) - and every
 * engine cell goes to the cell its labels name. What the layout has no row or column for is named
 * in the pop-up, never squeezed in; a sheet label the engine does not know is left as it was.
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
var SIMFILL_BUILD = 'SimFill.gs          D68  2026-10-27';

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

// ============================== layout anchors (D65) =========================================
// Sheet NAME -> which layout rule reads it. Both names each sheet has carried are listed; a sheet
// not in this map gets no derived anchors and is named in the pop-up when nothing else found one.
var SIMFILL_FAMILIES = {
  'EcoGainsSim':          { kind: 'grid',  sim: 'ECOGAINS_SIM',       diff: 'ECOGAINS_DIFF' },
  'EcoGainsSim_HC':       { kind: 'grid',  sim: 'ECOGAINS_SIM',       diff: 'ECOGAINS_DIFF' },
  'EcoGainsSim_so_far':   { kind: 'grid',  sim: 'ECOGAINS_SIM_7_DAY', diff: 'ECOGAINS_DIFF_7_DAY' },
  'EcoGainsSim_HC_7d':    { kind: 'grid',  sim: 'ECOGAINS_SIM_7_DAY', diff: 'ECOGAINS_DIFF_7_DAY' },
  'EcoGainsSim_Daily':    { kind: 'daily' },
  'EcoGainsSim_PlybyPly': { kind: 'pbp' },
  'ToF':                  { kind: 'tof' },
  'MD':                   { kind: 'tof' },
  'cal_new':              { kind: 'cal' }
};
var SIMFILL_SEGMENT_TAGS = ['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'];
var SIMFILL_NONCE_REF = 'sim_refresh!$A$1';
// The daily view's bars -> the ECOGAINS_DAILY block key. Matched in THIS order: 'NEW NET' must not
// be read as 'NET', and the two delta bars ('GAINS data - sim', 'NET data - sim') come last.
var SIMFILL_DAILY_BARS = [
  [/CURRENT GAINS/i, 'DATA'], [/NEW GAINS/i, 'NEW'], [/CURRENT SPEND/i, 'SPEND'],
  [/CURRENT NET/i, 'CURNET'], [/NEW NET/i, 'NEWNET'], [/SIM of cal_curr/i, 'CURRENT'],
  [/GAINS/i, 'DATADIFF'], [/NET/i, null]                      // the NET delta is sheet formulas
];
// The ToF sheet's SIM PART bars -> the ECOGAINS_TOF block, and the first cell the spill itself
// writes (the anchor is the row under the bar that holds that word, or is empty).
var SIMFILL_TOF_BARS = [
  [/RUN ECONOMICS/i, 'RUN', 'Segment'], [/REWARD PER RUN/i, 'REWARD', 'Resource'],
  [/GAIN VS SPEND/i, 'GAINSPEND', 'Stage']
];
var SIMFILL_TOF_STOPS = /RUN ECONOMICS|REWARD PER RUN|GAIN VS SPEND|SEGMENT BEHAVIOUR|^SIM PART/i;
// The play-by-play sheet: input labels (column A, prefix match) in the order the three functions
// take them, and the three bars.
var SIMFILL_PBP_INPUTS = ['Calendar', 'Day to Simulate', 'Player Segment', 'Payer', 'Mode',
                          'Luck', 'Seed', 'Levels Played', 'Starting Saga Level'];
var SIMFILL_PBP_BARS = [
  [/^Player Profile/i,            'ECOGAINS_PBP_PROFILE', [2, 3]],
  [/^Active Events on This Day/i, 'ECOGAINS_PBP_EVENTS',  [0, 1, 2, 3, 5]],
  [/^Play-by-Play Sim/i,          'ECOGAINS_PBP',         [0, 1, 2, 3, 4, 5, 6, 7, 8]]
];
var SIMFILL_PBP_STOPS = /^Player Profile|^Active Events on This Day|^Play-by-Play Sim|^Assumptions/i;

function simFillTxt_(x){ return String(x == null ? '' : x).trim(); }
function simFillColA1_(c){
  var sN = '';
  while (c > 0){ var m = (c - 1) % 26; sN = String.fromCharCode(65 + m) + sN; c = (c - m - 1) / 26; }
  return sN;
}
function simFillRef_(r, c){ return '$' + simFillColA1_(c) + '$' + r; }
/** First cell whose trimmed text equals `label` (case-insensitive), searching rows r1..r2 and
 *  columns c1..c2 (1-based, inclusive), or null. */
function simFillFind_(v, label, r1, r2, c1, c2){
  var want = String(label).toLowerCase();
  for (var r = Math.max(1, r1); r <= Math.min(r2, v.length); r++){
    var row = v[r - 1] || [];
    for (var c = Math.max(1, c1); c <= Math.min(c2, row.length); c++)
      if (simFillTxt_(row[c - 1]).toLowerCase() === want) return { r: r, c: c };
  }
  return null;
}
/** Consecutive non-empty cells on row `r` from column `c` (1-based), i.e. a header's width. */
function simFillRunW_(v, r, c){
  var row = v[r - 1] || [], n = 0;
  for (var k = c; k <= row.length && simFillTxt_(row[k - 1]) !== ''; k++) n++;
  return n;
}
function simFillAnchor_(sheet, r, c, formula, rows, cols, how, map){
  return { sheet: sheet, row: r, col: c, formula: formula, room: { rows: rows, cols: cols }, how: how,
           map: map || null };
}
/** label -> sheet row for column `c`: the CONTIGUOUS run of labels from r1 (at most to r2),
 *  first occurrence wins. A block's labels end at the first blank label cell - past it are spacer
 *  rows, leftover values from an older fill, or the legend under the last block, none of which is
 *  a row the engine owns. */
function simFillRowMap_(v, c, r1, r2){
  var m = {};
  for (var r = r1; r <= r2; r++){
    var t = simFillTxt_((v[r - 1] || [])[c - 1]);
    if (t === '') break;
    if (m[t] === undefined) m[t] = r;
  }
  return m;
}
/** header text -> sheet column on row `r` over columns c1..c2. */
function simFillColMap_(v, r, c1, c2){
  var m = {}, row = v[r - 1] || [];
  for (var c = c1; c <= c2; c++){
    var t = simFillTxt_(row[c - 1]);
    if (t !== '' && m[t] === undefined) m[t] = c;
  }
  return m;
}

/**
 * The anchors a sheet's LABELS imply: { anchors: [...], notes: [...] }. Pure over `v` (the
 * sheet's values), so the harness can run it over a builder's own xlsx and compare with the
 * formulas that builder wrote. `maxRows`/`maxCols` bound the room of a block nothing follows.
 */
function simFillLayoutAnchors_(sheetName, v, maxRows, maxCols){
  var fam = SIMFILL_FAMILIES[sheetName], out = [], notes = [];
  if (!fam) return { anchors: out, notes: ['no layout rule for sheet "' + sheetName + '"'] };
  if (!v || !v.length) return { anchors: out, notes: [sheetName + ' is empty'] };
  maxRows = Math.max(maxRows || 0, v.length);
  maxCols = Math.max(maxCols || 0, v.reduce(function(m, row){ return Math.max(m, row.length); }, 0));
  var r, c, row;

  if (fam.kind === 'grid'){
    // Payer: the cell right of the 'Payer' label in the top rows. Segment blocks: a tag cell
    // ('0-9' ...) in one of the first two columns with 'Source' in the same column one row down;
    // the first 'HC' on that header row is the SIM block, the second the DIFF block.
    var pay = simFillFind_(v, 'Payer', 1, 8, 1, 4);
    if (!pay){ notes.push(sheetName + ": no 'Payer' label in rows 1-8"); return { anchors: out, notes: notes }; }
    var payRef = simFillRef_(pay.r, pay.c + 1);
    var tags = [];
    for (r = 1; r <= v.length; r++){
      row = v[r - 1] || [];
      for (c = 1; c <= Math.min(2, row.length); c++){
        if (SIMFILL_SEGMENT_TAGS.indexOf(simFillTxt_(row[c - 1])) < 0) continue;
        var below = v[r] || [];
        if (simFillTxt_(below[c - 1]).toLowerCase() !== 'source') continue;
        tags.push({ r: r, c: c });
      }
    }
    if (!tags.length) notes.push(sheetName + ": no segment block found (a '0-9'.. tag with 'Source' under it)");
    tags.forEach(function(t, i){
      var hdr = t.r + 1, d0 = t.r + 2, hrow = v[hdr - 1] || [];
      var hc = [];
      for (c = 1; c <= hrow.length; c++) if (simFillTxt_(hrow[c - 1]).toUpperCase() === 'HC') hc.push(c);
      if (!hc.length){ notes.push(sheetName + ' row ' + hdr + ": header has no 'HC' column"); return; }
      var roomRows = ((i + 1 < tags.length) ? tags[i + 1].r : maxRows + 1) - d0;
      var segRef = simFillRef_(t.r, t.c);
      var rowMap = simFillRowMap_(v, t.c, d0, d0 + roomRows - 1);
      var w0 = simFillRunW_(v, hdr, hc[0]);
      out.push(simFillAnchor_(sheetName, d0, hc[0],
        '=LET(payer, ' + payRef + ', segment, ' + segRef + ', ' + fam.sim + '(payer, segment, ' + SIMFILL_NONCE_REF + '))',
        roomRows, w0, 'labels',
        { rowKeys: 'CATEGORY_ORDER', colKeys: 'RESOURCES', rows: rowMap, cols: simFillColMap_(v, hdr, hc[0], hc[0] + w0 - 1) }));
      if (hc.length > 1){
        var w1 = simFillRunW_(v, hdr, hc[1]);
        out.push(simFillAnchor_(sheetName, d0, hc[1],
          '=LET(payer, ' + payRef + ', segment, ' + segRef + ', ' + fam.diff + '(payer, segment, ' + SIMFILL_NONCE_REF + '))',
          roomRows, w1, 'labels',
          { rowKeys: 'CATEGORY_ORDER', colKeys: 'RESOURCES', rows: rowMap, cols: simFillColMap_(v, hdr, hc[1], hc[1] + w1 - 1) }));
      }
    });
  } else if (fam.kind === 'daily'){
    var refs = {}, missing = [];
    ['Payer', 'Segment', 'Source'].forEach(function(l){
      var f = simFillFind_(v, l, 1, 8, 1, 4);
      if (f) refs[l] = simFillRef_(f.r, f.c + 1); else missing.push(l);
    });
    if (missing.length){ notes.push(sheetName + ': no ' + missing.join(' / ') + ' label in rows 1-8'); return { anchors: out, notes: notes }; }
    var barRow = 0;
    for (r = 1; r <= v.length && !barRow; r++){
      row = v[r - 1] || [];
      for (c = 1; c <= row.length; c++) if (/CURRENT GAINS/i.test(simFillTxt_(row[c - 1]))){ barRow = r; break; }
    }
    if (!barRow){ notes.push(sheetName + ": no 'CURRENT GAINS' bar"); return { anchors: out, notes: notes }; }
    var hdrRow = barRow + 1, d0d = barRow + 2;
    var dayCell = simFillFind_(v, 'Day', hdrRow, hdrRow, 1, 6);
    var dayCol = dayCell ? dayCell.c : 2;
    var nDays = 0;
    for (r = d0d; r <= v.length; r++){
      var x = (v[r - 1] || [])[dayCol - 1];
      if (typeof x !== 'number' && !/^\d+$/.test(simFillTxt_(x))) break;
      nDays++;
    }
    row = v[barRow - 1] || [];
    var seenKey = {};
    for (c = 1; c <= row.length; c++){
      var txt = simFillTxt_(row[c - 1]);
      if (!txt) continue;
      var key, hit = false;
      for (var k = 0; k < SIMFILL_DAILY_BARS.length; k++)
        if (SIMFILL_DAILY_BARS[k][0].test(txt)){ key = SIMFILL_DAILY_BARS[k][1]; hit = true; break; }
      if (!hit || !key) continue;                           // unknown text, or the formula block
      if (seenKey[key]){ notes.push(sheetName + ': a second "' + txt + '" bar - only the first is filled'); continue; }
      seenKey[key] = true;
      var wd = simFillRunW_(v, hdrRow, c), dayMap = {};
      for (var rd = d0d; rd < d0d + nDays; rd++){
        var dv = (v[rd - 1] || [])[dayCol - 1];
        var dn = String(Math.round(Number(dv)));
        if (dayMap[dn] === undefined) dayMap[dn] = rd;
      }
      out.push(simFillAnchor_(sheetName, d0d, c,
        '=LET(payer,' + refs.Payer + ', segment,' + refs.Segment + ', source,' + refs.Source + ', ' +
        'ECOGAINS_DAILY(payer, segment, source, "' + key + '", ' + SIMFILL_NONCE_REF + '))',
        nDays, wd, 'labels',
        { rowKeys: 'DAYS', colKeys: 'RESOURCES', rows: dayMap, cols: simFillColMap_(v, hdrRow, c, c + wd - 1) }));
    }
    SIMFILL_DAILY_BARS.forEach(function(sp){
      if (sp[1] && !seenKey[sp[1]]) notes.push(sheetName + ': no bar matching ' + String(sp[0]).replace(/^\/|\/i$/g, '') + ' on row ' + barRow + ', so the ' + sp[1] + ' block is not filled');
    });
  } else if (fam.kind === 'tof'){
    var simBar = 0;
    for (r = 1; r <= v.length; r++) if (/^SIM PART/i.test(simFillTxt_((v[r - 1] || [])[0]))){ simBar = r; break; }
    if (!simBar){ notes.push(sheetName + ": no 'SIM PART' bar in column A"); return { anchors: out, notes: notes }; }
    var payT = simFillFind_(v, 'Payer', simBar, v.length, 1, 1);
    if (!payT){ notes.push(sheetName + ": no 'Payer' label under the SIM PART bar"); return { anchors: out, notes: notes }; }
    var payRefT = simFillRef_(payT.r, payT.c + 1), seenBar = {};
    for (r = simBar + 1; r <= v.length; r++){
      var a = simFillTxt_((v[r - 1] || [])[0]), spec = null;
      for (var b = 0; b < SIMFILL_TOF_BARS.length; b++) if (SIMFILL_TOF_BARS[b][0].test(a)){ spec = SIMFILL_TOF_BARS[b]; break; }
      if (!spec) continue;
      if (seenBar[spec[1]]){ notes.push(sheetName + ' row ' + r + ': a second "' + a + '" bar - only the first is filled'); continue; }
      seenBar[spec[1]] = true;
      // the anchor: under the bar, the first row that is empty or already holds the spill's own
      // first cell; note rows (long italic text) in between are stepped over
      var anchorRow = 0;
      for (var q = r + 1; q <= Math.min(r + 8, maxRows); q++){
        var t = simFillTxt_((v[q - 1] || [])[0]);
        if (t === '' || t.toLowerCase() === spec[2].toLowerCase()){ anchorRow = q; break; }
        if (SIMFILL_TOF_STOPS.test(t)) break;
      }
      if (!anchorRow){ notes.push(sheetName + ' row ' + r + ' (' + a + '): no room under the bar'); continue; }
      var stop = maxRows + 1;
      for (var q2 = anchorRow + 1; q2 <= v.length; q2++)
        if (SIMFILL_TOF_STOPS.test(simFillTxt_((v[q2 - 1] || [])[0]))){ stop = q2; break; }
      out.push(simFillAnchor_(sheetName, anchorRow, 1,
        '=ECOGAINS_TOF(' + payRefT + ', "' + spec[1] + '", ' + SIMFILL_NONCE_REF + ')',
        stop - anchorRow, maxCols, 'labels'));
    }
    // a block with no bar is not guessed at - it is named, so the sheet can be given the bar
    SIMFILL_TOF_BARS.forEach(function(sp){
      if (!seenBar[sp[1]]) notes.push(sheetName + ': no bar matching ' + String(sp[0]).replace(/^\/|\/i$/g, '') + ' under SIM PART, so the ' + sp[1] + ' block is not filled - add that bar text in column A above its "' + sp[2] + '" header row');
    });
  } else if (fam.kind === 'pbp'){
    var inRefs = [], miss = [];
    SIMFILL_PBP_INPUTS.forEach(function(l){
      var found = null;
      for (r = 1; r <= Math.min(14, v.length) && !found; r++)
        if (simFillTxt_((v[r - 1] || [])[0]).toLowerCase().indexOf(l.toLowerCase()) === 0) found = r;
      if (found) inRefs.push(simFillRef_(found, 2)); else { inRefs.push(null); miss.push(l); }
    });
    for (r = 1; r <= v.length; r++){
      var aP = simFillTxt_((v[r - 1] || [])[0]), specP = null;
      for (var bp = 0; bp < SIMFILL_PBP_BARS.length; bp++) if (SIMFILL_PBP_BARS[bp][0].test(aP)){ specP = SIMFILL_PBP_BARS[bp]; break; }
      if (!specP) continue;
      var args = specP[2].map(function(i){ return inRefs[i]; });
      if (args.some(function(x){ return !x; })){ notes.push(sheetName + ' (' + aP.slice(0, 30) + '): input label(s) missing: ' + miss.join(', ')); continue; }
      var stopP = maxRows + 1;
      for (var q3 = r + 2; q3 <= v.length; q3++)
        if (SIMFILL_PBP_STOPS.test(simFillTxt_((v[q3 - 1] || [])[0]))){ stopP = q3; break; }
      out.push(simFillAnchor_(sheetName, r + 1, 1, '=' + specP[1] + '(' + args.join(',') + ')',
        stopP - (r + 1), maxCols, 'labels'));
    }
    if (!out.length) notes.push(sheetName + ': none of the three bars found (Player Profile / Active Events / Play-by-Play Sim)');
  } else if (fam.kind === 'cal'){
    // the 'Summary of old vs new' block: a header row with 'instances' and 'event-days', the
    // category names in the column under 'source', the spill at the first 'instances' column
    var hdrC = null;
    for (r = 1; r <= v.length && !hdrC; r++){
      row = v[r - 1] || [];
      var inst = -1, src = -1;
      for (c = 1; c <= row.length; c++){
        var tt = simFillTxt_(row[c - 1]).toLowerCase();
        if (tt === 'instances' && inst < 0) inst = c;
        if (tt === 'source' && src < 0) src = c;
      }
      if (inst > 0 && src > 0) hdrC = { r: r, inst: inst, src: src };
    }
    if (!hdrC){ notes.push(sheetName + ": no 'source | instances | event-days' summary header"); return { anchors: out, notes: notes }; }
    var first = hdrC.r + 1, nCat = 0;
    for (r = first; r <= v.length && simFillTxt_((v[r - 1] || [])[hdrC.src - 1]) !== ''; r++) nCat++;
    var hrowC = v[hdrC.r - 1] || [], lastHdr = hdrC.inst;
    for (c = hdrC.inst; c <= hrowC.length; c++) if (simFillTxt_(hrowC[c - 1]) !== '') lastHdr = c;
    out.push(simFillAnchor_(sheetName, first, hdrC.inst,
      '=ECOGAINS_CAL_COUNTS(' + SIMFILL_NONCE_REF + ')', nCat, lastHdr - hdrC.inst + 1, 'labels',
      { rowKeys: 'CATEGORY_ORDER', colKeys: null, rows: simFillRowMap_(v, hdrC.src, first, first + nCat - 1) }));
  }
  return { anchors: out, notes: notes };
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
function simFillAnchors_(ss, sheetName, props, notes){
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return [];
  var found = {}, how = {};                         // "r,c" -> formula text / where it came from
  var grid = sh.getDataRange().getFormulas();
  for (var r = 0; r < grid.length; r++)
    for (var c = 0; c < grid[r].length; c++)
      if (grid[r][c] && grid[r][c].indexOf('ECOGAINS_') !== -1){
        found[(r + 1) + ',' + (c + 1)] = grid[r][c]; how[(r + 1) + ',' + (c + 1)] = 'formula';
      }
  [SIMFILL_PROP, 'simFormulas.'].forEach(function(prefix){
    var raw = props.getProperty(prefix + sheetName);
    if (!raw) return;
    try {
      JSON.parse(raw).forEach(function(t){                       // t = [row, col, formula]
        var id = t[0] + ',' + t[1];
        if (!found[id]){ found[id] = t[2]; how[id] = 'snapshot'; }
      });
    } catch (e){
      Logger.log('SimFill: unreadable snapshot ' + prefix + sheetName + ' (' + e + ') - ignored.');
    }
  });
  // D65: the sheet's own labels. Anything the first two sources did not name is taken from here,
  // and every anchor gets the ROOM the layout leaves for it, so an oversize spill is clipped and
  // reported instead of written over the block below.
  var room = {}, map = {};
  var lay = simFillLayoutAnchors_(sheetName, sh.getDataRange().getValues(), sh.getMaxRows(), sh.getMaxColumns());
  lay.anchors.forEach(function(a){
    var id = a.row + ',' + a.col;
    room[id] = a.room; map[id] = a.map;
    if (!found[id]){ found[id] = a.formula; how[id] = 'labels'; }
  });
  if (notes) lay.notes.forEach(function(n){ notes.push(n); });
  return Object.keys(found).map(function(id){
    var rc = id.split(',');
    return { sheet: sheetName, row: Number(rc[0]), col: Number(rc[1]), formula: found[id],
             how: how[id], room: room[id] || null, map: map[id] || null };
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
  var jobs = [], skipped = [], stoppedAt = '', notes = [], derived = 0, present = [];

  // ---- 1. collect every anchor, and snapshot the formulas BEFORE anything is replaced --------
  sheets.forEach(function(name){
    if (!ss.getSheetByName(name)) return;
    present.push(name);
    var anchors = simFillAnchors_(ss, name, props, notes);
    if (!anchors.length) return;
    props.setProperty(SIMFILL_PROP + name, JSON.stringify(anchors.map(function(a){
      return [a.row, a.col, a.formula];
    })));
    anchors.forEach(function(a){ jobs.push(a); if (a.how === 'labels') derived++; });
  });
  if (!jobs.length){
    var none = 'No ECOGAINS_ formula found on ' + present.join(', ') + ', no snapshot of one, and ' +
               'no layout the labels could be read off (' + notes.join('; ') + '). Nothing to fill.';
    Logger.log(none);
    try { SpreadsheetApp.getActive().toast(none, 'Fill all sims', 10); } catch (e){}
    simFillPopup_('Fill all sims', none);
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
  // D65: a spill is written into the ROOM its layout leaves and nothing more. The rows past the
  // next block (or the columns past the header) are dropped and the clip is reported - the user
  // decides whether to widen the sheet, never this file.
  var cells = 0, overflow = [], perSheet = {}, unplaced = [], stale = [], tails = [];
  done.forEach(function(d){
    var sh = ss.getSheetByName(d.job.sheet);
    if (!sh) return;
    var grid = d.grid, room = d.job.room, at = d.job.sheet + '!' + simFillColA1_(d.job.col) + d.job.row;
    // D68: BY LABEL where the layout gave a map and the grid has the engine's own shape
    var placed = simFillPlace_(d.job, grid);
    if (placed){
      var nw = simFillWriteMapped_(sh, d.job, placed);
      cells += nw;
      perSheet[d.job.sheet] = (perSheet[d.job.sheet] || 0) + 1;
      if (placed.missRows.length || placed.missCols.length)
        unplaced.push(at + ' (' + d.fn + '): ' +
          (placed.missRows.length ? 'no row for ' + placed.missRows.join(', ') : '') +
          (placed.missRows.length && placed.missCols.length ? '; ' : '') +
          (placed.missCols.length ? 'no column for ' + placed.missCols.join(', ') : ''));
      if (placed.staleRows.length)
        stale.push(at + ': ' + placed.staleRows.map(function(x){ return '"' + x + '"'; }).join(', '));
      return;
    }
    if (room && (grid.length > room.rows || grid[0].length > room.cols)){
      overflow.push(at + ': ' + d.fn + ' returns ' + grid.length + ' x ' + grid[0].length +
                    ' but the layout has room for ' + room.rows + ' x ' + room.cols +
                    ' - the rest was NOT written');
      grid = grid.slice(0, Math.max(0, Math.min(grid.length, room.rows)))
                 .map(function(rw){ return rw.slice(0, Math.max(0, Math.min(rw.length, room.cols))); });
      if (!grid.length || !grid[0].length) return;
    }
    sh.getRange(d.job.row, d.job.col).clearContent();
    sh.getRange(d.job.row, d.job.col, grid.length, grid[0].length).setValues(grid);
    cells += grid.length * grid[0].length;
    perSheet[d.job.sheet] = (perSheet[d.job.sheet] || 0) + 1;
    // D68: a table that came back SHORTER than last time leaves its old tail under it (ToF's stage
    // table on LIVE_OPS_V3 still lists stages to 60). A live spill would have shrunk, so the fill
    // does the same: the contiguous non-empty rows directly below the new grid, inside its room
    // and its columns, up to the first blank row - never a row holding a formula, never past it.
    if (d.job.room){
      var tail = simFillTail_(sh, d.job.row + grid.length, d.job.col, grid[0].length,
                              d.job.row + d.job.room.rows - 1, grid[0][0]);
      if (tail) tails.push(at + ': ' + tail + ' leftover row(s) of the previous, longer table cleared');
    }
  });

  var stampTxt = 'values filled ' + stamp_() + ' by Fill all sims (NOT live formulas)';
  simFillStamp_(ss, sheets, stampTxt);

  // ---- 4. Sim per Segment, in the SAME execution (user decision 2026-10-27): its reads share
  // this run's caches, and one menu item leaves no sheet behind.
  var spsLine = '';
  if (typeof fillSimPerSegment === 'function'){
    try { fillSimPerSegment(); spsLine = 'Sim per Segment filled.'; }
    catch (e){ spsLine = 'Sim per Segment NOT filled: ' + e; }
  }

  var secs = ((new Date().getTime() - t0) / 1000).toFixed(1);
  var msg = done.length + ' of ' + jobs.length + ' sim blocks filled as values (' +
            cells.toLocaleString() + ' cells) in ' + secs + 's' +
            (derived ? ' - ' + derived + ' anchor(s) located from the sheet labels' : '') +
            (stoppedAt ? '  --  STOPPED EARLY on the time budget: ' + stoppedAt +
                         '. Run it again to finish.' : '') +
            (unplaced.length ? '  --  ' + unplaced.length + ' block(s) with rows/columns NOT ON THE SHEET: ' + unplaced.join('; ') : '') +
            (overflow.length ? '  --  ' + overflow.length + ' CLIPPED: ' + overflow.join('; ') : '') +
            (skipped.length ? '  --  ' + skipped.length + ' LEFT AS FORMULAS: ' +
                              skipped.join('; ') : '') +
            (notes.length ? '  --  not located: ' + notes.join('; ') : '') +
            (spsLine ? '  |  ' + spsLine : '') +
            '  |  these blocks no longer follow a config edit - re-run this after every edit. ' +
            'EcoGainsSim > Restore sim formulas puts them back.';
  Logger.log(msg);
  try { SpreadsheetApp.getActive().toast(msg, 'Fill all sims', 15); } catch (e){}
  // The pop-up (user decision): the toast vanishes in 15s and a clipped block looks filled.
  var lines = [done.length + ' of ' + jobs.length + ' sim blocks filled as values in ' + secs + 's.'];
  Object.keys(perSheet).forEach(function(n){ lines.push('   ' + n + ': ' + perSheet[n] + ' block(s)'); });
  if (derived) lines.push(derived + ' anchor(s) were located from the sheet labels (no formula, no snapshot).');
  if (unplaced.length) lines.push('', 'NOT ON THE SHEET - the engine has rows / columns this layout has no label for (not written):',
                                  '   ' + unplaced.join('\n   '));
  if (stale.length) lines.push('', 'Labels on the sheet the engine does not produce (left as they were):', '   ' + stale.join('\n   '));
  if (overflow.length) lines.push('', 'CLIPPED - more values than the layout has room for:', '   ' + overflow.join('\n   '));
  if (tails.length) lines.push('', 'Shorter than last time (old rows under the table cleared):', '   ' + tails.join('\n   '));
  if (skipped.length) lines.push('', 'Left as formulas:', '   ' + skipped.join('\n   '));
  if (stoppedAt) lines.push('', 'STOPPED EARLY on the time budget: ' + stoppedAt + '. Run it again to finish.');
  if (notes.length) lines.push('', 'Not located:', '   ' + notes.join('\n   '));
  if (spsLine) lines.push('', spsLine);
  lines.push('', 'These blocks no longer follow a config edit - re-run this after every edit.');
  simFillPopup_('Fill all sims', lines.join('\n'));
  return done.length;
}

/**
 * D68: where each cell of an engine grid goes, by label. Returns null when the job has no map, or
 * the grid is not the engine's own shape (an error message, a resized list) - the caller then
 * places it positionally inside the room, as before.
 *   { cells: [[sheetRow, sheetCol, value], ...], missRows, missCols, staleRows }
 */
function simFillPlace_(job, grid){
  var m = job && job.map;
  if (!m) return null;
  var rowKeys;
  if (m.rowKeys === 'CATEGORY_ORDER') rowKeys = (typeof CATEGORY_ORDER !== 'undefined') ? CATEGORY_ORDER : null;
  else if (m.rowKeys === 'DAYS'){ rowKeys = []; for (var k = 1; k <= grid.length; k++) rowKeys.push(String(k)); }
  if (!rowKeys || rowKeys.length !== grid.length) return null;
  var colKeys = null;
  if (m.colKeys === 'RESOURCES'){
    colKeys = (typeof RESOURCES !== 'undefined') ? RESOURCES : null;
    if (!colKeys || colKeys.length !== grid[0].length) return null;
  }
  var cells = [], missRows = [], missCols = [], seenRow = {}, colOf = [];
  for (var j = 0; j < grid[0].length; j++){
    var cc = colKeys ? m.cols[colKeys[j]] : ((job.room && j >= job.room.cols) ? undefined : job.col + j);
    colOf.push(cc);
    if (cc === undefined && colKeys) missCols.push(colKeys[j]);
  }
  for (var i = 0; i < grid.length; i++){
    var rr = m.rows[rowKeys[i]];
    if (rr === undefined){ if (m.rowKeys !== 'DAYS') missRows.push(rowKeys[i]); continue; }
    seenRow[rowKeys[i]] = true;
    for (var jj = 0; jj < grid[i].length; jj++)
      if (colOf[jj] !== undefined) cells.push([rr, colOf[jj], grid[i][jj]]);
  }
  if (m.rowKeys === 'DAYS'){
    var nd = 0;
    for (var ii = 0; ii < rowKeys.length; ii++) if (m.rows[rowKeys[ii]] === undefined) nd++;
    if (nd) missRows.push(nd + ' day(s) past the sheet\'s last Day row');
  }
  if (!colKeys && job.room && grid[0].length > job.room.cols)
    missCols.push((grid[0].length - job.room.cols) + ' column(s) past the header');
  var staleRows = [], known = {};
  rowKeys.forEach(function(x){ known[x] = true; });
  Object.keys(m.rows).forEach(function(lab){ if (!known[lab]) staleRows.push(lab); });
  return { cells: cells, missRows: missRows, missCols: missCols, staleRows: staleRows };
}

/** Write placed cells: ONE read and ONE write over their bounding rectangle, every cell in it that
 *  the engine does not own written back exactly as it was - unless one of those holds a FORMULA,
 *  which a values write would destroy; then it goes row by row in contiguous runs. A live spill at
 *  the anchor is collapsed first. Returns the number of cells written. */
function simFillWriteMapped_(sh, job, placed){
  var anchor = sh.getRange(job.row, job.col);
  if (anchor.getFormula()) anchor.clearContent();
  if (!placed.cells.length) return 0;
  var r1 = Infinity, r2 = -1, c1 = Infinity, c2 = -1;
  placed.cells.forEach(function(x){
    if (x[0] < r1) r1 = x[0]; if (x[0] > r2) r2 = x[0];
    if (x[1] < c1) c1 = x[1]; if (x[1] > c2) c2 = x[1];
  });
  var rect = sh.getRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
  var vals = rect.getValues(), fml = rect.getFormulas(), own = {};
  placed.cells.forEach(function(x){ own[x[0] + ',' + x[1]] = true; vals[x[0] - r1][x[1] - c1] = x[2]; });
  var foreignFormula = false;
  for (var r = 0; r < fml.length && !foreignFormula; r++)
    for (var c = 0; c < fml[r].length; c++)
      if (fml[r][c] && !own[(r1 + r) + ',' + (c1 + c)]){ foreignFormula = true; break; }
  if (!foreignFormula){ rect.setValues(vals); return placed.cells.length; }
  // row by row, contiguous runs of owned cells only
  var byRow = {};
  placed.cells.forEach(function(x){ (byRow[x[0]] = byRow[x[0]] || []).push(x); });
  Object.keys(byRow).forEach(function(rk){
    var xs = byRow[rk].sort(function(a, b){ return a[1] - b[1]; });
    var start = 0;
    for (var q = 1; q <= xs.length; q++){
      if (q < xs.length && xs[q][1] === xs[q - 1][1] + 1) continue;
      var run = xs.slice(start, q);
      sh.getRange(Number(rk), run[0][1], 1, run.length).setValues([run.map(function(x){ return x[2]; })]);
      start = q;
    }
  });
  return placed.cells.length;
}

/** Clear the leftover tail of a table: rows `r0`.. (at most `rMax`) in columns c0..c0+w-1, while
 *  each row has at least one value and no formula. Stops at the first blank row, and at a row that
 *  STARTS A TABLE - its first cell is this table's own header word (`head`, a stacked older copy),
 *  one of the spills' header words, or a bar - because blocks butted together with no blank row
 *  between them are separate tables, not one table's tail (LIVE_OPS_V3's ToF: the stage table
 *  sits directly under REWARD PER RUN). Returns the number of rows cleared (0 -> nothing done). */
var SIMFILL_HEADER_WORDS = ['segment', 'resource', 'stage', 'row', 'event', 'source', 'day', 'metric'];
function simFillTail_(sh, r0, c0, w, rMax, head){
  if (!(rMax >= r0) || !(w > 0)) return 0;
  var n = Math.min(rMax, sh.getMaxRows()) - r0 + 1;
  if (!(n > 0)) return 0;
  var rng = sh.getRange(r0, c0, n, w), vals = rng.getValues(), fml = rng.getFormulas(), k = 0;
  var headLc = simFillTxt_(head).toLowerCase();
  for (; k < vals.length; k++){
    var any = false, hasF = false;
    for (var c = 0; c < w; c++){
      if (fml[k][c]) hasF = true;
      if (vals[k][c] !== '' && vals[k][c] != null) any = true;
    }
    if (!any || hasF) break;
    var first = simFillTxt_(vals[k][0]), firstLc = first.toLowerCase();
    if ((headLc && firstLc === headLc) || SIMFILL_HEADER_WORDS.indexOf(firstLc) >= 0 ||
        SIMFILL_TOF_STOPS.test(first) || SIMFILL_PBP_STOPS.test(first)) break;
  }
  if (k > 0) sh.getRange(r0, c0, k, w).clearContent();
  return k;
}

/** The end-of-run pop-up. A menu run has a UI; a trigger or the harness does not, and neither
 *  should cost the run its result - so it falls back to the log. */
function simFillPopup_(title, text){
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert(title, text, ui.ButtonSet.OK);
  } catch (e){ Logger.log(title + ': ' + text); }
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
