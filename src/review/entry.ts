import { scopeAfter, scopeCountdown, scopeDates, scopeHasSubject, scopeLabels, scopeNotes, scopeStartDate } from '../core/catalog/index.ts';
import { folderLabel } from '../core/deck/index.ts';
import type { FolderIssue } from '../core/deck/index.ts';
import type { Pick } from '../core/study/index.ts';
import type { Catalog, State } from '../state/index.ts';
import { subjectName } from './done.ts';

// 入口畫面的資料（D-095、D-133、任務說明 §2、§8）：純程式，順序已在 progress() 排好，畫面不重排。

interface EntryRow {
  name: string;
  done: number;
  total: number;
  /** 這一科還要花的分鐘數；做完是 0。 */
  minutes: number;
  finished: boolean;
  pick: Pick;
  /** 科目名稱底下的倒數（D-095）：幾天或今天；這份範圍沒寫到這一科、日期未定或有問題是 null。 */
  countdown: number | 'today' | null;
}
export type EntryView =
  /** 還在讀，或 state 還沒建好。 */
  | { kind: 'loading' }
  /** rows 空的就是今天沒有卡。more：全部做完而且還有可以再複習的。 */
  | { kind: 'ready'; done: number; total: number; finished: boolean; rows: EntryRow[]; more: boolean };

export function entryView(state: State | null): EntryView {
  if (!state) return { kind: 'loading' };
  let progress;
  let more;
  // 還沒 ready 時 progress() 丟錯是預期的（State 的註解），不是故障。
  try { progress = state.progress(); more = state.today().more.length > 0; } catch { return { kind: 'loading' }; }
  const rows = progress.subjects.map(row => {
    const finished = row.done >= row.total;
    return { name: subjectName(row.subject), done: row.done, total: row.total, minutes: finished ? 0 : Math.max(1, Math.ceil(row.remainingSeconds / 60)), finished, pick: { subject: row.subject }, countdown: countdownOf(state, row.subject) };
  });
  const finished = progress.total > 0 && progress.done >= progress.total;
  return { kind: 'ready', done: progress.done, total: progress.total, finished, rows, more: finished && more };
}

function countdownOf(state: State, subject: string | null): number | 'today' | null {
  const { file, usable, period, day } = state.exam();
  return file && usable && subject !== null && scopeHasSubject(file, subject) ? scopeCountdown(period, day) : null;
}

/** 目錄的科目標題旁（D-097）：只有這份範圍寫到這個學期的這一科才有。 */
export function examSubject(state: State | null, term: string, subject: string): string | null {
  if (!state) return null;
  const { file, usable, period, day } = state.exam();
  if (!file || !usable || period.kind !== 'ok' || !scopeHasSubject(file, subject, term)) return null;
  const left = scopeCountdown(period, day);
  return left === 'today' ? '今天考試' : `距離考試：${String(left)} 天（${scopeStartDate(period)}）`;
}

/** 入口與目錄的「考試範圍與日期」那一列（tasks/exam-scope.md §7、§2-6）。status 是標題旁的字；還在讀是 null。 */
export interface ExamRowView { status: string | null; subjects: { subject: string; label: string }[]; after: string | null; notes: string[] }

export function examRow(state: State | null): ExamRowView {
  const nothing: ExamRowView = { status: null, subjects: [], after: null, notes: [] };
  const catalog = state?.examCatalog() ?? null;
  if (!state || !catalog) return nothing;
  const { settled, missing, file, usable, period } = state.exam();
  if (!file && (!settled || missing > 0)) return { ...nothing, status: '暫時讀不到' };
  if (!file) return { ...nothing, status: '還沒設定' };
  const { unreadable, unmatched } = scopeNotes(file, catalog);
  const count = (n: number, word: string): string[] => n > 0 ? [`有 ${String(n)} ${word}`] : [];
  return {
    status: period.kind === 'ok' ? scopeDates(period) : period.kind === 'none' ? '日期未定' : '考試日期有問題',
    subjects: usable ? scopeLabels(file, catalog) : [],
    after: usable ? scopeAfter(file, catalog) : null,
    notes: [...count(unreadable, '行看不懂'), ...count(unmatched, '行對不到卡組'), ...count(missing, '份暫時讀不到')],
  };
}

