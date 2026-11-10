import * as codemirrorState from '@codemirror/state';
import * as codemirrorView from '@codemirror/view';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

/**
 * 最小的 obsidian 替身（技術債 A9）：在 Node 跑 esbuild 建好的外掛程式碼，不是 Obsidian 實機。
 * 只模擬接線用得到的：外掛的註冊方法、Notice、Modal、vault 的讀寫與事件、分頁與 workspace 的事件、Platform。
 * 實機的證據在開發命令與 Windows 版 Obsidian 的截圖。
 */
class TAbstractFile { path: string; constructor(path: string) { this.path = path; } }
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile { children: TAbstractFile[] = []; }

/** Modal 與設定分頁用的最小元素：empty、createDiv、createEl、setText、click、照標籤找的 querySelectorAll、disabled。 */
export class FakeEl {
  readonly tag: string;
  text: string;
  disabled = false;
  readonly children: FakeEl[] = [];
  /** 這個容器裡的 Setting（設定分頁）。 */
  readonly rows: FakeSetting[] = [];
  /** 設定分頁開著沒：預設沒開，測試要重畫時自己設。 */
  shown = false;
  hidden = false;
  private readonly clicks: (() => void)[] = [];
  constructor(tag = 'div', options?: { text?: string }) { this.tag = tag; this.text = options?.text ?? ''; }
  empty() { this.children.length = 0; this.rows.length = 0; }
  setText(text: string) { this.text = text; }
  createDiv(options?: { text?: string }) { return this.createEl('div', options); }
  createSpan(options?: { text?: string }) { return this.createEl('span', options); }
  createEl(tag: string, options?: { text?: string }) { const el = new FakeEl(tag, options); this.children.push(el); return el; }
  addClass() {}
  setAttribute() {}
  toggle(show: boolean) { this.hidden = !show; }
  addEventListener(type: string, callback: () => void) { if (type === 'click') this.clicks.push(callback); }
  /** 照瀏覽器：停用的按鈕不送 click。 */
  click() { if (!this.disabled) for (const callback of this.clicks) callback(); }
  isShown() { return this.shown; }
  querySelectorAll(tag: string): FakeEl[] { return this.children.flatMap(child => [...child.tag === tag ? [child] : [], ...child.querySelectorAll(tag)]); }
}

/** 設定分頁的控制項：記下選項與現在的值，choose() 照使用者改了值的樣子呼叫 onChange。 */
class FakeDropdown {
  readonly options: { value: string; label: string }[] = [];
  value = '';
  private changed: (value: string) => unknown = () => {};
  addOption(value: string, label: string) { this.options.push({ value, label }); return this; }
  setValue(value: string) { this.value = value; return this; }
  onChange(callback: (value: string) => unknown) { this.changed = callback; return this; }
  choose(value: string) { this.value = value; this.changed(value); }
}
class FakeToggle {
  value = false;
  private changed: (value: boolean) => unknown = () => {};
  setValue(value: boolean) { this.value = value; return this; }
  onChange(callback: (value: boolean) => unknown) { this.changed = callback; return this; }
  choose(value: boolean) { this.value = value; this.changed(value); }
}
class FakeButton {
  text = ''; icon = ''; tooltip = '';
  private clicked: () => unknown = () => {};
  setButtonText(text: string) { this.text = text; return this; }
  setIcon(icon: string) { this.icon = icon; return this; }
  setTooltip(tooltip: string) { this.tooltip = tooltip; return this; }
  setCta() { return this; }
  setDisabled() { return this; }
  onClick(callback: () => unknown) { this.clicked = callback; return this; }
  click() { this.clicked(); }
}
export class FakeSetting {
  name = ''; desc = ''; heading = false;
  settingEl = new FakeEl(); nameEl = new FakeEl(); descEl = new FakeEl();
  dropdown: FakeDropdown | null = null;
  toggle: FakeToggle | null = null;
  readonly extras: FakeButton[] = [];
  constructor(container: FakeEl) { container.rows.push(this); }
  setName(name: string) { this.name = name; return this; }
  setDesc(desc: string) { this.desc = desc; return this; }
  setHeading() { this.heading = true; return this; }
  addDropdown(build: (dropdown: FakeDropdown) => unknown) { build(this.dropdown = new FakeDropdown()); return this; }
  addToggle(build: (toggle: FakeToggle) => unknown) { build(this.toggle = new FakeToggle()); return this; }
  addExtraButton(build: (button: FakeButton) => unknown) { const button = new FakeButton(); this.extras.push(button); build(button); return this; }
  addButton(build: (button: FakeButton) => unknown) { build(new FakeButton()); return this; }
  addText(build: (text: { setPlaceholder(): unknown; onChange(): unknown }) => unknown) { const text = { setPlaceholder: () => text, onChange: () => text }; build(text); return this; }
}

