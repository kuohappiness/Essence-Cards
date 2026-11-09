import { stringify } from 'yaml';
import { parseDeck, splitUnit, TRAILING_ID } from '../deck/index.ts';
import { PICK_NEEDS } from '../version/index.ts';
import { sha256Hex, titlePrefix } from './prompt.ts';
import type { CardForm, ExistingTarget } from './prompt.ts';
import { checkPiece, nameLineIds, normalizeReply, pieceText, quoteLine, safeFileName, segmentReply, splitReply } from './reply.ts';
import type { Normalized, Piece, ReplyIssue } from './reply.ts';
import type { RuleSubject } from './rules.ts';

// 檢查的結果與存草稿的全文（tasks/ai-cards-mvp.md §4、§5）：都在記憶體裡做，不寫檔。

/** 一個已有的學習目標現在的樣子（state 照最近讀到的內容回答）：剛好一個讀得懂的目標、找不到、或有好幾個／需要新版。 */
export type ExistingNow = { kind: 'one'; path: string; name: string } | { kind: 'none' } | { kind: 'unusable' };

/** 檢查過的一篇。 */
interface InspectedPiece extends Piece {
  targets: number;
  prompts: number;
  candidates: number;
  /** 加進已有的學習目標每一項：整理後的行號與 ID（不是 6 碼的 ID 也列，存草稿時照原文留著）。 */
  adds: { line: number; id: string }[];
  /** 新目標與候選的名稱行（整理後的行號）：存草稿時在行尾配 ID。 */
  names: number[];
  /** 有比較卡：卡組要寫 `需要版本`（D-191）。 */
  pick: boolean;
}

export interface Inspection {
  normalized: Normalized;
  /** 最後一行是單獨的 `<<<完>>>`；沒有時要家長勾「我確定整段都貼了」才能存。 */
  ended: boolean;
  /** 擋住，不能存。 */
  errors: ReplyIssue[];
  /** 提示，可以存。 */
  hints: ReplyIssue[];
  pieces: InspectedPiece[];
  /** AI 自己寫的 ID（§4）：整理後的行號與拿掉的字（`^abc123`）。存草稿時拿掉、記進快照的 `程式改動`。 */
  removed: { line: number; text: string }[];
}

const byLine = (a: ReplyIssue, b: ReplyIssue): number => a.line - b.line;

/** 加進已有的學習目標的一項現在能不能轉成連結（§5，格式查核 F8）；不能時回傳原因。 */
function addProblem(id: string, sent: readonly ExistingTarget[], now: (id: string) => ExistingNow): string | null {
  const before = sent.find(each => each.id === id);
  if (!before) return `「${id}」不在這次送出的已有學習目標裡`;
  const found = now(id);
  if (found.kind === 'none') return `找不到學習目標「${id}」`;
  if (found.kind === 'unusable') return `學習目標「${id}」重複或需要新版`;
  if (found.path !== before.path) return `學習目標「${id}」已經不在送出時的那一篇`;
  return null;
}

/**
 * 檢查貼回的回覆（§4）：整理、分段、拆篇，每一篇用 parseDeck 讀、再跑草稿的檢查。sent 是這次送出的已有學習目標，now 問 state 現在的樣子。
 * 沒有錯誤時 pieces 每一篇都可以存；有錯誤時 pieces 照樣列出（畫面寫原因用），不能存。
 */
