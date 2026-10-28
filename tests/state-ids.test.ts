import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry, planToday } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { IdIssue, State, StateOptions } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// W5 §8-5、§8-7 I3～I6：補 ID、弄丟的偵測與家長的選擇。「外部改檔」是記憶體 Files 的 write／remove／rename（技術債 A9），
// 通知同步送出；`settle()` 用假計時器讓 delay 過去、跑完重讀，同一次載入裡偵測。
const DELAY = 30;
const P = 'Essence Cards/P.md';
const OTHER = 'Essence Cards/別篇.md';
const LOG = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const review = (t: string, lt: string) => encodeEntry(t, { lt, r: 'good', v: '12345678' });
const A = '- 能說明 A ^k3m9x2\n    - QA1 :: AA1\n    - QA2 :: AA2\n';
const B = '- 能說明 B ^b23456\n    - QB :: AB\n';
const C = '- 能說明 C\n    - QC :: AC\n';

const timed = new WeakSet<TestContext>();
interface Harness extends MemoryFiles {
  state: State;
  read: (path: string) => string | null;
  /** 外部寫進去並等 state 讀到（delay 過後）。 */
  edit: (path: string, text: string) => Promise<void>;
  /** 讓 delay 過去並跑完排好的重讀。 */
  settle: () => Promise<void>;
  issues: (path?: string) => IdIssue[];
  /** files.modify 的路徑，照呼叫順序。 */
  modifies: string[];
}
/** unread：第一次載入時就讀不到的路徑（state-load 的 S7、S8）。 */
async function setup(t: TestContext, vault: Record<string, string>, options: Partial<StateOptions> = {}, unread: string[] = []): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles(vault);
  for (const path of unread) memory.failing.add(path);
  const modifies: string[] = [];
  const files = { ...memory.files, modify: (path: string, edit: (text: string) => string) => { modifies.push(path); return memory.files.modify(path, edit); } };
  const state = createState({ files, device: 'PC-test', delay: DELAY, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480, ...options });
  t.after(() => state.close());
  await state.ready();
  const settle = async () => { t.mock.timers.tick(DELAY + 1); await new Promise<void>(resolve => setImmediate(resolve)); };
  const edit = async (path: string, text: string) => { memory.write(path, text); await settle(); };
  return { ...memory, state, read: path => memory.texts.get(path) ?? null, edit, settle, issues: (path = P) => state.deckStatus(path).issues, modifies };
}
const plain = (issues: IdIssue[]) => issues.map(({ path, line, name, kind, restore }) => ({ path, line, name, kind, restore }));
const share = (state: State) => state.today().share.map(item => item.lt);

void test('I3 taken 包括被取消的作答：被取消的 aaaaab 不再配出', async t => {
  const h = await setup(t, {
    [OTHER]: '- 別的 ^aaaaaa\n    - Q :: A\n',
    [LOG]: review('2026-10-20T19:00:00.000+08:00', 'aaaaab') + '\n' + encodeEntry('2026-10-20T19:00:05.000+08:00', { undo: '2026-10-20T19:00:00.000+08:00' }) + '\n',
  });
  assert.deepEqual(h.state.history().reviews, []);
  assert.equal(h.state.fillText(P, '- 新目標\n    - Q :: A\n'), '- 新目標 ^aaaaac\n    - Q :: A\n');
});

const I4 = '- 能說明 A\n    - Q1 :: A1\n- 能說明 B ^b23456\n    - Q2 :: A2\n- borrow :: 借入\n';
const I4filled = '- 能說明 A ^aaaaac\n    - Q1 :: A1\n- 能說明 B ^b23456\n    - Q2 :: A2\n- borrow ^aaaaad\n    - borrow :: 借入\n';
const I4vault = {
  'Essence Cards/補.md': I4,
  [OTHER]: '- 別的 ^aaaaaa\n    - Q :: A\n',
  [LOG]: review('2026-10-20T19:00:00.000+08:00', 'aaaaab') + '\n',
};

