import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { parseDeck } from '../src/core/deck/index.ts';
import { createPreview, RATE_DELAY } from '../src/review/index.ts';
import type { Session } from '../src/review/index.ts';
import { answers, DECK, setup } from './helpers/pick-session.ts';
import type { Harness } from './helpers/pick-session.ts';
import { renderReview, type ReviewUi } from './helpers/review-ui.ts';
import type { ReportKind } from '../src/core/errors/index.ts';

// 比較卡的畫面（tasks/question-type-seam.md §7）：用 hook 替身跑真的 Review。版面、顏色與空格的位置在 Obsidian 用開發命令驗（§10）。
const NO_OWNER = { term: null, subject: null, unit: null };
async function show(t: TestContext, session: Session, onReport?: (kind: ReportKind, card: { deck: string; lt: string; v: string }) => void): Promise<ReviewUi> {
  const ui = await renderReview({
    app: {} as App, session, close: () => {}, openLink: () => {}, materials: () => [], owner: () => NO_OWNER, units: () => [],
    speech: { say: () => {}, stop: () => {} }, autoRead: { get: () => false, set: () => {} }, pickedAt: performance.now(), onReport,
  });
  t.after(() => { ui.unmount(); });
  await ui.settle();
  return ui;
}
const PROPS = '---\n科目: 國語\n---\n';
const preview = (text: string, reveal = false): Session => {
  const session = createPreview({ path: DECK, deck: parseDeck(text), reveal });
  assert.ok(session);
  return session;
};
const CHARS = `- 寨（寨、塞、寒、賽） 相似字 ^zhai00
    - 盜匪躲在山＿＿裡。 :: 寨
    - 記憶錨點：下面是**木**，木頭圍成的防守地：山寨、寨子
- 塞（寨、塞、寒、賽） 相似字 ^sai000
    - 下班時間大＿＿車。 :: 塞
    - 記憶錨點：下面是**土**，沒有常用詞
- 寒（寨、塞、寒、賽） 相似字 ^han000
    - 冬天很＿＿冷。 :: 寒
- 賽（寨、塞、寒、賽） 相似字 ^yyy000
    - 明天有籃球比＿＿。 :: 賽
`;
/** 一組比較卡：每個成員一張、一句。 */
const group = (members: string[]): string => members.map((word, i) => `- ${word}（${members.join('、')}） 比較 ^id${String(i).padStart(4, '0')}\n    - 第 ${String(i)} 句＿＿ :: ${word}\n`).join('');
const keyTexts = (ui: ReviewUi): string[] => ui.find('ec-pick-key').map(key => ui.text(key));
const actionTexts = (ui: ReviewUi): string[] => ui.find('ec-actions').flatMap(row => row.children.flatMap(child => typeof child === 'string' ? [child] : child.props.className === 'ec-pick-keys' ? [] : [ui.text(child)]));
const press = (ui: ReviewUi, className: string, index = 0): void => { ui.click(ui.find(className)[index]); };

void test('標題：結尾、全形冒號、括號順序的組；沒有結尾時只列組', async t => {
  const titled = await show(t, preview(PROPS + CHARS));
  assert.equal(titled.text(titled.find('ec-pick-title')[0]), '相似字：寨、塞、寒、賽');
  const plain = await show(t, preview(PROPS + '- 寨（寨、塞） ^zhai00\n    - 山＿＿ :: 寨\n'));
  assert.equal(plain.text(plain.find('ec-pick-title')[0]), '寨、塞');
  // 每張卡都有的那一行（路徑、「新」）照舊在最上面。
  assert.ok(plain.root().children.length > 0);
  assert.equal(plain.find('ec-meta').length, 1);
});

void test('同一組的字結尾不同：標題用選中的那一格的結尾', async t => {
  const ui = await show(t, preview(PROPS + '- 寨（寨、塞） 比較 ^zhai00\n    - 山＿＿ :: 寨\n- 塞（寨、塞） 相似字 ^sai000\n    - 大＿＿車 :: 塞\n'));
  assert.equal(ui.text(ui.find('ec-pick-title')[0]), '比較：寨、塞');
});

