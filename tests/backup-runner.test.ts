import test from 'node:test';
import assert from 'node:assert/strict';
import { backupName, createBackupRunner, filesReader, hashBytes, openBackup, staleBackups } from '../src/core/backup/index.ts';
import type { BackupHost, BackupManifest, BackupStatus, LastBackup, StoredBackup } from '../src/core/backup/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import { goal } from './helpers/vault.ts';

// 外掛內的備份 §1-4、§1-6、§1-7、§1-9：什麼時候備份、同時只做一份、失敗與清理。主機（src/desktop）換成記憶體裡的替身。

const DECK = 'Essence Cards/國二上/自然/2-3 濃度.md';
const DAY = 24 * 60 * 60 * 1000;
// 2026-11-02 20:15:03.250 +08:00
const NOW = Date.UTC(2026, 10, 2, 12, 15, 3, 250);
const VAULT = { name: 'Essence', path: 'D:/Notes/Essence' };
const DEFAULT = 'C:/備份/Essence';

/**
 * 記憶體裡的備份資料夾：檔名照 syntax §8 產生。failPrepare 讓「準備備份位置」失敗（failTimes 是只失敗前幾次），holdPrepare、holdList
 * 讓準備位置、清理時的列檔停在半路；failRemove 裡的檔刪不掉。prepares、removes 記呼叫次數。
 */
function memoryHost() {
  const folders = new Map<string, Map<string, Uint8Array>>();
  const control = {
    failPrepare: null as string | null, failTimes: Infinity, holdPrepare: null as Promise<void> | null, holdList: null as Promise<void> | null,
    failRemove: new Set<string>(), writes: 0, codes: 0, prepares: 0, removes: 0, lists: 0,
  };
  const folder = (path: string): Map<string, Uint8Array> => {
    if (!folders.has(path)) folders.set(path, new Map());
    return folders.get(path)!;
  };
  const host: BackupHost = {
    vault: VAULT,
    key: path => path.toLowerCase(),
    async prepare(path) {
      control.prepares++;
      if (control.holdPrepare) await control.holdPrepare;
      if (control.failPrepare && control.failTimes-- > 0) throw Error(control.failPrepare);
      folder(path);
      return path;
    },
    write(path, taken) {
      control.writes++;
      const name = backupName(taken.started, taken.offset, taken.manifest.build, (0xa000 + control.codes++).toString(16));
      folder(path).set(name, taken.zip);
      return Promise.resolve(name);
    },
    async list(path) {
      control.lists++;
      if (control.holdList) await control.holdList;
      return [...folder(path)].flatMap(([name, bytes]) => {
        const opened = openBackup(bytes);
        return opened.ok ? [{ name, size: bytes.length, sha256: hashBytes(bytes), manifest: opened.value.manifest }] : [];
      });
    },
    read: (path, name) => Promise.resolve(folders.get(path)?.get(name) ?? null),
    remove(path, backup) {
      control.removes++;
      if (control.failRemove.has(backup.name)) return Promise.reject(Error('刪不掉'));
      folder(path).delete(backup.name);
      return Promise.resolve();
    },
  };
  return { host, folders, folder, control };
}

function setup(options: { build?: string; last?: LastBackup | null; now?: () => number; memory?: ReturnType<typeof memoryHost> } = {}) {
  const files = createMemoryFiles({ [DECK]: goal('abc123') });
  const memory = options.memory ?? memoryHost();
  const saved: { last: LastBackup | null } = { last: options.last ?? null };
  const statuses: BackupStatus[] = [];
  let now = options.now ?? (() => NOW);
  const runner = createBackupRunner({
    host: memory.host, reader: filesReader(files.files, '.obsidian', () => Promise.resolve(null)),
    config: '.obsidian', build: options.build ?? '0.2.0+1a2b3c4', defaultFolder: DEFAULT,
    store: { folder: () => null, last: () => saved.last, saveLast: last => { saved.last = last; } },
    now: () => now(), offset: () => 480,
    onStatus: status => { statuses.push(status); },
  });
  return { runner, memory, saved, statuses, files, setNow: (fn: () => number) => { now = fn; } };
}
const byOf = (memory: ReturnType<typeof memoryHost>): string[] =>
  [...memory.folder(DEFAULT).values()].map(bytes => { const opened = openBackup(bytes); return opened.ok ? opened.value.manifest.by : 'broken'; });

