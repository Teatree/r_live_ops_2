// Envelope TIER mix per (segment, payer) - which tiers each engagement level actually receives.
const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const N=60, SEED=20260910;
  const cfg=loadPackConfig_();
  const cat=loadCardCatalog_(cfg, SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AlbumConfig'));
  const ctx=Context.get();
  const tiers=[1,2,3,4,5,6];
  console.log('');
  console.log('envelopes per season by TIER (mean per player)   [Cards/Open: '+
    tiers.map(t=>t+'*='+(cfg.cardsPerOpen[t+'-star Pack']||0)).join(' ')+']');
  console.log('cell                 1*    2*    3*    4*    5*    6*   TOT  cards');
  const rowsOut=[];
  cloudPermutations_().forEach((p,pi)=>{
    const pre=cardSeasonPre_(p.seg,p.payer,ctx);
    const by={},tot={cards:0,packs:0};
    for(let k=0;k<N;k++){
      const r=runOneCardSeason_(p.seg,p.payer,playerSeed_(SEED,pi,k),cfg,cat,pre);
      tiers.forEach(t=>by[t]=(by[t]||0)+num(r.packsOpenedByTier[t]));
      tot.cards+=r.totalCardsDrawn; tot.packs+=r.packsOpenedTotal;
    }
    const line=p.label.padEnd(17)+tiers.map(t=>(by[t]/N).toFixed(1).padStart(6)).join('')+
               (tot.packs/N).toFixed(1).padStart(6)+(tot.cards/N).toFixed(0).padStart(7);
    console.log(line);
    rowsOut.push([p.label, tiers.map(t=>by[t]/N)]);
  });
  // The ratio that decides whether a tier is a PROGRESSIVE lever: how much more of it the top
  // cell gets than the bottom one. A tier whose ratio is ~1 pays engagement nothing.
  const lo=rowsOut[0][1], hi=rowsOut[rowsOut.length-1][1];
  console.log('');
  console.log('100+ PAYER / 0-9 NONPAYER, per tier:  '+
    tiers.map((t,i)=>t+'*='+(lo[i]>0.01?(hi[i]/lo[i]).toFixed(2):'n/a')+'x').join('  '));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