void test('I4 補 ID：fillIds 避開別篇與紀錄裡的 ID，第二次不改字，today 與 deckStatus 跟著更新', async t => {
  const h = await setup(t, I4vault);
  assert.deepEqual(h.state.deckStatus('Essence Cards/補.md'), { missing: 2, issues: [] });
  assert.equal(await h.state.fillIds('Essence Cards/補.md'), true);
  assert.equal(h.read('Essence Cards/補.md'), I4filled);
  assert.equal(await h.state.fillIds('Essence Cards/補.md'), false);
  assert.equal(h.read('Essence Cards/補.md'), I4filled);
  assert.equal(h.state.fillText('Essence Cards/補.md', I4filled), I4filled);
  await h.settle();
  assert.ok(share(h.state).includes('aaaaac') && share(h.state).includes('aaaaad'), share(h.state).join());
  assert.deepEqual(h.state.deckStatus('Essence Cards/補.md'), { missing: 0, issues: [] });
});

void test('I4 fillIds: false（手機）：不讀、不寫，fillText 回傳原文', async t => {
  const h = await setup(t, I4vault, { fillIds: false });
  const before = h.reads.length;
  assert.equal(await h.state.fillIds('Essence Cards/補.md'), false);
  assert.equal(h.reads.length, before);
  assert.equal(h.state.fillText('Essence Cards/補.md', I4), I4);
  assert.equal(h.read('Essence Cards/補.md'), I4);
});

void test('I4 不存在的路徑、系統資料夾、Essence Cards 外面：回傳 false，不建立或改動任何檔', async t => {
  const outside = '其他/外面（卡片）.md', mistakes = 'Essence Cards/錯題本/x.md';
  const h = await setup(t, { [outside]: C, [mistakes]: C });
  for (const path of ['Essence Cards/沒有.md', 'Essence Cards/新資料夾/沒有.md', mistakes, outside]) assert.equal(await h.state.fillIds(path), false, path);
  assert.ok(!h.texts.has('Essence Cards/沒有.md'));
  assert.ok(![...h.texts.keys()].some(path => path.startsWith('Essence Cards/新資料夾/')));
  assert.equal(h.read(outside), C);
  assert.equal(h.read(mistakes), C);
  assert.equal(h.state.fillText(mistakes, C), C);
});

void test('I5 ID 在外部被拿掉：lost、restore 是原本的 ID；不出題；存檔不替它配 ID，同一篇其他新目標照常補', async t => {
  const h = await setup(t, { [P]: A + B });
  assert.ok(share(h.state).includes('k3m9x2'));
  await h.edit(P, A.replace(' ^k3m9x2', '') + B);
  assert.deepEqual(plain(h.issues()), [{ path: P, line: 0, name: '能說明 A', kind: 'lost', restore: 'k3m9x2' }]);
  assert.deepEqual(h.state.deckStatus(P).missing, 0);
  assert.ok(!share(h.state).includes('k3m9x2'));
  // 存檔（開著的筆記）時同一篇多了 C：C 照常補，A 不動。
  const text = A.replace(' ^k3m9x2', '') + B + C;
  assert.equal(h.state.fillText(P, text), A.replace(' ^k3m9x2', '') + B + '- 能說明 C ^aaaaaa\n    - QC :: AC\n');
  assert.equal(h.issues().length, 1);
  // 離開筆記時的備援也不替它配 ID。
  await h.edit(P, A.replace(' ^k3m9x2', '') + B);
  assert.equal(await h.state.fillIds(P), false);
  assert.equal(h.read(P), A.replace(' ^k3m9x2', '') + B);
});

void test('I5 同樣的內容再讀一次、改名稱一個字、改其中一題：問題都還在；整個刪掉才消失', async t => {
  const h = await setup(t, { [P]: A + B });
  const lost = A.replace(' ^k3m9x2', '');
  await h.edit(P, lost + B);
  await h.edit(P, lost + B + '\n');
  assert.deepEqual(plain(h.issues()).map(i => [i.kind, i.restore, i.line]), [['lost', 'k3m9x2', 0]]);
  await h.edit(P, '\n' + lost.replace('能說明 A', '能說明 A2') + B);
  assert.deepEqual(plain(h.issues()).map(i => [i.kind, i.restore, i.name, i.line]), [['lost', 'k3m9x2', '能說明 A2', 1]]);
  await h.edit(P, lost.replace('能說明 A', '能說明 A2').replace('QA1 :: AA1', 'QA1 :: 改過') + B);
  assert.deepEqual(plain(h.issues()).map(i => [i.kind, i.restore, i.line]), [['lost', 'k3m9x2', 0]]);
  assert.ok(!share(h.state).includes('k3m9x2'));
  await h.edit(P, B);
  assert.deepEqual(h.issues(), []);
});

