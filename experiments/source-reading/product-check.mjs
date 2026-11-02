// 試作：正式程式跑兩份考卷（都不是盲測了），確認和定稿的合併版沒有變差。評分邏輯從 judge.mjs 取。
//   node experiments/source-reading/product-check.mjs "$(pwd)"
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const load = file => import(pathToFileURL(root + '/' + file).href);
const { sourceLinks, headingKey, codeKey, termKey } = await load('src/core/deck/index.ts');
const { readMerged, unitKey } = await load('experiments/source-reading/readers-merged.mjs');
const { readFable } = await load('experiments/source-reading/readers-fable.mjs');
const { CONTEXTS } = await load('experiments/source-reading/readers.mjs');

const PLACE = { p: 'page', fig: 'figure', tab: 'table', ex: 'example' };
function placeOf(link, scope) {
  if (link.kind === 'block') { const m = /^(p|fig|tab|ex)(.+)$/.exec(link.id); return { scope, kind: PLACE[m[1]], value: m[2] }; }
  if (link.kind === 'note') return { scope, kind: 'note', value: link.link };
  if (link.kind === 'heading') return { scope, kind: 'heading', value: link.heading };
  return null;
}
function reader(ctx) {
  return text => {
    const [term, code] = ctx.self.split(' ');
    const own = { term, subject: ctx.subject, unit: { code } };
    const out = { units: [], places: [], hint: false };
    const find = (t, c) => Object.keys(ctx.units).find(k => { const [a, b] = k.split(' '); return termKey(a) === termKey(t) && codeKey(b) === codeKey(c); });
    for (const item of sourceLinks([text], own)) {
      if (item.problem) out.hint = true;
      const { link } = item;
      if (link.kind === 'heading') {
        const hit = ctx.headings.find(h => headingKey(h) === headingKey(link.heading));
        if (hit) out.places.push({ scope: 'this', kind: 'heading', value: hit });
        else if (!item.remark) out.hint = true;
      } else if (link.kind === 'unit') {
        const hit = find(link.term, link.unit);
        const key = hit ?? `${link.term} ${link.unit}`;
        if (key !== ctx.self && !out.units.includes(key)) out.units.push(key);
        if (!hit && item.needsUnit) out.hint = true;
        const scope = key === ctx.self ? 'this' : key;
        if (link.rest?.kind === 'heading') {
          const list = ctx.unitHeadings?.[key] ?? [];
          const heading = list.find(h => headingKey(h) === headingKey(link.rest.heading));
          if (heading) out.places.push({ scope, kind: 'heading', value: heading });
          else if (!hit || headingKey(ctx.units[hit] ?? '') !== headingKey(link.rest.heading)) { if (hit) out.hint = true; }
        } else if (link.rest) out.places.push(placeOf(link.rest, scope));
      } else if (link.kind !== 'text') out.places.push(placeOf(link, 'this'));
    }
    return out;
  };
}
const product = (text, ctx) => reader(ctx)(text);
product.key = unitKey;

const source = readFileSync(root + '/experiments/source-reading/judge.mjs', 'utf8');
const body = source.slice(source.indexOf('function placeId('), source.indexOf('const PATHS'));
for (const file of ['exam-2.json', 'exam-1.json']) {
  const raw = JSON.parse(readFileSync(`${root}/experiments/source-reading/${file}`, 'utf8'));
  const contexts = raw.contexts ?? CONTEXTS;
  const cases = (raw.cases ?? raw).map(one => one.readings ? one : { ...one, readings: [{ units: one.units ?? [], places: one.places ?? [] }, ...(one.alt ?? []).map(each => ({ units: each.units ?? [], places: each.places ?? [] }))] });
  const { score } = new Function('judgeKey', 'contexts', 'readFable', 'unitKey', body + '; return { score };')(unitKey, contexts, readFable, unitKey);
  const tally = r => { const c = {}; for (const one of cases) { const s = score(r, one); c[s.path] = (c[s.path] ?? 0) + 1; for (const f of new Set(s.safety)) c['歸屬:' + f] = (c['歸屬:' + f] ?? 0) + 1; } return c; };
  console.log(`\n=== ${file}`);
  console.log('定稿合併版', JSON.stringify(tally(readMerged)));
  console.log('正式程式  ', JSON.stringify(tally(product)));
  const silent = cases.filter(one => score(product, one).safety.length);
  console.log('正式程式的歸屬錯：');
  for (const one of silent) console.log(`  ${JSON.stringify(one.text)} ${score(product, one).path} ${JSON.stringify(score(product, one).safety)} 讀 ${JSON.stringify(score(product, one).read.units)}${one.disputed ? ' 〔有爭議〕' : ''}`);
  const worse = cases.filter(one => score(readMerged, one).path === '沒提示就對' && score(product, one).path !== '沒提示就對');
  console.log('比合併版退步：', worse.map(one => `${one.text}[${score(product, one).path}]`).join('｜'));
  const better = cases.filter(one => score(readMerged, one).path !== '沒提示就對' && score(product, one).path === '沒提示就對');
  console.log('比合併版進步：', better.map(one => one.text).join('｜'));
}
