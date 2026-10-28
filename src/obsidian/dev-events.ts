import { MarkdownView, TFile, TFolder } from 'obsidian';
import type { App, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { EditorView } from '@codemirror/view';
import type { State } from '../state/index.ts';
import type { Saver } from './save.ts';
import { removePaths } from '../dev/cleanup.ts';
import { judge, type Judged, type Mark } from '../dev/marks.ts';
import { createObsidianFiles } from './files.ts';
import { keepRendering } from './dev-review.ts';

// 事件記錄（第一個里程碑報告 R5；技術債 A3、T3）：直接訂閱 Obsidian 的 workspace 與 vault 事件，不經過 Files.watch
// （它把改名攤成舊、新兩個路徑），記下事件名稱、路徑、舊路徑、時間與順序。只在開發版建置。
// events 在 Obsidian 裡自己做每一種操作；record-start、record-stop 之間由 AI 在 Windows 用檔案總管同一套 Shell 操作。

/** 一筆紀錄。ms 是從開始記錄算起的毫秒；open 是那一刻所有 Markdown 分頁開著的檔（save.ts 的 openPaths 看到的）。 */
interface Recorded {
  n: number;
  ms: number;
  /** workspace、vault：Obsidian 的事件；files：Files.watch 的通知（state 看到的）；saver：存檔備援的紀錄與 opened 的呼叫；step：操作的開頭。 */
  kind: 'workspace' | 'vault' | 'files' | 'saver' | 'step';
  name: string;
  path?: string | null;
  from?: string;
  /** vault 的資料夾事件：當下 TFolder.children 還有幾個。 */
  children?: number;
  open?: string[];
}
interface Recorder { records: Recorded[]; step(name: string): void; stop(): Recorded[] }
export interface EventsHost { app: App; saver: Saver | null; state: () => State | null; log(listener: (event: string) => void): () => void }

const DECKS = 'Essence Cards/W5 範例/事件測試';
const SCRATCH = 'Essence W5/事件';
/** 每一步之後等多久再做下一步（毫秒）：比存檔備援的 LEAVE_DELAY（1 秒）長，備援的紀錄也收得到。 */
const SETTLE = 1500;
/** Obsidian 以外的改動，最多等多久讓 Obsidian 發現（毫秒）。 */
const OUTSIDE = 10000;

const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (check()) return true; await sleep(50); }
  return check();
}

export function leafPath(leaf: WorkspaceLeaf): string | null {
  if (leaf.view instanceof MarkdownView) return leaf.view.file?.path ?? null;
  const file = leaf.getViewState().state?.file;
  return typeof file === 'string' ? file : null;
}
/** 所有 Markdown 分頁開著的檔；目前的分頁、還沒載入的分頁、另一個視窗裡的分頁另外標出來。 */
function openNow(app: App): string[] {
  const active = app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
  return app.workspace.getLeavesOfType('markdown').map(leaf => {
    const marks = [leaf === active ? '目前' : '', leaf.view instanceof MarkdownView ? '' : '未載入', leaf.view.containerEl.win === window ? '' : '另一個視窗'].filter(Boolean);
    return (leafPath(leaf) ?? '（沒有檔案）') + (marks.length ? '（' + marks.join('、') + '）' : '');
  }).sort();
}

