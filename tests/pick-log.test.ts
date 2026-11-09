import test from 'node:test';
import assert from 'node:assert/strict';
import { appendLine, encodeEntry, mergeHistory, parseLine } from '../src/core/study/index.ts';
import type { ReviewEntry } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { Harness } from './helpers/pick-session.ts';
import { DECK, CHARS, PC, rights, setup } from './helpers/pick-session.ts';
import { withBaseline } from './helpers/observed.ts';

// 比較卡的紀錄（tasks/question-type-seam.md §4）。預期值是任務說明的例子，字面比較。
const T = '2026-11-05T20:15:03.250+08:00';
const T2 = '2026-11-05T20:15:03.251+08:00';
const review = (line: string): ReviewEntry => {
  const entry = parseLine(line);
  assert.ok(entry && entry.kind === 'review', line);
  return entry;
};

void test('欄位順序 t、lt、r、v、pick、retry、also、with', () => {
  assert.equal(encodeEntry(T, { lt: '寨的ID', r: 'near', v: 'a1b2c3d4', pick: '塞', retry: 'right' }),
    `{"t":"${T}","lt":"寨的ID","r":"near","v":"a1b2c3d4","pick":"塞","retry":"right"}`);
  assert.equal(encodeEntry(T2, { lt: '塞的ID', r: 'good', v: '9f0e1d2c', pick: '塞', with: T }),
    `{"t":"${T2}","lt":"塞的ID","r":"good","v":"9f0e1d2c","pick":"塞","with":"${T}"}`);
  assert.equal(encodeEntry(T2, { lt: 'b', r: 'near', v: '5e6f7a8b', pick: 'lend', retry: 'right', also: [{ v: '0c1d2e3f', r: 'good', pick: 'borrow' }], with: T }),
    `{"t":"${T2}","lt":"b","r":"near","v":"5e6f7a8b","pick":"lend","retry":"right","also":[{"v":"0c1d2e3f","r":"good","pick":"borrow"}],"with":"${T}"}`);
});

void test('第一次按沒印象是 pick: null、沒有 retry，最上層與 also 各一次；點了 ？ 是字串，分得開', () => {
  assert.equal(encodeEntry(T, { lt: 'a', r: 'miss', v: '77aa1c0e', pick: null }), `{"t":"${T}","lt":"a","r":"miss","v":"77aa1c0e","pick":null}`);
  assert.equal(encodeEntry(T, { lt: 'a', r: 'miss', v: '77aa1c0e', pick: null, also: [{ v: '11111111', r: 'miss', pick: null }] }),
    `{"t":"${T}","lt":"a","r":"miss","v":"77aa1c0e","pick":null,"also":[{"v":"11111111","r":"miss","pick":null}]}`);
  assert.equal(encodeEntry(T, { lt: 'a', r: 'good', v: '77aa1c0e', pick: '？' }), `{"t":"${T}","lt":"a","r":"good","v":"77aa1c0e","pick":"？"}`);
});

void test('also 的格帶 retry 時放在 pick 後面；空的 also 不寫；舊的兩種題型一字不變', () => {
  assert.equal(encodeEntry(T, { lt: 'a', r: 'miss', v: 'v1', pick: '塞', retry: 'wrong', also: [{ v: 'v2', r: 'near', pick: '寒', retry: 'right' }] }),
    `{"t":"${T}","lt":"a","r":"miss","v":"v1","pick":"塞","retry":"wrong","also":[{"v":"v2","r":"near","pick":"寒","retry":"right"}]}`);
  assert.equal(encodeEntry(T, { lt: 'a', r: 'good', v: 'v1', pick: '塞', also: [] }), `{"t":"${T}","lt":"a","r":"good","v":"v1","pick":"塞"}`);
  assert.equal(encodeEntry(T, { lt: 'a', r: 'good', v: 'v1' }), `{"t":"${T}","lt":"a","r":"good","v":"v1"}`);
  assert.equal(encodeEntry(T, { lt: 'a', r: 'near', v: 'v1', typed: 'wrong', retry: 'right', src: 'check' }), `{"t":"${T}","lt":"a","r":"near","v":"v1","typed":"wrong","retry":"right","src":"check"}`);
});