export function inspectReply(reply: string, form: CardForm, subject: Pick<RuleSubject, 'subject' | 'r3'>, sent: readonly ExistingTarget[], now: (id: string) => ExistingNow): Inspection {
  const normalized = normalizeReply(reply);
  const segments = segmentReply(normalized, subject.r3);
  const errors = [...segments.errors], hints: ReplyIssue[] = [];
  const removed: Inspection['removed'] = [];
  const pieces: InspectedPiece[] = [];
  if (!segments.errors.length) {
    const split = splitReply(normalized, segments, form, subject);
    errors.push(...split.errors);
    for (const piece of split.pieces) {
      const { text, rawLine } = pieceText(normalized, piece);
      const checked = checkPiece(text, rawLine, subject, form);
      errors.push(...checked.errors);
      hints.push(...checked.hints);
      const deck = parseDeck(text);
      const result = checked.result;
      const lines = text.split('\n');
      const names: number[] = [];
      // 新目標的名稱行（最上層直接寫題目的沒有名稱行，存檔時才由一般的補 ID 補上）與候選的名稱行。
      const own = [...deck.targets.filter(t => !t.implicit).map(t => t.line), ...result.candidates.map(t => t.line - 1)];
      for (const line of own) {
        const ids = nameLineIds(lines[line]);
        if (ids.error) { errors.push({ line: rawLine(line), message: ids.error }); continue; }
        if (ids.trailing !== null) {
          const match = TRAILING_ID.exec(lines[line]);
          removed.push({ line: piece.lines[line], text: match ? match[0].trim() : '^' + ids.trailing });
          hints.push({ line: rawLine(line), message: `AI 自己寫了 ID「^${ids.trailing}」：拿掉，存草稿時重配` });
        }
        names.push(piece.lines[line]);
      }
      for (const [i, line] of lines.entries()) if (/!\[\[[^\]]*\]\]/.test(line)) hints.push({ line: rawLine(i), message: '附件沒有圖檔，這張圖不會顯示' });
      const adds = result.existing.map(each => ({ line: piece.lines[each.line - 1], id: each.id ?? /^(\S+)/.exec(each.name)?.[1] ?? '' }));
      for (const add of adds) {
        const problem = addProblem(add.id, sent, now);
        if (problem) hints.push({ line: normalized.raw[add.line], message: `${problem}：照原文留在框裡，不轉成連結` });
      }
      pieces.push({ ...piece, names, adds, pick: deck.targets.some(t => t.group), targets: deck.targets.length, prompts: deck.targets.reduce((sum, t) => sum + t.prompts.length, 0), candidates: result.candidates.length });
    }
  }
  // 寫出最後一行（真人測試 2026-11-08：還沒寫完就按了複製，家長看不出少了 <<<完>>>，就勾了確定）。
  if (!segments.ended) {
    const last = normalized.lines.findLastIndex(line => line.trim() !== '');
    hints.push({ line: last < 0 ? 0 : normalized.raw[last], message: '最後一行不是 <<<完>>>：AI 可能還沒寫完，或沒有整段複製。回 AI 那邊看它寫完了沒，寫完再按程式碼區塊的「複製」重貼一次' });
  }
  const quoted = (issue: ReplyIssue): ReplyIssue => {
    const quote = issue.line ? quoteLine(reply, issue.line) : undefined;
    return quote === undefined ? issue : { ...issue, quote };
  };
  return { normalized, ended: segments.ended, errors: errors.sort(byLine).map(quoted), hints: hints.sort(byLine).map(quoted), pieces, removed };
}

/**
 * 按「啟用」先問的數字（§7，L2-11）：ready 是啟用後排得進去的目標（同 catalog 的 usableTarget：讀得懂、沒暫停、有 ID，再扣掉 stopped 判定停出的），其他各算一種沒排進去的原因。
 * stopped 由 state.aiStopped 給，和正式排程同一套條件（R2-8）。
 */
export function activationCounts(text: string, stopped: (target: { id: string; line: number }) => boolean): { ready: number; malformed: number; paused: number; stopped: number; noId: number } {
  const counts = { ready: 0, malformed: 0, paused: 0, stopped: 0, noId: 0 };
  for (const target of parseDeck(text).targets) {
    if (!target.ok) counts.malformed++;
    else if (target.fields.paused) counts.paused++;
    else if (target.id === null) counts.noId++;
    else if (stopped({ id: target.id, line: target.line })) counts.stopped++;
    else counts.ready++;
  }
  return counts;
}

/** 卡組放在哪（§5，D-040 的預設編排）：學業卡組 `Essence Cards/學業/<年級學期>/<科目>/`，一般知識 `Essence Cards/`。 */
function deckFolder(form: Pick<CardForm, 'term'>, subject: Pick<RuleSubject, 'subject'>): string {
  return subject.subject === null ? 'Essence Cards' : `Essence Cards/學業/${form.term.trim()}/${subject.subject}`;
}
const SNAPSHOT_FOLDER = 'Essence Cards/紀錄/AI 輸出';
const RAW_FOLDER = SNAPSHOT_FOLDER + '/原文';
/** 原文的檔（§5）：SHA-256 前 12 碼。 */
export const rawPath = (sha: string): string => `${RAW_FOLDER}/${sha.slice(0, 12)}.md`;

