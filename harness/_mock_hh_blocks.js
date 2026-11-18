// D108 gates: Hatchling Hideaway configured PER SEGMENT (one block per segment on HH / HH_v2, each with its own rewards
// and requirements). Every gate asserts a RULE with a fixture built here (snapshot -> mutate -> assert -> restore).
//   node harness/_mock_hh_blocks.js [--data v3z | v3y | <dump.json>]
// v3z = 'LiveOpsCal_NS_HH_segs' (the block layout). On an old single-ladder dump (v3y) the block gates build the
// block layout themselves from the old ladder.
//   H1  the block reader prices exactly what the single ladder priced when every block IS that ladder
//   H2  identical HH / HH_v2 blocks -> E_v2 == E_base in every cell (DIFF = timing only)
//   H3  a REWARD edit in one segment's block moves that segment's E by SUM S(req) x d(reward), and no other segment
//   H4  a REQUIREMENT edit (Tiles) in one block moves that segment's E by the survival at the new cumulative tokens
//   H5  a 'Cum tokens' column, when the block has one, is read instead of Tiles / accuracy
//   H6  a block without its own header row reads the sheet's first header; 250+ reads the 100+ block
//   H7  ALL = the member segments pooled (segMixCat_); the card sim's rungs and the play-by-play ladder read the block
//   H8  COLL_SEG_BLOCKS = false on a sheet without blocks = the old reader, bit for bit
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3z');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
let PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const di = process.argv.indexOf('--engine-dir');
if (di >= 0){
  const ed = path.resolve(process.argv[di + 1]);
  PRELUDE = PRELUDE.replace("const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);", 'const ENGINE = (f) => path.join(' + JSON.stringify(ed) + ', f);');
  if (PRELUDE.indexOf(JSON.stringify(ed)) < 0) throw new Error('_mock_cards.js ENGINE line moved - fix the harness');
}
const _log = console.log; global.__say = _log; console.log = () => {};

