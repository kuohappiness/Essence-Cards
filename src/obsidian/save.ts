import { MarkdownView, Modal, setIcon } from 'obsidian';
import type { App, Editor, Plugin, WorkspaceLeaf } from 'obsidian';
import { isDeckPath, parseDeck } from '../core/deck/index.ts';
import type { EditorHandle, IdIssue, IdIssueKind, Malformed, State, WriteBlock, WriteResult } from '../state/index.ts';
import { textChanges } from './diff.ts';

// 存檔按鈕、待處理問題的小視窗與離開筆記時的備援（W5 §8-6、D-134），只在電腦接上。
// 家長不必知道 ID 存在：文字只說「加入複習」「進度連結」。

export const TIPS = {
  // 不說「都已加入複習」：還沒到期、別篇需要新版、草稿、暫停的目標也不出題，按鈕不能承諾（技術債 D1）。
  done: '筆記已自動儲存；沒有發現需要處理的地方',
  missing: (n: number) => `筆記已自動儲存；有 ${n} 個學習目標尚未加入複習`,
  issues: (n: number) => `有 ${n} 個學習目標的進度連結需要處理`,
  /** 寫錯的不算（技術債 D1）。 */
  added: (n: number) => `${n} 個學習目標已加入複習`,
  /** 寫法有問題、暫時不會出題的目標（技術債 D1）；按鈕說明與存檔後的通知都用。 */
  malformed: (n: number) => `筆記已自動儲存；有 ${n} 個學習目標寫法有問題，暫時不會出題`,
  /** 存檔後新增的數和寫法有問題的合成一次通知（技術債 D1）。 */
  addedMalformed: (added: number, n: number) => `${added} 個學習目標已加入複習；有 ${n} 個學習目標寫法有問題，暫時不會出題`,
  /** 通知裡一個寫法有問題的目標；line 從 1 算。 */
  problem: (line: number, name: string, reason: string) => `第 ${line} 行〈${name}〉：${reason}`,
  /** 通知只列前幾個，其餘的數。 */
  more: (n: number) => `另有 ${n} 個`,
  stale: '這篇筆記剛剛改過，請再按一次存檔',
  failed: '這篇筆記暫時存不進去，學習目標還沒加入複習；請稍後再按一次存檔',
  /** 受阻：還沒讀完或有檔案讀不到（D-154 第 2 點）；按鈕說明與小視窗也用這一句。 */
  blocked: '筆記已自動儲存；暫時無法把新目標加入複習，讀取完成後請再按一次存檔',
  // 需要新版的卡組（任務說明 2-2、syntax.md §2-1）：Cards 不寫它，也不說「都已加入複習」。
  needsUpdate: '這篇筆記需要新版的外掛才讀得懂；筆記已自動儲存，更新外掛之前不會加入複習',
  /** 受阻：這台電腦還沒有一份成功的備份（D-150 第 3 點，外掛內備份任務說明 §1-6）；按鈕說明與小視窗也用這一句。 */
  backup: '筆記已自動儲存；備份還沒成功，先不把新目標加入複習，到設定頁看原因',
};
export const MESSAGES: Record<IdIssueKind, (name: string) => string> = {
  lost: name => `〈${name}〉原本的編號不見了（可能在 Obsidian 以外改過這篇筆記）。`,
  changed: name => `〈${name}〉的編號和原本的不一樣。`,
  ambiguous: name => `〈${name}〉那一行有兩個編號。`,
};
/** 離開筆記之後等多久才補（毫秒）。 */
const LEAVE_DELAY = 1000;
/** 存檔後的通知最多列幾個寫法有問題的目標（介面建議，技術債 D1）。 */
const SHOWN = 3;
/** 通知裡的短句，依問題種類（不比對中文訊息）；沒列的用解析時那一句。 */
const SHORT: Partial<Record<Malformed['code'], string>> = { 'typed-answer-invalid': '中翻英的答案只能是英文單字或片語' };
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

/**
 * 受阻的原因對到的說明（技術債「存檔按鈕的受阻原因各自判斷」：按鈕的說明看 state.writeBlock()，按下的結果看 save 回的原因，
 * 兩邊用這一張表、state 用同一個順序）。還沒讀完、有檔案讀不到（D-154）、還沒有成功的備份（D-150）；phone、closed 不提示。
 */
const BLOCKED: Partial<Record<WriteBlock, string>> = { loading: TIPS.blocked, unread: TIPS.blocked, backup: TIPS.backup };
/** 受阻的說明；不是受阻或不提示的原因是 null。 */
const blockedTip = (result: WriteResult): string | null => result.kind === 'blocked' && result.reason !== 'needs-update' ? BLOCKED[result.reason] ?? null : null;

/**
 * done、unchanged 的提示（技術債 D1）：新增的數（寫錯的不算）和寫法有問題的目標合成一次，問題照行號列前 SHOWN 個（行號、名稱、原因），
 * 其餘寫「另有 N 個」。都沒有時不提示。
 */
