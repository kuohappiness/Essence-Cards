import { isAlias, isMap, isNode, isScalar, parseDocument } from 'yaml';
import { linesOf } from './markdown.ts';
import { frontmatterLines, parseDeck } from './parse.ts';

/** 改完讀回來要是這個狀態。 */
const READ_AS = { 暫停: 'paused', 啟用: 'active' } as const;

/** 屬性區的字：改完這個值或多一行。回傳 null 是這個寫法不能只改一行。source 的換行都是 \n 或 \r\n，位置和 raw 相同。 */
function editHead(raw: string, value: string, eol: string): string | null {
  const source = raw.replace(/\r(?!\n)/g, '\n');
  const doc = parseDocument(source);
  if (doc.errors.length) return null;
  let data: unknown;
  // 繞圈的 alias 到這裡才會丟錯。
  try { data = doc.toJS(); } catch { return null; }
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) return null;
  const pair = isMap(doc.contents) ? doc.contents.items.find(each => isScalar(each.key) && each.key.value === '狀態') : undefined;
  if (!pair) return raw + `狀態: ${value}` + eol;
  if (isAlias(pair.value)) return null;
  const keyEnd = isNode(pair.key) ? pair.key.range?.[1] : undefined;
  const range = isNode(pair.value) ? pair.value.range : undefined;
  if (keyEnd === undefined) return null;
  const end = range?.[1] ?? 0;
  if (!range || end <= range[0]) {
    const colon = source.indexOf(':', keyEnd) + 1;
    return raw.slice(0, colon) + ' ' + value + raw.slice(colon);
  }
  if (source.slice(range[0], end).includes('\n')) return null;
  // 引號留著：只換裡面的字。
  const style = isScalar(pair.value) ? pair.value.type : null;
  const quote = style === 'QUOTE_DOUBLE' ? '"' : style === 'QUOTE_SINGLE' ? "'" : '';
  return raw.slice(0, range[0]) + quote + value + quote + raw.slice(end);
}

/**
 * 把卡組屬性區的 `狀態` 改成這個值（D-183 第 6 點、tasks/quiz-practice.md §5）：只改這個值，別的字元都不動；沒有這一行放在屬性區最後，沒有屬性區就建一個。
 * 已經是這個值回傳原文。屬性區讀不懂（沒有結束、YAML 有錯、不是對照表），或這個寫法只改一行讀不回來，回傳 null，呼叫的人不寫。
 */
export function setDeckStatus(text: string, value: keyof typeof READ_AS): string | null {
  const lines = linesOf(text);
  const eol = lines.find(line => line.eol)?.eol ?? '\n';
  let result: string;
  const bounds = frontmatterLines(lines);
  if (bounds === null) {
    const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
    result = bom + ['---', `狀態: ${value}`, '---', ''].join(eol) + text.slice(bom.length);
  } else {
    if (bounds === 'unclosed') return null;
    const { close } = bounds;
    const whole = (from: number, to: number): string => lines.slice(from, to).map(line => line.raw + line.eol).join('');
    const head = editHead(whole(1, close), value, eol);
    if (head === null) return null;
    result = whole(0, 1) + head + whole(close, lines.length);
  }
  // 讀回來要是這個狀態，別的屬性與學習目標都不變（`{科目: 自然}` 這種寫法多一行就壞了；有 BOM、沒有屬性區的檔，第一個目標原本解析不到，加了屬性區會多出來）。
  const before = parseDeck(text), after = parseDeck(result);
  const others = ({ props, targets }: typeof before): string => JSON.stringify([{ ...props, status: null, issues: null }, targets.map(({ id, name, prompts }) => [id, name, prompts.map(prompt => prompt.fingerprint)])]);
  return after.props.status === READ_AS[value] && others(after) === others(before) ? result : null;
}
