import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state/index.ts';
import type { State } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 考試範圍接上 state（tasks/exam-scope.md §3、§4、§5）：真正的 createState，假的 Files。

const DELAY = 30;
const DAY = 86_400_000;
const OFFSET = 480;
const FOLDER = 'Essence Cards/考試範圍/';
const SCOPE = FOLDER + '2026-10-28 國二上.md';
const NATURE = 'Essence Cards/自然 2-1.md';
const ENGLISH = 'Essence Cards/英文 L1.md';
const at = (text: string): number => Date.parse(text + '+08:00');
const NOON = at('2026-10-20T12:00:00');
const tick = async (t: TestContext, ms = DELAY): Promise<void> => {
  t.mock.timers.tick(ms);
  for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve));
};

const head = (term: string, subject: string, code: string, extra = ''): string => `---\n年級學期: ${term}\n科目: ${subject}\n單元: "${code}"\n${extra}---\n`;
const targets = (...ids: string[]): string => ids.map(id => `- 目標 ${id} ^${id}\n    - 問 ${id} :: 答 ${id}\n`).join('');
const DECKS = {
  [NATURE]: head('國二上', '自然', '2-1') + targets('a', 'b'),
  [ENGLISH]: head('國二上', '英文', 'L1') + targets('c'),
};
const scopeText = (start = '2026-10-28', end = '2026-10-29', ...lines: string[]): string => `---\n識別碼: x7f3k2\n考試開始: ${start}\n考試結束: ${end}\n---\n${(lines.length ? lines : ['- 國二上 自然 2-1']).join('\n')}\n`;

interface Harness {
  state: State;
  memory: MemoryFiles;
  changed: () => number;
  errors: unknown[];
  setNow: (ms: number) => void;
  lane: (id: string) => string | undefined;
  retention: () => number | undefined;
  logged: () => Record<string, unknown>[];
}
const mocked = new WeakSet<TestContext>();
function make(t: TestContext, initial: Record<string, string>, now = NOON): Harness {
  if (!mocked.has(t)) t.mock.timers.enable({ apis: ['setTimeout'] });
  mocked.add(t);
  const memory = createMemoryFiles(initial);
  let clock = now, changes = 0;
  const errors: unknown[] = [];
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: true, now: () => clock, offset: () => OFFSET, onError: error => { errors.push(error); }, random: () => 0 });
  t.after(() => state.close());
  state.onChange(() => { changes++; });
  const item = (id: string) => { const today = state.today(); return [...today.share, ...today.more].find(each => each.lt === id); };
  return {
    state, memory, errors,
    changed: () => changes,
    setNow(ms) { clock = ms; },
    lane: id => item(id)?.lane,
    retention() { const today = state.today(); return today.slots.get('a')?.retention; },
    logged: () => [...memory.texts].filter(([path]) => path.startsWith('Essence Cards/紀錄/') || path.endsWith('.jsonl')).flatMap(([, text]) => text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)).filter(line => line.set === 'exam'),
  };
}
/** 把紀錄寫進檔（writer 的等待也是 setTimeout）。 */
const flushLog = async (t: TestContext, state: State): Promise<void> => {
  const done = state.flush();
  await tick(t, 1000);
  await done;
};
/** 畫面打開的是這一刻選定的那一份。 */
const opened = (state: State): Parameters<State['endExam']>[0] => ({ path: state.exam().path, id: state.exam().file?.id ?? null });
const save = (state: State, change: Parameters<State['setExam']>[0]): ReturnType<State['setExam']> => state.setExam(change, opened(state));
const finish = (state: State): ReturnType<State['endExam']> => state.endExam(opened(state));
const ready = async (t: TestContext, h: Harness): Promise<void> => {
  const done = h.state.ready();
  await tick(t, 0);
  await done;
};

void test('無範圍 → 建立有期間的範圍，同一天：lane 與保持率當場變；移除後變回來（Codex 環節 7 第 2 題的反例）', async t => {
  const h = make(t, DECKS);
  await ready(t, h);
  assert.equal(h.lane('a'), 'new');
  assert.equal(h.retention(), 0.8);
  assert.deepEqual(h.state.exam().file, null);
  assert.equal(h.state.exam().settled, true);
  const before = h.changed();
  const result = await save(h.state, { add: [{ term: '國二上', subject: '自然', code: '2' }], start: '2026-10-28', end: '2026-10-29' });
  assert.deepEqual(result, { kind: 'done' });
  assert.equal(h.changed(), before + 1, '存範圍時 onChange 只通知一次');
  assert.equal(h.lane('a'), 'exam-new');
  assert.equal(h.lane('c'), 'new', '英文不在範圍內');
  assert.equal(h.retention(), 0.9);
  assert.equal(h.memory.texts.get(SCOPE), '---\n識別碼: 222222\n考試開始: 2026-10-28\n考試結束: 2026-10-29\n---\n- 國二上 自然 2\n'.replace('222222', h.state.exam().file?.id ?? ''));
  assert.equal(h.state.exam().file?.id?.length, 6);
  await tick(t);
  assert.equal(h.changed(), before + 1, '檔案通知讀到同一份：不多通知');
  h.memory.remove(SCOPE);
  await tick(t);
  assert.equal(h.lane('a'), 'new');
  assert.equal(h.retention(), 0.8);
  assert.equal(h.state.exam().file, null);
});

