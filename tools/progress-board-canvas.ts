// 開發進度畫板的畫布頁（progress-map-board.html）：無限白板，拖曳、縮放，越放大看越細。
// 縮小：只看每一段的完成度；放大一點：模組與色塊；再放大：每一項功能的便利貼，點一下看現況。
// 位置照流程自動排（PLACES 的欄列），md 不寫座標。
import { BACK, LEGEND, LINKS, LIST_PAGE, PLACES, TOKENS, bar, count, debtNote, escape, footer, itemsOf, percent, tally, type Meta, type Stage } from './progress-board-data.ts';

// 畫布上的欄列：PLACES 的字母對到 [欄, 列, 跨幾欄]。
const CELLS: Record<string, [number, number, number]> = { a: [0, 0, 1], c: [1, 0, 1], d: [2, 0, 1], e: [3, 0, 1], b: [0, 1, 1], f: [3, 1, 1], g: [0, 2, 4] };
const STATUS_LABEL = Object.fromEntries(LEGEND);

export function renderCanvas(stages: readonly Stage[], meta: Meta): string {
  const all = count(stages.flatMap(itemsOf));
  const value = percent(all);
  const items: { stage: string; module: string; name: string; note: string; status: string }[] = [];
  let extra = 0;
  const cards = stages.map((stage, index) => {
    const counts = count(itemsOf(stage));
    const p = percent(counts);
    const level = p === null ? 'todo' : p >= 60 ? 'done' : p >= 20 ? 'part' : 'todo';
    const place = PLACES[stage.name];
    const cell = place ? CELLS[place] : [extra % 4, 3 + Math.floor(extra++ / 4), 1];
    const modules = stage.modules.map(module => {
      const mp = percent(count(module.items));
      const notes = module.items.map(item => {
        items.push({ stage: stage.name, module: module.name, name: item.name, note: item.note, status: STATUS_LABEL[item.status] });
        return `<button class="pin s-${item.status}" data-i="${items.length - 1}"><span>${item.name}</span></button>`;
      }).join('');
      const figure = mp === null ? '<span class="mp later-only">v1 之後</span>' : `${bar(mp)}<span class="mp">${mp}%</span>`;
      return `<div class="mod"><div class="mh"><span class="mn">${escape(module.name)}</span>${figure}</div><div class="pins">${notes}</div></div>`;
    }).join('');
    const back = BACK[stage.name] ? `<p class="back">${BACK[stage.name]}</p>` : '';
    return `<section class="st lv-${level}" data-stage="${escape(stage.name)}" data-col="${cell[0]}" data-row="${cell[1]}" data-span="${cell[2]}" data-index="${index}">
<div class="cover"><b>${escape(stage.name)}</b><span class="cp">${p ?? '—'}<small>%</small></span>${bar(p)}</div>
<header><h2>${escape(stage.name)}</h2><span class="pct">${p ?? '—'}<small>%</small></span></header>
<p class="desc">${stage.description}</p>${back}${bar(p)}<div class="tallies">${tally(counts)}</div>
<div class="mods">${modules}</div>
</section>`;
  }).join('\n');
  const chips = stages.map((stage, i) => `<button data-go="${i}">${escape(stage.name)}</button>`).join('');
  const links = JSON.stringify(LINKS.filter(([from, to]) => stages.some(s => s.name === from) && stages.some(s => s.name === to)));
  // JSON 放進 <script>：把 < 換掉，內容裡的 </script> 才不會提早結束標籤。
  const data = JSON.stringify(items).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#f6f7f4">
<title>Essence 開發進度｜畫布</title>
<style>${TOKENS}${CSS}</style>
</head>
<body data-level="0">
<div class="viewport" id="vp"><div class="world" id="world"><svg class="wires" id="wires" aria-hidden="true"></svg>
${cards}
</div></div>
<header class="hud top">
  <div class="ttl"><h1>Essence 開發進度</h1><span class="big">${value ?? '—'}<small>%</small></span>${debtNote(meta)}</div>
  <nav class="views" aria-label="切換畫面"><a href="${LIST_PAGE}">清單</a><span aria-current="page">畫布</span></nav>
</header>
<nav class="hud jump" aria-label="跳到某一段">${chips}</nav>
<div class="hud zoom" role="group" aria-label="縮放"><button id="out" aria-label="縮小">−</button><button id="fit">全覽</button><button id="in" aria-label="放大">＋</button></div>
<div class="hud legend">${LEGEND.map(([s, label]) => `<span class="s-${s}"><i></i>${label}</span>`).join('')}</div>
<aside class="sheet" id="sheet" hidden><button class="close" id="close" aria-label="關閉">×</button><p class="path" id="path"></p><h3 id="name"></h3><p class="state" id="state"></p><p class="text" id="text"></p></aside>
<footer class="hud foot">${footer(meta)}</footer>
<script>const LINKS=${links},ITEMS=${data};${SCRIPT}</script>
</body>
</html>
`;
}

const CSS = `
*{box-sizing:border-box}
html,body{height:100%;margin:0;overflow:hidden;overscroll-behavior:none}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","PingFang TC",sans-serif;-webkit-text-size-adjust:100%;-webkit-user-select:none;user-select:none}
a{color:inherit}
button{font:inherit;color:inherit;cursor:pointer}
.viewport{position:fixed;inset:0;touch-action:none;cursor:grab;background-image:radial-gradient(var(--dot) 1.2px,transparent 1.2px)}
.viewport.drag{cursor:grabbing}
.world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.wires{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.wires path{fill:none;stroke:var(--wire);stroke-width:3}.wires path.dash{stroke-dasharray:10 10}
.wires text{font-size:22px;fill:var(--muted);paint-order:stroke;stroke:var(--bg);stroke-width:8px;stroke-linejoin:round}
.st{position:absolute;width:420px;background:var(--card);border-radius:22px;padding:22px 22px 14px;box-shadow:var(--shadow);border-top:6px solid var(--todo)}
.st.lv-done{border-top-color:var(--done)}.st.lv-part{border-top-color:var(--part)}
.st header{display:flex;justify-content:space-between;align-items:baseline}
.st h2{margin:0;font-size:24px}.pct{font-size:30px;font-weight:700}.pct small,.cp small,.big small{font-size:.45em;margin-left:2px;color:var(--muted)}
.desc{margin:4px 0 10px;color:var(--muted);font-size:14px}.back{margin:-6px 0 10px;font-size:13px;color:var(--later)}
.bar{display:block;height:7px;border-radius:4px;background:var(--todo-bg);overflow:hidden}.bar span{display:block;height:100%;border-radius:4px;background:var(--done)}
.tallies{display:flex;gap:12px;margin-top:8px;font-size:13px;color:var(--muted)}.tally{display:inline-flex;align-items:center;gap:5px}
i{display:inline-block;width:10px;height:10px;border-radius:50%;flex:none}
.s-done i{background:var(--done)}.s-part i{background:var(--part)}.s-todo i{background:var(--todo)}.s-later i{border:2px solid var(--later)}
.mods{display:flex;flex-direction:column;gap:16px;margin-top:16px}
.st[data-span="4"] .mods{flex-direction:row;flex-wrap:wrap}.st[data-span="4"] .mod{flex:1 1 380px}
.mh{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600;margin-bottom:8px}.mn{flex:1}
.mh .bar{width:70px;height:6px}.mp{font-size:13px;color:var(--muted);font-weight:500;min-width:38px;text-align:right}.later-only{color:var(--later)}
.pins{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.pin{display:block;text-align:left;border:0;border-radius:10px;padding:8px 10px;min-height:58px;font-size:13px;line-height:1.35;color:var(--ink);box-shadow:0 1px 2px #1f2b2614}
.pin.s-done{background:var(--done-bg)}.pin.s-part{background:var(--part-bg)}.pin.s-todo{background:var(--todo-bg)}
.pin.s-later{background:var(--later-bg);outline:2px dashed var(--later);outline-offset:-2px}
.pin code{font-size:.92em}
.pin:focus-visible{outline:3px solid var(--part);outline-offset:1px}
.cover{position:absolute;inset:0;border-radius:inherit;background:var(--card);display:none;flex-direction:column;justify-content:center;gap:18px;padding:40px;cursor:pointer}
.cover b{font-size:84px;line-height:1}.cp{font-size:110px;font-weight:700;line-height:1}.cover .bar{height:22px;border-radius:11px}.cover .bar span{border-radius:11px}
body[data-level="0"] .cover{display:flex}
body[data-level="1"] .pin span{visibility:hidden}
body[data-level="1"] .pin{min-height:26px;padding:0}
body[data-level="1"] .pins{grid-template-columns:repeat(auto-fill,minmax(26px,1fr))}
.hud{position:fixed;z-index:2}
.top{left:12px;right:12px;top:max(10px,env(safe-area-inset-top));display:flex;justify-content:space-between;align-items:center;gap:10px;pointer-events:none}
.top>*{pointer-events:auto}
.ttl{display:flex;align-items:baseline;gap:12px;background:var(--card);border-radius:14px;padding:6px 14px;box-shadow:var(--shadow)}
.ttl h1{margin:0;font-size:16px}.big{font-size:22px;font-weight:700}
.ttl{flex-wrap:wrap;row-gap:0}.ttl h1,.views>*{white-space:nowrap}
.ttl .debt{font-size:11px;color:var(--muted);white-space:nowrap}
.views{display:inline-flex;gap:2px;background:var(--card);border-radius:999px;padding:3px;box-shadow:var(--shadow);font-size:13px}
.views>*{padding:4px 14px;border-radius:999px;text-decoration:none;color:var(--muted)}.views [aria-current]{background:var(--done-bg);color:var(--ink);font-weight:600}
.jump{left:12px;right:12px;top:calc(max(10px,env(safe-area-inset-top)) + 52px);display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;pointer-events:auto}
.jump button{flex:none;border:0;background:var(--card);border-radius:999px;padding:4px 12px;font-size:13px;box-shadow:var(--shadow);color:var(--muted)}
.zoom{right:12px;bottom:calc(max(12px,env(safe-area-inset-bottom)) + 26px);display:flex;background:var(--card);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}
.zoom button{border:0;background:none;min-width:44px;height:40px;font-size:15px;color:var(--ink)}.zoom #fit{font-size:13px;padding:0 10px;border-left:1px solid var(--line);border-right:1px solid var(--line)}
.legend{left:12px;bottom:calc(max(12px,env(safe-area-inset-bottom)) + 30px);display:flex;gap:10px;flex-wrap:wrap;max-width:calc(100% - 200px);font-size:12px;color:var(--muted);background:var(--card);border-radius:10px;padding:5px 10px;box-shadow:var(--shadow)}
.legend span{display:inline-flex;align-items:center;gap:5px}
.foot{left:12px;bottom:max(6px,env(safe-area-inset-bottom));max-width:calc(100% - 24px);font-size:11px;color:var(--muted);background:var(--card);border-radius:8px;padding:2px 8px;opacity:.92}
.sheet{position:fixed;z-index:3;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));max-width:440px;margin:0 auto;background:var(--card);border-radius:18px;padding:16px 18px;box-shadow:0 8px 30px #1f2b2633;-webkit-user-select:text;user-select:text}
.sheet h3{margin:2px 0 4px;font-size:17px}.path,.state{margin:0;font-size:12px;color:var(--muted)}.text{margin:8px 0 0;font-size:14px}
.close{position:absolute;right:10px;top:8px;border:0;background:none;font-size:22px;color:var(--muted);width:36px;height:36px}
@media (max-width:640px){.legend{display:none}.ttl .debt{flex-basis:100%;margin-top:-2px}.jump{top:calc(max(10px,env(safe-area-inset-top)) + 70px)}.zoom{bottom:calc(max(12px,env(safe-area-inset-bottom)) + 44px)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const SCRIPT = `
(()=>{
const vp=document.getElementById('vp'),world=document.getElementById('world'),svg=document.getElementById('wires'),body=document.body;
const W=420,GX=150,GY=150,MIN=0.06,MAX=2.5;
let x=0,y=0,s=1,bounds={w:0,h:0},anim=0;
const cards=[...world.querySelectorAll('.st')];
function layout(){
  const rows={};
  for(const c of cards){const r=+c.dataset.row,span=+c.dataset.span;c.style.width=(W*span+GX*(span-1))+'px';rows[r]=Math.max(rows[r]||0,c.offsetHeight);}
  const tops={};let acc=0;for(const r of Object.keys(rows).map(Number).sort((a,b)=>a-b)){tops[r]=acc;acc+=rows[r]+GY;}
  let w=0;for(const c of cards){const left=+c.dataset.col*(W+GX);c.style.left=left+'px';c.style.top=tops[+c.dataset.row]+'px';w=Math.max(w,left+c.offsetWidth);}
  bounds={w,h:acc-GY};wires();
}
function wires(){
  const by=n=>cards.find(c=>c.dataset.stage===n);
  const pt=(c,side)=>{const l=c.offsetLeft,t=c.offsetTop,w=c.offsetWidth,h=c.offsetHeight,m=Math.min(h/2,120);
    return side==='r'?[l+w,t+m]:side==='l'?[l,t+m]:side==='t'?[l+w/2,t]:[l+w/2,t+h];};
  let out='<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1L9 5L0 9" fill="none" stroke="var(--wire)" stroke-width="1.6"/></marker></defs>';
  for(const [f,t,fs,ts,label,dash] of LINKS){const a=by(f),b=by(t);if(!a||!b)continue;
    const [x1,y1]=pt(a,fs),[x2,y2]=pt(b,ts);let d,lx,ly,anchor='middle';
    if(fs==='t'&&ts==='t'){const top=Math.min(y1,y2)-70;d='M'+x1+' '+y1+' C'+x1+' '+top+' '+x2+' '+top+' '+x2+' '+y2;lx=(x1+x2)/2;ly=top+18;}
    else if(fs==='b'){const m=(y1+y2)/2;d='M'+x1+' '+y1+' C'+x1+' '+m+' '+x2+' '+m+' '+x2+' '+y2;lx=x1+16;ly=m;anchor='start';}
    else{const m=(x1+x2)/2;d='M'+x1+' '+y1+' C'+m+' '+y1+' '+m+' '+y2+' '+x2+' '+y2;lx=m;ly=(y1+y2)/2-10;}
    out+='<path d="'+d+'"'+(dash?' class="dash"':'')+' marker-end="url(#ar)"/>';
    if(label)out+='<text x="'+lx+'" y="'+ly+'" text-anchor="'+anchor+'">'+label+'</text>';}
  svg.setAttribute('width',bounds.w);svg.setAttribute('height',bounds.h);svg.innerHTML=out;
}
function apply(){
  world.style.transform='translate('+x+'px,'+y+'px) scale('+s+')';
  vp.style.backgroundSize=(22*s)+'px '+(22*s)+'px';vp.style.backgroundPosition=x+'px '+y+'px';
  body.dataset.level=s<0.42?'0':s<0.78?'1':'2';
}
function zoomAt(px,py,ns){ns=Math.min(MAX,Math.max(MIN,ns));x=px-(px-x)*ns/s;y=py-(py-y)*ns/s;s=ns;apply();}
function go(tx,ty,ts){cancelAnimationFrame(anim);const fx=x,fy=y,fs=s,start=performance.now();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){x=tx;y=ty;s=ts;apply();return;}
  const step=now=>{const k=Math.min(1,(now-start)/260),e=1-Math.pow(1-k,3);x=fx+(tx-fx)*e;y=fy+(ty-fy)*e;s=fs+(ts-fs)*e;apply();if(k<1)anim=requestAnimationFrame(step);};anim=requestAnimationFrame(step);}
function hudTop(){return document.querySelector(".jump").getBoundingClientRect().bottom+12;}
function frame(l,t,w,h,cap){const vw=innerWidth,vh=innerHeight,top=hudTop(),bottom=70,pad=24;
  const ns=Math.min(cap,(vw-pad*2)/w,(vh-top-bottom)/h);return [(vw-w*ns)/2-l*ns,top+(vh-top-bottom-h*ns)/2-t*ns,ns];}
function fit(){const [a,b,c]=frame(0,0,bounds.w,bounds.h,1);go(a,b,c);}
function focus(card){const vw=innerWidth,vh=innerHeight,top=hudTop(),bottom=70,l=card.offsetLeft,t=card.offsetTop,w=card.offsetWidth,h=card.offsetHeight;
  const ns=Math.min(1.1,(vw-48)/w,w>W*2?(vh-top-bottom)/h:9);const room=vh-top-bottom-h*ns;
  go((vw-w*ns)/2-l*ns,top+Math.max(0,room/2)-t*ns,ns);}
// 拖曳與兩指縮放：移動超過 6px 才算拖，不然算點一下。
const pts=new Map();let moved=false,pinch=null,last=null;
vp.addEventListener('pointerdown',e=>{pts.set(e.pointerId,[e.clientX,e.clientY]);cancelAnimationFrame(anim);
  if(pts.size===1){moved=false;last=[e.clientX,e.clientY];}
  if(pts.size===2){const [p,q]=[...pts.values()];pinch={d:Math.hypot(p[0]-q[0],p[1]-q[1]),s,mx:(p[0]+q[0])/2,my:(p[1]+q[1])/2,x,y};moved=true;}});
vp.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);
  if(pinch&&pts.size>=2){const [p,q]=[...pts.values()];const d=Math.hypot(p[0]-q[0],p[1]-q[1]),mx=(p[0]+q[0])/2,my=(p[1]+q[1])/2;
    const ns=Math.min(MAX,Math.max(MIN,pinch.s*d/pinch.d));x=mx-(pinch.mx-pinch.x)*ns/pinch.s;y=my-(pinch.my-pinch.y)*ns/pinch.s;s=ns;apply();return;}
  if(!last)return;const dx=e.clientX-last[0],dy=e.clientY-last[1];
  if(!moved&&Math.hypot(dx,dy)<6)return;if(!moved){moved=true;vp.classList.add('drag');try{vp.setPointerCapture(e.pointerId);}catch{}}
  x+=dx;y+=dy;last=[e.clientX,e.clientY];apply();});
const up=e=>{pts.delete(e.pointerId);if(pts.size<2)pinch=null;if(pts.size===1){last=[...pts.values()][0];}if(!pts.size){last=null;vp.classList.remove('drag');}};
vp.addEventListener('pointerup',up);vp.addEventListener('pointercancel',up);
vp.addEventListener('click',e=>{if(moved){e.preventDefault();e.stopPropagation();return;}
  const pin=e.target.closest('.pin');if(pin){show(+pin.dataset.i);return;}
  const card=e.target.closest('.st');if(card&&body.dataset.level==='0'){focus(card);return;}
  hide();},true);
vp.addEventListener('wheel',e=>{e.preventDefault();const k=e.ctrlKey?0.01:0.0015;zoomAt(e.clientX,e.clientY,s*Math.exp(-e.deltaY*k));},{passive:false});
document.addEventListener('gesturestart',e=>e.preventDefault());
document.getElementById('in').onclick=()=>{const ns=Math.min(MAX,s*1.4);go(innerWidth/2-(innerWidth/2-x)*ns/s,innerHeight/2-(innerHeight/2-y)*ns/s,ns);};
document.getElementById('out').onclick=()=>{const ns=Math.max(MIN,s/1.4);go(innerWidth/2-(innerWidth/2-x)*ns/s,innerHeight/2-(innerHeight/2-y)*ns/s,ns);};
document.getElementById('fit').onclick=fit;
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>focus(cards[+b.dataset.go]));
addEventListener('keydown',e=>{if(e.target.closest&&e.target.closest('input,textarea'))return;
  if(e.key==='+'||e.key==='=')document.getElementById('in').click();else if(e.key==='-')document.getElementById('out').click();
  else if(e.key==='0')fit();else if(e.key==='Escape')hide();
  else if(e.key.startsWith('Arrow')){const d=80;x+=e.key==='ArrowLeft'?d:e.key==='ArrowRight'?-d:0;y+=e.key==='ArrowUp'?d:e.key==='ArrowDown'?-d:0;apply();}});
// 便利貼的說明。
const sheet=document.getElementById('sheet');
function show(i){const it=ITEMS[i];if(!it)return;document.getElementById('path').textContent=it.stage+' › '+it.module;
  document.getElementById('name').innerHTML=it.name;document.getElementById('state').textContent=it.status;
  document.getElementById('text').innerHTML=it.note||'（沒有補充）';sheet.hidden=false;}
function hide(){sheet.hidden=true;}
document.getElementById('close').onclick=hide;
// pin 也能用鍵盤（Enter、空白鍵）打開。
world.addEventListener('keydown',e=>{const pin=e.target.closest('.pin');if(pin&&(e.key==='Enter'||e.key===' ')){e.preventDefault();show(+pin.dataset.i);}});
addEventListener('resize',()=>apply());
layout();const [a,b,c]=frame(0,0,bounds.w,bounds.h,1);x=a;y=b;s=c;apply();
document.fonts&&document.fonts.ready.then(()=>{layout();});
})();
`;
