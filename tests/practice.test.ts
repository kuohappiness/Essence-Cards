import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry, mergeHistory } from '../src/core/study/index.ts';
import type { Rating } from '../src/core/study/index.ts';
import { firstTry } from '../src/review/done.ts';
import { createSession, RATE_DELAY } from '../src/review/index.ts';
import type { Session, View } from '../src/review/index.ts';
import { createState } from '../src/state/index.ts';
import type { State, StudyPick } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 全部卡的一輪與一次複習的範圍（tasks/entry-and-catalog.md §4、§5）：真正的 createState＋createSession，不用替身。

const DELAY = 30;
const START = Date.parse('2026-10-24T19:00:00.000+08:00');
const DECK = 'Essence Cards/國二上/自然/2-1（卡片）.md';
const OTHER = 'Essence Cards/國二上/自然/2-2（卡片）.md';
const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const OWN = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
const HEAD = (code: string): string => `---\n年級學期: 國二上\n科目: 自然\n單元: "${code}"\n---\n`;
const targets = (...ids: string[]): string => ids.map(id => `- 目標 ${id} ^${id}\n    - ${id} 的題目 :: 答\n`).join('');
const UNIT = '["國二上","自然","2-1"]';
const line = (date: string, lt: string, r: Rating): string => encodeEntry(date + '+08:00', { lt, r, v: '12345678' });

interface Harness extends MemoryFiles {
  state: State;
  clock: { now: number };
  settle: () => Promise<void>;
  open: (pick: StudyPick) => Promise<Session>;
  /** 自評之後時間往前一點（0.3 秒的規則，同一個作答時間不重複）。 */
  rate: (session: Session, rating: Rating) => void;
  round: (scope?: { unit: string } | { deck: string }) => StudyPick;
}
async function setup(t: TestContext, texts: Record<string, string>, start = START): Promise<Harness> {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const memory = createMemoryFiles(texts);
  const clock = { now: start };
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: false, now: () => clock.now, offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  const sessions: Session[] = [];
  t.after(() => { for (const session of sessions) session.close(); });
  return {
    ...memory, state, clock,
    settle: async () => { t.mock.timers.tick(DELAY + 1); await new Promise<void>(resolve => setImmediate(resolve)); },
    async open(pick) {
      const session = createSession({ state, pick, now: () => clock.now });
      sessions.push(session);
      await session.ready();
      return session;
    },
    rate(session, rating) {
      session.reveal();
      clock.now += RATE_DELAY + 1;
      assert.ok(session.rate(rating), '這次自評要算數');
      clock.now += 1000;
    },
    round: (scope = { unit: UNIT }) => ({ ...scope, since: clock.now }),
  };
}
const card = (view: View): string => {
  assert.equal(view.kind, 'card');
  if (view.kind !== 'card') throw Error();
  return view.card.card.lt;
};
const remaining = (view: View): string => view.top.center;
const entryRow = (state: State): string => { const { done, total } = state.progress(); return done + '/' + total; };

void test('§4 順序：今天到期的 → 還沒到期的（最容易忘的先）→ 新卡；12 個目標裡 3 個今天答過、1 個新卡', async t => {
  // 自編：r1 今天早上答錯；a1、a2 今天早上答對；d1～d3 早就到期（舊的先）；n1～n5 太簡單、還沒到期；x1 新卡。
  const log = [
    line('2026-10-24T08:00:00.000', 'r1', 'miss'), line('2026-10-24T08:01:00.000', 'a1', 'easy'), line('2026-10-24T08:02:00.000', 'a2', 'good'),
    line('2026-10-01T08:00:00.000', 'd1', 'good'), line('2026-10-05T08:00:00.000', 'd2', 'good'), line('2026-10-10T08:00:00.000', 'd3', 'good'),
    line('2026-10-20T08:00:00.000', 'n1', 'easy'), line('2026-10-21T08:00:00.000', 'n2', 'easy'), line('2026-10-22T08:00:00.000', 'n3', 'easy'), line('2026-10-23T08:00:00.000', 'n4', 'easy'), line('2026-10-19T08:00:00.000', 'n5', 'easy'),
  ].sort().join('\n') + '\n';
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('x1', 'a1', 'a2', 'r1', 'd2', 'd1', 'd3', 'n1', 'n2', 'n3', 'n4', 'n5'), [PHONE]: log });
  const s = await h.open(h.round());
  assert.equal(remaining(s.view()), '還剩 12 張');
  const order: string[] = [];
  while (s.view().kind === 'card') { order.push(card(s.view())); h.rate(s, 'good'); }
  assert.deepEqual(order, ['r1', 'd1', 'd2', 'd3', 'n5', 'n1', 'n2', 'n3', 'n4', 'x1', 'a2', 'a1']);
  assert.equal(s.view().kind, 'done');
});

