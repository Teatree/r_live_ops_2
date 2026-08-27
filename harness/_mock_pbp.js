// Offline verification for EcoGainsSim_PBP.gs over _mockdata.json (regenerate with
// _dump_mockdata.py first). Loads EcoGainsSim_v4.gs (required) + EcoGainsSim_PBP.gs, runs the
// showcase scenario plus edge scenarios, and asserts the release-gate checks.
const fs = require('fs');
const path = require('path');
const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_mockdata.json'), 'utf8'));

function mkRange(sheetName, r1, c1, nr, nc) {
  const sh = data[sheetName];
  return {
    getValues: () => { const out = [];
      for (let r = r1; r < r1 + nr; r++) { const row = [];
        for (let c = c1; c < c1 + nc; c++) row.push((sh.values[r-1] && sh.values[r-1][c-1] !== undefined) ? sh.values[r-1][c-1] : '');
        out.push(row); } return out; },
    getMergedRanges: () => (sh.merges || [])
      .filter(m => m.r >= r1 && m.r + m.nr - 1 <= r1 + nr - 1 && m.c >= c1 && m.c + m.nc - 1 <= c1 + nc - 1)
      .map(m => ({ getRow: () => m.r, getColumn: () => m.c, getNumRows: () => m.nr, getNumColumns: () => m.nc })),
    getValue: () => { const row = sh.values[r1-1] || []; return row[c1-1] !== undefined ? row[c1-1] : ''; },
  };
}
function mkSheet(name) {
  const sh = data[name];
  if (!sh) return null;
  return {
    getDataRange: () => mkRange(name, 1, 1, sh.values.length, sh.values[0] ? sh.values[0].length : 0),
    getRange: (a, b, c, d) => {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d+)$/);
        const col = m[1].split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);
        return mkRange(name, +m[2], col, 1, 1);
      }
      return mkRange(name, a, b, c || 1, d || 1);
    },
  };
}
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: (n) => mkSheet(n) }) };

eval(fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8'));
eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail && !cond ? ' - ' + detail : ''));
  if (!cond) failures++;
};
const CLAIMS_COL = 6;
const sumRowIdx = (ledger) => ledger.findIndex(r => String(r[0]).startsWith('Session'));
const ledgerBody = (ledger) => {           // rows up to (excl.) the blank line before the summary
  const s = sumRowIdx(ledger);
  return ledger.slice(1, s - 1);
};
const eBlock = (ledger) => {               // E main row + its continuation rows
  const body = ledgerBody(ledger), out = [];
  let inE = false;
  for (const r of body) {
    if (r[0] === 'E') inE = true;
    else if (inE && r[0] !== '') break;
    if (inE) out.push(r);
  }
  return out;
};
const parseBundles = (ledger) => {         // sum every grant bundle in the Claims column
  const tot = {};
  for (const row of ledgerBody(ledger)) {
    const cell = String(row[CLAIMS_COL] || '');
    for (const m of cell.matchAll(/\{([^}]*)\}/g))
      for (const part of m[1].split(',')) {
        const kv = part.split(':');
        if (kv.length === 2) { const k = kv[0].trim(), v = parseFloat(kv[1]); if (!isNaN(v)) tot[k] = (tot[k] || 0) + v; }
      }
  }
  return tot;
};

// ---------- showcase scenario ----------
const args = ['cal_new', 5, '10-19', 'NONPAYER', 'Sampled', 'p50', 42];
const L = ECOGAINS_PBP(...args);
console.log('=== ledger cal_new day5 10-19 NONPAYER Sampled p50 seed42:', L.length, 'rows x', L[0].length, 'cols');
for (const r of L.slice(0, 16))
  console.log('  ', r.slice(0, 6).map(x => String(x).slice(0, 9)).join(' | '),
              '| C:', String(r[6]).slice(0, 58), '|', r.slice(7, 11).map(x => String(x).slice(0, 8)).join(' | '));
console.log('   ...');
for (const r of L.slice(sumRowIdx(L))) console.log('  ', r.slice(1, 8).map(x => String(x).slice(0, 14)).join(' | '));

