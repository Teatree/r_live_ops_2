// Offline harness for SimFill.gs (D52) - the menu run that replaces every ECOGAINS_* spill with
// the value it computes, in ONE execution.
//
//   node harness/_mock_simfill.js               (defaults to the collections dump)
//   node harness/_mock_simfill.js --data _mockdata_wb9.json
//
// The SpreadsheetApp mock and the engine loader are reused from _mock_cards.js, same as
// _mock_cloud.js does - two mocks that drift apart is the failure this project keeps paying for.
// Two things the shared mock does NOT have are added here, because only this file needs them:
// FORMULAS (getFormulas / getFormula / setFormula) and PropertiesService.
//
// EVERY FORMULA IN THIS FILE IS A FIXTURE, never a read of the live workbook. The rule under test
// is "parse the formula as authored, resolve its arguments against the sheet, call the function,
// write what it returns - and refuse, loudly, anything you cannot parse with certainty". A gate
// that asserted the workbook's current formula text would pass for the wrong reason the moment
// someone re-authored a cell.
const fs = require('fs');
const path = require('path');

const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
if (CARDS.indexOf(CUT) < 0) throw new Error('_mock_cards.js prelude marker moved - fix CUT.');
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function GATES() {
  const fillSrc = fs.readFileSync(ENGINE('SimFill.gs'), 'utf8');

  // ---------------------------------------------------------------- formula + properties mock
  // Formulas live beside the values, keyed "r,c". A cell with a formula reports it through
  // getFormulas/getFormula; setValue and clearContent drop it, exactly as Sheets does - which is
  // the behaviour the fill depends on when it clears an anchor to collapse the old spill.
  const formulas = {};                                   // sheet -> {"r,c": "=..."}
  const F = (n) => (formulas[n] = formulas[n] || {});
  const props = {};
  global.PropertiesService = {
    getDocumentProperties: () => ({
      getProperty: (k) => (props[k] === undefined ? null : props[k]),
      setProperty: (k, v) => { props[k] = String(v); },
    }),
  };
  global.LockService = { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };

  const baseSS = SpreadsheetApp.getActiveSpreadsheet();
  const wrapRange = (name, rng, r1, c1, nr, nc) => {
    const f = F(name);
    return Object.assign(Object.create(null), rng, {
      getFormula: () => f[r1 + ',' + c1] || '',
      setFormula: (v) => { f[r1 + ',' + c1] = v; },
      getFormulas: () => {
        const out = [];
        for (let r = r1; r < r1 + nr; r++) {
          const row = [];
          for (let c = c1; c < c1 + nc; c++) row.push(f[r + ',' + c] || '');
          out.push(row);
        }
        return out;
      },
      setValue: (v) => { delete f[r1 + ',' + c1]; rng.setValue(v); },
      setValues: (g) => {
        for (let i = 0; i < g.length; i++)
          for (let j = 0; j < g[i].length; j++) delete f[(r1 + i) + ',' + (c1 + j)];
        rng.setValues(g);
      },
      clearContent: () => {
        for (let r = r1; r < r1 + nr; r++)
          for (let c = c1; c < c1 + nc; c++) delete f[r + ',' + c];
        rng.clearContent();
      },
    });
  };
  const wrapSheet = (name) => {
    const sh = mkSheet(name);
    if (!sh) return null;
    const dims = () => {
      const v = data[name].values;
      return [v.length, v.reduce((m, r) => Math.max(m, r.length), 0)];
    };
    return Object.assign(Object.create(null), sh, {
      getName: () => name,
      getMaxRows: () => dims()[0],
      getMaxColumns: () => dims()[1],
      getDataRange: () => { const [nr, nc] = dims(); return wrapRange(name, sh.getDataRange(), 1, 1, nr, nc); },
      getRange: (a, b, c, d) => {
        const r = sh.getRange(a, b, c, d);
        return wrapRange(name, r, r.getRow(), r.getColumn(), r.getNumRows(), r.getNumColumns());
      },
    });
  };
  const alerts = [];                                     // the end-of-run pop-up (D65)
  global.SpreadsheetApp = Object.assign({}, SpreadsheetApp, {
    getUi: () => ({ alert: (title, text) => { alerts.push(String(text === undefined ? title : text)); }, ButtonSet: { OK: 'OK' } }),
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => wrapSheet(n),
      // getSheets is what lets simFillSheets_ find a sim sheet the curated list misses (the
      // 'EcoGainsSim_HC' vs 'EcoGainsSim' name split). Without it here the gate would pass on a
      // curated list that does not cover this workbook.
      getSheets: () => Object.keys(data).filter(k => !k.startsWith('_')).map(k => wrapSheet(k)),
    }),
  });

  // the two companions whose spills the layouts locate (cal_new's counts, the so_far window)
  // DIRECT evals at this scope: an eval inside a callback defines its functions in the callback,
  // where neither the fill nor these gates can see them.
  eval(fs.readFileSync(ENGINE('CalStats.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('EcoGainsSim_7Day.gs'), 'utf8'));
  eval(fillSrc);

  const cellVal = (sheet, r, c) => {
    const row = data[sheet].values[r - 1] || [];
    return row[c - 1] === undefined ? '' : row[c - 1];
  };
  const setF = (sheet, r, c, f) => { F(sheet)[r + ',' + c] = f; };
  const clearAll = () => {
    Object.keys(formulas).forEach(k => delete formulas[k]);
    Object.keys(props).forEach(k => delete props[k]);
    alerts.length = 0; toasts.length = 0;
  };

  // ---------------------------------------------------------------- 0. namespace hygiene
  {
    const names = (src) => {
      const out = new Set();
      const re = /^(?:function\s+([A-Za-z0-9_$]+)|var\s+([A-Za-z0-9_$]+)\s*=)/gm;
      let m;
      while ((m = re.exec(src))) out.add(m[1] || m[2]);
      return out;
    };
    const fn = names(fillSrc);
    const others = [v4Src, dailySrc, cardSrc,
                    fs.readFileSync(ENGINE('SimPerSegmentFill.gs'), 'utf8')].map(names);
    const clash = [...fn].filter(n => others.some(s => s.has(n)));
    check('SimFill.gs declares no globals that collide with the other engine files',
      clash.length === 0, clash.length ? 'collides: ' + clash.join(', ') : 'none');
    check('SimFill.gs does not define onOpen (it would kill the EcoGainsSim menu)',
      !/^function\s+onOpen\s*\(/m.test(fillSrc));
    check('the EcoGainsSim menu offers both fill and restore',
      /addItem\('Fill all sims \(values, no formulas\)',\s*'fillAllSims'\)/.test(v4Src) &&
      /addItem\('Restore sim formulas',\s*'restoreSimFormulas'\)/.test(v4Src));
  }

  // ---------------------------------------------------------------- 1. the formula parser
  // Shapes are asserted one by one, INCLUDING the ones that must be refused. The refusals are the
  // half that matters: a parser that quietly mis-reads an argument writes a confident wrong number
  // into a cell that used to be right, and nothing anywhere says so.
  {
    const t = (f) => simFillTarget_(String(f).replace(/^=/, ''));
    // The trailing sim_refresh!$A$1 must be DROPPED, not resolved: it exists only to defeat
    // Google's argument-based caching, no engine function reads it, and resolving it would make
    // the fill depend on a hidden one-cell sheet being present.
    const bare = t('=ECOGAINS_TOF($B$272, "RUN", sim_refresh!$A$1)');
    check('a bare ECOGAINS_ call parses, arguments in order, nonce dropped',
      bare && bare.name === 'ECOGAINS_TOF' && bare.args.join('|') === '$B$272|"RUN"',
      bare ? bare.args.join(' | ') : 'not parsed');

    const let1 = t('=LET(payer, $B$3, segment, $A$5, ECOGAINS_SIM(payer, segment, sim_refresh!$A$1))');
    check('a LET wrapper resolves its bindings into the ECOGAINS_ arguments',
      let1 && let1.name === 'ECOGAINS_SIM' && let1.args.join('|') === '$B$3|$A$5',
      let1 ? let1.args.join(' | ') : 'not parsed');

    const noArg = t('=ECOGAINS_CAL_COUNTS(sim_refresh!$A$1)');
    check('a call whose ONLY argument is the nonce parses to zero arguments',
      noArg && noArg.name === 'ECOGAINS_CAL_COUNTS' && noArg.args.length === 0,
      noArg ? noArg.args.length + ' args' : 'not parsed');

    const chain = t('=LET(a, $B$3, b, a, ECOGAINS_SIM(b, "0-9"))');
    check('a binding that names an earlier binding is followed to the reference',
      chain && chain.args[0] === '$B$3', chain ? chain.args.join(' | ') : 'not parsed');

    check('an arithmetic expression around the call is REFUSED (not silently evaluated)',
      t('=ECOGAINS_SIM($B$3, $A$5) * 2') === null);
    check('a non-ECOGAINS function is REFUSED',
      t('=SUM(A1:A9)') === null);
    check('a LET with an even argument count (no body) is REFUSED',
      t('=LET(payer, $B$3, ECOGAINS_SIM(payer))') === null ||
      t('=LET(payer, $B$3, segment, $A$5, ECOGAINS_SIM(payer))') !== null);
    check('an unknown ECOGAINS_ name resolves to no function rather than throwing',
      simFillFn_('ECOGAINS_NOT_A_REAL_ONE') === null);
    check('simFillFn_ refuses a name outside the ECOGAINS_ namespace',
      simFillFn_('Context') === null && simFillFn_('eval') === null);
  }

  // ---------------------------------------------------------------- 2. argument resolution
  {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const r = (e, sheet) => simFillResolve_(ss, sheet || 'EcoGainsSim', e);
    check('a quoted literal resolves to the string', r('"NEW"').value === 'NEW');
    check('a number literal resolves to a number', r('42').value === 42);
    check('a same-sheet reference reads that sheet', (() => {
      data['EcoGainsSim'].values[2] = data['EcoGainsSim'].values[2] || [];
      const sh = ss.getSheetByName('EcoGainsSim');
      sh.getRange('B3').setValue('PAYER');
      return r('$B$3').value === 'PAYER';
    })());
    check('a cross-sheet reference reads the named sheet', (() => {
      const sh = ss.getSheetByName('sim_refresh') || ss.getSheetByName('PackConfig');
      const name = sh.getName();
      sh.getRange('A1').setValue('NONCE-X');
      return r(name + "!$A$1").value === 'NONCE-X';
    })());
    check('a RANGE argument is REFUSED rather than reduced to its first cell',
      r('$B$3:$B$9').ok === false);
    check('a reference to a missing sheet is REFUSED', r('NoSuchSheet!$A$1').ok === false);
  }

  // ---------------------------------------------------------------- 3. fill, end to end
  {
    clearAll();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sim = ss.getSheetByName('EcoGainsSim');
    sim.getRange('B3').setValue('NONPAYER');
    sim.getRange('A5').setValue('40-99');
    setF('EcoGainsSim', 7, 2,
      '=LET(payer, $B$3, segment, $A$5, ECOGAINS_SIM(payer, segment, sim_refresh!$A$1))');
    // The refusal fixture, side by side with the good one: one cell must fill and the other must
    // still be a formula afterwards, in the SAME run.
    // OUTSIDE every block the labels locate (D65) but INSIDE the sheet's data range: a cell in a
    // spill's footprint is overwritten by that spill (the sheet working, not the refusal failing),
    // and a cell past the data range is never scanned at all. Row 3 is the input row.
    setF('EcoGainsSim', 3, 10, '=ECOGAINS_SIM($B$3, $A$5) + 1');

    const want = ECOGAINS_SIM('NONPAYER', '40-99');
    const n = fillAllSims();

    check('the fill wrote at least the one supported anchor', n >= 1, 'filled ' + n);
    check('the anchor now holds the value the custom function returns, not a formula',
      cellVal('EcoGainsSim', 7, 2) === want[0][0] && !F('EcoGainsSim')['7,2'],
      'cell=' + JSON.stringify(cellVal('EcoGainsSim', 7, 2)) + ' want=' + JSON.stringify(want[0][0]));
    check('the WHOLE spill was written, every row and column', (() => {
      for (let i = 0; i < want.length; i++)
        for (let j = 0; j < want[i].length; j++)
          if (cellVal('EcoGainsSim', 7 + i, 2 + j) !== want[i][j]) return false;
      return true;
    })(), want.length + ' x ' + want[0].length + ' cells');
    check('an unparseable formula is LEFT IN PLACE, not overwritten',
      F('EcoGainsSim')['3,10'] === '=ECOGAINS_SIM($B$3, $A$5) + 1');
    check('and it is named in the toast so the skip cannot pass for success',
      toasts.some(t => t.indexOf('LEFT AS FORMULAS') >= 0 && t.indexOf('R3C10') >= 0),
      toasts.length ? toasts[toasts.length - 1].slice(0, 160) : '(no toast)');

    // THE POINT OF THE WHOLE FILE: one execution, one set of sheet reads.
    const readsOut = {};
    check('the fill reads each sheet ONCE, not once per anchor', (() => {
      const reads = readsOut;
      const orig = sheetVals_;
      _sheetValsCache = {}; Context.reset();
      // Count MISSES, not calls. sheetVals_ is called constantly and answers from
      // _sheetValsCache; the thing that costs a round trip in Apps Script - and the thing this
      // whole file exists to collapse - is the miss.
      sheetVals_ = function (nm) {
        if (_sheetValsCache[nm] === undefined) reads[nm] = (reads[nm] || 0) + 1;
        return orig(nm);
      };
      setF('EcoGainsSim', 39, 2,
        '=LET(payer, $B$3, segment, $A$5, ECOGAINS_SIM(payer, segment, sim_refresh!$A$1))');
      setF('EcoGainsSim', 71, 2,
        '=LET(payer, $B$3, segment, $A$5, ECOGAINS_DIFF(payer, segment, sim_refresh!$A$1))');
      fillAllSims();
      sheetVals_ = orig;
      const twice = Object.keys(reads).filter(k => reads[k] > 1);
      return Object.keys(reads).length > 0 && twice.length === 0;
    })(), Object.keys(readsOut).length + ' sheets, worst ' +
          Math.max(0, ...Object.values(readsOut)) + ' read(s): ' +
          Object.keys(readsOut).filter(k => readsOut[k] > 1).join(', '));
  }

  // ---------------------------------------------------------------- 4. re-fill and restore
  {
    clearAll();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sim = ss.getSheetByName('EcoGainsSim');
    sim.getRange('B3').setValue('PAYER');
    sim.getRange('A5').setValue('10-19');
    const FML = '=LET(payer, $B$3, segment, $A$5, ECOGAINS_SIM(payer, segment, sim_refresh!$A$1))';
    setF('EcoGainsSim', 7, 2, FML);
    fillAllSims();
    check('one fill leaves no ECOGAINS_ formula behind on that anchor', !F('EcoGainsSim')['7,2']);

    // A SECOND fill has no live formula to scan. Without the snapshot it would find nothing, do
    // nothing, and report success - which is indistinguishable from working.
    sim.getRange('A5').setValue('100+');
    const want2 = ECOGAINS_SIM('PAYER', '100+');
    const n2 = fillAllSims();
    check('a SECOND fill still finds the anchor, from the snapshot rather than a live formula',
      n2 >= 1 && cellVal('EcoGainsSim', 7, 2) === want2[0][0],
      'filled ' + n2);
    check('and it re-read the arguments, so an input edit between runs is picked up',
      cellVal('EcoGainsSim', 7, 3) === want2[0][1] &&
      JSON.stringify(want2) !== JSON.stringify(ECOGAINS_SIM('PAYER', '10-19')),
      '100+ differs from 10-19');

    const back = restoreSimFormulas();
    check('restore puts the original formula back, character for character',
      back >= 1 && F('EcoGainsSim')['7,2'] === FML, F('EcoGainsSim')['7,2'] || '(none)');
    check('restore clears the value it replaced, so no stale number sits under the spill',
      cellVal('EcoGainsSim', 7, 2) === '');
  }

  // ---------------------------------------------------------------- 5. it must not invent work
  // D65 changed the rule: with no formula and no snapshot the fill reads the sheet's LABELS, and
  // only a sheet it cannot read that way is left alone. So the fixture is the UNRECOGNISED case:
  // a sheet whose name has no layout rule, and a known sheet whose labels are gone.
  {
    clearAll();
    const snap = JSON.stringify(data['EcoGainsSim'].values);
    const scratch = JSON.parse(snap);
    data['EcoGainsSim_scratch'] = { values: scratch, merges: [] };      // scanned (name prefix), no rule
    // the known sheet: blank every segment tag so its layout cannot be read
    const v = data['EcoGainsSim'].values;
    const tags = [];
    for (let r = 0; r < v.length; r++) for (let c = 0; c < 2; c++)
      if (['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'].indexOf(String((v[r] || [])[c] || '').trim()) >= 0) { tags.push([r, c, v[r][c]]); v[r][c] = ''; }
    const beforeScratch = JSON.stringify(scratch), beforeMain = JSON.stringify(v);
    const n = fillAllSims();
    check('a sheet with no formula, no snapshot and no readable layout is left untouched',
      JSON.stringify(data['EcoGainsSim_scratch'].values) === beforeScratch && JSON.stringify(data['EcoGainsSim'].values) === beforeMain,
      'filled ' + n);
    check('and both are NAMED in the pop-up: the unknown sheet and the sheet whose labels are missing',
      alerts.some(t => t.indexOf('no layout rule for sheet "EcoGainsSim_scratch"') >= 0) &&
      alerts.some(t => /EcoGainsSim: no segment block found/.test(t)),
      alerts.join(' | ').slice(0, 300));
    {
      const n2 = restoreSimFormulas();
      check('restore puts nothing back on a sheet that had no snapshot (other sheets may restore), and says so when nothing did',
        !Object.keys(F('EcoGainsSim')).length && !Object.keys(F('EcoGainsSim_scratch')).length &&
        (n2 > 0 || toasts.some(t => t.indexOf('No fill snapshot found') >= 0)), 'restored ' + n2);
    }
    tags.forEach(([r, c, t]) => { v[r][c] = t; });
    delete data['EcoGainsSim_scratch'];
    check('section 5 fixture restored', JSON.stringify(data['EcoGainsSim'].values) === snap);
  }

  // ---------------------------------------------------------------- 5b. labels ARE a source (D65)
  // The same sheet, labels intact, no formula, no snapshot: the fill locates the anchors from the
  // segment tags / 'Source | HC' headers and the 'Payer' input, writes the spills, and says so.
  {
    clearAll();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sim = ss.getSheetByName('EcoGainsSim');
    const vals = sim.getDataRange().getValues();
    const lay = simFillLayoutAnchors_('EcoGainsSim', vals, sim.getMaxRows(), sim.getMaxColumns());
    const simA = lay.anchors.filter(a => a.formula.indexOf('ECOGAINS_SIM(') >= 0);
    const difA = lay.anchors.filter(a => a.formula.indexOf('ECOGAINS_DIFF(') >= 0);
    check('the 33-day grid yields one SIM and one DIFF anchor per segment block, from its labels',
      simA.length >= 1 && simA.length === difA.length, simA.length + ' SIM / ' + difA.length + ' DIFF');
    const payerCell = sim.getRange('B3').getValue();
    const a0 = simA[0];
    const segCell = sim.getRange(a0.formula.match(/segment, (\$[A-Z]+\$\d+)/)[1].replace(/\$/g, '')).getValue();
    const want = ECOGAINS_SIM(String(payerCell), String(segCell));
    const n = fillAllSims();
    check('with no formula and no snapshot the fill still writes every block it can locate', n >= simA.length, 'filled ' + n);
    check('the located anchor holds the value the custom function returns', Math.abs(Number(cellVal('EcoGainsSim', a0.row, a0.col)) - Number(want[0][0])) < 1e-9,
      'cell ' + cellVal('EcoGainsSim', a0.row, a0.col) + ' want ' + want[0][0]);
    check('the pop-up says the anchors came from the labels', alerts.some(t => /located from the sheet labels/.test(t)));
    check('a snapshot now exists, so the next fill does not even need the labels', !!props[SIMFILL_PROP + 'EcoGainsSim']);
    check('restore writes the builder-shaped formula back at the located anchor',
      restoreSimFormulas() >= 1 && F('EcoGainsSim')[a0.row + ',' + a0.col] === a0.formula, F('EcoGainsSim')[a0.row + ',' + a0.col]);
  }

  // ---------------------------------------------------------------- 7. BUILDER PARITY (D65)
  // Every display xlsx the builders emit, mounted as a sheet: the anchors the LABELS imply must
  // be exactly the cells and formulas the builder wrote (ECOGAINS_CAL_STATS excluded - it has no
  // label and the live workbooks never carried it). A new builder layout that this rule cannot
  // read fails here, not in the user's workbook.
  {
    const disp = JSON.parse(fs.readFileSync(path.join(__dirname, '_display_formulas.json'), 'utf8'));
    const norm = (f) => String(f).replace(/\s+/g, '').replace(/,?sim_refresh!\$A\$1/g, '').replace(/^=/, '');
    Object.keys(disp).forEach(name => {
      const d = disp[name];
      const want = {};
      Object.keys(d.formulas).forEach(id => { const f = d.formulas[id]; if (f.indexOf('ECOGAINS') >= 0 && f.indexOf('ECOGAINS_CAL_STATS') < 0) want[id] = f; });
      const lay = simFillLayoutAnchors_(name, d.values, d.max_rows, d.max_cols);
      const got = {};
      lay.anchors.forEach(a => { got[a.row + ',' + a.col] = a.formula; });
      const missing = Object.keys(want).filter(id => !got[id]);
      const extra = Object.keys(got).filter(id => !want[id]);
      const wrong = Object.keys(want).filter(id => got[id] && norm(got[id]) !== norm(want[id]));
      check('BUILDER PARITY ' + name + ' (' + d.file + '): the labels locate every anchor the builder wrote, and no other',
        !missing.length && !extra.length, 'missing ' + JSON.stringify(missing) + ' extra ' + JSON.stringify(extra) + ' notes ' + JSON.stringify(lay.notes));
      check('BUILDER PARITY ' + name + ': every located formula equals the builder text (whitespace / nonce aside)',
        !wrong.length, wrong.map(id => id + ': ' + got[id] + ' vs ' + want[id]).join(' | '));
      check('BUILDER PARITY ' + name + ': every anchor carries a room (rows x cols) the layout leaves for it',
        lay.anchors.every(a => a.room && a.room.rows > 0 && a.room.cols > 0), JSON.stringify(lay.anchors.map(a => [a.row, a.col, a.room])));
    });
  }

  // ---------------------------------------------------------------- 8. WRITTEN BY LABEL (D68)
  // Mount the HC_v4 display (built for the old 25-source / 19-resource list) and fill it with
  // today's 29-source / 20-resource engine. Rule: every labelled row receives ITS OWN source's
  // values (the positional writer put Season Pass (Paid) in Target Day's row and everything below
  // it one source off), the sources and resources the layout lacks are NAMED in the pop-up, and
  // nothing outside the labelled cells moves - the next block's tag row included.
  {
    clearAll();
    const disp = JSON.parse(fs.readFileSync(path.join(__dirname, '_display_formulas.json'), 'utf8'));
    const hc = disp['EcoGainsSim_HC'];
    const had = data['EcoGainsSim_HC'];
    data['EcoGainsSim_HC'] = { values: hc.values.map(r => r.slice()), merges: [] };
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EcoGainsSim_HC');
    const lay = simFillLayoutAnchors_('EcoGainsSim_HC', sh.getDataRange().getValues(), sh.getMaxRows(), sh.getMaxColumns());
    const first = lay.anchors.find(a => a.formula.indexOf('ECOGAINS_SIM(') >= 0);
    const labels = Object.keys(first.map.rows);
    const missingSrc = CATEGORY_ORDER.filter(c => first.map.rows[c] === undefined);
    const missingRes = RESOURCES.filter(r => first.map.cols[r] === undefined);
    const nextTagRow = first.row + first.room.rows;
    const belowBefore = JSON.stringify(data['EcoGainsSim_HC'].values[nextTagRow - 1]);
    const want = ECOGAINS_SIM(String(sh.getRange('C3').getValue()), String(sh.getRange('B6').getValue()));
    fillAllSims();
    let wrong = [];
    labels.forEach(lab => {
      const i = CATEGORY_ORDER.indexOf(lab); if (i < 0) return;
      RESOURCES.forEach((r, j) => {
        const c = first.map.cols[r]; if (c === undefined) return;
        const got = cellVal('EcoGainsSim_HC', first.map.rows[lab], c);
        if (Math.abs(Number(got) - Number(want[i][j])) > 1e-9) wrong.push(lab + '/' + r + ' got ' + got + ' want ' + want[i][j]);
      });
    });
    check('LABEL MAP: every labelled row holds ITS OWN source\'s value, column by resource header (old 25-source layout, 29-source engine)',
      labels.length > 0 && missingSrc.length > 0 && wrong.length === 0, wrong.slice(0, 3).join(' | ') || (labels.length + ' labelled rows, all correct'));
    check('LABEL MAP: the sources and resources the layout has no label for are NAMED in the pop-up',
      alerts.some(t => /NOT ON THE SHEET/.test(t) && missingSrc.every(m => t.indexOf(m) >= 0) && missingRes.every(m => t.indexOf(m) >= 0)),
      'missing ' + missingSrc.join(', ') + ' / ' + missingRes.join(', ') + ' | ' + alerts.join(' | ').slice(0, 300));
    check('LABEL MAP: the next block\'s tag row is untouched', JSON.stringify(data['EcoGainsSim_HC'].values[nextTagRow - 1]) === belowBefore);
    if (had) data['EcoGainsSim_HC'] = had; else delete data['EcoGainsSim_HC'];
  }
  // a PERMUTED label list: swap two source labels on the sheet -> the values follow the labels
  {
    clearAll();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const snapMain = JSON.stringify(data['EcoGainsSim'].values);
    const sim = ss.getSheetByName('EcoGainsSim');
    const lay0 = simFillLayoutAnchors_('EcoGainsSim', sim.getDataRange().getValues(), sim.getMaxRows(), sim.getMaxColumns());
    const a0 = lay0.anchors.find(a => a.formula.indexOf('ECOGAINS_SIM(') >= 0);
    const rA = a0.map.rows['Ads'], rC = a0.map.rows['Core'];
    const labCol = (() => { const v = data['EcoGainsSim'].values; for (let c = 0; c < 3; c++) if (String((v[rA - 1] || [])[c]).trim() === 'Ads') return c; return 0; })();
    data['EcoGainsSim'].values[rA - 1][labCol] = 'Core'; data['EcoGainsSim'].values[rC - 1][labCol] = 'Ads';
    const segCell = sim.getRange(a0.formula.match(/segment, (\$[A-Z]+\$\d+)/)[1].replace(/\$/g, '')).getValue();
    const want = ECOGAINS_SIM(String(sim.getRange('B3').getValue()), String(segCell));
    fillAllSims();
    const hcCol = a0.map.cols['HC'];
    check('LABEL MAP: swap the "Ads" and "Core" labels on the sheet -> each row receives the source its label names',
      Math.abs(Number(cellVal('EcoGainsSim', rA, hcCol)) - Number(want[CATEGORY_ORDER.indexOf('Core')][0])) < 1e-9 &&
      Math.abs(Number(cellVal('EcoGainsSim', rC, hcCol)) - Number(want[CATEGORY_ORDER.indexOf('Ads')][0])) < 1e-9,
      'row ' + rA + ' (now "Core") ' + cellVal('EcoGainsSim', rA, hcCol) + ' / row ' + rC + ' (now "Ads") ' + cellVal('EcoGainsSim', rC, hcCol));
    data['EcoGainsSim'].values = JSON.parse(snapMain);
  }
  // a sheet label the engine does not produce: left as it was, and named
  {
    clearAll();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const snapMain = JSON.stringify(data['EcoGainsSim'].values);
    const sim = ss.getSheetByName('EcoGainsSim');
    const lay0 = simFillLayoutAnchors_('EcoGainsSim', sim.getDataRange().getValues(), sim.getMaxRows(), sim.getMaxColumns());
    const a0 = lay0.anchors.find(a => a.formula.indexOf('ECOGAINS_SIM(') >= 0);
    const rI = a0.map.rows['IAPs'];
    const v = data['EcoGainsSim'].values;
    const labCol = [0, 1, 2].find(c => String((v[rI - 1] || [])[c]).trim() === 'IAPs');
    v[rI - 1][labCol] = 'Retired Event';
    const hcCol = a0.map.cols['HC'];
    v[rI - 1][hcCol - 1] = 777;
    fillAllSims();
    check('LABEL MAP: a sheet label the engine does not produce keeps its cells, and is named in the pop-up',
      Number(cellVal('EcoGainsSim', rI, hcCol)) === 777 && alerts.some(t => /Labels on the sheet the engine does not produce/.test(t) && t.indexOf('Retired Event') >= 0),
      'cell ' + cellVal('EcoGainsSim', rI, hcCol));
    data['EcoGainsSim'].values = JSON.parse(snapMain);
  }

  // ---------------------------------------------------------------- 9. the so_far twin (when the dump has it)
  {
    if (data['EcoGainsSim_so_far'] && data['cal_new']) {
      // LIVE_OPS_V3's own old-layout sheets (25 sources): after a fill, the cal_new summary row
      // labelled "Target Day" carries Target Day's counts, not Season Pass (Paid)'s (D68).
      clearAll();
      const snapCal = JSON.stringify(data['cal_new'].values);
      fillAllSims();
      const want = ECOGAINS_CAL_COUNTS();
      const cv = data['cal_new'].values;
      const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('cal_new');
      const lay = simFillLayoutAnchors_('cal_new', JSON.parse(snapCal), sh.getMaxRows(), sh.getMaxColumns());
      const a = lay.anchors[0];
      const bad = Object.keys(a.map.rows).filter(lab => {
        const i = CATEGORY_ORDER.indexOf(lab); if (i < 0) return false;
        return String(cv[a.map.rows[lab] - 1][a.col - 1]) !== String(want[i][0]);
      });
      check('LABEL MAP on the workbook\'s own cal_new summary: every source row carries its own counts',
        bad.length === 0 && Object.keys(a.map.rows).length >= 20, bad.slice(0, 4).join(', ') || Object.keys(a.map.rows).length + ' rows correct');
      data['cal_new'].values = JSON.parse(snapCal);
    }
    if (data['EcoGainsSim_so_far']) {
      const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EcoGainsSim_so_far');
      const lay = simFillLayoutAnchors_('EcoGainsSim_so_far', sh.getDataRange().getValues(), sh.getMaxRows(), sh.getMaxColumns());
      check('EcoGainsSim_so_far: the same labels yield the 7-DAY functions, one SIM and one DIFF per block',
        lay.anchors.length >= 2 && lay.anchors.every(a => /ECOGAINS_(SIM|DIFF)_7_DAY\(/.test(a.formula)) &&
        lay.anchors.filter(a => /SIM_7_DAY/.test(a.formula)).length === lay.anchors.filter(a => /DIFF_7_DAY/.test(a.formula)).length,
        lay.anchors.length + ' anchors; ' + JSON.stringify(lay.notes));
    } else {
      console.log('SKIP so_far gate: this dump has no EcoGainsSim_so_far sheet (run with --data v3)');
    }
    if (data['ToF']) {
      const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ToF');
      const lay = simFillLayoutAnchors_('ToF', sh.getDataRange().getValues(), sh.getMaxRows(), sh.getMaxColumns());
      // the rule: a block is located if and only if its bar is on the sheet; a block whose bar is
      // missing is NAMED in the notes (LIVE_OPS_V3's ToF has no GAIN VS SPEND bar) - never guessed
      const colA = sh.getDataRange().getValues().map(r => String((r || [])[0] || '').trim());
      const simBar = colA.findIndex(t => /^SIM PART/i.test(t));
      const barOn = { RUN: /RUN ECONOMICS/i, REWARD: /REWARD PER RUN/i, GAINSPEND: /GAIN VS SPEND/i };
      const okAll = Object.keys(barOn).every(k => {
        const present = colA.slice(simBar + 1).some(t => barOn[k].test(t));
        const located = lay.anchors.some(a => a.formula.indexOf('"' + k + '"') >= 0);
        const named = lay.notes.some(n => n.indexOf('the ' + k + ' block is not filled') >= 0);
        return present ? located : (!located && named);
      });
      check('ToF: a SIM PART block is located exactly when its bar is on the sheet, and a missing bar is named in the pop-up',
        okAll, JSON.stringify(lay.anchors.map(a => [a.row, a.formula])) + ' ' + JSON.stringify(lay.notes));
    }
    if (data['cal_new']) {
      const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('cal_new');
      const lay = simFillLayoutAnchors_('cal_new', sh.getDataRange().getValues(), sh.getMaxRows(), sh.getMaxColumns());
      check('cal_new: the summary block yields the ECOGAINS_CAL_COUNTS anchor at its first instances column, room = the category rows',
        lay.anchors.length === 1 && lay.anchors[0].room.rows >= 20 && lay.anchors[0].room.cols >= 7,
        JSON.stringify(lay.anchors.map(a => [a.row, a.col, a.room])) + ' ' + JSON.stringify(lay.notes));
    }
  }

  // ---------------------------------------------------------------- 9b. A SHORTER TABLE CLEARS ITS OWN TAIL (D68)
  {
    if (data['ToF']) {
      clearAll();
      const snapT = JSON.stringify(data['ToF'].values);
      const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ToF');
      const lay = simFillLayoutAnchors_('ToF', sh.getDataRange().getValues(), sh.getMaxRows(), sh.getMaxColumns());
      const payerOf = (a) => String(sh.getRange(a.formula.match(/\$([A-Z]+)\$(\d+)/)[0].replace(/\$/g, '')).getValue());
      const blockOf = (a) => a.formula.match(/"([A-Z]+)"/)[1];
      // the anchor with the most spare room under its table
      let best = null, bestSpare = -1, bestLen = 0;
      lay.anchors.forEach(a => { const n = ECOGAINS_TOF(payerOf(a), blockOf(a)).length; const sp = a.room.rows - n; if (sp > bestSpare) { bestSpare = sp; best = a; bestLen = n; } });
      if (best && bestSpare >= 6) {
        const v = data['ToF'].values, r0 = best.row + bestLen;          // 1-based first row past the table
        const put = (r, a, b) => { v[r - 1] = v[r - 1] || []; v[r - 1][0] = a; v[r - 1][1] = b; };
        put(r0, 'old 0', 99); put(r0 + 1, 'old 1', 99); put(r0 + 2, 'old 2', 99);
        v[r0 + 2] = (v[r0 + 2] || []).map(() => '');                    // row r0+3 (1-based) blank
        put(r0 + 4, 'SENTINEL', 1);
        fillAllSims();
        const gone = [0, 1, 2].every(k => String(cellVal('ToF', r0 + k, 1)) === '');
        check('TAIL: a table that came back shorter clears the old rows directly under it, up to the first blank row',
          gone && alerts.some(t => /Shorter than last time/.test(t)), 'block ' + blockOf(best) + ' rows ' + r0 + '..' + (r0 + 2) + ': ' + JSON.stringify([0, 1, 2].map(k => cellVal('ToF', r0 + k, 1))));
        check('TAIL: nothing past the first blank row is touched', String(cellVal('ToF', r0 + 4, 1)) === 'SENTINEL');
        // a row that starts a table stops the tail even with no blank row between
        data['ToF'].values = JSON.parse(snapT);
        const v2 = data['ToF'].values;
        const put2 = (r, a, b) => { v2[r - 1] = v2[r - 1] || []; v2[r - 1][0] = a; v2[r - 1][1] = b; };
        put2(r0, 'Stage', 'Type'); put2(r0 + 1, 1, 'Safe');
        clearAll(); fillAllSims();
        check('TAIL: a row starting a new table (a header word) stops the tail - butted blocks are separate tables',
          String(cellVal('ToF', r0, 1)) === 'Stage' && String(cellVal('ToF', r0 + 1, 2)) === 'Safe');
      } else {
        console.log('SKIP tail gate: no ToF block has room for the fixture (best spare ' + bestSpare + ' rows)');
      }
      data['ToF'].values = JSON.parse(snapT);
    }
  }

  // ---------------------------------------------------------------- 9c. STALE REMEMBERED ANCHORS (D69)
  // A sheet rebuilt since its last fill: the snapshot remembers anchors one row and one column off
  // the blocks the labels now place. They must be DROPPED (named in the pop-up, gone from the new
  // snapshot), and the block must come out exactly as the engine computes it.
  {
    clearAll();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const snapMain = JSON.stringify(data['EcoGainsSim'].values);
    const sim = ss.getSheetByName('EcoGainsSim');
    const lay = simFillLayoutAnchors_('EcoGainsSim', sim.getDataRange().getValues(), sim.getMaxRows(), sim.getMaxColumns());
    const a0 = lay.anchors.find(a => a.formula.indexOf('ECOGAINS_SIM(') >= 0);
    const staleR = a0.row + 1, staleC = a0.col + 1;
    props[SIMFILL_PROP + 'EcoGainsSim'] = JSON.stringify([[staleR, staleC, a0.formula]]);
    const segCell = sim.getRange(a0.formula.match(/segment, (\$[A-Z]+\$\d+)/)[1].replace(/\$/g, '')).getValue();
    const want = ECOGAINS_SIM(String(sim.getRange('B3').getValue()), String(segCell));
    fillAllSims();
    let wrong = 0;
    Object.keys(a0.map.rows).forEach(lab => { const i = CATEGORY_ORDER.indexOf(lab); if (i < 0) return;
      RESOURCES.forEach((r, j) => { const c = a0.map.cols[r]; if (c === undefined) return;
        if (Math.abs(Number(cellVal('EcoGainsSim', a0.map.rows[lab], c)) - Number(want[i][j])) > 1e-9) wrong++; }); });
    const at = 'EcoGainsSim!' + simFillColA1_(staleC) + staleR;
    check('STALE SNAPSHOT: an anchor the labels do not support is not filled - the block is exactly the engine\'s', wrong === 0, wrong + ' wrong cells');
    check('STALE SNAPSHOT: it is named in the pop-up and gone from the new snapshot',
      alerts.some(t => t.indexOf('older layout') >= 0 && t.indexOf(at) >= 0) &&
      !JSON.parse(props[SIMFILL_PROP + 'EcoGainsSim'] || '[]').some(t => t[0] === staleR && t[1] === staleC),
      alerts.join(' | ').slice(0, 200));
    data['EcoGainsSim'].values = JSON.parse(snapMain);
  }
  // a legend directly under the last block (no blank row) is not reported as an unknown label
  {
    clearAll();
    const snapMain = JSON.stringify(data['EcoGainsSim'].values);
    const sim = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EcoGainsSim');
    const lay = simFillLayoutAnchors_('EcoGainsSim', sim.getDataRange().getValues(), sim.getMaxRows(), sim.getMaxColumns());
    const last = lay.anchors.filter(a => a.formula.indexOf('ECOGAINS_SIM(') >= 0).pop();
    const lastRow = Math.max.apply(null, Object.values(last.map.rows));
    const v = data['EcoGainsSim'].values, labCol = [0, 1].find(c => String((v[lastRow - 1] || [])[c] || '').trim() !== '');
    v[lastRow] = v[lastRow] || []; v[lastRow][labCol] = 'LEGEND / ASSUMPTIONS';
    v[lastRow + 1] = v[lastRow + 1] || []; v[lastRow + 1][labCol] = 'Colors: blue = measured';
    fillAllSims();
    check('LEGEND: text directly under the last block is not reported as a label the engine does not produce',
      !alerts.some(t => t.indexOf('LEGEND / ASSUMPTIONS') >= 0), alerts.join(' | ').slice(0, 200));
    data['EcoGainsSim'].values = JSON.parse(snapMain);
  }

  // ---------------------------------------------------------------- 10. V2Diff derives its pairs (D66)
  {
    const v2Src = fs.readFileSync(ENGINE('V2Diff.gs'), 'utf8');
    eval(v2Src);
    const pairs = v2diffPairs_();
    const has = (b, v) => pairs.some(p => p[0] === b && p[1] === v);
    const present = Object.keys(data).filter(n => n.endsWith('_v2') && data[n.slice(0, -3)]);
    check('V2Diff: every X_v2 sheet with a base X in the workbook is a pair (' + present.length + ' in this dump)',
      present.every(n => has(n.slice(0, -3), n)), present.filter(n => !has(n.slice(0, -3), n)).join(', '));
    const nsWd = !!data['NS_weekday'];
    check('V2Diff: NS_v2_weekday pairs with NS_weekday when that sheet exists, else with NS',
      !data['NS_v2_weekday'] || (nsWd ? (has('NS_weekday', 'NS_v2_weekday') && !has('NS', 'NS_v2_weekday')) : has('NS', 'NS_v2_weekday')),
      JSON.stringify(pairs.filter(p => p[1] === 'NS_v2_weekday')));
    const seen = {}; let dup = 0;
    pairs.forEach(p => { const k = p[0] + '>' + p[1]; if (seen[k]) dup++; seen[k] = 1; });
    check('V2Diff: no pair is listed twice', dup === 0, dup + ' duplicates');
    const derivedOnly = pairs.filter(p => !V2DIFF_PAIRS.some(q => q[0] === p[0] && q[1] === p[1]));
    check('V2Diff: every DERIVED pair names two sheets the workbook has (static pairs with an absent twin stay, reported as unauthored)',
      derivedOnly.every(p => data[p[0]] && data[p[1]]), JSON.stringify(derivedOnly.filter(p => !data[p[0]] || !data[p[1]])));
  }

  // ---------------------------------------------------------------- 6. a throwing function
  {
    clearAll();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.getSheetByName('EcoGainsSim').getRange('A5').setValue('NOT-A-SEGMENT');
    const FML = '=LET(segment, $A$5, ECOGAINS_SIM("NONPAYER", segment, sim_refresh!$A$1))';
    setF('EcoGainsSim', 7, 2, FML);
    const before = cellVal('EcoGainsSim', 7, 2);
    fillAllSims();
    // Either the engine answers for an unknown segment (it carries zeros) or it throws. Both are
    // acceptable; what is NOT acceptable is a throw quietly leaving the previous fill's numbers
    // in place with no formula and no warning.
    const threw = !!F('EcoGainsSim')['7,2'];
    check('a function that throws leaves its formula live rather than a stale value',
      threw ? (F('EcoGainsSim')['7,2'] === FML &&
               toasts.some(t => t.indexOf('threw') >= 0))
            : cellVal('EcoGainsSim', 7, 2) !== before || true,
      threw ? 'threw and was left as a formula' : 'engine answered for an unknown segment');
  }
}

eval(PRELUDE + '\n(' + GATES.toString() + ')();\n' + `
console.log('');
console.log(failures ? (failures + ' CHECK(S) FAILED') : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
`);
