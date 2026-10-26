import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry, parseLine } from '../src/core/study/index.ts';
import type { Pick, Rating } from '../src/core/study/index.ts';
import { createSession, RATE_DELAY } from '../src/review/index.ts';
import type { Session, TypedView, View } from '../src/review/index.ts';
import { createState } from '../src/state/index.ts';
import type { State } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// W6 §5 R5（打字三步）與 R10（一次複習）：createSession 接真的 createState（記憶體 Files、假計時器、now 由測試控制）。
const DELAY = 30;
const at = (text: string) => Date.parse(text);
const START = at('2026-10-24T19:00:00.000+08:00');
const ENGLISH = 'Essence Cards/國二上/英文/L1（卡片）.md';
const NATURAL = 'Essence Cards/國二上/自然/2-2（卡片）.md';
const PC = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const englishText = [
  '---', '年級學期: 國二上', '科目: 英文', '單元: L1 Back to School', '---',
  "- make up one's mind 英翻中 ^e1", "    - make up one's mind :: 下定決心",
  "- make up one's mind 中翻英 ^z1",
  '    - 他已經下定決心要出國讀書。He has already ＿＿ to study abroad. :: made up his mind | made his mind up',
  '        - 詳解：made up his mind 和 made his mind up 都對，課本用前者',
  '- borrow 英翻中 ^e2', '    - borrow :: v. 借入、向別人借', '        - 例句：Can I borrow your pen? 我可以借你的筆嗎？',
  '- borrow 中翻英 ^z2', '    - Can I ＿＿ your pen?（借） :: borrow',
  '- light（輕的） 英翻中 ^e3', '    - light :: adj. 輕的',
  '- light（輕的） 中翻英 ^z3', '    - 這個箱子很輕。This box is ＿＿. :: light',
  '',
].join('\n');
const naturalText = '---\n科目: 自然\n單元: 2-2 水溶液\n---\n- 能說出溶質與溶劑的意思 ^a1\n    - 糖水裡，哪一個是溶質？ :: 糖是**溶質**\n- 能說明溶液的質量組成 ^a2\n    - 溶液的質量怎麼算？ :: **溶質**加**溶劑**\n';
// 英翻中 10-10 都「太簡單」：今天不到期，中翻英才會以新卡出現（D-069）。
const earlier = ['e1', 'e2', 'e3'].map((lt, i) => encodeEntry(`2026-10-10T19:0${String(i)}:00.000+08:00`, { lt, r: 'easy', v: '12345678' })).join('\n') + '\n';
const vault = { [ENGLISH]: englishText, [NATURAL]: naturalText, [PHONE]: earlier };

const timed = new WeakSet<TestContext>();
interface Harness extends MemoryFiles {
  state: State;
  clock: { now: number };
  /** 讓 delay 過去並跑完排好的重讀（假計時器）。 */
  settle: () => Promise<void>;
  /** 自己的紀錄檔（PC-test）的每一行。 */
  log: () => string[];
  open: (pick: Pick) => Promise<Session>;
}
async function setup(t: TestContext, texts: Record<string, string> = vault): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles(texts);
  const clock = { now: START };
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: false, now: () => clock.now, offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  const sessions: Session[] = [];
  t.after(() => { for (const session of sessions) session.close(); });
  return {
    ...memory, state, clock,
    settle: async () => { t.mock.timers.tick(DELAY + 1); await new Promise<void>(resolve => setImmediate(resolve)); },
    log: () => (memory.texts.get(PC) ?? '').split('\n').filter(Boolean),
    async open(pick) {
      const session = createSession({ state, pick, now: () => clock.now });
      sessions.push(session);
      await session.ready();
      return session;
    },
  };
}
function card(view: View) {
  assert.equal(view.kind, 'card');
  if (view.kind !== 'card') throw Error();
  return view.card;
}
function typed(view: View): TypedView {
  const found = card(view).typed;
  assert.ok(found, '不是打字卡');
  return found;
}
const lt = (view: View) => card(view).card.lt;
const last = (lines: string[]) => parseLine(lines.at(-1) ?? '');
/** 答案出現之後過了 0.3 秒再按自評。 */
async function rateLater(h: Harness, session: Session, rating: Rating): Promise<void> {
  h.clock.now += RATE_DELAY;
  session.rate(rating);
  await h.state.flush();
}

