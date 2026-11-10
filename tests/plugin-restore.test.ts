import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyRestore, backupName, createBackupRunner, deckIds, filesReader, hashBytes, openBackup, planRestore, readCurrent, tickable } from '../src/core/backup/index.ts';
import type { BackupHost, BackupReader, OpenedBackup, PlanOptions, RestoreResult, RestoreRun } from '../src/core/backup/index.ts';
import { parseData, sameSaved } from '../src/core/settings/index.ts';
import { dueAt, replay } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { State } from '../src/state/index.ts';
import { createNodeFiles } from '../tools/node-files.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import type { MemoryFiles } from './helpers/memory-files.ts';
import { goal, makeVault, review } from './helpers/vault.ts';

// 外掛內的還原（tasks/plugin-restore.md §2、§3、§5、§7）：真正的 createState、createBackupRunner、applyRestore，記憶體 Files。

const A = 'Essence Cards/國二上/a.md', B = 'Essence Cards/國二上/b.md';
const LOGS = 'Essence Cards/紀錄/';
const LOG = LOGS + '2026-11 iPhone-7f3a.jsonl';
const DATA = '.obsidian/plugins/essence-cards/data.json';
const T = '2026-11-01T10:00:00.000+08:00', T2 = '2026-11-02T10:00:00.000+08:00';
const NOW = Date.parse('2026-11-10T20:00:00.000+08:00');
const VAULT = { name: 'Essence', path: 'D:/Notes/Essence' };
const FOLDER = 'C:/備份/Essence';
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const OPTIONS: PlanOptions = { config: '.obsidian', sameFile: path => path.toLowerCase() };
const DEVICE = 'Windows-2c9e';
const restoredLog = (source: string): string => `${LOGS}${source} 還原 2026-11-10 ${DEVICE}.jsonl`;

function memoryHost() {
  const folder = new Map<string, Uint8Array>();
  const control = { failPrepare: null as string | null, hold: null as Promise<void> | null, codes: 0 };
  const host: BackupHost = {
    vault: VAULT, key: path => path.toLowerCase(),
    async prepare(path) {
      if (control.hold) await control.hold;
      if (control.failPrepare) throw Error(control.failPrepare);
      return path;
    },
    write(_, taken) {
      const name = backupName(taken.started, taken.offset, taken.manifest.build, (0xa000 + control.codes++).toString(16));
      folder.set(name, taken.zip);
      return Promise.resolve(name);
    },
    list: () => Promise.resolve([...folder].flatMap(([name, bytes]) => {
      const opened = openBackup(bytes);
      return opened.ok ? [{ name, size: bytes.length, sha256: hashBytes(bytes), manifest: opened.value.manifest }] : [];
    })),
    read: (_, name) => Promise.resolve(folder.get(name) ?? null),
    remove(_, backup) { folder.delete(backup.name); return Promise.resolve(); },
  };
  return { host, folder, control };
}

interface Harness extends MemoryFiles {
  state: State;
  data: { bytes: Uint8Array | null };
  backups: ReturnType<typeof memoryHost>;
  runner: ReturnType<typeof createBackupRunner>;
  reader: ReturnType<typeof filesReader>;
  failures: string[];
}
async function setup(t: TestContext, texts: Record<string, string>, data: string | null = null): Promise<Harness> {
  const memory = createMemoryFiles(texts);
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: true, stuckAfter: 20, random: () => 0, now: () => NOW, offset: () => 480, onError() {} });
  t.after(() => state.close());
  await state.ready();
  const box = { bytes: data === null ? null : encode(data) };
  const reader = filesReader(memory.files, '.obsidian', () => Promise.resolve(box.bytes));
  const backups = memoryHost();
  const saved = { last: null as Parameters<Parameters<typeof createBackupRunner>[0]['store']['saveLast']>[0] | null };
  const runner = createBackupRunner({
    host: backups.host, reader, config: '.obsidian', build: '0.4.0+1a2b3c4', defaultFolder: FOLDER,
    store: { folder: () => null, last: () => saved.last, saveLast: last => { saved.last = last; } },
    now: () => NOW, offset: () => 480, onStatus() {}, restoreLimit: 200,
  });
  return { ...memory, state, data: box, backups, runner, reader, failures: [] };
}
/** 手動做一份，回傳檔名與打開的內容。 */
async function snapshot(h: Harness): Promise<{ name: string; opened: OpenedBackup }> {
  const before = new Set(h.backups.folder.keys());
  await h.runner.backup();
  const name = [...h.backups.folder.keys()].find(key => !before.has(key))!;
  const opened = openBackup(h.backups.folder.get(name)!);
  assert.ok(opened.ok);
  return { name, opened: opened.value };
}
const planNow = async (h: Harness, opened: OpenedBackup, chosen: ReadonlySet<string>, plan = OPTIONS) =>
  planRestore({ manifest: opened.manifest, backup: opened.files, current: await readCurrent(h.reader, DATA), ...plan, selection: chosen });

/** 畫面比對（§1）之後按下還原：over 換掉某一步。 */
async function restore(h: Harness, backup: { name: string; opened: OpenedBackup }, paths: readonly string[], over: Partial<RestoreRun> = {}, afterCompare?: () => void | Promise<void>): Promise<RestoreResult> {
  const chosen = new Set(paths);
  const screen = new Map((await planNow(h, backup.opened, chosen)).files.filter(file => chosen.has(file.path)).map(file => [file.path, file.current?.sha256 ?? null] as const));
  await afterCompare?.();
  return h.state.restore(async writer => {
    const result = await applyRestore({
      opened: backup.opened, chosen, screen, plan: OPTIONS,
      before: () => h.runner.beforeRestore([backup.name], h.reader),
      current: () => readCurrent(h.reader, DATA),
      files: h.files, deck: (path, write) => writer.deck(path, write), busy: () => false, noLinks: () => Promise.resolve(),
      settings: bytes => { h.data.bytes = bytes; return Promise.resolve('saved'); },
      device: DEVICE, now: () => NOW, offset: () => 480, closed: () => writer.closed(),
      fail: (step, error) => { h.failures.push(`${step}：${error instanceof Error ? error.message : String(error)}`); },
      ...over,
    });
    await writer.reread(result.written);
    return result;
  });
}
const outcomes = (result: RestoreResult): [string, string][] => result.files.map(file => [file.path, file.outcome]);
const issues = (h: Harness, ...paths: string[]): unknown[] => paths.flatMap(path => h.state.deckStatus(path).issues);
/** 檔案通知排的重讀做完。 */
const settled = async (h: Harness): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 20)); await h.state.flush(); };
const allIds = (h: Harness): string[] => [...h.texts].filter(([path]) => path.startsWith('Essence Cards/國二上/')).flatMap(([, text]) => deckIds(encode(text)));

