import type { App, Plugin } from 'obsidian';
import { createBackupRunner, filesReader, PLUGIN_DATA, PLUGIN_MANIFEST } from '../core/backup/index.ts';
import type { BackupReader, BackupRunner, BackupStatus, LastBackup } from '../core/backup/index.ts';
import type { Files } from '../core/files.ts';
import type { Desktop } from '../desktop/index.ts';

// 外掛內的備份（D-150、tasks/plugin-backup.md §1-4～§1-7），只在電腦接上：什麼時候做、通知、這台電腦的設定。
// 寫到 vault 外的動作都在 src/desktop（D-148），這裡只拿 main.ts 動態載入後交進來的 Desktop。

/** 這台電腦的設定（這個 vault 專用的 localStorage，不放 data.json：D-149 第 7 點、同 device.ts）。 */
const FOLDER_KEY = 'essence-cards-backup-folder';
const LAST_KEY = 'essence-cards-backup-last';
/** 開著時多久看一次要不要做每月的備份（任務說明 §1-4）。 */
const EVERY = 6 * 60 * 60 * 1000;
/** 失敗時的通知（§1-6）：入口畫面的「給家長」一區做好之前先用 Obsidian 的通知。 */
export const BACKUP_NOTICE = 'Essence Cards：備份失敗，暫停修改卡組；學生照常複習。到設定頁看原因';

export interface BackupHostOptions {
  plugin: Plugin;
  desktop: Desktop;
  files: Files;
  /** 正在執行的外掛的 BUILD。 */
  build: string;
  /** 狀態變了：main.ts 更新 state 的閘門、存檔按鈕與設定頁。 */
  changed: (status: BackupStatus) => void;
  notify: (message: string) => void;
}

/** wireBackup 交回的：設定頁用的動作與狀態。 */
export interface BackupWiring {
  runner: BackupRunner;
  desktop: Desktop;
  /** 使用者選的位置；null 是預設位置。 */
  custom(): string | null;
  /** 換位置（null 是用預設位置）：舊位置的備份不動、不搬（§1-7）。 */
  setFolder(folder: string | null): void;
  /** state 讀完之後：看一次要不要備份，之後每 6 小時看一次。 */
  start(): void;
}

/** localStorage 讀到的上次成功備份；被清掉或讀不懂時是 null（當成沒有備份，不推定成功，§1-4）。 */
function lastOf(value: unknown): LastBackup | null {
  if (typeof value !== 'object' || value === null) return null;
  const last = value as Record<string, unknown>;
  const ok = ['build', 'name', 'sha256', 'folder'].every(key => typeof last[key] === 'string') && typeof last.time === 'number';
  return ok ? last as unknown as LastBackup : null;
}

/**
 * 外掛讀 vault 的一方：Files 讀 `Essence Cards/`，Obsidian 的 adapter 讀設定資料夾裡的 data.json（檔案索引不含設定資料夾，§1-2）。
 * 每次先確定設定資料夾：裡面要有外掛的 manifest.json，確定不了就整份失敗（syntax §8）。
 */
function vaultReader(app: App, files: Files): { reader: BackupReader; config: string } {
  const { adapter, configDir: config } = app.vault;
  const data = config + '/' + PLUGIN_DATA;
  const base = filesReader(files, config, async () => await adapter.exists(data) ? new Uint8Array(await adapter.readBinary(data)) : null);
  return {
    config,
    reader: {
      async list() {
        if (!await adapter.exists(config + '/' + PLUGIN_MANIFEST)) throw Error(`${config}/${PLUGIN_MANIFEST} 不存在：確定不了這個 vault 的設定資料夾`);
        return base.list();
      },
      read: path => base.read(path),
    },
  };
}

export function wireBackup(host: BackupHostOptions): BackupWiring {
  const { plugin, desktop } = host;
  const { app } = plugin;
  const custom = (): string | null => {
    const saved: unknown = app.loadLocalStorage(FOLDER_KEY);
    return typeof saved === 'string' && saved ? saved : null;
  };
  /** 同一個原因這次載入只通知一次（§1-6）。 */
  const warned = new Set<string>();
  const { reader, config } = vaultReader(app, host.files);
  const runner = createBackupRunner({
    host: desktop.host, reader, config, build: host.build, defaultFolder: desktop.defaultFolder,
    store: {
      folder: custom,
      last: () => lastOf(app.loadLocalStorage(LAST_KEY)),
      saveLast: last => { app.saveLocalStorage(LAST_KEY, last); },
    },
    now: Date.now, offset: ms => -new Date(ms).getTimezoneOffset(),
    onStatus(status) {
      host.changed(status);
      const failure = status.failure;
      if (!failure) return;
      const key = failure.step + '\n' + failure.message;
      if (warned.has(key)) return;
      warned.add(key);
      host.notify(BACKUP_NOTICE);
    },
  });
  // 外掛停用：進行中的備份停在下一步之前（§1-1）。計時器由 registerInterval 收回。
  plugin.register(() => { runner.cancel(); });
  return {
    runner, desktop, custom,
    setFolder(folder) { app.saveLocalStorage(FOLDER_KEY, folder); },
    start() {
      void runner.check();
      plugin.registerInterval(window.setInterval(() => { void runner.check(); }, EVERY));
    },
  };
}
