import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

const source = ['src/**/*.{ts,tsx}', 'tools/*.ts', 'tests/**/*.ts'];
const core = ['src/core/**/*.{ts,tsx}'];
const restricted = (patterns) => ['error', { patterns }];
const fsrs = { group: ['ts-fsrs', 'ts-fsrs/*'], message: 'ts-fsrs 只由 study/fsrs.ts 包裝。' };
const localDate = /^(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$|^to(Locale.*)?(Date|Time)?String$|^getYear$|^setYear$/;

export default tseslint.config(
  { ignores: ['node_modules/**', 'experiments/**', 'docs/**', 'main.js', '.claude/**', '.agents/**'] },
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
    files: ['src/**/*.{ts,tsx}', 'tools/*.{ts,mjs}', 'tests/**/*.ts'],
    ignores: ['src/core/study/fsrs.ts'],
    rules: { 'no-restricted-imports': restricted([fsrs]) },
  },
  {
    files: core,
    rules: {
      'no-restricted-imports': restricted([
        { group: ['obsidian', 'obsidian/*', 'react', 'react/*', 'react-dom', 'react-dom/*', 'motion', 'motion/*', 'node:*', ...builtinModules], message: '核心不能依賴畫面、Obsidian 或 Node。' },
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
    'no-restricted-imports': restricted([{ group: ['obsidian', 'obsidian/*', 'react', 'react/*', 'react-dom', 'react-dom/*', 'motion', 'motion/*', 'node:*', ...builtinModules], message: '核心不能依賴畫面、Obsidian 或 Node。' }]),
  } },
  {
    files: ['src/**/*.{ts,tsx}', 'tools/*.{ts,mjs}', 'tests/**/*.ts'],
    ignores: core,
    rules: { 'no-restricted-imports': restricted([
      fsrs,
      { regex: '(^|/)core/(?!files\\.ts$|[^/]+/index\\.ts$)', message: '核心只能透過 files.ts 或各模組的 index.ts 使用。' },
    ]) },
  },
);