void test('parseLine 多讀 with、also 的 v；pick、retry 與 also 的其他欄位不讀', () => {
  const line = `{"t":"${T2}","lt":"b","r":"near","v":"5e6f7a8b","pick":"lend","retry":"right","also":[{"v":"0c1d2e3f","r":"good","pick":"borrow"}],"with":"${T}"}`;
  assert.deepEqual(parseLine(line), { kind: 'review', t: T2, at: Date.parse(T2), offset: 480, lt: 'b', r: 'near', v: '5e6f7a8b', typed: null, src: null, with: T, also: ['0c1d2e3f'] });
});

void test('with 不是字串、also 形狀不對：當沒有，舊測試的欄位不多', () => {
  const plain = { kind: 'review', t: T, at: Date.parse(T), offset: 480, lt: 'a', r: 'good', v: 'v1', typed: null, src: null };
  for (const extra of ['"with":3', '"with":null', '"also":3', '"also":"x"', '"also":[]', '"also":[3]', '"also":[{"r":"good"}]', '"also":[{"v":3}]', '"also":[{"v":"x"},null]']) {
    assert.deepEqual(parseLine(`{"t":"${T}","lt":"a","r":"good","v":"v1",${extra}}`), plain, extra);
  }
});

const base = `"lt":"a","r":"good","v":"v1"`;
const reviews = (...lines: string[]): number => mergeHistory([{ path: 'Essence Cards/紀錄/2026-11 A.jsonl', text: lines.join('\n') + '\n' }], null).reviews.length;
const line = (extra = ''): string => `{"t":"${T}",${base}${extra}}`;

void test('sameReview：逐字相同的副本算一筆，also 不同算兩筆，with 不同或一有一沒有算兩筆，同集合異順序與空陣列相同，pick、retry 不比', () => {
  assert.equal(reviews(line(), line()), 1);
  assert.equal(reviews(line(',"also":[{"v":"x"}]'), line(',"also":[{"v":"y"}]')), 2);
  assert.equal(reviews(line(',"also":[{"v":"x"}]'), line()), 2);
  assert.equal(reviews(line(`,"with":"${T}"`), line(`,"with":"${T2}"`)), 2);
  assert.equal(reviews(line(`,"with":"${T}"`), line()), 2);
  assert.equal(reviews(line(',"also":[{"v":"x"},{"v":"y"}]'), line(',"also":[{"v":"y"},{"v":"x"}]')), 1);
  assert.equal(reviews(line(',"also":[]'), line()), 1);
  assert.equal(reviews(line(',"pick":"塞"'), line(',"pick":"寨","retry":"right"')), 1);
});

void test('有效的集合不看讀檔順序：mergeHistory 兩種順序、appendLine 增量都相同', () => {
  const A = line(`,"with":"${T2}"`), B = line(), C = line(',"also":[{"v":"x"}]');
  const key = (entries: readonly ReviewEntry[]): string[] => entries.map(entry => JSON.stringify([entry.with ?? null, entry.also ?? []])).sort();
  const one = mergeHistory([{ path: 'Essence Cards/紀錄/2026-11 A.jsonl', text: [A, B].join('\n') + '\n' }, { path: 'Essence Cards/紀錄/2026-11 B.jsonl', text: [C, A].join('\n') + '\n' }], null);
  const two = mergeHistory([{ path: 'Essence Cards/紀錄/2026-11 B.jsonl', text: [C, A].join('\n') + '\n' }, { path: 'Essence Cards/紀錄/2026-11 A.jsonl', text: [A, B].join('\n') + '\n' }], null);
  assert.deepEqual(key(one.reviews), key(two.reviews));
  assert.equal(one.reviews.length, 3);
  let grown = mergeHistory([], null);
  for (const each of [A, B, C, A]) grown = appendLine(grown, each);
  assert.deepEqual(key(grown.reviews), key(one.reviews));
  assert.equal(review(A).with, T2);
});

