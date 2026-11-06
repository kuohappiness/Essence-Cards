import { codeKey, tidy } from '../deck/index.ts';
import type { CatalogIndex } from './index.ts';
import { compareText, headEditor, headOf, headValues, idOf, LINE_END, linesWithEnds, LIST_MARK, looseId, piecesOf, QUIZ_FOLDER, readDate, readLine, scopeDay, scopeWritable, subjectOf, termOf, unitLine } from './scope.ts';
import type { ScopeDate, ScopeUnit } from './scope.ts';

// 小考檔（tasks/quiz-mark.md §1、syntax.md §4-1、D-189 第 4、5 點）：日期、單元那一行與識別碼借用段考的讀法（scope.ts），必填的日期、只有一個目標、生效與取消是小考自己的規則。不改排程，所以不碰 study。

/** 小考檔：考試範圍/小考/ 整棵底下的 Markdown。 */
export const isQuizFile = (path: string): boolean => path.startsWith(QUIZ_FOLDER + '/') && path.endsWith('.md');

/** 內文的目標：單元、連結的原字；bad 是寫法有問題。 */
type QuizTarget = { kind: 'unit'; unit: ScopeUnit } | { kind: 'link'; link: string } | { kind: 'bad' };
export interface QuizFile {
  /** 識別碼；沒有或空白是 null。屬性區壞了也照認看得出來的（和段考相同）。 */
  id: string | null;
  date: ScopeDate;
  /** 屬性區讀得出來而且有 `取消` 這個鍵（值是什麼都算）。 */
  cancelled: boolean;
  /** 屬性區讀不出來：日期算有問題，外掛不寫這種檔。不從字串猜取消。 */
  broken: boolean;
  target: QuizTarget;
}

// ── 讀一份 ──

/** `[[連結]]` 的路徑（別名與 # 後面不算）；不是剛好一個連結是 null。清單符號與行尾的標點是打字雜訊，和範圍行同一種看法。 */
function readLink(raw: string): string | null {
  const open = raw.indexOf('[['), close = raw.lastIndexOf(']]');
  if (open < 0 || close < open) return null;
  const before = tidy(raw.slice(0, open)).trimStart(), after = tidy(raw.slice(close + 2)).replace(LINE_END, '');
  // 多接一個字才認得出 `-` 後面沒有空白的清單符號。
  if ((before + 'x').replace(LIST_MARK, '') !== 'x' || after !== '') return null;
  const inner = raw.slice(open + 2, close);
  if (/[[\]]/.test(inner)) return null;
  return inner.split('|')[0].split('#')[0].trim() || null;
}

/** 內文恰好一個非空白的行（§1）：段考的讀法會略過標題，所以先驗行數，再把連結和單元分開。 */
function readTarget(pieces: readonly string[]): QuizTarget {
  const lines = pieces.filter(piece => tidy(piece).trim() !== '');
  if (lines.length !== 1) return { kind: 'bad' };
  const link = readLink(lines[0]);
  if (link !== null) return { kind: 'link', link };
  if (lines[0].includes('[[')) return { kind: 'bad' };
  const read = readLine(lines[0], 0);
  return read?.kind === 'unit' ? { kind: 'unit', unit: { term: read.term, subject: read.subject, code: read.code } } : { kind: 'bad' };
}

export function parseQuiz(text: string): QuizFile {
  const pieces = piecesOf(text);
  const head = headOf(pieces);
  if (!head) return { id: null, date: { kind: 'none' }, cancelled: false, broken: false, target: readTarget(pieces) };
  const none = { date: { kind: 'none' }, cancelled: false, broken: true } as const;
  if (head.close < 0) return { ...none, id: looseId(head.raw), target: { kind: 'bad' } };
  const target = readTarget(pieces.slice(head.close + 1));
  const values = headValues(head.raw);
  if (!values) return { ...none, id: looseId(head.raw), target };
  return { id: idOf(values), date: readDate(values['小考日期']), cancelled: Object.hasOwn(values, '取消'), broken: false, target };
}

