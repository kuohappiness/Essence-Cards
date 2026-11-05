import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { act } from 'react';
import type { App } from 'obsidian';
import { encodeEntry } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { State } from '../src/state/index.ts';
import type { EntryHandle, EntryOptions } from '../src/ui/entry-host.tsx';
import { installDom, loadUi } from './helpers/dom.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 考試範圍的畫面（tasks/exam-scope.md §6、§7、§8）：真的 React 加 happy-dom、真的 createState，存到記憶體檔案再讀回來看。

const window = installDom();
const { openEntry } = await loadUi<{ openEntry: (options: EntryOptions) => EntryHandle }>('src/ui/entry-host.tsx');

/** 2026-10-16 中午。 */
const NOW = Date.parse('2026-10-16T12:00:00.000+08:00');
const FOLDER = 'Essence Cards/考試範圍/';
const head = (term: string, subject: string, unit: string, extra = ''): string => `---\n年級學期: ${term}\n科目: ${subject}\n單元: "${unit}"\n${extra}---\n`;
const targets = (...ids: string[]): string => ids.map(id => `- 目標 ${id} ^${id}\n    - ${id} 的題目 :: 答\n`).join('');
const DECKS = {
  'Essence Cards/自然 2-1.md': head('國二上', '自然', '2-1 水溶液') + targets('a'),
  'Essence Cards/自然 2-2.md': head('國二上', '自然', '2-2') + targets('b'),
  'Essence Cards/自然 2-3.md': head('國二上', '自然', '2-3') + targets('c'),
  'Essence Cards/英文 L1.md': head('國二上', '英文', 'L1') + targets('e'),
  'Essence Cards/舊 1-1.md': head('國一下', '自然', '1-1') + targets('o'),
};
const scopeText = (start: string, end: string, ...lines: string[]): string => `---\n識別碼: s1\n${start ? '考試開始: ' + start + '\n' : ''}${end ? '考試結束: ' + end + '\n' : ''}---\n${lines.map(line => line + '\n').join('')}`;

/** React 看得到的打字：繞過它在元素上裝的追蹤，呼叫原型的 setter。 */
const setNative = (input: HTMLInputElement, value: string): void => { Reflect.set(Object.getPrototypeOf(input) as object, 'value', value, input); };

interface Screen extends MemoryFiles {
  state: State;
  clock: { now: number };
  handle: EntryHandle;
  notes: [string, number | undefined][];
  notices: string[];
  closed: () => boolean;
  all: (selector: string) => HTMLElement[];
  text: () => string;
  button: (name: string) => HTMLButtonElement;
  click: (element: Element) => Promise<void>;
  /** 勾選框，照列的字找。 */
  box: (label: string) => HTMLInputElement;
  /** 打字到日期欄，離開欄位。 */
  type: (name: '考試開始' | '考試結束', value: string, leave?: boolean) => Promise<void>;
  field: (name: '考試開始' | '考試結束') => HTMLInputElement;
  /** 範圍檔的內容；沒有是 null。 */
  scope: () => string | null;
  settle: () => Promise<void>;
}

async function open(t: TestContext, texts: Record<string, string>, screen: 'entry' | 'catalog' | 'scope' = 'scope', setup?: (memory: MemoryFiles) => void): Promise<Screen> {
  const memory = createMemoryFiles(texts);
  setup?.(memory);
  const clock = { now: NOW };
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: false, stuckAfter: 20, now: () => clock.now, offset: () => 480, onError() {} });
  t.after(() => state.close());
  await state.ready();
  const notes: [string, number | undefined][] = [], notices: string[] = [];
  let closed = false;
  const app = { loadLocalStorage: () => null, saveLocalStorage() {} } as unknown as App;
  let handle!: EntryHandle;
  await act(async () => {
    handle = openEntry({
      app, state: () => state, screen, reminders: false, covered: () => false,
      start() {}, openNote: (path, line) => { notes.push([path, line]); }, openSettings() {},
      notify: message => { notices.push(message); },
      onClose: () => { closed = true; },
    });
    await Promise.resolve();
  });
  t.after(async () => { await act(async () => { handle.close(); await Promise.resolve(); }); });
  // 同一個測試可能開好幾個：看最後開的那一個。
  const root = (): Element => {
    const found = Array.from(document.querySelectorAll('.ec-fullscreen')).at(-1);
    assert.ok(found, '入口開著');
    return found;
  };
  const all = (selector: string): HTMLElement[] => Array.from(root().querySelectorAll<HTMLElement>(selector));
  const settle = async (): Promise<void> => { await act(async () => { await wait(10); }); };
  const setValue = async (input: HTMLInputElement, value: string): Promise<void> => {
    await act(async () => {
      setNative(input, value);
      input.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
      await Promise.resolve();
    });
  };
  const field = (name: string): HTMLInputElement => {
    const found = all('input[type="text"]').find(each => each.getAttribute('aria-label') === name);
    assert.ok(found, '找不到日期欄 ' + name);
    return found as HTMLInputElement;
  };
  return {
    ...memory, state, clock, handle, notes, notices, closed: () => closed, all, settle,
    text: () => root().textContent ?? '',
    button(name) {
      const found = all('button').find(button => button.textContent === name || button.getAttribute('aria-label') === name);
      assert.ok(found, '找不到按鈕「' + name + '」：' + all('button').map(button => button.textContent).join('、'));
      return found as HTMLButtonElement;
    },
    click: async element => { await act(async () => { (element as HTMLElement).click(); await wait(5); }); },
    box(label) {
      const row = all('.ec-sc-u').find(each => each.querySelector('.ec-sc-name span')?.textContent === label);
      const input = row?.querySelector('input');
      assert.ok(input, '找不到勾選框 ' + label + '：' + all('.ec-sc-u').map(each => each.textContent).join('、'));
      return input;
    },
    field,
    async type(name, value, leave = true) {
      const input = field(name);
      await setValue(input, value);
      if (leave) await act(async () => { input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }) as unknown as Event); await Promise.resolve(); });
    },
    scope() {
      const found = [...memory.texts.keys()].filter(path => path.startsWith(FOLDER)).sort();
      return found.length ? memory.texts.get(found[0]) ?? null : null;
    },
  };
}
const boxes = (s: Screen): [string, boolean][] => s.all('.ec-sc-u').map(row => [row.querySelector('.ec-sc-name span')?.textContent ?? '', row.querySelector('input')?.checked ?? false]);