// 第一行已落盤、後面的行暫時寫不進去（§11）：對照組是同樣的時間、沒有失敗。
const LAST_OF_MONTH = Date.parse('2026-10-31T23:59:50.000+08:00');
const NEXT_MONTH = Date.parse('2026-11-01T00:00:05.000+08:00');
async function answerAll(h: Harness): Promise<void> {
  h.clock.now = LAST_OF_MONTH;
  const s = await h.open({ subject: '國語' });
  rights(h, s);
  h.clock.now += 1000;
  assert.equal(s.rate('good'), true);
}
void test('第一行已落盤、第二行暫時失敗：跨到下個月才重試，路徑還是原本的 t；重開重併的行與結果固定', async t => {
  const steady = await setup(t, await withBaseline({ [DECK]: CHARS }, 'PC-test'));
  await answerAll(steady);
  await steady.state.flush();
  const expected = steady.texts.get(PC) ?? '';
  assert.equal(expected.split('\n').filter(Boolean).length, 4, '對照組：一個字一行');

  const h = await setup(t, await withBaseline({ [DECK]: CHARS }, 'PC-test'));
  const original = h.files.append.bind(h.files);
  let calls = 0;
  h.files.append = (file, line) => ++calls === 2 ? Promise.reject(Error('暫時失敗')) : original(file, line);
  await answerAll(h);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal((h.texts.get(PC) ?? '').split('\n').filter(Boolean).length, 1, '只有第一行落盤');

  h.clock.now = NEXT_MONTH;
  await h.state.flush();
  assert.equal(h.texts.get(PC), expected, '和沒有失敗時逐字相同：順序、t、with 都沒變');
  assert.equal(h.texts.has('Essence Cards/紀錄/2026-11 PC-test.jsonl'), false, '後面的行不跟著現在的時間跑到下個月的檔');

  const lines = expected.split('\n').filter(Boolean).map(line => JSON.parse(line) as { t: string; with?: string });
  assert.deepEqual(lines.map(line => line.with), [undefined, lines[0].t, lines[0].t, lines[0].t], '第一行還是第一行');

  const reopened = createState({ files: h.files, device: 'PC-test', delay: 30, fillIds: false, now: () => h.clock.now, offset: () => 480 });
  t.after(() => reopened.close());
  await reopened.ready();
  assert.equal(h.texts.get(PC), expected, '重開不多寫');
  assert.deepEqual(reopened.progress(), h.state.progress(), '重開重併的結果相同');
  const merged = mergeHistory([{ path: PC, text: expected }], null);
  let grown = mergeHistory([], null);
  for (const line of expected.split('\n').filter(Boolean)) grown = appendLine(grown, line);
  assert.deepEqual(grown.reviews, merged.reviews, 'mergeHistory 與 appendLine 相同');
  assert.deepEqual(merged.reviews.map(entry => entry.t), lines.map(line => line.t));
});

// main 的黏行救回（syntax §5-2）碰上比較卡的欄位：一批通常是一秒內連續寫的幾行，最可能接在同一行。
const LOG = 'Essence Cards/紀錄/2026-11 A.jsonl';
const merged = (text: string) => mergeHistory([{ path: LOG, text }], null);
const ROW1 = `{"t":"${T}","lt":"a","r":"near","v":"v1","pick":"塞","retry":"right"}`;
const ROW2 = `{"t":"${T2}","lt":"b","r":"good","v":"v2","pick":"塞","also":[{"v":"v3","r":"good","pick":"寒"}],"with":"${T}"}`;

void test('一批黏在同一行：每一筆都讀回來，with 與 also 都在，巢狀的 also 不算一筆', () => {
  const history = merged(`${ROW1}${ROW2}\n`);
  assert.deepEqual(history.reviews, [review(ROW1), review(ROW2)]);
  assert.equal(history.reviews[1].with, T);
  assert.deepEqual(history.reviews[1].also, ['v3']);
  assert.deepEqual(history.problems.map(problem => problem.line), [0]);
});

void test('前一筆寫到一半、後一筆接在後面：救回的是完整的那一筆，with 指到的第一筆不在也照讀', () => {
  const history = merged(`${ROW1.slice(0, 30)}${ROW2}\n`);
  assert.deepEqual(history.reviews, [review(ROW2)]);
  assert.deepEqual(history.seen, ['b']);
});

void test('字鍵的字長得像紀錄的開頭：不會被當成一筆', () => {
  const row = `{"t":"${T2}","lt":"b","r":"good","v":"v2","pick":${JSON.stringify('{"t":"x"}')},"with":"${T}"}`;
  assert.deepEqual(merged(`${ROW1}${row}\n`).reviews, [review(ROW1), review(row)]);
});

void test('回看改評分的取消黏在同一行：兩筆都取消', () => {
  const undo = (t: string, of: string): string => `{"t":"${t}","undo":"${of}"}`;
  const later = '2026-11-05T20:15:04.000+08:00', later2 = '2026-11-05T20:15:04.001+08:00';
  assert.deepEqual(merged(`${ROW1}\n${ROW2}\n${undo(later, T)}${undo(later2, T2)}\n`).reviews, []);
});
