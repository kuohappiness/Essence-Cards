import test from 'node:test';
import assert from 'node:assert/strict';
import { appendLine, encodeEntry, mergeHistory, parseLine } from '../src/core/study/index.ts';
import type { ReviewEntry } from '../src/core/study/index.ts';

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