void test('紀錄行：建立、改（有 old）、提前結束；沒有變動不記、不寫', async t => {
  const h = make(t, DECKS);
  await ready(t, h);
  await save(h.state, { add: [{ term: '國二上', subject: '自然', code: '2' }], start: '2026-10-28', end: '2026-10-29' });
  const id = h.state.exam().file?.id;
  await save(h.state, { add: [{ term: '國二上', subject: '英文', code: 'L1' }] });
  await save(h.state, {});
  await save(h.state, { add: [{ term: '國二上', subject: '英文', code: 'L1' }] });
  await finish(h.state);
  await h.state.flush();
  const lines = h.logged().map(({ val }) => val);
  assert.deepEqual(lines, [
    { id, do: '建立', units: ['國二上 自然 2'], start: '2026-10-28', end: '2026-10-29' },
    { id, do: '改', units: ['國二上 自然 2', '國二上 英文 L1'], start: '2026-10-28', end: '2026-10-29', old: { id, units: ['國二上 自然 2'], start: '2026-10-28', end: '2026-10-29' } },
    { id, do: '提前結束', units: ['國二上 自然 2', '國二上 英文 L1'], start: '2026-10-28', end: '2026-10-29', ended: '2026-10-20' },
  ]);
});

void test('紀錄行：手寫的檔第一次按確定：補識別碼算改，old 照原字；只有日期的寫法變了不記', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: '---\n考試開始: 10/28\n---\n- 國二上 自然 2-1\n' });
  await ready(t, h);
  await save(h.state, { start: '2026-10-28' });
  await h.state.flush();
  const id = h.state.exam().file?.id;
  assert.deepEqual(h.logged().map(({ val }) => val), [{ id, do: '改', units: ['國二上 自然 2-1'], start: '2026-10-28', old: { units: ['國二上 自然 2-1'], start: '10/28' } }]);
  const only = make(t, { ...DECKS, [SCOPE]: '---\n識別碼: x\n考試開始: 20261028\n---\n- 國二上 自然 2-1\n' });
  await ready(t, only);
  await save(only.state, {});
  await only.state.flush();
  assert.equal(only.memory.texts.get(SCOPE), '---\n識別碼: x\n考試開始: 2026-10-28\n---\n- 國二上 自然 2-1\n', '下次按確定才標準化');
  assert.deepEqual(only.logged(), []);
});

void test('撞名不蓋掉，換後綴；空檔寫進去', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: '老師說\n' });
  // 那一份只有看不懂的行：選到它；要有另一種情況才會建立新檔，所以先結束它。
  await ready(t, h);
  await finish(h.state);
  assert.match(h.memory.texts.get(SCOPE) ?? '', /提前結束/);
  await save(h.state, { add: [{ term: '國二上', subject: '自然', code: '2' }], start: '2026-10-28' });
  assert.match(h.memory.texts.get(SCOPE) ?? '', /老師說/, '舊檔內容不變');
  assert.match(h.memory.texts.get(FOLDER + '2026-10-28 國二上 2.md') ?? '', /- 國二上 自然 2\n$/);
  const empty = make(t, { ...DECKS });
  await ready(t, empty);
  empty.memory.texts.set(SCOPE, '');
  await save(empty.state, { add: [{ term: '國二上', subject: '自然', code: '2' }], start: '2026-10-28' });
  assert.match(empty.memory.texts.get(SCOPE) ?? '', /- 國二上 自然 2\n$/, '空檔沒有內容可丟');
});

void test('回呼看到檔不見或已經結束、屬性區壞了：不寫、不建立、回原因', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText() });
  await ready(t, h);
  h.memory.texts.delete(SCOPE);
  assert.deepEqual(await save(h.state, { add: [{ term: '國二上', subject: '英文', code: 'L1' }] }), { kind: 'blocked', reason: 'changed' });
  assert.equal(h.memory.texts.has(SCOPE), false, '不建立');
  const ended = make(t, { ...DECKS, [SCOPE]: scopeText() });
  await ready(t, ended);
  ended.memory.texts.set(SCOPE, scopeText().replace('---\n-', '提前結束: 2026-10-19\n---\n-'));
  assert.deepEqual(await save(ended.state, { add: [{ term: '國二上', subject: '英文', code: 'L1' }] }), { kind: 'blocked', reason: 'changed' });
  const broken = make(t, { ...DECKS, [SCOPE]: '---\n考試開始: [\n---\n- 國二上 自然 2-1\n' });
  await ready(t, broken);
  assert.deepEqual(await save(broken.state, { add: [{ term: '國二上', subject: '英文', code: 'L1' }] }), { kind: 'blocked', reason: 'broken' });
  assert.equal(broken.memory.texts.get(SCOPE), '---\n考試開始: [\n---\n- 國二上 自然 2-1\n');
  const failing = make(t, { ...DECKS, [SCOPE]: scopeText() });
  await ready(t, failing);
  failing.memory.control.failModify = true;
  assert.equal((await save(failing.state, { add: [{ term: '國二上', subject: '英文', code: 'L1' }] })).kind, 'failed');
});

void test('畫面改了開始日，別台同時把結束日改得更早：不寫、不記，期間沒有變成有問題', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText('2026-10-21', '2026-10-28') });
  await ready(t, h);
  const changed = scopeText('2026-10-21', '2026-10-25');
  h.memory.texts.set(SCOPE, changed);
  assert.deepEqual(await save(h.state, { start: '2026-10-27' }), { kind: 'blocked', reason: 'dates' });
  assert.equal(h.memory.texts.get(SCOPE), changed);
  assert.deepEqual(h.logged().filter(entry => entry.set === 'exam'), []);
  await tick(t);
  assert.equal(h.state.exam().period.kind, 'ok');
});

