import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { IdIssue, State, StateOptions } from '../src/state/index.ts';
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

const duplicateIssues = (h: Harness, path: string): IdIssue[] => h.state.deckStatus(path).issues.filter(issue => issue.kind === 'duplicate');
/** 第 1 項共同的預期：今天的份與再複習一些都沒有、不收作答、紀錄沒有多一行；missing 不算它們。 */
async function stopped(h: Harness, paths: readonly string[]): Promise<void> {
  assert.ok(!h.share().includes(ID), h.share().join());
  assert.ok(!h.more().includes(ID), h.more().join());
  assert.equal(h.state.canAnswer(ID), false);
  await h.state.flush();
  const before = h.logLines();
  assert.equal(h.state.answer({ lt: ID, r: 'good', v: '12345678' }), null);
  assert.equal(h.state.answer({ lt: ID, r: 'miss', src: 'mistake' }), null);
  assert.equal(h.state.answer({ set: 'status', lt: ID, val: '暫停' }), null);
  await h.state.flush();
  assert.deepEqual(h.logLines(), before);
  for (const path of paths) {
    assert.equal(h.state.deckStatus(path).missing, 0, path);
    assert.ok(duplicateIssues(h, path).length > 0, path);
  }
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

// ---- §3-2：家長選「這一個是新加的」 ----

/** 這一篇用了重複 ID 的問題裡，第 line 行那一個。 */
function issueAt(h: Harness, path: string, line: number): IdIssue {
  const issue = duplicateIssues(h, path).find(each => each.line === line);
  assert.ok(issue, path + ' 第 ' + String(line) + ' 行沒有 duplicate 問題');
  return issue;
}
const plain = (issues: IdIssue[]) => issues.map(({ path, line, name, kind, restore, others }) => ({ path, line, name, kind, restore, others }));

void test('duplicate 問題的樣子：每個衝突的目標在它那一篇一個問題，restore 是 null，others 是同一個 ID 的其他目標', async t => {
  const h = await setup(t, { [P]: ORIGINAL + COPY, [Q]: '- third 英翻中 ^b4rw7k\n    - third :: 第三\n' });
  const borrow = { path: P, line: 0, name: 'borrow 英翻中' }, lend = { path: P, line: 2, name: 'lend 英翻中' }, third = { path: Q, line: 0, name: 'third 英翻中' };
  assert.deepEqual(plain(h.state.deckStatus(P).issues), [
    { ...borrow, kind: 'duplicate', restore: null, others: [lend, third] },
    { ...lend, kind: 'duplicate', restore: null, others: [borrow, third] },
  ]);
  assert.deepEqual(plain(h.state.deckStatus(Q).issues), [{ ...third, kind: 'duplicate', restore: null, others: [borrow, lend] }]);
});

void test('第 3 項三份同一個 ID，家長選第二份：只有那一行換成新 ID，第一、三份仍衝突，別篇的檔逐字不變', async t => {
  const second = '- second 英翻中 ^b4rw7k\n    - second :: 第二\n', third = '- third 英翻中 ^b4rw7k\n    - third :: 第三\n';
  const text = ORIGINAL + second + third;
  const h = await setup(t, { [P]: text, [Q]: OTHER });
  const editor = createMemoryEditor(h, P, text);
  const firstIssue = issueAt(h, P, 0);
  assert.deepEqual(await h.state.resolve(issueAt(h, P, 2), 'new', editor), { kind: 'done', added: 0 });
  assert.equal(editor.value, ORIGINAL + '- second 英翻中 ^aaaaaa\n    - second :: 第二\n' + third);
  assert.equal(h.texts.get(P), editor.value);
  assert.equal(h.texts.get(Q), OTHER);
  assert.deepEqual(h.state.conflicts(), [{ id: ID, targets: [{ path: P, line: 0, name: 'borrow 英翻中' }, { path: P, line: 4, name: 'third 英翻中' }] }]);
  assert.ok(!h.share().includes(ID));
  assert.ok(h.share().includes('aaaaaa'), '新加的那一個用新 ID 出題');
  assert.deepEqual(h.state.today().share.filter(item => item.lt === 'aaaaaa').map(item => item.lane), ['new'], '從頭複習');
  assert.equal(h.state.canAnswer('aaaaaa'), true);
  assert.deepEqual(duplicateIssues(h, P).map(issue => issue.line), [0, 4]);
  assert.equal(duplicateIssues(h, P)[0], firstIssue, '只有 others 變了：同一個物件');
  assert.deepEqual(h.state.history().reviews.map(review => review.lt), [ID], '紀錄不變');
});

void test('家長選新加的之後，同一篇其他沒有 ID 的目標照一般規則補；只剩一個時問題消失、剩下的恢復', async t => {
  const text = ORIGINAL + COPY + '- new\n    - new :: 新\n';
  const h = await setup(t, { [P]: text });
  const editor = createMemoryEditor(h, P, text);
  assert.deepEqual(await h.state.resolve(issueAt(h, P, 2), 'new', editor), { kind: 'done', added: 0 });
  assert.equal(editor.value, ORIGINAL + '- lend 英翻中 ^aaaaaa\n    - lend :: 借出\n- new ^aaaaab\n    - new :: 新\n');
  assert.deepEqual(h.state.conflicts(), []);
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [], malformed: [] });
  assert.deepEqual(h.state.today().share.filter(item => item.lt === ID).map(item => item.lane), ['due']);
  assert.equal(h.state.canAnswer(ID), true);
});

void test('第 3 項 restore 對 duplicate 回 stale，什麼都不寫', async t => {
  const text = ORIGINAL + COPY;
  const h = await setup(t, { [P]: text });
  const editor = createMemoryEditor(h, P, text);
  assert.deepEqual(await h.state.resolve(issueAt(h, P, 2), 'restore', editor), { kind: 'stale' });
  assert.equal(editor.value, text);
  assert.equal(h.texts.get(P), text);
  assert.equal(duplicateIssues(h, P).length, 2);
});

