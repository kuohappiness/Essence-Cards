import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createObsidianStub, type ObsidianStub } from './helpers/obsidian.ts';

// 目錄的暫停／恢復接到 Obsidian（tasks/quiz-practice.md §5）：用共用的 obsidian 替身跑 src/obsidian/deck-status.ts，只模擬分頁與編輯器。
// 寫入本身在 deck-status.test.ts 測（真的 createState），這裡看：開著的筆記走編輯器、有沒存的修改不寫、提示的字。
const root = fileURLToPath(new URL('../', import.meta.url));
const code = (await build({
  absWorkingDir: root, stdin: { contents: "export { changeDeckStatus } from './src/obsidian/deck-status.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false,
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
})).outputFiles[0].text;

const DECK = 'Essence Cards/P.md';
const TEXT = '---\n狀態: 啟用\n---\n- 目標 ^aaa111\n    - 問 :: 答\n';
/** 給家長看的字（預期值寫死，不引用程式裡的常數）。 */
const TIPS = {
  unsaved: '這篇筆記有還沒存進去的修改，狀態先不改；等一下再按一次',
  stale: '這篇筆記剛剛改過，請再按一次',
  failed: '這篇筆記暫時存不進去，狀態沒有改；請稍後再按一次',
  unwritable: '這篇筆記的屬性區寫法有問題，狀態沒有改；先打開筆記修好',
  blocked: '還有檔案沒讀到，狀態先不改；讀取完成後請再按一次',
  backup: '備份還沒成功，狀態先不改；到設定頁看原因',
  needsUpdate: '這篇筆記需要新版的外掛才讀得懂，更新外掛之前不能改狀態',
};
type Result = { kind: string; reason?: string; error?: unknown };
interface Module {
  changeDeckStatus: (app: unknown, state: unknown, path: string, value: string, onError: (error: unknown) => void) => Promise<string | null>;
}
interface Fake { stub: ObsidianStub; run: (result?: Result) => Promise<string | null>; calls: { path: string; value: string; editor: { path: string; text(): string | null } | null }[]; errors: unknown[] }

function setup(): Fake {
  const stub = createObsidianStub();
  stub.texts.set(DECK, TEXT);
  const { changeDeckStatus } = stub.load<Module>(code);
  const calls: Fake['calls'] = [], errors: unknown[] = [];
  return {
    stub, calls, errors,
    run: (result = { kind: 'done', added: 0 } as Result) => changeDeckStatus(stub.app, {
      setDeckStatus(path: string, value: string, editor: Fake['calls'][number]['editor']) { calls.push({ path, value, editor }); return Promise.resolve(result); },
    }, DECK, '暫停', error => { errors.push(error); }),
  };
}
/** 開著這一篇的分頁；editor 是編輯器裡的文字。 */
function openNote(h: Fake, editor: string): void {
  const leaf = h.stub.leaf(DECK);
  (leaf.view as { value: string }).value = editor;
  h.stub.leaves.push(leaf);
}

void test('沒開著：走檔案（沒有編輯器）；寫成了不提示', async () => {
  const h = setup();
  assert.equal(await h.run(), null);
  assert.deepEqual(h.calls.map(({ path, value, editor }) => [path, value, editor]), [[DECK, '暫停', null]]);
});

void test('開著、內容和磁碟相同：走編輯器；別篇開著不算', async () => {
  const h = setup();
  h.stub.leaves.push(h.stub.leaf('Essence Cards/別篇.md'));
  openNote(h, TEXT);
  assert.equal(await h.run(), null);
  assert.equal(h.calls[0].editor?.path, DECK);
  assert.equal(h.calls[0].editor?.text(), TEXT);
});

void test('開著、編輯器裡有沒存的修改：照受阻處理，不寫、不覆蓋', async () => {
  const h = setup();
  openNote(h, TEXT + '- 剛打的\n');
  assert.equal(await h.run(), TIPS.unsaved);
  assert.deepEqual(h.calls, [], 'state 沒有被呼叫');
  assert.equal(h.stub.texts.get(DECK), TEXT);
  assert.deepEqual(h.stub.writes, []);
});

void test('換行不同不算沒存的修改：檔案是 CRLF，編輯器一律 LF', async () => {
  const h = setup();
  h.stub.texts.set(DECK, TEXT.replaceAll('\n', '\r\n'));
  openNote(h, TEXT);
  assert.equal(await h.run(), null);
  assert.equal(h.calls.length, 1);
});

void test('還沒載入的分頁不是編輯器：走檔案', async () => {
  const h = setup();
  h.stub.leaves.push(h.stub.deferred(DECK));
  assert.equal(await h.run(), null);
  assert.equal(h.calls[0].editor, null);
});

void test('提示的字：受阻、剛改過、屬性區有問題、寫不進去；不提示的不跳；寫不進去交給錯誤紀錄', async () => {
  const h = setup();
  const cases: [Result, string | null][] = [
    [{ kind: 'done' }, null], [{ kind: 'saved' }, null], [{ kind: 'unchanged' }, null],
    [{ kind: 'blocked', reason: 'phone' }, null], [{ kind: 'blocked', reason: 'closed' }, null],
    [{ kind: 'blocked', reason: 'loading' }, TIPS.blocked], [{ kind: 'blocked', reason: 'unread' }, TIPS.blocked],
    [{ kind: 'blocked', reason: 'backup' }, TIPS.backup], [{ kind: 'blocked', reason: 'needs-update' }, TIPS.needsUpdate],
    [{ kind: 'stale' }, TIPS.stale], [{ kind: 'unwritable' }, TIPS.unwritable],
  ];
  for (const [result, tip] of cases) assert.equal(await h.run(result), tip, JSON.stringify(result));
  assert.deepEqual(h.errors, []);
  const broken = Error('寫不進去');
  assert.equal(await h.run({ kind: 'failed', error: broken }), TIPS.failed);
  assert.deepEqual(h.errors, [broken]);
});

void test('不會 reject：讀不到磁碟也是提示加錯誤紀錄，不寫', async () => {
  const stub = createObsidianStub({ failRead: () => true });
  stub.texts.set(DECK, TEXT);
  const { changeDeckStatus } = stub.load<Module>(code);
  const leaf = stub.leaf(DECK);
  (leaf.view as { value: string }).value = TEXT;
  stub.leaves.push(leaf);
  const errors: unknown[] = [];
  let called = false;
  assert.equal(await changeDeckStatus(stub.app, { setDeckStatus() { called = true; return Promise.resolve({ kind: 'done' }); } }, DECK, '暫停', error => { errors.push(error); }), TIPS.failed);
  assert.equal(called, false);
  assert.equal(errors.length, 1);
});
