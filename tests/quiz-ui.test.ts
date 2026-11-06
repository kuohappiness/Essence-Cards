import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { act } from 'react';
import type { App } from 'obsidian';
import { createState } from '../src/state/index.ts';
import type { State, StudyPick } from '../src/state/index.ts';
import type { EntryHandle, EntryOptions } from '../src/ui/entry-host.tsx';
import { installDom, loadUi } from './helpers/dom.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 小考的畫面（tasks/quiz-mark.md §2、§3、§4）：真的 React 加 happy-dom、真的 createState，存到記憶體檔案再讀回來看。

const window = installDom();
const { openEntry } = await loadUi<{ openEntry: (options: EntryOptions) => EntryHandle }>('src/ui/entry-host.tsx');

const at = (text: string): number => Date.parse(text + '+08:00');
/** 2026-11-05 中午。 */
const NOON = at('2026-11-05T12:00:00');
const FOLDER = 'Essence Cards/考試範圍/小考/';
const WORDS = 'Essence Cards/學業/國二上英文 L3 單字.md', GRAMMAR = 'Essence Cards/學業/國二上英文 L3 文法.md', DRAFT = 'Essence Cards/學業/國二上英文 L3 草稿.md', PAUSED = 'Essence Cards/學業/國二上英文 L3 暫停.md';
const NATURE = 'Essence Cards/學業/自然 2-1.md', ALONE = 'Essence Cards/其他/雜記.md', EMPTY = 'Essence Cards/學業/國二上公民 1-1.md';
const head = (term: string, subject: string, unit: string, extra = ''): string => `---\n年級學期: ${term}\n科目: ${subject}\n單元: "${unit}"\n${extra}---\n`;
const targets = (...ids: string[]): string => ids.map(id => `- 目標 ${id} ^${id}\n    - ${id} 的題目 :: 答\n`).join('');
const DECKS: Record<string, string> = {
  [WORDS]: head('國二上', '英文', 'L3 Vocabulary') + targets('w1', 'w2', 'w3'),
  [GRAMMAR]: head('國二上', '英文', 'L3 Vocabulary') + targets('g1'),
  [NATURE]: head('國二上', '自然', '2-1 水溶液') + targets('n1', 'n2'),
  [EMPTY]: head('國二上', '公民', '1-1') + '只有筆記，沒有目標\n',
  [ALONE]: '---\n狀態: 啟用\n---\n' + targets('z1'),
};
const L3 = '- 國二上 英文 L3';
const quizText = (date: string, line = L3, id = 'q4m8t2', extra = ''): string => `---\n識別碼: ${id}\n小考日期: ${date}\n${extra}---\n${line}\n`;
const link = (path: string): string => `- [[${path.replace(/\.md$/, '')}]]`;

/** React 看得到的打字：繞過它在元素上裝的追蹤，呼叫原型的 setter。 */
const setNative = (input: HTMLInputElement, value: string): void => { Reflect.set(Object.getPrototypeOf(input) as object, 'value', value, input); };

interface Screen extends MemoryFiles {
  state: State;
  clock: { now: number };
  /** 目錄的按鈕開關：只存在這台裝置。 */
  prefs: Map<string, unknown>;
  starts: StudyPick[];
  notes: string[];
  notices: string[];
  all: (selector: string) => HTMLElement[];
  text: () => string;
  button: (name: string, within?: HTMLElement) => HTMLButtonElement;
  has: (name: string, within?: HTMLElement) => boolean;
  click: (element: Element) => Promise<void>;
  /** 目錄展開一個單元。 */
  expand: (name: string) => Promise<void>;
  /** 目錄裡一篇那一列。 */
  piece: (name: string) => HTMLElement;
  type: (value: string) => Promise<void>;
  /** 小考資料夾裡的檔，照路徑排。 */
  quizFiles: () => string[];
  /** 入口的小考列，每列的字。 */
  rows: () => string[];
  go: (screen: 'entry' | 'catalog') => Promise<void>;
}

