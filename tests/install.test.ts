import test from 'node:test';
import { gitEnv } from '../tools/git.ts';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from '../src/core/backup/index.ts';
import { installVault, registerTestVault, releaseProblems } from '../tools/install.ts';
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
const env = gitEnv();
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();

/**
 * 暫存的 repo：src、tools/build.mjs、manifest.json、package.json，相依套件用 junction 指回；commit 後打 tag v0.0.1。
 * 版號固定是 0.0.1，不跟著真的 repo 升版（升到 0.1.0 時這裡的測試全部壞過）。
 */
async function repo(t: T, { tag = true }: { tag?: boolean } = {}): Promise<{ dir: string; head: string }> {
  const dir = await tempFolder(t, 'essence-repo-');
  await cp(join(root, 'src'), join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'tools'));
  await cp(join(root, 'tools/build.mjs'), join(dir, 'tools/build.mjs'));
  for (const name of ['manifest.json', 'package.json']) {
    const json = JSON.parse(await readFile(join(root, name), 'utf8')) as Record<string, unknown>;
    await writeFile(join(dir, name), JSON.stringify({ ...json, version: '0.0.1' }, null, 2) + '\n');
  }
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
  // 對照表和產物一起存在本機（D-155 第 5 點），雜湊記進 release.json；不裝進 vault。
  assert.deepEqual((await readdir(folder)).sort(), ['main.js', 'main.js.map', 'manifest.json', 'release.json', 'styles.css']);
  const release = JSON.parse(await readFile(join(folder, 'release.json'), 'utf8')) as { commit: string; build: string; sha256: Record<string, string> };
  assert.equal(release.commit, head);
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    const installed = new Uint8Array(await readFile(join(vault, '.obsidian/plugins/essence-cards', name)));
    assert.equal(hashBytes(installed), release.sha256[name], name);
  }
  assert.equal(hashBytes(new Uint8Array(await readFile(join(folder, 'main.js.map')))), release.sha256['main.js.map']);
  assert.deepEqual(await plugin(vault), ['main.js', 'manifest.json', 'styles.css']);
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
  // 舊的版本沒有對照表（0.1.0 之前就裝了的）照常能退回。
  const saved = await readFile(join(folder, 'release.json'), 'utf8');
  const { 'main.js.map': _map, ...withoutMap } = release.sha256;
  await writeFile(join(folder, 'release.json'), JSON.stringify({ ...release, sha256: withoutMap }));
  await rm(join(folder, 'main.js.map'));
  assert.equal((await installVault({ vault: other, release: '0.0.1', local })).build, release.build);
  await writeFile(join(folder, 'release.json'), saved);
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

void test('git 的環境變數不分大小寫都拿掉：小寫或大小寫混用的 git_dir 指到別的 repo 時，仍讀自己的 repo（Codex 第二輪 L3）', async t => {
  const own = await repo(t), other = await repo(t, { tag: false });
  const { buildVersion } = await import('../tools/build.mjs');
  for (const name of ['git_dir', 'Git_Dir']) {
    process.env[name] = join(other.dir, '.git');
    try {
      assert.equal((await releaseProblems(own.dir)).commit, own.head, name);
      assert.equal(await buildVersion(own.dir), '0.0.1+' + git(own.dir, 'rev-parse', '--short', 'HEAD'), name);
    } finally {
      delete process.env[name];
    }
  }
  assert.equal(git(other.dir, 'rev-parse', 'HEAD'), other.head);
});