function startRecording(host: EventsHost): Recorder {
  const { app } = host;
  const { workspace, vault } = app;
  const started = performance.now();
  const records: Recorded[] = [];
  const push = (kind: Recorded['kind'], name: string, extra: Partial<Recorded> = {}) => {
    records.push({ n: records.length + 1, ms: Math.round((performance.now() - started) * 10) / 10, kind, name, ...extra });
  };
  const entry = (file: TAbstractFile): Partial<Recorded> => ({ path: file.path, ...(file instanceof TFolder ? { children: file.children.length } : {}) });
  const open = () => ({ open: openNow(app) });
  const workspaceRefs = [
    workspace.on('layout-change', () => { push('workspace', 'layout-change', open()); }),
    workspace.on('file-open', file => { push('workspace', 'file-open', { path: file?.path ?? null, ...open() }); }),
    workspace.on('active-leaf-change', leaf => { push('workspace', 'active-leaf-change', { path: leaf ? leafPath(leaf) : null, ...open() }); }),
    workspace.on('editor-change', (_editor, info) => { push('workspace', 'editor-change', { path: info.file?.path ?? null }); }),
    workspace.on('window-open', () => { push('workspace', 'window-open', open()); }),
    workspace.on('window-close', () => { push('workspace', 'window-close', open()); }),
  ];
  const vaultRefs = [
    vault.on('create', file => { push('vault', 'create', entry(file)); }),
    vault.on('modify', file => { push('vault', 'modify', entry(file)); }),
    vault.on('delete', file => { push('vault', 'delete', entry(file)); }),
    vault.on('rename', (file, oldPath) => { push('vault', 'rename', { ...entry(file), from: oldPath }); }),
  ];
  const stopFiles = createObsidianFiles(app).watch(path => { push('files', 'notify', { path }); });
  const stopLog = host.log(event => { push('saver', event.replace(/^\d+ /, '')); });
  // main.ts 的 ViewPlugin 經過 saver.opened 告訴備援「這篇開著」：換成先記一筆再照原樣呼叫，停止時換回來。
  const { saver } = host;
  const opened = saver?.opened;
  if (saver && opened) saver.opened = path => { push('saver', 'opened', { path: path ?? null }); opened(path); };
  return {
    records,
    step: name => { push('step', name, open()); },
    stop: () => {
      for (const ref of workspaceRefs) workspace.offref(ref);
      for (const ref of vaultRefs) vault.offref(ref);
      stopFiles();
      stopLog();
      if (saver && opened) saver.opened = opened;
      return records;
    },
  };
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  let path = '';
  for (const part of folder.split('/')) {
    path = path ? path + '/' + part : part;
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
  }
}
async function writeFile(app: App, path: string, text: string): Promise<TFile> {
  await ensureFolder(app, path.slice(0, path.lastIndexOf('/')));
  const found = app.vault.getFileByPath(path);
  if (found) { await app.vault.modify(found, text); return found; }
  return app.vault.create(path, text);
}
/** 刪掉測試建的資料夾，回傳最後還在的路徑（src/dev/cleanup.ts：Obsidian 的快取或磁碟任一邊還有就再刪，最多三輪）。 */
export function removeTestPaths(app: App, paths: string[]): Promise<string[]> {
  const { vault } = app;
  return removePaths({
    cached: path => !!vault.getAbstractFileByPath(path),
    exists: path => vault.adapter.exists(path),
    async remove(path, cached) {
      const found = vault.getAbstractFileByPath(path);
      if (cached && found) { await vault.delete(found, true); return; }
      const stat = await vault.adapter.stat(path);
      if (stat?.type === 'folder') await vault.adapter.rmdir(path, true);
      else if (stat) await vault.adapter.remove(path);
    },
    wait: sleep,
  }, paths);
}
const removeFolders = (app: App): Promise<string[]> => removeTestPaths(app, [DECKS, SCRATCH]);
/** 卡組都已經有 ID：關掉時備援不會寫檔，vault 的事件只有操作本身的。 */
function deckText(name: string, id: string): string { return `- 能說明${name} ^${id}\n    - ${name}是什麼？ :: ${name}\n`; }
const newId = (tag: string): string => 'v' + Date.now().toString(36).slice(-4) + tag;

/**
 * Obsidian 以外的檔案操作：Node 的 fs（Obsidian 的電腦版提供 require）。移到資源回收筒（Electron 的 shell.trashItem）
 * 在 renderer 失敗（Failed to create FileOperation instance，2026-10-27），改由 record-start、record-stop 之間在 Windows 做。
 */
interface Outside { full(path: string): string; rm(path: string): Promise<void>; rename(from: string, to: string): Promise<void> }
function outside(app: App): Outside {
  const load = (window as unknown as { require?: (name: string) => unknown }).require;
  if (!load) throw Error('這裡沒有 require（不是電腦版）');
  const fs = load('fs') as { promises: { rm(path: string, options: { recursive: boolean }): Promise<void>; rename(from: string, to: string): Promise<void> } };
  const full = (path: string) => (app.vault.adapter as unknown as { getFullPath(path: string): string }).getFullPath(path);
  return {
    full,
    rm: path => fs.promises.rm(full(path), { recursive: true }),
    rename: (from, to) => fs.promises.rename(full(from), full(to)),
  };
}

/** 一行一筆；路徑去掉這次測試資料夾的前綴，open 是當時開著的分頁。 */
const short = (path: string): string => path.replace(DECKS + '/', '').replace(SCRATCH + '/', '');
const show = (r: Recorded): string => `${r.ms} ${r.kind} ${r.name}${r.path !== undefined ? ' ' + (r.path === null ? 'null' : short(r.path)) : ''}${r.from ? ' ← ' + short(r.from) : ''}`
  + `${r.children !== undefined ? '（children ' + r.children + '）' : ''}${r.open ? '｜開著：' + (r.open.map(short).join('、') || '無') : ''}`;

/** 改名的那一段：Obsidian 送的是 rename（帶舊路徑）還是 delete＋create，間隔多少；Files.watch 通知了哪些。 */
function renameSeen(records: Recorded[], from: string, to: string) {
  const vault = records.filter(r => r.kind === 'vault' && (r.path === from || r.path === to || r.from === from));
  const renamed = vault.find(r => r.name === 'rename' && r.from === from && r.path === to);
  const removed = vault.find(r => r.name === 'delete' && r.path === from), created = vault.find(r => r.name === 'create' && r.path === to);
  return {
    kind: renamed ? 'rename' : removed && created ? 'delete+create' : 'other',
    // create 的時間減 delete 的時間：負的表示新路徑的 create 先到。
    gapMs: !renamed && removed && created ? Math.round((created.ms - removed.ms) * 10) / 10 : null,
    vault: vault.map(show),
    files: records.filter(r => r.kind === 'files' && (r.path === from || r.path === to)).map(show),
  };
}

