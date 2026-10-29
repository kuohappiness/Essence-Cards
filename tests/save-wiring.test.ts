import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createObsidianStub } from './helpers/obsidian.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import { createState } from '../src/state/index.ts';

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
/** 替身的 state 已經讀完、沒有讀不到的檔（存檔按鈕判斷受阻用，D-154）。 */
const loadedState = { ready: () => Promise.resolve(), unread: () => [] };

function setup() {
  const stub = createObsidianStub();
  const fills: string[] = [];
  let intervals = 0;
  const plugin = { app: stub.app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { intervals++; return id; } };
  const { wireSave } = stub.load<{ wireSave: (host: unknown) => { refresh(): void; opened(path: string): void; start(): void } }>(code);
  const state = { deckStatus: () => ({ missing: 1, issues: [] }), fillIds: (path: string) => { fills.push(path); return Promise.resolve(true); }, onChange: () => () => {}, ...loadedState };
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

// 任務說明 2-2、syntax.md §2-1：需要新版的卡組，Cards 不寫它（state 的寫入門檻回 blocked needs-update）。存檔按鈕照實說明，
// 不說「都已加入複習」（同 D-154 的原則）；按下去只提示，不開待處理的小視窗。
void test('2-2 需要新版的卡組：按鈕說明需要更新，存檔被擋時提示同一句，不開待處理的小視窗', async () => {
  const stub = createObsidianStub();
  const plugin = { app: stub.app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { return id; } };
  const { wireSave } = stub.load<{ wireSave: (host: unknown) => { refresh(): void; save(view: unknown): Promise<void> } }>(code);
  const notified: string[] = [];
  const state = {
    deckStatus: () => ({ missing: 0, issues: [], needsUpdate: true }), onChange: () => () => {}, ...loadedState,
    save: () => Promise.resolve({ kind: 'blocked', reason: 'needs-update' }),
  };
  const saver = wireSave({ plugin, state: () => state, notify(message: string) { notified.push(message); }, onError(error: unknown) { throw error; } });
  const leaf = stub.leaf(DECK);
  stub.leaves.push(leaf);
  saver.refresh();
  // 存檔按鈕等 ready() 回來才知道讀完了（D-154 的受阻說明），之後自己再更新一次。
  await wait(0);
  const [button] = (leaf.view as { actions: { label: string }[] }).actions;
  const tip = '這篇筆記需要新版的外掛才讀得懂；筆記已自動儲存，更新外掛之前不會加入複習';
  assert.equal(button.label, tip);
  await saver.save(leaf.view);
  assert.deepEqual([notified, stub.modals.length], [[tip], 0]);
});

// S27（tasks/state-writes.md §7）：存檔交給 state 的 EditorHandle 照按下時的那一篇；按鈕連按只排一份。
void test('S27 存檔的 EditorHandle：換篇後 text() 是 null、內容不同時 apply 回傳 false、persist 呼叫 view.save()；連按只排一份', async () => {
  const stub = createObsidianStub();
  const plugin = { app: stub.app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { return id; } };
  const { wireSave } = stub.load<{ wireSave: (host: unknown) => { save(view: unknown): Promise<void> } }>(code);
  interface Handle { path: string; text(): string | null; apply(before: string, after: string): boolean; persist(): Promise<void> }
  const handles: Handle[] = [];
  let finish: () => void = () => {};
  const state = {
    deckStatus: () => ({ missing: 0, issues: [] }), onChange: () => () => {}, ...loadedState,
    save: (editor: Handle) => { handles.push(editor); return new Promise(resolve => { finish = () => { resolve({ kind: 'unchanged' }); }; }); },
  };
  const saver = wireSave({ plugin, state: () => state, notify() {}, onError(error: unknown) { throw error; } });
  const view = stub.leaf(DECK).view as { file: { path: string } | null; value: string; saves: number };
  view.value = '- 能說明 C\n';
  const first = saver.save(view), second = saver.save(view);
  assert.equal(first, second, '同一篇還沒結束時回傳同一個 Promise');
  assert.equal(handles.length, 1);
  const [handle] = handles;
  assert.equal(handle.path, DECK);
  assert.equal(handle.text(), '- 能說明 C\n');
  assert.equal(handle.apply('別的內容', '- 能說明 C ^aaaaaa\n'), false);
  assert.equal(handle.apply('- 能說明 C\n', '- 能說明 C ^aaaaaa\n'), true);
  await handle.persist();
  assert.equal(view.saves, 1);
  view.file = { path: 'Essence Cards/Q.md' };
  assert.equal(handle.text(), null, '換篇之後');
  assert.equal(handle.path, DECK);
  finish();
  await first;
  view.file = { path: DECK };
  void saver.save(view);
  assert.equal(handles.length, 2, '上一份結束之後再按，排新的一份');
});

// Codex L2 的 R3（tasks/state-writes.md §7）：小視窗按下還原或當成新的之後，結果回來之前兩個按鈕都停用；這段時間別篇的讀取
// 讓小視窗重畫（onChange）也一樣，再按不另外排一份。結果回來才解除。
void test('L2 R3 小視窗等待中重畫：按鈕維持停用、不另外排一份；結果回來後才解除', async () => {
  const stub = createObsidianStub();
  const plugin = { app: stub.app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { return id; } };
  const { wireSave } = stub.load<{ wireSave: (host: unknown) => { save(view: unknown): Promise<void> } }>(code);
  const issue = { path: DECK, line: 0, name: '能說明 C', kind: 'lost', restore: 'k3m9x2' };
  const listeners = new Set<() => void>();
  const choices: string[] = [];
  let finish: (result: unknown) => void = () => {};
  const state = {
    deckStatus: () => ({ missing: 0, issues: [issue] }), ...loadedState,
    onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    save: () => Promise.resolve({ kind: 'unchanged' }),
    resolve: (_issue: unknown, choice: string) => { choices.push(choice); return new Promise(resolve => { finish = resolve; }); },
  };
  const saver = wireSave({ plugin, state: () => state, notify() {}, onError(error: unknown) { throw error; } });
  await saver.save(stub.leaf(DECK).view);
  assert.equal(stub.modals.length, 1, '有待處理的問題時開小視窗');
  const buttons = () => stub.modals[0].contentEl.querySelectorAll('button');
  assert.equal(buttons().length, 2);
  buttons()[0].click();
  assert.deepEqual(choices, ['restore']);
  assert.ok(buttons().every(button => button.disabled));
  for (let i = 0; i < 2; i++) for (const listener of [...listeners]) listener();
  assert.equal(buttons().length, 2, '重畫了');
  assert.ok(buttons().every(button => button.disabled), '重畫之後按鈕又能按');
  buttons()[1].click();
  assert.deepEqual(choices, ['restore']);
  finish({ kind: 'done', added: 0 });
  await wait(0);
  assert.equal(buttons().length, 2);
  assert.ok(buttons().every(button => !button.disabled), '結果回來後解除');
});

// D-154 第 2 點（tasks/icloud-placeholders.md §2）：存檔受阻（這台電腦會補 ID，但還沒讀完或有檔案讀不到）時當下說清楚。
// 用真的 state（記憶體 Files）做出「還沒讀完」與「讀不到」；替身的 view 把 Editor 的交易套用到自己的文字，save() 把文字寫進
// 記憶體 Files（Obsidian 的 view.save），編輯器裡的文字一開始就已經自動存檔（和磁碟相同）。
const BLOCKED = '筆記已自動儲存；暫時無法把新目標加入複習，讀取完成後請再按一次存檔';
const OTHER = 'Essence Cards/Q.md';
const WITH_IDS = '- 能說明蒸發 ^aaaaaa\n    - 水變成水蒸氣叫什麼？ :: 蒸發\n';
const NEW_TARGET = WITH_IDS + '- 能說明凝結\n    - 水蒸氣變成水叫什麼？ :: 凝結\n';

interface BoundView { file: { path: string } | null; value: string; actions: { label: string }[]; editor: unknown; save: () => Promise<void> }
async function blockedSetup(t: TestContext, deck: string, block: 'unread' | 'loading' | 'none') {
  const memory = createMemoryFiles({ [DECK]: deck, [OTHER]: '- 能說明 Q ^bbbbbb\n    - Q？ :: Q\n' });
  if (block === 'unread') memory.failing.add(OTHER);
  const held = block === 'loading' ? memory.holdRead(OTHER) : null;
  const state = createState({ files: memory.files, device: 'PC-test', delay: 0, fillIds: true, random: () => 0 });
  // 斷言在放行之前失敗時，close() 不能一直等那個被攔住的讀取。
  t.after(() => { held?.release(); return state.close(); });
  // main.ts 一建立 state 就叫 ready()。
  const ready = state.ready();
  if (block !== 'loading') await ready;
  const stub = createObsidianStub();
  const plugin = { app: stub.app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { return id; } };
  const { wireSave } = stub.load<{ wireSave: (host: unknown) => { refresh(): void; save(view: unknown): Promise<void> } }>(code);
  const notices: string[] = [];
  const saver = wireSave({ plugin, state: () => state, notify(message: string) { notices.push(message); }, onError(error: unknown) { throw error; } });
  const leaf = stub.leaf(DECK);
  stub.leaves.push(leaf);
  const view = leaf.view as BoundView;
  view.value = deck;
  view.editor = {
    getValue: () => view.value,
    offsetToPos: (offset: number) => ({ offset }),
    // 同一次交易的變更都以交易前的文字為準（CodeMirror）：從後往前套。
    transaction({ changes }: { changes: { from: { offset: number }; to: { offset: number }; text: string }[] }) {
      for (const change of [...changes].sort((a, b) => b.from.offset - a.from.offset)) view.value = view.value.slice(0, change.from.offset) + change.text + view.value.slice(change.to.offset);
    },
  };
  view.save = () => { if (memory.texts.get(DECK) !== view.value) memory.write(DECK, view.value); return Promise.resolve(); };
  const settle = () => wait(30);
  /** 更新按鈕之後的說明（main.ts 在 onChange、切換分頁時更新）。 */
  const tip = () => { saver.refresh(); return view.actions.at(-1)?.label; };
  return { memory, state, saver, view, notices, tip, settle, release: () => held?.release(), ready, modals: stub.modals };
}
const ids = (text: string) => [...text.matchAll(/ \^([a-z0-9]{6})$/gm)].map(match => match[1]);

void test('B1 有檔案讀不到、文字有沒 ID 的目標：按存檔不改字，提示與按鈕說明都是受阻那一句；恢復後再按，補上 ID', async t => {
  const h = await blockedSetup(t, NEW_TARGET, 'unread');
  assert.deepEqual(h.state.unread(), [OTHER]);
  assert.equal(h.tip(), BLOCKED);
  await h.saver.save(h.view);
  assert.deepEqual(h.notices, [BLOCKED]);
  assert.equal(h.view.value, NEW_TARGET, '不改字');
  assert.equal(h.memory.texts.get(DECK), NEW_TARGET);
  assert.equal(h.tip(), BLOCKED);
  h.memory.failing.delete(OTHER);
  h.memory.notify(OTHER);
  await h.settle();
  assert.deepEqual(h.state.unread(), []);
  assert.equal(h.tip(), '筆記已自動儲存；有 1 個學習目標尚未加入複習', '恢復後回到原本的說明');
  await h.saver.save(h.view);
  assert.deepEqual(h.notices, [BLOCKED, '1 個學習目標已加入複習']);
  assert.equal(ids(h.view.value).length, 2);
  assert.equal(h.memory.texts.get(DECK), h.view.value);
  assert.equal(h.tip(), '筆記已自動儲存；學習目標都已加入複習');
});

void test('B2 還沒讀完（ready() 還沒完成）：同 B1；讀完之後按鈕回到原本的說明，再按照常補', async t => {
  const h = await blockedSetup(t, NEW_TARGET, 'loading');
  assert.equal(h.tip(), BLOCKED, '不能說「學習目標都已加入複習」');
  await h.saver.save(h.view);
  assert.deepEqual(h.notices, [BLOCKED]);
  assert.equal(h.view.value, NEW_TARGET);
  h.release();
  await h.ready;
  await h.settle();
  assert.equal(h.view.actions.at(-1)?.label, '筆記已自動儲存；有 1 個學習目標尚未加入複習', 'ready() 完成時自己更新按鈕');
  await h.saver.save(h.view);
  assert.deepEqual(h.notices, [BLOCKED, '1 個學習目標已加入複習']);
  assert.equal(ids(h.view.value).length, 2);
});

void test('B3 受阻但每個目標都有 ID：按存檔不提示；按鈕說明照樣是受阻那一句', async t => {
  const h = await blockedSetup(t, WITH_IDS, 'unread');
  await h.saver.save(h.view);
  assert.deepEqual(h.notices, []);
  assert.equal(h.view.value, WITH_IDS);
  assert.equal(h.tip(), BLOCKED);
});

void test('B4 受阻時在小視窗按「還原」與「當成新的」：提示受阻那一句，不是「剛剛改過」；問題保留；恢復後照常還原', async t => {
  const h = await blockedSetup(t, WITH_IDS, 'none');
  // 在 Obsidian 以外弄丟 ID（D-134）：重讀時出現待處理的問題。
  const lost = '- 能說明蒸發\n    - 水變成水蒸氣叫什麼？ :: 蒸發\n';
  h.memory.write(DECK, lost);
  h.view.value = lost;
  await h.settle();
  assert.equal(h.state.deckStatus(DECK).issues.length, 1);
  h.memory.failing.add(OTHER);
  h.memory.notify(OTHER);
  await h.settle();
  assert.deepEqual(h.state.unread(), [OTHER]);
  for (const [i, button] of [[0, 0], [1, 1]] as const) {
    await h.saver.save(h.view);
    assert.equal(h.modals.length, i + 1, '有待處理的問題時開小視窗');
    const buttons = h.modals[i].contentEl.querySelectorAll('button');
    assert.equal(buttons.length, 2, '還原與當成新的');
    buttons[button].click();
    await h.settle();
    assert.equal(h.notices.at(-1), BLOCKED);
    assert.ok(!h.notices.includes('這篇筆記剛剛改過，請再按一次存檔'));
    assert.equal(h.state.deckStatus(DECK).issues.length, 1, '問題保留');
    assert.equal(h.view.value, lost);
  }
  h.memory.failing.delete(OTHER);
  h.memory.notify(OTHER);
  await h.settle();
  const before = h.notices.length;
  await h.saver.save(h.view);
  h.modals[2].contentEl.querySelectorAll('button')[0].click();
  await h.settle();
  assert.deepEqual(h.state.deckStatus(DECK).issues, []);
  assert.deepEqual(ids(h.view.value), ['aaaaaa'], '還原原本的 ID');
  assert.ok(!h.notices.slice(before).includes(BLOCKED));
});

// Codex L2 的 R1：小視窗開著時這一篇變成需要新版（例如編輯器的文字帶了新寫法），resolve 回 blocked needs-update：
// 照實說需要更新外掛，不說「請再按一次存檔」（重按也不會成功）。其他結果照舊。
void test('L2 R1 小視窗收到 blocked needs-update：提示需要更新外掛；stale、failed 照舊', async () => {
  for (const [result, tip] of [
    [{ kind: 'blocked', reason: 'needs-update' }, '這篇筆記需要新版的外掛才讀得懂；筆記已自動儲存，更新外掛之前不會加入複習'],
    [{ kind: 'stale' }, '這篇筆記剛剛改過，請再按一次存檔'],
    [{ kind: 'failed', error: Error('寫不進去') }, '這篇筆記暫時存不進去，學習目標還沒加入複習；請稍後再按一次存檔'],
  ] as const) {
    const stub = createObsidianStub();
    const plugin = { app: stub.app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { return id; } };
    const { wireSave } = stub.load<{ wireSave: (host: unknown) => { save(view: unknown): Promise<void> } }>(code);
    const issue = { path: DECK, line: 0, name: '能說明 C', kind: 'lost', restore: 'k3m9x2' };
    const notified: string[] = [];
    const state = {
      deckStatus: () => ({ missing: 0, issues: [issue] }), onChange: () => () => {}, ...loadedState,
      save: () => Promise.resolve({ kind: 'unchanged' }),
      resolve: () => Promise.resolve(result),
    };
    const saver = wireSave({ plugin, state: () => state, notify(message: string) { notified.push(message); }, onError(error: unknown) { throw error; } });
    await saver.save(stub.leaf(DECK).view);
    stub.modals[0].contentEl.querySelectorAll('button')[0].click();
    await wait(0);
    assert.deepEqual(notified, [tip], result.kind);
  }
});

// 合併更新防線第二部分時（兩邊都改了小視窗的提示）：受阻時小視窗一律說受阻那一句，不看文字。目標本身有 ID 的問題（changed、
// ambiguous）也一樣，不退回「這篇筆記剛剛改過」；需要新版照上面 L2 R1。
void test('B4 補：受阻時小視窗的問題目標本身有 ID（changed）：提示受阻那一句', async () => {
  for (const reason of ['unread', 'loading'] as const) {
    const stub = createObsidianStub();
    const plugin = { app: stub.app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { return id; } };
    const { wireSave } = stub.load<{ wireSave: (host: unknown) => { save(view: unknown): Promise<void> } }>(code);
    const issue = { path: DECK, line: 0, name: '能說明 C', kind: 'changed', restore: 'k3m9x2' };
    const notified: string[] = [];
    const state = {
      deckStatus: () => ({ missing: 0, issues: [issue] }), onChange: () => () => {}, ...loadedState,
      save: () => Promise.resolve({ kind: 'blocked', reason }),
      resolve: () => Promise.resolve({ kind: 'blocked', reason }),
    };
    const saver = wireSave({ plugin, state: () => state, notify(message: string) { notified.push(message); }, onError(error: unknown) { throw error; } });
    const view = stub.leaf(DECK).view as { value: string };
    view.value = '- 能說明 C ^p7q2w8\n    - C？ :: C\n';
    await saver.save(view);
    assert.deepEqual(notified, [], '存檔：目標都有 ID，不提示');
    stub.modals[0].contentEl.querySelectorAll('button')[0].click();
    await wait(0);
    assert.deepEqual(notified, [BLOCKED], reason);
  }
});

// 外掛架構檢查環節 5 結論第 1 條（tasks/icloud-placeholders.md §2 的 2026-10-29 補充）：
// B6 小視窗收到 saved（已寫進磁碟、state 還在核對）：和按存檔收到 saved 一樣不提示，不說「剛剛改過」，由 state 繼續核對。
void test('B6 小視窗按「還原」或「當成新的」收到 saved：不提示', async () => {
  for (const button of [0, 1]) {
    const stub = createObsidianStub();
    const plugin = { app: stub.app, addCommand() {}, registerEvent() {}, registerInterval(id: number) { return id; } };
    const { wireSave } = stub.load<{ wireSave: (host: unknown) => { save(view: unknown): Promise<void> } }>(code);
    const issue = { path: DECK, line: 0, name: '能說明 C', kind: 'lost', restore: 'k3m9x2' };
    const notified: string[] = [];
    const state = {
      deckStatus: () => ({ missing: 0, issues: [issue] }), onChange: () => () => {}, ...loadedState,
      save: () => Promise.resolve({ kind: 'unchanged' }),
      resolve: () => Promise.resolve({ kind: 'saved' }),
    };
    const saver = wireSave({ plugin, state: () => state, notify(message: string) { notified.push(message); }, onError(error: unknown) { throw error; } });
    await saver.save(stub.leaf(DECK).view);
    stub.modals[0].contentEl.querySelectorAll('button')[button].click();
    await wait(0);
    assert.deepEqual(notified, [], String(button));
  }
});

// B7 一篇需要新版（裡面有沒 ID 的目標）、同時另有讀不到的檔：按鈕的樣子與說明是需要新版；按下時 state 的門檻先看到讀不到，
// 提示受阻那一句；讀完再按才說需要新版。兩次說的不同，照實記下，這次不統一。
void test('B7 需要新版、同時有讀不到的檔：按鈕說需要新版；按下先說受阻，讀完再按才說需要新版', async t => {
  const NEEDS = '這篇筆記需要新版的外掛才讀得懂；筆記已自動儲存，更新外掛之前不會加入複習';
  const deck = '---\n科目: 自然\n需要版本: 9.0.0\n---\n' + NEW_TARGET;
  const h = await blockedSetup(t, deck, 'unread');
  assert.deepEqual(h.state.deckStatus(DECK), { missing: 0, issues: [], needsUpdate: true });
  assert.equal(h.tip(), NEEDS);
  await h.saver.save(h.view);
  assert.deepEqual(h.notices, [BLOCKED]);
  h.memory.failing.delete(OTHER);
  h.memory.notify(OTHER);
  await h.settle();
  assert.deepEqual(h.state.unread(), []);
  await h.saver.save(h.view);
  assert.deepEqual(h.notices, [BLOCKED, NEEDS]);
  assert.equal(h.tip(), NEEDS);
  assert.equal(h.view.value, deck, '一個字都沒改');
});
