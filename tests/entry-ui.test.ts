import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { act } from 'react';
import type { App } from 'obsidian';
import { encodeEntry } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { State, StudyPick } from '../src/state/index.ts';
import type { EntryHandle, EntryOptions } from '../src/ui/entry-host.tsx';
import { installDom, loadUi } from './helpers/dom.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 入口與目錄（tasks/entry-and-catalog.md §1、§2、§3、§8、§11）：真的 React 加 happy-dom、真的 createState。版面與實際焦點在開發命令驗。

const window = installDom();
const { openEntry } = await loadUi<{ openEntry: (options: EntryOptions) => EntryHandle }>('src/ui/entry-host.tsx');

const START = Date.parse('2026-10-24T19:00:00.000+08:00');
const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const head = (term: string, subject: string, unit: string, extra = ''): string => `---\n年級學期: ${term}\n科目: ${subject}\n單元: "${unit}"\n${extra}---\n`;
const targets = (...ids: string[]): string => ids.map(id => `- 目標 ${id} ^${id}\n    - ${id} 的題目 :: 答\n`).join('');

interface Screen extends MemoryFiles {
  state: State;
  clock: { now: number };
  handle: EntryHandle;
  starts: StudyPick[];
  notes: [string, number | undefined][];
  notices: string[];
  settings: () => number;
  covered: { value: boolean };
  storage: Map<string, unknown>;
  closed: () => boolean;
  /** 放行 Setup.hold 擋住的讀取。 */
  release: () => void;
  /** 打開的畫面裡符合 CSS 選擇器的元素。 */
  all: (selector: string) => HTMLElement[];
  text: () => string;
  /** 文字完全相同的按鈕。 */
  button: (name: string) => HTMLButtonElement;
  click: (element: Element) => Promise<void>;
  settle: () => Promise<void>;
}
interface Setup { screen?: 'entry' | 'catalog'; reminders?: boolean; ready?: boolean; hold?: string; state?: () => State | null; storage?: Record<string, unknown>; desktop?: boolean }

async function open(t: TestContext, texts: Record<string, string>, setup: Setup = {}): Promise<Screen> {
  const memory = createMemoryFiles(texts);
  const held = setup.hold ? memory.holdRead(setup.hold) : null;
  const clock = { now: START };
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: setup.desktop === true, stuckAfter: 20, now: () => clock.now, offset: () => 480, onError() {} });
  t.after(() => { held?.release(); return state.close(); });
  if (setup.ready !== false) await state.ready();
  const starts: StudyPick[] = [], notes: [string, number | undefined][] = [], notices: string[] = [];
  let settings = 0, closed = false;
  const covered = { value: false };
  const storage = new Map<string, unknown>(Object.entries(setup.storage ?? {}));
  const app = { loadLocalStorage: (key: string) => storage.get(key) ?? null, saveLocalStorage: (key: string, value: unknown) => { storage.set(key, value); } } as unknown as App;
  let handle!: EntryHandle;
  await act(async () => {
    handle = openEntry({
      app, state: setup.state ?? (() => state), screen: setup.screen, reminders: setup.reminders ?? false, covered: () => covered.value,
      start: pick => { starts.push(pick); }, openNote: (path, line) => { notes.push([path, line]); }, openSettings: () => { settings++; }, notify: message => { notices.push(message); },
      // 只有電腦傳（main.ts 看 Platform.isDesktopApp）；提示的字在 deck-status-wiring 測。
      setDeckStatus: setup.desktop ? (path, value) => state.setDeckStatus(path, value, null).then(result => result.kind === 'done' ? null : '受阻：' + result.kind) : undefined,
      onClose: () => { closed = true; },
    });
    await Promise.resolve();
  });
  t.after(async () => { await act(async () => { handle.close(); await Promise.resolve(); }); });
  const root = (): Element => {
    const found = document.querySelector('.ec-fullscreen');
    assert.ok(found, '入口開著');
    return found;
  };
  const all = (selector: string): HTMLElement[] => Array.from(root().querySelectorAll<HTMLElement>(selector));
  const settle = async (): Promise<void> => { await act(async () => { await wait(10); }); };
  return {
    ...memory, state, clock, handle, release: () => { held?.release(); }, starts, notes, notices, settings: () => settings, covered, storage, closed: () => closed, all, settle,
    text: () => root().textContent ?? '',
    button(name) {
      const found = all('button').find(button => button.textContent === name || button.getAttribute('aria-label') === name);
      assert.ok(found, '找不到按鈕「' + name + '」：' + all('button').map(button => button.textContent).join('、'));
      return found as HTMLButtonElement;
    },
    click: async element => { await act(async () => { (element as HTMLElement).click(); await Promise.resolve(); }); },
  };
}
const key = async (target: Element, name: string): Promise<void> => {
  await act(async () => { target.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }) as unknown as Event); await Promise.resolve(); });
};

