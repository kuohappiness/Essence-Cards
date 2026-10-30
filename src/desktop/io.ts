import { link, lstat, mkdir, open, readFile, realpath, rmdir, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

// 電腦專用的檔案操作（D-148）：外掛的備份與過渡工具（tools/vault-io.ts 重新匯出）共用同一份，不寫兩份。

/**
 * 目的地這台電腦的檔名規則：會寫到同一個檔的兩個路徑得到相同的值（syntax §8「寫回的目的地另外算」，清理時比 vault 的路徑也用它）。
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
 * 裡跑時，Windows 把寫進 %LOCALAPPDATA% 的東西導到那裡（2026-10-29 實測；%TEMP% 不會）。App 外看不到，解除安裝那個 App
 * 時會一起刪掉，所以備份不放這裡：回傳拒絕的理由（fix 是怎麼換位置，工具與外掛的說法不同）；不是就回傳 null（使用者 2026-10-29 選的做法）。
 */
export function virtualizedReason(folder: string, real: string, fix = '用 --to 指定 App 以外的資料夾（不能在 vault 裡、也不要在雲端同步的資料夾裡）。'): string | null {
  if (!/[\\/]AppData[\\/]Local[\\/]Packages[\\/][^\\/]+[\\/]LocalCache[\\/]/i.test(real + '\\')) return null;
  return `備份位置 ${folder} 實際在 ${real}：這個程式在封裝的 App（例如 Claude 桌面 App）裡跑，Windows 把它導到那個 App 的私有資料夾，`
    + '從檔案總管或 App 以外的程式看不到，解除安裝那個 App 時會一起刪掉。' + fix;
}

/** 讀不到檔案時分清楚原因（更新防線任務 1-1 第 1 點）：消失、權限、被占用，Windows 上其他的多半是 iCloud 只留了雲端佔位檔。 */
export function readError(path: string, error: unknown): Error {
  const code = (error as NodeJS.ErrnoException).code;
  const reason = code === 'ENOENT' ? '讀的時候檔案不見了'
    : code === 'EACCES' || code === 'EPERM' ? '沒有讀取權限'
      : code === 'EBUSY' ? '檔案正被其他程式占用'
        : process.platform === 'win32' ? '讀不到內容，可能是 iCloud 只留了雲端佔位檔（在檔案總管對它選「永遠保留在此裝置上」，下載完再試）'
          : '讀不到內容';
  return Error(`${path}：${reason}（${code ?? (error instanceof Error ? error.message : String(error))}）`, { cause: error });
}

/** 檔案的身分（磁碟與 inode）：確認要動的還是這次建立的那個檔。 */
export interface Identity { dev: bigint; ino: bigint }
/** 把內容寫進剛建立的檔（path 是它的位置）；測試用替身模擬寫壞、空間不足、寫的時候資料夾被換掉。 */
export type WriteNew = (handle: FileHandle, bytes: Uint8Array, path: string) => Promise<void>;

/** 清理時沒有刪的檔，附在失敗原因後面。 */
export const leftBehind = (path: string): string => `；${path} 沒有刪（那裡已經不是這次建立的檔，或確定不了），請確認後手動處理`;

/** path 現在就是 identity 那個一般檔案（不跟著連結）。 */
export async function isOwn(path: string, identity: Identity): Promise<boolean> {
  const now = await lstat(path, { bigint: true });
  return now.isFile() && now.dev === identity.dev && now.ino === identity.ino;
}

/** 只刪這次建立的檔：path 現在還是 identity 那個檔才刪；不是、已經不在或確定不了就不動，回傳 false。 */
export async function removeOwn(path: string, identity: Identity): Promise<boolean> {
  try {
    if (!await isOwn(path, identity)) return false;
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 獨占建立 path、寫入 bytes，回傳這次建立的檔的身分（Codex 第三次查核 T1）。身分在建立的那一刻從開著的檔讀，不是事後照路徑讀：
 * 寫的時候資料夾被換掉，記到的仍是這次的檔。建立本身失敗（例如 EEXIST，別的程序先建了它）就沒有這次的檔，什麼都不刪；
 * 建立之後才失敗的半個檔，確認還是這次的才刪，不然留著並在錯誤裡說明。
 */
export async function writeNew(path: string, bytes: Uint8Array, write: WriteNew = (handle, data) => handle.writeFile(data)): Promise<Identity> {
  const handle = await open(path, 'wx');
  let identity: Identity | null = null;
  try {
    identity = await handle.stat({ bigint: true });
    await write(handle, bytes, path);
    await handle.close();
    return identity;
  } catch (error) {
    // 關過再關不會出錯（替身可能先關了）。
    await handle.close().catch(() => {});
    if (identity !== null && await removeOwn(path, identity)) throw error;
    throw Error((error as Error).message + leftBehind(path), { cause: error });
  }
}

/** 已經有同名的正式檔：提交時不覆寫，由呼叫的一方換一個名字。 */
export class NameTaken extends Error {}
/** 建硬連結（fs.link 的形狀）。 */
export type Link = (from: string, to: string) => Promise<void>;

/**
 * 把這次寫好、檢查過的暫存檔提交成正式檔名，不覆寫已有的檔（技術債「備份與還原只考慮一個程序在跑」第 1 點：外掛的每月備份
 * 可能和更新命令同時跑）。先建硬連結：已有同名檔就是 EEXIST，不會蓋掉；成功後刪掉暫存名。檔案系統不支援硬連結時（例如 exFAT
 * 的外接硬碟）改成獨占建立正式檔名、寫入同一份位元組、讀回比對。同名檔已經存在時丟 NameTaken。暫存名沒刪掉不算失敗
 * （列出備份只看 .zip）。seams 給測試模擬不支援硬連結。
 */
export async function commitNew(temporary: string, path: string, identity: Identity, bytes: Uint8Array, seams: { link?: Link } = {}): Promise<void> {
  if (!await isOwn(temporary, identity)) throw Error(temporary + ' 已經不是這次寫的暫存檔');
  try {
    await (seams.link ?? link)(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new NameTaken(path + ' 已經存在，不覆寫', { cause: error });
    let own: Identity;
    try { own = await writeNew(path, bytes); } catch (fallback) {
      if ((fallback as NodeJS.ErrnoException).code === 'EEXIST') throw new NameTaken(path + ' 已經存在，不覆寫', { cause: fallback });
      throw Error(`提交成 ${path} 失敗：${(fallback as Error).message}（硬連結：${(error as Error).message}）`, { cause: fallback });
    }
    const back = new Uint8Array(await readFile(path));
    if (back.length !== bytes.length || back.some((byte, i) => byte !== bytes[i])) {
      throw Error(path + ' 寫完讀回來不同' + (await removeOwn(path, own) ? '，已刪掉' : leftBehind(path)));
    }
  }
  await removeOwn(temporary, identity);
}

/** 這次建立的一層資料夾與它的身分。 */
export interface CreatedFolder { path: string; identity: Identity }

/** 拿掉 Windows 的 `\\?\`（與 `\\?\UNC\`）長路徑寫法，逐層往上時才停得在磁碟根目錄。 */
const plainPath = (path: string): string => path.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '');

/** 建立 folder（含上層），回傳這次才建的每一層（由上到下）與它們的身分；本來就有的不算。 */
export async function makeFolder(folder: string): Promise<CreatedFolder[]> {
  const first = await mkdir(folder, { recursive: true });
  if (first === undefined) return [];
  // Windows 回報的第一層是長路徑寫法；傳進來的也可能是（Codex 第四次查核的觀察）。
  const top = plainPath(first);
  const created: CreatedFolder[] = [];
  for (let path = resolve(plainPath(folder)); ; path = dirname(path)) {
    created.unshift({ path, identity: await lstat(path, { bigint: true }) });
    if (relative(path, top) === '') return created;
    // 對不上回報的那一層：確定不了哪幾層是這次建的，一層都不算。
    if (dirname(path) === path) return [];
  }
}

/**
 * 收掉 makeFolder 這次建的資料夾（Codex 第三次查核 T3）：由下往上，只收身分沒變、還空著的（rmdir 不刪有東西的資料夾）。
 * 遇到收不掉的那一層就停，它和上面的都留著，回傳那一層；都收掉回傳 null。已經不在的那一層跳過。
 */
export async function removeFolders(created: readonly CreatedFolder[]): Promise<string | null> {
  for (const { path, identity } of [...created].reverse()) {
    try {
      const now = await lstat(path, { bigint: true });
      if (!now.isDirectory() || now.dev !== identity.dev || now.ino !== identity.ino) return path;
      await rmdir(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return path;
    }
  }
  return null;
}
