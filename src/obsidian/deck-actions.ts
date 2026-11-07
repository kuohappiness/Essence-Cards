import { MarkdownView, Modal } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import { check } from '../core/ai/index.ts';
import { codeKey, isDeckPath, parseDeck, termKey } from '../core/deck/index.ts';
import { createPreview } from '../review/index.ts';
import type { Session } from '../review/index.ts';
import type { State, StudyPick } from '../state/index.ts';
import { noRemind, previewButton, previewReveal } from '../ui/prefs.ts';

// 卡組筆記標題列的「全部卡」（D-146）與「預覽」（D-161、D-163 第 3 點）：按鈕與同名命令，電腦與 iPhone 都有；
// 和存檔按鈕同一套掛法與卸載（save.ts，技術債 W2：Obsidian 卸載外掛時不會拿掉 addAction 加的按鈕）。

const FULL = '全部卡';
const PREVIEW = '預覽';
const ACTIVATE = '啟用';
const NO_PREVIEW = '這篇沒有可以預覽的題目';

export interface DeckActionsHost {
  plugin: Plugin;
  state: () => State | null;
  /** 開始一次複習；做完或 ✕ 回到這篇筆記，焦點還原。 */
  start: (pick: StudyPick) => void;
  /** 打開預覽；結束時回筆記。 */
  preview: (session: Session) => void;
  notify: (message: string) => void;
  /** 草稿的「啟用」（tasks/ai-cards-mvp.md §7）：只在電腦傳；回傳要提示的字，沒事是 null。 */
  activate?: (path: string) => Promise<string | null>;
}

/** 全部卡按下去先出的提醒（D-146 的原文）：12 是這一輪的目標數；只記這台裝置。目錄的全部卡不提醒。 */
class RemindModal extends Modal {
  private readonly count: number;
  private readonly modals: Set<Modal>;
  /** 按了開始練習；off 是有沒有勾「以後不再提醒」。 */
  private readonly begin: (off: boolean) => void;
  constructor(app: App, count: number, modals: Set<Modal>, begin: (off: boolean) => void) {
    super(app);
    this.count = count;
    this.modals = modals;
    this.begin = begin;
  }
  onOpen(): void {
    this.modals.add(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: `將開始完整練習本篇的 ${String(this.count)} 個學習目標。` });
    contentEl.createEl('p', { text: '但同時，複習排程也會受作答紀錄的影響。' });
    contentEl.createEl('p', { text: '如果您是家長，建議從筆記中看所有題目。' });
    const label = contentEl.createEl('label', { cls: 'essence-cards-remind-off' });
    const box = label.createEl('input', { type: 'checkbox' });
    label.createEl('span', { text: '以後不再提醒' });
    const buttons = contentEl.createDiv({ cls: 'essence-cards-issue-buttons' });
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => { this.close(); });
    buttons.createEl('button', { text: '開始練習', cls: 'mod-cta' }).addEventListener('click', () => {
      const off = box.checked;
      this.close();
      this.begin(off);
    });
  }
  onClose(): void { this.modals.delete(this); this.contentEl.empty(); }
}

