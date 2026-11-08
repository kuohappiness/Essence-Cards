import { codeKey, nameIds, parseDeck, pickWord, readTerm, termKey } from '../deck/index.ts';
import { blocksOf, check, fenceCloses } from './check.ts';
import type { CheckResult } from './check.ts';
import type { RuleSubject } from './rules.ts';
import { titlePrefix, unitCode } from './prompt.ts';
import type { CardForm } from './prompt.ts';

// 貼回與檢查（tasks/ai-cards-mvp.md §4）：整理（只改包裝）→ 分段與結束標記 → 拆篇 → 每一篇檢查。
// 回報的行號一律是貼上的原文的行（從 1 算）：整理不增減中間的行，只拿掉最外層圍欄那兩行與它們外面的空行，以及 `<<<完>>>` 後面的圍欄與引用標記。

/** 擋住（不能存）或提示（可以存）的一項；line 是原文的第幾行（從 1 算），0 是整段；quote 是那一行的原文（縮短過，給家長找）。 */
export interface ReplyIssue { line: number; message: string; quote?: string }

const lineText = (issue: ReplyIssue): string => `第 ${String(issue.line)} 行${issue.quote === undefined ? '' : `「${issue.quote}」`}`;
/** 一項擋住或提示：行號與那一行的原文（輸入框沒有行號，家長靠原文找）。 */
export const issueText = (issue: ReplyIssue): string => (issue.line ? `${lineText(issue)}：` : '') + issue.message;
/** 同一句提示合成一列（例如每張圖都提示一次）：共用那句話，底下列出每一行的原文（§4 每一項都要寫出原文，L2-10）。 */
export function groupHints(hints: readonly ReplyIssue[]): { text: string; lines: string[] }[] {
  const groups = new Map<string, ReplyIssue[]>();
  for (const hint of hints) groups.set(hint.message, [...groups.get(hint.message) ?? [], hint]);
  return [...groups].map(([message, same]) => same.length === 1 ? { text: issueText(same[0]), lines: [] } : { text: `${message}（共 ${String(same.length)} 處）`, lines: same.map(lineText) });
}

