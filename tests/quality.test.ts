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
