import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 離開筆記時的備援（W5 §8-6、D-134）：用最小的 obsidian 替身在 Node 跑 src/obsidian/save.ts 的 wireSave，
// 只模擬分頁與事件，不是 Obsidian 實機（實機證據在開發命令 save）。Codex 再審的 R3。
const root = fileURLToPath(new URL('../', import.meta.url));
const code = (await build({
  absWorkingDir: root, stdin: { contents: "export { wireSave } from './src/obsidian/save.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false,
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
})).outputFiles[0].text;

const DECK = 'Essence Cards/P.md';
class MarkdownView { file: { path: string } | null; constructor(path: string | null) { this.file = path ? { path } : null; } addAction() { return { addClass() {}, setAttribute() {}, toggleClass() {}, remove() {} }; } }
interface Leaf { view: MarkdownView | object; getViewState(): { state?: { file?: string } } }
const leaf = (path: string | null): Leaf => ({ view: new MarkdownView(path), getViewState: () => ({ state: path ? { file: path } : {} }) });
/** 還沒載入的分頁：沒有 MarkdownView，只有 viewState 的檔名。 */
const deferred = (path: string): Leaf => ({ view: {}, getViewState: () => ({ state: { file: path } }) });

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const intervals: (() => void)[] = [];
  const leaves: Leaf[] = [];
  const fills: string[] = [];
  const app = { workspace: {
    on: (name: string, callback: (...args: unknown[]) => void) => { handlers.set(name, callback); return name; },
    getLeavesOfType: () => leaves, getActiveViewOfType: () => null,
  } };
  const plugin = { app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { return id; } };
  const window = { setTimeout, setInterval: (callback: () => void) => { intervals.push(callback); return intervals.length; } };
  const obsidian = { MarkdownView, Modal: class {}, setIcon() {} };
  const module = { exports: {} as { wireSave: (host: unknown) => { refresh(): void; opened(path: string): void; start(): void } } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('require', 'module', 'exports', 'window', code) as (require: (name: string) => unknown, module: unknown, exports: unknown, window: unknown) => void;
  run(name => name === 'obsidian' ? obsidian : {}, module, module.exports, window);
  const state = { deckStatus: () => ({ missing: 1, issues: [] }), fillIds: (path: string) => { fills.push(path); return Promise.resolve(true); }, onChange: () => () => {} };
  const saver = module.exports.wireSave({ plugin, state: () => state, notify() {}, onError() {} });
  const fire = (name: string) => { handlers.get(name)?.(); };
  return { saver, leaves, fills, fire, tick: () => { for (const callback of intervals) callback(); } };
}

void test('R3 背景分頁只開不改就關掉：編輯器一建立就記下開著，關掉後補一次', async () => {
  const h = setup();
  h.fire('layout-change');
  h.leaves.push(leaf(DECK));
  h.saver.opened(DECK);
  h.leaves.length = 0;
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [DECK]);
});

void test('R3 還沒載入的背景分頁（沒有事件、沒有編輯器）：定時補記，關掉後補一次', async () => {
  const h = setup();
  h.fire('layout-change');
  h.leaves.push(deferred(DECK));
  h.tick();
  h.leaves.length = 0;
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [DECK]);
});

void test('啟動時只記下開著哪些不補；只是切換焦點（同一篇還開在另一個分頁）不補；不是卡組不補', async () => {
  const h = setup();
  h.leaves.push(leaf(DECK), leaf(DECK), leaf('其他/筆記.md'));
  h.fire('layout-change');
  h.leaves.splice(1, 1);
  h.fire('layout-change');
  h.fire('file-open');
  h.leaves.pop();
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, []);
  // 在啟動的第一個事件之前看到的也不算（還不知道誰開著）。
  const g = setup();
  g.saver.opened(DECK);
  g.tick();
  g.fire('layout-change');
  await wait(1100);
  assert.deepEqual(g.fills, []);
});

// Codex 第三次審查的 T1：重新啟用外掛時 layout 已經 ready，第一個分頁事件可能就是關掉原本開著的卡組。
void test('T1 重新啟用外掛：layout ready 時記下開著的分頁（不補），第一個事件就是關掉也補一次', async () => {
  for (const make of [leaf, deferred]) {
    const h = setup();
    h.leaves.push(make(DECK));
    h.saver.start();
    await wait(1100);
    assert.deepEqual(h.fills, [], '啟用時不補');
    h.leaves.length = 0;
    h.fire('layout-change');
    await wait(1100);
    assert.deepEqual(h.fills, [DECK]);
  }
});
