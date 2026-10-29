import test from 'node:test';
import { gitEnv } from '../tools/git.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from '../src/core/backup/index.ts';
import type { BackupManifest } from '../src/core/backup/index.ts';
import { examReminder } from '../tools/exam-reminder.ts';
import { registerTestVault } from '../tools/install.ts';
import { baseline, changedSince, checkUpdate, installUpdate } from '../tools/update-vault.ts';
import type { UpdateOptions } from '../tools/update-vault.ts';
import { goal, makeVault, put, review, tempFolder } from './helpers/vault.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = gitEnv();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, env, encoding: 'utf8' }).trim();
const short = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, env, encoding: 'utf8' }).trim();
// 當地時間 +08:00 的某一刻。
const at = (date: string, time: string): number => Date.parse(`${date}T${time}+08:00`);
const scope = (start?: string, end?: string): string =>
  (start || end ? '---\n' + (start ? `考試開始: ${start}\n` : '') + (end ? `考試結束: ${end}\n` : '') + '---\n' : '') + '- 國二上 自然 2-1～2-3\n';
const remind = (scopes: Record<string, string | null>, now: number) =>
  examReminder(Object.entries(scopes).map(([path, text]) => ({ path, text })), now, 480);

void test('考前提醒：前 7 天內、考試期間印提醒並要 --exam-ok；7 天以外與沒有生效的不用；清晨 4 點換日', () => {
  const now = at('2026-10-21', '20:00');
  assert.deepEqual(remind({ a: scope('2026-10-28', '2026-10-29') }, now), { kind: 'soon', needsOk: true, message: '離段考還有 7 天（「a」）；這一版可以考後再裝，由家長決定' });
  assert.deepEqual([remind({ a: scope('2026-10-29') }, now).kind, remind({ a: scope('2026-10-29') }, now).needsOk], ['none', false]);
  assert.match(remind({ a: scope('2026-10-29') }, now).message, /離段考還有 8 天.*在 7 天以外/);
  // 考試開始那天清晨 4 點前還是前一天；4 點起是考試期間。
  assert.equal(remind({ a: scope('2026-10-28', '2026-10-29') }, at('2026-10-28', '03:59')).message, '離段考還有 1 天（「a」）；這一版可以考後再裝，由家長決定');
  assert.equal(remind({ a: scope('2026-10-28', '2026-10-29') }, at('2026-10-28', '04:00')).kind, 'during');
  // 結束日的隔天清晨 4 點前仍是考試期間；4 點起失效。只寫開始就是一天。
  assert.equal(remind({ a: scope('2026-10-28', '2026-10-29') }, at('2026-10-30', '03:59')).kind, 'during');
  assert.deepEqual(remind({ a: scope('2026-10-28', '2026-10-29') }, at('2026-10-30', '04:00')), { kind: 'none', needsOk: false, message: '沒有生效的考試範圍' });
  assert.equal(remind({ a: scope('2026-10-28') }, at('2026-10-29', '04:00')).kind, 'none');
  // 好幾份生效時用開始日最早的那一份。
  assert.match(remind({ late: scope('2026-11-20'), early: scope('2026-10-25') }, now).message, /離段考還有 4 天（「early」）/);
  assert.deepEqual(remind({}, now), { kind: 'none', needsOk: false, message: '沒有生效的考試範圍' });
});

void test('考前提醒：沒填日期是日期未定；讀不到（讀不到檔、屬性區壞了、日期寫法不對）照實說，不當成沒有考試', () => {
  const now = at('2026-10-21', '20:00');
  assert.deepEqual(remind({ a: scope() }, now), { kind: 'undated', needsOk: false, message: '考試範圍「a」還沒填考試日期，日期未定' });
  assert.equal(remind({ a: scope(), b: scope('2026-12-20') }, now).kind, 'none');
  for (const text of [null, '---\n考試開始: [\n---\n', '---\n考試開始: 2026-10-28\n', '---\n考試開始: 2026/10/28\n---\n', '---\n考試開始: 2026-02-30\n---\n']) {
    const result = remind({ a: text }, now);
    assert.deepEqual([result.kind, result.needsOk], ['unreadable', true], String(text));
    assert.match(result.message, /不當成沒有考試/);
  }
});

void test('基線：和 .local/releases/ 的產物相同就用那一份的 commit；否則讀 BUILD；.dirty、讀不出、repo 裡找不到都是基線缺失', async t => {
  const local = await tempFolder(t, 'essence-local-');
  const main = (text: string): Uint8Array => new TextEncoder().encode(text);
  assert.deepEqual(await baseline(null, local, root), { missing: '這個 vault 還沒裝過外掛' });
  assert.deepEqual(await baseline(main(`/*! Essence Cards build=0.0.1+${short} dev=false */`), local, root), { commit: head, build: '0.0.1+' + short });
  assert.match((await baseline(main(`/*! Essence Cards build=0.0.1+${short}.dirty dev=true */`), local, root) as { missing: string }).missing, /未提交修改/);
  assert.match((await baseline(main('/*! Essence Cards build=0.0.1+0000000 dev=false */'), local, root) as { missing: string }).missing, /repo 裡找不到/);
  assert.match((await baseline(main('"use strict";'), local, root) as { missing: string }).missing, /讀不出/);
  assert.match((await baseline(main('/*! Essence Cards build=0.0.1 dev=false */'), local, root) as { missing: string }).missing, /沒有 commit/);
  const released = main('released main.js');
  await mkdir(join(local, 'releases', '0.1.0'), { recursive: true });
  await writeFile(join(local, 'releases', '0.1.0', 'release.json'), JSON.stringify({ build: '0.1.0+abcdef0', commit: 'abcdef0123', sha256: { 'main.js': hashBytes(released) } }));
  assert.deepEqual(await baseline(released, local, root), { commit: 'abcdef0123', build: '0.1.0+abcdef0' });
});

