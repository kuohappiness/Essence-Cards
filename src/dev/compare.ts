import { parseDeck } from '../core/deck/index.ts';

/** metadataCache 的一個清單項目：開始與結束的行（0 起算）、上層項目的行（負數是最上層）、區塊 ID。 */
export interface ListItem { line: number; end: number; parent: number; id?: string }
/** 一筆不一致；rule 對應 W5 說明 §0-3 的 (a)～(e)。 */
export interface Mismatch { rule: 'a' | 'b' | 'c' | 'd' | 'e'; line: number; detail: string }

const fieldNames = /^(出處|類型|重要性|狀態|備註|錯題補強)\s*[:：]/;
// 最上層項目的 parent 是負數（Windows 版 1.14.4 實測：第 0 行開始的清單是 -1）。
const root = (item: ListItem): boolean => item.parent < 0;
const marker = /^\s*(?:[-*+]|\d+[.)])(?:\s+|$)/;

/** 拿掉圍欄程式碼（含圍欄那兩行）；項目自己開的 `- ~~~` 也算。 */
function withoutFences(content: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of content.split('\n')) {
    const body = line.replace(marker, '').trimStart();
    const open = /^(`{3,}|~{3,})/.exec(body)?.[1];
    if (fence !== null) {
      if (open && open[0] === fence[0] && open.length >= fence.length && body.slice(open.length).trim() === '') fence = null;
    } else if (open) fence = open;
    else kept.push(line);
  }
  return kept.join('\n');
}

/** 去掉清單符號、圍欄、行內程式碼與公式之後，還有 `::` 或 `==`，而且不是六個欄位之一。 */
function questionLike(content: string): boolean {
  const plain = withoutFences(content).replace(marker, '')
    .replace(/(`+)[\s\S]*?\1/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$\n]*\$/g, '');
  return /::|==/.test(plain) && !fieldNames.test(plain.trim());
}

/**
 * 拿 parseDeck 的結果和 Obsidian 的 listItems 比對（W5 說明 §0-3）。
 * 引言框裡的項目先拿掉。(a) 照字面「目標的行＝最上層項目的行」會把沒有題目的一般清單也算進去
 * （D-089 #12 不產生目標），所以分成兩半：目標一定是最上層項目；最上層項目本身像題目、
 * 或底下有像題目的項目時，一定是目標。轉錄稿不比 (a) 的後半（全部清單本來就不當卡組）。
 */
export function compareLists(text: string, listItems: readonly ListItem[]): Mismatch[] {
  const lines = text.split(/\r\n|\r|\n/);
  const items = listItems.filter(item => !(lines[item.line] ?? '').trimStart().startsWith('>'));
  const starts = items.map(item => item.line).sort((a, b) => a - b);
  const byLine = new Map(items.map(item => [item.line, item]));
  function content(item: ListItem): string {
    const next = starts.find(line => line > item.line) ?? Infinity;
    return lines.slice(item.line, Math.min(item.end, next - 1) + 1).join('\n');
  }
  const children = (line: number) => items.filter(item => item.parent === line);
  const deck = parseDeck(text);
  const mismatches: Mismatch[] = [];
  const report = (rule: Mismatch['rule'], line: number, detail: string): void => { mismatches.push({ rule, line, detail }); };

  const targetLines = new Set(deck.targets.map(target => target.line));
  for (const target of deck.targets) {
    const item = byLine.get(target.line);
    if (!item || !root(item)) report('a', target.line, '目標不是最上層的清單項目');
  }
  if (!deck.props.isTranscript) {
    for (const item of items) {
      if (!root(item) || targetLines.has(item.line)) continue;
      if (questionLike(content(item)) || children(item.line).some(child => questionLike(content(child)))) {
        report('a', item.line, '最上層項目有題目，但不是目標');
      }
    }
  }

  for (const target of deck.targets) {
    if (target.id !== null && byLine.get(target.line)?.id !== target.id) {
      report('d', target.line, 'ID 不同：解析 ' + target.id + '，metadataCache ' + String(byLine.get(target.line)?.id));
    }
    // 寫錯的目標（ok 是 false）也照比：parseDeck 仍保留它的題目，結構一樣要對（比 W5 說明 §0-3 嚴）。
    // implicit 目標的題目就是目標那一行（parseDeck 照這樣建），由 (a) 檢查它是最上層項目。
    if (target.implicit) continue;
    const promptLines = new Set(target.prompts.map(prompt => prompt.line));
    for (const prompt of target.prompts) {
      const item = byLine.get(prompt.line);
      if (!item) report('b', prompt.line, '題目不是清單項目');
      else if (item.parent !== target.line) report('b', prompt.line, '題目的上層是第 ' + String(item.parent) + ' 行，不是目標');
    }
    for (const child of children(target.line)) {
      if (questionLike(content(child)) && !promptLines.has(child.line)) report('c', child.line, '目標底下像題目的項目沒有出題');
    }
  }
  return mismatches.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** (e) 補 ID 之後的筆記：(a)～(d) 照樣比，而且除了 W2 刻意跳過的 implicit，每個目標都有 ID。 */
export function compareAssigned(text: string, listItems: readonly ListItem[]): Mismatch[] {
  const missing: Mismatch[] = parseDeck(text).targets
    .filter(target => target.id === null && !target.implicit)
    .map(target => ({ rule: 'e' as const, line: target.line, detail: '補 ID 之後仍沒有 ID' }));
  return [...compareLists(text, listItems), ...missing].sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
