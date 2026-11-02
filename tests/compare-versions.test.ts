import test from 'node:test';
import type { TestContext } from 'node:test';
import { gitEnv } from '../tools/git.ts';
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
  assert.ok((snap.due.aaa111 as number) > NOW || snap.today.some(item => item.lt === 'aaa111'));
  assert.equal(snap.days.length, 30);
  assert.equal(snap.days.reduce((sum, n) => sum + n, 0), 2);
  assert.deepEqual(snap.today.map(item => item.list), snap.today.map(() => 'share'));
});

const base = (): Snapshot => ({
  gates: { decks: [], held: [], incomplete: false, conflicts: [] },
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

void test('比較：同一個 key 出現好幾次（重複的 ID）時每一個都比，次數改變也抓得到，不會被蓋掉成零差異（Codex 第二輪 L2）', () => {
  const twice = (): Snapshot => {
    const snap = base();
    snap.decks[0].targets = [
      { key: 'abc234', id: 'abc234', name: 'First', line: 0, ok: true, fingerprints: ['84fee6d9'], importance: 'medium', paused: false, direction: null },
      { key: 'abc234', id: 'abc234', name: 'Second', line: 2, ok: true, fingerprints: ['b9987b45'], importance: 'medium', paused: false, direction: null },
    ];
    return snap;
  };
  const changed = twice();
  changed.decks[0].targets[0].fingerprints = ['ffffffff'];
  assert.deepEqual(diffSnapshots(twice(), changed, time), ['Essence Cards/A.md 的 abc234 第 1 個的 fingerprints：["84fee6d9"] → ["ffffffff"]']);
  const more = twice();
  more.decks[0].targets.push({ ...more.decks[0].targets[1], name: 'Third', line: 4 });
  assert.deepEqual(diffSnapshots(twice(), more, time), ['Essence Cards/A.md 的 abc234 出現次數：2 → 3']);
  const problems = base();
  problems.decks[0].problems = ['2 error duplicate-id', '2 error duplicate-id'];
  const fewer = base();
  fewer.decks[0].problems = ['2 error duplicate-id'];
  assert.deepEqual(diffSnapshots(problems, fewer, time), ['Essence Cards/A.md 少了問題：2 error duplicate-id']);
});

void test('比較：讀取閘門的改變都抓得到；一邊沒有重複 ID 的判斷時，另一邊找到的照樣報，不算沒有差異', () => {
  const conflict = { id: 'aaa111', targets: [{ path: 'Essence Cards/A.md', line: 0, name: 'A' }, { path: 'Essence Cards/B.md', line: 2, name: 'A2' }] };
  const shown = 'aaa111（Essence Cards/A.md 第 1 行「A」、Essence Cards/B.md 第 3 行「A2」）';
  const withGates = (gates: Partial<Snapshot['gates']>): Snapshot => ({ ...base(), gates: { ...base().gates, ...gates } });
  assert.deepEqual(diffSnapshots(withGates({ conflicts: null }), withGates({ conflicts: [] }), time), []);
  assert.deepEqual(diffSnapshots(withGates({ conflicts: null }), withGates({ conflicts: [conflict] }), time), ['重複的學習目標 ID（舊版沒有這個判斷）：' + shown]);
  assert.deepEqual(diffSnapshots(withGates({ conflicts: [conflict] }), withGates({ conflicts: null }), time), ['重複的學習目標 ID（新版沒有這個判斷）：' + shown]);
  assert.deepEqual(diffSnapshots(withGates({ conflicts: [] }), withGates({ conflicts: [conflict] }), time), ['重複的學習目標 ID 多了：' + shown]);
  assert.deepEqual(diffSnapshots(withGates({ conflicts: [conflict] }), withGates({ conflicts: [] }), time), ['重複的學習目標 ID 少了：' + shown]);
  const moved = { ...conflict, targets: [conflict.targets[0], { ...conflict.targets[1], line: 4 }] };
  assert.deepEqual(diffSnapshots(withGates({ conflicts: [conflict] }), withGates({ conflicts: [moved] }), time),
    [`重複的學習目標 ID 的目標：${shown} → aaa111（Essence Cards/A.md 第 1 行「A」、Essence Cards/B.md 第 5 行「A2」）`]);
  assert.deepEqual(diffSnapshots(withGates({ held: ['aaa111'] }), withGates({ held: ['bbb222'] }), time), ['紀錄行不再停掉：aaa111', '紀錄行停掉：bbb222']);
  assert.deepEqual(diffSnapshots(withGates({ incomplete: false }), withGates({ incomplete: true }), time), ['整份紀錄不完整：否 → 是']);
  const stopped = base();
  stopped.due.aaa111 = 'stopped';
  assert.deepEqual(diffSnapshots(base(), stopped, time), ['aaa111 的下次到期：2026-11-01T00:00:00.000Z → （停掉了）']);
  // 讀不懂的那一邊沒有內容可比：不報「卡組多了、不見了」，只報讀不讀得懂變了；兩邊都讀不懂就沒有差異。
  const gated = (): Snapshot => ({ ...base(), gates: { ...base().gates, decks: ['Essence Cards/A.md'] }, decks: [] });
  assert.deepEqual(diffSnapshots(gated(), base(), time), ['Essence Cards/A.md：需要新版才讀得懂 → 讀得懂']);
  assert.deepEqual(diffSnapshots(base(), gated(), time), ['Essence Cards/A.md：讀得懂 → 需要新版才讀得懂']);
  assert.deepEqual(diffSnapshots(gated(), gated(), time), []);
});

const env = gitEnv();
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'core.autocrlf=false', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
const linkModules = (dir: string): Promise<void> => symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');

/** 真正部署過的版本（tag）：clone 到暫存資料夾，不動這個 repo 的 worktree 清單。沒有 tag 時失敗，不跳過（CI 的 checkout 要 fetch-depth: 0）。 */
async function deployed(t: TestContext): Promise<string> {
  const dir = await tempFolder(t, 'essence-deployed-');
  git(root, 'clone', '-q', '--no-checkout', root, dir);
  git(dir, 'checkout', '-q', 'v0.2.0');
  await linkModules(dir);
  return dir;
}
/** 現在的程式改幾個字之後的複本：讀取能力不同、接不上的版本。 */
async function patched(t: TestContext, path: string, from: string, to: string): Promise<string> {
  const dir = await tempFolder(t, 'essence-patched-');
  await cp(join(root, 'src'), join(dir, 'src'), { recursive: true });
  for (const name of ['manifest.json', 'package.json']) await cp(join(root, name), join(dir, name));
  await linkModules(dir);
  const before = await readFile(join(dir, path), 'utf8');
  assert.ok(before.includes(from), from);
  await writeFile(join(dir, path), before.replace(from, to));
  return dir;
}

// 跨版本的固定輸入：重複的 ID（跨篇）、需要新版的卡組（別篇有同一個 ID）、紀錄行停掉的目標、沒作答過的新卡。
const A = 'Essence Cards/A.md', B = 'Essence Cards/B.md', C = 'Essence Cards/C.md';
const named = (id: string, name: string): string => `- ${name} ^${id}\n    - 題目 ${id} :: 答案 ${id}\n`;
const gatedFiles = {
  [A]: goal('aaa111') + named('dup111', '第一份') + goal('gat111') + goal('hld111') + goal('new111'),
  [B]: named('dup111', '第二份'),
  [C]: '---\n需要版本: 99.0.0\n---\n' + goal('gat111') + goal('gat222'),
  [LOG]: [review('2026-10-20T20:00:00.000+08:00', 'aaa111'), review('2026-10-20T20:01:00.000+08:00', 'dup111'), review('2026-10-20T20:02:00.000+08:00', 'gat111'), review('2026-10-20T20:03:00.000+08:00', 'hld111'),
    JSON.stringify({ t: '2026-10-21T20:00:00.000+08:00', lt: 'hld111', r: 'good', v: '12345678', need: '99.0.0' })].join('\n') + '\n',
};
const gatedInput = { now: NOW, offset: 480, files: gatedFiles };
const dupConflict = { id: 'dup111', targets: [{ path: A, line: 2, name: '第一份' }, { path: B, line: 0, name: '第二份' }] };
const days = (first: number): number[] => [first, ...Array.from({ length: 29 }, () => 0)];

void test('跨版本的固定輸入：v0.2.0 與現在各照自己的 state；被擋的卡組、停掉的目標都進比較資料，舊版沒有 D-157 的判斷、照它的規則出', async t => {
  const before = await snapshot(await deployed(t), gatedInput), after = await snapshot(root, gatedInput);
  assert.deepEqual(before.gates, { decks: [C], held: ['hld111'], incomplete: false, conflicts: null });
  assert.deepEqual(after.gates, { decks: [C], held: ['hld111'], incomplete: false, conflicts: [dupConflict] });
  // 需要新版的卡組內容不進比較資料；同一個 ID 在讀得懂的卡組裡、紀錄行停掉的目標，都不用舊紀錄算到期。
  for (const snap of [before, after]) assert.deepEqual(snap.decks.map(deck => deck.path), [A, B]);
  // 10/20 答對一次，7 天後的清晨 4 點（+08:00）到期。
  const DUE = Date.parse('2026-10-27T20:00:00.000Z');
  assert.deepEqual(before.due, { aaa111: DUE, dup111: DUE, gat111: 'stopped', hld111: 'stopped', new111: null });
  assert.deepEqual(after.due, { aaa111: DUE, dup111: 'stopped', gat111: 'stopped', hld111: 'stopped', new111: null });
  assert.deepEqual(before.today.map(item => item.lt), ['aaa111', 'dup111', 'new111']);
  assert.deepEqual(after.today.map(item => item.lt), ['aaa111', 'new111']);
  assert.deepEqual([before.days, after.days], [days(2), days(1)]);
  // 今天的份因此不同是預期的差異，不能報成零差異。
  assert.deepEqual(diffSnapshots(before, after, time), [
    '重複的學習目標 ID（舊版沒有這個判斷）：dup111（Essence Cards/A.md 第 3 行「第一份」、Essence Cards/B.md 第 1 行「第二份」）',
    'dup111 的下次到期：2026-10-27T20:00:00.000Z → （停掉了）',
    '今天的份的順序不同：aaa111、dup111、new111 → aaa111、new111',
    `未來 30 天每天的到期數：${days(2).join(' ')} → ${days(1).join(' ')}`,
  ]);
});

void test('跨版本的固定輸入：有一行辨認不出影響範圍時，兩版都是整份紀錄不完整，全部目標都停、今天沒有份', async t => {
  const input = { now: NOW, offset: 480, files: { [A]: goal('aaa111') + goal('new111'), [LOG]: [review('2026-10-20T20:00:00.000+08:00', 'aaa111'), JSON.stringify({ t: '2026-10-21T20:00:00.000+08:00', need: '99.0.0' })].join('\n') + '\n' } };
  for (const snap of [await snapshot(await deployed(t), input), await snapshot(root, input)]) {
    assert.equal(snap.gates.incomplete, true);
    assert.deepEqual(snap.due, { aaa111: 'stopped', new111: 'stopped' });
    assert.deepEqual([snap.today, snap.days], [[], days(0)]);
  }
});

void test('讀取能力看那一版自己的版號：同一份標記，新的讀得懂，舊的停；讀得懂之後才看得到的重複 ID 也算', async t => {
  const input = { now: NOW, offset: 480, files: {
    [A]: goal('aaa111') + goal('gat111'), [C]: '---\n需要版本: 5.0.0\n---\n' + goal('gat111') + goal('gat222'),
    [LOG]: JSON.stringify({ t: '2026-10-21T20:00:00.000+08:00', lt: 'aaa111', r: 'good', v: '12345678', need: '5.0.0' }) + '\n',
  } };
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as { version: string };
  assert.ok(Number(manifest.version.split('.')[0]) < 5, '這個測試的舊版要讀不懂 5.0.0');
  const newer = await patched(t, 'manifest.json', `"version": "${manifest.version}"`, '"version": "5.0.0"');
  const before = await snapshot(root, input), after = await snapshot(newer, input);
  assert.deepEqual(before.gates, { decks: [C], held: ['aaa111'], incomplete: false, conflicts: [] });
  assert.deepEqual(after.gates, { decks: [], held: [], incomplete: false, conflicts: [{ id: 'gat111', targets: [{ path: A, line: 2, name: '能說明 gat111' }, { path: C, line: 3, name: '能說明 gat111' }] }] });
  assert.deepEqual(before.due, { aaa111: 'stopped', gat111: 'stopped' });
  assert.deepEqual(Object.keys(after.due), ['aaa111', 'gat111', 'gat222']);
  assert.equal(after.due.gat111, 'stopped');
  assert.equal(typeof after.due.aaa111, 'number');
  const lines = diffSnapshots(before, after, time);
  assert.ok(lines.includes('紀錄行不再停掉：aaa111'), lines.join('\n'));
  assert.ok(lines.includes('Essence Cards/C.md：需要新版才讀得懂 → 讀得懂'), lines.join('\n'));
});

void test('接不上就丟錯（比較的一方寫無法比較）：版號不是正式版號、state 沒有閘門、沒有讀取能力的模組、比較時想寫版本行以外的內容', async t => {
  const input = { now: NOW, offset: 480, files };
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as { version: string };
  await assert.rejects(snapshot(await patched(t, 'manifest.json', `"version": "${manifest.version}"`, '"version": "abc"'), input), /版號不是正式版號/);
  await assert.rejects(snapshot(await patched(t, 'src/state/index.ts', 'blocked: () =>', 'renamed: () =>'), input), /這個版本沒有 blocked/);
  await assert.rejects(snapshot(await patched(t, 'src/state/index.ts', 'canAnswer: answerable', 'renamed: answerable'), input), /這個版本沒有 canAnswer/);
  await assert.rejects(snapshot(await patched(t, 'src/core/version/index.ts', 'export { canRead, releaseOf }', 'export { canRead }'), input), /releaseOf/);
  await assert.rejects(snapshot(await patched(t, 'src/state/index.ts', "record({ set: 'app', val: options.build });", "record({ set: 'cap', val: 5 }); record({ set: 'app', val: options.build });"), input), /想寫入.*"set":"cap"/);
});

void test('發布前比較：v0.2.0 到現在；報告列出兩邊的讀取閘門與重複的 ID，今天的份不同不是零差異', async t => {
  const clone = await deployed(t);
  const vault = await makeVault(t, gatedFiles);
  const backup = (await backupVault({ vault, to: await tempFolder(t), by: 'backup', now: () => NOW, offset: () => 480 })).path;
  const result = await compareVersions({ backup, old: 'v0.2.0', new: git(root, 'rev-parse', 'HEAD'), root: clone, install: linkModules, now: () => NOW });
  assert.equal(result.comparable, true);
  assert.ok(result.differences.length > 0);
  const text = await readFile(result.report, 'utf8');
  assert.match(text, /舊版：\n\n- 需要新版才讀得懂的卡組：Essence Cards\/C\.md\n- 讀不懂的紀錄行停掉的學習目標：hld111\n- 整份紀錄不完整（全部學習目標都停）：否\n- 重複的學習目標 ID（這些目標都停）：這一版沒有這個判斷\n/);
  assert.match(text, /新版：\n\n[^]*- 重複的學習目標 ID（這些目標都停）：dup111（Essence Cards\/A\.md 第 3 行「第一份」、Essence Cards\/B\.md 第 1 行「第二份」）\n/);
  assert.match(text, /## 差異（\d+ 項）/);
  assert.match(text, /今天的份的順序不同：aaa111、dup111、new111 → aaa111、new111/);
  assert.doesNotMatch(text, /沒有差異。/);
});

void test('發布前比較：開兩個 worktree 各跑轉接器；同一個 commit 是零差異，轉接器接不上是「無法比較」，報告寫在備份旁邊', async t => {
  const repo = await tempFolder(t, 'essence-repo-');
  await cp(join(root, 'src'), join(repo, 'src'), { recursive: true });
  for (const name of ['manifest.json', 'package.json']) await cp(join(root, name), join(repo, name));
  await writeFile(join(repo, '.gitignore'), 'node_modules\n');
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  const first = git(repo, 'rev-parse', 'HEAD');
  // 第二個 commit 拿掉 planToday：轉接器接不上。checkout 的換行可能是 LF 或 CRLF（Codex 第二輪 L5），兩種都要真的拿掉。
  const withoutPlanToday = (text: string): string => text.replace(/^export \{ planToday \} from '\.\/plan\.ts';\r?\n/m, '');
  for (const eol of ['\n', '\r\n']) {
    const sample = ['export { review } from \'./fsrs.ts\';', 'export { planToday } from \'./plan.ts\';', 'export { nextCard } from \'./session.ts\';', ''].join(eol);
    assert.equal(withoutPlanToday(sample), ['export { review } from \'./fsrs.ts\';', 'export { nextCard } from \'./session.ts\';', ''].join(eol), JSON.stringify(eol));
  }
  const index = join(repo, 'src/core/study/index.ts');
  const before = await readFile(index, 'utf8');
  assert.notEqual(withoutPlanToday(before), before);
  await writeFile(index, withoutPlanToday(before));
  git(repo, 'commit', '-q', '-am', 'break');
  const vault = await makeVault(t, files);
  const backup = (await backupVault({ vault, to: await tempFolder(t), by: 'backup', now: () => NOW, offset: () => 480 })).path;
  const install = (dir: string): Promise<void> => symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
  const same = await compareVersions({ backup, old: first, new: first, root: repo, install, now: () => NOW });
  assert.deepEqual([same.old.result.ok ? 'ok' : same.old.result.reason, same.comparable, same.differences], ['ok', true, []]);
  assert.match(same.old.build, /^0\.2\.0\+[0-9a-f]{7,}$/);
  const text = await readFile(same.report, 'utf8');
  assert.match(text, new RegExp('輸入的 SHA-256：' + same.zip));
  assert.match(text, /限制：考試範圍（`exam`）目前是 null/);
  assert.match(text, /沒有差異。/);
  assert.match(text, /## 讀取閘門\n\n舊版：\n\n- 需要新版才讀得懂的卡組：沒有\n/);
  const broken = await compareVersions({ backup, old: first, new: 'HEAD', root: repo, install, now: () => NOW + 1000 });
  assert.equal(broken.comparable, false);
  assert.equal(broken.new.result.ok, false);
  assert.match(await readFile(broken.report, 'utf8'), /## 無法比較\n\n- 新版：[^\n]*planToday/);
  // 那一版的 state 一直不回來（例如列不出來時一直重試）：跑到時間就是無法比較，不會一直等。
  await writeFile(index, before);
  const stateFile = join(repo, 'src/state/index.ts');
  const stateText = await readFile(stateFile, 'utf8');
  assert.ok(stateText.includes('    ready() {'));
  await writeFile(stateFile, stateText.replace('    ready() {', '    ready() { setInterval(() => {}, 1000); return new Promise(() => {});'));
  git(repo, 'commit', '-q', '-am', 'hang');
  const hung = await compareVersions({ backup, old: first, new: 'HEAD', root: repo, install, now: () => NOW + 2000, timeout: 2000 });
  assert.equal(hung.comparable, false);
  assert.match(hung.new.result.ok ? '' : hung.new.result.reason, /轉接器沒有跑完/);
  assert.equal(git(repo, 'worktree', 'list').split('\n').length, 1);
});
