import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocs, formatProblem, DONE_ROWS, ROADMAP } from '../tools/check-docs.ts';

// pre-commit 會匯出 GIT_DIR / GIT_INDEX_FILE 等；在另一個 repo 操作前必須清除。
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];

const git = (root: string, ...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], { cwd: root, stdio: 'pipe' });

async function repo(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'essence-docs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  const put = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  const add = async (path: string, text: string) => {
    await put(path, text);
    git(root, 'add', '--', path);
  };
  const run = (staged = false) => checkDocs(root, { staged, exceptions: [] }).problems.map(formatProblem);
  return { root, put, add, run };
}

void test('一般連結、圖片、參照式連結、角括號與百分比編碼的路徑；找不到的報出檔案與行號', async t => {
  const { add, run } = await repo(t);
  await add('docs/有 空格.md', '# 標題\n');
  await add('docs/pic.png', '');
  await add('docs/a.md', [
    '# A',
    '',
    '見 [好的](<有 空格.md>)、[編碼](%E6%9C%89%20%E7%A9%BA%E6%A0%BC.md)、![圖](pic.png)、[參照][ok]。',
    '',
    '第二段的第一行',
    '接著 [壞的](<沒有 這個.md>)、![壞圖](missing.png)、[壞參照][bad]。',
    '',
    '[ok]: 有%20空格.md',
    '[bad]: ../nowhere.md',
    '',
  ].join('\n'));
  assert.deepEqual(run(), [
    'docs/a.md:5  沒有 這個.md  找不到檔案',
    'docs/a.md:5  missing.png  找不到檔案',
    'docs/a.md:5  ../nowhere.md  找不到檔案',
  ]);
});

void test('程式碼區塊與行內程式碼裡的連結不算；網址、mailto、obsidian 與 // 開頭的不查', async t => {
  const { add, run } = await repo(t);
  await add('a.md', [
    '# A',
    '',
    '```markdown',
    '[假的](missing.md)',
    '```',
    '',
    '    [縮排的假連結](missing.md)',
    '',
    '行內 `[假的](missing.md)` 不算；[網站](https://example.com/x.md)、[信](mailto:a@example.com)、[庫](obsidian://open?vault=x)、[協定相對](//example.com/x.md)。',
    '',
  ].join('\n'));
  assert.deepEqual(run(), []);
});

void test('錨點：中文標題、重複標題的 -1、行內程式碼與連結的標題文字、<a id>；連到非 .md 的不查錨點', async t => {
  const { add, run } = await repo(t);
  await add('b.md', [
    '# B',
    '',
    '## D-141 文件架構：入口只放狀態，同一類資訊只維護一份',
    '',
    '## 重複',
    '',
    '## 重複',
    '',
    '### 0-1 答案格拆開 ` | `（D-122）',
    '',
    '### 見 [連結文字](a.md) 一節',
    '',
    '<a id="自訂錨點"></a>',
    '',
    '段落裡的 <span id="行內錨點">x</span>。',
    '',
  ].join('\n'));
  await add('c.ts', '');
  await add('a.md', [
    '# A',
    '',
    '[1](b.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)、[2](b.md#重複)、[3](b.md#重複-1)、[4](b.md#0-1-答案格拆開-d-122)、[5](b.md#見-連結文字-一節)、[6](b.md#自訂錨點)、[7](b.md#行內錨點)、[8](c.ts#L3)、[9](#a)',
    '',
    '[壞1](b.md#重複-2)、[壞2](b.md#0-1-答案格拆開--d-122)、[壞3](#沒有)',
    '',
  ].join('\n'));
  assert.deepEqual(run(), [
    'a.md:5  b.md#重複-2  找不到錨點',
    'a.md:5  b.md#0-1-答案格拆開--d-122  找不到錨點',
    'a.md:5  #沒有  找不到錨點',
  ]);
});

void test('大小寫不符要報；連到資料夾時有檔案在底下就算存在；指到 repo 外要報', async t => {
  const { add, run } = await repo(t);
  await add('docs/plans/README.md', '# 計畫\n');
  await add('docs/a.md', '# A\n\n[大小寫](Plans/README.md)、[資料夾](plans/)、[資料夾2](plans)、[根](/docs/plans/README.md)、[外面](../../x.md)、[空資料夾](empty/)\n');
  assert.deepEqual(run(), [
    'docs/a.md:3  Plans/README.md  大小寫不符（實際是 docs/plans/README.md）',
    'docs/a.md:3  ../../x.md  指到 repo 外',
    'docs/a.md:3  empty/  找不到檔案',
  ]);
});

