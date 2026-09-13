// What the CURRENT engine reads out of an 11-row SEGMENT BEHAVIOUR block.
const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const cfg=tofConfig_();
  console.log('\ncfg.beh keys the engine built:', Object.keys(cfg.beh).join(', '));
  console.log('\nkey        take-up  cash-out  runs/day   <- which SHEET ROW won');
  Object.keys(cfg.beh).forEach(k=>{
    const b=cfg.beh[k];
    console.log(k.padEnd(11)+String(b.continueP).padStart(8)+String(b.cashOut).padStart(10)+
                String(b.runsPerDay).padStart(10));
  });
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
