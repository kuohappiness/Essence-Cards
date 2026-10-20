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
export function maskInline(text: string): string {
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
    if (/^>/.test(trimmed)) {
      if (stack.length && indent >= stack.at(-1)!.contentColumn) extend(i);
      else stack.length = 0;
      continue;
    }
    const opening = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      let container = stack.length - 1;
      while (container >= 0 && indent < stack[container].contentColumn) container--;
      if (container >= 0 || indent < 4) {
        stack.length = container + 1;
        extend(i);
        fence = { char: opening[1][0], count: opening[1].length, contentColumn: stack.at(-1)?.contentColumn ?? 0 };
        continue;
      }
    }
    if (!trimmed) continue;
    const heading = /^(#{1,6})(?:\s+(.*)|$)/.exec(trimmed);
    if (heading && indent < 4 && (!stack.length || indent < stack.at(-1)!.contentColumn)) {
      section = (heading[2] ?? '').replace(/\s+#+\s*$/, '').trim(); stack.length = 0; continue;
    }
    // CommonMark：1～4 欄間隔都屬於符號；超過 4 欄只取一欄。
    const match = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/.exec(expanded);
    if (match) {
      while (stack.length && indent < stack.at(-1)!.contentColumn) stack.pop();
      if (!stack.length && indent >= 4) continue;
      extend(i);
      const gap = match[3].length > 4 ? 1 : Math.max(1, match[3].length);
      // 只展開縮排；正文中的 Tab 仍是原文。
      const body = raw.replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*/, '');
      const itemFence = /^(`{3,}|~{3,})(.*)$/.exec(body);
      if (itemFence && !(itemFence[1][0] === '`' && itemFence[2].includes('`'))) {
        fence = { char: itemFence[1][0], count: itemFence[1].length, contentColumn: indent + match[2].length + gap };
        continue;
      }
      const item: Item = { line: i, end: i + 1, indent, contentColumn: indent + match[2].length + gap,
        text: body.trimEnd(), children: [], section };
      (stack.at(-1)?.children ?? roots).push(item);
      stack.push(item);
    } else {
      while (stack.length && indent < stack.at(-1)!.contentColumn) stack.pop();
      if (stack.length) {
        stack.at(-1)!.text += '\n' + raw.trim();
        extend(i);
      } else stack.length = 0;
    }
  }
  return roots;
}