void test('§4 練全新的單元中途關掉再開：剛答對的排到新卡後面，答錯的還是最先出', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b', 'c', 'd') });
  const first = await h.open(h.round());
  h.rate(first, 'good');
  h.rate(first, 'miss');
  first.close();
  const second = await h.open(h.round());
  assert.equal(remaining(second.view()), '還剩 4 張');
  const order: string[] = [];
  while (second.view().kind === 'card') { order.push(card(second.view())); h.rate(second, 'good'); }
  assert.deepEqual(order, ['b', 'c', 'd', 'a']);
});

void test('§4 早上做完當日卡，晚上按全部卡：今天答過的照樣出；連按兩輪都能做完，第二輪不會一開始就完成', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b', 'c') });
  const morning = await h.open({ unit: UNIT });
  assert.equal(remaining(morning.view()), '還剩 3 張');
  while (morning.view().kind === 'card') h.rate(morning, 'good');
  if (morning.view().kind === 'done') assert.equal((morning.view() as Extract<View, { kind: 'done' }>).done.title, '這個單元今天的份完成了！');
  assert.equal(entryRow(h.state), '3/3');
  for (const round of [1, 2]) {
    h.clock.now += 3_600_000;
    const s = await h.open(h.round());
    assert.equal(remaining(s.view()), '還剩 3 張', '第 ' + round + ' 輪');
    assert.equal(s.view().kind, 'card');
    for (let left = 3; left > 0; left--) { assert.equal(remaining(s.view()), `還剩 ${left} 張`); h.rate(s, 'good'); }
    assert.equal(s.view().kind, 'done');
    const done = s.view() as Extract<View, { kind: 'done' }>;
    assert.equal(done.done.title, '這個單元練完了！');
    assert.deepEqual(done.done.buttons.map(button => button.kind), ['close']);
  }
});

void test('§4 答錯一張：上方還是原本的數字，答對才少一；答錯照時間再出，沒有別張時提早出', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b') });
  const s = await h.open(h.round());
  assert.equal(card(s.view()), 'a');
  h.rate(s, 'miss');
  assert.equal(remaining(s.view()), '還剩 2 張');
  assert.equal(card(s.view()), 'b');
  h.rate(s, 'good');
  assert.equal(remaining(s.view()), '還剩 1 張');
  const view = s.view();
  assert.equal(card(view), 'a');
  assert.equal(view.kind === 'card' && view.card.card.early, true, '還沒到時間但沒有別張');
  h.rate(s, 'good');
  assert.equal(s.view().kind, 'done');
});

void test('§4 中途 ✕ 再按：新的一輪，上方回到總數，剛答過的排在後面；切到背景回來還是同一輪', async t => {
  const log = ['a', 'b', 'c'].map(lt => line('2026-10-20T08:00:00.000', lt, 'easy')).join('\n') + '\n';
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b', 'c'), [PHONE]: log });
  const first = await h.open(h.round());
  assert.equal(card(first.view()), 'a', '都還沒到期、一樣容易忘時照 ID');
  h.rate(first, 'good');
  // 切到背景回來：同一輪，a 不再出。
  first.pause(); h.clock.now += 120_000;
  first.resume();
  assert.equal(remaining(first.view()), '還剩 2 張');
  assert.equal(card(first.view()), 'b');
  first.close();
  const second = await h.open(h.round());
  assert.equal(remaining(second.view()), '還剩 3 張');
  const order: string[] = [];
  while (second.view().kind === 'card') { order.push(card(second.view())); h.rate(second, 'good'); }
  assert.deepEqual(order, ['b', 'c', 'a'], 'a 剛答過，最不容易忘');
});

