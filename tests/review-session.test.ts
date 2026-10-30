import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry, mergeHistory, parseLine, planToday } from '../src/core/study/index.ts';
import type { Pick, Rating } from '../src/core/study/index.ts';
import { AWAY_LIMIT, createSession, RATE_DELAY } from '../src/review/index.ts';
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
async function setup(t: TestContext, texts: Record<string, string> = vault, start = START): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
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

// Codex 格式查核 F6：沒打字（或只有空白）按確認什麼都不做，不會被當成「沒印象」，也不寫紀錄。
void test('R5 空白輸入按確認：第 1 步、第 3 步都不動，不算沒印象', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  for (const text of ['', '   ']) { s.input(text); s.submit(); }
  assert.deepEqual([typed(s.view()).step, typed(s.view()).first, typed(s.view()).canSkip], [1, null, true]);
  s.skip(); s.skip();
  assert.equal(typed(s.view()).step, 3);
  s.input('  '); s.submit();
  assert.deepEqual([typed(s.view()).step, typed(s.view()).finished, card(s.view()).allowed], [3, false, []]);
  await h.state.flush();
  assert.deepEqual(h.log(), []);
});

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
  // 照位置比：mnd 的 n 打在 i 的位置、d 打在 n 的位置，「你打的」那一行從 n 起標出（漏打也看得到）。
  assert.deepEqual(view.live?.typed.filter(l => l.bad).map(l => l.char), ['n', 'd'], '照打時打錯的字母當場標出');
  s.input('made up h');
  assert.deepEqual(typed(s.view()).live?.typed.filter(l => l.bad), [], '還沒打完的部分不算錯');
  s.input('made up his mnd');
  s.submit();
  assert.equal(typed(s.view()).finished, false, '和答案不同不結束');
  s.input('made up his mind'); s.submit();
  assert.equal(typed(s.view()).finished, true);
  assert.deepEqual(card(s.view()).allowed, ['miss', 'near']);
  await rateLater(h, s, 'near');
  assert.ok(h.log()[0].includes('"typed":"wrong","retry":"wrong"'));
});

void test('R5 原形等於答案（borrow）或去掉括號後等於答案（light）：第 1 步拼錯直接第 3 步，retry: not-needed', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  // 先把 z1 做掉。
  s.input('made up his mind'); s.submit();
  await rateLater(h, s, 'good');
  assert.equal(lt(s.view()), 'z2');
  s.input('borow'); s.submit();
  let view = typed(s.view());
  assert.deepEqual([view.step, view.first, view.second, view.hint], [3, 'wrong', 'not-needed', null]);
  s.input('borrow'); s.submit();
  await rateLater(h, s, 'near');
  assert.ok(h.log()[1].includes('"lt":"z2","r":"near","v":'));
  assert.ok(h.log()[1].endsWith(',"typed":"wrong","retry":"not-needed"}'), h.log()[1]);
  assert.equal(lt(s.view()), 'z3');
  // 按「沒印象」跳過第 2 步也是 not-needed。
  s.skip();
  view = typed(s.view());
  assert.deepEqual([view.step, view.first, view.second, view.hint, view.answer], [3, 'skip', 'not-needed', null, 'light']);
  s.input('light'); s.submit();
  await rateLater(h, s, 'miss');
  assert.ok(h.log()[2].endsWith(',"typed":"skip","retry":"not-needed"}'), h.log()[2]);
});

// D-158：答案從網頁或 PDF 複製來，帶著彎引號或不換行空白；q1 的名稱是 '、答案是 ’，q2 反過來。
const CURLY = 'Essence Cards/國二上/英文/L2（卡片）.md';
const curlyText = [
  '---', '年級學期: 國二上', '科目: 英文', '單元: L2', '---',
  "- o'clock 中翻英 ^q1", '    - 現在七點。It is seven ＿＿. :: o’clock',
  '- o’clock 中翻英 ^q2', "    - 現在七點。It is seven ＿＿. :: o'clock",
  '- look after 中翻英 ^q3', '    - 照顧 :: look after',
  '',
].join('\n');

