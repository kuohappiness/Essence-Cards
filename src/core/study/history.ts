import type { Files } from '../files.ts';
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

export function mergeHistory(sources: readonly { path: string; text: string }[]): History {
  const history: History = { reviews: [], changes: [], problems: [], cancelled: [] };
  const cancelled = new Set<string>();
  const seenReviews = new Map<string, ReviewEntry>();
  const collisions = new Map<string, ReviewEntry[]>();
  const seenChanges = new Set<string>();
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
        let entry = parseLine(raw);
        if (!entry) {
          try { JSON.parse(raw); } catch {
            const start = raw.lastIndexOf('{"t":');
            if (start > 0) entry = parseLine(raw.slice(start));
          }
          history.problems.push({ path, line, message: entry ? '寫入中斷；已從行尾救回一筆紀錄' : '無法解析紀錄或缺少有效的必要欄位' });
        }
        if (!entry) continue;
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
  history.reviews = history.reviews.filter(entry => !cancelled.has(entry.t)).sort((a, b) => a.at - b.at);
  history.changes.sort((a, b) => a.at - b.at);
  history.cancelled = [...cancelled].sort();
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

export function appendLine(history: History, line: string): History {
  const entry = parseLine(line);
  if (!entry) throw Error('不是合法的一行紀錄：' + line);
  if (entry.kind === 'undo') {
    // mergeHistory 也取消所有檔案裡 t 相同的作答，包括之後才加進來的（記在 cancelled）。
    const known = history.cancelled.includes(entry.undo);
    const reviews = history.reviews.filter(review => review.t !== entry.undo);
    if (known && reviews.length === history.reviews.length) return history;
    return { ...history, reviews, cancelled: known ? history.cancelled : [...history.cancelled, entry.undo].sort() };
  }
  if (entry.kind === 'change') {
    const key = changeKey(entry);
    if (history.changes.some(change => changeKey(change) === key)) return history;
    const changes = [...history.changes];
    changes.splice(firstAfter(changes, entry.at), 0, entry);
    return { ...history, changes };
  }
  if (history.cancelled.includes(entry.t)) return history;
  // t 相同時 at 也相同，只要看 at 相同的那一段。
  const end = firstAfter(history.reviews, entry.at);
  for (let i = end - 1; i >= 0 && history.reviews[i].at === entry.at; i--) {
    if (history.reviews[i].t === entry.t && sameReview(history.reviews[i], entry)) return history;
  }
  const reviews = [...history.reviews];
  reviews.splice(end, 0, entry);
  return { ...history, reviews };
}

export async function readHistory(files: Files): Promise<History> {
  const paths = (await files.list(LOG_FOLDER)).filter(isLogPath);
  const sources = await Promise.all(paths.map(async path => ({ path, text: await files.read(path) ?? '' })));
  return mergeHistory(sources);
}
