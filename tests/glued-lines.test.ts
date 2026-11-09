import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry, mergeHistory, readHistory } from '../src/core/study/index.ts';
import type { History } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { State } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import { seeded } from './helpers/seeded.ts';
import { withBaseline } from './helpers/observed.ts';

// S6（外掛架構檢查環節 3 結論第 6 條、syntax §5-2）：完整的一筆只缺換行，下一筆接在同一行時，兩筆都要算。
// 這台的版本是 0.1.0；標記用 9.0.0 代表比這台新。

const PC = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const T1 = '2026-10-29T19:00:00.000+08:00', T2 = '2026-10-29T19:01:00.000+08:00', T3 = '2026-10-29T19:02:00.000+08:00';
const review = (t: string, lt: string) => encodeEntry(t, { lt, r: 'good', v: '12345678' });
const A = review(T1, 'aaaaaa'), B = review(T2, 'bbbbbb'), C = review(T3, 'cccccc');
const merge = (text: string) => mergeHistory([{ path: PC, text }], '0.1.0');
const lts = (history: History) => history.reviews.map(entry => entry.lt);

const NOTHING = '無法解析紀錄或缺少有效的必要欄位';
interface Expected {
  reviews: string[];
  held?: string[];
  incomplete?: boolean;
  cancelled?: string[];
  changes?: unknown[];
  /** 記進 problems 的說明要符合什麼；預設是救回。 */
  message?: RegExp | string;
}
const SAVED = /已救回.*原檔沒有改/;
const needUndo = JSON.stringify({ t: T2, need: '9.0.0', undo: T1 });
const needTarget = JSON.stringify({ t: T2, need: '9.0.0', lt: 'hhhhhh' });
const needNested = JSON.stringify({ t: T1, need: '9.0.0', payload: { t: T2, lt: 'nested', r: 'good', v: '12345678' } });
const openOuter = `{"t":"${T1}","set":"future","val":[`;
const note = (val: string) => JSON.stringify({ t: T1, set: 'note', val });

