/************************************************************************************************
 * ChangeSummary.gs - the 'change_summary' sheet: what the redesign does to every gain source.
 * ---------------------------------------------------------------------------------------------
 * REQUIRES EcoGainsSim_v4.gs (Context, CATEGORY_ORDER, RESOURCES, measuredRow_, resultRow_, sheetVals_ ...).
 * Optional: SimPerSegmentFill.gs (spsGroupOf_ - the PAID / ADS / CORE / META column; without it every source
 * reads META). NOT a custom function: menu EcoGainsSim > Fill change summary, one execution (~1-3 minutes, the
 * same engine pass as Fill Sim per Segment). It refreshes the export_scale table first (D87, Compute export scale).
 *
 * SIX TABLES side by side, left to right:
 *   CURRENT gain        measuredRow_ - the control: the export (data_gains, the ANCHOR_ARM rows) over its own dates,
 *                       scaled to the counted window per event where the by-source feed confirms the payout days, by
 *                       activity otherwise (D79 / D87), plus the engine's anchors for what the export cannot see. The
 *                       same numbers ECOGAINS_DIFF subtracts, re-expressed per player (below).
 *   CURRENT share       each source's share of the block total, per resource (sources sum to 100%)
 *   NEW gain            resultRow_ - cal_new on the _v2 configs, the same numbers as ECOGAINS_SIM, per player
 *   NEW share
 *   NEW vs CURRENT %    new / current - 1 ('new' where the current gain is 0)
 *   share change (pp)   new share - current share, in percentage points
 * VALUE = every resource x its item_vals row-3 price (envelopes priced; ToF tickets at the 'ToF_Value' cell, the
 * only name that row gives them; SPT x2 is 0 there). Inside a block the rows are sorted by CURRENT value, TOTAL
 * first.
 *
 * PER PLAYER (D88, 2026-11-02). data_gains reports amount_per_earner = amount / resource_earners, and the earners
 * of a resource are a different set for every resource - 94% of the 0-9 non-payers earned coins, 1% earned a
 * 5-star envelope - so a per-earner 5-star is ~100x a per-player one, and a VALUE that adds per-earner columns
 * (or a share of it) is not a number about players at all. Every amount the export anchors is multiplied by that
 * cell's resource_earners / players_in_cell, read off the same pull; the engine's own grid stays per earner (its
 * DIFF per resource is unaffected - it is a ratio). An amount the export does not carry (BOTTOM-UP: an envelope
 * tier a source never paid, a resource a _v2 ladder adds, the paid Season Pass track) is left as the model gives
 * it, per player of the behaviour population (data_seg_beh). The 'Bottom-up %' key is the share of a row's VALUE
 * priced that way.
 *
 * ROWS: one band per (segment, payer) block - {ALL, every segment the pull carries} x {All payers, NONPAYER,
 * PAYER}, the whole population first. A merged block is the players_in_cell-weighted mean of its cells - the
 * population of the same pull, so a merged per-player amount is exactly the pooled amount over the pooled players
 * (D88; it was weighted by data_seg_beh's unique_players, a different population: 71k against data_gains' 100k).
 * THE WHOLE-POPULATION BAND IS THE PULL'S OWN 'ALL' SEGMENT (D94, 2026-11-05, user decision) where the pull
 * carries one (LIVE_OPS_V3 (20)): ALL x NONPAYER and ALL x PAYER are engine cells like any other - their own
 * gains, activity, ranks and balances, with the sources configured per segment (Saga, Night Sky, ToF, the
 * collection rows) pooled from the member segments - and only ALL x All payers is a merge, of those two cells.
 * It replaces the 'All' band that was the weighted mean of every segment cell; the note on row 3 prints both
 * totals so the difference is on the sheet. A pull with no ALL segment keeps the weighted 'All' band.
 * The blocks are written
 * twice: the window total, then the daily average (window total / window days). Every row carries Period /
 * Segment / Payer / Group / Model / Bottom-up %, every table repeats the Source name (no frozen panes on a sim
 * sheet), and a filter sits on the header row.
 *
 * MODEL (D88): anchored = measured x the model's change (R x D x T, or export x model_new / model_cur); bottom-up =
 * no measured level; anchored + bottom-up = both, Bottom-up % says how much; carried = no simulator (NEW =
 * CURRENT); carried + envelopes = carried, envelopes priced; card sim = the collection rows (50 seeded seasons per
 * cell and side - noisy); rule = Chuck's Challenge under the D86 user rule; export only = in data_gains but not an
 * engine row (Col - Chests), carried. A. 0 players are not included (no behaviour telemetry).
 *
 * STALE MARK (D88): the sheet holds values. An edit to any sheet the engine reads (REFRESH_WATCH) writes a red
 * STALE line into A2 (csMarkStale_, called from onEdit) until the next fill - (15)'s summary had been filled
 * before the v2 re-fit was applied and read as the engine's answer for the configs under it.
 *
 * VALUES, NOT FORMULAS (deliberate): the sheet is meant to be filtered and re-sorted, and a share or Δ formula
 * pointing at its block's TOTAL row breaks the moment a sort moves either row. Re-run the menu item after an edit.
 ************************************************************************************************/