// ---- §2 計畫 ----

void test('§2 計畫：平台的擋住原因、需要新版（備份或現在）、NUL 的卡組都擋住，不進寫入順序', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') });
  const { opened } = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  h.write(B, '---\n需要版本: 9.0.0\n---\n' + goal('bbbbbb', '新版'));
  const plan = await planNow(h, opened, new Set([A, B]), { ...OPTIONS, refuse: ({ target }) => target === A ? '路徑上有連結' : null, needsUpdate: deck => deck.props.need !== null });
  assert.deepEqual(plan.files.map(file => [file.path, file.action, file.reasons]), [[A, 'blocked', ['路徑上有連結']], [B, 'blocked', ['需要新版的外掛才讀得懂，這一版不寫它']]]);
  assert.deepEqual(plan.order, []);
  const nul = new Map(opened.files).set(A, encode(goal('aaaaaa') + '\0'));
  const blocked = planRestore({ manifest: opened.manifest, backup: nul, current: await readCurrent(h.reader, DATA), ...OPTIONS, selection: new Set([A]) });
  assert.deepEqual(blocked.files.find(file => file.path === A)?.reasons, ['備份裡這一篇的內容不完整（有 NUL）']);
});

void test('§2 只差副檔名大小寫：照實際會寫的檔擋住需要新版，ID 也照卡組查（L2 的 R5）', async t => {
  const upper = A.replace(/\.md$/, '.MD');
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const { opened } = await snapshot(h);
  const renamed = new Map(opened.files);
  renamed.set(upper, renamed.get(A)!);
  renamed.delete(A);
  const needsUpdate = (deck: Parameters<NonNullable<PlanOptions['needsUpdate']>>[0]): boolean => deck.props.need !== null;
  h.write(A, '---\n需要版本: 9.0.0\n---\n' + goal('aaaaaa', '新版'));
  const need = planRestore({ manifest: opened.manifest, backup: renamed, current: await readCurrent(h.reader, DATA), ...OPTIONS, needsUpdate, selection: new Set([upper]) });
  assert.deepEqual(need.files.map(file => [file.path, file.action, file.reasons]), [[upper, 'blocked', ['需要新版的外掛才讀得懂，這一版不寫它']]]);
  h.write(A, goal('cccccc'));
  h.write(B, goal('aaaaaa'));
  const taken = planRestore({ manifest: opened.manifest, backup: renamed, current: await readCurrent(h.reader, DATA), ...OPTIONS, selection: new Set([upper]) });
  assert.deepEqual(taken.files.filter(file => file.path === upper).map(file => [file.action, file.reasons]), [['blocked', [`學習目標 ID aaaaaa 現在在「${B}」`]]]);
  const nul = new Map(renamed).set(upper, encode(goal('cccccc', '別的') + '\0'));
  const broken = planRestore({ manifest: opened.manifest, backup: nul, current: await readCurrent(h.reader, DATA), ...OPTIONS, selection: new Set([upper]) });
  assert.deepEqual(broken.files.filter(file => file.path === upper).map(file => file.reasons), [['備份裡這一篇的內容不完整（有 NUL）']]);
});

void test('§2 只差副檔名大小寫（反方向）：備份是 .md、現況是 .MD，一樣擋需要新版與 NUL（L2 的 R5）', async t => {
  const upper = A.replace(/\.md$/, '.MD');
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const { opened } = await snapshot(h);
  h.remove(A);
  h.write(upper, '---\n需要版本: 9.0.0\n---\n' + goal('aaaaaa', '新版'));
  const needsUpdate = (deck: Parameters<NonNullable<PlanOptions['needsUpdate']>>[0]): boolean => deck.props.need !== null;
  const need = planRestore({ manifest: opened.manifest, backup: opened.files, current: await readCurrent(h.reader, DATA), ...OPTIONS, needsUpdate, selection: new Set([A]) });
  assert.deepEqual(need.files.filter(file => file.path === A).map(file => [file.action, file.reasons]), [['blocked', ['需要新版的外掛才讀得懂，這一版不寫它']]]);
  h.write(upper, goal('aaaaaa') + '\0');
  await assert.rejects(readCurrent(h.reader, DATA), /內容不完整/);
});

void test('§2 紀錄裡只補不見的：快照、原文、考試切面不見會補（不用勾），同名不同內容衝突不動，錯誤紀錄不列', async t => {
  const snap = LOGS + 'AI 輸出/快照.md', exam = LOGS + '考試/2026-11-08.json', err = LOGS + '錯誤/2026-11 PC-test.jsonl';
  const h = await setup(t, { [A]: goal('aaaaaa'), [snap]: '快照', [exam]: '{"a":1}', [err]: '{"t":"x"}\n' });
  const backup = await snapshot(h);
  h.remove(snap);
  h.write(exam, '{"a":2}');
  h.remove(err);
  const plan = await planNow(h, backup.opened, new Set());
  assert.deepEqual(plan.files.map(file => [file.path, file.kind, file.action]), [[snap, 'missing', 'restore'], [exam, 'changed', 'blocked']]);
  assert.equal(tickable(plan.files[0]), false);
  const result = await restore(h, backup, []);
  assert.equal(h.texts.get(snap), '快照');
  assert.equal(h.texts.get(exam), '{"a":2}');
  assert.equal(h.texts.has(err), false);
  assert.deepEqual(outcomes(result), [[snap, '已還原']]);
});

void test('§2 data.json：五個欄位都相同不列（其他欄位不同也一樣）；備份讀不懂時 parseData 回 null', () => {
  const a = parseData(encode('{"capMinutes":30,"other":1}'))!, b = parseData(encode('{"capMinutes":30,"other":2}'))!, c = parseData(encode('{"capMinutes":45}'))!;
  assert.equal(sameSaved(a, b), true);
  assert.equal(sameSaved(a, c), false);
  for (const bad of ['{', '[1]', 'null', '3']) assert.equal(parseData(encode(bad)), null, bad);
});

