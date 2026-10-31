import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

void test('ESLint 的模組邊界與日期規則會擋下違規寫法，允許公開介面與 UTC', async () => {
  // 這裡只驗證語法規則；片段不是完整產品檔案，不需要建立 TypeScript project。
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  for (const name of ['obsidian', 'react/jsx-runtime', 'react-dom/client', 'motion/react', 'node:fs', 'fs/promises', 'path', 'ts-fsrs']) {
    const [result] = await lint.lintText(`import '${name}';`, { filePath: 'src/core/files.ts' });
    assert.ok(result.messages.some(m => m.ruleId === 'no-restricted-imports'), name);
  }
  for (const method of ['getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds', 'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds', 'setMilliseconds', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toString']) {
    for (const call of [`new Date().${method}()`, `new Date()['${method}']()`]) {
      const [result] = await lint.lintText(`${call};`, { filePath: 'src/core/files.ts' });
      assert.ok(result.messages.some(m => m.ruleId === 'no-restricted-syntax'), call);
    }
  }
  for (const [path, name, blocked] of [
    ['src/main.ts', './core/deck/parse.ts', true],
    ['tools/example.mjs', '../src/core/study/fsrs.ts', true],
    ['tests/example.test.ts', '../src/core/deck/types.ts', true],
    ['src/main.ts', './core/files.ts', false],
    ['src/main.ts', './core/deck/index.ts', false],
    ['src/core/study/fsrs.ts', 'ts-fsrs', false],
  ] as const) {
    const [result] = await lint.lintText(`import '${name}';`, { filePath: path });
    assert.equal(result.messages.some(m => m.ruleId === 'no-restricted-imports'), blocked, path + ': ' + name);
  }
  const [utc] = await lint.lintText('new Date().getUTCDate(); new Date().getTimezoneOffset();', { filePath: 'src/core/files.ts' });
  assert.deepEqual(utc.messages, []);
});

void test('安裝 hook 時恢復 LF：Git Bash 可執行，缺相依時程式與文件的 commit 都擋', async t => {
  const root = await mkdtemp(join(tmpdir(), 'essence-hooks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = promisify(execFile);
  const shell = promisify(exec);
  // pre-commit 會匯出 GIT_DIR / GIT_INDEX_FILE 等；在另一個 repo 操作前必須清除。
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  const isolated = { cwd: root, env };
  await run('git', ['init', '-q'], isolated);
  await mkdir(join(root, '.githooks'));
  await mkdir(join(root, 'src'));
  const original = (await readFile(new URL('../.githooks/pre-commit', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  const hook = join(root, '.githooks/pre-commit');
  await writeFile(hook, original.replaceAll('\n', '\r\n'));
  await chmod(hook, 0o755);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: { preprepare: string; prepare: string } };
  await shell(pkg.scripts.preprepare, isolated);
  await shell(pkg.scripts.prepare, isolated);
  assert.equal(await readFile(hook, 'utf8'), original);
  await writeFile(join(root, 'src/probe.ts'), 'export {};\n');
  await run('git', ['add', '--', 'src/probe.ts'], isolated);
  const commit = ['-c', 'user.name=QualityTest', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'probe'];
  await assert.rejects(run('git', commit, isolated), /先執行 npm install/);
  await run('git', ['rm', '--cached', '--', 'src/probe.ts'], isolated);
  await writeFile(join(root, 'doc.md'), '文件\n');
  await run('git', ['add', '--', 'doc.md'], isolated);
  await assert.rejects(run('git', commit, isolated), /先執行 npm install/);
});

void test('D-141 每次 commit 都跑文件檢查且讀暫存區：只改文件不跑程式檢查，沒 stage 的壞連結不擋', async t => {
  // 相依借用本 repo 的 node_modules（junction，Linux 上是 symlink），檢查程式複製一份；兩者都不 stage。
  // 清理時先拆掉連結再刪資料夾，不會碰到本 repo 的 node_modules。
  const root = await mkdtemp(join(tmpdir(), 'essence-hook-docs-'));
  const modules = join(root, 'node_modules');
  t.after(async () => {
    await unlink(modules).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  const run = promisify(execFile);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  const isolated = { cwd: root, env };
  const commit = ['-c', 'user.name=QualityTest', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'probe'];
  await run('git', ['init', '-q'], isolated);
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), modules, 'junction');
  await mkdir(join(root, 'tools'));
  // 本 repo 的例外表在這裡會變成「沒用到」，複製時清空。
  const checker = await readFile(new URL('../tools/check-docs.ts', import.meta.url), 'utf8');
  const emptied = checker.replace(/^export const EXCEPTIONS: Exception\[\] = \[[\s\S]*?^\];\r?$/m, 'export const EXCEPTIONS: Exception[] = [];');
  assert.notEqual(emptied, checker);
  await writeFile(join(root, 'tools/check-docs.ts'), emptied);
  await mkdir(join(root, '.githooks'));
  const hook = join(root, '.githooks/pre-commit');
  await writeFile(hook, (await readFile(new URL('../.githooks/pre-commit', import.meta.url), 'utf8')).replaceAll('\r\n', '\n'));
  await chmod(hook, 0o755);
  await run('git', ['config', 'core.hooksPath', '.githooks'], isolated);
  // 只改文件：沒有 package.json，跑到程式檢查就會失敗，所以通過表示只跑了文件檢查。
  await writeFile(join(root, 'a.md'), '# A\n\n[b](b.md)\n');
  await writeFile(join(root, 'b.md'), '# B\n');
  await run('git', ['add', '--', 'a.md', 'b.md'], isolated);
  await run('git', commit, isolated);
  // 部分 stage：工作樹的壞連結沒 stage，照樣能 commit。
  await writeFile(join(root, 'a.md'), '# A\n\n[b](b.md)、[壞](missing.md)\n');
  await writeFile(join(root, 'b.md'), '# B\n\n改了\n');
  await run('git', ['add', '--', 'b.md'], isolated);
  await run('git', commit, isolated);
  // stage 了就擋。
  await run('git', ['add', '--', 'a.md'], isolated);
  await assert.rejects(run('git', commit, isolated), /a\.md:3 {2}missing\.md {2}找不到檔案/);
});

for (const scenario of ['中文新增', '移出 src 的改名'] as const) void test('L2-3 hook 擋下缺相依的' + scenario, async t => {
  const root = await mkdtemp(join(tmpdir(), 'essence-hook-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  const isolated = { cwd: root, env };
  const run = promisify(execFile);
  const commit = ['-c', 'user.name=QualityTest', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'probe'];
  await run('git', ['init', '-q'], isolated);
  await run('git', ['config', 'core.quotepath', 'true'], isolated);
  await mkdir(join(root, 'src'));
  if (scenario === '移出 src 的改名') {
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'src/x.ts'), 'export {};\n');
    await run('git', ['add', '--', 'src/x.ts'], isolated);
    await run('git', commit, isolated);
    await run('git', ['mv', 'src/x.ts', 'docs/x.ts'], isolated);
  } else {
    await writeFile(join(root, 'src/中文.ts'), 'export {};\n');
    await run('git', ['add', '--', 'src/中文.ts'], isolated);
  }
  await mkdir(join(root, '.githooks'));
  const hook = join(root, '.githooks/pre-commit');
  await writeFile(hook, (await readFile(new URL('../.githooks/pre-commit', import.meta.url), 'utf8')).replaceAll('\r\n', '\n'));
  await chmod(hook, 0o755);
  await run('git', ['config', 'core.hooksPath', '.githooks'], isolated);
  await assert.rejects(run('git', commit, isolated), /先執行 npm install/);
});

// 外掛架構檢查環節 9 結論第 2 條（Q2）：改到程式時跑同一份 npm run check，只是測試改用 dot reporter。
void test('Q2 改到程式時 hook 跑 npm run check：測試只印點、保留原本的 NODE_OPTIONS；失敗時擋下並印出錯誤', async t => {
  const root = await mkdtemp(join(tmpdir(), 'essence-hook-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = promisify(execFile);
  // 原本的 NODE_OPTIONS 已有 --test-reporter 時（例如這個測試本身由 pre-commit 執行），再加一個 node 會報錯，所以換成已知的值。
  // 這個測試的程序帶著 NODE_TEST_CONTEXT，裡面再跑的 node --test 會當自己是子程序，測試失敗也回 0，所以拿掉。
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '--max-old-space-size=1024' };
  delete env.NODE_TEST_CONTEXT;
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  const isolated = { cwd: root, env };
  const commit = ['-c', 'user.name=QualityTest', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'probe'];
  await run('git', ['init', '-q'], isolated);
  // hook 只看 node_modules 在不在；文件檢查換成什麼都不做的替身，不 stage。
  await mkdir(join(root, 'node_modules'));
  await mkdir(join(root, 'tools'));
  await writeFile(join(root, 'tools/check-docs.ts'), 'export {};\n');
  await mkdir(join(root, '.githooks'));
  const hook = join(root, '.githooks/pre-commit');
  await writeFile(hook, (await readFile(new URL('../.githooks/pre-commit', import.meta.url), 'utf8')).replaceAll('\r\n', '\n'));
  await chmod(hook, 0o755);
  await run('git', ['config', 'core.hooksPath', '.githooks'], isolated);
  const check = 'node -e "console.log(\'NODE_OPTIONS=\' + process.env.NODE_OPTIONS)" && node --test probe.test.mjs';
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { check } }));
  const probe = "import test from 'node:test';\nvoid test('probe-pass', () => {});\n";
  await writeFile(join(root, 'probe.test.mjs'), probe);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/probe.ts'), 'export {};\n');
  await run('git', ['add', '--', 'src/probe.ts'], isolated);
  const passed = await run('git', commit, isolated);
  assert.match(passed.stdout + passed.stderr, /NODE_OPTIONS=--max-old-space-size=1024 --test-reporter=dot\n/);
  assert.doesNotMatch(passed.stdout + passed.stderr, /probe-pass/);
  await writeFile(join(root, 'probe.test.mjs'), probe + "void test('probe-fail', () => { throw new Error('probe failure message'); });\n");
  await writeFile(join(root, 'src/probe.ts'), 'export const changed = 1;\n');
  await run('git', ['add', '--', 'src/probe.ts'], isolated);
  await assert.rejects(run('git', commit, isolated), (error: unknown) => {
    const { code, stdout, stderr } = error as { code: unknown; stdout: string; stderr: string };
    assert.equal(code, 1);
    assert.match(stdout + stderr, /probe failure message/);
    assert.doesNotMatch(stdout + stderr, /probe-pass/);
    return true;
  });
  assert.equal((await run('git', ['rev-list', '--count', 'HEAD'], isolated)).stdout.trim(), '1');
});

const loadForms = (name: string) => [
  "import '" + name + "';", "export * from '" + name + "';",
  "void import('" + name + "');", "require('" + name + "');",
];
const isBoundary = (message: { ruleId: string | null }) => message.ruleId === 'no-restricted-imports' || message.ruleId === 'essence/module-boundaries';
/** D-148：src/ 一律不准 require（不管載入的是什麼），其他寫法照各自的邊界。 */
const expected = (path: string, code: string, blocked: boolean): boolean => blocked || (path.startsWith('src/') && code.startsWith('require('));
for (const [name, path, dependency] of [
  ['核心不能載入 React', 'src/core/files.ts', 'react'],
  ['入口不能載入核心內部', 'src/main.ts', './core/study/fsrs.ts'],
  ['工具不能直接載入 ts-fsrs', 'tools/example.mjs', 'ts-fsrs'],
] as const) void test('L2-4 ' + name + '，涵蓋 import、export、動態 import 與 require', async () => {
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  for (const code of loadForms(dependency)) {
    const [result] = await lint.lintText(code, { filePath: path });
    assert.ok(result.messages.some(isBoundary), path + ': ' + code);
  }
});

void test('L2-4 三個目錄都受邊界規則保護，公開入口與 FSRS 包裝例外仍可使用', async () => {
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  for (const [path, name, blocked] of [
    ['src/core/files.ts', 'node:fs', true], ['src/core/files.ts', 'fs/promises', true],
    ['src/core/files.ts', 'obsidian', true], ['src/core/files.ts', 'motion/react', true],
    ['src/core/files.ts', 'react-dom/client', true], ['src/core/files.ts', 'react/jsx-runtime', true],
    ['src/core/study/fsrs.ts', 'react', true],
    ['src/core/study/entries.ts', 'ts-fsrs', true], ['src/main.ts', 'ts-fsrs', true],
    ['tests/example.test.ts', 'ts-fsrs', true],
    ['tools/nested/example.mjs', 'ts-fsrs', true], ['tests/nested/example.mjs', 'ts-fsrs', true],
    ['tools/example.mjs', '../src/core/study/log.ts', true],
    ['tests/example.test.ts', '../src/core/deck/types.ts', true],
    ['src/core/study/fsrs.ts', 'ts-fsrs', false],
    ['src/main.ts', './core/files.ts', false], ['src/main.ts', './core/study/index.ts', false],
    ['tools/example.mjs', '../src/core/study/index.ts', false],
    ['tests/example.test.ts', '../src/core/deck/index.ts', false],
  ] as const) for (const code of loadForms(name)) {
    const [result] = await lint.lintText(code, { filePath: path });
    assert.equal(result.messages.some(isBoundary), expected(path, code, blocked), path + ': ' + code);
  }
  for (const [path, blocked] of [['src/core/study/types.ts', true], ['tests/example.test.ts', true], ['src/core/study/fsrs.ts', false]] as const) {
    const [result] = await lint.lintText("export type External = import('ts-fsrs').FSRS;", { filePath: path });
    assert.equal(result.messages.some(isBoundary), blocked, path);
  }
});

void test('W4 核心模組之間只能 import 對方的 index.ts，deck 不能依賴 study，study 從 deck 只拿型別', async () => {
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  for (const [path, code, blocked] of [
    ['src/core/study/plan.ts', "import type { Deck } from '../deck/index.ts';", false],
    ['src/core/study/plan.ts', "export type { Deck } from '../deck/index.ts';", false],
    ['src/core/study/plan.ts', "export type Deck = import('../deck/index.ts').Deck;", false],
    ['src/core/study/plan.ts', "import type { Files } from '../files.ts';", false],
    ['src/core/study/plan.ts', "import { review } from './fsrs.ts';", false],
    ['src/core/study/plan.ts', "import type { Deck } from '../deck/types.ts';", true],
    ['src/core/study/plan.ts', "import '../deck/parse.ts';", true],
    ['src/core/study/plan.ts', "import { parseDeck } from '../deck/index.ts';", true],
    ['src/core/study/plan.ts', "import { type Deck } from '../deck/index.ts';", true],
    ['src/core/study/plan.ts', "export * from '../deck/index.ts';", true],
    ['src/core/study/plan.ts', "void import('../deck/index.ts');", true],
    ['src/core/study/plan.ts', "require('../deck/index.ts');", true],
    ['src/core/deck/parse.ts', "import type { Memory } from '../study/index.ts';", true],
    ['src/core/deck/parse.ts', "export type Memory = import('../study/index.ts').Memory;", true],
    ['src/core/deck/parse.ts', "void import('../study/index.ts');", true],
    ['src/core/deck/parse.ts', "require('../study/time.ts');", true],
    ['src/core/deck/parse.ts', "import { linesOf } from './markdown.ts';", false],
    ['src/core/future/x.ts', "import { planToday } from '../study/index.ts';", false],
    ['src/core/future/x.ts', "import { planToday } from '../study/plan.ts';", true],
    ['src/core/future/x.ts', "export { dayOf } from '../study/time.ts';", true],
  ] as const) {
    const [result] = await lint.lintText(code, { filePath: path });
    assert.equal(result.messages.some(isBoundary), expected(path, code, blocked), path + ': ' + code);
  }
});

void test('W5 state 與 dev 不能 import Obsidian、畫面或 Node；核心不能 import 核心以外的 src', async () => {
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  for (const [path, code, blocked] of [
    ['src/state/index.ts', "import { Notice } from 'obsidian';", true],
    ['src/state/index.ts', "void import('obsidian');", true],
    ['src/state/index.ts', "import 'react';", true],
    ['src/dev/compare.ts', "import { readFile } from 'node:fs/promises';", true],
    ['src/dev/compare.ts', "require('fs');", true],
    ['src/dev/compare.ts', "import '../core/deck/parse.ts';", true],
    ['src/dev/compare.ts', "import { parseDeck } from '../core/deck/index.ts';", false],
    ['src/state/index.ts', "import type { Files } from '../core/files.ts';", false],
    ['src/state/index.ts', "import { x } from '../dev/compare.ts';", false],
    ['src/core/study/plan.ts', "import { createState } from '../../state/index.ts';", true],
    ['src/core/study/plan.ts', "export * from '../../dev/compare.ts';", true],
    ['src/core/study/plan.ts', "void import('../../main.ts');", true],
    ['src/core/files.ts', "import type { State } from '../state/index.ts';", true],
    ['src/core/files.ts', "import type { Deck } from './deck/index.ts';", false],
    ['src/obsidian/files.ts', "import { Notice } from 'obsidian';", false],
    // W5 §8-7 I10：CodeMirror 只能在 src/obsidian/ 與 main.ts。
    ['src/core/deck/parse.ts', "import { EditorState } from '@codemirror/state';", true],
    ['src/core/deck/parse.ts', "import type { Extension } from '@codemirror/state';", true],
    ['src/core/study/plan.ts', "void import('@codemirror/view');", true],
    ['src/state/index.ts', "import { EditorView } from '@codemirror/view';", true],
    ['src/dev/compare.ts', "require('@codemirror/state');", true],
    ['src/obsidian/lock.ts', "import { EditorState } from '@codemirror/state';", false],
  ] as const) {
    const [result] = await lint.lintText(code, { filePath: path });
    assert.equal(result.messages.some(isBoundary), expected(path, code, blocked), path + ': ' + code);
  }
});

// 技術債 A7：state 和核心一樣只能透過 index.ts 使用（state 裡面互相 import 照舊）。
// 第一個里程碑回顧的 R1：tests/node-files.test.ts 換掉全域的 fs.readdirSync，Linux 上 Node 自己的遞迴監看也被換掉，CI 紅了三天。
void test('R1 測試不能改全域的 Node 內建模組：syncBuiltinESMExports 與指定 fs 的成員都擋，呼叫照常', async () => {
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  for (const [code, rule] of [
    ["import { syncBuiltinESMExports } from 'node:module';\nsyncBuiltinESMExports();", 'no-restricted-imports'],
    ["import fs from 'node:fs';\nfs.readdirSync = () => [];", 'no-restricted-syntax'],
    ["import * as path from 'node:path';\npath.join = () => '';", 'no-restricted-syntax'],
    ["import fs from 'node:fs';\nconsole.log(fs.readdirSync('.'));", null],
    ["import { createRequire } from 'node:module';\nconsole.log(createRequire);", null],
  ] as const) {
    const [result] = await lint.lintText(code, { filePath: 'tests/example.test.ts' });
    const rules = result.messages.map(message => message.ruleId);
    assert.deepEqual(rules, rule === null ? [] : [rule], code);
  }
});

void test('A7 src/state/ 只能透過 index.ts 使用，涵蓋 import、export、動態 import 與 require', async () => {
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  for (const [path, name, blocked] of [
    ['src/main.ts', './state/ids.ts', true],
    ['src/main.ts', './state/device.ts', true],
    ['src/obsidian/device.ts', '../state/device.ts', true],
    ['src/dev/compare.ts', '../state/ids.ts', true],
    ['tests/example.test.ts', '../src/state/device.ts', true],
    ['tools/example.mjs', '../src/state/ids.ts', true],
    ['src/main.ts', './state/index.ts', false],
    ['src/obsidian/device.ts', '../state/index.ts', false],
    ['tests/example.test.ts', '../src/state/index.ts', false],
    ['src/state/index.ts', './ids.ts', false],
    ['src/state/ids.ts', './device.ts', false],
  ] as const) for (const code of loadForms(name)) {
    const [result] = await lint.lintText(code, { filePath: path });
    assert.equal(result.messages.some(isBoundary), expected(path, code, blocked), path + ': ' + code);
  }
});

// W6 限制第 3 點：review 和 state 一樣純；ui 與 review 只透過 state 拿資料，不碰檔案存取、排程與寫紀錄的函式。
void test('W6 src/review/ 不能依賴畫面、Obsidian 或 Node；ui 與 review 不能 import 讀檔、排程、寫紀錄的函式', async () => {
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  for (const [path, code, blocked] of [
    ['src/review/index.ts', "import { useState } from 'react';", true],
    ['src/review/index.ts', "import { Notice } from 'obsidian';", true],
    ['src/review/index.ts', "import { animate } from 'motion';", true],
    ['src/review/index.ts', "import { readFile } from 'node:fs/promises';", true],
    ['src/review/index.ts', "void import('react-dom/client');", true],
    ['src/review/index.ts', "import type { Files } from '../core/files.ts';", true],
    ['src/review/index.ts', "import { planToday } from '../core/study/index.ts';", true],
    ['src/review/index.ts', "import { nextCard, progress } from '../core/study/index.ts';", true],
    ['src/review/index.ts', "import { readDecks } from '../core/deck/index.ts';", true],
    ['src/review/index.ts', "import { parseDeck } from '../core/deck/index.ts';", true],
    ['src/review/index.ts', "import { checkTyped, dayStart, dayOf } from '../core/study/index.ts';", false],
    ['src/review/index.ts', "import { baseForm } from '../core/deck/index.ts';", false],
    ['src/review/index.ts', "import type { Card, Pick } from '../core/study/index.ts';", false],
    ['src/review/index.ts', "import type { State } from '../state/index.ts';", false],
    ['src/review/index.ts', "import { x } from '../state/ids.ts';", true],
    // tasks/state-split.md §3：拆出來的讀取層與寫入一樣只能在 state 裡用。
    ['src/review/index.ts', "import { x } from '../state/reads.ts';", true],
    ['src/review/index.ts', "import { x } from '../state/writes.ts';", true],
    ['src/state/index.ts', "import { createReads } from './reads.ts';", false],
    ['src/ui/Review.tsx', "import type { Files } from '../core/files.ts';", true],
    ['src/ui/Review.tsx', "void import('../core/files.ts');", true],
    ['src/ui/Review.tsx', "import { appendLine, createLogWriter, mergeHistory, readHistory, replay, review } from '../core/study/index.ts';", true],
    ['src/ui/Review.tsx', "import { type Card, nextCard } from '../core/study/index.ts';", true],
    ['src/ui/Review.tsx', "import { checkTyped } from '../core/study/index.ts';", false],
    ['src/ui/Review.tsx', "import type { Prompt } from '../core/deck/index.ts';", false],
    ['src/ui/Review.tsx', "import { MarkdownRenderer } from 'obsidian';", false],
    ['src/ui/Review.tsx', "import { useState } from 'react';", false],
    ['src/ui/Review.tsx', "import { animate } from 'motion';", false],
    ['src/ui/Review.tsx', "import { createSession } from '../review/index.ts';", false],
    ['src/ui/nested/Card.tsx', "import { planToday } from '../../core/study/index.ts';", true],
    ['src/ui/nested/Card.tsx', "import '../../core/files.ts';", true],
    // 這些函式在其他地方照舊可以用。
    ['src/main.ts', "import { planToday } from './core/study/index.ts';", false],
    ['src/state/index.ts', "import { planToday } from '../core/study/index.ts';", false],
  ] as const) {
    const [result] = await lint.lintText(code, { filePath: path });
    assert.equal(result.messages.some(isBoundary), expected(path, code, blocked), path + ': ' + code);
  }
});

// D-148 第 3 點與技術債「D-148 的檢查會漏掉別的 require 寫法」：整個 src/ 禁用 Node 與 Electron，只有 src/desktop/ 能用明列的；
// require 的各種寫法都擋（開發命令 src/obsidian/dev*.ts 是放行清單，正式建置不含它們）；src/desktop/ 只能由 main.ts 動態載入；
// @codemirror 只有 src/obsidian/ 與 main.ts。
void test('D-148 Node 與 Electron 只在 src/desktop/，require 的各種寫法都擋，src/desktop/ 只能由 main.ts 動態載入', async () => {
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  const cases: [string, string, boolean][] = [
    ['src/ui/a.ts', "import { readFile } from 'node:fs/promises';", true],
    ['src/obsidian/a.ts', "import 'fs';", true],
    ['src/obsidian/a.ts', "void import('electron');", true],
    ['src/main.ts', "import { shell } from 'electron';", true],
    ['src/desktop/a.ts', "import { readFile } from 'node:fs/promises';", false],
    ['src/desktop/a.ts', "import { shell } from 'electron';", false],
    ['src/desktop/a.ts', "import { exec } from 'node:child_process';", true],
    ['src/desktop/a.ts', "import { readFile } from 'fs/promises';", true],
    ['src/obsidian/a.ts', "require('fs');", true],
    ['src/obsidian/a.ts', "const load = require; load('fs');", true],
    ['src/obsidian/a.ts', "(window as unknown as { require(name: string): unknown }).require('fs');", true],
    ['src/obsidian/a.ts', "(globalThis as Record<string, (name: string) => unknown>)['require']('fs');", true],
    ['src/obsidian/a.ts', "(globalThis as Record<string, (name: string) => unknown>)[`require`]('fs');", true],
    ['src/obsidian/a.ts', "declare const module: { require(name: string): unknown }; module.require('fs');", true],
    ['src/obsidian/a.ts', "require.call(null, 'fs');", true],
    // Codex L2 B5：解構取出載入器（識別字、字串、樣板字串、簡寫、解構賦值）與 Reflect.get 也擋。
    ['src/obsidian/a.ts', "const { require: load } = window as unknown as { require(name: string): unknown }; load('fs');", true],
    ['src/obsidian/a.ts', "const { 'require': load } = window as unknown as { require(name: string): unknown }; load('fs');", true],
    ['src/obsidian/a.ts', "const { [`require`]: load } = window as unknown as { require(name: string): unknown }; load('fs');", true],
    ['src/obsidian/a.ts', "const { require } = window as unknown as { require(name: string): unknown }; require('fs');", true],
    ['src/obsidian/a.ts', "let load: unknown; ({ require: load } = window as unknown as { require: unknown }); void load;", true],
    ['src/obsidian/a.ts', "const load = Reflect.get(window, 'require') as (name: string) => unknown; load('fs');", true],
    ['src/obsidian/a.ts', "type T = 'require'; const a: T[] = []; void a;", false],
    // Codex 再審 C2：普通的字串資料不是取出載入器，不擋。
    ['src/obsidian/a.ts', "export const text = 'require';", false],
    ['src/obsidian/a.ts', "export const labels = ['require'];", false],
    ['src/obsidian/a.ts', "export const text = `require`;", false],
    ['src/desktop/a.ts', "const fs = require('node:fs/promises');", true],
    ['src/obsidian/dev-x.ts', "const load = (window as unknown as { require?: (name: string) => unknown }).require;", false],
    ['src/obsidian/a.ts', "const o = { require: 1 }; type T = { require: () => void }; interface U { require(): void }", false],
    ['src/main.ts', "void import('./desktop/index.ts');", false],
    ['src/main.ts', "import { createDesktop } from './desktop/index.ts';", true],
    ['src/obsidian/a.ts', "void import('../desktop/index.ts');", true],
    ['src/obsidian/a.ts', "import { createDesktop } from '../desktop/index.ts';", true],
    ['src/obsidian/a.ts', "import type { Desktop } from '../desktop/index.ts';", false],
    ['src/desktop/a.ts', "import { x } from './io.ts';", false],
    ['src/ui/a.ts', "import { EditorState } from '@codemirror/state';", true],
    ['src/obsidian/a.ts', "import { EditorState } from '@codemirror/state';", false],
    ['tools/a.ts', "import { readFile } from 'node:fs/promises'; require('fs');", false],
  ];
  for (const [path, code, blocked] of cases) {
    const [result] = await lint.lintText(code, { filePath: path });
    assert.equal(result.messages.some(isBoundary), blocked, path + ': ' + code + ' ' + JSON.stringify(result.messages.map(message => message.message)));
  }
});

// tasks/error-log.md §2-4：產品程式的錯要交給錯誤紀錄（D-155 第 2 點）；只有先印 console 再交出錯誤的幾個檔、開發命令可以用 console。
void test('§2-4 src/ 開 no-console：新加的 console.log 報錯；main.ts、Markdown.tsx、開發命令放行；tools 與 tests 不管', async () => {
  const lint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });
  for (const [path, blocked] of [
    ['src/core/errors/log.ts', true],
    ['src/state/index.ts', true],
    ['src/ui/Review.tsx', true],
    ['src/ui/host.tsx', true],
    ['src/obsidian/save.ts', true],
    ['src/main.ts', false],
    ['src/ui/Markdown.tsx', false],
    ['src/obsidian/dev.ts', false],
    ['src/obsidian/dev-review.ts', false],
    ['src/dev/compare.ts', false],
    ['tools/example.ts', false],
    ['tests/example.test.ts', false],
  ] as const) {
    const [result] = await lint.lintText("console.log('x');\nconsole.error('y');", { filePath: path });
    const found = result.messages.filter(message => message.ruleId === 'no-console').length;
    assert.equal(found, blocked ? 2 : 0, path);
  }
});
