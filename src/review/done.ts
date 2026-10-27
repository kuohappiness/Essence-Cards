import { dayStart } from '../core/study/index.ts';
import type { History, Pick, Progress, Today } from '../core/study/index.ts';

/** 完成畫面（W6 §2-6、D-070、D-120）。 */
export interface DoneView {
  title: string;
  detail: string;
  /** more：再複習一些（{ more: true }）；next：接著做那一科；close：結束複習。 */
  buttons: { kind: 'more' | 'next' | 'close'; label: string; pick?: Pick }[];
}

/** 今天複習了幾張（每翻一張都算一次，答錯再出的也算；錯題補強不算，D-068），花了約幾分鐘（間隔超過 2 分鐘不算，D-120）。 */
export function todayStats(history: History, today: Today): { count: number; minutes: number } {
  const start = dayStart(today.day, today.offset);
  const times = history.reviews.filter(entry => entry.at >= start && entry.src !== 'mistake').map(entry => entry.at).sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap <= 120_000) total += gap;
  }
  return { count: times.length, minutes: Math.round(total / 60_000) };
}

export const subjectName = (subject: string | null): string => subject ?? '其他';

const statsText = ({ count, minutes }: { count: number; minutes: number }): string =>
  `今天複習了 ${String(count)} 張・${minutes < 1 ? '不到 1 分鐘' : '約 ' + String(minutes) + ' 分鐘'}`;

export function doneView(pick: Pick, progress: Progress, stats: { count: number; minutes: number }): DoneView {
  if ('more' in pick) return { title: '又多複習了一些', detail: statsText(stats), buttons: [{ kind: 'close', label: '結束複習' }] };
  const unfinished = progress.subjects.find(row => row.done < row.total);
  if (!unfinished) {
    return { title: '今天的份完成了！', detail: statsText(stats), buttons: [{ kind: 'more', label: '再複習一些', pick: { more: true } }, { kind: 'close', label: '結束複習' }] };
  }
  const subject = 'subject' in pick ? pick.subject : null;
  const next = subjectName(unfinished.subject);
  return {
    title: `${subjectName(subject)}的份完成了！`,
    detail: `還有${next} ${String(unfinished.total - unfinished.done)} 張`,
    buttons: [{ kind: 'next', label: `接著做${next}`, pick: { subject: unfinished.subject } }, { kind: 'close', label: '結束複習' }],
  };
}