void test('第 4 項別篇的不能從這裡改：編輯器不是問題的那一篇，回 stale', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY });
  const editor = createMemoryEditor(h, P, ORIGINAL);
  assert.deepEqual(await h.state.resolve(issueAt(h, Q, 0), 'new', editor), { kind: 'stale' });
  assert.equal(editor.value, ORIGINAL);
  assert.equal(h.texts.get(Q), COPY);
});

// 第 4 項：送出時核對。每一種都測 state 重讀之後才送舊物件（reread）與 state 還沒重讀就送（editor 的文字已經變了）。
for (const reread of [true, false]) {
  const when = reread ? '等 state 重讀之後才送舊物件' : 'state 還沒重讀就送';
  /** 開一個 P 有 before、Q 有 q 的 vault，拿 P 第 line 行的舊問題，把文字改成 after 之後送出。 */
  async function submitAfter(t: TestContext, before: string, after: string, line: number, q?: string): Promise<{ h: Harness; editor: ReturnType<typeof createMemoryEditor> }> {
    const h = await setup(t, { [P]: before, ...q === undefined ? {} : { [Q]: q } });
    const old = issueAt(h, P, line);
    const editor = createMemoryEditor(h, P, after);
    if (reread) await h.edit(P, after);
    assert.deepEqual(await h.state.resolve(old, 'new', editor), { kind: 'stale' });
    assert.equal(editor.value, after, '沒有換 ID');
    return { h, editor };
  }
  void test('第 4 項那一行改了名稱，舊物件回 stale，問題照目前的內容重算：' + when, async t => {
    const { h } = await submitAfter(t, ORIGINAL + COPY, ORIGINAL + COPY.replace('lend 英翻中', 'loan 英翻中'), 2);
    assert.deepEqual(duplicateIssues(h, P).map(issue => [issue.line, issue.name]), [[0, 'borrow 英翻中'], [2, 'loan 英翻中']]);
  });
  void test('第 4 項那一行改了題目，舊物件回 stale：' + when, async t => {
    const { h } = await submitAfter(t, ORIGINAL + COPY, ORIGINAL + COPY.replace('lend :: 借出', 'lend :: 借給'), 2);
    assert.equal(duplicateIssues(h, P).length, 2);
  });
  void test('第 4 項被搬到別行，舊物件回 stale：' + when, async t => {
    const { h } = await submitAfter(t, ORIGINAL + COPY, '\n' + ORIGINAL + COPY, 2);
    assert.deepEqual(duplicateIssues(h, P).map(issue => issue.line), [1, 3]);
  });
  void test('第 4 項副本已經刪掉，舊物件回 stale、問題消失：' + when, async t => {
    const { h } = await submitAfter(t, ORIGINAL + COPY, ORIGINAL, 0);
    assert.deepEqual(h.state.deckStatus(P).issues, []);
    assert.equal(h.state.canAnswer(ID), true);
  });
  void test('第 4 項兩份同名同題互換位置（備註不同），舊物件回 stale：' + when, async t => {
    const first = '- borrow ^b4rw7k\n    - 備註：甲\n    - borrow :: 借入\n', second = '- borrow ^b4rw7k\n    - 備註：乙\n    - borrow :: 借入\n';
    const { h } = await submitAfter(t, first + second, second + first, 3);
    assert.equal(duplicateIssues(h, P).length, 2);
  });
  void test('第 4 項新物件照常能用：' + when, async t => {
    const moved = '\n' + ORIGINAL + COPY;
    const { h, editor } = await submitAfter(t, ORIGINAL + COPY, moved, 2);
    await h.settle();
    assert.deepEqual(await h.state.resolve(issueAt(h, P, 3), 'new', editor), { kind: 'done', added: 0 });
    assert.equal(editor.value, '\n' + ORIGINAL + '- lend 英翻中 ^aaaaaa\n    - lend :: 借出\n');
  });
}

void test('第 4 項別篇的副本已經刪掉（state 重讀過）：舊物件回 stale', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY });
  const old = issueAt(h, P, 0);
  h.remove(Q);
  await h.settle();
  const editor = createMemoryEditor(h, P, ORIGINAL);
  assert.deepEqual(await h.state.resolve(old, 'new', editor), { kind: 'stale' });
  assert.equal(editor.value, ORIGINAL);
});

void test('第 4 項只有別的目標改動（others 變了）：舊物件照樣能用，others 原地更新', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY });
  const old = issueAt(h, P, 0);
  await h.edit(Q, COPY.replace('lend 英翻中', 'loan 英翻中'));
  assert.equal(issueAt(h, P, 0), old);
  assert.deepEqual(old.others, [{ path: Q, line: 0, name: 'loan 英翻中' }]);
  const editor = createMemoryEditor(h, P, ORIGINAL);
  assert.deepEqual(await h.state.resolve(old, 'new', editor), { kind: 'done', added: 0 });
  assert.equal(editor.value, '- borrow 英翻中 ^aaaaaa\n    - borrow :: 借入\n');
});

void test('改名：問題跟著新路徑，同一個物件', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY });
  const old = issueAt(h, P, 0);
  h.rename(P, 'Essence Cards/P2.md');
  await h.settle();
  assert.equal(old.path, 'Essence Cards/P2.md');
  assert.equal(issueAt(h, 'Essence Cards/P2.md', 0), old);
  assert.deepEqual(issueAt(h, Q, 0).others, [{ path: 'Essence Cards/P2.md', line: 0, name: 'borrow 英翻中' }]);
});

void test('第 9 項 (a) 選副本是新加的之後，原本的目標在外部弄丟 ID 仍會待處理', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY });
  const editor = createMemoryEditor(h, Q, COPY);
  assert.deepEqual(await h.state.resolve(issueAt(h, Q, 0), 'new', editor), { kind: 'done', added: 0 });
  assert.deepEqual(h.state.conflicts(), []);
  await h.edit(P, ORIGINAL.replace(' ^b4rw7k', ''));
  assert.deepEqual(h.state.deckStatus(P).issues.map(issue => [issue.kind, issue.restore]), [['lost', ID]]);
});