check(`ledger rectangular ${11 + RESOURCES.length} cols (11 chrome + ${RESOURCES.length} resources)`,
  L.every(r => r.length === L[0].length) && L[0].length === 11 + RESOURCES.length);
const eIdx = L.findIndex(r => r[0] === 'E');
const playRows = ledgerBody(L).filter(r => typeof r[0] === 'number' || /^\d+$/.test(String(r[0])));
check('has S, N plays, E rows', L[1][0] === 'S' && eIdx > 10, 'eIdx=' + eIdx);
check('N from data_streaks (26)', playRows.length === 26, 'plays=' + playRows.length);

// one claim per row + no em dashes anywhere in any spill
const multiClaim = ledgerBody(L).filter(r => (String(r[CLAIMS_COL]).match(/\{/g) || []).length > 1);
check('one claim per ledger row', multiClaim.length === 0, JSON.stringify(multiClaim[0] || '').slice(0, 80));
const EV = ECOGAINS_PBP_EVENTS('cal_new', 5, '10-19', 'NONPAYER', 'p50');
const P = ECOGAINS_PBP_PROFILE('10-19', 'NONPAYER');
check('no em dashes in any spill', ![L, EV, P].some(t => JSON.stringify(t).indexOf('—') >= 0));

// determinism
const L2 = ECOGAINS_PBP(...args);
check('deterministic per seed', JSON.stringify(L) === JSON.stringify(L2));
const L3 = ECOGAINS_PBP('cal_new', 5, '10-19', 'NONPAYER', 'Sampled', 'p50', 43);
check('seed changes Sampled output', JSON.stringify(L) !== JSON.stringify(L3));
const E1 = ECOGAINS_PBP('cal_new', 5, '10-19', 'NONPAYER', 'Expected', 'p50', 1);
const E2 = ECOGAINS_PBP('cal_new', 5, '10-19', 'NONPAYER', 'Expected', 'p50', 999);
check('Expected mode seed-independent', JSON.stringify(E1) === JSON.stringify(E2));

// TOTAL row vs sum of ledger bundles
const totRow = L[L.length - 1];
const hdr = L[0];
// D19: the six pack tiers are ordinary ledger resources — present as columns, and payable if a
// ladder row this session grants one. (They read 0 until pack values are authored on the sheets.)
check('ledger carries the six pack columns',
  PACK_RES.every(r => hdr.indexOf(PBP_RES_DISPLAY[r] || r) >= 0),
  PACK_RES.map(r => `${r}@${hdr.indexOf(PBP_RES_DISPLAY[r] || r)}`).join(' '));
const bundles = parseBundles(L);
const DISP = { HC: 'Coins', 'UL Red': 'Unlimited Red', 'UL Chuck': 'Unlimited Chuck',
               'UL Bomb': 'Unlimited Bomb', SPTx2: 'SPT x2' };   // mirrors PBP_RES_DISPLAY
let totOK = true, totDetail = '';
RESOURCES.forEach((res, i) => {
  const shown = +totRow[2 + i] || 0, parsed = bundles[DISP[res] || res] || 0;
  if (Math.abs(shown - parsed) > 0.5) { totOK = false; totDetail += `${res}: ${shown} vs ${parsed}; `; }
});
check('TOTAL == sum of ledger bundles', totOK, totDetail);

// final inventory (last E-block row) == TOTAL (no opening inventory anymore)
const invStart = 11;   // Row,Play,Level,Win,Streak,Mult,Claims + 4 slots
const lastE = eBlock(L).slice(-1)[0];
let invOK = true, invDetail = '';
RESOURCES.forEach((res, i) => {
  const invE = +lastE[invStart + i] || 0, tot = +totRow[2 + i] || 0;
  if (Math.abs(invE - tot) > 0.01) { invOK = false; invDetail += `${res}: ${invE} vs ${tot}; `; }
});
check('final inventory == TOTAL', invOK, invDetail);

// events table: new 6-column shape
console.log('=== events table:');
for (const r of EV) console.log('  ', r.map(x => String(x).slice(0, 30)).join(' | '));
check('events table has 6 columns (Family/Inst/Event day removed)',
      EV[0].length === 6 && EV[0][0] === 'Event' && EV[0][1] === 'Ends today?' && EV[0][3] === 'Accrual today');

// score calibration: TaD cum at E == events-table target (scaling exact when wins > 0)
const tadSlot = hdr.indexOf('Target Day score');
const tadTarget = +String(EV.find(r => r[0] === 'Target Day')[3]).replace('target +', '');
check('TaD day score == measured target', tadSlot > 0 && Math.abs(L[eIdx][tadSlot] - tadTarget) < tadTarget * 0.02 + 2,
      `cum=${L[eIdx][tadSlot]} target=${tadTarget}`);

// day-end LB claims (each on its own row inside the E block)
const eClaims = eBlock(L).map(r => String(r[CLAIMS_COL])).join(' || ');
check('Kite E claim = below ladder', /Kite Festival.*(below ladder|pays nothing)/.test(eClaims), eClaims);
// Refreshed 2026-08-03: the Race sheet was regenerated from the live server config on
// 2026-07-10, so the Flash Race ladder pays Coins 10 + SPT 50 at rank 3 (it used to pay Coins 50).
// Assert against the LADDER, not a baked number, so a future config change can't rot this again.
{
  const want = pbpLbLadder_(PBP_EVENTS['Flash Race']);
  const m = /Flash Race[^|]*rank (\d+) -> \{([^}]*)\}/.exec(eClaims);
  const rank = m ? +m[1] : -1;
  const paid = m ? m[2] : '';
  const expect = want[rank] || {};
  // the claim string renders DISPLAY names (HC -> 'Coins', SPTx2 -> 'SPT x2')
  const shown = (k) => PBP_RES_DISPLAY[k] || k;
  const ok = m && Object.keys(expect).length > 0 &&
             Object.entries(expect).every(([k, v]) => paid.includes(`${shown(k)}: ${v}`));
  check('Flash Race E claim matches the Race_v2 ladder at the reached rank', ok,
        `rank ${rank} paid {${paid}} vs ladder ${JSON.stringify(expect)}`);
}

