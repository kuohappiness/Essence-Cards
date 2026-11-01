import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { State, StateOptions } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';
import { createMemoryEditor } from './helpers/editor.ts';

// D-157：重複的學習目標 ID 先停、家長選（tasks/duplicate-ids.md §8）。只透過公開介面：createState、記憶體 Files、記憶體編輯器；
// 「外部改檔」是記憶體 Files 的 write／remove（同步送通知），settle() 用假計時器讓 delay 過去、跑完重讀。
const DELAY = 30;
const P = 'Essence Cards/P.md';
const Q = 'Essence Cards/Q.md';
const A0 = 'Essence Cards/A 排在前面.md';
const Z9 = 'Essence Cards/Z 排在後面.md';
const LOG = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const NOW = '2026-10-24T19:00:00.000+08:00';
const ID = 'b4rw7k';
const REVIEW_T = '2026-10-01T19:00:00.000+08:00';
const LOGGED = encodeEntry(REVIEW_T, { lt: ID, r: 'good', v: '12345678' }) + '\n';
const ORIGINAL = '- borrow 英翻中 ^b4rw7k\n    - borrow :: 借入\n';
const COPY = '- lend 英翻中 ^b4rw7k\n    - lend :: 借出\n';
const OTHER = '- other ^cccccc\n    - other :: 其他\n';

const timed = new WeakSet<TestContext>();
interface Harness extends MemoryFiles {
  state: State;
  /** 讓 ms（預設剛好超過 delay）過去，跑完排好的重讀。 */
  settle: (ms?: number) => Promise<void>;
  edit: (path: string, text: string) => Promise<void>;
  share: () => string[];
  more: () => string[];
  /** 紀錄檔所有的行。 */
  logLines: () => string[];
}
async function setup(t: TestContext, vault: Record<string, string>, options: Partial<StateOptions> = {}, unread: string[] = []): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles({ [LOG]: LOGGED, ...vault });
  for (const path of unread) memory.failing.add(path);
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: true, random: () => 0,
    now: () => Date.parse(NOW), offset: () => 480, ...options });
  t.after(() => state.close());
  await state.ready();
  const settle = async (ms = DELAY + 1) => { t.mock.timers.tick(ms); for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  const edit = async (path: string, text: string) => { memory.write(path, text); await settle(); };
  return { ...memory, state, settle, edit,
    share: () => state.today().share.map(item => item.lt),
    more: () => state.today().more.map(item => item.lt),
    logLines: () => [...memory.texts].filter(([path]) => path.includes('/紀錄/')).flatMap(([, text]) => text.split('\n').filter(Boolean)) };
}
const pair = (a: string, b: string, line = 0) => [{ id: ID, targets: [{ path: a, line: 0, name: 'borrow 英翻中' }, { path: b, line, name: 'lend 英翻中' }] }];

void test('第一次載入就重複（跨篇）：conflicts 照路徑、行號列出這個 ID 與兩個目標', async t => {
  const h = await setup(t, { [Q]: COPY, [P]: ORIGINAL });
  assert.deepEqual(h.state.conflicts(), pair(P, Q));
});

void test('同一篇：貼在下面、貼在上面都列出兩個目標，照行號排', async t => {
  const below = await setup(t, { [P]: ORIGINAL + COPY });
  assert.deepEqual(below.state.conflicts(), pair(P, P, 2));
  const above = await setup(t, { [P]: COPY + ORIGINAL });
  assert.deepEqual(above.state.conflicts(), [{ id: ID, targets: [{ path: P, line: 0, name: 'lend 英翻中' }, { path: P, line: 2, name: 'borrow 英翻中' }] }]);
});

void test('沒有重複時 conflicts 是空的；還沒 ready 也是空的', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: OTHER });
  assert.deepEqual(h.state.conflicts(), []);
  const memory = createMemoryFiles({ [P]: ORIGINAL + COPY });
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: false });
  t.after(() => state.close());
  assert.deepEqual(state.conflicts(), []);
});

