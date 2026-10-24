/** 保留每一行的原文與換行，寫回時不用重新序列化 Markdown。 */
export interface Line { raw: string; eol: string }
export interface Item {
  line: number;
  end: number;
  indent: number;
  contentColumn: number;
  text: string;
  children: Item[];
  section: string | null;
}
export function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (const match of text.matchAll(pattern)) {
    if (match[0] === '') break;
    lines.push({ raw: match[1], eol: match[2] });
  }
  return lines;
}
export function expandTabs(text: string): string {
  let expanded = '';
  for (const ch of text) expanded += ch === '\t' ? ' '.repeat(4 - expanded.length % 4) : ch;
  return expanded;
}
export function stripId(text: string): { text: string; id: string | null } {
  const newline = text.indexOf('\n');
  const head = newline < 0 ? text : text.slice(0, newline);
  const match = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/.exec(head);
  return match ? { text: head.slice(0, match.index) + (newline < 0 ? '' : text.slice(newline)), id: match[1] } : { text, id: null };
}
/** 相同長度的遮罩，保留 cloze 在原文裡的 UTF-16 位置。 */
function maskInline(text: string): string {
  const markers = /`+|\${1,2}/g;
  let masked = '', cursor = 0;
  for (let match = markers.exec(text); match; match = markers.exec(text)) {
    const marker = match[0], after = match.index + marker.length;
    let close = -1;
    if (marker[0] === '`') {
      const runs = /`+/g;
      runs.lastIndex = after;
      for (let end = runs.exec(text); end; end = runs.exec(text)) {
        if (end[0].length === marker.length) { close = end.index; break; }
      }
    } else {
      close = text.indexOf(marker, after);
      if (marker === '$' && close >= 0 && text.slice(after, close).includes('\n')) close = -1;
    }
    if (close < 0) continue;
    const end = close + marker.length;
    masked += text.slice(cursor, match.index) + '\u0000'.repeat(end - match.index);
    cursor = end;
    markers.lastIndex = end;
  }
  return masked + text.slice(cursor);
}
/** 行尾的區塊 ID（家長自訂的也算）。 */
export const TRAILING_ID = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
// 程式產生的 ID：前面是行首或空白，6 碼指定字母表，後面不是英數字或 -（D-134）。
const programId = /(?<=^|[ \t])\^([abcdefghjkmnpqrstuvwxyz23456789]{6})(?![A-Za-z0-9-])/g;
/** 相同長度的遮罩：[[連結]] 與 [文字](網址) 裡的字不算。 */
function maskLinks(text: string): string {
  return text.replace(/\[\[[^\]\n]*\]\]|\[[^\]\n]*\]\([^)\n]*\)/g, match => '\u0000'.repeat(match.length));
}
export interface NameIds {
  /** 行尾的區塊 ID；start 是它前面空白的開頭。 */
  trailing: { id: string; start: number } | null;
  /** 行中的程式格式 ID（不在行內程式碼、公式、連結裡）；[start, end) 含它前面的空白，拿掉後不留雙空白。 */
  middle: { id: string; start: number; end: number }[];
}
/** 學習目標名稱那一行的 ID 寫法（W5 §8-4）。只給目標名稱用，題目與答案的正文不套用。 */
export function nameIds(line: string): NameIds {
  const trail = TRAILING_ID.exec(line);
  const limit = trail ? trail.index : line.length;
  const middle: NameIds['middle'] = [];
  for (const match of maskLinks(maskInline(line)).matchAll(programId)) {
    if (match.index >= limit) break;
    let start = match.index;
    while (start > 0 && (line[start - 1] === ' ' || line[start - 1] === '\t')) start--;
    let end = match.index + match[0].length;
    // 在行首（前面沒有空白）時，連同後面的空白一起拿掉。
    if (start === match.index) while (end < limit && (line[end] === ' ' || line[end] === '\t')) end++;
    middle.push({ id: match[1], start, end });
  }
  return { trailing: trail ? { id: trail[1], start: trail.index } : null, middle };
}
/** 拿掉行中的候選（由後往前，保留其他字）。 */
export function removeMiddle(line: string, middle: NameIds['middle']): string {
  let result = line;
  for (const { start, end } of [...middle].reverse()) result = result.slice(0, start) + result.slice(end);
  return result;
}
export function questionSyntax(text: string): { colon: number; blanks: { start: number; end: number }[] } {
  const masked = maskInline(text);
  return {
    colon: masked.indexOf('::'),
    blanks: [...masked.matchAll(/==([^=\n]+)==/g)].map(match => ({ start: match.index, end: match.index + match[0].length })),
  };
}
export function listTree(lines: Line[], start: number): Item[] {
  const roots: Item[] = [], stack: Item[] = [];
  let section: string | null = null;
  let fence: { char: string; count: number; contentColumn: number } | null = null;
  // 上一行是哪個項目的段落文字；下一行沒有空行又縮排不夠時，照 CommonMark 接在這段後面（Obsidian 相同，W5 對照）。
  let paragraph: Item | null = null;
  // 項目裡的分隔線或圍欄之後：Obsidian 的閱讀模式把縮排不夠的下一行留在同一個項目裡當一般段落，清單沒有結束
  // （2026-10-25 對照，Codex 審查 W5 的 F1）。這種行不接進名稱或題目，後面的題目仍屬於同一個目標。
  let inside = false;
  const extend = (line: number): void => { for (const item of stack) item.end = line + 1; };
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i].raw;
    const expanded = expandTabs(raw);
    const indent = expanded.match(/^ */)![0].length;
    const trimmed = expanded.trimStart();
    // 清單容器已結束時，這一行必須重新判斷，不能延伸到前一個目標的 end。
    if (fence && trimmed && indent < fence.contentColumn) fence = null;
    if (fence) {
      extend(i);
      if (new RegExp('^' + fence.char + '{' + fence.count + ',}\\s*$').test(trimmed)) fence = null;
      continue;
    }
    // 引言框在某一項的內容裡時，只結束比它深的項目，後面的題目仍屬於同一個目標。
    if (/^>/.test(trimmed)) {
      paragraph = null; inside = false;
      while (stack.length && indent < stack.at(-1)!.contentColumn) stack.pop();
      if (stack.length) extend(i);
      continue;
    }
    const opening = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      let container = stack.length - 1;
      while (container >= 0 && indent < stack[container].contentColumn) container--;
      if (container >= 0 || indent < 4) {
        paragraph = null; inside = container >= 0;
        stack.length = container + 1;
        extend(i);
        fence = { char: opening[1][0], count: opening[1].length, contentColumn: stack.at(-1)?.contentColumn ?? 0 };
        continue;
      }
    }
    if (!trimmed) { paragraph = null; inside = false; continue; }
    const heading = /^(#{1,6})(?:\s+(.*)|$)/.exec(trimmed);
    // 只有不在任何項目內容裡的標題才分組；在項目內容裡的是那一項的文字。
    if (heading && indent < 4 && (!stack.length || indent < stack[0].contentColumn)) {
      section = (heading[2] ?? '').replace(/\s+#+\s*$/, '').trim(); stack.length = 0; paragraph = null; inside = false; continue;
    }
    const thematic = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(trimmed);
    // 標題與分隔線（相對所屬項目縮排不到 4 欄）是自己的區塊：打斷段落，`- - -` 也不是清單項目（CommonMark 4.1）。
    const breaks = (heading !== null || thematic) && indent - ([...stack].reverse().find(item => item.contentColumn <= indent)?.contentColumn ?? 0) < 4;
    // CommonMark：1～4 欄間隔都屬於符號；超過 4 欄只取一欄。
    const match = breaks ? null : /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/.exec(expanded);
    if (match) {
      while (stack.length && indent < stack.at(-1)!.contentColumn) stack.pop();
      if (!stack.length && indent >= 4) continue;
      extend(i);
      const gap = match[3].length > 4 ? 1 : Math.max(1, match[3].length);
      // 只展開縮排；正文中的 Tab 仍是原文。
      const body = raw.replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*/, '');
      const itemFence = /^(`{3,}|~{3,})(.*)$/.exec(body);
      if (itemFence && !(itemFence[1][0] === '`' && itemFence[2].includes('`'))) {
        paragraph = null; inside = true;
        fence = { char: itemFence[1][0], count: itemFence[1].length, contentColumn: indent + match[2].length + gap };
        continue;
      }
      const item: Item = { line: i, end: i + 1, indent, contentColumn: indent + match[2].length + gap,
        text: body.trimEnd(), children: [], section };
      (stack.at(-1)?.children ?? roots).push(item);
      stack.push(item);
      paragraph = body.trim() ? item : null; inside = false;
    } else if (paragraph && !breaks) {
      // 段落的延續行，縮排不夠也一樣。
      paragraph.text += '\n' + raw.trim();
      extend(i);
    } else if (inside && !breaks && stack.length && indent < stack.at(-1)!.contentColumn) {
      extend(i);
    } else {
      while (stack.length && indent < stack.at(-1)!.contentColumn) stack.pop();
      if (stack.length) {
        stack.at(-1)!.text += '\n' + raw.trim();
        extend(i);
        // 標題與分隔線之後沒有段落可以延續；分隔線之後縮排不夠的行仍留在這個項目裡。
        paragraph = heading || thematic ? null : stack.at(-1)!;
        inside = thematic;
      } else { stack.length = 0; paragraph = null; inside = false; }
    }
  }
  return roots;
}