const THREE = {
  'Essence Cards/自然 2-1.md': head('國二上', '自然', '2-1 水溶液') + targets('a', 'b'),
  'Essence Cards/英文 L1.md': head('國二上', '英文', 'L1') + targets('c'),
  'Essence Cards/攝影.md': '---\n分類: [攝影]\n---\n' + targets('d'),
};

void test('§2 入口：今日複習、一科一列（順序照 progress）、N 分鐘、目錄；第一批不顯示的都沒有', async t => {
  const s = await open(t, THREE);
  assert.match(s.text(), /今日複習0\/4/);
  assert.deepEqual(s.all('.ec-sb .ec-en-name').map(each => each.textContent), ['自然', '英文', '其他'], '其他排最後（D-133）');
  assert.deepEqual(s.all('.ec-sb .ec-en-n').map(each => each.textContent), ['0/2', '0/1', '0/1']);
  assert.deepEqual(s.all('.ec-sb-btn').map(each => each.textContent), ['1 分鐘', '1 分鐘', '1 分鐘']);
  for (const word of ['濾網', '已濾掉', '抽測', '距離考試', '再複習一些']) assert.ok(!s.text().includes(word), word);
  assert.ok(s.text().includes('Essence Cards'), '字標');
  await s.click(s.button('開始自然'));
  assert.deepEqual(s.starts, [{ subject: '自然' }]);
});

void test('§2 做完：數字與線變色、按鈕換「完成」不能按；全部做完時今日複習也變色，並出現再複習一些；more 空的不出現', async t => {
  const s = await open(t, { 'Essence Cards/a.md': head('國二上', '自然', '2-1') + targets('a') });
  s.state.answer({ lt: 'a', r: 'good', v: 'x' });
  s.handle.refresh();
  await s.settle();
  const row = s.all('.ec-sb')[0];
  assert.ok(row.classList.contains('is-done'));
  const done = s.button('完成');
  assert.equal(done.disabled, true);
  assert.equal(s.all('.ec-en-today.is-done').length, 1);
  assert.ok(!s.text().includes('再複習一些'), 'more 是空的');
});

void test('§2 全部做完而且 more 有東西：出現再複習一些，按了開 more', async t => {
  const many = Array.from({ length: 130 }, (_, i) => 'k' + String(i));
  const s = await open(t, { 'Essence Cards/a.md': head('國二上', '自然', '2-1') + targets(...many) });
  const { share } = s.state.today();
  assert.ok(share.length < many.length);
  for (const item of share) { s.clock.now += 1000; s.state.answer({ lt: item.lt, r: 'good', v: 'x' }); }
  s.handle.refresh();
  await s.settle();
  await s.click(s.button('再複習一些'));
  assert.deepEqual(s.starts, [{ more: true }]);
});

