// Offline harness for CardOpenings.gs (card-collection pack simulator, D19).
// Mocks a WRITABLE SpreadsheetApp over _mockdata.json, runs SimulatePackOpenings end-to-end and
// checks the acquisition seam (dailyPacksFor_), the pool/draw semantics, both pity mechanisms,
// chest purchasing and determinism.
//
// Requires PackConfig / Col_Cards_Daily in _mockdata.json — _dump_mockdata.py overlays the freshly
// built display/PackConfig_v2.xlsx and display/SimOutput_v2.xlsx (PENDING_IMPORT), so this runs
// against the layout the engine expects even before the sheets are imported into the workbook.
const fs = require('fs');
const path = require('path');
const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);
// --data <name|path> picks the dump (2026-09-01). The card sim lives in the COLLECTIONS
// workbook lineage, not the ECO one: _mockdata.json has no PackConfig worth reading and
// loadPackConfig_ dies on it before a single gate runs. Default is therefore the
// collections dump; pass --data main to force the ECO dump.
const DATA_ALIASES = { collections: '_mockdata_collections.json', main: '_mockdata.json',
                       wb14: '_mockdata_wb14.json' };
function dataPath(){
  const i = process.argv.indexOf('--data');
  const pick = (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : 'collections';
  const f = DATA_ALIASES[pick] || pick;
  return path.isAbsolute(f) ? f : path.join(__dirname, f);
}
const DATA_FILE = dataPath();
const RAW = fs.readFileSync(DATA_FILE, 'utf8');
let data = JSON.parse(RAW);
console.log('data: ' + path.basename(DATA_FILE) +
            (data._meta ? '  (from ' + data._meta.source + ', dumped ' + data._meta.dumped + ')'
                        : ''));
console.log('');

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};
const f2 = (x) => (Math.round(x * 100) / 100);

// Last row of a PackConfig block: the next row whose column A starts with any PC_BLOCKS label.
// Module scope because both the pity round-trip (section 1) and the skew fixture (section 6) bound
// a block this way.
function pcBlockEnd(v, b) {
  for (let r = b + 1; r < v.length; r++) {
    const a = String((v[r] || [])[0]).trim();
    if (PC_BLOCKS.some(L => a.indexOf(L) === 0)) return r;
  }
  return v.length;
}

// ---------------------------------------------------------------- writable sheet mock
function ensure(sheet, r, c) {
  while (sheet.values.length < r) sheet.values.push([]);
  const row = sheet.values[r - 1];
  while (row.length < c) row.push('');
  return row;
}
function colToNum(s) { return s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0); }

function mkRange(name, r1, c1, nr, nc) {
  const sh = data[name];
  return {
    getRow: () => r1, getColumn: () => c1,
    getNumRows: () => nr, getNumColumns: () => nc,
    getValues: () => {
      const out = [];
      for (let r = r1; r < r1 + nr; r++) {
        const row = [];
        for (let c = c1; c < c1 + nc; c++)
          row.push((sh.values[r - 1] && sh.values[r - 1][c - 1] !== undefined) ? sh.values[r - 1][c - 1] : '');
        out.push(row);
      }
      return out;
    },
    getMergedRanges: () => (sh.merges || [])
      .filter(m => m.r >= r1 && m.r + m.nr - 1 <= r1 + nr - 1 && m.c >= c1 && m.c + m.nc - 1 <= c1 + nc - 1)
      .map(m => ({ getRow: () => m.r, getColumn: () => m.c, getNumRows: () => m.nr, getNumColumns: () => m.nc })),
    getValue: () => { const row = sh.values[r1 - 1] || []; return row[c1 - 1] !== undefined ? row[c1 - 1] : ''; },
    setValue: (v) => { ensure(sh, r1, c1)[c1 - 1] = v; },
    setValues: (grid) => {
      for (let i = 0; i < grid.length; i++)
        for (let j = 0; j < grid[i].length; j++) ensure(sh, r1 + i, c1 + j)[c1 + j - 1] = grid[i][j];
    },
    clearContent: () => {
      for (let r = r1; r < r1 + nr; r++)
        for (let c = c1; c < c1 + nc; c++) if (sh.values[r - 1]) ensure(sh, r, c)[c - 1] = '';
    },
    setHorizontalAlignment: () => {},
  };
}
function mkSheet(name) {
  const sh = data[name];
  if (!sh) return null;
  return {
    getName: () => name,
    getLastRow: () => sh.values.length,
    getDataRange: () => mkRange(name, 1, 1, sh.values.length,
      sh.values.reduce((m, r) => Math.max(m, r.length), 0)),
    getRange: (a, b, c, d) => {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
        const c1 = colToNum(m[1]), r1 = +m[2];
        if (!m[3]) return mkRange(name, r1, c1, 1, 1);
        return mkRange(name, r1, c1, +m[4] - r1 + 1, colToNum(m[3]) - c1 + 1);
      }
      return mkRange(name, a, b, c || 1, d || 1);
    },
  };
}
const toasts = [];
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({ getSheetByName: (n) => mkSheet(n) }),
  getActive: () => ({ toast: (msg, title) => toasts.push(msg) }),
};
const logs = [];
global.Logger = { log: (m) => logs.push(String(m)) };

// ---------------------------------------------------------------- load engine
const v4Src = fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8');
const dailySrc = fs.readFileSync(ENGINE('EcoGainsSim_Daily.gs'), 'utf8');
const cardSrc = fs.readFileSync(ENGINE('CardOpenings.gs'), 'utf8');
// NOTE: these evals must stay at MODULE scope — inside a function the engine's `var`/`function`
// declarations would be function-local and invisible to the checks below. Every reload point
// below repeats the three evals for the same reason (same pattern as _mock_daily.js).
eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};

// strips comments so a gate can look for real code, not prose in a doc block
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ------------------------------------------------- 0. HARDCODED ASSUMPTIONS (printed, not hidden)
// PACK_PARTICIPATION overrides a MEASURED number with a design assumption, which is exactly the
// kind of thing that goes unnoticed for months and then makes a result look inexplicable. Every
// active override is printed on EVERY harness run, next to the rate it is replacing, so the
// distance between assumption and measurement is impossible to miss. See CLAUDE.md (D25).
{
  const overrides = Object.keys(typeof PACK_PARTICIPATION !== 'undefined' ? PACK_PARTICIPATION : {});
  console.log('\n================ HARDCODED ASSUMPTIONS (PACK_PARTICIPATION) ================');
  if (!overrides.length) {
    console.log('  none — every source uses its measured data_event_inst participation_rate');
  } else {
    const ctx0 = Context.get();
    overrides.forEach((cat) => {
      const assumed = PACK_PARTICIPATION[cat];
      const seen = ['0-9', '20-39', '100+'].map((seg) => {
        const inst = ctx0.ds.eventInst((LB_R_SPECS[cat] || COLL_R_SPECS[cat] ||
                                        PACK_ONLY_SPECS[cat] || {}).inst || cat, seg, 'PAYER');
        return seg + '=' + (inst ? Number(inst.participation_rate).toFixed(4) : 'n/a');
      }).join('  ');
      const worst = Math.max(...['0-9', '20-39', '100+'].map((seg) => {
        const inst = ctx0.ds.eventInst((LB_R_SPECS[cat] || COLL_R_SPECS[cat] ||
                                        PACK_ONLY_SPECS[cat] || {}).inst || cat, seg, 'PAYER');
        const p = inst ? Number(inst.participation_rate) : 0;
        return p > 0 ? assumed / p : 0;
      }));
      console.log('  ' + cat + ': ASSUMED ' + assumed + '   measured (PAYER) ' + seen +
                  (worst > 1 ? '   -> up to ' + worst.toFixed(0) + 'x the measured rate' : ''));
    });
    console.log('  These are DESIGN ASSUMPTIONS, not measurements. Any pack number for these');
    console.log('  sources is conditional on them. Override per source with a "Participation"');
    console.log('  label on its _v2 config sheet (value in the cell to the right).');
  }
  console.log('============================================================================\n');
  // The resolution ORDER is the contract; if it ever silently changes, every pack number for an
  // overridden source moves without a failing test anywhere else.
  check('PACK_PARTICIPATION overrides the measured participation_rate',
    typeof packParticipation_ === 'function' &&
    Object.keys(PACK_PARTICIPATION).every(c => packParticipation_(c, { participation_rate: 0.0123 })
                                               === PACK_PARTICIPATION[c]),
    overrides.length ? overrides.map(c => c + '=' + PACK_PARTICIPATION[c]).join(', ') : '(none set)');
  check('a source with no override still uses its measured rate',
    packParticipation_('Bomb Challenge', { participation_rate: 0.4 }) === 0.4);
  check('no telemetry at all still falls back to full participation',
    packParticipation_('Bomb Challenge', null) === 1);
}

