import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { encodeEntry } from '../src/core/study/index.ts';
import type { Files } from '../src/core/files.ts';
import { createState } from '../src/state/index.ts';
import type { IdIssue, State, StateOptions } from '../src/state/index.ts';
import { createNodeFiles } from '../tools/node-files.ts';

// W5 §8-5、§8-7 I3～I6：補 ID、弄丟的偵測與家長的選擇。「外部改檔」用 node:fs 直接寫，同一次載入裡偵測。
const P = 'Essence Cards/P.md';
const OTHER = 'Essence Cards/別篇.md';
const LOG = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const review = (t: string, lt: string) => encodeEntry(t, { lt, r: 'good', v: '12345678' });
const A = '- 能說明 A ^k3m9x2\n    - QA1 :: AA1\n    - QA2 :: AA2\n';
const B = '- 能說明 B ^b23456\n    - QB :: AB\n';
const C = '- 能說明 C\n    - QC :: AC\n';

interface Harness {
  root: string;
  state: State;
  reads: string[];
  write: (path: string, text: string) => Promise<void>;
  read: (path: string) => Promise<string | null>;
  /** 寫進去並等 state 讀到（onChange 或 delay 過後）。 */
  edit: (path: string, text: string) => Promise<void>;
  issues: (path?: string) => IdIssue[];
}
async function setup(t: TestContext, vault: Record<string, string>, options: Partial<StateOptions> = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'essence-ids-'));
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, 'utf8');
  };
  const read = async (path: string) => { try { return await readFile(join(root, path), 'utf8'); } catch { return null; } };
  for (const [path, text] of Object.entries(vault)) await write(path, text);
  const node = createNodeFiles(root);
  const reads: string[] = [];
  const files: Files = { ...node, read: path => { reads.push(path); return node.read(path); } };
  const state = createState({ files, device: 'PC-test', delay: 30, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480, ...options });
  t.after(async () => { await state.close(); await rm(root, { recursive: true, force: true }); });
  await state.ready();
  const edit = async (path: string, text: string) => {
    const before = reads.filter(p => p === path).length;
    await write(path, text);
    const end = Date.now() + 5000;
    while (reads.filter(p => p === path).length === before) {
      if (Date.now() > end) assert.fail('state 沒有重讀 ' + path);
      await wait(10);
    }
    await wait(80);
  };
  return { root, state, reads, write, read, edit, issues: (path = P) => state.deckStatus(path).issues };
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
  assert.equal(await h.read('Essence Cards/補.md'), I4filled);
  assert.equal(await h.state.fillIds('Essence Cards/補.md'), false);
  assert.equal(await h.read('Essence Cards/補.md'), I4filled);
  assert.equal(h.state.fillText('Essence Cards/補.md', I4filled), I4filled);
  await wait(200);
  assert.ok(share(h.state).includes('aaaaac') && share(h.state).includes('aaaaad'), share(h.state).join());
  assert.deepEqual(h.state.deckStatus('Essence Cards/補.md'), { missing: 0, issues: [] });
});

void test('I4 fillIds: false（手機）：不讀、不寫，fillText 回傳原文', async t => {
  const h = await setup(t, I4vault, { fillIds: false });
  const before = h.reads.length;
  assert.equal(await h.state.fillIds('Essence Cards/補.md'), false);
  assert.equal(h.reads.length, before);
  assert.equal(h.state.fillText('Essence Cards/補.md', I4), I4);
  assert.equal(await h.read('Essence Cards/補.md'), I4);
});

void test('I4 不存在的路徑、系統資料夾、Essence Cards 外面：回傳 false，不建立或改動任何檔', async t => {
  const outside = '其他/外面（卡片）.md', mistakes = 'Essence Cards/錯題本/x.md';
  const h = await setup(t, { [outside]: C, [mistakes]: C });
  for (const path of ['Essence Cards/沒有.md', 'Essence Cards/新資料夾/沒有.md', mistakes, outside]) assert.equal(await h.state.fillIds(path), false, path);
  await assert.rejects(access(join(h.root, 'Essence Cards/沒有.md')));
  await assert.rejects(access(join(h.root, 'Essence Cards/新資料夾')));
  assert.equal(await h.read(outside), C);
  assert.equal(await h.read(mistakes), C);
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
  await h.write(P, A.replace(' ^k3m9x2', '') + B);
  await wait(150);
  assert.equal(await h.state.fillIds(P), false);
  assert.equal(await h.read(P), A.replace(' ^k3m9x2', '') + B);
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
  assert.equal(await h.read(P), B + '- 能說明 C ^aaaaaa\n    - QC :: AC\n');
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
  assert.equal(await h.read(P), A.replace('^k3m9x2', '^aaaaaa') + B);
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

void test('自己寫回造成的變化不算弄丟：補 ID 之後按 Undo（ID 拿掉）不變成問題', async t => {
  const h = await setup(t, { [P]: B });
  const filled = h.state.fillText(P, B + C);
  assert.equal(filled, B + '- 能說明 C ^aaaaaa\n    - QC :: AC\n');
  await h.edit(P, filled);
  await h.edit(P, B + C);
  assert.deepEqual(h.issues(), []);
});

void test('改名（同一批的刪除與新增）時待處理的問題跟著新路徑', async t => {
  const h = await setup(t, { [P]: A + B });
  const lost = A.replace(' ^k3m9x2', '') + B;
  await h.edit(P, lost);
  await rm(join(h.root, P));
  await h.edit('Essence Cards/新名字.md', lost);
  assert.deepEqual(h.issues(), []);
  assert.deepEqual(plain(h.issues('Essence Cards/新名字.md')).map(i => [i.kind, i.restore]), [['lost', 'k3m9x2']]);
  assert.equal(await h.state.fillIds('Essence Cards/新名字.md'), false);
});