const cases: [string, string, Expected][] = [
  // 規格列的例子（backlog 那一列）。
  ['A＋B：兩筆都在', A + B, { reviews: ['aaaaaa', 'bbbbbb'] }],
  ['A＋B＋C：三筆都在', A + B + C, { reviews: ['aaaaaa', 'bbbbbb', 'cccccc'] }],
  ['A＋壞的中段＋C：壞的中段不採用', A + '{"t":"cut' + C, { reviews: ['aaaaaa', 'cccccc'] }],
  ['取消接在作答後面：作答取消', A + encodeEntry(T2, { undo: T1 }), { reviews: [], cancelled: [T1] }],
  ['重試寫了兩次的同一筆只算一筆', A + A, { reviews: ['aaaaaa'] }],
  ['need 的取消指到救回的作答：作答留著、目標停掉、不算取消', A + needUndo, { reviews: ['aaaaaa'], held: ['aaaaaa'], message: /需要新版才讀得懂/ }],
  ['(a) 完整的 need 物件裡有巢狀的 {"t": 再接一筆：不完整，巢狀的不採用', needNested + B, { reviews: ['bbbbbb'], incomplete: true }],
  ['(b) 沒關上的外層裡有完整的範例再接一筆：範例不採用', openOuter + A + B, { reviews: ['bbbbbb'] }],
  // 自己想到的組合。
  ['need 的取消排在作答前面：全部讀完才找', needUndo + A, { reviews: ['aaaaaa'], held: ['aaaaaa'] }],
  ['need 的取消找不到作答：不完整', B + needUndo, { reviews: ['bbbbbb'], incomplete: true }],
  ['讀不懂的夾在中間：前後都算，只停它的目標', A + needTarget + C, { reviews: ['aaaaaa', 'cccccc'], held: ['hhhhhh'] }],
  ['讀不懂、又看不出影響範圍的：不完整', A + JSON.stringify({ t: T2, need: '9.0.0', lt: ' ' }), { reviews: ['aaaaaa'], incomplete: true }],
  ['讀得懂的 need 照平常讀', JSON.stringify({ t: T1, need: '0.1.0', lt: 'aaaaaa', r: 'good', v: '12345678' }) + B, { reviews: ['aaaaaa', 'bbbbbb'] }],
  ['只有讀不懂的：沒有救回，說需要新版', needTarget + needTarget, { reviews: [], held: ['hhhhhh'], message: /需要新版才讀得懂.*原檔沒有改/ }],
  ['字串裡的括號與跳脫的引號不算邊界', note('a}{"t":"x\\') + B, { reviews: ['bbbbbb'], changes: ['a}{"t":"x\\'] }],
  ['字串裡的反斜線結尾不吃掉結束的引號', note('x\\') + note('y\\'), { reviews: [], changes: ['x\\', 'y\\'] }],
  ['變更行接作答', encodeEntry(T1, { set: 'app', val: '0.1.0+abc' }) + B, { reviews: ['bbbbbb'], changes: ['0.1.0+abc'] }],
  ['同一個 t、內容不同的兩筆都留', A + review(T1, 'dddddd'), { reviews: ['aaaaaa', 'dddddd'] }],
  ['跳脫的鍵名照讀', `{"t":"${T1}","\\u006ct":"esc001","r":"good","v":"12345678"}` + B, { reviews: ['esc001', 'bbbbbb'] }],
  ['物件之間的空白不算壞', A + ' \t' + B + ' ' + C, { reviews: ['aaaaaa', 'bbbbbb', 'cccccc'] }],
  ['開頭的 BOM、結尾的 CRLF 照舊不算', '﻿' + A + B + '\r', { reviews: ['aaaaaa', 'bbbbbb'] }],
  ['完整的一筆後面是斷掉的開頭', A + '{"t":"cut', { reviews: ['aaaaaa'] }],
  ['完整的一筆後面是雜訊', A + '壞掉', { reviews: ['aaaaaa'] }],
  ['餘段的尾段照舊先看 need', A + '{"t":"cut' + needTarget, { reviews: ['aaaaaa'], held: ['hhhhhh'], message: /已救回.*需要新版才讀得懂/ }],
  ['完整但缺必要欄位的物件不往裡面挖，接著還有的照讀', JSON.stringify({ nested: JSON.parse(A) as unknown }) + B, { reviews: ['bbbbbb'] }],
  ['括號對得上但不是 JSON：從那裡起是餘段，只救最後的尾段', '{"t":壞}' + A + B, { reviews: ['bbbbbb'] }],
  ['括號不成對：從那裡起是餘段', `{"t":"${T1}","val":[1}` + B, { reviews: ['bbbbbb'] }],
  ['開頭是雜訊：照舊只救最後的尾段', '壞掉' + A + B, { reviews: ['bbbbbb'] }],
  ['開頭是陣列：不是物件，照舊只救最後的尾段', '[1]' + A + B, { reviews: ['bbbbbb'] }],
  ['只是斷掉的開頭：照舊是問題，沒有救回', '{"t":"cut', { reviews: [], message: NOTHING }],
  ['整行合法 JSON、只是缺必要欄位：不往裡面挖', JSON.stringify({ nested: JSON.parse(A) as unknown }), { reviews: [], message: NOTHING }],
  ['已知限制：沒關上的外層，最後一段是範例，照舊救回', openOuter + A, { reviews: ['aaaaaa'] }],
];

for (const [name, raw, expected] of cases) void test('S6 ' + name, () => {
  const history = merge(raw + '\n');
  assert.deepEqual(lts(history), expected.reviews);
  assert.deepEqual(history.held, expected.held ?? []);
  assert.equal(history.incomplete, expected.incomplete ?? false);
  assert.deepEqual(history.cancelled, expected.cancelled ?? []);
  assert.deepEqual(history.changes.map(entry => entry.val), expected.changes ?? []);
  // 問題照樣記下路徑與行號，不說成原檔已修好。
  assert.deepEqual(history.problems.map(problem => [problem.path, problem.line]), [[PC, 0]]);
  const message = expected.message ?? SAVED;
  if (typeof message === 'string') assert.equal(history.problems[0].message, message);
  else assert.match(history.problems[0].message, message);
});

