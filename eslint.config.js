import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

const source = ['src/**/*.{ts,tsx}', 'tools/*.ts', 'tests/**/*.ts'];
const core = ['src/core/**/*.{ts,tsx}'];
const moduleFiles = ['src/**/*.{ts,tsx}', 'tools/**/*.{ts,mjs}', 'tests/**/*.{ts,tsx,mjs}'];
const corePackages = ['obsidian', 'react', 'react-dom', 'motion'];
const coreImports = {
  group: [...corePackages.flatMap(name => [name, name + '/*']), 'node:*', ...builtinModules],
  message: '核心不能依賴畫面、Obsidian 或 Node。',
};
const coreEntry = { regex: '(^|/)core/(?!files\\.ts$|[^/]+/index\\.ts$)', message: '核心只能透過 files.ts 或各模組的 index.ts 使用。' };
const restricted = (patterns) => ['error', { patterns }];
const fsrs = { group: ['ts-fsrs', 'ts-fsrs/*'], message: 'ts-fsrs 只由 study/fsrs.ts 包裝。' };
const localDate = /^(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$|^to(Locale.*)?(Date|Time)?String$|^getYear$|^setYear$/;

// no-restricted-imports 處理靜態 import/export；其餘載入形式套用相同三條邊界。
const moduleBoundaries = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');
    const inCore = path.includes('/src/core/');
    const isFsrs = path.endsWith('/src/core/study/fsrs.ts');
    const privateCore = new RegExp(coreEntry.regex);
    function check(node, source) {
      const literal = source?.type === 'TSLiteralType' ? source.literal : source;
      const name = literal?.value;
      let message;
      if (typeof name !== 'string') message = '模組名稱必須是字串常值，才能檢查邊界。';
      else if (inCore && (name.startsWith('node:') || builtinModules.includes(name) || corePackages.some(pkg => name === pkg || name.startsWith(pkg + '/')))) message = coreImports.message;
      else if (!isFsrs && (name === 'ts-fsrs' || name.startsWith('ts-fsrs/'))) message = fsrs.message;
      else if (!inCore && privateCore.test(name)) message = coreEntry.message;
      if (message) context.report({ node, message });
    }
    return {
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
        allowDefaultProject: ['tools/*.ts', 'tests/*.ts'],
        maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 30,
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
);
