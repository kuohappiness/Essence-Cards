import { staleBackups } from './retention.ts';
import type { StoredBackup } from './retention.ts';
import { takeBackup } from './take.ts';
import type { BackupReader, Taken } from './take.ts';
import { hashBytes, openBackup } from './zip.ts';

/** 外掛自己做備份的原因（syntax §8 的 by）。 */
export type PluginBy = 'new-version' | 'monthly' | 'manual';

/** 這台電腦記的上次成功備份（localStorage，任務說明 §1-4）：建置版本、開始時間、檔名、zip 的雜湊、備份資料夾的實際路徑。 */
export interface LastBackup { build: string; time: number; name: string; sha256: string; folder: string }

/** 電腦專用資料夾的備份動作（D-148），由 src/desktop 提供；這裡不碰 fs。 */
export interface BackupHost {
  /** 這個 vault 的名稱與實際路徑（syntax §8 的 vault；從解析過連結的路徑取）。 */
  vault: { name: string; path: string };
  /** 這台電腦的檔名規則：清理時比 vault 的名稱與路徑用。 */
  key: (path: string) => string;
  /** 建好並檢查備份位置，回傳實際路徑；不能用就丟錯（原因寫在錯誤裡）。 */
  prepare(folder: string): Promise<string>;
  /** 寫一份備份（暫存名、讀回檢查、不覆寫地提交），回傳檔名。 */
  write(folder: string, taken: Taken): Promise<string>;
  /** folder 直接底下整份讀得懂的備份。 */
  list(folder: string): Promise<StoredBackup[]>;
  /** 一份備份的位元組；不存在是 null。 */
  read(folder: string, name: string): Promise<Uint8Array | null>;
  /** 刪一份舊備份：刪之前再確認資料夾的實際路徑與內容，對不上就丟錯。 */
  remove(folder: string, backup: StoredBackup): Promise<void>;
}

/** 只屬於這台電腦的設定（這個 vault 專用的 localStorage，D-149 第 7 點）。 */
interface BackupStore {
  /** 使用者選的備份位置；null 是預設位置。 */
  folder(): string | null;
  /** 被清掉或讀不懂時是 null（當成沒有備份，不推定成功）。 */
  last(): LastBackup | null;
  saveLast(last: LastBackup): void;
}

interface BackupFailure { by: PluginBy; step: string; message: string; time: number }
export interface BackupStatus {
  /** 寫入閘門：這個建置版本有一份對得到的成功備份，而且這次載入之後沒有失敗過（失敗了要再成功一次）。 */
  ready: boolean;
  /** 這次載入確認過了沒（check 第一次做完之前是 false）。 */
  checked: boolean;
  /** 正在做的那一份。 */
  running: PluginBy | null;
  /** 這台電腦記的上次成功備份。 */
  last: LastBackup | null;
  /** 最近一次失敗：哪一步、原因（D-154）；之後成功就清掉。 */
  failure: BackupFailure | null;
  /** 最近一次成功之後清理沒做完的：檔名與原因。下一次成功備份後再試。 */
  cleanup: string[];
}

export interface RunnerOptions {
  host: BackupHost;
  reader: BackupReader;
  /** 已經確定的設定資料夾（裡面有外掛的 manifest.json，syntax §8）。 */
  config: string;
  /** 正在執行的外掛的 BUILD：清單的 build 與 tool 都是它（syntax §8）。 */
  build: string;
  defaultFolder: string;
  store: BackupStore;
  now: () => number;
  offset: (ms: number) => number;
  /** 狀態變了：外掛更新 state 的閘門、存檔按鈕、設定頁與通知。 */
  onStatus: (status: BackupStatus) => void;
}

export interface BackupRunner {
  /**
   * 外掛載入、state 讀完之後，以及之後每 6 小時：這個建置版本沒有對得到的成功備份就做 new-version，超過 30 天就做 monthly；
   * 都不用做時打開閘門（這次載入失敗過的除外）。
   */
  check(): Promise<void>;
  /** 設定頁的「立即備份」。 */
  backup(): Promise<void>;
  status(): BackupStatus;
  /** 外掛卸載：進行中的備份停在下一步之前，之後不再通知。 */
  cancel(): void;
}