// ── §6 進出 ──

void test('§6 從入口進來回入口，從目錄進來回目錄；返回、✕、Esc 都一樣', async t => {
  const s = await open(t, DECKS, 'entry');
  await s.click(s.button('考試範圍與日期還沒設定'));
  assert.ok(s.text().includes('勾選這次要考的單元'));
  await s.click(s.button('返回'));
  assert.ok(s.text().includes('今日複習'));
  await s.click(s.button('目錄'));
  await s.click(s.button('考試範圍與日期還沒設定'));
  await s.click(s.button('關閉考試範圍'));
  assert.ok(s.all('.ec-seg').length > 0, '回到目錄');
  await s.click(s.button('考試範圍與日期還沒設定'));
  await act(async () => { s.all('.ec-entry')[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }) as unknown as Event); await Promise.resolve(); });
  assert.ok(s.all('.ec-seg').length > 0, 'Esc 回到目錄');
  assert.equal(s.closed(), false);
});

// ── §6 預先勾選 ──

const answer = (lt: string, iso: string): string => encodeEntry(iso, { lt, r: 'good', v: 'x' }) + '\n';
const LOG = 'Essence Cards/紀錄/2026-09 iPhone-test.jsonl';

void test('§6 預先勾選：最近 6 週內才第一次作答的勾、更早作答過的不勾、還沒作答的勾、舊學期的不勾', async t => {
  const s = await open(t, { ...DECKS, [LOG]: answer('a', '2026-08-01T12:00:00.000+08:00') + answer('a', '2026-10-01T12:00:00.000+08:00') + answer('b', '2026-10-01T12:00:00.000+08:00') + answer('o', '2026-10-01T12:00:00.000+08:00') });
  assert.deepEqual(boxes(s), [['2 全部', false], ['2-1 水溶液', false], ['2-2', true], ['2-3', true], ['L1', true]]);
  assert.ok(!s.text().includes('1-1'), '舊學期收著');
  await s.click(s.button('國一下'));
  assert.equal(s.box('1-1').checked, false);
});

void test('§6 預先勾選：有上一份時看它結束之後；提前結束的上一份用提前結束那天；生效的那一份勾的是它自己', async t => {
  const past = scopeText('2026-09-20', '2026-09-21', '- 國一下 自然 1-1');
  const before = answer('a', '2026-09-21T12:00:00.000+08:00'), after = answer('b', '2026-09-22T12:00:00.000+08:00');
  const a = await open(t, { ...DECKS, [FOLDER + 'old.md']: past, [LOG]: before + after });
  assert.deepEqual(boxes(a).filter(([, on]) => on).map(([label]) => label), ['2-2', '2-3', 'L1'], '結束當天作答的不勾；之後的勾');
  const ended = '---\n識別碼: s2\n考試開始: 2026-12-01\n提前結束: 2026-09-10\n---\n- 國一下 自然 1-1\n';
  const b = await open(t, { ...DECKS, [FOLDER + 'old.md']: ended, [LOG]: answer('a', '2026-09-09T12:00:00.000+08:00') + answer('b', '2026-09-11T12:00:00.000+08:00') });
  assert.deepEqual(boxes(b).filter(([, on]) => on).map(([label]) => label), ['2-2', '2-3', 'L1']);
  const c = await open(t, { ...DECKS, [FOLDER + 'now.md']: scopeText('2026-10-28', '', '- 國二上 自然 2-2') });
  assert.deepEqual(boxes(c).filter(([, on]) => on).map(([label]) => label), ['2-2'], '有生效的範圍時勾的是那一份');
  assert.ok(!c.text().includes('已經先勾好'));
});

// ── §6 勾選 ──

