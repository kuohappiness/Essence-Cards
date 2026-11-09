import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistory, planToday } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { SettingsValue } from '../src/core/settings/index.ts';
import type { StateOptions } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import type { MemoryFiles } from './helpers/memory-files.ts';

// 狀態與設定的變更紀錄（tasks/record-gaps.md §1、§6 第 1～18 條）。一律透過 createState 與假的 Files。
const DELAY = 30;
const ROOT = 'Essence Cards/';
const A = ROOT + 'A（卡片）.md', B = ROOT + 'B（卡片）.md', C = ROOT + 'C（卡片）.md';
const OWN = ROOT + '紀錄/2026-10 Windows-2c9e.jsonl';
const NOV = ROOT + '紀錄/2026-11 Windows-2c9e.jsonl';
const PHONE = ROOT + '紀錄/2026-10 iPhone-7f3a.jsonl';
const NOW = Date.parse('2026-10-24T19:00:00.000+08:00');
const T = (minute: number): string => `2026-10-20T19:${String(minute).padStart(2, '0')}:00.000+08:00`;
const goal = (id: string, extra = ''): string => `- 能說明 ${id} ^${id}\n${extra}    - 題目 ${id} :: 答案 ${id}\n`;
const paused = '    - 狀態：暫停\n';
const deck = (status: string | null, id = 'aaaaaa', extra = ''): string => (status === null ? '' : `---\n狀態: ${status}\n---\n`) + goal(id, extra);
const line = (t: string, fields: object): string => JSON.stringify({ t, ...fields });
const review = (t: string, lt = 'aaaaaa'): string => line(t, { lt, r: 'good', v: '12345678' });
/** 設定的基準：想只看卡組與目標時先放好，這幾行就不會再寫。 */
const SETTLED = [line(T(0), { set: 'cap', val: 30 }), line(T(0), { set: 'retention', val: 0.8 }), line(T(0), { set: 'filter', val: [] })].join('\n') + '\n';
const statusLine = (t: string, target: { deck: string } | { lt: string }, val: string): string => line(t, { set: 'status', ...target, val });

interface Short { t: string; text: string }
const short = (raw: string): Short => {
  const data = JSON.parse(raw) as { t: string; set?: string; deck?: string; lt?: string; val?: unknown };
  if (!data.set) return { t: data.t, text: String(data.lt) };
  const who = data.deck ?? data.lt;
  return { t: data.t, text: who === undefined ? `${data.set}=${JSON.stringify(data.val)}` : `${who.replace(ROOT, '')}=${String(data.val)}` };
};
const linesOf = (memory: MemoryFiles, path = OWN): string[] => (memory.texts.get(path) ?? '').split('\n').filter(Boolean);
const shorts = (memory: MemoryFiles, path = OWN): string[] => linesOf(memory, path).map(raw => short(raw).text);

const enabled = new WeakSet<TestContext>();
function launch(t: TestContext, memory: MemoryFiles, options: Partial<StateOptions> = {}) {
  if (!enabled.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); enabled.add(t); }
  const state = createState({ files: memory.files, device: 'Windows-2c9e', delay: DELAY, fillIds: false, now: () => NOW, offset: () => 480, ...options });
  t.after(() => state.close());
  const tick = async (ms: number): Promise<void> => { t.mock.timers.tick(ms); await new Promise<void>(resolve => setImmediate(resolve)); };
  return { state, tick };
}
async function open(t: TestContext, memory: MemoryFiles, options: Partial<StateOptions> = {}) {
  const opened = launch(t, memory, options);
  await opened.state.ready();
  await opened.state.flush();
  return opened;
}

void test('§1-1 第一次 ready 寫六行基準；同樣內容再 ready 一次一行都不多', async t => {
  const memory = createMemoryFiles({ [A]: deck('草稿', 'aaaaaa'), [B]: deck('啟用', 'bbbbbb'), [C]: deck('暫停', 'cccccc') });
  const first = await open(t, memory);
  await first.state.close();
  assert.deepEqual(shorts(memory), ['A（卡片）.md=草稿', 'B（卡片）.md=啟用', 'C（卡片）.md=暫停', 'cap=30', 'retention=0.8', 'filter=[]']);
  const second = await open(t, memory, { now: () => NOW + 60_000 });
  await second.state.close();
  assert.equal(shorts(memory).length, 6);
});