// ---------------------------------------------------------------- 0. namespace hygiene
{
  const names = (src) => {
    const out = new Set();
    const re = /^(?:function\s+([A-Za-z0-9_$]+)|var\s+([A-Za-z0-9_$]+)\s*=)/gm;
    let m;
    while ((m = re.exec(src))) out.add(m[1] || m[2]);
    return out;
  };
  const v4n = names(v4Src), dn = names(dailySrc), cn = names(cardSrc);
  const clash = [...cn].filter(n => v4n.has(n) || dn.has(n));
  check('CardOpenings.gs declares no globals that collide with the engine files',
    clash.length === 0, clash.length ? 'collides: ' + clash.join(', ') : 'none');
  check('CardOpenings.gs does not define onOpen (it would kill the EcoGainsSim menu)',
    !/^function\s+onOpen\s*\(/m.test(cardSrc));
  check('the project has exactly one onOpen',
    [v4Src, dailySrc, cardSrc].filter(s => /^function\s+onOpen\s*\(/m.test(s)).length === 1);
  check('EcoGainsSim menu offers the card sim',
    /addItem\('Simulate card pack openings',\s*'SimulatePackOpenings'\)/.test(v4Src));
  check('EcoPackGains / PlayerBehavior are no longer read (comments aside)',
    !/EcoPackGains|PlayerBehavior/.test(stripComments(cardSrc)));
}

// ------------------------------------------- 0b. the spill vs the display sheet (2026-09-02)
// The engine writes CATEGORY_ORDER rows x RESOURCES columns into a block whose row labels and
// column headers are STATIC TEXT that nothing validates. Add a resource or a source on one side
// only and every row/column after it silently shifts onto its neighbour: no error, no blank, just
// wrong numbers under right labels. It has now happened twice — 2026-08-21 with three added
// category rows, and 2026-09-02 when ToF_Ticket and the ToF source were authored in the workbook
// before the engine knew about them (ToF showed Col - Sets' numbers, Col - Sets showed
// Col - Albums', Col - Albums went blank).
//
// This lives HERE rather than in _mock_run.js because it needs the display sheet, and the ECO dump
// _mock_run reads does not carry one — it skips its alignment check entirely. The collections dump
// does, and it is the workbook of record for this work.
{
  const egv = (data['EcoGainsSim'] || {}).values || [];
  let hdrRow = -1, resC = -1, labC = -1;
  for (let r = 0; r < egv.length && hdrRow < 0; r++) {
    const row = egv[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).trim() === 'HC') { hdrRow = r; resC = c; break; }
    }
    if (hdrRow >= 0)
      for (let c = 0; c < resC; c++)
        if (String(row[c]).trim() === 'Source') labC = c;
  }
  const sheetRes = [];
  for (let c = resC; hdrRow >= 0 && c < egv[hdrRow].length; c++) {
    const h = String(egv[hdrRow][c]).trim();
    if (h === '') break;
    sheetRes.push(h);
  }
  const firstBad = sheetRes.findIndex((h, i) => h !== RESOURCES[i]);
  check('EcoGainsSim header block == RESOURCES, name for name',
    hdrRow >= 0 && sheetRes.length === RESOURCES.length && firstBad === -1,
    hdrRow < 0 ? 'no header row found'
      : `${sheetRes.length} sheet vs ${RESOURCES.length} engine` +
        (firstBad === -1 ? '' : ` — first mismatch at ${firstBad}: sheet "${sheetRes[firstBad]}"` +
                                ` vs engine "${RESOURCES[firstBad]}"`));

  const labels = [];
  for (let r = hdrRow + 1; hdrRow >= 0 && labC >= 0 && r < egv.length; r++) {
    const v = String((egv[r] || [])[labC] || '').trim();
    if (v === '') break;
    labels.push(v);
  }
  const badCat = labels.findIndex((l, i) => l !== CATEGORY_ORDER[i]);
  check('EcoGainsSim source labels == CATEGORY_ORDER, row for row',
    labels.length === CATEGORY_ORDER.length && badCat === -1,
    `${labels.length} sheet vs ${CATEGORY_ORDER.length} engine` +
    (badCat === -1 ? '' : ` — first mismatch at row ${hdrRow + 2 + badCat}: sheet "${labels[badCat]}"` +
                          ` vs engine "${CATEGORY_ORDER[badCat]}"`));
}

// ---------------------------------------------------------------- 1. PackConfig reader
let cfg;
{
  cfg = loadPackConfig_();
  check('PackConfig: snap pool read', Object.keys(cfg.qtyByRarity).length === 6,
    JSON.stringify(cfg.qtyByRarity));
  check('PackConfig: TOTAL row and notes excluded from the pool',
    cfg.qtyByRarity['TOTAL'] === undefined && !Object.keys(cfg.qtyByRarity).some(k => k.length > 6));
  check('PackConfig: 6 pack definitions with cards/open 2..7',
    JSON.stringify(PACK_RES.map(p => cfg.cardsPerOpen[p])) === '[2,3,4,5,6,7]',
    JSON.stringify(PACK_RES.map(p => cfg.cardsPerOpen[p])));
  // Pity is AUTHORED on the sheet and gets RETUNED: when the 6th pack tier was retired the whole
  // ladder shifted down a step, so 5-star now forces highest and 6-star is a flat [0]. The old
  // gates named those two tiers explicitly and so asserted one day's config - they went red on a
  // deliberate design change, which is the opposite of what a gate is for. Assert the RULE: the
  // reader round-trips whatever PACK PITY CONFIG says, whichever tier it says it about.
  const stripBrackets = (x) => String(x == null ? '' : x).split('[').join('').split(']').join('');
  const sheetPity = {}, pityTypos = [];
  {
    const v = data['PackConfig'].values;
    let b = -1;
    for (let r = 0; r < v.length; r++)
      if (String((v[r] || [])[0]).trim().indexOf('PACK PITY CONFIG') === 0) { b = r; break; }
    if (b >= 0) {
      const end = pcBlockEnd(v, b);
      for (let r = b + 1; r < end; r++) {
        const name = String((v[r] || [])[0]).trim();
        if (!name || name.toUpperCase() === 'PACK TYPE') continue;
        const key = normalizePackKey(name);
        if (cfg.cardsPerOpen[key] === undefined) { pityTypos.push(name); continue; }
        const probs = stripBrackets(v[r][1]).split(',')
          .map(x => parseFloat(x)).filter(x => isFinite(x));
        const force = String(v[r][2]).trim().toUpperCase();
        sheetPity[key] = { probs: probs.length ? probs : [0],
                           forceHighest: (force === 'TRUE' || force === 'YES' || force === '1') };
      }
    }
  }
  const readBack = {};
  Object.keys(sheetPity).forEach(k => { readBack[k] = cfg.pity[k]; });
  check('PackConfig: pity table round-trips the sheet (probs + forceHighest)',
    Object.keys(sheetPity).length > 0 &&
    JSON.stringify(readBack) === JSON.stringify(sheetPity),
    Object.keys(sheetPity).map(k => k.replace(' Pack', '') + (sheetPity[k].forceHighest ? '*' : '') +
      '=[' + sheetPity[k].probs.join(',') + ']').join(' ') + '   (* = forces highest rarity)');
  // A pity row naming a pack PACK DEFINITIONS does not define is unreachable: the pity silently
  // never applies, and nothing else would notice.
  check('PackConfig: every pity row names a defined pack tier',
    pityTypos.length === 0,
    pityTypos.length ? 'unmatched: ' + pityTypos.join(', ') : Object.keys(sheetPity).length + ' rows');
  // ROTTED 2026-09-02 and fixed by asserting the RULE. This gate was named for the ordering but
  // actually asserted `cost[0] === 1000 && cost[2] === 250` — the prices of a workbook two exports
  // ago. The current STAR CHEST block reads 300/100/50, which is perfectly sorted, so the gate
  // failed on a sheet that is entirely correct. Costs are authored and will change again; the
  // ordering is the invariant the chest sweep depends on (tryBuyChests walks the list and takes the
  // first affordable one, so an unsorted list buys a cheap chest while a better one is affordable).
  const sortedDesc = (list) => list.every((c, i) => i === 0 || list[i - 1].cost >= c.cost);
  check('PackConfig: chests sorted most-expensive-first',
    cfg.chests.length >= 2 && sortedDesc(cfg.chests),
    cfg.chests.map(c => `${c.tier}@${c.cost}->${c.rewardPack}`).join(', '));
  // ...and the reader must SORT, not merely inherit the sheet's order. Reverse the chest rows in
  // place, re-read, and the list must come back descending again. Without this the gate above is
  // vacuous the moment someone authors the block in ascending order.
  {
    const pv = data['PackConfig'].values;
    let first = -1;
    for (let r = 0; r < pv.length; r++)
      if (String((pv[r] || [])[0]).trim().indexOf('STAR CHEST') === 0) { first = r; break; }
    const body = [];                       // data rows: header row is first+1, chests follow
    for (let r = first + 2; r < pv.length; r++) {
      if (String((pv[r] || [])[0]).trim() === '') break;
      if (typeof pv[r][1] === 'number' && pv[r][1] > 0) body.push(r);
    }
    const snap = JSON.stringify(data);
    const rows = body.map(r => pv[r].slice());
    for (let i = 0; i < body.length; i++) pv[body[i]] = rows[body.length - 1 - i];
    _sheetValsCache = {};
    const re = loadPackConfig_();
    check('PackConfig: the chest reader SORTS (reversed sheet still reads descending)',
      body.length >= 2 && re.chests.length === cfg.chests.length && sortedDesc(re.chests),
      're-read: ' + re.chests.map(c => `${c.tier}@${c.cost}`).join(', '));
    data = JSON.parse(snap); _sheetValsCache = {};
    check('PackConfig: chest-order fixture restored', JSON.stringify(data) === snap);
  }
  check('PackConfig: chest purchasing panel read',
    cfg.buyMinStars === 250 && cfg.buyStartDay === 14 && cfg.buyEndProb === 0.95,
    `min ${cfg.buyMinStars} start ${cfg.buyStartDay} p ${cfg.buyEndProb}`);
  check('PackConfig: set + album reward tables read',
    cfg.setRewards.order.length === 8 && cfg.albumRewards.order.length === 3);
  // the grid is gone as a BLOCK (a column-A label); the builder still mentions it in a note row
  check('PackConfig: the removed rarity-probability grid is no longer a block',
    !data['PackConfig'].values.some(r => String(r[0]).trim() === 'PACK RARITY PROBABILITIES'));
  check('PackConfig: retired Season Duration is not read',
    cfg.seasonDays === undefined);
}

// ---------------------------------------------------------------- 2. acquisition seam
{
  const flow = dailyPacksFor_('10-19', 'NONPAYER', Context.get());
  check('dailyPacksFor_ returns a 33 x 6 total grid',
    flow.total.length === DAILY_DAYS && flow.total.every(r => r.length === 6));
  // "No ladder -> zero flow" used to be assertable against the sheet as shipped, because nothing
  // had been typed on the pack columns yet. The workbook now authors them, so that gate was
  // reporting a design milestone as a failure. Mutation-gate the PLUMBING rule instead: strip every
  // '*-star Dly' value everywhere, and the flow must go to exactly zero. This can never rot.
  const packDlyHdrs = PACK_RES.map(r => r.replace(' Pack', ' Dly'));
  const zeroSnap = JSON.stringify(data);
  let zeroedCells = 0;
  Object.keys(data).forEach(name => {
    const sh = data[name];
    if (!sh || !sh.values) return;
    const cols = {};
    sh.values.forEach(row => (row || []).forEach((cell, c) => {
      if (packDlyHdrs.indexOf(String(cell).trim()) >= 0) cols[c] = true;
    }));
    if (!Object.keys(cols).length) return;
    sh.values.forEach(row => Object.keys(cols).forEach(c => {
      if (row && typeof row[c] === 'number' && row[c] !== 0) { row[c] = 0; zeroedCells++; }
    }));
  });
  _sheetValsCache = {};
  const zeroFlow = dailyPacksFor_('10-19', 'NONPAYER', Context.get());
  check('no authored pack ladder -> zero pack flow (plumbing only, D19/1)',
    zeroedCells > 0 && zeroFlow.total.every(r => r.every(v => v === 0)) &&
    zeroFlow.bySource.length === 0,
    zeroedCells + ' authored pack cells blanked, ' + zeroFlow.bySource.length + ' sources left');
  data = JSON.parse(zeroSnap);
  _sheetValsCache = {};
  check('zero-flow fixture restored', JSON.stringify(data) === zeroSnap);
}