interface Options { mark?: boolean; screen?: 'entry' | 'catalog'; setDeckStatus?: EntryOptions['setDeckStatus']; resolveLink?: Parameters<typeof createState>[0]['resolveLink']; now?: number; setup?: (memory: MemoryFiles) => void }
async function open(t: TestContext, texts: Record<string, string> = {}, options: Options = {}): Promise<Screen> {
  const { mark = true, screen = 'catalog' } = options;
  const memory = createMemoryFiles({ ...DECKS, ...texts });
  options.setup?.(memory);
  const clock = { now: options.now ?? NOON };
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: false, stuckAfter: 20, writeTimeout: 200, now: () => clock.now, offset: () => 480, onError() {}, random: () => 0.5, ...(options.resolveLink ? { resolveLink: options.resolveLink } : {}) });
  t.after(() => state.close());
  await state.ready();
  const prefs = new Map<string, unknown>(mark ? [['essence-cards-quiz-mark', true]] : []);
  const app = { loadLocalStorage: (key: string) => prefs.get(key) ?? null, saveLocalStorage(key: string, value: unknown) { prefs.set(key, value); } } as unknown as App;
  const starts: StudyPick[] = [], notes: string[] = [], notices: string[] = [];
  let handle!: EntryHandle;
  await act(async () => {
    handle = openEntry({
      app, state: () => state, screen, reminders: false, covered: () => false,
      start: pick => { starts.push(pick); }, openNote: path => { notes.push(path); }, openSettings() {},
      notify: message => { notices.push(message); },
      onClose() {},
      ...(options.setDeckStatus ? { setDeckStatus: options.setDeckStatus } : {}),
    });
    await Promise.resolve();
  });
  t.after(async () => { await act(async () => { handle.close(); await Promise.resolve(); }); });
  const root = (): Element => {
    const found = Array.from(document.querySelectorAll('.ec-fullscreen')).at(-1);
    assert.ok(found, '入口開著');
    return found;
  };
  const all = (selector: string): HTMLElement[] => Array.from(root().querySelectorAll<HTMLElement>(selector));
  const among = (within?: HTMLElement): HTMLElement[] => within ? Array.from(within.querySelectorAll<HTMLElement>('button')) : all('button');
  const named = (name: string, within?: HTMLElement): HTMLElement | undefined => among(within).find(button => button.textContent === name || button.getAttribute('aria-label') === name);
  const click = async (element: Element): Promise<void> => { await act(async () => { (element as HTMLElement).click(); await wait(25); }); };
  const button = (name: string, within?: HTMLElement): HTMLButtonElement => {
    const found = named(name, within);
    assert.ok(found, '找不到按鈕「' + name + '」：' + among(within).map(each => each.textContent).join('、'));
    return found as HTMLButtonElement;
  };
  return {
    ...memory, state, clock, prefs, starts, notes, notices, all, click, button,
    has: (name, within) => named(name, within) !== undefined,
    text: () => root().textContent ?? '',
    expand: name => click(button('展開' + name)),
    piece(name) {
      const found = all('.ec-tr-pc').find(each => each.querySelector('.ec-tr-deck')?.textContent?.startsWith(name));
      assert.ok(found, '找不到那一篇 ' + name);
      return found;
    },
    async type(value) {
      const input = all('input[type="text"]').find(each => each.getAttribute('aria-label') === '小考日期') as HTMLInputElement | undefined;
      assert.ok(input, '日期欄開著');
      await act(async () => {
        setNative(input, value);
        input.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
        await Promise.resolve();
      });
    },
    quizFiles: () => [...memory.texts.keys()].filter(path => path.startsWith(FOLDER)).sort(),
    rows: () => all('.ec-qz').map(row => row.textContent ?? ''),
    async go(next) { await click(button(next === 'catalog' ? '目錄' : '返回')); },
  };
}
const text = (s: Screen, path: string): string => {
  const found = s.texts.get(path);
  assert.ok(found !== undefined, '沒有這份檔：' + path);
  return found;
};

// ── §2 開關 ──

void test('§2 預設關：目錄沒有小考按鈕；打開才有，關掉又沒有', async t => {
  const s = await open(t, {}, { mark: false });
  await s.expand('L3 Vocabulary');
  assert.equal(s.has('小考'), false, '預設關');
  assert.ok(s.has('全部卡 4'), '單元展開了');
  s.prefs.set('essence-cards-quiz-mark', true);
  await s.click(s.button('展開L3 Vocabulary'));
  await s.click(s.button('展開L3 Vocabulary'));
  assert.ok(s.has('小考'), '打開之後有');
  s.prefs.set('essence-cards-quiz-mark', false);
  await s.click(s.button('展開L3 Vocabulary'));
  await s.click(s.button('展開L3 Vocabulary'));
  assert.equal(s.has('小考'), false);
});

void test('§2 開關只管目錄的按鈕：關著時，已經設的小考在入口照樣顯示，按得下去', async t => {
  const s = await open(t, { [FOLDER + '2026-11-06 小考.md']: quizText('2026-11-06') }, { mark: false, screen: 'entry' });
  assert.equal(s.rows().length, 1);
  assert.match(s.rows()[0], /英文 L3.*明天考.*全部卡 4/);
  await s.click(s.button('全部卡 4'));
  assert.equal(s.starts.length, 1);
});

void test('§2 沒有小考檔的家庭：入口不會多一列', async t => {
  const s = await open(t, {}, { screen: 'entry' });
  assert.deepEqual(s.rows(), []);
});

// ── §3 目錄：設小考 ──

void test('§3 單元：按下去選今天、明天、後天、其他日期；選明天建一份新檔，按鈕寫日期，入口多一列', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考'));
  for (const name of ['今天', '明天', '後天', '其他日期']) assert.ok(s.has(name), name);
  assert.equal(s.has('取消小考'), false, '還沒設，沒有東西可以取消');
  assert.deepEqual(s.quizFiles(), [], '選之前不寫');
  await s.click(s.button('明天'));
  assert.deepEqual(s.quizFiles(), [FOLDER + '2026-11-06 小考.md']);
  assert.match(text(s, FOLDER + '2026-11-06 小考.md'), /^---\n識別碼: [a-z][a-z0-9]{5}\n小考日期: 2026-11-06\n---\n- 國二上 英文 L3\n$/);
  assert.ok(s.has('小考 11/6'), '按鈕寫日期');
  assert.equal(s.has('明天'), false, '選單收起來');
  await s.go('entry');
  assert.match(s.rows()[0], /英文 L3.*明天考.*全部卡 4/);
});

void test('§3 當天寫「今天小考」；清晨 4 點前算前一天', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考'));
  await s.click(s.button('今天'));
  assert.ok(s.has('今天小考'));
  assert.equal(text(s, FOLDER + '2026-11-05 小考.md').includes('小考日期: 2026-11-05'), true);

  const early = await open(t, {}, { now: at('2026-11-06T03:30:00') });
  await early.expand('L3 Vocabulary');
  await early.click(early.button('小考'));
  await early.click(early.button('今天'));
  assert.deepEqual(early.quizFiles(), [FOLDER + '2026-11-05 小考.md'], '凌晨 3:30 的今天還是 11/5');
});