// Jigsaw: Completion Bonus tiers - every play-row delta is 0 (loss) or a tier point (win)
const jigSlot = hdr.indexOf('Jigsaw tokens');
const jigStart = +L[1][jigSlot];
let prev = jigStart, tierOK = true, tierDetail = '';
for (const r of playRows) {
  const cur = +r[jigSlot], d = Math.round((cur - prev) * 10) / 10;
  if (![0, 3, 5, 7, 10].includes(d)) { tierOK = false; tierDetail += `play ${r[0]}: +${d}; `; }
  if (r[3] === 'LOSS' && d !== 0) { tierOK = false; tierDetail += `loss earned ${d}; `; }
  prev = cur;
}
check('Jigsaw deltas are tier points 3/5/7/10 (0 on loss)', tierOK, tierDetail);
check('Jigsaw events accrual = tier text', /\+3\/5\/7\/10 per win/.test(String(EV.find(r => r[0] === 'Jigsaw')[3])));

// milestone-crossing consistency: Jigsaw claims iff cum crossed a req
const jigEnd = +L[eIdx][jigSlot];
const jigReqs = [30, 80, 150, 250, 370, 520, 690, 890, 1110, 1360, 1630, 1930];
const expected = jigReqs.filter(q => q > jigStart && q <= jigEnd).length;
const jigGrants = ledgerBody(L).filter(r => /Jigsaw m\d+/.test(String(r[CLAIMS_COL]))).length;
check('Jigsaw crossings == claims', expected === jigGrants, `expected ${expected} (${jigStart}->${jigEnd}), got ${jigGrants}`);

