import { lstat, readdir, readFile, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { backupName, checkWritten, hashBytes, openBackup } from '../core/backup/index.ts';
import type { StoredBackup, Taken } from '../core/backup/index.ts';
import { commitNew, isInside, leftBehind, makeFolder, NameTaken, realTarget, removeFolders, removeOwn, virtualizedReason, writeNew } from './io.ts';
import type { Identity, Link, WriteNew } from './io.ts';

// 備份資料夾裡的檔（D-150、syntax §8）：外掛與過渡工具共用。讀 vault 不在這裡，由呼叫的一方用 core/backup 的 takeBackup 做好。

/** 位置不能用的原因：在 vault 裡（以實際路徑判斷，連到 vault 的連結也算）、被封裝 App 導走；可以用是 null。 */
function refusal(requested: string, real: string, vault: string, fix?: string): string | null {
  if (isInside(real, vault)) return `備份位置 ${requested} 在 vault 裡（以實際路徑判斷），不能放在 vault 裡`;
  return virtualizedReason(requested, real, fix);
}

/**
 * 檢查一個備份位置，不建任何資料夾（設定頁選位置時，§1-1）：real 是實際路徑（還不存在的部分接在最近一個存在的上層後面），
 * problem 是不能用的原因。vault 是 vault 的實際路徑。fix 是遇到封裝 App 時怎麼換位置的說法。
 */
export async function checkFolder(requested: string, vault: string, fix?: string): Promise<{ real: string; problem: string | null }> {
  let real: string;
  try { real = await realTarget(requested); } catch (error) {
    // 一路往上都不存在：連磁碟（例如外接硬碟的磁碟代號）都找不到。照實說，不猜是不是沒接上（D-154）。
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
    throw Error(`備份位置 ${requested} 所在的磁碟找不到（${code}）`, { cause: error });
  }
  return { real, problem: refusal(requested, real, vault, fix) };
}

/**
 * 建好備份位置並回傳它的實際路徑；不能用就丟錯。已經看得出不能用的，不建任何資料夾就拒絕；建好才看得出的（MSIX 在建立時
 * 才把 %LOCALAPPDATA% 導走）也拒絕，並收掉這次建的空資料夾；有別的東西或換過就留著（Codex 第三次查核 T3）。
 */
export async function prepareFolder(requested: string, vault: string, fix?: string): Promise<string> {
  const known = await checkFolder(requested, vault, fix);
  if (known.problem) throw Error(known.problem);
  const created = await makeFolder(known.real);
  const real = await realpath(known.real);
  const refused = refusal(requested, real, vault, fix);
  if (refused) {
    const kept = await removeFolders(created);
    throw Error(refused + (kept === null ? '' : `（這次建的資料夾 ${kept} 沒有收掉：裡面有別的東西或已經換過，請確認後手動處理）`));
  }
  return real;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export interface WriteOptions {
  /** 檔名的隨機 4 碼（0-9a-f）。 */
  random: () => string;
  /** 測試用：把 zip 寫進剛建立的暫存檔的替身（模擬寫壞）、建硬連結的替身（模擬不支援）。 */
  write?: WriteNew;
  link?: Link;
}

/**
 * 把一份讀好的備份寫進 folder（已經用 prepareFolder 確認過），回傳正式檔的路徑（syntax §8「檔名」）：用 `<正式檔名>.tmp` 獨占建立、
 * 寫完讀回檢查（checkWritten），再不覆寫地提交成正式檔名（commitNew）。檔名或暫存名已經有了（含別的程序剛好同時建立）就換隨機碼，
 * 最多 20 次。失敗時只刪這次建立、身分沒變的暫存檔（Codex 中途查核 F5、第三次查核 T1），刪不了就在錯誤裡說明。
 */
export async function writeBackup(folder: string, taken: Taken, options: WriteOptions): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const path = join(folder, backupName(taken.started, taken.offset, taken.manifest.build, options.random()));
    const temporary = path + '.tmp';
    if (await exists(path)) continue;
    let identity: Identity;
    try { identity = await writeNew(temporary, taken.zip, options.write); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    try {
      const problem = checkWritten(new Uint8Array(await readFile(temporary)), taken);
      if (problem) throw Error(problem);
      await commitNew(temporary, path, identity, taken.zip, { link: options.link });
      return path;
    } catch (error) {
      const removed = await removeOwn(temporary, identity);
      if (error instanceof NameTaken && removed) continue;
      if (!removed) throw Error((error as Error).message + leftBehind(temporary), { cause: error });
      throw error;
    }
  }
  throw Error('找不到沒用過的備份檔名');
}

/**
 * 列出 folder 直接底下的備份（syntax §8「讀備份的一方」）：只看 `.zip` 結尾的一般檔（不跟著連結、不往子資料夾找），
 * 整份通過 openBackup 才列進 backups；讀不懂、壞掉的列進 skipped 與原因。資料夾不存在時兩個都是空的。
 */
export async function listBackups(folder: string): Promise<{ backups: StoredBackup[]; skipped: { name: string; reason: string }[] }> {
  const backups: StoredBackup[] = [], skipped: { name: string; reason: string }[] = [];
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { backups, skipped };
    throw error;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith('.zip')) continue;
    if (!entry.isFile()) { skipped.push({ name: entry.name, reason: '不是一般的檔案（例如連結或資料夾）' }); continue; }
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await readFile(join(folder, entry.name))); } catch (error) {
      skipped.push({ name: entry.name, reason: '讀不到：' + (error instanceof Error ? error.message : String(error)) });
      continue;
    }
    const opened = openBackup(bytes);
    if (!opened.ok) { skipped.push({ name: entry.name, reason: opened.error }); continue; }
    backups.push({ name: entry.name, size: bytes.length, sha256: hashBytes(bytes), manifest: opened.value.manifest });
  }
  return { backups, skipped };
}

/** 讀一份備份的位元組（第二部分的還原用）：folder 直接底下的一般檔。 */
export async function readBackup(folder: string, name: string): Promise<Uint8Array> {
  const path = join(folder, name);
  if (!(await lstat(path)).isFile()) throw Error(path + ' 不是一般的檔案');
  return new Uint8Array(await readFile(path));
}

/**
 * 刪一份舊備份（只給清理用，任務說明 §1-7）：刪之前再確認備份資料夾的實際路徑還是 real、還是一般檔、大小與雜湊還是剛才驗過的；
 * 對不上就丟錯、不刪。確認到刪之間沒有鎖：別的程序剛好在這段很短的空檔換掉這個檔，仍可能刪到新的內容（照實記下）。
 */
export async function removeBackup(folder: string, real: string, backup: Pick<StoredBackup, 'name' | 'size' | 'sha256'>): Promise<void> {
  if (await realpath(folder) !== real) throw Error(`備份資料夾 ${folder} 的實際位置換了，不刪 ${backup.name}`);
  const path = join(folder, backup.name);
  const before = await lstat(path, { bigint: true });
  if (!before.isFile()) throw Error(path + ' 不是一般的檔案，不刪');
  const bytes = new Uint8Array(await readFile(path));
  const after = await lstat(path, { bigint: true });
  if (after.ino !== before.ino || after.dev !== before.dev || bytes.length !== backup.size || hashBytes(bytes) !== backup.sha256) {
    throw Error(path + ' 和剛才驗過的不同，不刪');
  }
  await unlink(path);
}