void test('§2 邊界：今天沒有卡、沒有卡組都寫同一句，目錄照常；還在讀、state 還沒建好都寫「正在讀取卡組…」，按鈕不丟錯，讀完自動換', async t => {
  const empty = await open(t, {});
  assert.match(empty.text(), /今天沒有要複習的卡/);
  assert.ok(empty.button('目錄'));
  await act(async () => { empty.handle.close(); await Promise.resolve(); });
  // state 還沒建好。
  const none = await open(t, {}, { state: () => null });
  assert.match(none.text(), /正在讀取卡組…/);
  await none.click(none.button('目錄'));
  assert.match(none.text(), /正在讀取卡組…/);
});

void test('§2 還在讀：讀完自動換成科目列，不用重開', async t => {
  const memory = { 'Essence Cards/a.md': head('國二上', '自然', '2-1') + targets('a') };
  const s = await open(t, memory, { ready: false, hold: 'Essence Cards/a.md' });
  assert.match(s.text(), /正在讀取卡組…/);
  s.release();
  await s.state.ready();
  await s.settle();
  assert.deepEqual(s.all('.ec-sb .ec-en-name').map(each => each.textContent), ['自然']);
});

void test('§1 ✕ 與 Esc 關掉；設定圖示交給主機；目錄的 ✕、返回、Esc 回入口', async t => {
  const s = await open(t, THREE);
  await s.click(s.button('設定'));
  assert.equal(s.settings(), 1);
  await s.click(s.button('目錄'));
  assert.ok(s.all('.ec-en-title').length, '目錄');
  await s.click(s.button('返回'));
  assert.equal(s.all('.ec-en-title').length, 0);
  await s.click(s.button('目錄'));
  await s.click(s.button('關閉目錄'));
  assert.equal(s.all('.ec-en-title').length, 0);
  await s.click(s.button('目錄'));
  await key(s.all('.ec-en-top')[0], 'Escape');
  assert.equal(s.all('.ec-en-title').length, 0, 'Esc 回入口，還沒關');
  assert.equal(s.closed(), false);
  await key(s.all('.ec-en-top')[0], 'Escape');
  assert.equal(s.closed(), true);
  assert.equal(document.querySelector('.ec-fullscreen'), null);
});

void test('§1 ✕ 關掉：焦點還原到打開前的地方；按鈕消失時焦點回到畫面上，不掉到 body（R6）', async t => {
  const outside = document.createElement('button');
  document.body.append(outside);
  outside.focus();
  const s = await open(t, THREE);
  assert.ok(document.activeElement?.closest('.ec-fullscreen'), '打開時焦點在畫面裡');
  const go = s.button('目錄');
  go.focus();
  await s.click(go);
  assert.notEqual(document.activeElement, document.body);
  assert.ok(document.activeElement?.closest('.ec-fullscreen'));
  // 複習蓋在上面時不搶焦點。
  s.covered.value = true;
  outside.focus();
  s.handle.refresh();
  await s.settle();
  assert.equal(document.activeElement, outside);
  s.covered.value = false;
  await s.click(s.button('關閉目錄'));
  outside.focus();
  await s.click(s.button('關閉'));
  assert.equal(document.activeElement, outside);
  outside.remove();
});

const CATALOG = {
  'Essence Cards/小四 2-1.md': head('小四上', '自然', '2-1') + '- 目標 x ^x\n    - 出處：小五上 2-1 p.15\n    - x 的題目 :: 答\n',
  'Essence Cards/小五 2-1 課本.md': head('小五上', '自然', '2-1 水溶液', '材料: "[[教材]]"\n') + targets('a', 'b'),
  'Essence Cards/小五 2-1 習作.md': head('小五上', '自然', '2-1 水溶液', '狀態: 草稿\n') + targets('c'),
  'Essence Cards/小五 2-2.md': head('小五上', '自然', '2-2', '狀態: 草稿\n') + targets('d'),
  'Essence Cards/小五 2-3.md': head('小五上', '自然', '2-3', '狀態: 暫停\n') + targets('e'),
  'Essence Cards/小五 L1.md': head('小五上', '英文', 'L1') + targets('f') + '- 寫錯的目標\n    - 問 ::\n',
  'Essence Cards/攝影.md': targets('g'),
};