void test('§6 勾選、取消；「2 全部」與底下互相連動；沒有下一層的不多一列；存成新檔', async t => {
  const s = await open(t, DECKS);
  assert.ok(!boxes(s).some(([label]) => label === 'L 全部' || label === 'L1 全部'));
  await s.click(s.box('2 全部'));
  assert.deepEqual(boxes(s).slice(0, 4).map(([, on]) => on), [true, true, true, true]);
  await s.click(s.box('2-2'));
  assert.deepEqual(boxes(s).slice(0, 4).map(([, on]) => on), [false, true, false, true], '取消底下一個，整章也不算');
  await s.click(s.box('2-1 水溶液'));
  await s.click(s.box('2-2'));
  await s.click(s.box('2-1 水溶液'));
  assert.deepEqual(boxes(s).slice(0, 4).map(([, on]) => on), [false, true, true, true], '底下全部一個一個勾，不會變成整章');
  await s.click(s.button('確定'));
  await s.settle();
  assert.deepEqual(s.notices, ['考試範圍已設定']);
  const text = s.scope() ?? '';
  assert.match(text, /- 國二上 自然 2-1\n- 國二上 自然 2-2\n- 國二上 自然 2-3\n/);
  assert.match(text, /- 國二上 英文 L1\n/);
  assert.ok(!/- 國二上 自然 2\n/.test(text));
});

void test('§6 勾整章寫一行；再取消其中一個，那一行換成其餘的單元；存完入口與目錄跟著變', async t => {
  const s = await open(t, DECKS, 'entry');
  assert.ok(s.text().includes('還沒設定'));
  await s.click(s.button('考試範圍與日期還沒設定'));
  await s.click(s.box('L1'));
  await s.click(s.box('2 全部'));
  await s.click(s.button('確定'));
  await s.settle();
  assert.match(s.scope() ?? '', /^- 國二上 自然 2$/m);
  assert.deepEqual(s.all('.ec-sc-line').map(each => each.textContent), ['自然2 全部']);
  assert.ok(s.text().includes('日期未定'));
  await s.click(s.all('.ec-sc-row')[0]);
  assert.equal(s.box('2 全部').checked, true);
  await s.click(s.box('2-2'));
  await s.click(s.button('確定'));
  await s.settle();
  const text = s.scope() ?? '';
  assert.match(text, /^- 國二上 自然 2-1\n- 國二上 自然 2-3$/m);
  assert.ok(!/^- 國二上 自然 2$/m.test(text));
  assert.deepEqual(s.all('.ec-sc-line').map(each => each.textContent), ['自然2-1、2-3']);
});

void test('§6 存完入口與目錄的數字變了：考前提高保持率，今天多一張，目錄的當日卡也是', async t => {
  const s = await open(t, { 'Essence Cards/自然 2-1.md': head('國二上', '自然', '2-1') + targets('a'), [LOG]: answer('a', '2026-10-13T12:00:00.000+08:00') }, 'entry');
  assert.ok(s.text().includes('今天沒有要複習的卡'));
  await s.click(s.button('考試範圍與日期還沒設定'));
  assert.equal(s.box('2-1').checked, true, '最近學的');
  await s.type('考試開始', '2026-10-20');
  await s.click(s.button('確定'));
  await s.settle();
  assert.match(s.text(), /今日複習0\/1/);
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '距離考試：4 天');
  await s.click(s.button('目錄'));
  await s.click(s.all('.ec-tr-name')[0]);
  assert.deepEqual(s.all('.ec-u-btn').map(each => each.textContent), ['當日卡 1', '全部卡 1']);
});

void test('§6 沒勾任何單元不能按；範圍檔寫到、沒有卡組的單元列在最後、勾著，可以取消', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('', '', '- 國二上 自然 9-9', '- 國二上 自然 2-1') });
  assert.equal(s.box('9-9').checked, true);
  assert.ok(s.all('.ec-sc-u').find(row => row.textContent.includes('9-9'))?.textContent.includes('還沒有卡組'));
  await s.click(s.box('9-9'));
  await s.click(s.box('2-1 水溶液'));
  assert.equal(s.button('確定').disabled, true);
  await s.click(s.box('2-2'));
  assert.equal(s.button('確定').disabled, false);
  await s.click(s.button('確定'));
  await s.settle();
  assert.ok(!(s.scope() ?? '').includes('9-9'));
  assert.ok((s.scope() ?? '').includes('- 國二上 自然 2-2'));
});

void test('§6 看不懂的行與分類行看得到，存別的不動它們', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('', '', '老師說第三節不考', '分類：醫學', '- 國二上 自然 2-1') });
  assert.ok(s.text().includes('老師說第三節不考'));
  assert.ok(s.text().includes('這一行看不懂，不會算進範圍，會留著；一行只寫一個編號'));
  assert.ok(s.text().includes('這一行目前不支援'));
  await s.click(s.box('2-2'));
  await s.click(s.button('確定'));
  await s.settle();
  const text = s.scope() ?? '';
  assert.ok(text.includes('老師說第三節不考') && text.includes('分類：醫學') && text.includes('- 國二上 自然 2-2'));
});

