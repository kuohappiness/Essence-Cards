import type { Files } from '../files.ts';
import { parseLine } from './entries.ts';
import { LOG_FOLDER } from './log.ts';
import type { History, ReviewEntry } from './types.ts';

// 設定值可能是物件；欄位順序不同仍然是相同的值，陣列順序則保留。
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, canonical(object[key])]));
  }
  return value;
}

export function mergeHistory(sources: readonly { path: string; text: string }[]): History {
  const history: History = { reviews: [], changes: [], problems: [] };
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
          const key = JSON.stringify({ ...entry, val: canonical(entry.val) });
          if (!seenChanges.has(key)) { seenChanges.add(key); history.changes.push(entry); }
          continue;
        }
        const previous = seenReviews.get(entry.t);
        if (previous) {
          const same = (other: ReviewEntry) => other.lt === entry.lt && other.r === entry.r && other.v === entry.v && other.typed === entry.typed && other.src === entry.src;
          if (same(previous)) continue;
          const others = collisions.get(entry.t);
          if (others?.some(same)) continue;
          if (others) others.push(entry);
          else collisions.set(entry.t, [entry]);
        } else seenReviews.set(entry.t, entry);
        history.reviews.push(entry);
      }
    }
  }
  history.reviews = history.reviews.filter(entry => !cancelled.has(entry.t)).sort((a, b) => a.at - b.at);
  history.changes.sort((a, b) => a.at - b.at);
  return history;
}

export async function readHistory(files: Files): Promise<History> {
  const prefix = LOG_FOLDER + '/';
  const paths = (await files.list(LOG_FOLDER)).filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && path.endsWith('.jsonl'));
  const sources = await Promise.all(paths.map(async path => ({ path, text: await files.read(path) ?? '' })));
  return mergeHistory(sources);
}