const EMPTY = { empty: true };
const isEmpty = (leaf: { view: unknown }): boolean => leaf.view === EMPTY;

export interface StubOptions {
  /** vault 裡一開始有的檔案。 */
  texts?: Record<string, string>;
  /** 這些路徑讀不到。 */
  failRead?: (path: string) => boolean;
  /** 寫入都失敗；給函式時只有它回 true 的路徑寫不進去（建立、追加與 process）。 */
  failWrite?: boolean | ((path: string) => boolean);
  /** vault.on 拋錯（監看不了，tasks/error-log.md §2-3）；給函式時拋出它回傳的值（不一定是 Error）。 */
  failWatch?: boolean | (() => unknown);
  /** Platform.isDesktopApp；預設 false（手機）。 */
  desktop?: boolean;
  /** Platform.isIosApp；預設 false。 */
  ios?: boolean;
  /**
   * 電腦上 vault 在磁碟上的位置（FileSystemAdapter.getBasePath）：給了才是 FileSystemAdapter，外掛內的備份才載入得起來
   * （load 的程式碼這時可以 require node: 的模組）。vault 的內容仍在記憶體裡。
   */
  vaultPath?: string;
  /** 這個 vault 的 localStorage 一開始的值（例如備份位置）。 */
  localStorage?: Record<string, unknown>;
  /** data.json 一開始的內容；預設 null（沒有檔）。undefined 是讀不到（照 Obsidian 1.15 的 loadData）。 */
  data?: unknown;
  /** saveData 寫不進去：照 Obsidian 1.15 吞掉錯誤、照常完成。 */
  failSave?: boolean;
}

interface Leaf { view: unknown; getViewState(): { state?: { file?: string } }; setViewState?(state: unknown): Promise<void>; setEphemeralState?(state: unknown): void; history?: unknown[] }
interface Command { id: string; name?: string; callback?: () => void; checkCallback?: (checking: boolean) => boolean | void }

class FakeMarkdownView {
  file: { path: string } | null;
  /** 編輯器的文字（transaction 不改它）；save() 被呼叫的次數。 */
  value = '';
  saves = 0;
  editor = { getValue: () => this.value, transaction() {}, offsetToPos: () => ({ line: 0, ch: 0 }) };
  containerEl = { querySelector: () => null };
  /** addAction 加上的按鈕：圖示、提示文字（aria-label 跟著更新）與按下去的動作。 */
  actions: { icon: string; label: string; click: () => void }[] = [];
  constructor(path: string | null) { this.file = path ? { path } : null; }
  save() { this.saves++; return Promise.resolve(); }
  getEphemeralState() { return { cursor: 7 }; }
  addAction(icon: string, label: string, click: () => void) {
    const action = { icon, label, click };
    this.actions.push(action);
    return { addClass() {}, setAttribute(name: string, value: string) { if (name === 'aria-label') action.label = value; }, toggleClass() {},
      // 和 DOM 的 remove 一樣：按鈕從標題列拿掉（技術債 W2 的測試看它）。
      remove: () => { const at = this.actions.indexOf(action); if (at >= 0) this.actions.splice(at, 1); } };
  }
}