/** 資料夾刪掉之後：每個檔都收到 Files.watch 的通知、read 都是 null（契約 C15）。 */
async function deletedSeen(app: App, records: Recorded[], paths: string[]) {
  const files = createObsidianFiles(app);
  const notified = paths.map(path => records.some(r => r.kind === 'files' && r.path === path));
  const reads = await Promise.all(paths.map(path => files.read(path).then(text => text, (error: unknown) => 'reject: ' + String(error))));
  return {
    ok: notified.every(Boolean) && reads.every(text => text === null),
    notified: Object.fromEntries(paths.map((path, i) => [path, notified[i]])),
    reads: Object.fromEntries(paths.map((path, i) => [path, reads[i]])),
    vault: records.filter(r => r.kind === 'vault').map(show),
  };
}
const folderFiles = (folder: string) => [folder + '/1.md', folder + '/sub/2.md'];
async function makeFolder(app: App, folder: string): Promise<void> {
  for (const path of folderFiles(folder)) await writeFile(app, path, path + '\n');
}

/**
 * A3：背景開檔、關檔、換篇、切換分頁、改名、另一個視窗，各發哪些 workspace 事件；每筆記下當時開著哪些。
 * 「底」是一般筆記，用閱讀模式開在主視窗、一直開著（背景開檔要有別的分頁在前景才算背景），裡面的連結給中鍵與 Ctrl＋點。
 */
async function a3(app: App, rec: Recorder): Promise<Recorded[]> {
  const { workspace } = app;
  const tag = newId('');
  const [a, b, c] = await Promise.all(['甲', '乙', '丙'].map((name, i) => writeFile(app, `${DECKS}/${name}（卡片）.md`, deckText(name, tag + 'abc'[i]))));
  const base = await writeFile(app, `${SCRATCH}/底.md`, `[[${a.path.slice(0, -3)}|甲]]\n\n[[${c.path.slice(0, -3)}|丙]]\n`);
  await sleep(SETTLE);
  const from = rec.records.length;
  const step = async (name: string, action: () => unknown) => { rec.step(name); await action(); await sleep(SETTLE); };
  const tab = async (file: TFile, active = true) => { const leaf = workspace.getLeaf('tab'); await leaf.openFile(file, { active }); return leaf; };
  const leafOf = (file: TFile) => workspace.getLeavesOfType('markdown').find(leaf => leafPath(leaf) === file.path) ?? null;
  /** 在「底」的閱讀模式點連結：button 1 是中鍵（mousedown、mouseup、auxclick），ctrl 是 Ctrl＋左鍵。 */
  const click = (index: number, init: MouseEventInit) => {
    const link = anchor?.view.containerEl.querySelectorAll<HTMLElement>('.markdown-preview-view a.internal-link')[index];
    if (!link) throw Error('「底」的閱讀模式找不到第 ' + (index + 1) + ' 個連結');
    const events = init.button === 1 ? ['mousedown', 'mouseup', 'auxclick'] : ['mousedown', 'mouseup', 'click'];
    for (const type of events) link.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...init }));
  };
  let anchor: WorkspaceLeaf | null = null, leaf: WorkspaceLeaf | null = null, popout: Window | null = null;
  await step('0 「底」用閱讀模式開在前景分頁', async () => { anchor = workspace.getLeaf('tab'); await anchor.openFile(base, { active: true, state: { mode: 'preview' } }); });
  // 先開一個空白分頁再切回「底」，下一步只記檔案載入到背景分頁的那一段。
  await step('1a 開一個空白分頁，再切回「底」', () => { leaf = workspace.getLeaf('tab'); if (anchor) workspace.setActiveLeaf(anchor, { focus: true }); });
  await step('1 背景開檔（程式）：甲載入到背景的空白分頁', () => leaf?.openFile(a, { active: false }));
  await step('2 關掉甲的背景分頁', () => { leaf?.detach(); });
  await step('3 中鍵點「底」裡丙的連結', () => { click(1, { button: 1, buttons: 4 }); });
  await step('4 關掉丙的分頁', () => { leafOf(c)?.detach(); });
  await step('5 Ctrl＋點「底」裡甲的連結', () => { click(0, { button: 0, ctrlKey: true }); });
  await step('6 關掉甲的分頁', () => { leafOf(a)?.detach(); });
  await step('7 前景開檔：乙開到新的分頁', async () => { leaf = await tab(b); });
  await step('8 同一個分頁換成丙', () => leaf?.openFile(c));
  await step('9 切到「底」的分頁', () => { if (anchor) workspace.setActiveLeaf(anchor, { focus: true }); });
  await step('10 切回丙的分頁', () => { if (leaf) workspace.setActiveLeaf(leaf, { focus: true }); });
  await step('11 改名開著的丙', () => app.vault.rename(c, `${DECKS}/丙 改名（卡片）.md`));
  await step('12 關掉改名後的丙（目前的分頁）', () => { leaf?.detach(); });
  await step('13 甲開到另一個視窗', async () => { leaf = workspace.openPopoutLeaf(); await leaf.openFile(a); });
  await step('14 關掉另一個視窗裡的分頁', () => { leaf?.detach(); });
  await step('15 乙開到分頁，再移到另一個視窗', async () => { popout = workspace.moveLeafToPopout(await tab(b)).win; });
  await step('16 用視窗的關閉關掉另一個視窗', () => { popout?.close(); });
  await step('17 關掉「底」（最後一個分頁）', () => { anchor?.detach(); });
  rec.step('結束');
  return rec.records.slice(from);
}

