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
    return { name: subjectName(row.subject), done: row.done, total: row.total, minutes: finished ? 0 : Math.max(1, Math.ceil(row.remainingSeconds / 60)), finished, pick: { subject: row.subject } };
  });
  const finished = progress.total > 0 && progress.done >= progress.total;
  return { kind: 'ready', done: progress.done, total: progress.total, finished, rows, more: finished && more };
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
