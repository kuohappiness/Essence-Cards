import { editorInfoField, Notice, Platform, Plugin } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type { EditorState, StateField } from '@codemirror/state';
import { isDeckPath } from './core/deck/index.ts';
import type { Files } from './core/files.ts';
import { countFiles } from './dev/wrap-files.ts';
import { loadDeviceCode } from './obsidian/device.ts';
import { createObsidianFiles } from './obsidian/files.ts';
import { idLock, type IdToken } from './obsidian/lock.ts';
import { wireSave } from './obsidian/save.ts';
import { createState, type ErrorSource, type State } from './state/index.ts';

/** tools/build.mjs 的 define：開發版是 true，正式建置是 false，開發命令整段不進 main.js。 */
declare const DEV: boolean;

// 照錯誤來源如實提示；監聽者丟錯是程式的錯，只記在 console（Codex 審查 W5 第 11 點）。
const NOTICES: Partial<Record<ErrorSource, string>> = {
  write: 'Essence Cards：複習紀錄暫時寫不進去，會自動再試',
  read: 'Essence Cards：有些卡組或複習紀錄暫時讀不到，會自動再試',
};

/** 編輯器開的檔案（CodeMirror 的 state 裡 Obsidian 放的資訊）。 */
// obsidian.d.ts 用 CommonJS 的 @codemirror/state 型別，這裡是 ESM 的；同一個執行期物件，只是型別宣告分成兩份。
const infoField = editorInfoField as unknown as StateField<MarkdownFileInfo>;
const pathOf = (state: EditorState): string | undefined => state.field(infoField, false)?.file?.path;

export default class EssenceCardsPlugin extends Plugin {
  /** 這台裝置的碼（W5 說明 §4-2）；紀錄的檔名用它。 */
  device = '';
  /** layout ready 之後才建立；畫面從這裡拿資料。 */
  state: State | null = null;
  /** 開發版：存檔按鈕、提示與編輯器鎖定的紀錄，給開發命令讀（W5 §8-7 的 lock、save）。 */
  devLog = { notices: [] as string[], events: [] as string[], removed: [] as { path: string; ids: string[] }[], tokens: null as ((state: EditorState) => IdToken[]) | null, save: null as ReturnType<typeof wireSave> | null };
  /** 這次載入已經提示過的來源：同一種只提示一次。 */
  private warned = new Set<ErrorSource>();
  private unloaded = false;
  private saver: ReturnType<typeof wireSave> | null = null;

  onload(): void {
    const loadedAt = performance.now();
    // 只註冊命令與事件，不讀任何檔案：layout ready 之前 Obsidian 會對每個檔案發 create（§4-1）。
    this.device = loadDeviceCode(this.app);
    this.addCommand({
      id: 'version',
      name: '版本',
      callback: () => { new Notice('Essence Cards：' + this.manifest.version); },
    });
    // 補 ID 與鎖住 ID 只在電腦（D-134：iPhone 不寫卡組筆記，也不裝編輯器的鎖定）。
    if (Platform.isDesktopApp) this.wireIds();
    let files: Files = createObsidianFiles(this.app);
    let calls = (): number => 0;
    if (DEV) ({ files, calls } = countFiles(files));
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
    if (DEV) {
      const onloadMs = performance.now() - loadedAt;
      void import('./obsidian/dev.ts').then(dev => { dev.registerDev(this, { loadedAt, onloadMs, beforeLayoutReady: () => beforeLayoutReady }); });
    }
  }

  onunload(): void {
    this.unloaded = true;
    this.state?.close().catch((error: unknown) => { console.error('Essence Cards', error); });
  }

  /** 編輯器的鎖定、存檔按鈕與命令、離開筆記時的備援（W5 §8-6）。 */
  private wireIds(): void {
    // 開發版另外鎖 Essence W5/暫存/ 裡的副本，讓開發命令 lock 在那裡測各種編輯。
    const lockable = (path: string | undefined): boolean => !!path && (isDeckPath(path) || DEV && path.startsWith('Essence W5/暫存/'));
    const lock = idLock({
      isDeck: state => lockable(pathOf(state)),
      onRemoved: (state, ids) => {
        const path = pathOf(state);
        if (!path) return;
        this.state?.removedInEditor(path, ids);
        if (DEV) { this.devLog.removed.push({ path, ids }); this.devLog.events.push(Math.round(performance.now()) + " 編輯器拿掉 " + ids.join(",")); }
      },
      onRestored: (state, ids) => {
        const path = pathOf(state);
        if (path) this.state?.restoredInEditor(path, ids);
        if (DEV) this.devLog.events.push(Math.round(performance.now()) + " 編輯器補回 " + ids.join(","));
      },
    });
    this.registerEditorExtension(lock.extension);
    this.saver = wireSave({
      plugin: this,
      state: () => this.state,
      notify: message => { new Notice(message); if (DEV) this.devLog.notices.push(message); },
      onError: error => { console.error('Essence Cards：離開筆記時補學習目標 ID 失敗', error); },
      log: DEV ? event => { this.devLog.events.push(Math.round(performance.now()) + ' ' + event); } : undefined,
    });
    if (DEV) Object.assign(this.devLog, { tokens: lock.tokens, save: this.saver });
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
    // 卡組重讀之後更新存檔按鈕的樣子。
    this.state.onChange(() => { this.saver?.refresh(); });
    // 讀不到時 ready() 自己重試（每次失敗都經過 onError）；只有停用外掛會讓它 reject。
    this.state.ready().then(() => { this.saver?.refresh(); }, () => {});
  }
}
