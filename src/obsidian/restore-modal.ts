import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { ESSENCE_ROOT, PLUGIN_DATA, tickable } from '../core/backup/index.ts';
import type { PlannedFile, RestoreResult } from '../core/backup/index.ts';
import { LOG_FOLDER } from '../core/study/index.ts';
import type { BackupRow, Comparison, RestoreFlow } from './restore.ts';

// 還原的視窗（tasks/plugin-restore.md §1）：選備份、看差異勾選、結果，同一個 Modal 換內容。

const BY: Record<string, string> = { 'new-version': '新版第一次', monthly: '每月', manual: '手動', restore: '還原前', 'update-vault': '更新前', backup: '手動工具' };
const OUTCOME_ORDER = ['失敗', '擋住', '跳過', '已還原'];
const short = (path: string): string => path.startsWith(ESSENCE_ROOT + '/') ? path.slice(ESSENCE_ROOT.length + 1) : path;
const isLogSide = (file: PlannedFile): boolean => file.path.startsWith(LOG_FOLDER + '/');

/** 增減行數；不是文字回 null。 */
function counts(diff: readonly string[] | null): string | null {
  if (!diff) return null;
  const add = diff.filter(line => line.startsWith('+')).length, cut = diff.filter(line => line.startsWith('-')).length;
  return `+${String(add)} −${String(cut)}`;
}

export class RestoreModal extends Modal {
  private readonly flow: RestoreFlow;
  private comparison: Comparison | null = null;
  private chosen = new Set<string>();
  private working = false;

  constructor(app: App, flow: RestoreFlow) {
    super(app);
    this.flow = flow;
  }

  onOpen(): void {
    this.modalEl.addClass('essence-cards-restore');
    this.titleEl.setText('還原');
    void this.pick();
  }

  onClose(): void { this.contentEl.empty(); }

  private fail(error: unknown): void {
    this.contentEl.empty();
    this.contentEl.createDiv({ cls: 'essence-cards-backup-problem', text: error instanceof Error ? error.message : String(error) });
  }

  /** 第一步：選一份備份。 */
  private async pick(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createDiv({ text: '讀取備份…' });
    let list;
    try { list = await this.flow.list(); } catch (error) { this.fail(error); return; }
    contentEl.empty();
    if (!list.rows.length) contentEl.createDiv({ text: '備份資料夾裡沒有可以用的備份' });
    const body = contentEl.createDiv({ cls: 'essence-cards-restore-list' });
    for (const row of list.rows) {
      const line = body.createEl('button', { cls: 'essence-cards-restore-row' });
      const { manifest } = row.stored;
      line.createSpan({ text: manifest.started.slice(0, 16).replace('T', ' ') });
      line.createSpan({ text: BY[manifest.by] ?? manifest.by, cls: 'setting-item-description' });
      line.createSpan({ text: manifest.build ?? '', cls: 'setting-item-description' });
      if (row.foreign !== null) line.createSpan({ text: '別的 vault：' + row.foreign, cls: 'essence-cards-backup-problem' });
      line.addEventListener('click', () => { void this.compare(row); });
    }
    if (list.unreadable) contentEl.createDiv({ cls: 'setting-item-description', text: `有 ${String(list.unreadable)} 份讀不懂，沒有列出` });
  }

