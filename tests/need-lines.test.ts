import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/core/deck/index.ts';
import { appendLine, encodeEntry, mergeHistory, nextCard, planToday, readHistory } from '../src/core/study/index.ts';
import type { DeckEntry, History, TodayInput } from '../src/core/study/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// 讀不懂的紀錄行（syntax.md §5-2、D-149 第 3 點、Codex 格式查核 F2）：先看 need，讀不懂時保留原文、停掉它影響的學習目標，
// 辨認不出來就全部停。這台的版本是 0.1.0；標記用 9.0.0 代表比這台新。

const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
const PC = 'Essence Cards/紀錄/2026-10 Windows-2c9e.jsonl';
const T = '2026-10-28T10:00:00.000+08:00';
const review = (t: string, lt: string, r = 'good') => encodeEntry(t, { lt, r: r as 'good', v: '12345678' });
const merge = (lines: string[], version: string | null = '0.1.0', path = PHONE) => mergeHistory([{ path, text: lines.join('\n') + '\n' }], version);
const held = (history: History) => ({ held: history.held, incomplete: history.incomplete });

const deck: DeckEntry = { path: 'Essence Cards/A（卡片）.md', deck: parseDeck(['abc123', 'def456', 'ghi789'].map(id => `- 能說明 ${id} ^${id}\n    - 題目 ${id} :: 答案 ${id}`).join('\n')) };
function plan(history: History, now = '2026-10-29T19:00:00.000+08:00'): string[] {
  const input: TodayInput = { decks: [deck], history, settings: { capMinutes: 30, retention: 0.8, filter: [] }, exam: null, now: Date.parse(now), offset: 480 };
  const today = planToday(input);
  return [...today.share, ...today.more].map(item => item.lt).sort();
}

void test('Codex 的 undo 反例：帶 need 的 undo 不套用，原本那筆作答不會復活成可排程，目標被暫停', () => {
  const history = merge([review(T, 'abc123'), JSON.stringify({ t: '2026-10-28T10:01:00.000+08:00', need: '9.0.0', undo: T })]);
  assert.deepEqual(held(history), { held: ['abc123'], incomplete: false });
  assert.deepEqual(history.cancelled, []);
  assert.deepEqual(history.problems, []);
  assert.deepEqual(plan(history), ['def456', 'ghi789']);
  // 讀得懂的版本照常取消：同一份紀錄、這台是 9.0.0 時 0 筆有效作答，目標照常排程。
  const newer = merge([review(T, 'abc123'), JSON.stringify({ t: '2026-10-28T10:01:00.000+08:00', need: '9.0.0', undo: T })], '9.0.0');
  assert.deepEqual([newer.reviews.length, newer.cancelled, held(newer)], [0, [T], { held: [], incomplete: false }]);
  assert.deepEqual(plan(newer), ['abc123', 'def456', 'ghi789']);
});

void test('Codex 漏掉 miss 的反例：帶 need 的 miss 讓目標暫停，不是用舊的熟練度排到很久以後', () => {
  const lines = [review('2026-10-01T19:00:00.000+08:00', 'abc123'), review('2026-10-08T19:00:00.000+08:00', 'abc123'), review('2026-10-20T19:00:00.000+08:00', 'abc123')];
  const miss = JSON.stringify({ t: '2026-10-28T19:00:00.000+08:00', need: '9.0.0', lt: 'abc123', r: 'miss', v: '12345678' });
  // 對照：跳過那一行時 abc123 今天不出（舊的熟練度排到之後）；讀得懂時 miss 讓它今天再學。
  assert.equal(plan(merge(lines)).includes('abc123'), false);
  assert.equal(plan(merge([...lines, miss], '9.0.0')).includes('abc123'), true);
  const history = merge([...lines, miss]);
  assert.deepEqual(held(history), { held: ['abc123'], incomplete: false });
  assert.equal(history.reviews.length, 3);
  assert.deepEqual(plan(history), ['def456', 'ghi789']);
  // 之後的每一天也不出，直到換成讀得懂的版本。
  assert.deepEqual(plan(history, '2026-11-20T19:00:00.000+08:00'), ['def456', 'ghi789']);
});