/** 整理後的回覆：lines 是每一行（不含換行），raw[i] 是第 i 行在原文的行號（從 1 算）。 */
export interface Normalized { lines: string[]; raw: number[] }

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:markdown|md)?[ \t]*$/i;
/** Gemini 的引用標記：`[cite_start]`、`[cite: 1, 2]`。 */
const CITE = /\[cite(?:_start|_end)?(?::[^\]\n]*)?\]/g;
/** `<<<完>>>` 後面可以略過的一行：空白、引用標記、程式碼區塊的結尾符號，或結尾符號接著引用標記。 */
const tailJunk = (line: string): boolean => /^(?:`{3,}|~{3,})?$/.test(line.replace(CITE, '').trim());

/**
 * 整理（§4）：拿掉開頭的 BOM、換行統一成 `\n`；整段被最外層的一對圍欄（三個以上的反引號或波浪號，開頭可帶 `markdown`）包起來時拿掉那一對，
 * 裡面較短的圍欄不動。裡面有一樣長、可以當成結束的圍欄時，不算被一對包起來（CommonMark 會在那裡結束），不拿。
 * `<<<完>>>` 後面只剩程式碼區塊的結尾符號與引用標記時拿掉（真人測試 2026-11-08：Gemini 在框的結尾符號後面接 `[cite: …]`，
 * 框沒收好，按程式碼區塊的「複製」會連那一行一起複製）；拿掉的結尾符號照樣和開頭的圍欄配成一對。
 */
export function normalizeReply(text: string): Normalized {
  let lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  let raw = lines.map((_, i) => i + 1);
  const first = lines.findIndex(line => line.trim() !== '');
  const open = first >= 0 ? FENCE_OPEN.exec(lines[first]) : null;
  // 結束標記照分段的認法：最外層的圍欄裡面算，裡面另一個程式碼區塊裡的不算。
  const from = open ? first + 1 : 0;
  const end = markers(lines.slice(from)).filter(each => each.name === END).at(-1);
  const tail = end ? lines.slice(from + end.at + 1) : [];
  const fences = tail.map(line => line.replace(CITE, '').trim()).filter(rest => rest !== '');
  const closing = fences.length === 1 ? fences[0] : null;
  // 尾巴只認一個結尾符號（L2-7），有外框時還要和開頭配成一對；配不起來的留著，分段會擋下「<<<完>>> 後面還有文字」。
  const pairs = closing === null || !open || (fenceCloses(closing, open[1]) && !lines.slice(first + 1, from + end!.at + 1).some(line => fenceCloses(line, open[1])));
  if (end && tail.some(line => line.trim() !== '') && tail.every(tailJunk) && fences.length <= 1 && pairs) {
    lines = lines.slice(0, from + end.at + 1);
    raw = raw.slice(0, from + end.at + 1);
  }
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last--;
  if (!open) return { lines, raw };
  const plain = (to: number): boolean => !lines.slice(first + 1, to).some(line => fenceCloses(line, open[1]));
  if (closing !== null && pairs && lines.length === from + end!.at + 1) return { lines: lines.slice(first + 1), raw: raw.slice(first + 1) };
  if (last > first && fenceCloses(lines[last], open[1]) && plain(last)) return { lines: lines.slice(first + 1, last), raw: raw.slice(first + 1, last) };
  return { lines, raw };
}

/** 原文第 line 行（從 1 算）縮短成給家長找的樣子：去掉頭尾空白、連續空白併成一個，太長的截斷。 */
export function quoteLine(text: string, line: number): string | undefined {
  const found = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)[line - 1]?.replace(/[ \t　]+/g, ' ').trim();
  if (!found) return undefined;
  const chars = [...found];
  return chars.length > 80 ? chars.slice(0, 80).join('') + '…' : found;
}

const MARKER = /^ {0,3}<<<([^<>\n]*)>>>[ \t]*$/;
const SECTIONS = ['全貌', '架構', '卡組'];
const END = '完';

/** 分段的結果：卡組段是 [start, end)（整理後的行）；ended 是最後一個非空行是單獨的 `<<<完>>>`。 */
export interface Segments { start: number; end: number; ended: boolean; errors: ReplyIssue[] }

/**
 * 最外層、單獨一行的段標記：照 blocksOf 的區塊邊界，程式碼、引言框、清單裡的不算（§4）。
 * 接在清單後面又有縮排的是清單的內文；頂格寫的算最外層（AI 常把 `<<<完>>>` 直接接在最後一題的下一行）。
 */
function markers(lines: readonly string[]): { at: number; name: string }[] {
  const found: { at: number; name: string }[] = [];
  for (const block of blocksOf(lines.map((raw, no) => ({ no, raw })))) {
    if (block.kind !== 'para' && block.kind !== 'cont') continue;
    const match = MARKER.exec(lines[block.line]);
    if (match && (block.kind === 'para' || !lines[block.line].startsWith(' '))) found.push({ at: block.line, name: match[1].trim() });
  }
  return found;
}

/**
 * 分段與結束（§4）：R3 的科目照標記切，要有全貌、架構、卡組各一個，卡組段之後只能接 `<<<完>>>`；其他科目不用段標記，`<<<完>>>` 之前整段是卡組段。
 * 第一個非空行前面的開場白不猜，是錯誤。`<<<完>>>` 後面還有字也是錯誤（不知道哪一段才是回覆的結尾）。
 */
export function segmentReply(normalized: Normalized, r3: boolean): Segments {
  const { lines, raw } = normalized;
  const errors: ReplyIssue[] = [];
  const at = (index: number): number => raw[index] ?? raw[raw.length - 1] ?? 0;
  const found = markers(lines);
  const ends = found.filter(each => each.name === END);
  const blank = (from: number, to: number): boolean => lines.slice(from, to).every(line => line.trim() === '');
  for (const each of found) {
    if (each.name !== END && !SECTIONS.includes(each.name)) errors.push({ line: at(each.at), message: `認不得的標記 <<<${each.name}>>>：標記照抄 ${r3 ? '<<<全貌>>>、<<<架構>>>、<<<卡組>>>、' : ''}<<<完>>>` });
    else if (!r3 && each.name !== END) errors.push({ line: at(each.at), message: `這一科不用段標記 <<<${each.name}>>>：回覆就是卡組本身，最後一行寫 <<<完>>>` });
  }
  if (ends.length > 1) errors.push({ line: at(ends[1].at), message: '<<<完>>> 出現了兩次' });
  const end = ends[0];
  if (end && !blank(end.at + 1, lines.length)) errors.push({ line: at(end.at + 1 + lines.slice(end.at + 1).findIndex(line => line.trim() !== '')), message: '<<<完>>> 後面還有文字：只貼回覆本身，<<<完>>> 是最後一行' });
  const ended = !!end && blank(end.at + 1, lines.length);
  const stop = end ? end.at : lines.length;
  let start = 0;
  if (r3) {
    for (const name of SECTIONS) {
      const same = found.filter(each => each.name === name);
      if (!same.length) errors.push({ line: 0, message: `少了 <<<${name}>>> 那一段：回覆可能沒有貼完整，或 AI 沒照格式交` });
      else if (same.length > 1) errors.push({ line: at(same[1].at), message: `<<<${name}>>> 出現了兩次` });
    }
    const deck = found.find(each => each.name === '卡組');
    const sections = found.filter(each => SECTIONS.includes(each.name));
    if (sections.length && !blank(0, sections[0].at)) errors.push({ line: at(lines.findIndex(line => line.trim() !== '')), message: '第一個標記前面有其他文字（例如「好的，以下是……」）：請只貼回覆本身，從第一個標記開始' });
    if (deck) {
      const after = found.find(each => each.at > deck.at && each.name !== END);
      if (after) errors.push({ line: at(after.at), message: `<<<卡組>>> 之後只能接 <<<完>>>，不能再有 <<<${after.name}>>>` });
      start = deck.at + 1;
      if (blank(start, stop)) errors.push({ line: at(deck.at), message: '<<<卡組>>> 這一段是空的：回覆可能沒有貼完整' });
    }
  } else {
    const first = lines.findIndex(line => line.trim() !== '');
    if (first >= 0 && first < stop && !looksLikeDeck(lines[first])) errors.push({ line: at(first), message: `第一行「${lines[first].trim().slice(0, 20)}」不是卡組的內容（例如「好的，以下是……」）：請只貼回覆本身` });
    if (blank(0, stop)) errors.push({ line: 0, message: '沒有卡組的內容：回覆可能沒有貼完整' });
  }
  return { start, end: stop, ended, errors };
}

/** 卡組段第一個非空行該長的樣子：引言框、標題、清單、屬性區（另外擋）；篇名行由拆篇判斷。其他（開場白）不猜。 */
const looksLikeDeck = (line: string): boolean => /^ {0,3}(>|#{1,6}\s|[-*+]\s|\d+[.)]\s|---\s*$)/.test(line) || readTerm(line.trim()) !== null;

/** 檔名裡不能用、或會破壞連結的字換成全形；開頭結尾的空白與句點拿掉（§4）。 */
export function safeFileName(name: string): string {
  const map: Record<string, string> = { '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜', '#': '＃', '^': '＾', '[': '［', ']': '］' };
  return name.replace(/[\\/:*?"<>|#^[\]]/g, char => map[char]).replace(/^[\s.]+|[\s.]+$/g, '');
}

const collapse = (text: string): string => text.replace(/[ \t　]+/g, ' ').trim();
const CODE_LIKE = /^(?:[0-9]+(?:-[0-9]+)*|[A-Za-z]+[0-9]+(?:-[0-9]+)*)$/;

/** 一篇：篇名與篇名行（整理後的行號；沒有篇名行是 null）、檔名（還沒加 ` 2` 這種後綴）、這一篇的行（整理後的行號，照順序）。 */
export interface Piece { title: string | null; line: number | null; name: string; lines: number[] }

/**
 * 拆篇（§4）：篇名行只認卡組段裡最外層、獨立的段落，整行等於篇名開頭，或它加一個空白再加篇名（用表單的值比，不猜）。
 * 疑似篇名（認得的年級學期接著科目、空白、單元編號）和表單不同、寫成標題，都是錯誤。第一個篇名行前面只有給家長的備註時併進第一篇。
 */
export function splitReply(normalized: Normalized, segments: Segments, form: CardForm, subject: Pick<RuleSubject, 'subject' | 'r3'>): { pieces: Piece[]; errors: ReplyIssue[] } {
  const { lines, raw } = normalized;
  const errors: ReplyIssue[] = [];
  const prefix = titlePrefix(form, subject);
  const range = lines.slice(segments.start, segments.end).map((text, i) => ({ no: segments.start + i, raw: text }));
  const blocks = blocksOf(range);
  const titles = new Map<number, string>();
  const formKey = { term: termKey(form.term.trim()), subject: subject.subject ?? '', code: codeKey(unitCode(form.unit)) };
  blocks.forEach((block, i) => {
    if (block.kind !== 'para' && block.kind !== 'heading') return;
    const text = collapse(block.text);
    const standalone = block.kind === 'para' && blocks[i - 1]?.kind !== 'para' && blocks[i + 1]?.kind !== 'para';
    if (prefix !== null && block.kind === 'para' && standalone && (text === prefix || text.startsWith(prefix + ' '))) { titles.set(block.line, text); return; }
    // 疑似篇名：認得的年級學期，接著科目、空白、單元編號。
    const term = readTerm(text);
    if (!term) return;
    const rest = /^\s*(\S+)\s+(\S+)/.exec(text.slice(term.length));
    if (!rest || !CODE_LIKE.test(codeKey(rest[2]))) return;
    const same = term.term === formKey.term && rest[1] === formKey.subject && codeKey(rest[2]) === formKey.code;
    const line = raw[block.line];
    if (!same) errors.push({ line, message: `這一行像篇名，但和這次填的單元不同（${prefix ?? form.unit}）：要分篇就照這次的單元寫，不是篇名就改寫這一行` });
    else if (block.kind === 'heading') errors.push({ line, message: `篇名請另起一行，不加 #：寫成「${text}」` });
    else errors.push({ line, message: `篇名請照「${prefix ?? ''} 篇名」寫，單獨一行` });
  });
  const pieces: Piece[] = [];
  const order = [...titles.keys()].sort((a, b) => a - b);
  if (!order.length) {
    const name = subject.subject === null ? `${collapse(form.unit)}（卡片）` : `${form.term.trim()}${subject.subject} ${collapse(form.unit)}（卡片）`;
    pieces.push({ title: null, line: null, name: safeFileName(name), lines: range.map(each => each.no) });
  } else {
    // 第一個篇名行前面：只有給家長的備註時，併進第一篇的最上面。
    const before = blocks.filter(block => block.line < order[0] && block.kind !== 'blank');
    const notes = before.every(block => block.kind === 'callout' && /^\s{0,3}>\s?\[![^\]]+\][-+]?\s*給(家長|學習者)的備註\s*$/.test(block.body[0].raw));
    if (!notes) for (const block of before) errors.push({ line: raw[block.line], message: '第一個篇名前面還有內容：請移到它所屬的那一篇（篇名行的下面）' });
    const seen = new Set<string>();
    order.forEach((line, i) => {
      const title = titles.get(line)!;
      if (seen.has(title)) errors.push({ line: raw[line], message: `篇名「${title}」出現了兩次` });
      seen.add(title);
      const next = order[i + 1] ?? segments.end;
      const own = range.filter(each => each.no > line && each.no < next).map(each => each.no);
      const head = i === 0 && notes ? range.filter(each => each.no < line).map(each => each.no) : [];
      pieces.push({ title, line, name: safeFileName(title), lines: [...head, ...own] });
    });
  }
  for (const piece of pieces) {
    const text = piece.lines.map(no => lines[no]).join('\n');
    if (!parseDeck(text).targets.length) errors.push({ line: piece.line === null ? 0 : raw[piece.line], message: `${piece.title === null ? '這一篇' : `「${piece.title}」`}沒有任何學習目標` });
  }
  return { pieces, errors };
}