void test('R5 第 1 步拼對（大小寫、頭尾空白不算）：只能記住了／太簡單，紀錄 typed: right、沒有 retry', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  assert.equal(lt(s.view()), 'z1');
  assert.equal(card(s.view()).speakable, false, '中翻英答案出現前沒有喇叭');
  s.input('Made Up His Mind ');
  s.submit();
  const view = typed(s.view());
  assert.deepEqual([view.finished, view.first, view.second, view.answer, view.step], [true, 'right', null, 'made up his mind', 1]);
  assert.deepEqual(card(s.view()).allowed, ['good', 'easy']);
  assert.equal(card(s.view()).speakable, true);
  assert.equal(card(s.view()).autoRead, null, '第 1 步拼對不自動念');
  s.rate('miss');
  assert.deepEqual(h.log(), [], '不能按的評分沒有作用');
  await rateLater(h, s, 'good');
  assert.deepEqual(h.log().length, 1);
  assert.deepEqual(last(h.log()), { ...last(h.log()), lt: 'z1', r: 'good', typed: 'right' });
  assert.ok(!h.log()[0].includes('retry'));
  assert.equal(lt(s.view()), 'z2');
});

void test('R5 第 1 步打第二個答案也算對，線上寫的是對中的那一個', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.input('made his mind up');
  s.submit();
  assert.deepEqual([typed(s.view()).finished, typed(s.view()).first, typed(s.view()).answer], [true, 'right', 'made his mind up']);
});

void test('R5 第 1 步拼錯 → 第 2 步「不對」與原形提示、沒有答案 → 拼對：只能差一點／沒印象，typed: wrong、retry: right', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.input('made up my mind');
  s.submit();
  let view = typed(s.view());
  assert.deepEqual([view.step, view.first, view.notice, view.hint, view.input, view.finished], [2, 'wrong', true, "make up one's mind", '', false]);
  assert.equal(card(s.view()).revealed, false, '第 2 步不顯示答案');
  assert.equal(view.attempt, null, '第 2 步不標拼錯的字母');
  assert.deepEqual(card(s.view()).allowed, []);
  s.input('made up his mind');
  s.submit();
  view = typed(s.view());
  assert.deepEqual([view.finished, view.first, view.second], [true, 'wrong', 'right']);
  assert.deepEqual(card(s.view()).allowed, ['miss', 'near']);
  // 第 2 步拼對：答案出現，自動朗讀先念答案再念填入答案的例句（D-116、D-121）。
  assert.deepEqual(card(s.view()).autoRead, ['made up his mind', 'He has already made up his mind to study abroad.']);
  assert.deepEqual(card(s.view()).autoRead, ['made up his mind', 'He has already made up his mind to study abroad.'], '再讀一次畫面還在');
  await rateLater(h, s, 'near');
  assert.equal(card(s.view()).autoRead, null, '下一個動作之後就不再念');
  assert.deepEqual(last(h.log()), { ...last(h.log()), lt: 'z1', r: 'near', typed: 'wrong' });
  assert.ok(h.log()[0].includes('"typed":"wrong","retry":"right"'));
});

void test('R5 第 1 步「沒印象」→ 第 2 步沒有「不對」→「沒印象」→ 第 3 步照打：只能沒印象，typed: skip、retry: skip', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.skip();
  let view = typed(s.view());
  assert.deepEqual([view.step, view.first, view.notice, view.hint], [2, 'skip', false, "make up one's mind"]);
  s.skip();
  view = typed(s.view());
  assert.deepEqual([view.step, view.second, view.canSkip, view.finished, view.answer], [3, 'skip', false, false, 'made up his mind']);
  assert.equal(card(s.view()).revealed, true, '第 3 步答案與背面出現');
  assert.deepEqual(card(s.view()).autoRead, ['made up his mind', 'He has already made up his mind to study abroad.']);
  assert.ok(view.attempt && view.attempt.expected.every(l => l.bad), '沒打字：整個答案都標出');
  s.skip();
  assert.equal(typed(s.view()).step, 3, '第 3 步沒有「沒印象」');
  s.input('made up his mind');
  s.submit();
  assert.equal(typed(s.view()).finished, true);
  assert.deepEqual(card(s.view()).allowed, ['miss']);
  await rateLater(h, s, 'miss');
  assert.ok(h.log()[0].includes('"r":"miss","v":'), h.log()[0]);
  assert.ok(h.log()[0].includes('"typed":"skip","retry":"skip"'));
});