void test('§1-2 外掛關著時改成暫停：重開多一行，時間是重開的時候', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const first = await open(t, memory);
  await first.state.close();
  memory.texts.set(A, deck('暫停'));
  const later = NOW + 3_600_000;
  const second = await open(t, memory, { now: () => later });
  await second.state.close();
  const last = short(linesOf(memory).at(-1) as string);
  assert.equal(last.text, 'A（卡片）.md=暫停');
  assert.equal(Date.parse(last.t), later);
  assert.equal(shorts(memory).length, 5);
});

void test('§1-3 開著改 啟用 → 暫停 → 啟用 多兩行；同一份內容再通知不多', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const { state, tick } = await open(t, memory);
  const before = shorts(memory).length;
  memory.write(A, deck('暫停'));
  await tick(DELAY);
  memory.write(A, deck('啟用'));
  await tick(DELAY);
  memory.notify(A);
  await tick(DELAY);
  await state.flush();
  assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=暫停', 'A（卡片）.md=啟用']);
});

void test('§1-5 有讀不到的卡組或自己的紀錄時不寫，補齊後寫一次', async t => {
  for (const unreadable of [B, OWN]) {
    const memory = createMemoryFiles({ [A]: deck('啟用'), [B]: deck('啟用', 'bbbbbb'), [OWN]: '' });
    memory.failing.add(unreadable);
    const { state, tick } = launch(t, memory);
    void state.ready();
    for (let i = 0; i < 5; i++) await tick(2000);
    await state.flush().catch(() => {});
    assert.deepEqual(shorts(memory), [], unreadable);
    memory.failing.delete(unreadable);
    await tick(60_000);
    await state.flush();
    assert.equal(shorts(memory).length, 5, unreadable);
    await tick(60_000);
    await state.flush();
    assert.equal(shorts(memory).length, 5, unreadable);
    await state.close();
  }
});

void test('§1-5 補齊的內容和快取相同也要比：別篇的變更在補齊後才寫', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用'), [B]: deck('啟用', 'bbbbbb') });
  const { state, tick } = await open(t, memory);
  const before = shorts(memory).length;
  // B 讀不到；A 同時改了。
  memory.failing.add(B);
  memory.write(B, deck('啟用', 'bbbbbb'));
  memory.write(A, deck('暫停'));
  await tick(DELAY);
  await state.flush();
  assert.deepEqual(state.unread(), [B]);
  assert.equal(shorts(memory).length, before);
  memory.failing.delete(B);
  await tick(1000);
  await state.flush();
  assert.deepEqual(state.unread(), []);
  assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=暫停']);
});

void test('§1-5 history.incomplete 時全部不寫，更新後再比', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用'), [PHONE]: line(T(1), { need: '9.0.0', set: 'cap', val: 5 }) + '\n' });
  const { state, tick } = await open(t, memory);
  assert.equal(state.history().incomplete, true);
  assert.deepEqual(shorts(memory), []);
  memory.write(PHONE, '');
  await tick(DELAY);
  await state.flush();
  assert.equal(state.history().incomplete, false);
  assert.equal(shorts(memory).length, 4);
});

void test('§1-6 別台的行先到、卡組還沒變：不寫；之後卡組變了寫一行', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const { state, tick } = await open(t, memory);
  const before = shorts(memory).length;
  memory.append(PHONE, statusLine('2026-10-24T20:00:00.000+08:00', { deck: A }, '暫停'));
  await tick(DELAY);
  await state.flush();
  assert.equal(shorts(memory).length, before);
  memory.write(A, deck('暫停'));
  await tick(DELAY);
  await state.flush();
  assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=暫停']);
});

