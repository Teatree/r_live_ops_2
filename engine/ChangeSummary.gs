/************************************************************************************************
 * ChangeSummary.gs - the 'change_summary' sheet: what the redesign does to every gain source.
 * ---------------------------------------------------------------------------------------------
 * REQUIRES EcoGainsSim_v4.gs (Context, CATEGORY_ORDER, RESOURCES, measuredRow_, resultRow_, sheetVals_ ...).
 * Optional: SimPerSegmentFill.gs (spsGroupOf_ - the PAID / ADS / CORE / META column; without it every source
 * reads META). NOT a custom function: menu EcoGainsSim > Fill change summary, one execution (~1-3 minutes, the
 * same engine pass as Fill Sim per Segment).
 *
 * SIX TABLES side by side, left to right:
 *   CURRENT gain        measuredRow_ - the control: the export (data_gains, the ANCHOR_ARM rows) over its own dates,
 *                       scaled to the counted window by activity (D79), plus the engine's anchors for what the
 *                       export cannot see (Season Pass (Paid), envelopes it does not carry ...). The same numbers
 *                       ECOGAINS_DIFF subtracts.
 *   CURRENT share       each source's share of the block total, per resource (sources sum to 100%)
 *   NEW gain            resultRow_ - cal_new on the _v2 configs, the same numbers as ECOGAINS_SIM
 *   NEW share
 *   NEW vs CURRENT %    new / current - 1 ('new' where the current gain is 0)
 *   share change (pp)   new share - current share, in percentage points
 * VALUE = every resource x its item_vals row-3 price (envelopes priced; ToF tickets at the 'ToF_Value' cell, the
 * only name that row gives them; SPT x2 is 0 there). Inside a block the rows are sorted by CURRENT value, TOTAL
 * first.
 *
 * ROWS: one band per (segment, payer) block - {All, 0-9 .. 100+} x {All payers, NONPAYER, PAYER}, All players
 * first. A merged block is the unique_players-weighted mean of its cells (the Sim per Segment rule); a single
 * cell is the engine's row as is. The 18 blocks are written twice: the window total, then the daily average
 * (window total / window days). Every row carries Period / Segment / Payer / Group / Model, every table repeats
 * the Source name (no frozen panes on a sim sheet), and a filter sits on the header row.
 *
 * A category the export carries that is not an engine row (Col - Chests on LIVE_OPS_V3) is listed with Model
 * 'export only': CURRENT from the export, NEW = CURRENT. A. 0 players are not included (no behaviour telemetry).
 *
 * VALUES, NOT FORMULAS (deliberate): the sheet is meant to be filtered and re-sorted, and a share or Δ formula
 * pointing at its block's TOTAL row breaks the moment a sort moves either row. Re-run the menu item after an edit.
 ************************************************************************************************/

// Build stamp, read back by ECOGAINS_BUILD().
var CHANGESUM_BUILD = 'ChangeSummary.gs  D85  2026-11-02';

var CS_SHEET = 'change_summary';
var CS_SEGMENTS = ['0-9', '10-19', '20-39', '40-99', '100+'];
var CS_PAYERS = ['NONPAYER', 'PAYER'];
var CS_HEADER_ROW = 5;                 // the filter row; rows 1-4 are the title, two notes and the table bars
var CS_KEYS = ['Period', 'Segment', 'Payer', 'Group', 'Model'];
var CS_TABLES = [
  { key: 'cur',   title: 'CURRENT - gain per earner',                     fill: '#CFE2F3', tot: '#E3EDF8' },
  { key: 'curSh', title: 'CURRENT - share of the block total',           fill: '#CFE2F3', tot: '#E3EDF8' },
  { key: 'nw',    title: 'NEW - gain per earner',                         fill: '#E2EFDA', tot: '#EEF6E9' },
  { key: 'nwSh',  title: 'NEW - share of the block total',               fill: '#E2EFDA', tot: '#EEF6E9' },
  { key: 'pct',   title: 'NEW vs CURRENT - % change in gain',            fill: '#FCE5CD', tot: '#FDF1E3' },
  { key: 'pp',    title: 'NEW vs CURRENT - share change (percentage points)', fill: '#FCE5CD', tot: '#FDF1E3' }
];
var CS_EPS = 1e-12;

