// Print a patched ladder side by side (old -> new) for review. node harness/_calbal_show.js SHEET r0 r1 [c0 c1]
const fs = require('fs'), path = require('path');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '_mockdata_v3h.json'), 'utf8'));
const P = JSON.parse(fs.readFileSync(path.join(path.dirname(__dirname), 'analysis/out/calbal_patches.json'), 'utf8'));
const [sh, r0, r1, c0, c1] = [process.argv[2], +process.argv[3], +process.argv[4], +(process.argv[5] || 1), +(process.argv[6] || 26)];
const colL = (c) => { let s = ''; c++; while (c > 0){ const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; };
const pat = {}; (P.patches[sh] || []).forEach(p => { pat[p.cell] = p.new; });
const v = D[sh].values;
const hdr = v.findIndex((r, i) => i < r0 - 1 && r && r.filter(x => String(x).trim()).length > 8 && i >= r0 - 4);
const H = v[r0 - 2] || [];
for (let r = r0; r <= r1; r++){
  const row = v[r - 1] || [], parts = [];
  for (let c = c0 - 1; c < c1; c++){
    const cell = colL(c) + r, o = row[c] === undefined ? '' : row[c], n = (cell in pat) ? pat[cell] : o;
    if (String(o) === '' && String(n) === '') continue;
    if (String(o) === '0' && String(n) === '0') continue;
    const name = String(H[c] || colL(c)).replace(' Dly', '').replace('Unlimited ', 'U.').slice(0, 10);
    parts.push(name + ' ' + (String(o) === String(n) ? o : o + '>' + (n === '' ? '(clear)' : n)));
  }
  console.log(String(r).padStart(3) + '  ' + parts.join(' | '));
}
