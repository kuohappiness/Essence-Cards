import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry } from '../src/core/study/index.ts';
import type { Pick } from '../src/core/study/index.ts';
import { AWAY_LIMIT, createSession, RATE_DELAY, sourceLinks } from '../src/review/index.ts';
import type { Session } from '../src/review/index.ts';
import { createState } from '../src/state/index.ts';
import type { App } from 'obsidian';
import { createMemoryFiles } from './helpers/memory-files.ts';
import { renderReview, type ReviewUi } from './helpers/review-ui.ts';
import { resolveSource } from '../src/ui/sources.ts';

// 複習畫面元件（src/ui/Review.tsx）的時序：Codex L2 審查的 F1（動畫期間的按鍵）、F3（自動朗讀被換卡停掉）、F7（第 2 步拼對的打勾）；
// 最後是 F5（出處的子圖，src/ui/sources.ts）。
// 用 tests/helpers/review-ui.ts 的 hook／Motion 替身跑真的 Review 元件，接真的 createSession 與 createState（記憶體 Files）。
const START = Date.parse('2026-10-24T19:00:00.000+08:00');
const NATURAL = 'Essence Cards/國二上/自然/2-2（卡片）.md';
const ENGLISH = 'Essence Cards/國二上/英文/L1（卡片）.md';
const PC = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const naturalText = '---\n科目: 自然\n單元: 2-2 水溶液\n---\n- 能說出溶質與溶劑的意思 ^a1\n    - 糖水裡，哪一個是溶質？ :: 糖是**溶質**\n- 能說明溶液的質量組成 ^a2\n    - 溶液的質量怎麼算？ :: **溶質**加**溶劑**\n';
const englishText = [
  '---', '年級學期: 國二上', '科目: 英文', '單元: L1 Back to School', '---',
  "- make up one's mind 英翻中 ^e1", "    - make up one's mind :: 下定決心",
  "- make up one's mind 中翻英 ^z1",
  '    - 他已經下定決心要出國讀書。He has already ＿＿ to study abroad. :: made up his mind | made his mind up',
  '- borrow 英翻中 ^e2', '    - borrow :: v. 借入、向別人借',
  '- borrow 中翻英 ^z2', '    - Can I ＿＿ your pen?（借） :: borrow',
  '- light（輕的） 英翻中 ^e3', '    - light :: adj. 輕的',
  '',
].join('\n');

