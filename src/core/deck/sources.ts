// 出處與單元編號的讀法（syntax.md §2-1、§2-5、D-080、D-164、D-169、D-170）：只靠字面與這一篇自己的屬性。這裡拿不到別篇與材料，
// 所以新增一篇卡組、材料多一個標題都不會讓舊的出處變意思。不用猜的直接讀懂；要猜的不生效，只標出問題。
// 在哪一份材料裡找由 Obsidian 層判斷，單元對到哪一篇由 core/catalog 判斷。

/**
 * 連結的目標：block 是 `#^id`、heading 是舊的段落標題、note 是筆記連結本身（alias 只顯示，不送去開）；
 * unit 是別的單元；text 不做連結（先備，D-087）。
 */
export type SourceLink =
  | { kind: 'block'; id: string }
  | { kind: 'heading'; heading: string }
  | { kind: 'note'; link: string; alias?: string }
  | { kind: 'unit'; term: string; unit: string; rest: SourceLink | null }
  | { kind: 'text' };
/** 字面上就知道有問題（不用看目錄與材料，§9-5）：term-only 年級學期沒有完整的編號；position 範圍寫反或可能不是頁碼；before 位置前面有一句話；leftover 字裡有像編號的；negative 有否定字。 */
export type SourceProblem = 'term-only' | 'position' | 'before' | 'leftover' | 'negative';
/** 一個按鈕。text 是原文，手寫的容錯只影響讀法（D-164 第 6 點）。 */
export interface SourceItem {
  text: string;
  link: SourceLink;
  problem?: SourceProblem;
  /** 對不到目錄才算有問題：其他編號（`Starter`）、列表沿用學期的（`1-8`）。標準的編號沒有卡組不提示（D-033 邊用邊長）。 */
  needsUnit?: true;
  /** 同一欄有讀懂別的，這一段只是字：材料裡找得到標題就連，找不到不提示。 */
  remark?: true;
  /** 只在單元：written 這個單元明寫了年級學期；carried 這個單元的學期是沿用前一項的，它後面的位置也是（tasks/exam-scope.md §1）。 */
  basis?: 'written' | 'carried';
  /** 字面上有單元的線索、但沒有算進歸屬（`小五上 p.15`、`1-3 p.20`、網址裡的編號）。普通標題要比材料才知道，不算。 */
  missed?: true;
}
/** 這一篇自己的屬性：本科的名稱、本篇的編號（`L3 p.30` 就是這一篇）、自己的學期。 */
export interface SourceOwner { term: string | null; subject: string | null; unit: { code: string } | null }

// ── 去雜訊：只換確定的語法字元，連結裡不動；不用 NFKC，CO₂、① 不是打字雜訊（D-170 第 3 點）──

const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/g;

export function tidy(text: string): string {
  return text
    .replace(ZERO_WIDTH, '')
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―−﹘﹣─━]/g, '-').replace(/〜/g, '~').replace(/﹐/g, ',').replace(/﹔/g, ';').replace(/﹑/g, '、')
    .replace(/\s+/g, ' ')
    // 數字之間的 ㄦ（注音的連字號鍵）、ㄧ、一、ー、之 是連字號打錯。
    .replace(/(?<=\d) ?[ㄦㄧ一ー之] ?(?=\d)/g, '-')
    .replace(/(?<=[0-9A-Za-z]) ?- ?(?=[0-9])/g, '-')
    .replace(/(?<![A-Za-z])([pP]) ?[.,:。] ?(?=\d)/g, '$1.')
    .replace(/ +([,;/、])/g, '$1');
}
/** 原文裡對應去雜訊之後第 at 個字的位置。每個前綴只算一次；從後面找：`1 - 3` 打到一半時比打完還長。 */
function rawCutter(source: string): (at: number) => number {
  if (tidy(source) === source) return at => at;
  const lengths = Array.from({ length: source.length + 1 }, (_, end) => tidy(source.slice(0, end)).length);
  return at => {
    for (let end = source.length; end > 0; end--) if (lengths[end] <= at) return end;
    return 0;
  };
}
/** 超過這個長度就不切原文，按鈕用去雜訊之後的字：成本和長度的平方成正比，顯示不值得卡住目錄。 */
const RAW_CUT_LIMIT = 2000;
const END = /[,/;、。.\s]+$/;
const RAW_END = /[,，﹐/／;；﹔、﹑。．.\s]+$/;
const SEPARATOR = /[,，﹐/／;；﹔]/;

/** 單元編號的比對鍵：全半形、大小寫、連字號的打法不分；`L01` 與 `L1` 不同（§9-2、D-170 第 4 點）。屬性、出處、目錄、考試範圍共用。 */
export const codeKey = (code: string): string => tidy(code).trim().toLowerCase();
/** 材料標題的比對鍵（只影響連結）：全半形、大小寫、空白、上下標不分。 */
export const headingKey = (text: string): string => tidy(text).toLowerCase().replace(/\s/g, '').replace(/[₀-₉]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x2080 + 48)).replace(/[¹²³]/g, c => ({ '¹': '1', '²': '2', '³': '3' })[c] ?? c);