/** 目錄的資料；還沒 ready 是 null（同上，丟錯是預期的）。 */
export function catalogView(state: State | null): Catalog | null {
  if (!state) return null;
  try { return state.catalog(); } catch { return null; }
}

/** 提醒一區用到的系統資料夾防呆（src/obsidian/folder-guard.ts 的一部分）。 */
export interface FolderActions {
  issues(): readonly FolderIssue[];
  /** 「搬回原位」：成功是 true；結果的通知由防呆自己發。 */
  moveBack(issue: FolderIssue): Promise<boolean>;
  /** 「不用了」。 */
  dismiss(folder: string): void;
}
/** 搬錯位置的系統資料夾（tasks/system-folder-guard.md §2-4）一項：action 是那一項的按鈕（搬回原位、不用了），沒有按鈕是 null。 */
interface FolderReminder { folder: string; text: string; action: 'move' | 'dismiss' | null; issue: FolderIssue }
/** 提醒一區（D-163 第 5 點）：讀不到、需要新版、搬錯位置的系統資料夾；count 是幾項（狀態列寫「2 項提醒」）。 */
export interface ReminderView { unread: readonly string[]; needsUpdate: boolean; folders: FolderReminder[]; count: number }

export function reminderView(state: State | null, issues: readonly FolderIssue[] = []): ReminderView {
  const folders = issues.map(folderReminder);
  if (!state) return { unread: [], needsUpdate: false, folders, count: folders.length };
  const unread = state.unread();
  const blocked = state.blocked();
  const needsUpdate = blocked.decks.length > 0 || blocked.targets.length > 0 || blocked.all;
  return { unread, needsUpdate, folders, count: (unread.length ? 1 : 0) + (needsUpdate ? 1 : 0) + folders.length };
}

/** 搬回去之後會怎樣：照資料夾說，沒有列的寫「外掛就讀得到」。 */
const BACK: Record<string, string> = {
  'Essence Cards': '卡組與複習進度就會回來',
  '紀錄': '複習進度就會回來',
  '紀錄/錯誤': '錯誤紀錄就會接著寫',
  '考試範圍': '考試範圍與倒數就會回來',
  '考試範圍/小考': '小考就會回來',
};

function folderReminder(issue: FolderIssue): FolderReminder {
  const label = folderLabel(issue.folder);
  const name = label.slice(label.lastIndexOf('/') + 1);
  const up = issue.folder.includes('/') ? '「' + issue.folder.slice(0, issue.folder.lastIndexOf('/')) + '」底下' : ' vault 最上層';
  const quote = (paths: readonly string[]): string => paths.map(path => '「' + path + '」').join('、');
  const back = BACK[label] ?? '外掛就讀得到';
  if (issue.kind === 'missing') return { folder: issue.folder, issue, action: 'dismiss', text: `找不到「${label}」。如果改了名或搬到別處，請改回「${name}」、放回${up}` };
  if (issue.kind === 'both') return { folder: issue.folder, issue, action: null, text: `有兩個「${label}」：${quote([issue.folder, ...issue.at])}。請把別處那個裡面的檔搬進「${issue.folder}」，再刪掉空的資料夾` };
  if (issue.at.length === 1) return { folder: issue.folder, issue, action: 'move', text: `「${label}」不在原位，現在在「${issue.at[0]}」。搬回${up}，${back}` };
  return { folder: issue.folder, issue, action: null, text: `「${label}」不在原位，有好幾個同名的資料夾：${quote(issue.at)}。把對的那一個搬回${up}，${back}` };
}