void test('§1-6 卡組先到、別台的行後到：這台一行，後到的行不再多寫', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const { state, tick } = await open(t, memory);
  const before = shorts(memory).length;
  memory.write(A, deck('暫停'));
  await tick(DELAY);
  memory.append(PHONE, statusLine('2026-10-24T20:00:00.000+08:00', { deck: A }, '暫停'));
  await tick(DELAY);
  await state.flush();
  assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=暫停']);
});

void test('§1-7 別台時鐘偏快寫了暫停，連續十批通知：這台一行都不多', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const { state, tick } = await open(t, memory);
  const before = shorts(memory).length;
  for (let i = 0; i < 10; i++) {
    memory.append(PHONE, statusLine(`2027-01-01T00:00:0${String(i)}.000+08:00`, { deck: A }, i % 2 ? '啟用' : '暫停'));
    await tick(DELAY);
  }
  await state.flush();
  assert.equal(shorts(memory).length, before);
});

void test('§1-8 改名：新路徑一行，舊路徑的行逐字不變；刪掉不寫；同路徑刪掉再建值相同不多寫', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const { state, tick } = await open(t, memory);
  const baseline = linesOf(memory);
  memory.rename(A, B);
  await tick(DELAY);
  await state.flush();
  assert.deepEqual(linesOf(memory).slice(0, baseline.length), baseline);
  assert.deepEqual(shorts(memory).slice(baseline.length), ['B（卡片）.md=啟用']);
  memory.remove(B);
  await tick(DELAY);
  await state.flush();
  assert.equal(linesOf(memory).length, baseline.length + 1);
  memory.write(B, deck('啟用'));
  await tick(DELAY);
  await state.flush();
  assert.equal(linesOf(memory).length, baseline.length + 1);
});

void test('§1-8 目標的 lt 搬到別篇：不多寫', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用', 'aaaaaa', paused), [B]: deck('啟用', 'bbbbbb') });
  const { state, tick } = await open(t, memory);
  const before = shorts(memory).length;
  assert.ok(shorts(memory).includes('aaaaaa=暫停'));
  memory.write(A, deck('啟用', 'cccccc'));
  memory.write(B, deck('啟用', 'bbbbbb') + goal('aaaaaa', paused));
  await tick(DELAY);
  await state.flush();
  assert.deepEqual(shorts(memory).slice(before).filter(text => text.startsWith('aaaaaa')), []);
});

void test('§1-9 卡組的狀態打到一半、空值、屬性區壞掉：不寫，上次的值不動；改回合法值後照比', async t => {
  for (const bad of ['---\n狀態: 暫\n---\n', '---\n狀態:\n---\n', '---\n狀態: [\n---\n', '---\n狀態: 暫停\n']) {
    const memory = createMemoryFiles({ [A]: deck('暫停') });
    const { state, tick } = await open(t, memory);
    const before = shorts(memory).length;
    memory.write(A, bad + goal('aaaaaa'));
    await tick(DELAY);
    await state.flush();
    assert.equal(shorts(memory).length, before, bad);
    memory.write(A, deck('暫停'));
    await tick(DELAY);
    await state.flush();
    assert.equal(shorts(memory).length, before, bad);
    memory.write(A, deck('啟用'));
    await tick(DELAY);
    await state.flush();
    assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=啟用'], bad);
    await state.close();
  }
});

void test('§1-9 新的卡組狀態讀壞時也不寫基準', async t => {
  const memory = createMemoryFiles({ [A]: '---\n狀態: 暫\n---\n' + goal('aaaaaa') });
  const { state } = await open(t, memory);
  await state.close();
  assert.deepEqual(shorts(memory).filter(text => text.startsWith('A')), []);
});

void test('§1-9 沒有狀態屬性寫啟用；轉錄稿、沒有目標又沒寫狀態的筆記不寫；沒有目標但明寫了狀態的算', async t => {
  const memory = createMemoryFiles({
    [A]: goal('aaaaaa'),
    [B]: '---\n來源類型: 影片\n---\n逐字稿\n',
    [C]: '只是筆記\n',
    [ROOT + 'D（卡片）.md']: '---\n狀態: 草稿\n---\n還沒寫目標\n',
  });
  const { state } = await open(t, memory);
  await state.close();
  assert.deepEqual(shorts(memory).filter(text => text.includes('.md=')), ['A（卡片）.md=啟用', 'D（卡片）.md=草稿']);
});

