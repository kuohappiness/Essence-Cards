import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { removeEmptyFolder } from '../src/desktop/index.ts';
import type { wireFolderGuard as Wire } from '../src/obsidian/folder-host.ts';
import { tempFolder } from './helpers/vault.ts';

// 系統資料夾的防呆刪空資料夾（tasks/system-folder-guard.md §1-5、Codex L2 F2）：只用非遞迴的刪除，有東西就失敗。

void test('removeEmptyFolder：空的才刪；有檔、有子資料夾都由系統拒絕，內容留著', async t => {
  const vault = await tempFolder(t);
  await mkdir(join(vault, 'Essence Cards', '英文', '紀錄'), { recursive: true });
  await removeEmptyFolder(vault, 'Essence Cards/英文/紀錄');
  assert.equal(existsSync(join(vault, 'Essence Cards', '英文', '紀錄')), false);

  await mkdir(join(vault, 'a', 'sub'), { recursive: true });
  await assert.rejects(removeEmptyFolder(vault, 'a'), (error: NodeJS.ErrnoException) => ['ENOTEMPTY', 'EEXIST'].includes(error.code ?? ''));
  assert.ok(existsSync(join(vault, 'a', 'sub')));
  await writeFile(join(vault, 'a', 'sub', '同步剛到的.md'), 'x');
  await assert.rejects(removeEmptyFolder(vault, 'a/sub'));
  assert.ok(existsSync(join(vault, 'a', 'sub', '同步剛到的.md')));
});

void test('removeEmptyFolder：vault 本身、vault 以外的位置不刪', async t => {
  const vault = await tempFolder(t);
  const outside = await tempFolder(t);
  await assert.rejects(removeEmptyFolder(vault, ''), /不是 vault 裡的資料夾/);
  await assert.rejects(removeEmptyFolder(vault, '.'), /不是 vault 裡的資料夾/);
  await assert.rejects(removeEmptyFolder(join(vault, 'x'), '../'), /不是 vault 裡的資料夾/);
  await assert.rejects(removeEmptyFolder(vault, outside), /不是 vault 裡的資料夾/);
  assert.ok(existsSync(vault));
  assert.ok(existsSync(outside));
});

void test('removeEmptyFolder：照實際路徑判斷，經過 junction 走到 vault 外、本身是連結、大小寫不同的根都不刪（Codex L2 第二輪 F6）', async t => {
  const base = await tempFolder(t);
  const vault = join(base, 'vault'), outside = join(base, 'outside');
  await mkdir(join(outside, '紀錄'), { recursive: true });
  await mkdir(join(vault, 'Essence Cards'), { recursive: true });
  const kind = process.platform === 'win32' ? 'junction' : 'dir';
  // 上一層是連到 vault 外面的 junction：寫法在 vault 裡，實際在外面。
  await symlink(outside, join(vault, 'Essence Cards', '英文'), kind);
  await assert.rejects(removeEmptyFolder(vault, 'Essence Cards/英文/紀錄'), /不是 vault 裡的資料夾/);
  assert.ok(existsSync(join(outside, '紀錄')));
  // 要刪的本身是連結（連到 vault 外的空資料夾）：不刪連結，也不碰它連到的地方。
  await mkdir(join(outside, '空的'));
  await symlink(join(outside, '空的'), join(vault, 'Essence Cards', '連結'), kind);
  await assert.rejects(removeEmptyFolder(vault, 'Essence Cards/連結'), /不是 vault 裡的資料夾/);
  assert.ok(existsSync(join(vault, 'Essence Cards', '連結')));
  assert.ok(existsSync(join(outside, '空的')));
  // 絕對路徑、反斜線、空的段落一律不收（大小寫不同的 vault 根也是絕對路徑）。
  const empty = join(base, 'CaseVault');
  await mkdir(empty);
  for (const path of [join(base, 'CASEVAULT'), empty.toUpperCase(), 'Essence Cards\\英文', 'Essence Cards//英文', 'Essence Cards/./英文']) {
    await assert.rejects(removeEmptyFolder(empty, path), /不是 vault 裡的資料夾/, path);
  }
  assert.ok(existsSync(empty));
  // vault 本身經過連結也一樣：照實際路徑，vault 裡真正的空資料夾照常刪。
  const linked = join(base, 'linked');
  await symlink(vault, linked, kind);
  await mkdir(join(vault, 'Essence Cards', '空的'));
  await removeEmptyFolder(linked, 'Essence Cards/空的');
  assert.equal(existsSync(join(vault, 'Essence Cards', '空的')), false);
});