// ---- 演練（更新防線 §1-6 的情境在外掛這條路上） ----

void test('演練：備份 → 新作答、撤銷、搬目標、改字、掉行 → 還原 → 原有紀錄一行不少、內容正確、全庫 ID 不重複、再比對沒有要補的', async t => {
  const one = review(T, 'aaaaaa'), two = review(T2, 'bbbbbb', 'miss');
  const a0 = goal('aaaaaa') + goal('cccccc'), b0 = goal('bbbbbb');
  const h = await setup(t, { [A]: a0, [B]: b0, [LOG]: one + '\n' + two + '\n' });
  const backup = await snapshot(h);
  const due = dueAt(replay(h.state.history().reviews).get('aaaaaa')!, 0.8);
  // cccccc 從 A 搬到 B、A 改字、紀錄掉了一行（iCloud 留了另一個版本）、之後又有新作答。
  const later = review('2026-11-05T10:00:00.000+08:00', 'bbbbbb');
  h.write(A, goal('aaaaaa', '改壞了'));
  h.write(B, goal('bbbbbb') + goal('cccccc'));
  h.write(LOG, two + '\n' + later + '\n');
  await settled(h);
  const result = await restore(h, backup, [A, B]);
  assert.equal(result.stopped, null);
  assert.deepEqual(outcomes(result), [[A, '已還原'], [B, '已還原']]);
  assert.equal(h.texts.get(A), a0);
  assert.equal(h.texts.get(B), b0);
  assert.deepEqual(allIds(h).sort(), ['aaaaaa', 'bbbbbb', 'cccccc']);
  assert.equal(h.texts.get(LOG), two + '\n' + later + '\n');
  assert.equal(h.texts.get(restoredLog('2026-11 iPhone-7f3a')), one + '\n');
  // 重讀（§5）在閘門放開之前做完：畫面馬上看到補回的作答。
  assert.equal(h.state.history().reviews.length, 3);
  assert.equal(dueAt(replay(h.state.history().reviews.filter(entry => entry.lt === 'aaaaaa')).get('aaaaaa')!, 0.8), due);
  assert.equal(h.state.writeBlock(), null);
  const again = await planNow(h, backup.opened, new Set());
  assert.deepEqual(again.files.filter(file => file.action !== 'keep').map(file => file.path), []);
  assert.deepEqual(again.logs, []);
});

void test('冪等：同一份備份連做兩次，第二次沒有要寫的、沒有多的還原檔', async t => {
  const line = review(T, 'aaaaaa');
  const h = await setup(t, { [A]: goal('aaaaaa'), [LOG]: line + '\n' });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  h.remove(LOG);
  await restore(h, backup, [A]);
  const after = new Map(h.texts);
  const second = await restore(h, backup, [A]);
  assert.deepEqual(outcomes(second), [[A, '跳過']]);
  assert.equal(second.files[0].reason, '現在和備份相同');
  assert.deepEqual(second.written, []);
  assert.deepEqual(new Map(h.texts), after);
});

void test('中途失敗或停用後重新比對就是續做：不重複補行，沒寫成的這次寫成', async t => {
  const line = review(T, 'aaaaaa');
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb'), [LOG]: line + '\n' });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  h.write(B, goal('bbbbbb', '改過'));
  h.remove(LOG);
  h.control.failReplace = path => path === B;
  const first = await restore(h, backup, [A, B]);
  assert.deepEqual(outcomes(first), [[A, '已還原'], [B, '失敗']]);
  assert.match(h.failures[0], /寫 .*b\.md：寫不進去/);
  assert.equal(h.state.writeBlock(), null);
  h.control.failReplace = undefined;
  const second = await restore(h, backup, [B]);
  assert.deepEqual(outcomes(second), [[B, '已還原']]);
  assert.equal(h.texts.get(B), goal('bbbbbb'));
  assert.equal([...h.texts.keys()].filter(path => path.includes(' 還原 ')).length, 1);
});

void test('還原中途外掛停用：停在下一個檔之前，閘門放開，重新比對能續做', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  h.write(B, goal('bbbbbb', '改過'));
  let writes = 0;
  const files = { ...h.files, replace: (...args: Parameters<MemoryFiles['files']['replace']>) => { writes++; return h.files.replace(...args); } };
  const result = await restore(h, backup, [A, B], { files, closed: () => writes >= 1 });
  assert.deepEqual(outcomes(result), [[A, '已還原'], [B, '跳過']]);
  assert.match(result.files[1].reason, /外掛停用/);
  assert.equal(h.texts.get(B), goal('bbbbbb', '改過'));
  assert.deepEqual(outcomes(await restore(h, backup, [B])), [[B, '已還原']]);
});

// ---- §3 交錯 ----

void test('交錯：比對之後改過的不蓋掉（計畫之後）', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '第一次改'));
  const result = await restore(h, backup, [A], {}, () => { h.write(A, goal('aaaaaa', '第二次改')); });
  assert.deepEqual(outcomes(result), [[A, '跳過']]);
  assert.match(result.files[0].reason, /比對之後改過/);
  assert.equal(h.texts.get(A), goal('aaaaaa', '第二次改'));
});

void test('交錯：還原前的備份之後才改的不蓋掉（內容不在那份備份裡）', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  const result = await restore(h, backup, [A], {
    before: async () => {
      const done = await h.runner.beforeRestore([backup.name], h.reader);
      h.write(A, goal('aaaaaa', '備份之後才改'));
      return done;
    },
  });
  assert.deepEqual(outcomes(result), [[A, '跳過']]);
  assert.equal(h.texts.get(A), goal('aaaaaa', '備份之後才改'));
});

void test('交錯：掃描之後、最後確認之前改的不蓋掉；回呼裡的確認是最後一道', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  const files = {
    ...h.files,
    replace(path: string, check: (now: Uint8Array | null) => boolean, bytes: Uint8Array) {
      h.write(path, goal('aaaaaa', '最後一刻改'));
      return h.files.replace(path, check, bytes);
    },
  };
  const result = await restore(h, backup, [A], { files });
  assert.deepEqual(outcomes(result), [[A, '跳過']]);
  assert.equal(h.texts.get(A), goal('aaaaaa', '最後一刻改'));
  assert.deepEqual(result.written, []);
});