void test('I5 ID 被換成沒見過的：changed、restore 是原本的；那個目標不出題', async t => {
  const h = await setup(t, { [P]: A + B });
  await h.edit(P, A.replace('^k3m9x2', '^zzzzz9') + B);
  assert.deepEqual(plain(h.issues()), [{ path: P, line: 0, name: '能說明 A', kind: 'changed', restore: 'k3m9x2' }]);
  assert.ok(!share(h.state).includes('zzzzz9') && !share(h.state).includes('k3m9x2'));
  assert.ok(share(h.state).includes('b23456'));
  assert.equal(h.state.fillText(P, A.replace('^k3m9x2', '^zzzzz9') + B), A.replace('^k3m9x2', '^zzzzz9') + B);
});

void test('I5 兩個都被拿掉 ID：兩個 lost，restore 都是 null', async t => {
  const h = await setup(t, { [P]: A + B });
  await h.edit(P, A.replace(' ^k3m9x2', '') + B.replace(' ^b23456', ''));
  assert.deepEqual(plain(h.issues()).map(i => [i.kind, i.restore, i.line]), [['lost', null, 0], ['lost', null, 3]]);
});

void test('I5 只有刪掉（沒有新目標）不是問題；同一次刪掉又加了沒 ID 的新目標是問題', async t => {
  const h = await setup(t, { [P]: A + B });
  await h.edit(P, B);
  assert.deepEqual(h.issues(), []);
  const h2 = await setup(t, { [P]: A + B });
  await h2.edit(P, B + C);
  assert.deepEqual(plain(h2.issues()).map(i => [i.kind, i.restore, i.name]), [['lost', 'k3m9x2', '能說明 C']]);
});

void test('I5 removedInEditor 報過的 ID 不算弄丟：之後出現的新目標照常補', async t => {
  const h = await setup(t, { [P]: A + B });
  h.state.removedInEditor(P, ['k3m9x2']);
  await h.edit(P, B + C);
  assert.deepEqual(h.issues(), []);
  assert.equal(await h.state.fillIds(P), true);
  assert.equal(h.read(P), B + '- 能說明 C ^aaaaaa\n    - QC :: AC\n');
});

void test('I5 ambiguous-id：候選之一是上一版的 ID 時 restore 是它', async t => {
  const h = await setup(t, { [P]: A + B });
  await h.edit(P, A.replace(' ^k3m9x2', ' ^k3m9x2 和 ^p7q2w8') + B);
  assert.deepEqual(plain(h.issues()), [{ path: P, line: 0, name: '能說明 A 和', kind: 'ambiguous', restore: 'k3m9x2' }]);
  assert.ok(!share(h.state).includes('k3m9x2'));
});

void test('I5 ready() 時就沒有 ID 的目標不是問題，照常補；重新載入讀到弄丟後的內容也沒有問題', async t => {
  const h = await setup(t, { [P]: A.replace(' ^k3m9x2', '') + B });
  assert.deepEqual(h.issues(), []);
  assert.deepEqual(h.state.deckStatus(P).missing, 1);
  assert.equal(await h.state.fillIds(P), true);
  assert.equal(h.read(P), A.replace('^k3m9x2', '^aaaaaa') + B);
  const changed = await setup(t, { [P]: A.replace('^k3m9x2', '^zzzzz9') + B + C });
  assert.deepEqual(changed.issues(), []);
});

void test('I5 重新載入讀到 ambiguous-id：仍是待處理（不出題、不補），只是沒有前一版，restore 是 null', async t => {
  const h = await setup(t, { [P]: A.replace(' ^k3m9x2', ' ^k3m9x2 和 ^p7q2w8') + B });
  assert.deepEqual(plain(h.issues()).map(i => [i.kind, i.restore]), [['ambiguous', null]]);
});