void test('--staged 讀暫存區：沒 stage 的檔案與修改不算，已 stage 的刪除算不存在', async t => {
  const { root, put, add, run } = await repo(t);
  await add('target.md', '# T\n');
  await add('gone.md', '# G\n');
  await add('a.md', '# A\n\n[t](target.md)、[g](gone.md)\n');
  assert.deepEqual(run(true), []);
  // 只在工作樹的新檔案：兩種模式都不算存在（不是 Git 追蹤的檔案）。
  await put('new.md', '# N\n');
  await add('b.md', '# B\n\n[n](new.md)\n');
  assert.deepEqual(run(true), ['b.md:3  new.md  找不到檔案']);
  assert.deepEqual(run(false), ['b.md:3  new.md  找不到檔案']);
  git(root, 'rm', '-q', '--cached', '--', 'b.md');
  // 部分 stage：工作樹有壞連結但沒 stage，暫存區照舊。
  await put('a.md', '# A\n\n[t](target.md)、[g](gone.md)、[壞](broken.md)\n');
  assert.deepEqual(run(true), []);
  assert.deepEqual(run(false), ['a.md:3  broken.md  找不到檔案']);
  git(root, 'add', '--', 'a.md');
  assert.deepEqual(run(true), ['a.md:3  broken.md  找不到檔案']);
  await add('a.md', '# A\n\n[t](target.md)、[g](gone.md)\n');
  // 已 stage 的刪除。
  git(root, 'rm', '-q', '-f', '--', 'gone.md');
  assert.deepEqual(run(true), ['a.md:3  gone.md  找不到檔案']);
  // 已 stage 的改名：舊路徑不存在，新路徑存在。
  git(root, 'mv', 'target.md', 'moved.md');
  assert.deepEqual(run(true), ['a.md:3  target.md  找不到檔案', 'a.md:3  gone.md  找不到檔案']);
});

const roadmap = (rows: string[]) => [
  '# 路線圖',
  '',
  '## 現在在哪裡',
  '',
  '## 已完成',
  '',
  '| 日期 | 工作 |',
  '|---|---|',
  ...rows.map(work => `| 2026-10-27 | ${work} |`),
  '',
].join('\n');

void test('已完成：10 列通過、11 列要報', async t => {
  const { add, run } = await repo(t);
  const rows = (n: number) => Array.from({ length: n }, (_, i) => `第 ${i + 1} 件`);
  await add(ROADMAP, roadmap(rows(DONE_ROWS)));
  assert.deepEqual(run(), []);
  await add(ROADMAP, roadmap(rows(DONE_ROWS + 1)));
  assert.deepEqual(run(), [`${ROADMAP}:19  ## 已完成  11 列，上限 10`]);
});

void test('tasks、討論稿與 docs/plans 第一層的檔案，標題下第一個非空行要有狀態；README、子資料夾與其他資料夾不查', async t => {
  const { add, run } = await repo(t);
  await add('tasks/ok.md', '# 任務\n\n狀態：進行中\n');
  await add('tasks/inline.md', '# 任務\n日期：2026-10-27｜整理者：Claude｜狀態：已結案 → D-141\n');
  await add('tasks/missing.md', '# 任務\n\n建議模型：Opus\n\n狀態：進行中\n');
  await add('tasks/no-title.md', '狀態：進行中\n');
  await add('Claude Codex Discussion/2026-10-27-x.md', '# 討論\n\n日期：2026-10-27\n');
  await add('docs/plans/x.md', '# 主題\n\n[第二階段清單](../../a.md)\n\n狀態：規畫中\n');
  await add('tasks/sub/deep.md', '# 不查\n');
  await add('docs/plans/sub/y.md', '# 不查\n');
  await add('docs/plans/README.md', '# 不查\n');
  await add('tasks/README.md', '# 不查\n');
  await add('docs/x.md', '# 不查\n');
  await add('a.md', '# A\n');
  assert.deepEqual(run(), [
    'Claude Codex Discussion/2026-10-27-x.md:3  狀態：  標題下第一個非空行沒有狀態',
    'docs/plans/x.md:3  狀態：  標題下第一個非空行沒有狀態',
    'tasks/missing.md:3  狀態：  標題下第一個非空行沒有狀態',
    'tasks/no-title.md:1  # 標題  沒有一級標題',
  ]);
});

void test('例外表只蓋掉逐項列出的連結；沒用到的例外要報', async t => {
  const { root, add } = await repo(t);
  await add('a.md', '# A\n\n[壞](missing.md)、[也壞](other.md)\n');
  const exceptions = [
    { file: 'a.md', target: 'missing.md', reason: '測試' },
    { file: 'a.md', target: 'unused.md', reason: '測試' },
  ];
  assert.deepEqual(checkDocs(root, { exceptions }).problems.map(formatProblem), [
    'a.md:3  other.md  找不到檔案',
    'a.md  unused.md  例外表的這一項沒有用到，請刪掉',
  ]);
});

void test('命令列：有問題時 exit code 1 並逐行列出，沒有時印摘要', async t => {
  const { root, add } = await repo(t);
  const script = fileURLToPath(new URL('../tools/check-docs.ts', import.meta.url));
  await add('a.md', '# A\n\n[b](b.md)、[網站](https://example.com)\n');
  await add('b.md', '# B\n');
  assert.equal(execFileSync(process.execPath, [script, '--root', root], { encoding: 'utf8', stdio: 'pipe' }).trim(), '文件檢查通過（工作樹）：2 個 Markdown 檔、1 個連結');
  await add('a.md', '# A\n\n[c](c.md)\n');
  assert.throws(
    () => execFileSync(process.execPath, [script, '--staged', '--root', root], { encoding: 'utf8', stdio: 'pipe' }),
    (error: { status: number; stderr: string }) => error.status === 1 && error.stderr.includes('a.md:3  c.md  找不到檔案'),
  );
});
