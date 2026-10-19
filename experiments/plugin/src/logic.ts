export const ratings = ['miss', 'near', 'good', 'easy'] as const;
export type Rating = typeof ratings[number];
export function spelling(input: string, answer: string) {
  const a = [...input.trim().toLowerCase()], b = [...answer.trim().toLowerCase()];
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
  const typed: { char: string; bad: boolean }[] = [], expected: typeof typed = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && d[i][j] === d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1])) {
      const bad = a[i - 1] !== b[j - 1]; typed.unshift({ char: a[--i], bad }); expected.unshift({ char: b[--j], bad });
    } else if (j && d[i][j] === d[i][j - 1] + 1) expected.unshift({ char: b[--j], bad: true });
    else typed.unshift({ char: a[--i], bad: true });
  }
  return { ok: a.join('') === b.join(''), typed, expected };
}
export type Axis = 'pending' | 'horizontal' | 'vertical';
export function lockAxis(axis: Axis, dx: number, dy: number): Axis {
  if (axis !== 'pending') return axis;
  if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.6) return 'horizontal';
  if (Math.abs(dy) > 10 || Math.abs(dx) > 10) return 'vertical';
  return 'pending';
}
export function gesture(axis: Axis, dx: number, dy: number, ms: number, canBack: boolean, viewing: boolean) {
  if (axis === 'vertical') return '捲動';
  if (axis === 'pending') return Math.hypot(dx, dy) < 10 ? '點擊' : '彈回';
  if (Math.abs(dx) < 60 && !(Math.abs(dx) > 10 && Math.abs(dx) / Math.max(ms, 1) > 0.5)) return '彈回';
  return dx > 0 ? (canBack ? '上一張' : '彈回') : (viewing ? '回到目前' : '彈回');
}
export function frameStats(intervals: number[]) {
  const sorted = [...intervals].sort((a, b) => a - b), n = sorted.length;
  const median = n ? (sorted[Math.floor(n / 2)] + sorted[Math.floor((n - 1) / 2)]) / 2 : 0;
  return { frames: n, median, max: n ? sorted[n - 1] : 0, dropped: intervals.filter(n => n > median * 1.5).length, intervals };
}
export function timestamp(date: Date) {
  const offset = -date.getTimezoneOffset(), shifted = new Date(date.getTime() + offset * 60000);
  return shifted.toISOString().slice(0, -1) + (offset >= 0 ? '+' : '-') + String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0') + ':' + String(Math.abs(offset) % 60).padStart(2, '0');
}
export function uniqueClock(now: () => number = Date.now) {
  let last = 0;
  return () => timestamp(new Date(last = Math.max(now(), last + 1)));
}
export type RecordLine = { t: string; lt: string; r: Rating; v: string } | { t: string; undo: string } | { t: string; set: 'cap' | 'status' | 'filter'; val: number | string | string[]; deck?: string };
export const reviewLine = (t: string, lt: string, r: Rating, v: string): RecordLine => ({ t, lt, r, v });
export const undoLine = (t: string, undo: string): RecordLine => ({ t, undo });