void test('§1-10 目標：暫停一行，拿掉後一行啟用；暫停 → 狀態：暫 → 暫停 不多；重複欄位用第一個', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用', 'aaaaaa', paused) });
  const { state, tick } = await open(t, memory);
  const before = shorts(memory).length;
  assert.ok(shorts(memory).includes('aaaaaa=暫停'));
  memory.write(A, deck('啟用', 'aaaaaa', '    - 狀態：暫\n'));
  await tick(DELAY);
  memory.write(A, deck('啟用', 'aaaaaa', paused));
  await tick(DELAY);
  await state.flush();
  assert.equal(shorts(memory).length, before);
  memory.write(A, deck('啟用', 'aaaaaa', '    - 狀態：啟用\n    - 狀態：暫停\n'));
  await tick(DELAY);
  await state.flush();
  assert.deepEqual(shorts(memory).slice(before), ['aaaaaa=啟用']);
  memory.write(A, deck('啟用'));
  await tick(DELAY);
  await state.flush();
  assert.equal(shorts(memory).length, before + 1);
});

void test('§1-10 沒有 ID、ID 重複、待處理的不寫；沒暫停的目標沒有行；整篇暫停不替目標寫', async t => {
  const memory = createMemoryFiles({
    [A]: deck('啟用', 'aaaaaa') + '- 沒有 ID 的目標\n' + paused + '    - 題目 :: 答案\n',
    [B]: deck('暫停', 'bbbbbb'),
    [C]: goal('dddddd', paused) + goal('dddddd', paused),
  });
  const { state } = await open(t, memory);
  await state.close();
  assert.deepEqual(shorts(memory).filter(text => !text.includes('.md=') && !/^(?:cap|retention|filter)=/.test(text)), []);
});

void test('§1-10 目標的狀態認不得：這台沒有舊行時也不寫', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用', 'aaaaaa', '    - 狀態：暫\n') });
  const { state } = await open(t, memory);
  await state.close();
  assert.deepEqual(shorts(memory).filter(text => text.startsWith('aaaaaa')), []);
});

void test('§1-11 需要新版的卡組與裡面的目標不寫', async t => {
  const memory = createMemoryFiles({ [A]: '---\n需要版本: 9.0.0\n狀態: 暫停\n---\n' + goal('aaaaaa', paused) });
  const { state } = await open(t, memory, { build: '0.1.0+1a2b3c4' });
  await state.close();
  assert.deepEqual(shorts(memory).filter(text => text.includes('.md=') || text.startsWith('aaaaaa')), []);
});

void test('§1-12 手機（不能寫卡組）照樣寫', async t => {
  const memory = createMemoryFiles({ [A]: deck('暫停') });
  const { state } = await open(t, memory, { fillIds: false });
  await state.close();
  assert.ok(shorts(memory).includes('A（卡片）.md=暫停'));
});

void test('§1-13 append 失敗一次：重試成功後這個變更只有一行', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用'), [OWN]: SETTLED + statusLine(T(1), { deck: A }, '啟用') + '\n' });
  const { state, tick } = await open(t, memory);
  const before = shorts(memory).length;
  memory.control.failAppend = true;
  memory.write(A, deck('暫停'));
  await tick(DELAY);
  await assert.rejects(state.flush());
  memory.notify(A);
  await tick(DELAY);
  memory.control.failAppend = false;
  await state.flush();
  assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=暫停']);
});