void test('R5 D-158 彎引號與空白字元：第 1 步就結束、typed: right，線上寫答案原本的字', async t => {
  const h = await setup(t, { [CURLY]: curlyText });
  const s = await h.open({ subject: '英文' });
  for (const [id, text, answer] of [['q1', "o'clock", 'o’clock'], ['q2', 'O’Clock', "o'clock"], ['q3', 'look  after', 'look after']]) {
    assert.equal(lt(s.view()), id);
    s.input(text); s.submit();
    const view = typed(s.view());
    assert.deepEqual([view.finished, view.first, view.second, view.answer, view.step], [true, 'right', null, answer, 1], `${id} 打 ${text}`);
    assert.deepEqual(card(s.view()).allowed, ['good', 'easy']);
    await rateLater(h, s, 'good');
    assert.deepEqual(last(h.log()), { ...last(h.log()), lt: id, r: 'good', typed: 'right' });
  }
});

void test('R5 D-158 原形和答案只差彎引號：第 1 步拼錯直接第 3 步，retry: not-needed；照打 \' 也能結束', async t => {
  const h = await setup(t, { [CURLY]: curlyText });
  const s = await h.open({ subject: '英文' });
  s.input('oclock'); s.submit();
  const view = typed(s.view());
  assert.deepEqual([view.step, view.first, view.second, view.hint, view.copy], [3, 'wrong', 'not-needed', null, 'o’clock']);
  s.input("o'clock");
  assert.equal(typed(s.view()).live?.typed.some(l => l.bad), false, '照打的 \' 不標出');
  s.submit();
  assert.equal(typed(s.view()).finished, true);
  await rateLater(h, s, 'near');
  assert.ok(h.log()[0].endsWith(',"typed":"wrong","retry":"not-needed"}'), h.log()[0]);
});

void test('R5 D-158 第 2 步多按的空白與不換行空白不算錯：retry: right，能選的評分照第 1 步', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.input('made up my mind'); s.submit();
  s.input('made  up his mind'); s.submit();
  const view = typed(s.view());
  assert.deepEqual([view.finished, view.first, view.second, view.answer], [true, 'wrong', 'right', 'made up his mind']);
  assert.deepEqual(card(s.view()).allowed, ['miss', 'near']);
  await rateLater(h, s, 'near');
  assert.ok(h.log()[0].includes('"typed":"wrong","retry":"right"'), h.log()[0]);
});

