import { chooseScope, parseScope, scopeDay, scopePeriod } from '../src/core/catalog/index.ts';
import type { ScopeFile } from '../src/core/catalog/index.ts';
import { dayOf } from '../src/core/study/index.ts';

export const SCOPE_FOLDER = 'Essence Cards/考試範圍';

/**
 * 考前提醒（D-149 第 6 點）：soon 考試開始前 7 天內；during 考試期間；undated 生效的考試範圍沒填日期；
 * unreadable 讀不到考試範圍（不當成沒有考試）；none 沒有生效的考試範圍，或還在 7 天以外。
 * needsOk：不擋，但安裝要多加 --exam-ok，維護的 AI 先問過使用者才加。
 */
export interface Reminder {
  kind: 'soon' | 'during' | 'undated' | 'unreadable' | 'none';
  message: string;
  needsOk: boolean;
}

const LATER = '這一版可以考後再裝，由家長決定';

/**
 * 從 `Essence Cards/考試範圍/` 的每一份算提醒（text 是 null 表示那一份讀不到），讀法與選哪一份都和外掛同一份（tasks/exam-scope.md §2-3）。生效：沒填期間，或結束日還沒過（清晨 4 點換日，
 * 只寫開始就是一天）；好幾份生效時用開始日最早的那一份（syntax §4）。
 */
export function examReminder(scopes: readonly { path: string; text: string | null }[], now: number, offset: number): Reminder {
  const today = dayOf(now, offset);
  const entries: { path: string; file: ScopeFile }[] = [];
  for (const { path, text } of scopes) {
    if (text === null) return { kind: 'unreadable', needsOk: true, message: `讀不到考試範圍「${path}」，不當成沒有考試；${LATER}` };
    const file = parseScope(text);
    if (!file.ended && scopePeriod(file).kind === 'bad') {
      return { kind: 'unreadable', needsOk: true, message: `考試範圍「${path}」${file.broken ? '屬性區讀不出來' : '的日期有問題'}，不當成沒有考試；${LATER}` };
    }
    entries.push({ path, file });
  }
  const { chosen } = chooseScope(entries, today);
  if (!chosen) return { kind: 'none', needsOk: false, message: '沒有生效的考試範圍' };
  const period = scopePeriod(chosen.file);
  if (period.kind !== 'ok') return { kind: 'undated', needsOk: false, message: `考試範圍「${chosen.path}」還沒填考試日期，日期未定` };
  const days = scopeDay(period.start) - today;
  if (days <= 0) return { kind: 'during', needsOk: true, message: `考試期間（「${chosen.path}」）；${LATER}` };
  if (days <= 7) return { kind: 'soon', needsOk: true, message: `離段考還有 ${days} 天（「${chosen.path}」）；${LATER}` };
  return { kind: 'none', needsOk: false, message: `離段考還有 ${days} 天（「${chosen.path}」），在 7 天以外` };
}