void test('F2：lt 有效、undo 找得到時只停這兩個（undo 指到的作答在別的檔、已被取消也算找得到）', () => {
  const lines = [review(T, 'def456'), JSON.stringify({ t: '2026-10-28T10:02:00.000+08:00', need: '9.0.0', lt: 'abc123', undo: T })];
  assert.deepEqual(held(merge(lines)), { held: ['abc123', 'def456'], incomplete: false });
  const other = mergeHistory([{ path: PC, text: review(T, 'def456') + '\n' + encodeEntry('2026-10-28T10:01:00.000+08:00', { undo: T }) + '\n' },
    { path: PHONE, text: JSON.stringify({ t: '2026-10-28T10:02:00.000+08:00', need: '9.0.0', undo: T }) + '\n' }], '0.1.0');
  assert.deepEqual(held(other), { held: ['def456'], incomplete: false });
  assert.deepEqual(other.cancelled, [T]);
  // 不同裝置同一刻的兩筆作答：undo 指到的兩筆都停。
  const both = mergeHistory([{ path: PC, text: review(T, 'def456') + '\n' }, { path: PHONE, text: review(T, 'ghi789', 'miss') + '\n' + JSON.stringify({ t: '2026-10-28T10:02:00.000+08:00', need: '9.0.0', undo: T }) + '\n' }], '0.1.0');
  assert.deepEqual(held(both), { held: ['def456', 'ghi789'], incomplete: false });
  assert.deepEqual(plan(both), ['abc123']);
});

void test('F2：三個條件任何一個不成立就整個歷史不完整、全部停', () => {
  const base = { t: '2026-10-28T10:02:00.000+08:00', need: '9.0.0' };
  const cases: [string, Record<string, unknown>][] = [
    ['lt 與 undo 都沒有', { set: 'cap', val: 20 }],
    ['lt 是空字串', { lt: '' }],
    ['lt 只有空白', { lt: '  ' }],
    ['lt 不是字串', { lt: 5 }],
    ['lt 是 null', { lt: null }],
    ['有 lt 但 undo 指的作答找不到', { lt: 'abc123', undo: '2026-10-28T09:00:00.000+08:00' }],
    ['undo 是空字串', { undo: '' }],
    ['undo 不是字串', { undo: 1 }],
    ['undo 指到的是變更不是作答', { undo: '2026-10-27T10:00:00.000+08:00' }],
  ];
  for (const [label, fields] of cases) {
    const history = merge([review(T, 'def456'), encodeEntry('2026-10-27T10:00:00.000+08:00', { set: 'cap', val: 20 }), JSON.stringify({ ...base, ...fields })]);
    assert.equal(history.incomplete, true, label);
    assert.deepEqual(plan(history), [], label);
  }
});

void test('§0-1 標記壞掉的行不被當成沒有標記；讀得懂的標記照平常讀', () => {
  for (const need of ['0.6', 'v0.1.0', '0.1.0+1a2b3c4', '01.0.0', '', null, 1, ['0.1.0'], { v: '0.1.0' }]) {
    const history = merge([JSON.stringify({ t: T, need, lt: 'abc123', r: 'miss', v: '12345678' })], '9.9.9');
    assert.deepEqual([held(history), history.reviews.length], [{ held: ['abc123'], incomplete: false }, 0], JSON.stringify(need));
  }
  for (const need of ['0.1.0', '0.0.9', '0.0.0']) {
    const history = merge([JSON.stringify({ t: T, need, lt: 'abc123', r: 'miss', v: '12345678' })]);
    assert.deepEqual([held(history), history.reviews.map(r => [r.lt, r.r])], [{ held: [], incomplete: false }, [['abc123', 'miss']]], need);
  }
  // 這台的版本不明（null，例如工具沒有傳）：任何標記都讀不懂。
  assert.deepEqual(held(merge([JSON.stringify({ t: T, need: '0.0.0', lt: 'abc123', r: 'good', v: '12345678' })], null)), { held: ['abc123'], incomplete: false });
});

void test('§5-2 先看 need 再看其他欄位：讀不懂的行不是寫壞的行，其他欄位不合舊格式也照 lt 停', () => {
  for (const fields of [{ t: 'not-a-time' }, { r: 'later' }, { v: 7 }, { kind: 'new' }]) {
    const history = merge([JSON.stringify({ t: T, need: '9.0.0', lt: 'abc123', r: 'good', v: '12345678', ...fields })]);
    assert.deepEqual([held(history), history.problems, history.reviews.length], [{ held: ['abc123'], incomplete: false }, [], 0], JSON.stringify(fields));
  }
  // 讀不懂的變更也不進 changes。
  const change = merge([JSON.stringify({ t: T, need: '9.0.0', set: 'status', lt: 'abc123', val: '暫停' })]);
  assert.deepEqual([change.changes, held(change)], [[], { held: ['abc123'], incomplete: false }]);
});

