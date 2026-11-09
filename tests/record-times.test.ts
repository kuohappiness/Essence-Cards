import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import type { MemoryFiles } from './helpers/memory-files.ts';

// 紀錄的時間不重號（tasks/record-gaps.md §4）：undo 用 t 認人，新的一行不能和舊紀錄裡用來認人的 t 相同。
const DECK = 'Essence Cards/A（卡片）.md';
const OWN = 'Essence Cards/紀錄/2026-10 Windows-2c9e.jsonl';
const goal = (id: string): string => `- 能說明 ${id} ^${id}\n    - 題目 ${id} :: 答案 ${id}\n`;
const answer = { lt: 'aaaaaa', r: 'good', v: '12345678' } as const;
const T = '2026-10-24T19:00:00.000+08:00';
const NEXT = '2026-10-24T19:00:00.001+08:00';

function launch(t: TestContext, memory: MemoryFiles, at: number) {
  const state = createState({ files: memory.files, device: 'Windows-2c9e', delay: 30, fillIds: false, now: () => at, offset: () => 480 });
  t.after(() => state.close());
  return state;
}

void test('§4 重開後時鐘回到某一筆作答的同一毫秒：新一行加 1 毫秒，undo 只取消指定的那一筆', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa') });
  const first = launch(t, memory, Date.parse(T) - 60_000);
  await first.ready();
  await first.close();
  memory.append(OWN, JSON.stringify({ t: T, lt: 'aaaaaa', r: 'miss', v: '12345678' }));
  const second = launch(t, memory, Date.parse(T));
  await second.ready();
  assert.equal(second.answer(answer), NEXT);
  assert.equal(second.answer({ undo: NEXT }), '2026-10-24T19:00:00.002+08:00');
  await second.flush();
  assert.deepEqual(second.history().reviews.map(review => [review.t, review.r]), [[T, 'miss']]);
  assert.deepEqual(second.history().cancelled, [NEXT]);
});

void test('§4 舊的 undo 指向一個已經不存在的 t，新作答撞到它：新一行加 1 毫秒，新作答沒有被取消', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa'), [OWN]: JSON.stringify({ t: '2026-10-20T19:00:00.000+08:00', undo: T }) + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.equal(state.answer(answer), NEXT);
  assert.deepEqual(state.history().reviews.map(review => review.t), [NEXT]);
});

void test('§4 被取消的作答的 t 也避開：reviews 已經沒有它', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa'), [OWN]: JSON.stringify({ t: T, lt: 'aaaaaa', r: 'miss', v: '12345678' }) + '\n' + JSON.stringify({ t: '2026-10-24T18:00:00.000+08:00', undo: T }) + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.deepEqual(state.history().reviews, []);
  assert.equal(state.answer(answer), NEXT);
  assert.equal(state.history().reviews.length, 1);
});

void test('§4 變更行的 t 也避開；連續撞到就一直往後加', async t => {
  const line = (ms: number): string => JSON.stringify({ t: `2026-10-24T19:00:00.00${String(ms)}+08:00`, set: 'cap', val: 30 });
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa'), [OWN]: [0, 1, 2].map(line).join('\n') + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.equal(state.answer(answer), '2026-10-24T19:00:00.003+08:00');
});

void test('§4 舊紀錄有一筆 2030 年的時間：新一行用現在的時間，不被推到未來', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa'), [OWN]: JSON.stringify({ t: '2030-01-01T00:00:00.000+08:00', lt: 'bbbbbb', r: 'good', v: '12345678' }) + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.equal(state.answer(answer), T);
});

void test('§4 取消行自己的 t 不用避開：沒有東西用它認人', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa'), [OWN]: JSON.stringify({ t: T, undo: '2026-10-20T19:00:00.000+08:00' }) + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.equal(state.answer(answer), T);
});
