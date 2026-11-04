import { codeKey, termKey, termRank, tidy } from '../deck/index.ts';
import type { Catalog, CatalogIndex, UnitView } from './index.ts';
import { compareCode, compareTerm } from './order.ts';
import { covers, scopeDay, scopeWritable, subjectOf, termOf, unitInScope } from './scope.ts';
import type { ScopeFile, ScopeLine, ScopePeriod, ScopeUnit } from './scope.ts';

// 範圍和卡組對起來（tasks/exam-scope.md §3、§7、§8）：範圍檔只看字面（scope.ts），這裡才看索引與目錄。都是純函式，畫面不自己算。

type Lines = Pick<ScopeFile, 'lines'>;
type UnitLine = Extract<ScopeLine, { kind: 'unit' }>;
const unitLines = (file: Lines): UnitLine[] => file.lines.filter((line): line is UnitLine => line.kind === 'unit');

/** 這份範圍裡的目標：自己的單元或出處的單元落在範圍內。對不到卡組的單元也算（§3），所以後來才建卡組只讓提示消失。 */
export function targetsInScope(file: Lines, index: CatalogIndex): Set<string> {
  const ids = new Set<string>();
  for (const member of index.members) if (member.units.some(unit => unitInScope(file, unit))) ids.add(member.id);
  return ids;
}

interface Named { term: string | null; subject: string | null; code: string | null }
const allUnits = (catalog: Catalog): UnitView[] => catalog.terms.flatMap(term => term.subjects.flatMap(subject => subject.units));
const sameBook = (unit: Named, term: string, subject: string): boolean => unit.term !== null && unit.subject !== null && termOf(unit.term) === termOf(term) && subjectOf(unit.subject) === subjectOf(subject);
/** 這一行有對到卡組：單元相同，或在它底下。 */
const hasDeck = (line: UnitLine, units: readonly UnitView[]): boolean =>
  units.some(unit => unit.code !== null && sameBook(unit, line.term, line.subject) && covers(codeKey(line.code), codeKey(unit.code)));

/** 入口與目錄那一列的行數（§2-6）：一句話算看不懂，分類行不算；單元、科目或學期對不到任何卡組的算對不到。 */
export function scopeNotes(file: Lines, catalog: Catalog): { unreadable: number; unmatched: number } {
  const units = allUnits(catalog);
  return { unreadable: file.lines.filter(line => line.kind === 'unreadable').length, unmatched: unitLines(file).filter(line => !hasDeck(line, units)).length };
}

/** 一科一組，照這一科在檔案裡第一次出現的順序。 */
function bySubject(file: Lines): { subject: string; lines: UnitLine[] }[] {
  const groups = new Map<string, { subject: string; lines: UnitLine[] }>();
  for (const line of unitLines(file)) {
    const key = subjectOf(line.subject), group = groups.get(key);
    if (group) group.lines.push(line);
    else groups.set(key, { subject: line.subject, lines: [line] });
  }
  return [...groups.values()];
}
/** 這一科寫到的學期，照順序，寫成標準的樣子。 */
const termsOf = (lines: readonly UnitLine[]): string[] => [...new Set(lines.map(line => termKey(line.term)))].sort(compareTerm);

