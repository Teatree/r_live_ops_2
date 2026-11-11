// D105 probe: Mighty Ice Cream on its own data (data_mic) - the local sim per payer and the MiC row per cell,
// on a dump whose calendars carry MiC. cal_parsed is rebuilt first, the way Precompute calendars does it.
//   node harness/_probe_mic_data.js [--data v3v] [--part 0.6]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3v');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
global.__PART = arg('--part', null);
const _log = console.log; global.__say = _log; console.log = () => {};
function PROBE(){
  const say = global.__say, MIC = 'Mighty Ice Cream';
  const rows = [['calendar', 'event', 'start', 'dur']];
  [CAL_CUR, CAL_NEW].forEach(cal => { const inst = parseCalendarLive_(cal);
    Object.keys(inst).forEach(ev => inst[ev].forEach(x => rows.push([cal, ev, x.start, x.dur]))); });
  data[CAL_PARSED_SHEET] = { values: rows, merges: [] };
  if (global.__PART != null){ const v = data['Mic_v2'].values, r = v.findIndex(x => String(x[0]).trim() === WAGER_SPECS[MIC].partLabel); v[r][1] = Number(global.__PART); }
  Context.reset();
  const ctx = Context.get();
  say('MiC festivals on cal_new: ' + (ctx.calNew[MIC] || []).map(x => x.start + '+' + x.dur).join(' ') +
      '; league size ' + wagerLeague_(MIC, 'Mic_v2') + '; table mode ' + (wagerTable_('Mic_v2', WAGER_SPECS[MIC]) || {}).mode);
  ['NONPAYER', 'PAYER'].forEach(p => {
    const ls = ECOGAINS_MIC(p, 0);
    say('\nlocal sim ' + p);
    ls.forEach(r => say('  ' + r.map(x => typeof x === 'number' ? (Math.abs(x) < 10 ? x.toFixed(3) : x.toFixed(1)) : String(x)).join(' | ')));
  });
  say('\nMiC row per cell (window): coins / SPT / value, with the old 0.3 / streak model for reference later');
  const prices = itemVals_();
  segMembers_(ctx.ds).concat(['ALL']).forEach(s => ['NONPAYER', 'PAYER'].forEach(p => {
    const r = resultRow_(MIC, s, p, ctx), m = measuredRow_(MIC, s, p, ctx.ds);
    say('  ' + (s + ' ' + p).padEnd(18) + ' coins ' + num(r.HC).toFixed(1).padStart(7) + '  SPT ' + num(r.SPT).toFixed(1).padStart(7) +
        '  value ' + micValue_(r).toFixed(1).padStart(8) + '  | TODAY coins ' + num(m.HC).toFixed(1));
  }));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
