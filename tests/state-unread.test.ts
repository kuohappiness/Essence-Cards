import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state/index.ts';
import type { State } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// unread() 的兩個缺口（tasks/entry-and-catalog.md §8、backlog 技術債）：一直沒回來的讀取要算進去；內容變了要通知。

const DELAY = 30;
const STUCK = 30_000;
const DECK = 'Essence Cards/a.md';
const OTHER = 'Essence Cards/b.md';
const text = '- 目標 ^a\n    - 問 :: 答\n';
const tickAsync = async (t: TestContext, ms: number): Promise<void> => { t.mock.timers.tick(ms); await new Promise<void>(resolve => setImmediate(resolve)); };

function make(t: TestContext, memory: MemoryFiles, stuckAfter?: number): { state: State; changed: () => number; unreadEvents: () => number } {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: false, ...(stuckAfter === undefined ? {} : { stuckAfter }), now: () => 0, offset: () => 480, onError() {} });
  t.after(() => state.close());
  let changed = 0, unread = 0;
  state.onChange(() => { changed++; });
  state.onUnread(() => { unread++; });
  return { state, changed: () => changed, unreadEvents: () => unread };
}

void test('讀取一直不回來 30 秒後算進 unread()，通知一次；回來了拿掉、再通知一次', async t => {
  const memory = createMemoryFiles({ [DECK]: text });
  const held = memory.holdRead(DECK);
  const h = make(t, memory);
  void h.state.ready();
  await held.started;
  await tickAsync(t, STUCK - 1);
  assert.deepEqual(h.state.unread(), [], '還沒到 30 秒');
  assert.equal(h.unreadEvents(), 0);
  await tickAsync(t, 1);
  assert.deepEqual(h.state.unread(), [DECK]);
  assert.equal(h.unreadEvents(), 1);
  held.release();
  await h.state.ready();
  assert.deepEqual(h.state.unread(), []);
  assert.equal(h.unreadEvents(), 2);
});

void test('30 秒內回來的讀取不算；計時清掉，之後不會誤報', async t => {
  const memory = createMemoryFiles({ [DECK]: text });
  const held = memory.holdRead(DECK);
  const h = make(t, memory);
  void h.state.ready();
  await held.started;
  await tickAsync(t, STUCK - 1);
  held.release();
  await h.state.ready();
  await tickAsync(t, STUCK * 2);
  assert.deepEqual(h.state.unread(), []);
  assert.equal(h.unreadEvents(), 0);
});

void test('unread 從 2 變 0：每次內容變了就通知；變空時也通知，不靠 onChange', async t => {
  const memory = createMemoryFiles({ [DECK]: text, [OTHER]: text });
  memory.failing.add(DECK);
  memory.failing.add(OTHER);
  const h = make(t, memory);
  await h.state.ready();
  assert.deepEqual(h.state.unread(), [DECK, OTHER]);
  assert.equal(h.unreadEvents(), 1, '同一批的兩篇只通知一次');
  memory.failing.delete(OTHER);
  await tickAsync(t, 1000);
  assert.deepEqual(h.state.unread(), [DECK]);
  assert.equal(h.unreadEvents(), 2);
  memory.failing.delete(DECK);
  const before = h.changed();
  await tickAsync(t, 2000);
  assert.deepEqual(h.state.unread(), []);
  assert.equal(h.unreadEvents(), 3);
  // 讀到的內容和上一次一樣（這裡第一次讀到，所以 onChange 會來一次）；重點是沒有 unread 的通知以外的多餘呼叫：見下一個測試。
  assert.ok(h.changed() >= before);
});

void test('讀不到又讀到、內容沒變：unread 通知照來，onChange 不多一次（存檔按鈕等既有監聽者不受影響）', async t => {
  const memory = createMemoryFiles({ [DECK]: text });
  const h = make(t, memory);
  await h.state.ready();
  memory.failing.add(DECK);
  memory.notify(DECK);
  await tickAsync(t, DELAY + 1);
  assert.deepEqual(h.state.unread(), [DECK]);
  const changed = h.changed();
  memory.failing.delete(DECK);
  await tickAsync(t, 1000);
  assert.deepEqual(h.state.unread(), []);
  assert.equal(h.unreadEvents(), 2);
  assert.equal(h.changed(), changed, '內容沒變就不重排');
});

void test('關掉之後不再通知，卡住的計時也清掉', async t => {
  const memory = createMemoryFiles({ [DECK]: text });
  const held = memory.holdRead(DECK);
  const h = make(t, memory);
  void h.state.ready().catch(() => {});
  await held.started;
  const closing = h.state.close();
  await tickAsync(t, STUCK * 2);
  assert.equal(h.unreadEvents(), 0);
  held.release();
  await closing;
});

void test('監聽者丟錯不影響其他監聽者，經 onError 記成 listener', async t => {
  const memory = createMemoryFiles({ [DECK]: text });
  memory.failing.add(DECK);
  const errors: string[] = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: false, now: () => 0, offset: () => 480, onError: (_error, source) => { errors.push(source); } });
  t.after(() => state.close());
  let reached = 0;
  state.onUnread(() => { throw Error('監聽者的錯'); });
  state.onUnread(() => { reached++; });
  await state.ready();
  assert.equal(reached, 1);
  assert.ok(errors.includes('listener'));
});