// ------------------------------------------- 2b. leaderboard rank distribution (2026-09-02)
// The bug this section exists to stop coming back: a leaderboard used to be priced at three
// quantile ATOMS (position_p25/p50/p75, weight 1/3), so a ladder paying only the top ranks scored
// an EXACT ZERO for every segment whose p25 fell outside the paying band. Flash Race pays a pack at
// rank 1 only and `20-39` reads 2/3/4, so the model said that player wins none of 15 races in 33
// days. Every gate below asserts a RULE against a mutation fixture — none reads a shipped number.
{
  const modelWas = LB_RANK_MODEL;
  const cardsSnap = JSON.stringify(data);

  // -- the distribution itself ---------------------------------------------------------------
  const mkInst = (a, b, c) => ({ position_p25: a, position_p50: b, position_p75: c });
  const cum = (d, upto) => d.filter(x => x.rank <= upto).reduce((s, x) => s + x.p, 0);

  const d1 = rankDist_(mkInst(5, 10, 14), 20);
  check('rankDist_ is a probability distribution (sums to 1, no negative mass)',
    d1 && Math.abs(cum(d1, 1e9) - 1) < 1e-9 && d1.every(x => x.p >= -1e-12),
    'Σp = ' + cum(d1, 1e9).toFixed(12) + ' over ' + d1.length + ' ranks');
  check('rankDist_ honours every measured anchor exactly',
    Math.abs(cum(d1, 5) - 0.25) < 1e-9 && Math.abs(cum(d1, 10) - 0.50) < 1e-9 &&
    Math.abs(cum(d1, 14) - 0.75) < 1e-9,
    'F(5)=' + cum(d1, 5).toFixed(4) + ' F(10)=' + cum(d1, 10).toFixed(4) +
    ' F(14)=' + cum(d1, 14).toFixed(4));
  check('rankDist_ CDF is monotone', d1.every((x, i) => cum(d1, i + 1) >= cum(d1, i) - 1e-12));
  // `100+` Red reads [1,1,2]. A discrete p_q is the SMALLEST rank with F(rank) >= q, so a tie means
  // the mass is already banked there and the highest q wins: P(1) must be .50, not .25 and not the
  // old sampler's 2/3.
  const d2 = rankDist_(mkInst(1, 1, 2), 10);
  check('rankDist_ tie rule: repeated quantile ranks take the HIGHEST q',
    Math.abs(d2[0].p - 0.50) < 1e-9, 'P(rank 1) = ' + d2[0].p.toFixed(4));
  // A quantile that is absent must drop WITH its own q, not slide the others onto wrong ones.
  const d3 = rankDist_(mkInst(0, 4, 8), 20);
  check('rankDist_ drops an absent quantile with its own probability',
    Math.abs(cum(d3, 4) - 0.50) < 1e-9 && Math.abs(cum(d3, 8) - 0.75) < 1e-9,
    'F(4)=' + cum(d3, 4).toFixed(4) + ' F(8)=' + cum(d3, 8).toFixed(4));
  // N must exceed p75 or the 25% above it has nowhere to sit and leaks back into paying ranks.
  const d4 = rankDist_(mkInst(6, 11, 17), 10);       // nMax deliberately BELOW p75 (stale LBSize)
  check('rankDist_ survives a bracket size smaller than p75 (stale LBSize panel)',
    d4 && Math.abs(cum(d4, 1e9) - 1) < 1e-9 && Math.abs(cum(d4, 17) - 0.75) < 1e-9,
    'N = ' + d4.length + ', Σp = ' + cum(d4, 1e9).toFixed(9));

  // -- block-scoped config read --------------------------------------------------------------
  // Race carries five `LBSize` rows, one per event. readSPLabel_ scans the whole sheet and returns
  // the FIRST, collapsing all five onto Red's; blockLabel_ must take the nearest one ABOVE the
  // block. Written as a mutation so it cannot freeze whatever the panels happen to say today.
  {
    const rv = data['Race_v2'].values;
    const stamp = {};
    [[4, 8, 111], [22, 26, 222], [40, 44, 333], [58, 62, 444], [76, 80, 555]]
      .forEach(([panelRow, hdrRow, val]) => {
        for (let c = 0; c < (rv[panelRow] || []).length; c++)
          if (String(rv[panelRow][c]).trim().toLowerCase() === 'lbsize') { rv[panelRow][c + 1] = val; break; }
        stamp[hdrRow] = val;
      });
    _sheetValsCache = {};
    const got = Object.keys(stamp).map(h => lbSize_('Race_v2', +h));
    check('blockLabel_ resolves LBSize per BLOCK, not per sheet',
      got.join(',') === Object.keys(stamp).map(h => stamp[h]).join(','),
      'read ' + got.join(',') + ' — expected ' + Object.keys(stamp).map(h => stamp[h]).join(','));
    data = JSON.parse(cardsSnap); _sheetValsCache = {};
  }

  // -- the headline rule: a top-only ladder must pay SOMETHING to a mid segment ---------------
  // Fixture: strip every authored pack, then put ONE 1-star pack on Flash Race rank 1 alone.
  // `20-39` reads p25/p50/p75 = 2/3/4, so no quantile touches rank 1.
  {
    const rv = data['Race_v2'].values;
    let dlyCol = -1;
    for (let c = 0; c < (rv[80] || []).length; c++)
      if (String(rv[80][c]).trim() === '1-star Dly') dlyCol = c;
    const packDlyHdrs = PACK_RES.map(r => r.replace(' Pack', ' Dly'));
    Object.keys(data).forEach(name => {                 // clear the whole workbook's pack ladders
      const sh = data[name];
      if (!sh || !sh.values) return;
      const cols = {};
      sh.values.forEach(row => (row || []).forEach((cell, c) => {
        if (packDlyHdrs.indexOf(String(cell).trim()) >= 0) cols[c] = true;
      }));
      sh.values.forEach(row => Object.keys(cols).forEach(c => {
        if (row && typeof row[c] === 'number') row[c] = 0;
      }));
    });
    rv[81][dlyCol] = 1;                                 // rank 1 only
    const packsFor = (seg, payer) => {
      _sheetValsCache = {};
      const ctx = Context.get(), inst = ctx.ds.eventInst('Flash Race', seg, payer);
      const e = rewardE_('Flash Race', seg, payer, ctx.ds);
      const row = packLane_('Flash Race', seg, payer, ctx, e && e.eV2, inst, 'Flash Race');
      return PACK_RES.reduce((a, r) => a + num(row[r]), 0);
    };
    check('fixture sane: Flash Race 20-39 never finishes at rank 1 in the quantiles',
      dlyCol >= 0 && [25, 50, 75].every(q => {
        const i = Context.get().ds.eventInst('Flash Race', '20-39', 'NONPAYER');
        return num(i['position_p' + q]) !== 1;
      }));
    LB_RANK_MODEL = 'quantiles';
    const oldPacks = packsFor('20-39', 'NONPAYER');
    LB_RANK_MODEL = 'cdf';
    const newPacks = packsFor('20-39', 'NONPAYER');
    check('THE BUG: three-atom sampler pays a top-only ladder EXACTLY ZERO here',
      oldPacks === 0, 'quantiles model -> ' + oldPacks);
    check('rank CDF pays a top-only ladder a positive, bounded amount',
      newPacks > 0 && newPacks < 1, 'cdf model -> ' + newPacks.toFixed(4) + ' packs/season');
    // ...and it must come DOWN where a quantile sat on rank 1 (p25 = 1 pins P(1) at .25, the
    // conservative end of the feasible [0.25, 0.5); the old sampler used .333).
    LB_RANK_MODEL = 'quantiles';
    const oldTop = packsFor('40-99', 'NONPAYER');
    LB_RANK_MODEL = 'cdf';
    const newTop = packsFor('40-99', 'NONPAYER');
    check('rank CDF REDUCES the top-segment over-grant (p25 = 1 -> P(1) = .25, not 1/3)',
      oldTop > 0 && newTop > 0 && newTop < oldTop &&
      Math.abs(newTop / oldTop - 0.75) < 1e-6,
      oldTop.toFixed(4) + ' -> ' + newTop.toFixed(4) + ' (x' + (newTop / oldTop).toFixed(4) + ')');

    // A ladder paying the SAME thing on every rank must be invariant to how the mass is spread —
    // the one case where both models have to agree, and a sharp check that Σp = 1 end to end.
    for (let r = 81; r <= 87; r++) rv[r][dlyCol] = 1;
    LB_RANK_MODEL = 'quantiles';
    const flatOld = packsFor('40-99', 'NONPAYER');
    LB_RANK_MODEL = 'cdf';
    const flatNew = packsFor('40-99', 'NONPAYER');
    check('a FLAT ladder is invariant to the rank model (all mass inside the ladder)',
      Math.abs(flatOld - flatNew) < 1e-9, flatOld.toFixed(6) + ' vs ' + flatNew.toFixed(6));

    data = JSON.parse(cardsSnap); _sheetValsCache = {};
  }

  // -- gains model and card sim must describe the SAME game ----------------------------------
  // packLane_ is an expectation; packRungs_ is the discrete draw behind it. If they drift, the
  // card sim's season totals stop reconciling with the EcoGainsSim cell.
  {
    _sheetValsCache = {};
    const ctx = Context.get();
    let worst = 0, worstAt = '';
    ['Red Challenge', 'Flash Race', 'Target Day', 'Kite Festival'].forEach(cat => {
      ['0-9', '20-39', '100+'].forEach(seg => {
        const spec = LB_R_SPECS[cat];
        const inst = ctx.ds.eventInst(spec.inst, seg, 'NONPAYER');
        const e = rewardE_(cat, seg, 'NONPAYER', ctx.ds);
        const rr = packRungs_(cat, seg, 'NONPAYER', ctx, 0);
        PACK_RES.forEach(t => {
          const fromE = num(e && e.eV2[t]);
          let fromRungs = 0;
          if (rr) rr.groups.forEach(g => g.rungs.forEach(x => { fromRungs += x.p * num(x.packs[t]); }));
          const gap = Math.abs(fromE - fromRungs);
          if (gap > worst) { worst = gap; worstAt = cat + '/' + seg + '/' + t; }
        });
      });
    });
    check('packRungs_ rung expectation == lbE_ E_v2, per tier (card sim reconciles with gains)',
      worst < 1e-9, 'worst gap ' + worst.toExponential(2) + (worstAt ? ' at ' + worstAt : ''));
  }

  LB_RANK_MODEL = modelWas;
  data = JSON.parse(cardsSnap); _sheetValsCache = {};
  check('rank-distribution fixtures restored', JSON.stringify(data) === cardsSnap);
}

