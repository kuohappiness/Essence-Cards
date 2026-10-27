import { editorInfoField, Notice, Platform, Plugin } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type { EditorState, StateField } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { isDeckPath } from './core/deck/index.ts';
import type { Files } from './core/files.ts';
import { countFiles } from './dev/wrap-files.ts';
import { loadDeviceCode } from './obsidian/device.ts';
import { createObsidianFiles } from './obsidian/files.ts';
import { idLock, type IdToken } from './obsidian/lock.ts';
import { wireSave, type Saver } from './obsidian/save.ts';
import { createState, type ErrorSource, type State } from './state/index.ts';
import { openReview, registerStart, type ReviewEvent, type ReviewHandle } from './ui/index.ts';
import type { Pick } from './core/study/index.ts';

/** tools/build.mjs 的 define：開發版是 true，正式建置是 false，開發命令整段不進 main.js。 */
declare const DEV: boolean;
/** tools/build.mjs 的 define：manifest 的版本加 git commit，例如 0.0.1+50625d2（「版本」命令顯示它，W6 §7 前提）。 */
declare const BUILD: string;

// 照錯誤來源如實提示；監聽者丟錯是程式的錯，只記在 console（Codex 審查 W5 第 11 點）。
const NOTICES: Partial<Record<ErrorSource, string>> = {
  write: 'Essence Cards：複習紀錄暫時寫不進去，會自動再試',
  read: 'Essence Cards：有些卡組或複習紀錄暫時讀不到，會自動再試',
};

/** 編輯器開的檔案（CodeMirror 的 state 裡 Obsidian 放的資訊）。 */
// obsidian.d.ts 用 CommonJS 的 @codemirror/state 型別，這裡是 ESM 的；同一個執行期物件，只是型別宣告分成兩份。
const infoField = editorInfoField as unknown as StateField<MarkdownFileInfo>;
const pathOf = (state: EditorState): string | undefined => state.field(infoField, false)?.file?.path;

/**
 * 外掛發出的事件（技術債 A10）：開發命令訂閱它們記下存檔按鈕、提示與編輯器鎖定的紀錄（W5 §8-7 的 lock、save）；
 * 正式版照樣發，沒有人聽就什麼都不做。
 */
export interface PluginEvents {
  /** 存檔按鈕與備援的提示文字（Notice）。 */
  notice: string;
  /** 存檔備援與編輯器鎖定的紀錄：「<毫秒> <事件>」。 */
  event: string;
  /** 編輯器裡刪掉或剪下整個目標：那一篇與拿掉的 ID。 */
  removed: { path: string; ids: string[] };
  /** 複習畫面的量測與手勢結果（W6 §4 的自動量測）。 */
  review: ReviewEvent;
}
export type PluginEvent = keyof PluginEvents;

/** 電腦上補 ID 與鎖定接好之後交回的：鎖住的 ID（開發命令看）、存檔按鈕與離開筆記的備援。 */
export interface IdsWiring { tokens: (state: EditorState) => IdToken[]; saver: Saver }

export default class EssenceCardsPlugin extends Plugin {
  /** 這台裝置的碼（W5 說明 §4-2）；紀錄的檔名用它。 */
  device = '';
  /** layout ready 之後才建立；畫面從這裡拿資料。 */
  state: State | null = null;
  /** 電腦上補 ID 與鎖定的接線；手機是 null（D-134）。 */
  ids: IdsWiring | null = null;
  /** 除了卡組之外也要鎖 ID 的路徑前綴：開發命令 lock 在 Essence W5/暫存/ 的副本上測各種編輯；正式版是空的。 */
  lockAlso: string[] = [];
  /** 開著的複習畫面（W6）；同時只有一個。 */
  review: ReviewHandle | null = null;
  /** 這次載入已經提示過的來源：同一種只提示一次。 */
  private warned = new Set<ErrorSource>();
  private unloaded = false;
  private readonly listeners: { [K in PluginEvent]: Set<(value: PluginEvents[K]) => void> } = { notice: new Set(), event: new Set(), removed: new Set(), review: new Set() };