export interface ObsidianStub {
  /** 當成 require('obsidian') 的結果。 */
  obsidian: Record<string, unknown>;
  app: Record<string, unknown>;
  notices: string[];
  commands: Map<string, Command>;
  ribbons: { icon: string; title: string; callback: (evt: unknown) => unknown }[];
  extensions: () => number;
  /** open() 過的 Modal：open 時呼叫 onOpen、close 時呼叫 onClose；isOpen 是開著沒。 */
  modals: { titleEl: FakeEl; contentEl: FakeEl; isOpen: boolean; close(): void }[];
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
  /** document.visibilityState 變成 visible 並送事件。 */
  show: () => void;
  /** data.json：現在的內容，loadData、saveData 被呼叫的次數。 */
  data: { content: unknown; loads: number; saves: number };
  document: EventTarget & { visibilityState: string };
  window: EventTarget & { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: (callback: () => void, ms?: number) => number; clearInterval: () => void };
  /** registerInterval 登記的回呼：tick() 全部跑一次。 */
  tick: () => void;
  /** window.setInterval 與 registerInterval 被呼叫的次數（手機不該建立備份的計時器，D-148）。 */
  timers: () => { setInterval: number; registerInterval: number };
  /** load 的程式碼 require 過的模組名稱（含被拒絕的）。 */
  required: string[];
  /** addSettingTab 加上的設定分頁。 */
  settingTabs: unknown[];
  /** addStatusBarItem 加上的狀態列項目。 */
  statusBar: { textContent: string; style: { display: string }; clicks: (() => void)[] }[];
  /** 這個 vault 的 localStorage 現在的值（app.loadLocalStorage）。 */
  storage: (key: string) => unknown;
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
   * 執行 esbuild 建好的 CommonJS 程式碼：require 只認 obsidian 與 CodeMirror（電腦而且給了 vaultPath 時加上 node: 的模組）；document 與 window 由替身提供，不動 Node 的全域。
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
  const modals: ObsidianStub['modals'] = [];
  let extensions = 0;
  const timers = { setInterval: 0, registerInterval: 0 };
  const required: string[] = [];
  const settingTabs: unknown[] = [];
  const data = { content: 'data' in options ? options.data : null as unknown, loads: 0, saves: 0 };
  let calls = 0, ready = false, before = 0;
  const texts = new Map(Object.entries(options.texts ?? {}));
  const count = (): void => { if (!ready) calls++; };
  const failing = (path: string): boolean => typeof options.failWrite === 'function' ? options.failWrite(path) : !!options.failWrite;
  const fail = (path: string): Promise<never> | null => failing(path) ? Promise.reject(Error('寫不進去')) : null;
  // 和 Obsidian 一樣，同一篇檔案每次查都是同一個 TFile（新建的才是新物件），改名時物件不變、path 跟著改（Codex 第二次再審的 F3）。
  const nodes = new Map<string, TFile>();
  const node = (path: string): TFile => { let file = nodes.get(path); if (!file) nodes.set(path, file = new TFile(path)); return file; };
  /** 替身的 vault.adapter：給了 vaultPath 才是 FileSystemAdapter（電腦專用的備份在其他情況載入失敗，照實提示）。 */
  class FileSystemAdapter { getBasePath() { return options.vaultPath ?? ''; } }
  const bytes = (path: string): ArrayBuffer => new TextEncoder().encode(texts.get(path) ?? '').buffer;
  const adapter = {
    write: (path: string, text: string) => { writes.push('adapter ' + path); texts.set(path, text); return Promise.resolve(); },
    read: (path: string) => Promise.resolve(texts.get(path) ?? ''),
    readBinary: (path: string) => Promise.resolve(bytes(path)),
    exists: (path: string) => Promise.resolve(texts.has(path)),
  };
  const vault = {
    configDir: '.obsidian',
    readBinary: (file: TFile) => { count(); return options.failRead?.(file.path) ? Promise.reject(Error('讀不到：' + file.path)) : Promise.resolve(bytes(file.path)); },
    getAbstractFileByPath: (path: string) => { count(); return texts.has(path) ? node(path) : null; },
    getFileByPath: (path: string) => texts.has(path) ? node(path) : null,
    getFiles: () => { count(); return [...texts.keys()].map(node); },
    read: (file: TFile) => { count(); return options.failRead?.(file.path) ? Promise.reject(Error('讀不到：' + file.path)) : Promise.resolve(texts.get(file.path) ?? ''); },
    cachedRead: (file: TFile) => Promise.resolve(texts.get(file.path) ?? ''),
    // 和 Obsidian 一樣，已經有這個檔時丟錯，不覆寫。
    create: (path: string, text: string) => {
      count(); writes.push('create ' + path);
      const failed = fail(path);
      if (failed) return failed;
      if (texts.has(path)) return Promise.reject(Error('File already exists.'));
      texts.set(path, text); nodes.delete(path);
      return Promise.resolve(node(path));
    },
    append: (file: TFile, text: string) => { count(); writes.push('append ' + file.path); const failed = fail(file.path); if (failed) return failed; texts.set(file.path, (texts.get(file.path) ?? '') + text); return Promise.resolve(); },
    process: (file: TFile, edit: (text: string) => string) => {
      count(); writes.push('process ' + file.path);
      // 只有指定了路徑的 failWrite 才擋 process（全部寫不進去的舊用法只擋紀錄的建立與追加）。
      if (typeof options.failWrite === 'function' && options.failWrite(file.path)) return Promise.reject(Error('寫不進去'));
      texts.set(file.path, edit(texts.get(file.path) ?? '')); return Promise.resolve('');
    },
    modify: (file: TFile, text: string) => { writes.push('modify ' + file.path); texts.set(file.path, text); return Promise.resolve(); },
    modifyBinary: (file: TFile, data: ArrayBuffer) => { writes.push('modifyBinary ' + file.path); texts.set(file.path, new TextDecoder().decode(data)); return Promise.resolve(); },
    createBinary: (path: string, data: ArrayBuffer) => {
      writes.push('createBinary ' + path);
      if (texts.has(path)) return Promise.reject(Error('File already exists.'));
      texts.set(path, new TextDecoder().decode(data)); nodes.delete(path);
      return Promise.resolve(node(path));
    },
    delete: (file: TFile) => { writes.push('delete ' + file.path); texts.delete(file.path); nodes.delete(file.path); return Promise.resolve(); },
    rename: (file: TFile, to: string) => {
      writes.push('rename ' + file.path + ' → ' + to);
      texts.set(to, texts.get(file.path) ?? ''); texts.delete(file.path); nodes.delete(file.path);
      file.path = to; nodes.set(to, file);
      return Promise.resolve();
    },
    createFolder: (path: string) => { count(); writes.push('folder ' + path); return Promise.resolve(); },
    adapter: options.vaultPath ? Object.assign(new FileSystemAdapter(), adapter) : adapter,
    on: () => {
      count();
      // 測試要能拋出不是 Error 的值（例如不准查原型的 Proxy）。
      if (typeof options.failWatch === 'function') throw options.failWatch();
      if (options.failWatch) throw Error('監看不了');
      return {};
    },
    offref: () => {},
  };
  const storage = new Map(Object.entries(options.localStorage ?? {}));
  const layout: (() => void)[] = [];
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const intervals: (() => void)[] = [];
  const leaves: Leaf[] = [];
  const statusBar: ObsidianStub['statusBar'] = [];
  const app = {
    vault,
    workspace: {
      onLayoutReady: (callback: () => void) => { if (ready) callback(); else layout.push(callback); },
      on: (name: string, callback: (...args: unknown[]) => void) => { handlers.set(name, [...handlers.get(name) ?? [], callback]); return name; },
      // 換成空白的分頁算 empty，其他都算 markdown（延後載入的也是）。
      getLeavesOfType: (type: string) => leaves.filter(leaf => (type === 'empty') === isEmpty(leaf)),
      iterateAllLeaves: (callback: (leaf: Leaf) => void) => { leaves.forEach(callback); },
      getActiveViewOfType: () => null,
      openLinkText: () => Promise.resolve(),
      leftSplit: { collapsed: true }, rightSplit: { collapsed: true },
    },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null, on: (name: string) => name },
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => { if (value === null) storage.delete(key); else storage.set(key, value); },
  };
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = Object.assign(new EventTarget(), {
    setTimeout, clearTimeout,
    setInterval: (callback: () => void) => { timers.setInterval++; intervals.push(callback); return intervals.length; },
    clearInterval: () => {},
  });
  class Plugin {
    app: unknown; manifest: unknown;
    /** register 與 registerDomEvent 登記的收尾：unload() 時跑（和 Obsidian 的 Component 一樣）。 */
    private cleanups: (() => void)[] = [];
    constructor(app: unknown, manifest: unknown) { this.app = app; this.manifest = manifest; }
    onunload(): void {}
    /** 停用外掛（Obsidian 呼叫的是這個）：onunload，再移除登記的事件。 */
    unload(): void { this.onunload(); for (const cleanup of this.cleanups.splice(0)) cleanup(); }
    addCommand(command: Command) { commands.set(command.id, command); return command; }
    addRibbonIcon(icon: string, title: string, callback: (evt: unknown) => unknown) { ribbons.push({ icon, title, callback }); return {}; }
    addStatusBarItem() {
      const item = { textContent: '', style: { display: '' }, clicks: [] as (() => void)[], addClass() {}, addEventListener(_type: string, callback: () => void) { item.clicks.push(callback); } };
      statusBar.push(item);
      return item;
    }
    registerEditorExtension() { extensions++; }
    registerEvent() {}
    register(cleanup: () => void) { this.cleanups.push(cleanup); }
    registerInterval(id: number) { timers.registerInterval++; return id; }
    addSettingTab(tab: unknown) { settingTabs.push(tab); }
    loadData(): Promise<unknown> { data.loads++; return Promise.resolve(data.content === undefined ? undefined : JSON.parse(JSON.stringify(data.content))); }
    saveData(next: unknown): Promise<void> { data.saves++; if (!options.failSave) data.content = next; return Promise.resolve(); }
    registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => void) { protocol.set(action, handler); }
    registerDomEvent(target: EventTarget, type: string, callback: () => void) {
      target.addEventListener(type, callback);
      this.cleanups.push(() => { target.removeEventListener(type, callback); });
    }
  }
  class Notice { constructor(message: string) { notices.push(message); } }
  class Component { load() {} unload() {} register() {} }
  class Modal {
    app: unknown;
    titleEl = new FakeEl();
    contentEl = new FakeEl();
    onOpen?(): void;
    onClose?(): void;
    isOpen = false;
    constructor(app: unknown) { this.app = app; }
    open() { modals.push(this); this.isOpen = true; this.onOpen?.(); }
    close() { this.isOpen = false; this.onClose?.(); }
  }
  class SuggestModal extends Modal {}
  class PluginSettingTab {
    app: unknown; plugin: unknown; containerEl = new FakeEl();
    constructor(app: unknown, plugin: unknown) { this.app = app; this.plugin = plugin; }
  }
  const obsidian = {
    Plugin, Notice, Component, Modal, SuggestModal, PluginSettingTab, Setting: FakeSetting, FileSystemAdapter, TFile, TFolder, TAbstractFile,
    MarkdownView: FakeMarkdownView,
    MarkdownRenderer: { render: (_app: unknown, markdown: string, el: { textContent: string }) => { el.textContent = markdown; return Promise.resolve(); } },
    setIcon: () => {}, editorInfoField: {}, apiVersion: 'test',
    Platform: { isWin: true, isDesktop: !!options.desktop, isDesktopApp: !!options.desktop, isMobileApp: !options.desktop, isIosApp: !!options.ios, isAndroidApp: false },
  };
  function load<T>(code: string): T {
    const module = { exports: {} as T };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function('require', 'module', 'exports', 'document', 'window', code) as (require: (name: string) => unknown, module: unknown, exports: unknown, document: unknown, window: unknown) => void;
    run((name: string) => {
      required.push(name);
      if (name === '@codemirror/state') return codemirrorState;
      if (name === '@codemirror/view') return codemirrorView;
      // 電腦上的備份（D-148）：替身是電腦、而且給了 vaultPath 時，Node 的內建模組用 Node 自己的。
      if (options.desktop && options.vaultPath && name.startsWith('node:')) return nodeRequire(name);
      if (name !== 'obsidian') throw Error('只能 require obsidian 與 CodeMirror：' + name);
      return obsidian;
    }, module, module.exports, document, window);
    return module.exports;
  }
  const leaf = (path: string | null): Leaf => {
    const history: unknown[] = [];
    const view = new FakeMarkdownView(path);
    const made: Leaf = { view, getViewState: () => ({ state: path ? { file: path } : {} }), history, setViewState(state) { history.push(state); made.view = (state as { type?: string }).type === 'empty' ? EMPTY : view; return Promise.resolve(); }, setEphemeralState(state) { history.push(state); } };
    return made;
  };
  return {
    obsidian, app, notices, commands, ribbons, extensions: () => extensions, modals, protocol, writes, texts,
    timers: () => ({ ...timers }), required, settingTabs, statusBar, storage: key => storage.get(key) ?? null,
    text: path => texts.get(path),
    callsBeforeReady: () => before,
    layoutReady: () => { before = calls; ready = true; for (const callback of layout.splice(0)) callback(); },
    hide: () => { document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
    show: () => { document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange')); },
    data,
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
