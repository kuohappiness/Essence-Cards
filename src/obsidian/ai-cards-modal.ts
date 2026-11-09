import { Modal } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import { freeName, groupHints, issueText, PURPOSES } from '../core/ai/index.ts';
import type { CardForm, CardJob, Inspection, Purpose } from '../core/ai/index.ts';
import { SERVICES } from './ai-cards.ts';
import type { AiCards, Outcome } from './ai-cards.ts';

// AI 製卡的視窗（tasks/ai-cards-mvp.md §2）：電腦才有（D-039：手機上不製卡），入口與目錄不放（D-100）。
// 用 Obsidian 的視窗、和存檔按鈕的小視窗同一種做法：家長要在瀏覽器與 Obsidian 之間來回，視窗不蓋住整個工作區。

const TEXT = {
  title: 'AI 製卡',
  resumeSave: (label: string) => `繼續存上一次的結果（${label}，存到一半）`,
  resumePaste: (label: string, ago: string) => `接著貼回上一次的結果（${label}，${ago}複製）`,
  newLesson: '做新的一課',
  next: '下一步：到 ChatGPT、Gemini 或 Claude 開一個新對話，附上課本頁面的照片或 PDF，貼上提示送出；AI 回完後，按回覆裡程式碼區塊右上角的「複製」，貼在下面。',
  copied: (chars: number) => `已複製提示，共 ${chars.toLocaleString('en-US')} 字。`,
  paste: '把 AI 的整段回覆貼在這裡',
  confirmEnd: '我確定整段都貼了',
  blocked: '擋住了，改好再檢查（可以直接在上面改字）：',
  hints: '提示（可以存）：',
  saving: '正在存成草稿…',
  broken: (n: number) => `有 ${String(n)} 份之前複製的提示讀不懂，已經拿掉；要用的話請重新複製一次。`,
};

/** 給家長看的「多久以前」。 */
function ago(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${String(minutes)} 分鐘前`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${String(hours)} 小時前` : `${String(Math.round(hours / 24))} 天前`;
}
const labelOf = (job: CardJob): string => `${job.subject.subject === null ? '' : job.form.term}${job.subject.subject ?? job.subject.label} ${job.form.unit}`.trim();

export interface AiCardsModalHost {
  cards: () => AiCards | null;
  /** 打開那篇筆記（新分頁）。 */
  openNote: (path: string) => void;
  notify: (message: string) => void;
  now: () => number;
}

/** 貼到一半的回覆：關掉視窗也留著，下次接著貼回（只在這次開著 Obsidian 的期間）。 */
const pasted = new Map<string, string>();

class AiCardsModal extends Modal {
  private readonly host: AiCardsModalHost;
  private readonly modals: Set<Modal>;
  private job: CardJob | null = null;
  private form: CardForm | null = null;
  private inspection: Inspection | null = null;
  private confirmed = false;
  private service: string | null = null;
  private busy = false;
  constructor(app: App, host: AiCardsModalHost, modals: Set<Modal>) {
    super(app);
    this.host = host;
    this.modals = modals;
  }
  onOpen(): void {
    this.modals.add(this);
    this.modalEl.addClass('essence-cards-ai-modal');
    this.titleEl.setText(TEXT.title);
    this.start();
  }
  onClose(): void { this.modals.delete(this); this.contentEl.empty(); }

  /** 重開命令時有沒完成的工作就先問（§2、§5）。 */
  private start(): void {
    const cards = this.host.cards();
    if (!cards) { this.close(); return; }
    const jobs = cards.jobs();
    if (!jobs.length && !cards.broken) { this.showForm(); return; }
    const el = this.reset();
    if (cards.broken) el.createEl('p', { text: TEXT.broken(cards.broken), cls: 'essence-cards-issue-note' });
    for (const job of jobs) {
      const row = el.createDiv({ cls: 'essence-cards-issue' });
      if (job.save) {
        row.createEl('p', { text: TEXT.resumeSave(labelOf(job)) });
        const buttons = row.createDiv({ cls: 'essence-cards-issue-buttons' });
        buttons.createEl('button', { text: '繼續', cls: 'mod-cta' }).addEventListener('click', () => { this.job = job; void this.finish(cards.resume(job)); });
        buttons.createEl('button', { text: '放棄' }).addEventListener('click', () => { this.job = job; void this.abandon(); });
      } else {
        row.createEl('p', { text: TEXT.resumePaste(labelOf(job), ago(job.copiedMs, this.host.now())) });
        row.createDiv({ cls: 'essence-cards-issue-buttons' }).createEl('button', { text: '接著貼回', cls: 'mod-cta' }).addEventListener('click', () => { this.job = job; this.showPaste(null); });
      }
    }
    el.createDiv({ cls: 'essence-cards-issue-buttons' }).createEl('button', { text: TEXT.newLesson }).addEventListener('click', () => { this.showForm(); });
  }
  private reset(): HTMLElement {
    this.contentEl.empty();
    this.contentEl.addClass('essence-cards-ai');
    return this.contentEl;
  }