function doneTip(added: number, malformed: readonly Malformed[]): string | null {
  if (!malformed.length) return added ? TIPS.added(added) : null;
  const head = added ? TIPS.addedMalformed(added, malformed.length) : TIPS.malformed(malformed.length);
  const lines = malformed.slice(0, SHOWN).map(target => TIPS.problem(target.at + 1, target.name, SHORT[target.code] ?? target.reason));
  if (malformed.length > SHOWN) lines.push(TIPS.more(malformed.length - SHOWN));
  return [head, ...lines].join('\n');
}

/**
 * 存檔結果的提示；text 是按下時編輯器裡的文字，malformed 是存檔之後 state 看到的寫法有問題的目標。done、unchanged 照 doneTip；
 * 需要新版的說要更新外掛；受阻、而且有沒 ID 的目標時說清楚新目標這次沒加入。受阻但目標都有 ID、saved 與其他 blocked 不提示。
 */
function saveTip(result: WriteResult, text: string, malformed: readonly Malformed[]): string | null {
  if (result.kind === 'done') return doneTip(result.added, malformed);
  if (result.kind === 'unchanged') return doneTip(0, malformed);
  if (result.kind === 'stale') return TIPS.stale;
  if (result.kind === 'failed') return TIPS.failed;
  if (result.kind === 'blocked' && result.reason === 'needs-update') return TIPS.needsUpdate;
  const blocked = blockedTip(result);
  if (blocked) return parseDeck(text).targets.some(target => !target.id) ? blocked : null;
  return null;
}

const KINDS = ['needs-update', 'done', 'missing', 'issues', 'malformed'] as const;
/**
 * 一篇卡組按鈕的樣子：需要新版、有待處理的問題、有目標寫法有問題（技術債 D1：按下去補 ID 並在通知列出問題，所以排在沒有 ID 前面）、
 * 有目標還沒有 ID、沒有要做的。
 */
function buttonLook(status: { missing: number; issues: IdIssue[]; malformed: Malformed[]; needsUpdate?: true }): { kind: (typeof KINDS)[number]; icon: string; tip: string } {
  if (status.needsUpdate) return { kind: 'needs-update', icon: 'alert-circle', tip: TIPS.needsUpdate };
  if (status.issues.length) return { kind: 'issues', icon: 'alert-triangle', tip: TIPS.issues(status.issues.length) };
  if (status.malformed.length) return { kind: 'malformed', icon: 'alert-triangle', tip: TIPS.malformed(status.malformed.length) };
  if (status.missing) return { kind: 'missing', icon: 'save', tip: TIPS.missing(status.missing) };
  return { kind: 'done', icon: 'check-circle', tip: TIPS.done };
}

/** 外掛的存活（技術債 W2）：卸載後是 false；開著的小視窗記在 modals，卸載時關掉。 */
interface Life { alive: () => boolean; modals: Set<Modal> }