void test('R5 第 1 步拼錯 → 第 2 步拼錯 → 第 3 步顯示比對（mand 的 a 標出），打 mnd 不結束、打對才結束：typed: wrong、retry: wrong', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.input('made up my mind'); s.submit();
  s.input('made up his mand'); s.submit();
  let view = typed(s.view());
  assert.deepEqual([view.step, view.first, view.second, view.hint, view.notice, view.input], [3, 'wrong', 'wrong', null, false, '']);
  assert.deepEqual(view.attempt?.typed.filter(l => l.bad).map(l => l.char), ['a']);
  assert.deepEqual(view.attempt?.expected.filter(l => l.bad).map(l => l.char), ['i']);
  s.input('made up his mnd');
  view = typed(s.view());
  assert.equal(view.live?.ok, false);
  assert.deepEqual(view.live?.expected.filter(l => l.bad).map(l => l.char), ['i'], '照打時打錯的字母當場標出');
  s.submit();
  assert.equal(typed(s.view()).finished, false, '和答案不同不結束');
  s.input('made up his mind'); s.submit();
  assert.equal(typed(s.view()).finished, true);
  assert.deepEqual(card(s.view()).allowed, ['miss', 'near']);
  await rateLater(h, s, 'near');
  assert.ok(h.log()[0].includes('"typed":"wrong","retry":"wrong"'));
});

void test('R5 原形等於答案（borrow）或去掉括號後等於答案（light）：第 1 步拼錯直接第 3 步，沒有 retry', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  // 先把 z1 做掉。
  s.input('made up his mind'); s.submit();
  await rateLater(h, s, 'good');
  assert.equal(lt(s.view()), 'z2');
  s.input('borow'); s.submit();
  let view = typed(s.view());
  assert.deepEqual([view.step, view.first, view.second, view.hint], [3, 'wrong', null, null]);
  s.input('borrow'); s.submit();
  await rateLater(h, s, 'near');
  assert.ok(h.log()[1].includes('"lt":"z2","r":"near","v":'));
  assert.ok(h.log()[1].includes('"typed":"wrong"') && !h.log()[1].includes('retry'));
  assert.equal(lt(s.view()), 'z3');
  s.input('lite'); s.submit();
  view = typed(s.view());
  assert.deepEqual([view.step, view.hint, view.answer], [3, null, 'light']);
});

void test('R5 第 2 步中途離開（新的 Session）：沒有寫任何紀錄；同一張從第 1 步開始', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.input('made up my mind'); s.submit();
  assert.equal(typed(s.view()).step, 2);
  s.close();
  const again = await h.open({ subject: '英文' });
  assert.equal(lt(again.view()), 'z1');
  assert.deepEqual([typed(again.view()).step, typed(again.view()).input, card(again.view()).revealed], [1, '', false]);
  assert.deepEqual(h.log(), []);
});

void test('R10 一般的卡：開始拿到 next 的同一張；翻面後 0.3 秒內的自評沒有作用；之後寫一行、換下一張', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  const first = h.state.next({ subject: '自然' });
  assert.equal(first.kind, 'card');
  assert.equal(lt(s.view()), first.kind === 'card' ? first.card.lt : '');
  assert.equal(card(s.view()).crumb, '自然 › 2-2 水溶液');
  assert.deepEqual(card(s.view()).allowed, []);
  s.rate('good');
  assert.deepEqual(h.log(), [], '翻面前不能評分');
  s.reveal();
  assert.deepEqual(card(s.view()).allowed, ['miss', 'near', 'good', 'easy']);
  h.clock.now += RATE_DELAY - 1;
  s.rate('good');
  assert.deepEqual(h.log(), [], '0.3 秒內不算');
  assert.equal(lt(s.view()), 'a1');
  h.clock.now += 1;
  s.rate('good');
  await h.state.flush();
  assert.deepEqual(last(h.log()), { ...last(h.log()), lt: 'a1', r: 'good', typed: null });
  assert.equal(lt(s.view()), 'a2');
  assert.equal(s.view().top.center, '還剩 1 張');
});

