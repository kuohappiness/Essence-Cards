import { remote, shell } from 'electron';

// 系統的檔案總管與選資料夾對話框（Obsidian 電腦版的 Electron）。index.ts 用到時才動態載入這個檔：Node 的測試載入 index.ts
// 不需要 Electron，建置出來的 require("electron") 也只在用到時才執行。

/** 用系統的檔案總管打開資料夾；打不開回傳原因，打開了是 null。 */
export async function openFolder(folder: string): Promise<string | null> {
  const error = await shell.openPath(folder);
  return error || null;
}

/** 系統的選資料夾對話框；取消是 null。叫不到對話框就丟錯。 */
export async function chooseFolder(start: string): Promise<string | null> {
  if (!remote) throw Error('叫不到系統的選資料夾對話框');
  const result = await remote.dialog.showOpenDialog({ title: '選備份位置', defaultPath: start, properties: ['openDirectory', 'createDirectory'] });
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
}
