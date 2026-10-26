import type { Pick, Progress } from '../core/study/index.ts';
import { subjectName } from './done.ts';

// 暫時的開始方式（W6 §3-9）：選單一列一科，照 progress() 的順序；入口畫面（D-095）做好時拿掉。

export interface StartRow { label: string; pick: Pick; done: boolean }

/** 選單的列：「自然　3/10　約 5 分鐘」；做完的寫「完成」；全部做完只有一列「再複習一些」；今天沒有卡時是空的。 */
export function startRows(progress: Progress): StartRow[] {
  if (progress.total === 0) return [];
  const rows = progress.subjects.map(row => {
    const done = row.done >= row.total;
    const time = done ? '完成' : `約 ${String(Math.max(1, Math.ceil(row.remainingSeconds / 60)))} 分鐘`;
    return { label: `${subjectName(row.subject)}　${String(row.done)}/${String(row.total)}　${time}`, pick: { subject: row.subject }, done };
  });
  if (rows.every(row => row.done)) return [{ label: '再複習一些', pick: { more: true }, done: false }];
  return rows;
}
