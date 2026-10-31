import { TFile, TFolder, type App, type TAbstractFile } from 'obsidian';
import type { Files } from '../core/files.ts';

/** 檔案存取的 Obsidian 版（W5 說明 §2）：照 src/core/files.ts 的契約，和 tools/node-files.ts 跑同一份契約檢查。 */
export function createObsidianFiles(app: App): Files {
  const { vault } = app;
  const pending = new Map<string, Promise<void>>();
  // vault 的路徑本來就是相對的；擋掉絕對路徑與任何一段是 ..，不讓它碰 vault 以外。
  function location(path: string): string {
    if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
      throw Error('檔案路徑必須位於 vault 內');
    }
    return path;
  }
  // 同一個路徑的 modify / append 排隊，和 Node 版相同（大小寫不同視為同一個檔，頂多多排隊）。
  function serial(path: string, action: () => Promise<void>): Promise<void> {
    const key = path.normalize('NFC').toLowerCase();
    // 前一份的失敗已經由 next 交回它自己的呼叫端：這裡與下面清掉排隊的 .catch 只是不讓它擋住下一份、不留下沒人接的拒絕。
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    pending.set(key, next);
    void next.finally(() => { if (pending.get(key) === next) pending.delete(key); }).catch(() => {});
    return next;
  }
  function file(path: string): TFile | null {
    const found = vault.getAbstractFileByPath(path);
    if (found instanceof TFolder) throw Error('這是資料夾，不是檔案：' + path);
    return found instanceof TFile ? found : null;
  }
  async function create(path: string, text: string): Promise<void> {
    const slash = path.lastIndexOf('/');
    let folder = '';
    for (const part of slash < 0 ? [] : path.slice(0, slash).split('/')) {
      folder = folder ? folder + '/' + part : part;
      if (!vault.getAbstractFileByPath(folder)) await createFolder(folder);
    }
    await vault.create(path, text);
  }
  /**
   * 建一層資料夾。兩個不同的檔同時第一次寫進同一個不存在的資料夾時會一起建，後到的那個失敗（D-155 第 4 點）：失敗時再查一次，
   * 已經是資料夾就照常往下（是別的寫入建好的），不是就照原樣拋出。
   */
  async function createFolder(folder: string): Promise<void> {
    try {
      await vault.createFolder(folder);
    } catch (error) {
      if (!(vault.getAbstractFileByPath(folder) instanceof TFolder)) throw error;
    }
  }
  /** 資料夾裡的每個檔（含子資料夾）；檔案就是它自己。 */
  function inside(entry: TAbstractFile): TFile[] {
    if (entry instanceof TFile) return [entry];
    if (entry instanceof TFolder) return entry.children.flatMap(inside);
    return [];
  }
  return {
    list(folder) {
      // 包在 Promise 裡：路徑不合法時和 Node 版一樣是 reject。
      return Promise.resolve().then(() => {
        const prefix = location(folder) === '' ? '' : folder.replace(/\/$/, '') + '/';
        return vault.getFiles().map(f => f.path).filter(path => path.startsWith(prefix)).sort();
      });
    },
    async read(path) {
      const found = file(location(path));
      // vault.read 讀磁碟上最新的內容（cachedRead 可能是舊的），包括 iCloud 剛同步來的。
      return found ? vault.read(found) : null;
    },
    async readBytes(path) {
      const found = file(location(path));
      return found ? new Uint8Array(await vault.readBinary(found)) : null;
    },
    modify(path, edit) {
      location(path);
      return serial(path, async () => {
        const found = file(path);
        // vault.process 一次讀、改、寫（D-110）；edit 回傳原文時不寫入（契約 C6 在 Obsidian 驗）。
        if (found) await vault.process(found, edit);
        else await create(path, edit(''));
      });
    },
    append(path, line) {
      location(path);
      return serial(path, async () => {
        const found = file(path);
        if (found) await vault.append(found, line + '\n');
        else await create(path, line + '\n');
      });
    },
    watch(onChange) {
      const each = (entry: TAbstractFile) => { for (const f of inside(entry)) onChange(f.path); };
      const refs = [
        vault.on('create', each),
        vault.on('modify', each),
        vault.on('delete', each),
        // 資料夾改名時，通知裡面每個檔的舊、新路徑。
        vault.on('rename', (entry, oldPath) => {
          for (const f of inside(entry)) { onChange(oldPath + f.path.slice(entry.path.length)); onChange(f.path); }
        }),
      ];
      return () => { for (const ref of refs) vault.offref(ref); };
    },
  };
}