// ── 每一列 ──

/** 連結解析的結果（真的解析在 Obsidian 層，state 傳進來）：指向一個檔、找不到、重名認不出是哪一個。 */
export type QuizResolved = { kind: 'file'; path: string } | { kind: 'none' } | { kind: 'several' };
/** 目錄的哪裡：單元的鍵或卡組路徑。 */
export type QuizRef = { unit: string } | { deck: string };
/** date 日期有問題；body 內文寫法有問題；unmatched 單元對不到卡組；missing 找不到這一篇；several 認不出是哪一篇；copies 同一個識別碼的檔不一樣。 */
export type QuizProblem = 'date' | 'body' | 'unmatched' | 'missing' | 'several' | 'copies';
export interface QuizRow {
  /** 畫面的鍵：識別碼，沒有就是路徑。 */
  key: string;
  id: string | null;
  /** 這次小考的每一份檔，照路徑；第一份是畫面要打開的。 */
  paths: readonly string[];
  /** 讀得懂而且大家一樣的小考日期；待修正的可能是 null。 */
  date: string | null;
  problem: QuizProblem | null;
  subject: string | null;
  /** 單元名或篇名；看不出來時是檔名或連結的最後一段。 */
  name: string;
  /** 指到目錄的哪裡（目錄的按鈕用）；對不到、找不到是空的。副本不一樣時可能有好幾個。 */
  refs: readonly QuizRef[];
  /** 全部卡的 N：現在可以練的目標數。待修正的是 0。 */
  count: number;
  /** 比「同一個目標」用；待修正而且看不出目標是 null。 */
  same: string | null;
}
export interface QuizContext {
  /** 今天的日編號（清晨 4 點換日）。 */
  day: number;
  index: Pick<CatalogIndex, 'units' | 'unitTargets' | 'deckTargets'>;
  /** 這個路徑是已知的卡組（轉錄稿不算）。 */
  known: (path: string) => { subject: string | null } | null;
  resolve: (link: string, from: string) => QuizResolved;
}

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const unitSame = (unit: ScopeUnit): string => 'unit:' + JSON.stringify([termOf(unit.term), subjectOf(unit.subject), codeKey(unit.code)]);
const deckSame = (path: string): string => 'deck:' + path;