void test('同一個路徑換成另一次考試，state 還沒讀到：舊畫面的變動與結束都不寫、不記；同一次考試上別人改的別的行留著', async t => {
  const A = '---\n識別碼: aaaaaa\n---\n- 國二上 自然 2-1\n';
  const h = make(t, { ...DECKS, [SCOPE]: A });
  await ready(t, h);
  const target = opened(h.state);
  const other = '---\n識別碼: cccccc\n---\n- 國二上 自然 4\n';
  const add = { add: [{ term: '國二上', subject: '英文', code: 'L1' }] };
  h.memory.texts.set(SCOPE, other);
  assert.deepEqual(await h.state.setExam(add, target), { kind: 'blocked', reason: 'changed' });
  assert.deepEqual(await h.state.endExam(target), { kind: 'blocked', reason: 'changed' });
  assert.equal(h.memory.texts.get(SCOPE), other);
  assert.deepEqual(h.logged().filter(entry => entry.set === 'exam'), []);

  const same = make(t, { ...DECKS, [SCOPE]: A });
  await ready(t, same);
  const mine = opened(same.state);
  same.memory.texts.set(SCOPE, A + '- 國二上 自然 2-2\n老師說第三節不考\n');
  assert.deepEqual(await same.state.setExam(add, mine), { kind: 'done' });
  assert.equal(same.memory.texts.get(SCOPE), A + '- 國二上 自然 2-2\n老師說第三節不考\n- 國二上 英文 L1\n', '同一次考試：別人改的行留著');

  const none = make(t, { ...DECKS, [SCOPE]: '- 國二上 自然 2-1\n' });
  await ready(t, none);
  const bare = opened(none.state);
  none.memory.texts.set(SCOPE, A);
  assert.deepEqual(await none.state.setExam(add, bare), { kind: 'blocked', reason: 'changed' }, '打開時沒有識別碼，現在有：分不出是不是同一次');
  assert.equal(none.memory.texts.get(SCOPE), A);
});

void test('排隊時選定的換了：前一筆結束讓另一份接手，舊畫面晚到的變動不會落到那一份', async t => {
  const first = FOLDER + 'a.md', second = FOLDER + 'b.md';
  const later = '---\n識別碼: bbbbbb\n考試開始: 2026-11-20\n---\n- 國二上 自然 2-1\n';
  const h = make(t, { ...DECKS, [first]: '---\n識別碼: aaaaaa\n考試開始: 2026-10-28\n---\n- 國二上 自然 2-1\n', [second]: later });
  await ready(t, h);
  const target = opened(h.state);
  assert.equal(target.path, first);
  const add = { add: [{ term: '國二上', subject: '英文', code: 'L1' }] };
  const ending = h.state.endExam(target), late = h.state.setExam(add, target), lateEnd = h.state.endExam(target);
  assert.deepEqual(await ending, { kind: 'done' });
  assert.deepEqual(await late, { kind: 'blocked', reason: 'changed' });
  assert.deepEqual(await lateEnd, { kind: 'blocked', reason: 'changed' });
  assert.equal(h.memory.texts.get(second), later);
  assert.equal(h.state.exam().path, second);
  assert.deepEqual(h.logged().filter(entry => entry.set === 'exam').map(entry => (entry.val as { id: string; do: string }).id), ['aaaaaa']);
});

void test('打開時沒有範圍，別處新建了一份：不另建一份；打開時有，現在沒有：不建立', async t => {
  const h = make(t, DECKS);
  await ready(t, h);
  const target = opened(h.state);
  h.memory.write(SCOPE, scopeText());
  await tick(t);
  assert.deepEqual(await h.state.setExam({ add: [{ term: '國二上', subject: '英文', code: 'L1' }] }, target), { kind: 'blocked', reason: 'changed' });
  assert.deepEqual([...h.memory.texts.keys()].filter(path => path.startsWith(FOLDER)), [SCOPE]);

  const gone = make(t, { ...DECKS, [SCOPE]: scopeText() });
  await ready(t, gone);
  const was = opened(gone.state);
  gone.memory.remove(SCOPE);
  await tick(t);
  assert.deepEqual(await gone.state.setExam({ add: [{ term: '國二上', subject: '英文', code: 'L1' }] }, was), { kind: 'blocked', reason: 'changed' });
  assert.deepEqual(await gone.state.endExam(was), { kind: 'blocked', reason: 'changed' });
  assert.deepEqual([...gone.memory.texts.keys()].filter(path => path.startsWith(FOLDER)), []);
});

/** 真的 Files 同一個路徑排隊：下一次的 modify 等 gate 打開才進入回呼，後面的排在它後面。 */
function slowFiles(memory: MemoryFiles): { files: MemoryFiles['files']; gate: () => () => void } {
  let next: Promise<void> | null = null, tail: Promise<unknown> = Promise.resolve();
  return {
    files: {
      ...memory.files,
      modify(path, edit) {
        const held = next;
        next = null;
        const run = tail.catch(() => {}).then(() => held).then(() => memory.files.modify(path, edit));
        tail = run;
        return run;
      },
    },
    gate() {
      let open = (): void => {};
      next = new Promise<void>(resolve => { open = resolve; });
      return open;
    },
  };
}
function makeSlow(t: TestContext, initial: Record<string, string>): { state: State; memory: MemoryFiles; gate: () => () => void; exams: () => Record<string, unknown>[] } {
  if (!mocked.has(t)) t.mock.timers.enable({ apis: ['setTimeout'] });
  mocked.add(t);
  const memory = createMemoryFiles(initial);
  const { files, gate } = slowFiles(memory);
  const state = createState({ files, device: 'PC-test', delay: DELAY, fillIds: false, writeTimeout: 30, now: () => NOON, offset: () => OFFSET, onError() {}, random: () => 0 });
  t.after(() => state.close());
  return { state, memory, gate, exams: () => examLines(memory) };
}
const examLines = (memory: MemoryFiles): Record<string, unknown>[] => [...memory.texts].filter(([path]) => path.endsWith('.jsonl')).flatMap(([, text]) => text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)).filter(entry => entry.set === 'exam');
const readySlow = async (t: TestContext, state: State): Promise<void> => { const done = state.ready(); await tick(t, 0); await done; };
/** 排隊輪到它（微任務），計時才開始；再等到逾時。 */
const expire = async (t: TestContext): Promise<void> => { await tick(t, 0); await tick(t, 30); };
const failedWith = (result: Awaited<ReturnType<State['endExam']>>): string => result.kind === 'failed' && result.error instanceof Error ? result.error.message : JSON.stringify(result);

