// 開發進度畫板的清單頁（progress-map-list.html）：照流程的格子排列，點開模組看每一項。
import { BACK, BOARD_PAGE, LEGEND, LINKS, PLACES, TOKENS, bar, count, escape, footer, itemsOf, percent, tally, type Meta, type Module, type Stage } from './progress-board-data.ts';

function renderModule(module: Module): string {
  const counts = count(module.items);
  const value = percent(counts);
  const v1 = counts.done + counts.part + counts.todo;
  const items = module.items.map(item => `<li class="item s-${item.status}"><i></i><span class="name">${item.name}</span>${item.note ? `<span class="note">${item.note}</span>` : ''}</li>`).join('');
  const figure = v1 ? `${bar(value)}<span class="frac">${value}%</span>` : `<span class="frac later-only">v1 之後</span>`;
  return `<details class="module"><summary><span class="mname">${escape(module.name)}</span><span class="mfig">${figure}</span></summary><ul>${items}</ul></details>`;
}

function renderStage(stage: Stage, index: number): string {
  const counts = count(itemsOf(stage));
  const value = percent(counts);
  const level = value === null ? 'todo' : value >= 60 ? 'done' : value >= 20 ? 'part' : 'todo';
  const place = PLACES[stage.name];
  const back = BACK[stage.name] ? `<p class="back">${BACK[stage.name]}</p>` : '';
  return `<section class="stage lv-${level}" data-stage="${escape(stage.name)}" ${place ? ` data-place="${place}"` : ''} id="s${index}">
<header><h2>${escape(stage.name)}</h2><span class="pct">${value ?? '—'}<small>%</small></span></header>
<p class="desc">${stage.description}</p>${back}
${bar(value)}<div class="tallies">${tally(counts)}</div>
<div class="modules">${stage.modules.map(renderModule).join('')}</div>
</section>`;
}