/** 一份的目標對到目錄之後的樣子。 */
interface Reading {
  problem: QuizProblem | null;
  subject: string | null;
  name: string;
  ref: QuizRef | null;
  count: number;
  same: string | null;
}
function readEntry(path: string, target: QuizTarget, context: QuizContext): Reading {
  const blank = { subject: null, name: fileName(path), ref: null, count: 0, same: null };
  if (target.kind === 'bad') return { ...blank, problem: 'body' };
  if (target.kind === 'unit') {
    const { unit } = target, same = unitSame(unit);
    const node = context.index.units.find(each => unitSame({ term: each.term ?? '', subject: each.subject ?? '', code: each.code ?? '' }) === same);
    if (!node) return { ...blank, problem: 'unmatched', subject: unit.subject, name: `${unit.term} ${unit.code}`, same };
    return { problem: null, subject: node.subject, name: node.name, ref: { unit: node.key }, count: context.index.unitTargets(node.key).length, same };
  }
  const linkName = target.link.slice(target.link.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const resolved = context.resolve(target.link, path);
  if (resolved.kind === 'several') return { ...blank, problem: 'several', name: linkName };
  const deck = resolved.kind === 'file' ? context.known(resolved.path) : null;
  if (resolved.kind !== 'file' || !deck) return { ...blank, problem: 'missing', name: linkName };
  return { problem: null, subject: deck.subject, name: fileName(resolved.path), ref: { deck: resolved.path }, count: context.index.deckTargets(resolved.path).length, same: deckSame(resolved.path) };
}

const dateOf = (file: QuizFile): string | null => !file.broken && file.date.kind === 'ok' ? file.date.date : null;
/** 比副本一不一樣：日期（壞掉的照原字）與目標（解析後的卡組、正規化後的三欄）。 */
function fingerprint(file: QuizFile, read: Reading): string {
  const date = file.broken ? 'broken' : file.date.kind === 'ok' ? file.date.date : file.date.kind === 'bad' ? 'bad:' + file.date.raw : 'none';
  const target = read.same ?? (file.target.kind === 'link' ? 'link:' + file.target.link : 'bad');
  return JSON.stringify([date, target]);
}

/** 一組（同一個識別碼，或沒有識別碼的一份）的一列；過了小考日期的是 null。 */
function groupRow(copies: readonly { path: string; file: QuizFile }[], context: QuizContext): QuizRow | null {
  const { day } = context;
  const reads = copies.map(({ path, file }) => ({ path, file, read: readEntry(path, file.target, context) }));
  const first = reads[0];
  const passed = (file: QuizFile): boolean => { const date = dateOf(file); return date !== null && day > scopeDay(date); };
  const base = { key: first.file.id ?? first.path, id: first.file.id, paths: reads.map(each => each.path), subject: first.read.subject, name: first.read.name };
  if (new Set(reads.map(({ file, read }) => fingerprint(file, read))).size > 1) {
    // 兩份都過了就不用修；否則不自己挑（§1）。
    if (reads.every(each => passed(each.file))) return null;
    const refs = [...new Map(reads.flatMap(each => each.read.ref ? [[JSON.stringify(each.read.ref), each.read.ref] as const] : [])).values()];
    return { ...base, date: null, problem: 'copies', refs, count: 0, same: null };
  }
  const date = dateOf(first.file);
  const refs = first.read.ref ? [first.read.ref] : [];
  // 日期有問題：不失效、不猜（§1）。
  if (date === null) return { ...base, date: null, problem: 'date', refs, count: 0, same: first.read.same };
  if (passed(first.file)) return null;
  return { ...base, date, problem: first.read.problem, refs, count: first.read.problem === null ? first.read.count : 0, same: first.read.same };
}

/**
 * 現在要顯示的每一列（§1、§4）：先按識別碼分組（任何一份有 `取消`，整組都取消）；同一個目標好幾份生效時用日期早的，一樣早的照路徑；
 * 待修正的不參加比較，正常的照樣可以練，壞的照樣看得到。照日期、科目、名稱排，沒有日期的在最後。輸入順序不影響結果。
 */
export function quizRows(entries: readonly { path: string; file: QuizFile }[], context: QuizContext): QuizRow[] {
  const sorted = [...entries].sort((a, b) => compareText(a.path, b.path));
  const groups = new Map<string, { path: string; file: QuizFile }[]>();
  for (const each of sorted) {
    const key = each.file.id === null ? 'path:' + each.path : 'id:' + each.file.id;
    const group = groups.get(key);
    if (group) group.push(each);
    else groups.set(key, [each]);
  }
  const rows = [...groups.values()].filter(copies => !copies.some(each => each.file.cancelled)).flatMap(copies => groupRow(copies, context) ?? []);
  const compareDate = (a: QuizRow, b: QuizRow): number => compareText(a.date ?? '9', b.date ?? '9');
  const chosen = new Map<string, QuizRow>();
  for (const row of rows) {
    if (row.same === null || row.date === null || (row.problem !== null && row.problem !== 'unmatched')) continue;
    const other = chosen.get(row.same);
    if (!other || compareDate(row, other) < 0 || (compareDate(row, other) === 0 && compareText(row.paths[0], other.paths[0]) < 0)) chosen.set(row.same, row);
  }
  const kept = rows.filter(row => row.same === null || row.date === null || (row.problem !== null && row.problem !== 'unmatched') || chosen.get(row.same) === row);
  return kept.sort((a, b) => compareDate(a, b) || compareText(a.subject ?? '', b.subject ?? '') || compareText(a.name, b.name) || compareText(a.paths[0], b.paths[0]));
}

// ── 寫 ──

/** 目錄交出的目標：單元或一篇卡組。 */
export type QuizInput = { unit: ScopeUnit } | { deck: string };
/** 和 QuizRow 的 same 同一種比法。 */
export const quizInputSame = (input: QuizInput): string => 'unit' in input ? unitSame(input.unit) : deckSame(input.deck);
/** 寫成一行、讀回來還是同一個才算寫得出來；寫不出來是 null（連結不能用的字、讀不回來的單元）。 */
export function quizLine(input: QuizInput): string | null {
  if ('unit' in input) return scopeWritable(input.unit) ? unitLine(input.unit) : null;
  const link = quizLink(input.deck);
  const line = `- [[${link}]]`;
  return readLink(line) === link ? line : null;
}
/** 外掛寫的連結：vault 路徑，去掉 `.md`。 */
export const quizLink = (path: string): string => path.replace(/\.md$/, '');
export const newQuizText = ({ id, date, line }: { id: string; date: string; line: string }): string => ['---', '識別碼: ' + id, '小考日期: ' + date, '---', line, ''].join('\n');
/** 新檔的檔名（不含 .md 與資料夾）：建立時的小考日期加「小考」；之後改日期不改名。 */
export const quizFileName = (date: string): string => date + ' 小考';

/** 畫面交出的變動：改日期、取消的日期；id 是還沒有識別碼時補的。 */
interface QuizChange { date?: string; cancelled?: string; id?: string }
type QuizEdit = { kind: 'ok'; text: string } | { kind: 'blocked'; reason: 'changed' | 'broken' };

/** 外掛不碰的屬性（比對用）。 */
function otherProps(raw: string): string {
  const skip = new Set(['識別碼', '小考日期', '取消']);
  return JSON.stringify(Object.entries(headValues(raw) ?? {}).filter(([key]) => !skip.has(key)));
}

/**
 * 把變動套到這份文字（§1）：只動那一行，手寫的註解、引號、CRLF 與內文都照留。空字串是檔不見，已經取消的不改回去，屬性區壞了不寫；
 * 讀回來不是要的結果（`{小考日期: …}` 這種寫法一行一行改會改壞）也不寫。
 */
export function editQuiz(text: string, change: QuizChange): QuizEdit {
  if (text === '') return { kind: 'blocked', reason: 'changed' };
  const before = parseQuiz(text);
  if (before.broken) return { kind: 'blocked', reason: 'broken' };
  if (before.cancelled) return { kind: 'blocked', reason: 'changed' };
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const lines = linesWithEnds(text.slice(bom.length));
  const close = lines[0]?.raw.trim() === '---' ? lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line.raw)) : -1;
  if (close <= 0) return { kind: 'blocked', reason: 'broken' };
  const eol = lines[0].eol || '\n';
  const raw = lines.slice(1, close).map(line => line.raw + line.eol).join('');
  const head = headEditor(raw, eol);
  if (before.id === null && change.id !== undefined && !head.setValue('識別碼', change.id)) head.insert(0, '識別碼: ' + change.id);
  if (change.date !== undefined && !head.setValue('小考日期', change.date)) head.insert(null, '小考日期: ' + change.date);
  if (change.cancelled !== undefined) head.insert(null, '取消: ' + change.cancelled);
  const edited = head.result();
  const result = bom + lines[0].raw + lines[0].eol + edited + lines.slice(close).map(line => line.raw + line.eol).join('');
  const after = parseQuiz(result);
  const wantedDate: ScopeDate = change.date === undefined ? before.date : { kind: 'ok', date: change.date };
  const asWanted = !after.broken && after.id === (before.id ?? change.id ?? null) && after.cancelled === (change.cancelled !== undefined)
    && JSON.stringify(after.date) === JSON.stringify(wantedDate) && JSON.stringify(after.target) === JSON.stringify(before.target) && otherProps(edited) === otherProps(raw);
  return asWanted ? { kind: 'ok', text: result } : { kind: 'blocked', reason: 'broken' };
}
