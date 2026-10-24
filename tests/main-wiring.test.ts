import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as codemirrorState from '@codemirror/state';
import * as codemirrorView from '@codemirror/view';

// src/main.ts 的接線（W5 §4-1）：用最小的 obsidian 替身在 Node 跑正式建置的程式碼，不是 Obsidian 實機。
const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = (await build({
  absWorkingDir: root, entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['obsidian', '@codemirror/state', '@codemirror/view'], write: false, define: { 'process.env.NODE_ENV': '"production"', DEV: 'false' },
})).outputFiles[0].text;

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
}

/** 記憶體裡的 vault；failRead／failWrite 決定哪些路徑讀不到、寫不進去。 */
function host(texts: Record<string, string>, fail: { read?: (path: string) => boolean; write?: boolean }, desktop = false): Host {
  const notices: string[] = [];
  const commands: string[] = [];
  let extensions = 0;
  let calls = 0, ready = false, before = 0;
  const files = new Map(Object.entries(texts));
  const count = () => { if (!ready) calls++; };
  const vault = {
    getAbstractFileByPath: (path: string) => { count(); return files.has(path) ? new TFile(path) : null; },
    getFiles: () => { count(); return [...files.keys()].map(path => new TFile(path)); },
    read: (file: TFile) => { count(); return fail.read?.(file.path) ? Promise.reject(Error('讀不到：' + file.path)) : Promise.resolve(files.get(file.path) ?? ''); },
    create: (path: string, text: string) => { count(); if (fail.write) return Promise.reject(Error('寫不進去')); files.set(path, text); return Promise.resolve(new TFile(path)); },
    append: (file: TFile, text: string) => { count(); if (fail.write) return Promise.reject(Error('寫不進去')); files.set(file.path, (files.get(file.path) ?? '') + text); return Promise.resolve(); },
    process: (file: TFile, edit: (text: string) => string) => { count(); files.set(file.path, edit(files.get(file.path) ?? '')); return Promise.resolve(''); },
    createFolder: () => { count(); return Promise.resolve(); },
    on: () => { count(); return {}; },
    offref: () => {},
  };
  const layout: (() => void)[] = [];
  const app = {
    vault,
    workspace: { onLayoutReady: (callback: () => void) => { layout.push(callback); }, on: () => ({}), getLeavesOfType: () => [], getActiveViewOfType: () => null },
    loadLocalStorage: () => null, saveLocalStorage: () => {},
  };
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  class Plugin {
    app: unknown; manifest: unknown;
    constructor(app: unknown, manifest: unknown) { this.app = app; this.manifest = manifest; }
    addCommand(command: { id: string }) { commands.push(command.id); }
    registerEditorExtension() { extensions++; }
    registerEvent() {}
    registerDomEvent(target: EventTarget, type: string, callback: () => void) { target.addEventListener(type, callback); }
  }
  class Notice { constructor(message: string) { notices.push(message); } }
  class MarkdownView {}
  class Modal {}
  const obsidian = { Plugin, Notice, TFile, TFolder, TAbstractFile, MarkdownView, Modal, setIcon: () => {}, editorInfoField: {}, Platform: { isWin: true, isDesktopApp: desktop } };
  const module = { exports: {} as { default: new (app: unknown, manifest: unknown) => Host['plugin'] } };
  // 執行 esbuild 剛建好的正式版程式碼；document 由參數提供，不動 Node 的全域。
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('require', 'module', 'exports', 'document', bundled) as (require: (name: string) => unknown, module: unknown, exports: unknown, document: unknown) => void;
  run((name: string) => {
    if (name === '@codemirror/state') return codemirrorState;
    if (name === '@codemirror/view') return codemirrorView;
    if (name !== 'obsidian') throw Error('只能 require obsidian 與 CodeMirror：' + name);
    return obsidian;
  }, module, module.exports, document);
  const plugin = new module.exports.default(app, { id: 'essence-cards', version: '0.0.1' });
  return {
    plugin, notices, commands, extensions: () => extensions, text: path => files.get(path),
    callsBeforeReady: () => before,
    layoutReady: () => { before = calls; ready = true; for (const callback of layout) callback(); },
    hide: () => { document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
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
    assert.equal(extensions(), desktop ? 1 : 0);
    layoutReady();
    assert.ok(plugin.state);
    await plugin.state.ready();
    assert.equal(await plugin.state.fillIds('Essence Cards/b.md'), desktop);
    assert.equal(/\^[a-z0-9]{6}\n/.test(text('Essence Cards/b.md') ?? ''), desktop);
    plugin.onunload();
  }
});
