import { TFile, TFolder, type App, type TAbstractFile } from 'obsidian';
import type { Files } from '../core/files.ts';

/**
 * 檔案存取的 Obsidian 版（W5 說明 §2）：照 src/core/files.ts 的契約，和 tools/node-files.ts 跑同一份契約檢查。
 * pause：系統資料夾正在搬回時回傳等待的 Promise（FolderGuard.pause，tasks/system-folder-guard.md §1-8）。排隊之後、真正
 * 依路徑找檔之前問，沒有擋住就在同一個同步段落裡開始：搬走的那一刻排著的寫入不會在原位建出新的資料夾（Codex L2 第二輪 F1）。
 */
export function createObsidianFiles(app: App, options: { pause?: (path: string, folder?: boolean) => Promise<void> | null } = {}): Files {
  const { vault } = app;
  const pause = (path: string, folder = false): Promise<void> | null => options.pause?.(path, folder) ?? null;
  const pending = new Map<string, Promise<unknown>>();
  // vault 的路徑本來就是相對的；擋掉絕對路徑與任何一段是 ..，不讓它碰 vault 以外。
  function location(path: string): string {
    if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
      throw Error('檔案路徑必須位於 vault 內');
    }
    return path;
  }
  // 同一個路徑的 modify / append 排隊，和 Node 版相同（大小寫不同視為同一個檔，頂多多排隊）。
  function serial<T>(path: string, action: () => Promise<T>): Promise<T> {
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
  /** 上層資料夾，外層在前。 */
  function parents(path: string): string[] {
    const parts = path.split('/').slice(0, -1);
    return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  }
  async function makeParents(path: string): Promise<void> {
    for (const folder of parents(path)) if (!vault.getAbstractFileByPath(folder)) await createFolder(folder);
  }
  async function create(path: string, text: string): Promise<void> {
    await makeParents(path);
    await vault.create(path, text);
  }
  /**
   * 建一層資料夾。兩個不同的檔同時第一次寫進同一個不存在的資料夾時會一起建，後到的那個失敗（D-155 第 4 點）：失敗時再查一次，
   * 已經是資料夾就照常往下（是別的寫入建好的），不是就照原樣拋出。
   * 清單沒有、硬碟上有也算（iCloud 剛同步來，Obsidian 還沒掃到；tasks/exam-scope.md §10 在 Windows 遇到）。
   */
  async function createFolder(folder: string): Promise<void> {
    try {
      await vault.createFolder(folder);
    } catch (error) {
      if (vault.getAbstractFileByPath(folder) instanceof TFolder) return;
      const found = await vault.adapter.stat(folder).catch(() => null);
      if (found?.type !== 'folder') throw error;
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
      return Promise.resolve().then(async () => {
        const prefix = location(folder) === '' ? '' : folder.replace(/\/$/, '') + '/';
        // 擋住時等完再問；最後一次沒有擋住和讀清單在同一個同步段落（下面幾個也一樣）。
        const at = prefix.slice(0, -1);
        for (let wait = pause(at, true); wait; wait = pause(at, true)) await wait;
        return vault.getFiles().map(f => f.path).filter(path => path.startsWith(prefix)).sort();
      });
    },
    async read(path) {
      location(path);
      for (let wait = pause(path); wait; wait = pause(path)) await wait;
      const found = file(path);
      // vault.read 讀磁碟上最新的內容（cachedRead 可能是舊的），包括 iCloud 剛同步來的。
      return found ? vault.read(found) : null;
    },
    async readBytes(path) {
      location(path);
      for (let wait = pause(path); wait; wait = pause(path)) await wait;
      const found = file(path);
      return found ? new Uint8Array(await vault.readBinary(found)) : null;
    },
    modify(path, edit) {
      location(path);
      return serial(path, async () => {
        // 建上層資料夾要等，期間檔案、占用與搬回都可能變了（R3-2）：建好之後回到這裡重問一次，最後一次的 edit 到 vault.create 中間沒有等待。
        // 第一次的 edit 決定要不要建：丟錯就不動資料夾（家長連資料夾一起刪掉時，離開筆記的補 ID 不會讓它冒出來）。
        for (let made = false; ; made = true) {
          for (let wait = pause(path); wait; wait = pause(path)) await wait;
          const found = file(path);
          // vault.process 一次讀、改、寫（D-110）；edit 回傳原文時不寫入（契約 C6 在 Obsidian 驗）。
          if (found) { await vault.process(found, text => edit(text, true)); return; }
          const text = edit('', false);
          // 建過一次就直接建檔：iCloud 剛同步來的資料夾硬碟上有、清單可能一直還沒有（createFolder 當成建好）。
          if (made || parents(path).every(folder => vault.getAbstractFileByPath(folder))) { await vault.create(path, text); return; }
          await makeParents(path);
        }
      });
    },
    append(path, line) {
      location(path);
      return serial(path, async () => {
        for (let wait = pause(path); wait; wait = pause(path)) await wait;
        const found = file(path);
        if (found) await vault.append(found, line + '\n');
        else await create(path, line + '\n');
      });
    },
    replace(path, check, bytes) {
      location(path);
      return serial(path, async () => {
        // 同 modify：建上層資料夾與讀都要等，回到這裡重問；最後一次的 check 到寫入中間只隔一次讀（§3-2 的空檔），讀完先確認還是同一個檔。
        const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        for (let made = false; ; made = true) {
          for (let wait = pause(path); wait; wait = pause(path)) await wait;
          const found = file(path);
          const now = found ? new Uint8Array(await vault.readBinary(found)) : null;
          if (found && file(path) !== found) continue;
          if (!check(now)) return false;
          if (found) { await vault.modifyBinary(found, data); return true; }
          if (made || parents(path).every(folder => vault.getAbstractFileByPath(folder))) { await vault.createBinary(path, data); return true; }
          await makeParents(path);
        }
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