// ---------------------------------------------------------------- 3. end-to-end with a ladder
// Author a pack ladder the way the user will: put packs on the Jigsaw _v2 milestones and on the
// Flash Race _v2 rank ladder, then run the whole sim.
function authorLadders() {
  const put = (sheet, hdrRow, r0, r1, header, val) => {
    const cols = {};
    data[sheet].values[hdrRow].forEach((h, i) => { cols[String(h).trim()] = i; });
    for (let r = r0; r <= Math.min(r1, data[sheet].values.length - 1); r++)
      if (data[sheet].values[r]) data[sheet].values[r][cols[header]] = val;
  };
  put('J_v2', 9, 10, 21, '3-star Dly', 1);        // every Jigsaw milestone pays a 3-star pack
  put('Race_v2', 80, 81, 87, '1-star Dly', 2);    // every Flash Race rank pays two 1-star packs
  put('TE', 14, 15, 21, '6-star Dly', 1);         // Team Event leaderboard pays a 6-star pack
}

let firstRun = null;
{
  const snapshot = JSON.parse(RAW);
  authorLadders();
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};

  const flow = dailyPacksFor_('10-19', 'NONPAYER', Context.get());
  const expected = flow.total.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
  check('authored ladders produce a nonzero pack flow', expected > 0, 'expected packs ' + f2(expected));
  // The old form asserted the attributed set was EXACTLY the three sheets this fixture authors,
  // which held only while the workbook itself had no pack ladders. It now authors many, so assert
  // the two rules that actually matter: authoring a pack on a sheet makes that source appear, and
  // every attributed source is a real engine category (not a stray sheet name or a label typo).
  const attributed = flow.bySource.map(s => s.cat);
  const authored = ['Flash Race', 'Jigsaw', 'Team Event'];
  const missing = authored.filter(c => attributed.indexOf(c) < 0);
  const bogus = attributed.filter(c => CATEGORY_ORDER.indexOf(c) < 0);
  check('pack flow is attributed to the sources that pay them',
    missing.length === 0 && bogus.length === 0,
    (missing.length ? 'authored but unattributed: ' + missing.join(', ') + '  ' : '') +
    (bogus.length ? 'not an engine category: ' + bogus.join(', ') + '  ' : '') +
    attributed.length + ' sources: ' + attributed.join(', '));

  const seg = mkSheet('Col_Cards_Daily');
  seg.getRange('B2').setValue('10-19');
  seg.getRange('D2').setValue('NONPAYER');
  seg.getRange('G2').setValue(12345);

  const opened = SimulatePackOpenings();
  check('SimulatePackOpenings ran and opened packs', opened > 0, opened + ' packs');

  const tally = {};
  for (let i = 0; i < 12; i++)
    tally[data['Col_Cards_Daily'].values[41 + i][0]] = data['Col_Cards_Daily'].values[41 + i][1];
  console.log('  tally:', JSON.stringify(tally));

  check('tally: cards drawn == new + dupes',
    tally['Total Cards Drawn'] === tally['Unique Cards'] + tally['Duplicate Cards'],
    `${tally['Total Cards Drawn']} vs ${tally['Unique Cards']} + ${tally['Duplicate Cards']}`);
  check('tally: final balance == earned - spent',
    tally['Final Star Balance'] === tally['Stars Earned'] - tally['Stars Spent on Chests'],
    `${tally['Final Star Balance']} vs ${tally['Stars Earned']} - ${tally['Stars Spent on Chests']}`);
  check('tally: segment/payer recorded', tally['Segment / Payer'] === '10-19 / NONPAYER',
    String(tally['Segment / Payer']));
  check('tally: expected packs is the unrounded flow',
    Math.abs(tally['Expected Packs (fractional)'] - expected) < 0.02,
    `${tally['Expected Packs (fractional)']} vs ${f2(expected)}`);
  check('granted packs are within 1 per (source,tier) of the expectation (unbiased rounding)',
    Math.abs(tally['Total Packs Opened'] - expected) <= 18,
    `granted ${tally['Total Packs Opened']} vs expected ${f2(expected)}`);

  // running totals: 33 rows, monotonic packs-opened, album tier never decreases
  const tot = [];
  for (let i = 0; i < 33; i++) tot.push(data['Col_Cards_Daily'].values[5 + i]);
  check('running totals: 33 day rows, days 1..33 in order',
    tot.length === 33 && tot.every((r, i) => r[0] === i + 1));
  check('running totals: packs-opened is monotonic non-decreasing',
    tot.every((r, i) => i === 0 || r[6] >= tot[i - 1][6]));
  check('running totals: album tier never goes backwards',
    tot.every((r, i) => i === 0 || r[5] >= tot[i - 1][5]));
  check('running totals: % complete within [0,1]', tot.every(r => r[3] >= 0 && r[3] <= 1));

  // pack log
  const log = [];
  for (let r = 56; r < data['Col_Cards_Daily'].values.length; r++) {
    const row = data['Col_Cards_Daily'].values[r];
    if (!row || row[0] === '' || row[0] == null) break;
    log.push(row);
  }
  check('pack log: every row has a day in 1..33',
    log.length > 0 && log.every(r => r[0] >= 1 && r[0] <= 33), log.length + ' rows');
  check('pack log: days are non-decreasing', log.every((r, i) => i === 0 || r[0] >= log[i - 1][0]));
  check('pack log: every pack name is a known tier or blank',
    log.every(r => r[1] === '' || PACK_RES.indexOf(r[1]) >= 0),
    [...new Set(log.map(r => r[1]))].join(', '));
  const isEmptyLabel = (t) => t === '(did not play)' || t === '(played, no pack dropped)';
  check('pack log: sources are real engine categories (or a chest / an empty-day reason)',
    log.every(r => isEmptyLabel(r[2]) || /Chest Opened/.test(r[2]) || CATEGORY_ORDER.indexOf(r[2]) >= 0),
    [...new Set(log.map(r => r[2]))].join(' | '));
  // An empty day must say WHICH kind of empty it was, and a played-but-empty day must show what the
  // session looked like — that detail is the whole point of splitting the old '(nothing)' label.
  const empties = log.filter(r => isEmptyLabel(r[2]));
  check('pack log: empty days say whether the player showed up',
    empties.every(r => r[2] === '(did not play)' || r[2] === '(played, no pack dropped)'),
    empties.length + ' empty rows');
  const playedEmpty = log.filter(r => r[2] === '(played, no pack dropped)');
  check('pack log: played-but-empty days report the session',
    playedEmpty.length === 0 || playedEmpty.every(r => /level|min|session/.test(String(r[3]))),
    playedEmpty.length ? playedEmpty[0][3] : 'no played-empty days in this run');
  check('pack log: a day that granted a pack is never labelled "did not play"',
    !log.some(r => r[2] === '(did not play)' && r[1] !== ''));

  // STALE-SHEET GUARD. Snapshot / mutate / assert / restore: put an Album label back where the OLD
  // Col_Cards_Daily layout had it (column J, inside the widened log) and the run must ABORT rather than
  // clear over it. Without this, a script/sheet mismatch silently eats the first column of every
  // 3x3 grid and the grids simply render 2 wide, with nothing reporting an error.
  {
    const snapshot = JSON.stringify(data['Col_Cards_Daily'].values);
    data['Col_Cards_Daily'].values[55][9] = 'Album #1';        // row 56, column J
    let aborted = '';
    try { SimulatePackOpenings(); } catch (e) { aborted = String(e.message || e); }
    check('stale Col_Cards_Daily layout aborts instead of clearing over the album grids',
      /OLD layout/.test(aborted) && /column J/.test(aborted),
      aborted ? aborted.slice(0, 90) + '...' : 'run completed — the guard did NOT fire');
    data['Col_Cards_Daily'].values = JSON.parse(snapshot);
    check('stale-guard fixture restored',
      JSON.stringify(data['Col_Cards_Daily'].values) === snapshot);
  }

  // Grid geometry: all THREE columns painted, and the set NAME written beside the anchor without
  // clobbering the 'Set #N' label that findGridAnchors_ locates the grid by.
  // Both blocks below RUN the sim, which writes Col_Cards_Daily. The determinism gate downstream
  // compares that sheet byte for byte, so the state is snapshotted here and restored after.
  const cardsSnap = JSON.stringify(data['Col_Cards_Daily'].values);

  // RARITY RECONCILIATION. AlbumConfig and PackConfig name the top tier differently ('6-star' vs
  // 'Gold'); the reader used to DROP every card whose rarity was not a defined name, which silently
  // removed 10 of 72 cards, made six of eight sets uncompletable and orphaned the Gold pool. Assert
  // the catalog keeps every CARD row, and that an unresolvable rarity is a loud error not a drop.
  {
    const albumSh = mkSheet('AlbumConfig');
    const rows = albumSh.getRange(3, 1, albumSh.getLastRow() - 2, 5).getValues()
      .filter(r => r[0] && r[1] && r[4] && /^CARD/i.test(String(r[0])));
    const cfgR = loadPackConfig_();
    const valid = {};
    cfgR.rarityOrder.forEach(x => { valid[x] = true; });
    const unresolved = rows.filter(r => {
      const t = String(r[4]).trim();
      if (valid[t]) return false;
      const m = t.match(/^(\d+)\s*[-\s]?\s*(?:star|\u2605|\*)?$/i);
      return !(m && Number(m[1]) - 1 >= 0 && Number(m[1]) - 1 < cfgR.rarityOrder.length);
    });
    check('every AlbumConfig card resolves to a defined rarity (none silently dropped)',
      unresolved.length === 0,
      unresolved.length ? unresolved.slice(0, 3).map(r => r[0] + '=' + r[4]).join(', ')
                        : rows.length + ' card rows all resolvable');
    // and an unresolvable one must THROW rather than shrink the catalog
    const snapA = JSON.stringify(data['AlbumConfig'].values);
    const av = data['AlbumConfig'].values;
    let hit = -1;
    for (let r = 2; r < av.length; r++)
      if (av[r] && String(av[r][0]).indexOf('CARD') === 0) { hit = r; break; }
    if (hit >= 0) {
      av[hit][4] = 'Platinum';
      let threw = '';
      try { SimulatePackOpenings(); } catch (e) { threw = String(e.message || e); }
      check('an unknown rarity stops the run instead of dropping the card',
        /does not define/.test(threw), threw ? threw.slice(0, 90) + '...' : 'run completed silently');
      data['AlbumConfig'].values = JSON.parse(snapA);
      check('rarity fixture restored', JSON.stringify(data['AlbumConfig'].values) === snapA);
    }
  }

  // LEADERBOARD EXCLUSIVITY. A rank ladder pays exactly ONE place per instance. The old accumulator
  // emitted "rank 4", "rank 2" and "rank 1" for Target Day on a single day, which are mutually
  // exclusive outcomes. Assert no source ever shows two different ranks on the same day.
  {
    const LB = { 'Target Day': 1, 'Bomb Challenge': 1, 'Chuck Challenge': 1, 'Red Challenge': 1,
                 'Level Race': 1, 'Flash Race': 1, 'Kite Festival': 1 };
    let collisions = [];
    [11, 101, 1009, 7919].forEach(sd => {
      const sh = mkSheet('Col_Cards_Daily');
      sh.getRange('B2').setValue('40-99');
      sh.getRange('D2').setValue('NONPAYER');
      sh.getRange('G2').setValue(sd);
      SimulatePackOpenings();
      const v2 = data['Col_Cards_Daily'].values, seen = {};
      for (let r = 57; r < 57 + 300; r++) {
        const row = v2[r - 1];
        if (!row || row[0] === '' || row[0] == null) break;
        if (!row[1] || !LB[row[2]]) continue;
        const k = row[0] + '|' + row[2], rk = String(row[3]);
        if (seen[k] && seen[k] !== rk) collisions.push('seed ' + sd + ' day ' + row[0] + ' ' + row[2] + ': ' + seen[k] + ' + ' + rk);
        seen[k] = rk;
      }
    });
    check('a leaderboard never pays two different ranks on the same day',
      collisions.length === 0, collisions.length ? collisions.slice(0, 3).join(' | ') : '4 seeds clean');
  }

  // COLLECTION ECO GAINS. Completing a set or an album pays real currency out of the PackConfig
  // SET REWARDS / ALBUM REWARDS blocks. That payout used to exist ONLY as text in a Note cell, so
  // the collection feature's contribution to the economy was unreadable as a number. Assert it is
  // now totalled, per source, and that the total equals the sum over the completions that actually
  // happened - not merely that it is non-zero, which a stuck accumulator would also satisfy.
  {
    const snap = JSON.stringify(data['Col_Cards_Daily'].values);
    const raceSnap = JSON.stringify(data['Race_v2'].values);
    // hand every rank of one leaderboard a fat pack so sets actually complete in a 33-day run
    const rv = data['Race_v2'].values;
    const packCol = (rv[8] || []).findIndex(c => String(c).trim() === '6-star Dly');
    if (packCol > 0) {
      for (let r = 9; r <= 18; r++) {
        if (!rv[r]) rv[r] = [];
        while (rv[r].length <= packCol) rv[r].push('');
        rv[r][packCol] = 8;
      }
    }
    const sh = mkSheet('Col_Cards_Daily');
    sh.getRange('B2').setValue('40-99');
    sh.getRange('D2').setValue('NONPAYER');
    sh.getRange('G2').setValue(4242);
    logs.length = 0;
    SimulatePackOpenings();

    const v = data['Col_Cards_Daily'].values;
    const setCoins = +((v[41] || [])[4]) || 0;          // E42
    const setAll = String((v[42] || [])[4] || '');      // E43
    const albCoins = +((v[43] || [])[4]) || 0;          // E44

    // independently re-derive from the log's own completion notes
    const cfgR = loadPackConfig_();
    let expectSetCoins = 0, setsSeen = 0;
    for (let r = 57; r < 57 + 300; r++) {
      const row = v[r - 1];
      if (!row || row[0] === '' || row[0] == null) break;
      const note = String(row[9] || '');
      const m = note.match(/Set (\d+) completed/g);
      if (!m) continue;
      m.forEach(x => {
        const id = 'Set ' + x.match(/\d+/)[0];
        setsSeen++;
        expectSetCoins += num((cfgR.setRewards.map[id] || {})['Coins']);
      });
    }
    check('set-completion eco gains are totalled, not just noted',
      setsSeen === 0 || setCoins > 0,
      setsSeen + ' set completions in the log, Set Reward Coins = ' + setCoins);
    check('set-reward coins equal the sum over the completions that happened',
      Math.abs(setCoins - expectSetCoins) < 1e-6,
      setCoins + ' written vs ' + expectSetCoins + ' re-derived from the log notes');
    check('the per-resource breakdown is written beside the coin total',
      setsSeen === 0 || /Coins/.test(setAll), setAll.slice(0, 60));
    check('album-reward coins are a number (0 when no album completed)',
      isFinite(albCoins), String(albCoins));

    data['Race_v2'].values = JSON.parse(raceSnap);
    data['Col_Cards_Daily'].values = JSON.parse(snap);
    check('collection-eco-gains fixture restored',
      JSON.stringify(data['Race_v2'].values) === raceSnap &&
      JSON.stringify(data['Col_Cards_Daily'].values) === snap);
  }

  // UNBIASEDNESS. Replacing the accumulator with per-instance Bernoulli draws must not change what
  // the model PAYS, only when it pays it: the granted count has to track the expectation packRungs_
  // derives from packLane_. Averaged over seeds so a single lucky run cannot hide a systematic
  // over- or under-grant (the old trailing-fraction round-up was exactly such a bias).
  {
    let granted = 0, expected = 0;
    const seeds = [3, 17, 101, 1009, 7919, 15485863, 32452843, 49979687];
    seeds.forEach(sd => {
      const sh = mkSheet('Col_Cards_Daily');
      sh.getRange('B2').setValue('40-99');
      sh.getRange('D2').setValue('NONPAYER');
      sh.getRange('G2').setValue(sd);
      logs.length = 0;
      SimulatePackOpenings();
      const m = (logs.find(x => x.indexOf('Stage 1:') === 0) || '')
        .match(/Stage 1: (\d+) packs granted \(expected ([\d.]+)\)/);
      if (m) { granted += +m[1]; expected += +m[2]; }
    });
    const bias = expected > 0 ? (granted / expected - 1) * 100 : 0;
    check('granted pack count is unbiased against the modelled expectation',
      expected > 0 && Math.abs(bias) < 12,
      granted + ' granted vs ' + expected.toFixed(1) + ' expected over ' + seeds.length +
      ' seeds (' + bias.toFixed(1) + '%)');
  }

  data['Col_Cards_Daily'].values = JSON.parse(cardsSnap);
  check('sim-run fixtures restored before the determinism check',
    JSON.stringify(data['Col_Cards_Daily'].values) === cardsSnap);

  // The grid ANCHOR may sit immediately after the log (no spacer) or one column later. Both must
  // be found: a scan that assumes the spacer silently finds nothing on a hand-arranged sheet,
  // paints no grid, and leaves whatever stale content was there (exactly what left the live
  // grids reading 2 columns wide). Gate the scan range, not just the happy path.
  {
    const startCol = gridScanRange_().match(/^([A-Z]+)/)[1].split('')
      .reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
    check('grid scan starts at the first column past the log (no spacer assumed)',
      startCol === LOG_COLS.length + 1,
      'scan starts at column ' + startCol + ', log ends at ' + LOG_COLS.length);
  }

  // SELF-HEAL. Strip every Album/Set label from the sheet, as the live workbook had ended up, and
  // the writer must REBUILD the scaffold rather than silently painting nothing. Without this the
  // grids stay stale forever and no error is raised anywhere.
  {
    const snap = JSON.stringify(data['Col_Cards_Daily'].values);
    const vals = data['Col_Cards_Daily'].values;
    let wiped = 0;
    for (let r = 0; r < vals.length; r++)
      for (let c = 0; c < (vals[r] || []).length; c++)
        if (/^(Album|Set)\s*#\s*\d+$/i.test(String(vals[r][c]).trim())) { vals[r][c] = ''; wiped++; }
    check('grid-label fixture wiped some labels', wiped > 0, wiped + ' labels removed');
    const album = mkSheet('AlbumConfig'), lastA = album.getLastRow();
    const cat2 = album.getRange(3, 1, lastA - 2, 5).getValues()
      .filter(r => r[0] && r[1] && r[4] && /^CARD/i.test(String(r[0])))
      .map(r => ({ name: r[1], setNum: Number(r[2]), setName: String(r[3] == null ? '' : r[3]).trim(),
                   rarity: String(r[4]).trim(), key: r[1] + ' ' + String(r[4]).trim() }));
    const full2 = {}; cat2.forEach(c => { full2[c.key] = true; });
    writeAlbumGrids_(mkSheet('Col_Cards_Daily'), cat2, full2, 0, 9, 3);
    let sets = 0, named = 0;
    for (let r = 0; r < vals.length; r++)
      for (let c = 0; c < (vals[r] || []).length; c++)
        if (/^Set\s*#\s*\d+$/i.test(String(vals[r][c]).trim())) {
          sets++;
          if (String((vals[r] || [])[c + 1] || '').trim()) named++;
        }
    check('missing scaffold is rebuilt from the catalog', sets > 0, sets + ' Set labels recreated');
    check('every rebuilt Set label carries its set name', sets > 0 && named === sets,
      named + '/' + sets + ' named');
    data['Col_Cards_Daily'].values = JSON.parse(snap);
    check('grid-label fixture restored', JSON.stringify(data['Col_Cards_Daily'].values) === snap);
  }

  {
    // This gate REPAINTS the grids with a synthetic full collection, so it must snapshot and restore
    // like every other mutating gate here — the determinism check downstream compares the whole
    // sheet byte-for-byte and would otherwise fail on this fixture's leftovers.
    const gridSnap = JSON.stringify(data['Col_Cards_Daily'].values);
    const album = mkSheet('AlbumConfig'), last = album.getLastRow();
    const cat = album.getRange(3, 1, last - 2, 5).getValues()
      .filter(r => r[0] && r[1] && r[4] && /^CARD/i.test(String(r[0])))
      .map(r => ({ name: r[1], setNum: Number(r[2]), setName: String(r[3] == null ? '' : r[3]).trim(),
                   rarity: String(r[4]).trim(), key: r[1] + ' ' + String(r[4]).trim() }));
    const full = {}; cat.forEach(c => { full[c.key] = true; });
    writeAlbumGrids_(mkSheet('Col_Cards_Daily'), cat, full, 0, 9);
    const vals = data['Col_Cards_Daily'].values;
    let anchorRow = -1, anchorCol = -1;
    for (let r = 55; r < vals.length && anchorRow < 0; r++)
      for (let c = 0; c < (vals[r] || []).length; c++)
        if (String(vals[r][c]).trim() === 'Set #1') { anchorRow = r; anchorCol = c; break; }
    check('grid anchor found after a repaint', anchorRow >= 0,
      anchorRow >= 0 ? 'Set #1 at row ' + (anchorRow + 1) + ' col ' + (anchorCol + 1) : 'not found');
    if (anchorRow >= 0) {
      const painted = [0, 1, 2].map(i =>
        [0, 1, 2].filter(j => String((vals[anchorRow + 1 + i] || [])[anchorCol + j] || '') !== '').length);
      check('every one of the 3 grid columns is painted',
        painted.every(n => n === 3), 'cells per row: ' + painted.join('/') + ' (want 3/3/3)');
      check('the set NAME is written beside the anchor, not over it',
        String(vals[anchorRow][anchorCol]).trim() === 'Set #1' &&
        String(vals[anchorRow][anchorCol + 1] || '').trim() !== '',
        String(vals[anchorRow][anchorCol]) + ' | ' + String(vals[anchorRow][anchorCol + 1]));
    }
    data['Col_Cards_Daily'].values = JSON.parse(gridSnap);
    check('grid fixture restored', JSON.stringify(data['Col_Cards_Daily'].values) === gridSnap);
  }

  firstRun = JSON.stringify(data['Col_Cards_Daily'].values);
  data = snapshot;   // restore for the next block
}