interface Opened { ui: ReviewUi; session: Session; clock: { now: number }; log: () => string[]; speech: string[]; flush: () => Promise<void> }
async function open(t: TestContext, pick: Pick, options: { autoRead?: boolean; texts?: Record<string, string> } = {}): Promise<Opened> {
  const memory = createMemoryFiles(options.texts ?? { [NATURAL]: naturalText, [ENGLISH]: englishText });
  const clock = { now: START };
  const state = createState({ files: memory.files, device: 'PC-test', delay: 30, fillIds: false, now: () => clock.now, offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  const session = createSession({ state, pick, now: () => clock.now });
  await session.ready();
  const speech: string[] = [];
  let autoOn = options.autoRead ?? false;
  const ui = await renderReview({
    app: {} as App, session, close: () => {}, openLink: () => {}, materials: () => [],
    speech: { say: texts => { speech.push('say ' + texts.join(' / ')); }, stop: () => { speech.push('stop'); } },
    autoRead: { get: () => autoOn, set: on => { autoOn = on; } },
    pickedAt: performance.now(),
  });
  t.after(() => { ui.unmount(); session.close(); });
  return { ui, session, clock, speech, log: () => (memory.texts.get(PC) ?? '').split('\n').filter(Boolean), flush: () => state.flush() };
}
const lt = (session: Session): string | null => { const view = session.view(); return view.kind === 'card' ? view.card.card.lt : null; };
/** 翻面（Space），過 0.3 秒按數字鍵自評。 */
function revealAndRate(o: Opened, key: string): void {
  o.ui.key(' ');
  o.clock.now += RATE_DELAY;
  o.ui.key(key);
}

void test('F1 回看換卡的動畫還沒結束就按數字鍵：不改任何一張的評分，紀錄不多', async t => {
  const o = await open(t, { subject: '自然' });
  revealAndRate(o, '3');
  revealAndRate(o, '3');
  await o.ui.settle();
  assert.equal(o.session.view().kind, 'done');
  o.ui.key('ArrowLeft');
  await o.ui.settle();
  assert.equal(lt(o.session), 'a2');
  await o.flush();
  const before = o.log();
  assert.equal(before.length, 2);

  // → 往後：滑出還在跑（hold），這時按 1（沒印象）。
  o.ui.motion.hold = true;
  o.ui.key('ArrowRight');
  o.ui.key('1');
  o.ui.motion.release();
  o.ui.motion.hold = false;
  await o.ui.settle();
  await o.flush();
  assert.deepEqual(o.log(), before, '動畫期間的按鍵不算');
  assert.equal(o.session.view().kind, 'done');
  assert.deepEqual(o.session.history().map(entry => entry.rating), ['good', 'good']);

  // ← 往回看第二張時（滑出中）按 1：同樣不算；動畫結束後在回看的卡上按 1 才是改評分。
  o.ui.motion.hold = true;
  o.ui.key('ArrowLeft');
  o.ui.key('1');
  o.ui.motion.release();
  o.ui.motion.hold = false;
  await o.ui.settle();
  await o.flush();
  assert.deepEqual(o.log(), before);
  o.ui.key('1');
  await o.flush();
  assert.equal(o.log().length, 4, '動畫結束後按的照常改評分（取消加新的一筆）');
});

void test('F1 動畫期間的翻面、確認、沒印象也不算：目前這張留在原來的樣子', async t => {
  const o = await open(t, { subject: '自然' });
  revealAndRate(o, '3');
  await o.ui.settle();
  assert.equal(lt(o.session), 'a2');
  o.ui.motion.hold = true;
  o.ui.key('ArrowLeft');
  o.ui.key(' ');
  o.ui.click(o.ui.find('ec-stage')[0]);
  o.ui.motion.release();
  o.ui.motion.hold = false;
  await o.ui.settle();
  o.ui.key('ArrowRight');
  await o.ui.settle();
  const view = o.session.view();
  assert.ok(view.kind === 'card' && view.card.card.lt === 'a2' && !view.card.viewing);
  assert.equal(view.card.revealed, false, '滑出時按 Space 或點卡片沒有翻面');

  // 打字卡：滑出時在輸入框按 Enter、點「沒印象」都不算。先做完 z1，才有可以回看的卡。
  const e = await open(t, { subject: '英文' }, { texts: { [ENGLISH]: englishText, [PHONE]: ['e1', 'e2'].map(id => encodeEntry('2026-10-10T19:00:00.000+08:00', { lt: id, r: 'easy', v: '12345678' })).join('\n') + '\n' } });
  assert.equal(lt(e.session), 'z1');
  e.session.input('made up his mind'); e.ui.key('Enter', 'input');
  e.clock.now += RATE_DELAY;
  e.ui.key('3');
  await e.ui.settle();
  assert.equal(lt(e.session), 'z2');
  e.session.input('borow');
  e.ui.motion.hold = true;
  e.ui.key('ArrowLeft');
  e.ui.key('Enter', 'input');
  for (const button of e.ui.find('ec-skip')) e.ui.click(button);
  e.ui.motion.release();
  e.ui.motion.hold = false;
  await e.ui.settle();
  e.ui.key('ArrowRight');
  await e.ui.settle();
  const typed = e.session.view();
  assert.ok(typed.kind === 'card' && typed.card.typed);
  assert.deepEqual([typed.card.card.lt, typed.card.typed.step, typed.card.typed.first, typed.card.typed.input], ['z2', 1, null, 'borow']);
});

void test('F3 自動朗讀：英翻中的題目一出現就念，沒有被換卡的停止取消；回看與關掉開關時停', async t => {
  const o = await open(t, { subject: '英文' }, { autoRead: true, texts: { [ENGLISH]: englishText } });
  await o.ui.settle();
  const first = lt(o.session);
  assert.ok(first?.startsWith('e'));
  assert.equal(o.speech.at(-1)?.startsWith('say '), true, '第一張：最後一個動作是念題目，不是停止：' + o.speech.join(' | '));
  revealAndRate(o, '3');
  await o.ui.settle();
  assert.notEqual(lt(o.session), first);
  const said = o.speech.lastIndexOf('stop');
  assert.ok(o.speech.slice(said + 1).length === 1 && o.speech.at(-1)?.startsWith('say '), '換卡：先停掉上一張，再念新的題目：' + o.speech.join(' | '));
  o.ui.key('ArrowLeft');
  await o.ui.settle();
  assert.equal(o.speech.at(-1), 'stop', '回看時停');
  o.ui.key('ArrowRight');
  await o.ui.settle();
  assert.equal(o.speech.at(-1), 'stop', '回到目前這張不補播');
  const toggle = o.ui.find('ec-auto')[0].children.find(child => typeof child !== 'string' && child.type === 'input');
  assert.ok(toggle && typeof toggle !== 'string');
  (toggle.props.onChange as (e: unknown) => void)({ currentTarget: { checked: false } });
  await o.ui.settle();
  assert.equal(o.speech.at(-1), 'stop', '關掉開關時停');
});

void test('F7 第 2 步拼對：打勾與答案（寫在線上的那一個）；回看時照舊顯示第 1 步打的字與比對', async t => {
  const o = await open(t, { subject: '英文' }, { texts: { [ENGLISH]: englishText, [PHONE]: ['e1', 'e2', 'e3'].map(id => encodeEntry('2026-10-10T19:00:00.000+08:00', { lt: id, r: 'easy', v: '12345678' })).join('\n') + '\n' } });
  assert.equal(lt(o.session), 'z1');
  o.session.input('made up my mind'); o.ui.key('Enter', 'input');
  o.session.input('made his mind up'); o.ui.key('Enter', 'input');
  await o.ui.settle();
  const ok = o.ui.find('ec-ok');
  assert.equal(ok.length, 1, '第 2 步拼對有打勾');
  assert.deepEqual(o.ui.find('ec-word').map(o.ui.text), ['made his mind up']);
  assert.deepEqual(o.ui.find('ec-lab'), [], '沒有「你打的／正確拼字」');
  o.clock.now += RATE_DELAY;
  o.ui.key('2');
  await o.ui.settle();
  o.ui.key('ArrowLeft');
  await o.ui.settle();
  assert.deepEqual(o.ui.find('ec-ok'), [], '回看：第 1 步拼錯，不畫打勾');
  assert.deepEqual(o.ui.find('ec-lab').map(o.ui.text), ['你打的', '正確拼字']);
});

// Codex L2 F5：出處寫 `圖 2-13`、材料只有 `^fig2-13a`、`^fig2-13b` 時連到第一張子圖（D-094、syntax.md §2-5）。
void test('F5 出處的圖省略子圖字母：精確的錨點優先，沒有時依材料順序找第一張子圖；都沒有才打開第一份材料', () => {
  const blocks: Record<string, readonly string[]> = {
    'Essence Cards/材料/甲.md': ['p43', 'fig2-12', 'fig2-13b', 'fig2-13a', 'fig2-13-note'],
    'Essence Cards/材料/乙.md': ['fig2-14', 'fig2-15b'],
    'Essence Cards/材料/丙.md': ['fig2-15'],
  };
  const app = {
    metadataCache: {
      getFirstLinkpathDest: (link: string) => { const path = `Essence Cards/材料/${link}.md`; return path in blocks ? { path } : null; },
      getFileCache: (file: { path: string }) => ({ blocks: Object.fromEntries(blocks[file.path].map(id => [id, {}])) }),
    },
  } as unknown as App;
  const materials = ['[[甲]]', '[[乙]]', '[[丙]]'];
  const resolve = (text: string) => { const [item] = sourceLinks([text]); return resolveSource(app, NATURAL, materials, item.link); };
  assert.equal(resolve('圖 2-13'), 'Essence Cards/材料/甲.md#^fig2-13a', '省略字母：第一張子圖（照字母，不照材料裡的先後）');
  assert.equal(resolve('圖 2-13 A'), 'Essence Cards/材料/甲.md#^fig2-13a');
  assert.equal(resolve('圖 2-13 B'), 'Essence Cards/材料/甲.md#^fig2-13b');
  assert.equal(resolve('圖 2-14'), 'Essence Cards/材料/乙.md#^fig2-14', '不同材料');
  assert.equal(resolve('圖 2-15'), 'Essence Cards/材料/丙.md#^fig2-15', '精確的錨點優先於前一份材料的子圖');
  assert.equal(resolve('圖 2-16'), 'Essence Cards/材料/甲.md', '完全不存在：打開第一份材料');
  assert.equal(resolve('圖 2-1'), 'Essence Cards/材料/甲.md', '2-1 不會對到 2-12 或 2-13a');
  assert.equal(resolve('p.43'), 'Essence Cards/材料/甲.md#^p43');
});

// D-145：在空格裡打字、打字卡不畫答案格、「也可以」、一行一個喇叭、照打的比對只在打錯時畫、沒有開關時 ✕ 不偏。
interface Tree { type: string; props: Record<string, unknown>; children: (Tree | string)[] }
const all = (node: Tree | string): Tree[] => typeof node === 'string' ? [] : [node, ...node.children.flatMap(all)];
const ofType = (ui: ReviewUi, type: string): Tree[] => all(ui.root()).filter(node => node.type === type);
const speakers = (ui: ReviewUi): unknown[] => ui.find('ec-say').map(button => button.props['aria-label']);
const reviewed = (ids: readonly string[]): string => ids.map(id => encodeEntry('2026-10-10T19:00:00.000+08:00', { lt: id, r: 'easy', v: '12345678' })).join('\n') + '\n';

void test('D-145 打字卡拼對：在空格裡打，翻面後不畫答案格，另一個答案寫成「也可以」，每一行一個喇叭', async t => {
  const o = await open(t, { subject: '英文' }, { texts: { [ENGLISH]: englishText, [PHONE]: reviewed(['e1', 'e2', 'e3']) } });
  assert.equal(lt(o.session), 'z1');
  assert.equal(ofType(o.ui, 'portal').length, 1, '輸入框放進題目的空格');
  assert.equal(o.ui.find('ec-blank-input').length, 1);
  assert.deepEqual(o.ui.find('ec-inrow'), [], '題目下面沒有輸入框');
  assert.deepEqual(speakers(o.ui), [], '中翻英在答案出現前沒有喇叭');
  const inputRef = o.ui.find('ec-blank-input')[0].props.ref as { current: { focus: () => void } };
  let focused = 0;
  inputRef.current.focus = () => { focused++; };
  o.ui.click(o.ui.find('ec-stage')[0]);
  assert.equal(focused, 1, '點卡片任何地方都叫出鍵盤');
  o.session.input('made his mind up'); o.ui.key('Enter', 'input');
  await o.ui.settle();
  assert.deepEqual(o.ui.find('ec-blank-input'), [], '三步走完，空格換回線上的答案');
  assert.equal(ofType(o.ui, 'markdown')[0].props.revealed, true);
  assert.deepEqual(o.ui.find('ec-a'), [], '打字卡不畫答案格');
  assert.deepEqual(o.ui.find('ec-also').map(o.ui.text), ['也可以：made up his mind'], '只列沒打的那一個，和「也可以：」同一行');
  assert.deepEqual(speakers(o.ui), ['朗讀 He has already made his mind up to study abroad.', '朗讀 made his mind up', '朗讀 made up his mind']);
});

void test('D-145 第 3 步在空格裡照打：線上先不寫答案、提示照著打，比對只在打錯字母時畫，走完才寫上答案', async t => {
  const o = await open(t, { subject: '英文' }, { texts: { [ENGLISH]: englishText, [PHONE]: reviewed(['e1', 'e2', 'e3', 'z1']) } });
  assert.equal(lt(o.session), 'z2');
  o.session.input('borow'); o.ui.key('Enter', 'input');
  await o.ui.settle();
  const view = o.session.view();
  assert.ok(view.kind === 'card' && view.card.typed?.step === 3, '原形就是答案：跳過第 2 步');
  assert.equal(o.ui.find('ec-blank-input').length, 1, '第 3 步也在空格裡打');
  assert.equal(ofType(o.ui, 'markdown')[0].props.revealed, false, '照打時線上先不寫答案');
  assert.deepEqual(o.ui.find('ec-hint').map(o.ui.text), ['照著打一次']);
  assert.deepEqual(o.ui.find('ec-lab').map(o.ui.text), ['你打的', '正確拼字']);
  assert.deepEqual(o.ui.find('ec-a'), []);
  assert.deepEqual(o.ui.find('ec-also'), [], '只有一個答案時沒有「也可以」');
  assert.deepEqual(speakers(o.ui), ['朗讀 Can I borrow your pen?', '朗讀 borrow']);
  o.session.input('borr');
  await o.ui.settle();
  assert.deepEqual(o.ui.find('ec-live'), [], '打的都對：不再顯示一次');
  o.session.input('borx');
  await o.ui.settle();
  assert.equal(o.ui.find('ec-live').length, 1, '打錯字母時才畫比對');
  o.session.input('borrow'); o.ui.key('Enter', 'input');
  await o.ui.settle();
  assert.deepEqual(o.ui.find('ec-blank-input'), []);
  assert.equal(ofType(o.ui, 'markdown')[0].props.revealed, true);
});

void test('D-145 打字中「沒印象」「確認」在卡片裡（題目下面），不在最底下那一排；沒打字按「沒印象」不畫「你打的」', async t => {
  const o = await open(t, { subject: '英文' }, { texts: { [ENGLISH]: englishText, [PHONE]: reviewed(['e1', 'e2', 'e3', 'z1']) } });
  assert.equal(lt(o.session), 'z2');
  assert.deepEqual(o.ui.find('ec-actions'), [], '打字中沒有最底下那一排');
  const card = o.ui.find('ec-card')[0];
  assert.deepEqual(all(card).filter(node => node.props.className === 'ec-typed-actions').length, 1, '在卡片裡');
  assert.deepEqual(o.ui.find('ec-show').map(o.ui.text), ['沒印象', '確認']);
  o.ui.click(o.ui.find('ec-skip')[0]);
  await o.ui.settle();
  assert.deepEqual(o.ui.find('ec-lab').map(o.ui.text), ['正確拼字'], '沒打字：只有「正確拼字」');
  assert.deepEqual(o.ui.find('ec-show').map(o.ui.text), ['確認'], '第 3 步只有確認，也在卡片裡');
  o.session.input('borrow'); o.ui.key('Enter', 'input');
  await o.ui.settle();
  assert.equal(o.ui.find('ec-actions').length, 1, '三步走完：自評在最底下');
  assert.deepEqual(o.ui.find('ec-typed-actions'), []);
});

void test('D-145 背面補充的名稱自己一行，喇叭念那一行的英文（重複的只念一次）', async t => {
  const deck = ['---', '科目: 英文', '單元: L2', '---', '- go 中翻英 ^g1', '    - 我昨天去了公園。I ＿＿ to the park yesterday. :: went', '    - 記憶錨點：go 的過去式不規則：go → went → gone', ''].join('\n');
  const o = await open(t, { subject: '英文' }, { texts: { [ENGLISH]: deck } });
  o.session.input('went'); o.ui.key('Enter', 'input');
  await o.ui.settle();
  assert.deepEqual(o.ui.find('ec-ex-label').map(o.ui.text), ['記憶錨點']);
  assert.deepEqual(ofType(o.ui, 'markdown').map(node => node.props.text).at(-1), 'go 的過去式不規則：go → went → gone');
  assert.deepEqual(speakers(o.ui), ['朗讀 I went to the park yesterday.', '朗讀 went', '朗讀 go、went、gone']);
});

void test('D-145 第 3 步照打的對象是「正確拼字」那一行（最接近的答案）：照打它不標錯，走完線上寫它', async t => {
  const o = await open(t, { subject: '英文' }, { texts: { [ENGLISH]: englishText, [PHONE]: reviewed(['e1', 'e2', 'e3']) } });
  assert.equal(lt(o.session), 'z1');
  o.session.input('made his mind upp'); o.ui.key('Enter', 'input');
  o.session.input('made his mind upp'); o.ui.key('Enter', 'input');
  await o.ui.settle();
  let view = o.session.view();
  assert.ok(view.kind === 'card' && view.card.typed?.step === 3);
  assert.equal(view.card.typed.copy, 'made his mind up');
  assert.deepEqual(o.ui.find('ec-also').map(o.ui.text), ['也可以：made up his mind']);
  assert.equal(speakers(o.ui)[1], '朗讀 made his mind up', '「正確拼字」那一行的喇叭念它');
  o.session.input('made his mind up');
  await o.ui.settle();
  assert.deepEqual(o.ui.find('ec-live'), []);
  o.ui.key('Enter', 'input');
  await o.ui.settle();
  view = o.session.view();
  assert.ok(view.kind === 'card' && view.card.typed?.finished);
  assert.equal(view.card.typed.answer, 'made his mind up');
});

void test('D-145 題目沒有 ＿＿ 的打字卡：輸入框照舊在題目下面', async t => {
  const deck = ['---', '科目: 英文', '單元: L1', '---', '- borrow 中翻英 ^z9', '    - 借入、向別人借（v.） :: borrow', ''].join('\n');
  const o = await open(t, { subject: '英文' }, { texts: { [ENGLISH]: deck } });
  assert.equal(lt(o.session), 'z9');
  assert.deepEqual(ofType(o.ui, 'portal'), []);
  assert.deepEqual(o.ui.find('ec-blank-input'), []);
  assert.equal(o.ui.find('ec-inrow').length, 1);
  assert.equal(o.ui.find('ec-input')[0].props.placeholder, '輸入英文');
});

void test('D-145 自然卡（沒有自動朗讀開關）的上方列和英文卡一樣是四格，✕ 在最後一格', async t => {
  const o = await open(t, { subject: '自然' });
  const top = o.ui.find('ec-top')[0].children.filter((child): child is Tree => typeof child !== 'string');
  assert.equal(top.length, 4);
  assert.equal(top[3].props['aria-label'], '結束複習');
  o.ui.key(' ');
  assert.equal(o.ui.find('ec-a').length, 1, '一般的問答卡照舊畫答案格');
});

// Codex L2 F4：切走超過 60 秒回來，目前這張從頭開始，畫面當成換了一張（捲回最上面、收起出處、先停再念題目）。
void test('F4 切走超過 60 秒回來：卡回到正面、捲回最上面，先停掉再重念英翻中的題目', async t => {
  const o = await open(t, { subject: '英文' }, { autoRead: true, texts: { [ENGLISH]: englishText } });
  await o.ui.settle();
  o.ui.key(' ');
  const stage = o.ui.find('ec-stage')[0].props.ref as { current: { scrollTop: number } };
  stage.current.scrollTop = 120;
  const before = o.speech.length;
  o.session.pause();
  o.clock.now += AWAY_LIMIT + 1;
  assert.equal(o.session.resume(), true);
  await o.ui.settle();
  const view = o.session.view();
  assert.ok(view.kind === 'card' && !view.card.revealed);
  assert.equal(stage.current.scrollTop, 0);
  assert.deepEqual(o.speech.slice(before).map(call => call.split(' ')[0]), ['stop', 'say']);
});
