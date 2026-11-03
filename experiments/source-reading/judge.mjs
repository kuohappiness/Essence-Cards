// 試作：第二版評分（討論稿〈Claude 回應第三輪〉）。安全先判，提示不免責，家長成本分開報。標準寫在 README，出考卷前定稿。
//   node experiments/source-reading/judge.mjs <考卷.json> [--list 讀法名稱]
// 考卷每題：{ id, context, text, readings: [{ units, places }], free, disputed, evidence, group }；舊格式（exam-1）用 units、places、alt 轉換。
// context 寫在考卷外層（新考卷）或用 readers.mjs 的 CONTEXTS（exam-1）。
import { readFileSync } from 'node:fs';
import { CONTEXTS, readCurrent, readSmall } from './readers.mjs';
import { readMerged, unitKey } from './readers-merged.mjs';
import { readFable } from './readers-fable.mjs';

/** 共同的單元鍵由裁判固定：全半形、大小寫不分；`L01` 與 `L1` 不同。候選自己的 key 不參與。 */
const judgeKey = unitKey;
const FORMAL = { 現在: readCurrent, 小修: readSmall, 合併: readMerged, Fable: readFable };

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const contexts = raw.contexts ?? CONTEXTS;
const cases = (raw.cases ?? raw).map(one => one.readings ? one : {
  ...one,
  readings: [{ units: one.units ?? [], places: one.places ?? [] }, ...(one.alt ?? []).map(each => ({ units: each.units ?? [], places: each.places ?? [] }))],
  free: !(one.units?.length || one.places?.length) && one.clear !== false,
  unsure: one.clear === false,
});
const listing = process.argv.includes('--list') ? process.argv[process.argv.indexOf('--list') + 1] : null;

// ── 意思的身分：連結與標題用原字，頁碼圖表用值；筆記連結不看 scope（它指的就是那份筆記）──

function placeId(place, ctx) {
  const scope = place.scope === 'this' || judgeKey(place.scope) === judgeKey(ctx.self) ? 'this' : judgeKey(place.scope);
  if (place.kind === 'note') return `note|${place.value}`;
  if (place.kind === 'heading') return `${scope}|heading|${place.value}`;
  return `${scope}|${place.kind}|${String(place.value).toLowerCase()}`;
}
const unitsOf = read => [...new Set(read.units.map(judgeKey))].sort();

function compare(read, reading, ctx) {
  const want = new Set(reading.units.map(judgeKey).filter(key => key !== judgeKey(ctx.self)));
  const got = unitsOf(read).filter(key => key !== judgeKey(ctx.self));
  const wantPlaces = reading.places.map(place => placeId(place, ctx)), gotPlaces = read.places.map(place => placeId(place, ctx));
  return {
    extra: got.filter(key => !want.has(key)),
    missing: [...want].filter(key => !got.includes(key)),
    lost: wantPlaces.filter(id => !gotPlaces.includes(id)),
    wrong: gotPlaces.filter(id => !wantPlaces.includes(id)),
  };
}
const weight = d => (d.extra.length + d.missing.length) * 100 + d.lost.length + d.wrong.length;
function bestOf(read, one, ctx) {
  return one.readings.map(reading => compare(read, reading, ctx)).reduce((a, b) => weight(b) < weight(a) ? b : a);
}

// ── 表單先填：同一個建議引擎給所有讀法，公平；只先填索引裡有的，或原文明寫的單元 ──

function suggest(text, ctx) {
  const read = readFable(text, ctx);
  const plain = unitKey(text);
  const named = key => Object.keys(ctx.units).some(each => judgeKey(each) === judgeKey(key));
  const literal = key => plain.includes(judgeKey(key).split(' ').slice(1).join(' ')) && plain.includes(judgeKey(key).split(' ')[0]);
  const units = read.units.filter(key => named(key) || literal(key));
  return { units, places: read.places.filter(place => place.scope === 'this' || units.some(key => judgeKey(key) === judgeKey(place.scope))), hint: false };
}

