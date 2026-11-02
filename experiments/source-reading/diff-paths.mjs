// 試作：把 judge.mjs 判定「互有勝負」時要交給使用者的逐題差異列出來。評分邏輯從 judge.mjs 取，不另外寫一份。
//   node experiments/source-reading/diff-paths.mjs experiments/source-reading/exam-2.json
import { readFileSync } from 'node:fs';
import { CONTEXTS } from './readers.mjs';
import { readMerged, unitKey } from './readers-merged.mjs';
import { readFable } from './readers-fable.mjs';
import { readSmall, readCurrent } from './readers.mjs';

const source = readFileSync(new URL('./judge.mjs', import.meta.url), 'utf8');
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const contexts = raw.contexts ?? CONTEXTS;
const cases = raw.cases;
const body = source.slice(source.indexOf('function placeId('), source.indexOf('const PATHS'));
const { score, suggest, bestOf } = new Function('judgeKey', 'contexts', 'readFable', 'unitKey', body + '; return { score, suggest, bestOf };')(unitKey, contexts, readFable, unitKey);

const shortRead = read => `${JSON.stringify(read.units)} ${read.places.map(p => `${p.scope === 'this' ? '' : p.scope + ':'}${p.kind}${p.value}`).join(' ')}${read.hint ? ' ⚠' : ''}`;
const answer = one => one.readings.map(r => `${JSON.stringify(r.units)} ${(r.places ?? []).map(p => `${p.scope === 'this' ? '' : p.scope + ':'}${p.kind}${p.value}`).join(' ')}`).join(' ／ ');
const line = (one, name, reader) => { const r = score(reader, one); return `   ${name} ${r.path}${r.safety.length ? '（' + r.safety.join('、') + '）' : ''}：${shortRead(r.read)}`; };

const SAFE = /默默|已多算|按套用/;
const print = (title, list, readers) => {
  console.log(`\n=== ${title}（${list.length}）`);
  for (const one of list) {
    console.log(`#${one.id} ${one.group} ${one.context} ${JSON.stringify(one.text)}${one.disputed ? ' 〔有爭議〕' : ''}\n   答 ${answer(one)}`);
    for (const [name, reader] of readers) console.log(line(one, name, reader));
  }
};
const both = [['合併', readMerged], ['Fable', readFable]];
const path = (reader, one) => score(reader, one);

print('歸屬：合併版有錯（默默、提示仍算、按套用）', cases.filter(one => path(readMerged, one).safety.length), both);
print('歸屬：Fable 定稿比合併版多的錯', cases.filter(one => path(readFable, one).safety.length && !path(readMerged, one).safety.length), both);
print('家長：Fable 沒提示就對，合併版要提示', cases.filter(one => path(readFable, one).path === '沒提示就對' && path(readMerged, one).path !== '沒提示就對' && !path(readMerged, one).safety.length), both);
print('家長：合併版沒提示就對，Fable 要提示或位置錯', cases.filter(one => path(readMerged, one).path === '沒提示就對' && path(readFable, one).path !== '沒提示就對'), both);

// 依判斷依據看「提示後要手改」：表單先填用的建議引擎不看索引，這一列會高估。
console.log('\n=== 提示後要手改，依判斷依據');
for (const [name, reader] of [['小修', readSmall], ['合併', readMerged], ['Fable', readFable]]) {
  const tally = {};
  for (const one of cases) if (score(reader, one).path === '提示後要手改') { const key = [...new Set(one.evidence)].join('＋'); tally[key] = (tally[key] ?? 0) + 1; }
  console.log(name.padEnd(6), JSON.stringify(tally));
}
// 事後估算（不是盲測）：沒寫學期的編號補上本篇的學期，目錄有才先填。
const withOwnTerm = (one, ctx) => {
  const proposal = suggest(one.text, ctx);
  const term = ctx.self.split(' ')[0];
  const filled = readMerged(`${term} ${one.text}`, ctx);
  const known = filled.units.length && filled.units.every(unit => Object.keys(ctx.units).some(each => unitKey(each) === unitKey(unit)));
  return known && !filled.hint ? filled : proposal;
};
for (const [name, reader] of [['小修', readSmall], ['合併', readMerged], ['Fable', readFable]]) {
  let solved = 0, total = 0, wrong = 0;
  for (const one of cases) {
    if (score(reader, one).path !== '提示後要手改') continue;
    total++;
    const ctx = contexts[one.context], after = bestOf(withOwnTerm(one, ctx), one, ctx);
    if (after.extra.length) wrong++;
    else if (!after.missing.length && !after.lost.length && !after.wrong.length) solved++;
  }
  console.log(`${name.padEnd(6)}手改 ${total} 題裡，表單看目錄補學期就對 ${solved} 題，補錯單元 ${wrong} 題`);
}