void test('§3 單元有兩篇以上啟用時每一篇都有按鈕，寫的是那一篇的連結；草稿、暫停的篇沒有', async t => {
  const s = await open(t, {
    [DRAFT]: head('國二上', '英文', 'L3 Vocabulary', '狀態: 草稿\n') + targets('d1'),
    [PAUSED]: head('國二上', '英文', 'L3 Vocabulary', '狀態: 暫停\n') + targets('p1'),
  });
  await s.expand('L3 Vocabulary');
  const words = s.piece('國二上英文 L3 單字');
  assert.ok(s.has('小考', words));
  assert.ok(s.has('小考', s.piece('國二上英文 L3 文法')));
  const quizButtons = s.all('.ec-tr-open .ec-u-btn').filter(each => each.textContent === '小考');
  assert.equal(quizButtons.length, 2, '只有啟用的兩篇');
  await s.click(s.button('小考', words));
  await s.click(s.button('後天', s.piece('國二上英文 L3 單字')));
  assert.equal(text(s, FOLDER + '2026-11-07 小考.md').endsWith('---\n' + link(WORDS) + '\n'), true);
  assert.ok(s.has('小考 11/7', s.piece('國二上英文 L3 單字')), '那一篇寫日期');
  assert.ok(s.has('小考', s.piece('國二上英文 L3 文法')), '另一篇沒有');
  assert.equal(s.all('.ec-tr-ub .ec-u-btn').filter(each => each.textContent === '小考').length, 1, '單元的按鈕也還沒設');
});

void test('§3 只有一篇啟用：單元的按鈕就夠，那一篇沒有多一顆', async t => {
  const s = await open(t);
  await s.expand('2-1 水溶液');
  assert.equal(s.all('.ec-u-btn').filter(each => each.textContent === '小考').length, 1);
  assert.equal(s.all('.ec-tr-pc').length, 0);
});

void test('§3 只有一篇啟用，但那一篇已經有手寫的小考：按鈕還找得到', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-07', link(NATURE)) });
  await s.expand('2-1 水溶液');
  assert.ok(s.has('小考 11/7', s.piece('自然 2-1')));
});

void test('§3 其他分類、沒有單元編號的：寫那一篇的連結', async t => {
  const s = await open(t);
  await s.click(s.button('其他'));
  await s.expand('雜記');
  await s.click(s.button('小考'));
  await s.click(s.button('明天'));
  assert.ok(text(s, FOLDER + '2026-11-06 小考.md').endsWith('---\n' + link(ALONE) + '\n'));
  assert.ok(s.has('小考 11/6'));
});

void test('§3 再按一次可以改日期：只改那一行，檔名與識別碼不變', async t => {
  const original = '---\n# 老師說的\n識別碼: q4m8t2\r\n小考日期: "2026-11-06"\n---\n- 國二上 英文 L3\n';
  const s = await open(t, { [FOLDER + '手寫.md']: original });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考 11/6'));
  assert.ok(s.has('取消小考'));
  await s.click(s.button('後天'));
  assert.deepEqual(s.quizFiles(), [FOLDER + '手寫.md']);
  assert.equal(text(s, FOLDER + '手寫.md'), original.replace('2026-11-06', '2026-11-07'), '註解、引號、CRLF 都照留');
  assert.ok(s.has('小考 11/7'));
});

void test('§3 取消：檔案多一行取消，按鈕變回「小考」，入口那一列消失；再設是新的一份、新的識別碼', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考'));
  await s.click(s.button('明天'));
  const first = text(s, FOLDER + '2026-11-06 小考.md');
  await s.click(s.button('小考 11/6'));
  await s.click(s.button('取消小考'));
  assert.equal(text(s, FOLDER + '2026-11-06 小考.md'), first.replace('小考日期: 2026-11-06\n', '小考日期: 2026-11-06\n取消: 2026-11-05\n'));
  assert.ok(s.has('小考'));
  await s.click(s.button('小考'));
  await s.click(s.button('明天'));
  assert.deepEqual(s.quizFiles(), [FOLDER + '2026-11-06 小考 2.md', FOLDER + '2026-11-06 小考.md'].sort());
  const id = (path: string): string | undefined => /識別碼: (\w+)/.exec(text(s, path))?.[1];
  assert.notEqual(id(FOLDER + '2026-11-06 小考.md'), id(FOLDER + '2026-11-06 小考 2.md'));
});

void test('§3 其他日期：讀得懂才能確定，存成標準寫法；寫錯、已經過了都留紅字，不寫檔', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考'));
  await s.click(s.button('其他日期'));
  assert.equal(s.button('確定').disabled, true, '還沒打');
  await s.type('2026-13-40');
  assert.equal(s.button('確定').disabled, true);
  assert.ok(s.all('.ec-sc-word.is-bad').length > 0, '寫錯有紅字');
  await s.type('2026-11-04');
  assert.ok(s.text().includes('這個日期已經過了'));
  assert.equal(s.button('確定').disabled, true);
  assert.deepEqual(s.quizFiles(), []);
  await s.type('2026/11/20');
  assert.equal(s.all('.ec-sc-word.is-bad').length, 0);
  await s.click(s.button('確定'));
  assert.ok(text(s, FOLDER + '2026-11-20 小考.md').includes('小考日期: 2026-11-20\n'));
  assert.ok(s.has('小考 11/20'));
});

