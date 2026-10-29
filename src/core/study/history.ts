import type { Files } from '../files.ts';
import { canRead } from '../version/index.ts';
import { parseLine } from './entries.ts';
import { LOG_FOLDER } from './log.ts';
import type { ChangeEntry, History, ReviewEntry } from './types.ts';

// 設定值可能是物件；欄位順序不同仍然是相同的值，陣列順序則保留。
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, canonical(object[key])]));
  }
  return value;
}

const changeKey = (entry: ChangeEntry): string => JSON.stringify({ ...entry, val: canonical(entry.val) });
// t 相同時，這幾欄也相同才算同一筆（iCloud 衝突副本）；不同就兩筆都留。
const sameReview = (a: ReviewEntry, b: ReviewEntry): boolean => a.lt === b.lt && a.r === b.r && a.v === b.v && a.typed === b.typed && a.src === b.src;

export function isLogPath(path: string): boolean {
  const name = path.startsWith(LOG_FOLDER + '/') ? path.slice(LOG_FOLDER.length + 1) : '';
  return name.endsWith('.jsonl') && !name.includes('/');
}

const ltOf = (value: unknown): string | null =>
  value && typeof value === 'object' && typeof (value as { lt?: unknown }).lt === 'string' ? (value as { lt: string }).lt : null;
/**
 * 壞掉的行裡寬鬆找到的 lt（History.seen）：整行照 JSON 讀（空白、跳脫的鍵名都算）、每一段 `{"t":` 開頭的尾段
 * 照 JSON 讀（救回的就是最後一段）、再用 `"lt": "…"` 找字串。
 */
function looseLts(line: string): string[] {
  const ids: string[] = [];
  const add = (id: string | null): void => { if (id !== null) ids.push(id); };
  try { add(ltOf(JSON.parse(line))); } catch { /* 寫入中斷的行：下面一段一段找 */ }
  for (let at = line.indexOf('{"t":', 1); at > 0; at = line.indexOf('{"t":', at + 1)) {
    try { add(ltOf(JSON.parse(line.slice(at)))); } catch { /* 這一段也壞了 */ }
  }
  for (const match of line.matchAll(/"lt"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try { add(JSON.parse('"' + match[1] + '"') as string); } catch { /* 字串本身壞了 */ }
  }
  return ids;
}
/** 合法的取消行多帶的 lt（parseLine 不讀它，取消的意思不變）也算出現過（Codex state-load L2 的 F1）。 */
function undoLt(line: string): string | null {
  try { return ltOf(JSON.parse(line)); } catch { return null; }
}
/** 照字串排序、不重複地加一個；已經有了就回傳同一個陣列。 */
function withSeen(seen: string[], id: string | null): string[] {
  if (id === null) return seen;
  let low = 0, high = seen.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (seen[middle] < id) low = middle + 1;
    else high = middle;
  }
  return seen[low] === id ? seen : [...seen.slice(0, low), id, ...seen.slice(low)];
}

/**
 * 帶 need 的一行（JSON 物件、自己有 need 這一欄）的欄位；沒有就是 null。先用原文篩掉一般的行：鍵名可能寫成跳脫的
 * `need`，所以含 `\u` 的也解析。
 */
function needed(raw: string): Record<string, unknown> | null {
  if (!raw.includes('need') && !raw.includes('\\u')) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  return value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'need') ? value as Record<string, unknown> : null;
}

/**
 * 合併所有紀錄檔（syntax.md §5）。version 是這台的正式版號（§0-1），用來判斷 need 讀不讀得懂；null 是版本不明，
 * 任何 need 都讀不懂。讀不懂的行（§5-2）先於其他欄位檢查：不取消、不排程、不算變更，只停掉它影響的學習目標（held），
 * 辨認不出影響範圍時整份不完整（incomplete）；行裡寬鬆找到的 lt 照樣收進 seen。
 */
