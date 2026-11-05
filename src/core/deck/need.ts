import { isMap, isScalar, parseDocument } from 'yaml';
import { linesOf } from './markdown.ts';
import { frontmatterLines, parseDeck } from './parse.ts';
import type { Deck } from './types.ts';

// 卡組的 `需要版本`（tasks/question-type-seam.md §3、D-191）：第一個會寫它的功能是點選填空。讀的一方在 parse.ts 與 core/version。

const KEY = '需要版本';

interface Frontmatter { start: number; close: number; body: string }

/** 屬性區的位置：沒有屬性區是 null，有開頭沒結束是 'unclosed'（Obsidian 當成一般文字，不知道該加在哪裡）。 */
function frontmatter(text: string): Frontmatter | 'unclosed' | null {
  const lines = linesOf(text);
  const bounds = frontmatterLines(lines);
  if (bounds === null || bounds === 'unclosed') return bounds;
  const offset = (line: number): number => lines.slice(0, line).reduce((sum, each) => sum + each.raw.length + each.eol.length, 0);
  const start = offset(1), close = offset(bounds.close);
  return { start, close, body: text.slice(start, close) };
}

/** 屬性區的值；YAML 寫壞、最上層不是對照表是 null。 */
function values(raw: string): Record<string, unknown> | null {
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length) return null;
    const data: unknown = doc.toJS();
    if (data === null) return {};
    return typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch { return null; } // 別名展開過多之類：toJS 會丟錯，和寫壞一樣不動。
}

const others = (props: Record<string, unknown>): string => JSON.stringify(Object.entries(props).filter(([key]) => key !== KEY));
/** 除了標記之外，這篇讀起來是什麼：屬性（解析看到的）與每個目標的 ID、名稱、指紋。 */
const meaning = (deck: Deck): string => JSON.stringify([{ ...deck.props, need: null, issues: null }, deck.targets.map(t => [t.id, t.name, t.prompts.map(p => p.fingerprint)])]);

/**
 * 把 `需要版本` 設成 need：**先試再驗，不重新序列化**。沒有屬性區就建一個；YAML 解析得到這個鍵時只換它的值（用 YAML 給的位置，
 * 同一行的註解、鍵的寫法都留著）；否則加在屬性區最後一行。之後重新解析：標記要等於 need，其他屬性（含不認得的鍵）要逐一相同，
 * 每個目標的 ID、名稱、指紋要相同；不成立回 null，文字不動（單行對照表、共享錨點、區塊純量、重複的鍵、YAML 寫壞都是）。
 */
export function markNeed(text: string, need: string): string | null {
  const fm = frontmatter(text);
  if (fm === 'unclosed') return null;
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let next: string, before: Record<string, unknown> = {};
  if (fm === null) {
    next = `${bom}---${eol}${KEY}: ${need}${eol}---${eol}${text.slice(bom.length)}`;
  } else {
    const read = values(fm.body);
    if (read === null) return null;
    before = read;
    const doc = parseDocument(fm.body);
    const pair = isMap(doc.contents) ? doc.contents.items.find(item => isScalar(item.key) && item.key.value === KEY) : null;
    if (pair) {
      if (!isScalar(pair.value) || !pair.value.range) return null;
      const [from, to] = pair.value.range;
      next = text.slice(0, fm.start + from) + need + text.slice(fm.start + to);
    } else {
      next = text.slice(0, fm.close) + `${KEY}: ${need}${eol}` + text.slice(fm.close);
    }
  }
  const after = frontmatter(next);
  const read = after === null || after === 'unclosed' ? null : values(after.body);
  if (!read || read[KEY] !== need || others(read) !== others(before)) return null;
  const deck = parseDeck(next);
  return deck.props.need === need && meaning(deck) === meaning(parseDeck(text)) ? next : null;
}
