import { MarkdownView, Modal, setIcon } from 'obsidian';
import type { App, Editor, Plugin, WorkspaceLeaf } from 'obsidian';
import { isDeckPath } from '../core/deck/index.ts';
import type { EditorHandle, IdIssue, IdIssueKind, State, WriteResult } from '../state/index.ts';
import { textChanges } from './diff.ts';

// 存檔按鈕、待處理問題的小視窗與離開筆記時的備援（W5 §8-6、D-134），只在電腦接上。
// 家長不必知道 ID 存在：文字只說「加入複習」「進度連結」。

export const TIPS = {
  done: '筆記已自動儲存；學習目標都已加入複習',
  missing: (n: number) => `筆記已自動儲存；有 ${n} 個學習目標尚未加入複習`,
  issues: (n: number) => `有 ${n} 個學習目標的進度連結需要處理`,
  added: (n: number) => `${n} 個學習目標已加入複習`,
  stale: '這篇筆記剛剛改過，請再按一次存檔',
  failed: '這篇筆記暫時存不進去，學習目標還沒加入複習；請稍後再按一次存檔',
};
export const MESSAGES: Record<IdIssueKind, (name: string) => string> = {
  lost: name => `〈${name}〉原本的編號不見了（可能在 Obsidian 以外改過這篇筆記）。`,
  changed: name => `〈${name}〉的編號和原本的不一樣。`,
  ambiguous: name => `〈${name}〉那一行有兩個編號。`,
};
/** 離開筆記之後等多久才補（毫秒）。 */
const LEAVE_DELAY = 1000;
export const BUTTONS = { restore: '還原原本的進度', fresh: '當成新的學習目標，從頭複習', unsure: '找不到可以確定的原本編號' };

export interface SaveHost {
  plugin: Plugin;
  state: () => State | null;
  /** 提示家長（Notice）；開發版另外記下來給開發命令讀。 */
  notify: (message: string) => void;
  /** 離開筆記時補 ID 失敗（例如寫不進去）；存檔與小視窗的寫入出現程式的錯也交給它。 */
  onError: (error: unknown) => void;
  /** 記下離開筆記與補 ID 的時間點（main.ts 發成事件，開發命令訂閱；技術債 A10）。 */
  log?: (event: string) => void;
}

/** 只改有變的部分，經 Editor 的交易套用：游標、選取與 Undo 照常（W5 §8-2 第 4 點）。 */
function applyText(editor: Editor, before: string, after: string): void {
  const changes = textChanges(before, after);
  if (!changes.length) return;
  editor.transaction({ changes: changes.map(c => ({ from: editor.offsetToPos(c.from), to: editor.offsetToPos(c.to), text: c.insert })) });
}

/**
 * 開著的筆記交給 state 寫入（tasks/state-writes.md §7）：path 是按下時的那一篇；換篇、改名之後 text() 回傳 null，
 * 內容已經不是 before 時 apply 不改；persist 等編輯器把內容寫進磁碟（view.save()）。
 */
function editorOf(view: MarkdownView, path: string): EditorHandle {
  const editor = view.editor;
  return {
    path,
    text: () => view.file?.path === path ? editor.getValue() : null,
    apply(before, after) {
      if (editor.getValue() !== before) return false;
      applyText(editor, before, after);
      return true;
    },
    persist: () => view.save(),
  };
}

/** 存檔結果的提示；unchanged、blocked、saved 不提示（讀不到時 main.ts 已有一次「讀不到…會自動重試」）。 */
function saveTip(result: WriteResult): string | null {
  if (result.kind === 'done') return result.added ? TIPS.added(result.added) : null;
  if (result.kind === 'stale') return TIPS.stale;
  if (result.kind === 'failed') return TIPS.failed;
  return null;
}

/** 一篇卡組按鈕的樣子：沒有要做的、有目標還沒有 ID、有待處理的問題。 */
function buttonLook(status: { missing: number; issues: IdIssue[] }): { kind: 'done' | 'missing' | 'issues'; icon: string; tip: string } {
  if (status.issues.length) return { kind: 'issues', icon: 'alert-triangle', tip: TIPS.issues(status.issues.length) };
  if (status.missing) return { kind: 'missing', icon: 'save', tip: TIPS.missing(status.missing) };
  return { kind: 'done', icon: 'check-circle', tip: TIPS.done };
}