void test('時機：沒有記錄（新的 BUILD、localStorage 被清掉）時做 new-version，成功後打開閘門並記下這一份', async () => {
  const { runner, memory, saved } = setup();
  assert.equal(runner.status().ready, false);
  await runner.check();
  assert.deepEqual(byOf(memory), ['new-version']);
  assert.equal(runner.status().ready, true);
  assert.equal(runner.status().failure, null);
  const [name, bytes] = [...memory.folder(DEFAULT)][0];
  assert.deepEqual(saved.last, { build: '0.2.0+1a2b3c4', time: NOW, name, sha256: hashBytes(bytes), folder: DEFAULT });
});

void test('時機：同一個 BUILD 重開、記的那份還在、30 天內不再備份，閘門直接打開', async () => {
  const first = setup();
  await first.runner.check();
  const again = setup({ memory: first.memory, last: first.saved.last, now: () => NOW + 30 * DAY });
  await again.runner.check();
  assert.equal(first.memory.control.writes, 1);
  assert.equal(again.runner.status().ready, true);
});

void test('時機：記的那份不見了、雜湊不同、BUILD 不同，都重做 new-version', async () => {
  const first = setup();
  await first.runner.check();
  const last = first.saved.last!;
  first.memory.folder(DEFAULT).delete(last.name);
  const gone = setup({ memory: first.memory, last });
  await gone.runner.check();
  assert.deepEqual(byOf(first.memory), ['new-version']);
  const changed = setup({ memory: first.memory, last: { ...gone.saved.last!, sha256: '0'.repeat(64) } });
  await changed.runner.check();
  const other = setup({ memory: first.memory, last: changed.saved.last, build: '0.3.0+9f8e7d6' });
  await other.runner.check();
  assert.equal(first.memory.control.writes, 4);
  assert.deepEqual(byOf(first.memory), ['new-version', 'new-version', 'new-version']);
});

void test('時機：恰好 30 天不做，超過才補做 monthly；新版與每月同時符合時記 new-version', async () => {
  const first = setup();
  await first.runner.check();
  const exactly = setup({ memory: first.memory, last: first.saved.last, now: () => NOW + 30 * DAY });
  await exactly.runner.check();
  assert.equal(first.memory.control.writes, 1);
  const later = setup({ memory: first.memory, last: first.saved.last, now: () => NOW + 30 * DAY + 1 });
  await later.runner.check();
  assert.deepEqual(byOf(first.memory).sort(), ['monthly', 'new-version']);
  const both = setup({ memory: first.memory, last: later.saved.last, build: '0.3.0+9f8e7d6', now: () => NOW + 90 * DAY });
  await both.runner.check();
  assert.deepEqual(byOf(first.memory).sort(), ['monthly', 'new-version', 'new-version']);
});

void test('同時兩個要求只做一份：check 與「立即備份」一起來，等著的拿同一個結果；前一份失敗時等著的也是失敗', async () => {
  const { runner, memory } = setup();
  await Promise.all([runner.check(), runner.backup(), runner.backup()]);
  assert.equal(memory.control.writes, 1);
  assert.equal(runner.status().ready, true);
  const failing = setup();
  failing.memory.control.failPrepare = '外接硬碟沒接上';
  await Promise.all([failing.runner.check(), failing.runner.backup()]);
  assert.equal(failing.memory.control.writes, 0);
  assert.equal(failing.runner.status().ready, false);
  assert.deepEqual({ ...failing.runner.status().failure, time: 0 }, { by: 'new-version', step: '準備備份位置', message: '外接硬碟沒接上', time: 0 });
});

void test('失敗：閘門關著、不刪既有的備份；之後成功就恢復；手動備份失敗後，30 天內的 check 不會自己打開', async () => {
  const first = setup();
  await first.runner.check();
  const run = setup({ memory: first.memory, last: first.saved.last });
  await run.runner.check();
  assert.equal(run.runner.status().ready, true);
  run.memory.control.failPrepare = '外接硬碟沒接上';
  await run.runner.backup();
  assert.equal(run.runner.status().ready, false);
  assert.equal(run.runner.status().failure?.by, 'manual');
  assert.equal(first.memory.folder(DEFAULT).size, 1);
  await run.runner.check();
  assert.equal(run.runner.status().ready, false);
  run.memory.control.failPrepare = null;
  await run.runner.backup();
  assert.equal(run.runner.status().ready, true);
  assert.equal(run.runner.status().failure, null);
});

void test('失敗：讀不到 vault 裡的檔時寫出是哪一步、哪個檔（D-154）', async () => {
  const { runner, files } = setup();
  files.failing.add(DECK);
  await runner.check();
  const failure = runner.status().failure!;
  assert.equal(failure.step, '讀 vault');
  assert.match(failure.message, /^讀不到 Essence Cards\/國二上\/自然\/2-3 濃度\.md（/);
});

