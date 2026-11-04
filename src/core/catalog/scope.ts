import { isMap, isNode, isScalar, parseDocument } from 'yaml';
import { chapterAlias, codeKey, readTerm, termKey, termRank, tidy } from '../deck/index.ts';

// 考試範圍檔（tasks/exam-scope.md §2、syntax.md §4、D-176）：只看字面，不看卡組。讀懂的、對不到卡組的、看不懂的分開，都留著讓畫面寫出來。

export const EXAM_FOLDER = 'Essence Cards/考試範圍';
export const isExamPath = (path: string): boolean => path.startsWith(EXAM_FOLDER + '/') && path.endsWith('.md');

/** 一行範圍。line 從 0 算，raw 是原字；unit 的三欄是讀到的標準寫法。 */
export type ScopeLine =
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
  /** `提前結束` 的日期；讀不懂是 null。 */
  endedOn: string | null;
  /** 屬性區讀不出來：日期算有問題，外掛不寫這種檔（§2-2）。 */
  broken: boolean;
  lines: ScopeLine[];
}
/** 單元的身分：年級學期、科目、編號，都是原字，比對時才去雜訊。 */
export interface ScopeUnit { term: string; subject: string; code: string }

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
/** 日編號換回 `YYYY-MM-DD`。 */
export const scopeDate = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);

export type ScopePeriod = { kind: 'none' | 'bad' } | { kind: 'ok'; start: string; end: string };
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

