import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as codemirrorState from '@codemirror/state';
import * as codemirrorView from '@codemirror/view';

// src/main.ts 的接線（W5 §4-1）：用最小的 obsidian 替身在 Node 跑正式建置的程式碼，不是 Obsidian 實機。
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = async (dev: boolean) => (await build({
  absWorkingDir: root, entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['obsidian', '@codemirror/state', '@codemirror/view'], write: false, define: { 'process.env.NODE_ENV': '"production"', DEV: String(dev) },
})).outputFiles[0].text;
const bundled = await bundle(false);
/** 開發版（給 iPhone 的開發命令也在裡面）。 */
const devBundled = await bundle(true);

class TAbstractFile { path: string; constructor(path: string) { this.path = path; } }
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile { children: TAbstractFile[] = []; }

interface Host {
  plugin: { onload(): void; onunload(): void; state: { ready(): Promise<unknown>; answer(entry: unknown): string; fillIds(path: string): Promise<boolean> } | null };
  notices: string[];
  /** addCommand 的 id 與 registerEditorExtension 的次數（W5 §8-6：補 ID 與鎖定只在電腦）。 */
  commands: string[];
  extensions: () => number;
  text: (path: string) => string | undefined;
  /** onLayoutReady 之前 vault 被呼叫的次數。 */
  callsBeforeReady: () => number;
  layoutReady: () => void;
  hide: () => void;
  /** registerObsidianProtocolHandler 收到的處理函式（開發版的 URI）。 */
  uri: (params: Record<string, string>) => void;
  /** 寫入 vault 的動作與路徑。 */
  writes: string[];
  /** 放一個開著這篇的分頁（不送事件）；關掉全部分頁並送 layout-change。 */
  openTab: (path: string) => void;
  closeTabs: () => void;
}