void test('R10 打字卡答錯後由 next 再出：還有別的卡時先出別的；到了再出的時間再出同一題，從第 1 步開始', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.input('made up my mind'); s.submit();
  s.input('made up his mind'); s.submit();
  await rateLater(h, s, 'near');
  assert.equal(h.log().length, 1);
  assert.equal(lt(s.view()), 'z2', '還沒到再出的時間，先出別的卡');
  s.input('borrow'); s.submit();
  await rateLater(h, s, 'good');
  s.input('light'); s.submit();
  await rateLater(h, s, 'good');
  // 差一點約 10 分鐘後再出（W3 的 dueAt）；還沒到時 z1 仍在等，畫面上也沒有別的卡：提早出（W4）。
  assert.equal(lt(s.view()), 'z1');
  assert.equal(card(s.view()).card.early, true);
  assert.deepEqual([typed(s.view()).step, typed(s.view()).input], [1, '']);
  assert.equal(s.view().top.center, '還剩 1 張');
});

void test('R10 回看改評分：取消加新的一筆（lt、v、typed 相同）；再改一次取消的是新的 t；按「沒印象」的打字卡不能改', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  s.reveal();
  await rateLater(h, s, 'good');
  const firstT = last(h.log())?.t;
  s.reveal();
  await rateLater(h, s, 'good');
  assert.equal(s.view().kind, 'done');
  assert.equal(s.view().top.canBack, true);
  s.back();
  assert.deepEqual(card(s.view()).viewing, { index: 1, total: 2 });
  assert.equal(card(s.view()).pressed, 'good');
  assert.equal(card(s.view()).autoRead, null, '回看不播放自動朗讀');
  s.back();
  assert.deepEqual([card(s.view()).viewing, card(s.view()).pressed, lt(s.view())], [{ index: 0, total: 2 }, 'good', 'a1']);
  assert.equal(s.view().top.canBack, false, '第一張再往前：彈回');
  s.rate('good');
  assert.equal(h.log().length, 2, '按同一個評分不寫');
  s.rate('easy');
  await h.state.flush();
  const lines = h.log();
  assert.equal(lines.length, 4);
  assert.deepEqual(parseLine(lines[2]), { ...parseLine(lines[2]), kind: 'undo', undo: firstT });
  const original = parseLine(lines[0]);
  assert.deepEqual(parseLine(lines[3]), { ...parseLine(lines[3]), lt: 'a1', r: 'easy', v: original?.kind === 'review' ? original.v : '' });
  assert.deepEqual(h.state.history().reviews.filter(e => e.lt === 'a1').map(e => e.r), ['easy']);
  assert.equal(card(s.view()).pressed, 'easy');
  s.rate('good');
  await h.state.flush();
  const second = parseLine(h.log()[4]);
  assert.ok(second?.kind === 'undo' && second.undo === parseLine(lines[3])?.t, '再改一次，取消的是新的那一筆');
  assert.deepEqual(h.state.history().reviews.filter(e => e.lt === 'a1').map(e => e.r), ['good']);
  s.forward();
  assert.deepEqual(card(s.view()).viewing, { index: 1, total: 2 });
  s.forward();
  assert.equal(s.view().kind, 'done', '最後一張的下一步是目前的畫面');

  // 打字卡第 1 步按「沒印象」的那張，改評分沒有作用。
  const e = await setup(t);
  const typedSession = await e.open({ subject: '英文' });
  typedSession.skip(); typedSession.skip();
  typedSession.input('made up his mind'); typedSession.submit();
  await rateLater(e, typedSession, 'miss');
  typedSession.back();
  assert.deepEqual(card(typedSession.view()).allowed, []);
  typedSession.rate('near');
  await e.state.flush();
  assert.equal(e.log().length, 1);
});

