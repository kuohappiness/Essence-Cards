import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('W1 安裝指令先建置並複製三個檔案，僅 require obsidian、無 CSS 時空檔', async t => {
  const vault = await mkdtemp(join(tmpdir(), 'essence-vault-'));
  t.after(() => rm(vault, { recursive: true, force: true }));
  const { stdout } = await run(process.execPath, ['tools/install-vault.mjs', vault], { cwd: root });
  assert.match(stdout, /main\.js \d+ bytes; require: obsidian/);
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    assert.deepEqual(await readFile(join(vault, '.obsidian/plugins/essence-cards', name)), await readFile(join(root, name)));
  }
  assert.equal(await readFile(join(root, 'styles.css'), 'utf8'), '');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual([manifest.id, manifest.name, manifest.version, manifest.minAppVersion, manifest.isDesktopOnly], ['essence-cards', 'Essence Cards', '0.0.1', '1.8.0', false]);
});

test('W1 CSS 合併：tokens 第一、其餘依路徑排序，隔離在暫存專案', async t => {
  const project = await mkdtemp(join(tmpdir(), 'essence-build-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, 'tools')); await mkdir(join(project, 'src', 'ui'), { recursive: true });
  await mkdir(join(project, 'src', 'nested'));
  await copyFile(join(root, 'tools/build.mjs'), join(project, 'tools/build.mjs'));
  // Windows junction 不需要系統管理員權限，也不複製相依套件。
  await symlink(join(root, 'node_modules'), join(project, 'node_modules'), 'junction');
  await writeFile(join(project, 'src/main.ts'), 'import { Notice } from "obsidian"; new Notice("test");');
  for (const [path, content] of [['ui/tokens.css', 'tokens{}'], ['a.css', 'a{}'], ['z.css', 'z{}'], ['nested/b.css', 'b{}']]) await writeFile(join(project, 'src', path), content);
  await run(process.execPath, ['tools/build.mjs'], { cwd: project });
  assert.equal(await readFile(join(project, 'styles.css'), 'utf8'), 'tokens{}\na{}\nb{}\nz{}');
  assert.deepEqual((await readdir(join(root, 'src'))).sort(), ['core', 'main.ts']);
});
test('W1 安裝指令拒絕未給 vault，不寫入預設路徑', async () => {
  await assert.rejects(run(process.execPath, ['tools/install-vault.mjs'], { cwd: root }), /用法/);
});
test('deck 連同 YAML 與 SHA-256 可直接建成 browser bundle', async () => {
  const result = await build({ absWorkingDir: root, entryPoints: ['src/core/deck/index.ts'], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  assert.deepEqual(imports.filter(entry => entry.external), []);
});