/** T3：資料夾在 Obsidian 裡刪與在 Obsidian 以外刪（C15），以及 Obsidian 以外的改名。 */
async function t3(app: App, rec: Recorder): Promise<unknown> {
  const out: Record<string, unknown> = {};
  const ops = outside(app);
  const removals: [string, (path: string) => Promise<void>][] = [
    ['vault.delete', path => { const found = app.vault.getAbstractFileByPath(path); if (!found) throw Error('找不到 ' + path); return app.vault.delete(found, true); }],
    ['直接刪除（Node 的 fs.rm，像 Shift+Delete 或其他程式）', path => ops.rm(path)],
  ];
  for (const [i, [name, remove]] of removals.entries()) {
    const folder = `${SCRATCH}/${i + 1}/f`;
    await makeFolder(app, folder);
    await sleep(SETTLE);
    const from = rec.records.length;
    rec.step('C15 刪除資料夾：' + name);
    const startedAt = performance.now();
    try { await remove(folder); } catch (error) { out[name] = { error: String(error) }; continue; }
    const paths = folderFiles(folder);
    const all = await until(() => paths.every(path => rec.records.slice(from).some(r => r.kind === 'files' && r.path === path)), OUTSIDE);
    out[name] = { waitedMs: Math.round(performance.now() - startedAt), allNotified: all, ...await deletedSeen(app, rec.records.slice(from), paths) };
  }
  const old = `${DECKS}/外部改名（卡片）.md`, renamed = `${DECKS}/外部改名 後（卡片）.md`;
  await writeFile(app, old, deckText('沉澱', newId('c')));
  await sleep(SETTLE);
  const from = rec.records.length;
  rec.step('外部改名一篇卡組（Node 的 fs.rename）');
  await ops.rename(old, renamed);
  await until(() => renameSeen(rec.records, old, renamed).kind !== 'other', OUTSIDE);
  await sleep(SETTLE);
  out['外部改名（fs.rename）'] = renameSeen(rec.records.slice(from), old, renamed);
  return out;
}

/** events：A3 與 T3 一次做完，結束時清掉這次建的檔。 */
export async function eventsTest(host: EventsHost): Promise<unknown> {
  const { app } = host;
  await removeFolders(app);
  const rendering = keepRendering();
  const rec = startRecording(host);
  const startedAt = new Date().toISOString();
  let result: Record<string, unknown>, cleanupLeft: string[] = [];
  try {
    const a3Records = await a3(app, rec);
    result = { startedAt, visibilityBefore: rendering.before, a3: a3Records.map(show), t3: await t3(app, rec) };
  } finally {
    rec.stop();
    rendering.restore();
    cleanupLeft = await removeFolders(app);
  }
  return { ...result, cleanupLeft };
}

// record-start 建好要操作的檔、開始記錄並交回完整路徑；AI 在 Windows 用檔案總管同一套 Shell 操作（改名、刪除；iCloud 的資料夾
// 不能刪到資源回收筒，2026-10-27 實測回「cloud sync provider 不支援」，檔案總管在那裡只能永久刪除），
// 再執行 record-stop 停止記錄、判斷結果並清掉這次建的檔。
const MANUAL = { deck: `${DECKS}/檔案總管改名（卡片）.md`, renamed: `${DECKS}/檔案總管改名 後（卡片）.md`, folder: `${SCRATCH}/檔案總管/f` };
let manual: { rec: Recorder; startedAt: string } | null = null;
export async function recordStart(host: EventsHost): Promise<unknown> {
  const { app } = host;
  manual?.rec.stop();
  manual = null;
  await removeFolders(app);
  await writeFile(app, MANUAL.deck, deckText('結晶', newId('d')));
  await makeFolder(app, MANUAL.folder);
  await sleep(SETTLE);
  manual = { rec: startRecording(host), startedAt: new Date().toISOString() };
  const ops = outside(app);
  return { startedAt: manual.startedAt, rename: { from: ops.full(MANUAL.deck), to: ops.full(MANUAL.renamed) }, removeFolder: ops.full(MANUAL.folder) };
}
export async function recordStop(host: EventsHost): Promise<unknown> {
  if (!manual) throw Error('還沒開始記錄：先執行 record-start');
  const { rec, startedAt } = manual;
  manual = null;
  const records = rec.stop();
  const result = {
    startedAt, records: records.map(show),
    rename: renameSeen(records, MANUAL.deck, MANUAL.renamed),
    c15: await deletedSeen(host.app, records, folderFiles(MANUAL.folder)),
  };
  return { ...result, cleanupLeft: await removeFolders(host.app) };
}

// ── a3check：Codex 查核 A3 設計稿要的實測（設計稿〈Codex 回應〉第 1、3、5 題與〈Codex L2〉的 R1） ──
// 每個情境用沒有 ID 的卡組，記下事件與每次的集合，核對每篇補了幾個 ID、有沒有問題；看按鈕時不呼叫 saver.refresh。
// 必要的操作（切成疊放、開在背景、開成閱讀模式、在畫布裡打字）沒做到就算失敗；做不到的子項列成未測（src/dev/marks.ts 的 judge）。

