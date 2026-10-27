import { Notice, SuggestModal, type App, type Plugin } from 'obsidian';
import type { Pick } from '../core/study/index.ts';
import { startRows, type StartRow } from '../review/index.ts';
import type { State } from '../state/index.ts';

// 暫時的開始方式（W6 §3-9）：命令「Essence Cards：開始複習」加左側功能區的圖示，打開一個選單一列一科；
// 入口畫面（D-095）做好時拿掉。

export interface StartOptions {
  state: () => State | null;
  /** 選了之後：打開全螢幕的複習畫面。 */
  open: (pick: Pick) => void;
}

class PickModal extends SuggestModal<StartRow> {
  private readonly rows: StartRow[];
  private readonly choose: (pick: Pick) => void;
  constructor(app: App, rows: StartRow[], choose: (pick: Pick) => void) {
    super(app);
    this.rows = rows;
    this.choose = choose;
    this.setPlaceholder('今天要複習哪一科？');
  }
  getSuggestions(query: string): StartRow[] {
    const needle = query.trim();
    return needle ? this.rows.filter(row => row.label.includes(needle)) : this.rows;
  }
  renderSuggestion(row: StartRow, el: HTMLElement): void { el.setText(row.label); }
  onChooseSuggestion(row: StartRow): void { this.choose(row.pick); }
}

export function registerStart(plugin: Plugin, options: StartOptions): void {
  async function start(): Promise<void> {
    const state = options.state();
    if (!state) { new Notice('Essence Cards：正在讀取卡組…'); return; }
    let loaded = true;
    try { state.progress(); } catch { loaded = false; }
    if (!loaded) {
      new Notice('Essence Cards：正在讀取卡組…');
      // 讀不到時 state 自己重試並由外掛提示；這裡只等讀完（停用外掛才會 reject）。
      try { await state.ready(); } catch { return; }
    }
    const rows = startRows(state.progress());
    if (!rows.length) { new Notice('Essence Cards：今天沒有要複習的卡'); return; }
    new PickModal(plugin.app, rows, pick => { options.open(pick); }).open();
  }
  plugin.addCommand({ id: 'start-review', name: '開始複習', callback: () => { void start(); } });
  plugin.addRibbonIcon('graduation-cap', 'Essence Cards：開始複習', () => { void start(); });
}
