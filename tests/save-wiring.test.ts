import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createObsidianStub } from './helpers/obsidian.ts';

// 離開筆記時的備援（W5 §8-6、D-134）：用共用的 obsidian 替身在 Node 跑 src/obsidian/save.ts 的 wireSave，
// 只模擬分頁與事件，不是 Obsidian 實機（實機證據在開發命令 save、a3check、t1prep／t1close）。
// 技術債 A3：「開著哪些」只有 start()、layout-change、opened（編輯器建立）三個來源，只在 layout-change 比對。替身照 Windows 1.14.5 的
// 實測送事件：開著的集合改變時送 layout-change（背景開檔與關檔也是），只切換分頁時只送 active-leaf-change 與 file-open；開完馬上關時
// 只在關之後送一次 layout-change（外掛架構討論稿環節 1 的實機記錄、A3 設計稿的 a3check）。
const root = fileURLToPath(new URL('../', import.meta.url));
const code = (await build({
  absWorkingDir: root, stdin: { contents: "export { wireSave } from './src/obsidian/save.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false,
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
})).outputFiles[0].text;

const DECK = 'Essence Cards/P.md';

function setup() {
  const stub = createObsidianStub();
  const fills: string[] = [];
  let intervals = 0;
  const plugin = { app: stub.app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { intervals++; return id; } };
  const { wireSave } = stub.load<{ wireSave: (host: unknown) => { refresh(): void; opened(path: string): void; start(): void } }>(code);
  const state = { deckStatus: () => ({ missing: 1, issues: [] }), fillIds: (path: string) => { fills.push(path); return Promise.resolve(true); }, onChange: () => () => {} };
  const saver = wireSave({ plugin, state: () => state, notify() {}, onError() {} });
  return { saver, leaves: stub.leaves, leaf: stub.leaf, deferred: stub.deferred, fills, fire: stub.fire, intervals: () => intervals };
}

void test('R3 背景分頁只開不改就關掉：開的時候與關的時候各有 layout-change（實測 A3 步驟 1、2），關掉後補一次', async () => {
  const h = setup();
  h.fire('layout-change');
  h.leaves.push(h.leaf(DECK));
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [], '開著時不補');
  h.leaves.length = 0;
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [DECK]);
});

void test('開完馬上關（只在關之後送一次 layout-change，a3check 的 C1）：編輯器建立時記下，關掉後補一次', async () => {
  const h = setup();
  h.fire('layout-change');
  h.leaves.push(h.leaf(DECK));
  h.saver.opened(DECK);
  h.leaves.length = 0;
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [DECK]);
});

void test('開、換篇、關都很快（a3check 的 C3）：兩篇的編輯器各建立一次，關掉後各補一次', async () => {
  const h = setup();
  const other = 'Essence Cards/Q.md';
  h.fire('layout-change');
  h.saver.opened(DECK);
  h.saver.opened(other);
  h.saver.opened('其他/筆記.md');
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills.sort(), [DECK, other]);
});

// 條件模型：1.14.5 只在冷啟動看到未載入的分頁（那種由 start() 接住，見 T1 的測試）；之後才出現的未載入分頁沒有實機證據，
// 這裡只確認 openPaths() 從 viewState 拿得到檔名。
void test('還沒載入的分頁在啟動之後出現：出現與關掉都送 layout-change 時，關掉後補一次', async () => {
  const h = setup();
  h.fire('layout-change');
  h.leaves.push(h.deferred(DECK));
  h.fire('layout-change');
  h.leaves.length = 0;
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [DECK]);
});

void test('背景轉成前景（只切焦點）不補，最後關掉才補一次', async () => {
  const h = setup();
  h.fire('layout-change');
  h.leaves.push(h.leaf(DECK));
  h.fire('layout-change');
  h.fire('active-leaf-change');
  h.fire('file-open');
  await wait(1100);
  assert.deepEqual(h.fills, []);
  h.leaves.length = 0;
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [DECK]);
});

void test('啟動時只記下開著哪些不補；重複的事件、refresh 與 start 不補；另一個分頁還開著不補；不是卡組不補；最後一個關掉補一次', async () => {
  const h = setup();
  h.leaves.push(h.leaf(DECK), h.deferred(DECK), h.leaf('其他/筆記.md'));
  h.saver.start();
  h.fire('layout-change');
  h.fire('layout-change');
  h.saver.refresh();
  h.saver.start();
  h.leaves.splice(0, 1);
  h.fire('layout-change');
  h.leaves.pop();
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [], '還有一個未載入的分頁開著那篇');
  h.leaves.length = 0;
  h.fire('layout-change');
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [DECK], '只補一次');
});

void test('只切換分頁（只送 active-leaf-change、file-open，實測 A3 步驟 9、10）不改基準：之後關掉照樣補一次', async () => {
  const h = setup();
  h.leaves.push(h.leaf(DECK), h.leaf('Essence Cards/Q.md'));
  h.fire('layout-change');
  h.fire('active-leaf-change');
  h.fire('file-open');
  await wait(1100);
  assert.deepEqual(h.fills, []);
  h.leaves.length = 0;
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills.sort(), [DECK, 'Essence Cards/Q.md']);
});

void test('關掉之後、補之前又打開了（還沒送 layout-change）不補；之後再關掉補一次', async () => {
  const h = setup();
  h.leaves.push(h.leaf(DECK));
  h.fire('layout-change');
  h.leaves.length = 0;
  h.fire('layout-change');
  h.leaves.push(h.leaf(DECK));
  await wait(1100);
  assert.deepEqual(h.fills, []);
  h.fire('layout-change');
  h.leaves.length = 0;
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, [DECK]);
});

void test('在啟動的第一個事件之前看到的不算（還不知道誰開著）；沒有定時掃分頁', async () => {
  const h = setup();
  h.saver.refresh();
  h.leaves.push(h.leaf(DECK));
  h.saver.opened(DECK);
  h.saver.refresh();
  h.leaves.length = 0;
  h.fire('layout-change');
  await wait(1100);
  assert.deepEqual(h.fills, []);
  assert.equal(h.intervals(), 0);
});

// Codex 第三次審查的 T1：重新啟用外掛時 layout 已經 ready，第一個分頁事件可能就是關掉原本開著的卡組。
void test('T1 重新啟用外掛：layout ready 時記下開著的分頁（不補），第一個事件就是關掉也補一次', async () => {
  for (const make of ['leaf', 'deferred'] as const) {
    const h = setup();
    h.leaves.push(h[make](DECK));
    h.saver.start();
    await wait(1100);
    assert.deepEqual(h.fills, [], '啟用時不補');
    h.leaves.length = 0;
    h.fire('layout-change');
    await wait(1100);
    assert.deepEqual(h.fills, [DECK]);
  }
});