/** 不撞名的檔名（§5〈檔名在寫之前就定好〉）：整個 vault 的檔名（大小寫不同也算撞）都沒有人用，撞了往後加 ` 2`、` 3`……；用掉的加進 taken。 */
export function freeName(base: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${String(n)}`;
    if (!taken.has(name.toLowerCase())) { taken.add(name.toLowerCase()); return name; }
  }
}

/** 一篇卡組的全文要寫成的樣子。 */
interface PlannedDeck { path: string; base: string; text: string; sha256: string; ids: string[] }
export interface PlannedDraft {
  decks: PlannedDeck[];
  /** 快照本文（§5〈快照〉）：整理後的整段回覆，名稱行只多了配好的 ID、少了 AI 的 ID；加進已有的照原文。 */
  snapshotBody: string;
  snapshotPath: string;
  /** 快照還沒加後綴的檔名；卡組的在 PlannedDeck.base。之後再撞名照這個遞增（R4-4）。 */
  snapshotBase: string;
  /** 快照的 `程式改動`：「第 37 行 拿掉 ^abc123」（行號是原文的）。 */
  edits: string[];
}

/** 屬性用 YAML 序列化寫（§5）：`L3 Sports: Week 1` 這種值才會加引號。 */
function properties(form: CardForm, subject: Pick<RuleSubject, 'subject' | 'r3'>, pick: boolean): string {
  const unit = form.unit.trim().replace(/[ \t　]+/g, ' ');
  const props: Record<string, string> = subject.subject === null ? { 狀態: '草稿' } : { 年級學期: form.term.trim(), 科目: subject.subject, 單元: unit, 狀態: '草稿' };
  if (pick) props['需要版本'] = PICK_NEEDS;
  return '---\n' + stringify(props, { lineWidth: 0 }) + '---\n';
}

/** 加進已有的學習目標那一項改成連結（§5）：開頭的 `ID 名稱` 換成 `[[卡組檔名#^ID|現在的名稱]]`。 */
function linked(line: string, id: string, found: { path: string; name: string }): string {
  const match = /^(\s{0,3}>\s?\s*(?:[-*+]|\d+[.)])\s+)(\S+)(?:\s+.*)?$/.exec(line);
  if (!match || match[2] !== id) return line;
  const file = found.path.slice(found.path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  return `${match[1]}[[${file}#^${id}|${found.name.replace(/[|\]]/g, char => char === '|' ? '｜' : '］')}]]`;
}

/**
 * 存草稿的第 1 步（§5）：定好每一篇的目的地、配好 ID、做出每一篇卡組與快照本文的全文。next() 給一個新的 ID（state 配的，已經避開所有占用）；
 * taken 是整個 vault 現在的檔名（小寫、不含 .md），用掉的會加進去。date 是快照檔名的日期（YYYY-MM-DD）。
 */
export function planDraft(inspection: Inspection, form: CardForm, subject: Pick<RuleSubject, 'subject' | 'r3'>, sent: readonly ExistingTarget[], now: (id: string) => ExistingNow,
  next: () => string, taken: Set<string>, date: string): PlannedDraft {
  if (inspection.errors.length) throw Error('還有擋住的錯誤，不能存草稿');
  const { lines, raw } = inspection.normalized;
  // 名稱行的改動：拿掉 AI 的 ID、行尾配上新的 ID。快照與卡組都套用。
  const edited = [...lines];
  const removedAt = new Set(inspection.removed.map(each => each.line));
  const edits = inspection.removed.map(each => `第 ${String(raw[each.line])} 行 拿掉 ${each.text}`);
  const folder = deckFolder(form, subject);
  const decks: PlannedDeck[] = [];
  for (const piece of inspection.pieces) {
    const ids: string[] = [];
    for (const line of piece.names) {
      const base = removedAt.has(line) ? edited[line].replace(TRAILING_ID, '') : edited[line].replace(/[ \t]+$/, '');
      const id = next();
      ids.push(id);
      edited[line] = `${base} ^${id}`;
    }
    const body = piece.lines.map(no => {
      const add = piece.adds.find(each => each.line === no);
      if (!add || addProblem(add.id, sent, now)) return edited[no];
      const found = now(add.id);
      return found.kind === 'one' ? linked(edited[no], add.id, found) : edited[no];
    });
    while (body.length && body[0].trim() === '') body.shift();
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    const text = properties(form, subject, piece.pick) + '\n' + body.join('\n') + '\n';
    const deck = parseDeck(text);
    const unit = splitUnit(form.unit);
    const props = deck.props;
    // 寫之前先讀回來核對（§5）：狀態是草稿、屬性和要寫的相同、每個新 ID 都在某一行的行尾。
    const same = props.status === 'draft' && (subject.subject === null
      ? props.term === null && props.subject === null
      : props.term === form.term.trim() && props.subject === subject.subject && props.unit?.code === unit.code && props.unit.name === unit.name.replace(/[ \t　]+/g, ' '));
    const trailing = new Set(text.split('\n').map(line => TRAILING_ID.exec(line)?.[1]).filter((id): id is string => !!id));
    if (!same || (piece.pick && props.need !== PICK_NEEDS) || !ids.every(id => trailing.has(id))) throw Error(`做出來的卡組讀回來和要寫的不同：${piece.name}`);
    decks.push({ path: `${folder}/${freeName(piece.name, taken)}.md`, base: piece.name, text, sha256: sha256Hex(text), ids });
  }
  const prefix = titlePrefix(form, subject);
  const label = prefix === null ? form.unit.trim() : `${form.term.trim()}${subject.subject ?? ''} ${form.unit.trim()}`;
  const snapshotBase = safeFileName(`${date} ${label}`.replace(/[ 	　]+/g, ' '));
  const snapshot = freeName(snapshotBase, taken);
  return { decks, snapshotBody: edited.join('\n'), snapshotPath: `${SNAPSHOT_FOLDER}/${snapshot}.md`, snapshotBase, edits };
}

