import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { setTimeout as wait } from 'node:timers/promises';
import { installDom } from './helpers/dom.ts';

// 點看不懂的出處 → 表單 → 套用，走到 CodeMirror 的交易（tasks/edit-markup.md §2 第 1 點、§4-3；L2 第一輪 R2、R6）：
// 真的 EditorView 加 happy-dom，Obsidian 加在 HTMLElement 上的建立元素函式用最小的替身。版面與滑鼠在開發命令 markup 驗。

installDom();
type Options = { cls?: string; text?: string; attr?: Record<string, string>; value?: string };
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
function createEl(this: HTMLElement, tag: string, options: Options = {}): HTMLElement {
  const element = document.createElement(tag);
  if (options.cls) element.className = options.cls;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
  if (options.value !== undefined) (element as HTMLInputElement).value = options.value;
  this.append(element);
  return element;
}
proto.createEl = createEl;
proto.createDiv = function (this: HTMLElement, options?: Options) { return createEl.call(this, 'div', options); };
proto.createSpan = function (this: HTMLElement, options?: Options) { return createEl.call(this, 'span', options); };
proto.empty = function (this: HTMLElement) { this.replaceChildren(); };
proto.setText = function (this: HTMLElement, text: string) { this.textContent = text; };
proto.appendText = function (this: HTMLElement, text: string) { this.append(text); };
proto.addClass = function (this: HTMLElement, name: string) { this.classList.add(name); };
proto.toggleClass = function (this: HTMLElement, name: string, on: boolean) { this.classList.toggle(name, on); };
(globalThis as Record<string, unknown>).activeDocument = document;

const { EditorState } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');
const { parseDeck } = await import('../src/core/deck/index.ts');
const { unreadableSources } = await import('../src/ui/sources.ts');
const { openUnreadableSourceForm } = await import('../src/obsidian/source-entry.ts');
const { closeSourceForm } = await import('../src/obsidian/source-form.ts');

const app = { metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null } } as unknown as App;
const entry = { state: null, version: '0.4.0', fail: (error: Error) => { throw error; } };
const hitsOf = (text: string) => unreadableSources(app, '卡組/本篇.md', parseDeck(text, { layout: true }), () => []);
const form = (): HTMLElement => { const box = document.querySelector<HTMLElement>('.essence-cards-source-form'); assert.ok(box, '表單沒有打開'); return box; };
const button = (text: string): HTMLButtonElement => Array.from(form().querySelectorAll('button')).find(each => each.textContent === text)!;
const reason = (): string => form().querySelector('.essence-cards-source-form-reason')?.textContent ?? '';
/** 清空「說明」，等表單停止打字後的核對（150 ms），再按「套用」：表單把 `老師說過 p.44` 預填成 p.44 加說明。 */
async function clearRemarkAndApply(): Promise<void> {
  const remark = form().querySelector<HTMLInputElement>('input[aria-label="說明（選填）"]')!;
  remark.value = '';
  remark.dispatchEvent(new Event('input'));
  await wait(300);
  assert.equal(button('套用').disabled, false, '核對過了應該可以套用：' + reason());
  button('套用').click();
}

void test('L2 R2：標示之後在上面貼了出處相同的目標，平移後的標示套用改的是原本那個目標', async () => {
  const old = '- 甲 ^abc123\n    - Q :: A\n    - 出處：老師說過 p.44\n';
  const [hit] = hitsOf(old);
  const view = new EditorView({ state: EditorState.create({ doc: old }), parent: document.body });
  const pasted = '- 乙 ^abc234\n    - Q :: A\n    - 出處：老師說過 p.44\n';
  // 貼上之後、標示重新算之前：標示跟著平移，hit 還是貼上之前算的。
  const from = view.state.doc.line(hit.at!.line + 1).from + hit.at!.from;
  const tr = view.state.update({ changes: { from: 0, insert: pasted }, userEvent: 'input.paste' });
  view.dispatch(tr);
  openUnreadableSourceForm(view, tr.changes.mapPos(from), entry, hit);
  assert.equal(reason(), '');
  await clearRemarkAndApply();
  assert.equal(view.state.doc.toString(), pasted + '- 甲 ^abc123\n    - Q :: A\n    - 出處：p.44\n', '改的是甲，乙不動');
  view.destroy();
});