void test('旗子：交出去的是選中的那一格：卡上真的有這一句，目標和指紋是同一格的', async t => {
  const h: Harness = await setup(t);
  const s = await h.open({ subject: '國語' });
  const reports: { deck: string; lt: string; v: string }[] = [];
  const ui = await show(t, s, (_kind, card) => { reports.push(card); });
  const current = s.view();
  assert.equal(current.kind, 'card');
  if (current.kind !== 'card') return;
  ui.click(ui.find('ec-flag')[0]);
  await ui.settle();
  ui.click(ui.find('ec-report-item')[0]);
  await ui.settle();
  assert.deepEqual(reports, [{ deck: DECK, lt: current.card.card.lt, v: current.card.card.prompt.fingerprint }]);
  assert.ok(current.card.card.blanks.some(blank => blank.lt === reports[0].lt && blank.prompt.fingerprint === reports[0].v));
});

void test('字鍵：照打散的順序，6 個以內一排、7 個以上兩排；詞也放得下（is-words）', async t => {
  const four = await show(t, preview(PROPS + CHARS));
  const view = (four.find('ec-pick-keys')[0]);
  assert.equal((view.props.style as Record<string, string>)['--ec-pick-columns'], '4');
  assert.deepEqual(keyTexts(four).sort(), ['塞', '寒', '寨', '賽']);
  const six = await show(t, preview(PROPS + group(['甲', '乙', '丙', '丁', '戊', '己'])));
  assert.equal((six.find('ec-pick-keys')[0].props.style as Record<string, string>)['--ec-pick-columns'], '6');
  const seven = await show(t, preview(PROPS + group(['甲', '乙', '丙', '丁', '戊', '己', '庚'])));
  assert.equal((seven.find('ec-pick-keys')[0].props.style as Record<string, string>)['--ec-pick-columns'], '4');
  const eight = await show(t, preview(PROPS + group(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'])));
  assert.equal((eight.find('ec-pick-keys')[0].props.style as Record<string, string>)['--ec-pick-columns'], '4');
  assert.equal(four.find('ec-pick-keys')[0].props.className, 'ec-pick-keys');
  const words = await show(t, preview(PROPS + group(['make up', 'affect', '質量'])));
  assert.equal(words.find('ec-pick-keys')[0].props.className, 'ec-pick-keys is-words');
  // 詞比字長（375 寬實測：6 個一排一格 52px，give up 超出字鍵）：一排最多 4 個，5、6 個排成兩排各 3 個。
  const columnsOf = async (members: string[]): Promise<string> => ((await show(t, preview(PROPS + group(members)))).find('ec-pick-keys')[0].props.style as Record<string, string>)['--ec-pick-columns'];
  const WORDS = ['affect', 'effect', 'make up', 'give up', 'carry on', 'take off', 'put on', 'turn on', 'look up'];
  assert.equal(await columnsOf(WORDS.slice(0, 3)), '3');
  assert.equal(await columnsOf(WORDS.slice(0, 4)), '4');
  assert.equal(await columnsOf(WORDS.slice(0, 5)), '3');
  assert.equal(await columnsOf(WORDS.slice(0, 6)), '3');
  assert.equal(await columnsOf(WORDS.slice(0, 7)), '4');
  assert.equal(await columnsOf(WORDS.slice(0, 8)), '4');
  assert.equal(await columnsOf(WORDS), '4', '9 個詞：還是一排 4 個');
});

void test('對照：有詞的組加 is-words，字那一欄跟著最長的詞變寬；單字的組維持原樣（使用者 2026-11-12）', async t => {
  const chars = await show(t, preview(PROPS + CHARS, true));
  assert.equal(chars.find('ec-pick-compare')[0].props.className, 'ec-pick-compare ec-answer');
  const words = await show(t, preview(PROPS + group(['反應', '反映']), true));
  assert.equal(words.find('ec-pick-compare')[0].props.className, 'ec-pick-compare ec-answer is-words');
  const english = await show(t, preview(PROPS + group(['give up', 'look after']), true));
  assert.equal(english.find('ec-pick-compare')[0].props.className, 'ec-pick-compare ec-answer is-words');
});

void test('每一句一行：句子照 Markdown 的 pick 模式，空格是按鈕放進 slotNode；待答的那一行有 is-on', async t => {
  const s = preview(PROPS + CHARS);
  const ui = await show(t, s);
  const rows = ui.find('ec-pick-row');
  assert.equal(rows.length, 4);
  assert.ok(rows[0].props.className === 'ec-pick-row is-on');
  assert.ok(rows[1].props.className === 'ec-pick-row');
  const marks = ui.find('ec-pick-mark').map(mark => ui.text(mark));
  assert.deepEqual(marks, ['', '', '', '']);
  const slot = ui.find('ec-pick-slot');
  assert.equal(slot.length, 4);
  assert.equal(slot[2].props['aria-label'], '第 3 格');
  press(ui, 'ec-pick-row', 3);
  assert.equal(ui.find('ec-pick-row')[3].props.className, 'ec-pick-row is-on');
  press(ui, 'ec-pick-key', 0);
  assert.equal(ui.text(ui.find('ec-pick-slot')[3]), keyTexts(ui)[0]);
});

void test('下面的動作：作答時沒印象、對答案；還有空格時對答案變淡；再選時是再選一次、剛才選的字變淡；結果階段換成評分或下一張', async t => {
  const h: Harness = await setup(t);
  const s = await h.open({ subject: '國語' });
  const ui = await show(t, s);
  assert.equal(ui.text(ui.find('ec-pick-skip')[0]), '沒印象');
  assert.equal(ui.text(ui.find('ec-pick-check')[0]), '對答案');
  assert.equal(ui.find('ec-pick-check')[0].props.className, 'ec-pick-act ec-pick-check');
  const keys = keyTexts(ui);
  answers(s).forEach((answer, index) => {
    h.clock.now += 400;
    press(ui, 'ec-pick-key', keys.indexOf(index === 0 ? keys.find(key => key !== answer) ?? '' : answer));
  });
  assert.equal(ui.find('ec-pick-check')[0].props.className, 'ec-pick-act ec-pick-check is-ready');
  h.clock.now += 400;
  press(ui, 'ec-pick-check');
  assert.equal(ui.text(ui.find('ec-pick-check')[0]), '再選一次');
  const disabled = ui.find('ec-pick-key').filter(key => key.props.disabled === true);
  assert.equal(disabled.length, 1);
  assert.equal(ui.text(ui.find('ec-pick-slot')[0]), ui.text(disabled[0]));
  assert.equal(ui.find('ec-pick-slot')[0].children.some(child => typeof child !== 'string' && child.type === 's'), true, '剛才選錯的字劃掉');
  assert.deepEqual(ui.find('ec-pick-mark').map(mark => ui.text(mark)), ['✕', '✓', '✓', '✓', '✓']);
  h.clock.now += 400;
  press(ui, 'ec-pick-key', keys.indexOf(answers(s)[0]));
  assert.deepEqual(ui.find('ec-pick-key'), [], '結果階段沒有字鍵');
  assert.deepEqual(ui.find('ec-rate'), []);
  assert.equal(ui.text(ui.find('ec-show')[0]), '下一張');
  h.clock.now += RATE_DELAY;
  press(ui, 'ec-show');
  await h.state.flush();
  assert.equal(h.log().length, 4);
  // 回看：結果階段的畫面，字鍵不出現；有錯的沒有評分。
  ui.key('ArrowLeft');
  await ui.settle();
  assert.deepEqual(ui.find('ec-pick-key'), []);
  assert.deepEqual(ui.find('ec-rate'), []);
  assert.deepEqual(actionTexts(ui), []);
  assert.equal(ui.find('ec-cmp').length, 4);
});

void test('鍵盤：Space、Enter 是對答案與下一張；3、4 照舊評分；字鍵上的 Space 不算', async t => {
  const h: Harness = await setup(t);
  const s = await h.open({ subject: '國語' });
  const ui = await show(t, s);
  const keys = keyTexts(ui);
  answers(s).forEach(answer => { h.clock.now += 400; press(ui, 'ec-pick-key', keys.indexOf(answer)); });
  h.clock.now += 400;
  ui.key(' ');
  assert.deepEqual(ui.find('ec-rate').map(rate => ui.text(rate)), ['記住了', '太簡單']);
  h.clock.now += RATE_DELAY;
  ui.key('4');
  await h.state.flush();
  assert.ok(h.log().every(line => line.r === 'easy'));
  assert.equal(h.log().length, 4);
});

void test('Enter 在有錯的結果階段是下一張', async t => {
  const h: Harness = await setup(t);
  const s = await h.open({ subject: '國語' });
  const ui = await show(t, s);
  const keys = keyTexts(ui);
  answers(s).forEach(() => { h.clock.now += 400; press(ui, 'ec-pick-skip'); });
  h.clock.now += 400;
  ui.key('Enter');
  assert.equal(ui.text(ui.find('ec-show')[0]), '下一張');
  assert.ok(keys.length > 0);
  h.clock.now += RATE_DELAY;
  ui.key('Enter');
  await h.state.flush();
  assert.equal(h.log().length, 4);
  assert.ok(h.log().every(line => line.r === 'miss' && line.pick === null));
});

void test('對照：每個字一行；記憶錨點去掉名稱、最後一個全形冒號之後是常用詞；沒有冒號就沒有那一行；右邊是結果，這次沒出句子的字沒有', async t => {
  const h: Harness = await setup(t, { [DECK]: PROPS + CHARS });
  const s = await h.open({ targets: ['zhai00', 'sai000'] });
  const ui = await show(t, s);
  const keys = keyTexts(ui);
  answers(s).forEach(answer => { h.clock.now += 400; press(ui, 'ec-pick-key', keys.indexOf(answer)); });
  assert.deepEqual(ui.find('ec-cmp'), [], '對答案之前沒有對照');
  h.clock.now += 400;
  press(ui, 'ec-pick-check');
  const rows = ui.find('ec-cmp');
  assert.deepEqual(ui.find('ec-cmp-ch').map(each => ui.text(each)), ['寨', '塞', '寒', '賽']);
  assert.equal(rows.length, 4);
  const anchors = ui.find('ec-cmp-why').map(each => each.children.flatMap(child => typeof child === 'string' || child.type !== 'markdown' ? [] : [child.props.text]));
  assert.deepEqual(anchors, [['下面是**木**，木頭圍成的防守地'], ['下面是**土**，沒有常用詞'], [], []]);
  assert.deepEqual(ui.find('ec-cmp-words').map(each => ui.text(each)), ['山寨、寨子']);
  assert.deepEqual(ui.find('ec-chip').map(chip => [ui.text(chip), chip.props['data-k']]), [['記住了', 'good'], ['記住了', 'good']]);
  // 改成太簡單之後，回看的結果跟著變。
  h.clock.now += RATE_DELAY;
  press(ui, 'ec-rate', 0);
  await h.state.flush();
  ui.key('ArrowLeft');
  await ui.settle();
  ui.key('4');
  await ui.settle();
  assert.deepEqual(ui.find('ec-chip').map(chip => chip.props['data-k']), ['easy', 'easy']);
  assert.deepEqual(ui.find('ec-rate').map(rate => [ui.text(rate), rate.props['aria-pressed']]), [['記住了', false], ['太簡單', true]]);
});

void test('預覽的自動展開：沒有記號、結果與評分；下面只有預覽自己的下一張', async t => {
  const ui = await show(t, preview(PROPS + CHARS, true));
  assert.deepEqual(ui.find('ec-pick-mark').map(mark => ui.text(mark)), ['', '', '', '']);
  assert.deepEqual(ui.find('ec-chip'), []);
  assert.deepEqual(ui.find('ec-rate'), []);
  assert.deepEqual(ui.find('ec-show'), []);
  assert.deepEqual(ui.find('ec-actions'), []);
  assert.equal(ui.text(ui.find('ec-next')[0]), '下一張');
  assert.equal(ui.find('ec-cmp').length, 4);
});
