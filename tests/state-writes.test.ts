import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { planToday } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { State, StateOptions } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// tasks/state-writes.md §8：state 的讀寫先後與寫入協調。只透過公開介面；記憶體 Files 與假計時器（技術債 A9）；
// random 固定為 0 時第一個配出的 ID 是 aaaaaa、下一個是 aaaaab。每個觀察點都斷言沒有預期以外的待處理問題，
// 最後斷言 today() 和 planToday(input()) 相同。
const DELAY = 500;
const P = 'Essence Cards/P.md';
const C = '- 能說明 C\n    - QC :: AC\n';
const Ca = '- 能說明 C ^aaaaaa\n    - QC :: AC\n';

const timed = new WeakSet<TestContext>();
interface Harness extends MemoryFiles {
  state: State;
  /** onChange 被呼叫的次數。 */
  changed: () => number;
  /** 讓 ms（預設剛好超過 delay）過去，並跑完排好的讀檔與重排。 */
  settle: (ms?: number) => Promise<void>;
  /** 跑完已經排好的 Promise（不推進時間）。 */
  flush: () => Promise<void>;
  /** 沒有待處理的問題。 */
  clean: (path?: string) => void;
  samePlan: () => void;
}
async function setup(t: TestContext, vault: Record<string, string>, options: Partial<StateOptions> = {}): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles(vault);
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480, ...options });
  t.after(() => state.close());
  await state.ready();
  let changes = 0;
  state.onChange(() => { changes++; });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  return {
    ...memory, state, flush,
    changed: () => changes,
    settle: async (ms = DELAY + 1) => { t.mock.timers.tick(ms); await flush(); },
    clean: (path = P) => { assert.deepEqual(state.deckStatus(path).issues, [], path + ' 有預期以外的待處理問題'); },
    samePlan: () => { assert.deepEqual(state.today(), planToday(state.input())); },
  };
}

// ---- §2、§3：寫入先讀完已知的待讀；讀取不跨過 Cards I/O（離開筆記的 fillIds） ----

for (const landed of ['舊文字', 'null', 'reject'] as const) void test('M1 fillIds：讀取停在半路時離開筆記，寫入等它落地才開始，不出現 lost：' + landed, async t => {
  const h = await setup(t, { [P]: C });
  h.notify(P);
  const held = h.holdRead(P);
  t.mock.timers.tick(DELAY + 1);
  await held.started;
  const filling = h.state.fillIds(P);
  await h.flush();
  assert.equal(h.texts.get(P), C, '讀取還沒落地就寫了');
  // reject：之後的重試也讀不到，直到拿掉 failing。
  if (landed === 'reject') h.failing.add(P);
  held.release(landed === '舊文字' ? undefined : landed === 'null' ? null : Error('讀不到'));
  if (landed === 'reject') {
    assert.equal(await filling, false);
    assert.equal(h.texts.get(P), C);
    assert.deepEqual(h.state.unread(), [P]);
    h.failing.delete(P);
    await h.settle(1000);
    assert.deepEqual(h.state.unread(), []);
    assert.equal(await h.state.fillIds(P), true);
  } else assert.equal(await filling, true);
  assert.equal(h.texts.get(P), Ca);
  await h.flush();
  h.clean();
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  await h.settle();
  h.clean();
  h.samePlan();
});

void test('S20 fillIds 版：寫入有結果之前不讀這一篇；有結果之後立刻讀一次', async t => {
  const h = await setup(t, { [P]: C });
  const held = h.holdModify(P);
  const filling = h.state.fillIds(P);
  await h.flush();
  assert.equal(h.texts.get(P), Ca);
  const reads = h.reads.length;
  h.notify(P);
  await h.settle();
  assert.deepEqual(h.reads.slice(reads), [], '寫入還沒回來時讀了 P');
  held.release();
  assert.equal(await filling, true);
  await h.flush();
  assert.deepEqual(h.reads.slice(reads), [P]);
  h.clean();
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  await h.settle();
  assert.deepEqual(h.reads.slice(reads), [P]);
  h.samePlan();
});