const MATRIX = `${DECKS}/矩陣`;
const BASE = `${SCRATCH}/底.md`;
/** 補 ID 要等多久才看結果（毫秒）：LEAVE_DELAY 1 秒加上寫檔與重讀。 */
const FILL_WAIT = 2500;

type LayoutNode = { id?: string; type?: string; children?: LayoutNode[]; currentTab?: number; state?: unknown };
function firstTabs(node: LayoutNode): LayoutNode | null {
  if (node.type === 'tabs') return node;
  for (const child of node.children ?? []) { const found = firstTabs(child); if (found) return found; }
  return null;
}
const leafId = (): string => Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
/**
 * 以 base 的版面為底，主視窗只留一個分頁群組：anchor 在最前面（目前的分頁），後面依序是 files（背景）。給 changeLayout 用：
 * Workspaces 核心外掛存版面就是 getLayout()、切版面就是 changeLayout()（Obsidian 1.14.5 的程式碼，2026-10-28 查過）。
 */
function layoutWith(base: Record<string, unknown>, anchor: string, files: string[]): Record<string, unknown> {
  const layout = structuredClone(base) as Record<string, unknown> & { main: LayoutNode };
  const tabs = firstTabs(layout.main);
  if (!tabs) throw Error('版面裡找不到分頁群組');
  const id = leafId();
  const leaf = (file: string, key: string, mode: string): LayoutNode => ({ id: key, type: 'leaf', state: { type: 'markdown', state: { file, mode } } });
  tabs.children = [leaf(anchor, id, 'preview'), ...files.map(file => leaf(file, leafId(), 'source'))];
  tabs.currentTab = 0;
  layout.main = { ...layout.main, children: [tabs] };
  layout.active = id;
  return layout;
}