void test('等寫入逾時，回呼還沒進入：回失敗、之後也不會寫；重試排在後面照常，只寫一次、只記一次', async t => {
  const h = makeSlow(t, { ...DECKS, [SCOPE]: scopeText() });
  await readySlow(t, h.state);
  const open = h.gate();
  const ending = finish(h.state);
  await expire(t);
  assert.equal(failedWith(await ending), '寫進磁碟超過 30 ms 沒有回來（逾時），這次沒有存');
  assert.equal(h.memory.texts.get(SCOPE), scopeText(), '還沒寫');
  const retry = finish(h.state);
  await tick(t, 0);
  open();
  await tick(t, 0);
  assert.deepEqual(await retry, { kind: 'done' });
  await flushLog(t, h.state);
  assert.equal(h.memory.texts.get(SCOPE)?.match(/提前結束/g)?.length, 1);
  assert.equal(h.exams().length, 1);
});

void test('等寫入逾時，回呼還沒進入，也沒有重試：之後打開不會默默結束考試', async t => {
  const h = makeSlow(t, { ...DECKS, [SCOPE]: scopeText() });
  await readySlow(t, h.state);
  const open = h.gate();
  const ending = finish(h.state);
  await expire(t);
  await ending;
  open();
  await tick(t, 0);
  await tick(t);
  assert.equal(h.memory.texts.get(SCOPE), scopeText());
  assert.equal(h.state.exam().path, SCOPE, '考試還在');
  await flushLog(t, h.state);
  assert.deepEqual(h.exams(), []);
});

void test('等寫入逾時，回呼已經進入：畫面寫可能等一下才寫好；真的寫成了才記；重新讀到結果', async t => {
  const h = makeSlow(t, { ...DECKS, [SCOPE]: scopeText() });
  await readySlow(t, h.state);
  const held = h.memory.holdModify(SCOPE);
  const ending = finish(h.state);
  await expire(t);
  assert.equal(failedWith(await ending), '寫進磁碟超過 30 ms 沒有回來（逾時），可能等一下才寫好；請重新打開這個畫面確認');
  await flushLog(t, h.state);
  assert.deepEqual(h.exams(), [], '還不確定就不記');
  held.release();
  await tick(t, 0);
  await flushLog(t, h.state);
  assert.equal(h.exams().length, 1);
  assert.equal((h.exams()[0].val as { do: string }).do, '提前結束');
  await tick(t, DELAY);
  assert.equal(h.state.exam().file, null, '讀到結束了，倒數消失');
});

void test('等寫入逾時，之後才發現寫不進去：不記，範圍照舊', async t => {
  const memory = createMemoryFiles({ ...DECKS, [SCOPE]: scopeText() });
  if (!mocked.has(t)) t.mock.timers.enable({ apis: ['setTimeout'] });
  mocked.add(t);
  let refuse = (): void => {};
  const files = {
    ...memory.files,
    modify(path: string, edit: (text: string) => string) {
      return new Promise<void>((_, reject) => {
        edit(memory.texts.get(path) ?? '');
        refuse = () => { reject(Error('寫不進去')); };
      });
    },
  };
  const state = createState({ files, device: 'PC-test', delay: DELAY, fillIds: false, writeTimeout: 30, now: () => NOON, offset: () => OFFSET, onError() {}, random: () => 0 });
  t.after(() => state.close());
  await readySlow(t, state);
  const ending = finish(state);
  await expire(t);
  assert.match(failedWith(await ending), /可能等一下才寫好/);
  refuse();
  await tick(t, DELAY);
  assert.equal(state.exam().path, SCOPE);
  await flushLog(t, state);
  assert.deepEqual(examLines(memory), []);
});

void test('等寫入逾時後關閉：之後寫成了也不記', async t => {
  const h = makeSlow(t, { ...DECKS, [SCOPE]: scopeText() });
  await readySlow(t, h.state);
  const held = h.memory.holdModify(SCOPE);
  const ending = finish(h.state);
  await expire(t);
  await ending;
  await h.state.close();
  held.release();
  await tick(t, 0);
  assert.deepEqual(h.exams(), []);
});

void test('建立新檔逾時：回呼已經進入，真的寫成了才記一行建立', async t => {
  const h = makeSlow(t, DECKS);
  await readySlow(t, h.state);
  const path = FOLDER + '2026-10-28 國二上.md';
  const held = h.memory.holdModify(path);
  const saving = save(h.state, { add: [{ term: '國二上', subject: '自然', code: '2' }], start: '2026-10-28' });
  await expire(t);
  assert.match(failedWith(await saving), /可能等一下才寫好/);
  await flushLog(t, h.state);
  assert.deepEqual(h.exams(), []);
  held.release();
  await tick(t, 0);
  await flushLog(t, h.state);
  assert.deepEqual(h.exams().map(entry => (entry.val as { do: string }).do), ['建立']);
});