function fillChangeSummary(){
  if (typeof Context === 'undefined' || typeof resultRow_ !== 'function')
    throw new Error('Fill change summary needs EcoGainsSim_v4.gs in this Apps Script project.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CS_SHEET) || ss.insertSheet(CS_SHEET);
  var ctx = Context.get();
  var days = (typeof windowDays_ === 'function') ? windowDays_() : 33;
  var prices = csPrices_();
  var extras = csExportOnlyCats_();
  var cats = CATEGORY_ORDER.concat(extras);
  var cells = csCellRows_(ctx, extras);
  var blocks = csBlocks_(cells, cats);
  var grp = (typeof spsGroupOf_ === 'function') ? spsGroupOf_().map : {};
  var dflt = (typeof SPS_DEFAULT_GROUP !== 'undefined') ? SPS_DEFAULT_GROUP : 'META';
  var groupOf = function(cat){ return grp[cat] || dflt; };

  var L = csLayout_();
  var head = csHeadRows_(L, ctx, days, extras, ss);
  var body = [], marks = [];                          // marks: {row (0-based in body), total, section}
  [{ label: days + ' days', k: 1, fmtAbs: '#,##0.00' },
   { label: 'Daily avg', k: 1 / days, fmtAbs: '#,##0.000' }].forEach(function(per, pi){
    blocks.forEach(function(b, bi){
      var rows = csBlockRows_(b, per, prices, groupOf, L);
      rows.forEach(function(r, ri){ marks.push({ total: ri === 0, first: ri === 0 && bi === 0 && pi > 0, fmtAbs: per.fmtAbs }); body.push(r); });
    });
  });
  var grid = head.concat(body), nRows = grid.length, nCols = L.nCols;

  // ---- write: one rectangle of values, then the formats as grids of the same shape
  var oldF = sh.getFilter && sh.getFilter();
  if (oldF) oldF.remove();
  sh.clear();
  if (sh.clearConditionalFormatRules) sh.clearConditionalFormatRules();
  if (sh.getMaxColumns() < nCols) sh.insertColumnsAfter(sh.getMaxColumns(), nCols - sh.getMaxColumns());
  if (sh.getMaxRows() < nRows) sh.insertRowsAfter(sh.getMaxRows(), nRows - sh.getMaxRows());
  var rng = sh.getRange(1, 1, nRows, nCols);
  var fmt = [], bg = [], fw = [];
  grid.forEach(function(row, r){
    var f = [], b = [], w = [];
    for (var c = 0; c < nCols; c++){
      var col = L.cols[c];
      if (r < CS_HEADER_ROW){
        f.push('@');
        b.push(r >= 3 && col.t != null ? CS_TABLES[col.t].fill : (r >= 3 && col.kind === 'key' ? '#D9D9D9' : '#FFFFFF'));
        w.push(r === 0 || r >= 3 ? 'bold' : 'normal');
        continue;
      }
      var m = marks[r - CS_HEADER_ROW];
      f.push(csFmt_(col, m.fmtAbs));
      b.push(m.total ? (col.t != null ? CS_TABLES[col.t].tot : (col.kind === 'key' ? '#EFEFEF' : '#FFFFFF')) : '#FFFFFF');
      w.push(m.total ? 'bold' : 'normal');
    }
    fmt.push(f); bg.push(b); fw.push(w);
  });
  // formats BEFORE values: a label such as '10-19' written into an unformatted cell is read as a date
  rng.setNumberFormats(fmt);
  rng.setValues(grid);
  rng.setBackgrounds(bg);
  rng.setFontWeights(fw);
  rng.setFontFamily('Arial');
  rng.setFontSize(10);
  sh.getRange(1, 1).setFontSize(14);
  sh.getRange(2, 1, 2, 1).setFontColor('#555555');
  sh.getRange(CS_HEADER_ROW, 1, 1, nCols).setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.setRowHeight(CS_HEADER_ROW, 36);
  // a band per block: its TOTAL row opens it with a rule across the whole width; the daily section a heavier one
  marks.forEach(function(m, i){
    if (!m.total) return;
    sh.getRange(CS_HEADER_ROW + 1 + i, 1, 1, nCols)
      .setBorder(true, null, null, null, null, null, m.first ? '#000000' : '#999999',
                 m.first ? SpreadsheetApp.BorderStyle.SOLID_THICK : SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  });
  L.cols.forEach(function(col, c){ sh.setColumnWidth(c + 1, col.width); });
  if (sh.setHiddenGridlines) sh.setHiddenGridlines(true);
  sh.setConditionalFormatRules(csRules_(sh, L, nRows));
  sh.getRange(CS_HEADER_ROW, 1, nRows - CS_HEADER_ROW + 1, nCols).createFilter();

  var msg = 'change_summary: ' + blocks.length + ' blocks x ' + cats.length + ' sources, ' + days +
            '-day totals and daily averages' + (extras.length ? ' (export only: ' + extras.join(', ') + ')' : '');
  try { ss.toast(msg, 'EcoGainsSim', 10); } catch (e){}
  Logger.log(msg);
  return { rows: nRows, cols: nCols, blocks: blocks.length, sources: cats.length };
}

// ---- data --------------------------------------------------------------------------------------
/** resource -> coin price from item_vals (row 2 names, row 3 prices); ToF tickets sit under 'ToF_Value'. */
function csPrices_(){
  var v = sheetVals_('item_vals'), out = {};
  if (!v || v.length < 3) return out;
  for (var c = 0; c < (v[1] || []).length; c++){
    var name = String(v[1][c] == null ? '' : v[1][c]).trim();
    if (!name) continue;
    var res = (name === 'ToF_Value') ? TOF_TICKET : (RES_MAP[name] || name);
    if (RESOURCES.indexOf(res) >= 0) out[res] = num(v[2][c]);
  }
  return out;
}
function csValue_(row, prices){
  var s = 0;
  RESOURCES.forEach(function(r){ s += num(row[r]) * num(prices[r]); });
  return s;
}
/** Categories the export carries that are not engine rows (they would otherwise vanish from both sides). */
function csExportOnlyCats_(){
  var v = sheetVals_('data_gains');
  if (!v || v.length < 2) return [];
  var c = headerIndex_(v[0])['category'];
  if (c == null) return [];
  var seen = {}, out = [];
  for (var i = 1; i < v.length; i++){
    var k = String(v[i][c] == null ? '' : v[i][c]).trim();
    if (k && !seen[k] && CATEGORY_ORDER.indexOf(k) < 0){ seen[k] = 1; out.push(k); }
  }
  return out.sort();
}
/** One engine pass per segment x payer cell: every category's current (measured) and new (simulated) row. */
function csCellRows_(ctx, extras){
  var cells = [];
  CS_SEGMENTS.forEach(function(seg){
    CS_PAYERS.forEach(function(payer){
      var rows = {};
      CATEGORY_ORDER.forEach(function(cat){
        rows[cat] = { cur: measuredRow_(cat, seg, payer, ctx.ds), nw: resultRow_(cat, seg, payer, ctx) };
      });
      (extras || []).forEach(function(cat){
        var d = ctx.ds.dataRow(cat, seg, payer);
        rows[cat] = { cur: d, nw: d };
      });
      cells.push({ seg: seg, payer: payer, pop: num(ctx.ds.beh(seg, payer).unique_players), rows: rows });
    });
  });
  return cells;
}
/** The 18 blocks: a single cell is its own row; a merged block the unique_players-weighted mean of its cells. */
function csBlocks_(cells, cats){
  var out = [];
  ['All'].concat(CS_SEGMENTS).forEach(function(seg){
    ['All'].concat(CS_PAYERS).forEach(function(payer){
      var mem = cells.filter(function(x){ return (seg === 'All' || x.seg === seg) && (payer === 'All' || x.payer === payer); });
      var w = 0;
      mem.forEach(function(x){ w += x.pop; });
      var rows = {};
      cats.forEach(function(cat){
        if (mem.length === 1){ rows[cat] = { cur: mem[0].rows[cat].cur, nw: mem[0].rows[cat].nw }; return; }
        var cur = {}, nw = {};
        RESOURCES.forEach(function(r){
          var sc = 0, sn = 0;
          mem.forEach(function(x){ sc += x.pop * num(x.rows[cat].cur[r]); sn += x.pop * num(x.rows[cat].nw[r]); });
          cur[r] = (w > 0) ? sc / w : 0; nw[r] = (w > 0) ? sn / w : 0;
        });
        rows[cat] = { cur: cur, nw: nw };
      });
      out.push({ seg: seg, payer: payer, pop: w, cells: mem.length, rows: rows });
    });
  });
  return out;
}

// ---- layout ------------------------------------------------------------------------------------
/** Column plan: the keys, then per table Source + VALUE + every resource, a narrow spacer between tables. */
function csLayout_(){
  var cols = [];
  CS_KEYS.forEach(function(k){ cols.push({ kind: 'key', name: k, width: k === 'Model' ? 118 : (k === 'Period' ? 74 : 66) }); });
  var start = [];
  CS_TABLES.forEach(function(t, ti){
    start.push(cols.length);
    cols.push({ kind: 'src', t: ti, name: 'Source', width: 150 });
    cols.push({ kind: 'num', t: ti, name: 'VALUE', res: 'VALUE', width: 76 });
    RESOURCES.forEach(function(r){ cols.push({ kind: 'num', t: ti, name: r, res: r, width: 66 }); });
    if (ti < CS_TABLES.length - 1) cols.push({ kind: 'gap', name: '', width: 12 });
  });
  return { cols: cols, start: start, nCols: cols.length, width: 2 + RESOURCES.length };
}
function csHeadRows_(L, ctx, days, extras, ss){
  var blank = function(){ var a = []; for (var c = 0; c < L.nCols; c++) a.push(''); return a; };
  var r1 = blank(), r2 = blank(), r3 = blank(), r4 = blank(), r5 = blank();
  var when = '';
  try { when = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm'); }
  catch (e){ when = new Date().toISOString().slice(0, 16).replace('T', ' '); }
  var iso = function(d){ return (d == null) ? '?' : new Date(d * 86400000).toISOString().slice(0, 10); };
  var d1 = (typeof calDay1Date_ === 'function') ? calDay1Date_() : null;
  var span = ctx.ds && ctx.ds.span;
  r1[0] = 'CHANGE SUMMARY - gains per source, current calendar (measured) vs new calendar (simulated)';
  r2[0] = 'Run ' + when + '  -  ' + (typeof ENGINE_BUILD !== 'undefined' ? ENGINE_BUILD : 'engine') +
          '  -  window ' + days + ' days' + (d1 != null ? ' from ' + iso(d1) : '') +
          '  -  CURRENT = ' + (typeof ANCHOR_ARM !== 'undefined' && ANCHOR_ARM ? ANCHOR_ARM + ' ' : '') + 'export' +
          (span ? ' ' + iso(span.start) + '..' + iso(span.end) + ' (' + span.days + ' days) scaled to the window by activity' : '') +
          ', plus the engine\'s anchors  -  NEW = cal_new on the _v2 configs  -  VALUE = item_vals row 3 (envelopes priced, ' +
          'ToF tickets at ToF_Value)  -  merged rows weighted by unique_players';
  r3[0] = 'One band per segment x payer (TOTAL first, then sources by CURRENT value); the ' + days + '-day totals, then the ' +
          'daily averages. Filter any column on row ' + CS_HEADER_ROW + '. Model: simulated = the engine prices the change; ' +
          'carried = no simulator, NEW = CURRENT' + (extras.length ? '; export only = in data_gains but not an engine row (' +
          extras.join(', ') + '), carried' : '') + '. A. 0 players not included.';
  L.cols.forEach(function(col, c){
    if (col.kind === 'key'){ r5[c] = col.name; if (c === 0) r4[c] = 'FILTER KEYS'; return; }
    if (col.kind === 'gap') return;
    r5[c] = col.name;
    if (col.kind === 'src') r4[c] = CS_TABLES[col.t].title;
  });
  return [r1, r2, r3, r4, r5];
}
/** The rows of one block in one period: TOTAL, then the sources by current value (ties: new value, then order). */
function csBlockRows_(b, per, prices, groupOf, L){
  var k = per.k, cats = Object.keys(b.rows);
  var order = {};
  CATEGORY_ORDER.forEach(function(c, i){ order[c] = i; });
  var V = {};
  cats.forEach(function(c){ V[c] = { cur: csValue_(b.rows[c].cur, prices) * k, nw: csValue_(b.rows[c].nw, prices) * k }; });
  cats.sort(function(a, c){
    return (V[c].cur - V[a].cur) || (V[c].nw - V[a].nw) ||
           ((order[a] != null ? order[a] : 999) - (order[c] != null ? order[c] : 999)) || (a < c ? -1 : 1);
  });
  var get = function(cat, side, r){
    if (r === 'VALUE') return V[cat][side];
    return num(b.rows[cat][side][r]) * k;
  };
  var res = ['VALUE'].concat(RESOURCES);
  var tot = { cur: {}, nw: {} };
  res.forEach(function(r){
    var c = 0, n = 0;
    cats.forEach(function(cat){ c += get(cat, 'cur', r); n += get(cat, 'nw', r); });
    tot.cur[r] = c; tot.nw[r] = n;
  });
  var line = function(label, group, model, abs){
    var row = [per.label, b.seg, b.payer, group, model];
    CS_TABLES.forEach(function(t, ti){
      row.push(label);
      res.forEach(function(r){
        var c = abs.cur(r), n = abs.nw(r), tc = tot.cur[r], tn = tot.nw[r];
        var shC = (tc > CS_EPS) ? c / tc : '', shN = (tn > CS_EPS) ? n / tn : '';
        var x;
        if (t.key === 'cur') x = c;
        else if (t.key === 'nw') x = n;
        else if (t.key === 'curSh') x = shC;
        else if (t.key === 'nwSh') x = shN;
        else if (t.key === 'pct') x = (Math.abs(c) < CS_EPS) ? (Math.abs(n) < CS_EPS ? '' : 'new') : n / c - 1;
        else x = (shC === '' && shN === '') ? '' : 100 * ((shN === '' ? 0 : shN) - (shC === '' ? 0 : shC));
        row.push(x);
      });
      if (ti < CS_TABLES.length - 1) row.push('');
    });
    return row;
  };
  var out = [line('TOTAL', 'TOTAL', '', { cur: function(r){ return tot.cur[r]; }, nw: function(r){ return tot.nw[r]; } })];
  cats.forEach(function(cat){
    out.push(line(cat, groupOf(cat), csModelOf_(cat),
                  { cur: function(r){ return get(cat, 'cur', r); }, nw: function(r){ return get(cat, 'nw', r); } }));
  });
  return out;
}
function csModelOf_(cat){
  if (CATEGORY_ORDER.indexOf(cat) < 0) return 'export only';
  if (SOURCES[cat]) return 'simulated';
  if (typeof PACK_ONLY_SPECS !== 'undefined' && PACK_ONLY_SPECS[cat]) return 'carried + envelopes';
  return 'carried';
}
function csFmt_(col, fmtAbs){
  if (col.kind !== 'num') return '@';
  var key = CS_TABLES[col.t].key;
  if (key === 'cur' || key === 'nw') return (col.res === 'VALUE') ? '#,##0.0' : fmtAbs;
  if (key === 'curSh' || key === 'nwSh') return '0.0%';
  if (key === 'pct') return '+0.0%;-0.0%;0.0%';
  return '+0.00" pp";-0.00" pp";0.00" pp"';
}
/** Colour scales on the numeric columns of the share and change tables (data rows only). */
function csRules_(sh, L, nRows){
  var rules = [], n = nRows - CS_HEADER_ROW;
  if (n <= 0) return rules;
  var NUM = SpreadsheetApp.InterpolationType.NUMBER;
  var scale = function(ti, lo, mid, hi, cLo, cMid, cHi){
    var rng = sh.getRange(CS_HEADER_ROW + 1, L.start[ti] + 2, n, L.width - 1);
    var b = SpreadsheetApp.newConditionalFormatRule().setRanges([rng]);
    if (mid == null) b = b.setGradientMinpointWithValue(cLo, NUM, String(lo)).setGradientMaxpointWithValue(cHi, NUM, String(hi));
    else b = b.setGradientMinpointWithValue(cLo, NUM, String(lo)).setGradientMidpointWithValue(cMid, NUM, String(mid))
              .setGradientMaxpointWithValue(cHi, NUM, String(hi));
    rules.push(b.build());
  };
  scale(1, 0, null, 0.5, '#FFFFFF', null, '#9FC5E8');           // CURRENT share
  scale(3, 0, null, 0.5, '#FFFFFF', null, '#93C47D');           // NEW share
  scale(4, -0.1, 0, 0.1, '#E67C73', '#FFFFFF', '#57BB8A');      // % change: +-10% at the ends
  scale(5, -5, 0, 5, '#E67C73', '#FFFFFF', '#57BB8A');          // share change: +-5 pp at the ends
  return rules;
}
