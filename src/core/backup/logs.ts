import { isLogPath, LOG_FOLDER, readablePieces } from '../study/index.ts';
import { logSource } from './names.ts';

interface LogText { path: string; text: string }
/** 一個來源缺的行：照備份裡的順序，原樣（只去掉前後空白）。 */
export interface MissingLines { source: string; lines: string[] }

const byPath = (a: LogText, b: LogText): number => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const nameOf = (path: string): string => path.slice(LOG_FOLDER.length + 1);
interface Line { text: string; /** 這一行裡有 NUL，這是切出來的一段。 */ piece: boolean }
// NUL 是沒下載完的內容（D-154 第 4 點）：寫進還原檔會讓整個檔變成讀不到。當成斷行：完整的物件留下，被截斷的兩邊各是一段壞行，不會拼出備份裡沒有的作答（L2 的 R14）。
const linesOf = (text: string): Line[] => text.split('\n').flatMap(raw => {
  const piece = raw.includes('\0');
  return raw.split('\0').map(line => line.trim()).filter(line => line !== '').map(line => ({ text: line, piece }));
});
/** 這段文字裡重播讀得到的紀錄（syntax §5-2）：字面上看得到不算，要真的讀得出來（L2 的 R22）。 */
const recordsOf = (text: string): string[] => readablePieces(text).filter(piece => {
  try { JSON.parse(piece); return true; } catch { return false; }
});

/**
 * 每個來源缺的行（syntax §5-3）：備份有、現在的來源檔與這個來源先前的還原檔都沒有的行；兩邊都先去掉前後空白再比，
 * 空行不算，其他壞行也算；NUL 當成斷行，切出來的一段裡有紀錄的看重播讀不讀得到，沒有紀錄的片段在現在某一行裡就不算缺（syntax §5-3）。備份那份的最後一行是現在某一行的開頭時（備份時正在寫那一行），不算缺。
 * 只看 `紀錄/` 直接底下的 .jsonl（isLogPath）；備份裡的還原檔，行算回它原來的來源。
 */
export function missingLogLines(backup: readonly LogText[], current: readonly LogText[]): MissingLines[] {
  const now = new Map<string, string[]>();
  for (const file of current) {
    if (!isLogPath(file.path)) continue;
    const source = logSource(nameOf(file.path));
    now.set(source, [...now.get(source) ?? [], ...linesOf(file.text).map(line => line.text)]);
  }
  const missing = new Map<string, Set<string>>();
  // 同一個來源的檔照路徑排：還原檔在來源檔前面，和合併時的順序相同。
  for (const file of [...backup].filter(file => isLogPath(file.path)).sort(byPath)) {
    const source = logSource(nameOf(file.path));
    const present = now.get(source) ?? [];
    const known = new Set(present);
    const readable = new Set(present.flatMap(recordsOf));
    const lines = linesOf(file.text);
    const list = missing.get(source) ?? new Set<string>();
    lines.forEach(({ text, piece }, index) => {
      if (known.has(text)) return;
      if (piece) {
        const records = recordsOf(text);
        if (records.length ? records.every(record => readable.has(record)) : present.some(other => other.includes(text))) return;
      }
      if (index === lines.length - 1 && present.some(other => other.startsWith(text))) return;
      list.add(text);
    });
    missing.set(source, list);
  }
  return [...missing].filter(([, lines]) => lines.size > 0).map(([source, lines]) => ({ source, lines: [...lines] }));
}
