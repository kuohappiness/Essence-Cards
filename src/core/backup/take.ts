import { isDeckPath, parseDeck } from '../deck/index.ts';
import type { Files } from '../files.ts';
import { formatTime, isLogPath } from '../study/index.ts';
import { BACKUP_FORMAT, BACKUP_SCOPE, BACKUP_VERSION, ESSENCE_ROOT, PLUGIN_DATA } from './manifest.ts';
import type { BackupManifest } from './manifest.ts';
import { hashBytes, openBackup, writeZip } from './zip.ts';

/**
 * 做備份時讀 vault 的一方（D-150 第 5 點）：過渡工具用 Node 讀磁碟，外掛用 Files 與設定資料夾的 adapter。
 * 讀檔與寫檔由呼叫的一方傳進來，這裡只管讀兩次比對、清單與 zip、讀回檢查，電腦與手機都能載入。
 */
export interface BackupReader {
  /** `Essence Cards/` 底下所有檔（vault 相對路徑、`/` 分隔）；不存在時是空的。 */
  list(): Promise<string[]>;
  /** 原始位元組；不存在是 null（列出來的檔讀的時候不見了，算檔案在變）；讀不到就丟錯，訊息寫出是哪個檔、什麼原因（D-154）。 */
  read(path: string): Promise<Uint8Array | null>;
}

/**
 * 外掛讀 vault 的一方：`Essence Cards/` 經 Files（D-110）；data.json 在設定資料夾，不在 Obsidian 的檔案索引裡，由 readData
 * 讀（Obsidian 的 adapter，§1-2）。讀不到時錯誤寫出是哪個檔與原本的錯誤，不猜原因（D-154 第 2 點）。
 */
export function filesReader(files: Files, config: string, readData: () => Promise<Uint8Array | null>): BackupReader {
  const data = config + '/' + PLUGIN_DATA;
  return {
    list: () => files.list(ESSENCE_ROOT),
    async read(path) {
      try { return path === data ? await readData() : await files.readBytes(path); } catch (error) {
        throw Error(`讀不到 ${path}（${error instanceof Error ? error.message : String(error)}）`, { cause: error });
      }
    },
  };
}

export interface TakeOptions {
  reader: BackupReader;
  /** 清單的 vault：名稱與實際路徑由呼叫的一方從解析過連結的路徑取（syntax §8），config 是已經確定的設定資料夾。 */
  vault: BackupManifest['vault'];
  build: string | null;
  tool: string;
  by: string;
  now: () => number;
  offset: (ms: number) => number;
  /** 測試用：每一輪讀完之後的時機（模擬中途被改）。 */
  afterRead?: (attempt: number) => Promise<void> | void;
}

/** 讀好、還沒寫出去的一份備份：zip 的位元組、清單、讀到的檔；started 與 offset 是檔名用的開始時間。 */
export interface Taken {
  manifest: BackupManifest;
  files: Map<string, Uint8Array>;
  zip: Uint8Array;
  attempts: number;
  started: number;
  offset: number;
}

const ATTEMPTS = 3;
const startsWith = (whole: Uint8Array, head: Uint8Array): boolean => head.length <= whole.length && head.every((byte, i) => whole[i] === byte);
const byCode = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
/** 讀的時候檔案不見了：算檔案在變，整份重來。 */
class Moved extends Error {}

interface Snapshot { files: Map<string, Uint8Array>; absent: string[] }

async function snapshot(reader: BackupReader, config: string): Promise<Snapshot> {
  const files = new Map<string, Uint8Array>();
  const absent: string[] = [];
  const data = config + '/' + PLUGIN_DATA;
  for (const path of [...await reader.list(), data]) {
    const bytes = await reader.read(path);
    if (bytes) files.set(path, bytes);
    else if (path === data) absent.push(path);
    else throw new Moved(path + '：讀的時候檔案不見了');
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

/** 原本就有問題、照原樣備份的卡組（不是 UTF-8、有語法錯誤），記在清單的 notes，不算失敗。 */
function notesOf(files: ReadonlyMap<string, Uint8Array>): BackupManifest['notes'] {
  const notes: BackupManifest['notes'] = [];
  for (const [path, bytes] of files) {
    if (!isDeckPath(path)) continue;
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
      notes.push({ path, message: '不是 UTF-8 文字，照原樣備份' });
      continue;
    }
    const errors = parseDeck(text).problems.filter(problem => problem.level === 'error');
    if (errors.length) notes.push({ path, message: '原本就有語法問題，照原樣備份（' + [...new Set(errors.map(problem => problem.code))].join('、') + '）' });
  }
  return notes;
}

/**
 * 讀 `Essence Cards/` 全部與外掛的 data.json，做成一份 zip（D-150 第 5 點、syntax §8；這次不排除任何檔案）：
 * 讀原始位元組 → 讀完重新列檔與比雜湊（不穩定就整份重來，最多 3 次）→ 清單與 zip。讀不到就丟錯，不留一半。
 */
export async function takeBackup(options: TakeOptions): Promise<Taken> {
  const { reader, now, offset: offsetOf } = options;
  let taken: Snapshot | null = null;
  let started = 0;
  let attempts = 0;
  let reason = '';
  while (!taken && attempts < ATTEMPTS) {
    attempts++;
    started = Math.trunc(now());
    try {
      const first = await snapshot(reader, options.vault.config);
      await options.afterRead?.(attempts);
      const why = unstable(first, await snapshot(reader, options.vault.config));
      if (why === null) taken = first;
      else reason = why;
    } catch (error) {
      if (!(error instanceof Moved)) throw error;
      reason = error.message;
    }
  }
  if (!taken) throw Error(`檔案一直在變，試了 ${ATTEMPTS} 次都沒有穩定的一份：${reason}`);

  const offset = offsetOf(started);
  const finished = Math.max(Math.trunc(now()), started);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION,
    vault: options.vault,
    build: options.build, tool: options.tool, by: options.by,
    started: formatTime(started, offset), finished: formatTime(finished, offsetOf(finished)),
    scope: BACKUP_SCOPE,
    files: [...taken.files].sort(([a], [b]) => byCode(a, b)).map(([path, bytes]) => ({ path, size: bytes.length, sha256: hashBytes(bytes) })),
    absent: taken.absent, excluded: [], notes: notesOf(taken.files),
  };
  return { manifest, files: taken.files, zip: writeZip(manifest, taken.files, new Date(started)), attempts, started, offset };
}

/**
 * 寫好的備份讀回來檢查（D-150 第 5 點）：整份照 syntax §8 讀得懂、清單和寫出去的相同、每個檔的雜湊相同，
 * 卡組再用 parseDeck 比學習目標 ID 與題目指紋。都對回傳 null，不對回傳原因。
 */
export function checkWritten(bytes: Uint8Array, taken: Taken): string | null {
  const opened = openBackup(bytes);
  if (!opened.ok) return '寫好的備份讀回來不對：' + opened.error;
  if (JSON.stringify(opened.value.manifest) !== JSON.stringify(taken.manifest)) return '寫好的備份讀回來的清單不同';
  for (const [file, original] of taken.files) {
    const back = opened.value.files.get(file);
    if (!back || hashBytes(back) !== hashBytes(original)) return '寫好的備份讀回來 ' + file + ' 的雜湊不同';
    if (isDeckPath(file) && signature(back) !== signature(original)) return '寫好的備份讀回來 ' + file + ' 的學習目標或題目不同';
  }
  return null;
}