void test('清理：新備份成功後刪掉超過保留的；刪不掉的記下來，備份仍算成功；新備份失敗時不清理', async () => {
  const memory = memoryHost();
  let now = NOW;
  const { runner, saved } = setup({ memory, now: () => now });
  for (let i = 0; i < 12; i++) { now = NOW + i * 60_000; await runner.backup(); }
  // 同一個月的 12 份：留最新 10 份（月底那份也在裡面）。
  assert.equal(memory.folder(DEFAULT).size, 10);
  const oldest = [...memory.folder(DEFAULT).keys()].sort()[0];
  memory.control.failRemove.add(oldest);
  now = NOW + 20 * 60_000;
  await runner.backup();
  assert.equal(runner.status().ready, true);
  assert.equal(saved.last?.time, now);
  assert.deepEqual(runner.status().cleanup, [oldest + '：刪不掉']);
  memory.control.failPrepare = '外接硬碟沒接上';
  const before = memory.folder(DEFAULT).size;
  await runner.backup();
  assert.equal(memory.folder(DEFAULT).size, before);
});

void test('取消：外掛停用之後，進行中的備份不寫、不再通知', async () => {
  const { runner, memory, statuses, files } = setup();
  // 讀 vault 的第一步（列出卡組）停在半路，這時停用外掛。
  const list = files.files.list.bind(files.files);
  let release = (): void => {};
  files.files.list = folder => new Promise(resolve => { release = () => { resolve(list(folder)); }; });
  const done = runner.check();
  await new Promise(resolve => setImmediate(resolve));
  const seen = statuses.length;
  runner.cancel();
  release();
  await done;
  assert.equal(memory.control.writes, 0);
  assert.equal(statuses.length, seen);
});

// ── 保留（D-150 第 6 點、任務說明 §1-7、syntax §8「自動清理只認完整的備份」）──

function stored(started: string, options: { build?: string | null; code?: string; vault?: Partial<BackupManifest['vault']>; name?: string } = {}): StoredBackup {
  const build = options.build === undefined ? '0.2.0+1a2b3c4' : options.build;
  const code = options.code ?? 'a3f9';
  const vault = { ...VAULT, config: '.obsidian', ...options.vault };
  const manifest = { format: 'essence-cards-backup', version: 1, vault, build, tool: '0.2.0+1a2b3c4', by: 'monthly', started, finished: started, scope: '', files: [], absent: [], excluded: [], notes: [] } as BackupManifest;
  const time = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(started)!;
  const known = build !== null && /^\d+\.\d+\.\d+(\+[0-9a-f]{4,40}(\.dirty)?)?$/.test(build) ? build : '未知';
  return { name: options.name ?? `Essence Cards 備份 ${time[1]} ${time[2]}${time[3]}${time[4]} ${known} ${code}.zip`, size: 1, sha256: '0'.repeat(64), manifest };
}
const stale = (backups: StoredBackup[], keep = 'x'): string[] => staleBackups(backups, VAULT, path => path.toLowerCase(), keep).map(backup => backup.manifest.started).sort();

void test('保留：同一個月 12 份留最新 10 份；每月一份的 15 個月全部留下', () => {
  const sameMonth = Array.from({ length: 12 }, (_, i) => stored(`2026-10-${String(i + 1).padStart(2, '0')}T10:00:00.000+08:00`));
  assert.deepEqual(stale(sameMonth), ['2026-10-01T10:00:00.000+08:00', '2026-10-02T10:00:00.000+08:00']);
  const monthly = Array.from({ length: 15 }, (_, i) => stored(`${2025 + Math.floor((i + 9) / 12)}-${String((i + 9) % 12 + 1).padStart(2, '0')}-15T10:00:00.000+08:00`));
  assert.deepEqual(stale(monthly), []);
});

void test('保留：舊的月份只留每月最後一份；月份照各份 started 自己記的當地月份（跨月的 finished 不算）', () => {
  const recent = Array.from({ length: 10 }, (_, i) => stored(`2026-11-${String(i + 10).padStart(2, '0')}T10:00:00.000+08:00`));
  const october = [stored('2026-10-05T10:00:00.000+08:00'), stored('2026-10-31T23:59:59.000+08:00')];
  // 開始在 10 月、寫完在 11 月：算 10 月。
  october[1].manifest.finished = '2026-11-01T00:00:01.000+08:00';
  assert.deepEqual(stale([...recent, ...october]), ['2026-10-05T10:00:00.000+08:00']);
});