void test('§1-14 變更行不影響排程與重播；seen 只多了目標狀態行的 lt，重讀與增量一致', async t => {
  const answer = review('2026-10-20T19:00:00.000+08:00');
  const undone = review('2026-10-21T19:00:00.000+08:00', 'bbbbbb');
  const log = [answer, undone, line('2026-10-21T19:01:00.000+08:00', { undo: '2026-10-21T19:00:00.000+08:00' })].join('\n') + '\n';
  const memory = createMemoryFiles({ [A]: deck('啟用', 'aaaaaa', paused) + goal('eeeeee'), [B]: deck('暫停', 'bbbbbb'), [C]: deck('草稿', 'cccccc'), [OWN]: log });
  const { state } = await open(t, memory);
  const input = state.input();
  const withLines = mergeHistory([{ path: OWN, text: memory.texts.get(OWN) as string }]);
  const without = mergeHistory([{ path: OWN, text: log }]);
  assert.deepEqual(state.history(), withLines);
  assert.deepEqual(state.history().seen, [...new Set([...without.seen, 'aaaaaa'])].sort());
  assert.deepEqual(withLines.reviews, without.reviews);
  assert.deepEqual([withLines.held, withLines.incomplete, withLines.problems, withLines.cancelled], [without.held, without.incomplete, without.problems, without.cancelled]);
  assert.ok(withLines.changes.length > without.changes.length);
  assert.deepEqual(planToday({ ...input, history: withLines }), planToday({ ...input, history: without }));
  assert.deepEqual(state.today(), planToday({ ...input, history: without }));
});

void test('§1-15 時鐘回撥跨月：連續三批只多一行，重開後最多再多一行', async t => {
  const memory = createMemoryFiles({ [A]: deck('暫停'), [NOV]: SETTLED + statusLine('2026-11-01T08:00:00.000+08:00', { deck: A }, '啟用') + '\n' });
  const back = Date.parse('2026-10-31T20:00:00.000+08:00');
  const { state, tick } = await open(t, memory, { now: () => back });
  for (let i = 0; i < 3; i++) { memory.notify(A); await tick(DELAY); }
  await state.close();
  assert.deepEqual(shorts(memory, OWN), ['A（卡片）.md=暫停']);
  const again = await open(t, memory, { now: () => back + 60_000 });
  await again.state.close();
  assert.ok(shorts(memory, OWN).length <= 2);
  assert.equal(shorts(memory, NOV).length, 4);
});

void test('§1-15 正常跨月不多寫；同月回撥照行序比', async t => {
  const memory = createMemoryFiles({ [A]: deck('暫停'), [OWN]: SETTLED + statusLine('2026-10-30T08:00:00.000+08:00', { deck: A }, '暫停') + '\n' });
  const november = await open(t, memory, { now: () => Date.parse('2026-11-02T08:00:00.000+08:00') });
  await november.state.close();
  assert.deepEqual(shorts(memory, NOV), []);
  // 同一個月裡後面的行時間較早：照行的順序，最後一行是暫停。
  const sameMonth = createMemoryFiles({ [A]: deck('暫停'), [OWN]: SETTLED + statusLine('2026-10-30T08:00:00.000+08:00', { deck: A }, '啟用') + '\n' + statusLine('2026-10-10T08:00:00.000+08:00', { deck: A }, '暫停') + '\n' });
  const before = shorts(sameMonth).length;
  const opened = await open(t, sameMonth);
  await opened.state.close();
  assert.equal(shorts(sameMonth).length, before);
});

void test('§1-16 衝突副本與還原檔不算這台的；換裝置碼重新寫一份基準', async t => {
  for (const other of ['2026-10 Windows-2c9e 2.jsonl', '2026-10 Windows-2c9e 還原 2026-11-02 Windows-1111.jsonl']) {
    const memory = createMemoryFiles({ [A]: deck('暫停'), [OWN]: SETTLED + statusLine(T(1), { deck: A }, '啟用') + '\n', [ROOT + '紀錄/' + other]: statusLine(T(2), { deck: A }, '暫停') + '\n' });
    const before = shorts(memory).length;
    const { state } = await open(t, memory);
    await state.close();
    assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=暫停'], other);
  }
  const memory = createMemoryFiles({ [A]: deck('暫停'), [OWN]: SETTLED + statusLine(T(1), { deck: A }, '暫停') + '\n' });
  const { state } = await open(t, memory, { device: 'Windows-9999' });
  await state.close();
  assert.equal(shorts(memory, ROOT + '紀錄/2026-10 Windows-9999.jsonl').length, 4);
});

