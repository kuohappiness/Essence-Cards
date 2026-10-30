import { lstat, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isPlainPath, PLUGIN_MANIFEST } from '../src/core/backup/index.ts';
import { readError } from '../src/desktop/io.ts';

// 和外掛共用的檔案操作在 src/desktop/io.ts（D-148），這裡重新匯出，工具照舊從這個檔拿。
export { defaultBackupFolder, isOwn, leftBehind, makeFolder, readError, removeFolders, removeOwn, sameFileKey, virtualizedReason, writeNew } from '../src/desktop/io.ts';
export type { Identity, WriteNew } from '../src/desktop/io.ts';

/** 這台電腦的平台名稱，寫法同 state/device.ts 的裝置碼（過渡的還原工具讀不到 Obsidian 存的裝置碼，syntax §5-3）。 */
export function platformName(platform: NodeJS.Platform = process.platform): 'Windows' | 'Mac' | 'Linux' {
  return platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'Mac' : 'Linux';
}

/**
 * vault 相對路徑 rel 的每一段（含 rel 本身）都不是符號連結或 junction；還不存在的部分不用看。過渡工具不跟著連結走：
 * 不然會備份或改寫到 vault 外（Codex 中途查核 F3）。是連結就丟錯。
 */
export async function assertNoLinks(vault: string, rel: string): Promise<void> {
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    let info;
    try { info = await lstat(join(vault, prefix)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw readError(prefix, error);
    }
    if (info.isSymbolicLink()) throw Error(`${prefix}：是連結（符號連結或 junction），過渡工具不跟著連結讀寫`);
  }
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
