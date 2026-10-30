import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import type { Files } from '../src/core/files.ts';
import { createState } from '../src/state/index.ts';
import type { StateOptions } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// tasks/error-log.md §2-3：除了 close() 之外，每一條讓 ready() 拒絕的路都恰好經過一次 onError；已經報過的讀取錯誤不再報一次。
const DECK = 'Essence Cards/a.md';
const vault = { [DECK]: '- 目標 ^aaaaaa\n    - Q :: A\n' };

function setup(files: Files, options: Partial<StateOptions> = {}) {
  const errors: [string, string][] = [];
  const state = createState({ files, device: 'PC-test', delay: 5, fillIds: false, offset: () => 480,
    onError: (error, source) => { errors.push([source, error instanceof Error ? error.message : String(error)]); }, ...options });
  return { state, errors };
}
const settled = (promise: Promise<unknown>): Promise<'resolved' | 'rejected'> => promise.then(() => 'resolved' as const, () => 'rejected' as const);

void test('§2-3 files.watch 拋錯：ready() 拒絕，onError 恰好一次（init）', async () => {
  const memory = createMemoryFiles(vault);
  const files: Files = { ...memory.files, watch: () => { throw Error('監看不了'); } };
  const { state, errors } = setup(files);
  assert.equal(await settled(state.ready()), 'rejected');
  assert.deepEqual(errors, [['init', '監看不了']]);
  await state.close();
});

void test('§2-3 首次排程拋錯：ready() 拒絕，onError 恰好一次（init）', async () => {
  const memory = createMemoryFiles(vault);
  const { state, errors } = setup(memory.files, { now: () => { throw Error('時鐘壞了'); } });
  assert.equal(await settled(state.ready()), 'rejected');
  assert.deepEqual(errors, [['init', '時鐘壞了']]);
  await state.close();
});

void test('§2-3 讀取那一批裡程式的錯：已經報過一次 read，不再報 init', async () => {
  const memory = createMemoryFiles(vault);
  // 讀到的不是文字：解析卡組時拋錯（程式的錯，不是讀不到）。
  const files: Files = { ...memory.files, read: () => Promise.resolve(42 as unknown as string) };
  const { state, errors } = setup(files);
  assert.equal(await settled(state.ready()), 'rejected');
  assert.deepEqual(errors.map(([source]) => source), ['read']);
  await state.close();
});

void test('§2-3 close() 讓 ready() 拒絕：onError 零次', async () => {
  const memory = createMemoryFiles(vault);
  const { state, errors } = setup(memory.files);
  const ready = settled(state.ready());
  await state.close();
  assert.equal(await ready, 'rejected');
  assert.deepEqual(errors, []);
  // close() 之後才呼叫 ready() 也一樣。
  const late = setup(memory.files);
  await late.state.close();
  assert.equal(await settled(late.state.ready()), 'rejected');
  assert.deepEqual(late.errors, []);
});

void test('§2-3 列不出來的重試照舊每次一次（read），列出來之後 ready() 完成，沒有 init', async () => {
  const memory = createMemoryFiles(vault);
  memory.control.failList = true;
  const { state, errors } = setup(memory.files);
  const ready = settled(state.ready());
  // 1 秒後重試第一次：失敗兩次之後恢復。
  await wait(20);
  assert.deepEqual(errors.map(([source]) => source), ['read']);
  await wait(1000);
  assert.deepEqual(errors.map(([source]) => source), ['read', 'read']);
  memory.control.failList = false;
  assert.equal(await ready, 'resolved');
  assert.deepEqual(errors.map(([source]) => source), ['read', 'read']);
  await state.close();
});

// Codex L2 的 R2：拒絕的原因是程式的錯時，就算呼叫端在同一輪 close()，也照樣記一次 init；close() 本身造成的拒絕才不記。
void test('§2-3 R2 files.watch 拋錯後同一輪就 close()：照樣記一次 init', async () => {
  const memory = createMemoryFiles(vault);
  const files: Files = { ...memory.files, watch: () => { throw Error('watch-crash'); } };
  const { state, errors } = setup(files);
  const ready = state.ready().catch((error: unknown) => (error as Error).message);
  await state.close();
  assert.equal(await ready, 'watch-crash');
  assert.deepEqual(errors, [['init', 'watch-crash']]);
});

void test('§2-3 R2 列不出來的等待中 close()：拒絕是 close 造成的，只有列不出來那一次 read', async () => {
  const memory = createMemoryFiles(vault);
  memory.control.failList = true;
  const { state, errors } = setup(memory.files);
  const ready = settled(state.ready());
  await wait(20);
  await state.close();
  assert.equal(await ready, 'rejected');
  assert.deepEqual(errors.map(([source]) => source), ['read']);
});
