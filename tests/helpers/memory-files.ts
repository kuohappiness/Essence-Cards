import type { Files } from '../../src/core/files.ts';
import type { ContractOps } from '../../src/dev/files-contract.ts';

/**
 * 記憶體裡的 Files（技術債 A9）：給 state 與接線的測試用，取代真檔案加輪詢。照 src/core/files.ts 的契約（C1～C15 在
 * tests/files-contract.test.ts 驗過）：通知在寫入的當下同步送出，所以測試不用等檔案系統；`write`、`remove`、`rename`
 * 是「別台裝置或家長在 Obsidian 以外改檔」，`notify` 只送通知（控制同一批裡的順序）。
 */
export interface MemoryFiles {
  files: Files;
  /** 目前的內容；直接改它不會送通知。 */
  texts: Map<string, string>;
  /** read 的路徑，照呼叫順序。 */
  reads: string[];
  /** 放進來的路徑 read 會失敗（模擬 iCloud 還沒同步好之類的暫時錯誤）。 */
  failing: Set<string>;
  /** failList：list 一律失敗（模擬整個資料夾暫時列不出來）。 */
  control: { failModify: boolean; failAppend: boolean; failList: boolean };
  /** 外部寫入：設定內容並通知。 */
  write(path: string, text: string): void;
  /** 外部追加一行（含換行）並通知。 */
  append(path: string, line: string): void;
  remove(path: string): void;
  /** 改名檔案或資料夾：每個檔通知舊、新路徑。 */
  rename(from: string, to: string): void;
  notify(...paths: string[]): void;
  /** 契約檢查用的改名與刪除。 */
  ops: ContractOps;
}

function location(path: string): string {
  if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
    throw Error('檔案路徑必須位於 vault 內');
  }
  return path;
}

export function createMemoryFiles(initial: Record<string, string> = {}): MemoryFiles {
  const texts = new Map(Object.entries(initial));
  const watchers = new Set<(path: string) => void>();
  const reads: string[] = [];
  const failing = new Set<string>();
  const control = { failModify: false, failAppend: false, failList: false };
  const pending = new Map<string, Promise<void>>();
  const notify = (...paths: string[]): void => { for (const path of paths) for (const watcher of [...watchers]) watcher(path); };
  const set = (path: string, text: string): void => { texts.set(path, text); notify(path); };
  // 同一個路徑的 modify / append 排隊，和 Node 版、Obsidian 版相同。
  function serial(path: string, action: () => void): Promise<void> {
    const key = path.normalize('NFC').toLowerCase();
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    pending.set(key, next);
    void next.finally(() => { if (pending.get(key) === next) pending.delete(key); }).catch(() => {});
    return next;
  }
  const under = (folder: string): string[] => {
    const prefix = folder === '' ? '' : folder.replace(/\/$/, '') + '/';
    return [...texts.keys()].filter(path => path.startsWith(prefix)).sort();
  };
  const files: Files = {
    list: folder => Promise.resolve().then(() => {
      if (control.failList) throw Error('列不出來：' + folder);
      return under(location(folder));
    }),
    read(path) {
      location(path);
      reads.push(path);
      if (failing.has(path)) return Promise.reject(Error('讀不到：' + path));
      return Promise.resolve(texts.get(path) ?? null);
    },
    modify(path, edit) {
      location(path);
      return serial(path, () => {
        const old = texts.get(path) ?? '';
        const next = edit(old);
        if (control.failModify) throw Error('寫不進去');
        if (texts.has(path) && old === next) return;
        set(path, next);
      });
    },
    append(path, line) {
      location(path);
      return serial(path, () => {
        if (control.failAppend) throw Error('寫不進去');
        set(path, (texts.get(path) ?? '') + line + '\n');
      });
    },
    watch(onChange) {
      watchers.add(onChange);
      return () => { watchers.delete(onChange); };
    },
  };
  function remove(path: string): void {
    const gone = texts.has(path) ? [path] : under(path);
    for (const file of gone) { texts.delete(file); notify(file); }
  }
  function rename(from: string, to: string): void {
    const moved = texts.has(from) ? [from] : under(from);
    for (const file of moved) {
      const target = to + file.slice(from.length);
      const text = texts.get(file) ?? '';
      texts.delete(file);
      texts.set(target, text);
      notify(file, target);
    }
  }
  return {
    files, texts, reads, failing, control,
    write: set,
    append: (path, line) => { set(path, (texts.get(path) ?? '') + line + '\n'); },
    remove, rename, notify,
    ops: { rename: (from, to) => { rename(from, to); return Promise.resolve(); }, remove: path => { remove(path); return Promise.resolve(); } },
  };
}