void test('第 9 項 (b) 在編輯器刪掉別篇的副本（removedInEditor）之後，原本的目標在外部弄丟 ID 仍會待處理', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: COPY + OTHER });
  h.state.removedInEditor(Q, [ID]);
  await h.edit(Q, OTHER);
  assert.deepEqual(h.state.conflicts(), []);
  await h.edit(P, ORIGINAL.replace(' ^b4rw7k', ''));
  assert.deepEqual(h.state.deckStatus(P).issues.map(issue => [issue.kind, issue.restore]), [['lost', ID]]);
});

void test('第 9 項 (b) 對照：別篇沒有這個 ID 時，編輯器刪掉的照舊是刻意拿掉', async t => {
  const h = await setup(t, { [P]: ORIGINAL, [Q]: OTHER });
  h.state.removedInEditor(P, [ID]);
  await h.edit(P, ORIGINAL.replace(' ^b4rw7k', ''));
  assert.deepEqual(h.state.deckStatus(P).issues, []);
});

for (const choice of ['new', 'restore'] as const) void test('第 9 項 (c) changed 選 ' + choice + ' 之後，還在別的目標上的 ID 不算刻意拿掉（Codex F1）', async t => {
  const a = (id: string) => '- A ^' + id + '\n    - a :: 甲\n', b = (id: string) => '- B ^' + id + '\n    - b :: 乙\n';
  const h = await setup(t, { [P]: a('aaaaaa'), [Q]: OTHER });
  await h.edit(P, a('bbbbbb'));
  const [issue] = h.state.deckStatus(P).issues;
  assert.deepEqual([issue.kind, issue.restore], ['changed', 'aaaaaa']);
  await h.edit(Q, OTHER + b('bbbbbb'));
  const editor = createMemoryEditor(h, P, a('bbbbbb'));
  assert.equal((await h.state.resolve(issue, choice, editor)).kind, 'done');
  assert.deepEqual(h.state.conflicts(), []);
  await h.edit(Q, OTHER + '- B\n    - b :: 乙\n');
  assert.deepEqual(h.state.deckStatus(Q).issues.map(each => [each.kind, each.restore]), [['lost', 'bbbbbb']]);
});

void test('第 14 項 ambiguous-id：候選不當成確定的 ID，不列 duplicate；ambiguous 照原本待處理，選還原回 stale', async t => {
  const h = await setup(t, { [P]: '- A ^b4rw7k\n    - a :: 甲\n', [Q]: OTHER });
  await h.edit(P, '- A ^b4rw7k 和 ^p7q2w8\n    - a :: 甲\n');
  assert.deepEqual(h.state.deckStatus(P).issues.map(issue => [issue.kind, issue.restore]), [['ambiguous', ID]]);
  await h.edit(Q, OTHER + '- B ^b4rw7k\n    - b :: 乙\n');
  assert.deepEqual(h.state.conflicts(), []);
  const [issue] = h.state.deckStatus(P).issues;
  assert.deepEqual(h.state.deckStatus(P).issues.map(each => each.kind), ['ambiguous']);
  assert.deepEqual(h.state.deckStatus(Q).issues, []);
  const text = '- A ^b4rw7k 和 ^p7q2w8\n    - a :: 甲\n';
  const editor = createMemoryEditor(h, P, text);
  assert.deepEqual(await h.state.resolve(issue, 'restore', editor), { kind: 'stale' });
  assert.equal(editor.value, text);
});

void test('第 15 項 (b) 讀得懂的 A、B 和需要新版的 C 都是 b4rw7k：A、B 列 duplicate、others 不含 C；選 A 之後 A 照常出，B 仍不出', async t => {
  const c = '---\n需要版本: 9.0.0\n---\n- C ^b4rw7k\n    - c :: 丙\n';
  const a = '- A ^b4rw7k\n    - a :: 甲\n', b = '- B ^b4rw7k\n    - b :: 乙\n';
  const h = await setup(t, { [P]: a, [Q]: b, [Z9]: c });
  assert.deepEqual(h.state.conflicts(), [{ id: ID, targets: [{ path: P, line: 0, name: 'A' }, { path: Q, line: 0, name: 'B' }] }]);
  assert.deepEqual(issueAt(h, P, 0).others, [{ path: Q, line: 0, name: 'B' }]);
  assert.deepEqual(h.state.deckStatus(Z9), { missing: 0, issues: [], malformed: [], needsUpdate: true });
  const editor = createMemoryEditor(h, P, a);
  assert.deepEqual(await h.state.resolve(issueAt(h, P, 0), 'new', editor), { kind: 'done', added: 0 });
  assert.equal(editor.value, '- A ^aaaaaa\n    - a :: 甲\n');
  assert.ok(h.share().includes('aaaaaa'));
  assert.deepEqual(h.state.deckStatus(Q), { missing: 0, issues: [], malformed: [] });
  assert.ok(!h.share().includes(ID));
  assert.equal(h.state.canAnswer(ID), false);
  assert.equal(h.texts.get(Z9), c);
});

void test('第 17 項同一個目標同時是 changed 與衝突：兩個問題都列；選當成新的之後兩個都消失（從 changed 或 duplicate 選都一樣）', async t => {
  const borrow = (id: string) => '- borrow ^' + id + '\n    - borrow :: 借入\n';
  const lend = OTHER + '- lend ^bbbbbb\n    - lend :: 借出\n';
  for (const kind of ['changed', 'duplicate']) {
    const h = await setup(t, { [P]: borrow('aaaaaa'), [Q]: OTHER });
    await h.edit(P, borrow('bbbbbb'));
    await h.edit(Q, lend);
    assert.deepEqual(h.state.deckStatus(P).issues.map(issue => issue.kind), ['changed', 'duplicate']);
    const issue = h.state.deckStatus(P).issues.find(each => each.kind === kind);
    assert.ok(issue);
    const editor = createMemoryEditor(h, P, borrow('bbbbbb'));
    assert.equal((await h.state.resolve(issue, 'new', editor)).kind, 'done', kind);
    assert.deepEqual(h.state.deckStatus(P).issues, [], kind);
    assert.deepEqual(h.state.conflicts(), [], kind);
    assert.deepEqual(h.state.deckStatus(Q).issues, [], kind);
    assert.ok(h.share().includes('bbbbbb'), kind);
  }
});

