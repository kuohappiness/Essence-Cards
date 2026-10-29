import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, lstat, readdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { readDecks } from '../src/core/deck/index.ts';
import { dueAt, readHistory, replay } from '../src/core/study/index.ts';
import type { History } from '../src/core/study/index.ts';
import { backupVault } from '../tools/backup.ts';
import { createNodeFiles } from '../tools/node-files.ts';
import { applyPlan, makePlan } from '../tools/restore.ts';
import type { RestoreOptions } from '../tools/restore.ts';
import { platformName } from '../tools/vault-io.ts';
import { goal, makeVault, put, review, tempFolder } from './helpers/vault.ts';

const LOGS = 'Essence Cards/紀錄/';
const T = '2026-10-28T10:00:00.000+08:00';
// 還原那天：2026-10-29 20:00 +08:00。
const fixed = { now: () => Date.UTC(2026, 9, 29, 12), offset: () => 480 };
const DEVICE = platformName() + '-2c9e';
const restored = (source: string): string => `${LOGS}${source} 還原 2026-10-29 ${DEVICE}.jsonl`;

/** 每次呼叫不同的隨機碼（計畫檔名、暫存檔名）；還原檔的裝置碼固定是 2c9e。 */
function counter(): () => string {
  let n = 0;
  return () => n++ === 0 ? '2c9e' : (0x1000 + n).toString(16);
}
const history = (vault: string): Promise<History> => readHistory(createNodeFiles(vault));
/** syntax §5-3 的「合併結果相同」：reviews 的內容與順序、changes、cancelled、seen（Codex 格式查核 R3）。 */
const effective = ({ reviews, changes, cancelled, seen }: History) => ({ reviews, changes, cancelled, seen });
const due = (h: History, lt: string): number => dueAt(replay(h.reviews).get(lt)!, 0.8);
const read = (vault: string, path: string): Promise<string> => readFile(join(vault, path), 'utf8');

async function backup(t: Parameters<typeof tempFolder>[0], vault: string, config?: string): Promise<string> {
  return (await backupVault({ vault, to: await tempFolder(t, 'essence-backup-'), config, by: 'backup', ...fixed })).path;
}
async function restore(vault: string, zip: string, extra: Partial<RestoreOptions> & { files?: string[] } = {}) {
  const options = { vault, backup: zip, ...fixed, random: counter(), ...extra };
  const { plan, path } = await makePlan(options);
  return { plan, result: await applyPlan({ ...options, plan: path, random: counter() }) };
}

void test('還原 C4 反例一：兩台裝置同一刻的作答，一個來源檔不見了，補成還原檔後順序與到期和兩個原檔都在時相同', async t => {
  const good = review(T, 'abc123', 'good'), miss = review(T, 'abc123', 'miss');
  const vault = await makeVault(t, { [LOGS + '2026-10 iPhone-1111.jsonl']: good + '\n', [LOGS + '2026-10 iPhone-2222.jsonl']: miss + '\n' });
  const original = await history(vault);
  assert.deepEqual(original.reviews.map(entry => entry.r), ['good', 'miss']);
  assert.equal(due(original, 'abc123'), Date.UTC(2026, 9, 28, 2, 1));
  const zip = await backup(t, vault);
  await unlink(join(vault, LOGS + '2026-10 iPhone-1111.jsonl'));
  const { plan, result } = await restore(vault, zip);
  assert.deepEqual(plan.logs, [{ source: '2026-10 iPhone-1111', lines: [good] }]);
  assert.deepEqual(result.logs.map(log => [log.path, log.outcome]), [[restored('2026-10 iPhone-1111'), '已還原']]);
  assert.equal(await read(vault, restored('2026-10 iPhone-1111')), good + '\n');
  const after = await history(vault);
  assert.deepEqual(effective(after), effective(original));
  assert.equal(due(after, 'abc123'), Date.UTC(2026, 9, 28, 2, 1));
});

void test('還原 C4 反例二：壞行原樣補進還原檔，救回的作答與 seen 的 abc123、old123 都還在，問題改指還原檔', async t => {
  const broken = '{"t":"unfinished","lt":"old123"' + review(T, 'abc123');
  const source = LOGS + '2026-10 iPhone-7f3a.jsonl';
  const vault = await makeVault(t, { [source]: broken + '\n' });
  const original = await history(vault);
  assert.equal(original.reviews.length, 1);
  assert.deepEqual(original.seen, ['abc123', 'old123']);
  const zip = await backup(t, vault);
  await writeFile(join(vault, source), '');
  await restore(vault, zip);
  assert.equal(await read(vault, restored('2026-10 iPhone-7f3a')), broken + '\n');
  const after = await history(vault);
  assert.deepEqual(effective(after), effective(original));
  assert.deepEqual(after.problems, [{ ...original.problems[0], path: restored('2026-10 iPhone-7f3a') }]);
});