void test('§5-2 讀不懂的行裡的 lt 寬鬆地收進 seen，配新 ID 時避開', () => {
  const history = merge([
    JSON.stringify({ t: T, need: '9.0.0', lt: 'abc123', r: 'later' }),
    '{"t":"2026-10-28T10:01:00.000+08:00","need":"9.0.0","\\u006ct":"esc456"}',
    JSON.stringify({ t: '2026-10-28T10:02:00.000+08:00', need: '9.0.0', lt: '  ', targets: ['new789'] }),
  ]);
  assert.deepEqual(history.seen, ['  ', 'abc123', 'esc456']);
  assert.deepEqual(held(history), { held: ['abc123', 'esc456'], incomplete: true });
});

void test('§5-2 寫壞的行：從行尾救回的那一段也先看 need', () => {
  const tail = JSON.stringify({ t: '2026-10-28T10:01:00.000+08:00', need: '9.0.0', lt: 'abc123', r: 'miss', v: '12345678' });
  const history = merge(['{"t":"2026-10-28T10:00:00.000+08:00","lt":"old123"' + tail, review('2026-10-28T10:02:00.000+08:00', 'def456')]);
  assert.deepEqual(held(history), { held: ['abc123'], incomplete: false });
  assert.deepEqual(history.reviews.map(r => r.lt), ['def456']);
  assert.deepEqual(history.seen, ['abc123', 'def456', 'old123']);
  assert.deepEqual(history.problems.map(p => [p.line, p.message]), [[0, '寫入中斷；行尾救回的那一筆需要新版才讀得懂']]);
  // 行尾救回的那一段讀得懂：照舊救回。
  const readable = merge(['{"t":"2026-10-28T10:00:00.000+08:00","lt":"old123"' + tail], '9.0.0');
  assert.deepEqual([held(readable), readable.reviews.map(r => r.lt), readable.problems.map(p => p.message)], [{ held: [], incomplete: false }, ['abc123'], ['寫入中斷；已從行尾救回一筆紀錄']]);
});

void test('readHistory 把這台的版本傳給合併；不傳就是版本不明', async () => {
  const files = createMemoryFiles({ [PHONE]: JSON.stringify({ t: T, need: '0.1.0', lt: 'abc123', r: 'good', v: '12345678' }) + '\n' }).files;
  assert.deepEqual(held(await readHistory(files, '0.1.0')), { held: [], incomplete: false });
  assert.deepEqual(held(await readHistory(files)), { held: ['abc123'], incomplete: false });
});

void test('appendLine 保留停掉的目標；帶 need 的行不能直接追加，要整份重新合併', () => {
  const history = merge([JSON.stringify({ t: T, need: '9.0.0', lt: 'abc123', r: 'good', v: '12345678' })]);
  const next = appendLine(history, review('2026-10-28T10:05:00.000+08:00', 'def456'));
  assert.deepEqual([held(next), next.reviews.map(r => r.lt)], [{ held: ['abc123'], incomplete: false }, ['def456']]);
  assert.throws(() => appendLine(history, JSON.stringify({ t: '2026-10-28T10:06:00.000+08:00', need: '0.0.1', lt: 'def456', r: 'good', v: '12345678' })), /need/);
});

void test('停掉的目標不出題：nextCard 拿不到它，同一篇的其他目標照常', () => {
  const history = merge([JSON.stringify({ t: T, need: '9.0.0', lt: 'abc123', r: 'good', v: '12345678' })]);
  const input: TodayInput = { decks: [deck], history, settings: { capMinutes: 30, retention: 0.8, filter: [] }, exam: null, now: Date.parse('2026-10-29T19:00:00.000+08:00'), offset: 480 };
  const today = planToday(input);
  assert.equal(today.slots.has('abc123'), false);
  const served: string[] = [];
  for (let next = nextCard(today, input, { deck: deck.path }); next.kind === 'card'; next = nextCard({ ...today, share: today.share.filter(item => !served.includes(item.lt)) }, input, { deck: deck.path })) served.push(next.card.lt);
  assert.deepEqual(served.sort(), ['def456', 'ghi789']);
});