// ── §6 日期 ──

void test('§6 日期的四種寫法離開欄位都換成標準格式，存進去也是', async t => {
  const s = await open(t, DECKS);
  for (const raw of ['2026-10-28', '2026/10/28', '20261028', '2026.10.28']) {
    await s.type('考試開始', raw);
    assert.equal(s.field('考試開始').value, '2026-10-28', raw);
  }
  await s.type('考試結束', '2026/10/29', false);
  await s.click(s.button('確定'));
  await s.settle();
  assert.match(s.scope() ?? '', /考試開始: 2026-10-28\n考試結束: 2026-10-29\n/);
});

void test('§6 三種錯誤各擋一次、確定不能按；改好後紅字當場消失', async t => {
  const s = await open(t, DECKS);
  const blocked = (word: string): void => {
    assert.ok(s.text().includes(word), word);
    assert.equal(s.button('確定').disabled, true);
  };
  await s.type('考試開始', '2026-13-01');
  blocked('這個日期不存在');
  assert.equal(s.field('考試開始').value, '2026-13-01', '看不懂的留原字');
  await s.type('考試開始', '10/28');
  blocked('看不懂這個日期，請寫西元年，例如 2026-10-28');
  await s.type('考試開始', '115/10/28');
  blocked('看不懂這個日期，請寫西元年，例如 2026-10-28');
  await s.type('考試開始', '2026-10-29');
  await s.type('考試結束', '2026-10-28');
  blocked('開始日不能晚於結束日');
  await s.type('考試結束', '2026-10-29');
  assert.ok(!s.text().includes('開始日不能晚於結束日'));
  assert.equal(s.button('確定').disabled, false, '同一天可以');
  assert.equal(s.all('.ec-sc-word.is-bad').length, 0);
});

void test('§6 過去的日期能存、寫灰字；只填開始時看開始日；存完通知不會生效', async t => {
  const s = await open(t, DECKS);
  await s.type('考試開始', '2026-10-15');
  assert.ok(s.text().includes('這個日期已經過了，不會排進今天的複習'));
  assert.equal(s.button('確定').disabled, false);
  await s.type('考試結束', '2026-10-16');
  assert.ok(!s.text().includes('這個日期已經過了'), '結束日是今天：還沒過');
  await s.type('考試結束', '2026-10-15');
  await s.click(s.button('確定'));
  await s.settle();
  assert.deepEqual(s.notices, ['已存，這個日期已經過了，不會生效']);
  assert.match(s.scope() ?? '', /考試開始: 2026-10-15\n考試結束: 2026-10-15\n/);
});

void test('§6 點日曆圖示選的日期填回文字欄；清空日期就拿掉那一行', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '2026-10-29', '- 國二上 自然 2-1') });
  assert.equal(s.field('考試開始').value, '2026-10-28');
  const picker = s.all('input[type="date"]')[1] as HTMLInputElement;
  assert.equal(picker.value, '2026-10-29');
  await act(async () => {
    setNative(picker, '2026-10-30');
    picker.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
    await Promise.resolve();
  });
  assert.equal(s.field('考試結束').value, '2026-10-30');
  await s.type('考試開始', '');
  await s.click(s.button('確定'));
  await s.settle();
  const text = s.scope() ?? '';
  assert.ok(!text.includes('考試開始'));
  assert.match(text, /考試結束: 2026-10-30\n/);
});

void test('§6 寫不進去：留在畫面上寫原因，已勾的不丟', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: '---\n考試開始: [\n---\n- 國二上 自然 2-1\n' });
  await s.click(s.box('2-2'));
  await s.click(s.button('確定'));
  await s.settle();
  assert.ok(s.text().includes('範圍檔的屬性區寫壞了，或不是一行一個屬性，請先修好再設定'));
  assert.equal(s.box('2-2').checked, true);
  assert.deepEqual(s.notices, []);
});

void test('§6 寫法特殊的單元灰掉寫原因，不能用勾選加入；勾整章再取消一個也不會寫它', async t => {
  const s = await open(t, { ...DECKS, 'Essence Cards/怪.md': head('國二上', '自然', '2-9,3') + targets('x') });
  const row = s.all('.ec-sc-u').find(each => each.textContent.includes('2-9,3'));
  assert.ok(row?.textContent.includes('這個單元的屬性寫法特殊，不能用勾選加入'));
  assert.equal(row?.querySelector('input')?.disabled, true);
  await s.click(s.box('2 全部'));
  await s.click(s.box('2-1 水溶液'));
  await s.click(s.button('確定'));
  await s.settle();
  assert.ok(!(s.scope() ?? '').includes('2-9,3'));
});