// Daily Gift: single concrete variant, integral bundle, always claimed
const sBlock = [L[1]]; for (let i = 2; i < L.length && L[i][0] === ''; i++) sBlock.push(L[i]);
const giftRow = sBlock.map(r => String(r[CLAIMS_COL])).find(c => c.startsWith('Daily Gift'));
check('Daily Gift claimed at S with a variant tag', !!giftRow && /variant \d/.test(giftRow), giftRow);
const giftNums = [...(giftRow || '').matchAll(/: ([\d.]+)/g)].map(m => +m[1]);
check('Daily Gift bundle is integral (no averaged fractions)', giftNums.length > 0 && giftNums.every(x => x === Math.round(x)), giftRow);

// starting level: random draw lands in [100,400] and shows on the S row; explicit value honored
const EX = ECOGAINS_PBP('cal_new', 5, '10-19', 'NONPAYER', 'Expected', 'p50', 1);
const exStart = +EX[1][2];
check('random start level in [100,400]', exStart >= 100 && exStart <= 400, 'start=' + exStart);
const exFirstPlay = ledgerBody(EX).find(r => r[0] === 1 || String(r[0]) === '1');
check('first play attempts the start level', +exFirstPlay[2] === exStart, `${exFirstPlay[2]} vs ${exStart}`);
const EXF = ECOGAINS_PBP('cal_new', 5, '10-19', 'NONPAYER', 'Expected', 'p50', 1, 0, 250);
check('explicit start level honored', +EXF[1][2] === 250, 'got ' + EXF[1][2]);

// Saga: FULL node bundles (c_saga_v2 pays boosters/UL on every node, HC only on odd + node 10),
// anchored to ABSOLUTE level: a claim on every win completing a x10 level
const exPlayRows = ledgerBody(EX).filter(r => typeof r[0] === 'number' || /^\d+$/.test(String(r[0])));
const exWins = exPlayRows.filter(r => r[3] === 'WIN').length;
const expSaga = [];
for (let lv = exStart; lv < exStart + exWins; lv++) if (lv % 10 === 0) expSaga.push(lv);
const sagaClaims = ledgerBody(EX).filter(r => /Saga node/.test(String(r[CLAIMS_COL])));
check('Saga claims == x10 boundaries crossed (all nodes pay)', sagaClaims.length === expSaga.length,
      `expected ${expSaga.length} (${expSaga}), got ${sagaClaims.length}`);
const NODE_HC = [10, 0, 10, 0, 10, 0, 10, 0, 10, 25];
const sagaAligned = sagaClaims.every(r => {
  const m = String(r[CLAIMS_COL]).match(/Saga node (\d+) at level (\d+)/);
  if (!m) return false;
  const lvl = +m[2], node = +m[1];
  const hasHC = /Coins: \d/.test(String(r[CLAIMS_COL]));
  const hasUL = /Unlimited Lives: \d/.test(String(r[CLAIMS_COL]));
  return lvl % 10 === 0 && node === Math.floor(((lvl - 1) % 100) / 10) + 1 &&
         hasUL && (hasHC === (NODE_HC[node - 1] > 0));
});
check('Saga bundles: UL on every node, HC only on paying nodes', sagaClaims.length === 0 || sagaAligned);

// profile block: 7 rows (claim rate removed, p(active) behind flag), each with a note
console.log('=== profile:');
for (const r of P) console.log('  ', r.map(x => String(x).slice(0, 60)).join(' | '));
check('profile spills 7 rows with notes', P.length === 7 && P[0][0] === 'Attempts / active day' &&
      P.every(r => String(r[2]).length > 10));