void test('§3 結構：學期可收合、最新的展開、其他收著；預設「全部」、單元收起；顏色與數字；草稿不顯示數字，暫停是 0，都標出來', async t => {
  const s = await open(t, CATALOG, { screen: 'catalog' });
  assert.deepEqual(s.all('.ec-tr-sem').map(each => [each.textContent, each.getAttribute('aria-expanded')]), [['小四上', 'false'], ['小五上', 'true'], ['其他', 'false']]);
  assert.equal(s.button('全部').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(s.all('.ec-tr-subject').map(each => each.textContent), ['自然', '英文']);
  const rows = s.all('.ec-tr-u').map(row => [row.querySelector('.ec-tr-name')?.textContent, row.querySelector('.ec-tr-due')?.textContent ?? null, row.querySelector('.ec-tr-due')?.getAttribute('data-m') ?? null]);
  assert.deepEqual(rows, [['2-1 水溶液', '3', 'new'], ['2-2草稿', null, null], ['2-3暫停', '0', 'new'], ['L1', '1', 'new']]);
  assert.equal(s.all('.ec-u-btn').length, 0, '單元都收起');
  // 沒有圖例、沒有管理（§3）；考試範圍在 exam-ui.test.ts。
  for (const word of ['管理', '圖例']) assert.ok(!s.text().includes(word), word);
});

void test('§3 學期收合存 saveLocalStorage，下次照存的', async t => {
  const s = await open(t, CATALOG, { screen: 'catalog' });
  await s.click(s.all('.ec-tr-sem')[0]);
  await s.click(s.all('.ec-tr-sem')[1]);
  assert.deepEqual(s.storage.get('essence-cards-catalog-terms'), { 小四上: true, 小五上: false });
  const again = await open(t, CATALOG, { screen: 'catalog', storage: Object.fromEntries(s.storage) });
  assert.deepEqual(again.all('.ec-tr-sem').map(each => each.getAttribute('aria-expanded')), ['true', 'false', 'false']);
});

void test('§3 點開：當日卡、全部卡按鈕；目標與小圓點；跨單元的小字；其他篇列出來、點了開筆記；目標不能點', async t => {
  const s = await open(t, CATALOG, { screen: 'catalog' });
  await s.click(s.all('.ec-tr-name')[0]);
  assert.deepEqual(s.all('.ec-u-btn').map(each => each.textContent), ['當日卡 3', '全部卡 3']);
  assert.deepEqual(s.all('.ec-tr-t').map(each => each.textContent), ['目標 a', '目標 b', '目標 x來自小四上 2-1']);
  assert.deepEqual(s.all('.ec-tr-t .ec-tr-dot').map(each => each.getAttribute('data-m')), ['new', 'new', 'new']);
  assert.equal(s.all('.ec-tr-t button').length, 0, '目標不能點');
  assert.deepEqual(s.all('.ec-tr-deck').map(each => each.textContent), ['小五 2-1 習作草稿']);
  await s.click(s.all('.ec-tr-deck')[0]);
  assert.deepEqual(s.notes, [['Essence Cards/小五 2-1 習作.md', undefined]]);
  await s.click(s.all('.ec-u-btn')[0]);
  await s.click(s.all('.ec-u-btn')[1]);
  const key = JSON.stringify(['小五上', '自然', '2-1']);
  assert.deepEqual(s.starts[0], { unit: key });
  assert.equal((s.starts[1] as { unit: string }).unit, key);
  assert.equal(typeof (s.starts[1] as { since: number }).since, 'number');
});

void test('§3 草稿、暫停的單元：點了打開筆記，有好幾篇時展開列出全部；寫錯的提示點了到第一個問題的行', async t => {
  const two = { ...CATALOG, 'Essence Cards/小五 2-2 習作.md': head('小五上', '自然', '2-2', '狀態: 草稿\n') + targets('h') };
  const s = await open(t, two, { screen: 'catalog' });
  const names = s.all('.ec-tr-name');
  await s.click(names[1]);
  assert.deepEqual(s.notes.at(-1), ['Essence Cards/小五 2-2 習作.md', undefined], '路徑第一篇');
  await s.click(names[2]);
  assert.deepEqual(s.notes.at(-1), ['Essence Cards/小五 2-3.md', undefined]);
  await s.click(s.all('.ec-tr-exp')[1]);
  assert.deepEqual(s.all('.ec-tr-deck').map(each => each.textContent), ['小五 2-2 習作草稿', '小五 2-2草稿']);
  assert.equal(s.all('.ec-u-btn').length, 0, '沒有練習按鈕');
  // 只有一篇、沒有問題的不能展開。
  assert.equal((s.all('.ec-tr-exp')[2] as HTMLButtonElement).disabled, true);
  await s.click(s.all('.ec-tr-name')[3]);
  const problem = s.all('.ec-tr-problem');
  assert.deepEqual(problem.map(each => each.textContent), ['1 個學習目標寫法有問題']);
  await s.click(problem[0]);
  assert.deepEqual(s.notes.at(-1), ['Essence Cards/小五 L1.md', 7]);
});

void test('§3 N 為 0 的按鈕不能按；「當日」只列當日卡 N > 0 的，全部展開；都沒有時寫今天沒有要複習的卡', async t => {
  const s = await open(t, { 'Essence Cards/a.md': head('國二上', '自然', '2-1') + targets('a'), 'Essence Cards/b.md': head('國二上', '自然', '2-2') + targets('b'), 'Essence Cards/小五.md': head('小五上', '自然', '1-1') + targets('c') }, { screen: 'catalog' });
  s.state.answer({ lt: 'a', r: 'good', v: 'x' });
  s.handle.refresh();
  await s.settle();
  await s.click(s.all('.ec-tr-name')[0]);
  assert.equal((s.button('當日卡 0')).disabled, true);
  assert.equal((s.button('全部卡 1')).disabled, false);
  await s.click(s.button('當日'));
  assert.deepEqual(s.all('.ec-tr-name').map(each => each.textContent), ['1-1', '2-2'], '收著的學期也展開');
  s.state.answer({ lt: 'b', r: 'good', v: 'x' });
  s.clock.now += 1000;
  s.state.answer({ lt: 'c', r: 'good', v: 'x' });
  s.handle.refresh();
  await s.settle();
  assert.match(s.text(), /今天沒有要複習的卡/);
});

void test('§1 回到目錄時原本展開的單元還是展開；離開目錄再進來全部收起', async t => {
  const s = await open(t, CATALOG, { screen: 'catalog' });
  await s.click(s.all('.ec-tr-name')[0]);
  s.covered.value = true;
  s.handle.refresh();
  await s.settle();
  s.covered.value = false;
  s.handle.refresh();
  await s.settle();
  assert.equal(s.all('.ec-u-btn').length, 2, '做完回來還是展開');
  await s.click(s.button('返回'));
  await s.click(s.button('目錄'));
  assert.equal(s.all('.ec-u-btn').length, 0);
});

void test('§8 提醒：只有電腦才有這一區；unread 從 2 變 0，區塊消失，不用重開；點開列出路徑', async t => {
  const decks = { 'Essence Cards/a.md': targets('a'), 'Essence Cards/b.md': targets('b') };
  const phone = await open(t, decks, { reminders: false });
  phone.failing.add('Essence Cards/a.md');
  phone.notify('Essence Cards/a.md');
  await phone.settle();
  assert.deepEqual(phone.state.unread(), ['Essence Cards/a.md']);
  assert.equal(phone.all('.ec-rem').length, 0, '手機沒有');
  await act(async () => { phone.handle.close(); await Promise.resolve(); });

  const s = await open(t, decks, { reminders: true });
  assert.equal(s.all('.ec-rem').length, 0, '沒有提醒時整區消失');
  s.failing.add('Essence Cards/a.md');
  s.failing.add('Essence Cards/b.md');
  s.notify('Essence Cards/a.md', 'Essence Cards/b.md');
  await s.settle();
  assert.match(s.text(), /有 2 個檔案暫時讀不到/);
  await s.click(s.all('.ec-rem-go')[0]);
  assert.deepEqual(s.all('.ec-rem-paths li').map(each => each.textContent), ['Essence Cards/a.md', 'Essence Cards/b.md']);
  s.failing.clear();
  await act(async () => { await wait(1100); });
  assert.deepEqual(s.state.unread(), []);
  assert.equal(s.all('.ec-rem').length, 0);
});

void test('§8 有內容需要新版：電腦寫在提醒一區', async t => {
  const s = await open(t, { 'Essence Cards/新.md': '---\n需要版本: 9.0.0\n---\n' + targets('n') }, { reminders: true });
  assert.match(s.text(), /有內容需要新版才讀得懂，請更新外掛/);
});

void test('§11 入口開著時讀到別台裝置的紀錄，數字更新；改卡組筆記，目錄更新；切到背景跨過清晨 4 點回來，是新一天的份', async t => {
  const s = await open(t, { 'Essence Cards/a.md': head('國二上', '自然', '2-1') + targets('a', 'b') });
  assert.deepEqual(s.all('.ec-sb .ec-en-n').map(each => each.textContent), ['0/2']);
  s.write(PHONE, encodeEntry('2026-10-24T18:59:00.000+08:00', { lt: 'a', r: 'good', v: 'x' }) + '\n');
  await s.settle();
  assert.deepEqual(s.all('.ec-sb .ec-en-n').map(each => each.textContent), ['1/2']);
  await s.click(s.button('目錄'));
  s.write('Essence Cards/c.md', head('國二上', '自然', '2-5') + targets('c'));
  await s.settle();
  assert.deepEqual(s.all('.ec-tr-name').map(each => each.textContent), ['2-1', '2-5']);
  await s.click(s.button('返回'));
  // 隔天：新的一天的份，a、b 都不一定到期，c 是新卡；重點是總數不再是昨天的。
  s.clock.now += 86_400_000;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  await act(async () => { document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event); await Promise.resolve(); });
  const today = s.state.progress();
  assert.deepEqual(s.all('.ec-sb .ec-en-n').map(each => each.textContent), [today.done + '/' + today.total]);
  assert.equal(today.done, 0, '昨天做的不算今天的');
});