const A = 'Essence Cards/A.md';
const B = 'Essence Cards/B.md';

void test('S13 fillIds 版：別篇收到通知還沒讀，先讀完再配號，不撞號', async t => {
  const h = await setup(t, { [A]: C });
  h.write(B, Ca);
  assert.equal(await h.state.fillIds(A), true);
  assert.equal(h.texts.get(A), C.replace('能說明 C', '能說明 C ^aaaaab'));
  await h.settle();
  h.clean(A);
  h.clean(B);
  h.samePlan();
});

void test('S21 fillIds 版：門檻在輪到時重查；前一份寫入時另一篇變成讀不到，後一份 blocked、不改字', async t => {
  const h = await setup(t, { [A]: C, [B]: C });
  const held = h.holdModify(A);
  const first = h.state.fillIds(A);
  await h.flush();
  const second = h.state.fillIds(B);
  h.failing.add(P);
  h.write(P, C);
  await h.settle();
  assert.deepEqual(h.state.unread(), [P]);
  held.release();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(h.texts.get(B), C);
  h.clean(A);
});

void test('S22 fillIds 版：一直有新的待讀時，第 5 輪後放棄（不寫），不會一直等下去', async t => {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles({ [A]: C, [P]: C });
  const files = { ...memory.files, read: (path: string) => { const result = memory.files.read(path); if (path === P) memory.notify(P); return result; } };
  const state = createState({ files, device: 'PC-test', delay: DELAY, fillIds: true, random: () => 0 });
  t.after(() => state.close());
  await state.ready();
  memory.notify(P);
  const reads = memory.reads.length;
  assert.equal(await state.fillIds(A), false);
  assert.equal(memory.texts.get(A), C);
  assert.equal(memory.reads.slice(reads).length, 5);
});

// ---- §4 準備只預留、核對與採用（離開筆記的 fillIds） ----

const D = '- 能說明 D\n    - QD :: AD\n';

void test('§4 fillIds 核對：寫成後家長又打了別的字，預期的 ID 都在就算寫成；預期不在（ID 被拿掉）不採用、回 false', async t => {
  const h = await setup(t, { [P]: C });
  const held = h.holdModify(P);
  const filling = h.state.fillIds(P);
  await h.flush();
  assert.equal(h.texts.get(P), Ca);
  h.write(P, Ca + D);
  held.release();
  assert.equal(await filling, true);
  h.clean();
  assert.deepEqual(h.state.deckStatus(P), { missing: 1, issues: [] });

  const lost = await setup(t, { [P]: C });
  const held2 = lost.holdModify(P);
  const filling2 = lost.state.fillIds(P);
  await lost.flush();
  lost.write(P, C + D);
  held2.release();
  assert.equal(await filling2, false);
  lost.clean();
  assert.deepEqual(lost.state.deckStatus(P), { missing: 2, issues: [] });
  // 預留過的 aaaaaa 不再配出。
  assert.equal(await lost.state.fillIds(P), true);
  assert.equal(lost.texts.get(P), '- 能說明 C ^aaaaab\n    - QC :: AC\n- 能說明 D ^aaaaac\n    - QD :: AD\n');
  lost.samePlan();
});

void test('S18 fillIds 版：寫成後核對讀不到，先回 false；讀到時照核對採用，沒有問題', async t => {
  const h = await setup(t, { [P]: C, [A]: C });
  const held = h.holdModify(P);
  const filling = h.state.fillIds(P);
  await h.flush();
  h.failing.add(P);
  held.release();
  assert.equal(await filling, false);
  assert.deepEqual(h.state.unread(), [P]);
  assert.equal(await h.state.fillIds(A), false, '讀不到時門檻擋住其他寫入');
  assert.equal(h.texts.get(A), C);
  const changes = h.changed();
  h.failing.delete(P);
  await h.settle(1000);
  assert.deepEqual(h.state.unread(), []);
  assert.equal(h.changed(), changes + 1);
  h.clean();
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  h.samePlan();
});
