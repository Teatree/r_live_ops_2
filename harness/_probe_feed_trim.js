// WHAT TRIMMING data_econ_daily_by_source COSTS (2026-11-06) - evidence, asserts nothing.
//
// The only reader of the feed is Compute export scale (exportScaleGrid_), which pools it over cells into
// the small export_scale table: granted amount per (source, resource, window day). This probe rebuilds
// that table from trimmed versions of the feed and compares every number the engine takes from it - the
// per-event scale of each (source, resource, cell) - with the full feed's.
//
//   node harness/_probe_feed_trim.js [--data v3q]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3q');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function PROBE(){
  Logger.log = function(){};
  const FEED = EXPORT_SCALE_FEED, full = data[FEED].values;
  const h = full[0].map(String), ix = (k) => h.indexOf(k);
  const used = ['source', 'currency', 'calendar_date', 'day_index', 'gain_total', 'recipients_day'].filter(k => ix(k) >= 0);
  const width = (v) => v.reduce((m, r) => Math.max(m, (r || []).length), 0);
  const realCols = h.filter(x => x.trim()).length;

  // every scale the engine would use, from a given feed
  const scales = (v) => {
    data[FEED] = { values: v, merges: [] };
    delete data[EXPORT_SCALE_SHEET];
    resetSheetCache_mock(); Context.reset();
    const g = exportScaleGrid_(Context.get());
    if (!g) return null;
    data[EXPORT_SCALE_SHEET] = { values: g, merges: [] };
    resetSheetCache_mock(); Context.reset();
    const ctx = Context.get(), tab = exportScaleTab_(), out = {}, cells = [];
    segMembers_(ctx.ds).concat(['ALL']).forEach(s => ['NONPAYER', 'PAYER'].forEach(p => cells.push([s, p])));
    Object.keys(EXPORT_SCALE_FAMILY).forEach(cat => {
      ((tab && tab.src[cat]) ? Object.keys(tab.src[cat].res) : []).forEach(res => {
        const chk = exportScaleCheck_(cat, res, ctx);
        cells.forEach(c => {
          let e = null; try { e = chk.ok ? spanScaleEvent_(cat, c[0], c[1], res, ctx) : null; } catch (err){ e = null; }
          out[cat + ' | ' + res + ' | ' + c.join(' ')] = (e == null) ? 'activity' : e;
        });
      });
    });
    return { out: out, tableRows: g.length - 4 };
  };
  const cmp = (a, b) => {
    let n = 0, flips = 0, worst = 0, at = '';
    Object.keys(a.out).forEach(k => {
      const x = a.out[k], y = (k in b.out) ? b.out[k] : 'missing';
      if (typeof x === 'number'){ n++; if (typeof y !== 'number'){ flips++; return; } const d = Math.abs(y / x - 1); if (d > worst){ worst = d; at = k + ': x' + x.toFixed(3) + ' -> x' + y.toFixed(3); } }
      else if (x !== y) flips++;
    });
    return { n: n, flips: flips, worst: worst, at: at };
  };

  const base = scales(full);
  const perEvent = Object.keys(base.out).filter(k => typeof base.out[k] === 'number').length;
  console.log(FEED + ': ' + (full.length - 1).toLocaleString() + ' rows x ' + width(full) + ' columns = ' + ((full.length) * width(full)).toLocaleString() +
              ' cells (' + realCols + ' columns have a header)');
  console.log('columns the engine reads: ' + used.join(', '));
  console.log('per-event scales on the full feed: ' + perEvent + ' of ' + Object.keys(base.out).length + ' (source x resource x cell); pooled table: ' + base.tableRows + ' rows\n');

  const keep = (pred) => [full[0]].concat(full.slice(1).filter(pred));
  const cols = (v, names) => { const id = names.map(ix); return v.map(r => id.map(i => r[i])); };
  const fam = EXPORT_SCALE_FAMILY, S = ix('source'), G = ix('gain_total'), SEG = ix('segment');
  // the lossless pool: one row per source x currency x date
  const pooled = () => {
    const m = {}, order = [];
    for (let i = 1; i < full.length; i++){
      const r = full[i]; if (!r[S] || String(r[S]).trim() === 'ALL') continue;
      const k = r[S] + '|' + r[ix('currency')] + '|' + r[ix('calendar_date')];
      if (!m[k]){ m[k] = [r[S], r[ix('currency')], r[ix('calendar_date')], 0, 0]; order.push(k); }
      m[k][3] += num(r[G]); m[k][4] += num(r[ix('recipients_day')]);
    }
    return [['source', 'currency', 'calendar_date', 'gain_total', 'recipients_day']].concat(order.map(k => m[k]));
  };
  const variants = [
    ['A  drop the columns the engine does not read',        cols(full, used)],
    ['B  A + drop the rows that granted nothing',           cols(keep(r => num(r[G]) > 0), used)],
    ['C  B + only the sources that get a per-event scale',  cols(keep(r => num(r[G]) > 0 && fam[String(r[S]).trim()]), used)],
    ['D  one row per source x currency x date (pooled)',    pooled()],
    ['E  the segment ALL rows only (all columns)',          keep(r => String(r[SEG]).trim() === 'ALL')],
    ['F  drop the segment ALL rows (all columns)',          keep(r => String(r[SEG]).trim() !== 'ALL')],
    ['G  every second day dropped (all columns)',           keep(r => Math.round(num(r[ix('day_index')])) % 2 === 1)],
  ];
  console.log('variant                                               rows     cells   of full   scales changed   lost per-event   largest change');
  variants.forEach(x => {
    const v = x[1], r = scales(v), c = r ? cmp(base, r) : null, cells = v.length * width(v);
    console.log(x[0].padEnd(52) + String(v.length - 1).padStart(6) + cells.toLocaleString().padStart(10) + (100 * cells / (full.length * width(full))).toFixed(1).padStart(8) + '%   ' +
      (!r ? 'NO TABLE (the feed is unusable)' :
       String(Object.keys(base.out).filter(k => typeof base.out[k] === 'number' && typeof r.out[k] === 'number' && Math.abs(r.out[k] / base.out[k] - 1) > 1e-9).length).padStart(8) +
       String(c.flips).padStart(17) + '   ' + (c.worst > 1e-9 ? (100 * c.worst).toFixed(2) + '%  (' + c.at + ')' : 'none')));
  });
  data[FEED] = { values: full, merges: [] };
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
