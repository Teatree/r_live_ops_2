// Album-completion composition probe. Not a gate - a measurement tool for balancing.
//   node harness/_probe_album.js --data _mockdata_wb9.json [--n 150] [--variant name]
const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));

function PROBE(){
  const argN=process.argv.indexOf('--n');
  const N=argN>0?Number(process.argv[argN+1]):150;
  const argV=process.argv.indexOf('--variant');
  const VARIANT=argV>0?process.argv[argV+1]:'base';
  const SEED=20260910;

  // ---- variant mutations, applied to the mock PackConfig sheet BEFORE loadPackConfig_ ---------
  const pc=data['PackConfig'].values;
  const rowOf=lab=>{for(let i=0;i<pc.length;i++) if(String(pc[i][0]).trim()===lab) return i; return -1;};
  const blockRow=(lab,id)=>{const b=rowOf(lab);for(let i=b+1;i<pc.length;i++){if(String(pc[i][0]).trim()===id)return i;}return -1;};
  const setSkew=(album,arr)=>{const r=blockRow('ALBUM SET SKEW',album);arr.forEach((v,i)=>pc[r][1+i]=v);};
  const setPool=(rar,q)=>{const r=blockRow('SNAP POOL',rar);pc[r][1]=q;};
  const setCards=(pack,n)=>{const r=blockRow('PACK DEFINITIONS',pack);pc[r][1]=n;};
  const setGuarNew=(pack,n)=>{const r=blockRow('PACK DEFINITIONS',pack);pc[r][3]=n;};
  const setGuarRar=(pack,n)=>{const r=blockRow('PACK DEFINITIONS',pack);pc[r][2]=n;};

  const V={
    base(){},
    // 1. flatten the album-1 skew: the steep 50/25/12/... front-loads set 1 for EVERYONE
    flat_skew(){ setSkew('Album 1',[1,1,1,1,1,1,1,1]); },
    mild_skew(){ setSkew('Album 1',[4,3,2.5,2,1.5,1.2,1,1]); },
    steeper_skew(){ setSkew('Album 1',[100,50,25,12,6,3,1,0.5]); },
    // 2. pool: fewer copies of the common tiers = fewer duplicates = faster completion for everyone
    pool_flat(){ [['1★',69],['2★',69],['3★',69],['4★',69],['5★',69],['Gold',66]].forEach(([r,q])=>setPool(r,q)); },
    pool_half_common(){ setPool('1★',71); setPool('2★',54); },
    pool_double_rare(){ setPool('4★',88); setPool('5★',52); setPool('Gold',42); },
    // 3. guarantee a NEW card in the bigger envelopes only - scales with who opens them
    guar_new_big(){ setGuarNew('4-star Pack',1); setGuarNew('5-star Pack',2); setGuarNew('6-star Pack (Paid)',2); },
    guar_new_all(){ ['1-star Pack','2-star Pack','3-star Pack','4-star Pack','5-star Pack','6-star Pack (Paid)'].forEach(p=>setGuarNew(p,1)); },
    // 4. widen the tier gradient: small envelopes smaller, big envelopes bigger
    tier_spread(){ setCards('1-star Pack',1); setCards('2-star Pack',2); setCards('3-star Pack',4);
                   setCards('4-star Pack',6); setCards('5-star Pack',9); setCards('6-star Pack (Paid)',11); },
    spread_hard(){ setCards('1-star Pack',1); setCards('2-star Pack',2); setCards('3-star Pack',3);
                   setCards('4-star Pack',6); setCards('5-star Pack',12); setCards('6-star Pack (Paid)',14); },
    spread_flatskew(){ V.tier_spread(); setSkew('Album 1',[1,1,1,1,1,1,1,1]); },
    spread_mildskew(){ V.tier_spread(); setSkew('Album 1',[4,3,2.5,2,1.5,1.2,1,1]); },
  };
  // ---- SOURCE-SIDE variants: scale the envelopes a CATEGORY pays, on the grant plan itself.
  // This is the reward-distribution dimension. It does not touch a config sheet, so it prices the
  // MOVE ("what if Night Sky paid half and Target Day paid more") without re-authoring a ladder -
  // which is the number wanted before anyone re-authors one.
  var PLANMUT=null, SPMUT=null;
  const scale=(m)=>{ PLANMUT=function(plan){
    plan.forEach(function(pl){
      var f=m[pl.cat]; if(f==null) return;
      pl.groups.forEach(function(g){ g.rungs.forEach(function(rg){
        for (var t in rg.packs) rg.packs[t]=rg.packs[t]*f;
      });});
    });
  };};
  const S={
    ns_off(){ scale({'Daily Night Sky Prize':0}); },
    ns_half(){ scale({'Daily Night Sky Prize':0.5}); },
    // move it: Night Sky halved, the progress-driven ladders paid more to keep the total roughly flat
    ns_to_progress(){ scale({'Daily Night Sky Prize':0.25,'Target Day':2.5,'Hatchling Hideaway':2.0,
                             'Jigsaw':2.0,'Rainbow Maker':1.3}); },
    progress_up(){ scale({'Target Day':2,'Hatchling Hideaway':2,'Jigsaw':2,'Rainbow Maker':1.5}); },
    tof_off(){ scale({'ToF':0}); },
    // SAME NUMBER of Season Pass (Paid) envelopes, retiered to the top. This is the one lever that
    // is payer-only and does NOT add an envelope to the paid track - the constraint as stated.
    sp_paid_retier(){ SPMUT='5-star Pack'; },
    sp_paid_retier6(){ SPMUT='6-star Pack (Paid)'; },
    spread_sp_retier(){ V.tier_spread(); SPMUT='5-star Pack'; }
  };
  if (S[VARIANT]) S[VARIANT]();
  else if (V[VARIANT]) V[VARIANT]();
  else { console.log('unknown variant '+VARIANT+'; have: '+Object.keys(V).concat(Object.keys(S)).join(', ')); return; }
  _sheetValsCache={};

  const cfg=loadPackConfig_();
  const cat=loadCardCatalog_(cfg, SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AlbumConfig'));
  const ctx=Context.get();
  const perms=cloudPermutations_();
  const byCell={};
  const t0=Date.now();
  perms.forEach((p,pi)=>{
    const pre=cardSeasonPre_(p.seg,p.payer,ctx);
    if (PLANMUT) PLANMUT(pre.plan);
    if (SPMUT) pre.spPacks.forEach(function(tp){
      if (String(tp.source||'').indexOf('Paid')<0) return;
      var n=0; for (var t in tp.packs) n+=tp.packs[t];
      tp.packs={}; if (n>0) tp.packs[SPMUT]=n;      // same count, one tier
    });
    const runs=[];
    for(let k=0;k<N;k++) runs.push(runOneCardSeason_(p.seg,p.payer,playerSeed_(SEED,pi,k),cfg,cat,pre));
    byCell[p.label]=albumCellStats_(runs);
    byCell[p.label].packsMean=runs.reduce((a,r)=>a+r.packsOpenedTotal,0)/N;
    byCell[p.label].pctMean=runs.reduce((a,r)=>a+r.dailyCloud[DAILY_DAYS-1].albumPct,0)/N;
  });
  const popInfo=cellPopulations_(ctx);
  const pop=albumPopulationStats_(byCell,popInfo);
  const secs=((Date.now()-t0)/1000).toFixed(0);

  console.log('');
  console.log('=== VARIANT '+VARIANT+'   N='+N+'/cell  seed '+SEED+'  ('+secs+'s) ===');
  console.log('POPULATION RATE '+(100*pop.rate).toFixed(2)+'%   finisher opens '+pop.packs.toFixed(1)+
              ' envelopes, draws '+pop.cards.toFixed(0)+' cards');
  console.log('');
  console.log('cell               pop%   rate%   share%  index  envel  album%');
  const comp=pop.composition.slice().sort((a,b)=>b.share-a.share);
  comp.forEach(x=>{
    const c=byCell[x.label];
    console.log(x.label.padEnd(17)+
      (100*x.popShare).toFixed(1).padStart(6)+
      (100*x.rate).toFixed(1).padStart(8)+
      (100*x.share).toFixed(1).padStart(8)+
      x.index.toFixed(2).padStart(7)+
      c.packsMean.toFixed(1).padStart(7)+
      c.pctMean.toFixed(0).padStart(7));
  });
  const target=pop.composition.filter(x=>x.label==='40-99 PAYER'||x.label==='100+ PAYER')
                              .reduce((a,x)=>a+x.share,0);
  const targetAll=pop.composition.filter(x=>x.payer==='PAYER'&&(x.seg==='40-99'||x.seg==='100+'))
                              .reduce((a,x)=>a+x.popShare,0);
  console.log('');
  console.log('TARGET (40-99 PAYER + 100+ PAYER): '+(100*target).toFixed(1)+'% of finishers, from '+
              (100*targetAll).toFixed(2)+'% of the base   ->  index '+(target/targetAll).toFixed(2)+'x');
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