// ── 目錄的單篇入口（D-189 第 3 點、tasks/quiz-practice.md §4）──

const WORDS = 'Essence Cards/英文/L3 單字.md', REST = 'Essence Cards/英文/L3 其他.md';
const L3 = { [WORDS]: head('國二上', '英文', 'L3') + targets('a', 'b', 'c'), [REST]: head('國二上', '英文', 'L3') + targets('d') };
const rows = (s: Screen): (string | null)[] => s.all('.ec-tr-pc').map(each => each.textContent);

void test('§4 單元有兩篇啟用：單元的全部卡底下每篇一列，數字和那篇筆記的全部卡相同；按下去只練那一篇，不跳提醒', async t => {
  const s = await open(t, L3, { screen: 'catalog' });
  assert.deepEqual(rows(s), [], '還沒展開');
  await s.click(s.all('.ec-tr-name')[0]);
  assert.deepEqual(s.all('.ec-tr-ub .ec-u-btn').map(each => each.textContent), ['當日卡 4', '全部卡 4'], '單元的按鈕不變');
  assert.deepEqual(rows(s), ['L3 其他全部卡 1', 'L3 單字全部卡 3']);
  assert.equal(s.state.deckTargets(WORDS).length, 3);
  assert.equal(s.all('.ec-tr-open')[0].firstElementChild?.className, 'ec-tr-pc', '緊接在單元的全部卡底下');
  await s.click(s.button('全部卡 3'));
  assert.equal(s.starts.length, 1, '直接開始，沒有多一步');
  const pick = s.starts[0] as { deck: string; since: number };
  assert.deepEqual(Object.keys(pick).sort(), ['deck', 'since']);
  assert.equal(pick.deck, WORDS);
  assert.equal(typeof pick.since, 'number');
  assert.deepEqual(s.state.scope({ deck: WORDS, since: START }), { done: 0, total: 3 });
  const next = s.state.next({ deck: WORDS, since: START });
  assert.equal(next.kind === 'card' && next.card.deck, WORDS);
  await s.click(s.all('.ec-tr-pc .ec-tr-deck')[0]);
  assert.deepEqual(s.notes, [[REST, undefined]], '篇名點了打開那篇筆記');
});

