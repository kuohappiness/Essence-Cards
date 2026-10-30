import { apiVersion, editorInfoField, FileSystemAdapter, Notice, Platform, Plugin } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type { EditorState, StateField } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { isDeckPath } from './core/deck/index.ts';
import { createErrorLog, hasOwnFrame, type ErrorLog, type ErrorWhere } from './core/errors/index.ts';
import type { Files } from './core/files.ts';
import { countFiles } from './dev/wrap-files.ts';
import { BACKUP_NOTICE, wireBackup, type BackupWiring } from './obsidian/backup.ts';
import { loadDeviceCode } from './obsidian/device.ts';
import { wireSettings } from './obsidian/settings.ts';
import { createObsidianFiles } from './obsidian/files.ts';
import { idLock, type IdToken } from './obsidian/lock.ts';
import { wireSave, type Saver } from './obsidian/save.ts';
import { versionText } from './obsidian/version.ts';
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
/** 有內容需要新版才讀得懂（任務說明 2-2）：入口的「給家長」一區做好之前，載入時用通知提示一次。 */
const UPDATE_NOTICE = 'Essence Cards：有內容需要新版才讀得懂，請更新外掛';
/** 學生在複習畫面回報之後的提示（D-160 第 3 點）；記錄器盡力而為，寫不進去時也照樣這樣說（D-160 的代價）。 */
const REPORT_NOTICE = '已記下，可以跟家長說一聲';
/** 「版本」命令先等排隊的紀錄寫完（寫入成功以 flush 為準），最多等這麼久。 */
const VERSION_WAIT = 2000;

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
  /** 電腦上的備份（D-150）；手機、還沒載入或載入失敗是 null。 */
  backup: BackupWiring | null = null;
  /** 電腦專用的功能載入失敗的原因（設定頁顯示）。 */
  private backupError: string | null = null;
  private settingTab: { refresh: () => void } | null = null;
  /** 這次載入已經提示過的來源：同一種只提示一次。 */
  private warned = new Set<ErrorSource>();
  /** 錯誤紀錄（D-155）：onload 裡裝置碼確定之後建立；這個外掛自己的錯都經過它。建立之前什麼都不記。 */
  private errors: ErrorLog = { record() {}, report() {} };
  private unloaded = false;
  private readonly listeners: { [K in PluginEvent]: Set<(value: PluginEvents[K]) => void> } = { notice: new Set(), event: new Set(), removed: new Set(), review: new Set() };

  onload(): void {
    const loadedAt = performance.now();
    // 只註冊命令與事件，不讀任何檔案：layout ready 之前 Obsidian 會對每個檔案發 create（§4-1）。
    this.device = loadDeviceCode(this.app);
    let files: Files = createObsidianFiles(this.app);
    // 錯誤紀錄等 layout ready 才讀寫：之前 vault 的索引還不完整，數不到當月的行數（D-155 第 3 點）。
    const layoutReady = new Promise<void>(resolve => { this.app.workspace.onLayoutReady(resolve); });
    this.errors = createErrorLog({ files, device: this.device, build: BUILD, obsidian: apiVersion, after: layoutReady });
    // 補網（D-155 第 2 點）：只收 stack 有這個外掛自己程式位置的；registerDomEvent 在停用時自動移除。瀏覽器已經印在 console。
    this.registerDomEvent(window, 'error', event => { if (hasOwnFrame(event.error)) this.errors.record('uncaught', event.error); });
    this.registerDomEvent(window, 'unhandledrejection', event => { if (hasOwnFrame(event.reason)) this.errors.record('uncaught', event.reason); });
    this.addCommand({
      id: 'version',
      name: '版本',
      callback: () => { void this.showVersion(); },
    });
    // 補 ID 與鎖住 ID 只在電腦（D-134：iPhone 不寫卡組筆記，也不裝編輯器的鎖定）。
    if (Platform.isDesktopApp) this.ids = this.wireIds();
    // 設定分頁（D-104、D-156 依功能分區）：「備份」一區；iPhone 上只寫「備份在電腦上做」。
    this.settingTab = wireSettings({ plugin: this, backup: () => this.backup, backupError: () => this.backupError });
    // 複習畫面的暫時入口（W6 §3-9）：命令與左側功能區的圖示；入口畫面做好時拿掉。
    registerStart(this, { state: () => this.state, open: pick => { this.startReview(pick); } });
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
    this.state?.close().catch((error: unknown) => { this.fail('close', error); });
  }

  /** 打開全螢幕的複習畫面（W6）：同時只有一個，再開就先關掉上一個。 */
  startReview(pick: Pick): ReviewHandle | null {
    if (!this.state) return null;
    const pickedAt = performance.now();
    this.review?.close();
    this.review = openReview({
      app: this.app, state: this.state, pick, pickedAt,
      onEvent: event => { this.emit('review', event); },
      onError: (error, where, path) => { this.fail(where, error, path); },
      // 學生的回報（D-160）：記進錯誤紀錄，不寫複習紀錄、不改排程；提示照第 3 點。
      onReport: (kind, card) => { this.errors.report({ kind, path: card.deck, lt: card.lt, v: card.v }); new Notice(REPORT_NOTICE); },
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
      try { listener(value); } catch (error) { this.fail('event', error); }
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
      onError: error => { this.fail('fill', error); },
      log: event => { this.emit('event', stamp(event)); },
    });
    // 編輯器一建立就告訴離開筆記的備援「這篇開著」：開完馬上關時，Obsidian 只在關之後送一次 layout-change（技術債 A3，a3check 的 C1、C3）。
    this.registerEditorExtension(ViewPlugin.define(view => { saver.opened(pathOf(view.state)); return {}; }));
    return { tokens: lock.tokens, saver };
  }

  /** 這個外掛自己的錯：照舊印在 console，再交給錯誤紀錄（where 照 syntax.md §9）。 */
  private fail(where: ErrorWhere, error: unknown, path?: string): void {
    console.error('Essence Cards', where, error);
    this.errors.record(where, error, path === undefined ? undefined : { path });
  }

  private report(error: unknown, source: ErrorSource): void {
    this.fail(source, error);
    const notice = NOTICES[source];
    if (!notice || this.warned.has(source)) return;
    this.warned.add(source);
    new Notice(notice);
  }

  /** 「版本」命令（任務說明 2-1）：先等排隊的紀錄寫完，這台的版本行才照實顯示；寫不完也照樣顯示。 */
  private async showVersion(): Promise<void> {
    const state = this.state;
    // 寫不進去已經經過 onError（write）記下；版本命令照樣顯示，版本行標成還沒寫成。
    if (state) await Promise.race([state.flush().catch(() => {}), new Promise(resolve => window.setTimeout(resolve, VERSION_WAIT))]);
    // 內容好幾行、要對著看：留到使用者關掉。
    new Notice(versionText(BUILD, this.device, this.state), 0);
  }

  /** 有內容需要新版才讀得懂：這次載入只提示一次（載入完，或之後重讀時才出現）。 */
  private updateWarned = false;
  private warnUpdate(): void {
    const blocked = this.state?.blocked();
    if (this.updateWarned || !blocked || (!blocked.decks.length && !blocked.targets.length && !blocked.all)) return;
    this.updateWarned = true;
    new Notice(UPDATE_NOTICE);
  }

  /**
   * 電腦上的備份（D-150、D-148）：判斷是電腦之後才動態載入電腦專用的資料夾（不經共用的重新匯出檔）；state 讀完再看要不要備份。
   * 載入失敗時閘門照樣關著（沒有成功的備份就不改寫卡組），設定頁寫出原因。
   */
  private async startBackup(files: Files): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) throw Error('這個 vault 不在這台電腦的資料夾裡');
      const { createDesktop } = await import('./desktop/index.ts');
      const desktop = await createDesktop(adapter.getBasePath());
      if (this.unloaded) return;
      this.backup = wireBackup({
        plugin: this, desktop, files, build: BUILD,
        changed: status => { this.state?.backupReady(status.ready); this.ids?.saver.refresh(); this.settingTab?.refresh(); },
        notify: message => { new Notice(message); this.emit('notice', message); },
      });
      this.settingTab?.refresh();
      await this.state?.ready();
      if (!this.unloaded) this.backup.start();
    } catch (error) {
      if (this.unloaded) return;
      console.error('Essence Cards：備份', error);
      this.backupError = '備份的功能載入失敗：' + (error instanceof Error ? error.message : String(error));
      new Notice(BACKUP_NOTICE);
      this.emit('notice', BACKUP_NOTICE);
      this.settingTab?.refresh();
    }
  }

  private start(files: Files): void {
    // onLayoutReady 的回呼不會隨外掛停用取消：layout ready 之前就停用時不建立 state。
    if (this.unloaded) return;
    // BUILD 由這裡傳進 state，核心不讀全域（任務說明 2-1）：版本行與讀取閘門都照它。
    // 電腦上改寫卡組要先有一份成功的備份（D-150 第 3 點）：閘門一開始關著，備份確認之後才打開。
    this.state = createState({ files, device: this.device, build: BUILD, fillIds: Platform.isDesktopApp, backup: Platform.isDesktopApp, onError: (error, source) => { this.report(error, source); } });
    if (Platform.isDesktopApp) void this.startBackup(files);
    // 離開筆記的備援：記下現在開著哪些（只記，不補）。
    this.ids?.saver.start();
    // 卡組重讀之後更新存檔按鈕的樣子。
    this.state.onChange(() => { this.ids?.saver.refresh(); this.warnUpdate(); });
    // 能讀到的讀完就完成：讀不到的那一篇先跳過，state 自己隔一段時間重試，恢復後自動納入（unread()；每次失敗都經過 onError）。
    // 只有列不出來時整個重試；停用外掛（close()）或程式本身的錯才會讓它 reject。程式本身的錯已經經過 onError（read 或 init，
    // tasks/error-log.md §2-3），停用不是故障，所以這裡只接住。
    this.state.ready().then(() => { this.ids?.saver.refresh(); this.warnUpdate(); }, () => {});
  }
}