export async function a3Check(host: EventsHost): Promise<unknown> {
  const { app } = host;
  const { workspace } = app;
  await removeFolders(app);
  const original = workspace.getLayout();
  const sidebars = { left: workspace.leftSplit.collapsed, right: workspace.rightSplit.collapsed };
  const command = (id: string): boolean => (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(id);
  const cases: Record<string, Judged & { marks: Mark[]; events: string[] }> = {};
  let made = 0;
  /** 一篇沒有 ID 的卡組（一個目標），等 state 讀到它再開始。 */
  const deck = async (name: string): Promise<TFile> => {
    const file = await writeFile(app, `${MATRIX}/${++made} ${name}（卡片）.md`, `- 能說明${name}\n    - ${name}是什麼？ :: ${name}\n`);
    await until(() => host.state()?.deckStatus(file.path).missing === 1, 5000);
    return file;
  };
  const ids = async (file: TFile): Promise<number> => ((await app.vault.read(file)).match(/ \^[a-z0-9]{6}$/gm) ?? []).length;
  const issues = (file: TFile): number => host.state()?.deckStatus(file.path).issues.length ?? -1;
  const leafOf = (file: TFile) => workspace.getLeavesOfType('markdown').find(leaf => leafPath(leaf) === file.path) ?? null;
  const anchor = () => workspace.getLeavesOfType('markdown').find(leaf => leafPath(leaf) === BASE) ?? null;
  const front = () => { const leaf = anchor(); if (leaf) workspace.setActiveLeaf(leaf, { focus: true }); };
  /** 「底」還是目前的分頁（開在背景的檢查用）。 */
  const anchorActive = (): boolean => { const leaf = anchor(); return !!leaf && workspace.getActiveViewOfType(MarkdownView)?.leaf === leaf; };
  const stacked = (leaf: WorkspaceLeaf | null): boolean => (leaf?.parent as unknown as { isStacked?: boolean } | undefined)?.isStacked === true;
  /** 主視窗只剩「底」：每個情境從這裡開始。 */
  const reset = async () => { await workspace.changeLayout(layoutWith(original, BASE, [])); await sleep(SETTLE); };
  /** 一個空白的背景分頁（先開再切回「底」）。 */
  const blank = async () => { const leaf = workspace.getLeaf('tab'); front(); await sleep(300); return leaf; };
  /** 分頁上的存檔按鈕現在的樣子；沒有按鈕是 null。 */
  const button = (leaf: WorkspaceLeaf | null) => {
    const el = leaf?.view instanceof MarkdownView ? leaf.view.containerEl.querySelector<HTMLElement>('.essence-cards-save') : null;
    return el ? ['done', 'missing', 'issues'].find(kind => el.hasClass('is-' + kind)) ?? 'other' : null;
  };
  /** expect 是這個時間點預期的 ID 數（0 表示還不該補）。 */
  const check = async (marks: Mark[], at: string, file: TFile, expect: number) => {
    marks.push({ at, deck: short(file.path), ids: await ids(file), expect, issues: issues(file) });
  };
  await writeFile(app, BASE, '「底」：一般筆記。\n');
  await writeFile(app, `${SCRATCH}/一般筆記.md`, '不是卡組。\n');
  const rendering = keepRendering();
  const rec = startRecording(host);
  let cleanupLeft: string[] = [];
  async function run(name: string, body: (marks: Mark[]) => Promise<void>): Promise<void> {
    await reset();
    const from = rec.records.length;
    rec.step(name);
    const marks: Mark[] = [];
    try { await body(marks); } catch (error) { marks.push({ at: '情境', error: error instanceof Error ? error.stack ?? error.message : String(error) }); }
    cases[name] = { ...judge(marks), marks, events: rec.records.slice(from).filter(r => r.kind !== 'files').map(show) };
  }
  try {
    await run('C1 背景開完立即關', async marks => {
      const p = await deck('甲'), leaf = await blank();
      await leaf.openFile(p, { active: false });
      marks.push({ at: '甲開在背景（「底」還是目前的分頁）', done: anchorActive() });
      leaf.detach();
      await sleep(FILL_WAIT); await check(marks, '關掉之後', p, 1);
    });
    await run('C2 前景快速開、換篇、關', async marks => {
      const p = await deck('甲'), q = await deck('乙'), leaf = workspace.getLeaf('tab');
      await leaf.openFile(p); await leaf.openFile(q); leaf.detach();
      await sleep(FILL_WAIT); await check(marks, '關掉之後', p, 1); await check(marks, '關掉之後', q, 1);
    });
    await run('C3 背景快速開、換篇、關', async marks => {
      const p = await deck('甲'), q = await deck('乙'), leaf = await blank();
      await leaf.openFile(p, { active: false }); await leaf.openFile(q, { active: false });
      marks.push({ at: '開在背景（「底」還是目前的分頁）', done: anchorActive() });
      leaf.detach();
      await sleep(FILL_WAIT); await check(marks, '關掉之後', p, 1); await check(marks, '關掉之後', q, 1);
    });
    await run('C4 側欄：右側開、收合、展開、換篇、關；左側開、關', async marks => {
      const p = await deck('甲'), q = await deck('乙'), r = await deck('丙');
      const right = workspace.getRightLeaf(false);
      if (!right) throw Error('右側欄開不出分頁');
      await right.openFile(p); await sleep(FILL_WAIT); await check(marks, '右側開著', p, 0);
      workspace.rightSplit.collapse(); await sleep(FILL_WAIT);
      marks.push({ at: '右側收合', done: workspace.rightSplit.collapsed });
      await check(marks, '右側收合', p, 0);
      workspace.rightSplit.expand(); await right.openFile(q); await sleep(FILL_WAIT); await check(marks, '右側換篇', p, 1);
      right.detach(); await sleep(FILL_WAIT); await check(marks, '右側關掉', q, 1);
      const left = workspace.getLeftLeaf(false);
      if (!left) throw Error('左側欄開不出分頁');
      await left.openFile(r); await sleep(FILL_WAIT); await check(marks, '左側開著', r, 0);
      left.detach(); await sleep(FILL_WAIT); await check(marks, '左側關掉', r, 1);
    });
    await run('C5 分割：同一篇開在兩邊、一邊換篇、關掉', async marks => {
      const p = await deck('甲'), q = await deck('乙');
      const a = workspace.getLeaf('tab'); await a.openFile(p);
      const b = workspace.getLeaf('split', 'vertical'); await b.openFile(p);
      marks.push({ at: '分成兩個分頁群組', done: a.parent !== b.parent });
      await sleep(FILL_WAIT); await check(marks, '兩邊都開著', p, 0);
      await b.openFile(q); await sleep(FILL_WAIT); await check(marks, '一邊換成乙、另一邊還開著甲', p, 0);
      a.detach(); await sleep(FILL_WAIT); await check(marks, '關掉甲那一邊', p, 1);
      b.detach(); await sleep(FILL_WAIT); await check(marks, '關掉乙那一邊', q, 1);
    });
    await run('C6 疊放分頁：切換、關背景頁、關掉剩下的', async marks => {
      const p = await deck('甲'), q = await deck('乙');
      const a = workspace.getLeaf('tab'); await a.openFile(p);
      const b = workspace.getLeaf('tab'); await b.openFile(q);
      const executed = command('workspace:toggle-stacked-tabs');
      await sleep(SETTLE);
      marks.push({ at: '切成疊放', done: executed && stacked(a), detail: { executed, stacked: stacked(a) } });
      workspace.setActiveLeaf(a, { focus: true }); await sleep(FILL_WAIT);
      await check(marks, '切到甲', p, 0); await check(marks, '切到甲', q, 0);
      b.detach(); await sleep(FILL_WAIT); await check(marks, '關掉背景的乙', q, 1); await check(marks, '關掉背景的乙', p, 0);
      a.detach(); await sleep(FILL_WAIT); await check(marks, '關掉甲', p, 1);
      front();
      const back = command('workspace:toggle-stacked-tabs');
      await sleep(300);
      marks.push({ at: '切回不疊放', done: back && !stacked(anchor()), detail: { executed: back, stacked: stacked(anchor()) } });
    });
    await run('C7 setViewState：前景換檔、切模式、換成別種畫面；背景換檔', async marks => {
      const p = await deck('甲'), q = await deck('乙'), r = await deck('丙'), t = await deck('丁');
      const leaf = workspace.getLeaf('tab'); await leaf.openFile(p); await sleep(SETTLE);
      await leaf.setViewState({ type: 'markdown', state: { file: q.path, mode: 'source' } });
      await sleep(FILL_WAIT); await check(marks, '前景甲換成乙', p, 1);
      await leaf.setViewState({ type: 'markdown', state: { file: q.path, mode: 'preview' } });
      marks.push({ at: '乙切成閱讀模式', done: leaf.getViewState().state?.mode === 'preview' });
      await sleep(FILL_WAIT); await check(marks, '乙切成閱讀模式', q, 0);
      await leaf.setViewState({ type: 'empty' });
      await sleep(FILL_WAIT); await check(marks, '乙的分頁換成空白畫面', q, 1);
      const bg = await blank();
      await bg.openFile(r, { active: false }); await sleep(SETTLE);
      await bg.setViewState({ type: 'markdown', state: { file: t.path, mode: 'source' }, active: false });
      marks.push({ at: '丁在背景（「底」還是目前的分頁）', done: anchorActive() });
      await sleep(FILL_WAIT); await check(marks, '背景丙換成丁', r, 1);
      bg.detach(); await sleep(FILL_WAIT); await check(marks, '關掉背景的丁', t, 1);
    });
    await run('C8 版面切換（Workspaces 核心外掛存與切版面用的 getLayout、changeLayout）', async marks => {
      marks.push({ at: 'Workspaces 核心外掛本身', note: '測試 vault 沒有開；它存版面就是 getLayout()、切版面就是 changeLayout()（1.14.5 的程式碼）' });
      const common = await deck('共同'), onlyA = await deck('只在A'), later = await deck('A的背景'), onlyB = await deck('只在B');
      await workspace.changeLayout(layoutWith(original, BASE, [common.path, onlyA.path, later.path]));
      await sleep(FILL_WAIT);
      // 版面裡的每一篇都要真的開出來：沒有分頁（null）不能當成已載入，共同的卡組也要在兩個版面都開著（Codex L2 再審的 S2）。
      const opened = (files: TFile[]) => files.map(file => ({ deck: short(file.path), leaf: !!leafOf(file) }));
      marks.push({ at: '版面 A 開著共同、只在A、A的背景', done: [common, onlyA, later].every(file => leafOf(file)), detail: opened([common, onlyA, later]) });
      const deferred = [common, onlyA, later].map(file => leafOf(file)?.isDeferred ?? null);
      marks.push({ at: '版面 A 的背景分頁是不是未載入', note: deferred });
      if (deferred.every(value => value === false)) marks.push({ at: '版面切換時才出現的未載入分頁', skipped: 'changeLayout 開出來的背景分頁都已載入（isDeferred 都是 false）；冷啟動的未載入分頁見 t1prep → app-reload → t1close-cold' });
      for (const file of [common, onlyA, later]) await check(marks, '版面 A', file, 0);
      await workspace.changeLayout(layoutWith(original, BASE, [common.path, onlyB.path]));
      await sleep(FILL_WAIT);
      marks.push({ at: '版面 B 開著共同、只在B，不再開著只在A、A的背景', done: [common, onlyB].every(file => leafOf(file)) && ![onlyA, later].some(file => leafOf(file)), detail: opened([common, onlyB, onlyA, later]) });
      await check(marks, '換成版面 B', common, 0); await check(marks, '換成版面 B', onlyA, 1); await check(marks, '換成版面 B', later, 1); await check(marks, '換成版面 B', onlyB, 0);
      const b = leafOf(onlyB);
      if (b) workspace.setActiveLeaf(b, { focus: true });
      await sleep(FILL_WAIT);
      marks.push({ at: '切到只在B之後（不呼叫 refresh）', button: button(leafOf(onlyB)), expectButton: 'missing' });
      await reset(); await sleep(FILL_WAIT - SETTLE);
      await check(marks, '只剩底', common, 1); await check(marks, '只剩底', onlyB, 1);
    });
    await run('C9 按鈕（不呼叫 refresh）：開卡組、同一個分頁換成一般筆記、再換卡組、關掉', async marks => {
      const p = await deck('甲'), q = await deck('乙');
      const plain = app.vault.getFileByPath(`${SCRATCH}/一般筆記.md`);
      if (!plain) throw Error('找不到一般筆記');
      const leaf = workspace.getLeaf('tab'); await leaf.openFile(p); await sleep(SETTLE);
      marks.push({ at: '開卡組', button: button(leaf), expectButton: 'missing' });
      await leaf.openFile(plain); await sleep(SETTLE);
      marks.push({ at: '換成一般筆記', button: button(leaf), expectButton: null });
      await leaf.openFile(q); await sleep(SETTLE);
      marks.push({ at: '再換成卡組', button: button(leaf), expectButton: 'missing' });
      leaf.detach(); await sleep(FILL_WAIT);
      await check(marks, '關掉之後', p, 1); await check(marks, '關掉之後', q, 1);
    });
    await run('C10 Canvas：只在畫布上、在畫布裡打字時別處送 layout-change、同一篇也開在分頁', async marks => {
      const p = await deck('甲'), q = await deck('乙'), r = await deck('丙');
      const canvas = await writeFile(app, `${SCRATCH}/畫布.canvas`, JSON.stringify({ nodes: [p, q].map((file, i) => ({ id: 'n' + i, type: 'file', file: file.path, x: i * 450, y: 0, width: 400, height: 300 })), edges: [] }));
      const leaf = workspace.getLeaf('tab'); await leaf.openFile(canvas); await sleep(FILL_WAIT);
      marks.push({ at: '畫布開著時的 Markdown 分頁', note: openNow(app).map(short) });
      await check(marks, '只在畫布上', p, 0);
      // 進入甲那張卡片的編輯：先試 Canvas 節點的 startEditing（未公開），再試雙擊；找到 CodeMirror 才打字。
      type CanvasNode = { file?: TFile; startEditing?: () => void; contentEl?: HTMLElement; nodeEl?: HTMLElement };
      const nodes = [...(leaf.view as unknown as { canvas?: { nodes?: Map<string, CanvasNode> } }).canvas?.nodes?.values() ?? []];
      const node = nodes.find(n => n.file?.path === p.path);
      node?.startEditing?.();
      await sleep(800);
      const editor = () => (node?.contentEl ?? leaf.view.containerEl).querySelector<HTMLElement>('.cm-content');
      if (!editor()) { (node?.nodeEl ?? leaf.view.containerEl.querySelector<HTMLElement>('.canvas-node'))?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window })); await sleep(800); }
      const content = editor();
      const cm = content ? EditorView.findFromDOM(content) : null;
      if (!cm) marks.push({ at: '在畫布裡打字', skipped: `找不到甲那張卡片的編輯器（畫布節點 ${nodes.length} 個、找到甲：${String(!!node)}、startEditing：${typeof node?.startEditing}）` });
      else {
        cm.dispatch({ changes: { from: cm.state.doc.length, insert: '- 能說明畫布\n    - 畫布是什麼？ :: 畫布\n' }, userEvent: 'input.type' });
        await sleep(SETTLE);
        marks.push({ at: '在畫布裡打字', done: (await app.vault.read(p)).includes('能說明畫布') });
        // 甲還在畫布裡編輯時，右側欄開關丙一次（送 layout-change，不搶走畫布的焦點）：不能在家長還在打字時補甲。
        const side = workspace.getRightLeaf(false);
        if (side) { await side.openFile(r, { active: false }); await sleep(SETTLE); side.detach(); }
        await sleep(FILL_WAIT);
        await check(marks, '畫布裡還在編輯、別處送了 layout-change', p, 0);
        await check(marks, '右側欄開關的丙', r, 1);
      }
      const tab = workspace.getLeaf('tab'); await tab.openFile(q); await sleep(SETTLE);
      tab.detach(); await sleep(FILL_WAIT);
      await check(marks, '乙也開在分頁、關掉分頁（畫布還開著）', q, 1);
      leaf.detach(); await sleep(FILL_WAIT);
      marks.push({ at: '關掉畫布之後的甲', note: { ids: await ids(p), text: await app.vault.read(p) } });
    });
    await run('C11 閱讀模式：開完馬上關、背景開完馬上關、開換篇關', async marks => {
      const p = await deck('甲'), q = await deck('乙'), r = await deck('丙'), t = await deck('丁');
      const preview = { mode: 'preview' };
      let leaf = workspace.getLeaf('tab');
      await leaf.openFile(p, { state: preview });
      marks.push({ at: '甲開成閱讀模式', done: leaf.getViewState().state?.mode === 'preview' });
      leaf.detach();
      await sleep(FILL_WAIT); await check(marks, '前景閱讀模式開完馬上關', p, 1);
      leaf = await blank();
      await leaf.openFile(q, { active: false, state: preview });
      marks.push({ at: '乙用閱讀模式開在背景', done: leaf.getViewState().state?.mode === 'preview' && anchorActive() });
      leaf.detach();
      await sleep(FILL_WAIT); await check(marks, '背景閱讀模式開完馬上關', q, 1);
      leaf = workspace.getLeaf('tab');
      // 丙開好就看模式，不另外等，才不會改變「快速」的情境（Codex L2 再審的 S2）。
      await leaf.openFile(r, { state: preview });
      const modeR = leaf.getViewState().state?.mode;
      await leaf.openFile(t, { state: preview });
      const modeT = leaf.getViewState().state?.mode;
      marks.push({ at: '丙、丁都開成閱讀模式', done: modeR === 'preview' && modeT === 'preview', detail: { 丙: modeR, 丁: modeT } });
      leaf.detach();
      await sleep(FILL_WAIT); await check(marks, '閱讀模式開、換篇、關（丙）', r, 1); await check(marks, '閱讀模式開、換篇、關（丁）', t, 1);
    });
  } finally {
    rec.stop();
    if (sidebars.left) workspace.leftSplit.collapse(); else workspace.leftSplit.expand();
    if (sidebars.right) workspace.rightSplit.collapse(); else workspace.rightSplit.expand();
    await workspace.changeLayout(original);
    rendering.restore();
    cleanupLeft = await removeFolders(app);
  }
  const entries = Object.entries(cases);
  return {
    cleanupLeft,
    ok: Object.fromEntries(entries.map(([name, result]) => [name, result.ok])),
    failed: Object.fromEntries(entries.filter(([, result]) => result.failed.length).map(([name, result]) => [name, result.failed])),
    skipped: Object.fromEntries(entries.filter(([, result]) => result.skipped.length).map(([name, result]) => [name, result.skipped])),
    cases,
  };
}