// §8 第 12 項：底下的副本都帶題目，否則是一般筆記。
for (const [label, copy, line, name] of [
  ['草稿卡組', '---\n狀態: 草稿\n---\n' + COPY, 3, 'lend 英翻中'],
  ['暫停的卡組', '---\n狀態: 暫停\n---\n' + COPY, 3, 'lend 英翻中'],
  ['暫停的目標', '- lend 英翻中 ^b4rw7k\n    - 狀態：暫停\n    - lend :: 借出\n', 0, 'lend 英翻中'],
  ['寫錯的目標（中翻英答案有中文）', '- lend 中翻英 ^b4rw7k\n    - 借出 :: 借出\n', 0, 'lend 中翻英'],
  ['名稱行中間的 ID', '- lend ^b4rw7k 英翻中\n    - lend :: 借出\n', 0, 'lend 英翻中'],
  ['名稱寫成兩行時第一行的 ID', '- lend 英翻中 ^b4rw7k\n  接續文字\n    - lend :: 借出\n', 0, 'lend 英翻中'],
  ['同一個值在名稱行出現兩次', '- lend ^b4rw7k 英翻中 ^b4rw7k\n    - lend :: 借出\n', 0, 'lend 英翻中'],
] as const) void test('第 12 項算衝突：' + label, async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: copy });
  assert.deepEqual(h.state.conflicts(), [{ id: ID, targets: [{ path: P, line: 0, name: 'borrow 英翻中' }, { path: Q, line, name }] }]);
});

void test('第 12 項算衝突：家長自訂的 ID 也算，不是只看程式產生的 6 碼', async t => {
  const h = await setup(t, { [P]: '- A ^Mine-1\n    - A :: 甲\n', [Q]: '- B ^Mine-1\n    - B :: 乙\n' });
  assert.deepEqual(h.state.conflicts(), [{ id: 'Mine-1', targets: [{ path: P, line: 0, name: 'A' }, { path: Q, line: 0, name: 'B' }] }]);
});

// §8 第 13 項：另有一個真正的 b4rw7k 目標時，這些都不造成衝突、那個目標照其他門檻出題。
for (const [label, other] of [
  ['一般筆記（底下沒有題目）', '- 筆記 ^b4rw7k\n'],
  ['引言框裡帶題目', '> - borrow 英翻中 ^b4rw7k\n>     - borrow :: 借入\n'],
  ['程式碼區塊裡', '```\n- borrow 英翻中 ^b4rw7k\n    - borrow :: 借入\n```\n'],
  ['帶來源類型的轉錄稿', '---\n來源類型: 課本\n---\n- borrow 英翻中 ^b4rw7k\n    - borrow :: 借入\n'],
  ['題目行的區塊 ID', '- lend 英翻中 ^cccccc\n    - lend :: 借出 ^b4rw7k\n'],
  ['只寫在接續行尾', '- lend 英翻中\n  接續文字 ^b4rw7k\n    - lend :: 借出\n'],
  ['最上層直接寫題目、行尾有 ID', '- borrow :: 借入 ^b4rw7k\n'],
] as const) void test('第 13 項不算衝突：' + label, async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: other });
  assert.deepEqual(h.state.conflicts(), []);
  assert.ok(h.share().includes(ID), h.share().join());
  assert.equal(h.state.canAnswer(ID), true);
});

/** 第 1 項共同的預期：今天的份與再複習一些都沒有、不收作答、紀錄沒有多一行；missing 不算它們。 */
async function stopped(h: Harness, paths: readonly string[]): Promise<void> {
  assert.ok(!h.share().includes(ID), h.share().join());
  assert.ok(!h.more().includes(ID), h.more().join());
  assert.equal(h.state.canAnswer(ID), false);
  const before = h.logLines();
  assert.equal(h.state.answer({ lt: ID, r: 'good', v: '12345678' }), null);
  assert.equal(h.state.answer({ lt: ID, r: 'miss', src: 'mistake' }), null);
  assert.equal(h.state.answer({ set: 'status', lt: ID, val: '暫停' }), null);
  await h.state.flush();
  assert.deepEqual(h.logLines(), before);
  for (const path of paths) assert.equal(h.state.deckStatus(path).missing, 0, path);
}
for (const [label, vault, paths] of [
  ['篇內貼在下面', { [P]: ORIGINAL + COPY }, [P]],
  ['篇內貼在上面', { [P]: COPY + ORIGINAL }, [P]],
  ['跨篇副本的路徑在前', { [P]: ORIGINAL, [A0]: COPY }, [P, A0]],
  ['跨篇副本的路徑在後', { [P]: ORIGINAL, [Z9]: COPY }, [P, Z9]],
] as const) {
  void test('第 1 項第一次載入就重複：' + label, async t => {
    const h = await setup(t, { ...vault, [Q]: OTHER });
    await stopped(h, paths);
    assert.deepEqual(h.state.conflicts().map(each => each.targets.length), [2]);
    assert.ok(h.share().includes('cccccc'), '其他目標照常');
  });
  void test('第 1 項讀著讀著才出現：' + label, async t => {
    const h = await setup(t, { [P]: ORIGINAL, [Q]: OTHER });
    assert.ok(h.share().includes(ID));
    for (const [path, text] of Object.entries(vault)) await h.edit(path, text);
    await stopped(h, paths);
  });
}

