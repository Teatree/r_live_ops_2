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
    // SimulateCardCloud stops early when its projection (elapsed + elapsed/permutations_done)
    // crosses CLOUD_TIME_BUDGET_MS -- correct in Apps Script, where the alternative is dying
    // mid-write at the 6-minute kill. But it makes the RESULT depend on wall-clock, so this gate
    // could fail for a reason that has nothing to do with determinism: one run stops after N
    // permutations and the next after N+1, purely because the machine was busier. Observed once
    // under batch load on 2026-09-02, then 5 clean runs after and 3 clean runs before the change
    // being tested -- i.e. flaky, not a real regression, which is the worst kind of gate.
    // Pin the budget for the comparison so this asserts the SIM and nothing else, and assert
    // separately that no run was truncated (a truncated pair could agree vacuously).
    const budgetWas = CLOUD_TIME_BUDGET_MS;
    CLOUD_TIME_BUDGET_MS = Number.MAX_SAFE_INTEGER;
    logs.length = 0;
    reset(); CLOUD_TIME_BUDGET_MS = Number.MAX_SAFE_INTEGER; setInputs(8, 4242); SimulateCardCloud();
    const a = JSON.stringify(data['Col_Cards_Cloud'].values);
    reset(); CLOUD_TIME_BUDGET_MS = Number.MAX_SAFE_INTEGER; setInputs(8, 4242); SimulateCardCloud();
    const b = JSON.stringify(data['Col_Cards_Cloud'].values);
    const truncated = logs.some(l => String(l).indexOf('TIME BUDGET') >= 0);
    reset(); CLOUD_TIME_BUDGET_MS = Number.MAX_SAFE_INTEGER; setInputs(8, 99); SimulateCardCloud();
    const c = JSON.stringify(data['Col_Cards_Cloud'].values);
    CLOUD_TIME_BUDGET_MS = budgetWas;
    check('determinism comparison ran both permutation sweeps in full', !truncated,
      truncated ? 'a run hit the time budget — the comparison would be vacuous' : 'no truncation');
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

  // --------------------------------------------- 9b. the cadence block reconciles (2026-09-07)
  // 'Packs per day (mean)' is per CALENDAR day, all 33. Col_Cards_Daily's log shows the same season
  // spread over only the 4-6 days that dropped a pack, so it reads 2-3 packs a day against 0.35
  // here and the two sheets looked like they disagreed by 10x. They never did: at 10-19 NONPAYER
  // both say ~11.6 packs a season. These gates pin the arithmetic that makes that checkable on the
  // sheet, and the geometry that lets the block grow without silently overwriting the next one.
  {
    reset(); setInputs(N, SEED); SimulateCardCloud();
    const T4 = totalsSheet();
    // resolve the bar the way the ENGINE does - current label first, then the labels it used to
    // carry - so this gate keeps working on an older import instead of asserting the newest one
    const barRowA = (v, label) => {
      let r = barRow(v, label);
      (TB_ALIASES[label] || []).forEach(alt => { if (r < 0) r = barRow(v, alt); });
      return r;
    };
    const rCad = barRowA(T4, TB.cadence), rTot = barRow(T4, TB.totals);
    check('the CADENCE block is found by its label or a previous one', rCad > 0,
      'row ' + rCad + ' (aliases: ' + (TB_ALIASES[TB.cadence] || []).join(', ') + ')');

    const cadIdx = {};
    CADENCE_ROWS.forEach((lab, i) => { cadIdx[lab] = rCad + 1 + i; });
    // Only the rows the SHEET has room for: an older import of Col_Cards_Totals reserves four rows
    // and the writer clamps to them (checked below). Asserting all six would be asserting workbook
    // state, which is exactly the gate rot this harness keeps re-learning - the rule is that every
    // row that fits lands on its own label, in order.
    let room = 0;
    for (let r = rCad + 1; r < T4.length; r++) {
      const a = String((T4[r] || [])[0] || '').trim();
      const rest = (T4[r] || []).slice(1).filter(x => x !== '' && x != null);
      if (a && !rest.length) break;
      room++;
    }
    const fit = Math.min(CADENCE_ROWS.length, Math.max(0, room - 1));
    const rowLabels = CADENCE_ROWS.slice(0, fit)
      .map((lab, i) => String((T4[rCad + 1 + i] || [])[0] || '').trim());
    check('every CADENCE row the sheet has room for landed on its own label',
      rowLabels.join('|') === CADENCE_ROWS.slice(0, fit).join('|'),
      fit + ' of ' + CADENCE_ROWS.length + ' rows fit: ' + rowLabels.join(' | ') +
      (fit < CADENCE_ROWS.length ? '   <- re-import display/Col_Cards_Totals_v1.xlsx for the rest' : ''));
    const haveNew = fit === CADENCE_ROWS.length;

    // BUILDER vs ENGINE, read off the BUILDER SOURCE rather than off whichever import happens to be
    // in the workbook: the two lists have to agree, and the sheet is downstream of both. This is
    // the check that would have caught CADENCE growing to six rows against a four-row reservation.
    {
      const bsrc = fs.readFileSync(path.join(__dirname, '..', 'builders', '_build_cardcloud.py'), 'utf8');
      const reserved = {};
      const re = /\(\s*'([^']+)'\s*,\s*(SRC_ROWS|\d+)\s*\)/g;
      let m;
      while ((m = re.exec(bsrc))) reserved[m[1]] = (m[2] === 'SRC_ROWS' ? CLOUD_SRC_ROWS : Number(m[2]));
      const want = { [TB.cadence]: CADENCE_ROWS.length, [TB.totals]: TOTALS_ROWS.length,
                     [TB.totalsBand]: TOTALS_ROWS.length, [TB.ulMinutes]: UL_ROWS.length,
                     [TB.ecoTotal]: REWARD_COLUMNS.length, [TB.ecoSets]: REWARD_COLUMNS.length,
                     [TB.ecoAlbums]: REWARD_COLUMNS.length };
      const short = Object.keys(want).filter(k => reserved[k] != null && reserved[k] < want[k]);
      check('the builder reserves a row for every engine row, block by block',
        short.length === 0,
        short.length ? short.map(k => k + ': reserves ' + reserved[k] + ', engine has ' + want[k]).join(' | ')
                     : Object.keys(want).map(k => k.split(' ')[0] + ' ' + reserved[k] + '>=' + want[k]).join(', '));
    }

    // ...and if a sheet in the wild IS too short, the writer must clamp rather than overwrite the
    // next bar. Shrink the gap under the cadence bar and prove the block below survives.
    {
      const vT = data['Col_Cards_Totals'].values;
      const snap = JSON.stringify(vT.slice(rCad - 1, rCad + CADENCE_ROWS.length + 3));
      const nextLabel = TB.ecoTotal;
      const rNext = barRow(totalsSheet(), nextLabel);
      // move the next bar up so only 2 data rows fit
      vT[rCad + 3] = [nextLabel];
      SimulateCardCloud();
      const T5 = totalsSheet();
      check('an under-reserved block CLAMPS instead of overwriting the next bar',
        String((T5[rCad + 3] || [])[0] || '').trim() === nextLabel,
        'row ' + (rCad + 4) + ' still reads ' + JSON.stringify(String((T5[rCad + 3] || [])[0] || '')));
      const restored = JSON.parse(snap);
      for (let i = 0; i < restored.length; i++) vT[rCad - 1 + i] = restored[i];
      reset(); setInputs(N, SEED); SimulateCardCloud();
      check('cadence fixture restored (the next bar is back where it was)',
        barRow(totalsSheet(), nextLabel) === rNext,
        'bar at ' + barRow(totalsSheet(), nextLabel) + ', was ' + rNext);
    }

    // THE THREE DENOMINATORS. Each rate is a RATIO OF MEANS, so rate x its mean day count is
    // exactly the mean season total - no rounding slack beyond what the sheet prints. That identity
    // is what makes "packs per day" checkable on the sheet instead of an argument between two
    // sheets, which is how this started (2026-09-07).
    const iTot = TOTALS_ROWS.indexOf('Total Packs Opened');
    const need = ['Packs per calendar day (mean)', 'Packs per ACTIVE day (mean)',
                  'Packs on a day that has one (mean)', 'Active days (mean, of 33)',
                  'Days with a pack (mean, of 33)'];
    const missing = need.filter(l => CADENCE_ROWS.indexOf(l) < 0);
    check('every cadence row this gate reads still exists in CADENCE_ROWS',
      missing.length === 0, missing.length ? 'renamed away: ' + missing.join(', ') : need.length + ' rows');

    if (haveNew && !missing.length) {
      const get = (lab, c) => Number((T4[cadIdx[lab]] || [])[c]);
      let wCal = 0, wAct = 0, wPack = 0, atW = '';
      let ordered = true;
      perms.forEach((pm, j) => {
        const c = 1 + j;
        const total = Number((T4[rTot + 1 + iTot] || [])[c]);
        const cal  = get('Packs per calendar day (mean)', c);
        const act  = get('Packs per ACTIVE day (mean)', c);
        const pkd  = get('Packs on a day that has one (mean)', c);
        const nAct = get('Active days (mean, of 33)', c);
        const nPkd = get('Days with a pack (mean, of 33)', c);
        wCal  = Math.max(wCal,  Math.abs(cal * DAILY_DAYS - total));
        wAct  = Math.max(wAct,  Math.abs(act * nAct - total));
        wPack = Math.max(wPack, Math.abs(pkd * nPkd - total));
        // Packs land ONLY on days the player was in the game, and they clump, so the three rates
        // can only go one way. Not decoration: this caught season-pass envelopes opening on days
        // the log itself marked '(did not play)' - days-with-a-pack came out ABOVE days-played
        // (0-9 NONPAYER 3.2 vs 2.6), which no real player can do. Fixed by snapping the pass track
        // to an attended day the way D32 already snapped the instance rungs.
        if (!(pkd >= act - 1e-9 && act >= cal - 1e-9)) { ordered = false; atW = pm.label; }
      });
      check('packs per CALENDAR day x 33 == Total Packs Opened',
        wCal < 0.025, 'worst ' + wCal.toFixed(4));
      check('packs per ACTIVE day x active days == Total Packs Opened',
        wAct < 0.25, 'worst ' + wAct.toFixed(4));
      check('packs on a PACK day x days with a pack == Total Packs Opened',
        wPack < 0.35, 'worst ' + wPack.toFixed(4));
      check('the three rates are ordered pack-day >= active day >= calendar day',
        ordered, ordered ? 'on all ' + perms.length + ' permutations' : 'violated at ' + atW);

      // the same rule stated on the day counts, which is where it is legible: a pack cannot drop
      // on a day nobody played, so pack days can never outnumber active days
      let daysOk = true, atD = '';
      perms.forEach((pm, j) => {
        const c = 1 + j;
        if (get('Days with a pack (mean, of 33)', c) > get('Active days (mean, of 33)', c) + 1e-9) {
          daysOk = false; atD = pm.label;
        }
      });
      check('days with a pack never exceed days played', daysOk,
        daysOk ? 'on all ' + perms.length + ' permutations' : 'violated at ' + atD);
    }
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
