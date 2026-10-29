import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createObsidianStub } from './helpers/obsidian.ts';

// 開發命令的暫存檔（Codex 再審的 F3）：只清掉這次自己建的那一篇。用共用的 obsidian 替身在 Node 跑
// src/obsidian/dev-temp.ts 與 dev-version.ts，不是 Obsidian 實機；version 命令實機的證據在測試 vault 的 Essence W5/結果/。
const root = fileURLToPath(new URL('../', import.meta.url));
const code = (await build({
  absWorkingDir: root, stdin: { contents: "export { versionCheck } from './src/obsidian/dev-version.ts'; export { withTempFile } from './src/obsidian/dev-temp.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false, define: { 'process.env.NODE_ENV': '"production"' },
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
})).outputFiles[0].text;

/** version 命令的暫存卡組固定從這個名稱開始。 */
const NEWER = 'Essence Cards/W5 範例/需要新版（暫存）.md';
const STEM = 'Essence Cards/W5 範例/暫存';
const TEXT = '---\n需要版本: 9.0.0\n---\n- 目標 ^zzzzz8\n    - Q :: A\n';
const MINE = '家長自己的筆記，不是測試寫的\n';
type WithTempFile = (app: unknown, base: string, text: string, run: (path: string) => Promise<unknown>) => Promise<{ result: unknown; path: string; left: string | null }>;
type VersionCheck = (host: unknown, state: unknown, shots: string) => Promise<unknown>;

function setup(texts: Record<string, string> = {}) {
  const stub = createObsidianStub({ texts });
  const { withTempFile, versionCheck } = stub.load<{ withTempFile: WithTempFile; versionCheck: VersionCheck }>(code);
  return { ...stub, withTempFile, versionCheck };
}

void test('F3 同名的檔已經在：不覆寫、不刪，暫存檔另取名稱，做完只刪自己建的', async () => {
  const h = setup({ [STEM + '.md']: MINE, [STEM + ' 2.md']: MINE });
  let seen = '';
  const done = await h.withTempFile(h.app, STEM, TEXT, path => { seen = path; return Promise.resolve(h.texts.get(path)); });
  assert.deepEqual([seen, done.path, done.result, done.left], [STEM + ' 3.md', STEM + ' 3.md', TEXT, null]);
  assert.deepEqual([h.texts.get(STEM + '.md'), h.texts.get(STEM + ' 2.md'), h.texts.has(seen)], [MINE, MINE, false]);
  assert.deepEqual(h.writes, ['create ' + seen, 'delete ' + seen]);
});

void test('F3 建好之後中途失敗：只刪自己建的那一篇，錯誤照樣丟出', async () => {
  const h = setup({ [STEM + '.md']: MINE });
  let seen = '';
  await assert.rejects(h.withTempFile(h.app, STEM, TEXT, path => { seen = path; return Promise.reject(Error('截圖失敗')); }), /截圖失敗/);
  assert.deepEqual([seen, h.texts.get(STEM + '.md'), h.texts.has(seen)], [STEM + ' 2.md', MINE, false]);
  assert.deepEqual(h.writes, ['create ' + seen, 'delete ' + seen]);
});

void test('F3 跑的期間暫存檔被改過（不是這次寫的內容了）：不刪，回報留下的路徑', async () => {
  const h = setup();
  const done = await h.withTempFile(h.app, STEM, TEXT, path => { h.texts.set(path, '別人改過\n'); return Promise.resolve(null); });
  assert.deepEqual([done.path, done.left, h.texts.get(done.path)], [STEM + '.md', STEM + '.md', '別人改過\n']);
  assert.deepEqual(h.writes, ['create ' + STEM + '.md']);
});

void test('F3 version 命令第一步就失敗：還沒建任何檔，同名的既存檔不寫、不刪', async () => {
  const h = setup({ [NEWER]: MINE });
  Object.assign(h.document, { querySelectorAll: () => [] });
  const app = Object.assign(h.app, { commands: { executeCommandById() { throw Error('命令失敗'); } } });
  const state = { version: () => ({}), blocked: () => ({ decks: [], targets: [], all: false }), deckStatus: () => ({}), today: () => ({ share: [] }), canAnswer: () => true };
  await assert.rejects(h.versionCheck({ app, device: 'Windows-test', manifest: { id: 'essence-cards' } }, state, 'Essence W5/結果/版本'), /命令失敗/);
  assert.deepEqual([h.texts.get(NEWER), h.writes], [MINE, []]);
});

// Codex 第二次再審的 F3：內容相同不能證明是這次建的。跑的期間這次的檔被搬走、原路徑出現另一篇內容一樣的檔：
// 那一篇不刪；這次的檔留在搬去的地方，回報在 left。正常結束與中途失敗都一樣。
for (const fails of [false, true]) void test('F3 同一個路徑換成內容相同的另一篇：不刪它，回報這次的檔搬去哪裡' + (fails ? '（中途失敗）' : ''), async () => {
  const h = setup();
  type File = { path: string };
  const vault = h.app.vault as { getFileByPath(path: string): File | null; rename(file: File, to: string): Promise<void>; create(path: string, text: string): Promise<File> };
  let other: File | null = null;
  const running = h.withTempFile(h.app, STEM, TEXT, async path => {
    const mine = vault.getFileByPath(path);
    assert.ok(mine);
    await vault.rename(mine, STEM + '（搬走）.md');
    other = await vault.create(path, TEXT);
    if (fails) throw Error('截圖失敗');
    return null;
  });
  if (fails) await assert.rejects(running, /截圖失敗/);
  else assert.equal((await running).left, STEM + '（搬走）.md');
  assert.ok(other);
  assert.equal(vault.getFileByPath(STEM + '.md'), other, '另一篇還在');
  assert.deepEqual([h.texts.get(STEM + '.md'), h.texts.get(STEM + '（搬走）.md')], [TEXT, TEXT]);
  assert.ok(!h.writes.some(write => write.startsWith('delete ')), h.writes.join('\n'));
});
