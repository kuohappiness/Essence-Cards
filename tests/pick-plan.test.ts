import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/core/deck/index.ts';
import { encodeEntry, mergeHistory, planToday } from '../src/core/study/index.ts';
import type { DeckEntry, Today } from '../src/core/study/index.ts';

// 比較卡在今天的份裡怎麼算（tasks/question-type-seam.md §5-4）。預期值手算，不用同樣的算法再算一次。
const entry = (text: string): DeckEntry => ({ path: 'Essence Cards/國語/相似字.md', deck: parseDeck(text) });
function plan(deck: DeckEntry, lines: readonly string[], now: string, cap = 30): Today {
  const history = mergeHistory([{ path: 'Essence Cards/紀錄/2026-10 Phone-test.jsonl', text: lines.join('\n') }]);
  return planToday({ decks: [deck], history, settings: { capMinutes: cap, retention: 0.8, filter: [] }, exam: null, now: Date.parse(now), offset: 480 });
}

// 整組進與一張算一次（§5-4 第 1、3 點）。
const CHARS = entry(`---
科目: 國語
---
- 寨（寨、塞、寒、賽） 相似字 ^zhai00
    - 盜匪躲在山＿＿裡。 :: 寨
- 塞（寨、塞、寒、賽） 相似字 ^sai000
    - 下班時間大＿＿車。 :: 塞
- 寒（寨、塞、寒、賽） 相似字 ^han000
    - 冬天很＿＿冷。 :: 寒
- 賽（寨、塞、寒、賽） 相似字 ^yyy000
    - 明天有籃球比＿＿。 :: 賽
`);
const NOW = '2026-10-24T19:00:00.000+08:00';

void test('時間上限只夠一張時四個都進，秒數平均分、加總等於一張；一張也放不下時四個都在 more', () => {
  const one = plan(CHARS, [], NOW, 0.25);
  assert.deepEqual(one.share.map(item => item.lt), ['zhai00', 'sai000', 'han000', 'yyy000']);
  assert.deepEqual(one.more, []);
  assert.deepEqual(one.share.map(item => item.seconds), [3.75, 3.75, 3.75, 3.75]);
  const none = plan(CHARS, [], NOW, 0.2);
  assert.deepEqual(none.share, []);
  assert.deepEqual(none.more.map(item => item.lt), ['zhai00', 'sai000', 'han000', 'yyy000']);
  assert.deepEqual(none.more.map(item => item.seconds), [3.75, 3.75, 3.75, 3.75]);
});

const MIXED = entry('---\n科目: 國語\n---\n- 寨（寨、塞） 相似字 ^zhai00\n    - 山＿＿ :: 寨\n- 別的 ^other0\n    - Q :: A\n- 塞（寨、塞） 相似字 ^sai000\n    - 大＿＿車 :: 塞\n- 再一個 ^third0\n    - Q2 :: A2\n');

void test('新的目標同組的緊接在第一個後面，排在中間的往後', () => {
  const today = plan(MIXED, [], NOW);
  assert.deepEqual(today.share.map(item => item.lt), ['zhai00', 'sai000', 'other0', 'third0']);
  assert.deepEqual(today.share.map(item => item.seconds), [7.5, 7.5, 15, 15]);
});

void test('放得下第一個時，同組後面的不再占時間，也不受已經放不下影響', () => {
  // 30 秒：比較卡一張 15、別的 15，再一個放不下。
  const tight = plan(MIXED, [], NOW, 0.5);
  assert.deepEqual(tight.share.map(item => item.lt), ['zhai00', 'sai000', 'other0']);
  assert.deepEqual(tight.more.map(item => item.lt), ['third0']);
  // 不是新的不搬位置：寨、別的是 relearn，塞是 due。15 秒放了寨，別的放不下，塞和寨同一張照樣進今天的份。
  const lines = [encodeEntry('2026-10-01T19:00:00.000+08:00', { lt: 'zhai00', r: 'miss', v: '12345678' }), encodeEntry('2026-10-02T19:00:00.000+08:00', { lt: 'other0', r: 'miss', v: '12345678' }), encodeEntry('2026-10-04T19:00:00.000+08:00', { lt: 'sai000', r: 'good', v: '12345678' })];
  const due = plan(MIXED, lines, NOW, 0.25);
  assert.deepEqual(due.share.map(item => [item.lt, item.lane, item.seconds]), [['zhai00', 'relearn', 7.5], ['sai000', 'due', 7.5]]);
  assert.deepEqual(due.more.map(item => item.lt), ['other0', 'third0']);
});

void test('第一個放不下時，同組全部進 more', () => {
  const first = entry('---\n科目: 國語\n---\n- 別的 ^other0\n    - Q :: A\n- 寨（寨、塞） 相似字 ^zhai00\n    - 山＿＿ :: 寨\n- 塞（寨、塞） 相似字 ^sai000\n    - 大＿＿車 :: 塞\n');
  const blocked = plan(first, [], NOW, 0.25);
  assert.deepEqual(blocked.share.map(item => item.lt), ['other0']);
  assert.deepEqual(blocked.more.map(item => item.lt), ['zhai00', 'sai000']);
  assert.deepEqual(blocked.more.map(item => item.seconds), [7.5, 7.5]);
});