void test('§4 只有一篇啟用：沒有這幾列，單元的全部卡就是那一篇；草稿與暫停的篇照舊是筆記連結', async t => {
  const s = await open(t, { [WORDS]: L3[WORDS], [REST]: head('國二上', '英文', 'L3', '狀態: 暫停\n') + targets('d'), 'Essence Cards/英文/L3 草稿.md': head('國二上', '英文', 'L3', '狀態: 草稿\n') + targets('e') }, { screen: 'catalog' });
  await s.click(s.all('.ec-tr-name')[0]);
  assert.deepEqual(s.all('.ec-u-btn').map(each => each.textContent), ['當日卡 3', '全部卡 3']);
  assert.deepEqual(rows(s), []);
  assert.deepEqual(s.all('.ec-tr-deck').map(each => each.textContent), ['L3 其他暫停', 'L3 草稿草稿']);
});

void test('§4 兩篇啟用、一篇草稿：草稿不佔一列全部卡；沒有目標的篇 0 不能按', async t => {
  const s = await open(t, { ...L3, 'Essence Cards/英文/L3 草稿.md': head('國二上', '英文', 'L3', '狀態: 草稿\n') + targets('e'), 'Essence Cards/英文/L3 空的.md': head('國二上', '英文', 'L3') }, { screen: 'catalog' });
  await s.click(s.all('.ec-tr-name')[0]);
  assert.deepEqual(rows(s), ['L3 其他全部卡 1', 'L3 單字全部卡 3', 'L3 空的全部卡 0']);
  assert.equal(s.button('全部卡 0').disabled, true);
  assert.equal(s.button('全部卡 1').disabled, false);
  assert.deepEqual(s.all('.ec-tr-open > .ec-tr-deck').map(each => each.textContent), ['L3 草稿草稿']);
});

