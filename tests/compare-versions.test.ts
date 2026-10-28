import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupVault } from '../tools/backup.ts';
import { snapshot } from '../tools/compare/adapter.ts';
import { diffSnapshots } from '../tools/compare/snapshot.ts';
import type { Snapshot } from '../tools/compare/snapshot.ts';
import { compareVersions } from '../tools/compare-versions.ts';
import { goal, makeVault, review, tempFolder } from './helpers/vault.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const time = (ms: number): string => new Date(ms).toISOString();
// 2026-10-29 20:00 +08:00
const NOW = Date.UTC(2026, 9, 29, 12);
const LOG = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
const files = {
  'Essence Cards/A.md': goal('aaa111') + goal('bbb222') + '- 還沒有 ID 的目標\n    - 題目 :: 答案\n',
  [LOG]: [review('2026-10-20T20:00:00.000+08:00', 'aaa111', 'good'), review('2026-10-25T20:00:00.000+08:00', 'bbb222', 'good')].join('\n') + '\n',
};

void test('比較資料：同一個版本比自己是零差異；轉接器照外掛的排法算到期、今天的份與 30 天', async () => {
  const snap = await snapshot(root, { now: NOW, offset: 480, files });
  assert.deepEqual(diffSnapshots(snap, snap, time), []);
  assert.deepEqual(snap.decks.map(deck => deck.targets.map(target => target.key)), [['aaa111', 'bbb222', '@4:還沒有 ID 的目標']]);
  assert.ok(snap.due.aaa111! > NOW || snap.today.some(item => item.lt === 'aaa111'));
  assert.equal(snap.days.length, 30);
  assert.equal(snap.days.reduce((sum, n) => sum + n, 0), 2);
  assert.deepEqual(snap.today.map(item => item.list), snap.today.map(() => 'share'));
});

const base = (): Snapshot => ({
  decks: [{ path: 'Essence Cards/A.md', props: { status: 'active', isTranscript: false, term: null, subject: null, unit: null, categories: [] },
    targets: [
      { key: 'aaa111', id: 'aaa111', name: 'A', line: 0, ok: true, fingerprints: ['11111111'], importance: 'medium', paused: false, direction: null },
      { key: 'bbb222', id: 'bbb222', name: 'B', line: 2, ok: true, fingerprints: ['22222222'], importance: 'medium', paused: false, direction: null },
    ], problems: [] }],
  due: { aaa111: Date.UTC(2026, 10, 1), bbb222: Date.UTC(2026, 10, 5) },
  today: [], days: [0, 0, 0, 1, 0, 0, 0, 1, ...Array.from({ length: 22 }, () => 0)],
});

void test('比較：兩個目標互換到期日時 30 天的總數相同，逐目標的比較抓得到', () => {
  const after = base();
  after.due = { aaa111: Date.UTC(2026, 10, 5), bbb222: Date.UTC(2026, 10, 1) };
  const lines = diffSnapshots(base(), after, time);
  assert.deepEqual(lines, [
    'aaa111 的下次到期：2026-11-01T00:00:00.000Z → 2026-11-05T00:00:00.000Z',
    'bbb222 的下次到期：2026-11-05T00:00:00.000Z → 2026-11-01T00:00:00.000Z']);
});

void test('比較：沒 ID 的目標多出或消失、題目指紋、問題與屬性的改變都抓得到', () => {
  const after = base();
  after.decks[0].targets.push({ key: '@4:新的', id: null, name: '新的', line: 4, ok: true, fingerprints: ['33333333'], importance: 'medium', paused: false, direction: null });
  after.decks[0].targets[0].fingerprints = ['44444444'];
  after.decks[0].problems = ['4 error missing-answer'];
  after.decks[0].props.status = 'paused';
  assert.deepEqual(diffSnapshots(base(), after, time), [
    'Essence Cards/A.md 的屬性 status："active" → "paused"',
    'Essence Cards/A.md 的 aaa111 的 fingerprints：["11111111"] → ["44444444"]',
    'Essence Cards/A.md 的學習目標多了：@4:新的（新的）',
    'Essence Cards/A.md 多了問題：4 error missing-answer']);
  assert.deepEqual(diffSnapshots(after, base(), time).filter(line => line.includes('@4')), ['Essence Cards/A.md 的學習目標不見了：@4:新的（新的）']);
});

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();

void test('發布前比較：開兩個 worktree 各跑轉接器；同一個 commit 是零差異，轉接器接不上是「無法比較」，報告寫在備份旁邊', async t => {
  const repo = await tempFolder(t, 'essence-repo-');
  await cp(join(root, 'src'), join(repo, 'src'), { recursive: true });
  for (const name of ['manifest.json', 'package.json']) await cp(join(root, name), join(repo, name));
  await writeFile(join(repo, '.gitignore'), 'node_modules\n');
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  const first = git(repo, 'rev-parse', 'HEAD');
  // 第二個 commit 拿掉 planToday：轉接器接不上。
  const index = join(repo, 'src/core/study/index.ts');
  await writeFile(index, (await readFile(index, 'utf8')).replace("export { planToday } from './plan.ts';\n", ''));
  git(repo, 'commit', '-q', '-am', 'break');
  const vault = await makeVault(t, files);
  const backup = (await backupVault({ vault, to: await tempFolder(t), by: 'backup', now: () => NOW, offset: () => 480 })).path;
  const install = (dir: string): Promise<void> => symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
  const same = await compareVersions({ backup, old: first, new: first, root: repo, install, now: () => NOW });
  assert.deepEqual([same.old.result.ok ? 'ok' : same.old.result.reason, same.comparable, same.differences], ['ok', true, []]);
  assert.match(same.old.build, /^0\.0\.1\+[0-9a-f]{7,}$/);
  const text = await readFile(same.report, 'utf8');
  assert.match(text, new RegExp('輸入的 SHA-256：' + same.zip));
  assert.match(text, /限制：考試範圍（`exam`）目前是 null/);
  assert.match(text, /沒有差異。/);
  const broken = await compareVersions({ backup, old: first, new: 'HEAD', root: repo, install, now: () => NOW + 1000 });
  assert.equal(broken.comparable, false);
  assert.deepEqual(broken.new.result, { ok: false, reason: '這個版本沒有 planToday' });
  assert.match(await readFile(broken.report, 'utf8'), /## 無法比較\n\n- 新版：這個版本沒有 planToday/);
  assert.equal(git(repo, 'worktree', 'list').split('\n').length, 1);
});
