import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

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