void test('還原：衝突副本、還原檔、來源檔三者的順序和那些行還在來源檔時相同', async t => {
  const source = LOGS + '2026-10 iPhone-7f3a.jsonl', copy = LOGS + '2026-10 iPhone-7f3a 2.jsonl';
  const near = review(T, 'abc123', 'near'), good = review(T, 'abc123', 'good'), easy = review('2026-10-28T10:05:00.000+08:00', 'abc123', 'easy');
  const vault = await makeVault(t, { [copy]: near + '\n', [source]: good + '\n' + easy + '\n' });
  const original = await history(vault);
  assert.deepEqual(original.reviews.map(entry => entry.r), ['near', 'good', 'easy']);
  const zip = await backup(t, vault);
  // iCloud 解衝突時留了另一個版本：來源檔少了 good 那一行。
  await writeFile(join(vault, source), easy + '\n');
  await restore(vault, zip);
  assert.deepEqual((await readdir(join(vault, LOGS))).sort(), ['2026-10 iPhone-7f3a 2.jsonl', `2026-10 iPhone-7f3a 還原 2026-10-29 ${DEVICE}.jsonl`, '2026-10 iPhone-7f3a.jsonl']);
  const after = await history(vault);
  assert.deepEqual(effective(after), effective(original));
  assert.equal(due(after, 'abc123'), due(original, 'abc123'));
});

/** 演練用的 vault：備份之後新作答與 undo、把 bbb222 從 A 搬到 B、A 改字、iPad 的紀錄檔不見了。 */
async function drill(t: Parameters<typeof tempFolder>[0]) {
  const A = 'Essence Cards/A.md', B = 'Essence Cards/B.md', S = LOGS + '2026-10 iPhone-7f3a.jsonl', P = LOGS + '2026-10 iPad-0000.jsonl';
  const before = { [A]: goal('aaa111') + goal('bbb222'), [B]: goal('ccc333'), [S]: review(T, 'aaa111') + '\n', [P]: review(T, 'ccc333') + '\n' };
  const vault = await makeVault(t, before);
  const zip = await backup(t, vault);
  await appendFile(join(vault, S), review('2026-10-29T19:00:00.000+08:00', 'bbb222') + '\n' + JSON.stringify({ t: '2026-10-29T19:00:01.000+08:00', undo: T }) + '\n');
  await put(vault, A, goal('aaa111', '改過的答案'));
  await put(vault, B, goal('ccc333') + goal('bbb222'));
  await unlink(join(vault, P));
  return { vault, zip, A, B, S, P, before, log: await read(vault, S) };
}

void test('還原演練：照計畫還原後原有的紀錄行一行都沒少、內容正確、全庫 ID 不重複；再跑一次 --plan 沒有要補的', async t => {
  const { vault, zip, A, B, S, P, before, log } = await drill(t);
  const { plan, result } = await restore(vault, zip);
  assert.deepEqual(plan.files.map(file => [file.path, file.kind, file.action]), [[A, 'changed', 'restore'], [B, 'changed', 'restore']]);
  assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[A, '已還原'], [B, '已還原']]);
  assert.deepEqual(result.logs.map(file => [file.path, file.outcome]), [[restored('2026-10 iPad-0000'), '已還原']]);
  assert.match(result.backup, /Essence Cards 備份 .*\.zip$/);
  assert.equal(await read(vault, S), log);
  assert.equal(await read(vault, A), before[A]);
  assert.equal(await read(vault, B), before[B]);
  assert.equal(await read(vault, restored('2026-10 iPad-0000')), before[P]);
  const ids = (await readDecks(createNodeFiles(vault))).flatMap(entry => entry.deck.targets.map(target => target.id));
  assert.deepEqual(ids.sort(), ['aaa111', 'bbb222', 'ccc333']);
  const again = await makePlan({ vault, backup: zip, ...fixed, random: () => 'ffff' });
  assert.deepEqual([again.plan.files, again.plan.logs], [[], []]);
});