// W6 §5 R5 最後一列（格式查核 F6）：只用 Session 的公開介面寫不出非法組合。
void test('R5 寫不出非法組合：沒有 typed 就沒有 retry；typed: right 沒有 retry；typed: wrong／skip 一定有 retry', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  // z1：第 1 步拼錯、第 2 步拼錯、照打 → 差一點。
  s.input('made up my mind'); s.submit(); s.input('made up his mand'); s.submit(); s.input('made his mind up'); s.submit();
  await rateLater(h, s, 'near');
  // z2：第 1 步拼對。
  s.input('borrow'); s.submit();
  await rateLater(h, s, 'good');
  // z3：沒印象 → 跳過第 2 步 → 照打。
  s.skip(); s.input('light'); s.submit();
  await rateLater(h, s, 'miss');
  // 回看改一次評分（取消加新的一筆），還有一般的卡。
  s.back(); s.back(); s.rate('easy');
  const natural = await h.open({ subject: '自然' });
  natural.reveal();
  await rateLater(h, natural, 'good');
  await h.state.flush();
  const reviews = h.log().map(line => JSON.parse(line) as Record<string, unknown>).filter(line => 'r' in line);
  assert.equal(reviews.length, 5);
  for (const line of reviews) {
    if (!('typed' in line)) assert.ok(!('retry' in line), JSON.stringify(line));
    else if (line.typed === 'right') assert.ok(!('retry' in line), JSON.stringify(line));
    else assert.ok(['right', 'wrong', 'skip', 'not-needed'].includes(line.retry as string), JSON.stringify(line));
  }
  assert.deepEqual(reviews.map(line => [line.typed ?? null, line.retry ?? null]), [['wrong', 'wrong'], ['right', null], ['skip', 'not-needed'], ['right', null], [null, null]]);
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
  // 回看一般科目的卡：沒有喇叭、沒有自動朗讀（2026-10-26 Obsidian 實測：回看時公式的符號被當成英文）。
  s.back();
  assert.equal(card(s.view()).viewing?.index, 0);
  assert.equal(card(s.view()).english, false);
  assert.equal(card(s.view()).speakable, false);
  assert.equal(card(s.view()).autoRead, null);
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
  // 原始 JSON 的 lt、v、typed、retry 和原本那行完全相同（一般卡沒有 typed、retry）。
  const raw = (line: string) => { const { lt: id, v, typed: first, retry } = JSON.parse(line) as Record<string, unknown>; return { id, v, first, retry }; };
  assert.deepEqual(raw(lines[3]), raw(lines[0]));
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

// Codex 格式查核 F5：改評分用的是這一次記下的 typed、retry（History 不讀 retry），改兩次每一行新的紀錄都留著證據。
void test('R10 打字卡第 1 步拼錯、第 2 步拼對後改評分兩次：新的每一行都還有 typed: wrong、retry: right，取消的是前一筆', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.input('made up my mind'); s.submit();
  s.input('made up his mind'); s.submit();
  await rateLater(h, s, 'near');
  s.back();
  s.rate('miss');
  s.rate('near');
  await h.state.flush();
  const raw = h.log().map(line => JSON.parse(line) as Record<string, unknown>);
  assert.equal(raw.length, 5);
  for (const i of [0, 2, 4]) assert.deepEqual([raw[i].lt, raw[i].typed, raw[i].retry], ['z1', 'wrong', 'right'], '第 ' + String(i + 1) + ' 行');
  assert.deepEqual(raw.map(line => line.r ?? 'undo'), ['near', 'undo', 'miss', 'undo', 'near']);
  assert.deepEqual([raw[1].undo, raw[3].undo], [raw[0].t, raw[2].t]);
  // 增量（state 的 history）與全量（重新 mergeHistory）都只剩最後一筆有效的作答。
  const full = mergeHistory([{ path: PC, text: h.log().join('\n') + '\n' }]);
  for (const history of [h.state.history(), full]) assert.deepEqual(history.reviews.filter(e => e.lt === 'z1').map(e => [e.t, e.r, e.typed]), [[raw[4].t, 'near', 'wrong']]);
});

// Codex L2：原本名稱寫「第 2 步」，實際走的是 borrow 原形等於答案的第 3 步；兩個情況分開測。
void test('R10 回看時目前這張在第 3 步（borrow 跳過第 2 步）：回到目前時仍在第 3 步、比對還在；一般卡翻面後回看，回來仍是翻面', async t => {
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
  assert.deepEqual([lt(s.view()), typed(s.view()).step, typed(s.view()).input, typed(s.view()).finished], ['z2', 3, '', false]);
  assert.deepEqual(typed(s.view()).attempt?.typed.map(l => l.char).join(''), 'borow');

  const n = await setup(t);
  const natural = await n.open({ subject: '自然' });
  natural.reveal();
  await rateLater(n, natural, 'good');
  natural.reveal();
  natural.back();
  natural.forward();
  assert.deepEqual([lt(natural.view()), card(natural.view()).revealed, card(natural.view()).viewing], ['a2', true, null]);
});

