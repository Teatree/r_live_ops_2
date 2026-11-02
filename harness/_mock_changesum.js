// Offline harness for ChangeSummary.gs (D85) - the menu run that writes the 'change_summary' sheet: per source,
// CURRENT (measuredRow_) and NEW (resultRow_) gains, their shares, the % change and the share change, for 18
// segment x payer blocks, as window totals and as daily averages. D88: per player (the export's per-earner amounts
// x resource_earners / players_in_cell), merges weighted by players_in_cell, the Model / Bottom-up % keys, the red
// D86 note and the STALE mark.
//
//   node harness/_mock_changesum.js              (defaults to --data v3k, LIVE_OPS_V3 (15))
//   node harness/_mock_changesum.js --data v3h
//
// The SpreadsheetApp mock and the engine loader are the shared ones from _mock_cards.js. Added here, because only
// this file needs them: a sheet that can be INSERTED and CLEARED, and recorders for the formatting calls (number
// formats, backgrounds, weights, borders, conditional rules, the filter) so their wiring can be asserted.
// Every check is a RULE (the sheet equals the engine, a share is its abs over the block total, a mutation moves what
// it should) - never a number frozen from a workbook.
const fs = require('fs');
const path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3k');

const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
if (CARDS.indexOf(CUT) < 0) throw new Error('_mock_cards.js prelude marker moved - fix CUT.');
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function GATES() {
  const csSrc = fs.readFileSync(ENGINE('ChangeSummary.gs'), 'utf8');
  const spsSrc = fs.readFileSync(ENGINE('SimPerSegmentFill.gs'), 'utf8');

  // ---------------------------------------------------------------- the writable, formattable sheet
  const REC = {};                                        // sheet -> recorded formatting
  const recOf = (n) => (REC[n] = REC[n] || { fmt: {}, bg: {}, fw: {}, fc: {}, borders: [], rules: [], filter: null, removed: 0,
                                              widths: {}, gridHidden: false, max: { rows: 1000, cols: 26 } });
  const putGrid = (map, r1, c1, g) => { for (let i = 0; i < g.length; i++) for (let j = 0; j < g[i].length; j++) map[(r1 + i) + ',' + (c1 + j)] = g[i][j]; };
  const chain = (o) => new Proxy(o, { get: (t, k) => (k in t) ? t[k] : (() => chain(t)) });
  const csRange = (name, r1, c1, nr, nc) => {
    const base = mkRange(name, r1, c1, nr || 1, nc || 1), rec = recOf(name);
    const self = chain({
      getRow: () => r1, getColumn: () => c1, getNumRows: () => nr || 1, getNumColumns: () => nc || 1,
      getValues: base.getValues, getValue: base.getValue,
      setValues: (g) => { base.setValues(g); return self; },
      setValue: (v) => { base.setValue(v); return self; },
      setNumberFormats: (g) => { putGrid(rec.fmt, r1, c1, g); return self; },
      setBackgrounds: (g) => { putGrid(rec.bg, r1, c1, g); return self; },
      setFontWeights: (g) => { putGrid(rec.fw, r1, c1, g); return self; },
      setFontColors: (g) => { putGrid(rec.fc, r1, c1, g); return self; },
      setFontColor: (x) => { for (let i = 0; i < (nr || 1); i++) for (let j = 0; j < (nc || 1); j++) rec.fc[(r1 + i) + ',' + (c1 + j)] = x; return self; },
      setBorder: (...a) => { rec.borders.push({ r: r1, c: c1, nr, nc, color: a[6], style: a[7] }); return self; },
      createFilter: () => { if (rec.filter) throw new Error('createFilter on a sheet that already has a filter');
        rec.filter = { r: r1, c: c1, nr, nc, remove: () => { rec.filter = null; rec.removed++; } }; return rec.filter; },
    });
    return self;
  };
  const csSheet = (name) => {
    if (!data[name]) return null;
    const rec = recOf(name);
    return chain({
      getName: () => name,
      getDataRange: () => { const v = data[name].values; return csRange(name, 1, 1, Math.max(1, v.length), Math.max(1, v.reduce((m, r) => Math.max(m, r.length), 0))); },
      getRange: (a, b, c, d) => csRange(name, a, b, c, d),
      getFilter: () => rec.filter,
      clear: () => { data[name].values = []; data[name].merges = []; rec.fmt = {}; rec.bg = {}; rec.fw = {}; rec.fc = {}; rec.borders = []; },
      clearConditionalFormatRules: () => { rec.rules = []; },
      setConditionalFormatRules: (rules) => { rec.rules = rules.slice(); },
      getMaxRows: () => rec.max.rows, getMaxColumns: () => rec.max.cols,
      insertRowsAfter: (a, n) => { rec.max.rows += n; }, insertColumnsAfter: (a, n) => { rec.max.cols += n; },
      setColumnWidth: (c, w) => { rec.widths[c] = w; },
      setHiddenGridlines: (h) => { rec.gridHidden = !!h; },
    });
  };
  const toastsCS = [];
  global.SpreadsheetApp = Object.assign({}, SpreadsheetApp, {
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => (n === CS_SHEET_NAME || n === 'export_scale') ? csSheet(n) : mkSheet(n),
      insertSheet: (n) => { data[n] = { values: [], merges: [] }; return csSheet(n); },
      toast: (m) => { toastsCS.push(String(m)); },
      getSpreadsheetTimeZone: () => 'Europe/Helsinki',
    }),
    InterpolationType: { NUMBER: 'NUMBER' },
    BorderStyle: { SOLID_MEDIUM: 'SOLID_MEDIUM', SOLID_THICK: 'SOLID_THICK' },
    newConditionalFormatRule: () => {
      const rule = { ranges: [], points: [] };
      const b = { setRanges: (r) => { rule.ranges = r; return b; },
        setGradientMinpointWithValue: (col, t, v) => { rule.points.push(['min', v, col]); return b; },
        setGradientMidpointWithValue: (col, t, v) => { rule.points.push(['mid', v, col]); return b; },
        setGradientMaxpointWithValue: (col, t, v) => { rule.points.push(['max', v, col]); return b; },
        build: () => rule };
      return b;
    },
  });
  const CS_SHEET_NAME = 'change_summary';

  // DIRECT evals at this scope, so the fill's functions and these gates see each other
  eval(spsSrc);
  eval(csSrc);

  // ---------------------------------------------------------------- 0. namespace hygiene + menu
  {
    const names = (src) => { const out = new Set(); const re = /^(?:function\s+([A-Za-z0-9_$]+)|var\s+([A-Za-z0-9_$]+)\s*=)/gm; let m;
      while ((m = re.exec(src))) out.add(m[1] || m[2]); return out; };
    const mine = names(csSrc);
    const others = ['EcoGainsSim_v4.gs', 'EcoGainsSim_Daily.gs', 'CardOpenings.gs', 'SimPerSegmentFill.gs', 'SimFill.gs',
                    'EcoGainsSim_7Day.gs', 'EcoGainsSim_PBP.gs', 'CalStats.gs', 'HCPerWin.gs', 'V2Diff.gs', 'calParseTest.gs']
      .map(f => names(fs.readFileSync(ENGINE(f), 'utf8')));
    const clash = [...mine].filter(n => others.some(s => s.has(n)));
    check('ChangeSummary.gs declares no globals that collide with the other engine files', clash.length === 0, clash.length ? 'collides: ' + clash.join(', ') : 'none');
    check('ChangeSummary.gs does not define onOpen', !/^function\s+onOpen\s*\(/m.test(csSrc));
    check('the EcoGainsSim menu offers Fill change summary', /addItem\('Fill change summary',\s*'fillChangeSummary'\)/.test(v4Src));
    check('ECOGAINS_BUILD reads the change-summary build stamp', /'CHANGESUM_BUILD'/.test(v4Src));
  }

  // ---------------------------------------------------------------- run it
  delete data[CS_SHEET_NAME];
  resetSheetCache_mock();
  const t0 = Date.now();
  const res1 = fillChangeSummary();
  console.log('  fill: ' + res1.rows + ' rows x ' + res1.cols + ' cols, ' + res1.blocks + ' blocks, ' + res1.sources + ' sources, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  const V = () => data[CS_SHEET_NAME].values;
  const cell = (r, c) => { const row = V()[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; };
  check('a workbook without change_summary gets one', !!data[CS_SHEET_NAME] && V().length > 0);

  // ---------------------------------------------------------------- 1. layout
  const L = csLayout_(), W = 2 + RESOURCES.length, HR = CS_HEADER_ROW;
  const expectCols = CS_KEYS.length + CS_TABLES.length * W + (CS_TABLES.length - 1);
  check('column plan: keys + 6 tables of Source/VALUE/' + RESOURCES.length + ' resources + 5 spacers', L.nCols === expectCols && res1.cols === expectCols, L.nCols + ' vs ' + expectCols);
  {
    const hdr = V()[HR - 1], bar = V()[HR - 2];
    let ok = CS_KEYS.every((k, i) => hdr[i] === k), tOk = true;
    CS_TABLES.forEach((t, ti) => {
      const s = L.start[ti], want = ['Source', 'VALUE'].concat(RESOURCES);
      want.forEach((h, j) => { if (hdr[s + j] !== h) ok = false; });
      if (bar[s] !== t.title) tOk = false;
      if (ti < CS_TABLES.length - 1 && hdr[s + W] !== '') ok = false;
    });
    check('row ' + HR + ' names every column: the keys, then Source, VALUE and RESOURCES in order, per table', ok);
    check('row ' + (HR - 1) + ' carries the six table titles in order (current, current share, new, new share, %, pp)', tOk,
          CS_TABLES.map((t, ti) => bar[L.start[ti]]).join(' | '));
  }
  const days = windowDays_();
  const extras = csExportOnlyCats_();
  const cats = CATEGORY_ORDER.concat(extras);
  const per = cats.length + 1;
  check('rows: 2 periods x 18 blocks x (TOTAL + ' + cats.length + ' sources) under the header', V().length === HR + 2 * 18 * per,
        V().length + ' vs ' + (HR + 2 * 18 * per));
  const blockOrder = [];
  ['All'].concat(CS_SEGMENTS).forEach(s => ['All'].concat(CS_PAYERS).forEach(p => blockOrder.push([s, p])));
  // block index -> {row (1-based) of TOTAL, rows: {source -> row}}
  const blocks = [];
  for (let pi = 0; pi < 2; pi++) for (let bi = 0; bi < 18; bi++){
    const r0 = HR + 1 + (pi * 18 + bi) * per, rows = {};
    for (let k = 1; k < per; k++) rows[cell(r0 + k, L.start[0] + 1)] = r0 + k;
    blocks.push({ pi, bi, seg: blockOrder[bi][0], payer: blockOrder[bi][1], r0, rows });
  }
  {
    let ok = true, why = '';
    blocks.forEach(b => {
      for (let k = 0; k < per; k++){
        const r = b.r0 + k;
        if (cell(r, 1) !== (b.pi ? 'Daily avg' : days + ' days') || cell(r, 2) !== b.seg || cell(r, 3) !== b.payer){ ok = false; why = why || ('row ' + r); }
      }
      if (cell(b.r0, L.start[0] + 1) !== 'TOTAL' || cell(b.r0, 4) !== 'TOTAL'){ ok = false; why = why || ('TOTAL at ' + b.r0); }
      if (Object.keys(b.rows).length !== cats.length){ ok = false; why = why || ('sources in block ' + b.bi); }
    });
    check('every row carries Period / Segment / Payer; All players first; each block opens with its TOTAL', ok, why);
  }
  const col = (ti, res) => L.start[ti] + 1 + 1 + (res === 'VALUE' ? 0 : 1 + RESOURCES.indexOf(res));   // 1-based
  const RV = ['VALUE'].concat(RESOURCES);
  const N = (x) => (x === '' || x === undefined) ? 0 : Number(x);
  const near = (a, b, tol) => Math.abs(N(a) - N(b)) <= (tol || 1e-9) * Math.max(1, Math.abs(N(b)));

  // ---------------------------------------------------------------- 2. the sheet IS the engine
  resetSheetCache_mock();
  const ctx = Context.get();
  const POPI = csPopulation_(ctx);
  // the D88 conversion, written out independently: an amount the export carries x resource_earners / players_in_cell
  const convOf = (seg, payer, cat, res) => {
    const pc = POPI.cells[seg + '|' + payer];
    const src = (LANE_STANDIN[cat] && laneStandInActive_(cat, ctx)) ? LANE_STANDIN[cat].like : cat;
    return (POPI.perPlayer && pc && pc.has[src + '|' + res]) ? pc.earners[res] / pc.players : 1;
  };
  const convCur = (seg, payer, cat, res) => {
    const pc = POPI.cells[seg + '|' + payer];
    return (POPI.perPlayer && pc && pc.has[cat + '|' + res]) ? pc.earners[res] / pc.players : 1;
  };
  check('the dump\'s data_gains carries players_in_cell and resource_earners (the D88 per-player basis)', POPI.perPlayer);
  {
    let n = 0, bad = 0, first = '';
    blocks.filter(b => b.pi === 0 && b.seg !== 'All' && b.payer !== 'All').forEach(b => {
      CATEGORY_ORDER.forEach(cat => {
        const m = measuredRow_(cat, b.seg, b.payer, ctx.ds), s = resultRow_(cat, b.seg, b.payer, ctx), r = b.rows[cat];
        RESOURCES.forEach(res => { n++;
          const wc = num(m[res]) * convCur(b.seg, b.payer, cat, res), wn = num(s[res]) * convOf(b.seg, b.payer, cat, res);
          if (!near(cell(r, col(0, res)), wc) || !near(cell(r, col(2, res)), wn)){ bad++;
            if (!first) first = b.seg + ' ' + b.payer + ' ' + cat + ' ' + res + ': sheet ' + cell(r, col(0, res)) + '/' + cell(r, col(2, res)) + ' want ' + wc + '/' + wn; } });
      });
    });
    check('every single-cell block: CURRENT = measuredRow_ and NEW = resultRow_, each export-anchored amount x resource_earners / players_in_cell',
          bad === 0, n + ' cells, ' + bad + ' off' + (first ? ' - ' + first : ''));
  }
  {
    let ok = extras.length > 0, why = extras.length ? '' : 'no export-only category on this dump';
    blocks.filter(b => b.pi === 0 && b.seg !== 'All' && b.payer !== 'All').forEach(b => extras.forEach(cat => {
      const d = ctx.ds.dataRow(cat, b.seg, b.payer), r = b.rows[cat];
      if (cell(r, 5) !== 'export only') { ok = false; why = why || cat + ' model ' + cell(r, 5); }
      RESOURCES.forEach(res => { const w = num(d[res]) * convCur(b.seg, b.payer, cat, res);
        if (!near(cell(r, col(0, res)), w) || !near(cell(r, col(2, res)), w)) { ok = false; why = why || (cat + ' ' + res); } });
    }));
    check('a category only the export carries (' + extras.join(', ') + ') is listed, CURRENT = NEW = the export', ok, why);
  }

  // ---------------------------------------------------------------- 3. merged blocks, totals, value, order
  const pop = {}; CS_SEGMENTS.forEach(s => CS_PAYERS.forEach(p => { pop[s + '|' + p] = POPI.cells[s + '|' + p].players; }));
  {
    let bad = 0, first = '', n = 0;
    blocks.filter(b => b.pi === 0 && (b.seg === 'All' || b.payer === 'All')).forEach(b => {
      const mem = blocks.filter(x => x.pi === 0 && x.seg !== 'All' && x.payer !== 'All' && (b.seg === 'All' || x.seg === b.seg) && (b.payer === 'All' || x.payer === b.payer));
      let w = 0; mem.forEach(x => { w += pop[x.seg + '|' + x.payer]; });
      cats.forEach(cat => [0, 2].forEach(ti => RESOURCES.forEach(res => { n++;
        let s = 0; mem.forEach(x => { s += pop[x.seg + '|' + x.payer] * N(cell(x.rows[cat], col(ti, res))); });
        if (!near(cell(b.rows[cat], col(ti, res)), s / w)) { bad++; if (!first) first = b.seg + '/' + b.payer + ' ' + cat + ' ' + res; } })));
    });
    check('a merged block is the players_in_cell-weighted mean of its cells (All players = all ten)', bad === 0, n + ' cells, ' + bad + ' off ' + first);
  }
  const prices = csPrices_();
  check('prices: item_vals row 3, envelopes included, ToF tickets from the ToF_Value cell',
        prices['5-star Pack'] > 0 && prices['HC'] === 1 && prices['ToF_Ticket'] > 0, JSON.stringify(prices));
  {
    let badT = 0, badV = 0, badO = 0, first = '';
    blocks.forEach(b => {
      [0, 2].forEach(ti => {
        RV.forEach(res => { let s = 0; cats.forEach(cat => { s += N(cell(b.rows[cat], col(ti, res))); });
          if (!near(cell(b.r0, col(ti, res)), s)) { badT++; first = first || ('TOTAL ' + b.seg + '/' + b.payer + ' ' + res); } });
        [b.r0].concat(cats.map(c => b.rows[c])).forEach(r => {
          let v = 0; RESOURCES.forEach(res => { v += N(cell(r, col(ti, res))) * N(prices[res]); });
          if (!near(cell(r, col(ti, 'VALUE')), v)) { badV++; first = first || ('VALUE row ' + r); }
        });
      });
      for (let k = 2; k < per; k++) if (N(cell(b.r0 + k, col(0, 'VALUE'))) > N(cell(b.r0 + k - 1, col(0, 'VALUE'))) + 1e-9) { badO++; first = first || ('order row ' + (b.r0 + k)); }
    });
    check('each TOTAL row is the sum of its sources, per resource and table', badT === 0, badT + ' off ' + first);
    check('VALUE = every resource x its price, on every row', badV === 0, badV + ' off');
    check('inside a block, sources run from the highest CURRENT value down', badO === 0, badO + ' out of order');
  }

  // ---------------------------------------------------------------- 4. shares and changes
  {
    let badS = 0, badP = 0, badQ = 0, first = '';
    blocks.forEach(b => {
      RV.forEach(res => {
        const tc = N(cell(b.r0, col(0, res))), tn = N(cell(b.r0, col(2, res)));
        let sc = 0, sn = 0;
        [b.r0].concat(cats.map(c => b.rows[c])).forEach((r, k) => {
          const c0 = N(cell(r, col(0, res))), n0 = N(cell(r, col(2, res)));
          const shC = cell(r, col(1, res)), shN = cell(r, col(3, res));
          const wantC = tc > 1e-12 ? c0 / tc : '', wantN = tn > 1e-12 ? n0 / tn : '';
          if (!(shC === wantC || near(shC, wantC)) || !(shN === wantN || near(shN, wantN))) { badS++; first = first || ('share row ' + r + ' ' + res); }
          if (k > 0){ sc += N(shC); sn += N(shN); }
          const pct = cell(r, col(4, res));
          const wantP = Math.abs(c0) < 1e-12 ? (Math.abs(n0) < 1e-12 ? '' : 'new') : n0 / c0 - 1;
          if (!(pct === wantP || (typeof wantP === 'number' && near(pct, wantP)))) { badP++; first = first || ('pct row ' + r + ' ' + res + ' ' + pct + ' vs ' + wantP); }
          const pp = cell(r, col(5, res));
          const wantQ = (wantC === '' && wantN === '') ? '' : 100 * (N(wantN) - N(wantC));
          if (!(pp === wantQ || (typeof wantQ === 'number' && near(pp, wantQ)))) { badQ++; first = first || ('pp row ' + r + ' ' + res); }
        });
        if (tc > 1e-12 && Math.abs(sc - 1) > 1e-9) { badS++; first = first || ('shares do not sum to 1: ' + b.seg + '/' + b.payer + ' ' + res); }
        if (tn > 1e-12 && Math.abs(sn - 1) > 1e-9) { badS++; first = first || ('new shares do not sum to 1: ' + res); }
      });
    });
    check('shares = gain / block total, sources sum to 100% per resource (both sides)', badS === 0, badS + ' off ' + first);
    check('% change = new / current - 1 (\'new\' where current is 0, blank where both are)', badP === 0, badP + ' off');
    check('share change = new share - current share, in percentage points', badQ === 0, badQ + ' off');
  }
  {
    let bad = 0, first = '';
    blocks.filter(b => b.pi === 0).forEach(b => {
      const d = blocks.find(x => x.pi === 1 && x.bi === b.bi);
      cats.concat(['TOTAL']).forEach(cat => {
        const r = cat === 'TOTAL' ? b.r0 : b.rows[cat], rd = cat === 'TOTAL' ? d.r0 : d.rows[cat];
        RV.forEach(res => {
          [0, 2].forEach(ti => { if (!near(cell(rd, col(ti, res)), N(cell(r, col(ti, res))) / days, 1e-9)) { bad++; first = first || (b.seg + '/' + b.payer + ' ' + cat + ' ' + res); } });
          [1, 3, 4, 5].forEach(ti => { const a = cell(r, col(ti, res)), x = cell(rd, col(ti, res));
            if (!(a === x || (typeof a === 'number' && near(x, a, 1e-9)))) { bad++; first = first || ('derived ' + res); } });
        });
      });
    });
    check('the daily section = the window totals / ' + days + ' days, same shares and changes, same order', bad === 0, bad + ' off ' + first);
  }

  // ---------------------------------------------------------------- 4b. D88: the model keys, the red note, the stale mark
  const liveRows = (seg, payer, pi) => {                  // source -> row of the block AS THE SHEET NOW HAS IT
    const o = {}, lab = pi ? 'Daily avg' : days + ' days';
    V().forEach((r, i) => { if (i >= HR && r[0] === lab && r[1] === seg && r[2] === payer) o[r[L.start[0]]] = i + 1; });
    return o;
  };
  {
    const b0 = blocks.find(b => b.pi === 0 && b.seg === '20-39' && b.payer === 'PAYER');
    const modelOf = (cat) => cell(b0.rows[cat], 5), buOf = (cat) => N(cell(b0.rows[cat], 6));
    // the examples come from the engine's own routing tables, never a name frozen here (Flock Flurry left
    // PACK_ONLY_SPECS for LB_R_SPECS in D91 and this gate went red on a correct sheet)
    const onRow = (cat) => !!b0.rows[cat];
    const carriedEx = CATEGORY_ORDER.find(c => onRow(c) && !SOURCES[c] && !PACK_ONLY_SPECS[c] && !CS_COL_CATS[c]);
    const packOnlyEx = Object.keys(PACK_ONLY_SPECS).find(c => onRow(c) && !SOURCES[c]);
    const lbEx = Object.keys(LB_R_SPECS).find(c => onRow(c) && SOURCES[c] && !(LANE_STANDIN[c] && laneStandInActive_(c)));
    check('Model: carried sources say carried, the pack-only ones carried + envelopes, the collection rows card sim',
          !!carriedEx && !!packOnlyEx && modelOf(carriedEx) === 'carried' && modelOf(packOnlyEx) === 'carried + envelopes' && modelOf('Col - Sets') === 'card sim',
          [carriedEx + ' ' + modelOf(carriedEx), packOnlyEx + ' ' + modelOf(packOnlyEx), modelOf('Col - Sets')].join(' | '));
    check('Model: a simulated leaderboard never reads carried',
          !!lbEx && ['anchored', 'anchored + bottom-up', 'bottom-up'].indexOf(modelOf(lbEx)) >= 0 &&
          Object.keys(LB_R_SPECS).filter(c => onRow(c) && SOURCES[c]).every(c => String(modelOf(c)).indexOf('carried') < 0),
          lbEx + ' ' + modelOf(lbEx) + '; Flock Flurry ' + modelOf('Flock Flurry'));
    check('Model: a source the export anchors on every resource reads anchored with Bottom-up % 0 (Daily Night Sky Prize)',
          modelOf('Daily Night Sky Prize') === 'anchored' && buOf('Daily Night Sky Prize') === 0, modelOf('Daily Night Sky Prize') + ' ' + buOf('Daily Night Sky Prize'));
    check('Model: the paid Season Pass (no export category) reads bottom-up, Bottom-up % 100',
          modelOf('Season Pass (Paid)') === 'bottom-up' && near(buOf('Season Pass (Paid)'), 1), modelOf('Season Pass (Paid)') + ' ' + buOf('Season Pass (Paid)'));
    // Bottom-up % written out: the VALUE share of the resources the export does not carry (both sides)
    let bad = 0, n = 0;
    const prices = csPrices_();
    CATEGORY_ORDER.forEach(cat => {
      if (LANE_STANDIN[cat] && laneStandInActive_(cat, ctx)) return;
      const m = measuredRow_(cat, '20-39', 'PAYER', ctx.ds), s = resultRow_(cat, '20-39', 'PAYER', ctx), pc = POPI.cells['20-39|PAYER'];
      let an = 0, bu = 0;
      RESOURCES.forEach(res => { const v = (Math.abs(num(m[res]) * convCur('20-39', 'PAYER', cat, res)) + Math.abs(num(s[res]) * convOf('20-39', 'PAYER', cat, res))) * num(prices[res]);
        if (pc.has[cat + '|' + res]) an += v; else bu += v; });
      const want = (an + bu > 1e-12) ? bu / (an + bu) : 0; n++;
      if (!near(buOf(cat), want, 1e-9)) bad++;
    });
    check('Bottom-up % = the VALUE share of the resources the export does not carry, row by row', bad === 0, n + ' rows, ' + bad + ' off');
    if (laneStandInActive_('Chuck Challenge', ctx)){
      const rec = REC[CS_SHEET_NAME], r = b0.rows['Chuck Challenge'];
      check('D86: Chuck\'s rows say the rule and are red; the note above the tables is red and names it',
            modelOf('Chuck Challenge') === "rule: Red's -> Chuck's" && rec.fc[r + ',' + (L.start[0] + 1)] === CS_RED && rec.fc[r + ',5'] === CS_RED &&
            /CHUCK'S CHALLENGE/.test(String(V()[3][0])) && rec.fc['4,1'] === CS_RED);
    }
  }
  {
    // RULE: doubling one cell's resource_earners for coins doubles every coin amount the export anchors there, and nothing else
    const g = data['data_gains'].values, h = g[0], snapG = JSON.stringify(data['data_gains']);
    const ix = (k) => h.indexOf(k);
    g.forEach((r, i) => { if (i && r[ix('ab_variant')] === 'Variant A' && r[ix('engagement_segment')] === 'D. 20-39' && r[ix('payer_flag')] === 'PAYER' && r[ix('resource')] === 'HC')
      r[ix('resource_earners')] = Number(r[ix('resource_earners')]) * 2; });
    const b0 = blocks.find(b => b.pi === 0 && b.seg === '20-39' && b.payer === 'PAYER');
    const before = {}; CATEGORY_ORDER.forEach(cat => { before[cat] = [N(cell(b0.rows[cat], col(0, 'HC'))), N(cell(b0.rows[cat], col(0, 'Red')))]; });
    resetSheetCache_mock(); fillChangeSummary();
    let bad = 0, n = 0, first = '';
    const pc = POPI.cells['20-39|PAYER'], rows2 = liveRows('20-39', 'PAYER', 0);
    CATEGORY_ORDER.forEach(cat => { n++;
      const want = pc.has[cat + '|HC'] ? before[cat][0] * 2 : before[cat][0];
      if (!near(N(cell(rows2[cat], col(0, 'HC'))), want, 1e-9) || !near(N(cell(rows2[cat], col(0, 'Red'))), before[cat][1], 1e-9)){ bad++; first = first || cat; } });
    check('RULE: resource_earners x2 for one cell\'s coins -> its anchored coin amounts x2, unanchored ones and other resources unmoved', bad === 0, n + ' rows, ' + bad + ' off ' + first);
    data['data_gains'] = JSON.parse(snapG); resetSheetCache_mock(); fillChangeSummary();
  }
  {
    // RULE: a pull without the two columns keeps the D85 sheet - per earner, unique_players weights
    const g = data['data_gains'].values, snapG = JSON.stringify(data['data_gains']);
    g[0] = g[0].map(x => x === 'players_in_cell' ? 'players_in_cell_x' : x);
    resetSheetCache_mock(); fillChangeSummary();
    const c2 = Context.get(), rows3 = liveRows('0-9', 'NONPAYER', 0);
    const m = measuredRow_('Target Day', '0-9', 'NONPAYER', c2.ds);
    check('RULE: no players_in_cell -> amounts per earner exactly as the engine gives them, and the notes say PER EARNER',
          RESOURCES.every(res => near(cell(rows3['Target Day'], col(0, res)), num(m[res]))) && /PER EARNER/.test(String(V()[2][0])));
    data['data_gains'] = JSON.parse(snapG); resetSheetCache_mock(); fillChangeSummary();
  }
  {
    // the STALE mark: first edit wins, a fill clears it
    const stamp = String(V()[1][0]);
    check('a fill writes the run stamp with an inputs fingerprint', /^Run \d{4}-\d{2}-\d{2} \d{2}:\d{2}  -  inputs #[0-9a-f]{8}/.test(stamp), stamp.slice(0, 60));
    const ok1 = csMarkStale_('NS_v2'), a2 = String(V()[1][0]);
    const ok2 = csMarkStale_('TaD_v2'), a2b = String(V()[1][0]);
    check('an input edit marks row 2 STALE in red, naming the sheet; a second edit keeps the first name',
          ok1 && !ok2 && /^STALE - NS_v2 was edited/.test(a2) && a2b === a2 && REC[CS_SHEET_NAME].fc['2,1'] === CS_RED, a2.slice(0, 70));
    fillChangeSummary();
    check('the next fill clears the STALE mark', /^Run /.test(String(V()[1][0])));
    check('onEdit marks the summary for any watched input sheet', /csMarkStale_\(name\)/.test(v4Src) &&
          ['NS_v2', 'Ki_2d_v2', 'PackConfig_v2', 'export_scale', 'cal_new'].every(n => REFRESH_WATCH.indexOf(n) >= 0));
  }
  check('the fill refreshes the export_scale table first (D87)', !!data['export_scale'] && (data['export_scale'].values || []).length > 4);

  // ---------------------------------------------------------------- 5. formatting wiring
  {
    const rec = REC[CS_SHEET_NAME];
    const f = (r, c) => rec.fmt[r + ',' + c];
    const b0 = blocks[3], r = b0.rows[cats[0]];
    check('number formats: gains, shares, % change, pp, Bottom-up %', f(r, col(0, 'HC')) === '#,##0.00' && f(r, col(1, 'HC')) === '0.0%' &&
          f(r, col(4, 'HC')) === '+0.0%;-0.0%;0.0%' && /pp/.test(f(r, col(5, 'HC'))) && f(r, 2) === '@' && f(r, 6) === '0%',
          [f(r, col(0, 'HC')), f(r, col(1, 'HC')), f(r, col(4, 'HC')), f(r, col(5, 'HC')), f(r, 2)].join(' | '));
    check('TOTAL rows bold, source rows not', rec.fw[b0.r0 + ',' + col(0, 'HC')] === 'bold' && rec.fw[r + ',' + col(0, 'HC')] === 'normal');
    check('one filter, on the header row, over every row and column', rec.filter && rec.filter.r === HR && rec.filter.c === 1 &&
          rec.filter.nr === V().length - HR + 1 && rec.filter.nc === L.nCols, rec.filter ? JSON.stringify({ r: rec.filter.r, nr: rec.filter.nr, nc: rec.filter.nc }) : 'none');
    check('colour scales on the two share and two change tables (data rows only)', rec.rules.length === 4 &&
          rec.rules.every(x => x.ranges[0].getRow() === HR + 1 && x.ranges[0].getNumRows() === V().length - HR));
    check('a rule opens every block, a heavier one the daily section', rec.borders.length === 36 && rec.borders.filter(x => x.style === 'SOLID_THICK').length === 1);
    check('gridlines hidden (sim-sheet style)', rec.gridHidden);
  }

  // ---------------------------------------------------------------- 6. re-run, and two rules by mutation
  {
    const body = () => JSON.stringify(V().filter((r, i) => i !== 1));   // row 2 carries the run time stamp (and the fingerprint)
    const snapV = body(), rem0 = REC[CS_SHEET_NAME].removed;
    fillChangeSummary();
    check('re-running reproduces the sheet exactly (bar the run stamp), and replaces the filter rather than stacking one',
          body() === snapV && REC[CS_SHEET_NAME].removed === rem0 + 1 && /^Run \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(V()[1][0])));
  }
  {
    // RULE: doubling the HC price moves every VALUE by exactly its HC gain, and nothing else
    const iv = data['item_vals'].values, c = iv[1].map(x => String(x).trim()).indexOf('Coins'), snapIv = JSON.stringify(data['item_vals']);
    const before = {}; blocks.filter(b => b.pi === 0).forEach(b => cats.forEach(cat => { before[b.bi + '|' + cat] = [N(cell(b.rows[cat], col(0, 'VALUE'))), N(cell(b.rows[cat], col(0, 'HC'))), N(cell(b.rows[cat], col(0, 'Red')))]; }));
    iv[2][c] = Number(iv[2][c]) * 2;
    resetSheetCache_mock();
    fillChangeSummary();
    let bad = 0, n = 0;
    const rowsOf = (pi, bi) => { const r0 = HR + 1 + (pi * 18 + bi) * per, o = {}; for (let k = 1; k < per; k++) o[cell(r0 + k, L.start[0] + 1)] = r0 + k; return o; };
    for (let bi = 0; bi < 18; bi++){ const rows = rowsOf(0, bi);
      cats.forEach(cat => { const [v0, hc, red] = before[bi + '|' + cat]; n++;
        if (!near(N(cell(rows[cat], col(0, 'VALUE'))), v0 + hc, 1e-9) || N(cell(rows[cat], col(0, 'Red'))) !== red) bad++; }); }
    check('RULE: HC price x2 -> every VALUE grows by exactly its HC gain, the gains themselves do not move', bad === 0, n + ' rows, ' + bad + ' off');
    data['item_vals'] = JSON.parse(snapIv); resetSheetCache_mock();
  }
  if (extras.length){
    // RULE: a category the export stops carrying leaves the sheet, and no stale rows are left behind
    const g = data['data_gains'].values, ci = g[0].indexOf('category'), snapG = JSON.stringify(data['data_gains']);
    const gone = extras[0];
    data['data_gains'].values = g.filter((r, i) => i === 0 || String(r[ci]).trim() !== gone);
    resetSheetCache_mock();
    const res2 = fillChangeSummary();
    const left = V().filter(r => r[L.start[0]] === gone).length;
    check('RULE: dropping ' + gone + ' from the export removes its rows, and the sheet shrinks to fit (no stale tail)',
          left === 0 && V().length === HR + 2 * 18 * (per - 1) && res2.sources === cats.length - 1, V().length + ' rows');
    data['data_gains'] = JSON.parse(snapG); resetSheetCache_mock();
  }

  // ---------------------------------------------------------------- 7. what the sheet says (for the reader of this log)
  {
    resetSheetCache_mock(); fillChangeSummary();
    const b = blocks[0], top = [];
    for (let k = 1; k <= 6; k++) top.push(cell(b.r0 + k, L.start[0] + 1) + ' ' + N(cell(b.r0 + k, col(0, 'VALUE'))).toFixed(0) + ' -> ' + N(cell(b.r0 + k, col(2, 'VALUE'))).toFixed(0));
    console.log('\n  All players, top sources by current value: ' + top.join(' | '));
    console.log('  All players TOTAL VALUE ' + N(cell(b.r0, col(0, 'VALUE'))).toFixed(0) + ' -> ' + N(cell(b.r0, col(2, 'VALUE'))).toFixed(0) +
                ' (' + (100 * N(cell(b.r0, col(4, 'VALUE')))).toFixed(2) + '%)');
  }
  console.log('\n' + (failures ? failures + ' FAILED' : 'ALL CHANGE-SUMMARY CHECKS PASSED'));
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