void test('還原演練：只選 A 會讓搬走的 bbb222 重複，A 擋住、什麼都不寫；紀錄照補', async t => {
  const { vault, zip, A, B } = await drill(t);
  const current = await read(vault, A);
  const { result } = await restore(vault, zip, { files: [A] });
  assert.deepEqual(result.files, [{ path: A, target: A, outcome: '擋住', reason: '學習目標 ID bbb222 現在在「' + B + '」' }]);
  assert.equal(await read(vault, A), current);
  assert.equal(result.logs.length, 1);
});

const ids = async (vault: string): Promise<(string | null)[]> =>
  (await readDecks(createNodeFiles(vault))).flatMap(entry => entry.deck.targets.map(target => target.id)).sort();

void test('還原：中途寫入失敗時列為失敗，等它釋放 ID 的檔也不寫、ID 不重複；重跑 --plan 再 --apply 就完成', async t => {
  const { vault, zip, A, B, before } = await drill(t);
  const write = async (path: string, bytes: Uint8Array, flag: 'w' | 'wx'): Promise<void> => {
    if (path.includes('B.md')) throw Object.assign(Error('寫入失敗'), { code: 'EIO' });
    await writeFile(path, bytes, { flag });
  };
  const { plan: first, result } = await restore(vault, zip, { seams: { write } });
  // A 要加回 bbb222，它現在在 B：B 先寫（Codex 中途查核 F1）。
  assert.deepEqual([first.order, first.files.map(file => file.after)], [[B, A], [[B], []]]);
  assert.deepEqual(result.files.map(file => [file.path, file.outcome, file.reason]),
    [[A, '跳過', '要先還原「' + B + '」才不會讓學習目標 ID 重複，它這次沒有還原成'], [B, '失敗', '寫入失敗']]);
  assert.deepEqual(await ids(vault), ['aaa111', 'bbb222', 'ccc333']);
  assert.deepEqual((await readdir(join(vault, 'Essence Cards'))).filter(name => name.includes('restore-tmp')), []);
  const { plan, result: second } = await restore(vault, zip);
  assert.deepEqual(plan.files.map(file => file.path), [A, B]);
  assert.deepEqual(plan.logs, []);
  assert.deepEqual(second.files.map(file => [file.path, file.outcome]), [[A, '已還原'], [B, '已還原']]);
  assert.deepEqual([await read(vault, A), await read(vault, B)], [before[A], before[B]]);
});

for (const [releases, adds] of [['A', 'B'], ['B', 'A']]) {
  void test(`還原（Codex 中途查核 F1）：${releases} 釋放 ID、${adds} 加回；${releases} 計畫之後改過或寫入失敗時，${adds} 都不寫、ID 不重複`, async t => {
    // 備份：釋放的那篇只有 aaa111，加回的那篇有 bbb222；計畫時 bbb222 在釋放的那篇裡。
    const R = `Essence Cards/${releases}.md`, D = `Essence Cards/${adds}.md`;
    for (const branch of ['changed', 'failed'] as const) {
      const vault = await makeVault(t, { [R]: goal('aaa111'), [D]: goal('bbb222') });
      const zip = await backup(t, vault);
      await put(vault, R, goal('aaa111') + goal('bbb222'));
      await put(vault, D, goal('ccc333'));
      const options = { vault, backup: zip, ...fixed, random: counter() };
      const { plan, path } = await makePlan(options);
      assert.deepEqual(plan.order, [R, D]);
      if (branch === 'changed') await put(vault, R, goal('aaa111', '計畫之後改字') + goal('bbb222'));
      const write = async (file: string, bytes: Uint8Array, flag: 'w' | 'wx'): Promise<void> => {
        if (branch === 'failed' && file.includes(releases + '.md.')) throw Object.assign(Error('no space left on device'), { code: 'ENOSPC' });
        await writeFile(file, bytes, { flag });
      };
      const result = await applyPlan({ ...options, plan: path, seams: { write } });
      const outcomes = Object.fromEntries(result.files.map(file => [file.path, file.outcome]));
      assert.deepEqual([outcomes[R], outcomes[D]], [branch === 'changed' ? '跳過' : '失敗', branch === 'changed' ? '擋住' : '跳過'], branch);
      assert.deepEqual(await ids(vault), ['aaa111', 'bbb222', 'ccc333'], branch);
    }
  });
}