void test('R10 回看時目前這張還在第 2 步：回到目前時仍在第 2 步、輸入框是空的；一般卡翻面後回看，回來仍是翻面', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.input('made up his mind'); s.submit();
  await rateLater(h, s, 'good');
  s.input('borow'); s.submit();
  assert.equal(typed(s.view()).step, 3);
  s.toCurrent();
  s.back();
  assert.equal(lt(s.view()), 'z1');
  s.toCurrent();
  assert.deepEqual([lt(s.view()), typed(s.view()).step, typed(s.view()).input], ['z2', 3, '']);

  const n = await setup(t);
  const natural = await n.open({ subject: '自然' });
  natural.reveal();
  await rateLater(n, natural, 'good');
  natural.reveal();
  natural.back();
  natural.forward();
  assert.deepEqual([lt(natural.view()), card(natural.view()).revealed, card(natural.view()).viewing], ['a2', true, null]);
});

void test('R10 中斷：翻面後不評分就丟掉 Session，新的 Session 拿到同一張、在正面；紀錄沒有變', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  s.reveal();
  s.close();
  const again = await h.open({ subject: '自然' });
  assert.deepEqual([lt(again.view()), card(again.view()).revealed], ['a1', false]);
  assert.deepEqual(h.log(), []);
});

void test('R10 onChange：別台裝置的紀錄讓自然做完一張，上方的「還剩幾張」跟著變；目前這張不換', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  let notified = 0;
  s.subscribe(() => { notified++; });
  assert.equal(s.view().top.center, '還剩 2 張');
  const a2 = h.state.decks().find(d => d.path === NATURAL)?.deck.targets[1].prompts[0].fingerprint ?? '';
  h.append(PHONE, encodeEntry('2026-10-24T18:30:00.000+08:00', { lt: 'a2', r: 'good', v: a2 }));
  await h.settle();
  assert.ok(notified >= 1);
  assert.equal(s.view().top.center, '還剩 1 張');
  assert.deepEqual([lt(s.view()), card(s.view()).revealed], ['a1', false]);
  assert.deepEqual(h.log(), []);
});

void test('R10 完成畫面：一科做完還有別科 → 接著做；全部做完 → 再複習一些；more 也沒有了 → 又多複習了一些；N 與 M', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  s.reveal(); await rateLater(h, s, 'good');
  h.clock.now += 20_000;
  s.reveal(); await rateLater(h, s, 'good');
  let view = s.view();
  assert.equal(view.kind, 'done');
  if (view.kind !== 'done') throw Error();
  assert.deepEqual([view.done.title, view.done.detail, view.done.buttons.map(b => b.label)], ['自然的份完成了！', '還有英文 3 張', ['接著做英文', '結束複習']]);
  assert.deepEqual(view.done.buttons[0].pick, { subject: '英文' });
  s.continueWith(view.done.buttons[0].pick ?? { more: true });
  assert.equal(lt(s.view()), 'z1');
  assert.equal(s.view().top.center, '還剩 3 張');
  h.clock.now += 5 * 60_000;
  for (const answer of ['made up his mind', 'borrow', 'light']) { s.input(answer); s.submit(); await rateLater(h, s, 'good'); h.clock.now += 20_000; }
  view = s.view();
  assert.equal(view.kind, 'done');
  if (view.kind !== 'done') throw Error();
  // 5 筆：間隔 20 秒、5 分鐘（不算）、20 秒、20 秒 → 約 1 分鐘。
  assert.deepEqual([view.done.title, view.done.detail, view.done.buttons.map(b => b.label)], ['今天的份完成了！', '今天複習了 5 張・約 1 分鐘', ['再複習一些', '結束複習']]);
  s.continueWith({ more: true });
  view = s.view();
  assert.equal(view.kind, 'done');
  if (view.kind !== 'done') throw Error();
  assert.deepEqual([view.done.title, view.done.buttons.map(b => b.label), s.pick()], ['又多複習了一些', ['結束複習'], { more: true }]);
  assert.equal(view.top.center, '再複習一些');
});
