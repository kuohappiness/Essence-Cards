import type { App } from 'obsidian';

// 開發命令 exam 在測試 vault 建的暫時檔（tasks/exam-scope.md §10）：只清有建立證據的。共用的測試 vault 可能有別的分支留下、同步才到的檔，不能看到就刪（Codex L2 的 R1）。

/** 建立的證據：建好了才記。分段跑時寫成一個 JSON，跨過重新載入外掛。 */
export interface Trial { files: string[]; folders: string[] }
export const newTrial = (): Trial => ({ files: [], folders: [] });

/** 資料夾現在沒有，就記下來（之後由這次的流程建立）。看硬碟不看清單：刪掉的資料夾 iCloud 可能又放回硬碟，Obsidian 的清單卻還沒有。 */
export async function noteFolder(app: App, trial: Trial, folder: string): Promise<boolean> {
  const missing = !(await app.vault.adapter.exists(folder));
  if (missing) trial.folders.push(folder);
  return missing;
}

/** 建暫時的檔。已經有的丟錯，不覆寫，也不記；建到一半失敗時，記著的是已經建好的那些。 */
export async function makeTrial(app: App, trial: Trial, folder: string, wanted: Record<string, string>): Promise<void> {
  if (await noteFolder(app, trial, folder)) await app.vault.createFolder(folder);
  for (const [path, content] of Object.entries(wanted)) {
    if (await app.vault.adapter.exists(path)) throw Error('已經有這個檔，不覆寫：' + path);
    await app.vault.create(path, content);
    trial.files.push(path);
  }
}

/** 只刪記著的檔；記著的資料夾空了才刪。回報 true，或還留著的路徑（別人放進去的檔讓資料夾留著，也要看得到）。 */
export async function clearTrial(app: App, trial: Trial, pause = 500): Promise<true | string[]> {
  const { vault } = app;
  const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, pause); });
  const ignore = (): void => { /* 開發命令：沒刪到的看結果。 */ };
  await settle();
  for (const path of trial.files) {
    const file = vault.getFileByPath(path);
    if (file) await vault.delete(file).catch(ignore);
  }
  await settle();
  for (const folder of trial.folders) {
    const entry = vault.getFolderByPath(folder);
    if (entry && !entry.children.length) await vault.delete(entry, true).catch(ignore);
    if (await vault.adapter.exists(folder)) await vault.adapter.rmdir(folder, false).catch(ignore);
  }
  await settle();
  const left: string[] = [];
  for (const path of [...trial.files, ...trial.folders]) if (await vault.adapter.exists(path)) left.push(path);
  return left.length === 0 || left;
}