class IssuesModal extends Modal {
  private readonly host: SaveHost;
  private readonly view: MarkdownView;
  private stop: (() => void) | null = null;
  constructor(app: App, host: SaveHost, view: MarkdownView) {
    super(app);
    this.host = host;
    this.view = view;
  }
  onOpen(): void {
    // 卡組重讀後問題可能變了（內容改過的問題換成新的物件，舊的不能寫回）：跟著重畫，家長看到的就是現在的內容。
    this.stop = this.host.state()?.onChange(() => { this.render(); }) ?? null;
    this.render();
  }
  onClose(): void { this.stop?.(); this.stop = null; this.contentEl.empty(); }
  private render(): void {
    const state = this.host.state(), path = this.view.file?.path;
    const issues = state && path ? state.deckStatus(path).issues : [];
    if (!issues.length) { this.close(); return; }
    this.titleEl.setText(TIPS.issues(issues.length));
    this.contentEl.empty();
    for (const issue of issues) {
      const row = this.contentEl.createDiv({ cls: 'essence-cards-issue' });
      row.createEl('p', { text: MESSAGES[issue.kind](issue.name) });
      const buttons = row.createDiv({ cls: 'essence-cards-issue-buttons' });
      if (issue.restore) buttons.createEl('button', { text: BUTTONS.restore, cls: 'mod-cta' }).addEventListener('click', () => { this.choose(issue, 'restore'); });
      else row.createEl('p', { text: BUTTONS.unsure, cls: 'essence-cards-issue-note' });
      buttons.createEl('button', { text: BUTTONS.fresh }).addEventListener('click', () => { this.choose(issue, 'new'); });
    }
  }
  private choose(issue: IdIssue, choice: 'restore' | 'new'): void {
    const state = this.host.state(), path = this.view.file?.path;
    if (!state || !path) return;
    // 結果回來之前兩個按鈕都停用。
    this.contentEl.querySelectorAll('button').forEach(button => { button.disabled = true; });
    state.resolve(issue, choice, editorOf(this.view, path)).then(result => {
      if (result.kind === 'done') { this.render(); return; }
      this.host.notify(result.kind === 'failed' ? TIPS.failed : TIPS.stale);
      this.close();
    }, (error: unknown) => { this.host.onError(error); this.close(); });
  }
}

/**
 * wireSave 交回的：更新按鈕、存檔（等到結果、提示與按鈕都更新後才完成；同一篇的存檔還沒結束時回傳同一個 Promise）、
 * 編輯器建立時記下這篇開著、layout ready 時記下目前開著哪些。
 */