export function mergeHistory(sources: readonly { path: string; text: string }[], version: string | null = null): History {
  const history: History = { reviews: [], changes: [], problems: [], cancelled: [], seen: [], held: [], incomplete: false };
  const seen = new Set<string>();
  const cancelled = new Set<string>();
  const seenReviews = new Map<string, ReviewEntry>();
  const collisions = new Map<string, ReviewEntry[]>();
  const seenChanges = new Set<string>();
  const held = new Set<string>();
  /** 讀不懂的行的 undo：全部讀完才找得到它指的作答（可能在別的檔、排在後面）。 */
  const heldUndo: string[] = [];
  /** 讀不懂的那一行停掉哪些目標（§5-2 的三個條件）；任何一條不成立就整份不完整。 */
  function hold(data: Record<string, unknown>): void {
    const hasLt = Object.hasOwn(data, 'lt'), hasUndo = Object.hasOwn(data, 'undo');
    if (!hasLt && !hasUndo) history.incomplete = true;
    if (hasLt) {
      if (typeof data.lt === 'string' && data.lt.trim()) held.add(data.lt);
      else history.incomplete = true;
    }
    if (hasUndo) {
      if (typeof data.undo === 'string' && data.undo) heldUndo.push(data.undo);
      else history.incomplete = true;
    }
  }
  const unreadable = (raw: string): Record<string, unknown> | null => {
    const data = needed(raw);
    return data && !canRead(data.need, version) ? data : null;
  };
  // 先按路徑、行號、trim 原文處理，再穩定排序時間，保留全部 tie-break。
  const ordered = [...sources].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (let source = 0; source < ordered.length;) {
    const path = ordered[source].path;
    const contents: string[][] = [];
    do { contents.push(ordered[source++].text.split('\n')); } while (ordered[source]?.path === path);
    const length = Math.max(...contents.map(lines => lines.length));
    // 同一路徑的多份來源也按行號交錯，不能讓第二份的第 0 行排到第 1 行後面。
    for (let line = 0; line < length; line++) {
      if (contents.length > 1) contents.sort((a, b) => {
        const left = a[line]?.trim() ?? '', right = b[line]?.trim() ?? '';
        return left < right ? -1 : left > right ? 1 : 0;
      });
      for (const lines of contents) {
        const raw = lines[line]?.trim();
        if (!raw) continue;
        const later = unreadable(raw);
        if (later) {
          for (const id of looseLts(raw)) seen.add(id);
          hold(later);
          continue;
        }
        let entry = parseLine(raw);
        if (!entry) {
          for (const id of looseLts(raw)) seen.add(id);
          let message = '無法解析紀錄或缺少有效的必要欄位';
          try { JSON.parse(raw); } catch {
            const start = raw.lastIndexOf('{"t":');
            // 從行尾救回的那一段也先看 need（§5-2）。
            const tail = start > 0 ? raw.slice(start) : null, late = tail === null ? null : unreadable(tail);
            if (late) { hold(late); message = '寫入中斷；行尾救回的那一筆需要新版才讀得懂'; }
            else if (tail !== null) entry = parseLine(tail);
            if (entry) message = '寫入中斷；已從行尾救回一筆紀錄';
          }
          history.problems.push({ path, line, message });
        }
        if (!entry) continue;
        const lt = entry.kind === 'undo' ? undoLt(raw) : entry.lt;
        if (lt !== null) seen.add(lt);
        if (entry.kind === 'undo') { cancelled.add(entry.undo); continue; }
        if (entry.kind === 'change') {
          const key = changeKey(entry);
          if (!seenChanges.has(key)) { seenChanges.add(key); history.changes.push(entry); }
          continue;
        }
        const previous = seenReviews.get(entry.t);
        if (previous) {
          if (sameReview(previous, entry)) continue;
          const others = collisions.get(entry.t);
          if (others?.some(other => sameReview(other, entry))) continue;
          if (others) others.push(entry);
          else collisions.set(entry.t, [entry]);
        } else seenReviews.set(entry.t, entry);
        history.reviews.push(entry);
      }
    }
  }
  // undo 指到的作答：所有檔案裡 t 相同的（被取消的也算）；一筆都沒有就辨認不出來。
  for (const t of heldUndo) {
    const first = seenReviews.get(t);
    if (!first) { history.incomplete = true; continue; }
    for (const entry of [first, ...collisions.get(t) ?? []]) held.add(entry.lt);
  }
  history.reviews = history.reviews.filter(entry => !cancelled.has(entry.t)).sort((a, b) => a.at - b.at);
  history.changes.sort((a, b) => a.at - b.at);
  history.cancelled = [...cancelled].sort();
  history.seen = [...seen].sort();
  history.held = [...held].sort();
  return history;
}

/** 第一筆 at 大於 time 的位置：同一個 at 的新一筆排在既有的後面，和 mergeHistory 的穩定排序一致。 */
function firstAfter(list: readonly { at: number }[], time: number): number {
  let low = 0, high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (list[middle].at <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * 自己剛寫的一行併進 history，結果和重新 mergeHistory 相同。held、incomplete 照舊：自己寫的行不帶 need
 * （現在沒有寫入端，syntax.md §0-1），帶 need 的行要整份重新合併才知道讀不讀得懂。
 */
export function appendLine(history: History, line: string): History {
  if (needed(line)) throw Error('帶 need 的行要整份重新合併，不能直接追加：' + line);
  const entry = parseLine(line);
  if (!entry) throw Error('不是合法的一行紀錄：' + line);
  // 被取消或重複而不加進去的作答、取消行多帶的 lt，也算出現過（和 mergeHistory 相同）。
  const seen = withSeen(history.seen, entry.kind === 'undo' ? undoLt(line) : entry.lt);
  const base = seen === history.seen ? history : { ...history, seen };
  if (entry.kind === 'undo') {
    // mergeHistory 也取消所有檔案裡 t 相同的作答，包括之後才加進來的（記在 cancelled）。
    const known = history.cancelled.includes(entry.undo);
    const reviews = history.reviews.filter(review => review.t !== entry.undo);
    if (known && reviews.length === history.reviews.length) return base;
    return { ...base, reviews, cancelled: known ? history.cancelled : [...history.cancelled, entry.undo].sort() };
  }
  if (entry.kind === 'change') {
    const key = changeKey(entry);
    if (history.changes.some(change => changeKey(change) === key)) return base;
    const changes = [...history.changes];
    changes.splice(firstAfter(changes, entry.at), 0, entry);
    return { ...base, changes };
  }
  if (history.cancelled.includes(entry.t)) return base;
  // t 相同時 at 也相同，只要看 at 相同的那一段。
  const end = firstAfter(history.reviews, entry.at);
  for (let i = end - 1; i >= 0 && history.reviews[i].at === entry.at; i--) {
    if (history.reviews[i].t === entry.t && sameReview(history.reviews[i], entry)) return base;
  }
  const reviews = [...history.reviews];
  reviews.splice(end, 0, entry);
  return { ...base, reviews };
}

/** version 同 mergeHistory：這台的正式版號，不傳是版本不明。 */
export async function readHistory(files: Files, version: string | null = null): Promise<History> {
  const paths = (await files.list(LOG_FOLDER)).filter(isLogPath);
  const sources = await Promise.all(paths.map(async path => ({ path, text: await files.read(path) ?? '' })));
  return mergeHistory(sources, version);
}
