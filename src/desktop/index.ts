import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import type { BackupHost } from '../core/backup/index.ts';
import { checkFolder, listBackups, prepareFolder, readBackup, removeBackup, writeBackup } from './backup.ts';
import { defaultBackupFolder, sameFileKey } from './io.ts';

// 外掛的電腦專用接點（D-148）：main.ts 在 Platform.isDesktopApp 成立後才動態 import 這個檔，不經共用的重新匯出檔。
// 載入時沒有副作用；對外只給具體的動作，不交出 fs。

/** 封裝 App 把位置導走時怎麼換（外掛的說法；Obsidian 本身不是封裝 App，照理碰不到）。 */
const FIX = '請換一個位置（不能在 vault 裡，也不要選雲端同步的資料夾）。';

export interface Desktop {
  /** 備份要用的動作（core/backup 的 runner 用）。 */
  host: BackupHost;
  /** 預設位置（syntax §8）：這台電腦不經雲端同步的應用程式資料夾。 */
  defaultFolder: string;
  /** 檢查一個位置（實際路徑、在不在 vault 裡、是否被封裝 App 導走），不建任何資料夾；problem 是不能用的原因。 */
  check(folder: string): Promise<{ real: string; problem: string | null }>;
  /** 用系統的檔案總管打開資料夾；打不開回傳原因，打開了是 null。 */
  open(folder: string): Promise<string | null>;
  /** 系統的選資料夾對話框；取消是 null。叫不到對話框就丟錯（設定頁改用文字欄位）。 */
  choose(start: string): Promise<string | null>;
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
    write: async (folder, taken) => basename(await writeBackup(folder, taken, { random: () => randomBytes(2).toString('hex') })),
    list: async folder => (await listBackups(folder)).backups,
    async read(folder, name) {
      try { return await readBackup(folder, name); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    remove: (folder, backup) => removeBackup(folder, folder, backup),
  };
  return {
    host,
    defaultFolder: defaultBackupFolder(basename(vault)),
    check: folder => checkFolder(folder, vault, FIX),
    open: async folder => (await import('./shell.ts')).openFolder(folder),
    choose: async start => (await import('./shell.ts')).chooseFolder(start),
  };
}