// ---------------------------------------------------------------- 4. determinism
{
  authorLadders();
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  const seg = mkSheet('Col_Cards_Daily');
  seg.getRange('B2').setValue('10-19');
  seg.getRange('D2').setValue('NONPAYER');
  seg.getRange('G2').setValue(12345);
  SimulatePackOpenings();
  check('same seed + same inputs -> byte-identical Col_Cards_Daily (deterministic)',
    JSON.stringify(data['Col_Cards_Daily'].values) === firstRun);

  const before = JSON.stringify(data['Col_Cards_Daily'].values);
  seg.getRange('G2').setValue(999);
  SimulatePackOpenings();
  check('a different seed changes the run', JSON.stringify(data['Col_Cards_Daily'].values) !== before);
}

// ---------------------------------------------------------------- 5. segment sensitivity
{
  data = JSON.parse(RAW);
  authorLadders();
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  const seg = mkSheet('Col_Cards_Daily');
  const run = (s, p) => {
    seg.getRange('B2').setValue(s);
    seg.getRange('D2').setValue(p);
    seg.getRange('G2').setValue(4242);
    SimulatePackOpenings();
    return data['Col_Cards_Daily'].values[41][1];        // Total Packs Opened
  };
  const light = run('0-9', 'NONPAYER');
  const heavy = run('100+', 'PAYER');
  check('heavier segment/payer opens more packs (real segmentation is wired)',
    heavy > light, `0-9 NONPAYER ${light} vs 100+ PAYER ${heavy}`);

  // A. 0 has no behaviour telemetry -> no pack flow at all (documented appendix semantics)
  const appendix = run('A. 0', 'NONPAYER');
  check('A. 0 appendix gets no packs (no behaviour telemetry to price reach)',
    appendix === 0, 'packs ' + appendix);
}