void test('重排看選定的身分、單元與期間：字形與順序不同不重排，換了識別碼要重排，改名選到同一份不重排', async t => {
  const a = FOLDER + 'a.md';
  const text = (id: string, ...lines: string[]): string => `---\n識別碼: ${id}\n考試開始: 2026-10-28\n---\n${lines.join('\n')}\n`;
  const h = make(t, { ...DECKS, [a]: text('aaaaaa', '- 國二上 英文 L1', '- 國二上 自然 2-1') });
  await ready(t, h);
  const kept = async (next: string, name: string): Promise<void> => {
    const before = h.state.today();
    h.memory.write(a, next);
    await tick(t);
    assert.equal(h.state.today(), before, name);
  };
  await kept(text('aaaaaa', '- 國二上 英文 l1', '- 國二上 自然 2-1'), '大小寫');
  await kept(text('aaaaaa', '- 國二上 自然 2-1', '- 國二上 英文 l1'), '順序');
  await kept(text('aaaaaa', '- 國二上 自然 ２-１ 水溶液', '- 國二上 英文 l1'), '全形與名稱');
  await kept(text('aaaaaa', '- 國二上 自然 2-1', '- 國二上 英文 l1', '- 國二上 自然 2-1'), '重複的行');
  const named = h.state.today();
  h.memory.rename(a, FOLDER + '改名.md');
  await tick(t);
  assert.equal(h.state.today(), named, '改名選到同一份');
  const before = h.state.today();
  h.memory.write(FOLDER + '改名.md', text('bbbbbb', '- 國二上 自然 2-1', '- 國二上 英文 l1'));
  await tick(t);
  assert.notEqual(h.state.today(), before, '內容一樣、識別碼不同：是另一次考試');
  const unit = h.state.today();
  h.memory.write(FOLDER + '改名.md', text('bbbbbb', '- 國二上 自然 2-1'));
  await tick(t);
  assert.notEqual(h.state.today(), unit, '單元變了');
});

void test('還沒 ready 與關閉之後擋下來', async t => {
  const h = make(t, DECKS);
  assert.deepEqual(await save(h.state, {}), { kind: 'blocked', reason: 'loading' });
  await ready(t, h);
  await h.state.close();
  assert.deepEqual(await save(h.state, {}), { kind: 'blocked', reason: 'closed' });
  assert.deepEqual(await finish(h.state), { kind: 'blocked', reason: 'closed' });
});

void test('範圍變動不改已完成數；今天答對的目標重排後還是完成', async t => {
  const h = make(t, DECKS);
  await ready(t, h);
  h.state.answer({ lt: 'a', r: 'good', v: 'x' });
  const before = h.state.progress();
  await save(h.state, { add: [{ term: '國二上', subject: '自然', code: '2-1' }], start: '2026-10-28' });
  const after = h.state.progress();
  assert.equal(after.done, before.done);
  assert.equal(after.subjects.find(row => row.subject === '自然')?.done, 1);
});

void test('結束這次考試：當場變回平常，檔案的開始與結束日不變；還沒開始的考試也一樣；有另一份時換它接手', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText() });
  await ready(t, h);
  assert.equal(h.lane('a'), 'exam-new');
  assert.deepEqual(await finish(h.state), { kind: 'done' });
  assert.equal(h.lane('a'), 'new');
  assert.equal(h.retention(), 0.8);
  assert.equal(h.state.exam().file, null);
  assert.equal(h.memory.texts.get(SCOPE), scopeText().replace('---\n-', '提前結束: 2026-10-20\n---\n-'));
  const other = FOLDER + 'b.md';
  const two = make(t, { ...DECKS, [SCOPE]: scopeText(), [other]: '---\n識別碼: other1\n考試開始: 2026-12-01\n---\n- 國二上 英文 L1\n' });
  await ready(t, two);
  assert.equal(two.lane('a'), 'exam-new');
  assert.deepEqual(two.state.exam().others, [other]);
  await finish(two.state);
  assert.equal(two.lane('a'), 'new');
  assert.equal(two.lane('c'), 'exam-new', '換它接手，不是回到平常');
  assert.equal(two.state.exam().path, other);
  assert.equal(two.retention(), 0.8, 'a 不在新的範圍裡');
});

void test('生效看清晨 4 點：結束日隔天 03:59 還生效，04:00 不生效；日期未定跨日照樣生效；開始日還沒到也提高', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText('2026-10-28', '2026-10-29') }, at('2026-10-30T03:59:00'));
  await ready(t, h);
  assert.equal(h.lane('a'), 'exam-new');
  assert.equal(h.retention(), 0.9);
  h.setNow(at('2026-10-30T04:00:00'));
  assert.equal(h.lane('a'), 'new');
  assert.equal(h.retention(), 0.8);
  const undated = make(t, { ...DECKS, [SCOPE]: '---\n識別碼: x\n---\n- 國二上 自然 2-1\n' });
  await ready(t, undated);
  assert.equal(undated.lane('a'), 'exam-new');
  assert.equal(undated.retention(), 0.8, '日期未定不提高');
  undated.setNow(NOON + 400 * DAY);
  assert.equal(undated.lane('a'), 'exam-new');
  const early = make(t, { ...DECKS, [SCOPE]: scopeText('2027-01-01', '2027-01-02') });
  await ready(t, early);
  assert.equal(early.retention(), 0.9, '開始日還沒到也提高');
});