// mechanical accruals on days HH / BB / Photoshoot run (from cal_parsed)
const cp = data.cal_parsed.values;
const dayOf = (label) => cp.slice(1).filter(r => r[0] === 'cal_new' && r[1] === label).map(r => +r[2])[0];
const hhDay = dayOf('Hatchling Hideaway');
if (hhDay) {
  const EVH = ECOGAINS_PBP_EVENTS('cal_new', hhDay, '10-19', 'NONPAYER', 'p50');
  const row = EVH.find(r => r[0] === 'Hatchling Hideaway');
  check(`HH accrual is flat 1.5/win (day ${hhDay})`, !!row && String(row[3]) === '+1.5 / win', row && row[3]);
}
const bbDay = dayOf("Bomb's Ballet Show");
if (bbDay) {
  const EVB = ECOGAINS_PBP_EVENTS('cal_new', bbDay, '10-19', 'NONPAYER', 'p50');
  const row = EVB.find(r => r[0] === "Bomb's Ballet");
  check(`BB accrual is +5 / first-try win (day ${bbDay})`, !!row && String(row[3]) === '+5 / first-try win', row && row[3]);
}
const phDay = dayOf('Photoshoot');
if (phDay) {
  const EVP = ECOGAINS_PBP_EVENTS('cal_new', phDay, '10-19', 'NONPAYER', 'p50');
  const row = EVP.find(r => r[0] === 'Photoshoot');
  check(`Photoshoot accrual is streak x-mult calibrated (day ${phDay})`, !!row && /^streak x-mult, target \+\d+/.test(String(row[3])), row && row[3]);
}

// FF join grant on a day Flock Flurry runs
const ffDay = dayOf('Flock Flurry');
if (ffDay) {
  const LF = ECOGAINS_PBP('cal_new', ffDay, '10-19', 'NONPAYER', 'Expected', 'p50', 1);
  const sB = [LF[1]]; for (let i = 2; i < LF.length && LF[i][0] === ''; i++) sB.push(LF[i]);
  const sClaims = sB.map(r => String(r[CLAIMS_COL])).join(' || ');
  check(`FF join grant on day ${ffDay}`, /Flock Flurry.*Unlimited Lives: 60/.test(sClaims), sClaims);
}

// ---------- Night Sky re-wire (NIGHT_SKY_REWIRE_PLAN §4.3 / §5 + NS_SIMULATE switch) ----------
const nsClaimRows = (ledger) => ledgerBody(ledger).filter(r => /Daily Night Sky Prize m\d+/.test(String(r[CLAIMS_COL])));
// Gate the SWITCH, not the shipped value (NS_SIMULATE flipped to true in D21 so NS packs flow):
// force the flag OFF and assert the ledger carries no NS claims.
const nsSrc = (on) => fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8')
  .replace(/var NS_SIMULATE = (?:true|false)/, 'var NS_SIMULATE = ' + (on ? 'true' : 'false'));
eval(nsSrc(false));
eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));
check('NS_SIMULATE OFF -> no NS claims in the ledger',
      NS_SIMULATE === false && nsClaimRows(ECOGAINS_PBP(...args)).length === 0);
// flip the switch on (re-eval v4 + PBP with fresh caches) and check the model itself
eval(nsSrc(true));
eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));
const LNS = ECOGAINS_PBP(...args);   // showcase scenario re-run with NS on
// Expected mode: EVERY milestone cleared by p50 x N pays, nothing else - incl. 0-9 (which the
// old exact-match handler silently zeroed). expect == 0 is a legitimate outcome (workbook (8)
// telemetry: 100+ p50 62 x 1.25 = 77.5 sits just under its first req 80), so agreement is asserted
// per segment and the "ladder read is sane" condition aggregated across segments instead.
let nsExpectTotal = 0;
for (const seg of ['0-9', '10-19', '100+']) {
  const stq = PBPData.streaks(seg, 'NONPAYER');
  const eff = num(stq.max_streak_per_day_p50) * NS_STREAK_N;
  const expect = readNSLadder_(seg, NS_V2_SHEET).filter(ms => ms.req <= eff + 1e-9).length;
  const LX = ECOGAINS_PBP('cal_new', 5, seg, 'NONPAYER', 'Expected', 'p50', 1);
  const got = nsClaimRows(LX).length;
  nsExpectTotal += expect;
  check(`NS Expected ${seg}: pays all reached milestones, none unreached (${expect})`,
        got === expect, `eff=${eff} expect=${expect} got=${got}`);
}
check('NS Expected: some segment reaches a milestone (ladder/streak read sane)', nsExpectTotal > 0,
      'total reached across segments=' + nsExpectTotal);