  onload(): void {
    const loadedAt = performance.now();
    // 只註冊命令與事件，不讀任何檔案：layout ready 之前 Obsidian 會對每個檔案發 create（§4-1）。
    this.device = loadDeviceCode(this.app);
    this.addCommand({
      id: 'version',
      name: '版本',
      callback: () => { new Notice('Essence Cards：' + BUILD); },
    });
    // 補 ID 與鎖住 ID 只在電腦（D-134：iPhone 不寫卡組筆記，也不裝編輯器的鎖定）。
    if (Platform.isDesktopApp) this.ids = this.wireIds();
    // 複習畫面的暫時入口（W6 §3-9）：命令與左側功能區的圖示；入口畫面做好時拿掉。
    registerStart(this, { state: () => this.state, open: pick => { this.startReview(pick); } });
    let files: Files = createObsidianFiles(this.app);
    let calls = (): number => 0;
    let beforeLayoutReady: number | null = null;
    this.app.workspace.onLayoutReady(() => {
      beforeLayoutReady = calls();
      this.start(files);
    });
    // iPhone 切走 Obsidian 時，把排隊的紀錄寫完。
    this.registerDomEvent(document, 'visibilitychange', () => {
      // 寫不進去的錯誤 writer 已經回報過；這裡只接住，不留下沒人處理的 rejection（Codex 審查 W5 的 F5）。
      if (document.visibilityState === 'hidden') this.state?.flush().catch((error: unknown) => { this.report(error, 'write'); });
    });
    // 開發版（tools/build.mjs --dev）：計數 layout ready 之前的檔案存取（T12 的證據）、載入開發命令；正式建置整段拿掉。
    if (DEV) {
      ({ files, calls } = countFiles(files));
      const onloadMs = performance.now() - loadedAt;
      void import('./obsidian/dev.ts').then(dev => { dev.registerDev(this, { loadedAt, onloadMs, beforeLayoutReady: () => beforeLayoutReady }); });
    }
  }

  onunload(): void {
    this.unloaded = true;
    // 外掛停用時一起關掉複習畫面（什麼都不寫，D-074）。
    this.review?.close();
    this.state?.close().catch((error: unknown) => { console.error('Essence Cards', error); });
  }

  /** 打開全螢幕的複習畫面（W6）：同時只有一個，再開就先關掉上一個。 */
  startReview(pick: Pick): ReviewHandle | null {
    if (!this.state) return null;
    const pickedAt = performance.now();
    this.review?.close();
    this.review = openReview({
      app: this.app, state: this.state, pick, pickedAt,
      onEvent: event => { this.emit('review', event); },
      onClose: () => { this.review = null; },
    });
    return this.review;
  }

  /** 訂閱外掛的事件；回傳取消訂閱的函式。 */
  on<K extends PluginEvent>(kind: K, listener: (value: PluginEvents[K]) => void): () => void {
    const set = this.listeners[kind];
    set.add(listener);
    return () => { set.delete(listener); };
  }

  private emit<K extends PluginEvent>(kind: K, value: PluginEvents[K]): void {
    for (const listener of this.listeners[kind]) {
      try { listener(value); } catch (error) { console.error('Essence Cards', kind, error); }
    }
  }

  /** 編輯器的鎖定、存檔按鈕與命令、離開筆記時的備援（W5 §8-6）。 */
  private wireIds(): IdsWiring {
    const stamp = (event: string): string => Math.round(performance.now()) + ' ' + event;
    const lockable = (path: string | undefined): boolean => !!path && (isDeckPath(path) || this.lockAlso.some(prefix => path.startsWith(prefix)));
    const lock = idLock({
      isDeck: state => lockable(pathOf(state)),
      onRemoved: (state, ids) => {
        const path = pathOf(state);
        if (!path) return;
        this.state?.removedInEditor(path, ids);
        this.emit('removed', { path, ids });
        this.emit('event', stamp('編輯器拿掉 ' + ids.join(',')));
      },
      onRestored: (state, ids) => {
        const path = pathOf(state);
        if (path) this.state?.restoredInEditor(path, ids);
        this.emit('event', stamp('編輯器補回 ' + ids.join(',')));
      },
    });
    this.registerEditorExtension(lock.extension);
    const saver = wireSave({
      plugin: this,
      state: () => this.state,
      notify: message => { new Notice(message); this.emit('notice', message); },
      onError: error => { console.error('Essence Cards：離開筆記時補學習目標 ID 失敗', error); },
      log: event => { this.emit('event', stamp(event)); },
    });
    // 編輯器一建立就告訴離開筆記的備援「這篇開著」：開到背景分頁時 Obsidian 不發 file-open（Codex 再審的 R3）。
    this.registerEditorExtension(ViewPlugin.define(view => { saver.opened(pathOf(view.state)); return {}; }));
    return { tokens: lock.tokens, saver };
  }

  private report(error: unknown, source: ErrorSource): void {
    console.error('Essence Cards', source, error);
    const notice = NOTICES[source];
    if (!notice || this.warned.has(source)) return;
    this.warned.add(source);
    new Notice(notice);
  }

  private start(files: Files): void {
    // onLayoutReady 的回呼不會隨外掛停用取消：layout ready 之前就停用時不建立 state。
    if (this.unloaded) return;
    this.state = createState({ files, device: this.device, fillIds: Platform.isDesktopApp, onError: (error, source) => { this.report(error, source); } });
    // 離開筆記的備援：記下現在開著哪些（只記，不補）。
    this.ids?.saver.start();
    // 卡組重讀之後更新存檔按鈕的樣子。
    this.state.onChange(() => { this.ids?.saver.refresh(); });
    // 讀不到時 ready() 自己重試（每次失敗都經過 onError）；只有停用外掛會讓它 reject。
    this.state.ready().then(() => { this.ids?.saver.refresh(); }, () => {});
  }
}