void test('日期有問題：範圍照算，不提高保持率', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: '---\n考試開始: 10/28\n---\n- 國二上 自然 2-1\n' });
  await ready(t, h);
  assert.equal(h.lane('a'), 'exam-new');
  assert.equal(h.retention(), 0.8);
  assert.equal(h.state.exam().period.kind, 'bad');
});

void test('同一個識別碼 A 有提前結束、B 沒有：不生效', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText().replace('---\n-', '提前結束: 2026-10-19\n---\n-'), [FOLDER + 'copy.md']: scopeText() });
  await ready(t, h);
  assert.equal(h.lane('a'), 'new');
  assert.equal(h.state.exam().file, null);
});

void test('03:59 開始讀、04:00 才回來：用當下那次的時間算', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText('2026-10-28', '2026-10-28') }, at('2026-10-29T03:00:00'));
  await ready(t, h);
  assert.equal(h.lane('a'), 'exam-new');
  const changed = scopeText('2026-10-28', '2026-10-28', '- 國二上 自然 2-1', '- 國二上 英文 L1');
  const held = h.memory.holdRead(SCOPE);
  h.memory.write(SCOPE, changed);
  await tick(t);
  await held.started;
  h.setNow(at('2026-10-29T04:00:00'));
  held.release(changed);
  await tick(t, 0);
  assert.equal(h.lane('c'), 'new', '這時候已經過了，不生效');
  assert.equal(h.lane('a'), 'new');
});

void test('手改的存檔經檔案通知觸發重排；讀到同一份完全不通知', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText() });
  await ready(t, h);
  const before = h.changed();
  h.memory.write(SCOPE, scopeText('2026-10-28', '2026-10-29', '- 國二上 英文 L1'));
  await tick(t);
  assert.equal(h.changed(), before + 1);
  assert.equal(h.lane('c'), 'exam-new');
  assert.equal(h.lane('a'), 'new');
  h.memory.notify(SCOPE);
  await tick(t);
  assert.equal(h.changed(), before + 1);
});

void test('只改看不懂的行數：onChange 通知、今天的份不重排；改名選到同一份：都不多；改名讓另一份贏：重排', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText() });
  await ready(t, h);
  const today = h.state.today(), before = h.changed();
  h.memory.write(SCOPE, scopeText('2026-10-28', '2026-10-29', '- 國二上 自然 2-1', '老師說第三節不考'));
  await tick(t);
  assert.equal(h.changed(), before + 1);
  assert.equal(h.state.today(), today, '同一個物件就是沒有重排');
  assert.equal(h.state.exam().file?.lines.length, 2);
  h.memory.rename(SCOPE, FOLDER + '改名.md');
  await tick(t);
  assert.equal(h.changed(), before + 1, '改名不多通知');
  assert.equal(h.state.today(), today);
  assert.equal(h.state.exam().path, FOLDER + '改名.md');
  // 同一天開始的兩份，平手比路徑：改名之後另一份贏。
  const a = FOLDER + 'a.md', b = FOLDER + 'b.md';
  const two = make(t, { ...DECKS, [a]: '---\n考試開始: 2026-10-28\n---\n- 國二上 自然 2-1\n', [b]: '---\n考試開始: 2026-10-28\n---\n- 國二上 英文 L1\n' });
  await ready(t, two);
  assert.equal(two.lane('a'), 'exam-new');
  two.memory.rename(a, FOLDER + 'c.md');
  await tick(t);
  assert.equal(two.lane('c'), 'exam-new', '內容不同就重排');
  assert.equal(two.lane('a'), 'new');
});

void test('另一份的路徑變了只通知畫面', async t => {
  const other = FOLDER + 'b.md';
  const h = make(t, { ...DECKS, [SCOPE]: scopeText(), [other]: '---\n識別碼: other1\n考試開始: 2026-12-01\n---\n- 國二上 英文 L1\n' });
  await ready(t, h);
  const today = h.state.today(), before = h.changed();
  h.memory.rename(other, FOLDER + 'c.md');
  await tick(t);
  assert.equal(h.changed(), before + 1);
  assert.equal(h.state.today(), today);
  assert.deepEqual(h.state.exam().others, [FOLDER + 'c.md']);
});

void test('範圍檔不變、目標改了出處：lane 跟著變；暫停、草稿、待處理的目標照舊不算', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText('2026-10-28', '2026-10-29', '- 國二上 自然 9-9') });
  await ready(t, h);
  assert.equal(h.lane('a'), 'new');
  h.memory.write(NATURE, head('國二上', '自然', '2-1') + '- 目標 a ^a\n    - 出處：國二上 9-9 p.3\n    - 問 a :: 答 a\n- 目標 b ^b\n    - 問 b :: 答 b\n');
  await tick(t);
  assert.equal(h.lane('a'), 'exam-new');
  assert.equal(h.lane('b'), 'new');
  const stopped = make(t, { [NATURE]: head('國二上', '自然', '2-1') + '- 目標 a ^a\n    - 狀態：暫停\n    - 問 a :: 答 a\n- 目標 b ^b\n    - 問 b :: 答 b\n', [SCOPE]: scopeText() });
  await ready(t, stopped);
  assert.equal(stopped.lane('a'), undefined, '暫停的不出');
  assert.equal(stopped.lane('b'), 'exam-new');
  const draft = make(t, { [NATURE]: head('國二上', '自然', '2-1', '狀態: 草稿\n') + targets('a'), [SCOPE]: scopeText() });
  await ready(t, draft);
  assert.equal(draft.lane('a'), undefined);
  assert.equal(draft.state.today().slots.size, 0);
});

