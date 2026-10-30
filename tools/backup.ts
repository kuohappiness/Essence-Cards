import { randomBytes } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ESSENCE_ROOT, readBuild, takeBackup } from '../src/core/backup/index.ts';
import type { BackupManifest, BackupReader } from '../src/core/backup/index.ts';
import { prepareFolder, writeBackup } from '../src/desktop/backup.ts';
import { buildVersion } from './build.mjs';
import { defaultBackupFolder, listTree, pluginConfig, readError } from './vault-io.ts';
import type { WriteNew } from './vault-io.ts';

/** 清單的 by（syntax §8）：過渡工具的值。 */
export type BackupBy = 'backup' | 'update-vault' | 'restore';
export interface BackupOptions {
  vault: string;
  /** 備份資料夾；預設是 defaultBackupFolder。不能在 vault 裡。 */
  to?: string;
  /** 設定資料夾，預設 .obsidian；裡面要有 plugins/essence-cards/manifest.json。 */
  config?: string;
  by: BackupBy;
  now?: () => number;
  offset?: (ms: number) => number;
  /** 檔名的隨機 4 碼。 */
  random?: () => string;
  /** 測試用：讀檔的替身（模擬讀不到）、每一輪讀完之後的時機（模擬中途被改）、把 zip 寫進剛建立的暫存檔的替身（模擬寫壞）。 */
  seams?: {
    read?: (path: string) => Promise<Uint8Array>;
    afterRead?: (attempt: number) => Promise<void> | void;
    write?: WriteNew;
  };
}
export interface BackupResult { path: string; manifest: BackupManifest; attempts: number }

const portable = (path: string): string => path.replaceAll('\\', '/');

/**
 * 備份 `Essence Cards/` 全部與外掛的 data.json 到 vault 外（D-150 第 5 點、syntax §8；過渡工具不排除任何檔案）。讀、比對與
 * 讀回檢查是 core/backup 的 takeBackup，寫進備份資料夾是 src/desktop/backup.ts，外掛用同一份；這裡只接上 Node 的讀檔。
 * 任何一步失敗就整份失敗，不留正式檔名。
 */
export async function backupVault(options: BackupOptions): Promise<BackupResult> {
  const read = options.seams?.read ?? (async (path: string) => new Uint8Array(await readFile(path)));
  const vault = await realpath(options.vault);
  if (!(await stat(vault)).isDirectory()) throw Error('vault 必須是已存在的資料夾');
  const config = await pluginConfig(vault, options.config);
  const folder = await prepareFolder(options.to ?? defaultBackupFolder(basename(vault)), vault);

  let main: string | null = null;
  try { main = await readFile(join(vault, config, 'plugins/essence-cards/main.js'), 'utf8'); } catch { /* 沒裝 main.js：build 是 null */ }
  const reader: BackupReader = {
    list: () => listTree(vault, ESSENCE_ROOT),
    async read(path) {
      try { return await read(join(vault, path)); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw readError(path, error);
      }
    },
  };
  const taken = await takeBackup({
    reader, vault: { name: basename(vault), path: portable(vault), config },
    build: main === null ? null : readBuild(main).build, tool: await buildVersion(), by: options.by,
    now: options.now ?? Date.now, offset: options.offset ?? (ms => -new Date(ms).getTimezoneOffset()),
    afterRead: options.seams?.afterRead,
  });
  const path = await writeBackup(folder, taken, { random: options.random ?? (() => randomBytes(2).toString('hex')), write: options.seams?.write });
  return { path, manifest: taken.manifest, attempts: taken.attempts };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { to: { type: 'string' }, config: { type: 'string' } } });
  if (positionals.length !== 1) throw Error('用法：npm run backup -- <vault> [--to <資料夾>] [--config <設定資料夾>]');
  const result = await backupVault({ vault: positionals[0], to: values.to, config: values.config, by: 'backup' });
  const bytes = result.manifest.files.reduce((sum, file) => sum + file.size, 0);
  console.log(`已備份：${result.path}（${result.manifest.files.length} 個檔，${bytes} bytes${result.attempts > 1 ? `，檔案在變，第 ${result.attempts} 次才穩定` : ''}）`);
  for (const path of result.manifest.absent) console.log('當時不存在：' + path);
  for (const note of result.manifest.notes) console.log(`記下：${note.path}：${note.message}`);
}