/** 把建議寫成標準字：本篇的先寫，每個單元的位置寫完整。正式讀法讀回來要是同一個意思。 */
function serialize(read) {
  const position = place => place.kind === 'page' ? `p.${place.value}` : place.kind === 'figure' ? `圖 ${place.value}` : place.kind === 'table' ? `表 ${place.value}` : place.kind === 'example' ? `例題 ${place.value}` : place.kind === 'note' ? `[[${place.value}]]` : `[[#${place.value}]]`;
  const own = read.places.filter(place => place.scope === 'this').map(position);
  const units = read.units.flatMap(unit => {
    const places = read.places.filter(place => place.scope !== 'this' && judgeKey(place.scope) === judgeKey(unit));
    return places.length ? places.map(place => `${unit} ${position(place)}`) : [unit];
  });
  return [...own, ...units].join('、');
}

/** 一題的路徑（互斥）與安全旗標。 */
function score(reader, one) {
  const ctx = contexts[one.context], read = reader(one.text, ctx), best = bestOf(read, one, ctx);
  const safety = [];
  for (const unit of best.extra) safety.push(read.hint ? '提示但已多算' : '默默多算');
  if (best.missing.length && !read.hint) safety.push('默默漏算');
  let path;
  const nothingWanted = one.readings.some(each => !each.units.length && !each.places.length);
  if (!read.hint) path = best.extra.length || best.missing.length ? '沒提示歸屬錯' : best.lost.length || best.wrong.length ? '沒提示位置錯' : '沒提示就對';
  else if (nothingWanted && !best.extra.length && !best.wrong.length) path = '提示本來就該（自由文字）';
  else {
    const proposal = suggest(one.text, ctx), after = bestOf(proposal, one, ctx);
    if (after.extra.length) { path = '按套用才歸錯'; safety.push('按套用才歸錯'); }
    else if (after.missing.length || after.lost.length || after.wrong.length) path = '提示後要手改';
    else if (!weight(best)) path = '提示但已讀對';
    else path = '提示後按一下就對';
  }
  // 放著不管的代價：有提示、不處理，還是缺單元。
  const ignored = read.hint && best.missing.length > 0;
  return { path, safety, ignored, read };
}

const PATHS = ['沒提示就對', '提示但已讀對', '提示後按一下就對', '提示後要手改', '提示本來就該（自由文字）', '沒提示位置錯', '沒提示歸屬錯', '按套用才歸錯'];
const SAFETY = ['默默多算', '默默漏算', '提示但已多算', '按套用才歸錯'];

function table(title, subset) {
  console.log(`\n== ${title}（${subset.length} 題）`);
  console.log('讀法'.padEnd(6) + PATHS.map(name => name.slice(0, 8)).join(' ｜ '));
  for (const [name, reader] of Object.entries(FORMAL)) {
    const counts = Object.fromEntries(PATHS.map(path => [path, 0]));
    for (const one of subset) counts[score(reader, one).path]++;
    console.log(name.padEnd(6) + PATHS.map(path => String(counts[path]).padStart(4)).join('      '));
  }
}

// ── 第 0 關：機械的安全（零違反）──

const CODE_HEADINGS = ['1-3', '1-3 溶液', '2-1', '2-1 水溶液', 'L1', 'L1 Greetings', 'Starter', '3-1', '3', 'p.20', '44', '圖 2-14'];
const STRESS = {
  清空索引: ctx => ({ ...ctx, units: {} }),
  索引順序反過來: ctx => ({ ...ctx, units: Object.fromEntries(Object.entries(ctx.units).reverse()) }),
  索引多一些單元: ctx => ({ ...ctx, units: { ...ctx.units, '國二上 Extension': '', '國二上 10-15': '', '小五上 Review': '', '國一上 A1': '' } }),
  清空標題: ctx => ({ ...ctx, headings: [] }),
  加像編號的標題: ctx => ({ ...ctx, headings: [...ctx.headings, ...CODE_HEADINGS] }),
};
console.log('== 第 0 關：索引與材料不能改歸屬（改變的題數，要 0）');
for (const [name, reader] of Object.entries(FORMAL)) {
  const line = Object.entries(STRESS).map(([label, change]) => {
    const ownText = one => { const ctx = contexts[one.context]; return [JSON.stringify(unitsOf(reader(one.text, ctx))), JSON.stringify(unitsOf(reader(one.text, change(ctx))))]; };
    const hits = cases.filter(one => { const [a, b] = ownText(one); return a !== b; });
    // 再加一種：材料裡有一個標題和這一題一字不差。
    return `${label} ${hits.length}`;
  });
  const same = cases.filter(one => { const ctx = contexts[one.context]; return JSON.stringify(unitsOf(reader(one.text, ctx))) !== JSON.stringify(unitsOf(reader(one.text, { ...ctx, headings: [...ctx.headings, one.text] }))); });
  console.log(name.padEnd(6) + line.join('、') + `、標題和原文相同 ${same.length}`);
}