// Sampled mode: claims == milestones cleared by the trace's best win run x N (honest gate)
{
  const pr = ledgerBody(LNS).filter(r => typeof r[0] === 'number' || /^\d+$/.test(String(r[0])));
  const best = Math.max(...pr.map(r => +r[4] || 0));
  const expect = readNSLadder_('10-19', NS_V2_SHEET).filter(ms => ms.req <= best * NS_STREAK_N + 1e-9).length;
  check('NS Sampled: claims == milestones cleared by best run x N', nsClaimRows(LNS).length === expect,
        `best=${best} expect=${expect} got=${nsClaimRows(LNS).length}`);
}
// reconciliation: seed-averaged Sampled NS HC ~ the 33-day sim's per-active-day E_day
{
  const stq = Context.get().ds.nsStreak('10-19', 'NONPAYER');
  const S = survival_([[stq.p25 * NS_STREAK_N, .25], [stq.p50 * NS_STREAK_N, .5],
                       [stq.p75 * NS_STREAK_N, .75], [stq.p90 * NS_STREAK_N, .9]]);
  let eDay = 0;
  readNSLadder_('10-19', NS_V2_SHEET).forEach(ms => { eDay += (ms.rew.HC || 0) * S(ms.req); });
  let acc = 0; const M = 60;
  for (let sd = 1; sd <= M; sd++) {
    const LX = ECOGAINS_PBP('cal_new', 5, '10-19', 'NONPAYER', 'Sampled', 'p50', sd);
    for (const r of nsClaimRows(LX)) {
      const m = String(r[CLAIMS_COL]).match(/Coins: ([\d.]+)/);
      if (m) acc += +m[1];
    }
  }
  const avg = acc / M;
  console.log(`NS reconciliation: seed-avg HC/night ${avg.toFixed(2)} vs window E_day ${eDay.toFixed(2)} (${M} seeds)`);
  check('NS Sampled seed-average ~ 33-day E_day (within x0.5..x2)', avg > eDay * 0.5 && avg < eDay * 2,
        `avg=${avg.toFixed(2)} eDay=${eDay.toFixed(2)}`);
}
// D22: the ledger reads NS on cal_curr and NS_v2 on cal_new (exception to note 9), so an edit to
// NS_v2 must move the cal_new ledger and leave the cal_curr one untouched. Mutated in-memory and
// restored; expectations recomputed, nothing hardcoded.
{
  const nsHCsum = (cal) => nsClaimRows(ECOGAINS_PBP(cal, 5, '10-19', 'NONPAYER', 'Expected', 'p50', 1))
    .reduce((s, r) => { const m = String(r[CLAIMS_COL]).match(/Coins: ([\d.]+)/); return s + (m ? +m[1] : 0); }, 0);
  const v = data['NS_v2'].values;
  let hdr = -1, rows = [];
  for (let r = 0; r < v.length; r++) {
    if (String(v[r][0]).trim() !== '10-19') continue;
    hdr = r + 1;
    for (let k = hdr + 1; k < v.length && String(v[k][0]).trim() !== ''; k++) rows.push(k);
    break;
  }
  const hcCol = (v[hdr] || []).findIndex(x => String(x).trim() === 'HC Reward');
  const beforeNew = nsHCsum('cal_new'), beforeCur = nsHCsum('cal_curr');
  const saved = rows.map(r => v[r][hcCol]);
  rows.forEach(r => { v[r][hcCol] = (+v[r][hcCol] || 0) * 3; });
  _sheetValsCache = {};
  const afterNew = nsHCsum('cal_new'), afterCur = nsHCsum('cal_curr');
  rows.forEach((r, i) => { v[r][hcCol] = saved[i]; });
  _sheetValsCache = {};
  check('NS_v2 HC x3 -> cal_new ledger NS claims x3 (cal_new reads NS_v2)',
        beforeNew > 0 && Math.abs(afterNew - 3 * beforeNew) < 1e-6, `${beforeNew} -> ${afterNew}`);
  check('NS_v2 HC x3 -> cal_curr ledger NS claims unchanged (cal_curr reads NS)',
        Math.abs(afterCur - beforeCur) < 1e-9, `${beforeCur} -> ${afterCur}`);
  check('NS_v2 == NS today -> both calendars claim the same NS rewards',
        Math.abs(beforeNew - beforeCur) < 1e-9, `${beforeNew} vs ${beforeCur}`);
}