void test('L2 R2：標示的那一段改過字，不寫，說筆記剛改過', () => {
  const old = '- 甲 ^abc123\n    - Q :: A\n    - 出處：老師說過 p.44\n';
  const [hit] = hitsOf(old);
  const view = new EditorView({ state: EditorState.create({ doc: old }), parent: document.body });
  const from = view.state.doc.line(hit.at!.line + 1).from + hit.at!.from;
  view.dispatch({ changes: { from: from + 2, to: from + 3, insert: '講' } });
  openUnreadableSourceForm(view, from, entry, hit);
  assert.equal(reason(), '筆記剛改過，請再點一次');
  assert.equal(button('套用').disabled, true);
  closeSourceForm();
  view.destroy();
});

void test('L2 R6：切不出原文的出處（接續行）打開表單，說這一項分在兩行，不說剛改過', () => {
  const text = '- 目標 ^abc123\n    - Q :: A\n    - 出處：老師說過\n      p.44\n';
  const [hit] = hitsOf(text);
  assert.equal(hit.at, null);
  const view = new EditorView({ state: EditorState.create({ doc: text }), parent: document.body });
  // 沒有位置的段，標示畫在那一欄出處第一行的內容（清單符號之後）。
  openUnreadableSourceForm(view, view.state.doc.line(3).from + 6, entry, hit);
  assert.match(reason(), /分在兩行/);
  assert.equal(button('套用').disabled, true);
  closeSourceForm();
  assert.equal(view.state.doc.toString(), text);
  view.destroy();
});

void test('L2 R10：標示之後改了後面接著的頁碼，表單的原文、位置與寫回都用現在的字', async () => {
  const old = '- 甲 ^abc123\n    - Q :: A\n    - 出處：老師說過 p.21、22\n';
  const [hit] = hitsOf(old);
  const view = new EditorView({ state: EditorState.create({ doc: old }), parent: document.body });
  const from = view.state.doc.line(hit.at!.line + 1).from + hit.at!.from;
  const end = view.state.doc.line(3).to;
  view.dispatch({ changes: { from: end - 2, to: end, insert: '23' }, userEvent: 'input.type' });
  openUnreadableSourceForm(view, from, entry, hit);
  assert.equal(form().querySelector('.essence-cards-source-form-original')?.textContent, '原文：老師說過 p.21、23');
  await clearRemarkAndApply();
  assert.equal(view.state.doc.toString(), '- 甲 ^abc123\n    - Q :: A\n    - 出處：p.21 p.23\n');
  view.destroy();
});

void test('L2 R10：標示之後改了前面的單元，表單預選現在跟著的單元', async () => {
  const head = '---\n年級學期: 國二上\n科目: 自然\n單元: 2-2 本篇\n---\n';
  const old = head + '- 目標 ^abc123\n    - Q :: A\n    - 出處：國二上 1-3 p.20、老師說過 p.21\n';
  const [hit] = hitsOf(old);
  assert.equal(hit.text, '老師說過 p.21');
  const view = new EditorView({ state: EditorState.create({ doc: old }), parent: document.body });
  const from = view.state.doc.line(hit.at!.line + 1).from + hit.at!.from;
  const unit = view.state.doc.line(8).from + view.state.doc.line(8).text.indexOf('1-3');
  view.dispatch({ changes: { from: unit, to: unit + 3, insert: '1-4' }, userEvent: 'input.type' });
  openUnreadableSourceForm(view, from, entry, hit);
  const checked = Array.from(form().querySelectorAll('[role="radio"][aria-checked="true"]')).map(each => each.textContent);
  assert.deepEqual(checked, ['國二上 1-4還沒有卡組']);
  await clearRemarkAndApply();
  const written = view.state.doc.line(8).text;
  assert.ok(!written.includes('1-3'), written);
  assert.equal(written, '    - 出處：國二上 1-4 p.20、國二上 1-4 p.21');
  view.destroy();
});