// ── 連結與「標題」先藏起來，裡面的字不動 ──

const LINK = /!?\[\[[^\]]*\]\]|!?［［[^］]*］］|\[[^\]]+\]\((?:\\.|[^()\\]|\((?:\\.|[^()\\]|\([^()]*\))*\))+\)|「[^」]+」|https?:\/\/(?:[^\s、﹑，﹐；﹔｜|,;]|[,;](?=[^\s、﹑，﹐；﹔｜|,;]))+/g;
const TOKEN = /\uE000(\d+)\uE001/g;
const restore = (text: string, tokens: readonly string[]): string => text.replace(TOKEN, (_, at: string) => tokens[Number(at)]);
// 連結外面的私用區字元拿掉，不會拼出不存在的遮罩；連結裡的字不動。
const MASKED = new RegExp(`[\uE000\uE001]|${LINK.source}`, 'g');
const mask = (text: string, tokens: string[]): string => text.replace(MASKED, match => { if (match.length === 1) return ''; tokens.push(match); return `\uE000${tokens.length - 1}\uE001`; });

/** 連結與「標題」裡的字不算分隔：欄位的 `｜`、值的 `、` 都先藏起來再切（§9-4）。 */
export function splitOutsideLinks(text: string, separator: RegExp): string[] {
  const tokens: string[] = [];
  return mask(text, tokens).split(separator).map(each => restore(each, tokens));
}

/** `100%.md` 這種原樣的百分號不是編碼：解不開就用原字，不用記進錯誤紀錄，一筆出處不能讓整份目錄建不起來（§9-5）。 */
function decodedPath(path: string): string {
  try { return decodeURIComponent(path); } catch { return path; }
}

/** 連結的目標；網址不是位置（null）。 */
function linkTarget(raw: string): SourceLink | null {
  const quoted = /^「([^」]+)」$/.exec(raw);
  if (quoted) return { kind: 'heading', heading: quoted[1] };
  const wiki = /^!?(\[\[|［［)\s*([^\]］]*?)\s*(?:\]\]|］］)$/.exec(raw);
  if (wiki) {
    // 連結裡的字不動（D-170 第 3 點）。全形括號是整個打錯，只換結構的字；半形括號裡的 `｜` 是檔名的一部分。
    const inner = wiki[1] === '［［' ? wiki[2].replace(/＃/g, '#').replace(/｜/g, '|') : wiki[2];
    const split = inner.indexOf('|');
    const target = (split < 0 ? inner : inner.slice(0, split)).trim();
    if (target.startsWith('#')) return { kind: 'heading', heading: target.slice(1) };
    return split < 0 ? { kind: 'note', link: target } : { kind: 'note', link: target, alias: inner.slice(split + 1).trim() };
  }
  const markdown = /^\[[^\]]+\]\((.+)\)$/s.exec(raw);
  return markdown ? { kind: 'note', link: decodedPath(markdown[1]).replace(/\.md$/, '') } : null;
}

// ── 年級學期 ──

const GRADE = '小一小二小三小四小五小六國一國二國三高一高二高三';
const ZH_GRADE = '一二三四五六';
const STAGE: Record<string, string> = { 小: '小', 國: '國', 高: '高', 國小: '小', 小學: '小', 國中: '國', 高中: '高' };
const JUNIOR: Record<string, string> = { 七: '一', 八: '二', 九: '三', 7: '一', 8: '二', 9: '三' };

/** 認得的年級學期的順序（小 → 國 → 高、年級、上 → 下）；認不得是 null。 */
export function termRank(term: string): number | null {
  const match = /^(..)([上下])$/.exec(term);
  const grade = match ? GRADE.indexOf(match[1]) : -1;
  // 兩個字一組：`一小` 這種跨在中間的不算。
  return match && grade >= 0 && grade % 2 === 0 ? grade + (match[2] === '下' ? 1 : 0) : null;
}

/** 開頭的年級學期；`二上`、`第三冊`、`B2` 要靠學制或教材才知道，不認（D-170 第 4 點）。 */
export function readTerm(text: string): { term: string; length: number } | null {
  const named = /^(國小|小學|國中|高中|小|國|高) ?([一二三四五六1-6]) ?(?:年級)? ?\(? ?([上下])(?: ?\))?(?: ?(?:學期|冊))?/.exec(text);
  if (named) {
    const grade = /\d/.test(named[2]) ? ZH_GRADE[Number(named[2]) - 1] : named[2];
    const term = STAGE[named[1]] + grade + named[3];
    return termRank(term) === null ? null : { term, length: named[0].length };
  }
  const junior = /^([七八九789]) ?(?:年級)? ?\(? ?([上下])(?: ?\))?(?: ?(?:學期|冊))?/.exec(text);
  return junior ? { term: '國' + JUNIOR[junior[1]] + junior[2], length: junior[0].length } : null;
}
/** 年級學期的比對鍵：`八上`、`國二上學期` 都是 `國二上`；認不得的照原字。 */
export function termKey(term: string): string {
  const text = tidy(term).trim(), read = readTerm(text);
  return read?.length === text.length ? read.term : term;
}

