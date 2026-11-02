import test from 'node:test';
import type { TestContext } from 'node:test';
import { gitEnv } from '../tools/git.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupVault } from '../tools/backup.ts';
import { snapshot } from '../tools/compare/adapter.ts';
import type { AdapterInput } from '../tools/compare/adapter.ts';
import { diffSnapshots } from '../tools/compare/snapshot.ts';
import type { AdapterResult, Snapshot, TodaySnap } from '../tools/compare/snapshot.ts';
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
  after.decks[0].problems = [{ line: 4, level: 'error', code: 'missing-answer' }];
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
  const duplicate = { line: 2, level: 'error', code: 'duplicate-id' };
  const problems = base();
  problems.decks[0].problems = [duplicate, duplicate];
  const fewer = base();
  fewer.decks[0].problems = [duplicate];
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

void test('比較：今天的份順序不同一定報，ID 裡有分隔符也一樣；從 share 搬到 more 也算（Codex 第五次審查 F6）', () => {
  const today = (...items: [TodaySnap['list'], string][]): Snapshot => ({ ...base(), today: items.map(([list, lt]) =>
    ({ list, lt, deck: 'Essence Cards/A.md', lane: 'due', retention: 0.8, prompt: null, direction: null })) });
  assert.deepEqual(diffSnapshots(today(['share', 'a'], ['share', 'a,share:a']), today(['share', 'a,share:a'], ['share', 'a']), time), ['今天的份的順序不同：a、a,share:a → a,share:a、a']);
  assert.deepEqual(diffSnapshots(today(['share', 'a'], ['share', 'b']), today(['share', 'a'], ['share', 'b']), time), []);
  assert.deepEqual(diffSnapshots(today(['share', 'a']), today(['more', 'a']), time), ['今天的份的順序不同：a → a', '今天的份裡 a 的 list："share" → "more"']);
});

void test('比較：單元與問題的切法不同就是不同，接起來的字串一樣也要報', () => {
  const withUnit = (code: string, name: string): Snapshot => {
    const snap = base();
    snap.decks[0].props.unit = { code, name };
    return snap;
  };
  assert.deepEqual(diffSnapshots(withUnit('L1', 'Back to School'), withUnit('L1 Back', 'to School'), time),
    ['Essence Cards/A.md 的屬性 unit：{"code":"L1","name":"Back to School"} → {"code":"L1 Back","name":"to School"}']);
  const withProblem = (level: string, code: string): Snapshot => {
    const snap = base();
    snap.decks[0].problems = [{ line: 1, level, code }];
    return snap;
  };
  assert.deepEqual(diffSnapshots(withProblem('a b', 'c'), withProblem('a', 'b c'), time), ['Essence Cards/A.md 少了問題：1 a b c', 'Essence Cards/A.md 多了問題：1 a b c']);
});

