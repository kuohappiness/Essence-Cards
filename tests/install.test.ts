import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from '../src/core/backup/index.ts';
import { installVault, registerTestVault } from '../tools/install.ts';
import type { InstallOptions } from '../tools/install.ts';
import { makeVault, tempFolder } from './helpers/vault.ts';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
type T = Parameters<typeof tempFolder>[0];

/** 不跑 esbuild 的建置替身：照要求的 dev 寫第一行（devOut 可以故意寫錯，模擬 DEV 沒關的產出）。 */
function fakeBuild(build: string, devOut?: boolean): NonNullable<InstallOptions['build']> {
  return async ({ root: base = root, dev = false, outdir = base } = {}) => {
    await mkdir(outdir, { recursive: true });
    await writeFile(join(outdir, 'main.js'), `/*! Essence Cards build=${build} dev=${devOut ?? dev} */\n"use strict";`);
    await writeFile(join(outdir, 'styles.css'), '');
    return { version: build, dev };
  };
}

// 拿掉繼承來的 GIT_*：在 pre-commit 裡跑時 GIT_DIR 指著真的 repo，暫存 repo 的 git init 會改到它（2026-10-29 把 core.bare 改成 true）。
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();

/** 暫存的 repo：src、tools/build.mjs、manifest.json、package.json，相依套件用 junction 指回；commit 後打 tag v0.0.1。 */
async function repo(t: T, { tag = true }: { tag?: boolean } = {}): Promise<{ dir: string; head: string }> {
  const dir = await tempFolder(t, 'essence-repo-');
  await cp(join(root, 'src'), join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'tools'));
  await cp(join(root, 'tools/build.mjs'), join(dir, 'tools/build.mjs'));
  for (const name of ['manifest.json', 'package.json']) await cp(join(root, name), join(dir, name));
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
  await writeFile(join(dir, '.gitignore'), 'node_modules\n/main.js\n/styles.css\n.local/\n');
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'release');
  if (tag) git(dir, 'tag', '-a', 'v0.0.1', '-m', '第一個正式版');
  return { dir, head: git(dir, 'rev-parse', 'HEAD') };
}

async function plugin(vault: string): Promise<string[]> {
  try { return (await readdir(join(vault, '.obsidian/plugins/essence-cards'))).sort(); } catch { return []; }
}

void test('安裝：開發版裝到沒登錄的 vault 被拒，什麼都不寫；登錄的以實際路徑判斷（junction 指到別處就不算）', async t => {
  const local = await tempFolder(t, 'essence-local-');
  const registered = await makeVault(t, {}, { plugin: false });
  const other = await makeVault(t, {}, { plugin: false });
  const build = fakeBuild('0.0.1+abc1234.dirty');
  await assert.rejects(installVault({ vault: other, dev: true, local, build }), /開發版只能裝到登錄過的測試 vault/);
  assert.deepEqual(await plugin(other), []);
  await registerTestVault(registered, local);
  const links = await tempFolder(t, 'essence-links-');
  await symlink(registered, join(links, '登錄的'), 'junction');
  await symlink(other, join(links, '別的'), 'junction');
  const fake = await tempFolder(t);
  await writeFile(join(fake, 'manifest.json'), '{"id":"essence-cards"}');
  assert.equal((await installVault({ vault: join(links, '登錄的'), dev: true, local, build, root: fake })).kind, 'dev');
  assert.deepEqual(await plugin(registered), ['main.js', 'manifest.json', 'styles.css']);
  await assert.rejects(installVault({ vault: join(links, '別的'), dev: true, local, build }), /沒有登錄/);
  // 登錄的路徑本身是 junction：存的是登錄當時的實際路徑，之後改指別處不影響原本那一個。
  await registerTestVault(join(links, '別的'), local);
  const saved = JSON.parse(await readFile(join(local, 'test-vaults.json'), 'utf8')) as { vaults: string[] };
  assert.deepEqual(saved.vaults.length, 2);
  assert.ok(!saved.vaults.some(path => path.includes('essence-links-')));
});

void test('安裝：正式使用的 vault 要工作樹乾淨、HEAD 是 tag、package.json 版號相同、DEV 是 false，不符就拒絕', async t => {
  const local = await tempFolder(t, 'essence-local-');
  const vault = await makeVault(t, {}, { plugin: false });
  const { dir, head } = await repo(t);
  const build = fakeBuild('0.0.1+' + head.slice(0, 7));
  await writeFile(join(dir, '未追蹤.txt'), 'x');
  await assert.rejects(installVault({ vault, root: dir, local, build }), /未提交或未追蹤的檔/);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'after tag');
  await assert.rejects(installVault({ vault, root: dir, local, build }), /HEAD 不是 tag v0\.0\.1（那個 tag 在/);
  const untagged = await repo(t, { tag: false });
  await assert.rejects(installVault({ vault, root: untagged.dir, local, build }), /HEAD 不是 tag v0\.0\.1（沒有這個 tag）/);
  const mismatch = await repo(t, { tag: false });
  const pkg = JSON.parse(await readFile(join(mismatch.dir, 'package.json'), 'utf8')) as { version: string };
  await writeFile(join(mismatch.dir, 'package.json'), JSON.stringify({ ...pkg, version: '0.0.2' }));
  git(mismatch.dir, 'commit', '-q', '-am', 'bump');
  git(mismatch.dir, 'tag', 'v0.0.1');
  await assert.rejects(installVault({ vault, root: mismatch.dir, local, build }), /package\.json 的版號 0\.0\.2 和 manifest\.json 的 0\.0\.1 不同/);
  const clean = await repo(t);
  await assert.rejects(installVault({ vault, root: clean.dir, local, build: fakeBuild('0.0.1+' + clean.head.slice(0, 7), true) }), /DEV 不是 false/);
  await assert.rejects(installVault({ vault, root: clean.dir, local, build: fakeBuild('0.0.1+1234567') }), /和 tag v0\.0\.1 的 commit 不符/);
  assert.deepEqual(await plugin(vault), []);
  assert.deepEqual(await readdir(local), []);
});