/** 按「啟用」先問（§7）：這一篇會開始複習幾個目標；寫法有問題的、引言框裡的不出題；同一課還有哪幾篇草稿。沒有的那一句不寫。 */
function activationText(state: State, path: string, text: string): string[] {
  const entry = state.decks().find(each => each.path === path);
  const deck = parseDeck(text);
  const malformed = state.deckStatus(path).malformed.length;
  const ready = deck.targets.length - malformed;
  const boxes = check(text);
  const more = [
    ...malformed ? [`${String(malformed)} 個學習目標寫法有問題，會先跳過`] : [],
    ...boxes.candidates.length || boxes.existing.length ? [[
      ...boxes.candidates.length ? [`候選卡片 ${String(boxes.candidates.length)} 個`] : [],
      ...boxes.existing.length ? [`加進已有的學習目標 ${String(boxes.existing.length)} 項`] : [],
    ].join('、') + '還在引言框裡，不會出題'] : [],
  ];
  const props = entry?.deck.props ?? deck.props;
  const siblings = props.term === null || props.subject === null || props.unit === null ? [] : state.decks().filter(each => each.path !== path && each.deck.props.status === 'draft'
    && each.deck.props.subject === props.subject && each.deck.props.term !== null && termKey(each.deck.props.term) === termKey(props.term!) && each.deck.props.unit !== null && codeKey(each.deck.props.unit.code) === codeKey(props.unit!.code));
  return [
    `啟用後，孩子就會開始複習這一篇的 ${String(ready)} 個學習目標。`,
    ...more.length ? [`還有：${more.join('；')}。`] : [],
    ...siblings.length ? [`同一課還有 ${String(siblings.length)} 篇草稿：${siblings.map(each => each.path.slice(each.path.lastIndexOf('/') + 1, -3)).join('、')}。`] : [],
  ];
}

class ActivateModal extends Modal {
  private readonly lines: string[];
  private readonly modals: Set<Modal>;
  private readonly confirm: () => void;
  constructor(app: App, lines: string[], modals: Set<Modal>, confirm: () => void) {
    super(app);
    this.lines = lines;
    this.modals = modals;
    this.confirm = confirm;
  }
  onOpen(): void {
    this.modals.add(this);
    const { contentEl } = this;
    contentEl.empty();
    for (const line of this.lines) contentEl.createEl('p', { text: line });
    const buttons = contentEl.createDiv({ cls: 'essence-cards-issue-buttons' });
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => { this.close(); });
    buttons.createEl('button', { text: ACTIVATE, cls: 'mod-cta' }).addEventListener('click', () => { this.close(); this.confirm(); });
  }
  onClose(): void { this.modals.delete(this); this.contentEl.empty(); }
}

