// R34 报价金额漂移审计（缺陷复现脚本，非生产代码）。
// 用法：node docs/evolution/_r34_amount_drift_audit.mjs
// 结论：200,000 组真实量级随机用例里 16,600 组（8.3%）行项，旧写法
//   Math.round(qty*price*(disc/100)*100)/100
// 比精确十进制定点（BigInt 参照）少 1 分；组小计/总计层无漂移（badGroup=badTotal=0）。
// 修复落在 src/lib/money.ts productCents + src/pages/PptQuote/pptQuoteTypes.ts 分位链路，
// 回归锁见 src/pages/PptQuote/quoteTotalCapital.test.ts。
function norm(d){if(d==null||!Number.isFinite(d)||d<=0)return 100;return Math.min(100,d)}
function itemSubtotal(it){const d=norm(it.discount);const raw=(it.qty||0)*(it.price||0)*(d/100);return Math.round(raw*100)/100}
function groupSubtotal(g){const raw=(g.items??[]).reduce((s,it)=>s+itemSubtotal(it),0);return Math.round(raw*100)/100}
function quoteTotal(gs){const raw=(gs??[]).reduce((s,g)=>s+groupSubtotal(g),0);return Math.round(raw*100)/100}
function exactCents(qty,price,disc){
  const Q=BigInt(Math.round(qty*1e6)),P=BigInt(Math.round(price*1e6)),D=BigInt(Math.round(norm(disc)*1e6));
  const N=Q*P*D, DEN=10n**18n;
  const r=(N*2n+DEN)/(2n*DEN);
  return Number(r);
}
let badItem=0,badGroup=0,badTotal=0,examples=[];
let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
for(let t=0;t<200000;t++){
  const n=1+Math.floor(rnd()*8);
  const items=[];
  for(let i=0;i<n;i++){
    const qty=Math.round(rnd()*40)/(rnd()<0.3?2:1);
    const price=Math.round(rnd()*1e8)/100;
    const disc=[100,95,90,85,80,88,70,66.667][Math.floor(rnd()*8)];
    items.push({qty,price,discount:disc});
    const exact=exactCents(qty,price,disc)/100;
    if(Math.abs(itemSubtotal({qty,price,discount:disc})-exact)>1e-9){badItem++;if(examples.length<6)examples.push({qty,price,disc,js:itemSubtotal({qty,price,discount:disc}),exact});}
  }
  const g=[{id:'g',name:'x',items}];
  const sumCents=items.reduce((s,it)=>s+Math.round(itemSubtotal(it)*100),0);
  if(Math.abs(groupSubtotal(g[0])*100-sumCents)>1e-6)badGroup++;
  if(Math.abs(quoteTotal(g)*100-sumCents)>1e-6)badTotal++;
}
console.log({badItem,badGroup,badTotal,trials:200000});
console.log(examples);
for(const c of [[1,1.005,100],[1,8.335,100],[1.5,12345.67,100],[3,19.99,100],[1,0.125,100],[2,0.005,100],[1,4.445,100],[20,49.995,100]]){
  const js=itemSubtotal({qty:c[0],price:c[1],discount:c[2]});
  console.log('edge',c.join('/'),'js=',js,'exactHalfUp=',exactCents(c[0],c[1],c[2])/100);
}
