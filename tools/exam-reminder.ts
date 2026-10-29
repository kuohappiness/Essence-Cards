import { parseDocument } from 'yaml';
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

const DAY = 86_400_000;
const LATER = '這一版可以考後再裝，由家長決定';

/** `YYYY-MM-DD` 是哪一天（和 dayOf 同一種編號）；寫法不對是 null。 */
function dateDay(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(at).toISOString().slice(0, 10) === value ? at / DAY : null;
}

/** 一份考試範圍的期間（syntax §4）；屬性區讀不出來或日期寫法不對丟錯。 */
function period(text: string): { start: number | null; end: number | null } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { start: null, end: null };
  const close = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
  if (close < 0) throw Error('屬性區沒有結束');
  const doc = parseDocument(lines.slice(1, close).join('\n'));
  if (doc.errors.length) throw Error('屬性區讀不出來');
  const data = (doc.toJS() ?? {}) as Record<string, unknown>;
  if (typeof data !== 'object' || Array.isArray(data)) throw Error('屬性區不是對照表');
  const read = (key: string): number | null => {
    if (data[key] === undefined || data[key] === null) return null;
    const day = dateDay(data[key]);
    if (day === null) throw Error(`「${key}」的日期寫法不對`);
    return day;
  };
  return { start: read('考試開始'), end: read('考試結束') };
}

/**
 * 從 `Essence Cards/考試範圍/` 的每一份算提醒（text 是 null 表示那一份讀不到）。生效：沒填期間，或結束日還沒過（清晨 4 點換日，
 * 只寫開始就是一天）；好幾份生效時用開始日最早的那一份（syntax §4）。
 */
export function examReminder(scopes: readonly { path: string; text: string | null }[], now: number, offset: number): Reminder {
  const today = dayOf(now, offset);
  const effective: { path: string; start: number | null; end: number | null }[] = [];
  for (const { path, text } of scopes) {
    if (text === null) return { kind: 'unreadable', needsOk: true, message: `讀不到考試範圍「${path}」，不當成沒有考試；${LATER}` };
    let found;
    try { found = period(text); } catch (error) {
      return { kind: 'unreadable', needsOk: true, message: `考試範圍「${path}」${(error as Error).message}，不當成沒有考試；${LATER}` };
    }
    const end = found.end ?? found.start;
    if (end === null || today <= end) effective.push({ path, ...found });
  }
  const dated = effective.filter(scope => scope.start !== null).sort((a, b) => a.start! - b.start!);
  const scope = dated[0] ?? effective[0];
  if (!scope) return { kind: 'none', needsOk: false, message: '沒有生效的考試範圍' };
  if (scope.start === null) return { kind: 'undated', needsOk: false, message: `考試範圍「${scope.path}」還沒填考試日期，日期未定` };
  const days = scope.start - today;
  if (days <= 0) return { kind: 'during', needsOk: true, message: `考試期間（「${scope.path}」）；${LATER}` };
  if (days <= 7) return { kind: 'soon', needsOk: true, message: `離段考還有 ${days} 天（「${scope.path}」）；${LATER}` };
  return { kind: 'none', needsOk: false, message: `離段考還有 ${days} 天（「${scope.path}」），在 7 天以外` };
}
