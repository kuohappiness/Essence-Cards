import { linesOf, nameIds, removeMiddle, TRAILING_ID } from './markdown.ts';
import { parseDeck } from './parse.ts';

/**
 * 把第 line 行那個學習目標的 ID 設成 id：拿掉那一行上其他的 ID 寫法（行尾的區塊 ID 與行中的程式格式 ID），放在行尾；
 * id 是 null 時只拿掉。那一行不是明確的學習目標（題目、implicit、一般筆記）時回傳 null（W5 §8-3）。
 */
export function setTargetId(text: string, line: number, id: string | null): string | null {
  if (id !== null && !/^[A-Za-z0-9-]+$/.test(id)) throw Error('學習目標 ID 只能有英數字與 -：' + id);
  if (!parseDeck(text).targets.some(target => target.line === line && !target.implicit)) return null;
  const lines = linesOf(text);
  const raw = lines[line].raw;
  const found = nameIds(raw);
  const bare = removeMiddle(found.trailing ? raw.slice(0, found.trailing.start) : raw, found.middle);
  lines[line] = { ...lines[line], raw: id === null ? bare : bare + ' ^' + id };
  return lines.map(each => each.raw + each.eol).join('');
}

/** 每一行行尾的區塊 ID（目標、題目、一般筆記都算）：還留在筆記裡的 ID 不算弄丟（W5 §8-5）。 */
export function blockIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of linesOf(text)) {
    const match = TRAILING_ID.exec(line.raw);
    if (match) ids.add(match[1]);
  }
  return ids;
}
