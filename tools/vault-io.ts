import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isPlainPath, PLUGIN_MANIFEST } from '../src/core/backup/index.ts';
import { assertNoLinks, readError } from '../src/desktop/io.ts';

// 和外掛共用的檔案操作在 src/desktop/io.ts（D-148），這裡重新匯出，工具照舊從這個檔拿。
export { assertNoLinks, defaultBackupFolder, isOwn, leftBehind, makeFolder, readError, removeFolders, removeOwn, sameFileKey, virtualizedReason, writeNew } from '../src/desktop/io.ts';
export type { Identity, WriteNew } from '../src/desktop/io.ts';

/** 這台電腦的平台名稱，寫法同 state/device.ts 的裝置碼（過渡的還原工具讀不到 Obsidian 存的裝置碼，syntax §5-3）。 */
export function platformName(platform: NodeJS.Platform = process.platform): 'Windows' | 'Mac' | 'Linux' {
  return platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'Mac' : 'Linux';
}

/**
 * vault 裡 folder 底下的所有檔案（vault 相對路徑、`/` 分隔、照字元碼排序）；folder 不存在時是空的。
 * 遇到符號連結或 junction 就停（folder 本身與上層也算）：過渡工具不跟著連結走，也不能略過它（略過就少備份了）。
 */
export async function listTree(vault: string, folder: string): Promise<string[]> {
  await assertNoLinks(vault, folder);
  const found: string[] = [];
  async function visit(rel: string): Promise<void> {
    let entries;
    try { entries = await readdir(join(vault, rel), { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw readError(rel, error);
    }
    for (const entry of entries) {
      const child = rel + '/' + entry.name;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) found.push(child);
      else throw Error(`${child}：不是一般的檔案或資料夾（例如符號連結），過渡工具不處理`);
    }
  }
  await visit(folder);
  return found.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

/**
 * 確定這個 vault 的設定資料夾：裡面要有 plugins/essence-cards/manifest.json（syntax §8），確定不了就丟錯，
 * 不推定成 .obsidian。
 */
export async function pluginConfig(vault: string, config = '.obsidian'): Promise<string> {
  if (!isPlainPath(config)) throw Error(`設定資料夾「${config}」不是相對 vault 的路徑`);
  let ok = false;
  try { ok = (await stat(join(vault, config, PLUGIN_MANIFEST))).isFile(); } catch { /* 下面一起說明 */ }
  if (!ok) throw Error(`${config}/${PLUGIN_MANIFEST} 不存在：確定不了這個 vault 的設定資料夾（外掛裝在哪裡）；用 --config 指定`);
  return config;
}
