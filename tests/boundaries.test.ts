import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import ts from 'typescript';

void test('core 的靜態 import/export、動態 import 與 require 都不能指向 Obsidian 或 Node', async () => {
  const root = new URL('../src/core/', import.meta.url);
  const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
  const paths = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.ts'));
  assert.ok(paths.length > 0);
  for (const path of paths) {
    const source = ts.createSourceFile(path, await readFile(new URL(path.replaceAll('\\', '/'), root), 'utf8'), ts.ScriptTarget.Latest, true);
    function check(node: ts.Node): void {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), path + ': 不使用動態計算的模組名稱');
        specifier = node.arguments[0];
      }
      if (specifier && ts.isStringLiteral(specifier)) {
        const name = specifier.text;
        assert.ok(name !== 'obsidian' && !name.startsWith('obsidian/') && !name.startsWith('node:') && !builtins.has(name), path + ': 禁止 ' + name);
      }
      ts.forEachChild(node, check);
    }
    check(source);
  }
});
void test('deck 對外只透過指定 index 匯出', async () => {
  const module = await import('../src/core/deck/index.ts');
  assert.deepEqual(Object.keys(module).sort(), ['assignIds', 'blockIds', 'isDeckPath', 'nameIds', 'parseDeck', 'readDecks', 'setTargetId']);
});

void test('src 裡只有 study/fsrs.ts 能 import、export、動態 import 或 require ts-fsrs', async () => {
  const root = new URL('../src/', import.meta.url);
  const paths = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.ts'));
  for (const raw of paths) {
    const path = raw.replaceAll('\\', '/');
    const source = ts.createSourceFile(path, await readFile(new URL(path, root), 'utf8'), ts.ScriptTarget.Latest, true);
    function check(node: ts.Node): void {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), path + ': 不使用動態計算的模組名稱');
        specifier = node.arguments[0];
      }
      if (specifier && ts.isStringLiteral(specifier) && (specifier.text === 'ts-fsrs' || specifier.text.startsWith('ts-fsrs/'))) assert.equal(path, 'core/study/fsrs.ts');
      ts.forEachChild(node, check);
    }
    check(source);
  }
});

void test('study 只匯出任務指定的公開介面，不洩漏 ts-fsrs 的型別或類別', async () => {
  const module = await import('../src/core/study/index.ts');
  assert.deepEqual(Object.keys(module).sort(), ['LOG_FOLDER', 'appendLine', 'checkTyped', 'createLogWriter', 'dayOf', 'dayStart', 'dueAt', 'encodeEntry', 'formatTime', 'intervalDays', 'isLogPath', 'logPath', 'mergeHistory', 'nextCard', 'parseLine', 'planToday', 'progress', 'readHistory', 'recall', 'replay', 'review'].sort());
});