void test('R10 回看時目前這張在第 2 步、輸入框有字：回到目前時仍在第 2 步，「不對」、原形提示與打的字都留著', async t => {
  // borrow 中翻英排在 make up one's mind 中翻英前面：先做完 borrow，第二張才是有原形提示（第 2 步）的卡。
  const lines = englishText.split('\n');
  const z1 = lines.findIndex(line => line.endsWith('^z1'));
  const z1Block = lines.splice(z1, 3);
  lines.splice(lines.findIndex(line => line.endsWith('^z2')) + 2, 0, ...z1Block);
  const h = await setup(t, { ...vault, [ENGLISH]: lines.join('\n') });
  const s = await h.open({ subject: '英文' });
  assert.equal(lt(s.view()), 'z2');
  s.input('borrow'); s.submit();
  await rateLater(h, s, 'good');
  assert.equal(lt(s.view()), 'z1');
  s.input('made up my mind'); s.submit();
  s.input('made up h');
  assert.deepEqual([typed(s.view()).step, typed(s.view()).input], [2, 'made up h']);
  s.back();
  assert.deepEqual([lt(s.view()), card(s.view()).viewing], ['z2', { index: 0, total: 1 }]);
  s.input('x'); s.submit(); s.skip();
  s.toCurrent();
  const view = typed(s.view());
  assert.deepEqual([lt(s.view()), view.step, view.notice, view.hint, view.input, card(s.view()).revealed], ['z1', 2, true, "make up one's mind", 'made up h', false]);
  s.submit();
  assert.deepEqual([typed(s.view()).step, typed(s.view()).second], [3, 'wrong'], '回來後照常從第 2 步接著做');
  await h.state.flush();
  assert.equal(h.log().length, 1, '回看中打字、確認、沒印象都沒有作用');
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

// Codex L2 F2：完成畫面不能固定成算出來那一刻的樣子。同步進來或回看改評分之後，照新的 progress 與 next 重算。
void test('R10 完成畫面跟著變：別台裝置做完英文 → 今天的份完成了，N 照新的紀錄算', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  s.reveal(); await rateLater(h, s, 'good');
  s.reveal(); await rateLater(h, s, 'good');
  let view = s.view();
  assert.ok(view.kind === 'done');
  assert.deepEqual([view.done.title, view.done.detail], ['自然的份完成了！', '還有英文 3 張']);
  const fingerprints = new Map(h.state.decks().flatMap(d => d.deck.targets.flatMap(target => target.prompts.map(p => [target.id, p.fingerprint] as const))));
  for (const id of ['z1', 'z2', 'z3']) h.append(PHONE, encodeEntry('2026-10-24T18:30:00.000+08:00', { lt: id, r: 'good', v: fingerprints.get(id) ?? '' }));
  await h.settle();
  view = s.view();
  assert.ok(view.kind === 'done');
  assert.deepEqual([view.done.title, view.done.buttons.map(b => b.label)], ['今天的份完成了！', ['再複習一些', '結束複習']]);
  assert.match(view.done.detail, /^今天複習了 5 張/, 'N 也照新的紀錄算');
});

void test('R10 完成畫面回看改成沒印象：回到目前時這科又有卡（正面），不是舊的完成畫面', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  s.reveal(); await rateLater(h, s, 'good');
  s.reveal(); await rateLater(h, s, 'good');
  assert.equal(s.view().kind, 'done');
  s.back();
  assert.equal(lt(s.view()), 'a2');
  s.rate('miss');
  s.toCurrent();
  assert.deepEqual([lt(s.view()), card(s.view()).revealed, card(s.view()).viewing], ['a2', false, null]);
  assert.equal(s.view().top.center, '還剩 1 張');
});

void test('R10 回看改評分時目前有一張還沒作答的卡：目前這張不換（翻面的樣子也留著）', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  s.reveal(); await rateLater(h, s, 'good');
  s.reveal();
  s.back();
  s.rate('miss');
  s.toCurrent();
  assert.deepEqual([lt(s.view()), card(s.view()).revealed], ['a2', true]);
});

// Codex L2 F4（2026-10-27 定，W6 §2-1）：切到背景連續超過 60 秒才重設目前這張未評分的卡；剛好 60 秒不重設；不寫紀錄。
void test('F4 切走超過 60 秒：翻面的一般卡回到正面；剛好 60 秒不動；不寫紀錄，0.3 秒的規則重新算', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  s.reveal();
  s.pause(); h.clock.now += AWAY_LIMIT;
  assert.equal(s.resume(), false, '剛好 60 秒不重設');
  assert.equal(card(s.view()).revealed, true);
  s.pause(); h.clock.now += AWAY_LIMIT + 1;
  assert.equal(s.resume(), true);
  assert.deepEqual([lt(s.view()), card(s.view()).revealed, card(s.view()).allowed], ['a1', false, []]);
  assert.equal(s.resume(), false, '沒有 pause 的 resume 不動');
  s.reveal();
  s.rate('good');
  assert.equal(lt(s.view()), 'a1', '重新翻面後 0.3 秒內的自評不算');
  await rateLater(h, s, 'good');
  assert.equal(h.log().length, 1, '只有這一次按的自評');
});

