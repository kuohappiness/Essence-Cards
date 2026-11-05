import { parseTime } from './time.ts';
import type { ExamLog, LogEntry, NewEntry, Rating } from './types.ts';

export function encodeEntry(t: string, entry: NewEntry): string {
  if ('undo' in entry) return JSON.stringify({ t, undo: entry.undo });
  if ('set' in entry) {
    return JSON.stringify({ t, set: entry.set, ...('deck' in entry ? { deck: entry.deck } : 'lt' in entry ? { lt: entry.lt } : {}), val: entry.val });
  }
  // 欄位順序 t, lt, r, v, typed, retry, src（syntax.md §5）。
  return JSON.stringify({ t, lt: entry.lt, r: entry.r, ...('v' in entry ? { v: entry.v } : {}),
    ...('typed' in entry && entry.typed ? { typed: entry.typed } : {}), ...('retry' in entry && entry.retry ? { retry: entry.retry } : {}),
    ...(entry.src ? { src: entry.src } : {}) });
}

const blank = (value: unknown): boolean => typeof value !== 'string' || !value.trim();
const wordList = (value: unknown): boolean => Array.isArray(value) && value.every(each => typeof each === 'string');

/** 變更這一種的值不符合契約的原因（syntax.md §5）；符合是 null。 */
function changeProblem(entry: Extract<NewEntry, { set: string }>): string | null {
  const val: unknown = entry.val;
  switch (entry.set) {
    case 'cap':
    case 'retention':
      return Number.isFinite(val) ? null : entry.set + ' 不是有限的數字';
    case 'semester':
    case 'app':
      return typeof val === 'string' ? null : entry.set + ' 不是字串';
    case 'filter':
      return wordList(val) ? null : 'filter 不是字串清單';
    case 'status': {
      const onDeck = 'deck' in entry;
      if (blank(onDeck ? entry.deck : entry.lt)) return '狀態的對象是空白';
      return (onDeck ? ['草稿', '啟用', '暫停'] : ['啟用', '暫停']).includes(entry.val) ? null : '狀態的值認不得';
    }
    case 'exam': {
      const log = val as Partial<ExamLog> | null;
      // id 可以是空的：手寫的範圍檔可能還沒有識別碼。
      return typeof log?.id === 'string' && ['建立', '改', '提前結束'].includes(log.do ?? '') && wordList(log.units) ? null : '考試範圍的紀錄不完整';
    }
  }
}

/** 新寫入的值不符合那一種的契約的原因；符合是 null。評分與指紋由編碼後的讀回檢查。 */
function entryProblem(entry: NewEntry): string | null {
  if ('undo' in entry) return blank(entry.undo) ? 'undo 是空白' : null;
  if ('set' in entry) return changeProblem(entry);
  if (blank(entry.lt)) return 'lt 是空白';
  const rating: unknown = entry.r;
  return entry.src === 'mistake' && rating !== 'miss' ? '錯題補強一定是 miss' : null;
}

/**
 * 新寫入的一行（技術債「紀錄的時間跨啟動會撞」的 (a)）：值先符合那一種的契約，編碼後確認讀得回來；不合就丟錯，呼叫端不排進寫入。
 * 只管新寫入：舊紀錄照下面的 parseLine 寬鬆地讀，不因這裡收窄（study.test.ts 的 L2-5）。
 */
export function encodeNew(t: string, entry: NewEntry): string {
  const problem = entryProblem(entry);
  if (problem !== null) throw Error(`這筆紀錄不能寫（${problem}）：` + JSON.stringify(entry));
  const line = encodeEntry(t, entry);
  if (!parseLine(line)) throw Error('這筆紀錄不能寫（讀不回來）：' + line);
  return line;
}

/** 從完整 JSON 解析；壞 JSON 的尾段救回由 mergeHistory 處理並留下 problem。 */
export function parseLine(line: string): LogEntry | null {
  let value: unknown;
  try { value = JSON.parse(line.trim()); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.t !== 'string') return null;
  const time = parseTime(data.t);
  if (!time) return null;
  if (Object.hasOwn(data, 'undo')) {
    return typeof data.undo === 'string' && data.undo.length > 0 ? { kind: 'undo', t: data.t, at: time.at, offset: time.offset, undo: data.undo } : null;
  }
  if (Object.hasOwn(data, 'set')) {
    if (typeof data.set !== 'string' || !data.set || !Object.hasOwn(data, 'val')) return null;
    if (data.deck != null && typeof data.deck !== 'string' || data.lt != null && typeof data.lt !== 'string') return null;
    if (data.set === 'status') {
      if (Object.hasOwn(data, 'deck') === Object.hasOwn(data, 'lt')) return null;
      const target = Object.hasOwn(data, 'deck') ? data.deck : data.lt;
      if (typeof target !== 'string' || !target.trim()) return null;
    }
    return { kind: 'change', t: data.t, at: time.at, offset: time.offset, set: data.set, deck: data.deck as string | null ?? null, lt: data.lt as string | null ?? null, val: data.val };
  }
  if (typeof data.lt !== 'string' || !data.lt || !['easy', 'good', 'near', 'miss'].includes(data.r as string)) return null;
  if (data.src != null && typeof data.src !== 'string') return null;
  if (typeof data.v !== 'string' && !(data.src === 'mistake' && data.v == null)) return null;
  return { kind: 'review', t: data.t, at: time.at, offset: time.offset, lt: data.lt, r: data.r as Rating, v: data.v as string | null ?? null, typed: typeof data.typed === 'string' ? data.typed : null, src: data.src as string | null ?? null };
}