void test('交錯：還原期間又打開的那一篇不寫，別篇照常（L2 的 R1）', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  h.write(B, goal('bbbbbb', '改過'));
  const result = await restore(h, backup, [A, B], { busy: path => path === A });
  assert.deepEqual(outcomes(result), [[A, '跳過'], [B, '已還原']]);
  assert.match(result.files[0].reason, /又被打開了/);
  assert.equal(h.texts.get(A), goal('aaaaaa', '改過'));
});

/** 這個路徑的 replace：確認照常做，通過之後停住，release 才真的寫（已經送出、結果未定）。 */
function heldAfterCheck(h: Harness, match: (path: string) => boolean) {
  let release = (): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const files = {
    ...h.files,
    replace(path: string, check: (now: Uint8Array | null) => boolean, bytes: Uint8Array) {
      if (!match(path)) return h.files.replace(path, check, bytes);
      return (async () => {
        if (!check(await h.files.readBytes(path))) return false;
        await gate;
        return h.files.replace(path, () => true, bytes);
      })();
    },
  };
  return { files, release };
}

void test('卡住（§3-1 第 6 點）：已送出的卡組寫入超過時間：交回結果、後面的不做；晚回來內容對', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb'), [LOG]: review(T, 'aaaaaa') + '\n' });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  h.write(B, goal('bbbbbb', '改過'));
  h.remove(LOG);
  await settled(h);
  const { files, release } = heldAfterCheck(h, path => path === A);
  const result = await restore(h, backup, [A, B], { files, timeout: 20 });
  assert.deepEqual(outcomes(result), [[A, '失敗'], [B, '跳過']]);
  assert.match(result.stuck ?? '', /寫入超過/);
  assert.match(result.files[1].reason, /重新開啟 Obsidian/);
  assert.deepEqual(result.logs.map(log => log.outcome), ['跳過']);
  release();
  await settled(h);
  assert.equal(h.texts.get(A), goal('aaaaaa'));
  assert.equal(h.texts.get(B), goal('bbbbbb', '改過'));
  assert.deepEqual(issues(h, A), []);
});

void test('卡住（§3-1 第 6 點）：卡住之後才輪到確認的寫入不寫', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  let release = (): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let answer: boolean | undefined;
  const files = { ...h.files, async replace(path: string, check: (now: Uint8Array | null) => boolean, bytes: Uint8Array) { await gate; const done = await h.files.replace(path, check, bytes); answer = done; return done; } };
  const result = await restore(h, backup, [A], { files, timeout: 20 });
  assert.deepEqual(outcomes(result), [[A, '失敗']]);
  assert.match(result.stuck ?? '', /寫入超過/);
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(answer, false);
  assert.equal(h.texts.get(A), goal('aaaaaa', '改過'));
});

void test('卡住（§3-1 第 6 點）：補紀錄超過時間，晚回來之後再比對沒有要補的，只有一個還原檔', async t => {
  const line = review(T, 'aaaaaa');
  const h = await setup(t, { [A]: goal('aaaaaa'), [LOG]: line + '\n' });
  const backup = await snapshot(h);
  h.remove(LOG);
  await settled(h);
  const { files, release } = heldAfterCheck(h, path => path.includes(' 還原 '));
  const result = await restore(h, backup, [], { files, timeout: 20 });
  assert.deepEqual(result.logs.map(log => log.outcome), ['失敗']);
  assert.match(result.stuck ?? '', /補紀錄超過/);
  release();
  await settled(h);
  assert.deepEqual((await planNow(h, backup.opened, new Set())).logs, []);
  await restore(h, backup, []);
  assert.equal([...h.texts.keys()].filter(path => path.includes(' 還原 ')).length, 1);
});

void test('卡住（§3-1 第 6 點）：設定卡住之後不再寫；掃描卡住後面的不做', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') }, '{"capMinutes":30}');
  const backup = await snapshot(h);
  h.data.bytes = encode('{"capMinutes":45}');
  let live: (() => boolean) | undefined;
  const hung = new Promise<'saved'>(() => {});
  const result = await restore(h, backup, [DATA], { timeout: 20, settings: (_, __, alive) => { live = alive; return hung; } });
  assert.deepEqual(outcomes(result), [[DATA, '失敗']]);
  assert.match(result.stuck ?? '', /寫設定超過/);
  assert.equal(live?.(), false);
  h.write(A, goal('aaaaaa', '改過'));
  h.write(B, goal('bbbbbb', '改過'));
  await settled(h);
  const list = (): Promise<string[]> => new Promise(() => {});
  const scan = await restore(h, backup, [A, B], { timeout: 20, current: () => readCurrent(h.reader, DATA), files: { ...h.files, list } });
  assert.deepEqual(outcomes(scan), [[A, '失敗'], [B, '跳過']]);
  assert.match(scan.stuck ?? '', /掃描卡組超過/);
});

void test('逾時（R2）：晚回來的卡組寫入不清掉別的工作的等待', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') });
  let one = (): void => {}, two = (): void => {};
  const first = new Promise<boolean>(resolve => { one = () => { resolve(false); }; });
  const second = new Promise<boolean>(resolve => { two = () => { resolve(false); }; });
  let late: Promise<boolean> | undefined, next: Promise<boolean> | undefined;
  await h.state.restore(writer => {
    late = writer.deck(A, () => first);
    next = writer.deck(B, () => second);
    return Promise.resolve();
  });
  one();
  await late;
  let closed = false;
  const closing = h.state.close().then(() => { closed = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(closed, false);
  two();
  await next;
  await closing;
});

void test('逾時（R15）：晚回來的卡組寫入不解開同一篇新寫入的讀取保護', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  let one = (): void => {};
  const first = new Promise<boolean>(resolve => { one = () => { resolve(false); }; });
  let late: Promise<boolean> | undefined;
  await h.state.restore(writer => { late = writer.deck(A, () => first); return Promise.resolve(); });
  // 閘門放開之後，同一篇開始一般的補 ID：卡在寫入的回呼之前，讀取保護是它的。
  const held = h.holdModify(A);
  const filling = h.state.fillIds(A);
  await new Promise(resolve => setTimeout(resolve, 10));
  const reads: string[] = [];
  const read = h.files.read.bind(h.files);
  h.files.read = path => { reads.push(path); return read(path); };
  one();
  await late;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(reads.filter(path => path === A), []);
  held.release();
  await filling;
});

