// One-off check for withNonce_ in EcoGainsSim_v4.gs (run: node harness/_nonce_test.js)
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "engine", "EcoGainsSim_v4.gs"), "utf8");
const m = src.match(/var SIM_NONCE_SHEET[\s\S]*?\nfunction withNonce_[\s\S]*?\n}\n/);
eval(m[0]);
const cases = [
  ['=LET(payer,$C$3, segment,$C$4, source,$C$5, ECOGAINS_DAILY(payer, segment, source, "CURRENT"))',
   '=LET(payer,$C$3, segment,$C$4, source,$C$5, ECOGAINS_DAILY(payer, segment, source, "CURRENT", sim_refresh!$A$1))'],
  ['=ECOGAINS_CAL_COUNTS()', '=ECOGAINS_CAL_COUNTS(sim_refresh!$A$1)'],
  ['=LET(payer, $C$3, segment, $B$6, ECOGAINS_SIM(payer, segment))',
   '=LET(payer, $C$3, segment, $B$6, ECOGAINS_SIM(payer, segment, sim_refresh!$A$1))'],
  ['=ECOGAINS_CAL_COUNTS(sim_refresh!$A$1)', '=ECOGAINS_CAL_COUNTS(sim_refresh!$A$1)'],   // already nonced
  ['=ECOGAINS_CAL_COUNTS(#REF!$A$1)', '=ECOGAINS_CAL_COUNTS(sim_refresh!$A$1)'],           // deleted-sheet repair
  ['=ECOGAINS_DAILY(A1, "a)b(", C1)', '=ECOGAINS_DAILY(A1, "a)b(", C1, sim_refresh!$A$1)'], // parens in quotes
  ['=SUM(A1:B2)', '=SUM(A1:B2)'],                                                          // non-sim untouched
];
let fail = 0;
for (const [inp, want] of cases) {
  const got = withNonce_(inp);
  if (got !== want) { fail++; console.log("FAIL\n  in:   " + inp + "\n  got:  " + got + "\n  want: " + want); }
}
console.log(fail ? fail + " failures" : "all " + cases.length + " withNonce_ cases pass");
