import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/core/deck/index.ts';
import { createPreview } from '../src/review/index.ts';
import type { CardView, Session } from '../src/review/index.ts';

// 比較卡的預覽（tasks/question-type-seam.md §9）：一組一張第一次的卡，剩下的句子各一張；作答和複習同一個流程，什麼都不寫。
const PATH = 'Essence Cards/國語/相似字.md';
const PROPS = '---\n科目: 國語\n狀態: 草稿\n---\n';
const CHARS = PROPS + `- 別的 ^other0
    - 前面的題 :: 答
- 寨（寨、塞、寒、賽） 相似字 ^zhai00
    - 盜匪躲在山＿＿裡。 :: 寨
    - 這座古老的＿＿子建在山頂上。 :: 寨
- 中間的目標 ^middle
    - 中間的題 :: 答
- 塞（寨、塞、寒、賽） 相似字 ^sai000
    - 下班時間大＿＿車。 :: 塞
    - 水管＿＿住了。 :: 塞
- 寒（寨、塞、寒、賽） 相似字
    - 冬天很＿＿冷。 :: 寒
    - ＿＿假快到了。 :: 寒
- 賽（寨、塞、寒、賽） 相似字
    - 明天有籃球比＿＿。 :: 賽
    - 運動會＿＿跑。 :: 賽
- 後面的目標 ^after0
    - 後面的題 :: 答
`;
const TWO = PROPS + `- borrow（borrow、lend） 比較 ^borrow
    - Can I ＿＿ your pen? :: borrow
    - I ＿＿ books. :: borrow
    - May I ＿＿ this? :: borrow
- lend（borrow、lend） 比較 ^lendxx
    - Can you ＿＿ me a pen? :: lend
    - Banks ＿＿ money. :: lend
    - Please ＿＿ me that. :: lend
`;
const open = (text: string, reveal = false): Session => {
  const session = createPreview({ path: PATH, deck: parseDeck(text), reveal });
  assert.ok(session);
  return session;
};
function view(s: Session): CardView {
  const current = s.view();
  assert.equal(current.kind, 'card');
  if (current.kind !== 'card') throw Error();
  return current.card;
}
/** 每一張卡的句子，照卡的順序；走到底。 */
function walk(s: Session): { questions: string[]; keys: number }[] {
  const cards: { questions: string[]; keys: number }[] = [];
  while (s.view().kind === 'card') {
    const { card } = view(s);
    cards.push({ questions: card.blanks.map(blank => blank.prompt.kind === 'qa' ? blank.prompt.question : blank.prompt.text), keys: card.group?.keys.length ?? 0 });
    s.forward();
  }
  return cards;
}

void test('四個字各兩句：第一次的卡 5 格放在第一個字的位置，其他目標照筆記順序，剩下 3 句各一張、字鍵整組；每一句都看得到一次', () => {
  const cards = walk(open(CHARS));
  assert.deepEqual(cards.map(card => [card.questions.length, card.keys]), [[1, 0], [5, 4], [1, 4], [1, 4], [1, 4], [1, 0], [1, 0]]);
  assert.deepEqual(cards[0].questions, ['前面的題']);
  assert.deepEqual(cards.at(-2)?.questions, ['中間的題']);
  assert.deepEqual(cards.at(-1)?.questions, ['後面的題']);
  const sentences = cards.flatMap(card => card.questions).filter(question => question.includes('＿'));
  assert.equal(sentences.length, 8);
  assert.equal(new Set(sentences).size, 8);
});

void test('兩個選項的組也一樣：第一次 3 格，其餘 3 句各一張一格', () => {
  const cards = walk(open(TWO));
  assert.deepEqual(cards.map(card => [card.questions.length, card.keys]), [[3, 2], [1, 2], [1, 2], [1, 2]]);
  assert.equal(new Set(cards.flatMap(card => card.questions)).size, 6);
});

/** 預覽用真的時間（Date.now）：測試控制它，隔一段時間才按。 */
function answer(t: TestContext, s: Session, picks: (answer: string, index: number) => string): void {
  (view(s).card.blanks.map(blank => blank.answer ?? '')).forEach((each, index) => {
    t.mock.timers.tick(400);
    s.act({ kind: 'row', index });
    s.act({ kind: 'key', key: picks(each, index) });
  });
}

void test('作答與複習同一個流程：填滿 0.35 秒內的對答案不算；評分與下一張只換下一張，不留回看', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const s = open(TWO);
  answer(t, s, each => each);
  assert.equal(view(s).pick?.filled, true);
  t.mock.timers.tick(349);
  s.act({ kind: 'check' });
  assert.equal(view(s).pick?.stage, 'answer');
  assert.equal(s.commit(), false, '還沒到結果階段');
  assert.equal(s.rate('good'), false);
  t.mock.timers.tick(1);
  s.act({ kind: 'check' });
  assert.equal(view(s).pick?.stage, 'result');
  assert.deepEqual(view(s).allowed, ['good', 'easy']);
  const first = view(s).card;
  assert.equal(s.commit(), false, '全對沒有下一張');
  assert.equal(s.rate('good'), true);
  assert.notEqual(view(s).card, first);
  assert.deepEqual(s.history(), []);
});

void test('有錯時：再選之後只有下一張；回上一張從頭開始', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const s = open(TWO);
  const first = view(s).card;
  answer(t, s, (each, index) => index === 0 ? (each === 'lend' ? 'borrow' : 'lend') : each);
  t.mock.timers.tick(400);
  s.act({ kind: 'check' });
  assert.equal(view(s).pick?.stage, 'retry');
  s.act({ kind: 'skip' });
  assert.deepEqual([view(s).pick?.stage, view(s).pick?.committable, view(s).allowed], ['result', true, []]);
  assert.equal(s.commit(), true);
  assert.notEqual(view(s).card, first);
  s.back();
  assert.deepEqual([view(s).card, view(s).pick?.stage], [first, 'answer']);
  assert.deepEqual(s.history(), []);
});

void test('預覽時自動展開答案：直接到結果階段，空格是答案，沒有對錯記號與結果；只有下一張', () => {
  const s = open(CHARS, true);
  s.forward();
  const pick = view(s).pick;
  assert.ok(pick);
  assert.deepEqual([pick.stage, pick.cursor, pick.committable, view(s).allowed, view(s).revealed], ['result', null, true, [], true]);
  assert.deepEqual(pick.results, {});
  assert.deepEqual(pick.cells.map(cell => cell.state), ['shown', 'shown', 'shown', 'shown', 'shown']);
  assert.deepEqual(pick.cells.map(cell => cell.text), view(s).card.blanks.map(blank => blank.answer));
  const first = view(s).card;
  assert.equal(s.commit(), true);
  assert.notEqual(view(s).card, first);
});
