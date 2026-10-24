import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readFile, rm, writeFile, mkdir, symlink, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Metafile } from 'esbuild';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

/** 遞迴列出資料夾裡的檔案（相對路徑、排序），比對建置前後用。 */
async function tree(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

/** 只有 tools/build.mjs 與給定 src 檔案的暫存專案；相依套件用 junction 指回 repo。 */
async function project(t: TestContext, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'essence-build-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'tools'));
  await copyFile(join(root, 'tools/build.mjs'), join(dir, 'tools/build.mjs'));
  // Windows junction 不需要系統管理員權限，也不複製相依套件。
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, 'src', path)), { recursive: true });
    await writeFile(join(dir, 'src', path), content);
  }
  return dir;
}

void test('W1 安裝指令先建置並複製三個檔案，只 require Obsidian 提供的套件，不改動 src/', async t => {
  const vault = await mkdtemp(join(tmpdir(), 'essence-vault-'));
  t.after(() => rm(vault, { recursive: true, force: true }));
  const before = await tree(join(root, 'src'));
  const { stdout } = await run(process.execPath, ['tools/install-vault.mjs', vault], { cwd: root });
  // W5 §8-2 第 2 點：編輯器的鎖定用 Obsidian 提供的 CodeMirror。
  assert.match(stdout, /main\.js \d+ bytes; require: @codemirror\/state, @codemirror\/view, obsidian\n/);
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    assert.deepEqual(await readFile(join(vault, '.obsidian/plugins/essence-cards', name)), await readFile(join(root, name)));
  }
  assert.deepEqual(await tree(join(root, 'src')), before);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual([manifest.id, manifest.name, manifest.version, manifest.minAppVersion, manifest.isDesktopOnly], ['essence-cards', 'Essence Cards', '0.0.1', '1.8.7', false]);
});

void test('W1 沒有 CSS 時 styles.css 是空字串，隔離在暫存專案', async t => {
  const dir = await project(t, { 'main.ts': 'import { Notice } from "obsidian"; new Notice("test");' });
  await run(process.execPath, ['tools/build.mjs'], { cwd: dir });
  assert.equal(await readFile(join(dir, 'styles.css'), 'utf8'), '');
});

void test('W1 CSS 合併：tokens 第一、其餘依路徑排序，建置前後 src/ 的檔案清單相同', async t => {
  const dir = await project(t, {
    'main.ts': 'import { Notice } from "obsidian"; new Notice("test");',
    'ui/tokens.css': 'tokens{}', 'a.css': 'a{}', 'z.css': 'z{}', 'nested/b.css': 'b{}',
  });
  const before = await tree(join(dir, 'src'));
  await run(process.execPath, ['tools/build.mjs'], { cwd: dir });
  assert.equal(await readFile(join(dir, 'styles.css'), 'utf8'), 'tokens{}\na{}\nb{}\nz{}');
  assert.deepEqual(await tree(join(dir, 'src')), before);
});

