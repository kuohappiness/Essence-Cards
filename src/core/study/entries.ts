import { parseTime } from './time.ts';
import type { LogEntry, NewEntry, Rating } from './types.ts';

export function encodeEntry(t: string, entry: NewEntry): string {
  if ('undo' in entry) return JSON.stringify({ t, undo: entry.undo });
  if ('set' in entry) {
    return JSON.stringify({ t, set: entry.set, ...('deck' in entry ? { deck: entry.deck } : 'lt' in entry ? { lt: entry.lt } : {}), val: entry.val });
  }
  // 欄位順序 t, lt, r, v, typed, pick, retry, also, with, src（syntax.md §5、tasks/question-type-seam.md §4）。
  return JSON.stringify({ t, lt: entry.lt, r: entry.r, ...('v' in entry ? { v: entry.v } : {}),
    ...('typed' in entry && entry.typed ? { typed: entry.typed } : {}),
    ...('pick' in entry && entry.pick !== undefined ? { pick: entry.pick } : {}),
    ...('retry' in entry && entry.retry ? { retry: entry.retry } : {}),
    ...('also' in entry && entry.also?.length ? { also: entry.also.map(({ v, r, pick, retry }) => ({ v, r, pick, ...(retry ? { retry } : {}) })) } : {}),
    ...('with' in entry && entry.with ? { with: entry.with } : {}),
    ...(entry.src ? { src: entry.src } : {}) });
}

/** also 裡的指紋：形狀不對就當沒有（pick、retry 與 also 的其他欄位只是證據，不讀）。 */
function alsoOf(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const cells = value as unknown[];
  const prints = cells.map(cell => cell !== null && typeof cell === 'object' ? (cell as { v?: unknown }).v : null);
  return prints.every(print => typeof print === 'string') ? prints : null;
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
  const also = alsoOf(data.also);
  return { kind: 'review', t: data.t, at: time.at, offset: time.offset, lt: data.lt, r: data.r as Rating, v: data.v as string | null ?? null, typed: typeof data.typed === 'string' ? data.typed : null, src: data.src as string | null ?? null,
    ...(typeof data.with === 'string' ? { with: data.with } : {}), ...(also ? { also } : {}) };
}