// Codex L2 的 F1：同一篇的另一個副本也用這個 ID 時，changed 不能跟著 ID 移過去：還原選項要有原目標身分的證據（D-134）。
const named = (name: string, id: string) => '- ' + name + ' ^' + id + '\n    - ' + name + ' :: ' + name + ' 的答案\n';
const copied = (_name: string, id: string) => '- 同名 ^' + id + '\n    - 同一題 :: 同一個答案\n';
const brief = (issues: IdIssue[]) => issues.map(({ line, name, kind, restore }) => ({ line, name, kind, restore }));
/** A 從 aaaaaa 被外部改成 bbbbbb（changed），同一篇再出現另一個用 bbbbbb 的 B。 */
async function changedThenCopied(t: TestContext, make: (name: string, id: string) => string): Promise<Harness> {
  const h = await setup(t, { [P]: make('A', 'aaaaaa') });
  await h.edit(P, make('A', 'bbbbbb'));
  await h.edit(P, make('A', 'bbbbbb') + make('B', 'bbbbbb'));
  assert.deepEqual(h.state.deckStatus(P).issues.map(({ line, kind, restore }) => ({ line, kind, restore })), [
    { line: 0, kind: 'changed', restore: 'aaaaaa' },
    { line: 0, kind: 'duplicate', restore: null },
    { line: 2, kind: 'duplicate', restore: null },
  ]);
  return h;
}

for (const [label, make] of [['內容不同', named], ['整段複製、同名同題', copied]] as const) for (const kind of ['duplicate', 'changed']) {
  void test('F1 同一篇（' + label + '）：選 A 的 ' + kind + ' 當成新的，A 的兩個問題一起結束，B 沒有問題、照常出題', async t => {
    const h = await changedThenCopied(t, make);
    const issue = h.state.deckStatus(P).issues.find(each => each.line === 0 && each.kind === kind);
    assert.ok(issue);
    assert.equal((await h.state.resolve(issue, 'new', createMemoryEditor(h, P, make('A', 'bbbbbb') + make('B', 'bbbbbb')))).kind, 'done');
    assert.equal(h.texts.get(P), make('A', 'aaaaab') + make('B', 'bbbbbb'));
    assert.deepEqual(h.state.deckStatus(P).issues, []);
    assert.deepEqual(h.state.conflicts(), []);
    assert.deepEqual(h.share().sort(), ['aaaaab', 'bbbbbb']);
  });
}

void test('F1 選 B 是新加的：A 本來就有的 changed 留著、還能還原；B 換新 ID', async t => {
  const h = await changedThenCopied(t, named);
  assert.equal((await h.state.resolve(issueAt(h, P, 2), 'new', createMemoryEditor(h, P, named('A', 'bbbbbb') + named('B', 'bbbbbb')))).kind, 'done');
  const after = named('A', 'bbbbbb') + named('B', 'aaaaab');
  assert.equal(h.texts.get(P), after);
  assert.deepEqual(h.state.conflicts(), []);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: 'A', kind: 'changed', restore: 'aaaaaa' }]);
  assert.deepEqual(h.share(), ['aaaaab']);
  assert.equal((await h.state.resolve(h.state.deckStatus(P).issues[0], 'restore', createMemoryEditor(h, P, after))).kind, 'done');
  assert.equal(h.texts.get(P), named('A', 'aaaaaa') + named('B', 'aaaaab'));
  assert.deepEqual(h.state.deckStatus(P).issues, []);
});

void test('F1 相鄰：家長自己刪掉 A，changed 跟著結束，不移給剩下的 B；B 照常出題', async t => {
  const h = await changedThenCopied(t, named);
  await h.edit(P, named('B', 'bbbbbb'));
  assert.deepEqual(h.state.deckStatus(P).issues, []);
  assert.deepEqual(h.state.conflicts(), []);
  assert.deepEqual(h.share(), ['bbbbbb']);
});

void test('F1 相鄰：A 的 ID 又被外部改掉，changed 還是 A 的（可還原 aaaaaa），不移給 B', async t => {
  const h = await changedThenCopied(t, named);
  await h.edit(P, named('A', 'cccccc') + named('B', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: 'A', kind: 'changed', restore: 'aaaaaa' }]);
  assert.deepEqual(h.state.conflicts(), []);
  assert.deepEqual(h.share(), ['bbbbbb']);
});

