import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, review, replay, intervalDays, dueAt, recall, formatTime, mergeHistory } from '../src/core/study/index.ts';
import type { ReviewEntry, Memory, Rating } from '../src/core/study/index.ts';

const initial = '2026-10-16T20:15:03.250+08:00';
function entry(t: string, r: Rating, src?: string, lt = 'target'): ReviewEntry {
  const value = parseLine(JSON.stringify({ t, lt, r, v: '12345678', src }));
  assert.ok(value?.kind === 'review');
  return value;
}
function memory(...entries: ReviewEntry[]): Memory {
  let result: Memory | null = null;
  for (const entry of entries) result = review(result, entry);
  assert.ok(result);
  return result;
}

const c1 = entry(initial, 'miss');
const c2 = entry('2026-10-16T20:16:10.000+08:00', 'good');
const good = entry(initial, 'good');
const cases: { name: string; entries: ReviewEntry[]; s: number; d: number; intervals: number[]; due: string[] }[] = [
  { name: 'A', entries: [good], s: 2.3065, d: 2.1181, intervals: [8, 2], due: ['2026-10-24T04:00:00.000+08:00', '2026-10-18T04:00:00.000+08:00'] },
  { name: 'B', entries: [entry(initial, 'easy')], s: 8.2956, d: 1, intervals: [28, 8], due: ['2026-11-13T04:00:00.000+08:00', '2026-10-24T04:00:00.000+08:00'] },
  { name: 'C1', entries: [c1], s: .2120, d: 6.4133, intervals: [1, 1], due: ['2026-10-16T20:16:03.250+08:00', '2026-10-16T20:16:03.250+08:00'] },
  { name: 'C2', entries: [c1, c2], s: .2467, d: 6.4021, intervals: [1, 1], due: ['2026-10-17T04:00:00.000+08:00', '2026-10-17T04:00:00.000+08:00'] },
  { name: 'C3', entries: [c1, c2, entry('2026-10-18T19:00:00.000+08:00', 'good')], s: 2.6344, d: 6.3909, intervals: [9, 3], due: ['2026-10-27T04:00:00.000+08:00', '2026-10-21T04:00:00.000+08:00'] },
  { name: 'D', entries: [good, entry('2026-10-22T21:00:00.000+08:00', 'near')], s: .7012, d: 4.7529, intervals: [2, 1], due: ['2026-10-22T21:10:00.000+08:00', '2026-10-22T21:10:00.000+08:00'] },
  { name: 'D′', entries: [good, entry('2026-10-22T21:00:00.000+08:00', 'miss')], s: .7012, d: 7.3945, intervals: [2, 1], due: ['2026-10-22T21:01:00.000+08:00', '2026-10-22T21:01:00.000+08:00'] },
  { name: 'E', entries: [entry('2026-10-16T20:00:00.000+08:00', 'good'), entry('2026-10-17T03:59:00.000+08:00', 'good')], s: 2.3065, d: 2.1112, intervals: [8, 2], due: ['2026-10-24T04:00:00.000+08:00', '2026-10-18T04:00:00.000+08:00'] },
  { name: 'E′', entries: [entry('2026-10-16T20:00:00.000+08:00', 'good'), entry('2026-10-17T04:00:00.000+08:00', 'good')], s: 7.3153, d: 2.1112, intervals: [24, 7], due: ['2026-11-10T04:00:00.000+08:00', '2026-10-24T04:00:00.000+08:00'] },
  { name: 'F', entries: [good, entry('2026-10-21T19:02:11.020+08:00', 'miss', 'mistake')], s: .6826, d: 7.3945, intervals: [2, 1], due: ['2026-10-21T19:02:11.020+08:00', '2026-10-21T19:02:11.020+08:00'] },
  { name: 'G', entries: [entry('2026-10-16T03:30:00.000+09:00', 'good')], s: 2.3065, d: 2.1181, intervals: [8, 2], due: ['2026-10-23T04:00:00.000+09:00', '2026-10-17T04:00:00.000+09:00'] },
  { name: 'H', entries: [entry(initial, 'near')], s: .2120, d: 5.1122, intervals: [1, 1], due: ['2026-10-16T20:25:03.250+08:00', '2026-10-16T20:25:03.250+08:00'] },
];

for (const row of cases) void test('FSRS 規格驗算 ' + row.name, () => {
  const result = memory(...row.entries);
  assert.ok(Math.abs(result.stability - row.s) < .0001, String(result.stability));
  assert.ok(Math.abs(result.difficulty - row.d) < .0001, String(result.difficulty));
  assert.equal(result.last, row.entries.at(-1));
  assert.equal(result.reps, row.entries.length);
  [.8, .9].forEach((retention, i) => {
    assert.equal(intervalDays(result, retention), row.intervals[i]);
    assert.equal(formatTime(dueAt(result, retention), result.last.offset), row.due[i]);
  });
});

void test('recall 的獨立驗算、近於零與不允許負經過天數', () => {
  const m = memory(good);
  assert.equal(recall(m, good.at), 1);
  assert.equal(recall(m, good.at - 1), 1);
  assert.ok(Math.abs(recall(m, good.at + 3 * 86_400_000) - .8809) < .0001);
  const later = recall(m, good.at + 10000 * 86_400_000);
  assert.ok(later > 0 && later < .5);
});

void test('near 與 miss 的穩定度相同、難度不同，抽測與未知來源同樣更新記憶', () => {
  const before = memory(good);
  const near = review(before, entry('2026-10-22T21:00:00.000+08:00', 'near'));
  const miss = review(before, entry('2026-10-22T21:00:00.000+08:00', 'miss'));
  assert.equal(near.stability, miss.stability);
  assert.ok(near.difficulty < miss.difficulty);
  assert.equal(before.reps, 1);
  for (const src of ['check', 'future']) {
    const result = review(null, entry(initial, 'good', src));
    assert.equal(result.stability, before.stability);
    assert.equal(result.difficulty, before.difficulty);
    assert.equal(dueAt(result, .8), dueAt(before, .8));
  }
});

void test('跨裝置各用自己的 offset 算天；日序倒退當 0；長期間隔限制 1～36500', () => {
  const first = entry('2026-10-16T04:01:00+14:00', 'good');
  const next = entry('2026-10-16T03:59:00-12:00', 'good');
  const m = memory(first, next);
  assert.equal(m.stability, memory(first).stability);
  assert.ok(Math.abs(m.difficulty - 2.1112) < .0001);
  assert.equal(intervalDays({ ...m, stability: 0 }, .8), 1);
  assert.equal(intervalDays({ ...m, stability: 100000 }, .8), 36500);
});

void test('replay 分開目標，與逐筆 review 相同，交換來源順序不影響結果', () => {
  const entries = [good, entry('2026-10-17T20:15:03.250+08:00', 'near', undefined, 'other'), entry('2026-10-18T20:15:03.250+08:00', 'easy')];
  const source = (entry: ReviewEntry) => ({ path: entry.lt + entry.t, text: JSON.stringify(entry) });
  const a = mergeHistory(entries.map(source));
  const b = mergeHistory(entries.map(source).reverse());
  assert.deepEqual(replay(a.reviews), new Map([['target', memory(entries[0], entries[2])], ['other', memory(entries[1])]]));
  assert.deepEqual(replay(a.reviews), replay(b.reviews));
  assert.deepEqual(replay([]), new Map());
});