void test('I6 lost 選還原：行尾回到原本的 ID，問題消失，回到 today，之後重讀不再出現', async t => {
  const h = await setup(t, { [P]: A + B });
  const lost = A.replace(' ^k3m9x2', '') + B;
  await h.edit(P, lost);
  const [issue] = h.issues();
  const restored = h.state.resolveText(issue, 'restore', lost);
  assert.equal(restored, A + B);
  assert.deepEqual(h.issues(), []);
  await h.edit(P, restored);
  assert.deepEqual(h.issues(), []);
  assert.ok(share(h.state).includes('k3m9x2'));
  await h.edit(P, restored + '\n');
  assert.deepEqual(h.issues(), []);
});

void test('I6 lost 選當成新的：配一個新 ID（不是原本的），問題消失', async t => {
  const h = await setup(t, { [P]: A + B });
  const lost = A.replace(' ^k3m9x2', '') + B;
  await h.edit(P, lost);
  const next = h.state.resolveText(h.issues()[0], 'new', lost);
  assert.equal(next, A.replace('^k3m9x2', '^aaaaaa') + B);
  assert.deepEqual(h.issues(), []);
  await h.edit(P, next);
  assert.deepEqual(h.issues(), []);
  assert.ok(share(h.state).includes('aaaaaa'));
});

void test('I6 還原前原本的 ID 已經出現在另一篇：回傳 null，問題保留', async t => {
  const h = await setup(t, { [P]: A + B });
  const lost = A.replace(' ^k3m9x2', '') + B;
  await h.edit(P, lost);
  await h.edit(OTHER, '- 別篇的目標 ^k3m9x2\n    - Q :: A\n');
  const [issue] = h.issues();
  assert.equal(h.state.resolveText(issue, 'restore', lost), null);
  assert.equal(h.issues().length, 1);
});

void test('I6 還原前那個目標又被改過、問題已不在：回傳 null', async t => {
  const h = await setup(t, { [P]: A + B });
  const lost = A.replace(' ^k3m9x2', '') + B;
  await h.edit(P, lost);
  const [issue] = h.issues();
  assert.equal(h.state.resolveText(issue, 'restore', B), null);
  assert.deepEqual(h.issues(), []);
  assert.equal(h.state.resolveText(issue, 'new', lost), null);
});

void test('I6 ambiguous 選還原只剩原本的；選當成新的拿掉候選、配新 ID，拿掉的候選不變成新的 lost', async t => {
  const twoIds = A.replace(' ^k3m9x2', ' ^k3m9x2 和 ^p7q2w8') + B;
  const h = await setup(t, { [P]: A + B });
  await h.edit(P, twoIds);
  assert.equal(h.state.resolveText(h.issues()[0], 'restore', twoIds), A.replace('能說明 A ^k3m9x2', '能說明 A 和 ^k3m9x2') + B);
  const h2 = await setup(t, { [P]: A + B });
  await h2.edit(P, twoIds);
  const next = h2.state.resolveText(h2.issues()[0], 'new', twoIds);
  assert.equal(next, A.replace('能說明 A ^k3m9x2', '能說明 A 和 ^aaaaaa') + B);
  await h2.edit(P, next);
  await h2.edit(P, next + C);
  assert.deepEqual(h2.issues(), []);
  assert.equal(h2.state.fillText(P, next + C), next + '- 能說明 C ^aaaaab\n    - QC :: AC\n');
});

void test('補 ID 之後按 Undo（編輯器回報拿掉）不是問題；Redo 回來（回報回來）之後在外部弄丟仍是問題', async t => {
  const h = await setup(t, { [P]: B });
  const filled = h.state.fillText(P, B + C);
  assert.equal(filled, B + '- 能說明 C ^aaaaaa\n    - QC :: AC\n');
  await h.edit(P, filled);
  h.state.removedInEditor(P, ['aaaaaa']);
  await h.edit(P, B + C);
  assert.deepEqual(h.issues(), []);
  h.state.restoredInEditor(P, ['aaaaaa']);
  await h.edit(P, filled);
  await h.edit(P, B + C);
  assert.deepEqual(plain(h.issues()).map(i => [i.kind, i.restore, i.name]), [['lost', 'aaaaaa', '能說明 C']]);
});