void test('§6 範圍檔讀不到：寫暫時讀不到、存不了，已勾的不丟', async t => {
  const path = FOLDER + 'a.md';
  const s = await open(t, { ...DECKS, [path]: scopeText('2026-10-28', '', '- 國二上 自然 2-1') }, 'entry', memory => { memory.failing.add(path); });
  assert.equal(s.all('.ec-sc-per')[0].textContent, '暫時讀不到');
  assert.ok(!s.text().includes('還沒設定'), '不知道不是沒有');
  await s.click(s.all('.ec-sc-row')[0]);
  assert.ok(s.text().includes('考試範圍暫時讀不到，等一下再試'));
  await s.click(s.box('2-2'));
  const before = s.box('2-2').checked;
  await s.click(s.button('確定'));
  await s.settle();
  assert.equal(s.all('.ec-sc-word.is-bad')[0]?.textContent, '考試範圍暫時讀不到，等一下再試');
  assert.equal(s.box('2-2').checked, before);
  assert.deepEqual(s.notices, []);
});

void test('§7 另一份讀不到時：看得到的那一份照常，多一行', async t => {
  const broken = FOLDER + 'b.md';
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '', '- 國二上 自然 2-1'), [broken]: scopeText('2026-11-01', '', '- 國二上 自然 2-2') }, 'entry', memory => { memory.failing.add(broken); });
  assert.equal(s.all('.ec-sc-per')[0].textContent, '10/28');
  assert.deepEqual(s.all('.ec-sc-note.is-warn').map(each => each.textContent), ['有 1 份暫時讀不到']);
});

void test('§4 一份卡住、另一份讀到：入口用讀到的，多寫「有 1 份暫時讀不到」；設定畫面存不了', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '', '- 國二上 自然 2-1'), [FOLDER + 'b.md']: scopeText('2026-10-20', '', '- 國二上 英文 L1') }, 'entry', memory => { memory.holdRead(FOLDER + 'b.md'); });
  await act(async () => { await wait(40); });
  assert.equal(s.all('.ec-sc-per')[0].textContent, '10/28');
  assert.deepEqual(s.all('.ec-sc-note.is-warn').map(each => each.textContent), ['有 1 份暫時讀不到']);
  await s.click(s.all('.ec-sc-row')[0]);
  await s.click(s.box('2-2'));
  await s.click(s.button('確定'));
  await s.settle();
  assert.equal(s.all('.ec-sc-word.is-bad')[0]?.textContent, '考試範圍暫時讀不到，等一下再試');
});

void test('§6 畫面開著時範圍檔被刪：寫原因，不把變動寫成一份新檔；重新打開才是新的', async t => {
  const path = FOLDER + 'a.md';
  const s = await open(t, { ...DECKS, [path]: scopeText('2026-10-28', '', '- 國二上 自然 2-1') });
  await s.click(s.box('2-2'));
  await act(async () => { s.remove(path); await wait(30); });
  assert.equal(s.box('2-2').checked, true, '動過之後不跟著變');
  await s.click(s.button('確定'));
  await s.settle();
  assert.equal(s.all('.ec-sc-word.is-bad')[0]?.textContent, '範圍檔被改名、刪除或已經結束，請重新打開這個畫面');
  assert.equal(s.scope(), null);
  await s.click(s.button('返回'));
  await s.click(s.all('.ec-sc-row')[0]);
  assert.ok(s.text().includes('已經先勾好'));
});

void test('§6 還沒動的時候跟著最新的：別處改了範圍，勾選跟著變；還有另一份生效時寫出來', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '', '- 國二上 自然 2-1') });
  assert.equal(s.box('2-2').checked, false);
  await act(async () => { s.write(FOLDER + 'a.md', scopeText('2026-10-28', '', '- 國二上 自然 2-2')); await wait(30); });
  assert.equal(s.box('2-2').checked, true);
  assert.equal(s.box('2-1 水溶液').checked, false);
  await act(async () => { s.write(FOLDER + 'b.md', scopeText('2026-11-01', '', '- 國二上 英文 L1').replace('識別碼: s1', '識別碼: s2')); await wait(30); });
  assert.ok(s.text().includes('還有另一份也生效：' + FOLDER + 'b.md'));
});

// ── §6 結束 ──

void test('§6 結束這次考試：有生效的範圍才有，第二下才生效，回到原處；之後再設定是新檔', async t => {
  const none = await open(t, DECKS);
  assert.ok(!none.text().includes('結束這次考試'));
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '', '- 國二上 自然 2-1') }, 'entry');
  assert.ok(s.text().includes('距離考試：12 天'));
  await s.click(s.all('.ec-sc-row')[0]);
  await s.click(s.button('結束這次考試'));
  assert.ok(!(s.scope() ?? '').includes('提前結束'), '第一下不生效');
  await s.click(s.button('再按一次結束這次考試'));
  await s.settle();
  assert.deepEqual(s.notices, ['這次考試已結束']);
  assert.match(s.scope() ?? '', /提前結束: 2026-10-16\n/);
  assert.ok(s.text().includes('還沒設定'), '回到入口');
  assert.ok(!s.text().includes('距離考試'));
});

// ── §7 入口 ──

