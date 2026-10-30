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

// D-148：Node 與 Electron 只有電腦專用的資料夾能用，而且只能用明列的（同 tools/build.mjs 的 DESKTOP_ONLY，建置再查一次）。
const desktopOnly = ['electron', 'node:crypto', 'node:fs/promises', 'node:os', 'node:path'];
const isNodeOrElectron = name => name === 'electron' || name.startsWith('electron/') || name.startsWith('node:') || builtinModules.includes(name) || builtinModules.includes(name.split('/')[0]);
const desktopMessage = 'Node 與 Electron 只有 src/desktop/ 能用，而且只能用明列的模組（D-148）；畫面與其他模組透過 main.ts 交進來的動作使用。';
const desktopEntry = 'src/desktop/ 只能由 src/main.ts 在判斷是電腦之後動態 import（D-148，不經共用的重新匯出檔）；其他檔案只能 import type。';
const requireMessage = 'src/ 不能用 require（直接呼叫、取成別名、成員或字串索引存取都不行）：Node 與 Electron 在 src/desktop/ 用靜態 import（D-148）；開發命令用 src/obsidian/dev*.ts 的放行清單。';
// @codemirror 是 Obsidian 提供的編輯器（W5 §8-2）：只有 src/obsidian/ 與 main.ts 能用。
const codemirrorMessage = '@codemirror 只有 src/obsidian/ 與 src/main.ts 能用（用 Obsidian 提供的那一份）。';

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
    // D-148 的範圍是整個 src/：電腦專用的資料夾、可以碰 CodeMirror 的地方、開發命令的 require 放行清單（正式建置不含它們，tests/build.test.ts）。
    const inSrc = path.includes('/src/');
    const inDesktop = path.includes('/src/desktop/');
    const isMain = path.endsWith('/src/main.ts');
    const editorSide = isMain || path.includes('/src/obsidian/');
    const devRequire = /\/src\/obsidian\/dev(-[a-z]+)?\.ts$/.test(path);
    const toDesktop = name => {
      if (!name.startsWith('.')) return false;
      return posix.normalize(posix.join(posix.dirname(path), name)).includes('/src/desktop/');
    };
    /** Node／Electron、src/desktop/、@codemirror 的邊界；四種載入形式都經過這裡。dynamic：動態 import；typeOnly：只拿型別。 */
    function srcBoundary(name, { dynamic = false, typeOnly = false } = {}) {
      if (!inSrc || typeOnly) return undefined;
      if (isNodeOrElectron(name)) return inDesktop && desktopOnly.includes(name) ? undefined : desktopMessage;
      if (!inDesktop && toDesktop(name) && !(isMain && dynamic)) return desktopEntry;
      if (!editorSide && (name === '@codemirror' || name.startsWith('@codemirror/'))) return codemirrorMessage;
      return undefined;
    }
    function check(node, source, dynamic) {
      const literal = source?.type === 'TSLiteralType' ? source.literal : source;
      const name = literal?.value;
      const typeOnly = node.type === 'TSImportType';
      let message;
      if (typeof name !== 'string') message = '模組名稱必須是字串常值，才能檢查邊界。';
      else if ((inCore || inPure) && (name.startsWith('node:') || builtinModules.includes(name) || corePackages.some(pkg => name === pkg || name.startsWith(pkg + '/')))) message = inCore ? coreImports.message : pureImports.message;
      else if (!isFsrs && (name === 'ts-fsrs' || name.startsWith('ts-fsrs/'))) message = fsrs.message;
      else if (!inCore && privateCore.test(name)) message = coreEntry.message;
      else if (!inState && privateState.test(name)) message = stateEntry.message;
      else if (inView && filesEntry.test(name)) message = viewFiles.message;
      else if (inCore) message = crossModule(path, name, typeOnly);
      message ??= srcBoundary(name, { dynamic, typeOnly });
      if (message) context.report({ node, message });
    }
    function checkStatic(node, typeOnly) {
      if (!node.source) return;
      const message = (inCore ? crossModule(path, node.source.value, typeOnly) : undefined) ?? srcBoundary(node.source.value, { typeOnly });
      if (message) context.report({ node, message });
    }
    /**
     * 識別字 require 只是名稱，不是拿載入器來用：`.require` 成員（另由 MemberExpression 擋）、物件字面值與類別的屬性名、型別裡的成員名。
     * 解構（ObjectPattern）的屬性名不算名稱：`const { require: load } = window` 是取出載入器（Codex L2 B5）。
     */
    function onlyName(node) {
      const parent = node.parent;
      if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return true;
      if (parent.type === 'Property' && parent.key === node && parent.parent.type === 'ObjectExpression') return true;
      if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key === node) return true;
      return parent.type === 'TSPropertySignature' || parent.type === 'TSMethodSignature';
    }
    /**
     * 內容剛好是 'require' 的字串或樣板字串用來取出載入器的位置：計算的成員（`window['require']`）、解構的屬性名
     * （`{ 'require': load }`、`{ [`require`]: load }`）、`Reflect` 的引數（`Reflect.get(window, 'require')`）。其他地方是普通的
     * 字串資料，不擋（Codex 再審 C2）；先存進變數再取的寫法不在這道檢查的範圍。
     */
    function takesLoader(node) {
      const parent = node.parent;
      if (parent.type === 'MemberExpression' && parent.property === node && parent.computed) return true;
      if (parent.type === 'Property' && parent.key === node && parent.parent.type === 'ObjectPattern') return true;
      const callee = parent.type === 'CallExpression' && parent.arguments.includes(node) ? parent.callee : null;
      return callee?.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'Reflect';
    }
    const banRequire = inSrc && !devRequire;
    const report = node => { context.report({ node, message: requireMessage }); };
    return {
      ImportDeclaration(node) { checkStatic(node, node.importKind === 'type'); },
      ExportNamedDeclaration(node) { checkStatic(node, node.exportKind === 'type'); },
      ExportAllDeclaration(node) { checkStatic(node, node.exportKind === 'type'); },
      ImportExpression(node) { check(node, node.source, true); },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]);
      },
      TSImportType(node) { check(node, node.argument); },
      TSExternalModuleReference(node) { check(node, node.expression); },
      // 技術債「D-148 的檢查會漏掉別的 require 寫法」：require(…)、const load = require、window.require、module.require、
      // globalThis['require']、require.call、解構取出（識別字、字串、樣板字串、簡寫、解構賦值）、Reflect.get(window, 'require') 都擋：
      // 識別字 require 只要不是名稱就擋（Codex L2 B5）；內容剛好是 'require' 的字串只在取出載入器的位置擋（Codex 再審 C2）。
      Identifier(node) {
        if (banRequire && node.name === 'require' && !onlyName(node)) report(node);
      },
      Literal(node) {
        if (banRequire && node.value === 'require' && takesLoader(node)) report(node);
      },
      TemplateLiteral(node) {
        if (banRequire && node.expressions.length === 0 && node.quasis[0]?.value.cooked === 'require' && takesLoader(node)) report(node);
      },
      MemberExpression(node) {
        if (banRequire && !node.computed && node.property.type === 'Identifier' && node.property.name === 'require') report(node);
      },
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
        allowDefaultProject: ['tools/*.ts', 'tools/compare/*.ts', 'tests/*.ts', 'tests/helpers/*.ts'],
        // tools、tests 不在 tsconfig 的 include 裡，由這裡的預設專案涵蓋；超過上限時 lint 整個失敗（2026-10-29 加到 61 個）。
        maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 100,
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
