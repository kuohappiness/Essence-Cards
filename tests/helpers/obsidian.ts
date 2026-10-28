import * as codemirrorState from '@codemirror/state';
import * as codemirrorView from '@codemirror/view';

/**
 * 最小的 obsidian 替身（技術債 A9）：在 Node 跑 esbuild 建好的外掛程式碼，不是 Obsidian 實機。
 * 只模擬接線用得到的：外掛的註冊方法、Notice、vault 的讀寫與事件、分頁與 workspace 的事件、Platform。
 * 實機的證據在開發命令與 Windows 版 Obsidian 的截圖。
 */
class TAbstractFile { path: string; constructor(path: string) { this.path = path; } }
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile { children: TAbstractFile[] = []; }

export interface StubOptions {
  /** vault 裡一開始有的檔案。 */
  texts?: Record<string, string>;
  /** 這些路徑讀不到。 */
  failRead?: (path: string) => boolean;
  /** 寫入都失敗。 */
  failWrite?: boolean;
  /** Platform.isDesktopApp；預設 false（手機）。 */
  desktop?: boolean;
}

interface Leaf { view: unknown; getViewState(): { state?: { file?: string } } }
interface Command { id: string; name?: string; callback?: () => void; checkCallback?: (checking: boolean) => boolean | void }

class FakeMarkdownView {
  file: { path: string } | null;
  /** 編輯器的文字（transaction 不改它）；save() 被呼叫的次數。 */
  value = '';
  saves = 0;
  editor = { getValue: () => this.value, transaction() {}, offsetToPos: () => ({ line: 0, ch: 0 }) };
  containerEl = { querySelector: () => null };
  constructor(path: string | null) { this.file = path ? { path } : null; }
  save() { this.saves++; return Promise.resolve(); }
  addAction() { return { addClass() {}, setAttribute() {}, toggleClass() {}, remove() {} }; }
}

export interface ObsidianStub {
  /** 當成 require('obsidian') 的結果。 */
  obsidian: Record<string, unknown>;
  app: Record<string, unknown>;
  notices: string[];
  commands: Map<string, Command>;
  ribbons: { icon: string; title: string; callback: (evt: unknown) => unknown }[];
  extensions: () => number;
  /** registerObsidianProtocolHandler 收到的處理函式，照 action。 */
  protocol: Map<string, (params: Record<string, string>) => void>;
  /** 寫入 vault 的動作與路徑。 */
  writes: string[];
  texts: Map<string, string>;
  text: (path: string) => string | undefined;
  /** onLayoutReady 之前 vault 被呼叫的次數。 */
  callsBeforeReady: () => number;
  layoutReady: () => void;
  /** document.visibilityState 變成 hidden 並送事件。 */
  hide: () => void;
  document: EventTarget & { visibilityState: string };
  window: EventTarget & { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: (callback: () => void, ms?: number) => number; clearInterval: () => void };
  /** registerInterval 登記的回呼：tick() 全部跑一次。 */
  tick: () => void;
  /** Markdown 分頁。 */
  leaves: Leaf[];
  leaf: (path: string | null) => Leaf;
  /** 還沒載入的分頁：沒有 MarkdownView，只有 viewState 的檔名。 */
  deferred: (path: string) => Leaf;
  /** 放一個開著這篇的分頁（不送事件）；關掉全部分頁並送 layout-change。 */
  openTab: (path: string) => void;
  closeTabs: () => void;
  /** 送 workspace 的事件（layout-change、file-open、active-leaf-change、editor-change…）。 */
  fire: (name: string, ...args: unknown[]) => void;
  /**
   * 執行 esbuild 建好的 CommonJS 程式碼：require 只認 obsidian 與 CodeMirror；document 與 window 由替身提供，不動 Node 的全域。
   * 回傳 module.exports。
   */
  load: <T>(code: string) => T;
}