  /** 第二步：比對。 */
  private async compare(row: BackupRow): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createDiv({ text: '比對中…' });
    this.chosen = new Set();
    try { this.comparison = await this.flow.compare(row); } catch (error) { this.fail(error); return; }
    this.drawDiff();
  }

  private drawDiff(): void {
    const comparison = this.comparison!;
    const { contentEl } = this;
    contentEl.empty();
    const base = comparison.plan(new Set());
    const plan = comparison.plan(this.chosen);
    const current = new Map(plan.files.map(file => [file.path, file]));
    // 可以勾的：不看勾選就擋住的不算；紀錄裡的不用勾。data.json 排在最前。
    const rows = base.files.filter(file => tickable(file) && file.action !== 'blocked').sort((a, b) => Number(comparison.settings(b) !== null) - Number(comparison.settings(a) !== null));
    const fixed = base.files.filter(file => file.action === 'blocked' && !(isLogSide(file) && file.kind === 'changed'));
    const conflicts = base.files.filter(file => file.action === 'blocked' && isLogSide(file) && file.kind === 'changed');
    const added = base.files.filter(file => file.kind === 'added');
    const auto = base.files.filter(file => file.action === 'restore' && isLogSide(file));
    const lines = plan.logs.reduce((sum, log) => sum + log.lines.length, 0);

    if (rows.length) {
      const all = contentEl.createDiv({ cls: 'essence-cards-restore-tools' });
      const button = all.createEl('button', { text: this.chosen.size === rows.length ? '全部取消' : '全選' });
      button.addEventListener('click', () => {
        this.chosen = this.chosen.size === rows.length ? new Set() : new Set(rows.map(file => file.path));
        this.drawDiff();
      });
    }
    const list = contentEl.createDiv({ cls: 'essence-cards-restore-list' });
    for (const file of rows) this.drawRow(list, comparison, file, current.get(file.path));
    if (!rows.length) list.createDiv({ text: '沒有可以勾選的差異' });
    for (const file of fixed) {
      const line = list.createDiv({ cls: 'essence-cards-restore-blocked' });
      line.createDiv({ text: file.target === null ? file.path : short(file.path) });
      line.createDiv({ cls: 'essence-cards-backup-problem', text: file.reasons.join('；') });
    }
    if (lines || auto.length) contentEl.createDiv({ cls: 'setting-item-description', text: `複習紀錄會補回 ${String(lines)} 行；AI 輸出與考試切面補回 ${String(auto.length)} 個不見的檔（不用勾選，只補不刪）` });
    if (conflicts.length) contentEl.createDiv({ cls: 'setting-item-description', text: `有 ${String(conflicts.length)} 個紀錄裡的檔同名但內容不同，不動：${conflicts.map(file => short(file.path)).join('、')}` });
    if (added.length) {
      const fold = contentEl.createEl('details', { cls: 'setting-item-description' });
      fold.createEl('summary', { text: `有 ${String(added.length)} 篇是備份之後才有的，不會動` });
      for (const file of added) fold.createDiv({ text: short(file.path) });
    }
    const count = plan.files.filter(file => this.chosen.has(file.path) && file.action === 'restore').length;
    const footer = contentEl.createDiv({ cls: 'essence-cards-restore-footer' });
    footer.createDiv({ cls: 'setting-item-description', text: '還原前會先備份現況' });
    const start = footer.createEl('button', { cls: 'mod-cta', text: `還原 ${String(count)} 篇` });
    start.disabled = count === 0 && !lines && !auto.length;
    start.addEventListener('click', () => { void this.start(); });
  }

  private drawRow(parent: HTMLElement, comparison: Comparison, file: PlannedFile, now: PlannedFile | undefined): void {
    const row = parent.createDiv({ cls: 'essence-cards-restore-item' });
    const head = row.createEl('label', { cls: 'essence-cards-restore-head' });
    const box = head.createEl('input', { type: 'checkbox' });
    box.checked = this.chosen.has(file.path);
    box.addEventListener('change', () => {
      if (box.checked) this.chosen.add(file.path); else this.chosen.delete(file.path);
      this.drawDiff();
    });
    const fields = comparison.settings(file);
    head.createSpan({ text: fields !== null ? '設定' : short(file.path) });
    head.createSpan({ cls: 'setting-item-description', text: file.kind === 'missing' ? '不見了' : '改過' });
    if (fields !== null) {
      for (const line of fields) row.createDiv({ cls: 'setting-item-description', text: line });
      row.createDiv({ cls: 'setting-item-description', text: '這個檔會同步，別的裝置之後也會換成這些值' });
    } else {
      const diff = comparison.diff(file);
      head.createSpan({ cls: 'setting-item-description', text: counts(diff) ?? (file.current ? `${String(file.current.size)} → ${String(file.backup?.size ?? 0)} bytes` : `${String(file.backup?.size ?? 0)} bytes`) });
      if (diff) {
        const fold = row.createEl('details');
        fold.createEl('summary', { text: '差異' });
        fold.createEl('pre', { cls: 'essence-cards-restore-diff', text: diff.join('\n') });
      }
    }
    if (now?.action === 'blocked') row.createDiv({ cls: 'essence-cards-backup-problem', text: now.reasons.join('；') });
  }

  private async start(): Promise<void> {
    if (this.working || !this.comparison) return;
    const comparison = this.comparison;
    this.working = true;
    // 勾了但被擋住的也交出去，結果才會列出它的原因。
    const chosen = new Set(this.chosen);
    this.contentEl.empty();
    this.contentEl.createDiv({ text: '正在還原…' });
    let result: RestoreResult;
    try { result = await this.flow.apply(comparison, chosen); } catch (error) {
      this.working = false;
      this.fail(error);
      return;
    }
    this.working = false;
    if (this.containerEl.isConnected) this.drawResult(result, comparison);
    else new Notice(`還原完成：${String(result.files.filter(file => file.outcome === '已還原').length)} 個檔`);
  }

  private drawResult(result: RestoreResult, comparison: Comparison): void {
    const { contentEl } = this;
    contentEl.empty();
    if (result.stopped) contentEl.createDiv({ cls: 'essence-cards-backup-problem', text: `${result.stopped.step}：${result.stopped.message}。什麼都沒有寫。` });
    if (result.backup) contentEl.createDiv({ cls: 'setting-item-description', text: '還原前的備份：' + result.backup });
    const list = contentEl.createDiv({ cls: 'essence-cards-restore-list' });
    const sorted = [...result.files].sort((a, b) => OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome));
    for (const file of sorted) {
      const row = list.createDiv({ cls: 'essence-cards-restore-item' });
      row.createSpan({ text: `${file.outcome}　${(file.target ?? file.path).endsWith('/' + PLUGIN_DATA) ? '設定' : short(file.target ?? file.path)}` });
      if (file.reason) row.createDiv({ cls: 'setting-item-description', text: file.reason });
    }
    for (const log of result.logs) {
      const row = list.createDiv({ cls: 'essence-cards-restore-item' });
      row.createSpan({ text: `${log.outcome}　補回 ${String(log.lines)} 行紀錄（${log.source}）` });
      if (log.reason) row.createDiv({ cls: 'setting-item-description', text: log.reason });
    }
    if (!result.files.length && !result.logs.length && !result.stopped) list.createDiv({ text: '沒有要寫的檔' });
    const footer = contentEl.createDiv({ cls: 'essence-cards-restore-footer' });
    footer.createEl('button', { text: '重新比對' }).addEventListener('click', () => { void this.compare(comparison.row); });
  }
}
