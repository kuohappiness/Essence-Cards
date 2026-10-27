import { MarkdownView, Modal, setIcon } from 'obsidian';
import type { App, Editor, Plugin, WorkspaceLeaf } from 'obsidian';
import { isDeckPath, parseDeck } from '../core/deck/index.ts';
import type { IdIssue, IdIssueKind, State } from '../state/index.ts';
import { textChanges } from './diff.ts';

// 存檔按鈕、待處理問題的小視窗與離開筆記時的備援（W5 §8-6、D-134），只在電腦接上。
// 家長不必知道 ID 存在：文字只說「加入複習」「進度連結」。

export const TIPS = {
  done: '筆記已自動儲存；學習目標都已加入複習',
  missing: (n: number) => `筆記已自動儲存；有 ${n} 個學習目標尚未加入複習`,
  issues: (n: number) => `有 ${n} 個學習目標的進度連結需要處理`,
  added: (n: number) => `${n} 個學習目標已加入複習`,
  stale: '這篇筆記剛剛改過，請再按一次存檔',
};
export const MESSAGES: Record<IdIssueKind, (name: string) => string> = {
  lost: name => `〈${name}〉原本的編號不見了（可能在 Obsidian 以外改過這篇筆記）。`,
  changed: name => `〈${name}〉的編號和原本的不一樣。`,
  ambiguous: name => `〈${name}〉那一行有兩個編號。`,
};
/** 離開筆記之後等多久才補（毫秒）。 */
const LEAVE_DELAY = 1000;
/** 多久看一次分頁、把開著的卡組記下來（毫秒）。 */
const REMEMBER_EVERY = 2000;
export const BUTTONS = { restore: '還原原本的進度', fresh: '當成新的學習目標，從頭複習', unsure: '找不到可以確定的原本編號' };

export interface SaveHost {
  plugin: Plugin;
  state: () => State | null;
  /** 提示家長（Notice）；開發版另外記下來給開發命令讀。 */
  notify: (message: string) => void;
  /** 離開筆記時補 ID 失敗（例如寫不進去）。 */
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
    const state = this.host.state();
    if (!state) return;
    const editor = this.view.editor, before = editor.getValue();
    const after = state.resolveText(issue, choice, before);
    if (after === null) { this.host.notify(TIPS.stale); this.close(); return; }
    applyText(editor, before, after);
    this.render();
  }
}

/** wireSave 交回的：更新按鈕、存檔、編輯器建立時記下這篇開著、layout ready 時記下目前開著哪些。 */
export interface Saver { refresh: () => void; save: (view: MarkdownView) => void; opened: (path: string | undefined) => void; start: () => void }
/** 接上存檔按鈕、同名命令與離開筆記時的備援。 */
export function wireSave(host: SaveHost): Saver {
  const { plugin } = host;
  const { app } = plugin;
  const buttons = new Map<MarkdownView, HTMLElement>();
  /** 上一次知道開著的檔（離開筆記的備援用）；啟動後第一次事件之前是 null。 */
  let open: Set<string> | null = null;

  function save(view: MarkdownView): void {
    const state = host.state(), path = view.file?.path;
    if (!state || !path || !isDeckPath(path)) return;
    const editor = view.editor, before = editor.getValue();
    const after = state.fillText(path, before);
    applyText(editor, before, after);
    const status = state.deckStatus(path);
    // 這次真的加上 ID 的目標數（用存檔當下的文字算，不用 state 上一次讀到的）。
    const withId = (text: string): number => parseDeck(text).targets.filter(target => target.id).length;
    const added = Math.max(0, withId(after) - withId(before));
    if (added) host.notify(TIPS.added(added));
    refresh();
    if (status.issues.length) new IssuesModal(app, host, view).open();
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
      open?.add(path);
      const look = buttonLook(state.deckStatus(path));
      let button = buttons.get(view);
      if (!button) {
        button = view.addAction(look.icon, look.tip, () => { save(view); });
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
      if (ok && !checking) save(view);
      return ok;
    },
  });

  // 離開筆記時的備援：上一次開著、這一次所有 Markdown 分頁都沒有開著的卡組，各補一次（只是切換焦點不算）。
  // 第一次（啟動）只記下開著哪些，不補。open 在 wireSave 的開頭宣告，refresh 也會把看到的卡組記進去。
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
  plugin.registerEvent(app.workspace.on('file-open', leave));
  plugin.registerEvent(app.workspace.on('active-leaf-change', refresh));
  // 開到背景分頁時 Obsidian 不發 file-open（2026-10-26 實測），只開不改就關也要補（D-134，Codex 再審的 R3）：
  // 編輯器一建立（main.ts 的 ViewPlugin 呼叫 opened）、在編輯器裡改過字、每 2 秒看一次分頁，都把開著的卡組記下來。
  // 只是記下開著，補 ID 仍然只在「上一次開著、這一次沒有」時；還不知道誰開著（open 是 null）時不記。
  const remember = (path: string | undefined): void => { if (open && path && isDeckPath(path)) open.add(path); };
  plugin.registerEvent(app.workspace.on('editor-change', (_editor, info) => { remember(info.file?.path); }));
  plugin.registerInterval(window.setInterval(() => { for (const path of openPaths()) remember(path); }, REMEMBER_EVERY));
  // layout ready 時（包括 layout 已經 ready、外掛才重新啟用）先記下目前開著哪些，不補；
  // 不然第一個事件就是關掉原本開著的卡組時，基準是空的，那篇就漏補（Codex 第三次審查的 T1）。
  const start = (): void => { open ??= openPaths(); };
  return { refresh, save, opened: remember, start };
}

/** 分頁開著的檔案；還沒載入的分頁從 viewState 拿。 */
function fileOf(leaf: WorkspaceLeaf): string | null {
  if (leaf.view instanceof MarkdownView && leaf.view.file) return leaf.view.file.path;
  const file = leaf.getViewState().state?.file;
  return typeof file === 'string' ? file : null;
}