function GATES(){
  const say = global.__say;
  let pass = 0, fail = 0;
  const gate = (name, ok, detail) => { ok ? pass++ : fail++; say((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };
  const close = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-9) * Math.max(1, Math.abs(b));
  const fresh = () => { resetSheetCache_mock(); _sheetValsCache = {}; Context.reset(); return Context.get(); };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));
  const CAT = 'Hatchling Hideaway', coll = COLL_R_SPECS[CAT];
  const SH = ['HH', 'HH_v2'];
  const snapAll = () => { const o = {}; SH.forEach(n => { o[n] = data[n] ? JSON.stringify(data[n]) : null; }); return o; };
  const restore = (o) => { SH.forEach(n => { if (o[n] == null) delete data[n]; else data[n] = JSON.parse(o[n]); }); fresh(); };
  const SEGLABS = ['0-9', '10-19', '20-39', '40-99', '100+'];
  const RESC = ['HC', 'Red', 'Unlimited Lives', 'COOP Token', '2-star Pack'];
  const sameE = (a, b) => RESOURCES.every(r => close(num(a[r]), num(b[r]), 1e-9));

  // ---- fixtures -------------------------------------------------------------------------------------------------
  // the OLD single-ladder layout: 'Gate number' header at row 11 (0-based 10), gates rows 12-16, the AU:AW helper on
  // HH_v2 (rows 4..9: Gate | Tiles | Cum tokens req, accuracy at AV2)
  const ACC = 0.8, TILES = [16, 25, 36, 49, 64];
  const REW = [[0, 0, 0, 1, 0, 0, 0, 0, 0, 60, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0], [10, 0, 0, 0, 1, 0, 0, 0, 0, 30, 0, 0, 0, 10, 0, 0, 1, 0, 0, 0, 0, 0],
               [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 10, 0, 0, 20, 0, 0, 1, 0, 0, 0, 0, 1], [15, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 10, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0],
               [30, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10, 70, 0, 0, 0, 1, 0, 0, 0, 1]];
  const HDR = ['Gate number', 'Coins', 'SPT', 'SPT x2', 'Red', 'Chuck', 'Bomb', 'Slingshot', 'Shuffle', 'Comet', 'Unlimited Lives', 'Unlimited Red',
               'Unlimited Chuck', 'Unlimited Bomb', 'COOP Token', 'Avatar', '1-star Dly', '2-star Dly', '3-star Dly', '4-star Dly', '5-star Dly',
               '6-star Dly', 'ToF_Ticket', '', 'Tiles'];
  const W = 50;
  const blankRow = () => Array(W).fill('');
  const panel = (rows) => { rows[0][0] = 'Hatchling Hideaway'; rows[1][0] = 'Config Panel'; rows[2][0] = 'EventDuration'; rows[2][1] = 4; };
  const oldLayout = (v2) => {
    const rows = []; for (let i = 0; i < 17; i++) rows.push(blankRow());
    panel(rows); rows[9][0] = 'Goals and Rewards';
    rows[10] = HDR.concat(Array(W - HDR.length).fill(''));
    TILES.forEach((t, i) => { const r = blankRow(); r[0] = 'Gate ' + (i + 1); REW[i].forEach((x, j) => { r[1 + j] = x; }); r[24] = t; rows[11 + i] = r; });
    if (v2){
      rows[1][46] = 'accuracy'; rows[1][47] = ACC; rows[3][46] = 'Gate'; rows[3][47] = 'Tiles'; rows[3][48] = 'Cum tokens req';
      let cum = 0; TILES.forEach((t, i) => { cum += t; rows[4 + i][46] = i + 1; rows[4 + i][47] = t; rows[4 + i][48] = cum / ACC; });
    }
    return { values: rows, merges: [] };
  };
  // the BLOCK layout of the 2026-11-18 workbook: label row, (header row only on the first block), gates; accuracy at AV2
  // on HH_v2 only. opts.edit(seg, rows) mutates one block's gate rows; opts.allHeaders writes a header on every block;
  // opts.cumCol adds a 'Cum tokens req' column (Z) holding cum tiles / accuracy
  const blockLayout = (v2, opts) => {
    opts = opts || {};
    const rows = []; for (let i = 0; i < 10; i++) rows.push(blankRow());
    panel(rows); rows[9][0] = 'Goals and Rewards';
    if (v2) { rows[1][46] = 'accuracy'; rows[1][47] = ACC; }
    const hdr = HDR.concat(opts.cumCol ? ['Cum tokens req'] : []);
    SEGLABS.forEach((lab, b) => {
      const l = blankRow(); l[0] = lab; rows.push(l);
      const h = blankRow(); if (b === 0 || opts.allHeaders) hdr.forEach((x, j) => { h[j] = x; }); rows.push(h);
      const g = TILES.map((t, i) => { const r = blankRow(); r[0] = 'Gate ' + (i + 1); REW[i].forEach((x, j) => { r[1 + j] = x; }); r[24] = t; return r; });
      if (opts.edit) opts.edit(lab, g);
      let cum = 0; if (opts.cumCol) g.forEach(r => { cum += num(r[24]); r[25] = cum / ACC; });
      g.forEach(r => rows.push(r));
      rows.push(blankRow());
    });
    return { values: rows, merges: [] };
  };
  const cells = []; segMembers_(fresh().ds).forEach(s => ['NONPAYER', 'PAYER'].forEach(p => cells.push([s, p])));
  const Eof = (s, p) => { const c = fresh(); return rewardE_(CAT, s, p, c.ds); };
  const Sof = (s, p) => { const c = fresh(), i = c.ds.eventInst(coll.inst, s, p);
    return i ? survival_([[num(i.final_balance_p25), .25], [num(i.final_balance_p50), .5], [num(i.final_balance_p75), .75]]) : null; };
  const SNAP0 = snapAll();
  say('data: ' + (data._meta ? data._meta.source : '?') + '   engine ' + ENGINE_BUILD);

  {
    // H1: blocks that are all the old ladder price exactly what the old single ladder priced
    data['HH'] = oldLayout(false); data['HH_v2'] = oldLayout(true);
    const E0 = cells.map(([s, p]) => Eof(s, p));
    data['HH'] = blockLayout(false); data['HH_v2'] = blockLayout(true);
    const E1 = cells.map(([s, p]) => Eof(s, p));
    restore(SNAP0);
    let bad = 0, n = 0;
    cells.forEach((c, i) => { if (!E0[i] && !E1[i]) return; n++; if (!E0[i] || !E1[i] || !sameE(E0[i].eBase, E1[i].eBase) || !sameE(E0[i].eV2, E1[i].eV2)) bad++; });
    gate('H1: five blocks that are each the old ladder price exactly what the old single ladder priced (both sides, every resource)',
      n > 0 && bad === 0, n + ' cells, ' + bad + ' differ; 40-99 NONPAYER coins ' + num((E1[cells.findIndex(c => c[0] === '40-99')] || {eV2: {}}).eV2.HC).toFixed(3));
  }
  {
    // H2: identical blocks on both sheets -> E_v2 == E_base everywhere
    data['HH'] = blockLayout(false); data['HH_v2'] = blockLayout(true);
    let bad = 0, n = 0;
    cells.forEach(([s, p]) => { const E = Eof(s, p); if (!E) return; n++; if (!sameE(E.eBase, E.eV2)) bad++; });
    restore(SNAP0);
    gate('H2: identical blocks on HH and HH_v2 give E_v2 == E_base in every cell (the Hatchling DIFF is timing only)', n > 0 && bad === 0, n + ' cells, ' + bad + ' off');
  }
  {
    // H3: a reward edit in ONE block: that segment moves by SUM S(req) x d(reward), no other segment moves
    const SEG = '20-39';
    data['HH'] = blockLayout(false); data['HH_v2'] = blockLayout(true);
    const E0 = cells.map(([s, p]) => Eof(s, p));
    data['HH_v2'] = blockLayout(true, { edit: (lab, g) => { if (lab === SEG){ g[1][1] = 40; g[3][4] = 3; } } });   // Gate 2 coins 10 -> 40, Gate 4 Red 0 -> 3
    const E1 = cells.map(([s, p]) => Eof(s, p));
    let others = 0, worst = 0, n = 0;
    cells.forEach(([s, p], i) => {
      if (!E0[i]) return;
      if (s !== SEG){ if (!sameE(E0[i].eV2, E1[i].eV2)) others++; return; }
      const S = Sof(s, p); let cum = 0; const reqs = TILES.map(t => (cum += t) / ACC);
      const wantHC = num(E0[i].eV2.HC) + S(reqs[1]) * 30, wantCO = num(E0[i].eV2.Red) + S(reqs[3]) * 3;
      worst = Math.max(worst, Math.abs(num(E1[i].eV2.HC) - wantHC), Math.abs(num(E1[i].eV2.Red) - wantCO)); n++;
    });
    restore(SNAP0);
    gate('H3: a reward edit in the 20-39 block moves 20-39 by SUM S(req) x d(reward) (by hand), and no other segment', n === 2 && worst < 1e-9 && others === 0,
      n + ' cells, worst ' + worst.toExponential(2) + ', other cells moved: ' + others);
  }
  {
    // H4: a requirement edit (Tiles) in one block: the survival at the NEW cumulative tokens
    const SEG = '40-99';
    data['HH'] = blockLayout(false);
    data['HH_v2'] = blockLayout(true, { edit: (lab, g) => { if (lab === SEG) g.forEach(r => { r[24] = num(r[24]) * 0.5; }); } });   // half the tiles
    let worst = 0, n = 0, det = '';
    cells.filter(c => c[0] === SEG).forEach(([s, p]) => {
      const E = Eof(s, p), S = Sof(s, p); if (!E || !S) return;
      let cum = 0, want = 0; TILES.forEach((t, i) => { cum += t * 0.5; want += S(cum / ACC) * REW[i][0]; });
      worst = Math.max(worst, Math.abs(num(E.eV2.HC) - want)); n++;
      det = 'coins ' + num(E.eBase.HC).toFixed(2) + ' -> ' + num(E.eV2.HC).toFixed(2);
    });
    restore(SNAP0);
    gate('H4: halving the 40-99 Tiles prices its gates on the survival at the new cumulative tokens (by hand)', n === 2 && worst < 1e-9, det);
  }
  {
    // H5: a 'Cum tokens req' column is read when the block has one (here set to tiles / accuracy x 1.5 by hand)
    data['HH'] = blockLayout(false);
    data['HH_v2'] = blockLayout(true, { cumCol: true, edit: () => {} });
    data['HH_v2'].values.forEach(r => { if (/^Gate \d+$/.test(String(r[0]))) r[25] = num(r[25]) * 1.5; });
    const c = fresh(), L = collBlockLadder_('HH_v2', coll, '10-19', 'HH');
    let cum = 0; const want = TILES.map(t => (cum += t) / ACC * 1.5);
    restore(SNAP0);
    gate('H5: a block\'s \'Cum tokens req\' column is read as the requirement (not Tiles / accuracy)', L && L.src === 'cum' && L.reqs.every((q, i) => close(q, want[i], 1e-12)),
      L ? L.reqs.map(x => x.toFixed(1)).join(' ') : 'no ladder');
  }
  {
    // H5b: a 'Cum tokens req' column with no number in it (formulas that errored / not cached) falls back to Tiles / accuracy
    data['HH'] = blockLayout(false);
    data['HH_v2'] = blockLayout(true, { cumCol: true });
    data['HH_v2'].values.forEach(r => { if (/^Gate \d+$/.test(String(r[0]))) r[25] = '#REF!'; });
    const c = fresh(), L = collBlockLadder_('HH_v2', coll, '10-19', 'HH');
    let cum = 0; const want = TILES.map(t => (cum += t) / ACC);
    restore(SNAP0);
    gate('H5b: a Cum tokens column with no number in it falls back to Tiles / accuracy (no silent carry)', L && L.src === 'tiles' && L.reqs.every((q, i) => close(q, want[i], 1e-12)),
      L ? L.src + ' ' + L.reqs.map(x => x.toFixed(1)).join(' ') : 'no ladder');
  }
  {
    // H6: a block without its own header reads the first one (same ladder as with every header written); 250+ reads 100+
    data['HH'] = blockLayout(false); data['HH_v2'] = blockLayout(true);
    fresh();
    const a = SEGLABS.map(l => JSON.stringify(collBlockLadder_('HH_v2', coll, segCanon_(l), 'HH')));
    data['HH_v2'] = blockLayout(true, { allHeaders: true });
    fresh();
    const b = SEGLABS.map(l => JSON.stringify(collBlockLadder_('HH_v2', coll, segCanon_(l), 'HH')));
    data['HH_v2'] = blockLayout(true, { edit: (lab, g) => { if (lab === '100+') g[0][1] = 777; } });
    fresh();
    const l250 = collBlockLadder_('HH_v2', coll, '250+', 'HH');
    restore(SNAP0);
    const strip = (x) => { const o = JSON.parse(x); delete o.hdrRow; delete o.own; return JSON.stringify(o); };
    gate('H6: blocks without a header row read the first header (same ladders as with every header written); 250+ reads the 100+ block',
      a.every((x, i) => x !== 'null' && strip(x) === strip(b[i])) && l250 && num(l250.rews[0].HC) === 777, '250+ Gate 1 coins ' + (l250 ? l250.rews[0].HC : '-'));
  }
  {
    // H7: ALL pools the members; the card sim's rungs and the play-by-play ladder read the segment's block
    data['HH'] = blockLayout(false);
    data['HH_v2'] = blockLayout(true, { edit: (lab, g) => { if (lab === '40-99') g.forEach(r => { r[17] = 2; }); } });   // 2-star on every 40-99 gate (HDR[17])
    const c = fresh();
    const mixed = segMixCat_(CAT), allRow = resultRow_(CAT, 'ALL', 'NONPAYER', c), mixRow = mixRow_(CAT, 'NONPAYER', c);
    let rungOk = false, pbpOk = false, det = '';
    try {
      const pr = packRungs_(CAT, '40-99', 'NONPAYER', c, 0), S = pacedSurv_(Sof('40-99', 'NONPAYER'), collPace_(CAT, '40-99', 'NONPAYER', c));
      let cum = 0; const reqs = TILES.map(t => (cum += t) / ACC);
      const rg = pr.groups[0].rungs, live = reqs.filter(q => S(q) > 0);   // a gate no player reaches (S = 0) has no rung
      rungOk = rg.length === live.length && live.length >= 3 && rg.every((x, i) => close(x.p, S(live[i]), 1e-12) && num(x.packs['2-star Pack']) === 2 && /^Gate /.test(x.label));
      det = rg.map(x => x.p.toFixed(3)).join(' ');
    } catch (e) { det = 'rungs threw ' + e.message; }
    try {
      const L = pbpMsLadder_(PBP_EVENTS['Hatchling Hideaway'], '40-99');
      pbpOk = L.length === 5 && L.every(x => num(x.rew['2-star Pack']) === 2);
    } catch (e) { det += ' / pbp threw ' + e.message; }
    restore(SNAP0);
    gate('H7a: ALL\'s Hatchling row is the member segments pooled once the sheets carry blocks', mixed && sameE(allRow, mixRow));
    gate('H7b: the card sim\'s rungs and the play-by-play ladder read the segment\'s own block (40-99 pays 2-star on every gate)', rungOk && pbpOk, det);
  }
  {
    // H8: COLL_SEG_BLOCKS = false on the old layout = the old reader, bit for bit (and the blocks are ignored)
    data['HH'] = oldLayout(false); data['HH_v2'] = oldLayout(true);
    const E0 = cells.map(([s, p]) => Eof(s, p));
    COLL_SEG_BLOCKS = false;
    const E1 = cells.map(([s, p]) => Eof(s, p));
    const mix = segMixCat_(CAT);
    COLL_SEG_BLOCKS = true;
    restore(SNAP0);
    let bad = 0; cells.forEach((c, i) => { if (JSON.stringify(E0[i]) !== JSON.stringify(E1[i])) bad++; });
    gate('H8: on the old single-ladder layout the flag changes nothing (bit for bit) and ALL keeps its own row', bad === 0 && !mix, bad + ' cells differ');
  }
  {
    // the dump as it is: what each segment's block prices (information)
    const c = fresh();
    if (collHasBlocks_('HH_v2')){
      say('\n   the dump\'s HH_v2 blocks (cum tokens: coins per gate):');
      SEGLABS.forEach(l => { const L = collBlockLadder_('HH_v2', coll, segCanon_(l), 'HH');
        say('     ' + l.padEnd(6) + (L ? L.reqs.map((q, i) => q.toFixed(1) + ':' + num(L.rews[i].HC)).join('  ') + '  (' + L.src + ')' : 'no block')); });
    }
  }
  say('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
