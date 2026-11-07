import { TFile, TFolder, type Plugin } from 'obsidian';
import { createFolderGuard, type FolderGuard } from './folder-guard.ts';

// 把系統資料夾的防呆（folder-guard.ts）接上 Obsidian（tasks/system-folder-guard.md §1、§2）。

/** 這台看過原位有檔的系統資料夾（§2-1）：saveLocalStorage，不隨 vault 同步。 */
const SEEN_KEY = 'essence-cards-system-folders';

/**
 * 在 onload 裡呼叫：rename 的監聽要比 state 的監看先註冊，同一批的通知才擋得住（§1-8）。layout ready 之後再呼叫 check()：
 * 之前 vault 的清單還不完整。
 */
export function wireFolderGuard(plugin: Plugin, options: {
  notify: (message: string) => void;
  fail: (error: unknown) => void;
  /**
   * 電腦版刪空資料夾的方法（src/desktop 的 removeEmptyFolder）：Windows 版的 adapter.rmdir(path, false) 對資料夾回 EISDIR
   * （2026-11-07 實機 W2），遞迴的那一種又會刪到最後一次確認之後才同步進來的內容（Codex L2 F2）。沒給時用 adapter 的非遞迴版。
   */
  removeEmpty?: (path: string) => Promise<void>;
}): FolderGuard {
  const { app } = plugin;
  const { vault } = app;
  const empty = async (path: string): Promise<boolean> => { const { files, folders } = await vault.adapter.list(path); return !files.length && !folders.length; };
  const guard = createFolderGuard({
    files: () => vault.getFiles().map(file => file.path),
    known(path) {
      const found = vault.getAbstractFileByPath(path);
      return found instanceof TFolder ? 'folder' : found instanceof TFile ? 'file' : null;
    },
    // Obsidian 在 vault 裡改名、搬動時改的是同一個 TFolder 的 path；Obsidian 以外搬動、刪掉時拿掉舊的、建新的（Codex L2 第四輪）。
    folder(path) {
      const found = vault.getAbstractFileByPath(path);
      return found instanceof TFolder ? found : null;
    },
    // 還在清單裡、而且那個位置就是它本身：拿掉之後同一個位置再建的是另一個物件。
    where: folder => folder instanceof TFolder && vault.getAbstractFileByPath(folder.path) === folder ? folder.path : null,
    // 清單裡它底下的每一項磁碟上都在（第五輪）：磁碟上剛同步來、清單還沒有的不算對不上。讀不到就是對不上。名字照 NFC 比：
    // Mac、iCloud 的檔名可能是分解的寫法，同一個名字不能因此算成對不上、讓每一次搬回都放棄。
    async intact(folder) {
      if (!(folder instanceof TFolder)) return false;
      try {
        const { files, folders } = await vault.adapter.list(folder.path);
        const names = new Set([...files, ...folders].map(path => path.slice(path.lastIndexOf('/') + 1).normalize('NFC')));
        return folder.children.every(child => names.has(child.name.normalize('NFC')));
      } catch { return false; }
    },
    exists: path => vault.adapter.exists(path),
    empty,
    // 只用非遞迴的刪除：有東西就失敗，不會刪到內容。
    rmdir: options.removeEmpty ?? (path => vault.adapter.rmdir(path, false)),
    async move(folder, to) {
      if (!(folder instanceof TFolder)) throw Error('不是資料夾：' + to);
      await app.fileManager.renameFile(folder, to);
    },
    notify: options.notify,
    fail: options.fail,
    load() {
      const saved: unknown = app.loadLocalStorage(SEEN_KEY);
      return Array.isArray(saved) ? saved.filter((each): each is string => typeof each === 'string') : [];
    },
    save(folders) { app.saveLocalStorage(SEEN_KEY, folders); },
    sleep: ms => new Promise(resolve => { window.setTimeout(resolve, ms); }),
    now: () => Date.now(),
    defer(run) { window.setTimeout(run, 0); },
    later(ms, run) {
      const id = window.setTimeout(run, ms);
      return () => { window.clearTimeout(id); };
    },
  });
  plugin.register(() => { guard.close(); });
  // 監看不了時防呆就不作用。不另外記：state 的監看用同一個 vault.on，layout ready 時會失敗、記一行 init（tasks/error-log.md §2-3），同一個原因不記兩次。
  try {
    plugin.registerEvent(vault.on('rename', (entry, oldPath) => {
      // 事件帶來的資料夾本身直接交給防呆（第五輪），不在之後照路徑重找。
      if (entry instanceof TFolder) guard.renamed(entry.path, oldPath, true, entry);
      else guard.renamed(entry.path, oldPath, false);
      guard.changed();
    }));
    plugin.registerEvent(vault.on('create', () => { guard.changed(); }));
    plugin.registerEvent(vault.on('delete', () => { guard.changed(); }));
  } catch { /* 見上面 */ }
  return guard;
}
