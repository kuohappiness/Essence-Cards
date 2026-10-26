import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../experiments/tools/decisions-index.mjs', import.meta.url));
const real = fileURLToPath(new URL('../docs/decisions.md', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');

// D-001 的狀態行提到 D-002、D-003，兩者都指到 D-004；D-003 提到比自己小的 D-001 不算；D-005 已取代 → D-004。
const fixture = [
  '# 決策紀錄',
  '',
  '## 索引',
  '',
  '| 決定 | 一句話 | 日期 | 狀態 |',
  '|---|---|---|---|',
  '',
  '---',
  '',
  '## D-001 甲',
  '',
  '✅ 2026-01-01｜補充見 D-002、D-003',
  '',
  '甲的內文。',
  '',
  '## D-002 乙',
  '',
  '✅ 2026-01-02｜後續見 D-004',
  '',
  '## D-003 丙',
  '',
  '✅ 2026-01-03｜見 D-004、D-001',
  '',
  '```markdown',
  '## D-099 程式碼區塊裡的不算',
  '```',
  '',
  '## D-004 丁',
  '',
  '✅ 2026-01-04',
  '',
  '## D-005 戊',
  '',
  '已取代 → [D-004](#d-004-丁)｜2026-01-05',
  '',
].join('\n');

async function fixtureFile(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'essence-decisions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'decisions.md');
  await writeFile(path, fixture);
  return { dir, path };
}

const headingsOf = (stdout: string) => stdout.split('\n').filter(line => line.startsWith('## D-')).map(line => line.slice(3, 8));

void test('查詢印出指定條目與狀態行明示的後續條目，遞迴、去重、照出現順序，不改檔', async t => {
  const { path } = await fixtureFile(t);
  const before = await hash(path);
  const one = run('--file', path, 'D-001');
  assert.equal(one.status, 0);
  assert.match(one.stdout, /^以下是原文與明示的後續條目，不等於完整的現行規則/);
  // D-099 那一行是 D-003 內文的程式碼區塊，跟著 D-003 印出，但不是一條決定。
  assert.deepEqual(headingsOf(one.stdout), ['D-001', 'D-002', 'D-003', 'D-099', 'D-004']);
  assert.match(one.stdout, /甲的內文。/);
  assert.equal(run('--file', path, 'D-099').status, 1);
  assert.deepEqual(headingsOf(run('--file', path, 'D-005').stdout), ['D-005', 'D-004']);
  assert.deepEqual(headingsOf(run('--file', path, 'd-4', 'D-002', 'D-004').stdout), ['D-004', 'D-002']);
  assert.equal(await hash(path), before);
});

void test('查詢未知的 D-ID 報到 stderr、exit code 1、什麼都不印', async t => {
  const { path } = await fixtureFile(t);
  const before = await hash(path);
  const result = run('--file', path, 'D-001', 'D-999');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /D-999/);
  assert.equal(await hash(path), before);
});

void test('查詢真正的決策紀錄前後逐位元組相同', async () => {
  const before = await hash(real);
  const result = run('D-099');
  assert.equal(result.status, 0);
  assert.deepEqual(headingsOf(result.stdout).slice(0, 1), ['D-099']);
  assert.equal(await hash(real), before);
});

void test('主題對照表和決策紀錄對不上時報錯且不寫檔', async t => {
  const { path } = await fixtureFile(t);
  const before = await hash(path);
  const result = run('--file', path);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /主題對照表有問題，未修改檔案/);
  assert.match(result.stderr, /D-006 不存在/);
  assert.equal(await hash(path), before);
});

void test('分組索引：真正的決策紀錄重跑兩次沒有差異，每條恰好一列、一句話與狀態都保留', async t => {
  const { dir } = await fixtureFile(t);
  const copy = join(dir, 'real.md');
  await copyFile(real, copy);
  const rowsOf = (text: string) => text.replace(/\r\n/g, '\n').split('\n').filter(line => line.startsWith('| [D-'));
  const original = rowsOf(await readFile(copy, 'utf8'));
  execFileSync(process.execPath, [script, '--file', copy], { stdio: 'pipe' });
  const once = await readFile(copy, 'utf8');
  execFileSync(process.execPath, [script, '--file', copy], { stdio: 'pipe' });
  assert.equal(await readFile(copy, 'utf8'), once);
  const rows = rowsOf(once);
  const ids = rows.map(row => /^\| \[(D-\d+) /.exec(row)?.[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...rows].sort(), [...original].sort());
  assert.match(once, /^## 索引\r?\n[\s\S]*?^### 產品與範圍\r?$/m);
});