void test('這次載入才配的 ID 在外部弄丟也是問題（沒有另外放過剛配出的 ID）', async t => {
  const h = await setup(t, { [P]: B + C });
  assert.equal(await h.state.fillIds(P), true);
  await h.settle();
  await h.edit(P, B + C);
  assert.deepEqual(plain(h.issues()).map(i => [i.kind, i.restore]), [['lost', 'aaaaaa']]);
});

void test('改名（同一批的刪除與新增）時待處理的問題跟著新路徑', async t => {
  const h = await setup(t, { [P]: A + B });
  const lost = A.replace(' ^k3m9x2', '') + B;
  await h.edit(P, lost);
  h.remove(P);
  h.write('Essence Cards/新名字.md', lost);
  await h.settle();
  assert.deepEqual(h.issues(), []);
  assert.deepEqual(plain(h.issues('Essence Cards/新名字.md')).map(i => [i.kind, i.restore]), [['lost', 'k3m9x2']]);
  assert.equal(await h.state.fillIds('Essence Cards/新名字.md'), false);
});

// ---- Codex L2（2026-10-25）的反例 ----

void test('F1 小視窗拿到的問題在內容改過之後失效：還原回傳 null、問題保留（新的問題物件可以還原）', async t => {
  const h = await setup(t, { [P]: A + B });
  const lost = A.replace(' ^k3m9x2', '') + B;
  await h.edit(P, lost);
  const [shown] = h.issues();
  // 按鈕先到：還沒重讀，直接拿改過題目的文字還原。
  const changed = lost.replace('QA1 :: AA1', 'totally new :: answer');
  assert.equal(h.state.resolveText(shown, 'restore', changed), null);
  assert.equal(h.issues().length, 1);
  assert.notEqual(h.issues()[0], shown);
  assert.equal(h.state.resolveText(h.issues()[0], 'restore', changed), changed.replace('- 能說明 A', '- 能說明 A ^k3m9x2'));
});

void test('F1 重讀先到：題目改過之後，舊的問題物件不能還原；只改行號（上面多一行）時仍可以', async t => {
  const h = await setup(t, { [P]: A + B });
  const lost = A.replace(' ^k3m9x2', '') + B;
  await h.edit(P, lost);
  const [shown] = h.issues();
  await h.edit(P, '\n' + lost);
  assert.equal(h.issues()[0], shown);
  assert.equal(shown.line, 1);
  const renamed = '\n' + lost.replace('能說明 A', '能說明 A 改名');
  await h.edit(P, renamed);
  assert.notEqual(h.issues()[0], shown);
  assert.equal(h.state.resolveText(shown, 'restore', renamed), null);
  assert.equal(h.issues().length, 1);
});

for (const line of [
  '{"t":"2026-10-24T12:00:00+08:00","lt": "aaaaaa","r":"good","v":"12345678"}',
  '{ "t" : "2026-10-24T12:00:00+08:00" , "lt" : "aaaaaa" , "r" : "good" , "v" : "12345678" }',
  '{"t":"2026-10-24T12:00:00+08:00","\\u006ct":"aaaaaa","r":"good","v":"12345678"}',
]) void test('F3 紀錄裡合法 JSON 的空白與跳脫鍵名：舊 ID 不再配出（有、沒有取消都一樣）：' + line.slice(30, 60), async t => {
  for (const undo of [false, true]) {
    const text = line + '\n' + (undo ? encodeEntry('2026-10-24T12:00:05.000+08:00', { undo: '2026-10-24T12:00:00+08:00' }) + '\n' : '');
    const h = await setup(t, { [P]: B, [LOG]: text });
    assert.equal(h.state.history().reviews.length, undo ? 0 : 1);
    assert.equal(h.state.fillText(P, B + C), B + '- 能說明 C ^aaaaab\n    - QC :: AC\n', 'undo ' + String(undo));
  }
});