void test('F4 打字卡切走超過 60 秒：回到第 1 步，清空輸入與這一次的作答結果；之後照常寫 typed、retry', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '英文' });
  s.input('made up my mind'); s.submit();
  s.input('made up h');
  assert.deepEqual([typed(s.view()).step, typed(s.view()).first], [2, 'wrong']);
  s.pause(); h.clock.now += 5 * 60_000;
  assert.equal(s.resume(), true);
  const view = typed(s.view());
  assert.deepEqual([view.step, view.first, view.second, view.notice, view.hint, view.input, view.attempt, view.firstAttempt, view.finished, view.canSkip],
    [1, null, null, false, null, '', null, null, false, true]);
  assert.equal(card(s.view()).revealed, false);
  s.input('made up his mind'); s.submit();
  await rateLater(h, s, 'good');
  assert.deepEqual(h.log().map(line => [parseLine(line)?.kind, line.includes('"typed":"right"'), line.includes('retry')]), [['review', true, false]], '這一次拼對：typed: right、沒有 retry');
});

void test('F4 回看時切走超過 60 秒：回看的位置與已評分的快照不動，回到目前時那張在正面；完成畫面不動', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  s.reveal(); await rateLater(h, s, 'good');
  s.reveal();
  s.back();
  s.pause(); h.clock.now += AWAY_LIMIT + 1;
  assert.equal(s.resume(), true);
  assert.deepEqual([lt(s.view()), card(s.view()).viewing, card(s.view()).pressed], ['a1', { index: 0, total: 1 }, 'good']);
  s.toCurrent();
  assert.deepEqual([lt(s.view()), card(s.view()).revealed], ['a2', false]);
  await rateLater(h, s, 'good');
  s.reveal(); await rateLater(h, s, 'good');
  assert.equal(s.view().kind, 'done');
  const before = s.view();
  s.pause(); h.clock.now += AWAY_LIMIT + 1;
  assert.equal(s.resume(), false, '完成畫面沒有可以重設的卡');
  assert.equal(s.view(), before);
  assert.equal(h.log().length, 2);
});

void test('F4 英翻中切走超過 60 秒：重新開始時題目照樣自動朗讀；回看中重設的，回到目前不補播', async t => {
  const h = await setup(t, { [ENGLISH]: englishText });
  const s = await h.open({ subject: '英文' });
  const question = card(s.view()).autoRead;
  assert.ok(question?.length);
  const shown = card(s.view()).shown;
  s.reveal();
  assert.equal(card(s.view()).autoRead, null);
  s.pause(); h.clock.now += AWAY_LIMIT + 1; s.resume();
  assert.deepEqual(card(s.view()).autoRead, question);
  assert.notEqual(card(s.view()).shown, shown, '從頭出現：畫面用 shown 換卡（停掉舊的朗讀、收起出處）');
  s.reveal(); await rateLater(h, s, 'good');
  const second = lt(s.view());
  assert.ok(second?.startsWith('e'), '第二張也是英翻中（會自動朗讀的卡），才測得出不補播：' + String(second));
  s.reveal(); s.back();
  assert.ok(card(s.view()).viewing);
  s.pause(); h.clock.now += AWAY_LIMIT + 1; s.resume();
  s.toCurrent();
  assert.deepEqual([lt(s.view()), card(s.view()).revealed, card(s.view()).autoRead], [second, false, null]);
});

// 任務說明 2-2：一篇卡組或一個目標在複習中途變成需要新版（停掉），目前這張作答時被拒絕：不寫紀錄、不算做過，畫面換下一張。
void test('2-2 複習中途卡組變成需要新版：這張作答不寫、不進回看，換下一張；回看裡停掉的那張不能改評分', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  assert.equal(lt(s.view()), 'a1');
  s.reveal();
  await rateLater(h, s, 'good');
  assert.equal(lt(s.view()), 'a2');
  // 別台裝置把這篇改成新寫法（這個 state 沒有傳 build，任何「需要版本」都讀不懂）。
  h.write(NATURAL, naturalText.replace('科目: 自然', '科目: 自然\n需要版本: 9.0.0'));
  await h.settle();
  assert.equal(lt(s.view()), 'a2', '目前這張不換（W6 §2-1）');
  s.reveal();
  h.clock.now += RATE_DELAY;
  assert.equal(s.rate('good'), true);
  await h.state.flush();
  assert.deepEqual(h.log().map(line => parseLine(line)?.kind === 'review' ? (parseLine(line) as { lt: string }).lt : line), ['a1']);
  assert.equal(s.view().kind, 'done');
  assert.deepEqual(s.history().map(entry => entry.card.lt), ['a1']);
  // 回看 a1：它的卡組需要新版，不能改評分。
  s.back();
  assert.deepEqual(card(s.view()).allowed, []);
  assert.equal(s.rate('miss'), false);
  await h.state.flush();
  assert.equal(h.log().length, 1);
});