void test('§4 兩篇同名、不同資料夾：篇名附資料夾名；不同名的不附', async t => {
  const deck = (id: string): string => head('國二上', '英文', 'L3') + targets(id);
  const s = await open(t, { 'Essence Cards/甲/單字.md': deck('a'), 'Essence Cards/乙/單字.md': deck('b'), 'Essence Cards/丙/其他.md': deck('c') }, { screen: 'catalog' });
  await s.click(s.all('.ec-tr-name')[0]);
  assert.deepEqual(rows(s).map(each => each?.replace(/全部卡 \d+$/, '')).sort(), ['其他', '單字（乙）', '單字（甲）'].sort());
});

// ── 暫停／恢復（D-183 第 6 點、D-189 第 3 點、tasks/quiz-practice.md §5）──

const PAUSED = head('國二上', '英文', 'L3', '狀態: 暫停\n') + targets('d');
const DRAFT = head('國二上', '英文', 'L3', '狀態: 草稿\n') + targets('e');
const reread = async (s: Screen): Promise<void> => { await act(async () => { await wait(30); }); await s.settle(); };

void test('§5 電腦上按暫停：那一篇變成暫停、單元的全部卡少了那一篇；按恢復回來；筆記只改一行', async t => {
  const s = await open(t, L3, { screen: 'catalog', desktop: true });
  await s.click(s.all('.ec-tr-name')[0]);
  assert.deepEqual(rows(s), ['L3 其他暫停全部卡 1', 'L3 單字暫停全部卡 3']);
  await s.click(s.all('.ec-tr-pc')[1].querySelectorAll('button')[1]);
  await reread(s);
  assert.equal(s.texts.get(WORDS), head('國二上', '英文', 'L3', '狀態: 暫停\n') + targets('a', 'b', 'c'));
  assert.deepEqual(s.notices, []);
  assert.deepEqual(s.all('.ec-tr-ub .ec-u-btn').map(each => each.textContent), ['當日卡 1', '全部卡 1'], '單元的數字少了那一篇');
  assert.deepEqual(rows(s), ['L3 其他暫停', 'L3 單字暫停恢復'], '只剩一篇啟用：沒有單篇的全部卡，暫停與恢復都找得到');
  await s.click(s.button('恢復'));
  await reread(s);
  assert.equal(s.texts.get(WORDS), head('國二上', '英文', 'L3', '狀態: 啟用\n') + targets('a', 'b', 'c'));
  assert.deepEqual(rows(s), ['L3 其他暫停全部卡 1', 'L3 單字暫停全部卡 3']);
});