void test('F3 壞掉的行：救回的尾段與認不出的行裡的 lt 也避開', async t => {
  const broken = '{"t":"2026-10-24T12:00:00+08:00","lt":"aaaaaa","r":"go' + review('2026-10-24T12:01:00.000+08:00', 'aaaaab') + '\n{"lt": "aaaaac", 壞掉\n';
  const h = await setup(t, { [P]: B, [LOG]: broken });
  assert.equal(h.state.fillText(P, B + C), B + '- 能說明 C ^aaaaad\n    - QC :: AC\n');
});

void test('F3 合法的取消行多帶的 lt 也避開（Codex state-load L2 的 F1）', async t => {
  const h = await setup(t, { [P]: B, [LOG]: '{"t":"2026-10-24T12:00:00.000+08:00","undo":"not-present","lt":"aaaaaa"}\n' });
  assert.equal(h.state.fillText(P, B + C), B + '- 能說明 C ^aaaaab\n    - QC :: AC\n');
});

for (const order of [['P', 'O'], ['O', 'P']]) void test('F5 同一批跨檔搬移不因通知順序誤報：' + order.join('→'), async t => {
  const O = OTHER;
  const h = await setup(t, { [P]: A, [O]: B });
  h.texts.set(P, C);
  h.texts.set(O, B + A);
  h.notify(...order.map(name => name === 'P' ? P : O));
  await h.settle();
  assert.deepEqual([h.state.deckStatus(P), h.state.deckStatus(O)], [{ missing: 1, issues: [] }, { missing: 0, issues: [] }]);
});

void test('F5 同一批交換兩篇的目標、搬出同時新增：沒有問題', async t => {
  const O = OTHER;
  const h = await setup(t, { [P]: A, [O]: B });
  h.texts.set(P, B + C);
  h.texts.set(O, A);
  h.notify(O, P);
  await h.settle();
  assert.deepEqual([h.state.deckStatus(P).issues, h.state.deckStatus(O).issues], [[], []]);
  assert.equal(h.state.deckStatus(P).missing, 1);
});

void test('離開筆記的補 ID 寫不進去時，state 不採用沒寫成的文字：之後照磁碟上的內容補，不誤報弄丟', async t => {
  const h = await setup(t, { [P]: B + C });
  h.control.failModify = true;
  await assert.rejects(h.state.fillIds(P));
  assert.equal(h.state.deckStatus(P).missing, 1);
  h.control.failModify = false;
  assert.equal(await h.state.fillIds(P), true);
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  // 寫不進去那次配出的 aaaaaa 仍算用過（不再配出），所以是 aaaaab。
  assert.equal(h.texts.get(P), B + '- 能說明 C ^aaaaab\n    - QC :: AC\n');
});

// ---- Codex 再審（2026-10-26）的反例 ----

void test('R1 寫入中斷後救回的尾段用跳脫的 lt 鍵：舊 ID 不再配出（有、沒有取消都一樣）', async t => {
  const broken = '{"t":"2026-10-24T11:00:00+08:00","r":"go{"t":"2026-10-24T12:00:00+08:00","\\u006ct":"aaaaaa","r":"good","v":"12345678"}';
  for (const undo of [false, true]) {
    const text = broken + '\n' + (undo ? encodeEntry('2026-10-24T12:00:05.000+08:00', { undo: '2026-10-24T12:00:00+08:00' }) + '\n' : '');
    const h = await setup(t, { [P]: B, [LOG]: text });
    assert.equal(h.state.history().reviews.length, undo ? 0 : 1);
    assert.equal(h.state.fillText(P, B + C), B + '- 能說明 C ^aaaaab\n    - QC :: AC\n', 'undo ' + String(undo));
  }
});

for (const order of [['P', 'LOG'], ['LOG', 'P']]) void test('R2 同一批讀到的紀錄也算數：換成紀錄裡已經有的 ID 不是 changed：' + order.join('→'), async t => {
  const h = await setup(t, { [P]: A + B, [LOG]: '' });
  h.texts.set(P, A.replace('^k3m9x2', '^aaaaaa') + B);
  h.texts.set(LOG, review('2026-10-24T12:00:00.000+08:00', 'aaaaaa') + '\n');
  h.notify(...order.map(name => name === 'P' ? P : LOG));
  await h.settle();
  assert.equal(h.state.history().reviews.length, 1);
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
});

