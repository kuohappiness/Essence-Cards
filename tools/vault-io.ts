import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isPlainPath, PLUGIN_MANIFEST } from '../src/core/backup/index.ts';

/** 這台電腦的平台名稱，寫法同 state/device.ts 的裝置碼（過渡的還原工具讀不到 Obsidian 存的裝置碼，syntax §5-3）。 */
export function platformName(platform: NodeJS.Platform = process.platform): 'Windows' | 'Mac' | 'Linux' {
  return platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'Mac' : 'Linux';
}

/**
 * 目的地這台電腦的檔名規則：會寫到同一個檔的兩個路徑得到相同的值（syntax §8「寫回的目的地另外算」）。
 * Windows 不分大小寫；Mac 不分大小寫、也不分 Unicode 的組合方式；Linux 都分。
 */
export function sameFileKey(platform: NodeJS.Platform = process.platform): (path: string) => string {
  if (platform === 'win32') return path => path.toLowerCase();
  if (platform === 'darwin') return path => path.normalize('NFC').toLowerCase();
  return path => path;
}

/** child 是 parent 本身或在它裡面；Windows 的 path.relative 不分大小寫。 */
export function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || !(rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel));
}

/** 實際路徑（解析 junction 與符號連結）；還不存在的部分接在最近一個存在的上層的實際路徑後面。 */
export async function realTarget(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(await realTarget(parent), basename(absolute));
  }
}

/**
 * 備份的預設位置（syntax §8）：這台電腦不經雲端同步的應用程式資料夾。
 * Windows `%LOCALAPPDATA%\Essence Cards\備份\<vault 名稱>\`，Mac `~/Library/Application Support/…`，其他 `$XDG_DATA_HOME` 或 `~/.local/share/…`。
 */
export function defaultBackupFolder(vaultName: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const home = homedir();
  const base = platform === 'win32' ? env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    : platform === 'darwin' ? join(home, 'Library', 'Application Support')
      : env.XDG_DATA_HOME || join(home, '.local', 'share');
  return join(base, 'Essence Cards', '備份', vaultName);
}

/**
 * 實際路徑落在封裝 App 的私有資料夾（`AppData\Local\Packages\<App>\LocalCache\`）：在 MSIX 封裝的 App（例如 Claude 桌面 App）
 * 裡跑時，Windows 把寫進 %LOCALAPPDATA% 的東西導到那裡（2026-10-29 實測）。回傳要印給人看的提醒；不是就回傳 null。
 */
export function virtualizedNotice(real: string): string | null {
  if (!/[\\/]AppData[\\/]Local[\\/]Packages[\\/][^\\/]+[\\/]LocalCache[\\/]/i.test(real)) return null;
  return `注意：這個程式在封裝的 App 裡跑，Windows 把 %LOCALAPPDATA% 導到那個 App 的私有資料夾，備份實際存在 ${real}：`
    + '從檔案總管或 App 以外的程式看 %LOCALAPPDATA% 看不到，解除安裝那個 App 時會一起刪掉。要放在別處，用 --to 指定。';
}

/** 讀不到檔案時分清楚原因（任務 1-1 第 1 點）：消失、權限、被占用，Windows 上其他的多半是 iCloud 只留了雲端佔位檔。 */
export function readError(path: string, error: unknown): Error {
  const code = (error as NodeJS.ErrnoException).code;
  const reason = code === 'ENOENT' ? '讀的時候檔案不見了'
    : code === 'EACCES' || code === 'EPERM' ? '沒有讀取權限'
      : code === 'EBUSY' ? '檔案正被其他程式占用'
        : process.platform === 'win32' ? '讀不到內容，可能是 iCloud 只留了雲端佔位檔（在檔案總管對它選「永遠保留在此裝置上」，下載完再試）'
          : '讀不到內容';
  return Error(`${path}：${reason}（${code ?? (error instanceof Error ? error.message : String(error))}）`, { cause: error });
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
