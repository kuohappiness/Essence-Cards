import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state/index.ts';
import type { StateOptions } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import type { MemoryFiles } from './helpers/memory-files.ts';

// 讀到不完整內容的防線（tasks/record-gaps.md §3、D-154 第 4 點）：含 NUL 的文字當成讀不到，不採用、不解析、不寫回。
const DELAY = 30;
const DECK = 'Essence Cards/A（卡片）.md';
const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
const EXAM = 'Essence Cards/考試範圍/2026-10-28 國二上.md';
const goal = (id: string): string => `- 能說明 ${id} ^${id}\n    - 題目 ${id} :: 答案 ${id}\n`;
const review = (t: string): string => JSON.stringify({ t, lt: 'aaaaaa', r: 'good', v: '12345678' });
const T0 = '2026-10-20T19:00:00.000+08:00';
const NOW = Date.parse('2026-10-24T19:00:00.000+08:00');

async function setup(t: TestContext, memory: MemoryFiles, options: Partial<StateOptions> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors: unknown[] = [];
  const state = createState({ files: memory.files, device: 'Windows-2c9e', delay: DELAY, fillIds: false, now: () => NOW, offset: () => 480, onError: error => { errors.push(error); }, ...options });
  t.after(() => state.close());
  const tick = async (ms: number): Promise<void> => { t.mock.timers.tick(ms); await new Promise<void>(resolve => setImmediate(resolve)); };
  let ready = false;
  void state.ready().then(() => { ready = true; });
  for (let i = 0; i < 20 && !ready; i++) await tick(2000);
  return { state, tick, errors };
}
const ids = (state: ReturnType<typeof createState>): string[] => state.decks().flatMap(entry => entry.deck.targets.map(target => String(target.id)));

void test('§3 卡組讀到含 NUL 的文字：進 unread，內容與 ID 照舊；下一次讀到正常內容後恢復', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa') });
  const { state, tick, errors } = await setup(t, memory);
  assert.deepEqual(ids(state), ['aaaaaa']);
  memory.write(DECK, goal('aaaaaa') + '\0\0\0');
  await tick(DELAY);
  assert.deepEqual(state.unread(), [DECK]);
  assert.deepEqual(ids(state), ['aaaaaa']);
  assert.equal(errors.length, 1);
  memory.texts.set(DECK, goal('aaaaaa') + goal('bbbbbb'));
  await tick(1000);
  assert.deepEqual(state.unread(), []);
  assert.deepEqual(ids(state), ['aaaaaa', 'bbbbbb']);
});

void test('§3 編輯器交出含 NUL 的文字：存檔、改狀態都不解析、不改字、不寫回，回 unread', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa') });
  const { state, tick } = await setup(t, memory, { fillIds: true, random: () => 0.31 });
  const bad = goal('aaaaaa') + '- 新目標\n    - 新問 :: 新答\n\0';
  let touched = 0;
  const editor = { path: DECK, text: () => bad, apply: () => { touched++; return true; }, persist: () => { touched++; return Promise.resolve(); } };
  for (const run of [() => state.save(editor), () => state.setDeckStatus(DECK, '暫停', editor)]) {
    const result = run();
    await tick(0);
    assert.deepEqual(await result, { kind: 'blocked', reason: 'unread' });
  }
  assert.equal(touched, 0);
  assert.equal(memory.texts.get(DECK), goal('aaaaaa'));
  assert.deepEqual(ids(state), ['aaaaaa']);
});

void test('§3 第一次載入就讀到含 NUL 的卡組：不解析，補齊後才有', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa') + '\0' });
  const { state, tick } = await setup(t, memory);
  assert.deepEqual(state.unread(), [DECK]);
  assert.deepEqual(ids(state), []);
  memory.texts.set(DECK, goal('aaaaaa'));
  await tick(2000);
  assert.deepEqual(state.unread(), []);
  assert.deepEqual(ids(state), ['aaaaaa']);
});

void test('§3 紀錄讀到含 NUL 的文字：進 unread，problems 沒有多一行，補齊後作答才併進來', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa'), [PHONE]: review(T0) + '\n' });
  const { state, tick } = await setup(t, memory);
  assert.equal(state.history().reviews.length, 1);
  memory.write(PHONE, review(T0) + '\n' + '\0'.repeat(40));
  await tick(DELAY);
  assert.deepEqual(state.unread(), [PHONE]);
  assert.deepEqual(state.history().problems, []);
  assert.equal(state.history().reviews.length, 1);
  memory.texts.set(PHONE, review(T0) + '\n' + review('2026-10-21T19:00:00.000+08:00') + '\n');
  await tick(1000);
  assert.deepEqual(state.unread(), []);
  assert.deepEqual(state.history().problems, []);
  assert.equal(state.history().reviews.length, 2);
});

void test('§3 範圍檔讀到含 NUL 的文字：也當成讀不到', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa'), [EXAM]: '---\n考試識別碼: x7f3k2\n開始日期: 2026-10-28\n---\n- 國二上 自然 2\n\0' });
  const { state } = await setup(t, memory);
  assert.deepEqual(state.unread(), [EXAM]);
});

void test('§3 寫回的 modify 拿到含 NUL 的文字：檔案逐字不變，回報失敗', async t => {
  const memory = createMemoryFiles({ [DECK]: '---\n狀態: 啟用\n---\n' + goal('aaaaaa') });
  const { state } = await setup(t, memory, { fillIds: true });
  // 不送通知：state 不知道內容變了，要到 modify 的回呼才看到。
  const broken = '---\n狀態: 啟用\n---\n' + goal('aaaaaa') + '\0\0';
  memory.texts.set(DECK, broken);
  const result = await state.setDeckStatus(DECK, '暫停', null);
  assert.equal(result.kind, 'failed');
  assert.equal(memory.texts.get(DECK), broken);
});

void test('§3 AI 製卡直接讀的檔含 NUL：丟錯，不當成讀到了', async t => {
  const path = 'Essence Cards/紀錄/AI 輸出/x.md';
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa'), [path]: '內容\0' });
  const { state } = await setup(t, memory);
  await assert.rejects(state.aiRead(path), /不完整/);
});

void test('§3 append、list 不經過防線：作答照常寫', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa') });
  const { state } = await setup(t, memory);
  assert.ok(state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' }));
  await state.flush();
  assert.ok([...memory.texts.keys()].some(path => path.includes('Windows-2c9e.jsonl')));
});
