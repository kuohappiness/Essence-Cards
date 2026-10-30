import { parseTime } from '../study/index.ts';
import type { BackupManifest } from './manifest.ts';
import { matchesName } from './names.ts';

/** 備份資料夾裡一份整份讀得懂的備份（列出的一方已經用 openBackup 驗過）。 */
export interface StoredBackup { name: string; size: number; sha256: string; manifest: BackupManifest }

/** 保留最近幾份（D-150 第 6 點）。 */
const RECENT = 10;

/**
 * 這次清理可以刪的備份（D-150 第 6 點、任務說明 §1-7）。候選：檔名和清單對得上（syntax §8「自動清理只認完整的備份」），
 * vault 的名稱與實際路徑都是這個 vault（照這台電腦的檔名規則 key 比；config 不比）。保留：候選照 started 換成的絕對時間排序
 * （同一毫秒再照檔名的字元碼），最新 10 份、每個月最後一份（月份是各份 started 自己記的當地 YYYY-MM）、這次成功的 keep，
 * 三者的聯集；其他回傳。不是候選的一律不在結果裡。
 */
export function staleBackups(backups: readonly StoredBackup[], vault: { name: string; path: string }, key: (path: string) => string, keep: string): StoredBackup[] {
  const candidates = backups
    .filter(backup => matchesName(backup.name, backup.manifest))
    .filter(backup => key(backup.manifest.vault.name) === key(vault.name) && key(backup.manifest.vault.path) === key(vault.path))
    .map(backup => ({ backup, at: parseTime(backup.manifest.started)!.at }))
    // 新的在前；同一毫秒照檔名，固定次序。
    .sort((a, b) => b.at - a.at || (a.backup.name < b.backup.name ? 1 : a.backup.name > b.backup.name ? -1 : 0));
  const kept = new Set<string>([keep]);
  for (const { backup } of candidates.slice(0, RECENT)) kept.add(backup.name);
  const months = new Set<string>();
  for (const { backup } of candidates) {
    const month = backup.manifest.started.slice(0, 7);
    if (months.has(month)) continue;
    months.add(month);
    kept.add(backup.name);
  }
  return candidates.map(({ backup }) => backup).filter(backup => !kept.has(backup.name));
}
