// Which SOURCE pays which TIER, for the bottom and the top cell. The actionable view: a tier is
// only a lever if you can name the ladder rows that pay it.
const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const N=60, SEED=20260910;
  const cfg=loadPackConfig_();
  const cat=loadCardCatalog_(cfg, SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AlbumConfig'));
  const ctx=Context.get();
  const cells=[['0-9','NONPAYER'],['40-99','PAYER'],['100+','PAYER']];
  const tiers=['1-star Pack','2-star Pack','3-star Pack','4-star Pack','5-star Pack'];
  const acc={};
  cells.forEach(([seg,payer],ci)=>{
    const pi=cloudPermutations_().findIndex(p=>p.seg===seg&&p.payer===payer);
    const pre=cardSeasonPre_(seg,payer,ctx);
    const by={};
    for(let k=0;k<N;k++){
      const r=runOneCardSeason_(seg,payer,playerSeed_(SEED,pi,k),cfg,cat,pre);
      for(const s in r.bySource){
        by[s]=by[s]||{};
        for(const t in r.bySource[s].tiers) by[s][t]=(by[s][t]||0)+r.bySource[s].tiers[t];
      }
    }
    acc[seg+' '+payer]=by;
  });
  const srcs=[...new Set(Object.values(acc).flatMap(o=>Object.keys(o)))].sort();
  const labs=Object.keys(acc);
  console.log('');
  console.log('ENVELOPES PER SEASON, source x tier      '+labs.map(l=>l.padStart(26)).join(''));
  console.log('source'.padEnd(34)+labs.map(()=>'   1*   2*   3*   4*   5* ').join(''));
  const tot={};
  srcs.forEach(s=>{
    let line=s.padEnd(34), any=false;
    labs.forEach(l=>{
      tiers.forEach(t=>{
        const v=(acc[l][s]&&acc[l][s][t]||0)/N;
        if(v>0.05) any=true;
        line+=(v>0.05?v.toFixed(1):'  -').padStart(5);
        tot[l+'|'+t]=(tot[l+'|'+t]||0)+v;
      });
      line+=' ';
    });
    if(any) console.log(line);
  });
  let tl='TOTAL'.padEnd(34);
  labs.forEach(l=>{ tiers.forEach(t=>tl+=(tot[l+'|'+t]||0).toFixed(1).padStart(5)); tl+=' '; });
  console.log(tl);
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