void test('卡住（R12）：前面的存檔卡住時放棄，還原的工作之後輪到也不做，閘門放開', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') });
  const held = h.holdRead(B);
  h.write(B, goal('bbbbbb', '改過'));
  const queued = h.state.fillIds(A);
  await held.started;
  let ran = false;
  await assert.rejects(h.state.restore(() => { ran = true; return Promise.resolve(); }), /前面還有存檔沒做完/);
  assert.equal(h.state.writeBlock() === 'restore', false);
  held.release();
  await queued;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(ran, false);
});

void test('卡住（R12）：補紀錄建好之後卡在讀回：一樣算卡住', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [LOG]: review(T, 'aaaaaa') + '\n' });
  const backup = await snapshot(h);
  h.remove(LOG);
  await settled(h);
  let release = (): void => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  const readBytes = h.files.readBytes.bind(h.files);
  const files = { ...h.files, readBytes: async (path: string) => { if (path.includes('還原')) await hold; return readBytes(path); } };
  const result = await restore(h, backup, [], { files, timeout: 20 });
  assert.deepEqual(result.logs.map(log => log.outcome), ['失敗']);
  assert.match(result.stuck ?? '', /補紀錄超過/);
  release();
});

void test('卡住（§3-1 第 6 點）：seal 之後閘門留著關、不能再還原，close 走得到底', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  await h.state.restore(writer => { writer.seal(); return Promise.resolve(); });
  assert.equal(h.state.writeBlock(), 'restoreStuck');
  await assert.rejects(h.state.restore(() => Promise.resolve()), /已經在還原/);
  await h.state.close();
});

void test('卡住（R6）：別的讀取已判定卡住時，重讀不讓閘門一直關著', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  await settled(h);
  const held = h.holdRead(B);
  h.notify(B);
  await held.started;
  for (let i = 0; i < 100 && h.state.writeBlock() !== 'unread'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.state.writeBlock(), 'unread');
  const result = await restore(h, backup, [A]);
  assert.deepEqual(outcomes(result), [[A, '已還原']]);
  assert.notEqual(h.state.writeBlock(), 'restore');
  held.release();
  await settled(h);
  assert.equal(h.state.writeBlock(), null);
});

void test('卡住（R6）：前一份備份一直沒做完：什麼都不寫，寫明原因，閘門放開；之後不再開始', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  let release = (): void => {};
  h.backups.control.hold = new Promise<void>(resolve => { release = resolve; });
  const other = h.runner.backup();
  const result = await restore(h, backup, [A]);
  assert.equal(result.stopped?.step, '先備份現況');
  assert.match(result.stopped.message, /超過時間/);
  assert.equal(h.texts.get(A), goal('aaaaaa', '改過'));
  assert.equal(h.state.writeBlock(), null);
  const count = h.backups.folder.size;
  release();
  h.backups.control.hold = null;
  await other;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.backups.folder.size, count + 1);
});

void test('卡住（R16）：現況備份放棄之後，晚回來的讀取不寫 zip、不記最後一次、不清理；備份的狀態不變', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  await settled(h);
  const before = h.backups.folder.size;
  const statusBefore = h.runner.status();
  // 第二次快照的最後一讀（data.json）卡住：之後已經沒有下一次讀取會攔住它。
  let release = (): void => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  let dataReads = 0;
  const reader: BackupReader = {
    list: () => h.reader.list(),
    read: async path => { if (path === DATA && ++dataReads === 2) await hold; return h.reader.read(path); },
  };
  const result = await restore(h, backup, [A], { before: () => h.runner.beforeRestore([backup.name], reader) });
  assert.match(result.stopped?.message ?? '', /超過時間/);
  release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.backups.folder.size, before);
  assert.equal(h.runner.status().last, statusBefore.last);
  assert.equal(h.runner.status().failure, statusBefore.failure);
  assert.equal(h.runner.status().ready, statusBefore.ready);
  assert.equal(h.runner.status().running, null);
});

void test('卡住（R23）：掃描卡組逾時之後，晚回來的舊掃描不再讀下一篇', async t => {
  const third = A.replace(/[^/]+$/, 'z-第三篇.md');
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb'), [third]: goal('cccccc') });
  const backup = await snapshot(h);
  h.remove(A);
  await settled(h);
  let release = (): void => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  const reads: string[] = [];
  const files = { ...h.files, readBytes: async (path: string) => { reads.push(path); if (reads.length === 1) await hold; return h.files.readBytes(path); } };
  const result = await restore(h, backup, [A], { files, timeout: 30 });
  assert.deepEqual(outcomes(result), [[A, '失敗']]);
  release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(reads.length, 1);
});

for (const step of ['prepare', 'write'] as const) void test(`卡住（R20）：現況備份放棄之後 ${step} 才回報失敗：算放棄，不關上一般寫入；期限內的失敗照舊算失敗`, async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  const statusBefore = h.runner.status();
  let release = (): void => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  (h.backups.host[step] as unknown) = async () => { await hold; throw Error('EPERM'); };
  const result = await restore(h, backup, [A]);
  assert.match(result.stopped?.message ?? '', /超過時間/);
  release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.runner.status().ready, statusBefore.ready);
  assert.equal(h.runner.status().failure, statusBefore.failure);
  assert.equal(h.runner.status().running, null);
  // 期限內的失敗：還是失敗，閘門關上。
  (h.backups.host[step] as unknown) = () => Promise.reject(Error('EPERM'));
  const failed = await restore(h, backup, [A]);
  assert.match(failed.stopped?.message ?? '', /EPERM/);
  assert.equal(h.runner.status().ready, false);
});