class IssuesModal extends Modal {
  private readonly host: SaveHost;
  private readonly view: MarkdownView;
  private readonly life: Life;
  private stop: (() => void) | null = null;
  /** 按下還原或當成新的、結果還沒回來：重畫時按鈕照樣停用，再按不另外排一份（Codex L2 的 R3）。 */
  private waiting = false;
  constructor(app: App, host: SaveHost, view: MarkdownView, life: Life) {
    super(app);
    this.host = host;
    this.view = view;
    this.life = life;
  }
  onOpen(): void {
    this.life.modals.add(this);
    // 卡組重讀後問題可能變了（內容改過的問題換成新的物件，舊的不能寫回）：跟著重畫，家長看到的就是現在的內容。
    this.stop = this.host.state()?.onChange(() => { this.render(); }) ?? null;
    this.render();
  }
  onClose(): void { this.life.modals.delete(this); this.stop?.(); this.stop = null; this.contentEl.empty(); }
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
    this.contentEl.querySelectorAll('button').forEach(button => { button.disabled = this.waiting; });
  }
  private choose(issue: IdIssue, choice: 'restore' | 'new'): void {
    const state = this.host.state(), path = this.view.file?.path;
    if (!state || !path || this.waiting) return;
    // 結果回來之前兩個按鈕都停用。
    this.waiting = true;
    this.contentEl.querySelectorAll('button').forEach(button => { button.disabled = true; });
    state.resolve(issue, choice, editorOf(this.view, path)).then(result => {
      this.waiting = false;
      // 外掛已經卸載（小視窗也關了）：不提示（技術債 W2）。
      if (!this.life.alive()) return;
      // saved：已寫進磁碟、state 還在核對，和按存檔收到 saved 一樣不提示（環節 5 結論第 1 條的 B6）。
      if (result.kind === 'done' || result.kind === 'saved') { this.render(); return; }
      // 受阻時問題保留，一律說「讀取完成後再按」（不看文字：目標本身有 ID 的問題也一樣），不說「剛剛改過」。寫不進去、需要新版
      // 和存檔用同一份對應（Codex L2 的 R1）；其他沒寫成的都請家長再按一次。
      this.host.notify(blockedTip(result) ?? saveTip(result, this.view.editor.getValue(), []) ?? TIPS.stale);
      this.close();
    }, (error: unknown) => { this.waiting = false; this.host.onError(error); if (this.life.alive()) this.close(); });
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

  /**
   * 技術債 W2：Obsidian 卸載外掛時不會拿掉 addAction 加的按鈕（Windows 1.14.5 用 URI 的 reload 重現：每重新啟用一次，同一個分頁就多一個，
   * 舊的說明停在當時、按了沒反應）。卸載時拿掉按鈕、關掉小視窗、取消還沒到期的補 ID；之後晚回來的存檔、小視窗的結果與 ready() 都不碰畫面。
   */
  let alive = true;
  const life: Life = { alive: () => alive, modals: new Set() };
  /** 離開筆記之後排好、還沒到期的補 ID。 */
  const timers = new Set<number>();
  plugin.register(() => {
    alive = false;
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    for (const modal of [...life.modals]) modal.close();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  });

  /**
   * 按鈕說明的受阻原因（D-154、D-150）：依 state 目前所知（writeBlock）。已經在等 ready() 的 state 讀完時更新按鈕；
   * unread() 變空時可能沒有 onChange（討論稿 P4），備份的閘門由外掛更新按鈕，說明可能晚到下一次更新；按下去那一刻以 state.save 的結果為準。
   */
  const watched = new WeakSet<State>();
  function blockTip(state: State): string | null {
    if (!watched.has(state)) {
      watched.add(state);
      // ready() 拒絕已經經過 onError 記下（tasks/error-log.md §2-3），或是停用外掛；按鈕維持受阻。
      state.ready().then(refresh, () => {});
    }
    const reason = state.writeBlock();
    return reason ? BLOCKED[reason] ?? null : null;
  }

  /** 存檔還沒結束的卡組：再按不另外排一份。 */
  const saving = new Map<string, Promise<void>>();
  function save(view: MarkdownView): Promise<void> {
    const state = host.state(), path = view.file?.path;
    if (!state || !path || !isDeckPath(path)) return Promise.resolve();
    const running = saving.get(path);
    if (running) return running;
    const text = view.editor.getValue();
    const job = state.save(editorOf(view, path)).then(result => {
      // 卸載之後才回來：不提示、不加回按鈕、不開小視窗（技術債 W2）。
      if (!alive) return;
      const tip = saveTip(result, text, state.deckStatus(path).malformed);
      if (tip) host.notify(tip);
      refresh();
      if (state.deckStatus(path).issues.length) new IssuesModal(app, host, view, life).open();
    }).catch(host.onError).finally(() => {
      saving.delete(path);
      // 開發命令 save 點按鈕之後等這一筆，確定是這次點擊觸發的存檔結束了（技術債 N1）。
      host.log?.('存檔結束 ' + path);
    });
    saving.set(path, job);
    return job;
  }

  function refresh(): void {
    // 卸載之後（例如晚完成的 ready()）不再加回按鈕（技術債 W2）。
    if (!alive) return;
    const state = host.state();
    const seen = new Set<MarkdownView>();
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const path = view.file?.path;
      if (!state || !path || !isDeckPath(path)) continue;
      seen.add(view);
      const look = buttonLook(state.deckStatus(path));
      // 受阻期間外觀照舊，說明一律用同一句（不說「學習目標都已加入複習」）；需要新版的照它的說明。按下時 state 的門檻先看讀不到，
      // 所以這種卡組按下去先說受阻、讀完再按才說需要新版（B7，照實記下、這次不統一）。
      const blocked = blockTip(state);
      const tip = blocked && look.kind !== 'needs-update' ? blocked : look.tip;
      let button = buttons.get(view);
      if (!button) {
        button = view.addAction(look.icon, tip, () => { void save(view); });
        button.addClass('essence-cards-save');
        buttons.set(view, button);
      }
      setIcon(button, look.icon);
      button.setAttribute('aria-label', tip);
      for (const kind of KINDS) button.toggleClass('is-' + kind, kind === look.kind);
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
      // 等編輯器把最後打的字存進檔案，再讀檔補；這段時間又打開了就不補。卸載時取消（技術債 W2）。
      host.log?.('離開 ' + path);
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (openPaths().has(path)) { host.log?.('又打開了，不補 ' + path); return; }
        host.state()?.fillIds(path).then(changed => {
          // 補完之後 state 怎麼看這一篇（開發命令查備援的時序用）。
          host.log?.('補 ' + path + ' → ' + String(changed) + '；' + JSON.stringify(host.state()?.deckStatus(path)));
        }, host.onError);
      }, LEAVE_DELAY);
      timers.add(timer);
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