void test('還原（Codex 中途查核 F2）：寫入期間才到的修改不蓋掉——別的檔在前一個檔寫入時被改、這個檔在暫存檔寫好後改名前被改，都跳過', async t => {
  const { vault, zip, A, B } = await drill(t);
  let step = 0;
  const write = async (file: string, bytes: Uint8Array, flag: 'w' | 'wx'): Promise<void> => {
    await writeFile(file, bytes, { flag });
    // 順序是 B 再 A：寫 B 的暫存檔時改了 B（改名前的檢查要擋），之後 A 的寫入照常。
    if (file.includes('B.md.') && step++ === 0) await put(vault, B, goal('ccc333') + goal('bbb222') + goal('new999'));
  };
  const result = await applyPlan({ vault, backup: zip, ...fixed, random: counter(), plan: (await makePlan({ vault, backup: zip, ...fixed, random: counter() })).path, seams: { write } });
  assert.deepEqual(result.files.map(file => [file.path, file.outcome, file.reason]), [
    [A, '跳過', '要先還原「' + B + '」才不會讓學習目標 ID 重複，它這次沒有還原成'], [B, '跳過', '還原期間改過；重跑 --plan 看新的差異']]);
  assert.equal(await read(vault, B), goal('ccc333') + goal('bbb222') + goal('new999'));
  assert.deepEqual((await readdir(join(vault, 'Essence Cards'))).filter(name => name.includes('restore-tmp')), []);
  // 寫 A 之前另一篇被改：A 照常（只看 A 自己），被改的那一篇是別的檔，不在這次還原裡。
  const other = await drill(t);
  const options = { vault: other.vault, backup: other.zip, ...fixed, random: counter() };
  const { path } = await makePlan({ ...options, random: counter() });
  let once = true;
  const late = async (file: string, bytes: Uint8Array, flag: 'w' | 'wx'): Promise<void> => {
    // 寫 B 的暫存檔時，A 才被同步改掉：輪到 A 時寫之前的重讀要擋住。
    if (file.includes('B.md.') && once) { once = false; await put(other.vault, other.A, goal('aaa111', '同步來的新字')); }
    await writeFile(file, bytes, { flag });
  };
  const second = await applyPlan({ ...options, plan: path, seams: { write: late } });
  assert.deepEqual(second.files.map(file => [file.path, file.outcome]), [[other.A, '跳過'], [other.B, '已還原']]);
  assert.equal(await read(other.vault, other.A), goal('aaa111', '同步來的新字'));
});

void test('還原：還原檔寫到一半空間不足時列為失敗、不留半個檔，重跑仍算缺', async t => {
  const { vault, zip } = await drill(t);
  const write = async (path: string, bytes: Uint8Array, flag: 'w' | 'wx'): Promise<void> => {
    if (!path.endsWith('.jsonl')) return writeFile(path, bytes, { flag });
    await writeFile(path, bytes.subarray(0, 5), { flag });
    throw Object.assign(Error('no space left on device'), { code: 'ENOSPC' });
  };
  const { result } = await restore(vault, zip, { seams: { write } });
  assert.deepEqual(result.logs.map(log => [log.outcome, log.reason]), [['失敗', 'no space left on device']]);
  assert.deepEqual((await readdir(join(vault, LOGS))).filter(name => name.includes('還原')), []);
  const again = await makePlan({ vault, backup: zip, ...fixed, random: () => 'eeee' });
  assert.equal(again.plan.logs.length, 1);
});

void test('還原：暫存檔撞到已有的檔就換名字，不刪不是這次建立的檔（Codex 中途查核 F5）', async t => {
  const { vault, zip, A } = await drill(t);
  const other = join(vault, A + '.abcd.restore-tmp');
  await writeFile(other, 'preexisting temporary');
  const codes = ['2c9e', 'abcd', 'abcd', 'beef'];
  const options = { vault, backup: zip, ...fixed, random: () => codes.shift() ?? 'ffff' };
  const { path } = await makePlan(options);
  const result = await applyPlan({ ...options, plan: path, files: [A, 'Essence Cards/B.md'] });
  assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[A, '已還原'], ['Essence Cards/B.md', '已還原']]);
  assert.equal(await readFile(other, 'utf8'), 'preexisting temporary');
});