void test('安裝：正式安裝先建置到暫存資料夾，產物與雜湊存到 .local/releases/，裝進 vault 讀回相同；同版號不能有兩份；--release 重裝那一份', async t => {
  const local = await tempFolder(t, 'essence-local-');
  const vault = await makeVault(t, {}, { plugin: false });
  const { dir, head } = await repo(t);
  const before = await readdir(dir);
  const result = await installVault({ vault, root: dir, local });
  assert.deepEqual([result.kind, result.version, result.build], ['release', '0.0.1', '0.0.1+' + git(dir, 'rev-parse', '--short', 'HEAD')]);
  assert.deepEqual(await readdir(dir), before);
  const folder = join(local, 'releases', '0.0.1');
  assert.deepEqual((await readdir(folder)).sort(), ['main.js', 'manifest.json', 'release.json', 'styles.css']);
  const release = JSON.parse(await readFile(join(folder, 'release.json'), 'utf8')) as { commit: string; build: string; sha256: Record<string, string> };
  assert.equal(release.commit, head);
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    const installed = new Uint8Array(await readFile(join(vault, '.obsidian/plugins/essence-cards', name)));
    assert.equal(hashBytes(installed), release.sha256[name], name);
  }
  assert.match(await readFile(join(vault, '.obsidian/plugins/essence-cards/main.js'), 'utf8'), /^\/\*! Essence Cards build=0\.0\.1\+[0-9a-f]+ dev=false \*\//);
  // 開發命令的 URI 帶引號，不和裝置碼的 "essence-cards-device" 混淆（同 build.test.ts）。
  assert.ok(!(await readFile(join(vault, '.obsidian/plugins/essence-cards/main.js'), 'utf8')).includes('"essence-cards-dev"'));
  assert.deepEqual(JSON.parse(await readFile(join(vault, '.obsidian/community-plugins.json'), 'utf8')), ['essence-cards']);
  // 同一個 commit 再裝一次：產物相同，照用。
  assert.equal((await installVault({ vault, root: dir, local })).build, release.build);
  // tag 移到別的 commit：同一個版號會有另一份產物，拒絕。
  await writeFile(join(dir, 'src/extra.css'), '.x { color: red; }');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'change');
  git(dir, 'tag', '-f', '-a', 'v0.0.1', '-m', 'moved');
  await assert.rejects(installVault({ vault, root: dir, local }), /已經有 0\.0\.1 的另一份產物/);
  // 退回：從 .local/releases/ 重裝那一份；產物被改過就拒絕。
  const other = await makeVault(t, {}, { plugin: false });
  const back = await installVault({ vault: other, release: '0.0.1', local });
  assert.deepEqual([back.kind, back.version, back.build], ['release', '0.0.1', release.build]);
  assert.deepEqual(await readFile(join(other, '.obsidian/plugins/essence-cards/main.js')), await readFile(join(folder, 'main.js')));
  await writeFile(join(folder, 'styles.css'), 'tampered');
  await assert.rejects(installVault({ vault: other, release: '0.0.1', local }), /styles\.css 和 release\.json 記的雜湊不同/);
  await assert.rejects(installVault({ vault: other, release: '9.9.9', local }), /沒有 9\.9\.9 的正式產物/);
});

void test('安裝命令：沒給 vault 或多給參數時印用法；開發版裝到沒登錄的 vault 被拒', async t => {
  const vault = await makeVault(t, {}, { plugin: false });
  await assert.rejects(run(process.execPath, ['tools/install-vault.mjs'], { cwd: root }), /用法/);
  await assert.rejects(run(process.execPath, ['tools/install-vault.mjs', vault, '--dev', 'x'], { cwd: root }), /用法/);
  await assert.rejects(run(process.execPath, ['tools/install-vault.mjs', vault, '--dev', '--register-test'], { cwd: root }), /用法/);
  await assert.rejects(run(process.execPath, ['tools/install-vault.mjs', vault, '--dev'], { cwd: root }), /開發版只能裝到登錄過的測試 vault/);
  assert.deepEqual(await plugin(vault), []);
});