console.log('\n== 第 0 關：同一個意思加打字雜訊，歸屬與位置不能變（改變的題數，要 0）');
const fullWidth = text => text.replace(/[0-9A-Za-z.,\-]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
const NOISE = {
  尾端空白: t => t + ' ', 開頭空白: t => ' ' + t, 連續空白: t => t.replace(/ /g, '  '), 全形空白: t => t.replace(/ /g, '　'),
  尾端逗號: t => t + ',', 尾端全形逗號: t => t + '，', 尾端句號: t => t + '。', 全形字: fullWidth, 破折號: t => t.replace(/-/g, '–'), 全形連字號: t => t.replace(/-/g, '－'),
  兩種: t => fullWidth(t).replace(/ /g, '　') + '，', 三種: t => (t + ' ,').replace(/-/g, '–').replace(/ (?=\S)/g, '  '),
};
const hasLink = text => /\[\[|\]\(|https?:/.test(text);
for (const [name, reader] of Object.entries(FORMAL)) {
  let total = 0, flips = 0; const samples = [];
  for (const one of cases) {
    if (hasLink(one.text) || one.group === 'B') continue;
    const ctx = contexts[one.context], base = reader(one.text, ctx);
    const key = read => JSON.stringify([unitsOf(read), read.places.map(place => placeId(place, ctx)).sort()]);
    for (const [label, apply] of Object.entries(NOISE)) {
      const changed = apply(one.text);
      if (changed === one.text) continue;
      total++;
      if (key(reader(changed, ctx)) !== key(base)) { flips++; if (samples.length < 4) samples.push(`${label}:${JSON.stringify(changed)}`); }
    }
  }
  console.log(`${name.padEnd(6)}${flips} / ${total}  ${samples.join(' ')}`);
}

console.log('\n== 第 0 關：建議寫成標準字，正式讀法讀回來要同一個意思（不符的題數，要 0）');
for (const [name, reader] of Object.entries(FORMAL)) {
  const bad = [];
  for (const one of cases) {
    const ctx = contexts[one.context], proposal = suggest(one.text, ctx);
    if (!proposal.units.length && !proposal.places.length) continue;
    const written = serialize(proposal), back = reader(written, ctx);
    if (JSON.stringify(unitsOf(back)) !== JSON.stringify(unitsOf(proposal))) bad.push(written);
  }
  console.log(`${name.padEnd(6)}${bad.length}  ${bad.slice(0, 3).map(each => JSON.stringify(each)).join(' ')}`);
}

// ── 安全與路徑 ──

console.log('\n== 第 1 關：歸屬錯（提示不免責）');
console.log('讀法'.padEnd(6) + SAFETY.join(' ｜ ') + ' ｜ 放著不管還缺單元');
for (const [name, reader] of Object.entries(FORMAL)) {
  const counts = Object.fromEntries(SAFETY.map(flag => [flag, 0])); let ignored = 0;
  for (const one of cases) { const result = score(reader, one); for (const flag of new Set(result.safety)) counts[flag]++; if (result.ignored) ignored++; }
  console.log(name.padEnd(6) + SAFETY.map(flag => String(counts[flag]).padStart(6)).join('     ') + '      ' + ignored);
}

table('第 2 關：每題走到哪裡（全部）', cases);
const agreed = cases.filter(one => !one.disputed);
if (agreed.length !== cases.length) table('只看兩位標答一致的題', agreed);
for (const context of Object.keys(contexts)) { const subset = cases.filter(one => one.context === context); if (subset.length) table(`情境 ${context}`, subset); }
for (const group of [...new Set(cases.map(one => one.group))].sort()) table(`${group} 組`, cases.filter(one => one.group === group));

if (listing) {
  console.log(`\n== ${listing} 逐題（沒提示就對以外）`);
  for (const one of cases) {
    const result = score(FORMAL[listing], one);
    if (result.path === '沒提示就對' || result.path === '提示本來就該（自由文字）') continue;
    console.log(`#${one.id} ${one.group ?? ''} ${JSON.stringify(one.text)} [${result.path}${result.safety.length ? '；' + result.safety.join('、') : ''}]\n   讀 ${JSON.stringify(result.read)}\n   答 ${JSON.stringify(one.readings)} ${one.note ?? ''}`);
  }
}
