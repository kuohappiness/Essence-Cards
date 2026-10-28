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

// ---- §2 讀取那一側：跨過 Cards I/O 的讀取結果整份不用（離開筆記的 fillIds） ----

for (const landed of ['舊文字', 'null', 'reject'] as const) void test('M1 fillIds：寫入前開始的讀取在寫成後才落地，結果整份不用、重讀，不出現 lost：' + landed, async t => {
  const h = await setup(t, { [P]: C });
  h.notify(P);
  const held = h.holdRead(P);
  t.mock.timers.tick(DELAY + 1);
  await held.started;
  assert.equal(await h.state.fillIds(P), true);
  assert.equal(h.texts.get(P), Ca);
  held.release(landed === '舊文字' ? undefined : landed === 'null' ? null : Error('讀不到'));
  await h.flush();
  h.clean();
  assert.deepEqual(h.state.unread(), []);
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