void test('§3 寫不進去：原因留在按鈕底下，選單不收起來', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考'));
  s.control.failModify = true;
  await s.click(s.button('明天'));
  assert.equal(s.quizFiles().length, 0);
  assert.match(s.all('[role="alert"]')[0]?.textContent ?? '', /寫不進去/);
  assert.ok(s.has('明天'), '可以再按一次');
  s.control.failModify = false;
  await s.click(s.button('明天'));
  assert.equal(s.quizFiles().length, 1);
  assert.equal(s.all('[role="alert"]').length, 0);
});

void test('§3 屬性區壞掉不寫，請家長先修：原因留在按鈕底下', async t => {
  const broken = '---\n識別碼: q4m8t2\n小考日期: 2026-11-06\n小考日期: 2026-11-07\n---\n- 國二上 英文 L3\n';
  const s = await open(t, { [FOLDER + 'a.md']: broken });
  await s.expand('L3 Vocabulary');
  const label = s.all('.ec-tr-ub .ec-u-btn').at(-1)?.textContent ?? '';
  assert.equal(label, '小考日期有問題', '重複的鍵看不出哪一個對');
  await s.click(s.button(label));
  assert.deepEqual(s.notes, [FOLDER + 'a.md'], '點了打開這份檔');
  assert.equal(text(s, FOLDER + 'a.md'), broken);
});

void test('§3 Esc 只收起選單，不離開目錄', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考'));
  const menu = s.all('.ec-qz-menu')[0];
  assert.ok(menu);
  await act(async () => {
    menu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
    await Promise.resolve();
  });
  assert.equal(s.all('.ec-qz-menu').length, 0);
  assert.ok(s.text().includes('目錄'), '還在目錄');
  assert.ok(s.has('小考'));
});

void test('L2 R3 選單開著時別台裝置取消了這次小考：選單寫已經改過、按不下去，不會變成新的一份；收起再打開才重來', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-07') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考 11/7'));
  await s.click(s.button('其他日期'));
  await s.type('2026-11-09');
  await act(async () => { s.write(FOLDER + 'a.md', quizText('2026-11-07', L3, 'q4m8t2', '取消: 2026-11-05\n')); await wait(25); });
  const menu = s.all('.ec-qz-menu')[0];
  assert.ok(menu, '選單還在，寫出原因');
  assert.match(menu.textContent ?? '', /這個小考剛被別處改過，請再看一次/);
  for (const name of ['今天', '明天', '後天', '確定', '取消小考']) assert.equal(s.has(name, menu), false, name + ' 按不到');
  assert.deepEqual(s.quizFiles(), [FOLDER + 'a.md'], '沒有建新檔');
  await s.click(s.button('小考'));
  assert.equal(s.all('.ec-qz-menu').length, 0, '按一下收起');
  await s.click(s.button('小考'));
  assert.ok(s.has('明天'), '再打開是新的選單');
});

void test('L2 R3 選單開著時同一個單元多了一份別人設的小考：不建第二份', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考'));
  await act(async () => { s.write(FOLDER + 'b.md', quizText('2026-11-08', L3, 'bbbbbb')); await wait(25); });
  const menu = s.all('.ec-qz-menu')[0];
  assert.ok(menu);
  assert.match(menu.textContent ?? '', /這個小考剛被別處改過，請再看一次/);
  assert.equal(s.has('明天', menu), false);
  assert.deepEqual(s.quizFiles(), [FOLDER + 'b.md']);
});

void test('L2 R3 自己按的設定與取消不算「別處改過」：選單照常收起', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考'));
  await s.click(s.button('明天'));
  assert.equal(s.all('.ec-qz-menu').length, 0);
  await s.click(s.button('小考 11/6'));
  await s.click(s.button('取消小考'));
  assert.equal(s.all('.ec-qz-menu').length, 0);
  assert.equal(s.text().includes('別處改過'), false);
});

/** 選單還開著，只寫「別處改過」，沒有任何按得下去的選項。 */
function assertChanged(s: Screen, when: string): void {
  const menu = s.all('.ec-qz-menu')[0];
  assert.ok(menu, when + '：選單還在');
  assert.match(menu.textContent ?? '', /這個小考剛被別處改過，請再看一次/, when);
  for (const name of ['今天', '明天', '後天', '其他日期', '取消小考']) assert.equal(s.has(name, menu), false, when + '：' + name + ' 按不到');
  assert.equal(s.text().includes('兩份看不出'), false, when + '：打開的是選單，不換成兩份的清單');
}

void test('L2 R6 選單開著時這次小考被取消、另一份待修正的又被修好：一直寫別處改過，取消不到另一份；收起再打開才操作那一份', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-07', L3, 'aaaaaa'), [FOLDER + 'b.md']: quizText('下週五', L3, 'bbbbbb') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考 11/7'));
  await act(async () => { s.write(FOLDER + 'a.md', quizText('2026-11-07', L3, 'aaaaaa', '取消: 2026-11-05\n')); await wait(25); });
  assertChanged(s, '這次被取消、只剩待修正的另一份');
  await act(async () => { s.write(FOLDER + 'b.md', quizText('2026-11-09', L3, 'bbbbbb')); await wait(25); });
  assertChanged(s, '另一份修好了');
  assert.equal(text(s, FOLDER + 'b.md').includes('取消'), false);
  await s.click(s.button('小考 11/9'));
  assert.equal(s.all('.ec-qz-menu').length, 0, '按一下收起');
  await s.click(s.button('小考 11/9'));
  await s.click(s.button('取消小考'));
  assert.match(text(s, FOLDER + 'b.md'), /取消: 2026-11-05/, '收起再打開，才是那一份的選單');
});