/** 編號屬於哪一章：沒有下一層的（`L1`、`2`）彼此可以併。 */
const chapterOf = (code: string): string => codeKey(code).includes('-') ? codeKey(code).split('-')[0] : '';
/** 同一學期裡的段（§7）：目錄排序裡相鄰的都在範圍內、又在同一章才併；整章算一段。 */
function segmentsOf(lines: readonly UnitLine[], units: readonly UnitView[]): string[] {
  const codes = units.flatMap(unit => unit.code ?? []);
  const under = (code: string): boolean => codes.some(each => codeKey(each) !== code && covers(code, codeKey(each)));
  const written = [...new Set(lines.map(line => codeKey(line.code)))];
  // 底下有單元的行是整章；被別的行包含的不再算一段。
  const chapters = written.filter(code => under(code) && !written.some(other => other !== code && covers(other, code)));
  const rawOf = (code: string): string => lines.find(line => codeKey(line.code) === code)?.code ?? code;
  const extras = lines.filter(line => !codes.some(each => covers(codeKey(line.code), codeKey(each)))).map(line => line.code);
  const items = [...codes, ...extras].filter((code, at, list) => list.findIndex(each => codeKey(each) === codeKey(code)) === at).sort(compareCode);
  const inScope = (code: string): boolean => written.some(each => covers(each, codeKey(code)));
  const segments: string[] = [];
  let run: string[] = [];
  const close = (): void => {
    if (run.length) segments.push(run.length === 1 ? run[0] : `${run[0]}～${run.at(-1) ?? ''}`);
    run = [];
  };
  const done = new Set<string>();
  for (const code of items) {
    const chapter = chapters.find(each => covers(each, codeKey(code)));
    if (chapter !== undefined) {
      close();
      if (!done.has(chapter)) segments.push(rawOf(chapter) + ' 全部');
      done.add(chapter);
    } else if (inScope(code)) {
      if (run.length && chapterOf(run[run.length - 1]) !== chapterOf(code)) close();
      run.push(code);
    } else close();
  }
  close();
  return segments;
}

/** 這一科的單元數（§7）：目錄裡在範圍內的單元，加上範圍檔寫到但沒有卡組的行。 */
function countOf(lines: readonly UnitLine[], units: readonly UnitView[]): number {
  const inside = units.filter(unit => unit.code !== null && lines.some(line => sameBook(unit, line.term, line.subject) && covers(codeKey(line.code), codeKey(unit.code ?? ''))));
  const missing = new Set(lines.filter(line => !hasDeck(line, units)).map(line => termOf(line.term) + ' ' + codeKey(line.code)));
  return inside.length + missing.size;
}

/** 一科一行（§7）：規則固定，不看螢幕寬度。 */
export function scopeLabels(file: Lines, catalog: Catalog): { subject: string; label: string }[] {
  const everyUnit = allUnits(catalog);
  const wholeTerms = new Set(unitLines(file).map(line => termOf(line.term)));
  return bySubject(file).map(({ subject, lines }) => {
    const terms = termsOf(lines);
    const units = everyUnit.filter(unit => unit.subject !== null && subjectOf(unit.subject) === subjectOf(subject));
    const count = countOf(lines, units);
    if (terms.length === 1) {
      const segments = segmentsOf(lines, units.filter(unit => sameBook(unit, lines[0].term, subject)));
      if (segments.length <= 3) return { subject, label: (wholeTerms.size > 1 ? terms[0] + ' ' : '') + segments.join('、') };
      return { subject, label: `${terms[0]}，共 ${String(count)} 個單元` };
    }
    const ranks = terms.map(term => termRank(term));
    const connected = ranks.every((rank, at) => rank !== null && (at === 0 || rank === (ranks[at - 1] ?? NaN) + 1));
    return { subject, label: `${connected ? `${terms[0]}～${terms[terms.length - 1]}` : terms.join('、')}，共 ${String(count)} 個單元` };
  });
}

const AFTER_LIMIT = 3;
/**
 * 排在範圍後面的單元（§7、D-176 第 9 點）：每一科只看它在範圍裡最新的學期，編號排在最後一個已勾單元之後、已啟用、不在範圍內的單元。
 * 分不出之後才建立的和故意沒勾的，所以只寫事實。沒有是 null。
 */