export function createObsidianStub(options: StubOptions = {}): ObsidianStub {
  const notices: string[] = [];
  const commands = new Map<string, Command>();
  const ribbons: ObsidianStub['ribbons'] = [];
  const writes: string[] = [];
  const protocol = new Map<string, (params: Record<string, string>) => void>();
  let extensions = 0;
  let calls = 0, ready = false, before = 0;
  const texts = new Map(Object.entries(options.texts ?? {}));
  const count = (): void => { if (!ready) calls++; };
  const fail = options.failWrite ? (): Promise<never> => Promise.reject(Error('寫不進去')) : null;
  const vault = {
    getAbstractFileByPath: (path: string) => { count(); return texts.has(path) ? new TFile(path) : null; },
    getFileByPath: (path: string) => texts.has(path) ? new TFile(path) : null,
    getFiles: () => { count(); return [...texts.keys()].map(path => new TFile(path)); },
    read: (file: TFile) => { count(); return options.failRead?.(file.path) ? Promise.reject(Error('讀不到：' + file.path)) : Promise.resolve(texts.get(file.path) ?? ''); },
    cachedRead: (file: TFile) => Promise.resolve(texts.get(file.path) ?? ''),
    create: (path: string, text: string) => { count(); writes.push('create ' + path); if (fail) return fail(); texts.set(path, text); return Promise.resolve(new TFile(path)); },
    append: (file: TFile, text: string) => { count(); writes.push('append ' + file.path); if (fail) return fail(); texts.set(file.path, (texts.get(file.path) ?? '') + text); return Promise.resolve(); },
    process: (file: TFile, edit: (text: string) => string) => { count(); writes.push('process ' + file.path); texts.set(file.path, edit(texts.get(file.path) ?? '')); return Promise.resolve(''); },
    modify: (file: TFile, text: string) => { writes.push('modify ' + file.path); texts.set(file.path, text); return Promise.resolve(); },
    delete: (file: TFile) => { writes.push('delete ' + file.path); texts.delete(file.path); return Promise.resolve(); },
    createFolder: (path: string) => { count(); writes.push('folder ' + path); return Promise.resolve(); },
    adapter: {
      write: (path: string, text: string) => { writes.push('adapter ' + path); texts.set(path, text); return Promise.resolve(); },
      read: (path: string) => Promise.resolve(texts.get(path) ?? ''),
      exists: (path: string) => Promise.resolve(texts.has(path)),
    },
    on: () => { count(); return {}; },
    offref: () => {},
  };
  const layout: (() => void)[] = [];
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const intervals: (() => void)[] = [];
  const leaves: Leaf[] = [];
  const app = {
    vault,
    workspace: {
      onLayoutReady: (callback: () => void) => { if (ready) callback(); else layout.push(callback); },
      on: (name: string, callback: (...args: unknown[]) => void) => { handlers.set(name, [...handlers.get(name) ?? [], callback]); return name; },
      getLeavesOfType: () => leaves,
      getActiveViewOfType: () => null,
      openLinkText: () => Promise.resolve(),
      leftSplit: { collapsed: true }, rightSplit: { collapsed: true },
    },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
    loadLocalStorage: () => null, saveLocalStorage: () => {},
  };
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = Object.assign(new EventTarget(), {
    setTimeout, clearTimeout,
    setInterval: (callback: () => void) => { intervals.push(callback); return intervals.length; },
    clearInterval: () => {},
  });
  class Plugin {
    app: unknown; manifest: unknown;
    constructor(app: unknown, manifest: unknown) { this.app = app; this.manifest = manifest; }
    addCommand(command: Command) { commands.set(command.id, command); return command; }
    addRibbonIcon(icon: string, title: string, callback: (evt: unknown) => unknown) { ribbons.push({ icon, title, callback }); return {}; }
    registerEditorExtension() { extensions++; }
    registerEvent() {}
    register() {}
    registerInterval(id: number) { return id; }
    registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => void) { protocol.set(action, handler); }
    registerDomEvent(target: EventTarget, type: string, callback: () => void) { target.addEventListener(type, callback); }
  }
  class Notice { constructor(message: string) { notices.push(message); } }
  class Component { load() {} unload() {} register() {} }
  class Modal { app: unknown; constructor(app: unknown) { this.app = app; } open() {} close() {} }
  class SuggestModal extends Modal {}
  const obsidian = {
    Plugin, Notice, Component, Modal, SuggestModal, TFile, TFolder, TAbstractFile,
    MarkdownView: FakeMarkdownView,
    MarkdownRenderer: { render: (_app: unknown, markdown: string, el: { textContent: string }) => { el.textContent = markdown; return Promise.resolve(); } },
    setIcon: () => {}, editorInfoField: {}, apiVersion: 'test',
    Platform: { isWin: true, isDesktopApp: !!options.desktop, isMobileApp: !options.desktop, isIosApp: false, isAndroidApp: false },
  };
  function load<T>(code: string): T {
    const module = { exports: {} as T };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function('require', 'module', 'exports', 'document', 'window', code) as (require: (name: string) => unknown, module: unknown, exports: unknown, document: unknown, window: unknown) => void;
    run((name: string) => {
      if (name === '@codemirror/state') return codemirrorState;
      if (name === '@codemirror/view') return codemirrorView;
      if (name !== 'obsidian') throw Error('只能 require obsidian 與 CodeMirror：' + name);
      return obsidian;
    }, module, module.exports, document, window);
    return module.exports;
  }
  const leaf = (path: string | null): Leaf => ({ view: new FakeMarkdownView(path), getViewState: () => ({ state: path ? { file: path } : {} }) });
  return {
    obsidian, app, notices, commands, ribbons, extensions: () => extensions, protocol, writes, texts,
    text: path => texts.get(path),
    callsBeforeReady: () => before,
    layoutReady: () => { before = calls; ready = true; for (const callback of layout.splice(0)) callback(); },
    hide: () => { document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
    document, window,
    tick: () => { for (const callback of intervals) callback(); },
    leaves, leaf,
    deferred: path => ({ view: {}, getViewState: () => ({ state: { file: path } }) }),
    openTab: path => { leaves.push(leaf(path)); },
    closeTabs: () => { leaves.length = 0; for (const callback of handlers.get('layout-change') ?? []) callback(); },
    fire: (name, ...args) => { for (const callback of handlers.get(name) ?? []) callback(...args); },
    load,
  };
}
