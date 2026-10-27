import { MarkdownView, TFile, TFolder } from 'obsidian';
import type { App, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { createObsidianFiles } from './files.ts';
import type { Saver } from './save.ts';
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
export interface EventsHost { app: App; saver: Saver | null; log(listener: (event: string) => void): () => void }

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

function leafPath(leaf: WorkspaceLeaf): string | null {
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
async function removeFolders(app: App): Promise<void> {
  for (const path of [DECKS, SCRATCH]) {
    const found = app.vault.getAbstractFileByPath(path);
    if (found) await app.vault.delete(found, true);
  }
}
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
  try {
    const a3Records = await a3(app, rec);
    const t3Result = await t3(app, rec);
    return { startedAt, visibilityBefore: rendering.before, a3: a3Records.map(show), t3: t3Result };
  } finally {
    rec.stop();
    rendering.restore();
    await removeFolders(app);
  }
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
  try {
    return {
      startedAt, records: records.map(show),
      rename: renameSeen(records, MANUAL.deck, MANUAL.renamed),
      c15: await deletedSeen(host.app, records, folderFiles(MANUAL.folder)),
    };
  } finally { await removeFolders(host.app); }
}