void test('§6 別處同時把結束日改得更早：寫原因、留在畫面上，打的日期不丟', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-21', '2026-10-28', '- 國二上 自然 2-1') });
  await s.type('考試開始', '2026-10-27');
  s.texts.set(FOLDER + 'a.md', scopeText('2026-10-21', '2026-10-25', '- 國二上 自然 2-1'));
  await s.click(s.button('確定'));
  await s.settle();
  assert.equal(s.all('.ec-sc-word.is-bad')[0]?.textContent, '別處改了日期，開始日會晚於結束日，這次沒有存；請重新打開這個畫面');
  assert.equal(s.field('考試開始').value, '2026-10-27');
  assert.ok(s.scope()?.includes('考試開始: 2026-10-21'));
});

void test('§6 整章裡有寫法特殊的單元：只取消別節時寫原因、不存；連它一起取消就存得進去', async t => {
  const s = await open(t, { ...DECKS, 'Essence Cards/自然 特殊.md': head('國二上', '自然', '2-9,3') + targets('z'), [FOLDER + 'a.md']: scopeText('', '', '- 國二上 自然 2') });
  const before = s.scope();
  await s.click(s.box('2-1 水溶液'));
  await s.click(s.button('確定'));
  await s.settle();
  assert.equal(s.all('.ec-sc-word.is-bad')[0]?.textContent, '「2-9,3」的編號寫法特殊，範圍檔寫不出來，不能只取消這一章的一部分：請留著整章，或連它一起取消');
  assert.equal(s.scope(), before);
  assert.equal(s.box('2-1 水溶液').checked, false, '已勾的不丟');
  await s.click(s.box('2-9,3'));
  await s.click(s.button('確定'));
  await s.settle();
  assert.equal(s.scope(), '---\n識別碼: s1\n---\n- 國二上 自然 2-2\n- 國二上 自然 2-3\n');
});

void test('§7 入口：倒數只有範圍寫到的科目、數字粗體；期間；一科一行；範圍外的科目沒有', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '2026-10-29', '- 國二上 自然 2-1', '- 國二上 自然 2-2') }, 'entry');
  assert.deepEqual(s.all('.ec-sb').map(row => [row.querySelector('.ec-en-name')?.textContent, row.querySelector('.ec-sb-ex')?.textContent ?? null]), [['自然', '距離考試：12 天'], ['英文', null]]);
  assert.equal(s.all('.ec-sb-ex b')[0].textContent, '12');
  assert.equal(s.all('.ec-sc-per')[0].textContent, '10/28～10/29');
  assert.deepEqual(s.all('.ec-sc-line').map(each => each.textContent), ['自然2-1～2-2']);
  assert.ok(s.text().includes('自然 2-3 不在範圍內'), '排在範圍後面的單元');
});

void test('§7 倒數跟著時間：10/27 寫 1 天；10/28 04:00 起今天考試；03:59 還算前一天；結束日隔天 04:00 全部消失', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '', '- 國二上 自然 2-1') }, 'entry');
  const at = async (iso: string): Promise<void> => { s.clock.now = Date.parse(iso); s.handle.refresh(); await s.settle(); };
  await at('2026-10-27T12:00:00.000+08:00');
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '距離考試：1 天');
  await at('2026-10-28T03:59:00.000+08:00');
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '距離考試：1 天');
  await at('2026-10-28T04:00:00.000+08:00');
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '今天考試');
  await at('2026-10-29T03:59:00.000+08:00');
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '今天考試');
  await at('2026-10-29T04:00:00.000+08:00');
  assert.equal(s.all('.ec-sb-ex').length, 0);
  assert.ok(s.text().includes('還沒設定'));
});

void test('§4 §7 開著跨過清晨 4 點：沒有通知、沒有切回前景，倒數自己換成新的一天；關掉之後不再看', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '', '- 國二上 自然 2-1') }, 'entry');
  const minute = async (iso: string): Promise<void> => { s.clock.now = Date.parse(iso); t.mock.timers.tick(60_000); await s.settle(); };
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '距離考試：12 天');
  await minute('2026-10-28T03:59:00.000+08:00');
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '距離考試：1 天');
  await minute('2026-10-28T04:00:00.000+08:00');
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '今天考試');
  await minute('2026-10-29T03:59:00.000+08:00');
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '今天考試');
  await minute('2026-10-29T04:00:00.000+08:00');
  assert.equal(s.all('.ec-sb-ex').length, 0);
  assert.ok(s.text().includes('還沒設定'));
  let asked = 0;
  const exam = s.state.exam.bind(s.state);
  s.state.exam = () => { asked++; return exam(); };
  await minute('2026-10-29T12:00:00.000+08:00');
  assert.ok(asked > 0, '開著的時候每分鐘看一次');
  await act(async () => { s.handle.close(); await Promise.resolve(); });
  asked = 0;
  await minute('2026-10-30T12:00:00.000+08:00');
  assert.equal(asked, 0, '關掉之後不再看');
});

void test('§4 背景跨過清晨 4 點回來：是新的一天', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '', '- 國二上 自然 2-1') }, 'entry');
  s.clock.now = Date.parse('2026-10-28T04:00:00.000+08:00');
  await act(async () => { document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event); await Promise.resolve(); });
  await s.settle();
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '今天考試');
});

