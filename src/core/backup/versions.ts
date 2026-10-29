import { isLogPath, LOG_FOLDER, parseTime } from '../study/index.ts';
import { canRead } from '../version/index.ts';
import { logSource } from './names.ts';

/** 一台裝置最後回報的建置版本（syntax §5-1 的 `set: app` 行）。 */
export interface VersionReport {
  /** 檔名裡的裝置碼；檔名認不出裝置碼時是檔名去掉 .jsonl。 */
  device: string;
  /** 建置版本；同一個來源、同一個時間卻有不同的值時是 null（不確定，不挑一個）。 */
  build: string | null;
  /** 最後回報的時間（原文）。 */
  t: string;
  /** 回報所在的紀錄檔（vault 路徑）。 */
  source: string;
  /**
   * 衝突副本：iCloud 的衝突副本（例如 `… 2.jsonl`），照檔名保留來源；還原檔：從備份補回的行，屬於原來的來源檔，
   * 不是還原那台電腦當時跑的版本，不算目前版本；不確定：同一個來源、同一個時間有不同的值，不挑一個。
   */
  note: '衝突副本' | '還原檔' | '不確定' | null;
}

const DEVICE_FILE = /^\d{4}-\d{2} ((?:iPhone|iPad|Android|Windows|Mac|Linux|Device)-[0-9a-f]{4})( \d+)?$/;
const ORDER = { null: 0, 衝突副本: 1, 不確定: 0, 還原檔: 2 } as const;

/**
 * 每台裝置最後回報的版本，從帶來源路徑的原始紀錄算（任務說明 2-1）：不能用合併後的 History.changes，它不帶來源、
 * 會把兩台裝置時間與值都相同的回報去重成一筆。只看 `紀錄/` 直接底下的 .jsonl；讀不出來的行跳過，need 讀不懂的行
 * 也跳過（syntax §0-1；version 是讀的那一方的正式版號，不傳是版本不明）。
 * 這是最後回報，不是即時狀態：還沒同步、還沒重開的裝置看不出來。
 */
export function lastVersions(sources: readonly { path: string; text: string }[], version: string | null = null): VersionReport[] {
  const best = new Map<string, { report: VersionReport; at: number; values: Set<string> }>();
  for (const { path, text } of sources) {
    if (!isLogPath(path)) continue;
    const name = path.slice(LOG_FOLDER.length + 1);
    const stem = name.slice(0, -'.jsonl'.length);
    // 還原檔的衝突副本（`… 還原 <日期> <裝置碼> 2.jsonl`）也是還原檔：先去掉衝突副本的尾巴再看（Codex 第二輪 L4）。
    // 補行的分組（syntax §5-3）照舊用 logSource，這裡只為了版本列表分類。
    const plain = stem.replace(/ \d+$/, '');
    const source = logSource(name) !== stem ? logSource(name) : logSource(plain + '.jsonl') !== plain ? logSource(plain + '.jsonl') : stem;
    const restored = source !== stem;
    const match = DEVICE_FILE.exec(source);
    const device = match ? match[1] : source;
    const note = restored ? '還原檔' : match?.[2] ? '衝突副本' : null;
    // 一個來源一筆：同一台裝置的不同月份、衝突副本、還原檔分開比，最後再合併同一台的同一種。
    for (const line of text.split('\n')) {
      let data: unknown;
      try { data = JSON.parse(line.trim()); } catch { continue; }
      if (!data || typeof data !== 'object') continue;
      const { t, set, val } = data as Record<string, unknown>;
      if (set !== 'app' || typeof val !== 'string' || typeof t !== 'string') continue;
      if (Object.hasOwn(data, 'need') && !canRead((data as { need: unknown }).need, version)) continue;
      const time = parseTime(t);
      if (!time) continue;
      const current = best.get(path);
      if (!current || time.at > current.at) best.set(path, { report: { device, build: val, t, source: path, note }, at: time.at, values: new Set([val]) });
      else if (time.at === current.at) current.values.add(val);
    }
  }
  const latest = new Map<string, { report: VersionReport; at: number }>();
  for (const { report, at, values } of best.values()) {
    if (values.size > 1) { report.build = null; report.note = report.note ?? '不確定'; }
    const key = report.device + '\n' + (report.note === '不確定' ? null : report.note);
    const current = latest.get(key);
    if (!current || at > current.at) latest.set(key, { report, at });
  }
  return [...latest.values()].map(entry => entry.report)
    .sort((a, b) => a.device < b.device ? -1 : a.device > b.device ? 1 : ORDER[`${a.note}`] - ORDER[`${b.note}`]);
}