void test('§4 雙向配對的兩個方向都出，英翻中排在中翻英前面', async t => {
  const pair = '- 詞 中翻英 ^z\n    - 他 ＿＿ 了 :: word\n- 詞 英翻中 ^e\n    - word :: 詞\n';
  const h = await setup(t, { [DECK]: HEAD('2-1') + pair });
  const s = await h.open(h.round());
  assert.equal(card(s.view()), 'e');
  h.rate(s, 'good');
  assert.equal(card(s.view()), 'z');
});

void test('§4 全部卡裡答對今天的份裡的卡：入口那一科的數字加一，單元的當日卡少一', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b') });
  assert.equal(entryRow(h.state), '0/2');
  const unitToday = (): number => h.state.catalog().terms[0].subjects[0].units[0].today;
  assert.equal(unitToday(), 2);
  const s = await h.open(h.round());
  h.rate(s, 'good');
  assert.equal(entryRow(h.state), '1/2');
  assert.equal(unitToday(), 1);
});

void test('§5 當日卡做完：入口那一科的進度跟著增加，單元「當日卡」的 N 變 0；別單元不動', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b'), [OTHER]: HEAD('2-2') + targets('c') });
  const s = await h.open({ unit: UNIT });
  while (s.view().kind === 'card') h.rate(s, 'good');
  assert.equal(entryRow(h.state), '2/3');
  const units = h.state.catalog().terms[0].subjects[0].units;
  assert.deepEqual(units.map(unit => unit.today), [0, 1]);
});

void test('§5 回看把記住了改成沒印象，剩餘數加一', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b') });
  const s = await h.open(h.round());
  h.rate(s, 'good');
  assert.equal(remaining(s.view()), '還剩 1 張');
  s.back();
  assert.ok(s.rate('miss'));
  s.toCurrent();
  assert.equal(remaining(s.view()), '還剩 2 張');
});

void test('§5 別台裝置的紀錄在這一輪之後答對，剩餘數減一；這一輪之前的不算', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b', 'c') });
  const earlier = encodeEntry('2026-10-24T18:59:00.000+08:00', { lt: 'c', r: 'good', v: '12345678' });
  const s = await h.open(h.round());
  h.clock.now += 1000;
  const later = encodeEntry(new Date(h.clock.now - 500).toISOString().replace('Z', '+00:00'), { lt: 'b', r: 'good', v: '12345678' });
  h.write(PHONE, earlier + '\n' + later + '\n');
  await h.settle();
  assert.equal(remaining(s.view()), '還剩 2 張');
});

void test('§5 中途把目標改暫停，總數減一；卡組筆記的全部卡同一份', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b', 'c') });
  const s = await h.open(h.round({ deck: DECK }));
  assert.equal(remaining(s.view()), '還剩 3 張');
  h.write(DECK, HEAD('2-1') + targets('a', 'b') + '- 目標 c ^c\n    - c 的題目 :: 答\n    - 狀態：暫停\n');
  await h.settle();
  assert.equal(remaining(s.view()), '還剩 2 張');
  while (s.view().kind === 'card') h.rate(s, 'good');
  assert.equal(s.view().kind === 'done' && s.view().top.center, '還剩 0 張');
  const view = s.view();
  assert.equal(view.kind === 'done' && view.done.title, '這篇練完了！');
});