// folder-host.ts 接 Obsidian：用 esbuild 載入正式的檔，obsidian 換成只有 TFolder／TFile 的替身（不是 Obsidian 實機）。
const root = fileURLToPath(new URL('../', import.meta.url));
const code = (await build({ absWorkingDir: root, entryPoints: ['src/obsidian/folder-host.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', external: ['obsidian'], write: false })).outputFiles[0].text;
class TFolder { path: string; children: { name: string }[] = []; constructor(path: string) { this.path = path; } }
class TFile {}
const load = (): typeof Wire => {
  const mod = { exports: {} as { wireFolderGuard: typeof Wire } };
  // 和 tests/helpers/obsidian.ts 的 load 一樣執行建置好的程式碼。
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('require', 'module', 'exports', 'window', code) as (require: (name: string) => unknown, module: unknown, exports: unknown, window: unknown) => void;
  run((name: string) => {
    if (name !== 'obsidian') throw Error('folder-host 只該 require obsidian：' + name);
    return { TFolder, TFile };
  }, mod, mod.exports, { setTimeout, clearTimeout });
  return mod.exports.wireFolderGuard;
};

const R = 'Essence Cards';
const FROM = `${R}/英文/考試範圍`;
type Listed = { files: string[]; folders: string[] };
/** 磁碟上的樣子：搬走的考試範圍裡有段考.md，其他位置（原位）是空的。 */
const DISK = (path: string): Promise<Listed> => Promise.resolve({ files: path === FROM ? [`${FROM}/段考.md`] : [], folders: [] });
/** 考試範圍在 Obsidian 以外被搬進英文，原位剩下 Obsidian 看不到的空資料夾。list 是磁碟上看到的（adapter.list）。 */
function plugin(rmdir: (path: string, recursive: boolean) => Promise<void>, list: (path: string) => Promise<Listed> = DISK) {
  const files = [`${R}/英文/L1.md`, `${FROM}/段考.md`];
  const renamed: string[] = [];
  // 同一個位置每次拿到同一個物件（Obsidian 的清單也是）：防呆照物件認資料夾。
  const folders = new Map([R, `${R}/英文`, FROM].map(path => [path, new TFolder(path)]));
  folders.get(FROM)?.children.push({ name: '段考.md' });
  const handlers = new Map<string, (entry: unknown, oldPath: string) => void>();
  const vault = {
    getFiles: () => files.map(path => ({ path })),
    getAbstractFileByPath: (path: string) => folders.get(path) ?? null,
    on: (name: string, run: (entry: unknown, oldPath: string) => void) => { handlers.set(name, run); return {}; },
    adapter: { exists: () => Promise.resolve(true), list, rmdir },
  };
  const app = { vault, loadLocalStorage: () => [R, `${R}/考試範圍`], saveLocalStorage: () => {}, fileManager: { renameFile: (folder: TFolder, to: string) => {
    // 和 Obsidian 一樣：同一個物件換位置。
    renamed.push(to); folders.delete(folder.path); folder.path = to; folders.set(to, folder); return Promise.resolve();
  } } };
  return { plugin: { app, register: () => {}, registerEvent: () => {} }, renamed, folders, handlers };
}

void test('wireFolderGuard：電腦版經過 removeEmpty，不用 adapter；其他平台只用非遞迴的 adapter.rmdir', async () => {
  const wire = load();
  const calls: string[] = [];
  const desktop = plugin((path, recursive) => { calls.push(`adapter ${path} ${String(recursive)}`); return Promise.resolve(); });
  const guard = wire(desktop.plugin as never, { notify: () => {}, fail: () => {}, removeEmpty: path => { calls.push('removeEmpty ' + path); return Promise.resolve(); } });
  guard.check();
  assert.equal(await guard.moveBack(guard.issues()[0]), true);
  assert.deepEqual(calls, [`removeEmpty ${R}/考試範圍`]);
  guard.close();

  // Windows 版的 adapter 回 EISDIR（W2）：不改用遞迴的那一種，記下、請家長自己拖回。
  calls.length = 0;
  const other = plugin((path, recursive) => { calls.push(`adapter ${path} ${String(recursive)}`); return Promise.reject(Object.assign(Error('EISDIR'), { code: 'EISDIR' })); });
  const failures: unknown[] = [];
  const guard2 = wire(other.plugin as never, { notify: () => {}, fail: error => { failures.push(error); } });
  guard2.check();
  assert.equal(await guard2.moveBack(guard2.issues()[0]), false);
  assert.deepEqual(calls, [`adapter ${R}/考試範圍 false`]);
  assert.equal(failures.length, 1);
  assert.deepEqual(other.renamed, []);
  guard2.close();
});

void test('wireFolderGuard：磁碟上那個位置的內容和 Obsidian 的清單對不上（換成了別的資料夾、讀不到）就不搬（第五輪）', async () => {
  const wire = load();
  const removeEmpty = (): Promise<void> => Promise.resolve();
  for (const list of [
    (path: string) => path === FROM ? Promise.resolve({ files: [`${FROM}/家長的.md`], folders: [] }) : DISK(path),
    (path: string) => path === FROM ? Promise.reject(Error('EIO')) : DISK(path),
  ]) {
    const other = plugin(() => Promise.resolve(), list);
    const failures: unknown[] = [];
    const guard = wire(other.plugin as never, { notify: () => {}, fail: error => { failures.push(error); }, removeEmpty });
    guard.check();
    assert.equal(await guard.moveBack(guard.issues()[0]), false);
    assert.deepEqual(other.renamed, []);
    assert.equal(failures.length, 1);
    assert.match(String(failures[0]), /對不上/);
    guard.close();
  }
  // 磁碟上多了清單還沒有的（剛同步來的）不算對不上；同一個名字寫法不同（NFD）也不算。
  const synced = plugin(() => Promise.resolve(), path => path === FROM ? Promise.resolve({ files: [`${FROM}/段考.md`, `${FROM}/剛同步來的.md`], folders: [] }) : DISK(path));
  synced.folders.get(FROM)?.children.push({ name: 'Café.md' });
  const nfd = 'Café.md'.normalize('NFD');
  const listed = synced.plugin.app.vault.adapter.list;
  synced.plugin.app.vault.adapter.list = async (path: string) => {
    const result = await listed(path);
    return path === FROM ? { files: [...result.files, `${FROM}/${nfd}`], folders: result.folders } : result;
  };
  const guard = wire(synced.plugin as never, { notify: () => {}, fail: () => {}, removeEmpty });
  guard.check();
  assert.equal(await guard.moveBack(guard.issues()[0]), true);
  assert.deepEqual(synced.renamed, [`${R}/考試範圍`]);
  guard.close();
});

void test('wireFolderGuard：rename 事件帶來的資料夾本身直接交給防呆，事件當下照路徑查不到也照它搬（第五輪）', async () => {
  const wire = load();
  const host = plugin(() => Promise.resolve());
  const notices: string[] = [];
  const guard = wire(host.plugin as never, { notify: message => { notices.push(message); }, fail: () => {}, removeEmpty: () => Promise.resolve() });
  // 在 Obsidian 裡把考試範圍從原位拖進英文：事件當下清單還查不到新位置，之後才查得到。
  const entry = host.folders.get(FROM);
  host.folders.delete(FROM);
  host.handlers.get('rename')?.(entry, `${R}/考試範圍`);
  if (entry) host.folders.set(FROM, entry);
  for (let i = 0; i < 20 && !host.renamed.length; i++) await new Promise(resolve => { setTimeout(resolve, 5); });
  assert.deepEqual(host.renamed, [`${R}/考試範圍`]);
  guard.close();
});
