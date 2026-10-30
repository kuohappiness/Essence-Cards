import type { Files } from '../../src/core/files.ts';
import type { ContractOps } from '../../src/dev/files-contract.ts';

/**
 * 記憶體裡的 Files（技術債 A9）：給 state 與接線的測試用，取代真檔案加輪詢。照 src/core/files.ts 的契約（C1～C16 在
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
  /**
   * 這個路徑下一次的 read 停在半路（tasks/state-writes.md §8 的測試替身）：開始讀時記下內容，release 時才回傳；
   * release 可以改成回傳別的內容、null，或傳 Error 讓它 reject。started：那次 read 開始了。
   */
  holdRead(path: string): { started: Promise<void>; release: (result?: string | null | Error) => void };
  /** 這個路徑下一次的 modify 照常寫完（含通知），但等 release 才回傳。 */
  holdModify(path: string): { release: () => void };
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
  const heldReads = new Map<string, { begin: () => void; wait: Promise<string | null | Error | undefined> }>();
  const heldModifies = new Map<string, Promise<void>>();
  const notify = (...paths: string[]): void => { for (const path of paths) for (const watcher of [...watchers]) watcher(path); };
  const set = (path: string, text: string): void => { texts.set(path, text); notify(path); };
  // 同一個路徑的 modify / append 排隊，和 Node 版、Obsidian 版相同。
  function serial(path: string, action: () => void | Promise<void>): Promise<void> {
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
      const held = heldReads.get(path);
      if (held) {
        heldReads.delete(path);
        const start = texts.get(path) ?? null;
        held.begin();
        return held.wait.then(result => {
          if (result instanceof Error) throw result;
          return result === undefined ? start : result;
        });
      }
      return Promise.resolve(texts.get(path) ?? null);
    },
    readBytes(path) {
      location(path);
      if (failing.has(path)) return Promise.reject(Error('讀不到：' + path));
      const text = texts.get(path);
      return Promise.resolve(text === undefined ? null : new TextEncoder().encode(text));
    },
    modify(path, edit) {
      location(path);
      return serial(path, () => {
        const old = texts.get(path) ?? '';
        const next = edit(old);
        if (control.failModify) throw Error('寫不進去');
        if (!(texts.has(path) && old === next)) set(path, next);
        const held = heldModifies.get(path);
        heldModifies.delete(path);
        return held;
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
  function holdRead(path: string): ReturnType<MemoryFiles['holdRead']> {
    let begin = (): void => {}, release: (result?: string | null | Error) => void = () => {};
    const started = new Promise<void>(resolve => { begin = resolve; });
    const wait = new Promise<string | null | Error | undefined>(resolve => { release = resolve; });
    heldReads.set(path, { begin, wait });
    return { started, release };
  }
  function holdModify(path: string): { release: () => void } {
    let release = (): void => {};
    heldModifies.set(path, new Promise<void>(resolve => { release = resolve; }));
    return { release };
  }
  return {
    files, texts, reads, failing, control, holdRead, holdModify,
    write: set,
    append: (path, line) => { set(path, (texts.get(path) ?? '') + line + '\n'); },
    remove, rename, notify,
    ops: { rename: (from, to) => { rename(from, to); return Promise.resolve(); }, remove: path => { remove(path); return Promise.resolve(); } },
  };
}