  /** 第一步：填單元（§2 的表）。 */
  private showForm(): void {
    const cards = this.host.cards();
    if (!cards) { this.close(); return; }
    const last = cards.last();
    const first = cards.subjects.find(each => each.key === last.subject) ?? cards.subjects[0];
    const form: CardForm = this.form ?? { subject: first.key, term: last.term ?? cards.terms(first.key)[0], unit: '', purpose: '準備段考', supplement: first.supplement, adjust: '', material: '' };
    this.form = form;
    const el = this.reset();
    const grid = el.createDiv({ cls: 'essence-cards-ai-form' });
    const field = (label: string): HTMLElement => { grid.createEl('label', { text: label }); return grid.createDiv(); };
    const subject = field('科目').createEl('select', { cls: 'dropdown' });
    for (const each of cards.subjects) subject.createEl('option', { text: each.label, value: each.key });
    subject.value = form.subject;
    const term = field('年級學期').createEl('select', { cls: 'dropdown' });
    const fillTerms = (): void => {
      term.empty();
      for (const each of cards.terms(form.subject)) term.createEl('option', { text: each, value: each });
      term.value = form.term;
    };
    fillTerms();
    const unit = field('單元').createEl('input', { type: 'text', placeholder: form.subject === 'general' ? '例如「睡眠講座」' : '「編號 名稱」，例如「2-2 水溶液」' });
    unit.value = form.unit;
    const purpose = field('學習目的').createEl('select', { cls: 'dropdown' });
    for (const each of PURPOSES) purpose.createEl('option', { text: each, value: each });
    purpose.value = form.purpose;
    const supplement = field('允許 AI 補充').createEl('input', { type: 'checkbox' });
    supplement.checked = form.supplement;
    const adjust = field('這次的調整').createEl('input', { type: 'text', placeholder: '選填，例如「這次最多 8 個目標」' });
    adjust.value = form.adjust;
    const material = field('教材').createEl('input', { type: 'text', placeholder: '選填，例如「課本 p.40～51 的照片」' });
    material.value = form.material;
    const rules = el.createEl('p', { cls: 'essence-cards-issue-note' });
    const same = el.createEl('p');
    const existing = el.createEl('p', { cls: 'essence-cards-issue-note' });
    const message = el.createEl('p', { cls: 'essence-cards-issue-note' });
    const buttons = el.createDiv({ cls: 'essence-cards-issue-buttons' });
    const copy = buttons.createEl('button', { text: '複製提示', cls: 'mod-cta' });
    const refresh = (): void => {
      rules.setText('規則：' + cards.rulesLine(form.subject));
      const found = cards.sameUnit(form);
      same.setText(found.length ? `已經有：${found.map(each => `${each.name}（${each.status}）`).join('、')}。還是要做一份新的嗎？舊的不會動。` : '');
      const count = cards.existing(form);
      existing.setText(count === null ? '正在讀取卡組…' : count ? `會一起送出 ${String(count)} 個已有的學習目標` : '已有的學習目標：無');
      copy.disabled = this.busy || !form.unit.trim();
    };
    subject.addEventListener('change', () => {
      form.subject = subject.value;
      form.supplement = cards.subjects.find(each => each.key === form.subject)?.supplement ?? false;
      supplement.checked = form.supplement;
      fillTerms();
      refresh();
    });
    term.addEventListener('change', () => { form.term = term.value; refresh(); });
    unit.addEventListener('input', () => { form.unit = unit.value; refresh(); });
    purpose.addEventListener('change', () => { form.purpose = purpose.value as Purpose; });
    supplement.addEventListener('change', () => { form.supplement = supplement.checked; });
    adjust.addEventListener('input', () => { form.adjust = adjust.value; });
    material.addEventListener('input', () => { form.material = material.value; });
    copy.addEventListener('click', () => {
      this.busy = true;
      refresh();
      void cards.copy({ ...form, unit: form.unit.trim() }).then(result => {
        this.busy = false;
        if ('error' in result) { message.setText(result.error); refresh(); return; }
        this.job = result.job;
        this.form = null;
        this.showPaste(result.chars);
      });
    });
    refresh();
    unit.focus();
  }