// ---------------------------------------------------------------- 6. pool / draw semantics
{
  data = JSON.parse(RAW);
  authorLadders();
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  const seg = mkSheet('Col_Cards_Daily');
  seg.getRange('B2').setValue('100+');
  seg.getRange('D2').setValue('PAYER');
  seg.getRange('G2').setValue(7);
  SimulatePackOpenings();

// Column index of a pack-log field, from the engine's own LOG_COLS. NOT from the Col_Cards_Daily header
// row: that is written by the builder and lags until the sheet is re-imported, so it would report
// the OLD layout against NEW output. The log gained an 'Earned From' column on 2026-08-18 and every
// fixed index below it shifted by one — the pity gates then read the blank Album column as
// 'Cards Drawn', scanned nothing, and reported "0 violations, 0 honoured": a pass-shaped result that
// proves nothing. Deriving the index keeps a future column from quietly disarming these gates.
function logCol(name){
  const i = LOG_COLS.indexOf(name);
  if (i < 0) throw new Error('pack log has no "' + name + '" column — LOG_COLS: ' + LOG_COLS.join('|'));
  return i;
}

  // Rarity mix of everything drawn should track the SNAP POOL shares, not any per-pack grid.
  const log = [];
  for (let r = 56; r < data['Col_Cards_Daily'].values.length; r++) {
    const row = data['Col_Cards_Daily'].values[r];
    if (!row || row[0] === '' || row[0] == null) break;
    if (row[logCol('Cards Drawn')]) log.push(String(row[logCol('Cards Drawn')]));
  }
  const drawn = log.join(', ').split(', ').filter(Boolean);
  const mix = {};
  drawn.forEach(k => { const m = k.match(/(\d★|Gold)$/); if (m) mix[m[1]] = (mix[m[1]] || 0) + 1; });
  const totalDrawn = Object.values(mix).reduce((a, b) => a + b, 0);
  const poolTotal = Object.values(cfg.qtyByRarity).reduce((a, b) => a + b, 0);
  console.log('  drawn rarity mix:', JSON.stringify(mix), 'of', totalDrawn);
  console.log('  snap pool shares:', JSON.stringify(
    Object.fromEntries(Object.entries(cfg.qtyByRarity).map(([k, v]) => [k, f2(v / poolTotal)]))));
  // Data-aware: Gold shipped at Qty 0 through workbook (13) and is stocked (41) from (14) on.
  // Assert the POOL RULE ("a rarity is drawable iff it has copies"), not the old workbook state.
  const goldQty = cfg.qtyByRarity['Gold'] || 0;
  check('Gold cards drawn iff the snap pool stocks them',
    goldQty > 0 ? (mix['Gold'] || 0) > 0 : !mix['Gold'],
    `pool qty ${goldQty}, drawn ${mix['Gold'] || 0}`);
  // Pool-proportionality is only the whole story when the ALBUM SET SKEW is NEUTRAL. The skew
  // multiplies a card's draw weight by its SET, and the workbook now authors Album 1 at
  // [15, 7.5, 2, 1.5, ...] - so the early sets, and whatever rarities they happen to hold, are
  // pulled far harder than their pool share. The old gate asserted 1-star dominance against the
  // shipped sheet and so went red on a feature working as designed (the skew was inert until
  // 2026-08-25 and typing a 900 into it did nothing at all).
  // Split it into the two rules that are actually true, each mutation-gated:
  //   (a) with the skew neutralised, draws track the snap pool -> 1-star dominates;
  //   (b) with the skew as authored, the most-skewed set is drawn harder than under (a).
  const setOfCardName = {};
  (data['AlbumConfig'].values || []).forEach(r => {
    if (r && r[1] && r[2] !== '' && r[2] != null) setOfCardName[String(r[1]).trim()] = Number(r[2]);
  });
  const runMix = (seed) => {
    const sg = mkSheet('Col_Cards_Daily');
    sg.getRange('B2').setValue('100+');
    sg.getRange('D2').setValue('PAYER');
    sg.getRange('G2').setValue(seed === undefined ? 7 : seed);
    SimulatePackOpenings();
    const rows = [];
    for (let r = 56; r < data['Col_Cards_Daily'].values.length; r++) {
      const row = data['Col_Cards_Daily'].values[r];
      if (!row || row[0] === '' || row[0] == null) break;
      if (row[logCol('Cards Drawn')]) rows.push(String(row[logCol('Cards Drawn')]));
    }
    const keys = rows.join(', ').split(', ').filter(Boolean);
    const rar = {}, bySet = {};
    keys.forEach(k => {
      const m = k.match(/(\d★|Gold)$/);
      if (m) rar[m[1]] = (rar[m[1]] || 0) + 1;
      const nm = k.slice(0, k.lastIndexOf(' '));
      const sn = setOfCardName[nm];
      if (sn) bySet[sn] = (bySet[sn] || 0) + 1;
    });
    return { rar, bySet, total: keys.length };
  };

  // (a) THREE things bend the mix away from raw pool shares, and all three must be switched off
  // before "rarity is a property of the pool" is a testable statement:
  //     * ALBUM SET SKEW    - multiplies a card's weight by its set;
  //     * rarity pity       - forceHighest drags pulls onto the rarest stocked tier;
  //     * dry-streak pity   - forces an UNOWNED card, and 1-star is the tier a player completes
  //                           first, so "give them something new" systematically steers away from
  //                           it. This one is why 2-star out-drew 1-star even with the skew off.
  const skewSnap = JSON.stringify(data);
  let skewCells = 0, pityCells = 0;
  {
    const v = data['PackConfig'].values;
    const flatten = (label, fn) => {
      let b = -1;
      for (let r = 0; r < v.length; r++)
        if (String((v[r] || [])[0]).trim().indexOf(label) === 0) { b = r; break; }
      if (b < 0) return;
      for (let r = b + 1; r < pcBlockEnd(v, b); r++) if (v[r]) fn(v[r]);
    };
    flatten('ALBUM SET SKEW', row => row.forEach((cell, c) => {
      if (c > 0 && typeof cell === 'number' && cell !== 1) { row[c] = 1; skewCells++; }
    }));
    flatten('PACK PITY CONFIG', row => {
      if (!String(row[0]).trim() || String(row[0]).trim().toUpperCase() === 'PACK TYPE') return;
      row[1] = '[0]'; row[2] = 'FALSE'; pityCells++;
    });
  }
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  PITY_CONFIG.enabled = false;                       // dry-streak pity lives in code, not the sheet
  // ONE seed cannot decide this. 1-star leads 2-star by only 281:214 in the pool, and a season is
  // ~220 draws, so the sd on each count is ~6 and the two overlap constantly - the old single-seed
  // gate was a coin-flip dressed as an assertion. Aggregate several seeds so the pool ratio is
  // decisive, and report observed-vs-expected so a REAL bias is visible rather than just a verdict.
  const SEEDS = [7, 11, 23, 101, 555, 900];
  const neutral = { rar: {}, bySet: {}, total: 0 };
  SEEDS.forEach(sd => {
    const m = runMix(sd);
    Object.keys(m.rar).forEach(k => { neutral.rar[k] = (neutral.rar[k] || 0) + m.rar[k]; });
    Object.keys(m.bySet).forEach(k => { neutral.bySet[k] = (neutral.bySet[k] || 0) + m.bySet[k]; });
    neutral.total += m.total;
  });
  PITY_CONFIG.enabled = true;
  const poolN = Object.values(cfg.qtyByRarity).reduce((a, b) => a + b, 0);
  console.log('  neutral mix (no skew, no pity), ' + SEEDS.length + ' seeds, ' + neutral.total +
              ' draws  [observed vs pool-proportional]:');
  console.log('    ' + Object.keys(cfg.qtyByRarity).map(r => {
    const exp = neutral.total * cfg.qtyByRarity[r] / poolN;
    return r + ' ' + (neutral.rar[r] || 0) + '/' + exp.toFixed(0);
  }).join('   '));
  check('with skew and both pity mechanisms off, 1★ is the most-drawn rarity (pool decides)',
    skewCells > 0 && pityCells > 0 && neutral.total > 0 &&
    Object.keys(neutral.rar).every(k => k === '1★' || neutral.rar['1★'] >= neutral.rar[k]),
    skewCells + ' skew weights + ' + pityCells + ' pity rows flattened -> ' +
    JSON.stringify(neutral.rar));

  // (b) restore the authored skew: the set it favours most must be drawn harder than when neutral.
  data = JSON.parse(skewSnap);
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  check('skew fixture restored', JSON.stringify(data) === skewSnap);
  const skewRow = (loadPackConfig_().albumSetSkew || [])[0] || [];
  let topSet = 1;
  skewRow.forEach((w, i) => { if (w > (skewRow[topSet - 1] || 0)) topSet = i + 1; });
  const skewed = { rar: {}, bySet: {}, total: 0 };
  SEEDS.forEach(sd => {
    const m = runMix(sd);
    Object.keys(m.rar).forEach(k => { skewed.rar[k] = (skewed.rar[k] || 0) + m.rar[k]; });
    Object.keys(m.bySet).forEach(k => { skewed.bySet[k] = (skewed.bySet[k] || 0) + m.bySet[k]; });
    skewed.total += m.total;
  });
  console.log('  authored-skew mix:', JSON.stringify(skewed.rar), 'of', skewed.total,
              '| by set:', JSON.stringify(skewed.bySet));
  check('the authored ALBUM SET SKEW actually biases the draw toward its favoured set',
    skewRow.length === 0 || (skewed.bySet[topSet] || 0) >= (neutral.bySet[topSet] || 0),
    'album 1 skew [' + skewRow.join(', ') + '] favours set ' + topSet + ': ' +
    (neutral.bySet[topSet] || 0) + ' cards neutral -> ' + (skewed.bySet[topSet] || 0) + ' skewed');

  // The pool is finite and drawn without replacement: no card key may be drawn more times than
  // it has copies within a single album run. Album advance rebuilds it, so check the weaker
  // invariant the sim guarantees — the engine never emits a draw once the pool is exhausted.
  check('no draw exceeds the per-album pool (engine never returned a null-pool card)',
    !logs.some(l => /Pool unexpectedly exhausted/.test(l)));
}

