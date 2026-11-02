// 出處與單元編號的字面讀法（syntax.md §2-1、§2-5、D-080、D-164、D-166）：只看字面、不看有沒有別篇卡組，所以新增一篇卡組不會讓舊的出處變意思。
// 家長亂填是常態，所以不猜：只有開頭寫了年級學期才算別的單元（D-166）。在哪一份材料裡找由 Obsidian 層判斷，單元對到哪一篇由 core/catalog 判斷。

/**
 * 連結的目標：block 是 `#^id`、heading 是舊的段落標題（§9-3 第 6 種）、note 是筆記連結本身（alias 只顯示，不送去開）；
 * unit 是別的單元；text 不做連結（先備，D-087）。
 */
export type SourceLink =
  | { kind: 'block'; id: string }
  | { kind: 'heading'; heading: string }
  | { kind: 'note'; link: string; alias?: string }
  | { kind: 'unit'; term: string; unit: string; rest: SourceLink | null }
  | { kind: 'text' };
/** text 是原文，手寫的容錯只影響讀法（D-164 第 6 點）。 */
export interface SourceItem { text: string; link: SourceLink }

/** 頁碼：`p.44`、`p44`、`P.44`、`p 44`，範圍 `p.44-46`、`p.44～46`（後面比前面大才算，連到前面那一頁）；`第 44 頁`、`44頁`。後面可以接說明文字。 */
function page(text: string): string | null {
  const latin = /^p\.?\s*(\d+)(?:[-～~](\d+))?(?:\s+.*)?$/is.exec(text);
  if (latin) return latin[2] === undefined || BigInt(latin[2]) > BigInt(latin[1]) ? latin[1] : null;
  return /^(?:第\s*)?(\d+)\s*頁(?:\s+.*)?$/s.exec(text)?.[1] ?? null;
}

/** 位置：頁碼、圖表例題（含子圖）、其他筆記的連結；都不是時 null。 */
function location(text: string): SourceLink | null {
  const number = page(text);
  if (number !== null) return { kind: 'block', id: 'p' + number };
  const figure = /^(圖|表|例題)\s*(\d+-\d+)(?:\s*([A-Za-z]))?(?:\s+.*)?$/s.exec(text);
  if (figure) return { kind: 'block', id: ({ 圖: 'fig', 表: 'tab', 例題: 'ex' } as const)[figure[1] as '圖' | '表' | '例題'] + figure[2] + (figure[3]?.toLowerCase() ?? '') };
  const note = /^\[\[([^\]]+)\]\]$/.exec(text);
  if (note) {
    const split = note[1].indexOf('|');
    return split < 0 ? { kind: 'note', link: note[1] } : { kind: 'note', link: note[1].slice(0, split).trim(), alias: note[1].slice(split + 1).trim() };
  }
  return null;
}

/** 單元編號後面的那一段：位置；其他文字照舊當段落標題。 */
const rest = (text: string): SourceLink | null => text ? location(text) ?? { kind: 'heading', heading: text } : null;

/** 認得的年級學期：小一～小六、國一～國三、高一～高三，各有上下；`國二 上` 也算。 */
const TERM = /^(小[一二三四五六]|國[一二三]|高[一二三])\s*([上下])(.*)$/s;
const GRADE = '小一小二小三小四小五小六國一國二國三高一高二高三';

/** 認得的年級學期的順序（小 → 國 → 高、年級、上 → 下）；認不得是 null。 */
export function termRank(term: string): number | null {
  const match = /^(..)([上下])$/.exec(term);
  const grade = match ? GRADE.indexOf(match[1]) : -1;
  // 兩個字一組：`一小` 這種跨在中間的不算。
  return match && grade >= 0 && grade % 2 === 0 ? grade + (match[2] === '下' ? 1 : 0) : null;
}

/**
 * 開頭是年級學期的單元（§9-3 第 3 種）；後面沒東西、接的是位置、黏著不是半形英數字開頭的字（`國二上的回顧`）都不算。
 * 編號裡有列表的分隔符號（`國二上 1-3, p.44`、`國二上 L1, L2`，切不開才會讀到這裡）也不算：不猜是哪幾項，當看不懂提示（D-166）。
 */
function termUnit(text: string): SourceLink | null {
  const match = TERM.exec(text);
  if (!match) return null;
  const after = match[3], body = after.trim();
  if (!body || location(body) || !/^(?:\s|[A-Za-z0-9])/.test(after)) return null;
  const { code, name } = splitUnit(body);
  if (/[,，/／]/.test(code)) return null;
  return { kind: 'unit', term: match[1] + match[2], unit: code, rest: rest(name) };
}

function read(text: string): SourceLink {
  const place = location(text);
  if (place) return place;
  const unit = termUnit(text);
  if (unit) return unit;
  if (/^先備\s*[：:]/.test(text) || !text) return { kind: 'text' };
  return { kind: 'heading', heading: text };
}

/** 切開之後這一段讀得懂：位置，或單元後面接位置（§9-3「切開」）。 */
function plainPart(text: string): boolean {
  const link = read(text);
  if (link.kind === 'block' || link.kind === 'note') return true;
  return link.kind === 'unit' && (link.rest?.kind === 'block' || link.rest?.kind === 'note');
}

/** `,`、`，`、`/`、`／` 只有在切開後每一段都讀得懂時才切；連結裡的不算（`[[a,b]]`）。 */
function split(text: string): string[] {
  const parts = text.split(/(?![^[]*\]\])[,，/／]/).map(part => part.trim());
  return parts.length > 1 && parts.every(plainPart) ? parts : [text];
}

/** 把資料欄位「出處」的每一項（已經照頓號切好）變成顯示文字加連結的目標。 */
export function sourceLinks(sources: readonly string[]): SourceItem[] {
  return sources.flatMap(split).map(text => ({ text, link: read(text) }));
}

/** 「編號 名稱」的切法（§9-2）：第一個空白前是編號，半形空白、全形空白、Tab 都算；屬性和出處共用。 */
export function splitUnit(value: string): { code: string; name: string } {
  const text = value.trim();
  const at = text.search(/[ \t　]/);
  return at < 0 ? { code: text, name: '' } : { code: text.slice(0, at), name: text.slice(at + 1).trim() };
}

/** 按鈕上的文字（D-164 第 8 點）：連結不露出括號，有別名顯示別名，有標題顯示標題，否則顯示筆記名稱；其他照原文。 */
export function sourceLabel({ text, link }: SourceItem): string {
  if (link.kind !== 'note') return text;
  if (link.alias) return link.alias;
  const parts = link.link.split('#');
  const heading = parts.at(-1) ?? '';
  return parts.length > 1 && heading && !heading.startsWith('^') ? heading : parts[0];
}