export function scopeAfter(file: Lines, catalog: Catalog): string | null {
  const everyUnit = allUnits(catalog);
  const found: string[] = [];
  for (const { subject, lines } of bySubject(file)) {
    const latest = termsOf(lines).at(-1) ?? '';
    const own = lines.filter(line => termKey(line.term) === latest);
    const units = everyUnit.filter(unit => sameBook(unit, latest, subject));
    const inside = (unit: UnitView): boolean => own.some(line => covers(codeKey(line.code), codeKey(unit.code ?? '')));
    const marks = [...own.map(line => line.code), ...units.filter(inside).flatMap(unit => unit.code ?? [])].sort(compareCode);
    const last = marks.at(-1) ?? '';
    for (const unit of units) {
      if (unit.code !== null && unit.status === 'active' && !inside(unit) && compareCode(unit.code, last) > 0) found.push(`${subject} ${unit.code}`);
    }
  }
  if (!found.length) return null;
  const more = found.length - AFTER_LIMIT;
  return found.slice(0, AFTER_LIMIT).join('、') + ' 不在範圍內' + (more > 0 ? `，另有 ${String(more)} 個` : '');
}

/** 倒數（§7）：開始日還沒到是幾天；考試期間內（結束日的下一個清晨 4 點之前）是今天；沒有有效的期間是 null。 */
export function scopeCountdown(period: ScopePeriod, day: number): number | 'today' | null {
  if (period.kind !== 'ok') return null;
  const start = scopeDay(period.start);
  return day >= start ? 'today' : start - day;
}
const shortDate = (date: string): string => { const [, month, day] = date.split('-'); return `${String(Number(month))}/${String(Number(day))}`; };
/** 標題旁的期間：`10/28～10/29`，一天就是 `10/28`。 */
export function scopeDates(period: Extract<ScopePeriod, { kind: 'ok' }>): string {
  return period.start === period.end ? shortDate(period.start) : `${shortDate(period.start)}～${shortDate(period.end)}`;
}
/** 科目標題旁的括號只寫開始日。 */
export const scopeStartDate = (period: Extract<ScopePeriod, { kind: 'ok' }>): string => shortDate(period.start);
/** 這份範圍有沒有寫到這一科（倒數只有這些科目才有）；給了學期就要是那個學期的。 */
export const scopeHasSubject = (file: Lines, subject: string, term?: string): boolean =>
  unitLines(file).some(line => subjectOf(line.subject) === subjectOf(subject) && (term === undefined || termOf(line.term) === termOf(term)));

/** 來自別的單元的目標（§8）。 */
interface FromOther { id: string; name: string; path: string; line: number; own: string }
type UnsureReason = '可能多算' | '可能打錯' | '可能少算';
/** 還不確定的出處（§8）：同一個目標只算一次，原因都寫。 */
interface Unsure { id: string; name: string; path: string; line: number; source: string; reasons: UnsureReason[] }
export interface ScopeCheck { fromOther: FromOther[]; unsure: Unsure[] }

/** 用到的時候才檢查（§8）：隨著勾選即時算；字面判斷，不用目錄或材料反過來改歸屬。 */
export function scopeCheck(file: Lines, index: CatalogIndex): ScopeCheck {
  const fromOther: FromOther[] = [], unsure: Unsure[] = [];
  const lines = unitLines(file);
  for (const { id, name, path, line, own, sources, subject, units, missed } of index.members) {
    const named = units.filter(unit => unitInScope(file, unit));
    const sure = named.filter(unit => unit.basis !== 'carried');
    if (named.length && !named.some(unit => unit.basis === 'own')) fromOther.push({ id, name, path, line, own });
    const reasons: UnsureReason[] = [];
    if (named.length && !sure.length) reasons.push('可能多算');
    if (units.some(unit => unit.basis === 'written' && index.find(unit.term, unit.subject, unit.code) === null && lines.some(each => sameBook(unit, each.term, each.subject)))) reasons.push('可能打錯');
    if (missed && lines.some(each => subjectOf(each.subject) === subjectOf(subject))) reasons.push('可能少算');
    if (reasons.length) unsure.push({ id, name, path, line, source: sources.join('、'), reasons });
  }
  return { fromOther, unsure };
}

// ── 設定畫面的列（§6）──