void test('範圍檔讀不到（reject）：同批的卡組照常、ready() 不被卡住、unread() 有它、不擋卡組的寫入；讀過又讀不到沿用上次的', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText() });
  h.memory.failing.add(SCOPE);
  await ready(t, h);
  assert.deepEqual(h.state.unread(), [SCOPE]);
  assert.equal(h.lane('a'), 'new', '第一次讀不到：今天的份當成沒有範圍');
  assert.equal(h.state.exam().file, null);
  assert.equal(h.state.exam().missing, 1);
  assert.deepEqual(await save(h.state, { add: [{ term: '國二上', subject: '自然', code: '2' }] }), { kind: 'blocked', reason: 'unread' });
  assert.equal(h.state.writeBlock(), null, '卡組的寫入不擋');
  h.memory.failing.delete(SCOPE);
  await tick(t, 1000);
  assert.deepEqual(h.state.unread(), []);
  assert.equal(h.lane('a'), 'exam-new', '讀到後重排');
  h.memory.failing.add(SCOPE);
  h.memory.notify(SCOPE);
  await tick(t);
  assert.deepEqual(h.state.unread(), [SCOPE]);
  assert.equal(h.lane('a'), 'exam-new', '讀過又讀不到：沿用上次讀到的');
  assert.equal(h.state.exam().missing, 0);
});

void test('一份卡住、另一份讀到：先用讀到的（暫定），寫不了；之後的通知不排在它後面；它回來後重新選', async t => {
  const a = FOLDER + 'a.md', b = FOLDER + 'b.md';
  const h = make(t, { ...DECKS, [a]: scopeText('2026-11-20', '2026-11-21'), [b]: '---\n識別碼: bbbbbb\n考試開始: 2026-10-28\n---\n- 國二上 英文 L1\n' });
  const held = h.memory.holdRead(b);
  const done = h.state.ready();
  await tick(t, 0);
  await held.started;
  await tick(t, 2000);
  await done;
  assert.equal(h.state.exam().path, a, '讀到的那份先用');
  assert.equal(h.lane('a'), 'exam-new', '範圍內的卡照考前排');
  assert.equal(h.retention(), 0.9);
  assert.equal(h.state.exam().settled, false, '還不知道另一份');
  assert.deepEqual(await save(h.state, { add: [{ term: '國二上', subject: '英文', code: 'L1' }] }), { kind: 'blocked', reason: 'unread' });
  await tick(t, 30_000);
  assert.deepEqual(h.state.unread(), [b], '一直沒回來算讀不到');
  assert.equal(h.state.exam().missing, 1);
  h.memory.write(a, scopeText('2026-11-22', '2026-11-23'));
  await tick(t);
  await tick(t);
  const period = h.state.exam().period;
  assert.equal(period.kind === 'ok' ? period.start : null, '2026-11-22', '讀到的那份之後的修改照常處理');
  h.memory.write(b, '---\n識別碼: bbbbbb\n考試開始: 2026-10-29\n---\n- 國二上 英文 L1\n');
  await tick(t);
  held.release();
  await tick(t, 0);
  await tick(t, 0);
  assert.equal(h.state.exam().settled, true);
  assert.deepEqual(h.state.unread(), []);
  const back = h.state.exam();
  assert.equal(back.path, b, '它是更早的考試：重新選');
  assert.equal(back.period.kind === 'ok' ? back.period.start : null, '2026-10-29', '卡住的時候又改了：讀完再讀一次，舊內容不留著');
});

void test('一份讀失敗、一份卡住：讀失敗的重試不等卡住的那份；都回來才算知道了', async t => {
  const a = FOLDER + 'a.md', b = FOLDER + 'b.md';
  const h = make(t, { ...DECKS, [a]: scopeText('2026-11-20', '2026-11-21'), [b]: '---\n識別碼: bbbbbb\n考試開始: 2026-10-28\n---\n- 國二上 英文 L1\n' });
  h.memory.failing.add(a);
  const held = h.memory.holdRead(b);
  const done = h.state.ready();
  await tick(t, 0);
  await tick(t, 2000);
  await done;
  assert.equal(h.state.exam().file, null);
  assert.equal(h.state.exam().settled, false);
  h.memory.failing.delete(a);
  await tick(t, 2000);
  await tick(t);
  assert.equal(h.state.exam().path, a, '重試成功');
  assert.equal(h.state.exam().settled, false, '另一份還沒回來');
  held.release();
  await tick(t, 0);
  assert.equal(h.state.exam().settled, true);
  assert.equal(h.state.exam().path, b);
  assert.equal(h.errors.length, 2, '第一次讀失敗一次、第一次重試一次；不多報');
});

void test('範圍檔一直沒回來：ready() 最多等 2 秒；卡組照常；讀到後重排；close 不等它、晚到的結果不回填', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText() });
  const held = h.memory.holdRead(SCOPE);
  const done = h.state.ready();
  await tick(t, 0);
  await held.started;
  await tick(t, 1999);
  let finished = false;
  void done.then(() => { finished = true; });
  await tick(t, 0);
  assert.equal(finished, false);
  await tick(t, 1);
  assert.equal(finished, true);
  await done;
  assert.equal(h.lane('a'), 'new');
  assert.equal(h.state.exam().settled, false);
  assert.deepEqual(await save(h.state, { add: [{ term: '國二上', subject: '自然', code: '2' }] }), { kind: 'blocked', reason: 'unread' });
  const before = h.changed();
  held.release();
  await tick(t, 0);
  assert.equal(h.state.exam().settled, true);
  assert.equal(h.lane('a'), 'exam-new');
  assert.equal(h.changed(), before + 1);

  const late = make(t, { ...DECKS, [SCOPE]: scopeText() });
  const stuck = late.memory.holdRead(SCOPE);
  const lateDone = late.state.ready();
  await tick(t, 0);
  await stuck.started;
  await tick(t, 2000);
  await lateDone;
  await late.state.close();
  stuck.release();
  await tick(t, 0);
  assert.equal(late.state.exam().file, null, '關閉之後晚到的結果不回填');
});

