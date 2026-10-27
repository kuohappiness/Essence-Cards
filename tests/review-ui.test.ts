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