/** 設定畫面的一列。key 不分別名與全半形；under、above 是勾選連動的對象；view 是目錄裡的單元（整章與沒有卡組的行是 null）。 */
export interface ScopeRow {
  key: string;
  kind: 'unit' | 'chapter' | 'extra';
  unit: ScopeUnit;
  label: string;
  status: 'draft' | 'paused' | null;
  /** 寫成一行再讀回來是同一個（§2-4）。 */
  writable: boolean;
  under: string[];
  above: string[];
  /** 現在的範圍檔已經算進去了。 */
  inScope: boolean;
  view: UnitView | null;
}
export interface ScopeRowTerm { term: string; subjects: { subject: string; rows: ScopeRow[] }[] }

const statusTag = (unit: UnitView | undefined): ScopeRow['status'] => !unit || unit.status === 'active' ? null : unit.status;

/** 一科的列：單元照目錄的順序，第一段相同、底下有單元的多一列整章（同編號的單元併進去），只分這一層；沒有卡組的行放最後。 */
function subjectRows(term: string, subject: string, units: readonly UnitView[], lines: readonly UnitLine[], file: Lines | null): ScopeRow[] {
  const coded = units.filter((unit): unit is UnitView & { code: string } => unit.code !== null);
  const row = (kind: ScopeRow['kind'], code: string, label: string, view: UnitView | null, tagged?: UnitView): ScopeRow => {
    const unit = { term, subject, code };
    return {
      key: JSON.stringify([termOf(term), subjectOf(subject), codeKey(code)]), kind, unit, label, status: statusTag(tagged ?? view ?? undefined),
      writable: scopeWritable(unit), under: [], above: [], inScope: file !== null && unitInScope(file, unit), view,
    };
  };
  const chapters = new Map<string, string>();
  for (const { code } of coded) {
    const first = tidy(code).trim().split('-')[0];
    if (codeKey(code).includes('-')) chapters.set(codeKey(first), first);
  }
  const rows = [...chapters].map(([key, first]) => row('chapter', first, first + ' 全部', null, coded.find(unit => codeKey(unit.code) === key)));
  for (const unit of coded) if (!chapters.has(codeKey(unit.code))) rows.push(row('unit', unit.code, unit.name, unit));
  rows.sort((a, b) => compareCode(a.unit.code, b.unit.code));
  const extras = lines.filter(line => !coded.some(unit => covers(codeKey(line.code), codeKey(unit.code))));
  for (const line of extras) {
    if (rows.some(each => each.key === row('extra', line.code, '', null).key)) continue;
    rows.push(row('extra', line.code, line.code, null));
  }
  const keyOf = (each: ScopeRow): string => codeKey(each.unit.code);
  for (const each of rows) {
    each.under = rows.filter(other => other !== each && covers(keyOf(each), keyOf(other))).map(other => other.key);
    each.above = rows.filter(other => other !== each && covers(keyOf(other), keyOf(each))).map(other => other.key);
  }
  return rows;
}

/** 設定畫面勾的樹（§6）：學期 → 科目 → 列；草稿、暫停也列（範圍是考什麼，不是卡的狀態），「其他」組不列；範圍檔寫到、目錄沒有的學期與科目也有位置。 */
export function scopeRows(file: Lines | null, catalog: Catalog): ScopeRowTerm[] {
  const lines = file ? unitLines(file) : [];
  const books: { term: string; subjects: { subject: string; units: readonly UnitView[] }[] }[] = catalog.terms.map(({ term, subjects }) => ({ term, subjects: subjects.map(({ subject, units }) => ({ subject, units })) }));
  for (const line of lines) {
    let book = books.find(each => termOf(each.term) === termOf(line.term));
    if (!book) books.push(book = { term: termKey(line.term), subjects: [] });
    if (!book.subjects.some(each => subjectOf(each.subject) === subjectOf(line.subject))) book.subjects.push({ subject: line.subject, units: [] });
  }
  books.sort((a, b) => compareTerm(a.term, b.term));
  return books.map(({ term, subjects }) => ({
    term,
    subjects: subjects.map(({ subject, units }) => ({ subject, rows: subjectRows(term, subject, units, lines.filter(line => sameBook({ term, subject, code: null }, line.term, line.subject)), file) })),
  }));
}