void test('§6 開著設定畫面跨過清晨 4 點：灰字自己出現；還沒重畫就按確定，通知也用當下的日子', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('', '', '- 國二上 自然 2-1') });
  await s.type('考試開始', '2026-10-27');
  s.clock.now = Date.parse('2026-10-27T12:00:00.000+08:00');
  t.mock.timers.tick(60_000);
  await s.settle();
  const gray = '這個日期已經過了，不會排進今天的複習';
  assert.equal(s.text().includes(gray), false);
  s.clock.now = Date.parse('2026-10-28T04:00:00.000+08:00');
  t.mock.timers.tick(60_000);
  await s.settle();
  assert.ok(s.text().includes(gray), '不用切換畫面');
  assert.equal(s.field('考試開始').value, '2026-10-27', '打的字不丟');

  const late = await open(t, { ...DECKS, [FOLDER + 'b.md']: scopeText('', '', '- 國二上 自然 2-1') });
  await late.type('考試開始', '2026-10-27');
  late.clock.now = Date.parse('2026-10-28T04:00:00.000+08:00');
  await late.click(late.button('確定'));
  await late.settle();
  assert.deepEqual(late.notices, ['已存，這個日期已經過了，不會生效'], '還沒到下一次檢查就按確定');
});

void test('§7 日期未定、日期有問題：列照常、不倒數；有問題多一行行數；範圍裡有的科目今天沒有卡，範圍那一列照常', async t => {
  const a = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('', '', '- 國二上 自然 2-1') }, 'entry');
  assert.equal(a.all('.ec-sc-per')[0].textContent, '日期未定');
  assert.equal(a.all('.ec-sb-ex').length, 0);
  const b = await open(t, { ...DECKS, [FOLDER + 'a.md']: '---\n考試開始: 2026-13-01\n---\n- 國二上 自然 2-1\n老師說的\n- 國二上 理化 9-9\n' }, 'entry');
  assert.equal(b.all('.ec-sc-per')[0].textContent, '考試日期有問題');
  assert.equal(b.all('.ec-sb-ex').length, 0);
  assert.deepEqual(b.all('.ec-sc-note.is-warn').map(each => each.textContent), ['有 1 行看不懂', '有 1 行對不到卡組']);
  assert.deepEqual(b.all('.ec-sc-line').map(each => each.textContent), ['自然2-1', '理化9-9']);
  assert.ok(!b.all('.ec-sb .ec-en-name').some(each => each.textContent === '理化'));
});

void test('考試範圍/小考/ 裡壞掉的檔（D-189）：入口、目錄、設定畫面都和沒有這份一樣；放在外面才算', async t => {
  const broken = '---\n考試開始: 2026-13-01\n---\n老師說的\n';
  const outside = await open(t, { ...DECKS, [FOLDER + '壞.md']: broken }, 'entry');
  assert.equal(outside.all('.ec-sc-per')[0].textContent, '考試日期有問題', '同一份在外面就有問題');
  for (const screen of ['entry', 'catalog'] as const) {
    const s = await open(t, { ...DECKS, [FOLDER + '小考/壞.md']: broken }, screen);
    assert.ok(s.text().includes('還沒設定'), screen);
    assert.ok(!s.text().includes('考試日期有問題'), screen);
    assert.ok(!s.text().includes('看不懂'), screen);
  }
  const form = await open(t, { ...DECKS, [FOLDER + '小考/壞.md']: broken }, 'scope');
  assert.ok(!form.text().includes('考試日期有問題'));
  assert.ok(!form.text().includes('看不懂'));
  assert.equal(form.field('考試開始').value, '', '當成新的一份');
});

void test('§7 別台裝置改了範圍，開著的入口自己更新', async t => {
  const s = await open(t, { ...DECKS, [FOLDER + 'a.md']: scopeText('2026-10-28', '', '- 國二上 自然 2-1') }, 'entry');
  assert.ok(s.text().includes('距離考試：12 天'));
  await act(async () => { s.write(FOLDER + 'a.md', scopeText('2026-10-20', '', '- 國二上 自然 2-2')); await wait(30); });
  assert.equal(s.all('.ec-sb-ex')[0].textContent, '距離考試：4 天');
  assert.deepEqual(s.all('.ec-sc-line').map(each => each.textContent), ['自然2-2']);
  await act(async () => { s.write(FOLDER + 'a.md', scopeText('2026-10-20', '', '- 國二上 自然 2-2', '看不懂的')); await wait(30); });
  assert.deepEqual(s.all('.ec-sc-note.is-warn').map(each => each.textContent), ['有 1 行看不懂']);
});

// ── §7 目錄 ──