// Codex L2 的 F2：別的單元寫過來的目標，收的那個單元全部暫停或改草稿時，目錄、選卡、還剩幾張都是 0。
for (const status of ['暫停', '草稿']) {
  void test(`§3 §5 單元改成全部${status}：當日卡、全部卡和目錄用同一份目標集合`, async t => {
    const owner = HEAD('2-2') + '- 目標 x ^x\n    - 出處：國二上 2-1 p.3\n    - x 的題目 :: 答\n';
    const off = `---\n年級學期: 國二上\n科目: 自然\n單元: "2-1"\n狀態: ${status}\n---\n` + targets('b');
    const h = await setup(t, { [DECK]: HEAD('2-1') + targets('b'), [OTHER]: owner });
    const round = h.round();
    const s = await h.open(round);
    assert.equal(remaining(s.view()), '還剩 2 張');
    assert.deepEqual(h.state.scope({ unit: UNIT }), { done: 0, total: 2 });
    h.write(DECK, off);
    await h.settle();
    const row = h.state.catalog().terms[0].subjects[0].units[0];
    assert.equal(row.count, status === '暫停' ? 0 : null);
    assert.deepEqual([row.today, row.targets], [0, []]);
    for (const pick of [round, { unit: UNIT }]) {
      assert.deepEqual(h.state.scope(pick), { done: 0, total: 0 }, JSON.stringify(pick));
      assert.equal(h.state.next(pick).kind, 'done', JSON.stringify(pick));
    }
    assert.equal(remaining(s.view()), '還剩 0 張');
    // 目標本身還在：擁有者的單元照樣算。
    assert.deepEqual(h.state.catalog().terms[0].subjects[0].units[1].targets.map(target => target.id), ['x']);
  });
}

void test('§5 重排（換日以外）不改已完成數', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b', 'c') });
  const s = await h.open({ unit: UNIT });
  h.rate(s, 'good');
  assert.equal(remaining(s.view()), '還剩 2 張');
  h.write(OTHER, HEAD('2-2') + targets('z'));
  await h.settle();
  assert.equal(remaining(s.view()), '還剩 2 張');
  assert.equal(entryRow(h.state), '1/4');
});

void test('§5 既有的卡組 Pick：還剩幾張與完成畫面都照這一篇，不算成全部科目', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b'), [OTHER]: HEAD('2-2') + targets('c', 'd', 'e') });
  const s = await h.open({ deck: DECK });
  assert.equal(remaining(s.view()), '還剩 2 張');
  while (s.view().kind === 'card') h.rate(s, 'good');
  const view = s.view();
  assert.equal(view.kind === 'done' && view.done.title, '這一篇今天的份完成了！');
});

void test('§5 全部卡不算進每日時間上限：今天的份放不下的目標照樣出', async t => {
  const many = Array.from({ length: 130 }, (_, i) => 'k' + i);
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets(...many) });
  assert.ok(h.state.progress().total < 130, '30 分鐘放不下 130 個（一個 15 秒）');
  const s = await h.open(h.round());
  assert.equal(remaining(s.view()), '還剩 130 張');
  const unit = h.state.catalog().terms[0].subjects[0].units[0];
  assert.equal(unit.count, 130);
  assert.equal(unit.today, h.state.progress().total);
});

void test('§11 停在完成畫面、跨過清晨 4 點回來：照新一天的份重新判斷', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a') });
  const s = await h.open({ subject: '自然' });
  h.rate(s, 'miss');
  h.rate(s, 'good');
  assert.equal(s.view().kind, 'done');
  // 同一天回來：什麼都不換。
  const before = s.view();
  s.pause(); h.clock.now += 120_000; s.resume();
  assert.equal(s.view(), before);
  // 隔天到期：新的一天的份有這張卡。
  s.pause(); h.clock.now += 86_400_000 * 40; s.resume();
  assert.equal(card(s.view()), 'a');
});