export interface Saver { refresh: () => void; save: (view: MarkdownView) => Promise<void>; opened: (path: string | undefined) => void; start: () => void }
/** 接上存檔按鈕、同名命令與離開筆記時的備援。 */
export function wireSave(host: SaveHost): Saver {
  const { plugin } = host;
  const { app } = plugin;
  const buttons = new Map<MarkdownView, HTMLElement>();
  /** 上一次知道開著的檔（離開筆記的備援用）；start() 或第一次 layout-change 之前是 null。 */
  let open: Set<string> | null = null;

  /** 存檔還沒結束的卡組：再按不另外排一份。 */
  const saving = new Map<string, Promise<void>>();
  function save(view: MarkdownView): Promise<void> {
    const state = host.state(), path = view.file?.path;
    if (!state || !path || !isDeckPath(path)) return Promise.resolve();
    const running = saving.get(path);
    if (running) return running;
    const job = state.save(editorOf(view, path)).then(result => {
      const tip = saveTip(result);
      if (tip) host.notify(tip);
      refresh();
      if (state.deckStatus(path).issues.length) new IssuesModal(app, host, view).open();
    }).catch(host.onError).finally(() => { saving.delete(path); });
    saving.set(path, job);
    return job;
  }

  function refresh(): void {
    const state = host.state();
    const seen = new Set<MarkdownView>();
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const path = view.file?.path;
      if (!state || !path || !isDeckPath(path)) continue;
      seen.add(view);
      const look = buttonLook(state.deckStatus(path));
      let button = buttons.get(view);
      if (!button) {
        button = view.addAction(look.icon, look.tip, () => { void save(view); });
        button.addClass('essence-cards-save');
        buttons.set(view, button);
      }
      setIcon(button, look.icon);
      button.setAttribute('aria-label', look.tip);
      for (const kind of ['done', 'missing', 'issues']) button.toggleClass('is-' + kind, kind === look.kind);
    }
    // 換成別的筆記、或分頁關掉了：拿掉按鈕。
    for (const [view, button] of buttons) if (!seen.has(view)) { button.remove(); buttons.delete(view); }
  }

  plugin.addCommand({
    id: 'save',
    name: '存檔',
    checkCallback: checking => {
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      const ok = !!view?.file && isDeckPath(view.file.path) && !!host.state();
      if (ok && !checking) void save(view);
      return ok;
    },
  });

  // 離開筆記時的備援：上一次開著、這一次所有 Markdown 分頁都沒有開著的卡組，各補一次（只是切換焦點不算）。
  // 「開著哪些」有三個來源（技術債 A3；Windows 1.14.5 實測見外掛架構討論稿環節 1 的實機記錄與 A3 設計稿的 a3check）：
  // 1. start()：layout ready 時記下 openPaths()，只記不補。接住 Obsidian 啟動時還原、還沒載入的分頁（openPaths 從 viewState 拿檔名），
  //    以及重新啟用外掛時已經開著的分頁（Codex 第三次審查的 T1）。
  // 2. layout-change：比對 openPaths() 和上一次，唯一會補的時機。開著的集合改變時 Obsidian 會送，送出時 getLeavesOfType 已經是新的：
  //    背景與前景的開、關，同一個分頁換篇、改名、分割、側欄、疊放分頁、setViewState、版面切換、另一個視窗的開與關都測過；
  //    只切換分頁時不送，集合也不變。
  // 3. opened（main.ts 的 ViewPlugin，編輯器一建立就呼叫）：只記不補。開完馬上關（或開、換篇、關）時 Obsidian 只在關之後送一次
  //    layout-change，那時卡組已經不在 openPaths() 裡，只有編輯器建立看得到它（a3check 的 C1、C3）。
  const openPaths = (): Set<string> => new Set(app.workspace.getLeavesOfType('markdown').map(fileOf).filter((path): path is string => !!path));
  function leave(): void {
    const now = openPaths();
    const state = host.state();
    if (open && state) for (const path of open) if (!now.has(path) && isDeckPath(path)) {
      // 等編輯器把最後打的字存進檔案，再讀檔補；這段時間又打開了就不補。
      host.log?.('離開 ' + path);
      window.setTimeout(() => {
        if (openPaths().has(path)) { host.log?.('又打開了，不補 ' + path); return; }
        host.state()?.fillIds(path).then(changed => {
          // 補完之後 state 怎麼看這一篇（開發命令查備援的時序用）。
          host.log?.('補 ' + path + ' → ' + String(changed) + '；' + JSON.stringify(host.state()?.deckStatus(path)));
        }, host.onError);
      }, LEAVE_DELAY);
    }
    open = now;
    refresh();
  }
  plugin.registerEvent(app.workspace.on('layout-change', leave));
  // 換到別的分頁時更新按鈕（只管按鈕，不記開著哪些）。
  plugin.registerEvent(app.workspace.on('active-leaf-change', refresh));
  // 還不知道誰開著（open 是 null）時不記：之後的 start() 或第一次 layout-change 會從 openPaths() 算。
  const opened = (path: string | undefined): void => { if (open && path && isDeckPath(path)) open.add(path); };
  // 包括 layout 已經 ready、外掛才重新啟用；不然第一個事件就是關掉原本開著的卡組時，基準是空的，那篇就漏補。
  const start = (): void => { open ??= openPaths(); };
  return { refresh, save, opened, start };
}

/** 分頁開著的檔案；還沒載入的分頁從 viewState 拿。 */
function fileOf(leaf: WorkspaceLeaf): string | null {
  if (leaf.view instanceof MarkdownView && leaf.view.file) return leaf.view.file.path;
  const file = leaf.getViewState().state?.file;
  return typeof file === 'string' ? file : null;
}
