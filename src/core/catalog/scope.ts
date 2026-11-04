import { isMap, parseDocument } from 'yaml';
import { chapterAlias, codeKey, readTerm, termKey, tidy } from '../deck/index.ts';

// 考試範圍檔（tasks/exam-scope.md §2、syntax.md §4、D-176）：只看字面，不看卡組。讀懂的、對不到卡組的、看不懂的分開，都留著讓畫面寫出來。

const EXAM_FOLDER = 'Essence Cards/考試範圍';
export const isExamPath = (path: string): boolean => path.startsWith(EXAM_FOLDER + '/') && path.endsWith('.md');

/** 一行範圍。line 從 0 算，raw 是原字；unit 的三欄是讀到的標準寫法。 */
type ScopeLine =
  | { kind: 'unit'; line: number; raw: string; term: string; subject: string; code: string }
  | { kind: 'category' | 'unreadable'; line: number; raw: string };
/** 日期：none 是沒寫；bad 的 why 分看不懂（format）與不存在（nonexistent），畫面寫的字不同。 */
type ScopeDate = { kind: 'none' } | { kind: 'ok'; date: string } | { kind: 'bad'; raw: string; why: 'format' | 'nonexistent' };
export interface ScopeFile {
  /** 識別碼；沒有或空白是 null。 */
  id: string | null;
  start: ScopeDate;
  end: ScopeDate;
  /** 有 `提前結束` 這一行（值是什麼都算）。 */
  ended: boolean;
  /** 屬性區讀不出來：日期算有問題，外掛不寫這種檔（§2-2）。 */
  broken: boolean;
  lines: ScopeLine[];
}
/** 單元的身分：年級學期、科目、編號，都是原字，比對時才去雜訊。 */
interface ScopeUnit { term: string; subject: string; code: string }

// ── 日期 ──

const DAY = 86_400_000;
function toDate(year: number, month: number, day: number): string | null {
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}
/** 屬性的值或畫面打的字。數字只收整數（裸寫的 `20261028` 在 YAML 是數字）；布林、清單、Date 算看不懂。 */
export function readDate(value: unknown): ScopeDate {
  if (value === undefined || value === null) return { kind: 'none' };
  const number = typeof value === 'number' && Number.isInteger(value);
  if (typeof value !== 'string' && !number) return { kind: 'bad', raw: JSON.stringify(value), why: 'format' };
  const raw = typeof value === 'string' ? value : String(value), text = tidy(raw).trim();
  if (!text) return { kind: 'none' };
  const match = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(text);
  const parts = match ? [match[1], match[3], match[4]] : /^(\d{4})(\d{2})(\d{2})$/.exec(text)?.slice(1);
  if (!parts) return { kind: 'bad', raw, why: 'format' };
  const date = toDate(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  return date ? { kind: 'ok', date } : { kind: 'bad', raw, why: 'nonexistent' };
}
/** 日期的日編號，和 study 的 dayOf 同一種算法（清晨 4 點換日）。 */
export const scopeDay = (date: string): number => Date.parse(date + 'T00:00:00Z') / DAY;

type ScopePeriod = { kind: 'none' | 'bad' } | { kind: 'ok'; start: string; end: string };
/** 考試期間（§2-2 的表）：只有一邊就是一天。 */
export function scopePeriod(file: ScopeFile): ScopePeriod {
  const { start, end } = file;
  if (file.broken || start.kind === 'bad' || end.kind === 'bad') return { kind: 'bad' };
  if (start.kind === 'none' && end.kind === 'none') return { kind: 'none' };
  const first = start.kind === 'ok' ? start.date : end.kind === 'ok' ? end.date : '';
  const last = end.kind === 'ok' ? end.date : first;
  return first <= last ? { kind: 'ok', start: first, end: last } : { kind: 'bad' };
}

// ── 一行 ──

const LIST_MARK = /^(?:[-*+]|\d+[.)])(?: |(?=[^\d])) ?(?:\[[ xX]\] )?/;
const LINE_END = /[,/;、。.\s]+$/;
/** 行中的這些字是一行好幾項或區間：不拆不猜（D-176 第 7 點）。要在吃名稱之前擋。 */
const SEVERAL = /[,、;/~]|\d ?[到至] ?\d/;
const NUMERIC = /^\d+(?:-\d+)*$/;
const LETTERED = /^[A-Za-z]+\d+(?:-\d+)*$/;
const looksLikeCode = (word: string): boolean => NUMERIC.test(word) || LETTERED.test(word);

function hasTerm(text: string): boolean {
  for (let at = 0; at < text.length; at++) if (readTerm(text.slice(at))) return true;
  return false;
}

/** 科目與編號（§2-1 第 4 步）。讀不懂是 null。 */
function readRest(rest: string): { subject: string; code: string } | null {
  const words = chapterAlias(rest)
    .replace(/(?<![A-Za-z0-9])([A-Za-z]{1,2}) (\d+)(?![0-9A-Za-z-])/g, '$1$2')
    .replace(/(^| )單元 ?(?=\S)/g, '$1')
    .split(' ').filter(Boolean);
  if (words.length < 2) return null;
  // 第一個字一定是科目的一部分（`Math2 L1`）。
  const at = words.findIndex((word, index) => index > 0 && looksLikeCode(word));
  if (at < 0) return { subject: words.slice(0, -1).join(' '), code: words[words.length - 1] };
  const code = words[at], name = words.slice(at + 1);
  const sameKind = NUMERIC.test(code) ? NUMERIC : LETTERED;
  // 名稱不看，但同一類的編號或年級學期就是寫了兩個（`2-1 2-2`）；不同類的是名稱（`2-1 CO2 的性質`）。
  if (name.some(word => sameKind.test(word)) || hasTerm(name.join(' '))) return null;
  return { subject: words.slice(0, at).join(' '), code };
}