void test('§9 記憶顏色：灰未複習、橙到期或剛答錯、綠還沒到期、藍間隔超過 21 天；在任一邊答對，兩個單元的顏色一起變', async t => {
  const log = [line('2026-10-24T08:00:00.000', 'wrong', 'miss'), line('2026-10-01T08:00:00.000', 'due', 'good'), line('2026-10-24T08:01:00.000', 'fine', 'good'), line('2026-10-24T08:02:00.000', 'deep', 'easy')].sort().join('\n') + '\n';
  const low = `---\n年級學期: 小四上\n科目: 自然\n單元: "2-1"\n---\n- 目標 ^shared\n    - 出處：小五上 2-1 p.15\n    - 問 :: 答\n`;
  const high = `---\n年級學期: 小五上\n科目: 自然\n單元: "2-1"\n---\n` + targets('wrong', 'due', 'fine', 'deep');
  const h = await setup(t, { 'Essence Cards/low.md': low, 'Essence Cards/high.md': high, [PHONE]: log });
  const colors = () => {
    const catalog = h.state.catalog();
    const [lowRow] = catalog.terms[0].subjects[0].units, [highRow] = catalog.terms[1].subjects[0].units;
    return { low: lowRow.targets[0].color, high: Object.fromEntries(highRow.targets.map(target => [target.id, target.color])) };
  };
  assert.deepEqual(colors(), { low: 'new', high: { wrong: 'near', due: 'near', fine: 'good', deep: 'easy', shared: 'new' } });
  const s = await h.open({ subject: '自然' });
  while (s.view().kind === 'card' && card(s.view()) !== 'shared') h.rate(s, 'good');
  h.rate(s, 'good');
  const after = colors();
  assert.equal(after.low, 'good');
  assert.equal(after.high.shared, 'good');
  assert.ok(!(h.texts.get(OWN) ?? '').includes('"lt":"low"'));
});

// ── 英文的兩個方向隔開（D-189 第 1 點、tasks/quiz-practice.md §2）──

/** n 個字的兩個方向，都是新卡：筆記裡同一個字的兩張相鄰，英翻中 e1、e2…，中翻英 z1、z2…。 */
const words = (n: number): string => Array.from({ length: n }, (_, i) => {
  const at = String(i + 1);
  return `- w${at} 中翻英 ^z${at}\n    - 字 ${at} :: w${at}\n- w${at} 英翻中 ^e${at}\n    - w${at} :: 字 ${at}\n`;
}).join('');
const ids = (letter: string, from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => letter + String(from + i));
/** 直接答（打字卡的步驟在 review-session 測過）：每張都走 practiceNext，一張 1 秒。回傳出卡順序與每張是不是提早出的。 */
function drill(h: Harness, pick: StudyPick, rating: (lt: string, order: readonly string[]) => Rating = () => 'good', limit = Infinity): { order: string[]; early: string[] } {
  const order: string[] = [], early: string[] = [];
  while (order.length < limit) {
    const next = h.state.next(pick);
    if (next.kind !== 'card') { assert.equal(next.kind, 'done'); break; }
    if (next.card.early) early.push(next.card.lt);
    h.state.answer({ lt: next.card.lt, r: rating(next.card.lt, order), v: '12345678' });
    order.push(next.card.lt);
    h.clock.now += 1000;
  }
  return { order, early };
}
/** 這一輪裡 a 的最後一次和 b 的下一次之間，答過幾個不同的其他目標。 */
const between = (order: readonly string[], a: string, b: string): number => {
  const from = order.lastIndexOf(a);
  const to = order.indexOf(b, from);
  assert.ok(from >= 0 && to > from, `${a} 要在 ${b} 前面：${order.join(' ')}`);
  return new Set(order.slice(from + 1, to).filter(lt => lt !== a && lt !== b)).size;
};

void test('§2 40 個字、兩個方向都是新卡：同一個字的兩張之間至少隔 10 個不同的目標，連最後幾個字也是', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + words(40) });
  const { order, early } = drill(h, h.round());
  assert.equal(order.length, 80);
  assert.equal(new Set(order).size, 80, '每張出一次');
  assert.deepEqual(early, []);
  for (const at of ids('', 1, 40)) assert.ok(between(order, 'e' + at, 'z' + at) >= 10, `第 ${at} 個字：${order.join(' ')}`);
});

