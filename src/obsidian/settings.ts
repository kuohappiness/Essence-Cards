import { Platform, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type { App, ButtonComponent, Plugin } from 'obsidian';
import type { BackupStatus, PluginBy } from '../core/backup/index.ts';
import { CAP_MINUTES, RETENTIONS, SEMESTERS } from '../core/settings/index.ts';
import type { SaveResult, SettingsChange, SettingsKey, SettingsStore } from '../core/settings/index.ts';
import { previewButton, previewReveal, quizMark } from '../ui/prefs.ts';
import type { BackupWiring } from './backup.ts';

// 外掛的設定分頁（D-104：用 Obsidian 內建的設定分頁）。依功能分區、不寫「給家長」這類角色（D-156：學生也可能自己用）。
// 「複習」的上限、保持率、倒數與「學期」存在設定檔 `Essence Cards/設定.json`、跟著同步（tasks/settings-page.md、tasks/settings-vault-file.md）；預覽與小考的開關只存在這台裝置（D-161、D-163 第 6 點）；「備份」見 tasks/plugin-backup.md §1-5；AI 製卡之後的任務再加。

const REVIEW = {
  section: '複習',
  cap: '每日時間上限',
  capNote: '全部科目加起來的時間。',
  retention: '目標保持率',
  retentionInfo: ['到了該複習的時候，預計還記得的比例。', '調低：複習次數少，但會多忘一些。', '調高：記得更牢，但每天要複習更多。'],
  countdown: '考試倒數',
  countdownNote: '入口的科目底下顯示距離考試幾天。',
  reset: '恢復預設',
  button: '顯示「預覽」按鈕',
  buttonNote: '卡組筆記的標題列多一顆「預覽」，看卡片在複習畫面上的樣子，不記錄、不動排程。只影響這台裝置。',
  reveal: '預覽時自動展開答案',
  revealNote: '一進卡片就是背面。只影響這台裝置。',
  quiz: '小考標記',
  quizNote: '在目錄替單元或某一篇設小考日期，入口最上面會多一列。不改複習的排程。只影響這台裝置的目錄按鈕。',
};
const TERM = {
  section: '學期',
  semester: '目前學期',
  note: '每年 2/1 自動換成下學期，8/1 換成下一個年級的上學期，也能手動改。',
  unset: '未設定',
};
const TEXTS = {
  section: '備份',
  phone: '備份在電腦上做',
  location: '位置',
  /** 位置下面只放一行短說明，旁邊的 ⓘ 點開才看到三點（使用者 2026-10-29：整段太長）。 */
  note: '預設存在這台電腦，外掛不會上傳。',
  details: [
    '不能選 vault 裡面或連到 vault 的資料夾（備份會被當成卡組讀進來）。',
    '選有雲端同步的資料夾，備份會跟著上傳。',
    '選外接硬碟時，沒接上的那次備份會失敗；成功之前先暫停修改卡組。',
  ],
  change: '變更…',
  useDefault: '用預設位置',
  paste: '貼上資料夾的完整路徑',
  usePasted: '使用這個位置',
  refused: '這個位置不能用：',
  last: '上次備份',
  now: '立即備份',
  open: '打開備份資料夾',
  loading: '準備中…',
  restore: '還原',
  restoreNote: '選一份備份，逐檔比對之後勾選要還原的。',
  restoreNotYet: '還原目前只在 Windows 驗過。',
  restoreOpen: '還原…',
};
const BY: Record<PluginBy | 'restore', string> = { 'new-version': '新版第一次', monthly: '每月', manual: '手動', restore: '還原前' };

/** 這台電腦的當地時間，到分。 */
function local(ms: number): string {
  const date = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** 「上次備份」那一行：時間與結果；失敗時寫是哪一步、哪個檔與原因（D-154）。 */
function describe(status: BackupStatus): string[] {
  const lines: string[] = [];
  if (status.running) lines.push(`正在備份（${BY[status.running]}）…`);
  if (status.failure) lines.push(`${local(status.failure.time)} 失敗（${BY[status.failure.by]}）：${status.failure.step}：${status.failure.message}`);
  if (status.last) lines.push(`${local(status.last.time)} 成功` + (status.failure ? '（之後的備份失敗，暫停修改卡組）' : ''));
  else if (!status.running && !status.failure) lines.push(status.checked ? '還沒有備份' : '確認中…');
  if (status.cleanup.length) lines.push('清理舊備份沒做完，下次備份後再試：' + status.cleanup.join('；'));
  return lines;
}

export interface SettingsHost {
  plugin: Plugin;
  /** 電腦上的備份；還沒載入是 null。 */
  backup: () => BackupWiring | null;
  /** 電腦專用的功能載入失敗的原因。 */
  backupError: () => string | null;
  /** 預覽的開關變了：按鈕與命令立刻跟著，不用重開。 */
  previewChanged: () => void;
  /** 同步的設定（設定檔）。 */
  settings: SettingsStore;
  /** 今天（`YYYY-MM-DD`，清晨 4 點換日）：選學期時記下選的那一天。 */
  today: () => string;
  /** 打開還原的視窗（tasks/plugin-restore.md §1）。 */
  openRestore: () => void;
  /** 這次沒有存下：提示並記下（tasks/settings-page.md §2-6）。 */
  saveFailed: (result: Exclude<SaveResult, 'saved'>) => void;
}

/** ⓘ 點開或收起 details；重畫時由呼叫端保留開著沒。 */
function infoToggle(icon: HTMLElement, details: HTMLElement, open: () => boolean, set: (open: boolean) => void): void {
  setIcon(icon, 'info');
  details.toggle(open());
  const toggle = (): void => {
    set(!open());
    details.toggle(open());
    icon.setAttribute('aria-expanded', String(open()));
  };
  icon.addEventListener('click', toggle);
  icon.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
}
const infoAttr = (open: boolean): Record<string, string> => ({ role: 'button', tabindex: '0', 'aria-label': '說明', 'aria-expanded': String(open) });

class EssenceSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;
  /** 重畫時保留：ⓘ 點開了沒、選錯位置時的說明、叫不到選資料夾對話框時改用文字欄位。 */
  private expanded = false;
  private retentionOpen = false;
  private problem: string | null = null;
  private typing = false;
  /** 打開備份資料夾失敗的原因。 */
  private opening: string | null = null;
  constructor(app: App, host: SettingsHost) {
    super(app, host.plugin);
    this.host = host;
  }

  /** Obsidian 打開這個分頁時呼叫：先用手上的值畫，同時重讀，值不同才重畫（§5）。 */
  display(): void {
    void this.host.settings.reload();
    this.draw();
  }

  private draw(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.review(containerEl);
    this.term(containerEl);
    new Setting(containerEl).setName(TEXTS.section).setHeading();
    if (!Platform.isDesktopApp) {
      new Setting(containerEl).setDesc(TEXTS.phone);
      return;
    }
    const backup = this.host.backup();
    if (!backup) {
      new Setting(containerEl).setDesc(this.host.backupError() ?? TEXTS.loading);
      return;
    }
    this.location(containerEl, backup);
    this.status(containerEl, backup);
    new Setting(containerEl).setName(TEXTS.restore).setDesc(backup.desktop.restorable ? TEXTS.restoreNote : TEXTS.restoreNotYet)
      .addButton(button => button.setButtonText(TEXTS.restoreOpen).setDisabled(!backup.desktop.restorable).onClick(() => { this.host.openRestore(); }));
  }

  /** 存一項；沒存下時提示，畫面回到實際的值。存成功時由 store 的通知重畫。 */
  private async save(change: SettingsChange): Promise<void> {
    const result = await this.host.settings.change(change);
    if (result === 'saved') return;
    this.host.saveFailed(result);
    this.refresh();
  }

  /** 存過才有恢復預設（D-149 第 7 點）。 */
  private resetButton(row: Setting, key: Exclude<SettingsKey, 'semester'>): void {
    if (!this.host.settings.saved().includes(key)) return;
    row.addExtraButton(button => button.setIcon('rotate-ccw').setTooltip(REVIEW.reset).onClick(() => { void this.save({ key, value: null }); }));
  }

  private review(containerEl: HTMLElement): void {
    const { settings, examCountdown } = this.host.settings.value();
    new Setting(containerEl).setName(REVIEW.section).setHeading();
    const cap = new Setting(containerEl).setName(REVIEW.cap).setDesc(REVIEW.capNote).addDropdown(dropdown => {
      for (const minutes of CAP_MINUTES) dropdown.addOption(String(minutes), `${String(minutes)} 分鐘`);
      dropdown.setValue(String(settings.capMinutes)).onChange(value => { void this.save({ key: 'capMinutes', value: Number(value) }); });
    });
    this.resetButton(cap, 'capMinutes');
    const retention = new Setting(containerEl).setName(REVIEW.retention).addDropdown(dropdown => {
      for (const rate of RETENTIONS) dropdown.addOption(String(rate), `${String(Math.round(rate * 100))}%`);
      dropdown.setValue(String(settings.retention)).onChange(value => { void this.save({ key: 'retention', value: Number(value) }); });
    });
    const icon = retention.nameEl.createSpan({ cls: 'essence-cards-backup-info clickable-icon', attr: infoAttr(this.retentionOpen) });
    const details = retention.descEl.createEl('ul', { cls: 'essence-cards-backup-details' });
    for (const text of REVIEW.retentionInfo) details.createEl('li', { text });
    infoToggle(icon, details, () => this.retentionOpen, open => { this.retentionOpen = open; });
    this.resetButton(retention, 'retention');
    const countdown = new Setting(containerEl).setName(REVIEW.countdown).setDesc(REVIEW.countdownNote).addToggle(toggle => toggle.setValue(examCountdown).onChange(on => { void this.save({ key: 'examCountdown', value: on }); }));
    this.resetButton(countdown, 'examCountdown');
    new Setting(containerEl).setName(REVIEW.button).setDesc(REVIEW.buttonNote).addToggle(toggle => toggle.setValue(previewButton.get(this.app)).onChange(on => {
      previewButton.set(this.app, on);
      this.host.previewChanged();
    }));
    new Setting(containerEl).setName(REVIEW.reveal).setDesc(REVIEW.revealNote).addToggle(toggle => toggle.setValue(previewReveal.get(this.app)).onChange(on => {
      previewReveal.set(this.app, on);
    }));
    new Setting(containerEl).setName(REVIEW.quiz).setDesc(REVIEW.quizNote).addToggle(toggle => toggle.setValue(quizMark.get(this.app)).onChange(on => {
      quizMark.set(this.app, on);
    }));
  }

  private term(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(TERM.section).setHeading();
    new Setting(containerEl).setName(TERM.semester).setDesc(TERM.note).addDropdown(dropdown => {
      dropdown.addOption('', TERM.unset);
      for (const semester of SEMESTERS) dropdown.addOption(semester, semester);
      dropdown.setValue(this.host.settings.semester() ?? '').onChange(value => {
        void this.save({ key: 'semester', value: value ? { value, setOn: this.host.today() } : null });
      });
    });
  }

  /** 備份或設定變了：設定頁開著時重畫。 */
  refresh(): void {
    if (this.containerEl.isShown()) this.draw();
  }

  private location(containerEl: HTMLElement, backup: BackupWiring): void {
    const custom = backup.custom();
    const row = new Setting(containerEl).setName(TEXTS.location);
    row.settingEl.addClass('essence-cards-backup-location');
    row.descEl.createDiv({ text: custom ?? backup.desktop.defaultFolder, cls: 'essence-cards-backup-path' });
    const note = row.descEl.createDiv({ cls: 'essence-cards-backup-note' });
    note.createSpan({ text: TEXTS.note });
    const info = note.createSpan({ cls: 'essence-cards-backup-info clickable-icon', attr: infoAttr(this.expanded) });
    const details = row.descEl.createEl('ul', { cls: 'essence-cards-backup-details' });
    for (const text of TEXTS.details) details.createEl('li', { text });
    infoToggle(info, details, () => this.expanded, open => { this.expanded = open; });
    if (this.problem) row.descEl.createDiv({ text: TEXTS.refused + this.problem, cls: 'essence-cards-backup-problem' });

    if (this.typing) {
      let pasted = '';
      row.addText(text => text.setPlaceholder(TEXTS.paste).onChange(value => { pasted = value.trim(); }));
      row.addButton(button => button.setButtonText(TEXTS.usePasted).onClick(() => { void this.use(backup, pasted); }));
    } else {
      row.addButton(button => button.setButtonText(TEXTS.change).onClick(() => { void this.choose(backup); }));
    }
    row.addButton(button => button.setButtonText(TEXTS.useDefault).setDisabled(custom === null).onClick(() => {
      backup.setFolder(null);
      this.problem = null;
      this.draw();
    }));
  }

  /** 系統的選資料夾對話框（§1-1）；叫不到就改成文字欄位貼路徑。 */
  private async choose(backup: BackupWiring): Promise<void> {
    let chosen: string | null;
    try { chosen = await backup.desktop.choose(backup.custom() ?? backup.desktop.defaultFolder); } catch {
      this.typing = true;
      this.draw();
      return;
    }
    if (chosen !== null) await this.use(backup, chosen);
  }

  /** 選了不能用的位置：當場說明原因，不換位置（§1-5）；可以用就記下實際路徑，位置那一列顯示的是它。 */
  private async use(backup: BackupWiring, folder: string): Promise<void> {
    if (!folder) return;
    this.problem = await backup.useFolder(folder);
    if (!this.problem) this.typing = false;
    this.draw();
  }

  private status(containerEl: HTMLElement, backup: BackupWiring): void {
    const status = backup.runner.status();
    const row = new Setting(containerEl).setName(TEXTS.last);
    row.settingEl.addClass('essence-cards-backup-status');
    for (const line of describe(status)) row.descEl.createDiv({ text: line });
    if (status.failure) row.descEl.firstElementChild?.addClass('essence-cards-backup-problem');
    if (this.opening) row.descEl.createDiv({ text: '打不開備份資料夾：' + this.opening, cls: 'essence-cards-backup-problem' });
    row.addButton((button: ButtonComponent) => button.setButtonText(TEXTS.now).setCta().setDisabled(status.running !== null).onClick(() => {
      void backup.runner.backup();
    }));
    row.addButton(button => button.setButtonText(TEXTS.open).onClick(() => {
      void backup.desktop.open(backup.custom() ?? backup.desktop.defaultFolder).then(error => { this.opening = error; this.draw(); });
    }));
  }
}

/** 接上設定分頁；交回備份狀態變了時重畫的函式。 */
export function wireSettings(host: SettingsHost): { refresh: () => void } {
  const tab = new EssenceSettingTab(host.plugin.app, host);
  host.plugin.addSettingTab(tab);
  return { refresh: () => { tab.refresh(); } };
}
