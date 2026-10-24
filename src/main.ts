import { Notice, Plugin } from 'obsidian';
import type { Files } from './core/files.ts';
import { countFiles } from './dev/wrap-files.ts';
import { loadDeviceCode } from './obsidian/device.ts';
import { createObsidianFiles } from './obsidian/files.ts';
import { createState, type ErrorSource, type State } from './state/index.ts';

/** tools/build.mjs 的 define：開發版是 true，正式建置是 false，開發命令整段不進 main.js。 */
declare const DEV: boolean;

// 照錯誤來源如實提示；監聽者丟錯是程式的錯，只記在 console（Codex 審查 W5 第 11 點）。
const NOTICES: Partial<Record<ErrorSource, string>> = {
  write: 'Essence Cards：複習紀錄暫時寫不進去，會自動再試',
  read: 'Essence Cards：有些卡組或複習紀錄暫時讀不到，會自動再試',
};

export default class EssenceCardsPlugin extends Plugin {
  /** 這台裝置的碼（W5 說明 §4-2）；紀錄的檔名用它。 */
  device = '';
  /** layout ready 之後才建立；畫面從這裡拿資料。 */
  state: State | null = null;
  /** 這次載入已經提示過的來源：同一種只提示一次。 */
  private warned = new Set<ErrorSource>();
  private unloaded = false;

  onload(): void {
    const loadedAt = performance.now();
    // 只註冊命令與事件，不讀任何檔案：layout ready 之前 Obsidian 會對每個檔案發 create（§4-1）。
    this.device = loadDeviceCode(this.app);
    this.addCommand({
      id: 'version',
      name: '版本',
      callback: () => { new Notice('Essence Cards：' + this.manifest.version); },
    });
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
    this.state = createState({ files, device: this.device, onError: (error, source) => { this.report(error, source); } });
    // 讀不到時 ready() 自己重試（每次失敗都經過 onError）；只有停用外掛會讓它 reject。
    this.state.ready().catch(() => {});
  }
}
