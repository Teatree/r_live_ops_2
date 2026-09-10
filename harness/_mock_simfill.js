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
      getDataRange: () => { const [nr, nc] = dims(); return wrapRange(name, sh.getDataRange(), 1, 1, nr, nc); },
      getRange: (a, b, c, d) => {
        const r = sh.getRange(a, b, c, d);
        return wrapRange(name, r, r.getRow(), r.getColumn(), r.getNumRows(), r.getNumColumns());
      },
    });
  };
  global.SpreadsheetApp = Object.assign({}, SpreadsheetApp, {
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => wrapSheet(n),
      // getSheets is what lets simFillSheets_ find a sim sheet the curated list misses (the
      // 'EcoGainsSim_HC' vs 'EcoGainsSim' name split). Without it here the gate would pass on a
      // curated list that does not cover this workbook.
      getSheets: () => Object.keys(data).filter(k => !k.startsWith('_')).map(k => wrapSheet(k)),
    }),
  });

  eval(fillSrc);

  const cellVal = (sheet, r, c) => {
    const row = data[sheet].values[r - 1] || [];
    return row[c - 1] === undefined ? '' : row[c - 1];
  };
  const setF = (sheet, r, c, f) => { F(sheet)[r + ',' + c] = f; };
  const clearAll = () => {
    Object.keys(formulas).forEach(k => delete formulas[k]);
    Object.keys(props).forEach(k => delete props[k]);
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
    setF('EcoGainsSim', 7, 40, '=ECOGAINS_SIM($B$3, $A$5) + 1');

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
      F('EcoGainsSim')['7,40'] === '=ECOGAINS_SIM($B$3, $A$5) + 1');
    check('and it is named in the toast so the skip cannot pass for success',
      toasts.some(t => t.indexOf('LEFT AS FORMULAS') >= 0 && t.indexOf('R7C40') >= 0),
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
  {
    clearAll();
    const before = JSON.stringify(data['EcoGainsSim'].values);
    const n = fillAllSims();
    check('with no formula and no snapshot the fill writes NOTHING and says so',
      n === 0 && JSON.stringify(data['EcoGainsSim'].values) === before &&
      toasts.some(t => t.indexOf('Nothing to fill') >= 0));
    check('restore with no snapshot writes NOTHING and says so',
      restoreSimFormulas() === 0 &&
      toasts.some(t => t.indexOf('No fill snapshot found') >= 0));
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