// ---- 同一批通知的順序不影響結果（第一個里程碑回顧的 R2：F5 與 R2 都是「同一批的順序」，R2 是 F5 的修正帶進來的） ----

function orders<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => orders([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
}
const D = '- 能說明 D ^d23456\n    - QD :: AD\n';
const Q = 'Essence Cards/Q.md';
const t1 = '2026-10-24T12:00:00.000+08:00';
/** 每個情境：開始的 vault、同一批改成的內容（null 是刪掉）、要看的卡組，以及照任何順序都該得到的結果。 */
const batches: { name: string; vault: Record<string, string>; batch: Record<string, string | null>; decks: string[];
  expected: { missing: number; issues: ReturnType<typeof plain> }[]; reviews: number }[] = [
  { name: '搬出搬入＋換成同一批紀錄裡的 ID',
    vault: { [P]: A + B, [OTHER]: D, [LOG]: '' },
    batch: { [P]: B.replace('^b23456', '^aaaaaa'), [OTHER]: D + A, [LOG]: review(t1, 'aaaaaa') + '\n' },
    decks: [P, OTHER], expected: [{ missing: 0, issues: [] }, { missing: 0, issues: [] }], reviews: 1 },
  { name: '交換兩篇的目標、搬出同時新增、紀錄取消一筆',
    vault: { [P]: A, [OTHER]: B, [LOG]: review(t1, 'k3m9x2') + '\n' },
    batch: { [P]: B + C, [OTHER]: A, [LOG]: review(t1, 'k3m9x2') + '\n' + encodeEntry('2026-10-24T12:00:05.000+08:00', { undo: t1 }) + '\n' },
    decks: [P, OTHER], expected: [{ missing: 1, issues: [] }, { missing: 0, issues: [] }], reviews: 0 },
  { name: '刪掉一篇、另一個路徑出現同樣內容（Obsidian 以外的改名）、紀錄加一筆',
    vault: { [P]: A + B, [LOG]: '' },
    batch: { [P]: null, [Q]: A + B, [LOG]: review(t1, 'b23456') + '\n' },
    decks: [Q], expected: [{ missing: 0, issues: [] }], reviews: 1 },
];
for (const scenario of batches) void test('同一批通知照任何順序結果都相同：' + scenario.name, async t => {
  for (const order of orders(Object.keys(scenario.batch))) {
    const h = await setup(t, scenario.vault);
    for (const path of order) {
      const text = scenario.batch[path];
      if (text === null) h.texts.delete(path);
      else h.texts.set(path, text);
    }
    h.notify(...order);
    await h.settle();
    const status = scenario.decks.map(path => { const { missing, issues } = h.state.deckStatus(path); return { missing, issues: plain(issues) }; });
    assert.deepEqual(status, scenario.expected, order.join(' → '));
    assert.equal(h.state.history().reviews.length, scenario.reviews, order.join(' → '));
  }
});

// ---- 卡組讀不到就跳過那一篇（tasks/state-load.md §3、§7 的 S7～S8）：占用資訊不完整時，不把「不知道」當成「沒用過」 ----

const samePlan = (state: State) => { assert.deepEqual(state.today(), planToday(state.input())); };

void test('S7 有卡組讀不到時暫停配 ID 與還原；讀到之後照常，而且避開它裡面的 ID', async t => {
  const lost = A.replace(' ^k3m9x2', '') + B + C;
  // 別篇讀不到，裡面有 aaaaaa；random 固定時下一個配出的就是 aaaaaa。
  const h = await setup(t, { [P]: A + B + C, [OTHER]: '- 別的 ^aaaaaa\n    - Q :: A\n' }, {}, [OTHER]);
  assert.deepEqual(h.state.unread(), [OTHER]);
  await h.edit(P, lost);
  assert.deepEqual(plain(h.issues()), [{ path: P, line: 0, name: '能說明 A', kind: 'lost', restore: 'k3m9x2' }]);
  assert.deepEqual(h.state.deckStatus(P).missing, 1);
  assert.equal(h.state.fillText(P, lost), lost);
  assert.equal(await h.state.fillIds(P), false);
  assert.deepEqual(h.modifies, []);
  assert.equal(h.read(P), lost);
  const [issue] = h.issues();
  assert.equal(h.state.resolveText(issue, 'new', lost), null);
  assert.equal(h.state.resolveText(issue, 'restore', lost), null);
  assert.deepEqual(h.issues(), [issue]);
  assert.deepEqual(h.state.deckStatus(P).missing, 1);
  samePlan(h.state);

  h.failing.delete(OTHER);
  h.notify(OTHER);
  await h.settle();
  assert.deepEqual(h.state.unread(), []);
  // lost 不因讀到而消失（不自動配回）；配新 ID 避開別篇的 aaaaaa。
  assert.deepEqual(h.issues(), [issue]);
  const filled = h.state.fillText(P, lost);
  assert.equal(filled, A.replace(' ^k3m9x2', '') + B + '- 能說明 C ^aaaaab\n    - QC :: AC\n');
  assert.equal(h.state.resolveText(issue, 'restore', filled), A + B + '- 能說明 C ^aaaaab\n    - QC :: AC\n');
  assert.deepEqual(h.issues(), []);
  samePlan(h.state);
});

void test('S7 自己作答的紀錄讀不到時也暫停：fillIds 不讀不寫；讀到之後照常補', async t => {
  const OWN = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
  const h = await setup(t, { [P]: B + C, [OWN]: review('2026-10-20T19:00:00.000+08:00', 'aaaaaa') + '\n' }, {}, [OWN]);
  assert.deepEqual(h.state.unread(), [OWN]);
  assert.equal(await h.state.fillIds(P), false);
  assert.deepEqual(h.modifies, []);
  h.failing.delete(OWN);
  t.mock.timers.tick(1000);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(h.state.unread(), []);
  assert.equal(await h.state.fillIds(P), true);
  assert.equal(h.read(P), B + '- 能說明 C ^aaaaab\n    - QC :: AC\n');
});

void test('S8 紀錄讀不到時換成那份紀錄裡的 ID：暫定的 changed，紀錄讀到後撤銷、目標回到今天的份', async t => {
  const log = encodeEntry('2026-10-23T19:00:00.000+08:00', { lt: 'aaaaaa', r: 'miss', v: '12345678' }) + '\n';
  const swapped = A.replace('^k3m9x2', '^aaaaaa') + B;
  const h = await setup(t, { [P]: A + B, [LOG]: log }, {}, [LOG]);
  let changes = 0;
  h.state.onChange(() => { changes++; });
  await h.edit(P, swapped);
  assert.deepEqual(plain(h.issues()), [{ path: P, line: 0, name: '能說明 A', kind: 'changed', restore: 'k3m9x2' }]);
  assert.ok(!share(h.state).includes('aaaaaa'));
  const before = changes;
  h.failing.delete(LOG);
  h.notify(LOG);
  await h.settle();
  assert.deepEqual(h.state.unread(), []);
  assert.deepEqual(h.issues(), []);
  assert.equal(changes, before + 1);
  assert.ok(share(h.state).includes('aaaaaa'), share(h.state).join());
  samePlan(h.state);
});

void test('S8 對照：紀錄一開始就讀得到時不產生問題；讀不到時換成紀錄裡沒有的 ID，讀到後問題仍在', async t => {
  const log = review('2026-10-23T19:00:00.000+08:00', 'aaaaaa') + '\n';
  const readable = await setup(t, { [P]: A + B, [LOG]: log });
  await readable.edit(P, A.replace('^k3m9x2', '^aaaaaa') + B);
  assert.deepEqual(readable.issues(), []);
  samePlan(readable.state);

  const h = await setup(t, { [P]: A + B, [LOG]: log }, {}, [LOG]);
  await h.edit(P, A.replace('^k3m9x2', '^bbbbbb') + B);
  const [issue] = h.issues();
  assert.deepEqual(plain([issue]), [{ path: P, line: 0, name: '能說明 A', kind: 'changed', restore: 'k3m9x2' }]);
  h.failing.delete(LOG);
  h.notify(LOG);
  await h.settle();
  assert.deepEqual(h.state.unread(), []);
  assert.deepEqual(h.issues(), [issue]);
  assert.ok(!share(h.state).includes('bbbbbb'));
  samePlan(h.state);
});