// ---------------------------------------------------------------- 6b. rarity pity semantics
// The PACK PITY CONFIG array is indexed by CONSECUTIVE MISSES of the target rarity (NOT by card
// slot — that was a wrong reading, corrected 2026-08-03). [0, 0.8, 0.8, 1.0] means: no help on a
// pull with no misses behind it; 80% after one miss; 80% after two; GUARANTEED after three.
// Counter resets on any hit and starts at 0 every pack.
//
// Test: give every pack tier a hard [0, 0, 0, 1.0] pity with forceHighest. With 5★ as the top
// stocked rarity, every run of 3 consecutive non-5★ cards inside one pack MUST be followed by a
// 5★. That is a deterministic consequence of the rule, independent of the seed.
{
  data = JSON.parse(RAW);
  authorLadders();
  const pc = data['PackConfig'].values;
  let b = -1;
  for (let r = 0; r < pc.length; r++)
    if (String(pc[r][0]).trim() === 'PACK PITY CONFIG') { b = r; break; }
  let patched = 0;
  for (let r = b + 2; r < pc.length; r++) {
    if (!/^\d+[-\s]*star/i.test(String(pc[r][0]).trim())) break;
    pc[r][1] = '[0, 0, 0, 1.0]';
    pc[r][2] = true;
    patched++;
  }
  check('pity fixture applied to all 6 pack tiers', patched === 6, patched + ' rows');
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  const sh = mkSheet('Col_Cards_Daily');
  sh.getRange('B2').setValue('100+');
  sh.getRange('D2').setValue('PAYER');
  sh.getRange('G2').setValue(2024);
  SimulatePackOpenings();

  const rarityOfCard = (s) => { const m = String(s).match(/(\d★|Gold)$/); return m ? m[1] : null; };
  // PityForceHighestRarity targets "the highest rarity that STILL has copies" — which rarity that
  // is depends on the snap pool, not on a constant: it was 5★ while Gold shipped at Qty 0, and is
  // Gold from workbook (14) on. Derive it, and since the pool depletes mid-run (the target can
  // fall back one step), accept the top two stocked rarities.
  const RARITY_ORDER = ['1★', '2★', '3★', '4★', '5★', 'Gold'];
  const stocked = RARITY_ORDER.filter(r => (cfg.qtyByRarity[r] || 0) > 0);
  const acceptable = new Set(stocked.slice(-2));
  console.log('  pity target rarities (top stocked):', [...acceptable].join('/'));
  let packs = 0, violations = 0, guaranteedHits = 0, streak = 0;
  for (let r = 56; r < data['Col_Cards_Daily'].values.length; r++) {
    const row = data['Col_Cards_Daily'].values[r];
    if (!row || row[0] === '' || row[0] == null) break;
    if (!row[logCol('Cards Drawn')]) continue;
    packs++;
    streak = 0;                                   // counter starts at 0 on every pack
    for (const card of String(row[logCol('Cards Drawn')]).split(', ')) {
      const rar = rarityOfCard(card);
      if (!rar) continue;
      if (streak >= 3) {                          // probs[3] == 1.0 -> this pull MUST be the target
        if (acceptable.has(rar)) guaranteedHits++; else violations++;
      }
      streak = acceptable.has(rar) ? 0 : streak + 1;
    }
  }
  console.log(`  ${packs} packs scanned · ${guaranteedHits} guaranteed pulls honoured`);
  check('pity: after 3 consecutive misses the next pull is the target rarity (p = 1.0)',
    violations === 0 && guaranteedHits > 0, `${violations} violations, ${guaranteedHits} honoured`);

  // and the counter must NOT carry between packs: with [0,0,0,1.0] the FIRST card of a pack can
  // never be forced, so across many packs the first card is sometimes not the target.
  let firstCards = 0, firstIsTarget = 0;
  for (let r = 56; r < data['Col_Cards_Daily'].values.length; r++) {
    const row = data['Col_Cards_Daily'].values[r];
    if (!row || row[0] === '' || row[0] == null) break;
    if (!row[logCol('Cards Drawn')]) continue;
    const rar = rarityOfCard(String(row[logCol('Cards Drawn')]).split(', ')[0]);
    if (rar) { firstCards++; if (rar === '5★') firstIsTarget++; }
  }
  check('pity: counter does not carry between packs (first card is never forced)',
    firstCards > 5 && firstIsTarget < firstCards,
    `${firstIsTarget}/${firstCards} first cards were the target`);
}

// ---------------------------------------------------------------- 7. chest purchasing rules
{
  data = JSON.parse(RAW);
  authorLadders();
  // force a chest-friendly setup: everything cheap, buying starts on day 1
  const pc = data['PackConfig'].values;
  const setPanel = (label, key, val) => {
    let b = -1;
    for (let r = 0; r < pc.length; r++) if (String(pc[r][0]).trim() === label) { b = r; break; }
    for (let r = b + 1; r < pc.length; r++)
      if (String(pc[r][0]).trim() === key) { pc[r][1] = val; return true; }
    return false;
  };
  // Chests must also be AFFORDABLE for the "buying is on" case to mean anything: the shipped
  // Bronze chest costs 250 stars, which a 33-day run does not reach. Price them at 10/20/30 so
  // the gate exercises the purchasing RULES (probability ramp + min-stars floor), not the economy.
  const setChestCosts = (costs) => {
    let b = -1;
    for (let r = 0; r < pc.length; r++)
      if (String(pc[r][0]).trim() === 'STAR CHEST COSTS & REWARDS') { b = r; break; }
    let i = 0;
    for (let r = b + 2; r < pc.length && i < costs.length; r++) {
      if (String(pc[r][0]).trim() === '' ) break;
      if (typeof pc[r][1] === 'number' && pc[r][1] > 0) pc[r][1] = costs[i++];
    }
    return i === costs.length;
  };
  check('chest cost override applied (harness fixture)', setChestCosts([10, 20, 30]));

  const runChests = () => {
    data['Col_Cards_Daily'] = JSON.parse(RAW).Col_Cards_Daily;
    const sh = mkSheet('Col_Cards_Daily');            // re-made: `data.Col_Cards_Daily` was just replaced
    sh.getRange('B2').setValue('100+');
    sh.getRange('D2').setValue('PAYER');
    sh.getRange('G2').setValue(31337);
    SimulatePackOpenings();
    let chestRows = 0;
    for (let r = 56; r < data['Col_Cards_Daily'].values.length; r++) {
      const row = data['Col_Cards_Daily'].values[r];
      if (!row || row[0] === '' || row[0] == null) break;
      if (/Chest Opened/.test(String(row[2]))) chestRows++;
    }
    return { spent: data['Col_Cards_Daily'].values[46][1], chestRows };   // B47 = Stars Spent on Chests
  };

  setPanel('CHEST PURCHASING', 'End-of-Season Buy Probability', 0);
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  const off = runChests();
  check('buy probability 0 -> no chests are ever bought',
    off.chestRows === 0 && off.spent === 0, `rows ${off.chestRows}, spent ${off.spent}`);

  setPanel('CHEST PURCHASING', 'End-of-Season Buy Probability', 0.95);
  setPanel('CHEST PURCHASING', 'Urgency Start Day', 1);
  setPanel('CHEST PURCHASING', 'Min Stars to Consider Buying', 1);
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  const on = runChests();
  check('urgency ramp from day 1 + min stars 1 -> chests are bought',
    on.chestRows > 0 && on.spent > 0, `rows ${on.chestRows}, spent ${on.spent}`);

  setPanel('CHEST PURCHASING', 'Min Stars to Consider Buying', 99999999);
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  const gated = runChests();
  check('min-stars gate blocks purchases even with p = 0.95',
    gated.chestRows === 0 && gated.spent === 0, `rows ${gated.chestRows}, spent ${gated.spent}`);
}

