// D109 gates: the card sim reads its inflow at the MODEL level on both sides, so a redesign that changes nothing gives
// Col - Sets / Col - Albums a DIFF of 0 even where data_gains carries envelope rows (the export anchoring, D82, used to
// put the redesign side on the export's level while the measured side stayed on the model's: 0-9 NONPAYER Daily Gift
// envelopes 0.33 vs 1.66 per season, Col - Sets 18.5 -> 42 coins on identical calendars and configs).
//   node harness/_mock_col_model_level.js [--data v3z2] [--cells "0-9 NONPAYER,20-39 PAYER"]
// Fixture: cal_new := cal_curr and every X_v2 := X (the card sheets included), so nothing is redesigned.
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3z2');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
let PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const di = process.argv.indexOf('--engine-dir');
if (di >= 0){
  const ed = path.resolve(process.argv[di + 1]);
  PRELUDE = PRELUDE.replace("const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);", 'const ENGINE = (f) => path.join(' + JSON.stringify(ed) + ', f);');
}
const _log = console.log; global.__say = _log; console.log = () => {};

function GATES(){
  const say = global.__say;
  let pass = 0, fail = 0;
  const gate = (name, ok, detail) => { ok ? pass++ : fail++; say((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };
  const fresh = () => { resetSheetCache_mock(); _sheetValsCache = {}; Context.reset(); return Context.get(); };
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const cells = arg('--cells', '0-9 NONPAYER,20-39 PAYER').split(',').map(x => x.trim().split(/\s+/));
  say('data: ' + (data._meta ? data._meta.source : '?') + '   engine ' + ENGINE_BUILD);
  // the fixture: nothing redesigned
  data['cal_new'] = JSON.parse(JSON.stringify(data['cal_curr']));
  delete data['cal_parsed'];
  let n = 0;
  Object.keys(data).forEach(k => { const m = /^(.*)_v2$/.exec(k); if (m && data[m[1]]){ data[k] = JSON.parse(JSON.stringify(data[m[1]])); n++; } });
  delete data['album_gains'];                                // the batch, not a saved album run
  say('fixture: cal_new := cal_curr, ' + n + ' _v2 sheets := their base');
  const run = () => {
    const c = fresh(), out = [];
    cells.forEach(([s, p]) => {
      const a = colSimSeasons_(s, p, c, 'cur'), b = colSimSeasons_(s, p, c, 'new');
      out.push({ s, p, cs: num(a && a.sets.HC), ns: num(b && b.sets.HC), ca: num(a && a.albums.HC), na: num(b && b.albums.HC) });
    });
    return out;
  };
  const exportHasEnvelopes = cells.some(([s, p]) => { const r = measuredRowCore_('Daily Gift', s, p, fresh().ds); return PACK_RES.some(t => num(r[t]) > 0); });
  say('data_gains carries envelope rows (Daily Gift) for these cells: ' + exportHasEnvelopes);
  const on = run();
  const fmt = (x) => x.s + ' ' + x.p + ' sets ' + x.cs.toFixed(1) + '->' + x.ns.toFixed(1) + ' albums ' + x.ca.toFixed(1) + '->' + x.na.toFixed(1);
  gate('M1: nothing redesigned -> Col - Sets and Col - Albums identical on both sides (model-level inflow, D109)',
    on.every(x => Math.abs(x.cs - x.ns) < 1e-9 && Math.abs(x.ca - x.na) < 1e-9), on.map(fmt).join(' | '));
  CARD_MODEL_LEVEL = false;
  const off = run();
  CARD_MODEL_LEVEL = true;
  gate('M2: CARD_MODEL_LEVEL = false (the export-anchored redesign side) does NOT give that on an export with envelope rows - the gate can fail',
    !exportHasEnvelopes || off.some(x => Math.abs(x.cs - x.ns) > 1e-9 || Math.abs(x.ca - x.na) > 1e-9), off.map(fmt).join(' | '));
  {
    // M3: the flag is scoped - outside the card sim, the gains model's envelope rows stay export-anchored
    const c = fresh(), [s, p] = cells[0];
    const r1 = resultRow_('Daily Gift', s, p, c);
    cardSeasonPre_(s, p, c);
    const r2 = resultRow_('Daily Gift', s, p, fresh());
    gate('M3: after a card-sim read the gains model\'s Daily Gift envelopes are still the export-anchored ones (the flag does not leak)',
      !_cardModelLevel && PACK_RES.every(t => Math.abs(num(r1[t]) - num(r2[t])) < 1e-12), PACK_RES.map(t => num(r2[t]).toFixed(3)).join(' '));
  }
  say('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