function readLine(raw: string, line: number): ScopeLine | null {
  const text = tidy(raw).trim();
  if (!text || /^#{1,6}(?: |$)/.test(text)) return null;
  const body = text.replace(LIST_MARK, '').replace(LINE_END, '').trim();
  if (/^分類 ?:/.test(body)) return { kind: 'category', line, raw };
  const unreadable: ScopeLine = { kind: 'unreadable', line, raw };
  if (SEVERAL.test(body)) return unreadable;
  const known = readTerm(body);
  const space = body.indexOf(' ');
  const term = known ? known.term : space < 0 ? body : body.slice(0, space);
  const rest = (known ? body.slice(known.length) : space < 0 ? '' : body.slice(space + 1)).trim();
  const read = readRest(rest);
  return read ? { kind: 'unit', line, raw, term, subject: read.subject, code: read.code } : unreadable;
}

// ── 一份檔 ──

/** 讀屬性區。沒有結束的 `---` 算壞，全部字都是屬性區（syntax §2-1 的「需要版本」同一種看法）。 */
export function parseScope(text: string): ScopeFile {
  const pieces = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const file: ScopeFile = { id: null, start: { kind: 'none' }, end: { kind: 'none' }, ended: false, broken: false, lines: [] };
  let body = 0;
  if (pieces[0].trim() === '---') {
    const close = pieces.findIndex((piece, index) => index > 0 && /^---\s*$/.test(piece));
    const raw = pieces.slice(1, close < 0 ? pieces.length : close).join('\n');
    if (close < 0) return { ...file, broken: true, ended: raw.includes('提前結束') };
    body = close + 1;
    const doc = parseDocument(raw);
    const data = doc.errors.length ? undefined : doc.toJS() as unknown;
    if (data === undefined || (data !== null && (!isMap(doc.contents) || typeof data !== 'object'))) {
      file.broken = true;
      file.ended = raw.includes('提前結束');
    } else {
      const values = (data ?? {}) as Record<string, unknown>;
      const id = values['識別碼'];
      if ((typeof id === 'string' || typeof id === 'number') && String(id).trim()) file.id = String(id).trim();
      file.start = readDate(values['考試開始']);
      file.end = readDate(values['考試結束']);
      file.ended = Object.hasOwn(values, '提前結束');
    }
  }
  for (let at = body; at < pieces.length; at++) {
    const line = readLine(pieces[at], at);
    if (line) file.lines.push(line);
  }
  return file;
}

// ── 比對 ──

const termOf = (term: string): string => tidy(termKey(term)).trim().toLowerCase();
const subjectOf = (subject: string): string => tidy(subject).trim().toLowerCase();
/** 層級照編號（D-033）：相同，或在它底下而且後面每一段都不是空的（`2-`、`2--1` 不在 `2` 底下）。 */
function covers(code: string, other: string): boolean {
  if (code === other) return true;
  return other.startsWith(code + '-') && other.slice(code.length + 1).split('-').every(Boolean);
}
export function unitInScope(file: ScopeFile, unit: ScopeUnit): boolean {
  const term = termOf(unit.term), subject = subjectOf(unit.subject), code = codeKey(unit.code);
  return file.lines.some(line => line.kind === 'unit' && termOf(line.term) === term && subjectOf(line.subject) === subject && covers(codeKey(line.code), code));
}

// ── 選哪一份（§2-3）──

const hasUnit = (file: ScopeFile): boolean => file.lines.some(line => line.kind === 'unit');
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/**
 * 先按識別碼分組（同一個識別碼任一份結束，整組都結束，舊副本不會復活）；沒有識別碼的各自算一次考試。還生效而且有讀得懂的行才是候選；
 * 沒有候選但有還生效的檔時回傳那一份（usable 是 false），畫面寫行數，排程當成沒有範圍。others 是其他也生效的候選。
 */
export function chooseScope<T extends { path: string; file: ScopeFile }>(entries: readonly T[], day: number): { chosen: T | null; usable: boolean; others: string[] } {
  const groupOf = (each: T): string => each.file.id === null ? 'path:' + each.path : 'id:' + each.file.id;
  const over = new Set(entries.filter(each => each.file.ended).map(groupOf));
  const alive = entries.filter(each => {
    if (over.has(groupOf(each))) return false;
    const period = scopePeriod(each.file);
    return period.kind !== 'ok' || day <= scopeDay(period.end);
  });
  /** 有效期間的開始日；沒有期間或日期有問題的排在後面。 */
  const startOf = (each: T): string => { const period = scopePeriod(each.file); return period.kind === 'ok' ? period.start : '9'; };
  const sorted = [...alive].sort((a, b) => compareText(startOf(a), startOf(b)) || compareText(a.path, b.path));
  const candidates = sorted.filter(each => hasUnit(each.file));
  const chosen = candidates[0] ?? sorted[0] ?? null;
  return { chosen, usable: candidates.length > 0, others: candidates.slice(1).map(each => each.path) };
}