void test('一份範圍檔的屬性區讀不出來（alias 接不上、繞圈）：只有它算壞，第一次載入照常讀完，另一份照用', async t => {
  for (const bad of ['---\n考試開始: *missing\n---\n- 國二上 自然 2-1\n', '---\n考試開始: &a [*a]\n---\n- 國二上 自然 2-1\n']) {
    const h = make(t, { ...DECKS, [FOLDER + 'a.md']: bad, [FOLDER + 'b.md']: scopeText() });
    await ready(t, h);
    assert.equal(h.state.exam().settled, true, bad);
    assert.deepEqual(h.errors, [], bad);
    assert.equal(h.state.exam().path, FOLDER + 'b.md', '日期有問題的排在後面');
    assert.equal(h.lane('a'), 'exam-new', bad);
    const only = make(t, { ...DECKS, [FOLDER + 'a.md']: bad });
    await ready(t, only);
    assert.equal(only.state.exam().settled, true, bad);
    assert.equal(only.state.exam().period.kind, 'bad', bad);
    assert.equal(only.state.today().slots.get('a')?.retention, 0.8, '範圍照算，不提高保持率：' + bad);
    assert.deepEqual(await save(only.state, { add: [{ term: '國二上', subject: '英文', code: 'L1' }] }), { kind: 'blocked', reason: 'broken' });
  }
});

void test('範圍檔的資料夾列不出來：自己重試，卡組照常', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const memory = createMemoryFiles({ ...DECKS, [SCOPE]: scopeText() });
  const errors: unknown[] = [];
  const list = (folder: string): Promise<string[]> => memory.files.list(folder);
  let refused = 2;
  const files = { ...memory.files, list: (folder: string) => folder.includes('考試範圍') && refused-- > 0 ? Promise.reject(Error('列不出來')) : list(folder) };
  const state = createState({ files, device: 'PC-test', delay: DELAY, fillIds: false, now: () => NOON, offset: () => OFFSET, onError: error => { errors.push(error); } });
  t.after(() => state.close());
  const done = state.ready();
  await tick(t, 0);
  await tick(t, 1000);
  await tick(t, 1000);
  await done;
  assert.equal(state.today().slots.get('a')?.inExam, false);
  assert.equal(state.exam().settled, false, '不知道，不是沒有');
  assert.equal(errors.length, 2);
  await tick(t, 1000);
  assert.equal(state.exam().settled, true);
  assert.equal(state.today().slots.get('a')?.inExam, true);
});

void test('紀錄與卡組讀不到照舊擋', async t => {
  const h = make(t, { ...DECKS, [SCOPE]: scopeText() });
  h.memory.failing.add(ENGLISH);
  await ready(t, h);
  assert.deepEqual(h.state.unread(), [ENGLISH]);
  assert.equal(h.state.writeBlock(), 'unread');
});

void test('§5 保持率同一個值：今天的份、全部卡的順序、目錄顏色', async t => {
  // 間隔：good 一次之後，0.8 還沒到期、0.9 到期。
  const answered = at('2026-10-19T12:00:00');
  const log = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
  const line = JSON.stringify({ t: '2026-10-19T12:00:00.000+08:00', lt: 'a', r: 'good', v: 'x' }) + '\n' + JSON.stringify({ t: '2026-10-19T12:00:00.000+08:00', lt: 'b', r: 'good', v: 'x' }) + '\n';
  assert.ok(answered < NOON);
  const later = NOON + 2 * DAY;
  const off = make(t, { ...DECKS, [log]: line }, later);
  await ready(t, off);
  const on = make(t, { ...DECKS, [log]: line, [SCOPE]: '---\n識別碼: x\n考試開始: 2026-10-28\n---\n- 國二上 自然 2-1\n' }, later);
  await ready(t, on);
  const colorOf = (state: State): string | undefined => state.catalog().terms[0].subjects.flatMap(subject => subject.units).flatMap(unit => unit.targets).find(target => target.id === 'a')?.color;
  const dueOff = off.lane('a'), dueOn = on.lane('a');
  assert.equal(dueOff, undefined, '平常還沒到期');
  assert.equal(dueOn, 'exam-due', '考前到期');
  assert.equal(colorOf(off.state), 'good');
  assert.equal(colorOf(on.state), 'near', '顏色用同一個值');
  const key = on.state.catalog().terms[0].subjects.flatMap(subject => subject.units).find(unit => unit.code === '2-1')?.key ?? '';
  const nextOff = off.state.next({ unit: key, since: later }), nextOn = on.state.next({ unit: key, since: later });
  assert.ok(nextOff.kind === 'card' && nextOn.kind === 'card');
  assert.equal(nextOff.card.early, false);
  assert.equal(nextOn.card.lt, 'a');
});

void test('紀錄的行舊版也讀得懂：進 changes，不算作答，不帶 need', async t => {
  const h = make(t, DECKS);
  await ready(t, h);
  await save(h.state, { add: [{ term: '國二上', subject: '自然', code: '2' }], start: '2026-10-28' });
  const history = h.state.history();
  assert.equal(history.reviews.length, 0);
  assert.equal(history.incomplete, false);
  assert.equal(history.changes.filter(change => change.set === 'exam').length, 1);
});