void test('備份：暫存檔被別的程序搶先建立時失敗，不刪那個檔（Codex 中途查核 F5）', async t => {
  const vault = await makeVault(t, { 'Essence Cards/A.md': goal('aaa111') });
  const to = await tempFolder(t);
  await assert.rejects(backupVault({ vault, to, by: 'backup', ...fixed, random: () => 'aaaa', seams: {
    write: async path => { await writeFile(path, 'other'); throw Object.assign(Error('exists'), { code: 'EEXIST' }); },
  } }), /exists/);
  assert.deepEqual(await readdir(to), ['Essence Cards 備份 2026-10-29 200000 未知 aaaa.zip.tmp']);
});

void test('Essence Cards 本身是連結時備份與計畫都拒絕；計畫之後子資料夾被換成連結時不寫，vault 外的檔不動（Codex 中途查核 F3）', async t => {
  const vault = await makeVault(t, { 'Essence Cards/子/A.md': goal('aaa111') });
  const zip = await backup(t, vault);
  const outside = await tempFolder(t, 'essence-outside-');
  await put(outside, '子/A.md', goal('aaa111', '外面的'));
  await rename(join(vault, 'Essence Cards'), join(vault, '移開'));
  await symlink(outside, join(vault, 'Essence Cards'), 'junction');
  await assert.rejects(backupVault({ vault, to: await tempFolder(t), by: 'backup', ...fixed }), /Essence Cards：是連結/);
  await assert.rejects(makePlan({ vault, backup: zip, ...fixed, random: counter() }), /Essence Cards：是連結/);
  await unlink(join(vault, 'Essence Cards'));
  await rename(join(vault, '移開'), join(vault, 'Essence Cards'));
  // 計畫之後，Essence Cards/子 被換成連到外面的 junction。
  await put(vault, 'Essence Cards/子/A.md', goal('aaa111', '改過'));
  const options = { vault, backup: zip, ...fixed, random: counter() };
  const { path } = await makePlan(options);
  const write = async (file: string, bytes: Uint8Array, flag: 'w' | 'wx'): Promise<void> => {
    // 檢查過路徑、寫暫存檔的那一刻換掉（最晚的中途置換）：改名前的檢查要擋住，不能寫到外面的 A.md。
    if (file.endsWith('.restore-tmp') && !(await lstat(join(vault, 'Essence Cards/子'))).isSymbolicLink()) {
      await rename(join(vault, 'Essence Cards/子'), join(vault, '子移開'));
      await symlink(join(outside, '子'), join(vault, 'Essence Cards/子'), 'junction');
    }
    await writeFile(file, bytes, { flag });
  };
  const result = await applyPlan({ ...options, plan: path, seams: { write } });
  assert.deepEqual(result.files.map(file => file.outcome), ['失敗']);
  assert.match(result.files[0].reason, /Essence Cards\/子：是連結/);
  assert.equal(await read(outside, '子/A.md'), goal('aaa111', '外面的'));
});

void test('還原：計畫之後被改過的檔在 --apply 時跳過，不蓋掉', async t => {
  const { vault, zip, A, B } = await drill(t);
  const options = { vault, backup: zip, ...fixed, random: counter() };
  const { path } = await makePlan(options);
  await put(vault, A, goal('aaa111', '計畫之後又改'));
  const result = await applyPlan({ ...options, plan: path });
  assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[A, '跳過'], [B, '已還原']]);
  assert.equal(await read(vault, A), goal('aaa111', '計畫之後又改'));
});

void test('還原：data.json 從 .obsidian-family 對到現在的 .obsidian；現在的設定資料夾確定不了時擋住、還原前的備份也做不了', async t => {
  const source = await makeVault(t, { 'Essence Cards/A.md': goal('aaa111'), '.obsidian-family/plugins/essence-cards/data.json': '{"cap":20}' }, { config: '.obsidian-family' });
  const zip = await backup(t, source, '.obsidian-family');
  const vault = await makeVault(t, { 'Essence Cards/A.md': goal('aaa111') });
  const { plan, result } = await restore(vault, zip);
  assert.deepEqual(plan.config, { source: '.obsidian-family', target: '.obsidian' });
  assert.deepEqual(result.files.map(file => [file.target, file.outcome]), [['.obsidian/plugins/essence-cards/data.json', '已還原']]);
  assert.equal(await read(vault, '.obsidian/plugins/essence-cards/data.json'), '{"cap":20}');
  const bare = await makeVault(t, { 'Essence Cards/A.md': goal('aaa111') }, { plugin: false });
  const options = { vault: bare, backup: zip, ...fixed, random: counter() };
  const { plan: blocked, path } = await makePlan(options);
  assert.deepEqual(blocked.files.map(file => [file.kind, file.action]), [['unmapped', 'blocked']]);
  await assert.rejects(applyPlan({ ...options, plan: path }), /manifest\.json 不存在/);
});

