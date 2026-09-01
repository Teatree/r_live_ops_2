// Offline harness for the STOCHASTIC card run (SimulateCardCloud, engine/CardOpenings.gs, D24).
// Runs the sweep end-to-end over a mockdata dump and checks the seam that matters most: the
// single-player and multi-player paths must go through ONE copy of the season rules. The rest are
// distribution properties that a single seed structurally cannot test.
//
// Needs Col_Cards_Cloud / Col_Cards_Totals in the dump — _dump_mockdata.py overlays the freshly
// built display/Col_Cards_{Cloud,Totals}_v1.xlsx (PENDING_IMPORT), so this runs against the layout
// the engine writes even before the sheets are imported into the workbook.
//
//   node harness/_mock_cloud.js               (defaults to the collections dump)
//   node harness/_mock_cloud.js --data main
const fs = require('fs');
const path = require('path');

// The SpreadsheetApp mock and engine loader are REUSED from _mock_cards.js rather than copied here.
// Two mocks that drift apart is the same failure this project keeps paying for. GATES below is
// never called at module scope (where `data` and `mkSheet` do not exist); it is stringified and
// eval'd together with that prelude, so it runs in the prelude's scope.
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
if (CARDS.indexOf(CUT) < 0) throw new Error('_mock_cards.js prelude marker moved - fix CUT.');
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function GATES() {
  const N = 24;                       // players per permutation for the gates (kept small: fast)
  const SEED = 20260901;
  const perms = cloudPermutations_();

  const cloudSheet  = () => data['Col_Cards_Cloud'].values;
  const totalsSheet = () => data['Col_Cards_Totals'].values;
  const barRow = (vals, label) => {   // 1-based, same resolution rule the engine uses
    for (let i = 0; i < vals.length; i++)
      if (String((vals[i] || [])[0]).trim() === label) return i + 1;
    return -1;
  };
  const setInputs = (n, seed) => {
    const t = data['Col_Cards_Totals'];
    while (t.values.length < 2) t.values.push([]);
    while (t.values[1].length < 4) t.values[1].push('');
    t.values[1][1] = n;
    t.values[1][3] = seed;
  };
  const reset = () => {
    data = JSON.parse(RAW);
    eval(v4Src); eval(dailySrc); eval(cardSrc); _sheetValsCache = {};
  };

  // ---------------------------------------------------------------- 0. shape
  console.log('data: ' + (data._meta ? data._meta.source : '(no _meta)'));
  console.log('');
  check('10 permutations, five real segments x two payer flags',
    perms.length === 10 && !perms.some(p => p.seg === 'A. 0'),
    perms.map(p => p.label).join(', '));
  check('A. 0 is excluded by construction (no data_seg_beh row to price its reach)',
    CLOUD_SEGMENTS.indexOf('A. 0') < 0);

  // ---------------------------------------------------------------- 1. shared-core equivalence
  // THE gate. If these two ever disagree, the single-player log and the cloud are describing
  // different games, and every "the sim ignores my edit" bug this project has had was exactly that
  // kind of divergence.
  {
    reset();
    const cfg = loadPackConfig_();
    const cat = loadCardCatalog_(cfg, mkSheet(SHEET_ALBUM));
    const pre = cardSeasonPre_('20-39', 'PAYER', Context.get());
    const direct = runOneCardSeason_('20-39', 'PAYER', 777, cfg, cat, pre);

    const sh = mkSheet('Col_Cards_Daily');
    sh.getRange('B2').setValue('20-39');
    sh.getRange('D2').setValue('PAYER');
    sh.getRange('G2').setValue(777);
    SimulatePackOpenings();
    const written = data['Col_Cards_Daily'].values;
    const tally = r => written[41 + r][1];       // TALLY_FIRST_ROW = 42 (1-based) -> index 41
    check('the two entry points share one season core (same seed -> same tally)',
      tally(0) === direct.packsOpenedTotal && tally(1) === direct.totalCardsDrawn &&
      tally(2) === direct.totalNew && tally(3) === direct.totalDupes &&
      tally(6) === direct.balance && tally(7) === direct.setsCompletedTotal,
      `sheet ${tally(0)}/${tally(1)}/${tally(2)} packs/cards/new  vs  core ` +
      `${direct.packsOpenedTotal}/${direct.totalCardsDrawn}/${direct.totalNew}`);

    check('every opened pack is attributed to exactly one source',
      Object.keys(direct.bySource).reduce((s, k) => s + direct.bySource[k].packs, 0) ===
      direct.packsOpenedTotal,
      Object.keys(direct.bySource).reduce((s, k) => s + direct.bySource[k].packs, 0) +
      ' attributed vs ' + direct.packsOpenedTotal + ' opened');
    check('per-source card counts sum to the cards actually drawn',
      Object.keys(direct.bySource).reduce((s, k) => s + direct.bySource[k].cards, 0) ===
      direct.totalCardsDrawn);

    // dailyCloud must be cumulative and must NOT reset on album advance
    const dc = direct.dailyCloud;
    let drops = 0;
    for (let d = 1; d < DAILY_DAYS; d++)
      ['packs', 'cards', 'unique', 'sets', 'albumPct'].forEach(k => {
        if (dc[d][k] < dc[d - 1][k] - 1e-9) drops++;
      });
    check('the cumulative day series never falls (album advance does not reset it)',
      drops === 0 && dc.length === DAILY_DAYS, drops + ' backward steps over 33 days');
    check('albumPct is albums-done x 100 plus progress through the current album',
      Math.abs(dc[DAILY_DAYS - 1].albumPct -
               (direct.albumIdx + direct.collectionSize / cat.totalUnique) * 100) < 1e-6,
      'day 33 = ' + dc[DAILY_DAYS - 1].albumPct.toFixed(2) + '%');
  }

  // ---------------------------------------------------------------- 2. the sweep
  reset();
  setInputs(N, SEED);
  const t0 = Date.now();
  const nRun = SimulateCardCloud();
  const secs = (Date.now() - t0) / 1000;
  check('the sweep runs every permutation', nRun === perms.length, nRun + ' of ' + perms.length);
  console.log(`  ${N} players x ${nRun} permutations in ${secs.toFixed(1)}s (node; Apps Script is slower)`);

  const C = cloudSheet(), T = totalsSheet();
  const rMeans = barRow(C, CLOUD_BAR_MEANS);
  const rBands = barRow(C, CLOUD_BAR_BANDS);
  check('both cloud bars are found by label', rMeans > 0 && rBands > 0,
    `MEANS at row ${rMeans}, BANDS at row ${rBands}`);

  // builder geometry vs engine stride: block j's label must land on its own row
  {
    let placed = 0;
    for (let j = 0; j < perms.length; j++) {
      const r0 = rBands + 2 + j * CLOUD_BAND_STRIDE;
      if (String((C[r0 - 1] || [])[0]).trim() === perms[j].label) placed++;
    }
    check('every band block sits where CLOUD_BAND_STRIDE says (builder and engine agree)',
      placed === perms.length, placed + ' of ' + perms.length + ' blocks at the expected row');
  }

  // ---------------------------------------------------------------- 3. percentile ordering
  {
    let bad = 0, checked = 0, worst = '';
    for (let j = 0; j < perms.length; j++) {
      const r0 = rBands + 2 + j * CLOUD_BAND_STRIDE;
      for (let d = 1; d <= DAILY_DAYS; d++) {
        const row = C[r0 + 1 + d];                       // day d, 0-indexed
        for (let m = 0; m < CLOUD_METRICS.length; m++) {
          const v = [];
          for (let s = 0; s < 5; s++) v.push(Number(row[1 + m * 6 + s]));   // p10..p90
          checked++;
          for (let i = 1; i < 5; i++)
            if (v[i] < v[i - 1] - 1e-9) {
              bad++;
              if (!worst) worst = `${perms[j].label} d${d} ${CLOUD_METRICS[m].label}: ${v.join(' ')}`;
            }
        }
      }
    }
    check('p10 <= p25 <= p50 <= p75 <= p90 on every series, day and permutation',
      bad === 0, bad + ' violations over ' + checked + ' cells' + (worst ? '  first: ' + worst : ''));
  }

  // ---------------------------------------------------------------- 4. cumulative on the sheet
  {
    let bad = 0;
    for (let j = 0; j < perms.length; j++) {
      const r0 = rBands + 2 + j * CLOUD_BAND_STRIDE;
      for (let m = 0; m < CLOUD_METRICS.length; m++) {
        if (CLOUD_METRICS[m].key === 'balance') continue;   // a level, spent down by chests
        for (let d = 2; d <= DAILY_DAYS; d++) {
          const prev = Number(C[r0 + d][1 + m * 6 + 5]);    // MEAN, day d-1
          const cur  = Number(C[r0 + 1 + d][1 + m * 6 + 5]);
          if (cur < prev - 1e-9) bad++;
        }
      }
    }
    check('written MEAN series are non-decreasing (Star Balance exempt)', bad === 0,
      bad + ' backward steps');
  }

  // ---------------------------------------------------------------- 5. means block agrees
  {
    let bad = 0;
    for (let j = 0; j < perms.length; j++) {
      const r0 = rBands + 2 + j * CLOUD_BAND_STRIDE;
      for (let m = 0; m < CLOUD_METRICS.length; m++)
        for (let d = 1; d <= DAILY_DAYS; d++) {
          const fromBand  = Number(C[r0 + 1 + d][1 + m * 6 + 5]);
          const fromMeans = Number(C[rMeans + 1 + d][1 + m * perms.length + j]);
          if (Math.abs(fromBand - fromMeans) > 1e-9) bad++;
        }
    }
    check('the MEANS block matches the MEAN column of each band block', bad === 0,
      bad + ' mismatched cells');
  }

  // ---------------------------------------------------------------- 6. unbiased vs the model
  // The granted pack count is a sum of Bernoulli draws around the modelled expectation, so the mean
  // over N players must sit inside Monte-Carlo error of it. This is the gate that would catch a
  // rounding bias creeping back into the trailing-fraction grant.
  {
    reset();
    const cfg = loadPackConfig_();
    const cat = loadCardCatalog_(cfg, mkSheet(SHEET_ALBUM));
    const pre = cardSeasonPre_('20-39', 'PAYER', Context.get());
    const M = 200, tot = [];
    for (let k = 0; k < M; k++)
      tot.push(runOneCardSeason_('20-39', 'PAYER', playerSeed_(SEED, 4, k), cfg, cat, pre)
                 .packsOpenedTotal);
    const mean = tot.reduce((a, b) => a + b, 0) / M;
    const sd = Math.sqrt(tot.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (M - 1));
    const exp = runOneCardSeason_('20-39', 'PAYER', 1, cfg, cat, pre).expectedTotal;
    const tol = 3 * sd / Math.sqrt(M);
    check('mean packs granted matches the modelled expectation within Monte-Carlo error',
      Math.abs(mean - exp) <= tol,
      `${mean.toFixed(2)} observed vs ${exp.toFixed(2)} expected (sd ${sd.toFixed(2)}, ` +
      `tolerance +/-${tol.toFixed(2)} over ${M} players)`);
  }

  // ---------------------------------------------------------------- 7. seeding
  {
    const seeds = {};
    let dupes = 0;
    for (let p = 0; p < 10; p++)
      for (let k = 0; k < 200; k++) {
        const s = playerSeed_(SEED, p, k);
        if (seeds[s]) dupes++;
        seeds[s] = true;
      }
    check('playerSeed_ gives 2000 distinct streams across permutations and players',
      dupes === 0, dupes + ' collisions');
    check('playerSeed_ is reproducible from (seed, permutation, player)',
      playerSeed_(SEED, 3, 7) === playerSeed_(SEED, 3, 7) &&
      playerSeed_(SEED, 3, 7) !== playerSeed_(SEED, 3, 8) &&
      playerSeed_(SEED, 3, 7) !== playerSeed_(SEED, 4, 7));
  }

  // ---------------------------------------------------------------- 8. determinism
  {
    reset(); setInputs(8, 4242); SimulateCardCloud();
    const a = JSON.stringify(data['Col_Cards_Cloud'].values);
    reset(); setInputs(8, 4242); SimulateCardCloud();
    const b = JSON.stringify(data['Col_Cards_Cloud'].values);
    reset(); setInputs(8, 99); SimulateCardCloud();
    const c = JSON.stringify(data['Col_Cards_Cloud'].values);
    check('same seed -> identical sheet', a === b);
    check('a different seed changes the result', a !== c);
  }

  // ---------------------------------------------------------------- 9. the minutes input
  // The engine READS column B of the UL block and must never overwrite it. A blank must stay blank
  // and read '-', never a number nobody chose.
  {
    reset(); setInputs(6, 4242);
    const rUL = barRow(totalsSheet(), TB.ulMinutes);
    check('the UNLIMITED BOOSTERS block is found by label', rUL > 0, 'row ' + rUL);
    SimulateCardCloud();
    let T2 = totalsSheet();
    const blankRow = T2[rUL + 1];
    check('a blank minutes-per-unit input stays blank and reports "-"',
      (blankRow[1] === '' || blankRow[1] == null) && blankRow[2] === '-',
      `input ${JSON.stringify(blankRow[1])}, first column ${JSON.stringify(blankRow[2])}`);

    // now fill it in and re-run: the input survives and the conversion happens
    data['Col_Cards_Totals'].values[rUL + 1][1] = 30;
    SimulateCardCloud();
    T2 = totalsSheet();
    const rowUL = T2[rUL + 1];
    const raw = Number((T2[barRow(T2, TB.ecoTotal) + 1 + REWARD_COLUMNS
      .map(rc => rc.name).indexOf(UL_ROWS[0])] || [])[1]);
    check('a filled minutes-per-unit input survives the run and converts',
      rowUL[1] === 30 && Math.abs(Number(rowUL[2]) - raw * 30) < 0.05,
      `input kept at ${rowUL[1]}, ${raw} units x 30 = ${rowUL[2]}`);
  }

  // ---------------------------------------------------------------- 10. per-source table
  {
    reset(); setInputs(N, SEED); SimulateCardCloud();
    const T3 = totalsSheet();
    const rSrc = barRow(T3, TB.packsSrc);
    check('the per-source block is found by label', rSrc > 0, 'row ' + rSrc);
    const labels = [];
    for (let i = 0; i < CLOUD_SRC_ROWS; i++) {
      const lab = String((T3[rSrc + 1 + i] || [])[0] || '').trim();
      if (lab) labels.push(lab);
    }
    check('per-source rows are real engine categories or a star chest',
      labels.length > 0 && labels.every(l =>
        CATEGORY_ORDER.indexOf(l) >= 0 || l.indexOf('Star Chest (') === 0),
      labels.length + ' sources: ' + labels.join(', '));
    // a zero row is a FINDING (an unauthored ladder, Kite at 0.35 opt-in) - it must be shown, not
    // dropped, or a source going quiet becomes invisible
    let zeroRows = 0;
    for (let i = 0; i < labels.length; i++) {
      const row = T3[rSrc + 1 + i];
      let all0 = true;
      for (let j = 1; j <= perms.length; j++) if (Number(row[j]) > 0) all0 = false;
      if (all0) zeroRows++;
    }
    console.log('  ' + zeroRows + ' of ' + labels.length +
                ' sources paid no pack in any permutation (shown deliberately)');
    check('every listed source has a value in all 10 permutation columns',
      labels.every((_, i) => {
        const row = T3[rSrc + 1 + i];
        for (let j = 1; j <= perms.length; j++)
          if (row[j] === '' || row[j] == null) return false;
        return true;
      }));
  }

  // ---------------------------------------------------------------- 11. namespace hygiene
  {
    const files = fs.readdirSync(path.join(__dirname, '..', 'engine'))
      .filter(f => f.endsWith('.gs'));
    const decl = {};
    const dupes = [];
    files.forEach(f => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'engine', f), 'utf8');
      const names = new Set();
      (src.match(/^(?:function\s+(\w+)|var\s+(\w+)\s*=)/gm) || []).forEach(m => {
        const n = m.replace(/^function\s+/, '').replace(/^var\s+/, '').replace(/\s*=$/, '').trim();
        names.add(n);
      });
      names.forEach(n => {
        if (decl[n] && decl[n] !== f) dupes.push(`${n} (${decl[n]} + ${f})`);
        decl[n] = f;
      });
    });
    check('the cloud run adds no globals that collide across engine files',
      dupes.length === 0, dupes.join(', ') || 'none');
    const v4 = fs.readFileSync(path.join(__dirname, '..', 'engine', 'EcoGainsSim_v4.gs'), 'utf8');
    check('the EcoGainsSim menu offers the cloud run',
      v4.indexOf("'SimulateCardCloud'") >= 0);
  }

  console.log('');
  console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
}

eval(PRELUDE + '(' + GATES.toString() + ')();');
