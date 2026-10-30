import type { App } from 'obsidian';
import { ESSENCE_ROOT } from '../core/backup/index.ts';
import type { State } from '../state/index.ts';
import { BACKUP_KEYS, type BackupWiring } from './backup.ts';
import { capturePng, keepRendering } from './dev-review.ts';
import { createObsidianFiles } from './files.ts';
import type { Params } from './dev-cloud.ts';

// 外掛內備份的 Windows 實機（tasks/plugin-backup.md §1-2、§1-10），只在開發版。用 URI 的 do 參數選要做的事：
// status（預設）、now（立即備份）、check（看要不要備份）、age（把記的上次備份調舊 days 天，驗每月）、folder（換位置，to=路徑或 default；
// force=1 不檢查，模擬選了外接硬碟、之後拔掉）、
// deck（打開 target 那一篇，看存檔按鈕）、files（Files.list 和磁碟上的檔案對照）、dialog（選資料夾對話框叫不叫得到；really=1 才真的打開）、open（打開備份資料夾）、
// shots（設定頁的截圖：一般、ⓘ 點開、選錯位置；fail=<路徑> 再加失敗與恢復）。

export interface BackupDevHost { app: App; backup: BackupWiring | null; state: State | null; notices: readonly string[]; refresh: () => void }

const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
const DAY = 24 * 60 * 60 * 1000;
/** Obsidian 的設定視窗（不在公開的型別裡）。 */
interface SettingWindow { open(): void; close(): void; openTabById(id: string): void; pluginTabs: { id?: string; plugin?: { manifest?: { id: string } } }[] }
const settingOf = (app: App): SettingWindow => (app as unknown as { setting: SettingWindow }).setting;

/** 狀態、閘門、存檔按鈕的說明與備份資料夾裡的備份。 */
async function snapshot(host: BackupDevHost, backup: BackupWiring): Promise<unknown> {
  const folder = backup.custom() ?? backup.desktop.defaultFolder;
  let backups: unknown;
  try {
    backups = (await backup.desktop.host.list(folder)).map(item => ({ name: item.name, by: item.manifest.by, started: item.manifest.started, files: item.manifest.files.length }));
  } catch (error) {
    backups = { error: error instanceof Error ? error.message : String(error) };
  }
  return {
    status: backup.runner.status(), custom: backup.custom(), defaultFolder: backup.desktop.defaultFolder, folder,
    writeBlock: host.state?.writeBlock() ?? null,
    saveButtons: (host.refresh(), Array.from(document.querySelectorAll('.essence-cards-save')).map(el => el.getAttribute('aria-label'))),
    notices: host.notices.filter(notice => notice.includes('備份')),
    backups,
  };
}

/** §1-2：Files.list('Essence Cards') 和磁碟上的檔案是否一致（.jsonl、圖片、剛同步來還沒被索引的新檔）。磁碟這邊用 Node 讀，只在開發命令。 */
async function compareFiles(app: App): Promise<unknown> {
  const load = (window as unknown as { require?: (name: string) => unknown }).require;
  if (!load) throw Error('這裡沒有 require（不是電腦版）');
  const fs = load('fs') as { promises: { readdir(path: string, options: { withFileTypes: true }): Promise<{ name: string; isDirectory(): boolean; isFile(): boolean }[]> } };
  const base = (app.vault.adapter as unknown as { getBasePath(): string }).getBasePath();
  const disk: string[] = [];
  async function visit(rel: string): Promise<void> {
    for (const entry of await fs.promises.readdir(base + '/' + rel, { withFileTypes: true })) {
      const child = rel + '/' + entry.name;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) disk.push(child);
    }
  }
  await visit(ESSENCE_ROOT);
  const listed = await createObsidianFiles(app).list(ESSENCE_ROOT);
  const indexed = new Set(listed), onDisk = new Set(disk);
  const extensions = (paths: string[]) => paths.reduce<Record<string, number>>((count, path) => { const ext = /\.[^./]+$/.exec(path)?.[0] ?? '(無)'; count[ext] = (count[ext] ?? 0) + 1; return count; }, {});
  return {
    disk: disk.length, listed: listed.length,
    onlyDisk: disk.filter(path => !indexed.has(path)), onlyListed: listed.filter(path => !onDisk.has(path)),
    extensions: { disk: extensions(disk), listed: extensions(listed) },
  };
}

/** 截標題是 title 的那個 Electron 視窗（設定開在另一個視窗時用）；找不到回傳 null。 */
async function captureWindow(app: App, path: string, title: string): Promise<string | null> {
  interface Win { getTitle(): string; webContents: { capturePage(): Promise<{ toPNG(): Uint8Array }> } }
  const load = (window as unknown as { require?: (name: string) => unknown }).require;
  const electron = load?.('electron') as { remote?: { BrowserWindow: { getAllWindows(): Win[] } } } | undefined;
  const target = title ? electron?.remote?.BrowserWindow.getAllWindows().find(win => win.getTitle() === title) : undefined;
  if (!target) return null;
  const png = (await target.webContents.capturePage()).toPNG();
  await app.vault.adapter.writeBinary(path, png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer);
  return path;
}