export function wireDeckActions(host: DeckActionsHost): { refresh: () => void } {
  const { plugin } = host;
  const { app } = plugin;
  const full = new Map<MarkdownView, HTMLElement>();
  const previews = new Map<MarkdownView, HTMLElement>();
  const activates = new Map<MarkdownView, HTMLElement>();
  /** 開著的提醒：停用外掛時關掉（任務說明 §1：停用之後什麼都不寫）。 */
  const modals = new Set<Modal>();
  let alive = true;
  plugin.register(() => {
    alive = false;
    for (const modal of [...modals]) modal.close();
    for (const buttons of [full, previews, activates]) {
      for (const button of buttons.values()) button.remove();
      buttons.clear();
    }
  });

  /** 全部卡的目標：只有啟用的卡組、可出的目標；草稿、暫停、轉錄稿、一般筆記是空的（§6）。 */
  const targetsOf = (path: string): readonly string[] => alive ? host.state()?.deckTargets(path) ?? [] : [];
  /** 預覽：開關打開，而且是讀得懂的卡組；草稿、暫停也可以（§7）。需要新版的不在 state.decks() 裡，不能照舊的讀法顯示。 */
  function canPreview(path: string): boolean {
    if (!alive || !previewButton.get(app)) return false;
    const entry = host.state()?.decks().find(each => each.path === path);
    return !!entry && !entry.deck.props.isTranscript;
  }

  /** 啟用：只有電腦、讀得懂的草稿（§7）。 */
  function canActivate(path: string): boolean {
    if (!alive || !host.activate) return false;
    const entry = host.state()?.decks().find(each => each.path === path);
    return entry?.deck.props.status === 'draft' && !entry.deck.props.isTranscript;
  }
  /** 先問，按「啟用」才改這一篇的狀態；提示照目錄的暫停／恢復。內容讀編輯器目前的文字。 */
  function askActivate(view: MarkdownView, path: string): void {
    const state = host.state();
    if (!alive || !state || !host.activate) return;
    const activate = host.activate;
    new ActivateModal(app, activationText(state, path, view.editor.getValue()), modals, () => {
      if (!alive) return;
      void activate(path).then(tip => { host.notify(tip ?? '已啟用，孩子之後就看得到這一篇'); });
    }).open();
  }

  function startFull(path: string): void {
    const count = targetsOf(path).length;
    if (!count) return;
    // 一輪從按下去的時間算（D-163 第 4 點）：提醒開著時，從按「開始練習」算。
    const begin = (): void => { host.start({ deck: path, since: Date.now() }); };
    if (noRemind.get(app)) { begin(); return; }
    new RemindModal(app, count, modals, off => {
      // 提醒開著時停用了外掛：什麼都不做（任務說明 §1）。
      if (!alive) return;
      if (off) noRemind.set(app, true);
      begin();
    }).open();
  }
  /** 內容讀編輯器目前的文字：看到的就是畫面上寫的（§7）。 */
  function openPreview(view: MarkdownView, path: string): void {
    if (!alive) return;
    const session = createPreview({ path, deck: parseDeck(view.editor.getValue()), reveal: previewReveal.get(app) });
    if (session) host.preview(session);
    else host.notify(NO_PREVIEW);
  }

  /** 按鈕該有就加、不該有就拿掉；這顆按鈕是哪一篇的，按下去時才看。 */
  function sync(view: MarkdownView, buttons: Map<MarkdownView, HTMLElement>, wanted: boolean, icon: string, title: string, cls: string, click: () => void): void {
    const button = buttons.get(view);
    if (wanted && !button) {
      const added = view.addAction(icon, title, click);
      added.addClass(cls);
      buttons.set(view, added);
    } else if (!wanted && button) {
      button.remove();
      buttons.delete(view);
    }
  }
  function refresh(): void {
    if (!alive) return;
    const seen = new Set<MarkdownView>();
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const path = view.file?.path;
      if (!path || !isDeckPath(path)) continue;
      seen.add(view);
      const click = (act: (path: string) => void) => (): void => { const now = view.file?.path; if (now) act(now); };
      sync(view, full, targetsOf(path).length > 0, 'play', FULL, 'essence-cards-full', click(startFull));
      sync(view, previews, canPreview(path), 'eye', PREVIEW, 'essence-cards-preview', click(each => { openPreview(view, each); }));
      sync(view, activates, canActivate(path), 'check-circle', ACTIVATE, 'essence-cards-activate', click(each => { askActivate(view, each); }));
    }
    // 換成別的筆記、或分頁關掉了：拿掉按鈕。
    for (const buttons of [full, previews, activates]) for (const [view, button] of buttons) if (!seen.has(view)) { button.remove(); buttons.delete(view); }
  }

  /** 使用中的那一篇；不是卡組是 null。 */
  const active = (): { view: MarkdownView; path: string } | null => {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path;
    return view && path && isDeckPath(path) ? { view, path } : null;
  };
  plugin.addCommand({
    id: 'full-deck',
    name: FULL,
    checkCallback: checking => {
      const now = active();
      if (!now || !targetsOf(now.path).length) return false;
      if (!checking) startFull(now.path);
      return true;
    },
  });
  plugin.addCommand({
    id: 'preview',
    name: PREVIEW,
    checkCallback: checking => {
      const now = active();
      if (!now || !canPreview(now.path)) return false;
      if (!checking) openPreview(now.view, now.path);
      return true;
    },
  });
  if (host.activate) plugin.addCommand({
    id: 'activate-draft',
    name: '啟用這一篇',
    checkCallback: checking => {
      const now = active();
      if (!now || !canActivate(now.path)) return false;
      if (!checking) askActivate(now.view, now.path);
      return true;
    },
  });
  plugin.registerEvent(app.workspace.on('layout-change', refresh));
  plugin.registerEvent(app.workspace.on('active-leaf-change', refresh));
  return { refresh };
}