// ---------------------------------------------------------------- 8. input validation
{
  data = JSON.parse(RAW);
  eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  const seg = mkSheet('Col_Cards_Daily');
  const expectThrow = (name, setup, re) => {
    setup();
    let msg = '';
    try { SimulatePackOpenings(); } catch (e) { msg = String(e.message || e); }
    check(name, re.test(msg), msg || '(no error thrown)');
  };
  expectThrow('unknown segment is rejected', () => {
    seg.getRange('B2').setValue('Mid-Core (Free)');
    seg.getRange('D2').setValue('NONPAYER');
  }, /Unknown segment/);
  expectThrow('bad payer flag is rejected', () => {
    seg.getRange('B2').setValue('10-19');
    seg.getRange('D2').setValue('Free');
  }, /NONPAYER or PAYER/);
  expectThrow('empty segment is rejected', () => {
    seg.getRange('B2').setValue('');
    seg.getRange('D2').setValue('NONPAYER');
  }, /is empty/);
}

{
  // No em-dashes (or middle dots / arrows) in anything WRITTEN TO THE SHEET. Comments are exempt;
  // string literals are not, because those become cell values.
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'CardOpenings.gs'), 'utf8');
  const offenders = [];
  src.split(String.fromCharCode(10)).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const re = /'([^']*)'|"([^"]*)"/g;
    let m;
    while ((m = re.exec(line))) {
      const lit = m[1] || m[2] || '';
      if (/[—–·→]/.test(lit)) offenders.push((i + 1) + ': ' + lit.slice(0, 50));
    }
  });
  check('no em-dashes in strings written to the sheet', offenders.length === 0,
    offenders.length ? offenders.join(' | ') : 'sheet-bound literals are plain ASCII punctuation');
}


// ------------------------------------------- 9. SEASON CUTOFF for envelopes (D26, 2026-09-01)
// The collection season ends at SEASON_LAST_DAY while the calendar window stays 33 days. After the
// cutoff no source hands out envelopes (the six *-star Pack resources) -- and NOTHING ELSE STOPS.
// Every gate here asserts a RULE, not a workbook state: each toggles SEASON_CUTOFF and compares, so
// none can rot when the calendar or the authored ladders change.
{
  console.log('\n================ SEASON CUTOFF (D26) ================');
  const CUT_PAIRS = [['20-39', 'PAYER'], ['0-9', 'NONPAYER'], ['100+', 'PAYER']];
  const NONPACK = RESOURCES.filter(r => !isPackRes_(r));

  const sweep = () => {
    Context.reset && Context.reset();
    const ctx = Context.get();
    const out = {};
    CUT_PAIRS.forEach(pair => {
      const seg = pair[0], payer = pair[1], key = seg + '|' + payer;
      const rec = { packByCat: {}, packTot: 0, nonpack: 0, latePack: 0, lateNon: 0, consErr: 0 };
      CATEGORY_ORDER.forEach(cat => {
        const W = resultRow_(cat, seg, payer, ctx);
        const p = PACK_RES.reduce((a, r) => a + num(W[r]), 0);
        if (p > 1e-12) rec.packByCat[cat] = p;
        rec.packTot += p;
        NONPACK.forEach(r => { rec.nonpack += num(W[r]); });
        const ser = dailySeries_(cat, seg, payer, ctx, true);
        PACK_RES.forEach(r => {
          let sum = 0;
          for (let d = 0; d < DAILY_DAYS; d++) {
            sum += num(ser[d][r]);
            if (d + 1 > SEASON_LAST_DAY) rec.latePack += num(ser[d][r]);
          }
          rec.consErr = Math.max(rec.consErr, Math.abs(sum - num(W[r])));
        });
        for (let d = SEASON_LAST_DAY; d < DAILY_DAYS; d++)
          NONPACK.forEach(r => { rec.lateNon += num(ser[d][r]); });
      });
      out[key] = rec;
    });
    return out;
  };

  const on = sweep();
  SEASON_CUTOFF = false; const off = sweep(); SEASON_CUTOFF = true;
  const back = sweep();
  const K = pair => pair[0] + '|' + pair[1];

  // 1. THE rule: no envelope is placed after the season ends.
  check('no envelopes placed after SEASON_LAST_DAY',
    CUT_PAIRS.every(p => on[K(p)].latePack < 1e-9),
    CUT_PAIRS.map(p => K(p) + ' ' + on[K(p)].latePack.toExponential(1)).join(' | '));

  // 2. The counterpart, and the point of the whole correction: ONLY envelopes stop. If this fails,
  //    the change has become a shorter simulation instead of a shorter collection season.
  check('non-pack resources still paid on the days after the cutoff',
    CUT_PAIRS.every(p => on[K(p)].lateNon > 0),
    CUT_PAIRS.map(p => K(p) + ' ' + on[K(p)].lateNon.toFixed(1)).join(' | '));

  // 3. The cutoff must not move a single non-pack number, anywhere.
  let worst = 0;
  CUT_PAIRS.forEach(p => { worst = Math.max(worst, Math.abs(on[K(p)].nonpack - off[K(p)].nonpack)); });
  check('cutoff leaves every non-pack window total bit-identical', worst < 1e-9,
    'max drift ' + worst.toExponential(2) + ' over ' + CUT_PAIRS.length + ' segment/payer pairs');

  // 4. Conservation: the 33-day series still sums to the window row, per resource.
  const cons = Math.max.apply(null, CUT_PAIRS.map(p => on[K(p)].consErr));
  check('daily envelope series still sums to the window row', cons < 1e-9,
    'max |sum(33 days) - row| = ' + cons.toExponential(2));

  // classify the cal_new lanes by how they sit against the cutoff
  const ctxC = Context.get();
  const wholly = [], straddle = [];
  CATEGORY_ORDER.forEach(cat => {
    const lane = DAILY_CAL_LABEL[cat];
    if (!lane || SEASON_EXEMPT_LANES[lane]) return;
    const insts = ctxC.calNew[lane] || [];
    if (!insts.length) return;
    const lo = i => Math.min.apply(null, i.days), hi = i => Math.max.apply(null, i.days);
    if (insts.some(i => lo(i) > SEASON_LAST_DAY)) wholly.push(cat);
    if (insts.some(i => lo(i) <= SEASON_LAST_DAY && hi(i) > SEASON_LAST_DAY)) straddle.push(cat);
  });

  // 5. Instances WHOLLY past the cutoff stop paying, so the source's envelope total must fall.
  const payingWholly = wholly.filter(c => (off['20-39|PAYER'].packByCat[c] || 0) > 1e-12);
  const dropped = payingWholly.filter(c =>
    (on['20-39|PAYER'].packByCat[c] || 0) < off['20-39|PAYER'].packByCat[c] - 1e-9);
  check('every source with an out-of-season instance loses envelopes',
    payingWholly.length > 0 && dropped.length === payingWholly.length,
    payingWholly.length ? dropped.join(', ') + ' (of ' + payingWholly.join(', ') + ')'
                        : 'no out-of-season instance pays packs in this workbook');

  // 6. "Events cut in the middle still give the full reward" -- a straddler's envelope total is
  //    UNCHANGED. Its packs merely land on or before the last day, which gate 1 already covers.
  const strad = straddle.filter(c => (off['20-39|PAYER'].packByCat[c] || 0) > 1e-12);
  check('straddling instances pay their envelopes in full',
    strad.length > 0 && strad.every(c =>
      Math.abs((on['20-39|PAYER'].packByCat[c] || 0) - off['20-39|PAYER'].packByCat[c]) < 1e-9),
    strad.length ? strad.join(', ') : 'no straddling instance pays packs in this workbook');

  // 7. Season Pass is exempt: the track is climbed during the season, so it pays its whole reached
  //    ladder even though the calendar draws a second pass instance past the cutoff.
  check('Season Pass envelopes are exempt from the cutoff',
    ['Season Pass (Free)', 'Season Pass (Paid)'].every(c =>
      Math.abs((on['20-39|PAYER'].packByCat[c] || 0) - (off['20-39|PAYER'].packByCat[c] || 0)) < 1e-9),
    'free ' + (on['20-39|PAYER'].packByCat['Season Pass (Free)'] || 0).toFixed(3) +
    ' / paid ' + (on['20-39|PAYER'].packByCat['Season Pass (Paid)'] || 0).toFixed(3));

  // 8. The card sim's DISCRETE plan must agree with the placement above.
  const plan = packGrantPlan_('20-39', 'PAYER', Context.get());
  const badDay = plan.filter(p => Math.max.apply(null, p.days) > SEASON_LAST_DAY);
  check('packGrantPlan_ never lands a grant past SEASON_LAST_DAY', badDay.length === 0,
    badDay.length ? badDay.map(p => p.cat + ' -> ' + p.days.join(',')).join(' | ')
                  : plan.length + ' instance plans, all on or before day ' + SEASON_LAST_DAY);
  const spLate = spPackTiers_('20-39', 'PAYER', Context.get()).filter(t => t.day > SEASON_LAST_DAY);
  check('Season Pass tiers never grant an envelope past SEASON_LAST_DAY', spLate.length === 0,
    spLate.length ? 'tiers ' + spLate.map(t => t.tier).join(',') : 'all pass tiers settle in-season');

  // 9. The master switch is a real switch, and the sweep is side-effect free.
  let restore = 0;
  CUT_PAIRS.forEach(p => { restore = Math.max(restore, Math.abs(on[K(p)].packTot - back[K(p)].packTot)); });
  check('SEASON_CUTOFF round-trips cleanly (off -> on reproduces the same totals)', restore < 1e-9,
    'max drift ' + restore.toExponential(2));
  check('SEASON_CUTOFF = false restores the full 33-day envelope flow',
    CUT_PAIRS.every(p => off[K(p)].packTot >= on[K(p)].packTot - 1e-9) &&
    CUT_PAIRS.some(p => off[K(p)].packTot > on[K(p)].packTot + 1e-9),
    CUT_PAIRS.map(p => K(p) + ' ' + off[K(p)].packTot.toFixed(2) + ' -> ' +
      on[K(p)].packTot.toFixed(2)).join(' | '));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