void test('--check 之後的變動：卡組或 data.json 改了、新的卡組都算；紀錄只多了後面的行與新的紀錄檔不算', () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
  const LOG = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl', DECK = 'Essence Cards/A.md', DATA = '.obsidian/plugins/essence-cards/data.json';
  const backup = new Map([[DECK, bytes(goal('aaa111'))], [LOG, bytes('a\n')], [DATA, bytes('{}')]]);
  const manifest = { files: [...backup].map(([path, content]) => ({ path, size: content.length, sha256: hashBytes(content) })) } as BackupManifest;
  const now = (changes: Record<string, string | null>): Map<string, Uint8Array> => {
    const map = new Map(backup);
    for (const [path, text] of Object.entries(changes)) { if (text === null) map.delete(path); else map.set(path, bytes(text)); }
    return map;
  };
  assert.deepEqual(changedSince(manifest, backup, now({ [LOG]: 'a\nb\n', 'Essence Cards/紀錄/2026-11 iPhone-7f3a.jsonl': 'c\n' })), []);
  assert.deepEqual(changedSince(manifest, backup, now({ [DECK]: goal('aaa111', '改') })), [DECK]);
  assert.deepEqual(changedSince(manifest, backup, now({ [LOG]: 'x\n' })), [LOG]);
  assert.deepEqual(changedSince(manifest, backup, now({ [DATA]: null, 'Essence Cards/B.md': goal('bbb222') })), [DATA, 'Essence Cards/B.md']);
});

void test('更新命令（測試 vault 演練）：--check 備份、比較、記下；--install 在卡組改了時要求重跑、考試期間要 --exam-ok，然後安裝', async t => {
  const local = await tempFolder(t, 'essence-local-');
  const vault = await makeVault(t, {
    'Essence Cards/A.md': goal('aaa111'),
    'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl': JSON.stringify({ t: '2026-10-28T20:00:00.000+08:00', set: 'app', val: '0.0.1+' + short }) + '\n' + review('2026-10-28T20:01:00.000+08:00', 'aaa111') + '\n',
    'Essence Cards/考試範圍/2026-10-28 國二上.md': scope('2026-10-28', '2026-10-30'),
    '.obsidian/plugins/essence-cards/main.js': `/*! Essence Cards build=0.0.1+${short} dev=false */`,
  });
  await registerTestVault(vault, local);
  const compared: string[] = [];
  const installed: string[] = [];
  const options: UpdateOptions = { vault, local, to: await tempFolder(t, 'essence-backup-'), now: () => at('2026-10-29', '20:00'), offset: () => 480, seams: {
    check: async () => {},
    compare: async ({ backup, old, new: next }) => {
      compared.push(old, next);
      const report = join(backup, '..', '報告.md');
      await writeFile(report, '');
      return { report, zip: '', old: { commit: old, build: '', result: { ok: false, reason: '' } }, new: { commit: next, build: '', result: { ok: false, reason: '' } }, comparable: true, differences: ['一項'] };
    },
    install: ({ vault: target }) => { installed.push(target); return Promise.resolve({ kind: 'test' as const, version: '0.0.1', build: '0.0.1+' + short, vault: target }); },
  } };
  const checked = await checkUpdate(options);
  assert.deepEqual([checked.test, checked.exam.kind, checked.differences, compared], [true, 'during', 1, [head, head]]);
  assert.deepEqual(checked.baseline, { commit: head, build: '0.0.1+' + short });
  assert.deepEqual(checked.devices.map(row => [row.device, row.build]), [['iPhone-7f3a', '0.0.1+' + short]]);
  assert.match(checked.backup, /Essence Cards 備份 2026-10-29 200000 0\.0\.1\+[0-9a-f]+ [0-9a-f]{4}\.zip$/);
  await appendFile(join(vault, 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl'), review('2026-10-29T21:00:00.000+08:00', 'aaa111') + '\n');
  await put(vault, 'Essence Cards/A.md', goal('aaa111', '改過'));
  await assert.rejects(installUpdate(options), /卡組或 data\.json 在 --check 之後改了，重跑 --check：\n- Essence Cards\/A\.md/);
  await put(vault, 'Essence Cards/A.md', goal('aaa111'));
  await assert.rejects(installUpdate(options), /考試期間.*先問過使用者再加 --exam-ok/);
  assert.deepEqual(await installUpdate({ ...options, examOk: true }), { build: '0.0.1+' + short, kind: 'test' });
  assert.deepEqual(installed.length, 1);
  assert.deepEqual(await readdir(local), ['test-vaults.json']);
  await assert.rejects(installUpdate({ ...options, examOk: true }), /還沒跑 --check/);
  // 沒裝過外掛：基線缺失，照樣寫報告。
  const fresh = await makeVault(t, { 'Essence Cards/A.md': goal('aaa111') });
  await registerTestVault(fresh, local);
  const missing = await checkUpdate({ ...options, vault: fresh });
  assert.deepEqual(missing.baseline, { missing: '這個 vault 還沒裝過外掛' });
  assert.match(await readFile(missing.report, 'utf8'), /基線缺失：這個 vault 還沒裝過外掛/);
});