// D23: on cal_new the ledger also picks the ladder by DAY TYPE — 'NS_v2' on Fri/Sat/Sun and
// 'NS_v2_weekday' on the other days. Zero the weekday ladder's HC and the cal_new ledger must pay
// NS coins on weekend days only, while cal_curr (one live Night Sky) is untouched.
{
  const nsHCday = (cal, day) =>
    nsClaimRows(ECOGAINS_PBP(cal, day, '10-19', 'NONPAYER', 'Expected', 'p50', 1))
      .reduce((s, r) => { const m = String(r[CLAIMS_COL]).match(/Coins: ([\d.]+)/); return s + (m ? +m[1] : 0); }, 0);
  const WD = 1, WE = 3;                                  // day 1 = Wednesday, day 3 = Friday
  const saved = data['NS_v2_weekday'] ? JSON.parse(JSON.stringify(data['NS_v2_weekday'])) : null;
  const cl = JSON.parse(JSON.stringify(data['NS_v2']));
  for (let r = 0; r < cl.values.length; r++) {
    const hc = (cl.values[r] || []).indexOf('HC Reward');
    if (hc === -1) continue;
    for (let k = r + 1; k < cl.values.length && String((cl.values[k] || [])[0]).trim() !== ''; k++)
      cl.values[k][hc] = 0;
  }
  const beforeWd = nsHCday('cal_new', WD), beforeWe = nsHCday('cal_new', WE);
  const beforeCurWd = nsHCday('cal_curr', WD);
  data['NS_v2_weekday'] = cl;
  _sheetValsCache = {};
  const afterWd = nsHCday('cal_new', WD), afterWe = nsHCday('cal_new', WE);
  const afterCurWd = nsHCday('cal_curr', WD);
  if (saved) data['NS_v2_weekday'] = saved; else delete data['NS_v2_weekday'];
  _sheetValsCache = {};
  check('NS_v2_weekday HC = 0 -> cal_new WEEKDAY ledger pays no NS coins',
        beforeWd > 0 && Math.abs(afterWd) < 1e-9, `day ${WD}: ${beforeWd} -> ${afterWd}`);
  check('NS_v2_weekday HC = 0 -> cal_new WEEKEND ledger unchanged (still reads NS_v2)',
        beforeWe > 0 && Math.abs(afterWe - beforeWe) < 1e-9, `day ${WE}: ${beforeWe} -> ${afterWe}`);
  check('NS_v2_weekday HC = 0 -> cal_curr ledger unchanged (one live Night Sky)',
        Math.abs(afterCurWd - beforeCurWd) < 1e-9, `${beforeCurWd} -> ${afterCurWd}`);
  check('NS day-type mutation restored (baseline reproduces)',
        Math.abs(nsHCday('cal_new', WD) - beforeWd) < 1e-9);
}

// back to the shipped defaults for the smoke tests
eval(fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8'));
eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));

// heavy segment + cal_curr smoke tests
const LH = ECOGAINS_PBP('cal_new', 5, '100+', 'NONPAYER', 'Sampled', 'p75', 7);
check('100+ runs (N~147)', LH.length > 140 && LH.every(r => r.length === LH[0].length), 'rows=' + LH.length);
const LC = ECOGAINS_PBP('cal_curr', 5, '0-9', 'PAYER', 'Sampled', 'p25', 3);
check('cal_curr 0-9 PAYER runs', LC.length > 10 && !String(LC[0][0]).includes('error'), String(LC[0][0]).slice(0, 60));

console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