void test('W1 新增模組資料夾與 CSS 不會誤報：建置成功、只 require obsidian', async t => {
  const dir = await project(t, {
    'main.ts': 'import { Notice } from "obsidian"; import { a } from "./state/a.ts"; import { b } from "./dev/b.ts"; new Notice(a + b);',
    'state/a.ts': 'export const a = "a";', 'dev/b.ts': 'export const b = "b";', 'obsidian/c.css': 'c{}',
  });
  const { stdout } = await run(process.execPath, ['tools/build.mjs'], { cwd: dir });
  assert.match(stdout, /require: obsidian\n/);
  assert.equal(await readFile(join(dir, 'styles.css'), 'utf8'), 'c{}');
});
void test('W1 安裝指令拒絕未給 vault，不寫入預設路徑', async () => {
  await assert.rejects(run(process.execPath, ['tools/install-vault.mjs'], { cwd: root }), /用法/);
});
void test('deck 連同 YAML 與 SHA-256 可直接建成 browser bundle', async () => {
  const result = await build({ absWorkingDir: root, entryPoints: ['src/core/deck/index.ts'], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  assert.deepEqual(imports.filter(entry => entry.external), []);
});

void test('study 連同 FSRS 可直接建成 browser bundle，不需要宿主或 Node', async () => {
  const result = await build({ absWorkingDir: root, entryPoints: ['src/core/study/index.ts'], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  assert.deepEqual(imports.filter(entry => entry.external), []);
});

void test('W5 開發命令只在 --dev 建置：正式的 main.js 不含 URI、命令名稱、對照與契約檢查的程式', async t => {
  const dir = await project(t, {});
  await cp(join(root, 'src'), join(dir, 'src'), { recursive: true });
  // 中文會被 esbuild 跳脫成 \uXXXX，契約檢查用它的代號 "C14" 當記號；URI 帶引號，不和裝置碼的 "essence-cards-device" 混淆。
  const marks = ['"essence-cards-dev"', 'cases.json', 'export-compare', 'metadataCache', '"C14"', 'Essence W5'];
  await run(process.execPath, ['tools/build.mjs', '--dev'], { cwd: dir });
  const dev = await readFile(join(dir, 'main.js'), 'utf8');
  for (const mark of marks) assert.ok(dev.includes(mark), '開發版缺 ' + mark);
  const { stdout } = await run(process.execPath, ['tools/build.mjs'], { cwd: dir });
  assert.match(stdout, /require: @codemirror\/state, @codemirror\/view, obsidian\n/);
  const production = await readFile(join(dir, 'main.js'), 'utf8');
  for (const mark of marks) assert.ok(!production.includes(mark), '正式版含有 ' + mark);
});

void test('W5 正式建置不含 src/dev/ 與開發命令的任何程式（包括計數 Files 呼叫的包裝）', async t => {
  // 跑真正的 tools/build.mjs（隔離在暫存專案），看它的 metafile 裡每個輸入檔實際進了輸出多少 bytes。
  const dir = await project(t, {});
  await cp(join(root, 'src'), join(dir, 'src'), { recursive: true });
  const included = async (dev: boolean) => {
    const out = join(dir, 'meta.json');
    await run(process.execPath, ['tools/build.mjs', ...(dev ? ['--dev'] : [])], { cwd: dir, env: { ...process.env, ESSENCE_METAFILE: out } });
    const meta = JSON.parse(await readFile(out, 'utf8')) as Metafile;
    return Object.entries(Object.values(meta.outputs)[0].inputs).filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path);
  };
  const devOnly = (path: string) => path.startsWith('src/dev/') || path === 'src/obsidian/dev.ts' || path === 'src/obsidian/dev-ids.ts';
  assert.deepEqual((await included(false)).filter(devOnly), []);
  // I9：CodeMirror 由 Obsidian 提供，沒有另一份被打包進來；編輯器的鎖定在正式版裡。
  for (const dev of [false, true]) {
    const inputs = await included(dev);
    assert.deepEqual(inputs.filter(path => path.includes('node_modules/@codemirror/')), []);
    assert.ok(inputs.includes('src/obsidian/lock.ts') && inputs.includes('src/obsidian/save.ts'));
  }
  assert.deepEqual((await included(true)).filter(devOnly).sort(), ['src/dev/compare.ts', 'src/dev/files-contract.ts', 'src/dev/wrap-files.ts', 'src/obsidian/dev-ids.ts', 'src/obsidian/dev.ts']);
});

void test('W5 安裝 --dev 裝開發版，並把 essence-cards 加進那個 vault 的外掛清單一次', async t => {
  const vault = await mkdtemp(join(tmpdir(), 'essence-vault-'));
  t.after(async () => { await rm(vault, { recursive: true, force: true }); await run(process.execPath, ['tools/build.mjs'], { cwd: root }); });
  await mkdir(join(vault, '.obsidian'));
  await writeFile(join(vault, '.obsidian/community-plugins.json'), '["other"]');
  for (let i = 0; i < 2; i++) await run(process.execPath, ['tools/install-vault.mjs', vault, '--dev'], { cwd: root });
  assert.deepEqual(JSON.parse(await readFile(join(vault, '.obsidian/community-plugins.json'), 'utf8')), ['other', 'essence-cards']);
  assert.ok((await readFile(join(vault, '.obsidian/plugins/essence-cards/main.js'), 'utf8')).includes('essence-cards-dev'));
  await assert.rejects(run(process.execPath, ['tools/install-vault.mjs', vault, '--dev', 'x'], { cwd: root }), /用法/);
});