void test('2-2 複習中途別台裝置的紀錄出現讀不懂的行、停掉目前這張：作答不寫，換下一張', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  assert.equal(lt(s.view()), 'a1');
  h.write(PHONE, earlier + JSON.stringify({ t: '2026-10-24T18:00:00.000+08:00', need: '9.0.0', lt: 'a1', r: 'miss', v: '12345678' }) + '\n');
  await h.settle();
  s.reveal();
  h.clock.now += RATE_DELAY;
  assert.equal(s.rate('good'), true);
  await h.state.flush();
  assert.deepEqual(h.log(), []);
  assert.equal(lt(s.view()), 'a2');
});

// S25（tasks/state-writes.md §6、外掛架構討論稿環節 4 Codex 第二輪的重現）：回看改評分會先取消原本那一筆；
// 取消的那一筆早於今天的份的開始時，今天的份要重排，不能留著用被取消那一筆算的記憶。
void test('S25 跨 04:00 回看改評分：今天的份重排，和 planToday(input()) 相同；同一天的取消不重排', async t => {
  const h = await setup(t, vault, at('2026-10-25T03:59:00.000+08:00'));
  const s = await h.open({ subject: '自然' });
  const target = lt(s.view());
  s.reveal();
  await rateLater(h, s, 'miss');
  h.clock.now = at('2026-10-25T04:01:00.000+08:00');
  assert.notEqual(h.state.today().slots.get(target)?.memory, null, '04:01 的份用 03:59 那一筆算記憶');
  s.back();
  assert.equal(lt(s.view()), target);
  s.rate('good');
  await h.state.flush();
  assert.deepEqual(h.state.today(), planToday(h.state.input()));
  assert.equal(h.state.today().slots.get(target)?.memory, null);

  const same = await setup(t);
  const s2 = await same.open({ subject: '自然' });
  s2.reveal();
  await rateLater(same, s2, 'miss');
  const before = same.state.today();
  s2.back();
  s2.rate('good');
  await same.state.flush();
  assert.equal(same.state.today(), before);
});

// Codex L2 的 F1：回看改評分要讓取消與新評分一起寫或一起不寫。取消涵蓋同一個 t 的所有作答：別台裝置同一刻的作答（a2）被停時，
// 取消被拒，這次改評分整組不寫，回看仍是原本的評分。
void test('L2 F1 回看改評分：取消被拒（同一刻別台裝置的作答被停）時整組不寫，回看的評分不變', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '自然' });
  assert.equal(lt(s.view()), 'a1');
  s.reveal();
  await rateLater(h, s, 'good');
  const [line] = h.log();
  const answered = parseLine(line);
  assert.ok(answered);
  // iPhone 在同一個毫秒答了 a2，之後那台寫了只停 a2 的新寫法（這個 state 沒有傳 build，任何 need 都讀不懂）。
  h.write(PHONE, earlier + encodeEntry(answered.t, { lt: 'a2', r: 'good', v: '12345678' }) + '\n'
    + JSON.stringify({ t: '2026-10-24T18:00:00.000+08:00', need: '9.0.0', lt: 'a2' }) + '\n');
  await h.settle();
  assert.deepEqual([h.state.canAnswer('a1'), h.state.canAnswer('a2')], [true, false]);
  s.back();
  assert.equal(s.rate('miss'), false);
  await h.state.flush();
  assert.deepEqual(h.log(), [line]);
  assert.deepEqual(h.state.history().reviews.filter(review => review.lt === 'a1').map(review => review.r), ['good']);
  assert.deepEqual(h.state.history().cancelled, []);
  assert.deepEqual(s.history().map(entry => [entry.card.lt, entry.rating]), [['a1', 'good']]);
  assert.equal(card(s.view()).pressed, 'good');
});