void test('L2 R6 選單開著時這次小考被取消、出現兩份不一樣、又修成另一份：一直寫別處改過，改不到另一份', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-07', L3, 'aaaaaa') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考 11/7'));
  await act(async () => {
    s.write(FOLDER + 'a.md', quizText('2026-11-07', L3, 'aaaaaa', '取消: 2026-11-05\n'));
    s.write(FOLDER + 'c1.md', quizText('2026-11-08', L3, 'cccccc'));
    s.write(FOLDER + 'c2.md', quizText('2026-11-09', L3, 'cccccc'));
    await wait(25);
  });
  assertChanged(s, '兩份不一樣');
  await act(async () => { s.write(FOLDER + 'c2.md', quizText('2026-11-08', L3, 'cccccc')); await wait(25); });
  assertChanged(s, '兩份改成一樣');
  assert.deepEqual([text(s, FOLDER + 'c1.md'), text(s, FOLDER + 'c2.md')], [quizText('2026-11-08', L3, 'cccccc'), quizText('2026-11-08', L3, 'cccccc')]);
});

void test('L2 R6 列出兩份時其中一份被修好、變成正常的小考：寫別處改過，不換成選單', async t => {
  const s = await open(t, { [FOLDER + 'c1.md']: quizText('2026-11-08', L3, 'cccccc'), [FOLDER + 'c2.md']: quizText('2026-11-09', L3, 'cccccc') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('這個小考有兩份不一樣的檔'));
  assert.ok(s.has(FOLDER + 'c2.md'));
  await act(async () => { s.write(FOLDER + 'c2.md', quizText('2026-11-08', L3, 'cccccc')); await wait(25); });
  assertChanged(s, '兩份改成一樣');
  assert.equal(s.has(FOLDER + 'c2.md'), false);
});

void test('L2 R3 R6 自己按的取消已經讀回、結果還沒回來（旁邊有待修正的另一份）：不寫別處改過、按不下去，結果回來之後收起', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-07', L3, 'aaaaaa'), [FOLDER + 'b.md']: quizText('下週五', L3, 'bbbbbb') });
  await s.expand('L3 Vocabulary');
  const cancel = s.state.cancelQuiz.bind(s.state);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  s.state.cancelQuiz = async opened => { const result = await cancel(opened); await gate; return result; };
  await s.click(s.button('小考 11/7'));
  await s.click(s.button('取消小考'));
  assert.match(text(s, FOLDER + 'a.md'), /取消: 2026-11-05/, '已經寫進去');
  assert.ok(s.has('小考日期有問題'), '目錄已經讀到：只剩待修正的另一份');
  const menu = s.all('.ec-qz-menu')[0];
  assert.ok(menu, '選單還開著，等結果');
  assert.equal(/別處改過/.test(menu.textContent ?? ''), false);
  assert.ok(s.button('取消小考', menu).disabled, '寫的時候按不下去');
  await act(async () => { release(); await wait(25); });
  assert.equal(s.all('.ec-qz-menu').length, 0, '結果回來之後收起');
  assert.equal(s.text().includes('別處改過'), false);
});

void test('L2 R9 自己按的取消寫入逾時、資料又變成別的：寫逾時的原因，不寫別處改過；選項仍按不到', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-07', L3, 'aaaaaa'), [FOLDER + 'b.md']: quizText('下週五', L3, 'bbbbbb') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考 11/7'));
  const held = s.holdModify(FOLDER + 'a.md');
  await s.click(s.button('取消小考'));
  await act(async () => { await wait(300); });
  assert.match(text(s, FOLDER + 'a.md'), /取消: 2026-11-05/, '其實已經寫進去，只是沒有回來');
  const menu = s.all('.ec-qz-menu')[0];
  assert.ok(menu, '選單還開著');
  assert.match(menu.textContent ?? '', /寫不進去：.*請重新打開這個畫面確認/);
  assert.equal(/別處改過/.test(menu.textContent ?? ''), false, '不把自己的動作說成別處改的');
  for (const name of ['今天', '明天', '後天', '其他日期', '取消小考']) assert.equal(s.has(name, menu), false, name + ' 按不到');
  held.release();
  await act(async () => { await wait(25); });
});

void test('L2 R6 列出兩份時換成另一組兩份不一樣：寫別處改過，不列另一組', async t => {
  const s = await open(t, { [FOLDER + 'c1.md']: quizText('2026-11-08', L3, 'cccccc'), [FOLDER + 'c2.md']: quizText('2026-11-09', L3, 'cccccc') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('這個小考有兩份不一樣的檔'));
  await act(async () => {
    s.write(FOLDER + 'c1.md', quizText('2026-11-08', L3, 'dddddd'));
    s.write(FOLDER + 'c2.md', quizText('2026-11-09', L3, 'dddddd'));
    await wait(25);
  });
  assertChanged(s, '換成另一組');
});

void test('L2 R6 選單開著時這一份的日期在別處被改壞：寫別處改過；按鈕變成待修正，按一下是收起，不是打開那份檔', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-07', L3, 'aaaaaa') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考 11/7'));
  await act(async () => { s.write(FOLDER + 'a.md', quizText('下週五', L3, 'aaaaaa')); await wait(25); });
  assertChanged(s, '同一份的日期壞掉');
  await s.click(s.button('小考日期有問題'));
  assert.equal(s.all('.ec-qz-menu').length, 0, '收起');
  assert.deepEqual(s.notes, [], '沒有打開檔');
  await s.click(s.button('小考日期有問題'));
  assert.deepEqual(s.notes, [FOLDER + 'a.md'], '收起之後再按才去修');
});