void test('交錯：掃描之前別篇剛出現同一個 ID：跳過，不造成重複；沒有內容的檔不用掃', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') });
  const backup = await snapshot(h);
  h.remove(A);
  await settled(h);
  const result = await restore(h, backup, [A], {
    noLinks: () => Promise.resolve(),
    current: async () => {
      const now = await readCurrent(h.reader, DATA);
      h.write(B, goal('bbbbbb') + goal('aaaaaa'));
      return now;
    },
  });
  assert.deepEqual(outcomes(result), [[A, '跳過']]);
  assert.match(result.files[0].reason, /aaaaaa 現在在/);
  assert.equal(h.texts.has(A), false);
});

void test('交錯：掃描時讀不到別篇算確定不了，跳過', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') });
  const backup = await snapshot(h);
  h.remove(A);
  await settled(h);
  const result = await restore(h, backup, [A], {
    current: async () => { const now = await readCurrent(h.reader, DATA); h.failing.add(B); return now; },
  });
  assert.deepEqual(outcomes(result), [[A, '跳過']]);
  assert.match(result.files[0].reason, /確定不了/);
  h.failing.delete(B);
});

void test('after：要先釋放 ID 的那篇沒寫成，後面的不寫，不造成重複', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') + goal('cccccc'), [B]: goal('bbbbbb') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa'));
  h.write(B, goal('bbbbbb') + goal('cccccc'));
  await settled(h);
  h.control.failReplace = path => path === B;
  const result = await restore(h, backup, [A, B]);
  assert.deepEqual(outcomes(result), [[A, '跳過'], [B, '失敗']]);
  assert.match(result.files[0].reason, /要先還原/);
  assert.deepEqual(allIds(h).sort(), ['aaaaaa', 'bbbbbb', 'cccccc']);
});

void test('閘門：還原時補 ID、AI 建檔回受阻，小考檔排在後面；不論成敗閘門都放開', async t => {
  const fresh = 'Essence Cards/國二上/新.md', quizzed = 'Essence Cards/學業/英文 L3.md';
  const h = await setup(t, { [A]: goal('aaaaaa'), [fresh]: '- 能說出 x\n    - Q :: A\n', [quizzed]: '---\n年級學期: 國二上\n科目: 英文\n單元: "L3"\n---\n- 目標 ^w1w1w1\n    - Q :: A\n' });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  await settled(h);
  let release = (): void => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  let fill: Promise<boolean> | undefined, create: ReturnType<State['aiCreate']> | undefined, quiz: ReturnType<State['setQuiz']> | undefined;
  let block: unknown, duringQuiz = true;
  const running = restore(h, backup, [A], {
    before: async () => {
      const done = await h.runner.beforeRestore([backup.name], h.reader);
      block = h.state.writeBlock();
      fill = h.state.fillIds(fresh);
      create = h.state.aiCreate('Essence Cards/國二上/AI.md', goal('dddddd'));
      quiz = h.state.setQuiz({ unit: { term: '國二上', subject: '英文', code: 'L3' } }, '2026-11-12', null);
      await hold;
      duringQuiz = [...h.texts.keys()].some(path => path.includes('/小考/'));
      return done;
    },
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.state.writeBlock(), 'restore');
  release();
  await running;
  assert.equal(block, 'restore');
  assert.equal(await fill, false);
  assert.deepEqual(await create, { kind: 'blocked', reason: 'restore' });
  assert.equal(h.texts.has('Essence Cards/國二上/AI.md'), false);
  assert.equal(h.texts.get(fresh), '- 能說出 x\n    - Q :: A\n');
  assert.equal(duringQuiz, false);
  assert.deepEqual(await quiz, { kind: 'done' });
  assert.equal([...h.texts.keys()].filter(path => path.includes('/小考/')).length, 1);
  assert.equal(h.state.writeBlock(), null);
  // 失敗時也放開。
  await assert.rejects(h.state.restore(() => Promise.reject(Error('壞了'))), /壞了/);
  assert.equal(h.state.writeBlock(), null);
});

void test('閘門：正在還原時再開一次丟錯，第一次不受影響', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  let release = (): void => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  const first = h.state.restore(() => hold);
  await assert.rejects(h.state.restore(() => Promise.resolve()));
  assert.equal(h.state.writeBlock(), 'restore');
  release();
  await first;
  assert.equal(h.state.writeBlock(), null);
});

// ---- §3-1 還原前的備份 ----

void test('還原前的備份失敗：一個檔都不寫，寫明是哪一步，閘門放開', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  h.backups.control.failPrepare = '外接硬碟拔掉了';
  const result = await restore(h, backup, [A]);
  assert.equal(result.backup, null);
  assert.equal(result.stopped?.step, '先備份現況');
  assert.match(result.stopped.message, /外接硬碟拔掉了/);
  assert.equal(h.texts.get(A), goal('aaaaaa', '改過'));
  assert.equal(h.state.writeBlock(), null);
});

void test('還原前的備份：by 是 restore、被蓋掉的內容在裡面；runner 正在做別份時另做一份', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '之後的編輯'));
  let release = (): void => {};
  h.backups.control.hold = new Promise<void>(resolve => { release = resolve; });
  const other = h.runner.backup();
  const count = h.backups.folder.size;
  const running = restore(h, backup, [A]);
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  h.backups.control.hold = null;
  await other;
  const result = await running;
  assert.deepEqual(outcomes(result), [[A, '已還原']]);
  assert.equal(h.backups.folder.size, count + 2);
  const taken = openBackup(h.backups.folder.get(result.backup!)!);
  assert.ok(taken.ok);
  assert.equal(taken.value.manifest.by, 'restore');
  assert.equal(decode(taken.value.files.get(A)!), goal('aaaaaa', '之後的編輯'));
});

void test('清理不刪正在用的那一份備份：最舊的那份，還原時留著，之後一般的備份照舊清掉', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  for (let i = 0; i < 9; i++) await h.runner.backup();
  h.write(A, goal('aaaaaa', '改過'));
  // 備份都同一刻：照檔名排，把正在用的那份改成排在最後才是最舊的。
  const oldest = [...h.backups.folder.keys()].sort()[0];
  const chosen = { name: oldest, opened: backup.opened };
  assert.equal(h.backups.folder.size, 10);
  await restore(h, chosen, [A]);
  assert.equal(h.backups.folder.has(oldest), true);
  await h.runner.backup();
  assert.equal(h.backups.folder.has(oldest), false);
});