void test('§1-17 舊版的第一行是按鈕記的暫停、卡組仍暫停：不多寫', async t => {
  const memory = createMemoryFiles({ [A]: deck('暫停'), [OWN]: SETTLED + statusLine(T(1), { deck: A }, '暫停') + '\n' });
  const before = shorts(memory).length;
  const { state } = await open(t, memory);
  await state.close();
  assert.equal(shorts(memory).length, before);
});

void test('§1-18 自己的檔最後一行沒有換行：新行另起一行，一行一筆，原本的作答與 undo 都在', async t => {
  const answer = review(T(1)), undone = review(T(2), 'bbbbbb'), undo = line(T(3), { undo: T(2) });
  for (const [tail, count] of [[answer, 1], [undone + '\n' + undo, 0]] as const) {
    const memory = createMemoryFiles({ [A]: deck('啟用'), [OWN]: tail });
    const first = await open(t, memory);
    await first.state.close();
    const text = memory.texts.get(OWN) as string;
    assert.ok(text.startsWith(tail + '\n{'));
    // 舊版（0.3.0）遇到黏在一起的兩筆只救得回最後一段，所以每一行都要自己是一筆完整的 JSON（L2 的 R1）。
    for (const raw of text.split('\n').filter(Boolean)) assert.doesNotThrow(() => JSON.parse(raw) as unknown);
    const history = mergeHistory([{ path: OWN, text }]);
    assert.equal(history.reviews.length, count);
    assert.equal(history.problems.length, 0);
    assert.equal(history.changes.length, 4);
    const second = await open(t, memory, { now: () => NOW + 60_000 });
    await second.state.close();
    assert.equal(memory.texts.get(OWN), text);
  }
});

void test('§1-18 沒有換行的檔：作答也另起一行、只補一次；寫到一半的那行不影響新行', async t => {
  const settled = SETTLED + statusLine(T(1), { deck: A }, '啟用');
  for (const [tail, problems] of [[settled, 0], [settled + '\n{"t":"2026-10-20T19:0', 1]] as const) {
    const memory = createMemoryFiles({ [A]: deck('啟用'), [OWN]: tail });
    const { state } = await open(t, memory);
    state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' });
    state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' });
    await state.flush();
    await state.close();
    const text = memory.texts.get(OWN) as string;
    assert.ok(text.startsWith(tail + '\n{'));
    assert.ok(!text.includes('\n\n'));
    const history = mergeHistory([{ path: OWN, text }]);
    assert.equal(history.reviews.length, 2);
    assert.equal(history.problems.length, problems);
  }
});

void test('§1-18 自己的檔帶讀不懂的 need：照 §5-2 只停它影響的目標，其他照寫', async t => {
  const memory = createMemoryFiles({ [A]: deck('暫停', 'aaaaaa', paused) + goal('bbbbbb', paused), [OWN]: line(T(1), { need: '9.0.0', lt: 'aaaaaa', r: 'good', v: '12345678' }) + '\n' });
  const { state } = await open(t, memory);
  await state.close();
  assert.deepEqual(state.history().held, ['aaaaaa']);
  assert.deepEqual(shorts(memory).slice(1).filter(text => !/^(?:cap|retention|filter)=/.test(text)), ['A（卡片）.md=暫停', 'bbbbbb=暫停']);
});

void test('§1-4 目錄按鈕與草稿按啟用各只有一行', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用'), [B]: deck('草稿', 'bbbbbb') });
  const { state } = await open(t, memory, { fillIds: true });
  const before = shorts(memory).length;
  assert.equal((await state.setDeckStatus(A, '暫停', null)).kind, 'done');
  assert.equal((await state.activateDraft(B, null)).kind, 'done');
  await state.flush();
  assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=暫停', 'B（卡片）.md=啟用']);
});

void test('§1-4 結果是 saved 先不記，之後讀到才記一行', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const { state, tick } = await open(t, memory, { fillIds: true });
  const before = shorts(memory).length;
  memory.failing.add(A);
  assert.equal((await state.setDeckStatus(A, '暫停', null)).kind, 'saved');
  await state.flush();
  assert.equal(shorts(memory).length, before);
  memory.failing.delete(A);
  await tick(1000);
  await state.flush();
  assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=暫停']);
});