/** 這一篇的文字（整理後的行，照順序）與它的第 i 行（從 0 算）在原文的行號。 */
export function pieceText(normalized: Normalized, piece: Piece): { text: string; rawLine: (line: number) => number } {
  return { text: piece.lines.map(no => normalized.lines[no]).join('\n'), rawLine: line => normalized.raw[piece.lines[line]] ?? 0 };
}

/** check 的問題裡，這幾種由這裡另外處理或這一版不適用：屬性區（擋）、AI 寫的 ID（拿掉）、一行兩個 ID（nameLineIds 擋）、加進已有的 ID（存草稿時核對）。 */
const HANDLED = new Set(['yaml', 'target-id', 'ambiguous-id', 'existing-id']);
/** 名稱有自己的寫法、不寫「能……」的科目（syntax §2-3 英文、國語預設〈名稱〉）。 */
const OWN_NAMES = new Set(['英文', '國語']);
/** 出處可以不寫的科目：英文預設「出處、類型不用寫（出處沒寫就是這一課）」（english.md〈錯題〉前的寫法）。 */
const SOURCE_OPTIONAL = new Set(['英文']);

/**
 * 清單結構跑掉的「不符」：照規則寫的 AI 輸出不會有（之前 13 份真實輸出都是 0 次），網頁的回覆複製按鈕卻會大量造成
 * （真人測試 2026-11-07：Gemini 壓平縮排、ChatGPT 把 `-` 跳脫成 `\-`）。存下去的草稿結構是錯的，所以在 AI 製卡擋下，
 * 一篇只報一次、指到第一處。出處與類型分兩行（data-position）不是複製造成的、照樣讀得懂，不在裡面。
 */