// ---- §3-3 原始位元組 ----

void test('原始位元組（Node 的 vault）：圖片、BOM、CRLF、不合法的 UTF-8 逐位元相同', async t => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 255]);
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...encode('- 目標 ^aaaaaa\r\n    - Q :: A\r\n')]);
  const invalid = Uint8Array.from([0xe4, 0xb8, 0x41, 0xff, 0x0a]);
  const vault = await makeVault(t, {});
  const files = createNodeFiles(vault);
  const cases = { 'Essence Cards/圖/x.png': png, [A]: bom, 'Essence Cards/壞.txt': invalid };
  for (const [path, bytes] of Object.entries(cases)) {
    assert.equal(await files.replace(path, now => now === null, bytes), true, path);
    assert.deepEqual(new Uint8Array(await readFile(join(vault, path))), bytes, path);
    assert.deepEqual(await files.readBytes(path), bytes, path);
    assert.equal(await files.replace(path, () => false, encode('不寫')), false);
    assert.deepEqual(new Uint8Array(await readFile(join(vault, path))), bytes, path);
  }
});

// ---- §5 state ----

void test('§5 還原兩篇：訂閱者只收到一次通知，那時兩篇都還原了、閘門放開（L2 的 R7）', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa', '改過'));
  h.write(B, goal('bbbbbb', '改過'));
  await settled(h);
  const seen: [string | null, boolean][] = [];
  h.state.onChange(() => { seen.push([h.state.writeBlock(), JSON.stringify(h.state.decks()).includes('改過')]); });
  const result = await restore(h, backup, [A, B], { timeout: 1000 });
  assert.deepEqual(outcomes(result), [[A, '已還原'], [B, '已還原']]);
  await settled(h);
  assert.deepEqual(seen, [[null, false]]);
});

void test('state：還原拿掉的 ID 不跳待處理的問題；之後再出現也不算沒見過', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') });
  const backup = await snapshot(h);
  h.write(A, goal('aaaaaa') + goal('bbbbbb'));
  await settled(h);
  assert.deepEqual(h.state.deckTargets(A).length, 2);
  await restore(h, backup, [A]);
  assert.equal(h.state.deckTargets(A).length, 1);
  assert.deepEqual(issues(h, A), []);
  h.write(A, goal('aaaaaa') + goal('bbbbbb'));
  await settled(h);
  assert.deepEqual(issues(h, A), []);
});

void test('state：讀到還原檔時歷史、到期和紀錄本來就在時相同（共用 §5-3 的口徑）', async t => {
  const lines = [review(T, 'aaaaaa'), review(T2, 'aaaaaa', 'miss')];
  const h = await setup(t, { [A]: goal('aaaaaa'), [LOG]: lines.join('\n') + '\n' });
  const backup = await snapshot(h);
  const before = h.state.history();
  h.remove(LOG);
  await settled(h);
  assert.equal(h.state.history().reviews.length, 0);
  await restore(h, backup, []);
  assert.deepEqual(h.state.history().reviews, before.reviews);
  assert.deepEqual(h.state.history().seen, before.seen);
  assert.equal(h.texts.get(restoredLog('2026-11 iPhone-7f3a')), lines.join('\n') + '\n');
});

void test('紀錄只建新檔：撞到別的程序剛建的就換下一個編號，不動它', async t => {
  const line = review(T, 'aaaaaa');
  const h = await setup(t, { [A]: goal('aaaaaa'), [LOG]: line + '\n' });
  const backup = await snapshot(h);
  h.remove(LOG);
  const taken = restoredLog('2026-11 iPhone-7f3a');
  const files = {
    ...h.files,
    replace(path: string, check: (now: Uint8Array | null) => boolean, bytes: Uint8Array) {
      if (path === taken && !h.texts.has(taken)) h.texts.set(taken, '別人的');
      return h.files.replace(path, check, bytes);
    },
  };
  const result = await restore(h, backup, [], { files });
  assert.equal(h.texts.get(taken), '別人的');
  assert.equal(result.logs.length, 1);
  assert.equal(result.logs[0].outcome, '已還原');
  assert.notEqual(result.logs[0].path, taken);
  assert.equal(h.texts.get(result.logs[0].path!), line + '\n');
});

void test('data.json：最後寫，帶比對時的 sha；changed 記成跳過，不同的路徑不走 Files', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') }, '{"capMinutes":30}');
  const backup = await snapshot(h);
  h.data.bytes = encode('{"capMinutes":45}');
  const sha = hashBytes(h.data.bytes);
  const calls: [string, string | null][] = [];
  const result = await restore(h, backup, [DATA], { settings: (bytes, expected) => { calls.push([decode(bytes), expected]); return Promise.resolve('changed'); } });
  assert.deepEqual(calls, [['{"capMinutes":30}', sha]]);
  assert.deepEqual(outcomes(result), [[DATA, '跳過']]);
  assert.equal(h.texts.has(DATA), false);
});

void test('設定寫不進去、讀不到：記進錯誤紀錄（L2 的 R10）', async t => {
  for (const [saved, text] of [['failed', '設定寫不進去'], ['unreadable', '設定暫時讀不到']] as const) {
    const h = await setup(t, { [A]: goal('aaaaaa') }, '{"capMinutes":30}');
    const backup = await snapshot(h);
    h.data.bytes = encode('{"capMinutes":45}');
    const result = await restore(h, backup, [DATA], { settings: () => Promise.resolve(saved) });
    assert.deepEqual(outcomes(result), [[DATA, '失敗']]);
    assert.match(h.failures[0], new RegExp('寫設定：' + text));
  }
});

void test('data.json：寫之前再查路徑上的連結，有連結就不寫（L2 的 R4）', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa') }, '{"capMinutes":30}');
  const backup = await snapshot(h);
  h.data.bytes = encode('{"capMinutes":45}');
  let wrote = false;
  const result = await restore(h, backup, [DATA], {
    noLinks: path => path === DATA ? Promise.reject(Error('路徑上有連結')) : Promise.resolve(),
    settings: () => { wrote = true; return Promise.resolve('saved'); },
  });
  assert.deepEqual(outcomes(result), [[DATA, '失敗']]);
  assert.equal(wrote, false);
  assert.match(h.failures[0], /寫設定：路徑上有連結/);
});

