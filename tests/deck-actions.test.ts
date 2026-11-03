import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createState } from '../src/state/index.ts';
import type { StudyPick } from '../src/state/index.ts';
import { createObsidianStub } from './helpers/obsidian.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// 卡組筆記標題列的「全部卡」與「預覽」（tasks/entry-and-catalog.md §6、§7）：共用的 obsidian 替身，不是 Obsidian 實機。

const root = fileURLToPath(new URL('../', import.meta.url));
const code = (await build({
  absWorkingDir: root, stdin: { contents: "export { wireDeckActions } from './src/obsidian/deck-actions.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false, external: ['obsidian'],
})).outputFiles[0].text;

const ACTIVE = 'Essence Cards/啟用.md';
const texts: Record<string, string> = {
  [ACTIVE]: '- 目標 ^a23456\n    - 問 :: 答\n- 另一個 ^b23456\n    - 問 :: 答\n- 暫停的 ^c23456\n    - 問 :: 答\n    - 狀態：暫停\n',
  'Essence Cards/草稿.md': '---\n狀態: 草稿\n---\n- 目標 ^d23456\n    - 問 :: 答\n',
  'Essence Cards/暫停.md': '---\n狀態: 暫停\n---\n- 目標 ^e23456\n    - 問 :: 答\n',
  'Essence Cards/轉錄稿.md': '---\n來源類型: 課本\n---\n- 問 :: 答\n',
  'Essence Cards/一般.md': '只是筆記\n',
  'Essence Cards/需要新版.md': '---\n需要版本: 9.0.0\n---\n- 目標 ^f23456\n    - 問 :: 答\n',
};
const PREVIEW_ON = 'essence-cards-preview-button';
const NO_REMIND = 'essence-cards-full-deck-no-remind';

interface FakeView { actions: { icon: string; label: string; click: () => void }[]; value: string; file: { path: string } | null }
async function setup(t: TestContext, local: Record<string, unknown> = {}) {
  const memory = createMemoryFiles(texts);
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: false, build: '0.2.0+test', now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  const stub = createObsidianStub({ localStorage: local });
  const cleanups: (() => void)[] = [];
  const commands = new Map<string, { checkCallback: (checking: boolean) => boolean }>();
  const plugin = { app: stub.app, addCommand(command: { id: string; checkCallback: (checking: boolean) => boolean }) { commands.set(command.id, command); }, registerEvent() {}, register(cleanup: () => void) { cleanups.push(cleanup); } };
  const { wireDeckActions } = stub.load<{ wireDeckActions: (host: unknown) => { refresh(): void } }>(code);
  const starts: StudyPick[] = [], previews: { view(): { kind: string } }[] = [], notices: string[] = [];
  const actions = wireDeckActions({ plugin, state: () => state, start(pick: StudyPick) { starts.push(pick); }, preview(session: { view(): { kind: string } }) { previews.push(session); }, notify(message: string) { notices.push(message); } });
  const open = (path: string): FakeView => {
    const leaf = stub.leaf(path);
    stub.leaves.push(leaf);
    const view = leaf.view as FakeView;
    view.value = memory.texts.get(path) ?? '';
    actions.refresh();
    return view;
  };
  const activate = (view: FakeView): void => { (stub.app.workspace as { getActiveViewOfType: () => unknown }).getActiveViewOfType = () => view; };
  const button = (view: FakeView, label: string) => view.actions.find(action => action.label === label);
  return { stub, state, memory, actions, commands, starts, previews, notices, open, activate, button, unload() { for (const cleanup of cleanups.splice(0)) cleanup(); } };
}
const labels = (view: FakeView): string[] => view.actions.map(action => action.label);

void test('§6 全部卡的按鈕：只在啟用的卡組、至少有一個可出的目標時顯示；命令同樣判斷', async t => {
  const h = await setup(t);
  assert.deepEqual(labels(h.open(ACTIVE)), ['全部卡']);
  for (const path of ['Essence Cards/草稿.md', 'Essence Cards/暫停.md', 'Essence Cards/轉錄稿.md', 'Essence Cards/一般.md', 'Essence Cards/需要新版.md']) {
    const view = h.open(path);
    assert.deepEqual(labels(view), [], path);
    h.activate(view);
    assert.equal(h.commands.get('full-deck')?.checkCallback(true), false, path);
  }
  h.activate(h.open(ACTIVE));
  assert.equal(h.commands.get('full-deck')?.checkCallback(true), true);
});

void test('§6 按下去先出提醒，12 是這一輪的目標數；取消不開複習、不寫紀錄；開始練習才開，從那時候算', async t => {
  const h = await setup(t);
  const view = h.open(ACTIVE);
  h.button(view, '全部卡')?.click();
  const modal = h.stub.modals.at(-1);
  assert.ok(modal?.isOpen);
  const text = modal.contentEl.children.map(el => el.text);
  assert.ok(text.includes('將開始完整練習本篇的 2 個學習目標。'), '暫停的不算：' + text.join('｜'));
  assert.ok(text.includes('但同時，複習排程也會受作答紀錄的影響。'));
  assert.ok(text.includes('如果您是家長，建議從筆記中看所有題目。'));
  const buttons = modal.contentEl.querySelectorAll('button');
  assert.deepEqual(buttons.map(el => el.text), ['取消', '開始練習']);
  buttons[0].click();
  assert.equal(modal.isOpen, false);
  assert.deepEqual(h.starts, []);
  assert.ok(!(h.memory.texts.get('Essence Cards/紀錄/2026-10 PC-test.jsonl') ?? '').includes('"lt"'), '沒有作答的紀錄');
  h.button(view, '全部卡')?.click();
  h.stub.modals.at(-1)?.contentEl.querySelectorAll('button')[1].click();
  assert.equal(h.starts.length, 1);
  const pick = h.starts[0] as { deck: string; since: number };
  assert.equal(pick.deck, ACTIVE);
  assert.equal(typeof pick.since, 'number');
});

void test('§6 勾「以後不再提醒」後同一台裝置不再出現，清掉該鍵又會出現', async t => {
  const h = await setup(t);
  const view = h.open(ACTIVE);
  h.button(view, '全部卡')?.click();
  const modal = h.stub.modals.at(-1);
  (modal?.contentEl.querySelectorAll('input')[0] as unknown as { checked: boolean }).checked = true;
  modal?.contentEl.querySelectorAll('button')[1].click();
  assert.equal(h.stub.storage(NO_REMIND), true);
  const count = h.stub.modals.length;
  h.button(view, '全部卡')?.click();
  assert.equal(h.stub.modals.length, count, '不再提醒');
  assert.equal(h.starts.length, 2);
  (h.stub.app.saveLocalStorage as (key: string, value: unknown) => void)(NO_REMIND, null);
  h.button(view, '全部卡')?.click();
  assert.equal(h.stub.modals.length, count + 1);
});

// Codex L2 的 F1：提醒開著時停用外掛，之後什麼都不能開、不能寫。
void test('§1 §6 提醒開著時停用外掛：提醒關掉；再按開始練習不開複習、不記「不再提醒」；命令也不作用', async t => {
  const h = await setup(t);
  const view = h.open(ACTIVE);
  h.activate(view);
  h.button(view, '全部卡')?.click();
  const modal = h.stub.modals.at(-1);
  assert.ok(modal?.isOpen);
  const [, begin] = modal.contentEl.querySelectorAll('button');
  (modal.contentEl.querySelectorAll('input')[0] as unknown as { checked: boolean }).checked = true;
  h.unload();
  assert.equal(modal.isOpen, false);
  begin.click();
  assert.deepEqual(h.starts, []);
  assert.equal(h.stub.storage(NO_REMIND), null);
  assert.equal(h.commands.get('full-deck')?.checkCallback(true), false);
  assert.equal(h.commands.get('preview')?.checkCallback(true), false);
});

void test('§6 §7 開關外掛後按鈕不重複（W2 的回歸）：卸載時拿掉；再接一次只有一顆', async t => {
  const h = await setup(t, { [PREVIEW_ON]: true });
  const view = h.open(ACTIVE);
  assert.deepEqual(labels(view), ['全部卡', '預覽']);
  h.unload();
  assert.deepEqual(labels(view), []);
  h.actions.refresh();
  assert.deepEqual(labels(view), [], '卸載之後不加回來');
});

void test('§7 預覽的按鈕與命令：開關關掉都不見，打開立刻出現，不用重開；草稿、暫停可以，轉錄稿、需要新版不行', async t => {
  const h = await setup(t);
  const view = h.open(ACTIVE);
  h.activate(view);
  assert.deepEqual(labels(view), ['全部卡']);
  assert.equal(h.commands.get('preview')?.checkCallback(true), false);
  (h.stub.app.saveLocalStorage as (key: string, value: unknown) => void)(PREVIEW_ON, true);
  h.actions.refresh();
  assert.deepEqual(labels(view), ['全部卡', '預覽']);
  assert.equal(h.commands.get('preview')?.checkCallback(true), true);
  for (const path of ['Essence Cards/草稿.md', 'Essence Cards/暫停.md']) assert.deepEqual(labels(h.open(path)), ['預覽'], path);
  for (const path of ['Essence Cards/轉錄稿.md', 'Essence Cards/需要新版.md']) assert.deepEqual(labels(h.open(path)), [], path);
  (h.stub.app.saveLocalStorage as (key: string, value: unknown) => void)(PREVIEW_ON, false);
  h.actions.refresh();
  assert.deepEqual(labels(view), ['全部卡']);
});

void test('§7 預覽讀編輯器目前的文字，不強迫存檔；沒有題目時用通知說明，不開畫面', async t => {
  const h = await setup(t, { [PREVIEW_ON]: true });
  const view = h.open('Essence Cards/一般.md');
  h.button(view, '預覽')?.click();
  assert.deepEqual(h.notices, ['這篇沒有可以預覽的題目']);
  assert.equal(h.previews.length, 0);
  view.value = '- 剛打的目標\n    - 問 :: 答\n';
  h.button(view, '預覽')?.click();
  assert.equal(h.previews.length, 1);
  assert.equal(h.previews[0].view().kind, 'card');
});