void test('安裝：設定資料夾（或底下的外掛資料夾、輸出檔）是連到別處的連結時拒絕，不寫進沒登錄的 vault（Codex 第二輪 L1）', async t => {
  const local = await tempFolder(t, 'essence-local-');
  const test = await makeVault(t, {}, { plugin: false });
  const other = await makeVault(t, { '.obsidian/community-plugins.json': '["other"]' }, { plugin: false });
  await registerTestVault(test, local);
  await symlink(join(other, '.obsidian'), join(test, '.obsidian'), 'junction');
  const fake = await tempFolder(t);
  await writeFile(join(fake, 'manifest.json'), '{"id":"essence-cards"}');
  const build = fakeBuild('0.0.1+abc1234.dirty');
  await assert.rejects(installVault({ vault: test, dev: true, local, build, root: fake }), /\.obsidian：是連結/);
  assert.deepEqual(await plugin(other), []);
  assert.equal(await readFile(join(other, '.obsidian/community-plugins.json'), 'utf8'), '["other"]');
  await assert.rejects(installVault({ vault: test, dev: true, local, build, root: fake, config: '../x' }), /不是相對 vault 的路徑/);
});

// D-149 第 4 點、任務說明 1-4：退回前先檢查現有資料的「需要版本」與 need；有比那一版新（或讀不懂）的就拒絕，什麼都不裝。
void test('退回：現有資料需要比那一版新的版本時拒絕，列出是哪些；讀得懂的照裝', async t => {
  const local = await tempFolder(t, 'essence-local-');
  const folder = join(local, 'releases', '0.1.0');
  await mkdir(folder, { recursive: true });
  const outputs = { 'main.js': '/*! Essence Cards build=0.1.0+1a2b3c4 dev=false */\n', 'manifest.json': '{"id":"essence-cards","version":"0.1.0"}', 'styles.css': '' };
  for (const [name, text] of Object.entries(outputs)) await writeFile(join(folder, name), text);
  const sha256 = Object.fromEntries(Object.entries(outputs).map(([name, text]) => [name, hashBytes(new TextEncoder().encode(text))]));
  await writeFile(join(folder, 'release.json'), JSON.stringify({ version: '0.1.0', build: '0.1.0+1a2b3c4', commit: '1a2b3c4', created: '2026-10-29T00:00:00.000Z', sha256 }));
  const goal = '- 目標 ^aaaaaa\n    - Q :: A\n';
  const log = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
  const cases: [Record<string, string>, RegExp][] = [
    [{ 'Essence Cards/新.md': '---\n需要版本: 0.2.0\n---\n' + goal }, /Essence Cards\/新\.md：需要版本 0\.2\.0/],
    [{ 'Essence Cards/壞.md': '---\n科目: [\n需要版本: 0.0.1\n---\n' + goal }, /Essence Cards\/壞\.md：需要版本的寫法讀不懂/],
    [{ [log]: JSON.stringify({ t: '2026-10-28T10:00:00.000+08:00', need: '0.2.0', lt: 'aaaaaa', r: 'good', v: '12345678' }) + '\n' }, /複習紀錄：1 個學習目標的紀錄需要比 0\.1\.0 新的版本（aaaaaa）/],
    [{ [log]: JSON.stringify({ t: '2026-10-28T10:00:00.000+08:00', need: 'v0.1.0', set: 'cap', val: 20 }) + '\n' }, /複習紀錄：有讀不懂的行，辨認不出影響哪些學習目標/],
  ];
  for (const [files, message] of cases) {
    const vault = await makeVault(t, files, { plugin: false });
    await assert.rejects(installVault({ vault, release: '0.1.0', local }), (error: Error) => /需要比 0\.1\.0 新的版本才讀得懂，不能退回這一版/.test(error.message) && message.test(error.message));
    assert.deepEqual(await plugin(vault), [], Object.keys(files)[0]);
  }
  const vault = await makeVault(t, { 'Essence Cards/舊.md': '---\n需要版本: 0.1.0\n---\n' + goal,
    [log]: JSON.stringify({ t: '2026-10-28T10:00:00.000+08:00', need: '0.0.9', lt: 'aaaaaa', r: 'good', v: '12345678' }) + '\n' }, { plugin: false });
  assert.equal((await installVault({ vault, release: '0.1.0', local })).version, '0.1.0');
  assert.deepEqual(await plugin(vault), ['main.js', 'manifest.json', 'styles.css']);
});