void test('F1 相鄰：A、B 對調位置，changed 跟著 A，不是跟著最近的行號', async t => {
  const h = await changedThenCopied(t, named);
  await h.edit(P, named('B', 'bbbbbb') + named('A', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues.filter(each => each.kind === 'changed')), [{ line: 2, name: 'A', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('F1 相鄰：B 貼在 A 上面（上一版只有 A），changed 跟著 A，不是跟著最近的行號', async t => {
  const h = await setup(t, { [P]: named('A', 'aaaaaa') });
  await h.edit(P, named('A', 'bbbbbb'));
  await h.edit(P, named('B', 'bbbbbb') + named('A', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues.filter(each => each.kind === 'changed')), [{ line: 2, name: 'A', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('F1 對照：整段複製再刪掉原本那一段（同名同題），等於搬走，changed 跟著留下的那一段', async t => {
  const h = await changedThenCopied(t, copied);
  await h.edit(P, copied('B', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
  assert.deepEqual(h.state.conflicts(), []);
});

// Codex 再審的 R1：這個 ID 不只一個目標在用時，還原選項只跟著名稱和題目都沒變的目標；同名或有幾題相同都不算（D-134）。
const twin = (name: string, id: string | null) => '- 同名' + (id ? ' ^' + id : '') + '\n    - ' + name + ' :: ' + name + ' 的答案\n';
const sameQuestion = (name: string, id: string) => '- ' + name + ' ^' + id + '\n    - 同一題 :: 同一個答案\n';
const partly = (name: string, id: string) => '- 同名 ^' + id + '\n    - 共同 :: 共同的答案\n    - ' + name + ' :: ' + name + ' 的答案\n';

for (const [label, make, deleted] of [
  ['改了名稱、題目相同', sameQuestion, sameQuestion('B', 'bbbbbb')],
  ['同名、題目不同', twin, twin('B', 'bbbbbb')],
] as const) {
  void test('R1 整段複製又改過再刪掉原本那一段（' + label + '）：認不出是不是同一個，changed 結束，不給 B 還原選項', async t => {
    const h = await changedThenCopied(t, make);
    await h.edit(P, deleted);
    assert.deepEqual(h.state.deckStatus(P).issues, []);
    assert.deepEqual(h.state.conflicts(), []);
    assert.deepEqual(h.share(), ['bbbbbb']);
  });
}

void test('R1 同名、題目不同，A 的 ID 又被外部改掉：changed 還是 A 的，不移給 B；還原寫回 A', async t => {
  const h = await changedThenCopied(t, twin);
  const after = twin('A', 'cccccc') + twin('B', 'bbbbbb');
  await h.edit(P, after);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
  assert.deepEqual(h.state.conflicts(), []);
  assert.equal((await h.state.resolve(h.state.deckStatus(P).issues[0], 'restore', createMemoryEditor(h, P, after))).kind, 'done');
  assert.equal(h.texts.get(P), twin('A', 'aaaaaa') + twin('B', 'bbbbbb'));
  assert.deepEqual(h.state.deckStatus(P).issues, []);
});

void test('R1 同名、題目不同，A 的 ID 被拿掉：changed 留在 A；還原寫回 A', async t => {
  const h = await changedThenCopied(t, twin);
  const after = twin('A', null) + twin('B', 'bbbbbb');
  await h.edit(P, after);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
  assert.equal((await h.state.resolve(h.state.deckStatus(P).issues[0], 'restore', createMemoryEditor(h, P, after))).kind, 'done');
  assert.equal(h.texts.get(P), twin('A', 'aaaaaa') + twin('B', 'bbbbbb'));
});

void test('R1 同名、題目不同，同一次把 A 的 ID 和題目都改掉：內容不一樣，還要家長選，但誰都不給還原選項', async t => {
  const h = await changedThenCopied(t, twin);
  await h.edit(P, twin('A 改過', 'cccccc') + twin('B', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: null }]);
});

void test('R1 同名、題目不同，同一次把 A 的 ID 拿掉、題目改掉：內容不一樣，誰都不給還原選項', async t => {
  const h = await changedThenCopied(t, twin);
  await h.edit(P, twin('A 改過', null) + twin('B', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'lost', restore: null }]);
});

void test('R1 ID 共用時同一次刪掉 A、新增一個目標：和沒有共用時一樣，新的目標不會拿到還原選項', async t => {
  const added = '- 新的\n    - 新題 :: 新答案\n';
  const h = await changedThenCopied(t, twin);
  await h.edit(P, twin('B', 'bbbbbb') + added);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 2, name: '新的', kind: 'lost', restore: null }]);
  const alone = await setup(t, { [Q]: twin('A', 'aaaaaa') });
  await alone.edit(Q, twin('A', 'bbbbbb'));
  await alone.edit(Q, added);
  assert.deepEqual(brief(alone.state.deckStatus(Q).issues), [{ line: 0, name: '新的', kind: 'lost', restore: null }]);
});

void test('R1 同名、只有一題相同，A 的 ID 又被外部改掉：還原選項不給 B', async t => {
  const h = await setup(t, { [P]: partly('A', 'aaaaaa') });
  await h.edit(P, partly('A', 'bbbbbb'));
  await h.edit(P, partly('A', 'bbbbbb') + partly('B', 'bbbbbb'));
  await h.edit(P, partly('A', 'cccccc') + partly('B', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('R1 同名、題目不同的 B 貼在 A 上面（上一版只有 A）：changed 跟著 A，不是跟著最近的行號', async t => {
  const h = await setup(t, { [P]: twin('A', 'aaaaaa') });
  await h.edit(P, twin('A', 'bbbbbb'));
  await h.edit(P, twin('B', 'bbbbbb') + twin('A', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues.filter(each => each.kind === 'changed')), [{ line: 2, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('R1 B 的 ID 被拿掉、A 的 ID 同時改掉：認不出來，兩個都不給還原選項', async t => {
  const h = await changedThenCopied(t, twin);
  await h.edit(P, twin('A', 'cccccc') + twin('B', null));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [
    { line: 0, name: '同名', kind: 'changed', restore: null },
    { line: 2, name: '同名', kind: 'lost', restore: null },
  ]);
});

void test('R1 ID 共用時改了 A 的題目：認不出是哪一個，changed 結束，兩個目標的 duplicate 留著要家長選', async t => {
  const h = await changedThenCopied(t, twin);
  await h.edit(P, twin('A 改過', 'bbbbbb') + twin('B', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [
    { line: 0, name: '同名', kind: 'duplicate', restore: null },
    { line: 2, name: '同名', kind: 'duplicate', restore: null },
  ]);
});

void test('R1 ID 共用時改了 A 的題目，同一次又新增一個目標：新的目標不會拿到還原選項', async t => {
  const h = await changedThenCopied(t, twin);
  const added = twin('A 改過', 'bbbbbb') + twin('B', 'bbbbbb');
  await h.edit(P, added + '- 新的\n    - 新題 :: 新答案\n');
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [
    { line: 0, name: '同名', kind: 'duplicate', restore: null },
    { line: 2, name: '同名', kind: 'duplicate', restore: null },
  ]);
});

// Codex 第三次審查的 R2：ID 共用不分同篇別篇；認不出來的問題有未知 ID 時，不管那個 ID 還在哪裡，還原選項都只跟著一樣的內容（D-134）。
const unrelated = '- 新的\n    - 新題 :: 新答案\n';
/** 和 changedThenCopied 一樣，但 B 在別篇。 */
async function changedThenElsewhere(t: TestContext): Promise<Harness> {
  const h = await setup(t, { [P]: twin('A', 'aaaaaa') });
  await h.edit(P, twin('A', 'bbbbbb'));
  await h.edit(Q, twin('B', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [
    { line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' },
    { line: 0, name: '同名', kind: 'duplicate', restore: null },
  ]);
  return h;
}

for (const [label, added, kind] of [
  ['沒有 ID', unrelated, 'lost'],
  ['有新的 ID', '- 新的 ^cccccc\n    - 新題 :: 新答案\n', 'changed'],
] as const) {
  void test('R2 同一次刪掉 A、新增無關的目標（' + label + '）：副本在別篇、同篇或沒有副本，都拿不到還原選項', async t => {
    const other = await changedThenElsewhere(t);
    await other.edit(P, added);
    assert.deepEqual(brief(other.state.deckStatus(P).issues), [{ line: 0, name: '新的', kind, restore: null }]);
    assert.deepEqual(other.state.conflicts(), []);
    const editor = createMemoryEditor(other, P, added);
    assert.equal((await other.state.resolve(other.state.deckStatus(P).issues[0], 'restore', editor)).kind, 'stale');
    assert.equal(editor.value, added);

    const same = await changedThenCopied(t, twin);
    await same.edit(P, twin('B', 'bbbbbb') + added);
    assert.deepEqual(brief(same.state.deckStatus(P).issues), [{ line: 2, name: '新的', kind, restore: null }]);

    const alone = await setup(t, { [P]: twin('A', 'aaaaaa') });
    await alone.edit(P, twin('A', 'bbbbbb'));
    await alone.edit(P, added);
    assert.deepEqual(brief(alone.state.deckStatus(P).issues), [{ line: 0, name: '新的', kind, restore: null }]);
  });
}

void test('R2 副本在別篇，A 的 ID 又被外部改掉：changed 還是 A 的；還原寫回 A', async t => {
  const h = await changedThenElsewhere(t);
  const after = twin('A', 'cccccc');
  await h.edit(P, after);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
  assert.deepEqual(h.state.conflicts(), []);
  assert.equal((await h.state.resolve(h.state.deckStatus(P).issues[0], 'restore', createMemoryEditor(h, P, after))).kind, 'done');
  assert.equal(h.texts.get(P), twin('A', 'aaaaaa'));
});

void test('R2 副本在別篇，A 的 ID 被拿掉：changed 留在 A；還原寫回 A', async t => {
  const h = await changedThenElsewhere(t);
  const after = twin('A', null);
  await h.edit(P, after);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
  assert.equal((await h.state.resolve(h.state.deckStatus(P).issues[0], 'restore', createMemoryEditor(h, P, after))).kind, 'done');
  assert.equal(h.texts.get(P), twin('A', 'aaaaaa'));
});

void test('R2 副本在別篇，同一次把 A 的 ID 和題目都改掉：還要家長選，但不給還原選項', async t => {
  const h = await changedThenElsewhere(t);
  await h.edit(P, twin('A 改過', 'cccccc'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: null }]);
});

void test('R2 副本在別篇，同一次把 A 的 ID 拿掉、題目改掉：還要家長選，但不給還原選項', async t => {
  const h = await changedThenElsewhere(t);
  await h.edit(P, twin('A 改過', null));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'lost', restore: null }]);
});

void test('R2 副本在別篇，改了 A 的題目：認不出是哪一個，changed 結束，兩篇的 duplicate 留著要家長選', async t => {
  const h = await changedThenElsewhere(t);
  const old = h.state.deckStatus(P).issues.find(each => each.kind === 'changed');
  assert.ok(old);
  const after = twin('A 改過', 'bbbbbb');
  await h.edit(P, after);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'duplicate', restore: null }]);
  assert.deepEqual(brief(h.state.deckStatus(Q).issues), [{ line: 0, name: '同名', kind: 'duplicate', restore: null }]);
  assert.equal((await h.state.resolve(old, 'restore', createMemoryEditor(h, P, after))).kind, 'stale');
  assert.equal(h.texts.get(P), after);
});

void test('R2 別篇的 B 貼過來取代 A（同一個 ID）：還原選項不跟著 ID 交給 B', async t => {
  const h = await changedThenElsewhere(t);
  await h.edit(P, twin('B', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'duplicate', restore: null }]);
});

for (const [label, order] of [['先通知這一篇', [P, Q]], ['先通知別篇', [Q, P]]] as const) {
  void test('R2 同一批把別篇的 B 搬來取代 A（' + label + '）：還原選項不跟著 ID 交給 B', async t => {
    const h = await changedThenElsewhere(t);
    h.texts.set(P, twin('B', 'bbbbbb'));
    h.texts.set(Q, '');
    h.notify(...order);
    await h.settle();
    assert.deepEqual(h.state.deckStatus(P).issues, []);
    assert.deepEqual(h.state.conflicts(), []);
  });
}

for (const [label, order] of [['先通知這一篇', [P, Q]], ['先通知別篇', [Q, P]]] as const) {
  void test('R2 同一批在別篇新增 B、改了 A 的題目（' + label + '）：認不出是哪一個，changed 結束，兩篇的 duplicate 留著', async t => {
    const h = await setup(t, { [P]: twin('A', 'aaaaaa') });
    await h.edit(P, twin('A', 'bbbbbb'));
    h.texts.set(P, twin('A 改過', 'bbbbbb'));
    h.texts.set(Q, twin('B', 'bbbbbb'));
    h.notify(...order);
    await h.settle();
    assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'duplicate', restore: null }]);
    assert.deepEqual(brief(h.state.deckStatus(Q).issues), [{ line: 0, name: '同名', kind: 'duplicate', restore: null }]);
  });
}

// Codex 第四次審查的 R3：同一批刪掉的卡組還算「這一批之前」的目標；只留這一批的證據，不記跨批的歷史。
for (const [label, order] of [['先通知這一篇', [P, Q]], ['先通知別篇', [Q, P]]] as const) {
  void test('R3 同一批把別篇整個刪掉、B 搬來取代 A（' + label + '）：和清空那一篇一樣，還原選項不跟著 ID 交給 B', async t => {
    const h = await changedThenElsewhere(t);
    const old = h.state.deckStatus(P).issues.find(each => each.kind === 'changed');
    assert.ok(old);
    const after = twin('B', 'bbbbbb');
    h.texts.set(P, after);
    h.texts.delete(Q);
    h.notify(...order);
    await h.settle();
    assert.deepEqual(h.state.deckStatus(P).issues, []);
    assert.deepEqual(h.state.conflicts(), []);
    const editor = createMemoryEditor(h, P, after);
    assert.equal((await h.state.resolve(old, 'restore', editor)).kind, 'stale');
    assert.equal(editor.value, after);
  });

  void test('R3 同一批把別篇整個刪掉、改了 A 的題目（' + label + '）：這一批之前還在共用，認不出是哪一個，changed 結束', async t => {
    const h = await changedThenElsewhere(t);
    h.texts.set(P, twin('A 改過', 'bbbbbb'));
    h.texts.delete(Q);
    h.notify(...order);
    await h.settle();
    assert.deepEqual(h.state.deckStatus(P).issues, []);
    assert.deepEqual(h.state.conflicts(), []);
  });
}

void test('R3 對照：同一批把別篇整個刪掉、A 只拿掉 ID（內容沒變）：changed 留在 A；還原寫回 A', async t => {
  const h = await changedThenElsewhere(t);
  const after = twin('A', null);
  h.texts.set(P, after);
  h.texts.delete(Q);
  h.notify(P, Q);
  await h.settle();
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
  assert.equal((await h.state.resolve(h.state.deckStatus(P).issues[0], 'restore', createMemoryEditor(h, P, after))).kind, 'done');
  assert.equal(h.texts.get(P), twin('A', 'aaaaaa'));
});

void test('R3 對照：需要新版的卡組同一批刪掉，本來就不算共用，A 改了題目還是 A 的', async t => {
  const h = await setup(t, { [P]: twin('A', 'aaaaaa') });
  await h.edit(P, twin('A', 'bbbbbb'));
  await h.edit(Q, '---\n需要版本: 9.0.0\n---\n' + twin('B', 'bbbbbb'));
  h.texts.set(P, twin('A 改過', 'bbbbbb'));
  h.texts.delete(Q);
  h.notify(P, Q);
  await h.settle();
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('R2 對照：別篇的副本不在了，共用就結束，A 改了題目也還是 A 的', async t => {
  const h = await changedThenElsewhere(t);
  h.remove(Q);
  await h.settle();
  await h.edit(P, twin('A 改過', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('R2 未知 ID 留在別篇不是目標的一行：同一次刪掉 A、新增無關的目標，拿不到還原選項', async t => {
  const h = await setup(t, { [P]: twin('A', 'aaaaaa') });
  await h.edit(P, twin('A', 'bbbbbb'));
  await h.edit(Q, '一段文字 ^bbbbbb\n');
  await h.edit(P, unrelated);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '新的', kind: 'lost', restore: null }]);
});

void test('R2 編輯器裡刪掉 changed 的目標、寫了無關的目標：未知 ID 是刻意拿掉的，新的目標也拿不到還原選項', async t => {
  const h = await setup(t, { [P]: twin('A', 'aaaaaa') });
  await h.edit(P, twin('A', 'bbbbbb'));
  h.state.removedInEditor(P, ['bbbbbb']);
  await h.edit(P, unrelated);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '新的', kind: 'lost', restore: null }]);
});

void test('R2 對照：編輯器裡把 changed 的未知 ID 換掉、內容沒變：還是可以還原', async t => {
  const h = await setup(t, { [P]: twin('A', 'aaaaaa') });
  await h.edit(P, twin('A', 'bbbbbb'));
  h.state.removedInEditor(P, ['bbbbbb']);
  await h.edit(P, twin('A', 'cccccc'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('R2 對照：需要新版的卡組不算共用（不列衝突），A 改了題目還是 A 的，不會什麼問題都不剩', async t => {
  const h = await setup(t, { [P]: twin('A', 'aaaaaa') });
  await h.edit(P, twin('A', 'bbbbbb'));
  await h.edit(Q, '---\n需要版本: 9.0.0\n---\n' + twin('B', 'bbbbbb'));
  assert.deepEqual(h.state.conflicts(), []);
  await h.edit(P, twin('A 改過', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('R2 未知 ID 留在需要新版的卡組：同一次刪掉 A、新增無關的目標，拿不到還原選項', async t => {
  const h = await setup(t, { [P]: twin('A', 'aaaaaa') });
  await h.edit(P, twin('A', 'bbbbbb'));
  await h.edit(Q, '---\n需要版本: 9.0.0\n---\n' + twin('B', 'bbbbbb'));
  await h.edit(P, unrelated);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '新的', kind: 'lost', restore: null }]);
});

void test('R2 副本在別篇，選 B 是新加的：A 本來就有的 changed 留著、還能還原寫回 A', async t => {
  const h = await changedThenElsewhere(t);
  assert.equal((await h.state.resolve(h.state.deckStatus(Q).issues[0], 'new', createMemoryEditor(h, Q, twin('B', 'bbbbbb')))).kind, 'done');
  assert.equal(h.texts.get(Q), twin('B', 'aaaaab'));
  assert.deepEqual(h.state.conflicts(), []);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '同名', kind: 'changed', restore: 'aaaaaa' }]);
  assert.equal((await h.state.resolve(h.state.deckStatus(P).issues[0], 'restore', createMemoryEditor(h, P, twin('A', 'bbbbbb')))).kind, 'done');
  assert.equal(h.texts.get(P), twin('A', 'aaaaaa'));
  assert.deepEqual(h.state.deckStatus(P).issues, []);
});

for (const kind of ['duplicate', 'changed']) {
  void test('R2 副本在別篇，選 A 的 ' + kind + ' 當成新的：A 的兩個問題一起結束，B 沒有問題、照常出題', async t => {
    const h = await changedThenElsewhere(t);
    const issue = h.state.deckStatus(P).issues.find(each => each.kind === kind);
    assert.ok(issue);
    assert.equal((await h.state.resolve(issue, 'new', createMemoryEditor(h, P, twin('A', 'bbbbbb')))).kind, 'done');
    assert.equal(h.texts.get(P), twin('A', 'aaaaab'));
    assert.deepEqual(h.state.deckStatus(P).issues, []);
    assert.deepEqual(h.state.deckStatus(Q).issues, []);
    assert.deepEqual(h.state.conflicts(), []);
    assert.deepEqual(h.share().sort(), ['aaaaab', 'bbbbbb']);
  });
}

void test('F1 對照：changed 的 ID 只有一個目標在用時，只靠 ID 認人照舊（名稱與題目都改了也認得）', async t => {
  const h = await setup(t, { [P]: named('A', 'aaaaaa') });
  await h.edit(P, named('A', 'bbbbbb'));
  await h.edit(P, named('全改了', 'bbbbbb'));
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '全改了', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('changed 的 ID 被拿掉之後，新的無 ID 目標貼在上面：changed 還是原本的目標，不交給新的', async t => {
  const bare = '- A\n    - A :: A 的答案\n';
  const h = await setup(t, { [P]: named('A', 'aaaaaa') });
  await h.edit(P, named('A', 'bbbbbb'));
  await h.edit(P, bare);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: 'A', kind: 'changed', restore: 'aaaaaa' }]);
  await h.edit(P, '- 新的\n    - 新題 :: 新答案\n' + bare);
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 2, name: 'A', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('changed 的 ID 被拿掉之後，同一次改了題目又新增無 ID 的目標：沒有 ID 不算共用，同名的還是認得出來', async t => {
  const h = await setup(t, { [P]: named('A', 'aaaaaa') });
  await h.edit(P, named('A', 'bbbbbb'));
  await h.edit(P, '- A\n    - A :: A 的答案\n');
  await h.edit(P, '- A\n    - A 改過 :: A 的答案\n- 新的\n    - 新題 :: 新答案\n');
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: 'A', kind: 'changed', restore: 'aaaaaa' }]);
});

void test('lost 的目標被改得認不出來：沒有未知 ID 可比，還是當成證據，新出現的目標可以還原', async t => {
  const h = await setup(t, { [P]: named('A', 'aaaaaa') });
  await h.edit(P, '- A\n    - A :: A 的答案\n');
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: 'A', kind: 'lost', restore: 'aaaaaa' }]);
  await h.edit(P, '- 全改了\n    - 新題 :: 新答案\n');
  assert.deepEqual(brief(h.state.deckStatus(P).issues), [{ line: 0, name: '全改了', kind: 'lost', restore: 'aaaaaa' }]);
});

void test('第 18 項解除後寫回的檔，新開的 state 沒有衝突', async t => {
  const text = ORIGINAL + COPY;
  const h = await setup(t, { [P]: text });
  const editor = createMemoryEditor(h, P, text);
  assert.equal((await h.state.resolve(issueAt(h, P, 2), 'new', editor)).kind, 'done');
  const state = createState({ files: h.files, device: 'PC-test', delay: DELAY, fillIds: true, now: () => Date.parse(NOW), offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  assert.deepEqual(state.conflicts(), []);
  assert.deepEqual(state.deckStatus(P).issues, []);
});

// 第 23 項：寫回的字面輸出（任務說明 §3-2 的表，Codex 格式查核 F3）。␠ 寫成空格、⇥ 寫成 \t。
for (const eol of ['\n', '\r\n']) for (const [label, before, after] of [
  ['行尾的 ID', ['- A ^b4rw7k'], ['- A ^aaaaaa']],
  ['ID 後面的空白拿掉', ['- A ^b4rw7k  '], ['- A ^aaaaaa']],
  ['分隔的 Tab 換成一個空格', ['- A\t^b4rw7k'], ['- A ^aaaaaa']],
  ['行中的 ID 移到行尾', ['- A ^b4rw7k B'], ['- A B ^aaaaaa']],
  ['原本行尾的空白留在 ID 前面', ['- A ^b4rw7k B  '], ['- A B   ^aaaaaa']],
  ['接續文字不動', ['- A ^b4rw7k', '  接續文字'], ['- A ^aaaaaa', '  接續文字']],
  ['第一行尾的兩格拿掉、接續文字不動', ['- A ^b4rw7k  ', '  接續文字'], ['- A ^aaaaaa', '  接續文字']],
] as const) void test('第 23 項寫回的字面輸出（' + JSON.stringify(eol) + '）：' + label, async t => {
  const tail = ['    - a :: 甲', '- B ^b4rw7k', '    - b :: 乙', ''];
  const text = [...before, ...tail].join(eol);
  const h = await setup(t, { [P]: text });
  const editor = createMemoryEditor(h, P, text);
  assert.deepEqual(await h.state.resolve(issueAt(h, P, 0), 'new', editor), { kind: 'done', added: 0 });
  assert.equal(editor.value, [...after, ...tail].join(eol));
  assert.deepEqual(await h.state.save(editor), { kind: 'unchanged' });
  assert.equal(editor.value, [...after, ...tail].join(eol));
  assert.equal(h.texts.get(P), [...after, ...tail].join(eol));
});
