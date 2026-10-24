import { Notice, Plugin } from 'obsidian';
import type { Files } from './core/files.ts';
import { countFiles } from './dev/wrap-files.ts';
import { loadDeviceCode } from './obsidian/device.ts';
import { createObsidianFiles } from './obsidian/files.ts';
import { createState, type State } from './state/index.ts';

/** tools/build.mjs 的 define：開發版是 true，正式建置是 false，開發命令整段不進 main.js。 */
declare const DEV: boolean;

export default class EssenceCardsPlugin extends Plugin {
  /** 這台裝置的碼（W5 說明 §4-2）；紀錄的檔名用它。 */
  device = '';
  /** layout ready 之後才建立；畫面從這裡拿資料。 */
  state: State | null = null;
  private warned = false;
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
      if (document.visibilityState === 'hidden') void this.state?.flush();
    });
    if (DEV) {
      const onloadMs = performance.now() - loadedAt;
      void import('./obsidian/dev.ts').then(dev => { dev.registerDev(this, { loadedAt, onloadMs, beforeLayoutReady: () => beforeLayoutReady }); });
    }
  }

  onunload(): void {
    this.unloaded = true;
    void this.state?.close();
  }

  private start(files: Files): void {
    // onLayoutReady 的回呼不會隨外掛停用取消：layout ready 之前就停用時不建立 state。
    if (this.unloaded) return;
    const report = (error: unknown): void => {
      console.error('Essence Cards', error);
      if (this.warned) return;
      this.warned = true;
      new Notice('Essence Cards：複習紀錄暫時寫不進去，會自動再試');
    };
    this.state = createState({ files, device: this.device, onError: report });
    this.state.ready().catch(report);
  }
}