void test('§2 英翻中答錯、1 分鐘後到期：到期時對方還不夠隔，先出別張；夠了才出', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + words(13) });
  const round = h.round();
  const first = drill(h, round, lt => lt === 'e1' ? 'miss' : 'good', 14).order;
  assert.deepEqual(first, [...ids('e', 1, 13), 'z1'], '答錯的還沒到期；z1 和 e1 隔了 12 個');
  h.clock.now += 120_000;
  const rest = drill(h, round).order;
  assert.deepEqual(rest, [...ids('z', 2, 11), 'e1', 'z12', 'z13'], 'e1 到期了，但 z1 之後要再答過 10 個不同的目標');
  assert.equal(between([...first, ...rest], 'z1', 'e1'), 10);
});

void test('§2 只有 3 個字（6 張）：照隔最多的先穿插，不會有一張等著不出；全部答對就結束', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + words(3) });
  const { order, early } = drill(h, h.round());
  assert.deepEqual(order, ['e1', 'e2', 'e3', 'z1', 'z2', 'z3']);
  assert.deepEqual(early, []);
});

void test('§2 只有一個字的兩個方向：直接出，不卡住', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + words(1) });
  const { order, early } = drill(h, h.round());
  assert.deepEqual(order, ['e1', 'z1']);
  assert.deepEqual(early, [], '另一張是新卡，不是提早出的重學');
});

void test('§2 到期的都不夠隔、也沒有新卡：在到期的裡挑隔最多的，不讓學生等', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + words(2) });
  const round = h.round();
  const first = drill(h, round, lt => lt.startsWith('e') ? 'miss' : 'good', 4).order;
  assert.deepEqual(first, ['e1', 'e2', 'z1', 'z2'], '新卡也不夠隔：z1 隔 1 個，z2 隔 0 個');
  h.clock.now += 120_000;
  const rest = drill(h, round);
  assert.deepEqual(rest.order, ['e1', 'e2'], 'z1 之後答過 z2，z2 之後沒有');
  assert.deepEqual(rest.early, []);
});

void test('§2 不為了湊間隔改出還沒到時間的：新卡不夠隔也照出；沒有別張才提早出', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('w') + words(1) });
  const { order, early } = drill(h, h.round(), (lt, seen) => lt === 'w' && !seen.includes('w') ? 'miss' : 'good');
  assert.deepEqual(order, ['w', 'e1', 'z1', 'w']);
  assert.deepEqual(early, ['w'], 'early 只表示提早出的重學');
});

void test('§2 中途關掉再開（新的 since）：從頭算，不沿用上一輪的間隔', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + words(1) + targets('a') });
  assert.deepEqual(drill(h, h.round()).order, ['e1', 'a', 'z1'], '只剩同一對時直接出');
  h.clock.now += 1000;
  assert.deepEqual(drill(h, h.round()).order, ['e1', 'a', 'z1'], 'e1 排最前面：z1 剛答過，但那是上一輪');
});

void test('§2 別的篇裡同樣的字不算一對', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + '- w1 英翻中 ^e1\n    - w1 :: 字\n', [OTHER]: HEAD('2-1') + '- w1 中翻英 ^z1\n    - 字 :: w1\n' + targets('a') });
  assert.deepEqual(drill(h, h.round()).order, ['e1', 'z1', 'a'], '筆記順序，沒有隔開');
});

/** 不經過選卡，直接照這個順序答。 */
const answerAll = (h: Harness, lts: readonly string[], r: Rating = 'good'): void => {
  for (const lt of lts) { h.state.answer({ lt, r, v: '12345678' }); h.clock.now += 1000; }
};
const nextOf = (h: Harness, pick: StudyPick): string | false => { const next = h.state.next(pick); return next.kind === 'card' && next.card.lt; };

void test('§2 錯題補強的作答不算間隔', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + words(2) + targets(...ids('m', 1, 10)) });
  const round = h.round();
  answerAll(h, ['e2', ...ids('m', 1, 10), 'e1']);
  for (const lt of ids('x', 1, 10)) { h.state.answer({ lt, r: 'miss', src: 'mistake' }); h.clock.now += 1000; }
  assert.equal(nextOf(h, round), 'z2', 'z1 排在前面，但 e1 之後只有錯題補強，還不夠隔');
});

