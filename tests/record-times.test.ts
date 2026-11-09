import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import type { MemoryFiles } from './helpers/memory-files.ts';
import { withBaseline } from './helpers/observed.ts';

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
  const memory = createMemoryFiles({ ...await withBaseline({ [DECK]: goal('aaaaaa') }, 'Windows-2c9e'), [OWN]: JSON.stringify({ t: '2026-10-20T19:00:00.000+08:00', undo: T }) + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.equal(state.answer(answer), NEXT);
  assert.deepEqual(state.history().reviews.map(review => review.t), [NEXT]);
});

void test('§4 被取消的作答的 t 也避開：reviews 已經沒有它', async t => {
  const memory = createMemoryFiles({ ...await withBaseline({ [DECK]: goal('aaaaaa') }, 'Windows-2c9e'), [OWN]: JSON.stringify({ t: T, lt: 'aaaaaa', r: 'miss', v: '12345678' }) + '\n' + JSON.stringify({ t: '2026-10-24T18:00:00.000+08:00', undo: T }) + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.deepEqual(state.history().reviews, []);
  assert.equal(state.answer(answer), NEXT);
  assert.equal(state.history().reviews.length, 1);
});

void test('§4 變更行的 t 也避開；連續撞到就一直往後加', async t => {
  const line = (ms: number): string => JSON.stringify({ t: `2026-10-24T19:00:00.00${String(ms)}+08:00`, set: 'cap', val: 30 });
  const memory = createMemoryFiles({ ...await withBaseline({ [DECK]: goal('aaaaaa') }, 'Windows-2c9e'), [OWN]: [0, 1, 2].map(line).join('\n') + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.equal(state.answer(answer), '2026-10-24T19:00:00.003+08:00');
});

void test('§4 舊紀錄有一筆 2030 年的時間：新一行用現在的時間，不被推到未來', async t => {
  const memory = createMemoryFiles({ ...await withBaseline({ [DECK]: goal('aaaaaa') }, 'Windows-2c9e'), [OWN]: JSON.stringify({ t: '2030-01-01T00:00:00.000+08:00', lt: 'bbbbbb', r: 'good', v: '12345678' }) + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.equal(state.answer(answer), T);
});

void test('§4 取消行自己的 t 不用避開：沒有東西用它認人', async t => {
  const memory = createMemoryFiles({ ...await withBaseline({ [DECK]: goal('aaaaaa') }, 'Windows-2c9e'), [OWN]: JSON.stringify({ t: T, undo: '2026-10-20T19:00:00.000+08:00' }) + '\n' });
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.equal(state.answer(answer), T);
});

void test('§4 避開之後，增量併進去的結果和重讀一樣：作答、取消、變更都逐項相同', async t => {
  const memory = createMemoryFiles({ ...await withBaseline({ [DECK]: goal('aaaaaa') }, 'Windows-2c9e'), [OWN]: JSON.stringify({ t: T, undo: '2026-10-20T19:00:00.000+08:00' }) + '\n' + JSON.stringify({ t: '2026-10-24T18:00:00.000+08:00', undo: T }) + '\n' });
  const first = launch(t, memory, Date.parse(T));
  await first.ready();
  const undone = first.answer(answer);
  assert.equal(undone, NEXT);
  first.answer({ undo: NEXT });
  first.answer(answer);
  await first.flush();
  const reread = launch(t, memory, Date.parse(T));
  await reread.ready();
  assert.deepEqual(reread.history(), first.history());
});

// 這次啟動第一次讀不到自己的月檔時，舊的 undo 還看不到：這一刻記下的作答可能撞到它（L2 的 R4）。讀到之後補寫一筆新的 t，不漏掉。
const CANCELLED_T = JSON.stringify({ t: T, lt: 'aaaaaa', r: 'miss', v: '12345678' }) + '\n' + JSON.stringify({ t: '2026-10-24T18:00:00.000+08:00', undo: T }) + '\n';
async function blindRun(t: TestContext, disk: string) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const memory = createMemoryFiles({ ...await withBaseline({ [DECK]: goal('aaaaaa') }, 'Windows-2c9e'), [OWN]: disk });
  memory.failing.add(OWN);
  const state = launch(t, memory, Date.parse(T));
  await state.ready();
  assert.deepEqual(state.unread(), [OWN]);
  memory.failing.delete(OWN);
  const reread = async (): Promise<void> => {
    await state.flush();
    t.mock.timers.tick(1000);
    for (let i = 0; i < 15; i++) await new Promise<void>(resolve => setImmediate(resolve));
    await state.flush();
    assert.deepEqual(state.unread(), []);
  };
  const lines = (): Record<string, unknown>[] => (memory.texts.get(OWN) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  return { memory, state, reread, lines };
}

void test('§4 第一次讀不到月檔時撞到舊 undo 的 t：讀到之後補寫一筆新的 t，作答不漏，重開相同（L2 的 R4）', async t => {
  const { memory, state, reread, lines } = await blindRun(t, CANCELLED_T);
  assert.equal(state.answer(answer), T);
  await reread();
  assert.deepEqual(state.history().reviews.map(review => [review.t, review.r]), [[NEXT, 'good']]);
  assert.deepEqual(state.history().cancelled, [T]);
  assert.deepEqual(lines().filter(line => 'r' in line).map(line => line.t), [T, T, NEXT]);
  assert.equal(lines().filter(line => 'undo' in line).length, 1);
  await reread();
  assert.equal(lines().length, 4, '只補一次');
  const again = launch(t, memory, Date.parse(T) + 60_000);
  await again.ready();
  assert.deepEqual(again.history(), state.history());
});

void test('§4 撞到的那一筆這次自己取消了：不補寫（相鄰情況）', async t => {
  const { state, reread, lines } = await blindRun(t, CANCELLED_T);
  assert.equal(state.answer(answer), T);
  state.answer({ undo: T });
  await reread();
  assert.deepEqual(state.history().reviews, []);
  assert.equal(lines().filter(line => 'r' in line).length, 2);
});

void test('§4 第一次讀不到月檔、沒有撞到：讀到之後不多寫（相鄰情況）', async t => {
  const other = JSON.stringify({ t: '2026-10-24T18:00:00.000+08:00', lt: 'aaaaaa', r: 'miss', v: '12345678' }) + '\n';
  const { state, reread, lines } = await blindRun(t, other);
  assert.equal(state.answer(answer), T);
  await reread();
  assert.deepEqual(state.history().reviews.map(review => review.t), ['2026-10-24T18:00:00.000+08:00', T]);
  assert.equal(lines().length, 2);
});

void test('§4 一次讀不到的期間兩筆作答，只有一筆撞到：只補那一筆（相鄰情況）', async t => {
  const { state, reread, lines } = await blindRun(t, CANCELLED_T);
  assert.equal(state.answer(answer), T);
  assert.equal(state.answer(answer), NEXT);
  await reread();
  assert.deepEqual(state.history().reviews.map(review => review.t), [NEXT, '2026-10-24T19:00:00.002+08:00']);
  assert.equal(lines().filter(line => 'r' in line).length, 4);
});