/** 從現在有焦點的元素按 Esc（真的鍵盤事件從這裡開始冒泡）。 */
async function escape(): Promise<void> {
  await act(async () => {
    const focused = document.activeElement as HTMLElement | null;
    assert.ok(focused, '有焦點');
    focused.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event);
    await Promise.resolve();
  });
}

void test('L2 R4 焦點還在小考按鈕上按 Esc：先收起選單、焦點留在按鈕，留在目錄；再按一次才回入口', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  const trigger = s.button('小考');
  trigger.focus();
  await s.click(trigger);
  assert.ok(s.all('.ec-qz-menu')[0]);
  assert.ok(document.activeElement === trigger, '打開選單不搬焦點');
  await escape();
  assert.equal(s.all('.ec-qz-menu').length, 0, '選單收起來');
  assert.ok(s.all('.ec-tr-ub').length > 0, '還在目錄，單元還展開著');
  assert.ok(document.activeElement === s.button('小考'), '焦點回到小考按鈕');
  await escape();
  assert.equal(s.all('.ec-tr-ub').length, 0, '第二次才回入口');
});

void test('L2 R4 焦點在選單裡（日期欄）按 Esc：收起選單，焦點回到小考按鈕', async t => {
  const s = await open(t);
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考'));
  await s.click(s.button('其他日期'));
  const input = s.all('input[type="text"]').find(each => each.getAttribute('aria-label') === '小考日期');
  assert.ok(input);
  input.focus();
  await escape();
  assert.equal(s.all('.ec-qz-menu').length, 0);
  assert.ok(s.all('.ec-tr-ub').length > 0, '還在目錄');
  assert.ok(document.activeElement === s.button('小考'), '焦點回到小考按鈕');
});

void test('L2 R4 列出兩份時按 Esc：目錄先收起清單；入口也是先收起清單，不關掉畫面', async t => {
  const files = { [FOLDER + 'a.md']: quizText('2026-11-06'), [FOLDER + 'b.md']: quizText('2026-11-07') };
  const s = await open(t, files);
  await s.expand('L3 Vocabulary');
  const trigger = s.button('這個小考有兩份不一樣的檔');
  trigger.focus();
  await s.click(trigger);
  assert.ok(s.has(FOLDER + 'b.md'));
  await escape();
  assert.equal(s.has(FOLDER + 'b.md'), false, '清單收起來');
  assert.ok(s.all('.ec-tr-ub').length > 0, '還在目錄');

  const home = await open(t, files, { screen: 'entry' });
  const fix = home.all('.ec-qz-fix')[0];
  assert.ok(fix);
  fix.focus();
  await home.click(fix);
  assert.ok(home.has(FOLDER + 'a.md'));
  await escape();
  assert.equal(home.has(FOLDER + 'a.md'), false, '清單收起來');
  assert.equal(home.all('.ec-qz-fix').length, 1, '入口還開著');
  assert.ok(document.activeElement === home.all('.ec-qz-fix')[0], '焦點回到那一列');
});

void test('§3 電腦與手機都有：手機沒有暫停的按鈕，小考按鈕一樣在', async t => {
  const phone = await open(t);
  await phone.expand('L3 Vocabulary');
  assert.equal(phone.has('暫停'), false, '這是手機');
  assert.equal(phone.all('.ec-u-btn').filter(each => each.textContent === '小考').length, 3);
  const desktop = await open(t, {}, { setDeckStatus: () => Promise.resolve(null) });
  await desktop.expand('L3 Vocabulary');
  assert.ok(desktop.has('暫停'));
  assert.equal(desktop.all('.ec-u-btn').filter(each => each.textContent === '小考').length, 3);
});

void test('§3 草稿、全部暫停的單元：沒有小考按鈕', async t => {
  const s = await open(t, { 'Essence Cards/學業/歷史 9-9.md': head('國二上', '歷史', '9-9', '狀態: 草稿\n') + targets('h1') });
  assert.equal(s.button('展開9-9').disabled, true, '草稿的單元展不開');
  assert.equal(s.all('.ec-u-btn').length, 0, '沒有展開任何單元');
});

void test('§3 §1 正常的小考和壞掉的檔在同一個單元：可以改，也看得到壞的那份', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06'), [FOLDER + 'b.md']: quizText('下週五', L3, 'bbbbbb') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考 11/6'));
  const other = s.all('.ec-qz-menu .ec-tr-problem')[0];
  assert.ok(other, '壞的那份有地方看');
  assert.equal(other.textContent, '另一份小考：小考日期有問題（' + FOLDER + 'b.md）');
  await s.click(other);
  assert.deepEqual(s.notes, [FOLDER + 'b.md']);
});