void test('§1-4 核對到不同內容：只記實際採用的值', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const { state, tick } = await open(t, memory, { fillIds: true });
  const before = shorts(memory).length;
  memory.failing.add(A);
  assert.equal((await state.setDeckStatus(A, '暫停', null)).kind, 'saved');
  memory.texts.set(A, deck('草稿'));
  memory.failing.delete(A);
  await tick(1000);
  await state.flush();
  assert.deepEqual(shorts(memory).slice(before), ['A（卡片）.md=草稿']);
});


// 和設定頁的交接（tasks/settings-page.md §3「給補紀錄缺口的介面」）。
const SETTINGS_SETS = ['cap', 'retention', 'filter', 'semester'];
const settingLines = (memory: MemoryFiles, path = OWN): unknown[][] => linesOf(memory, path).map(raw => JSON.parse(raw) as { set?: string; val?: unknown }).filter(each => SETTINGS_SETS.includes(each.set ?? '')).map(each => [each.set, each.val]);
const value = (extra: Partial<SettingsValue> = {}, capMinutes = 30): SettingsValue => ({ settings: { capMinutes, retention: 0.8, filter: [] }, semester: null, examCountdown: true, known: true, ...extra });
const DEFAULTS = [['cap', 30], ['retention', 0.8], ['filter', []]];

void test('§1 交接：data.json 還沒讀到時四種設定都不比，讀到才寫基準；沒設定學期不寫 semester', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const { state } = await open(t, memory, { settingsFirst: Promise.resolve(value({ known: false })) });
  assert.deepEqual(settingLines(memory), []);
  state.applySettings(value());
  await state.flush();
  assert.deepEqual(settingLines(memory), DEFAULTS);
});

void test('§1 交接：第一次的值直接進 load、不經 applySettings 也寫基準，學期是算出來的值', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  await open(t, memory, { settingsFirst: Promise.resolve(value({ semester: { value: '國二上', setOn: '2026-09-15' } }, 20)) });
  assert.deepEqual(settingLines(memory), [['cap', 20], ['retention', 0.8], ['filter', []], ['semester', '國二上']]);
});

void test('§1 交接：改設定多一行，先排入紀錄再通知畫面；同樣的值再來一次不多', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  const { state } = await open(t, memory, { settingsFirst: Promise.resolve(value()) });
  let seen: unknown = null;
  state.onChange(() => { seen ??= state.history().changes.at(-1)?.val; });
  state.applySettings(value({}, 45));
  assert.equal(seen, 45);
  state.applySettings(value({}, 45));
  await state.flush();
  assert.deepEqual(settingLines(memory), [...DEFAULTS, ['cap', 45]]);
});

void test('§1 交接：過了 2/1 學期自己變，data.json 沒變：換日後第一次排今天的份多一行，時間是發現的時候', async t => {
  const memory = createMemoryFiles({ [A]: deck('啟用') });
  let clock = Date.parse('2027-01-31T12:00:00.000+08:00');
  const { state } = await open(t, memory, { now: () => clock, settingsFirst: Promise.resolve(value({ semester: { value: '國二上', setOn: '2026-09-15' } })) });
  const JAN = ROOT + '紀錄/2027-01 Windows-2c9e.jsonl', FEB = ROOT + '紀錄/2027-02 Windows-2c9e.jsonl';
  assert.deepEqual(settingLines(memory, JAN).at(-1), ['semester', '國二上']);
  clock = Date.parse('2027-02-01T03:59:00.000+08:00');
  state.today();
  await state.flush();
  assert.deepEqual(settingLines(memory, FEB), [], '清晨 4 點前還是前一天');
  clock = Date.parse('2027-02-01T08:00:00.000+08:00');
  state.today();
  state.today();
  await state.flush();
  assert.deepEqual(settingLines(memory, FEB), [['semester', '國二下']]);
  assert.equal((JSON.parse(linesOf(memory, FEB)[0]) as { t: string }).t, '2027-02-01T08:00:00.000+08:00');
});