// 共同不變量：接在一起和有換行的對照，算出來的都相同；只差接在一起的那一行多記一個問題。
for (const [name, pieces] of [
  ['A、B、C', [A, B, C]],
  ['作答、取消', [A, encodeEntry(T2, { undo: T1 })]],
  ['同一筆兩次', [A, A]],
  ['作答、need 的取消', [A, needUndo]],
  ['need 的取消、作答', [needUndo, A]],
  ['巢狀的 need 物件、作答', [needNested, B]],
  ['變更、作答', [encodeEntry(T1, { set: 'filter', val: ['攝影'] }), B]],
] as const) void test('S6 接在一起和有換行的結果相同：' + name, () => {
  const glued = merge(pieces.join('') + '\n'), lines = merge(pieces.join('\n') + '\n');
  assert.deepEqual({ ...glued, problems: [] }, { ...lines, problems: [] });
  assert.equal(lines.problems.length, 0);
  assert.equal(glued.problems.length, 1);
});

void test('S6 問題記在接在一起的那一行，前後的行不受影響', () => {
  const history = merge(C + '\n' + A + B + '\n' + review(T3, 'eeeeee') + '\n');
  assert.deepEqual(lts(history), ['aaaaaa', 'bbbbbb', 'cccccc', 'eeeeee']);
  assert.deepEqual(history.problems.map(problem => problem.line), [1]);
});

void test('S6 seen：接在一起的每一筆、取消行多帶的 lt、沒採用的範例都算出現過', () => {
  const carried = JSON.stringify({ t: T2, undo: T1, lt: 'uuuuuu' });
  assert.deepEqual(merge(A + carried + B + '\n').seen, ['aaaaaa', 'bbbbbb', 'uuuuuu']);
  assert.deepEqual(merge(openOuter + A + B + '\n').seen, ['aaaaaa', 'bbbbbb']);
  // 夾在中間的完整物件用跳脫的鍵名：寬鬆的字串比對找不到，要照 JSON 讀（讀不懂的與缺必要欄位的都算）。
  const escaped = (extra: string, lt: string) => `{"t":"${T2}",${extra}"\\u006ct":"${lt}"}`;
  assert.deepEqual(merge(A + escaped('"need":"9.0.0",', 'esc001') + C + '\n').seen, ['aaaaaa', 'cccccc', 'esc001']);
  assert.deepEqual(merge(A + escaped('"r":"壞",', 'esc002') + C + '\n').seen, ['aaaaaa', 'cccccc', 'esc002']);
});

// 種子固定的隨機組合：這幾種行任意接在一起或換行，算出來都和全部換行相同。
void test('S6 性質：200 組隨機的紀錄，任意幾行接在一起，結果和全部換行相同', () => {
  const random = seeded(20261105);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const ids = ['aaaaaa', 'bbbbbb', 'cccccc'];
  for (let round = 0; round < 200; round++) {
    const times: string[] = [];
    const lines = Array.from({ length: 1 + Math.floor(random() * 8) }, (_, i) => {
      const t = `2026-10-29T19:00:${String(i).padStart(2, '0')}.000+08:00`;
      times.push(t);
      const earlier = pick(times);
      return pick<() => string>([
        () => review(t, pick(ids)),
        () => review(earlier, pick(ids)),
        () => encodeEntry(t, { undo: earlier }),
        () => encodeEntry(t, { set: 'filter', val: ['a}{', pick(ids)] }),
        () => JSON.stringify({ t, need: '9.0.0', lt: pick(ids) }),
        () => JSON.stringify({ t, need: '9.0.0', undo: earlier }),
        () => JSON.stringify({ t, need: '9.0.0', payload: JSON.parse(review(t, 'nested')) as unknown }),
        () => JSON.stringify({ t, note: JSON.parse(review(t, 'nested')) as unknown }),
      ])();
    });
    const glued = lines.reduce((text, line) => text + (random() < .5 ? '\n' : '') + line) + '\n';
    const history = merge(glued), control = merge(lines.join('\n') + '\n');
    assert.deepEqual({ ...history, problems: [] }, { ...control, problems: [] }, glued);
  }
});