void test('L2 R5 正常的小考旁邊另一份是兩份不一樣：寫兩份不一樣、列出兩份，不寫成日期有問題', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-07', L3, 'aaaaaa'), [FOLDER + 'b1.md']: quizText('2026-11-07', L3, 'bbbbbb'), [FOLDER + 'b2.md']: quizText('2026-11-09', L3, 'bbbbbb') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('小考 11/7'));
  const menu = s.all('.ec-qz-menu')[0];
  assert.ok(menu);
  assert.match(menu.textContent ?? '', /另一份小考：這個小考有兩份不一樣的檔/);
  assert.equal(/日期有問題/.test(menu.textContent ?? ''), false);
  assert.ok((menu.textContent ?? '').includes('請留下對的那一份'));
  await s.click(s.button(FOLDER + 'b2.md', menu));
  await s.click(s.button(FOLDER + 'b1.md', menu));
  assert.deepEqual(s.notes, [FOLDER + 'b2.md', FOLDER + 'b1.md']);
});

void test('§3 §1 同一個識別碼兩份不一樣：目錄寫出來，點了列出兩份，各自打開', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06'), [FOLDER + 'b.md']: quizText('2026-11-07') });
  await s.expand('L3 Vocabulary');
  await s.click(s.button('這個小考有兩份不一樣的檔'));
  assert.ok(s.text().includes('請留下對的那一份'));
  await s.click(s.button(FOLDER + 'b.md'));
  assert.deepEqual(s.notes, [FOLDER + 'b.md']);
});

// ── §4 入口 ──

void test('§4 入口最上面一列：科目、單元名、今天考、全部卡 N；按了開單元的一輪', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-05') }, { screen: 'entry' });
  assert.equal(s.all('.ec-sb')[0], s.all('.ec-qz')[0], '在科目列的最上面');
  assert.ok(s.all('.ec-sb').length > 1, '科目列還在');
  assert.match(s.rows()[0], /英文 L3/);
  assert.match(s.rows()[0], /今天考/);
  const before = Date.now();
  await s.click(s.button('全部卡 4'));
  const pick = s.starts[0] as { unit: string; since: number };
  assert.ok('unit' in pick, '開的是單元');
  assert.ok(pick.since >= before, 'since 是按下去的時間，完成畫面才算得出這一輪');
  const unit = s.state.catalog().terms.flatMap(term => term.subjects).flatMap(subject => subject.units).find(each => each.code === 'L3');
  assert.equal(pick.unit, unit?.key);
});

void test('§4 單篇：寫篇名與明天考，按了只開那一篇', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06', link(WORDS)) }, { screen: 'entry' });
  assert.match(s.rows()[0], /英文 國二上英文 L3 單字/);
  assert.match(s.rows()[0], /明天考/);
  await s.click(s.button('全部卡 3'));
  assert.equal((s.starts[0] as { deck: string }).deck, WORDS);
  assert.equal(typeof (s.starts[0] as { since: number }).since, 'number');
});

void test('§4 其他日期寫 11/7 考；好幾個照日期、科目、名稱排', async t => {
  const s = await open(t, {
    [FOLDER + 'z.md']: quizText('2026-11-05', '- 國二上 英文 L3', 'aaaaaa'),
    [FOLDER + 'a.md']: quizText('2026-11-07', '- 國二上 自然 2-1', 'bbbbbb'),
    [FOLDER + 'm.md']: quizText('2026-11-07', link(GRAMMAR), 'cccccc'),
    [FOLDER + 'k.md']: quizText('2026-11-06', link(WORDS), 'dddddd'),
  }, { screen: 'entry' });
  const order = s.rows().map(row => /^(.*?)(今天|明天|\d+\/\d+ )考/.exec(row)?.slice(1, 3).join('|'));
  assert.deepEqual(order, ['英文 L3 Vocabulary|今天', '英文 國二上英文 L3 單字|明天', '自然 2-1 水溶液|11/7 ', '英文 國二上英文 L3 文法|11/7 ']);
});

void test('§4 N 是 0 不能按', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06', link(EMPTY)) }, { screen: 'entry' });
  assert.equal(s.button('全部卡 0').disabled, true);
});

void test('§4 那一篇之後暫停了：全部卡 0 不能按；目錄沒有它的按鈕，入口可以取消', async t => {
  const s = await open(t, {
    [PAUSED]: head('國二上', '英文', 'L3 Vocabulary', '狀態: 暫停\n') + targets('p1'),
    [FOLDER + 'a.md']: quizText('2026-11-06', link(PAUSED)),
  }, { screen: 'entry' });
  assert.match(s.rows()[0], /國二上英文 L3 暫停.*明天考.*全部卡 0/);
  assert.equal(s.button('全部卡 0').disabled, true);
  await s.click(s.button('取消'));
  assert.deepEqual(s.rows(), []);
  assert.match(text(s, FOLDER + 'a.md'), /取消: 2026-11-05/);
});

void test('§4 正常的列、有卡可以練：沒有取消，要到目錄取消', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06') }, { screen: 'entry' });
  assert.equal(s.has('取消', s.all('.ec-qz')[0]), false);
});

void test('§4 考試日隔天清晨 4 點起消失，檔案留著；到了今天又沒有卡時，沒有卡的字在小考底下', async t => {
  const original = quizText('2026-11-05');
  const s = await open(t, { [FOLDER + 'a.md']: original }, { screen: 'entry', now: at('2026-11-06T03:59:59.999') });
  assert.equal(s.rows().length, 1);
  s.clock.now = at('2026-11-06T04:00:00');
  await s.click(s.button('目錄'));
  await s.click(s.button('返回'));
  assert.equal(s.rows().length, 0);
  assert.equal(text(s, FOLDER + 'a.md'), original);
});

