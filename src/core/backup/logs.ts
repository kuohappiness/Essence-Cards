import { isLogPath, LOG_FOLDER } from '../study/index.ts';
import { logSource } from './names.ts';

interface LogText { path: string; text: string }
/** 一個來源缺的行：照備份裡的順序，原樣（只去掉前後空白）。 */
export interface MissingLines { source: string; lines: string[] }

const byPath = (a: LogText, b: LogText): number => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const nameOf = (path: string): string => path.slice(LOG_FOLDER.length + 1);
const linesOf = (text: string): string[] => text.split('\n').map(line => line.trim()).filter(line => line !== '');

/**
 * 每個來源缺的行（syntax §5-3）：備份有、現在的來源檔與這個來源先前的還原檔都沒有的行；兩邊都先去掉前後空白再比，
 * 空行不算，壞行也算。備份那份的最後一行是現在某一行的開頭時（備份時正在寫那一行），不算缺。
 * 只看 `紀錄/` 直接底下的 .jsonl（isLogPath）；備份裡的還原檔，行算回它原來的來源。
 */
export function missingLogLines(backup: readonly LogText[], current: readonly LogText[]): MissingLines[] {
  const now = new Map<string, string[]>();
  for (const file of current) {
    if (!isLogPath(file.path)) continue;
    const source = logSource(nameOf(file.path));
    now.set(source, [...now.get(source) ?? [], ...linesOf(file.text)]);
  }
  const missing = new Map<string, Set<string>>();
  // 同一個來源的檔照路徑排：還原檔在來源檔前面，和合併時的順序相同。
  for (const file of [...backup].filter(file => isLogPath(file.path)).sort(byPath)) {
    const source = logSource(nameOf(file.path));
    const present = now.get(source) ?? [];
    const known = new Set(present);
    const lines = linesOf(file.text);
    const list = missing.get(source) ?? new Set<string>();
    lines.forEach((line, index) => {
      if (known.has(line)) return;
      if (index === lines.length - 1 && present.some(other => other.startsWith(line))) return;
      list.add(line);
    });
    missing.set(source, list);
  }
  return [...missing].filter(([, lines]) => lines.size > 0).map(([source, lines]) => ({ source, lines: [...lines] }));
}
