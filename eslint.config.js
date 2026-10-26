import { builtinModules } from 'node:module';
import { posix } from 'node:path';
import tseslint from 'typescript-eslint';

const source = ['src/**/*.{ts,tsx}', 'tools/*.ts', 'tests/**/*.ts'];
const core = ['src/core/**/*.{ts,tsx}'];
// state 與 dev 和核心一樣不碰畫面、Obsidian 與 Node，才能在 Node 直接測。
const pure = ['src/state/**/*.{ts,tsx}', 'src/dev/**/*.{ts,tsx}'];
const moduleFiles = ['src/**/*.{ts,tsx}', 'tools/**/*.{ts,mjs}', 'tests/**/*.{ts,tsx,mjs}'];
// @codemirror 是 Obsidian 提供的編輯器（W5 §8-2），和 obsidian 一樣只有 src/obsidian/ 與 main.ts 能用。
const corePackages = ['obsidian', 'react', 'react-dom', 'motion', '@codemirror'];
const coreImports = {
  group: [...corePackages.flatMap(name => [name, name + '/*']), 'node:*', ...builtinModules],
  message: '核心不能依賴畫面、Obsidian 或 Node。',
};
const pureImports = { ...coreImports, message: 'state 與 dev 不能依賴畫面、Obsidian 或 Node。' };
const coreEntry = { regex: '(^|/)core/(?!files\\.ts$|[^/]+/index\\.ts$)', message: '核心只能透過 files.ts 或各模組的 index.ts 使用。' };
const restricted = (patterns) => ['error', { patterns }];
const fsrs = { group: ['ts-fsrs', 'ts-fsrs/*'], message: 'ts-fsrs 只由 study/fsrs.ts 包裝。' };
const localDate = /^(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$|^to(Locale.*)?(Date|Time)?String$|^getYear$|^setYear$/;

// 核心不能 import src 裡核心以外的檔案。
// 核心的模組之間：src/core/<模組>/ 從別的模組只能 import 那個模組的 index.ts；deck 不能 import study；study 從 deck 只拿型別。
const coreModule = /\/src\/core\/([^/]+)\//;
function crossModule(path, name, typeOnly) {
  if (!name.startsWith('.')) return undefined;
  const target = posix.normalize(posix.join(posix.dirname(path), name));
  if (!target.includes('/src/core/')) return '核心不能 import src 裡核心以外的檔案。';
  const from = coreModule.exec(path)?.[1];
  if (!from) return undefined;
  const to = coreModule.exec(target)?.[1];
  if (!to || to === from) return undefined;
  if (from === 'deck' && to === 'study') return 'deck 不能 import study。';
  if (!target.endsWith('/src/core/' + to + '/index.ts')) return '核心的模組之間只能 import 對方的 index.ts。';
  if (from === 'study' && to === 'deck' && !typeOnly) return 'study 從 deck 只能 import 型別（import type）。';
  return undefined;
}

// no-restricted-imports 處理靜態 import/export；其餘載入形式套用相同三條邊界。核心模組之間的規則四種形式都在這裡。
const moduleBoundaries = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');
    const inCore = path.includes('/src/core/');
    const inPure = /\/src\/(state|dev)\//.test(path);
    const isFsrs = path.endsWith('/src/core/study/fsrs.ts');
    const privateCore = new RegExp(coreEntry.regex);
    function check(node, source) {
      const literal = source?.type === 'TSLiteralType' ? source.literal : source;
      const name = literal?.value;
      let message;
      if (typeof name !== 'string') message = '模組名稱必須是字串常值，才能檢查邊界。';
      else if ((inCore || inPure) && (name.startsWith('node:') || builtinModules.includes(name) || corePackages.some(pkg => name === pkg || name.startsWith(pkg + '/')))) message = inCore ? coreImports.message : pureImports.message;
      else if (!isFsrs && (name === 'ts-fsrs' || name.startsWith('ts-fsrs/'))) message = fsrs.message;
      else if (!inCore && privateCore.test(name)) message = coreEntry.message;
      else if (inCore) message = crossModule(path, name, node.type === 'TSImportType');
      if (message) context.report({ node, message });
    }
    function checkStatic(node, typeOnly) {
      const message = node.source && inCore ? crossModule(path, node.source.value, typeOnly) : undefined;
      if (message) context.report({ node, message });
    }
    return {
      ImportDeclaration(node) { checkStatic(node, node.importKind === 'type'); },
      ExportNamedDeclaration(node) { checkStatic(node, node.exportKind === 'type'); },
      ExportAllDeclaration(node) { checkStatic(node, node.exportKind === 'type'); },
      ImportExpression(node) { check(node, node.source); },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]);
      },
      TSImportType(node) { check(node, node.argument); },
      TSExternalModuleReference(node) { check(node, node.expression); },
    };
  },
};

export default tseslint.config(
  { ignores: ['node_modules/**', 'experiments/**', 'docs/**', 'main.js', '.claude/**', '.agents/**'] },
  {
    files: moduleFiles,
    languageOptions: { parser: tseslint.parser },
    plugins: { essence: { rules: { 'module-boundaries': moduleBoundaries } } },
    rules: { 'essence/module-boundaries': 'error' },
  },
  {
    files: source,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: {
      projectService: {
        allowDefaultProject: ['tools/*.ts', 'tests/*.ts', 'tests/helpers/*.ts'],
        maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 60,
      },
      tsconfigRootDir: import.meta.dirname,
    } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: moduleFiles,
    ignores: ['src/core/study/fsrs.ts'],
    rules: { 'no-restricted-imports': restricted([fsrs]) },
  },
  {
    files: core,
    rules: {
      'no-restricted-imports': restricted([
        coreImports,
        fsrs,
      ]),
      'no-restricted-syntax': ['error', {
        selector: `CallExpression[callee.type='MemberExpression'][callee.property.name=/${localDate.source}/]`,
        message: '核心的日期計算與格式化請用明確的 offset 與 UTC 方法。',
      }, {
        selector: `CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value=/${localDate.source}/]`,
        message: '核心的日期計算與格式化請用明確的 offset 與 UTC 方法。',
      }],
    },
  },
  { files: ['src/core/study/fsrs.ts'], rules: {
    'no-restricted-imports': restricted([coreImports]),
  } },
  {
    files: moduleFiles,
    ignores: core,
    rules: { 'no-restricted-imports': restricted([
      fsrs,
      coreEntry,
    ]) },
  },
  {
    files: pure,
    rules: { 'no-restricted-imports': restricted([pureImports, fsrs, coreEntry]) },
  },
);