/** 屬性區的值。讀不出來（YAML 有錯、alias 接不上或繞圈、最上層不是對照表）是 null；沒有字是空的對照表。 */
function headValues(raw: string): Record<string, unknown> | null {
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length) return null;
    const data = doc.toJS() as unknown;
    if (data === null) return {};
    // 繞圈的值到後面才會丟錯（比對、寫紀錄）：在這裡就算讀不出來。
    JSON.stringify(data);
    return isMap(doc.contents) && typeof data === 'object' ? data as Record<string, unknown> : null;
  } catch { return null; }
}
/** 屬性區壞了還是要認得是哪一次考試（§2-2）：這一行還在就照用，有 `提前結束` 的壞檔才擋得住同一個識別碼的舊副本。 */
function looseId(raw: string): string | null {
  const value = (/^[ \t]*識別碼[ \t]*:[ \t]*(.*)$/m.exec(raw)?.[1] ?? '').replace(/(?:^|\s+)#.*$/, '').trim();
  return (/^(["'])(.*)\1$/.exec(value)?.[2] ?? value).trim() || null;
}

const piecesOf = (text: string): string[] => text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
/** 屬性區的字與結束的 `---` 在第幾段（沒有結束是 -1）；沒有屬性區是 null。 */
function headOf(pieces: readonly string[]): { raw: string; close: number } | null {
  if (pieces[0].trim() !== '---') return null;
  const close = pieces.findIndex((piece, index) => index > 0 && /^---\s*$/.test(piece));
  return { raw: pieces.slice(1, close < 0 ? pieces.length : close).join('\n'), close };
}

/** 讀屬性區。沒有結束的 `---` 算壞，全部字都是屬性區（syntax §2-1 的「需要版本」同一種看法）。 */
export function parseScope(text: string): ScopeFile {
  const pieces = piecesOf(text);
  const file: ScopeFile = { id: null, start: { kind: 'none' }, end: { kind: 'none' }, ended: false, endedOn: null, broken: false, lines: [] };
  let body = 0;
  const head = headOf(pieces);
  if (head) {
    const { raw, close } = head;
    if (close < 0) return { ...file, broken: true, ended: raw.includes('提前結束'), id: looseId(raw) };
    body = close + 1;
    const values = headValues(raw);
    if (!values) {
      file.broken = true;
      file.ended = raw.includes('提前結束');
      file.id = looseId(raw);
    } else {
      const id = values['識別碼'];
      if ((typeof id === 'string' || typeof id === 'number') && String(id).trim()) file.id = String(id).trim();
      file.start = readDate(values['考試開始']);
      file.end = readDate(values['考試結束']);
      file.ended = Object.hasOwn(values, '提前結束');
      const endedOn = readDate(values['提前結束']);
      if (endedOn.kind === 'ok') file.endedOn = endedOn.date;
    }
  }
  for (let at = body; at < pieces.length; at++) {
    const line = readLine(pieces[at], at);
    if (line) file.lines.push(line);
  }
  return file;
}

// ── 比對 ──

export const termOf = (term: string): string => tidy(termKey(term)).trim().toLowerCase();
export const subjectOf = (subject: string): string => tidy(subject).trim().toLowerCase();
/** 層級照編號（D-033）：相同，或在它底下而且後面每一段都不是空的（`2-`、`2--1` 不在 `2` 底下）。 */
export function covers(code: string, other: string): boolean {
  if (code === other) return true;
  return other.startsWith(code + '-') && other.slice(code.length + 1).split('-').every(Boolean);
}
/** 這份範圍寫到哪些單元，和 unitInScope 同一種比法：字形與順序不同算一樣。 */
export function scopeUnitKeys(file: Pick<ScopeFile, 'lines'>): string[] {
  const keys = file.lines.flatMap(line => line.kind === 'unit' ? [JSON.stringify([termOf(line.term), subjectOf(line.subject), codeKey(line.code)])] : []);
  return [...new Set(keys)].sort();
}
export function unitInScope(file: Pick<ScopeFile, 'lines'>, unit: ScopeUnit): boolean {
  const term = termOf(unit.term), subject = subjectOf(unit.subject), code = codeKey(unit.code);
  return file.lines.some(line => line.kind === 'unit' && termOf(line.term) === term && subjectOf(line.subject) === subject && covers(codeKey(line.code), code));
}

// ── 選哪一份（§2-3）──

const hasUnit = (file: ScopeFile): boolean => file.lines.some(line => line.kind === 'unit');
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const groupOf = (each: { path: string; file: ScopeFile }): string => each.file.id === null ? 'path:' + each.path : 'id:' + each.file.id;

/**
 * 先按識別碼分組（同一個識別碼任一份結束，整組都結束，舊副本不會復活）；沒有識別碼的各自算一次考試。還生效而且有讀得懂的行才是候選；
 * 沒有候選但有還生效的檔時回傳那一份（usable 是 false），畫面寫行數，排程當成沒有範圍。others 是其他也生效的候選。
 */
export function chooseScope<T extends { path: string; file: ScopeFile }>(entries: readonly T[], day: number): { chosen: T | null; usable: boolean; others: string[] } {
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

/**
 * 上一份範圍的結束日（§6 的預先勾選）：整組結束的用有 `提前結束` 那一份的日期（讀不懂就用它的結束日），舊副本不算；其他的是已經過了的結束日。
 * 沒有讀得懂的行的不算一次考試。沒有上一份是 null。
 */
export function lastEnded(entries: readonly { path: string; file: ScopeFile }[], day: number): string | null {
  const over = new Set(entries.filter(each => each.file.ended).map(groupOf));
  const dates: string[] = [];
  for (const each of entries) {
    if (!hasUnit(each.file)) continue;
    const period = scopePeriod(each.file);
    const end = period.kind === 'ok' ? period.end : null;
    const date = over.has(groupOf(each)) ? (each.file.ended ? each.file.endedOn ?? end : null) : end !== null && day > scopeDay(end) ? end : null;
    if (date !== null) dates.push(date);
  }
  return dates.sort().at(-1) ?? null;
}

// ── 寫回（§2-4）──

/** 畫面交出的變動，在 Files.modify 的回呼裡套到最新的內容上。日期：沒給是畫面沒改，null 是清空。 */
export interface ScopeChange {
  add?: readonly ScopeUnit[];
  remove?: readonly ScopeUnit[];
  start?: string | null;
  end?: string | null;
  /** 提前結束的日期。 */
  ended?: string;
  /** 還沒有識別碼時補這個。 */
  id?: string;
}
type ScopeEdit = { kind: 'ok'; text: string } | { kind: 'blocked'; reason: 'changed' | 'broken' | 'dates' } | { kind: 'blocked'; reason: 'special'; lost: string[] };
interface RawLine { raw: string; eol: string }

function linesWithEnds(text: string): RawLine[] {
  const lines: RawLine[] = [];
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (match[0] === '') break;
    lines.push({ raw: match[1], eol: match[2] });
  }
  return lines;
}
const unitLine = (unit: ScopeUnit): string => `- ${unit.term} ${unit.subject} ${unit.code}`;
const sameBook = (a: ScopeUnit, b: ScopeUnit): boolean => termOf(a.term) === termOf(b.term) && subjectOf(a.subject) === subjectOf(b.subject);
const unitAt = (line: RawLine): ScopeUnit | null => { const read = readLine(line.raw, 0); return read?.kind === 'unit' ? read : null; };

/** 屬性區的字：每個值照 YAML 的位置換，註解、別的屬性與引號不動。raw 以 \n 接起來，沒有結尾的換行。 */
function editHead(raw: string, change: ScopeChange, before: ScopeFile): string {
  // 先讓每一行都以換行結尾，插入與刪除就都是一整行。
  const source = raw ? raw + '\n' : '';
  const doc = parseDocument(source);
  const pairs = isMap(doc.contents) ? doc.contents.items : [];
  const edits: { from: number; to: number; text: string }[] = [];
  const pairOf = (key: string) => pairs.find(pair => isScalar(pair.key) && pair.key.value === key);
  const rangeOf = (node: unknown): [number, number] | null => {
    const range = isNode(node) ? node.range : undefined;
    return range ? [range[0], range[1]] : null;
  };
  const lineStart = (at: number): number => at === 0 ? 0 : source.lastIndexOf('\n', at - 1) + 1;
  function setValue(key: string, text: string): boolean {
    const pair = pairOf(key);
    const keyRange = rangeOf(pair?.key);
    if (!pair || !keyRange) return false;
    const value = rangeOf(pair.value);
    if (value && value[1] > value[0]) {
      // 引號留著（§2-4）：只換裡面的字。
      const style = isScalar(pair.value) ? pair.value.type : null;
      const quote = style === 'QUOTE_DOUBLE' ? '"' : style === 'QUOTE_SINGLE' ? "'" : '';
      const written = quote + text + quote;
      if (source.slice(value[0], value[1]) !== written) edits.push({ from: value[0], to: value[1], text: written });
    } else {
      const colon = source.indexOf(':', keyRange[1]) + 1;
      edits.push({ from: colon, to: colon, text: ' ' + text });
    }
    return true;
  }
  function removeKey(key: string): void {
    const pair = pairOf(key);
    const keyRange = rangeOf(pair?.key);
    if (!pair || !keyRange) return;
    const last = rangeOf(pair.value)?.[1] ?? keyRange[1];
    edits.push({ from: lineStart(keyRange[0]), to: source.indexOf('\n', last) + 1, text: '' });
  }
  /** 新的一行：at 是它要放的位置（一行的開頭）；沒給就放最後。 */
  const insert = (at: number | null, text: string): void => { const where = at ?? source.length; edits.push({ from: where, to: where, text: text + '\n' }); };
  function date(key: string, read: ScopeDate, wanted: string | null | undefined, after: number | null): void {
    if (wanted === null) { removeKey(key); return; }
    const text = wanted ?? (read.kind === 'ok' ? read.date : null);
    if (text !== null && !setValue(key, text)) insert(after, `${key}: ${text}`);
  }
  if (before.id === null && change.id !== undefined && !setValue('識別碼', change.id)) insert(0, '識別碼: ' + change.id);
  // 提前結束只多一行，原本的日期連寫法都不動（§2-2）；標準化只在按「確定」時（§2-4）。
  if (change.ended !== undefined) insert(null, '提前結束: ' + change.ended);
  else {
    const endKey = rangeOf(pairOf('考試結束')?.key);
    date('考試開始', before.start, change.start, endKey ? lineStart(endKey[0]) : null);
    date('考試結束', before.end, change.end, null);
  }
  // 同一個位置的插入照加入的順序接起來；removeKey 與 setValue 的位置不會重疊。
  let result = source;
  const order = edits.map((each, index) => ({ each, index })).sort((a, b) => b.each.from - a.each.from || b.index - a.index);
  for (const { each } of order) result = result.slice(0, each.from) + each.text + result.slice(each.to);
  return result.endsWith('\n') ? result.slice(0, -1) : result;
}

/** 範圍行：先取消再新勾。units 是目前有卡組的單元，整章裡取消一個時用。 */
function editBody(body: RawLine[], change: ScopeChange, units: readonly ScopeUnit[], eol: string): RawLine[] {
  let lines = [...body];
  const within = (line: RawLine, unit: ScopeUnit): { read: ScopeUnit } | null => {
    const read = unitAt(line);
    return read && sameBook(read, unit) ? { read } : null;
  };
  const made = (unit: ScopeUnit): RawLine => ({ raw: unitLine(unit), eol });
  for (const unit of change.remove ?? []) {
    const code = codeKey(unit.code);
    lines = lines.filter(line => { const hit = within(line, unit); return !hit || !covers(code, codeKey(hit.read.code)); });
    const upper = lines.filter(line => { const hit = within(line, unit); return hit !== null && covers(codeKey(hit.read.code), code); });
    if (!upper.length) continue;
    const staying = lines.filter(line => !upper.includes(line));
    const under = upper.map(line => codeKey((unitAt(line) as ScopeUnit).code));
    const rest = units.filter(each => {
      const key = codeKey(each.code);
      // 同一次取消的都不展開：寫不回去的展開了就拿不掉（讀回來是看不懂的行）。
      return sameBook(each, unit) && under.some(top => covers(top, key)) && !isRemoved(each, change)
        && !staying.some(line => { const hit = within(line, each); return hit !== null && covers(codeKey(hit.read.code), key); });
    });
    const top = rest.filter(each => !rest.some(other => other !== each && codeKey(other.code) !== codeKey(each.code) && covers(codeKey(other.code), codeKey(each.code))));
    const at = lines.indexOf(upper[0]);
    lines = [...lines.slice(0, at), ...top.map(made), ...lines.slice(at + 1)].filter(line => !upper.includes(line));
  }
  for (const unit of change.add ?? []) {
    const code = codeKey(unit.code);
    if (lines.some(line => { const hit = within(line, unit); return hit !== null && covers(codeKey(hit.read.code), code); })) continue;
    const inside = lines.filter(line => { const hit = within(line, unit); return hit !== null && covers(code, codeKey(hit.read.code)); });
    if (inside.length) {
      const at = lines.indexOf(inside[0]);
      lines = [...lines.slice(0, at), { raw: unitLine(unit), eol: inside[0].eol }, ...lines.slice(at + 1)].filter(line => !inside.includes(line));
      continue;
    }
    const subject = subjectOf(unit.subject);
    const lastOf = (test: (line: RawLine) => boolean): number => lines.findLastIndex(test);
    let after = lastOf(line => within(line, unit) !== null);
    if (after < 0) after = lastOf(line => { const read = unitAt(line); return read !== null && subjectOf(read.subject) === subject; });
    if (after < 0) after = lastOf(line => line.raw.trim() !== '');
    lines = [...lines.slice(0, after + 1), made(unit), ...lines.slice(after + 1)];
  }
  return lines;
}

/** 這個單元就是這次取消的，或在它底下，或包含它（整章裡取消一個，整章就不算了）。 */
function isRemoved(unit: ScopeUnit, change: ScopeChange): boolean {
  const code = codeKey(unit.code);
  return (change.remove ?? []).some(each => sameBook(each, unit) && (covers(codeKey(each.code), code) || covers(code, codeKey(each.code))));
}

const OWN_KEYS = new Set(['識別碼', '考試開始', '考試結束', '提前結束']);
/** 外掛不碰的屬性（比對用）。 */
function otherProps(text: string): string {
  const head = headOf(piecesOf(text));
  return JSON.stringify(Object.entries((head && headValues(head.raw)) ?? {}).filter(([key]) => !OWN_KEYS.has(key)));
}
/** 讀回來是不是要的結果（§2-4）：只有這次要改的變了。清單以外的寫法（`{考試開始: 2026-10-28}`、`|`）一行一行地改，可能改壞，也可能帶走別的屬性。 */
function headAsWanted(text: string, result: string, after: ScopeFile, change: ScopeChange, before: ScopeFile): boolean {
  const wanted = (read: ScopeDate, value: string | null | undefined): ScopeDate => value === undefined ? read : value === null ? { kind: 'none' } : { kind: 'ok', date: value };
  return !after.broken && after.id === (before.id ?? change.id ?? null) && after.ended === (change.ended !== undefined)
    && JSON.stringify(after.start) === JSON.stringify(wanted(before.start, change.start))
    && JSON.stringify(after.end) === JSON.stringify(wanted(before.end, change.end))
    && otherProps(result) === otherProps(text);
}

/** 把變動套到這份文字（§2-4）。空字串是檔不見或清空，已經結束的不改回去，屬性區壞了不寫。 */
export function editScope(text: string, change: ScopeChange, units: readonly ScopeUnit[]): ScopeEdit {
  if (text === '') return { kind: 'blocked', reason: 'changed' };
  const before = parseScope(text);
  if (before.broken) return { kind: 'blocked', reason: 'broken' };
  if (before.ended) return { kind: 'blocked', reason: 'changed' };
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const lines = linesWithEnds(text.slice(bom.length));
  const eol = lines.find(line => line.eol)?.eol ?? '\n';
  const close = lines[0]?.raw.trim() === '---' ? lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line.raw)) : -1;
  const headLines = close > 0 ? lines.slice(1, close) : [];
  const raw = headLines.map(line => line.raw).join('\n');
  const edited = editHead(raw, change, before);
  let head: RawLine[];
  if (close > 0) {
    head = edited === raw ? lines.slice(0, close + 1) : [lines[0], ...(edited ? edited.split('\n').map(line => ({ raw: line, eol })) : []), lines[close]];
  } else {
    head = edited ? [{ raw: '---', eol }, ...edited.split('\n').map(line => ({ raw: line, eol })), { raw: '---', eol }] : [];
  }
  const body = lines.slice(close > 0 ? close + 1 : 0);
  const next = editBody(body, change, units, eol);
  // 中間的行都要有換行；結尾有沒有換行照原本的。
  const all = [...head, ...next];
  const endedWithEol = lines.length === 0 || lines[lines.length - 1].eol !== '';
  const output = all.map((line, index) => ({ raw: line.raw, eol: index === all.length - 1 ? (endedWithEol ? line.eol || eol : '') : line.eol || eol }));
  const result = bom + output.map(line => line.raw + line.eol).join('');
  const after = parseScope(result);
  if (!headAsWanted(text, result, after, change, before)) return { kind: 'blocked', reason: 'broken' };
  // 畫面只看得到打開時的另一邊：套到最新的內容上才變成開始晚於結束（別台改了另一邊），不寫（§2-4）。畫面沒改日期時，家長原本的值照舊留著。
  const inverted = after.start.kind === 'ok' && after.end.kind === 'ok' && after.start.date > after.end.date;
  if (inverted && (change.start != null || change.end != null)) return { kind: 'blocked', reason: 'dates' };
  // 沒有取消的單元都要還在（§2-4）：整章展開時，寫不回去的單元（`2-9,3`）一行寫不出來，存了就掉出範圍。
  const lost = units.filter(unit => unitInScope(before, unit) && !unitInScope(after, unit) && !isRemoved(unit, change));
  if (lost.length) return { kind: 'blocked', reason: 'special', lost: lost.map(unit => unit.code) };
  return { kind: 'ok', text: result };
}

/** 新檔的內容。 */
export function newScopeText({ id, start, end, add }: { id: string; start?: string | null; end?: string | null; add: readonly ScopeUnit[] }): string {
  const head = ['---', '識別碼: ' + id, ...(start ? ['考試開始: ' + start] : []), ...(end ? ['考試結束: ' + end] : []), '---'];
  return [...head, ...add.map(unitLine), ''].join('\n');
}
/** 新檔的檔名（不含 .md 與資料夾）：考試開始日加勾選單元裡最新的認得的學期；建立後不改名（D-142 第 1 點）。 */
export function scopeFileName(start: string | null, units: readonly ScopeUnit[]): string {
  const terms = units.map(unit => termKey(unit.term)).filter(term => termRank(term) !== null);
  const latest = terms.sort((a, b) => (termRank(b) ?? 0) - (termRank(a) ?? 0))[0];
  return (start ?? '日期未定') + (latest ? ' ' + latest : '');
}
/** 這個單元寫成一行再讀回來是不是同一個（§2-4）：不是的不能用勾選加入。這個格式不多一種引號。 */
export function scopeWritable(unit: ScopeUnit): boolean {
  const read = readLine(unitLine(unit), 0);
  return read?.kind === 'unit' && sameBook(read, unit) && codeKey(read.code) === codeKey(unit.code);
}