// ── 編號 ──

const ZH_NUMBER: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 中文數字 1～999；寫法不對回 null（`十百` 不算）。 */
function zhNumber(text: string): number | null {
  const match = /^(?:([一二兩三四五六七八九])百)?(?:([一二三四五六七八九])?(十)|零)?([一二三四五六七八九])?$/.exec(text);
  if (!match || !text) return null;
  return (match[1] ? ZH_NUMBER[match[1]] * 100 : 0) + (match[3] ? (match[2] ? ZH_NUMBER[match[2]] : 1) * 10 : 0) + (match[4] ? ZH_NUMBER[match[4]] : 0);
}
const NUMBER = '(?:\\d+|[一二兩三四五六七八九十百零]+)';
function toNumber(text: string): string | null {
  if (/^\d+$/.test(text)) return text;
  const value = zhNumber(text);
  return value === null ? null : String(value);
}

const AFTER_CODE = '(?=$| |[(,]|[pP]\\.? ?\\d|第 ?\\d|圖|表|例題|\\uE000)';
const PLACE_START = /^(?:(?:pp?|pg|page)\.? ?\d|第 ?\S*? ?頁|\d+(?: ?[-~至到] ?\d+)? ?頁|(?:圖|表|例題|範例|fig(?:ure)?\.?|table|example) ?\d|\uE000)/i;

const CHAPTER = new RegExp(`第 ?(${NUMBER}) ?章(?: ?第 ?(${NUMBER}) ?節)?`, 'g');
/** 字裡的 `第1章第3節`、`第2章` 換成編號；中文數字寫法不對的留原字。 */
export function chapterAlias(text: string): string {
  return text.replace(CHAPTER, (match, a: string, b: string | undefined) => {
    const first = toNumber(a), second = b === undefined ? null : toNumber(b);
    if (first === null || (b !== undefined && second === null)) return match;
    return second === null ? first : `${first}-${second}`;
  });
}

interface Code { code: string; rest: string; other?: true }
/** 年級學期後面的編號；開頭是位置、中文字或沒寫完時 null。other：不是標準形狀，對不到目錄才提示。 */
function readCode(text: string): Code | null {
  const t = text.trimStart();
  if (PLACE_START.test(t)) return null;
  const chapter = new RegExp(`^第 ?(${NUMBER}) ?章 ?第 ?(${NUMBER}) ?節 ?(.*)$`, 's').exec(t);
  if (chapter) {
    const [a, b] = [toNumber(chapter[1]), toNumber(chapter[2])];
    return a && b ? { code: `${a}-${b}`, rest: chapter[3] } : null;
  }
  const named = /^單元 ?(.*)$/s.exec(t);
  if (named) return readCode(named[1]);
  const shape = new RegExp(`^(\\d+(?:-\\d+)*|[A-Za-z]+\\d+)${AFTER_CODE} ?(.*)$`, 's').exec(t);
  if (shape) return { code: shape[1], rest: shape[2] };
  const spaced = new RegExp(`^([A-Za-z]{1,2}) (\\d+)${AFTER_CODE} ?(.*)$`, 's').exec(t);
  if (spaced) return { code: spaced[1] + spaced[2], rest: spaced[3] };
  // 其他編號（`Starter`、`L1-2`）：半形字母開頭的一個字。範圍符號、問號不是編號的一部分。
  const other = /^([A-Za-z][A-Za-z0-9-]*)(?: (.*))?$/s.exec(t);
  return other ? { code: other[1], rest: other[2] ?? '', other: true } : null;
}

// ── 位置 ──

const BLOCK: Record<string, string> = { 圖: 'fig', fig: 'fig', figure: 'fig', 表: 'tab', table: 'tab', 例題: 'ex', 範例: 'ex', example: 'ex' };
const FULL_NAME: Record<string, string> = { fig: '圖', tab: '表', ex: '例題' };
interface Found { at: number; end: number; link: SourceLink }

