import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { State, StateOptions } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 版本行（任務說明 2-1、syntax.md §5-1、D-149 第 2 點與 2026-10-29 的補充）：每台裝置第一次跑一個新的建置版本時，
// 在自己的紀錄寫一行 `set: app`。這台是 Windows-2c9e；外部改檔與讀檔的重試用記憶體 Files 加假計時器。
const DELAY = 30;
const BUILD = '0.1.0+1a2b3c4';
const DECK = 'Essence Cards/A（卡片）.md';
const OWN = 'Essence Cards/紀錄/2026-10 Windows-2c9e.jsonl';
const SEPT = 'Essence Cards/紀錄/2026-09 Windows-2c9e.jsonl';
const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
const app = (t: string, val: string) => JSON.stringify({ t, set: 'app', val });
const T0 = '2026-10-20T19:00:00.000+08:00';
const goal = (id: string) => `- 能說明 ${id} ^${id}\n    - 題目 ${id} :: 答案 ${id}\n`;
const answer = { lt: 'aaaaaa', r: 'good', v: '12345678' } as const;

const timed = new WeakSet<TestContext>();
interface Harness extends MemoryFiles {
  state: State;
  /** 這台自己的紀錄檔的每一行，照 set 或 lt 寫成短的樣子：`app:<val>`、`<lt>`。 */
  own: (path?: string) => string[];
  tick: (ms: number) => Promise<void>;
}
async function setup(t: TestContext, vault: Record<string, string>, options: Partial<StateOptions> = {}, unread: string[] = [], memory = createMemoryFiles(vault)): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  for (const path of unread) memory.failing.add(path);
  const state = createState({ files: memory.files, device: 'Windows-2c9e', build: BUILD, delay: DELAY, fillIds: false,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480, ...options });
  t.after(() => state.close());
  await state.ready();
  return {
    ...memory, state,
    own: (path = OWN) => (memory.texts.get(path) ?? '').split('\n').filter(Boolean).map(line => {
      const data = JSON.parse(line) as { set?: string; val?: string; lt?: string };
      return data.set === 'app' ? 'app:' + String(data.val) : data.lt ?? String(data.set);
    }),
    tick: async ms => { t.mock.timers.tick(ms); await new Promise<void>(resolve => setImmediate(resolve)); },
  };
}

void test('2-1 自己的歷史就緒：版本行排在這次第一筆作答前，寫成之後是 written', async t => {
  const h = await setup(t, { [DECK]: goal('aaaaaa') });
  assert.equal(h.state.version().own, 'queued');
  h.state.answer(answer);
  await h.state.flush();
  assert.deepEqual(h.own(), ['app:' + BUILD, 'aaaaaa']);
  assert.equal(h.state.version().own, 'written');
});

void test('2-1 同一個 BUILD 重開不再寫；不同的（退回舊版也算）會寫', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa'), [OWN]: app(T0, BUILD) + '\n' });
  // 每次重開晚一分鐘（同一台裝置跨啟動時間相同是技術債「紀錄的時間跨啟動會撞」，這裡不測）。
  const launch = (minute: number, build = BUILD) => setup(t, {}, { build, now: () => Date.parse('2026-10-24T19:00:00.000+08:00') + minute * 60_000 }, [], memory);
  const first = await launch(0);
  await first.state.close();
  assert.deepEqual([first.state.version().own, first.own()], ['same', ['app:' + BUILD]]);
  const older = await launch(1, '0.0.9+5d357fa');
  await older.state.close();
  assert.deepEqual(older.own(), ['app:' + BUILD, 'app:0.0.9+5d357fa']);
  const back = await launch(2);
  await back.state.close();
  assert.deepEqual(back.own(), ['app:' + BUILD, 'app:0.0.9+5d357fa', 'app:' + BUILD]);
  const again = await launch(3);
  await again.state.close();
  assert.deepEqual([again.state.version().own, again.own().length], ['same', 3]);
});

void test('2-1 比的是自己所有月份裡時間最晚的那一行', async t => {
  const same = await setup(t, { [SEPT]: app('2026-09-20T19:00:00.000+08:00', '0.0.9+5d357fa') + '\n', [OWN]: app(T0, BUILD) + '\n' });
  assert.equal(same.state.version().own, 'same');
  const later = await setup(t, { [SEPT]: app('2026-09-20T19:00:00.000+08:00', BUILD) + '\n', [OWN]: app(T0, '0.0.9+5d357fa') + '\n' });
  await later.state.flush();
  assert.deepEqual(later.own(), ['app:0.0.9+5d357fa', 'app:' + BUILD]);
});

void test('2-1 還原檔、衝突副本、別台裝置的版本行與 need 讀不懂的版本行都不算這台目前的版本', async t => {
  for (const [path, line] of [
    ['Essence Cards/紀錄/2026-10 Windows-2c9e 還原 2026-11-02 Windows-1111.jsonl', app(T0, BUILD)],
    ['Essence Cards/紀錄/2026-10 Windows-2c9e 2.jsonl', app(T0, BUILD)],
    [PHONE, app(T0, BUILD)],
    [OWN, JSON.stringify({ t: T0, need: '9.0.0', set: 'app', val: BUILD })],
  ] as const) {
    const h = await setup(t, { [path]: line + '\n' });
    await h.state.flush();
    // 自己的檔多了一行這個 BUILD（need 那一行原本就在自己的檔裡）。
    assert.deepEqual(h.own(), path === OWN ? ['app:' + BUILD, 'app:' + BUILD] : ['app:' + BUILD], path);
    assert.equal(h.state.version().own, 'written', path);
  }
});