void test('備份行的 NUL 當成斷行（R14）：不會拼出備份裡沒有的作答，完整的物件救回來', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [LOG]: review(T, 'aaaaaa') + '\n' });
  const { opened } = await snapshot(h);
  const planned = async (backup: ReadonlyMap<string, Uint8Array>) => planRestore({ manifest: opened.manifest, backup, current: await readCurrent(h.reader, DATA), ...OPTIONS, selection: new Set() });
  const whole = review(T2, 'abcdef');
  const [head, tail] = whole.replace('abcdef', 'abc\0def').split('\0');
  const inside = new Map(opened.files).set(LOG, encode(review(T, 'aaaaaa') + '\n' + head + '\0' + tail + '\n'));
  h.remove(LOG);
  const cut = (await planned(inside)).logs[0].lines;
  assert.deepEqual(cut, [review(T, 'aaaaaa'), head, tail]);
  for (const piece of cut.slice(1)) assert.throws(() => JSON.parse(piece) as unknown);
  // 中間一段 0：兩邊完整的物件都救得回來。
  const two = review(T2, 'bbbbbb', 'miss');
  const block = new Map(opened.files).set(LOG, encode(review(T, 'aaaaaa') + '\0\0\0' + two + '\n'));
  assert.deepEqual((await planned(block)).logs[0].lines, [review(T, 'aaaaaa'), two]);
  // 檔案之後下載完了：切出來的片段都在現在的行裡，不算缺。
  h.write(LOG, review(T, 'aaaaaa') + '\n' + whole + '\n');
  assert.deepEqual((await planned(inside)).logs, []);
});

void test('現況壞行裡看得到字面、重播卻讀不到的作答要補（R22）；讀得到的不補', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [LOG]: review(T, 'aaaaaa') + '\n' });
  const { opened } = await snapshot(h);
  const planned = async (backup: ReadonlyMap<string, Uint8Array>) => planRestore({ manifest: opened.manifest, backup, current: await readCurrent(h.reader, DATA), ...OPTIONS, selection: new Set() });
  const first = review(T2, 'bbbbbb'), second = review(T2.replace('10:', '11:'), 'cccccc');
  const backup = new Map(opened.files).set(LOG, encode(first + '\0' + second + '\n'));
  // 寫入中斷的開頭接著兩筆：重播只救回最後一筆，前一筆只是字面上看得到。
  h.write(LOG, first.slice(0, 12) + first + second + '\n');
  assert.deepEqual((await planned(backup)).logs, [{ source: '2026-11 iPhone-7f3a', lines: [first] }]);
  // 兩筆完整地黏在同一行，或各自一行：重播都讀得到，不補。
  h.write(LOG, first + second + '\n');
  assert.deepEqual((await planned(backup)).logs, []);
  h.write(LOG, first + '\n' + second + '\n');
  assert.deepEqual((await planned(backup)).logs, []);
});

void test('只有 NUL 的行不算（R3），最後一行的開頭規則照切開之後的段算', async t => {
  const h = await setup(t, { [A]: goal('aaaaaa'), [LOG]: review(T, 'aaaaaa') + '\n' });
  const { opened } = await snapshot(h);
  const whole = review(T2, 'bbbbbb');
  const half = whole.slice(0, 30);
  const dirty = new Map(opened.files).set(LOG, encode(review(T, 'aaaaaa') + '\n' + half + '\0\0\n\0\0\n'));
  h.remove(LOG);
  const planned = async (backup: ReadonlyMap<string, Uint8Array>) => planRestore({ manifest: opened.manifest, backup, current: await readCurrent(h.reader, DATA), ...OPTIONS, selection: new Set() });
  assert.deepEqual((await planned(dirty)).logs, [{ source: '2026-11 iPhone-7f3a', lines: [review(T, 'aaaaaa'), half] }]);
  // 切開之後的最後一段是現在某一行的開頭：備份時正在寫那一行，不算缺。
  h.write(LOG, review(T, 'aaaaaa') + '\n' + whole + '\n');
  assert.deepEqual((await planned(dirty)).logs, []);
});

void test('現況不完整（R3）：筆記或月檔含 NUL 算讀不到，比對與寫前都停；圖片可以有 0', async t => {
  const png = 'Essence Cards/圖/x.png';
  const h = await setup(t, { [A]: goal('aaaaaa'), [B]: goal('bbbbbb'), [LOG]: review(T, 'aaaaaa') + '\n', [png]: 'a\0b' });
  const backup = await snapshot(h);
  await readCurrent(h.reader, DATA);
  h.write(B, '\0'.repeat(20));
  await assert.rejects(readCurrent(h.reader, DATA), new RegExp(B + ' 的內容不完整.*把這個檔刪掉'));
  h.write(B, goal('bbbbbb'));
  h.write(LOG, review(T, 'aaaaaa') + '\n\0\0');
  await assert.rejects(readCurrent(h.reader, DATA), /的內容不完整/);
  h.write(LOG, review(T, 'aaaaaa') + '\n');
  await settled(h);
  h.write(A, goal('aaaaaa', '改過'));
  const gate = await restore(h, backup, [A], {}, () => { h.write(B, '\0'.repeat(20)); });
  assert.equal(gate.stopped?.step, '讀 vault');
  assert.match(gate.stopped.message, /內容不完整/);
  assert.equal(h.texts.get(A), goal('aaaaaa', '改過'));
  h.write(B, goal('bbbbbb'));
  h.remove(A);
  await settled(h);
  const scanned = await restore(h, backup, [A], { current: async () => { const now = await readCurrent(h.reader, DATA); h.write(B, '\0'.repeat(20)); return now; } });
  assert.deepEqual(outcomes(scanned), [[A, '跳過']]);
  assert.match(scanned.files[0].reason, /確定不了/);
  assert.equal(h.texts.has(A), false);
  h.write(B, goal('bbbbbb'));
  await settled(h);
  const ghost = 'Essence Cards/國二上/鬼.md';
  const listed = await restore(h, backup, [A], { files: { ...h.files, list: async folder => [...await h.files.list(folder), ghost] } });
  assert.deepEqual(outcomes(listed), [[A, '跳過']]);
  assert.match(listed.files[0].reason, /鬼\.md.*確定不了/);
});
