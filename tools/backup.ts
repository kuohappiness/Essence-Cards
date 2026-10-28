import { randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { BACKUP_FORMAT, BACKUP_SCOPE, BACKUP_VERSION, ESSENCE_ROOT, PLUGIN_DATA, backupName, hashBytes, openBackup, readBuild, writeZip } from '../src/core/backup/index.ts';
import type { BackupManifest } from '../src/core/backup/index.ts';
import { isDeckPath, parseDeck } from '../src/core/deck/index.ts';
import { formatTime, isLogPath } from '../src/core/study/index.ts';
import { buildVersion } from './build.mjs';
import { defaultBackupFolder, isInside, listTree, pluginConfig, readError, realTarget } from './vault-io.ts';

/** 清單的 by（syntax §8）。 */
export type BackupBy = 'backup' | 'update-vault' | 'restore';
export interface BackupOptions {
  vault: string;
  /** 備份資料夾；預設是 defaultBackupFolder。不能在 vault 裡。 */
  to?: string;
  /** 設定資料夾，預設 .obsidian；裡面要有 plugins/essence-cards/manifest.json。 */
  config?: string;
  by: BackupBy;
  now?: () => number;
  offset?: (ms: number) => number;
  /** 檔名的隨機 4 碼。 */
  random?: () => string;
  /** 測試用：讀檔的替身（模擬讀不到）、每一輪讀完之後的時機（模擬中途被改）、寫 zip 的替身（模擬寫壞）。 */
  seams?: {
    read?: (path: string) => Promise<Uint8Array>;
    afterRead?: (attempt: number) => Promise<void> | void;
    write?: (path: string, bytes: Uint8Array) => Promise<void>;
  };
}
export interface BackupResult { path: string; manifest: BackupManifest; attempts: number }

const ATTEMPTS = 3;
const portable = (path: string): string => path.replaceAll('\\', '/');
const startsWith = (whole: Uint8Array, head: Uint8Array): boolean => head.length <= whole.length && head.every((byte, i) => whole[i] === byte);
/** 讀的時候檔案不見了：算檔案在變，整份重來。 */
class Moved extends Error {}

interface Snapshot { files: Map<string, Uint8Array>; absent: string[] }

async function snapshot(vault: string, config: string, read: (path: string) => Promise<Uint8Array>): Promise<Snapshot> {
  const files = new Map<string, Uint8Array>();
  const absent: string[] = [];
  const data = config + '/' + PLUGIN_DATA;
  for (const path of [...await listTree(vault, ESSENCE_ROOT), data]) {
    try { files.set(path, await read(join(vault, path))); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw readError(path, error);
      if (path === data) absent.push(path);
      else throw new Moved(readError(path, error).message);
    }
  }
  return { files, absent };
}

/** 讀完重新列檔、重新算雜湊：集合要相同，每個檔要相同；紀錄只多了後面的行可以，用舊的內容。不同時回傳原因。 */
function unstable(first: Snapshot, second: Snapshot): string | null {
  if (first.absent.join('\n') !== second.absent.join('\n')) return 'data.json 在備份的時候出現或不見了';
  for (const path of second.files.keys()) if (!first.files.has(path)) return path + ' 在備份的時候出現了';
  for (const [path, bytes] of first.files) {
    const now = second.files.get(path);
    if (!now) return path + ' 在備份的時候不見了';
    if (hashBytes(now) === hashBytes(bytes)) continue;
    if (isLogPath(path) && startsWith(now, bytes)) continue;
    return path + ' 在備份的時候改了';
  }
  return null;
}

/** 卡組的學習目標 ID 與題目指紋：zip 裡的和讀進來的要相同（D-150 第 5 點）。 */
const signature = (bytes: Uint8Array): string =>
  JSON.stringify(parseDeck(new TextDecoder().decode(bytes)).targets.map(target => [target.id, target.prompts.map(prompt => prompt.fingerprint)]));

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * 備份 `Essence Cards/` 全部與外掛的 data.json 到 vault 外（D-150 第 5 點、syntax §8；過渡工具不排除任何檔案）。
 * 任何一步失敗就整份失敗，不留正式檔名：讀原始位元組 → 讀完重新列檔與比雜湊（不穩定就整份重來，最多 3 次）→
 * 寫成暫存檔 → 讀回比雜湊、用 parseDeck 比學習目標 ID 與題目指紋 → 改成正式檔名。
 */
export async function backupVault(options: BackupOptions): Promise<BackupResult> {
  const now = options.now ?? Date.now;
  const offsetOf = options.offset ?? (ms => -new Date(ms).getTimezoneOffset());
  const random = options.random ?? (() => randomBytes(2).toString('hex'));
  const read = options.seams?.read ?? (async (path: string) => new Uint8Array(await readFile(path)));
  const write = options.seams?.write ?? ((path: string, bytes: Uint8Array) => writeFile(path, bytes, { flag: 'wx' }));
  const vault = await realpath(options.vault);
  if (!(await stat(vault)).isDirectory()) throw Error('vault 必須是已存在的資料夾');
  const config = await pluginConfig(vault, options.config);
  const folder = await realTarget(options.to ?? defaultBackupFolder(basename(vault)));
  if (isInside(folder, vault)) throw Error(`備份位置 ${folder} 在 vault 裡（以實際路徑判斷），不能放在 vault 裡`);
  await mkdir(folder, { recursive: true });
  if (isInside(await realpath(folder), vault)) throw Error(`備份位置 ${folder} 在 vault 裡（以實際路徑判斷），不能放在 vault 裡`);

  let main: string | null = null;
  try { main = await readFile(join(vault, config, 'plugins/essence-cards/main.js'), 'utf8'); } catch { /* 沒裝 main.js：build 是 null */ }
  const build = main === null ? null : readBuild(main).build;
  const tool = await buildVersion();

  let taken: Snapshot | null = null;
  let started = 0;
  let attempts = 0;
  let reason = '';
  while (!taken && attempts < ATTEMPTS) {
    attempts++;
    started = Math.trunc(now());
    try {
      const first = await snapshot(vault, config, read);
      await options.seams?.afterRead?.(attempts);
      const why = unstable(first, await snapshot(vault, config, read));
      if (why === null) taken = first;
      else reason = why;
    } catch (error) {
      if (!(error instanceof Moved)) throw error;
      reason = error.message;
    }
  }
  if (!taken) throw Error(`檔案一直在變，試了 ${ATTEMPTS} 次都沒有穩定的一份：${reason}`);

  const notes: BackupManifest['notes'] = [];
  for (const [path, bytes] of taken.files) {
    if (!isDeckPath(path)) continue;
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
      notes.push({ path, message: '不是 UTF-8 文字，照原樣備份' });
      continue;
    }
    const errors = parseDeck(text).problems.filter(problem => problem.level === 'error');
    if (errors.length) notes.push({ path, message: '原本就有語法問題，照原樣備份（' + [...new Set(errors.map(problem => problem.code))].join('、') + '）' });
  }
  const offset = offsetOf(started);
  const finished = Math.max(Math.trunc(now()), started);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION,
    vault: { name: basename(vault), path: portable(vault), config },
    build, tool, by: options.by,
    started: formatTime(started, offset), finished: formatTime(finished, offsetOf(finished)),
    scope: BACKUP_SCOPE,
    files: [...taken.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, size: bytes.length, sha256: hashBytes(bytes) })),
    absent: taken.absent, excluded: [], notes,
  };
  const zip = writeZip(manifest, taken.files, new Date(started));

  let name = '';
  for (let i = 0; i < 20 && !name; i++) {
    const candidate = backupName(started, offset, build, random());
    if (!await exists(join(folder, candidate)) && !await exists(join(folder, candidate + '.tmp'))) name = candidate;
  }
  if (!name) throw Error('找不到沒用過的備份檔名');
  const path = join(folder, name);
  const temporary = path + '.tmp';
  try {
    await write(temporary, zip);
    const opened = openBackup(new Uint8Array(await readFile(temporary)));
    if (!opened.ok) throw Error('寫好的備份讀回來不對：' + opened.error);
    if (JSON.stringify(opened.value.manifest) !== JSON.stringify(manifest)) throw Error('寫好的備份讀回來的清單不同');
    for (const [file, bytes] of taken.files) {
      const back = opened.value.files.get(file);
      if (!back || hashBytes(back) !== hashBytes(bytes)) throw Error('寫好的備份讀回來 ' + file + ' 的雜湊不同');
      if (isDeckPath(file) && signature(back) !== signature(bytes)) throw Error('寫好的備份讀回來 ' + file + ' 的學習目標或題目不同');
    }
    if (await exists(path)) throw Error(path + ' 已經存在，不覆寫');
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return { path, manifest, attempts };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { to: { type: 'string' }, config: { type: 'string' } } });
  if (positionals.length !== 1) throw Error('用法：npm run backup -- <vault> [--to <資料夾>] [--config <設定資料夾>]');
  const result = await backupVault({ vault: positionals[0], to: values.to, config: values.config, by: 'backup' });
  const bytes = result.manifest.files.reduce((sum, file) => sum + file.size, 0);
  console.log(`已備份：${result.path}（${result.manifest.files.length} 個檔，${bytes} bytes${result.attempts > 1 ? `，檔案在變，第 ${result.attempts} 次才穩定` : ''}）`);
  for (const path of result.manifest.absent) console.log('當時不存在：' + path);
  for (const note of result.manifest.notes) console.log(`記下：${note.path}：${note.message}`);
}