const STRUCTURE = new Set(['top-question', 'no-question', 'para']);

/**
 * 比較組混了別種題目（`pick-mixed`）在 AI 製卡是擋住的，原本的字句說的是存檔時照原題型出，改成直接說怎麼改
 * （真人測試 2026-11-08：`lend（borrow、lend） 比較` 底下一題答案寫 lent，家長看不出哪裡錯）。
 */
function pickMixed(result: CheckResult, issue: CheckResult['issues'][number]): string {
  const owner = [...result.targets, ...result.candidates].find(target => target.questions.some(question => question.line === issue.line));
  const word = owner ? pickWord(owner.name) : null;
  return word === null ? issue.msg : `比較題的每一題都要是「題目裡一個 ＿＿，答案是 ${word}」：這一題不是，請改成這樣的句子，或刪掉這一題`;
}

/** 一篇的檢查（§4〈檢查〉）：check-syntax 算錯誤的擋住、算不符的提示，提醒不列；清單結構跑掉的合成一個錯誤。 */
export function checkPiece(text: string, rawLine: (line: number) => number, subject: Pick<RuleSubject, 'subject' | 'r3'>, form: CardForm): { errors: ReplyIssue[]; hints: ReplyIssue[]; result: CheckResult } {
  const errors: ReplyIssue[] = [], hints: ReplyIssue[] = [], broken: number[] = [];
  const result = check(text, { subject: subject.subject ?? '一般知識', unit: subject.subject === null ? null : unitCode(form.unit) });
  for (const issue of result.issues) {
    if (issue.level === '提醒' || HANDLED.has(issue.code)) continue;
    if (issue.code === 'target-name' && OWN_NAMES.has(subject.subject ?? '')) continue;
    if (issue.code === 'no-source' && SOURCE_OPTIONAL.has(subject.subject ?? '')) continue;
    if (STRUCTURE.has(issue.code)) { broken.push(rawLine(issue.line - 1)); continue; }
    (issue.level === '錯誤' ? errors : hints).push({ line: rawLine(issue.line - 1), message: issue.code === 'pick-mixed' ? pickMixed(result, issue) : issue.msg });
  }
  // 處數算行：最上層的題目同時是「沒有題目的目標」，同一行不算兩處。
  if (broken.length) errors.push({ line: Math.min(...broken), message: `回覆的縮排或清單符號在複製時跑掉了（這一篇共 ${String(new Set(broken).size)} 處）：請按 AI 回覆裡程式碼區塊右上角的「複製」，再整段貼一次` });
  const first = text.split('\n').findIndex(line => line.trim() !== '');
  if (first >= 0 && text.split('\n')[first].trim() === '---') errors.push({ line: rawLine(first), message: 'AI 寫了屬性區（開頭的 ---）：請把屬性區刪掉，程式會加' });
  return { errors, hints, result };
}

/** 名稱那一行的 ID 寫法（§4）：中間有 D-134 認得的 ID、或一行兩個 ID 是錯誤；只有行尾一個時拿掉、記下。 */
export function nameLineIds(line: string): { trailing: string | null; error: string | null } {
  const found = nameIds(line);
  if (found.middle.length) return { trailing: null, error: '學習目標名稱那一行中間有 ID：AI 不寫 ID，請把它刪掉' };
  return { trailing: found.trailing ? found.trailing.id : null, error: null };
}