void test('§5 兩篇都暫停：單元可以展開，看得到兩個恢復；按單元名稱照舊打開筆記', async t => {
  const s = await open(t, { [WORDS]: PAUSED.replace('^d', '^a'), [REST]: PAUSED }, { screen: 'catalog', desktop: true });
  assert.equal((s.all('.ec-tr-exp')[0] as HTMLButtonElement).disabled, false);
  await s.click(s.all('.ec-tr-exp')[0]);
  assert.deepEqual(rows(s), ['L3 其他暫停恢復', 'L3 單字暫停恢復']);
  await s.click(s.all('.ec-tr-name')[0]);
  assert.deepEqual(s.notes, [[REST, undefined]]);
});

void test('§5 草稿沒有按鈕；只有一篇的單元沒有按鈕', async t => {
  const s = await open(t, { [WORDS]: L3[WORDS], 'Essence Cards/英文/L3 草稿.md': DRAFT, 'Essence Cards/自然 2-1.md': head('國二上', '自然', '2-1') + targets('n') }, { screen: 'catalog', desktop: true });
  const named = (name: string): HTMLElement => { const found = s.all('.ec-tr-name').find(each => each.textContent === name); assert.ok(found, name); return found; };
  await s.click(named('L3'));
  assert.deepEqual(rows(s), ['L3 單字暫停']);
  assert.deepEqual(s.all('.ec-tr-open > .ec-tr-deck').map(each => each.textContent), ['L3 草稿草稿'], '草稿照舊是筆記連結');
  await s.click(named('2-1'));
  assert.deepEqual(rows(s), ['L3 單字暫停'], '自然 2-1 只有一篇');
});

void test('§5 手機的畫面沒有這兩個按鈕：同樣的卡組，只有單篇的全部卡', async t => {
  const s = await open(t, { ...L3, 'Essence Cards/英文/L3 暫停的.md': PAUSED.replace('^d', '^p') }, { screen: 'catalog' });
  await s.click(s.all('.ec-tr-name')[0]);
  assert.deepEqual(rows(s), ['L3 其他全部卡 1', 'L3 單字全部卡 3']);
  assert.deepEqual(s.all('.ec-tr-open > .ec-tr-deck').map(each => each.textContent), ['L3 暫停的暫停']);
  assert.deepEqual(s.all('button').map(each => each.textContent).filter(each => each === '暫停' || each === '恢復'), []);
});

void test('§5 寫不進去：照受阻的提示，畫面不變', async t => {
  const s = await open(t, L3, { screen: 'catalog', desktop: true });
  await s.click(s.all('.ec-tr-name')[0]);
  s.control.failModify = true;
  await s.click(s.all('.ec-tr-pc')[1].querySelectorAll('button')[1]);
  await reread(s);
  assert.deepEqual(s.notices, ['受阻：failed']);
  assert.equal(s.texts.get(WORDS), L3[WORDS]);
  assert.deepEqual(rows(s), ['L3 其他暫停全部卡 1', 'L3 單字暫停全部卡 3']);
});