void test('2-1 同一個時間有兩個不同的值（不確定）：照樣寫一行', async t => {
  const h = await setup(t, { [OWN]: app(T0, BUILD) + '\n' + app(T0, '0.0.9+5d357fa') + '\n' });
  await h.state.flush();
  assert.deepEqual(h.own(), ['app:' + BUILD, 'app:0.0.9+5d357fa', 'app:' + BUILD]);
});

void test('2-1 自己的歷史讀不到時不擋作答：先照常寫作答，讀到之後才比、只補一行（Codex 格式查核 R2）', async t => {
  const h = await setup(t, { [DECK]: goal('aaaaaa'), [OWN]: encodeEntry(T0, { lt: 'bbbbbb', r: 'good', v: '12345678' }) + '\n' }, {}, [OWN]);
  assert.equal(h.state.version().own, 'waiting');
  assert.equal(typeof h.state.answer(answer), 'string');
  await h.state.flush();
  assert.deepEqual(h.own(), ['bbbbbb', 'aaaaaa']);
  // 還讀不到：重試失敗也不寫。
  await h.tick(1001);
  assert.deepEqual([h.state.version().own, h.own()], ['waiting', ['bbbbbb', 'aaaaaa']]);
  h.failing.delete(OWN);
  await h.tick(2001);
  await h.state.flush();
  assert.deepEqual(h.own(), ['bbbbbb', 'aaaaaa', 'app:' + BUILD]);
  // 之後的作答、重讀都不再寫。
  h.state.answer(answer);
  h.write(PHONE, encodeEntry(T0, { lt: 'cccccc', r: 'good', v: '12345678' }) + '\n');
  await h.tick(DELAY + 1);
  await h.state.flush();
  assert.deepEqual(h.own(), ['bbbbbb', 'aaaaaa', 'app:' + BUILD, 'aaaaaa']);
  assert.equal(h.state.version().own, 'written');
});

void test('2-1 讀到之後才發現已經記過同一個 BUILD：不寫', async t => {
  const h = await setup(t, { [OWN]: app(T0, BUILD) + '\n' }, {}, [OWN]);
  h.state.answer(answer);
  h.failing.delete(OWN);
  await h.tick(1001);
  await h.state.flush();
  assert.deepEqual([h.state.version().own, h.own()], ['same', ['app:' + BUILD, 'aaaaaa']]);
});

void test('2-1 寫入成功以 flush 為準：寫不進去時是 queued，重試成功只有一行', async t => {
  const memory = createMemoryFiles({ [DECK]: goal('aaaaaa') });
  memory.control.failAppend = true;
  const h = await setup(t, {}, {}, [], memory);
  await assert.rejects(h.state.flush());
  assert.equal(h.state.version().own, 'queued');
  memory.control.failAppend = false;
  await h.state.flush();
  assert.deepEqual([h.state.version().own, h.own()], ['written', ['app:' + BUILD]]);
});

void test('2-1 沒傳 build：不寫版本行', async t => {
  const h = await setup(t, { [DECK]: goal('aaaaaa') }, { build: undefined });
  h.state.answer(answer);
  await h.state.flush();
  assert.deepEqual([h.state.version(), h.own()], [{ build: null, own: null, devices: [] }, ['aaaaaa']]);
});

void test('2-1 裝置列表：從帶來源路徑的原始行算；兩台時間與值都相同也兩台都列（Codex 第一次回應的探針），還原檔另標', async t => {
  const restored = 'Essence Cards/紀錄/2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2c9e.jsonl';
  const h = await setup(t, { [OWN]: app(T0, BUILD) + '\n', [PHONE]: app(T0, BUILD) + '\n', [restored]: app('2026-10-22T19:00:00.000+08:00', '0.0.1+0000000') + '\n' });
  const { build, own, devices } = h.state.version();
  assert.deepEqual([build, own], [BUILD, 'same']);
  assert.deepEqual(devices.map(row => [row.device, row.build, row.t, row.note]), [
    ['Windows-2c9e', BUILD, T0, null],
    ['iPhone-7f3a', BUILD, T0, null],
    ['iPhone-7f3a', '0.0.1+0000000', '2026-10-22T19:00:00.000+08:00', '還原檔'],
  ]);
  // 別台裝置的新回報同步到了：列表跟著變。
  h.write(PHONE, app(T0, BUILD) + '\n' + app('2026-10-24T08:00:00.000+08:00', '0.1.1+9f8e7d6') + '\n');
  await h.tick(DELAY + 1);
  assert.deepEqual(h.state.version().devices.filter(row => row.device === 'iPhone-7f3a' && row.note === null).map(row => row.build), ['0.1.1+9f8e7d6']);
});