void test('§4 今天沒有要複習的卡：小考那一列照樣在，底下寫今天沒有要複習的卡', async t => {
  const decks = Object.keys(DECKS);
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06', link(EMPTY)) }, { screen: 'entry', setup(memory) { for (const path of decks) if (path !== EMPTY) memory.texts.delete(path); } });
  assert.equal(s.rows().length, 1);
  assert.equal(s.all('.ec-sb').length, 1, '沒有科目列');
  assert.ok(s.text().indexOf('今天沒有要複習的卡') > s.text().indexOf('明天考'), '字在那一列底下');
});

// ── §1 待修正的列 ──

void test('§1 日期有問題：那一列寫出來，點了打開這份檔；不失效、不猜', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('下週五') }, { screen: 'entry' });
  assert.match(s.rows()[0], /小考日期有問題/);
  assert.equal(s.has('全部卡 4', s.all('.ec-qz')[0]), false, '不知道哪天考，不開');
  await s.click(s.all('.ec-qz-fix')[0]);
  assert.deepEqual(s.notes, [FOLDER + 'a.md']);
});

void test('§1 寫法有問題：那一列寫出來，點了打開這份檔', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06', '- 國二上 英文 L3\n- 國二上 英文 L4') }, { screen: 'entry' });
  assert.match(s.rows()[0], /小考檔寫法有問題/);
  await s.click(s.all('.ec-qz-fix')[0]);
  assert.deepEqual(s.notes, [FOLDER + 'a.md']);
});

void test('§1 單元對不到卡組：全部卡不能按，可以打開也可以取消', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06', '- 國二上 英文 L9') }, { screen: 'entry' });
  assert.match(s.rows()[0], /英文 國二上 L9.*明天考.*對不到卡組/);
  const row = s.all('.ec-qz')[0];
  const practice = Array.from(row.querySelectorAll('button')).find(each => each.textContent.includes('全部卡'));
  assert.equal(practice?.disabled, true);
  await s.click(s.all('.ec-qz-fix')[0]);
  assert.deepEqual(s.notes, [FOLDER + 'a.md']);
  await s.click(s.button('取消'));
  assert.deepEqual(s.rows(), [], '取消後消失');
  assert.match(text(s, FOLDER + 'a.md'), /取消: 2026-11-05/);
});

void test('§1 找不到這一篇：寫修法，點了打開小考檔；不退回整個單元；已經刪掉的目錄沒有按鈕，這裡可以取消', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06', '- [[Essence Cards/學業/已經刪掉的那一篇]]') }, { screen: 'entry' });
  assert.match(s.rows()[0], /已經刪掉的那一篇.*明天考.*找不到這一篇/);
  assert.ok(s.rows()[0]?.includes('從建議清單選那一篇'), '修法');
  assert.ok(s.rows()[0]?.includes('不要點斷掉的連結'));
  assert.equal(s.all('.ec-qz')[0]?.querySelectorAll('.ec-sb-btn').length, 0, '不退回整個單元');
  await s.click(s.all('.ec-qz-fix')[0]);
  assert.deepEqual(s.notes, [FOLDER + 'a.md'], '打開的是小考檔');
  await s.click(s.button('取消'));
  assert.deepEqual(s.rows(), []);
});

void test('§1 認不出是哪一篇：走待修正', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06', '- [[國二上英文 L3 單字]]') }, { screen: 'entry', resolveLink: () => ({ kind: 'several' }) });
  assert.match(s.rows()[0], /認不出是哪一篇/);
  assert.ok(s.rows()[0]?.includes('從建議清單選那一篇'));
});

void test('§1 取消擋下來時用通知說原因：這一列沒有放字的地方', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-06', '- [[不見了]]') }, { screen: 'entry' });
  s.control.failModify = true;
  await s.click(s.button('取消'));
  assert.match(s.notices[0] ?? '', /寫不進去/);
  assert.equal(s.rows().length, 1);
});

void test('§1 同一個識別碼兩份不一樣：點了列出兩份，請家長留下對的那一份，各自打開；不自己挑', async t => {
  const s = await open(t, { [FOLDER + 'a.md']: quizText('2026-11-05'), [FOLDER + 'b.md']: quizText('2026-11-07') }, { screen: 'entry' });
  assert.match(s.rows()[0], /這個小考有兩份不一樣的檔/);
  assert.equal(s.has(FOLDER + 'a.md'), false, '點了才列');
  await s.click(s.all('.ec-qz-fix')[0]);
  assert.ok(s.text().includes('請留下對的那一份'));
  await s.click(s.button(FOLDER + 'a.md'));
  await s.click(s.button(FOLDER + 'b.md'));
  assert.deepEqual(s.notes, [FOLDER + 'a.md', FOLDER + 'b.md']);
});

void test('§1 其他裝置改了小考檔：入口跟著變', async t => {
  const s = await open(t, {}, { screen: 'entry' });
  assert.deepEqual(s.rows(), []);
  await act(async () => { s.write(FOLDER + 'a.md', quizText('2026-11-06')); await wait(25); });
  assert.equal(s.rows().length, 1);
  await act(async () => { s.remove(FOLDER + 'a.md'); await wait(25); });
  assert.deepEqual(s.rows(), []);
});