void test('第 2 項存檔與離開筆記的備援不偷偷解掉衝突：衝突的兩行逐字不變，另一個沒有 ID 的目標照補', async t => {
  const mixed = COPY + ORIGINAL + '- new\n    - new :: 新\n';
  const filled = COPY + ORIGINAL + '- new ^aaaaaa\n    - new :: 新\n';
  const saved = await setup(t, { [P]: mixed });
  const editor = createMemoryEditor(saved, P, mixed);
  assert.deepEqual(await saved.state.save(editor), { kind: 'done', added: 1 });
  assert.equal(editor.value, filled);
  assert.equal(saved.texts.get(P), filled);
  await stopped(saved, [P]);
  const left = await setup(t, { [P]: mixed });
  assert.equal(await left.state.fillIds(P), true);
  assert.equal(left.texts.get(P), filled);
  await stopped(left, [P]);
});

void test('第 2 項衝突的目標不歸位、不改縮排：行中的 ID 留在行中，多一層的題目不動', async t => {
  const text = '- A ^b4rw7k B\n    - a :: 甲\n- C ^b4rw7k\n        - c :: 丙\n';
  const h = await setup(t, { [P]: text });
  const editor = createMemoryEditor(h, P, text);
  assert.deepEqual(await h.state.save(editor), { kind: 'unchanged' });
  assert.equal(editor.value, text);
  assert.equal(await h.state.fillIds(P), false);
  assert.equal(h.texts.get(P), text);
});

void test('第 2 項配新 ID 時衝突的 ID 照樣算用過', async t => {
  const h = await setup(t, { [P]: '- A ^aaaaaa\n    - a :: 甲\n- B ^aaaaaa\n    - b :: 乙\n- new\n    - new :: 新\n' });
  assert.equal(await h.state.fillIds(P), true);
  assert.equal(h.texts.get(P), '- A ^aaaaaa\n    - a :: 甲\n- B ^aaaaaa\n    - b :: 乙\n- new ^aaaaab\n    - new :: 新\n');
});

void test('第 5 項恢復：刪掉同一篇的副本，b4rw7k 又出現、用的是 10-01 那筆的記憶', async t => {
  const h = await setup(t, { [P]: ORIGINAL + COPY });
  assert.equal(h.state.canAnswer(ID), false);
  await h.edit(P, ORIGINAL);
  assert.deepEqual(h.state.conflicts(), []);
  assert.deepEqual(h.state.today().share.filter(item => item.lt === ID).map(item => item.lane), ['due']);
  assert.equal(h.state.canAnswer(ID), true);
});

void test('第 5 項恢復：另一台的刪除經同步到了（別篇的副本不見了），剩下的沿用這個 ID 與它的紀錄', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY });
  h.remove(Q);
  await h.settle();
  assert.deepEqual(h.state.conflicts(), []);
  assert.deepEqual(h.state.today().share.map(item => [item.lt, item.deck, item.lane]), [[ID, P, 'due']]);
  assert.equal(h.state.canAnswer(ID), true);
});

void test('第 5 項恢復時其他門檻照查：剩下的是暫停的目標就不出，但能作答', async t => {
  const h = await setup(t, { [P]: '- borrow 英翻中 ^b4rw7k\n    - 狀態：暫停\n    - borrow :: 借入\n', [Q]: COPY });
  h.remove(Q);
  await h.settle();
  assert.deepEqual(h.state.conflicts(), []);
  assert.ok(!h.share().includes(ID));
  assert.equal(h.state.canAnswer(ID), true);
});

void test('第 6 項讀不到不當刪除：副本那一篇讀不到時衝突照舊；之後讀到、內容沒有副本才解除', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY + OTHER });
  h.failing.add(Q);
  h.write(Q, OTHER);
  await h.settle();
  assert.deepEqual(h.state.unread(), [Q]);
  assert.equal(h.state.conflicts().length, 1);
  assert.equal(h.state.canAnswer(ID), false);
  h.failing.delete(Q);
  await h.settle(1001);
  assert.deepEqual(h.state.unread(), []);
  assert.deepEqual(h.state.conflicts(), []);
  assert.equal(h.state.canAnswer(ID), true);
});