void test('還原：備份讀不懂（清單壞了）就不出計畫', async t => {
  const vault = await makeVault(t, {});
  const zip = join(await tempFolder(t), 'Essence Cards 備份 2026-10-29 200000 未知 0000.zip');
  await writeFile(zip, 'not a zip');
  await assert.rejects(makePlan({ vault, backup: zip }), /這份備份不能用：不是讀得懂的 zip/);
});

void test('還原（Codex 再查 R1）：暫存檔寫好後父資料夾被換成連結，清理不沿連結刪外面的同名檔，暫存檔留著並說明', async t => {
  const A = 'Essence Cards/sub/A.md';
  const vault = await makeVault(t, { [A]: goal('aaa111') });
  const zip = await backup(t, vault);
  await put(vault, A, goal('aaa111', '改過'));
  const options = { vault, backup: zip, ...fixed, random: counter() };
  const { path } = await makePlan(options);
  const outside = await tempFolder(t, 'essence-outside-');
  let swapped = '';
  const write = async (file: string, bytes: Uint8Array, flag: 'w' | 'wx'): Promise<void> => {
    await writeFile(file, bytes, { flag });
    if (!file.endsWith('.restore-tmp') || swapped) return;
    swapped = basename(file);
    await writeFile(join(outside, swapped), 'outside existing evidence');
    await rename(join(vault, 'Essence Cards/sub'), join(vault, 'Essence Cards/moved'));
    await symlink(outside, join(vault, 'Essence Cards/sub'), 'junction');
  };
  const result = await applyPlan({ ...options, plan: path, seams: { write } });
  assert.deepEqual(result.files.map(file => file.outcome), ['失敗']);
  assert.match(result.files[0].reason, /Essence Cards\/sub：是連結.*暫存檔 .*沒有刪/);
  assert.equal(await readFile(join(outside, swapped), 'utf8'), 'outside existing evidence');
  assert.ok((await readdir(join(vault, 'Essence Cards/moved'))).includes(swapped));
});

for (const source of ['已還原的前置檔', '沒選的其他卡組', '新出現的卡組'] as const) {
  void test(`還原（Codex 再查 R2）：要加回的 ID 在還原期間被${source}重新占用時不寫，ID 不重複`, async t => {
    const A = 'Essence Cards/A.md', B = 'Essence Cards/B.md', C = 'Essence Cards/C.md';
    // 備份：A 有 abc234、bcd345；計畫時 bcd345 在 B。B 先寫（釋放 bcd345），再寫 A。
    const vault = await makeVault(t, { [A]: goal('abc234') + goal('bcd345'), [B]: goal('cde456'), [C]: goal('fff111') });
    const zip = await backup(t, vault);
    await put(vault, A, goal('abc234'));
    await put(vault, B, goal('cde456') + goal('bcd345'));
    const options = { vault, backup: zip, ...fixed, random: counter() };
    const { plan, path } = await makePlan(options);
    assert.deepEqual(plan.order, [B, A]);
    const write = async (file: string, bytes: Uint8Array, flag: 'w' | 'wx'): Promise<void> => {
      await writeFile(file, bytes, { flag });
      if (!file.includes('A.md.')) return;
      if (source === '已還原的前置檔') await put(vault, B, goal('cde456') + goal('bcd345'));
      if (source === '沒選的其他卡組') await put(vault, C, goal('fff111') + goal('bcd345'));
      if (source === '新出現的卡組') await put(vault, 'Essence Cards/D.md', goal('bcd345'));
    };
    const result = await applyPlan({ ...options, plan: path, files: [A, B], seams: { write } });
    const outcomes = Object.fromEntries(result.files.map(file => [file.path, [file.outcome, file.reason]]));
    assert.equal(outcomes[A][0], '跳過');
    assert.match(outcomes[A][1], /學習目標 ID bcd345 現在在「Essence Cards\/[BCD]\.md」/);
    const ids = (await readDecks(createNodeFiles(vault))).flatMap(entry => entry.deck.targets.map(target => target.id));
    assert.equal(ids.filter(id => id === 'bcd345').length, 1, ids.join(','));
    assert.deepEqual((await readdir(join(vault, 'Essence Cards'))).filter(name => name.includes('restore-tmp')), []);
  });
}