void test('新的目標在考試範圍內外都一起：exam-new 的第一個帶同組 new 的', () => {
  const history = mergeHistory([]);
  const today = planToday({ decks: [MIXED], history, settings: { capMinutes: 30, retention: 0.8, filter: [] }, now: Date.parse(NOW), offset: 480,
    exam: { hasPeriod: false, contains: (_entry, target) => target.id === 'sai000' || target.id === 'third0' } });
  assert.deepEqual(today.share.map(item => [item.lt, item.lane]), [['sai000', 'exam-new'], ['zhai00', 'new'], ['third0', 'exam-new'], ['other0', 'new']]);
});

void test('沒有比較卡時順序與秒數和以前一樣（不是整數也不是平均）', () => {
  const plain = entry('---\n科目: 國語\n---\n- 甲 ^aaaaa0\n    - Q1 :: A\n- 乙 ^bbbbb0\n    - Q2 :: A\n- 丙 ^ccccc0\n    - Q3 :: A\n');
  const today = plan(plain, [], NOW, 0.5);
  assert.deepEqual(today.share.map(item => [item.lt, item.seconds]), [['aaaaa0', 15], ['bbbbb0', 15]]);
  assert.deepEqual(today.more.map(item => [item.lt, item.seconds]), [['ccccc0', 15]]);
});

// 秒數（§5-4 第 2 點）：只看中位數。一張卡在第一行之後帶 with。
const secondsDeck = entry('---\n科目: 國語\n---\n- 能說明 ^goal00\n    - Q :: A\n');
const ms = (time: number): string => new Date(time + 8 * 3600_000).toISOString().slice(0, 23) + '+08:00';
const T0 = Date.parse('2026-10-20T11:00:00.000Z');
const line = (time: number, extra: { with?: string } = {}): string => encodeEntry(ms(time), { lt: 'goal00', r: 'good', v: '12345678', ...extra });
const seconds = (lines: readonly string[]): number => plan(secondsDeck, lines, '2026-11-02T19:00:00.000+08:00').share[0].seconds;

void test('秒數：一張比較卡三行算一次卡片事件，中位數不被拉低', () => {
  const lines: string[] = [];
  for (let i = 0; i < 31; i++) {
    const start = T0 + i * 8000;
    lines.push(line(start), line(start + 1, { with: ms(start) }), line(start + 2, { with: ms(start) }));
  }
  assert.equal(seconds(lines), 8);
  // 29 張只有 28 個間隔：不夠 30 個，用預設值。少算會在這裡露出來。
  assert.equal(seconds(lines.slice(0, 29 * 3)), 15);
});

void test('秒數：第一行還沒同步、只剩後面的行，也是一次事件（31 張每張 8 秒：8 秒，30 個間隔）', () => {
  const lines: string[] = [];
  for (let i = 0; i < 31; i++) {
    const start = T0 + i * 8000;
    lines.push(line(start + 1, { with: ms(start) }), line(start + 2, { with: ms(start) }));
  }
  assert.equal(seconds(lines), 8);
  assert.equal(seconds(lines.slice(0, 30 * 2)), 15);
});

void test('秒數：with 是壞值照一般的行算；沒有 with 的行相差 1 毫秒不折', () => {
  // 16 張兩行：31 個間隔，16 個 1 毫秒、15 個約 8 秒，中位數 1 毫秒，算成 1 秒。
  const bad: string[] = [], plain: string[] = [];
  for (let i = 0; i < 16; i++) {
    const start = T0 + i * 8000;
    bad.push(line(start), line(start + 1, { with: '壞值' }));
    plain.push(line(start), line(start + 1));
  }
  assert.equal(seconds(bad), 1);
  assert.equal(seconds(plain), 1);
});

void test('秒數：只有翻面的紀錄照舊（R2-1：31 張每張 8 秒，第 31 張評分前 199 毫秒回看改第 30 張：8 秒）', () => {
  const lines: string[] = [];
  for (let i = 0; i < 29; i++) lines.push(line(T0 + i * 8000));
  const last = T0 + 30 * 8000;
  lines.push(line(last - 199), line(last));
  assert.equal(seconds(lines), 8);
});

void test('秒數：R2-1 的三行案例（15 個 4 秒、15 個 16 秒，第一、二行之間卡住 250 毫秒）：10 秒，30 個間隔', () => {
  const lines: string[] = [];
  let time = T0;
  for (let i = 0; i < 31; i++) {
    lines.push(line(time), line(time + 250, { with: ms(time) }), line(time + 251, { with: ms(time) }));
    time += 251 + (i < 15 ? 4000 : 16000);
  }
  assert.equal(seconds(lines), 10);
});

void test('秒數：R3-4 的案例（31 張一行的比較卡，前 29 個間隔 8 秒，最後兩張之間時鐘往回撥）：8 秒，30 個間隔', () => {
  const lines: string[] = [];
  for (let i = 0; i < 30; i++) lines.push(line(T0 + i * 8000));
  // 寫入端照 max(now, last + 1)：往回撥時差 1 毫秒。
  lines.push(line(T0 + 29 * 8000 + 1));
  assert.equal(seconds(lines), 8);
  assert.equal(seconds(lines.slice(0, 30)), 15);
});
