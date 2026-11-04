import { scopeAfter, scopeCountdown, scopeDates, scopeHasSubject, scopeLabels, scopeNotes, scopeStartDate } from '../core/catalog/index.ts';
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
  if (!settled || (missing > 0 && !file)) return { ...nothing, status: '暫時讀不到' };
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

/** 提醒一區（D-163 第 5 點）：只有這兩種狀態提示；count 是幾項（狀態列寫「2 項提醒」）。 */
export interface ReminderView { unread: readonly string[]; needsUpdate: boolean; count: number }

export function reminderView(state: State | null): ReminderView {
  if (!state) return { unread: [], needsUpdate: false, count: 0 };
  const unread = state.unread();
  const blocked = state.blocked();
  const needsUpdate = blocked.decks.length > 0 || blocked.targets.length > 0 || blocked.all;
  return { unread, needsUpdate, count: (unread.length ? 1 : 0) + (needsUpdate ? 1 : 0) };
}