void test('第 7 項兩台讀取順序不同：兩台都讀到之後 conflicts 相同，都不出、都不收作答', async t => {
  const vault = { [P]: ORIGINAL, [Q]: COPY };
  const first = await setup(t, vault);
  // 裝置乙先只讀到副本那一篇，原本那篇晚到。
  const second = await setup(t, vault, { device: 'iPhone-2', fillIds: false }, [P]);
  assert.deepEqual(second.state.unread(), [P]);
  assert.equal(second.state.conflicts().length, 0);
  second.failing.delete(P);
  await second.settle(1001);
  assert.deepEqual(second.state.unread(), []);
  assert.deepEqual(second.state.conflicts(), first.state.conflicts());
  assert.deepEqual(first.state.conflicts(), pair(P, Q));
  for (const h of [first, second]) await stopped(h, [P, Q]);
});

void test('第 10 項取消照原本的門檻：衝突期間取消先前那一筆照寫，新的作答不寫', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY });
  assert.equal(typeof h.state.answer({ undo: REVIEW_T }), 'string');
  assert.deepEqual(h.state.history().reviews, []);
  assert.equal(h.state.answer({ lt: ID, r: 'good', v: '12345678' }), null);
});

void test('第 10 項取消的門檻不變：那一筆的 ID 也需要新版時，取消照舊不寫', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY, [Z9]: '---\n需要版本: 9.0.0\n---\n' + ORIGINAL });
  assert.equal(h.state.answer({ undo: REVIEW_T }), null);
});

void test('第 11 項 iPhone（fillIds: false）：衝突照算、作答照擋，卡組不寫', async t => {
  const text = ORIGINAL + COPY + '- new\n    - new :: 新\n';
  const h = await setup(t, { [P]: text }, { fillIds: false });
  await stopped(h, []);
  assert.equal(h.state.deckStatus(P).missing, 1, '只算沒有 ID 的那一個');
  assert.deepEqual(h.state.conflicts(), pair(P, P, 2));
  assert.equal(await h.state.fillIds(P), false);
  assert.equal(h.texts.get(P), text);
});

void test('第 15 項 (a) 一個讀得懂的目標和需要新版的卡組同一個 ID：不列衝突，讀得懂的那一個照原本停', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: '---\n需要版本: 9.0.0\n---\n' + COPY });
  assert.deepEqual(h.state.conflicts(), []);
  assert.ok(!h.share().includes(ID));
  assert.equal(h.state.canAnswer(ID), false);
});

void test('第 16 項跨層：另一份先被待處理拿掉，衝突照算，不因 changed 已不出題就只剩一個', async t => {
  const borrow = (id: string) => '- borrow ^' + id + '\n    - borrow :: 借入\n';
  const h = await setup(t, { [P]: borrow('aaaaaa'), [Q]: OTHER });
  await h.edit(P, borrow('bbbbbb'));
  assert.deepEqual(h.state.deckStatus(P).issues.map(issue => issue.kind), ['changed']);
  await h.edit(Q, OTHER + '- lend ^bbbbbb\n    - lend :: 借出\n');
  assert.ok(!h.share().includes('bbbbbb'), h.share().join());
  assert.deepEqual(h.state.conflicts(), [{ id: 'bbbbbb', targets: [{ path: P, line: 0, name: 'borrow' }, { path: Q, line: 2, name: 'lend' }] }]);
});

void test('第 18 項重開之後照目前的內容重算：衝突還在時新開的 state 照停，解除後新開的沒有衝突', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY });
  const reopen = async () => {
    const state = createState({ files: h.files, device: 'PC-test', delay: DELAY, fillIds: true, now: () => Date.parse(NOW), offset: () => 480 });
    t.after(() => state.close());
    await state.ready();
    return state;
  };
  const still = await reopen();
  assert.deepEqual(still.conflicts(), pair(P, Q));
  assert.equal(still.canAnswer(ID), false);
  h.remove(Q);
  await h.settle();
  const clear = await reopen();
  assert.deepEqual(clear.conflicts(), []);
  assert.ok(clear.today().share.some(item => item.lt === ID));
});