/** 記憶體裡的 vault；failRead／failWrite 決定哪些路徑讀不到、寫不進去。 */
function host(texts: Record<string, string>, fail: { read?: (path: string) => boolean; write?: boolean }, desktop = false, code = bundled): Host {
  const notices: string[] = [];
  const commands: string[] = [];
  const writes: string[] = [];
  let uri: (params: Record<string, string>) => void = () => { throw Error('沒有註冊 URI'); };
  let extensions = 0;
  let calls = 0, ready = false, before = 0;
  const files = new Map(Object.entries(texts));
  const count = () => { if (!ready) calls++; };
  const vault = {
    getAbstractFileByPath: (path: string) => { count(); return files.has(path) ? new TFile(path) : null; },
    getFiles: () => { count(); return [...files.keys()].map(path => new TFile(path)); },
    read: (file: TFile) => { count(); return fail.read?.(file.path) ? Promise.reject(Error('讀不到：' + file.path)) : Promise.resolve(files.get(file.path) ?? ''); },
    create: (path: string, text: string) => { count(); writes.push('create ' + path); if (fail.write) return Promise.reject(Error('寫不進去')); files.set(path, text); return Promise.resolve(new TFile(path)); },
    append: (file: TFile, text: string) => { count(); writes.push('append ' + file.path); if (fail.write) return Promise.reject(Error('寫不進去')); files.set(file.path, (files.get(file.path) ?? '') + text); return Promise.resolve(); },
    process: (file: TFile, edit: (text: string) => string) => { count(); writes.push('process ' + file.path); files.set(file.path, edit(files.get(file.path) ?? '')); return Promise.resolve(''); },
    modify: (file: TFile, text: string) => { writes.push('modify ' + file.path); files.set(file.path, text); return Promise.resolve(); },
    delete: (file: TFile) => { writes.push('delete ' + file.path); files.delete(file.path); return Promise.resolve(); },
    getFileByPath: (path: string) => files.has(path) ? new TFile(path) : null,
    adapter: { write: (path: string, text: string) => { writes.push('adapter ' + path); files.set(path, text); return Promise.resolve(); } },
    createFolder: (path: string) => { count(); writes.push('folder ' + path); return Promise.resolve(); },
    on: () => { count(); return {}; },
    offref: () => {},
  };
  const layout: (() => void)[] = [];
  const handlers = new Map<string, () => void>();
  const leaves: { view: MarkdownView; getViewState: () => { state: { file: string } } }[] = [];
  const app = {
    vault,
    workspace: {
      onLayoutReady: (callback: () => void) => { layout.push(callback); },
      on: (name: string, callback: () => void) => { handlers.set(name, callback); return name; },
      getLeavesOfType: () => leaves, getActiveViewOfType: () => null,
    },
    loadLocalStorage: () => null, saveLocalStorage: () => {},
  };
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  class Plugin {
    app: unknown; manifest: unknown;
    constructor(app: unknown, manifest: unknown) { this.app = app; this.manifest = manifest; }
    addCommand(command: { id: string }) { commands.push(command.id); }
    registerEditorExtension() { extensions++; }
    registerEvent() {}
    registerInterval(id: number) { return id; }
    registerObsidianProtocolHandler(_action: string, handler: (params: Record<string, string>) => void) { uri = handler; }
    registerDomEvent(target: EventTarget, type: string, callback: () => void) { target.addEventListener(type, callback); }
  }
  class Notice { constructor(message: string) { notices.push(message); } }
  class MarkdownView {
    file: { path: string };
    constructor(path: string) { this.file = { path }; }
    addAction() { return { addClass() {}, setAttribute() {}, toggleClass() {}, remove() {} }; }
  }
  class Modal {}
  const obsidian = { Plugin, Notice, TFile, TFolder, TAbstractFile, MarkdownView, Modal, setIcon: () => {}, editorInfoField: {}, Platform: { isWin: true, isDesktopApp: desktop } };
  const module = { exports: {} as { default: new (app: unknown, manifest: unknown) => Host['plugin'] } };
  // 執行 esbuild 剛建好的正式版程式碼；document 與 window 由參數提供，不動 Node 的全域。
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('require', 'module', 'exports', 'document', 'window', code) as (require: (name: string) => unknown, module: unknown, exports: unknown, document: unknown, window: unknown) => void;
  run((name: string) => {
    if (name === '@codemirror/state') return codemirrorState;
    if (name === '@codemirror/view') return codemirrorView;
    if (name !== 'obsidian') throw Error('只能 require obsidian 與 CodeMirror：' + name);
    return obsidian;
  }, module, module.exports, document, { setTimeout, setInterval: () => 0 });
  const plugin = new module.exports.default(app, { id: 'essence-cards', version: '0.0.1' });
  return {
    plugin, notices, commands, extensions: () => extensions, text: path => files.get(path), writes, uri: params => { uri(params); },
    callsBeforeReady: () => before,
    layoutReady: () => { before = calls; ready = true; for (const callback of layout) callback(); },
    hide: () => { document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
    openTab: path => { leaves.push({ view: new MarkdownView(path), getViewState: () => ({ state: { file: path } }) }); },
    closeTabs: () => { leaves.length = 0; handlers.get('layout-change')?.(); },
  };
}

const deck = { 'Essence Cards/a.md': '---\n科目: 自然\n---\n- 目標 ^aaaaaa\n    - Q :: A\n' };
/** 外掛會把錯誤印到 console.error；測試期間收起來，不讓輸出看起來像失敗。 */
function quiet(t: test.TestContext): void {
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
}

// Codex 審查 W5 的 F5：寫不進去時，切到背景與停用外掛的 flush／close 不能留下沒人接的 rejection。
void test('接線：寫不進去時只提示一次，切到背景與停用不留下未處理的 rejection', async t => {
  quiet(t);
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', listener);
  t.after(() => { process.off('unhandledRejection', listener); });
  {
    const { plugin, notices, callsBeforeReady, layoutReady, hide } = host(deck, { write: true });
    t.after(() => { plugin.onunload(); });
    plugin.onload();
    layoutReady();
    assert.equal(callsBeforeReady(), 0);
    assert.ok(plugin.state);
    await plugin.state.ready();
    plugin.state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' });
    plugin.state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' });
    await wait(50);
    hide();
    plugin.onunload();
    await wait(100);
    assert.deepEqual(notices, ['Essence Cards：複習紀錄暫時寫不進去，會自動再試']);
    assert.deepEqual(unhandled, []);
  }
});

// Codex 審查 W5 的 F3 與第 11 點：讀不到時的提示要如實，而且真的會自己重試。
void test('接線：啟動時讀不到紀錄，提示讀不到並自己重試到讀完', async t => {
  quiet(t);
  let failing = true;
  const log = 'Essence Cards/紀錄/2026-10 Windows-0000.jsonl';
  const { plugin, notices, layoutReady } = host({ ...deck, [log]: '' }, { read: path => failing && path === log });
  t.after(() => { plugin.onunload(); });
  plugin.onload();
  layoutReady();
  assert.ok(plugin.state);
  const ready = plugin.state.ready();
  await wait(50);
  assert.deepEqual(notices, ['Essence Cards：有些卡組或複習紀錄暫時讀不到，會自動再試']);
  failing = false;
  await ready;
  plugin.onunload();
  assert.equal(notices.length, 1);
});

void test('接線：補 ID、存檔命令與編輯器的鎖定只在電腦；手機的 state 不寫卡組', async t => {
  const missing = { 'Essence Cards/b.md': '- 新目標\n    - Q :: A\n' };
  for (const desktop of [false, true]) {
    const { plugin, commands, extensions, layoutReady, text } = host(missing, {}, desktop);
    t.after(() => { plugin.onunload(); });
    plugin.onload();
    assert.equal(commands.includes('save'), desktop);
    // 鎖定，以及告訴離開筆記的備援「這篇開著」的 ViewPlugin。
    assert.equal(extensions(), desktop ? 2 : 0);
    layoutReady();
    assert.ok(plugin.state);
    await plugin.state.ready();
    assert.equal(await plugin.state.fillIds('Essence Cards/b.md'), desktop);
    assert.equal(/\^[a-z0-9]{6}\n/.test(text('Essence Cards/b.md') ?? ''), desktop);
    plugin.onunload();
  }
});

// Codex 審查第二部分的 F4：開發版也會裝到 iPhone（W6 的實機測試），會寫卡組的開發命令在手機上不註冊、URI 也不執行。
void test('接線：開發版在手機上沒有 lock、save 命令，直接用 URI 叫也不寫任何檔案；電腦上有', async t => {
  const trial = 'Essence Cards/W5 範例/補 ID 試用（卡片）.md';
  for (const desktop of [false, true]) {
    const h = host({ [trial]: '- 能說明蒸發 ^aaaaaa\n    - Q :: A\n' }, {}, desktop, devBundled);
    t.after(() => { h.plugin.onunload(); });
    h.plugin.onload();
    await wait(20);
    h.layoutReady();
    await h.plugin.state?.ready();
    for (const code of ['lock', 'save']) assert.equal(h.commands.includes('dev-' + code), desktop, code);
    assert.ok(h.commands.includes('dev-today'));
    if (desktop) continue;
    for (const run of ['save', 'lock']) h.uri({ run });
    await wait(100);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.notices.filter(n => n.includes('只在電腦上執行')).length, 2);
    assert.equal(h.text(trial), '- 能說明蒸發 ^aaaaaa\n    - Q :: A\n');
  }
});

// Codex 第三次審查的 T1：layout 已經 ready 時重新啟用外掛，第一個事件就是關掉原本開著的卡組，也要補一次。
void test('接線：重新啟用外掛時已經開著的卡組，啟用時不寫，第一個事件就是關掉時補一次', async t => {
  const path = 'Essence Cards/b.md';
  const h = host({ [path]: '- 新目標\n    - Q :: A\n' }, {}, true);
  t.after(() => { h.plugin.onunload(); });
  h.openTab(path);
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await wait(1100);
  assert.deepEqual(h.writes, []);
  h.closeTabs();
  await wait(1200);
  assert.deepEqual(h.writes, ['process ' + path]);
  assert.match(h.text(path) ?? '', /^- 新目標 \^[a-z0-9]{6}\n/);
});