export function renderList(stages: readonly Stage[], meta: Meta): string {
  const all = count(stages.flatMap(itemsOf));
  const value = percent(all);
  const v1 = all.done + all.part + all.todo;
  const summary = stages.map((stage, i) => {
    const p = percent(count(itemsOf(stage)));
    return `<a class="chip" href="#s${i}"><span>${escape(stage.name)}</span>${bar(p)}<b>${p ?? '—'}%</b></a>`;
  }).join('');
  const links = JSON.stringify(LINKS.filter(([from, to]) => PLACES[from] && PLACES[to] && stages.some(s => s.name === from) && stages.some(s => s.name === to)));
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#f6f7f4">
<title>Essence 開發進度｜清單</title>
<style>${CSS}</style>
</head>
<body data-filter="all">
<header class="top">
  <div class="title"><h1>Essence 開發進度</h1><p>整個專案的功能照流程排列；點開模組看每一項。</p><nav class="views" aria-label="切換畫面"><span aria-current="page">清單</span><a href="${BOARD_PAGE}">畫布</a></nav></div>
  <div class="overall"><span class="big">${value ?? '—'}<small>%</small></span><div><span class="label">v1 完成度（共 ${v1} 項，另有 v1 之後 ${all.later} 項）</span>${bar(value)}<div class="tallies">${tally(all)}</div></div></div>
</header>
<nav class="tools" aria-label="篩選">
  <div class="filters" role="group">
    <button data-f="all" aria-pressed="true">全部</button><button data-f="v1" aria-pressed="false">只看 v1</button><button data-f="todo" aria-pressed="false">還沒開工</button><button data-f="later" aria-pressed="false">v1 之後</button>
  </div>
  <button class="toggle" data-open="0">全部展開</button>
  <div class="legend">${LEGEND.map(([s, label]) => `<span class="s-${s}"><i></i>${label}</span>`).join('')}</div>
</nav>
<div class="summary">${summary}</div>
<main class="canvas" id="canvas">
<svg class="wires" id="wires" aria-hidden="true"></svg>
${stages.map(renderStage).join('\n')}
</main>
<footer>${footer(meta)}</footer>
<script>const LINKS=${links};${SCRIPT}</script>
</body>
</html>
`;
}

const CSS = `${TOKENS}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","PingFang TC",sans-serif;-webkit-text-size-adjust:100%}
a{color:inherit}
.top{display:flex;flex-wrap:wrap;gap:16px 40px;align-items:flex-end;justify-content:space-between;padding:28px max(16px,4vw) 12px}
.title h1{margin:0;font-size:24px;letter-spacing:.02em}.title p{margin:4px 0 0;color:var(--muted);font-size:13px}
.views{display:inline-flex;gap:2px;margin-top:10px;background:var(--card);border-radius:999px;padding:3px;box-shadow:var(--shadow);font-size:13px}
.views>*{padding:4px 14px;border-radius:999px;text-decoration:none;color:var(--muted)}.views [aria-current]{background:var(--done-bg);color:var(--ink);font-weight:600}
.overall{display:flex;gap:16px;align-items:center;min-width:min(420px,100%)}
.overall>div{flex:1;min-width:0}
.big{font-size:44px;font-weight:700;line-height:1}.big small,.pct small{font-size:.45em;font-weight:600;margin-left:2px;color:var(--muted)}
.label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
.bar{display:block;height:6px;border-radius:3px;background:var(--todo-bg);overflow:hidden}
.bar span{display:block;height:100%;border-radius:3px;background:var(--done)}
.tallies{display:flex;gap:12px;margin-top:6px;font-size:12px;color:var(--muted)}
.tally,.legend span{display:inline-flex;align-items:center;gap:5px}
i{display:inline-block;width:9px;height:9px;border-radius:50%;flex:none;font-style:normal}
.s-done i{background:var(--done)}.s-part i{background:var(--part)}.s-todo i{background:var(--todo)}.s-later i{background:transparent;border:2px solid var(--later)}
.tools{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;padding:4px max(16px,4vw) 8px}
.filters{display:inline-flex;background:var(--card);border-radius:999px;padding:3px;box-shadow:var(--shadow)}
button{font:inherit;font-size:13px;color:var(--muted);background:none;border:0;border-radius:999px;padding:5px 12px;cursor:pointer}
.filters button[aria-pressed="true"]{background:var(--done-bg);color:var(--ink);font-weight:600}
.toggle{background:var(--card);box-shadow:var(--shadow)}
.legend{display:flex;gap:12px;font-size:12px;color:var(--muted);margin-left:auto}
.summary{display:flex;gap:8px;overflow-x:auto;padding:6px max(16px,4vw) 10px;scrollbar-width:none}
.chip{flex:none;display:grid;grid-template-columns:auto 56px auto;gap:8px;align-items:center;text-decoration:none;font-size:13px;background:var(--card);border-radius:10px;padding:6px 12px;box-shadow:var(--shadow)}
.chip b{font-weight:600;font-variant-numeric:tabular-nums}
.canvas{position:relative;display:grid;gap:22px;padding:18px max(16px,4vw) 40px;background-image:radial-gradient(var(--dot) 1px,transparent 1px);background-size:22px 22px;
grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))}
.wires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.wires path{fill:none;stroke:var(--wire);stroke-width:1.6}.wires path.dash{stroke-dasharray:5 5}
.wires text{font-size:12px;fill:var(--muted);paint-order:stroke;stroke:var(--bg);stroke-width:5px;stroke-linejoin:round}
.stage{position:relative;z-index:1;background:var(--card);border-radius:16px;padding:16px 16px 10px;box-shadow:var(--shadow);border-top:4px solid var(--todo);align-self:start}
.stage.lv-done{border-top-color:var(--done)}.stage.lv-part{border-top-color:var(--part)}
.stage header{display:flex;justify-content:space-between;align-items:baseline}
.stage h2{margin:0;font-size:18px}.pct{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.desc{margin:4px 0 8px;color:var(--muted);font-size:13px}
.back{margin:-4px 0 8px;font-size:12px;color:var(--later)}
.modules{margin-top:10px;border-top:1px solid var(--line)}
.module{border-bottom:1px solid var(--line)}.module:last-child{border-bottom:0}
summary{display:flex;align-items:center;gap:10px;padding:8px 2px;cursor:pointer;list-style:none;font-size:14px}
summary::-webkit-details-marker{display:none}
summary::before{content:"";width:6px;height:6px;border-right:1.6px solid var(--muted);border-bottom:1.6px solid var(--muted);transform:rotate(-45deg);transition:transform .15s;flex:none;margin-right:2px}
details[open]>summary::before{transform:rotate(45deg)}
.mname{flex:1;min-width:0}
.mfig{display:flex;align-items:center;gap:8px;flex:none}.mfig .bar{width:56px;height:5px}
.frac{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:34px;text-align:right}
.later-only{color:var(--later)}
ul{list-style:none;margin:0 0 8px;padding:0}
.item{display:grid;grid-template-columns:14px 1fr;column-gap:6px;padding:5px 4px;border-radius:8px;font-size:13.5px}
.item i{margin-top:6px}.item .note{grid-column:2;color:var(--muted);font-size:12px}
.item.s-later .name{color:var(--muted)}
.note code,.name code{font-size:.92em;background:var(--todo-bg);padding:0 4px;border-radius:4px}
body[data-filter="v1"] .item.s-later,body[data-filter="todo"] .item:not(.s-todo),body[data-filter="later"] .item:not(.s-later){display:none}
footer{padding:0 max(16px,4vw) 32px;font-size:12px;color:var(--muted)}
@media (min-width:1080px){
.canvas{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-areas:"a c d e" "b . . f" "g g g g";column-gap:56px;row-gap:56px;padding-top:44px}
${Object.values(PLACES).map(p => `.stage[data-place="${p}"]{grid-area:${p}}`).join('')}
}
@media (max-width:1079px){.wires{display:none}.legend{margin-left:0}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media print{.tools,.summary{display:none}details>ul{display:block}}
`;

const SCRIPT = `
(()=>{
const body=document.body,canvas=document.getElementById('canvas'),svg=document.getElementById('wires');
document.querySelectorAll('.filters button').forEach(b=>b.addEventListener('click',()=>{
  body.dataset.filter=b.dataset.f;
  document.querySelectorAll('.filters button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  if(b.dataset.f!=='all')document.querySelectorAll('.module').forEach(d=>{d.open=true});
}));
const toggle=document.querySelector('.toggle');
toggle.addEventListener('click',()=>{
  const open=toggle.dataset.open!=='1';
  document.querySelectorAll('.module').forEach(d=>{d.open=open});
  toggle.dataset.open=open?'1':'0';toggle.textContent=open?'全部收合':'全部展開';
});
const byName=n=>canvas.querySelector('.stage[data-stage="'+n+'"]');
function point(el,side,base){
  const r=el.getBoundingClientRect(),x=r.left-base.left,y=r.top-base.top;
  return side==='r'?[x+r.width,y+Math.min(r.height/2,60)]:side==='l'?[x,y+Math.min(r.height/2,60)]:side==='t'?[x+r.width/2,y]:[x+r.width/2,y+r.height];
}
function draw(){
  if(getComputedStyle(svg).display==='none')return;
  const base=canvas.getBoundingClientRect();
  let out='<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9" fill="none" stroke="var(--wire)" stroke-width="1.6"/></marker></defs>';
  for(const [from,to,fs,ts,label,dash] of LINKS){
    const a=byName(from),b=byName(to);if(!a||!b)continue;
    const [x1,y1]=point(a,fs,base),[x2,y2]=point(b,ts,base);
    let d,lx,ly;
    if(fs==='t'&&ts==='t'){const top=Math.min(y1,y2)-30;d='M'+x1+' '+y1+' C'+x1+' '+top+' '+x2+' '+top+' '+x2+' '+y2;lx=(x1+x2)/2;ly=top+8;}
    else if(fs==='b'){const m=(y1+y2)/2;d='M'+x1+' '+y1+' C'+x1+' '+m+' '+x2+' '+m+' '+x2+' '+y2;lx=x1+8;ly=m;}
    else{const m=(x1+x2)/2;d='M'+x1+' '+y1+' C'+m+' '+y1+' '+m+' '+y2+' '+x2+' '+y2;lx=m;ly=(y1+y2)/2-6;}
    out+='<path d="'+d+'" class="'+(dash?'dash':'')+'" marker-end="url(#arrow)"/>';
    if(label)out+='<text x="'+lx+'" y="'+ly+'" text-anchor="'+(fs==='b'?'start':'middle')+'">'+label+'</text>';
  }
  svg.innerHTML=out;
}
new ResizeObserver(draw).observe(canvas);
document.addEventListener('toggle',()=>requestAnimationFrame(draw),true);
draw();
})();
`;