/** 設定頁的截圖（§1-10，交使用者看過版面）：一般、ⓘ 點開、選錯位置；fail 給了再加失敗與恢復。 */
async function shots(host: BackupDevHost, backup: BackupWiring, folder: string, fail: string | undefined): Promise<unknown> {
  const { app } = host;
  const rendering = keepRendering();
  const setting = settingOf(app);
  const taken: { path: string | null; rows: string[] }[] = [];
  await app.vault.adapter.mkdir(folder);
  // Obsidian 1.14 的設定開在另一個視窗（setting.popout）：在那個視窗的 DOM 裡找備份兩列，截那個視窗。
  const panel = (): HTMLElement | null => (setting as unknown as { activeTab?: { containerEl?: HTMLElement } }).activeTab?.containerEl ?? null;
  const rows = (): string[] => Array.from(panel()?.querySelectorAll('.essence-cards-backup-location, .essence-cards-backup-status') ?? []).map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
  const shot = async (name: string) => {
    await sleep(1000);
    const path = `${folder}/${name}.png`;
    taken.push({ path: await captureWindow(app, path, panel()?.ownerDocument.title ?? '') ?? await capturePng(app, path), rows: rows() });
  };
  const custom = backup.custom();
  try {
    setting.open();
    setting.openTabById('essence-cards');
    await shot('1 設定頁');
    panel()?.querySelector<HTMLElement>('.essence-cards-backup-info')?.click();
    await shot('2 說明點開');
    const tab = setting.pluginTabs.find(item => item.plugin?.manifest?.id === 'essence-cards') as unknown as { use(backup: BackupWiring, folder: string): Promise<void>; problem: string | null; display(): void } | undefined;
    if (!tab) throw Error('找不到外掛的設定分頁');
    const base = (app.vault.adapter as unknown as { getBasePath(): string }).getBasePath();
    await tab.use(backup, base + '\\Essence Cards\\備份');
    await shot('3 選錯位置');
    tab.problem = null;
    if (fail) {
      backup.setFolder(fail);
      await backup.runner.backup();
      tab.display();
      await shot('4 失敗');
      backup.setFolder(custom);
      await backup.runner.backup();
      tab.display();
      await shot('5 接回來按立即備份');
    }
    tab.display();
    return { shots: taken, after: await snapshot(host, backup) };
  } finally {
    backup.setFolder(custom);
    setting.close();
    rendering.restore();
  }
}

export async function backupDev(host: BackupDevHost, params: Params, folder: string): Promise<unknown> {
  const { app } = host;
  const backup = host.backup;
  if (!backup) throw Error('備份還沒載入（不是電腦版，或載入失敗）');
  switch (params.do ?? 'status') {
    case 'status': return snapshot(host, backup);
    case 'now': await backup.runner.backup(); return snapshot(host, backup);
    case 'check': await backup.runner.check(); return snapshot(host, backup);
    case 'age': {
      const last = app.loadLocalStorage(BACKUP_KEYS.last) as { time: number } | null;
      if (!last) throw Error('localStorage 沒有上次的備份');
      const aged = { ...last, time: last.time - Number(params.days ?? '31') * DAY };
      app.saveLocalStorage(BACKUP_KEYS.last, aged);
      return { aged };
    }
    case 'folder': {
      const to = params.to === 'default' || !params.to ? null : params.to;
      const check = to && params.force !== '1' ? await backup.desktop.check(to) : null;
      if (!check?.problem) backup.setFolder(to);
      return { check, ...await snapshot(host, backup) as object };
    }
    case 'files': return compareFiles(app);
    case 'deck': {
      const file = app.vault.getFileByPath(params.target ?? '');
      if (!file) throw Error('沒有這一篇：' + params.target);
      await app.workspace.getLeaf('tab').openFile(file);
      await sleep(500);
      return snapshot(host, backup);
    }
    case 'dialog': {
      const load = (window as unknown as { require?: (name: string) => unknown }).require;
      const electron = load?.('electron') as { remote?: { dialog?: { showOpenDialog?: unknown } }; shell?: { openPath?: unknown } } | undefined;
      const found = { remote: !!electron?.remote, showOpenDialog: typeof electron?.remote?.dialog?.showOpenDialog, openPath: typeof electron?.shell?.openPath };
      if (params.really !== '1') return found;
      return { ...found, chosen: await backup.desktop.choose(backup.custom() ?? backup.desktop.defaultFolder) };
    }
    case 'open': return { error: await backup.desktop.open(backup.custom() ?? backup.desktop.defaultFolder) };
    case 'shots': return shots(host, backup, folder, params.fail);
    default: throw Error('沒有 do=' + params.do);
  }
}