// Build stamp, read back by ECOGAINS_BUILD().
var CHANGESUM_BUILD = 'ChangeSummary.gs  D94  2026-11-05';

var CS_SHEET = 'change_summary';
var CS_SEGMENTS = ['0-9', '10-19', '20-39', '40-99', '100+'];   // the fallback: a pull with no data_seg_beh rows
var CS_PAYERS = ['NONPAYER', 'PAYER'];
var CS_ALL_MERGED = 'All';             // the whole-population band when it is a merge of the segment cells
/** The member segments of the pull (D94), under data_seg_beh's own labels ('100-249', '250+' on (20)). */
function csSegments_(ctx){
  var mem = [];
  try { mem = segMembers_(ctx.ds).map(function(sg){ return segLabel_(sg, ctx.ds); }); } catch (e){ mem = []; }
  return mem.length ? mem : CS_SEGMENTS.slice();
}
/** The pull's own ALL segment ('ALL'), or null when it carries none. */
function csAllSeg_(ctx){
  try { return (ctx.ds.segs().indexOf(SEG_ALL) >= 0) ? SEG_ALL : null; } catch (e){ return null; }
}
var CS_HEADER_ROW = 6;                 // the filter row; rows 1-5: title, run stamp, notes, red notes, table bars
var CS_KEYS = ['Period', 'Segment', 'Payer', 'Group', 'Model', 'Bottom-up %'];
var CS_TABLES = [
  { key: 'cur',   title: 'CURRENT - gain per player',                     fill: '#CFE2F3', tot: '#E3EDF8' },
  { key: 'curSh', title: 'CURRENT - share of the block total',           fill: '#CFE2F3', tot: '#E3EDF8' },
  { key: 'nw',    title: 'NEW - gain per player',                         fill: '#E2EFDA', tot: '#EEF6E9' },
  { key: 'nwSh',  title: 'NEW - share of the block total',               fill: '#E2EFDA', tot: '#EEF6E9' },
  { key: 'pct',   title: 'NEW vs CURRENT - % change in gain',            fill: '#FCE5CD', tot: '#FDF1E3' },
  { key: 'pp',    title: 'NEW vs CURRENT - share change (percentage points)', fill: '#FCE5CD', tot: '#FDF1E3' }
];
var CS_EPS = 1e-12;
var CS_RED = '#CC0000';
var CS_COL_CATS = { 'Col - Sets': 1, 'Col - Albums': 1 };

