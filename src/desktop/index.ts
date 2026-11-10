import { randomBytes } from 'node:crypto';
import { lstat, realpath, rmdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { BackupHost } from '../core/backup/index.ts';
import { checkFolder, listBackups, prepareFolder, readBackup, removeBackup, writeBackup } from './backup.ts';
import type { StoredBackup } from '../core/backup/index.ts';
import { assertNoLinks, defaultBackupFolder, isInside, realTarget, sameFileKey } from './io.ts';

// 外掛的電腦專用接點（D-148）：main.ts 在 Platform.isDesktopApp 成立後才動態 import 這個檔，不經共用的重新匯出檔。
// 載入時沒有副作用；對外只給具體的動作，不交出 fs。

/** 封裝 App 把位置導走時怎麼換（外掛的說法；Obsidian 本身不是封裝 App，照理碰不到）。 */
const FIX = '請換一個位置（不能在 vault 裡，也不要選雲端同步的資料夾）。';

export interface Desktop {
  /** 備份要用的動作（core/backup 的 runner 用）。 */
  host: BackupHost;
  /** 預設位置（syntax §8）：這台電腦不經雲端同步的應用程式資料夾，解析過連結的實際路徑。 */
  defaultFolder: string;
  /** 檢查一個位置（實際路徑、在不在 vault 裡、是否被封裝 App 導走），不建任何資料夾；problem 是不能用的原因。 */
  check(folder: string): Promise<{ real: string; problem: string | null }>;
  /** 用系統的檔案總管打開資料夾；打不開回傳原因，打開了是 null。 */
  open(folder: string): Promise<string | null>;
  /** 系統的選資料夾對話框；取消是 null。叫不到對話框就丟錯（設定頁改用文字欄位）。 */
  choose(start: string): Promise<string | null>;
  /** 備份資料夾裡讀得懂的與讀不懂的（還原的選單，tasks/plugin-restore.md §1）。 */
  listing(folder: string): Promise<{ backups: StoredBackup[]; skipped: { name: string; reason: string }[] }>;
  /** vault 相對路徑上有連結就丟錯（§3-3）。 */
  noLinks(path: string): Promise<void>;
  /** 這個平台開放還原：檔名規則只在 Windows 驗過（tasks/plugin-restore.md〈小選擇〉第 2 項）。 */
  restorable: boolean;
}

/** 開放還原的平台。 */
export const restorableOn = (platform: NodeJS.Platform): boolean => platform === 'win32';

/**
 * 刪掉 vault 裡一個空的資料夾（系統資料夾的防呆 §1-5，tasks/system-folder-guard.md）。用非遞迴的 rmdir：有東西就由系統
 * 拒絕（ENOTEMPTY），確認是空的之後才同步進來的內容也不會被刪（Codex L2 F2）。Obsidian 電腦版的 adapter.rmdir(path, false)
 * 對資料夾回 EISDIR（實機 W2），所以不經 adapter。
 * path 是 vault 相對路徑，寫法和 obsidian/files.ts 一樣（不能是絕對路徑、不能有 \ 或 ..）。比對用實際路徑（Codex L2 第二輪 F6）：
 * 上一層經過 junction 或符號連結走到 vault 外面、或要刪的本身是連結，都不刪；vault 本身不刪（大小寫不同的寫法也一樣）。
 */
export async function removeEmptyFolder(basePath: string, path: string): Promise<void> {
  const refuse = (): never => { throw Error('不是 vault 裡的資料夾：' + path); };
  if (!path || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => part === '' || part === '.' || part === '..')) refuse();
  const vault = await realpath(basePath);
  const target = resolve(vault, path);
  const real = join(await realpath(dirname(target)), basename(target));
  if ((await lstat(real)).isSymbolicLink()) refuse();
  // isInside 用 path.relative（Windows 不分大小寫）：relative 是空的就是 vault 本身。
  if (!isInside(real, vault) || relative(vault, real) === '') refuse();
  await rmdir(real);
}

/** basePath 是 Obsidian 給的 vault 位置（FileSystemAdapter.getBasePath）。 */
export async function createDesktop(basePath: string): Promise<Desktop> {
  const vault = await realpath(basePath);
  const key = sameFileKey();
  const host: BackupHost = {
    vault: { name: basename(vault), path: vault.replaceAll('\\', '/') },
    key,
    prepare: folder => prepareFolder(folder, vault, FIX),
    // runner 記的是檔名（和 folder 分開記，§1-4）；writeBackup 回傳完整路徑。
    write: async (folder, taken, halt) => basename(await writeBackup(folder, taken, { random: () => randomBytes(2).toString('hex'), halt })),
    list: async folder => (await listBackups(folder)).backups,
    async read(folder, name) {
      try { return await readBackup(folder, name); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    remove: (folder, backup, halt) => removeBackup(folder, folder, backup, halt),
  };
  return {
    host,
    // 實際路徑（設定頁顯示的就是實際存放的位置，§1-5、Codex L2 B6）；封裝 App 導走時顯示的是導走後的位置，備份照樣拒絕。
    defaultFolder: await realTarget(defaultBackupFolder(basename(vault))),
    check: folder => checkFolder(folder, vault, FIX),
    open: async folder => (await import('./shell.ts')).openFolder(folder),
    choose: async start => (await import('./shell.ts')).chooseFolder(start),
    listing: folder => listBackups(folder),
    noLinks: path => assertNoLinks(vault, path),
    restorable: restorableOn(process.platform),
  };
}