void test('§2 「其他」不含自己：對方之後自己又答過一次不算一個', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + words(1) + targets(...ids('m', 1, 8), 'w') });
  const round = h.round();
  answerAll(h, ['z1', ...ids('m', 1, 8)]);
  answerAll(h, ['e1', 'w'], 'miss');
  h.clock.now += 120_000;
  assert.equal(nextOf(h, round), 'w', 'e1 比較早到期，但 z1 之後只答過 9 個其他的目標');
  answerAll(h, ['w']);
  assert.equal(nextOf(h, round), 'e1', '沒有別張了，不讓學生等');
});

void test('§2 到時間的先於新卡；一樣多就照原本的順序', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b', 'c') });
  const round = h.round();
  answerAll(h, ['c'], 'miss');
  h.clock.now += 120_000;
  assert.equal(nextOf(h, round), 'c', 'a、b 是新卡，排在前面也要等');
});

void test('§2 都不夠隔、隔得一樣多：照原本的順序', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + '- w 英翻中 ^e\n    - w :: 字\n- w 中翻英 ^z1\n    - 字一 :: w\n- w 中翻英 ^z2\n    - 字二 :: w\n' });
  assert.deepEqual(drill(h, h.round()).order, ['e', 'z1', 'z2']);
});

void test('§2 回看取消一筆：取消的那一筆不算作答，間隔跟著變', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + words(1) + targets(...ids('m', 1, 11)) });
  const round = h.round();
  const answered = drill(h, round, () => 'good', 11).order;
  assert.deepEqual(answered, ['e1', ...ids('m', 1, 10)]);
  const next = h.state.next(round);
  assert.equal(next.kind === 'card' && next.card.lt, 'm11', '新卡裡對方還沒答過的先');
  const t1 = h.state.answer({ lt: 'm11', r: 'good', v: '12345678' });
  h.clock.now += 1000;
  const last = h.state.next(round);
  assert.equal(last.kind === 'card' && last.card.lt, 'z1');
  assert.ok(t1);
  h.state.answer({ undo: t1 });
  const again = h.state.next(round);
  assert.equal(again.kind === 'card' && again.card.lt, 'm11');
});

// ── 完成畫面的「這輪第一次就答對」（D-189 第 2 點、tasks/quiz-practice.md §3）──

const doneOf = (view: View): Extract<View, { kind: 'done' }>['done'] => {
  assert.equal(view.kind, 'done');
  if (view.kind !== 'done') throw Error();
  return view.done;
};

void test('§3 40 個目標裡 32 個第一次就記住、8 個先答錯後答對：32／40；原本那一行留著', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets(...ids('a', 1, 40)) });
  const s = await h.open(h.round());
  const missed = new Set(ids('a', 1, 8)), seen = new Set<string>();
  while (s.view().kind === 'card') {
    const lt = card(s.view());
    h.rate(s, missed.has(lt) && !seen.has(lt) ? 'miss' : 'good');
    seen.add(lt);
  }
  const done = doneOf(s.view());
  assert.equal(done.score, '這輪第一次就答對 32／40');
  assert.match(done.detail, /^今天複習了 48 張/);
});

void test('§3 太簡單也算；單篇的全部卡一樣；新卡照算', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b') });
  const s = await h.open(h.round({ deck: DECK }));
  h.rate(s, 'easy');
  h.rate(s, 'good');
  assert.equal(doneOf(s.view()).score, '這輪第一次就答對 2／2');
});

void test('§3 第一次答差一點、回看改成記住了：算第一次就答對', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b') });
  const s = await h.open(h.round());
  h.rate(s, 'near');
  s.back();
  assert.ok(s.rate('good'));
  s.toCurrent();
  h.rate(s, 'good');
  assert.equal(doneOf(s.view()).score, '這輪第一次就答對 2／2');
});