/** 每月：距離上次成功備份超過 30 天（恰好 30 天不做）。 */
const MONTH = 30 * 24 * 60 * 60 * 1000;
class Cancelled extends Error {}
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * 外掛內的備份什麼時候做、同一時間只做一份、成功後清理（D-150 第 2、3、6 點，任務說明 §1-4、§1-6、§1-7）。
 * 失敗不刪任何既有的備份；新備份成功之後才清理，清理失敗不影響這次的成功。
 */
export function createBackupRunner(options: RunnerOptions): BackupRunner {
  const { host, store, build } = options;
  let status: BackupStatus = { ready: false, checked: false, running: null, last: store.last(), failure: null, cleanup: [] };
  let current: Promise<void> | null = null;
  let checking: Promise<void> | null = null;
  let cancelled = false;
  function set(patch: Partial<BackupStatus>): void {
    if (cancelled) return;
    status = { ...status, ...patch };
    options.onStatus(status);
  }
  const stop = (): void => { if (cancelled) throw new Cancelled('外掛停用了，這次備份沒有做完'); };
  const reader: BackupReader = {
    list: () => { stop(); return options.reader.list(); },
    read: path => { stop(); return options.reader.read(path); },
  };
  const same = (vault: { name: string; path: string }): boolean =>
    host.key(vault.name) === host.key(host.vault.name) && host.key(vault.path) === host.key(host.vault.path);

  /** 記的那份還在、雜湊和記的相同、整份照 syntax §8 讀得懂、是這個 vault（任務說明 §1-4）。 */
  async function verified(last: LastBackup): Promise<boolean> {
    try {
      const bytes = await host.read(last.folder, last.name);
      if (!bytes || hashBytes(bytes) !== last.sha256) return false;
      const opened = openBackup(bytes);
      return opened.ok && same(opened.value.manifest.vault);
    } catch {
      return false;
    }
  }

  /** 新備份成功後清理（任務說明 §1-7）：回傳沒做完的。 */
  async function clean(folder: string, keep: string): Promise<string[]> {
    let stale: StoredBackup[];
    try { stale = staleBackups(await host.list(folder), host.vault, host.key, keep); } catch (error) {
      return ['列出備份資料夾：' + message(error)];
    }
    const left: string[] = [];
    for (const backup of stale) {
      try { await host.remove(folder, backup); } catch (error) { left.push(backup.name + '：' + message(error)); }
    }
    return left;
  }

  /** 做一份備份；同一時間只做一份，等著的拿同一個結果（失敗就是失敗）。 */
  function run(by: PluginBy): Promise<void> {
    current ??= (async () => {
      set({ running: by });
      let step = '準備備份位置';
      try {
        const real = await host.prepare(store.folder() ?? options.defaultFolder);
        stop();
        step = '讀 vault';
        const taken = await takeBackup({ reader, vault: { ...host.vault, config: options.config }, build, tool: build, by, now: options.now, offset: options.offset });
        stop();
        step = '寫進備份資料夾';
        const name = await host.write(real, taken);
        const last: LastBackup = { build, time: taken.started, name, sha256: hashBytes(taken.zip), folder: real };
        store.saveLast(last);
        set({ ready: true, checked: true, running: null, last, failure: null, cleanup: [] });
        stop();
        const cleanup = await clean(real, name);
        if (cleanup.length) set({ cleanup });
      } catch (error) {
        if (error instanceof Cancelled) return;
        set({ ready: false, checked: true, running: null, failure: { by, step, message: message(error), time: options.now() } });
      }
    })().finally(() => { current = null; });
    return current;
  }

  return {
    check() {
      checking ??= (async () => {
        // 已經有一份在做：共用它的結果，不在它做完之後重新判斷、另做一份（Codex L2 B3）。
        if (current) return current;
        const last = store.last();
        if (!last || last.build !== build || !await verified(last)) {
          // 已經知道沒有對得到的成功備份：先關閘門再重做（Codex L2 B1），不能等重做的第一步之後。
          set({ ready: false });
          return run('new-version');
        }
        if (options.now() - last.time > MONTH) return run('monthly');
        // 這次載入失敗過的（例如手動備份失敗），等下一次成功才打開。
        set({ checked: true, last, ready: !status.failure });
      })().finally(() => { checking = null; });
      return checking;
    },
    backup: () => run('manual'),
    status: () => status,
    cancel() { cancelled = true; },
  };
}
