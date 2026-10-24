import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

void test('安裝 hook 時恢復 LF：Git Bash 可執行，缺相依擋程式 commit、文件 commit 直接通過', async t => {
  const root = await mkdtemp(join(tmpdir(), 'essence-hooks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = promisify(execFile);
  const shell = promisify(exec);
  // pre-commit 會匯出 GIT_DIR / GIT_INDEX_FILE 等；在另一個 repo 操作前必須清除。
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
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
  await run('git', commit, isolated);
});

for (const scenario of ['中文新增', '移出 src 的改名'] as const) void test('L2-3 hook 擋下缺相依的' + scenario, async t => {
  const root = await mkdtemp(join(tmpdir(), 'essence-hook-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
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

const loadForms = (name: string) => [
  "import '" + name + "';", "export * from '" + name + "';",
  "void import('" + name + "');", "require('" + name + "');",
];
const isBoundary = (message: { ruleId: string | null }) => message.ruleId === 'no-restricted-imports' || message.ruleId === 'essence/module-boundaries';
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
    assert.equal(result.messages.some(isBoundary), blocked, path + ': ' + code);
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
    assert.equal(result.messages.some(isBoundary), blocked, path + ': ' + code);
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
  ] as const) {
    const [result] = await lint.lintText(code, { filePath: path });
    assert.equal(result.messages.some(isBoundary), blocked, path + ': ' + code);
  }
});
