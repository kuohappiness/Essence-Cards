import { parseTime } from '../study/index.ts';

/** 備份檔的格式（syntax §8）。 */
export const BACKUP_FORMAT = 'essence-cards-backup';
/** 這個程式認得的清單版本；比它大的整份當成讀不懂。 */
export const BACKUP_VERSION = 1;
export const ESSENCE_ROOT = 'Essence Cards';
/** 外掛設定相對於設定資料夾的路徑；設定資料夾本身由 vault 決定（通常是 .obsidian）。 */
export const PLUGIN_DATA = 'plugins/essence-cards/data.json';
/** 設定資料夾裡有這個檔，才表示外掛裝在這裡（syntax §8「內容」）。 */
export const PLUGIN_MANIFEST = 'plugins/essence-cards/manifest.json';
export const MANIFEST_NAME = 'manifest.json';
export const BACKUP_SCOPE = '這台電腦當時看得到、讀得到的檔案；不保證包含還沒同步的其他裝置紀錄';

interface BackupFile { path: string; size: number; sha256: string }
export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  vault: { name: string; path: string; config: string };
  build: string | null;
  tool: string;
  by: string;
  started: string;
  finished: string;
  scope: string;
  files: BackupFile[];
  absent: string[];
  excluded: { path: string; reason: string }[];
  notes: { path: string; message: string }[];
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** 相對 vault 的路徑寫得對：`/` 分隔，沒有 `..`、`.`、空的段、開頭的 `/`、磁碟代號或反斜線。 */
export function isPlainPath(path: string): boolean {
  if (!path || path.includes('\\') || /^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** 備份裡可以有的路徑：`Essence Cards/` 底下，或 `<config>/plugins/essence-cards/data.json` 那一個（syntax §8「路徑範圍」）。 */
function inBackupScope(path: string, config: string): boolean {
  if (!isPlainPath(path)) return false;
  return path.startsWith(ESSENCE_ROOT + '/') || path === config + '/' + PLUGIN_DATA;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** 清單讀得懂：JSON 讀得出來還不夠，必要欄位都要有、型別對（syntax §8「讀備份的一方」）。不認得的欄位忽略。 */
export function readManifest(text: string): Checked<BackupManifest> {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: '清單不是 JSON' }; }
  if (!isObject(data)) return { ok: false, error: '清單不是物件' };
  if (data.format !== BACKUP_FORMAT) return { ok: false, error: 'format 不是 ' + BACKUP_FORMAT };
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) return { ok: false, error: 'version 不是正整數' };
  if (data.version > BACKUP_VERSION) return { ok: false, error: '清單的 version ' + data.version + ' 比這個程式認得的（' + BACKUP_VERSION + '）新' };
  const vault = data.vault;
  if (!isObject(vault) || typeof vault.name !== 'string' || typeof vault.path !== 'string' || typeof vault.config !== 'string') return { ok: false, error: 'vault 缺少 name、path 或 config' };
  if (!isPlainPath(vault.config)) return { ok: false, error: 'vault.config 不是相對 vault 的路徑' };
  if (data.build !== null && typeof data.build !== 'string') return { ok: false, error: 'build 不是字串或 null' };
  for (const key of ['tool', 'by', 'started', 'finished', 'scope'] as const) {
    if (typeof data[key] !== 'string') return { ok: false, error: key + ' 不是字串' };
  }
  for (const key of ['started', 'finished'] as const) {
    if (!parseTime(data[key] as string)) return { ok: false, error: key + ' 不是含時區的時間' };
  }
  for (const key of ['files', 'absent', 'excluded', 'notes'] as const) {
    if (!Array.isArray(data[key])) return { ok: false, error: key + ' 不是清單' };
  }
  const config = vault.config;
  const paths = new Set<string>();
  for (const file of data.files as unknown[]) {
    if (!isObject(file) || typeof file.path !== 'string') return { ok: false, error: 'files 有一項缺少 path' };
    if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0) return { ok: false, error: file.path + ' 的 size 不是非負整數' };
    if (!isSha(file.sha256)) return { ok: false, error: file.path + ' 的 sha256 不是 64 個小寫十六進位字元' };
    if (!inBackupScope(file.path, config)) return { ok: false, error: file.path + ' 不在備份的範圍內' };
    if (paths.has(file.path)) return { ok: false, error: 'files 裡 ' + file.path + ' 重複' };
    paths.add(file.path);
  }
  for (const path of data.absent as unknown[]) {
    if (typeof path !== 'string' || !inBackupScope(path, config)) return { ok: false, error: 'absent 有不在範圍內的路徑' };
  }
  for (const item of data.excluded as unknown[]) {
    if (!isObject(item) || typeof item.path !== 'string' || typeof item.reason !== 'string') return { ok: false, error: 'excluded 有一項缺少 path 或 reason' };
  }
  for (const item of data.notes as unknown[]) {
    if (!isObject(item) || typeof item.path !== 'string' || typeof item.message !== 'string') return { ok: false, error: 'notes 有一項缺少 path 或 message' };
  }
  return { ok: true, value: data as unknown as BackupManifest };
}

/**
 * zip 與清單一一對應（syntax §8）：恰好一個 manifest.json；zip 的路徑、files 的 path 各自不重複；兩邊的檔案相同，
 * 大小與雜湊也相同。任何重複或不符都整份當成壞掉，不靠去重放過。names 是 zip 裡每一項的名稱（含重複）。
 */
export function checkArchive(names: readonly string[], files: ReadonlyMap<string, Uint8Array>, manifest: BackupManifest, hash: (bytes: Uint8Array) => string): Checked<null> {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return { ok: false, error: 'zip 裡 ' + name + ' 重複' };
    seen.add(name);
  }
  if (!seen.has(MANIFEST_NAME)) return { ok: false, error: 'zip 裡沒有 ' + MANIFEST_NAME };
  const listed = new Map(manifest.files.map(file => [file.path, file]));
  for (const name of names) {
    if (name === MANIFEST_NAME) continue;
    if (!listed.has(name)) return { ok: false, error: 'zip 裡的 ' + name + ' 不在清單的 files 裡' };
  }
  for (const file of manifest.files) {
    const bytes = files.get(file.path);
    if (!bytes || !seen.has(file.path)) return { ok: false, error: '清單的 ' + file.path + ' 不在 zip 裡' };
    if (bytes.length !== file.size) return { ok: false, error: file.path + ' 的大小和清單不同' };
    if (hash(bytes) !== file.sha256) return { ok: false, error: file.path + ' 的雜湊和清單不同' };
  }
  return { ok: true, value: null };
}