void test('保留：照絕對時間排序，不照字串；同一毫秒照檔名', () => {
  const recent = Array.from({ length: 9 }, (_, i) => stored(`2026-11-${String(i + 10).padStart(2, '0')}T10:00:00.000+00:00`));
  // 字串上 -02:00 那份比較早，換成絕對時間（11-01 01:30Z）其實比較晚：它進最新 10 份，另一份是 11 月裡最早的、被刪。
  const late = stored('2026-10-31T23:30:00.000-02:00');
  const early = stored('2026-11-01T01:00:00.000+00:00');
  assert.deepEqual(stale([...recent, late, early]), ['2026-11-01T01:00:00.000+00:00']);
  const tie = Array.from({ length: 9 }, (_, i) => stored(`2026-11-${String(i + 10).padStart(2, '0')}T10:00:00.000+00:00`));
  const a = stored('2026-11-01T01:00:00.000+00:00', { code: 'aaaa' }), b = stored('2026-11-01T01:00:00.000+00:00', { code: 'bbbb' });
  assert.deepEqual(staleBackups([...tie, a, b], VAULT, path => path.toLowerCase(), 'x').map(backup => backup.name), [a.name]);
});

void test('保留：別的 vault、同名不同路徑、檔名和清單對不上、BUILD 寫法不對的都不刪；同路徑不同 config、路徑大小寫不同算同一個', () => {
  const recent = Array.from({ length: 10 }, (_, i) => stored(`2026-11-${String(i + 10).padStart(2, '0')}T10:00:00.000+08:00`));
  const old = '2026-11-01T10:00:00.000+08:00';
  const others = [
    stored(old, { vault: { name: 'Other', path: 'D:/Notes/Other' } }),
    stored(old, { vault: { path: 'E:/Moved/Essence' } }),
    stored(old, { name: 'Essence Cards 備份 2026-11-01 100000 0.2.0+1a2b3c4 a3f9 2.zip' }),
    stored(old, { name: 'Essence Cards 備份 2026-11-01 100001 0.2.0+1a2b3c4 a3f9.zip' }),
    stored(old, { build: 'weird', name: 'Essence Cards 備份 2026-11-01 100000 未知 a3f9.zip' }),
  ];
  assert.deepEqual(stale([...recent, ...others]), []);
  const sameVault = [stored(old, { vault: { config: '.obsidian-family' }, code: 'c0c0' }), stored(old, { vault: { path: 'd:/notes/essence' }, code: 'c1c1' })];
  assert.deepEqual(stale([...recent, ...sameVault]), [old, old]);
});

void test('保留：這次成功的那一份一定留（時鐘倒退、資料夾裡有未來時間的備份時）', () => {
  const future = Array.from({ length: 10 }, (_, i) => stored(`2027-01-${String(i + 10).padStart(2, '0')}T10:00:00.000+08:00`));
  // 這次的那份比同一個月的另一份早，不在最新 10 份、也不是月底那份：只有 keep 留住它。
  const now = stored('2026-11-01T10:00:00.000+08:00');
  const later = stored('2026-11-20T10:00:00.000+08:00', { code: 'b0b0' });
  assert.deepEqual(stale([...future, later, now]), ['2026-11-01T10:00:00.000+08:00']);
  assert.deepEqual(stale([...future, later, now], now.name), []);
});

// ── Codex L2 的回歸（Claude Codex Discussion/2026-10-30-plugin-backup-1-review.md）──

/** 等到 until() 成立（每次讓出一輪事件迴圈），最多 200 輪。 */
async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !until(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(until(), '等不到預期的狀態');
}

void test('L2 B1：同次載入發現記的那份失效（被刪掉）時，重做之前先關閘門；新備份完成前一直關著', async () => {
  const { runner, memory, saved, statuses } = setup();
  await runner.check();
  assert.equal(runner.status().ready, true);
  memory.folder(DEFAULT).delete(saved.last!.name);
  let release = (): void => {};
  memory.control.holdPrepare = new Promise(resolve => { release = resolve; });
  const seen = statuses.length;
  const done = runner.check();
  await settle(() => runner.status().running === 'new-version');
  assert.equal(runner.status().ready, false);
  assert.ok(statuses.slice(seen).some(status => !status.ready), 'onStatus 要送出 ready: false，外掛才會關 state 的閘門');
  release();
  await done;
  assert.equal(runner.status().ready, true);
});