  /** 第二、三步：已複製的說明、貼回、檢查、存成草稿（§2、§4）。chars 是剛複製的字數；接著貼回時是 null。 */
  private showPaste(chars: number | null): void {
    const cards = this.host.cards(), job = this.job;
    if (!cards || !job) { this.close(); return; }
    const el = this.reset();
    el.createEl('p', { text: (chars === null ? `${labelOf(job)}：` : TEXT.copied(chars)) + TEXT.next });
    const again = el.createDiv({ cls: 'essence-cards-issue-buttons' }).createEl('button', { text: chars === null ? '再複製一次提示' : '再複製一次' });
    again.addEventListener('click', () => { void cards.recopy(job).then(ok => { this.host.notify(ok ? '已複製提示' : '放不進剪貼簿；請再按一次'); }); });
    const box = el.createEl('textarea', { cls: 'essence-cards-ai-paste', attr: { placeholder: TEXT.paste, rows: '12' } });
    box.value = pasted.get(job.id) ?? '';
    const service = el.createDiv({ cls: 'essence-cards-ai-form' });
    service.createEl('label', { text: '用的是（選填）' });
    const pick = service.createDiv().createEl('select', { cls: 'dropdown' });
    pick.createEl('option', { text: '不選', value: '' });
    for (const each of SERVICES) pick.createEl('option', { text: each, value: each });
    pick.value = this.service ?? '';
    pick.addEventListener('change', () => { this.service = pick.value || null; });
    const result = el.createDiv();
    const buttons = el.createDiv({ cls: 'essence-cards-issue-buttons' });
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => { this.close(); });
    const checkButton = buttons.createEl('button', { text: '檢查' });
    const saveButton = buttons.createEl('button', { text: '存成草稿', cls: 'mod-cta' });
    const update = (): void => {
      const ready = !!this.inspection && !this.inspection.errors.length && (this.inspection.ended || this.confirmed);
      saveButton.toggle(!!this.inspection && !this.inspection.errors.length);
      saveButton.disabled = this.busy || !ready;
      checkButton.disabled = this.busy || !box.value.trim();
    };
    box.addEventListener('input', () => { pasted.set(job.id, box.value); this.inspection = null; this.confirmed = false; result.empty(); update(); });
    checkButton.addEventListener('click', () => {
      const inspection = cards.inspect(job, box.value);
      if ('error' in inspection) { result.setText(inspection.error); return; }
      this.inspection = inspection;
      this.confirmed = false;
      this.showResult(result, inspection, update);
      update();
    });
    saveButton.addEventListener('click', () => {
      this.busy = true;
      update();
      void this.finish(cards.save(job, box.value, this.service));
    });
    update();
  }

  /** 檢查的結果（§4 最後一點）：可以存時每一篇一列，底下列出提示；有擋住的只有原因與行號。 */
  private showResult(el: HTMLElement, inspection: Inspection, update: () => void): void {
    el.empty();
    if (inspection.errors.length) {
      el.createEl('p', { text: TEXT.blocked });
      const list = el.createEl('ul');
      for (const each of inspection.errors) list.createEl('li', { text: issueText(each) });
      return;
    }
    const taken = new Set(this.app.vault.getMarkdownFiles().map(file => file.basename.toLowerCase()));
    const list = el.createEl('ul');
    for (const piece of inspection.pieces) {
      const name = freeName(piece.name, taken);
      const renamed = name === piece.name ? '' : `（已有同名的卡組，這一篇存成「${name}」）`;
      list.createEl('li', { text: `${name}${renamed}：學習目標 ${String(piece.targets)}、題目 ${String(piece.prompts)}、候選卡片 ${String(piece.candidates)}、加進已有的學習目標 ${String(piece.adds.length)}` });
    }
    if (inspection.hints.length) {
      el.createEl('p', { text: TEXT.hints, cls: 'essence-cards-issue-note' });
      const hints = el.createEl('ul', { cls: 'essence-cards-issue-note' });
      for (const group of groupHints(inspection.hints)) {
        const item = hints.createEl('li', { text: group.text });
        if (group.lines.length) { const lines = item.createEl('ul'); for (const line of group.lines) lines.createEl('li', { text: line }); }
      }
    }
    if (!inspection.ended) {
      const label = el.createEl('label', { cls: 'essence-cards-remind-off' });
      const box = label.createEl('input', { type: 'checkbox' });
      label.createEl('span', { text: TEXT.confirmEnd });
      box.addEventListener('change', () => { this.confirmed = box.checked; update(); });
    }
  }

  /** 存成草稿或繼續之後（§5、§7）：成功就打開第一篇、通知；停下來寫原因與能選的。 */
  private async finish(work: Promise<Outcome>): Promise<void> {
    const el = this.reset();
    el.createEl('p', { text: TEXT.saving });
    const outcome = await work;
    this.busy = false;
    const job = this.job;
    if (outcome.kind === 'done') {
      if (job) pasted.delete(job.id);
      this.close();
      if (outcome.decks[0]) this.host.openNote(outcome.decks[0]);
      this.host.notify(`已存成草稿：${String(outcome.decks.length)} 篇、${String(outcome.targets)} 個學習目標。看過、改好後按「啟用」，孩子才看得到`);
      return;
    }
    const cards = this.host.cards();
    if (!cards || !job) { this.close(); return; }
    const box = this.reset();
    box.createEl('p', { text: outcome.message });
    const buttons = box.createDiv({ cls: 'essence-cards-issue-buttons' });
    const latest = cards.jobs().find(each => each.id === job.id);
    if (outcome.deck) {
      const { index, situation } = outcome.deck;
      buttons.createEl('button', { text: '跳過這一篇' }).addEventListener('click', () => { void this.finish(cards.choose(job, index, 'skip')); });
      if (situation === 'missing') buttons.createEl('button', { text: '重建這一篇' }).addEventListener('click', () => { void this.finish(cards.choose(job, index, 'rebuild')); });
    } else if (latest?.save) {
      buttons.createEl('button', { text: '繼續', cls: 'mod-cta' }).addEventListener('click', () => { void this.finish(cards.resume(job)); });
    } else if (latest) {
      buttons.createEl('button', { text: '回上一步', cls: 'mod-cta' }).addEventListener('click', () => { this.showPaste(null); });
    }
    if (latest?.save) buttons.createEl('button', { text: '放棄' }).addEventListener('click', () => { void this.abandon(); });
    buttons.createEl('button', { text: '關閉' }).addEventListener('click', () => { this.close(); });
  }

  /** 放棄（§5）：已寫成的卡組照樣是草稿、不刪；通知寫出留下了哪幾篇。 */
  private async abandon(): Promise<void> {
    const cards = this.host.cards(), job = this.job;
    if (!cards || !job) return;
    const result = await cards.abandon(job);
    if ('kind' in result) { await this.finish(Promise.resolve(result)); return; }
    pasted.delete(job.id);
    this.close();
    const names = result.left.map(path => path.slice(path.lastIndexOf('/') + 1, -3));
    this.host.notify(names.length ? `已放棄這次的製卡，沒有快照。留下的草稿：${names.join('、')}` : '已放棄這次的製卡，沒有留下任何卡組');
  }
}

/** 命令「AI 製卡」與左側功能列的圖示（§2）：只在電腦註冊。停用外掛時關掉開著的視窗。 */
export function wireAiCards(plugin: Plugin, host: AiCardsModalHost): void {
  const modals = new Set<Modal>();
  plugin.register(() => { for (const modal of [...modals]) modal.close(); });
  const open = (): void => { if (host.cards()) new AiCardsModal(plugin.app, host, modals).open(); };
  plugin.addRibbonIcon('sparkles', 'Essence Cards：AI 製卡', open);
  plugin.addCommand({ id: 'ai-cards', name: TEXT.title, callback: open });
}