/** 一段裡所有的位置，照原文順序；left 是沒用到的字，before 是第一個位置前面的字。bad：範圍寫反、可能不是頁碼。 */
function scan(text: string, tokens: readonly string[]): { found: Found[]; left: string; before: string; bad: boolean; hidden: boolean } {
  const found: Found[] = [];
  let masked = text, bad = false, hidden = false;
  const take = (match: RegExpMatchArray, link: SourceLink | null): void => {
    const at = match.index ?? 0;
    if (link) found.push({ at, end: at + match[0].length, link });
    masked = masked.slice(0, at) + ' '.repeat(match[0].length) + masked.slice(at + match[0].length);
  };
  for (const match of [...masked.matchAll(TOKEN)]) {
    const raw = tokens[Number(match[1])], link = linkTarget(raw);
    // 半形逗號後面緊接著字是網址的一部分，分不出是不是另一項：不算別的單元，像編號就提示（D-170 第 1 點）。
    const comma = raw.search(/[,;]/);
    if (!link && comma >= 0 && hasCode(tidy(raw.slice(comma)))) hidden = true;
    take(match, link);
  }
  for (const match of [...masked.matchAll(/(?<![^ ])#([^ #,、;/]+)/g)]) take(match, { kind: 'heading', heading: match[1] });
  for (const match of [...masked.matchAll(/(圖|表|例題|範例|figure|fig|table|example)\.? ?(\d+)[-.](\d+) ?(?:\(? ?([A-Za-z]) ?\)?(?![A-Za-z0-9]))?/gi)]) take(match, { kind: 'block', id: `${BLOCK[match[1].toLowerCase()]}${match[2]}-${match[3]}${match[4]?.toLowerCase() ?? ''}` });
  for (const match of [...masked.matchAll(/(?<![A-Za-z0-9-])第? ?(\d+)-(\d+) ?(圖|表|例題)/g)]) take(match, { kind: 'block', id: `${BLOCK[match[3]]}${match[1]}-${match[2]}` });
  const page = (match: RegExpMatchArray, first: string, last: string | undefined, sure: boolean): void => {
    const start = toNumber(first);
    if (start === null) return;
    const end = last === undefined ? null : toNumber(last);
    // 反向、位數較少都不確定（`p.46-44`、`p.44-6`），不偷偷截成第一頁（D-170 第 5 點）。
    if (last !== undefined && (end === null || BigInt(end) <= BigInt(start) || end.length !== start.length)) { bad = true; take(match, null); return; }
    // 沒有句點的 `p53` 後面又接字，可能是名稱。
    if (!sure && /^ *[^ \uE000圖表例第pP頁,]/.test(masked.slice((match.index ?? 0) + match[0].length))) { bad = true; take(match, null); return; }
    take(match, { kind: 'block', id: 'p' + start });
  };
  for (const match of [...masked.matchAll(/(?<![A-Za-z0-9])(pp?|pg|page)(\.?) ?(\d+)(?: ?[-~至到] ?(?:(?:pp?|pg|page)\.? ?)?(\d+))?( ?頁)?(?![A-Za-z0-9-])/gi)]) page(match, match[3], match[4], Boolean(match[2]) || Boolean(match[5]) || match[1].length > 1);
  for (const match of [...masked.matchAll(new RegExp(`(?<![0-9A-Za-z-])(?:第 ?)?(${NUMBER})(?: ?[-~至到] ?(${NUMBER}))? ?頁`, 'g'))]) page(match, match[1], match[2], true);
  found.sort((a, b) => a.at - b.at);
  const before = found.length ? masked.slice(0, found[0].at).replace(/ +/g, ' ').trim() : '';
  return { found, left: masked.replace(/ +/g, ' ').trim(), before, bad, hidden };
}

// ── 讀一欄 ──

// 有這些字的那一段不算歸屬、不算位置，只提示。表只會讓結果變成「先不算」，缺字只是少一次保護，不會多算（D-170 第 7 點）。
const NEGATIVE = /不是|不要|不用|不必|不算|不考|不看|不含|不包括|除外|以外|排除|並非|而非|而是|別算|勿|略過|改成|改為|更正|應為|不對/;
const SELF = /^(?:本單元|本篇|本課|本節|這一篇|這一課|這一節|這一單元|這個單元) ?/;
// 沒用到的字裡有編號或年級學期：可能是沒寫完的參照。
const SUSPECT = /(?<![A-Za-z0-9.-])\d+(?:-\d+)+(?![A-Za-z0-9-])|(?:小[一二三四五六]|國[一二三]|高[一二三]|[七八九]) ?[上下]/;
/** 字裡有編號，或任何讀法認得的年級學期（`8上`、`國中二年級上`）。 */
function hasCode(text: string): boolean {
  if (SUSPECT.test(text)) return true;
  for (let at = 0; at < text.length; at++) if (readTerm(text.slice(at))) return true;
  return false;
}
const WRAP = /^[([《【] ?(.*?) ?[)\]》】]$/s;
const NOTE_ONLY = /^(?:第 ?\d+ ?[題段行])$/;
/** 位置前面的字可以當教材名稱：兩個中文字以內或一個英文字（`課本第44頁`、`Workbook p.12`）。 */
const MATERIAL = /^(?:[\u3400-\u9FFF]{1,2}的?|[A-Za-z]+)$/;
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface UnitName { term: string; code: string; basis: 'written' | 'carried' }
/** codeLike：只有字但像編號，不當說明：材料裡找得到是標題（`1-2 溶液`），找不到才提示。written：這一段自己明寫了年級學期與標準的編號。 */
interface Pending extends SourceItem { codeLike?: true; written?: true }

export function sourceLinks(sources: readonly string[], own: SourceOwner): SourceItem[] {
  const tokens: string[] = [];
  // 一項一項藏：不同項的字不會接成一個連結。
  const masked = sources.map(source => mask(source, tokens).replace(/[\u200B\u200C\uFEFF]/g, '')).join('、');
  // 這一篇的屬性也去雜訊再比：`八上` 就是 `國二上`，`Ｌ３` 就是 `L3`。
  const ownCode = tidy(own.unit?.code ?? '').trim();
  const ownTerm = own.term === null ? null : termKey(own.term);
  const ownLetters = /^([A-Za-z]+)\d+$/.exec(ownCode)?.[1] ?? null;
  const subject = own.subject ? new RegExp(`^${escapeRegExp(tidy(own.subject).trim())} ?`) : null;
  const dropSubject = (text: string): string => subject ? text.replace(subject, '') : text;
  // 同一欄不分頓號、逗號、分行（D-170 第 6 點）：位置跟著前面的單元；scope 是 null 時，前面寫了別的學期卻沒有單元，不知道屬於哪裡。
  let scope: UnitName | 'this' | null = 'this', lastPlace: string | null = null, carry: UnitName | null = null;

  const inScope = (link: SourceLink): SourceLink => scope && scope !== 'this' ? { kind: 'unit', term: scope.term, unit: scope.code, rest: link } : link;
  /** 這個位置屬於別的單元時，歸屬依據跟著那個單元。 */
  const basisOf = (): Pick<SourceItem, 'basis'> => scope && scope !== 'this' ? { basis: scope.basis } : {};
  /** 接著前一個位置的一項；按鈕寫完整，只有數字看不懂。 */
  const follow = (id: string, text: string): Pending => { lastPlace = id; return { text, link: inScope({ kind: 'block', id }), ...basisOf() }; };
  /** 字裡有本篇那種字母的編號（英文卡組的 `也算 L1`）；`p.20 維生素 B12` 不算。 */
  const hasOwnKindCode = (text: string): boolean => ownLetters !== null && new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(ownLetters)}\\d+(?![A-Za-z0-9])`, 'i').test(text);
  const looksLikeCode = (text: string): boolean => hasCode(text) || hasOwnKindCode(text);
  const forget = (): void => { lastPlace = null; carry = null; };
  const items: Pending[] = [];

  /** 接著前一個位置：p.44, 45；圖 2-14、2-15；圖 2-13a、b；44、46頁。 */
  function continuation(segment: string, display: string, next: string | undefined): Pending | null {
    if (lastPlace?.startsWith('p') && /^\d+$/.test(segment)) return follow('p' + segment, 'p.' + segment);
    const kind = /^(fig|tab|ex)/.exec(lastPlace ?? '')?.[1];
    if (kind && /^\d+-\d+$/.test(segment)) return follow(kind + segment, `${FULL_NAME[kind]} ${segment}`);
    if (kind === 'fig' && /^[A-Za-z]$/.test(segment)) {
      const id = (lastPlace ?? '').replace(/[a-z]$/, '') + segment.toLowerCase();
      return follow(id, '圖 ' + id.slice(3));
    }
    return /^\d+$/.test(segment) && /^\d+ ?頁/.test(next ?? '') ? follow('p' + segment, display) : null;
  }

  /** 乾淨的列表：寫過年級學期的下一段只有編號（可以加位置），和前一個同一類，沿用學期（`國二上 1-3、1-8`）。 */
  function listed(segment: string): Code | null {
    const bare = /^(\d{1,2}(?:-\d{1,2})*|[A-Za-z]+\d+)(?![0-9A-Za-z-]) ?(.*)$/s.exec(segment);
    if (!bare || !carry) return null;
    const same = /^\d/.test(carry.code)
      ? /^\d/.test(bare[1]) && bare[1].split('-').length === carry.code.split('-').length
      : /^[A-Za-z]+/.exec(carry.code)?.[0].toLowerCase() === /^[A-Za-z]+/.exec(bare[1])?.[0].toLowerCase();
    if (!same) return null;
    const after = scan(bare[2], tokens);
    return !bare[2] || (after.found.length && !after.left) ? { code: bare[1], rest: bare[2], other: true } : null;
  }

  /** 否定段拿掉前面那個單元的字之後，還有沒有點名別的東西。 */
  function namesOther(segment: string, term: string, code: string): boolean {
    // 先看有沒有頁、圖：`不是第3頁` 說的是頁，只是號碼和單元 3 一樣。
    if (scan(segment, tokens).found.length) return true;
    const written = escapeRegExp(code).replace(/^([A-Za-z]+)(?=\d)/, '$1 ?');
    // 別名就是同一個單元（`第1章第3節` 是 1-3）。
    let text = chapterAlias(segment).replace(new RegExp(`(?<![0-9A-Za-z-])${written}(?![0-9A-Za-z-])`, 'gi'), '');
    for (let at = 0; at < text.length; at++) {
      const read = readTerm(text.slice(at));
      if (read?.term === term) { text = text.slice(0, at) + text.slice(at + read.length); break; }
    }
    return /[\dA-Za-z]/.test(text) || hasCode(text);
  }

  function readSegment(raw: string, source: string, next: string | undefined): Pending[] {
    const segment = raw.replace(WRAP, '$1');
    const display = restore(source, tokens);
    /** 一個位置就是整段的原文；好幾個時照位置切開，一個位置一個按鈕。外面有括號時照讀法的字切，括號不會只剩一半。 */
    const pieces = (list: readonly Found[], base: number): string[] => {
      if (list.length === 1) return [display];
      const cut = segment === raw && source.length <= RAW_CUT_LIMIT ? rawCutter(source) : null;
      return list.map((each, at) => {
        const from = at ? base + each.at : 0, to = at + 1 < list.length ? base + list[at + 1].at : null;
        const piece = cut ? source.slice(cut(from), to === null ? source.length : cut(to)) : segment.slice(from, to ?? segment.length);
        return restore(piece.trim(), tokens);
      });
    };
    const asHeading = (extra: Partial<Pending> = {}): Pending => ({ text: display, link: { kind: 'heading', heading: display }, ...extra });
    if (NEGATIVE.test(segment)) {
      forget();
      // 緊接在沒有位置的單元後面（`國二上 1-3，不算這個`）：說的就是那個單元，一起先不算。有位置的是實際的出處，照連；
      // 否定段自己點名了別的（`不是 p.46`、`不是國二上 1-8`、`不是 [[筆記]]`）：說的不是前面的單元。
      const last = items.at(-1);
      if (last?.link.kind === 'unit' && (last.link.rest === null || last.link.rest.kind === 'heading') && !namesOther(segment, last.link.term, last.link.unit)) {
        items[items.length - 1] = { text: last.text, link: { kind: 'text' }, problem: 'negative' };
        scope = 'this';
      }
      return [{ text: display, link: { kind: 'text' }, problem: 'negative' }];
    }
    if (NOTE_ONLY.test(segment)) { forget(); return [{ text: display, link: { kind: 'text' } }]; }
    let rest = segment, unit: UnitName | null = null, selfRef = false, needsUnit = false;
    const body = dropSubject(segment);
    const term = readTerm(body);
    const tail = term ? body.slice(term.length) : '';
    const after = dropSubject(tail.trimStart());
    // 學期後面緊接著中文字不算（`國二上的回顧`），本科的名稱可以（`國二上自然 1-3`）。
    if (term && (after !== tail.trimStart() || /^(?:$| |[0-9A-Za-z第]|單元|\uE000)/.test(tail))) {
      const code = readCode(after);
      if (!code || ((code.other || /^\d+$/.test(code.code)) && /^\d+(?![0-9-]* ?頁)/.test(code.rest))) {
        // 只有年級學期、編號沒寫完（`小五上 p.15`、`國二上 1 3`）：不猜單元。自己的學期還是這本書；別的學期的位置不知道在哪裡。
        forget();
        const found = code ? [] : scan(after.trim(), tokens).found;
        scope = term.term === ownTerm ? 'this' : null;
        if (scope === 'this' && found.length) {
          const texts = pieces(found, segment.length - after.trim().length);
          return found.map((each, at) => ({ text: texts[at], link: each.link, problem: 'term-only' as const, missed: true as const }));
        }
        return [asHeading({ problem: 'term-only', missed: true })];
      }
      unit = { term: term.term, code: code.code, basis: 'written' };
      needsUnit = code.other === true;
      rest = code.rest;
    } else if (SELF.test(segment)) {
      scope = 'this'; selfRef = true; rest = segment.replace(SELF, ''); carry = null;
    } else {
      const self = ownCode ? new RegExp(`^${escapeRegExp(ownCode)}(?![0-9A-Za-z-]) ?(.*)$`, 'is').exec(segment) : null;
      if (self) {
        scope = 'this'; selfRef = true; rest = self[1]; carry = null;
        if (!rest) { forget(); return [{ text: display, link: { kind: 'text' } }]; }
      } else {
        const followed = continuation(segment, display, next);
        if (followed) return [followed];
        const code = listed(segment);
        if (code && carry) {
          unit = { term: carry.term, code: code.code, basis: 'carried' };
          needsUnit = true;
          rest = code.rest;
        }
      }
    }
    if (unit) { scope = unit; carry = unit; }
    const written = unit !== null && !needsUnit ? { written: true as const } : {};

    const { found, left, before, bad, hidden } = scan(rest, tokens);
    if (scope === null && found.length) return [asHeading({ problem: 'term-only', missed: true })];
    if (!found.length) {
      // 沒用到的字有單元的線索：疑似漏掉，和要不要提示、提示哪一種無關（`p.46-44 1-3` 的 problem 是 position）。
      const clue = hidden || looksLikeCode(left) || /^(?:\d+|[A-Za-z]+\d+)$/.test(left);
      const missed = clue ? { missed: true as const } : {};
      const problem: SourceProblem | undefined = bad ? 'position' : clue ? 'leftover' : undefined;
      if (unit) {
        // 單元後面的字留在 rest：Obsidian 層比那個單元的名稱與材料的標題。
        lastPlace = null;
        return [{ text: display, link: { kind: 'unit', term: unit.term, unit: unit.code, rest: left ? { kind: 'heading', heading: restore(left, tokens) } : null }, basis: unit.basis, ...(problem ? { problem } : {}), ...(needsUnit ? { needsUnit: true as const } : {}), ...missed, ...written }];
      }
      // 後面的編號、數字不接過這些字（D-170 第 6 點）。
      forget();
      if (hidden && left) return [asHeading({ problem: 'leftover', ...missed })];
      if (selfRef && !left) return [{ text: display, link: { kind: 'text' }, ...(problem ? { problem } : {}), ...missed }];
      // 網址：只有字，不是位置，也不算看不懂。
      if (/\uE000/.test(segment) && !left) return [{ text: display, link: { kind: 'text' }, ...(problem ? { problem } : {}), ...missed }];
      if (bad) return [asHeading({ problem: 'position', ...missed })];
      return [asHeading(problem ? { codeLike: true, ...missed } : {})];
    }
    const texts = pieces(found, segment.length - rest.length);
    const placed: Pending[] = found.map((each, at) => {
      lastPlace = each.link.kind === 'block' ? each.link.id : null;
      return { text: texts[at], link: inScope(each.link), ...basisOf(), ...written };
    });
    if (needsUnit) placed[0].needsUnit = true;
    const final = placed[placed.length - 1];
    if (bad) final.problem = 'position';
    if (hidden || (left && looksLikeCode(left))) final.missed = true;
    // 同一段的尾數照接（`p.44 https://x.test,8上L1 45`）；隔了網址也要先留下提示。
    if (left && !before && /^\d+$/.test(left) && lastPlace?.startsWith('p')) {
      if (hidden) final.problem ??= 'leftover';
      return [...placed, follow('p' + left, 'p.' + left)];
    }
    // 單元與位置之間的字是說明，孤立的數字不是：用途要家長說明（`國二上 1-3 44 p.45`）。
    if (/^\d+$/.test(before)) placed[0].problem ??= 'before';
    if (!unit && !selfRef && before && !MATERIAL.test(before)) placed[0].problem ??= 'before';
    if (hidden || (left && looksLikeCode(left))) final.problem ??= 'leftover';
    return placed;
  }

  /** 切段：分隔符號；位置後面直接接年級學期加編號也切（`p.44 國二上 1-3 p.20`）。`p，44` 的逗號不是分隔。 */
  function segmentsOf(entry: string): string[] {
    const fixed = entry.replace(/(?<![A-Za-zＡ-Ｚａ-ｚ])([pPｐＰ])\s*[，,]\s*(?=[0-9０-９])/g, '$1.');
    return fixed.split(SEPARATOR).map(each => each.trim()).filter(Boolean).flatMap(part => {
      const clean = tidy(part);
      for (let at = 1; at < clean.length; at++) {
        if (clean[at - 1] !== ' ' || !readTerm(clean.slice(at))) continue;
        const head = scan(clean.slice(0, at).trim(), tokens);
        if (!head.found.length || head.left) continue;
        if (part.length > RAW_CUT_LIMIT) return [clean.slice(0, at).trim(), clean.slice(at).trim()];
        const cut = rawCutter(part)(at);
        return [part.slice(0, cut).trim(), part.slice(cut).trim()];
      }
      return [part];
    });
  }

  const entries = masked.split(/[、﹑]/).map(each => each.trim()).filter(Boolean);
  for (const [index, entry] of entries.entries()) {
    const display = restore(entry.replace(RAW_END, ''), tokens);
    if (/^先備 ?[：:]/.test(entry)) { forget(); items.push({ text: display, link: { kind: 'text' } }); continue; }
    const parts = segmentsOf(entry), start = items.length;
    parts.forEach((part, at) => {
      const clean = tidy(part).replace(END, '').trim();
      const next = parts[at + 1] ?? entries[index + 1];
      if (clean) items.push(...readSegment(clean, part.replace(RAW_END, '').trim(), next && tidy(next)));
    });
    // 這一項切成好幾段、全部都沒讀懂：是一句話或舊標題（`溶解, 擴散`），併回一個。
    const added = items.slice(start);
    if (added.length > 1 && added.every(each => each.link.kind === 'heading')) {
      const problem = added.find(each => each.problem)?.problem;
      items.splice(start, added.length, { text: display, link: { kind: 'heading', heading: display }, ...(problem ? { problem } : {}), ...(added.some(each => each.missed) ? { missed: true as const } : {}), ...(added.some(each => each.codeLike) ? { codeLike: true as const } : {}) });
    }
  }
  const anyRead = items.some(each => each.link.kind !== 'heading' && each.link.kind !== 'text');
  // 讀完才去重：`本篇` 這種字會影響後面的意思（D-170 第 6 點）。只顯示的項目照文字比。
  // 同一個目標寫兩次時按鈕留一個，診斷與確認依據不丟：後面的有問題就照它提示；有一項明寫了學期就不算沿用。
  const kept = new Map<string, SourceItem>();
  for (const { codeLike, written, ...item } of items) {
    const marked: SourceItem = anyRead && !codeLike && !item.problem && item.link.kind === 'heading' ? { ...item, remark: true } : item;
    const key = item.link.kind === 'text' ? item.text : JSON.stringify(item.link);
    const first = kept.get(key);
    if (!first) { kept.set(key, marked); continue; }
    if (marked.problem && !first.problem) { first.text = marked.text; first.problem = marked.problem; }
    if (written) delete first.needsUnit;
    if (item.basis === 'written') first.basis = 'written';
    if (item.missed) first.missed = true;
  }
  return [...kept.values()];
}

/** 「編號 名稱」的切法（§9-2）：第一個空白前是編號，半形空白、全形空白、Tab 都算；屬性和出處共用。 */
export function splitUnit(value: string): { code: string; name: string } {
  const text = value.trim();
  const at = text.search(/[ \t　]/);
  return at < 0 ? { code: text, name: '' } : { code: text.slice(0, at), name: text.slice(at + 1).trim() };
}

/** 按鈕上的文字（D-164 第 8 點）：連結不露出括號，有別名顯示別名，有標題顯示標題，否則顯示筆記名稱；其他照原文。 */
export function sourceLabel({ text, link }: SourceItem): string {
  const note = link.kind === 'unit' ? link.rest : link;
  if (note?.kind !== 'note') return text;
  if (note.alias) return note.alias;
  const parts = note.link.split('#');
  const heading = parts.at(-1) ?? '';
  return parts.length > 1 && heading && !heading.startsWith('^') ? heading : parts[0];
}

// ── 表單用：一項出處拆成年級學期、編號、位置與剩下的字（tasks/edit-markup.md §4-1）──

/**
 * 一項出處拆開的樣子：用讀法的同一套（readTerm、readCode、scan），只拆、不判斷歸屬（D-170 第 2 點）。
 * term 是認得的年級學期（`國二上`）；只寫 `二上` 這種要靠學制才知道的放在 short；code 是編號（`1-3`、`L1`）；
 * places 是認得的位置，照原文順序；bad 是範圍寫反、`p53` 後面接字；left 是沒用到的字（連結已經還原）。
 */
export interface SourceParts { term: string | null; short: string | null; code: string | null; places: SourceLink[]; bad: boolean; left: string }
const SHORT_TERM = /^([一二三四五六1-6]) ?(?:年級)? ?([上下])(?: ?(?:學期|冊))?(?![0-9])/;
export function sourceParts(text: string, own: SourceOwner): SourceParts {
  const tokens: string[] = [];
  const subject = own.subject ? new RegExp(`^${escapeRegExp(tidy(own.subject).trim())} ?`) : null;
  const dropSubject = (value: string): string => subject ? value.replace(subject, '') : value;
  let rest = dropSubject(tidy(mask(text, tokens)).replace(END, '').trim());
  let term: string | null = null, short: string | null = null, code: string | null = null;
  const read = readTerm(rest);
  const shortTerm = read ? null : SHORT_TERM.exec(rest);
  if (read) { term = read.term; rest = rest.slice(read.length); }
  else if (shortTerm) {
    short = (/\d/.test(shortTerm[1]) ? ZH_GRADE[Number(shortTerm[1]) - 1] : shortTerm[1]) + shortTerm[2];
    rest = rest.slice(shortTerm[0].length);
  }
  rest = dropSubject(rest.trimStart());
  // 其他形狀的編號（`Starter`）只在寫了學期之後算；開頭就是一個英文字的多半是教材名稱（`Workbook p.12`）。
  const found = readCode(rest);
  if (found && (!found.other || term || short)) { code = found.code; rest = found.rest; }
  const scanned = scan(rest, tokens);
  return { term, short, code, places: scanned.found.map(each => each.link), bad: scanned.bad, left: restore(scanned.left, tokens) };
}
