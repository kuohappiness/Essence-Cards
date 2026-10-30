import { builtinModules } from 'node:module';
import { posix } from 'node:path';
import tseslint from 'typescript-eslint';

const source = ['src/**/*.{ts,tsx}', 'tools/*.ts', 'tools/compare/*.ts', 'tests/**/*.ts'];
const core = ['src/core/**/*.{ts,tsx}'];
// state、dev 與 review（複習畫面的狀態，W6 §2）和核心一樣不碰畫面、Obsidian 與 Node，才能在 Node 直接測。
const state = ['src/state/**/*.{ts,tsx}'];
const review = ['src/review/**/*.{ts,tsx}'];
const pure = [...state, 'src/dev/**/*.{ts,tsx}', ...review];
// 畫面（W6 §3）：React 元件、CSS、Obsidian 的渲染與朗讀。
const ui = ['src/ui/**/*.{ts,tsx}'];
const moduleFiles = ['src/**/*.{ts,tsx}', 'tools/**/*.{ts,mjs}', 'tests/**/*.{ts,tsx,mjs}'];
// @codemirror 是 Obsidian 提供的編輯器（W5 §8-2），和 obsidian 一樣只有 src/obsidian/ 與 main.ts 能用。
const corePackages = ['obsidian', 'react', 'react-dom', 'motion', '@codemirror'];
const coreImports = {
  group: [...corePackages.flatMap(name => [name, name + '/*']), 'node:*', ...builtinModules],
  message: '核心不能依賴畫面、Obsidian 或 Node。',
};
const pureImports = { ...coreImports, message: 'state、dev 與 review 不能依賴畫面、Obsidian 或 Node。' };
const coreEntry = { regex: '(^|/)core/(?!files\\.ts$|[^/]+/index\\.ts$)', message: '核心只能透過 files.ts 或各模組的 index.ts 使用。' };
// 技術債 A7：state 也只能透過 index.ts 使用（state 裡面互相 import 不受限）。
const stateEntry = { regex: '(^|/)state/(?!index\\.ts$)', message: 'state 只能透過 index.ts 使用。' };
// W6 限制第 3 點：畫面只透過 state 拿資料。ui 與 review 不能碰檔案存取，也不能從核心拿讀檔、排程、寫紀錄的函式；
// 型別與純計算（checkTyped、baseForm、dayStart、dayOf）可以。
const viewFiles = { regex: '(^|/)core/files\\.ts$', message: '畫面只透過 state 拿資料，不直接存取檔案。' };
const viewNames = {
  group: ['**/core/deck/index.ts', '**/core/study/index.ts'],
  importNames: ['readDecks', 'parseDeck', 'readHistory', 'mergeHistory', 'appendLine', 'createLogWriter', 'planToday', 'nextCard', 'progress', 'replay', 'review'],
  message: '畫面只透過 state 拿資料：讀檔、排程、寫紀錄的函式不能在 ui 與 review 用。',
};
// 測試不改全域的 Node 內建模組（第一個里程碑回顧的 R1）：Node 自己的實作也呼叫它們，換掉的結果隨 Node 版本改變。
const builtinPatch = {
  group: ['node:module', 'module'], importNames: ['syncBuiltinESMExports'],
  message: '測試不改全域的 Node 內建模組：把替身直接交給要測的函式（docs/agents/quality.md〈本專案的做法〉）。',
};
const builtinAssign = {
  selector: "AssignmentExpression > MemberExpression.left[object.name=/^(fs|fsPromises|path|os|childProcess|child_process)$/]",
  message: builtinPatch.message,
};
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
    const inPure = /\/src\/(state|dev|review)\//.test(path);
    const inState = path.includes('/src/state/');
    const inView = /\/src\/(ui|review)\//.test(path);
    const isFsrs = path.endsWith('/src/core/study/fsrs.ts');
    const privateCore = new RegExp(coreEntry.regex);
    const privateState = new RegExp(stateEntry.regex);
    const filesEntry = new RegExp(viewFiles.regex);
    function check(node, source) {
      const literal = source?.type === 'TSLiteralType' ? source.literal : source;
      const name = literal?.value;
      let message;
      if (typeof name !== 'string') message = '模組名稱必須是字串常值，才能檢查邊界。';
      else if ((inCore || inPure) && (name.startsWith('node:') || builtinModules.includes(name) || corePackages.some(pkg => name === pkg || name.startsWith(pkg + '/')))) message = inCore ? coreImports.message : pureImports.message;
      else if (!isFsrs && (name === 'ts-fsrs' || name.startsWith('ts-fsrs/'))) message = fsrs.message;
      else if (!inCore && privateCore.test(name)) message = coreEntry.message;
      else if (!inState && privateState.test(name)) message = stateEntry.message;
      else if (inView && filesEntry.test(name)) message = viewFiles.message;
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
    // tools、tests 也在 tsconfig 的 include 裡（外掛架構檢查環節 9 的 Q3），型別檢查與 lint 用同一個專案。
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
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
    ignores: [...core, ...state],
    rules: { 'no-restricted-imports': restricted([
      fsrs,
      coreEntry,
      stateEntry,
    ]) },
  },
  {
    files: ['tests/**/*.{ts,tsx,mjs}'],
    rules: {
      'no-restricted-imports': restricted([fsrs, coreEntry, stateEntry, builtinPatch]),
      'no-restricted-syntax': ['error', builtinAssign],
    },
  },
  {
    files: state,
    rules: { 'no-restricted-imports': restricted([pureImports, fsrs, coreEntry]) },
  },
  {
    files: pure,
    ignores: [...state, ...review],
    rules: { 'no-restricted-imports': restricted([pureImports, fsrs, coreEntry, stateEntry]) },
  },
  {
    files: review,
    rules: { 'no-restricted-imports': restricted([pureImports, fsrs, coreEntry, stateEntry, viewFiles, viewNames]) },
  },
  {
    files: ui,
    rules: { 'no-restricted-imports': restricted([fsrs, coreEntry, stateEntry, viewFiles, viewNames]) },
  },
);