function fillChangeSummary(){
  if (typeof Context === 'undefined' || typeof resultRow_ !== 'function')
    throw new Error('Fill change summary needs EcoGainsSim_v4.gs in this Apps Script project.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // D87: the per-event export scale reads a pooled table - refresh it, so CURRENT is never on a stale one
  if (typeof fillExportScale === 'function'){
    try { fillExportScale(); } catch (e){ Logger.log('Compute export scale failed (' + e + ') - the export keeps the activity scale.'); }
  }
  var sh = ss.getSheetByName(CS_SHEET) || ss.insertSheet(CS_SHEET);
  var ctx = Context.get();
  var days = (typeof windowDays_ === 'function') ? windowDays_() : 33;
  var prices = csPrices_();
  var extras = csExportOnlyCats_();
  var cats = CATEGORY_ORDER.concat(extras);
  var popInfo = csPopulation_(ctx);
  var cells = csCellRows_(ctx, extras, popInfo);
  var blocks = csBlocks_(cells, cats, prices, ctx);
  var allCmp = csAllCompare_(cells, cats, prices, ctx);     // D94: the ALL band against the weighted merge it replaces
  var grp = (typeof spsGroupOf_ === 'function') ? spsGroupOf_().map : {};
  var dflt = (typeof SPS_DEFAULT_GROUP !== 'undefined') ? SPS_DEFAULT_GROUP : 'META';
  var groupOf = function(cat){ return grp[cat] || dflt; };
  var standIn = {};
  CATEGORY_ORDER.forEach(function(c){ if (typeof laneStandInActive_ === 'function' && laneStandInActive_(c, ctx)) standIn[c] = 1; });

  var L = csLayout_();
  var head = csHeadRows_(L, ctx, days, extras, ss, popInfo, standIn, allCmp);
  var body = [], marks = [];                          // marks: {total, first, fmtAbs}
  [{ label: days + ' days', k: 1, fmtAbs: '#,##0.00' },
   { label: 'Daily avg', k: 1 / days, fmtAbs: '#,##0.000' }].forEach(function(per, pi){
    blocks.forEach(function(b, bi){
      var rows = csBlockRows_(b, per, prices, groupOf, L, standIn);
      rows.forEach(function(r, ri){
        // the Chuck's Challenge rows are NOT painted red (user, 2026-11-03): the Model column ('rule: Red's ->
        // Chuck's') and the row-4 note already say they are a rule, and red read as an error
        marks.push({ total: ri === 0, first: ri === 0 && bi === 0 && pi > 0, fmtAbs: per.fmtAbs });
        body.push(r);
      });
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
  var fmt = [], bg = [], fw = [], fc = [];
  grid.forEach(function(row, r){
    var f = [], b = [], w = [], k = [];
    for (var c = 0; c < nCols; c++){
      var col = L.cols[c];
      if (r < CS_HEADER_ROW){
        f.push('@');
        b.push(r >= 4 && col.t != null ? CS_TABLES[col.t].fill : (r >= 4 && col.kind === 'key' ? '#D9D9D9' : '#FFFFFF'));
        w.push(r === 0 || r === 3 || r >= 4 ? 'bold' : 'normal');
        k.push(r === 3 ? CS_RED : (r === 1 || r === 2 ? '#555555' : '#000000'));
        continue;
      }
      var m = marks[r - CS_HEADER_ROW];
      f.push(csFmt_(col, m.fmtAbs));
      b.push(m.total ? (col.t != null ? CS_TABLES[col.t].tot : (col.kind === 'key' ? '#EFEFEF' : '#FFFFFF')) : '#FFFFFF');
      w.push(m.total ? 'bold' : 'normal');
      k.push('#000000');
    }
    fmt.push(f); bg.push(b); fw.push(w); fc.push(k);
  });
  // formats BEFORE values: a label such as '10-19' written into an unformatted cell is read as a date
  rng.setNumberFormats(fmt);
  rng.setValues(grid);
  rng.setBackgrounds(bg);
  rng.setFontWeights(fw);
  rng.setFontColors(fc);
  rng.setFontFamily('Arial');
  rng.setFontSize(10);
  sh.getRange(1, 1).setFontSize(14);
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
            '-day totals and daily averages, per player' + (extras.length ? ' (export only: ' + extras.join(', ') + ')' : '');
  try { ss.toast(msg, 'EcoGainsSim', 10); } catch (e){}
  Logger.log(msg);
  return { rows: nRows, cols: nCols, blocks: blocks.length, sources: cats.length };
}

/** onEdit hook (EcoGainsSim_v4.gs): an input sheet changed after the last fill -> say so in A2, in red. Cheap: one
 *  read of A2, one write. Never throws (a simple trigger must not fail an edit). */
function csMarkStale_(edited){
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CS_SHEET);
    if (!sh || edited === CS_SHEET) return false;
    var cell = sh.getRange(2, 1), was = String(cell.getValue() == null ? '' : cell.getValue());
    if (was.indexOf('STALE') === 0) return false;           // already marked: keep the FIRST edit's name and time
    var when = '';
    try { when = Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm'); }
    catch (e){ when = new Date().toISOString().slice(0, 16).replace('T', ' '); }
    cell.setValue('STALE - ' + edited + ' was edited ' + when + ', after this summary was filled. Re-run EcoGainsSim > ' +
                  'Fill change summary before reading it.   (filled: ' + was.replace(/^Run /, '').slice(0, 16) + ')');
    cell.setFontColor(CS_RED).setFontWeight('bold').setBackground('#F4CCCC');
    return true;
  } catch (e){ return false; }
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
/** The pull's own population, per cell (D88): players_in_cell, resource_earners per resource, and which
 *  (category, resource) the export carries. perPlayer = false when the pull lacks the two columns (an older
 *  export): every amount then stays per earner and the merge weight is data_seg_beh's unique_players. */
function csPopulation_(ctx){
  var v = sheetVals_('data_gains'), out = { perPlayer: false, cells: {} };
  // D94: every cell the pull carries (the member segments and ALL), keyed by the label data_seg_beh uses
  // for the segment - the label the blocks print - whatever data_gains calls it ('F. 100-249')
  var want = {};
  csSegments_(ctx).concat(csAllSeg_(ctx) ? [SEG_ALL] : []).forEach(function(sg){ want[segCanon_(sg)] = sg; });
  if (v && v.length > 1){
    var h = headerIndex_(v[0]);
    var ok = h['players_in_cell'] != null && h['resource_earners'] != null && h['engagement_segment'] != null;
    for (var i = 1; ok && i < v.length; i++){
      var r = v[i], seg = want[segCanon_(r[h['engagement_segment']])];
      if (!seg) continue;
      var key = seg + '|' + String(r[h['payer_flag']]).trim();
      var o = out.cells[key] || (out.cells[key] = { players: 0, earners: {}, has: {} });
      o.players = num(r[h['players_in_cell']]);
      var res = String(r[h['resource']]).trim(), cat = String(r[h['category']]).trim();
      o.earners[res] = num(r[h['resource_earners']]);
      if (num(r[h['amount_per_earner']]) > 0) o.has[cat + '|' + res] = 1;
    }
    out.perPlayer = ok && Object.keys(out.cells).length > 0;
  }
  return out;
}
/** One engine pass per segment x payer cell: every category's current (measured) and new (simulated) row, per
 *  player (D88), with the resources the export anchors marked. */
function csCellRows_(ctx, extras, popInfo){
  var cells = [], allSeg = csAllSeg_(ctx);
  csSegments_(ctx).concat(allSeg ? [allSeg] : []).forEach(function(seg){
    CS_PAYERS.forEach(function(payer){
      var pc = popInfo && popInfo.cells[seg + '|' + payer];
      var per = !!(popInfo && popInfo.perPlayer && pc && pc.players > 0);
      var conv = function(cat, row, anc){
        var o = {};
        RESOURCES.forEach(function(r){
          var a = !!(pc && pc.has[cat + '|' + r]);
          anc[r] = a;
          var e = (per && a) ? num(pc.earners[r]) / pc.players : 1;
          o[r] = num(row[r]) * e;
        });
        return o;
      };
      var rows = {};
      CATEGORY_ORDER.forEach(function(cat){
        var anc = {};
        var src = (typeof laneStandInActive_ === 'function' && LANE_STANDIN && LANE_STANDIN[cat] && laneStandInActive_(cat, ctx))
                  ? LANE_STANDIN[cat].like : cat;                // D86: Chuck's NEW is Red's row - Red's earners
        var cur = conv(cat, measuredRow_(cat, seg, payer, ctx.ds), {});
        var nw = conv(src, resultRow_(cat, seg, payer, ctx), anc);
        rows[cat] = { cur: cur, nw: nw, anc: anc };
      });
      (extras || []).forEach(function(cat){
        var anc = {}, d = conv(cat, ctx.ds.dataRow(cat, seg, payer), anc);
        rows[cat] = { cur: d, nw: d, anc: anc };
      });
      var pop = per ? pc.players : num(ctx.ds.beh(seg, payer).unique_players);
      cells.push({ seg: seg, payer: payer, pop: pop, rows: rows, all: (seg === allSeg) });
    });
  });
  return cells;
}
/** The 18 blocks: a single cell is its own row; a merged block the population-weighted mean of its cells. Each row
 *  also carries its bottom-up share of VALUE (both sides together). */
function csBlocks_(cells, cats, prices, ctx, mergedAll){
  var out = [];
  // D94: the whole-population band is the pull's ALL segment where it has one (its two cells; merged only
  // over the payer flag); otherwise - and when `mergedAll` asks for the old band - the weighted merge of
  // every member cell. An ALL cell is never part of another band.
  var hasAll = !mergedAll && cells.some(function(x){ return x.all; });
  var allSeg = hasAll ? cells.filter(function(x){ return x.all; })[0].seg : CS_ALL_MERGED;
  var segs = [], seenSeg = {};
  cells.forEach(function(x){ if (!x.all && !seenSeg[x.seg]){ seenSeg[x.seg] = 1; segs.push(x.seg); } });
  [allSeg].concat(segs).forEach(function(seg){
    ['All'].concat(CS_PAYERS).forEach(function(payer){
      var top = (seg === allSeg);
      var mem = cells.filter(function(x){
        if (payer !== 'All' && x.payer !== payer) return false;
        if (top) return hasAll ? x.all : !x.all;
        return !x.all && x.seg === seg;
      });
      var w = 0;
      mem.forEach(function(x){ w += x.pop; });
      var rows = {};
      cats.forEach(function(cat){
        var cur = {}, nw = {}, bu = 0, an = 0;
        RESOURCES.forEach(function(r){
          var sc = 0, sn = 0;
          mem.forEach(function(x){
            var c0 = num(x.rows[cat].cur[r]), n0 = num(x.rows[cat].nw[r]);
            sc += x.pop * c0; sn += x.pop * n0;
            var v = x.pop * (Math.abs(c0) + Math.abs(n0)) * num(prices[r]);
            if (x.rows[cat].anc[r]) an += v; else bu += v;
          });
          if (mem.length === 1){ cur[r] = num(mem[0].rows[cat].cur[r]); nw[r] = num(mem[0].rows[cat].nw[r]); }
          else { cur[r] = (w > 0) ? sc / w : 0; nw[r] = (w > 0) ? sn / w : 0; }
        });
        rows[cat] = { cur: cur, nw: nw, bu: (an + bu > CS_EPS) ? bu / (an + bu) : 0 };
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
  CS_KEYS.forEach(function(k){ cols.push({ kind: 'key', name: k, width: k === 'Model' ? 140 : (k === 'Period' ? 74 : (k === 'Bottom-up %' ? 78 : 66)) }); });
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
/** FNV-1a over the config and calendar sheets the engine reads (data_* pulls excluded - they are large and dated
 *  in their own columns): two fills on the same inputs print the same tag. */
function csFingerprint_(){
  var names = (typeof REFRESH_WATCH !== 'undefined') ? REFRESH_WATCH.filter(function(n){ return !/^data_/i.test(n); }) : [];
  names = names.concat(['PackConfig', 'PackConfig_v2', 'AlbumConfig', 'AlbumConfig_v2', 'ToF_v2', 'Ki_2d_v2']);
  var h = 0x811c9dc5, seen = {};
  names.forEach(function(n){
    if (seen[n]) return; seen[n] = 1;
    var v; try { v = sheetVals_(n); } catch (e){ v = null; }
    var s = n + ':' + JSON.stringify(v || []);
    for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  });
  return ('00000000' + h.toString(16)).slice(-8);
}
/** D94: what replacing the weighted 'All' band with the pull's ALL segment changed - the VALUE per player of
 *  both, current and new, over all players. null when the pull has no ALL segment. */
function csAllCompare_(cells, cats, prices, ctx){
  if (!cells.some(function(x){ return x.all; })) return null;
  var tot = function(blocks){
    var b = blocks[0], c = 0, n = 0;
    cats.forEach(function(cat){ c += csValue_(b.rows[cat].cur, prices); n += csValue_(b.rows[cat].nw, prices); });
    return { cur: c, nw: n, pct: (Math.abs(c) > CS_EPS) ? n / c - 1 : 0, pop: b.pop };
  };
  return { all: tot(csBlocks_(cells, cats, prices, ctx)), merged: tot(csBlocks_(cells, cats, prices, ctx, true)) };
}
function csHeadRows_(L, ctx, days, extras, ss, popInfo, standIn, allCmp){
  var blank = function(){ var a = []; for (var c = 0; c < L.nCols; c++) a.push(''); return a; };
  var r1 = blank(), r2 = blank(), r3 = blank(), r4 = blank(), r5 = blank(), r6 = blank();
  var when = '';
  try { when = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm'); }
  catch (e){ when = new Date().toISOString().slice(0, 16).replace('T', ' '); }
  var iso = function(d){ return (d == null) ? '?' : new Date(d * 86400000).toISOString().slice(0, 10); };
  var d1 = (typeof calDay1Date_ === 'function') ? calDay1Date_() : null;
  var span = ctx.ds && ctx.ds.span;
  var perEvent = 0;
  if (typeof exportScaleTab_ === 'function' && exportScaleTab_() && typeof EXPORT_SCALE_FAMILY !== 'undefined')
    Object.keys(EXPORT_SCALE_FAMILY).forEach(function(cat){ if (exportScaleCheck_(cat, 'HC', ctx).ok) perEvent++; });
  r1[0] = 'CHANGE SUMMARY - gains per player, per source: the current calendar (measured) vs the new calendar (simulated)';
  r2[0] = 'Run ' + when + '  -  inputs #' + csFingerprint_() + '  -  ' + (typeof ENGINE_BUILD !== 'undefined' ? ENGINE_BUILD : 'engine') +
          '  -  window ' + days + ' days' + (d1 != null ? ' from ' + iso(d1) : '') +
          '  -  CURRENT = ' + (typeof ANCHOR_ARM !== 'undefined' && ANCHOR_ARM ? ANCHOR_ARM + ' ' : '') + 'export' +
          (span ? ' ' + iso(span.start) + '..' + iso(span.end) + ' (' + span.days + ' days), scaled to the window per event (' + perEvent +
                  ' events, export_scale) and by activity otherwise' : '') +
          ', plus the engine\'s anchors  -  NEW = cal_new on the _v2 configs  -  VALUE = item_vals row 3 (envelopes priced, ToF tickets at ToF_Value)';
  r3[0] = (popInfo && popInfo.perPlayer
            ? 'Per player: the export\'s per-earner amounts x resource_earners / players_in_cell of the same pull; merged rows weighted by ' +
              'players_in_cell (so they are exact pooled amounts). Bottom-up amounts (no export anchor) are per player of data_seg_beh\'s ' +
              'population - Bottom-up % says how much of a row that is. '
            : 'PER EARNER - this data_gains has no players_in_cell / resource_earners: amounts are per earner of each resource and VALUE ' +
              'adds unlike denominators; merged rows weighted by unique_players. ') +
          (allCmp ? 'ALL is the pull\'s own whole-population segment (D94), not the weighted mean of the segments: VALUE per player ' +
                    allCmp.all.cur.toFixed(0) + ' -> ' + allCmp.all.nw.toFixed(0) + ' (' + (allCmp.all.pct >= 0 ? '+' : '') + (100 * allCmp.all.pct).toFixed(2) +
                    '%) against ' + allCmp.merged.cur.toFixed(0) + ' -> ' + allCmp.merged.nw.toFixed(0) + ' (' + (allCmp.merged.pct >= 0 ? '+' : '') +
                    (100 * allCmp.merged.pct).toFixed(2) + '%) for the weighted mean it replaces; its Saga, Night Sky, ToF and collection rows are ' +
                    'the member segments pooled (they are configured per segment). '
                  : '') +
          'One band per segment x payer (TOTAL first, then sources by CURRENT value); the ' + days + '-day totals, then the daily ' +
          'averages. Filter any column on row ' + CS_HEADER_ROW + '. Model: anchored = measured x the model\'s change; bottom-up = no ' +
          'measured level; carried = no simulator, NEW = CURRENT; card sim = 50 seeded seasons per cell (noisy)' +
          (extras.length ? '; export only = in data_gains but not an engine row (' + extras.join(', ') + '), carried' : '') + '. A. 0 players not included.';
  var red = [];
  if (standIn['Chuck Challenge'])
    red.push('CHUCK\'S CHALLENGE (user rule, D86): CURRENT = 0, NEW = what Red\'s Challenge loses on the redesign (Red\'s 4 -> 2, Chuck\'s 0 -> 2, ' +
             'same rewards). The export\'s own Chuck\'s payout (Oct 28, from the Oct 26-27 instance cal_curr draws as Bomb\'s) is counted on neither side.');
  red.push('The sheet holds values: an edit to any input sheet after this run turns row 2 red (STALE) until the next fill.');
  r4[0] = red.join('   |   ');
  L.cols.forEach(function(col, c){
    if (col.kind === 'key'){ r6[c] = col.name; if (c === 0) r5[c] = 'FILTER KEYS'; return; }
    if (col.kind === 'gap') return;
    r6[c] = col.name;
    if (col.kind === 'src') r5[c] = CS_TABLES[col.t].title;
  });
  return [r1, r2, r3, r4, r5, r6];
}
/** The rows of one block in one period: TOTAL, then the sources by current value (ties: new value, then order). */
function csBlockRows_(b, per, prices, groupOf, L, standIn){
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
  // the block's own bottom-up share: VALUE-weighted over its rows
  var buTot = 0, vTot = 0;
  cats.forEach(function(cat){ var v = Math.abs(V[cat].cur) + Math.abs(V[cat].nw); buTot += v * num(b.rows[cat].bu); vTot += v; });
  var line = function(label, group, model, bu, abs){
    var row = [per.label, b.seg, b.payer, group, model, bu];
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
  var out = [line('TOTAL', 'TOTAL', '', (vTot > CS_EPS) ? buTot / vTot : 0,
                  { cur: function(r){ return tot.cur[r]; }, nw: function(r){ return tot.nw[r]; } })];
  cats.forEach(function(cat){
    var bu = num(b.rows[cat].bu);
    out.push(line(cat, groupOf(cat), csModelOf_(cat, bu, standIn), bu,
                  { cur: function(r){ return get(cat, 'cur', r); }, nw: function(r){ return get(cat, 'nw', r); } }));
  });
  return out;
}
function csModelOf_(cat, bu, standIn){
  if (CATEGORY_ORDER.indexOf(cat) < 0) return 'export only';
  if (standIn && standIn[cat]) return 'rule: Red\'s -> Chuck\'s';
  if (CS_COL_CATS[cat]) return 'card sim';
  if (!SOURCES[cat]) return (typeof PACK_ONLY_SPECS !== 'undefined' && PACK_ONLY_SPECS[cat]) ? 'carried + envelopes' : 'carried';
  if (!(bu > 0.005)) return 'anchored';
  if (bu > 0.995) return 'bottom-up';
  return 'anchored + bottom-up';
}
function csFmt_(col, fmtAbs){
  if (col.kind === 'key') return (col.name === 'Bottom-up %') ? '0%' : '@';
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
