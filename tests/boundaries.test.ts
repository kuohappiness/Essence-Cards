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
// tasks/state-split.md §2：拆檔前後 state 對外的值不變。
void test('state 對外只透過 index 匯出 createState 與裝置碼', async () => {
  const module = await import('../src/state/index.ts');
  assert.deepEqual(Object.keys(module).sort(), ['createState', 'deviceCode', 'isDeviceCode']);
});
void test('deck 對外只透過指定 index 匯出', async () => {
  const module = await import('../src/core/deck/index.ts');
  assert.deepEqual(Object.keys(module).sort(), ['assignIds', 'baseForm', 'blockIds', 'isDeckPath', 'listDeckPaths', 'nameIds', 'parseDeck', 'readDecks', 'setTargetId', 'sourceLabel', 'sourceLinks', 'splitUnit', 'termRank']);
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

// readHistory、readDecks 給 tools/bench-study.ts 與測試用，產品程式走 state（技術債 A5、D-105）；parseTime 給備份清單的時間檢查（syntax §8）。
void test('study 只匯出任務指定的公開介面，不洩漏 ts-fsrs 的型別或類別', async () => {
  const module = await import('../src/core/study/index.ts');
  assert.deepEqual(Object.keys(module).sort(), ['LOG_FOLDER', 'appendLine', 'checkTyped', 'createLogWriter', 'dayOf', 'dayStart', 'dueAt', 'encodeEntry', 'findDuplicateIds', 'formatTime', 'intervalDays', 'isLogPath', 'logPath', 'memoryColors', 'mergeHistory', 'nextCard', 'parseLine', 'parseTime', 'planToday', 'progress', 'readHistory', 'recall', 'replay', 'review', 'scopeCount', 'todayLeft', 'typedKey', 'typedUnits'].sort());
});

// 範圍與目錄（tasks/entry-and-catalog.md §9-1）：deck、study 不 import catalog；catalog 從 study 只拿型別。
void test('deck、study 不 import catalog；catalog 從 study 只 import 型別', async () => {
  const root = new URL('../src/core/', import.meta.url);
  const specifiers = async (folder: string): Promise<{ path: string; name: string; typeOnly: boolean }[]> => {
    const found: { path: string; name: string; typeOnly: boolean }[] = [];
    for (const path of (await readdir(new URL(folder + '/', root))).filter(each => each.endsWith('.ts'))) {
      const source = ts.createSourceFile(path, await readFile(new URL(folder + '/' + path, root), 'utf8'), ts.ScriptTarget.Latest, true);
      source.forEachChild(node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const typeOnly = ts.isImportDeclaration(node) ? !!node.importClause?.isTypeOnly : node.isTypeOnly;
          found.push({ path, name: node.moduleSpecifier.text, typeOnly });
        }
      });
    }
    return found;
  };
  for (const folder of ['deck', 'study']) for (const { path, name } of await specifiers(folder)) assert.ok(!name.includes('catalog'), folder + '/' + path + ' 不能 import ' + name);
  const fromCatalog = await specifiers('catalog');
  assert.ok(fromCatalog.length > 0);
  for (const { path, name, typeOnly } of fromCatalog) if (name.includes('/study/')) assert.ok(typeOnly, 'catalog/' + path + ' 只能 import type');
});