const goal = (id: string) => `- 能說明 ${id} ^${id}\n    - 題目 ${id} :: 答案 ${id}\n`;
const DECK = 'Essence Cards/國二上/自然/2-2（卡片）.md';
const DELAY = 50;

void test('S6 原例：磁碟上已經黏住的兩筆，別台的紀錄到了之後、重開之後都在；state 當下與重開相同；原檔不改', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  // 舊版寫的：現在的 writer 知道檔尾沒有換行時會另起一行（L2 的 R1），已經黏住的只能靠讀取端。
  const glued = A + review('2026-10-30T19:00:00.000+08:00', 'bbbbbb') + '\n';
  const memory = createMemoryFiles({ ...await withBaseline({ [DECK]: '---\n科目: 自然\n---\n' + goal('aaaaaa') + goal('bbbbbb') + goal('zzzzzz') }, 'PC-test'), [PC]: glued });
  const open = (): State => {
    const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: false, now: () => Date.parse('2026-10-30T19:00:00.000+08:00'), offset: () => 480 });
    t.after(() => state.close());
    return state;
  };
  const state = open();
  await state.ready();
  await state.flush();
  assert.equal(memory.texts.get(PC), glued);
  assert.deepEqual(lts(state.history()), ['aaaaaa', 'bbbbbb']);

  // 別台的紀錄經過重讀、採用、觸發合併。
  memory.append(PHONE, review('2026-10-30T18:00:00.000+08:00', 'zzzzzz'));
  t.mock.timers.tick(DELAY + 1);
  await flush();
  assert.deepEqual(lts(state.history()), ['aaaaaa', 'zzzzzz', 'bbbbbb']);
  assert.deepEqual(state.history().problems.map(problem => [problem.path, problem.line]), [[PC, 0]]);
  assert.match(state.history().problems[0].message, SAVED);
  assert.equal(memory.texts.get(PC), glued);

  const reopened = open();
  await reopened.ready();
  assert.deepEqual(reopened.history(), state.history());
  assert.deepEqual(reopened.today(), state.today());
  assert.deepEqual(state.history(), await readHistory(memory.files));
  assert.equal(memory.texts.get(PC), glued);
});

for (const [name, tail, expected] of [
  ['結尾是作答', A, ['aaaaaa', 'bbbbbb', 'bbbbbb']],
  ['結尾是取消', A + '\n' + encodeEntry(T2, { undo: T1 }), ['bbbbbb', 'bbbbbb']],
] as const) void test(`月檔結尾沒換行、第一次又讀不到（${name}）：補讀前的作答另起一行，連續兩筆不多空行（L2 的 R12）`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const memory = createMemoryFiles({ ...await withBaseline({ [DECK]: '---\n科目: 自然\n---\n' + goal('aaaaaa') + goal('bbbbbb') }, 'PC-test'), [PC]: tail });
  memory.failing.add(PC);
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: false, now: () => Date.parse('2026-10-30T19:00:00.000+08:00'), offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  assert.deepEqual(state.unread(), [PC]);
  memory.failing.delete(PC);
  const answer = { lt: 'bbbbbb', r: 'good', v: '12345678' } as const;
  state.answer(answer);
  state.answer(answer);
  await state.flush();
  const text = memory.texts.get(PC) ?? '';
  assert.ok(text.startsWith(tail + '\n{'), text);
  assert.equal(text.trimEnd().split('\n').length, tail.split('\n').length + 2, '每筆一行，沒有多的空行');
  for (const line of text.trimEnd().split('\n')) JSON.parse(line);
  t.mock.timers.tick(1000);
  for (let i = 0; i < 15; i++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(state.unread(), []);
  assert.deepEqual(lts(state.history()), expected);
  assert.deepEqual(state.history().problems, []);
});
