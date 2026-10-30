import { Platform, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type { App, ButtonComponent, Plugin } from 'obsidian';
import type { BackupStatus, PluginBy } from '../core/backup/index.ts';
import type { BackupWiring } from './backup.ts';

// 外掛的設定分頁（D-104：用 Obsidian 內建的設定分頁）。依功能分區、不寫「給家長」這類角色（D-156：學生也可能自己用）。
// 這次只有「備份」一區（tasks/plugin-backup.md §1-5），複習、學期、AI 製卡之後的任務再加。

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
};
const BY: Record<PluginBy, string> = { 'new-version': '新版第一次', monthly: '每月', manual: '手動' };

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
}

class EssenceSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;
  /** 重畫時保留：ⓘ 點開了沒、選錯位置時的說明、叫不到選資料夾對話框時改用文字欄位。 */
  private expanded = false;
  private problem: string | null = null;
  private typing = false;
  /** 打開備份資料夾失敗的原因。 */
  private opening: string | null = null;
  constructor(app: App, host: SettingsHost) {
    super(app, host.plugin);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
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
  }

  /** 備份的狀態變了：設定頁開著時重畫。 */
  refresh(): void {
    if (this.containerEl.isShown()) this.display();
  }

  private location(containerEl: HTMLElement, backup: BackupWiring): void {
    const custom = backup.custom();
    const row = new Setting(containerEl).setName(TEXTS.location);
    row.settingEl.addClass('essence-cards-backup-location');
    row.descEl.createDiv({ text: custom ?? backup.desktop.defaultFolder, cls: 'essence-cards-backup-path' });
    const note = row.descEl.createDiv({ cls: 'essence-cards-backup-note' });
    note.createSpan({ text: TEXTS.note });
    const info = note.createSpan({ cls: 'essence-cards-backup-info clickable-icon', attr: { role: 'button', tabindex: '0', 'aria-label': '說明', 'aria-expanded': String(this.expanded) } });
    setIcon(info, 'info');
    const details = row.descEl.createEl('ul', { cls: 'essence-cards-backup-details' });
    for (const text of TEXTS.details) details.createEl('li', { text });
    details.toggle(this.expanded);
    const toggle = (): void => {
      this.expanded = !this.expanded;
      details.toggle(this.expanded);
      info.setAttribute('aria-expanded', String(this.expanded));
    };
    info.addEventListener('click', toggle);
    info.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
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
      this.display();
    }));
  }

  /** 系統的選資料夾對話框（§1-1）；叫不到就改成文字欄位貼路徑。 */
  private async choose(backup: BackupWiring): Promise<void> {
    let chosen: string | null;
    try { chosen = await backup.desktop.choose(backup.custom() ?? backup.desktop.defaultFolder); } catch {
      this.typing = true;
      this.display();
      return;
    }
    if (chosen !== null) await this.use(backup, chosen);
  }

  /** 選了不能用的位置：當場說明原因，不換位置（§1-5）；可以用就記下實際路徑，位置那一列顯示的是它。 */
  private async use(backup: BackupWiring, folder: string): Promise<void> {
    if (!folder) return;
    this.problem = await backup.useFolder(folder);
    if (!this.problem) this.typing = false;
    this.display();
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
      void backup.desktop.open(backup.custom() ?? backup.desktop.defaultFolder).then(error => { this.opening = error; this.display(); });
    }));
  }
}

/** 接上設定分頁；交回備份狀態變了時重畫的函式。 */
export function wireSettings(host: SettingsHost): { refresh: () => void } {
  const tab = new EssenceSettingTab(host.plugin.app, host);
  host.plugin.addSettingTab(tab);
  return { refresh: () => { tab.refresh(); } };
}