void test('§3 第一次記住了、回看改成沒印象，再答對：不算；英文的兩個方向各算一個', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + '- w 英翻中 ^e\n    - w :: 字\n- w 中翻英 ^z\n    - 字 :: word\n' });
  const s = await h.open(h.round());
  assert.equal(card(s.view()), 'e');
  h.rate(s, 'good');
  s.back();
  assert.ok(s.rate('miss'));
  s.toCurrent();
  assert.equal(card(s.view()), 'z');
  s.input('word');
  s.submit();
  h.rate(s, 'good');
  assert.equal(card(s.view()), 'e');
  h.rate(s, 'good');
  assert.equal(doneOf(s.view()).score, '這輪第一次就答對 1／2');
});

void test('§3 打字卡第 1 步拼錯、第 2 步拼對：不算；第 1 步拼對算', async t => {
  const typed = (at: string): string => `- w${at} 中翻英 ^z${at}\n    - 字 ${at} :: word${at}\n`;
  const h = await setup(t, { [DECK]: HEAD('2-1') + typed('1') + typed('2') });
  const s = await h.open(h.round());
  assert.equal(card(s.view()), 'z1');
  s.input('wrod');
  s.submit();
  s.input('word1');
  s.submit();
  h.rate(s, 'near');
  assert.equal(card(s.view()), 'z2');
  s.input('word2');
  s.submit();
  h.rate(s, 'good');
  assert.equal(card(s.view()), 'z1', '答錯的提早出');
  s.input('word1');
  s.submit();
  h.rate(s, 'good');
  assert.equal(doneOf(s.view()).score, '這輪第一次就答對 1／2');
});

void test('§3 打字卡要 typed 是 right：評分是記住了但第 1 步不是拼對的不算（畫面不會寫出這種紀錄，手改或舊紀錄才有）', () => {
  const entry = (lt: string, typed?: 'right' | 'wrong' | 'skip'): string => encodeEntry('2026-10-24T19:00:00.000+08:00', { lt, r: 'good', v: '12345678', ...(typed ? { typed } : {}) });
  const { reviews } = mergeHistory([{ path: OWN, text: [entry('a'), entry('b', 'right'), entry('c', 'wrong'), entry('d', 'skip')].join('\n') + '\n' }]);
  assert.deepEqual(firstTry(reviews, START - 1000, new Set(reviews.map(each => each.t))), { right: 2, total: 4 });
});

void test('§3 這一輪有一筆別台裝置的作答：不顯示；這一輪之前的、錯題補強的不影響', async t => {
  const h = await setup(t, { [DECK]: HEAD('2-1') + targets('a', 'b'), [PHONE]: line('2026-10-24T08:00:00.000', 'a', 'good') + '\n' });
  const s = await h.open(h.round());
  h.rate(s, 'good');
  h.state.answer({ lt: 'x', r: 'miss', src: 'mistake' });
  h.rate(s, 'good');
  assert.equal(doneOf(s.view()).score, '這輪第一次就答對 2／2');
  const later = encodeEntry(new Date(h.clock.now - 500).toISOString().replace('Z', '+00:00'), { lt: 'z', r: 'good', v: '12345678' });
  h.write(PHONE, line('2026-10-24T08:00:00.000', 'a', 'good') + '\n' + later + '\n');
  await h.settle();
  assert.equal('score' in doneOf(s.view()), false);
});

void test('§3 當日卡、今天的份、再複習一些的完成畫面沒有這一行；這一輪沒有作答也沒有', async t => {
  const decks = { [DECK]: HEAD('2-1') + targets('a'), [OTHER]: HEAD('2-2') + targets('b') };
  const h = await setup(t, decks);
  for (const pick of [{ unit: UNIT }, { deck: DECK }, { subject: '自然' }, { more: true as const }]) {
    const s = await h.open(pick);
    while (s.view().kind === 'card') h.rate(s, 'good');
    assert.equal('score' in doneOf(s.view()), false, JSON.stringify(pick));
  }
  const empty = await h.open(h.round({ unit: '["國二上","自然","9-9"]' }));
  assert.equal('score' in doneOf(empty.view()), false);
});