void test('§7 目錄：同一列；單元的「考試」標籤可以和草稿同時有；科目標題旁的倒數只有範圍寫到的學期與科目', async t => {
  const s = await open(t, {
    ...DECKS,
    'Essence Cards/草稿.md': head('國二上', '自然', '2-4', '狀態: 草稿\n') + targets('d'),
    [FOLDER + 'a.md']: scopeText('2026-10-28', '2026-10-29', '- 國二上 自然 2'),
  }, 'catalog');
  assert.equal(s.all('.ec-sc-per')[0].textContent, '10/28～10/29');
  const tags = s.all('.ec-tr-u').map(row => [row.querySelector('.ec-tr-name span')?.textContent, Array.from(row.querySelectorAll('.ec-tr-tag')).map(tag => tag.textContent)]);
  assert.deepEqual(tags, [['2-1 水溶液', ['考試']], ['2-2', ['考試']], ['2-3', ['考試']], ['2-4', ['考試', '草稿']], ['L1', []]]);
  assert.deepEqual(s.all('.ec-tr-sh').map(each => [each.querySelector('h2')?.textContent, each.querySelector('.ec-tr-ex')?.textContent ?? null]), [['自然', '距離考試：12 天（10/28）'], ['英文', null]]);
  await act(async () => { s.write(FOLDER + 'a.md', scopeText('2026-10-28', '2026-10-29', '- 國二上 自然 2', '老師說的', '- 國二上 理化 9-9')); await wait(30); });
  assert.deepEqual(s.all('.ec-sc-note.is-warn').map(each => each.textContent), ['有 1 行看不懂', '有 1 行對不到卡組'], '§2-6 的行數，目錄也有');
  s.clock.now = Date.parse('2026-10-28T05:00:00.000+08:00');
  s.handle.refresh();
  await s.settle();
  assert.equal(s.all('.ec-tr-ex')[0].textContent, '今天考試');
});

// ── §8 ──

const CROSS = {
  ...DECKS,
  'Essence Cards/小四.md': head('小四上', '自然', '2-1') + '- 溶解 ^low\n    - 出處：國二上 2-2 p.3\n    - 問 :: 答\n',
  'Essence Cards/不確定.md': head('國二上', '自然', '2-3') + '- 溫度影響溶解度 ^unsure\n    - 出處：1-3 p.20\n    - 問 :: 答\n',
};

void test('§8 兩行隨著勾選變；點開列名稱與原因；點了打開那一行；不擋確定', async t => {
  const s = await open(t, { ...CROSS, [FOLDER + 'a.md']: scopeText('', '', '- 國二上 自然 2-1') });
  assert.ok(!s.text().includes('來自別的單元'));
  assert.ok(s.text().includes('1 個出處還不確定'));
  await s.click(s.box('2-2'));
  const from = s.button('這次範圍裡有 1 個目標來自別的單元');
  await s.click(from);
  assert.ok(s.text().includes('〈溶解〉：來自小四上 2-1'));
  await s.click(s.button('1 個出處還不確定'));
  const item = s.all('.ec-sc-item').find(each => each.textContent.includes('溫度影響溶解度'));
  assert.equal(item?.textContent, '第 6 行〈溫度影響溶解度〉：1-3 p.20（可能少算）');
  assert.equal(s.button('確定').disabled, false);
  assert.ok(item);
  await s.click(item);
  assert.deepEqual(s.notes, [['Essence Cards/不確定.md', 5]]);
  await s.settle();
  await s.click(s.box('2-2'));
  assert.ok(!s.text().includes('來自別的單元'), '取消後那一行消失');
});

void test('§8 超過 20 列：寫另有幾個，總數是實際的數字', async t => {
  const many: Record<string, string> = {};
  for (let i = 0; i < 25; i++) many[`Essence Cards/低 ${String(i)}.md`] = head('小四上', '自然', `3-${String(i)}`) + `- 目標 ${String(i)} ^m${String(i)}\n    - 出處：國二上 2-1 p.3\n    - 問 :: 答\n`;
  const s = await open(t, { ...DECKS, ...many, [FOLDER + 'a.md']: scopeText('', '', '- 國二上 自然 2-1') });
  await s.click(s.button('這次範圍裡有 25 個目標來自別的單元'));
  assert.equal(s.all('.ec-sc-item').length, 20);
  assert.ok(s.text().includes('另有 5 個'));
});

void test('搬出 小考/ 的小考檔（D-189）：入口與目錄都沒有提示；對照的段考檔照樣寫日期未定', async t => {
  const quizzes = Object.fromEntries(['2026-11-05', '', '明天'].map((date, index) => [`${FOLDER}小考${String(index)}.md`, `---\n識別碼: q4m8t2\n小考日期: ${date}\n---\n- 國二上 英文 L1\n`]));
  for (const screen of ['entry', 'catalog'] as const) {
    const only = await open(t, { ...DECKS, ...quizzes }, screen);
    assert.ok(only.text().includes('還沒設定'), screen);
    assert.ok(!only.text().includes('日期未定'), screen);
    assert.ok(!only.text().includes('考試日期有問題'), screen);
    const mixed = await open(t, { ...DECKS, ...quizzes, [FOLDER + 'a.md']: scopeText('', '', '- 國二上 自然 2-1') }, screen);
    assert.equal(mixed.all('.ec-sc-per')[0].textContent, '日期未定', screen);
    assert.deepEqual(mixed.all('.ec-sc-line').map(each => each.textContent), ['自然2-1'], screen);
  }
});