void test('比較：ID 剛好是每個物件都有的名稱時還是一個 ID，只在一邊也報得出來', async () => {
  // 語法接受英數字與連字號，寫得出 constructor；底線寫不出來，__proto__ 是下面的假版本才會回傳。
  const named = await snapshot(root, { now: NOW, offset: 480, files: { [A]: '- 目標 ^constructor\n    - 題目 :: 答案\n' } });
  assert.deepEqual(named.due, JSON.parse('{"constructor":null}'));
  for (const id of ['constructor', 'toString', '__proto__']) {
    const after = base();
    after.due = { ...after.due, ...JSON.parse(`{"${id}":null}`) as Snapshot['due'] };
    assert.deepEqual(diffSnapshots(base(), after, time), [`${id} 的下次到期：（沒有這個目標） → （新卡）`]);
    assert.deepEqual(diffSnapshots(after, base(), time), [`${id} 的下次到期：（新卡） → （沒有這個目標）`]);
  }
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
async function patched(t: TestContext, path: string, ...pairs: string[]): Promise<string> {
  const dir = await tempFolder(t, 'essence-patched-');
  await cp(join(root, 'src'), join(dir, 'src'), { recursive: true });
  for (const name of ['manifest.json', 'package.json']) await cp(join(root, name), join(dir, name));
  await linkModules(dir);
  let text = await readFile(join(dir, path), 'utf8');
  for (let i = 0; i < pairs.length; i += 2) {
    assert.ok(text.includes(pairs[i]), pairs[i]);
    text = text.replace(pairs[i], pairs[i + 1]);
  }
  await writeFile(join(dir, path), text);
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
  for (const snap of [before, after]) assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
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

void test('回傳的型別不同也是接不上，不能靠真假值往下算：canAnswer 回傳 Promise 時，停掉的目標不能變成新卡（Codex L2 F1）', async t => {
  // aaa111 被紀錄行停掉；bbb222 作答過，算到期、也在今天的份裡；new111 是新卡。
  const reviewed = review('2026-10-20T20:00:00.000+08:00', 'bbb222');
  const held = JSON.stringify({ t: '2026-10-29T19:00:00.000+08:00', lt: 'aaa111', need: '99.0.0' });
  const gatedDeck = '---\n需要版本: 99.0.0\n---\n' + goal('gat111');
  const input = { now: NOW, offset: 480, files: { [A]: goal('aaa111') + goal('bbb222') + goal('new111'), [C]: gatedDeck, [LOG]: reviewed + '\n' + held + '\n' } };
  // 現在的版本：false 是停掉，true 照紀錄算。
  const snap = await snapshot(root, input);
  assert.deepEqual(snap.gates, { decks: [C], held: ['aaa111'], incomplete: false, conflicts: [] });
  assert.deepEqual(snap.due, { aaa111: 'stopped', bbb222: Date.parse('2026-10-27T20:00:00.000Z'), new111: null });
  assert.deepEqual(snap.today.map(item => item.lt), ['bbb222', 'new111']);
  // 今天已經答對：還在今天的份裡，只是沒有要出的題（nextCard 是 done），不是接不上。
  const answered = await snapshot(root, { ...input, files: { ...input.files, [LOG]: [reviewed, review('2026-10-29T19:30:00.000+08:00', 'bbb222'), held].join('\n') + '\n' } });
  assert.deepEqual(answered.today.map(item => [item.lt, item.prompt === null]), [['bbb222', true], ['new111', false]]);
  const study = 'src/core/study/index.ts', state = 'src/state/index.ts';
  const table: [string, string, string, RegExp][] = [
    [state, 'canAnswer: answerable', 'canAnswer: (lt: string) => Promise.resolve(answerable(lt))', /canAnswer.*型別不同/],
    [state, 'canAnswer: answerable', 'canAnswer: () => undefined', /canAnswer.*型別不同/],
    [state, 'unread: () => [...unread].sort()', 'unread: () => Promise.resolve([...unread].sort())', /unread.*型別不同/],
    [state, 'all: history.incomplete', 'whole: history.incomplete', /blocked.*all.*型別不同/],
    [study, "export { review, replay, intervalDays, dueAt, recall } from './fsrs.ts';", "export { review, replay, intervalDays, recall } from './fsrs.ts';\nexport const dueAt = () => NaN;", /dueAt.*型別不同/],
    [study, "export { formatTime, dayOf, dayStart, parseTime } from './time.ts';", "export { formatTime, dayStart, parseTime } from './time.ts';\nexport const dayOf = () => Promise.resolve(0);", /dayOf.*型別不同/],
    [study, "export { formatTime, dayOf, dayStart, parseTime } from './time.ts';", "export { formatTime, dayStart, parseTime } from './time.ts';\nexport const dayOf = () => 1.5;", /dayOf.*型別不同/],
    [study, "export { nextCard, progress, checkTyped, typedKey, typedUnits } from './session.ts';", "export { progress, checkTyped, typedKey, typedUnits } from './session.ts';\nexport const nextCard = () => Promise.resolve({ kind: 'card' });", /nextCard.*型別不同/],
    [study, "export { nextCard, progress, checkTyped, typedKey, typedUnits } from './session.ts';", "export { progress, checkTyped, typedKey, typedUnits } from './session.ts';\nexport const nextCard = () => ({ kind: 'stale' });", /nextCard.*型別不同/],
    ['src/core/study/plan.ts', 'retention: c.retention', 'retention: undefined', /retention.*型別不同/],
    ['src/core/study/plan.ts', 'return { day, offset, share, more, slots };', 'return { day, offset, share, more, slots: new Map() };', /slots.*型別不同/],
    ['src/core/version/index.ts', "export { canRead, releaseOf } from './release.ts';", "export { canRead } from './release.ts';\nexport const releaseOf = () => Promise.resolve('1.0.0');", /讀取能力不明/],
  ];
  for (const [path, from, to, expected] of table) await assert.rejects(snapshot(await patched(t, path, from, to), input), expected, to);

  // 集合：字串也能展開、走訪，空字串就成了空清單。比較的是一個完全沒有內容的輸入時也要拒絕，否則接不上的版本會報成零差異（Codex 再審 F2）。
  const empty = { ...input, files: {} };
  assert.deepEqual((await snapshot(root, empty)).gates, { decks: [], held: [], incomplete: false, conflicts: [] });
  const gates = 'blocked: () => ({ decks: gated, targets: history.held, all: history.incomplete })', todayOf = 'today: () => fresh().today,';
  const collections: [string, string, string, RegExp][] = [
    [state, gates, "blocked: () => ({ decks: gated.join(''), targets: history.held, all: history.incomplete })", /blocked\(\)\.decks.*型別不同/],
    [state, gates, "blocked: () => ({ decks: gated, targets: history.held.join(''), all: history.incomplete })", /blocked\(\)\.targets.*型別不同/],
    [state, 'unread: () => [...unread].sort()', "unread: () => ''", /unread.*型別不同/],
    [state, 'history: () => history,', "history: () => ({ ...history, reviews: '' }),", /reviews.*型別不同/],
    [state, todayOf, "today: () => ({ ...fresh().today, share: '' }),", /share.*型別不同/],
    [state, todayOf, "today: () => ({ ...fresh().today, more: '' }),", /more.*型別不同/],
    [state, todayOf, 'today: () => ({ ...fresh().today, slots: {} }),', /slots.*型別不同/],
    [state, todayOf, 'input: () => Promise.resolve(input()), today: () => fresh().today,', /retention/],
    [state, todayOf, 'input: () => ({ ...input(), settings: {} }), today: () => fresh().today,', /retention.*型別不同/],
    [study, "export { review, replay, intervalDays, dueAt, recall } from './fsrs.ts';", "export { review, intervalDays, dueAt, recall } from './fsrs.ts';\nexport const replay = () => Promise.resolve(new Map());", /replay.*型別不同/],
  ];
  for (const [path, from, to, expected] of collections) {
    const dir = await patched(t, path, from, to);
    for (const each of [input, empty]) await assert.rejects(snapshot(dir, each), expected, to);
  }
  // 清單裡的路徑與 ID 也要是字串。
  for (const [to, expected] of [
    ['blocked: () => ({ decks: gated.map(() => 5), targets: history.held, all: history.incomplete })', /blocked\(\)\.decks.*型別不同/],
    ['blocked: () => ({ decks: gated, targets: history.held.map(() => 5), all: history.incomplete })', /blocked\(\)\.targets.*型別不同/],
  ] as const) await assert.rejects(snapshot(await patched(t, state, gates, to), input), expected, to);
});

void test('送給比較端的每個值都要符合比較資料的形狀：換了型別就是接不上，比 JSON 抓不到（Codex 第三次審查 F3）', async t => {
  // 屬性都有值、有題目與問題、有英翻中方向、有暫停與沒有 ID 的目標：真正的舊版與現在都要接得上，經過 JSON 不變。
  const full = { now: NOW, offset: 480, files: {
    [A]: '---\n年級學期: 國二上\n科目: 英文\n單元: L1 Back to School\n分類:\n  - 單字\n狀態: 啟用\n---\n\n- borrow 英翻中 ^b4rw7k\n    - borrow :: v. 借入\n        - 例句：Can I borrow your pen?\n    - 重要性：高\n- uniform 英翻中 ^u6vf2m\n    - uniform :: n. 制服\n    - 狀態：暫停\n- 寫錯的目標 ^k3m9x2\n    - 題目 ::\n- 還沒有 ID 的目標\n    - 題目 :: 答案\n',
    [LOG]: review('2026-10-20T20:00:00.000+08:00', 'b4rw7k') + '\n',
  } };
  const props = { status: 'active', isTranscript: false, term: '國二上', subject: '英文', unit: { code: 'L1', name: 'Back to School' }, categories: ['單字'] };
  for (const dir of [await deployed(t), root]) {
    const snap = await snapshot(dir, full);
    assert.deepEqual(snap.decks[0].props, props);
    assert.deepEqual(snap.decks[0].targets.map(target => [target.key, target.ok, target.direction, target.paused, target.importance]), [
      ['b4rw7k', true, 'en-zh', false, 'high'], ['u6vf2m', true, 'en-zh', true, 'medium'], ['k3m9x2', false, null, false, 'medium'], ['@18:還沒有 ID 的目標', true, null, false, 'medium']]);
    assert.deepEqual(snap.decks[0].problems, [{ line: 17, level: 'error', code: 'missing-answer' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  }

  // 現在的程式，decks、today、conflicts 回傳前先過測試給的函式，不用每一種改法都複製一次。
  type Change = (value: never) => unknown;
  const hooks = globalThis as unknown as { broken: Record<'decks' | 'today' | 'conflicts', Change> };
  const same: Change = (value: never) => value;
  const reset = (): void => { hooks.broken = { decks: same, today: same, conflicts: same }; };
  t.after(() => { delete (globalThis as { broken?: unknown }).broken; });
  const dir = await patched(t, 'src/state/index.ts',
    'decks: () => deckList,', 'decks: () => globalThis.broken.decks(deckList),',
    'today: () => fresh().today,', 'today: () => globalThis.broken.today(fresh().today),',
    'conflicts: () => life.loaded ? tracker.duplicates() : [],', 'conflicts: () => globalThis.broken.conflicts(life.loaded ? tracker.duplicates() : []),');
  reset();
  assert.deepEqual(await snapshot(dir, full), await snapshot(root, full));

  interface Entry { deck: { props: object; targets: { prompts: object[] }[]; problems: object[] } }
  interface Slot { target: { prompts: object[] } }
  interface Today { share: object[]; slots: Map<string, Slot> }
  const deckField = (change: object): Change => ((list: Entry[]) => list.map(entry => ({ ...entry, deck: { ...entry.deck, ...change } })));
  const prop = (change: object): Change => ((list: Entry[]) => list.map(entry => ({ ...entry, deck: { ...entry.deck, props: { ...entry.deck.props, ...change } } })));
  const target = (change: object): Change => ((list: Entry[]) => list.map(entry => ({ ...entry, deck: { ...entry.deck, targets: entry.deck.targets.map(each => ({ ...each, ...change })) } })));
  const item = (change: object): Change => ((today: Today) => ({ ...today, share: today.share.map(each => ({ ...each, ...change })) }));
  const slotTarget = (change: (slot: Slot) => object): Change => ((today: Today) => ({ ...today, slots: new Map([...today.slots].map(([id, slot]) => [id, { ...slot, target: { ...slot.target, ...change(slot) } }])) }));
  const conflict = (value: unknown): Change => (() => value);
  const wrong = new Uint8Array();
  const hole = new Array(1);
  const anyInput: [keyof typeof hooks.broken, Change, RegExp][] = [
    ['decks', conflict(wrong), /decks\(\).*型別不同/],
    ['conflicts', conflict(wrong), /conflicts\(\).*型別不同/],
    ['conflicts', conflict(null), /conflicts\(\).*型別不同/],
    // 空洞會被 `some` 和 `map` 跳過：完全沒有內容時也要拒絕（Codex 第四次審查 F5）。
    ['decks', conflict(hole), /decks\(\).*型別不同/],
    ['conflicts', conflict(hole), /conflicts\(\).*型別不同/],
    ['conflicts', conflict([{ id: 'x', targets: hole }]), /conflicts\(\).*targets.*型別不同/],
    ['conflicts', conflict([{ id: 'x', targets: [] }, { id: 'x', targets: [] }]), /conflicts\(\).*重複/],
  ];
  const withContent: [keyof typeof hooks.broken, Change, RegExp][] = [
    // 比較端拿路徑與學習目標當 key，重複時只比得到最後一個，其他的不同也是零差異。
    ['decks', ((list: Entry[]) => [...list, ...list]), /decks\(\).*重複/],
    ['today', ((today: Today) => ({ ...today, share: [...today.share, ...today.share] })), /today\(\).*重複/],
    ['decks', ((list: Entry[]) => list.map(entry => ({ ...entry, path: 5 }))), /path.*型別不同/],
    ['decks', prop({ status: undefined }), /status.*型別不同/],
    ['decks', prop({ isTranscript: 'no' }), /isTranscript.*型別不同/],
    ['decks', prop({ term: NaN }), /term.*型別不同/],
    ['decks', prop({ subject: NaN }), /subject.*型別不同/],
    ['decks', prop({ unit: 'L1' }), /unit.*型別不同/],
    ['decks', prop({ unit: { code: 'L1', name: NaN } }), /unit.*型別不同/],
    ['decks', prop({ unit: { code: NaN, name: 'Back to School' } }), /unit.*型別不同/],
    ['decks', prop({ unit: 0 }), /unit.*型別不同/],
    ['decks', prop({ categories: '' }), /categories.*型別不同/],
    ['decks', prop({ categories: hole }), /categories.*型別不同/],
    ['decks', deckField({ targets: wrong }), /targets.*型別不同/],
    ['decks', deckField({ targets: hole }), /targets.*型別不同/],
    ['decks', deckField({ problems: wrong }), /problems.*型別不同/],
    ['decks', deckField({ problems: hole }), /problems.*型別不同/],
    ['decks', target({ prompts: hole }), /target\.prompts.*型別不同/],
    ['decks', deckField({ problems: [{ line: NaN, level: 'hint', code: 'x' }] }), /problems.*line.*型別不同/],
    ['decks', deckField({ problems: [{ line: 0, level: 5, code: 'x' }] }), /problems.*level.*型別不同/],
    ['decks', deckField({ problems: [{ line: 0, level: 'hint' }] }), /problems.*code.*型別不同/],
    ['decks', target({ id: undefined }), /target\.id.*型別不同/],
    ['decks', target({ name: 5 }), /target\.name.*型別不同/],
    ['decks', target({ line: NaN }), /target\.line.*型別不同/],
    ['decks', target({ line: 1.5 }), /target\.line.*型別不同/],
    ['decks', target({ ok: 'yes' }), /target\.ok.*型別不同/],
    ['decks', target({ prompts: wrong }), /target\.prompts.*型別不同/],
    ['decks', target({ prompts: [{ fingerprint: NaN }] }), /fingerprint.*型別不同/],
    ['decks', target({ fields: { importance: undefined, paused: false } }), /importance.*型別不同/],
    ['decks', target({ fields: { importance: 'medium', paused: 'no' } }), /paused.*型別不同/],
    ['decks', target({ direction: NaN }), /target\.direction.*型別不同/],
    ['today', item({ lt: 5 }), /today\(\).*lt.*型別不同/],
    ['today', item({ deck: NaN }), /today\(\).*deck.*型別不同/],
    ['today', item({ lane: undefined }), /today\(\).*lane.*型別不同/],
    ['today', slotTarget(() => ({ direction: NaN })), /slots.*direction.*型別不同/],
    ['today', slotTarget(slot => ({ prompts: slot.target.prompts.map(each => ({ ...each, fingerprint: NaN })) })), /nextCard\(\).*fingerprint.*型別不同/],
    ['conflicts', conflict([{ id: NaN, targets: [] }]), /conflicts\(\).*id.*型別不同/],
    ['conflicts', conflict([{ id: 'x', targets: wrong }]), /conflicts\(\).*targets.*型別不同/],
    ['conflicts', conflict([{ id: 'x', targets: [{ path: 5, line: 0, name: 'n' }] }]), /conflicts\(\).*path.*型別不同/],
    ['conflicts', conflict([{ id: 'x', targets: [{ path: 'p', line: 1.5, name: 'n' }] }]), /conflicts\(\).*line.*型別不同/],
    ['conflicts', conflict([{ id: 'x', targets: [{ path: 'p', line: 0 }] }]), /conflicts\(\).*name.*型別不同/],
  ];
  const empty = { ...full, files: {} };
  // 空的 typed array 也有 `.map`：沒有內容時不會丟錯，所以完全沒有內容也要拒絕。
  for (const [hook, change, expected] of anyInput) for (const each of [full, empty]) {
    reset();
    hooks.broken[hook] = change;
    await assert.rejects(snapshot(dir, each), expected, String(expected));
  }
  // 卡組的問題要有內容才走得到元素：`full` 裡有今天的份、卡組、問題。
  for (const [hook, change, expected] of withContent) {
    reset();
    hooks.broken[hook] = change;
    await assert.rejects(snapshot(dir, full), expected, String(expected));
  }
  reset();

  // 命令列這條路：程序之間的 JSON 會丟掉原型別，要在送出之前擋下來。正常的輸出和直接呼叫相同。
  assert.deepEqual(await adapterCli(t, root, full), { ok: true, snapshot: await snapshot(root, full) });
  const term = await adapterCli(t, await patched(t, 'src/state/index.ts', 'decks: () => deckList,', 'decks: () => deckList.map(entry => ({ ...entry, deck: { ...entry.deck, props: { ...entry.deck.props, term: NaN } } })),'), full);
  assert.ok(!term.ok && /term.*型別不同/.test(term.reason), JSON.stringify(term));
  const typed = await adapterCli(t, await patched(t, 'src/state/index.ts', 'decks: () => deckList,', 'decks: () => new Uint8Array(),'), empty);
  assert.ok(!typed.ok && /decks\(\).*型別不同/.test(typed.reason), JSON.stringify(typed));
  const holes = await adapterCli(t, await patched(t, 'src/state/index.ts', 'decks: () => deckList,', 'decks: () => deckList.map(entry => ({ ...entry, deck: { ...entry.deck, props: { ...entry.deck.props, categories: new Array(1) } } })),'), full);
  assert.ok(!holes.ok && /categories.*型別不同/.test(holes.reason), JSON.stringify(holes));
  const noContent = await adapterCli(t, await patched(t, 'src/state/index.ts', 'conflicts: () => life.loaded ? tracker.duplicates() : [],', 'conflicts: () => new Array(1),'), empty);
  assert.ok(!noContent.ok && /conflicts\(\).*型別不同/.test(noContent.reason), JSON.stringify(noContent));
});

/** 直接跑轉接器的命令列（compareVersions 用的那條路），回傳它寫出的結果。 */
async function adapterCli(t: TestContext, dir: string, input: AdapterInput): Promise<AdapterResult> {
  const folder = await tempFolder(t, 'essence-cli-');
  const [inputPath, outputPath] = [join(folder, 'input.json'), join(folder, 'output.json')];
  await writeFile(inputPath, JSON.stringify(input));
  execFileSync(process.execPath, [join(root, 'tools/compare/adapter.ts'), dir, inputPath, outputPath], { stdio: 'pipe' });
  return JSON.parse(await readFile(outputPath, 'utf8')) as AdapterResult;
}

void test('收尾：只有 Files 拒絕寫版本行是預期的；close 自己的錯、寫入時別的錯都不能當成成功（Codex 第三次審查 F4）', async t => {
  const { version } = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as { version: string };
  // 紀錄裡已經有這一版的版本行就不會寫任何東西，這時 close 的拒絕不可能來自 Files；沒有就會排一行、被拒絕。
  const nothingToWrite = { now: NOW, offset: 480, files: { [A]: goal('aaa111'), 'Essence Cards/紀錄/2026-10 compare.jsonl': JSON.stringify({ t: '2026-10-29T19:00:00.000+08:00', set: 'app', val: version }) + '\n' } };
  const versionLine = { now: NOW, offset: 480, files: { [A]: goal('aaa111') } };
  for (const input of [nothingToWrite, versionLine]) assert.deepEqual((await snapshot(root, input)).due, { aaa111: null });
  const closing = await patched(t, 'src/state/index.ts', 'reads.stop();', "reads.stop(); throw new TypeError('unsupported close contract');");
  for (const input of [nothingToWrite, versionLine]) await assert.rejects(snapshot(closing, input), /unsupported close contract/);
  const result = await adapterCli(t, closing, nothingToWrite);
  assert.ok(!result.ok && result.reason.includes('unsupported close contract'), JSON.stringify(result));
  const writing = await patched(t, 'src/state/index.ts', "onError: error => { report(error, 'write'); }", "onError: () => { report(new TypeError('write contract'), 'write'); }");
  await assert.rejects(snapshot(writing, versionLine), /write contract/);
});

// 假的版本回傳的每一個值，每個都會換成下面每一種不對的值。
const fakeGood = () => ({
  state: {
    unread: [] as string[],
    decks: [{ path: A, deck: {
      props: { status: 'active', isTranscript: false, term: '國二上', subject: '英文', unit: { code: 'L1', name: 'Back' }, categories: ['單字'] },
      targets: [{ id: 'aaa111', name: 'A', line: 0, ok: true, prompts: [{ fingerprint: '11111111' }], fields: { importance: 'medium', paused: false }, direction: 'en-zh' }],
      problems: [{ line: 1, level: 'error', code: 'x' }],
    } }],
    history: { reviews: [{}] },
    blocked: { decks: [C], targets: ['hld111'], all: false },
    canAnswer: true,
    input: { settings: { retention: 0.9 } },
    today: { share: [{ lt: 'aaa111', deck: A, lane: 'due' }], more: [{ lt: 'bbb222', deck: A, lane: 'new' }],
      slots: new Map([['aaa111', { retention: 0.8, target: { direction: 'en-zh' } }], ['bbb222', { retention: 0.8, target: { direction: 'en-zh' } }]]) },
    conflicts: [{ id: 'dup111', targets: [{ path: A, line: 0, name: 'A' }] }],
  },
  study: { releaseOf: '9.9.9', replay: new Map([['aaa111', {}]]), dueAt: NOW + 0.5, dayOf: 20000, nextCard: { kind: 'card', card: { prompt: { fingerprint: '11111111' } } } },
});
const fakeSnapshot: Snapshot = {
  gates: { decks: [C], held: ['hld111'], incomplete: false, conflicts: [{ id: 'dup111', targets: [{ path: A, line: 0, name: 'A' }] }] },
  decks: [{ path: A, props: { status: 'active', isTranscript: false, term: '國二上', subject: '英文', unit: { code: 'L1', name: 'Back' }, categories: ['單字'] },
    targets: [{ key: 'aaa111', id: 'aaa111', name: 'A', line: 0, ok: true, fingerprints: ['11111111'], importance: 'medium', paused: false, direction: 'en-zh' }],
    problems: [{ line: 1, level: 'error', code: 'x' }] }],
  due: { aaa111: NOW + 0.5 },
  today: [{ list: 'share', lt: 'aaa111', deck: A, lane: 'due', retention: 0.8, prompt: '11111111', direction: 'en-zh' }, { list: 'more', lt: 'bbb222', deck: A, lane: 'new', retention: 0.8, prompt: '11111111', direction: 'en-zh' }],
  days: days(1),
};
const WRONG: [string, () => unknown][] = [
  ['undefined', () => undefined], ['null', () => null], ['NaN', () => NaN], ['Infinity', () => Infinity], ['1.5', () => 1.5], ['5', () => 5], ['true', () => true],
  ['空字串', () => ''], ['"x"', () => 'x'], ['"__proto__"', () => '__proto__'], ['"constructor"', () => 'constructor'],
  ['[]', () => []], ['空洞', () => new Array<unknown>(1)], ['[null]', () => [null]], ['[undefined]', () => [undefined]], ['["x", 空洞]', () => { const list = ['x']; list.length = 2; return list; }],
  ['有 toJSON 的陣列', () => Object.assign(['x'], { toJSON: () => [] })], ['多了屬性的陣列', () => Object.assign(['x'], { extra: 1 })], ['Array 的子類別', () => new (class extends Array { toJSON() { return []; } })()],
  ['{}', () => ({})], ['有 toJSON 的物件', () => ({ toJSON: () => 'x' })], ['1n', () => 1n], ['Symbol', () => Symbol('x')], ['函式', () => () => 0], ['Promise', () => Promise.resolve()],
  ['字串物件', () => Object('x') as unknown], ['數字物件', () => Object(1) as unknown], ['布林物件', () => Object(false) as unknown], ['Date', () => new Date(0)], ['Map', () => new Map()], ['Set', () => new Set()],
  ['Uint8Array', () => new Uint8Array(1)], ['空的 Uint8Array', () => new Uint8Array()],
];
type Position = (string | number)[];
/** 值裡每一個位置（陣列的元素、物件的欄位、Map 的值）。 */
function positions(value: unknown, at: Position = []): Position[] {
  const children: [string | number, unknown][] = value instanceof Map ? [...(value as Map<string, unknown>)]
    : Array.isArray(value) ? (value as unknown[]).map((each, i) => [i, each])
    : typeof value === 'object' && value !== null ? Object.entries(value) : [];
  return [at, ...children.flatMap(([key, child]) => positions(child, [...at, key]))];
}
function replaced(value: unknown, [key, ...rest]: Position, wrong: unknown): unknown {
  if (key === undefined) return wrong;
  if (value instanceof Map) return new Map([...(value as Map<string, unknown>)].map(([k, each]) => [k, k === key ? replaced(each, rest, wrong) : each]));
  if (Array.isArray(value)) return (value as unknown[]).map((each, i) => i === key ? replaced(each, rest, wrong) : each);
  const fields = value as Record<string, unknown>;
  return { ...fields, [key]: replaced(fields[key], rest, wrong) };
}
const at = (value: unknown, position: Position): unknown => position.reduce<unknown>((each, key) =>
  each instanceof Map ? (each as Map<unknown, unknown>).get(key) : (each as Record<string | number, unknown>)[key], value);
const kind = (value: unknown): string => typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : Number.isFinite(value) ? 'number' : 'NaN')
  : typeof value === 'object' ? Object.prototype.toString.call(value) : typeof value;
// 交回同一版處理、轉接器不讀內容的（〈第四次審查〉的表）；其他位置型別不對就要拒絕。只影響分支的值（canAnswer、unread）不會進比較資料，看輸出看不出來（Codex L2 F1）。
const OPAQUE = new Set(['state.history.reviews.0', 'study.replay.aaa111']);
const CAN_BE_NULL = new Set<string | number | undefined>(['id', 'term', 'subject', 'unit', 'direction']);
/** 這個位置該不該接受這個值：和正常的值同一種；小數的位置也接受整數；能是 null 的欄位。 */
function fits(good: unknown, value: unknown, position: Position): boolean {
  if (OPAQUE.has(position.join('.')) || kind(good) === kind(value)) return true;
  return kind(good) === 'number' && kind(value) === 'integer' || value === null && CAN_BE_NULL.has(position.at(-1));
}
const NULLABLE = new Set(['id', 'term', 'subject', 'unit', 'direction', 'prompt', 'conflicts']);
/** 比較資料的形狀：和正常的那一份同型別；能是 null 的欄位才能是 null。 */
function sameShape(out: unknown, good: unknown, key: string): void {
  if (out === null) { assert.ok(NULLABLE.has(key), key); return; }
  if (Array.isArray(good)) {
    assert.ok(Array.isArray(out), key);
    for (const each of out as unknown[]) sameShape(each, good[0], key);
  } else if (typeof good === 'object' && good !== null) {
    assert.equal(Object.getPrototypeOf(out), Object.prototype, key);
    for (const [name, each] of Object.entries(good)) sameShape((out as Record<string, unknown>)[name], each, name);
  } else assert.equal(typeof out, typeof good, key);
}

void test('被比較的版本回傳的每個位置換成每一種不對的值：不是拒絕，就是形狀對、經過 JSON 不變（Codex 第四次審查 F5 之後，不再逐項補）', async t => {
  // 假的版本：每個函式回傳測試給的值，一個程序跑完所有組合。正常的值要出一份有具體內容的比較資料，否則全部拒絕也算過。
  const dir = await tempFolder(t, 'essence-fake-');
  const method = (group: string, name: string): string => `${name}: () => globalThis.fake.${group}.${name},`;
  const { state: stateValues, study: studyValues } = fakeGood();
  for (const [path, text] of Object.entries({
    'package.json': '{"type":"module"}',
    'manifest.json': '{"version":"9.9.9"}',
    'src/core/version/index.ts': 'export const releaseOf = () => globalThis.fake.study.releaseOf;\n',
    'src/core/study/index.ts': Object.keys(studyValues).map(name => `export const ${name} = () => globalThis.fake.study.${name};\n`).join(''),
    'src/state/index.ts': `export const createState = () => ({ ready: async () => {}, close: async () => {}, ${Object.keys(stateValues).map(name => method('state', name)).join(' ')} });\n`,
  })) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  const hooks = globalThis as unknown as { fake?: unknown };
  t.after(() => { delete hooks.fake; });
  const input = { now: NOW, offset: 480, files: {} };
  hooks.fake = fakeGood();
  assert.deepEqual(await snapshot(dir, input), fakeSnapshot);
  const escaped: string[] = [];
  let refused = 0;
  for (const position of positions(fakeGood()).filter(each => each.length > 1)) for (const [name, make] of WRONG) {
    const value = make();
    hooks.fake = replaced(fakeGood(), position, value);
    let out: Snapshot;
    try { out = await snapshot(dir, input); } catch { refused++; continue; }
    try {
      assert.ok(fits(at(fakeGood(), position), value, position));
      assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
      const { due, ...rest } = out, { due: _due, ...goodRest } = fakeSnapshot;
      sameShape(rest, goodRest, 'snapshot');
      for (const [id, at] of Object.entries(due)) assert.ok(at === null || at === 'stopped' || Number.isFinite(at), id);
    } catch {
      escaped.push(`${position.join('.')} = ${name}`);
    }
  }
  assert.deepEqual(escaped, []);
  assert.ok(refused > 500, String(refused));

  // 型別都對，內容矛盾：擋下的卡組又有內容。比較端兩邊都擋下就不比內容，這一份差異比不到。
  hooks.fake = replaced(fakeGood(), ['state', 'blocked', 'decks'], [A]);
  await assert.rejects(snapshot(dir, input), /decks\(\).*擋下/);
});

void test('比較：比較資料裡任何一個值不同都報得出來，少了一筆也是，兩個方向都要（Codex 第五次審查 F7）', () => {
  // 每個能是 null、'stopped' 的欄位都有例子。
  const rich = structuredClone(fakeSnapshot);
  rich.decks.push({ path: B, props: { status: 'draft', isTranscript: true, term: null, subject: null, unit: null, categories: [] },
    targets: [{ key: '@2:B', id: null, name: 'B', line: 2, ok: false, fingerprints: [], importance: 'low', paused: true, direction: null }], problems: [] });
  rich.due = { ...rich.due, new111: null, hld111: 'stopped' };
  rich.today[1] = { ...rich.today[1], prompt: null, direction: null };
  assert.deepEqual(diffSnapshots(rich, structuredClone(rich), time), []);
  const changed = (value: unknown, position: Position): unknown => {
    if (Array.isArray(value)) return value.length ? (value as unknown[]).slice(1) : undefined;
    if (typeof value === 'object' && value !== null) return undefined;
    if (position[0] === 'due') return value === 1 ? 2 : 1;
    return typeof value === 'string' ? value + 'x' : typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : 'x';
  };
  const unseen: string[] = [];
  for (const position of positions(rich).filter(each => each.length > 0)) {
    const other = changed(at(rich, position), position);
    if (other === undefined) continue;
    const after = replaced(rich, position, other) as Snapshot;
    if (!diffSnapshots(rich, after, time).length || !diffSnapshots(after, rich, time).length) unseen.push(position.join('.'));
  }
  assert.deepEqual(unseen, []);

  // 沒有 ID 的目標，替代的 key 和別的目標的 ID 相同：只有 id 不同，也要報。
  const target = (id: string | null, line: number, name: string): Snapshot['decks'][number]['targets'][number] =>
    ({ key: id ?? `@${line}:${name}`, id, name, line, ok: true, fingerprints: [], importance: 'medium', paused: false, direction: null });
  const aliased = (first: string | null): Snapshot => ({ ...structuredClone(rich), decks: [{ ...structuredClone(rich.decks[1]), path: A, targets: [target(first, 0, 'A'), target('@0:A', 2, 'B')] }], due: { '@0:A': 'stopped' }, today: [] });
  assert.deepEqual(diffSnapshots(aliased(null), aliased('@0:A'), time).filter(line => line.startsWith(A)), [`${A} 的 @0:A 第 1 個的 id：null → "@0:A"`]);
});

void test('發布前比較：v0.2.0 到現在；報告列出兩邊的讀取閘門與重複的 ID，今天的份不同不是零差異', async t => {
  const clone = await deployed(t);
  const vault = await makeVault(t, gatedFiles);
  const backup = (await backupVault({ vault, to: await tempFolder(t), by: 'backup', now: () => NOW, offset: () => 480 })).path;
  const result = await compareVersions({ backup, old: 'v0.2.0', new: git(root, 'rev-parse', 'HEAD'), root: clone, install: linkModules, now: () => NOW });
  assert.equal(result.comparable, true);
  assert.ok(result.differences.length > 0);
  const text = await readFile(result.report, 'utf8');
  assert.match(text, /舊版：\n\n- 需要新版才讀得懂的卡組：Essence Cards\/C\.md（內容沒有比到）\n- 讀不懂的紀錄行停掉的學習目標：hld111\n- 整份紀錄不完整（全部學習目標都停）：否\n- 重複的學習目標 ID（這些目標都停）：這一版沒有這個判斷\n/);
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
