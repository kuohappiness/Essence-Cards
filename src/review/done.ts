import { dayStart } from '../core/study/index.ts';
import type { History, Pick, Progress, Rating, ReviewEntry, Today } from '../core/study/index.ts';
import type { StudyPick } from '../state/index.ts';

/** 完成畫面（W6 §2-6、D-070、D-120）。 */
export interface DoneView {
  title: string;
  /** 全部卡的「這輪第一次就答對」（D-189 第 2 點）；其他範圍與不顯示時沒有這一欄。 */
  score?: string;
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

/**
 * 這一輪第一次就答對幾個（D-189 第 2 點）：分母是 since 之後答過的目標（不含錯題補強），分子是其中第一筆作答就是記住了、太簡單，打字卡還要第 1 步拼對。
 * own 是這次複習寫的作答，照作答的順序；回看改評分換掉那一筆的 t、位置不變，所以「第一筆」不看紀錄的時間（重答之後才改第一筆，改過的那一筆時間比重答晚）。
 * 這一輪的作答要和 own 逐筆對上，多一筆、少一筆都算不準，回傳 null：時間一樣不夠，別台裝置可能同一個毫秒作答（同步進來的不算這一輪）。分母是 0 也是 null。
 */
export function firstTry(reviews: readonly ReviewEntry[], since: number, own: readonly { t: string; lt: string; r: Rating }[]): { right: number; total: number } | null {
  const round = reviews.filter(entry => entry.at >= since && entry.src !== 'mistake');
  if (round.length !== own.length) return null;
  const first = new Map<string, ReviewEntry>();
  for (const { t, lt, r } of own) {
    const entry = round.find(each => each.t === t && each.lt === lt && each.r === r);
    if (!entry) return null;
    if (!first.has(lt)) first.set(lt, entry);
  }
  if (!first.size) return null;
  const right = [...first.values()].filter(({ r, typed }) => (r === 'good' || r === 'easy') && (typed === null || typed === 'right')).length;
  return { right, total: first.size };
}

export const subjectName = (subject: string | null): string => subject ?? '其他';

const statsText = ({ count, minutes }: { count: number; minutes: number }): string =>
  `今天複習了 ${String(count)} 張・${minutes < 1 ? '不到 1 分鐘' : '約 ' + String(minutes) + ' 分鐘'}`;

/** 單元與卡組的範圍（任務說明 §5）的標題；其他範圍是 null。 */
function scopeTitle(pick: StudyPick): string | null {
  if ('unit' in pick) return 'since' in pick ? '這個單元練完了！' : '這個單元今天的份完成了！';
  if ('deck' in pick) return 'since' in pick ? '這篇練完了！' : '這一篇今天的份完成了！';
  return 'targets' in pick ? '這一輪完成了！' : null;
}

export function doneView(pick: StudyPick, progress: Progress, stats: { count: number; minutes: number }, tried: { right: number; total: number } | null = null): DoneView {
  if ('more' in pick) return { title: '又多複習了一些', detail: statsText(stats), buttons: [{ kind: 'close', label: '結束複習' }] };
  const scoped = scopeTitle(pick);
  if (scoped) return { title: scoped, ...(tried ? { score: `這輪第一次就答對 ${String(tried.right)}／${String(tried.total)}` } : {}), detail: statsText(stats), buttons: [{ kind: 'close', label: '結束複習' }] };
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
