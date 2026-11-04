import { readDate, scopeDay, scopeRows } from '../core/catalog/index.ts';
import type { ScopeRow, ScopeRowTerm } from '../core/catalog/index.ts';
import { dayOf } from '../core/study/index.ts';
import type { History } from '../core/study/index.ts';
import type { Catalog, ExamChange, ExamResult, ExamView, ScopeFile, State } from '../state/index.ts';

// 設定畫面的資料與規則（tasks/exam-scope.md §6）：畫面只管顯示，勾選連動、要交出的變動與日期的字都在這裡。

export type { ScopeRow } from '../core/catalog/index.ts';

/** 沒有上一份範圍時，「最近學的」往回看幾天（使用者 2026-11-04）。 */
const RECENT_DAYS = 42;

/** 打開畫面那一刻的樣子。之後範圍檔被別處改了也不跟著變：交出去的是「勾了什麼、取消了什麼」，套在最新的內容上（§2-4）。 */
export interface ExamForm {
  terms: ScopeRowTerm[];
  /** 預設展開的學期。 */
  latest: string | null;
  /** 一開始勾著的列。 */
  checked: ReadonlySet<string>;
  /** true 是最近學的先勾好（沒有生效的範圍）。 */
  preset: boolean;
  /** 看不懂的行與分類行，原字（§6）。 */
  unreadable: string[];
  category: string[];
  start: string;
  end: string;
  /** 有生效的範圍：可以結束這次考試。 */
  usable: boolean;
  others: readonly string[];
  /** 範圍還不知道（第一次的讀取沒有結果，或選定的檔都讀不到）：寫原因，存不了。 */
  unknown: boolean;
  /** 勾的是哪一份；交出去的只有變動，存的時候選定的已經換了，就不能套上去。 */
  path: string | null;
}

/** 這個單元裡自己的目標最早的作答是哪一天；都還沒作答是 null。 */
function firstAnswers(history: History): Map<string, number> {
  const first = new Map<string, number>();
  for (const entry of history.reviews) {
    const day = dayOf(entry.at, entry.offset), known = first.get(entry.lt);
    if (known === undefined || day < known) first.set(entry.lt, day);
  }
  return first;
}

/** 最近學的（§6）：最新學期裡，上一份範圍結束之後（沒有上一份就最近 6 週內）才第一次作答，或還沒作答的啟用單元。 */
function presetKeys(terms: readonly ScopeRowTerm[], catalog: Catalog, history: History, exam: ExamView): Set<string> {
  const keys = new Set<string>();
  const term = terms.find(each => each.term === catalog.latest);
  if (!term) return keys;
  const cutoff = exam.previousEnd !== null ? scopeDay(exam.previousEnd) + 1 : exam.day - RECENT_DAYS;
  const first = firstAnswers(history);
  for (const row of term.subjects.flatMap(subject => subject.rows)) {
    if (row.kind !== 'unit' || row.view?.status !== 'active' || !row.writable) continue;
    const days = row.view.targets.filter(target => target.from === null).flatMap(target => first.get(target.id) ?? []);
    if (!days.length || Math.min(...days) >= cutoff) keys.add(row.key);
  }
  return keys;
}

const dateText = (read: ScopeFile['start']): string => read.kind === 'ok' ? read.date : read.kind === 'bad' ? read.raw : '';

/** 還沒 ready 是 null。 */
export function examForm(state: State | null): ExamForm | null {
  const catalog = state?.examCatalog() ?? null;
  if (!state || !catalog) return null;
  const exam = state.exam();
  const file = exam.file;
  const terms = scopeRows(file, catalog);
  const rows = terms.flatMap(term => term.subjects.flatMap(subject => subject.rows));
  const lines = file?.lines ?? [];
  return {
    terms, latest: catalog.latest,
    checked: exam.usable ? new Set(rows.filter(row => row.inScope).map(row => row.key)) : presetKeys(terms, catalog, state.history(), exam),
    preset: !exam.usable,
    unreadable: lines.flatMap(line => line.kind === 'unreadable' ? [line.raw] : []),
    category: lines.flatMap(line => line.kind === 'category' ? [line.raw] : []),
    start: file ? dateText(file.start) : '', end: file ? dateText(file.end) : '',
    usable: exam.usable, others: exam.others,
    unknown: !exam.settled || (exam.missing > 0 && !file),
    path: exam.path,
  };
}

const allRows = (form: ExamForm): ScopeRow[] => form.terms.flatMap(term => term.subjects.flatMap(subject => subject.rows));

/** 勾：連底下一起；取消：連底下與上面一起（整章裡取消一個，整章就不算了，§2-4）。 */
export function toggleRow(checked: ReadonlySet<string>, row: ScopeRow, on: boolean): Set<string> {
  const next = new Set(checked);
  if (on) for (const key of [row.key, ...row.under]) next.add(key);
  else for (const key of [row.key, ...row.under, ...row.above]) next.delete(key);
  return next;
}

/**
 * 畫面交出的變動（§2-4）：只有和一開始不同的，來回切換自然抵銷。
 * 已經被勾著的整章包含的不寫；把底下全部一個一個勾不會變成整章；取消整章由取消底下的單元達成（整章列本身沒有對應的行要拿掉）。
 */
export function formChange(form: ExamForm, checked: ReadonlySet<string>, start: string, end: string): ExamChange {
  const rows = allRows(form);
  const add = rows.filter(row => checked.has(row.key) && !row.inScope && row.writable && !row.above.some(key => checked.has(key))).map(row => row.unit);
  const remove = rows.filter(row => !checked.has(row.key) && row.inScope && row.kind !== 'chapter').map(row => row.unit);
  const date = (text: string, from: string): string | null | undefined => {
    const now = normalDate(text);
    return now === normalDate(from) ? undefined : now === '' ? null : now;
  };
  const startAt = date(start, form.start), endAt = date(end, form.end);
  return {
    ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}),
    ...(startAt === undefined ? {} : { start: startAt }), ...(endAt === undefined ? {} : { end: endAt }),
  };
}

/** 認得的日期換成標準格式；看不懂的留原字，改了才看得到哪裡錯。 */
export function normalDate(text: string): string {
  const read = readDate(text);
  return read.kind === 'ok' ? read.date : read.kind === 'none' ? '' : text;
}

const DATE_WORDS = { nonexistent: '這個日期不存在', format: '看不懂這個日期，請寫西元年，例如 2026-10-28' };
export const ORDER_WORD = '開始日不能晚於結束日';
export interface DateCheck {
  /** 寫在欄位下的紅字；有紅字就不能按確定。 */
  start: string | null;
  end: string | null;
  /** 開始晚於結束：不算哪一欄的錯。 */
  order: boolean;
  /** 日期都對，而且已經過了（只填開始時看開始日）：不擋，寫灰字。 */
  past: boolean;
}
/** day 是今天的日編號（清晨 4 點換日）。 */
export function checkDates(start: string, end: string, day: number): DateCheck {
  const from = readDate(start), to = readDate(end);
  const word = (read: typeof from): string | null => read.kind === 'bad' ? DATE_WORDS[read.why] : null;
  const order = from.kind === 'ok' && to.kind === 'ok' && from.date > to.date;
  const last = to.kind === 'ok' ? to.date : from.kind === 'ok' ? from.date : null;
  return { start: word(from), end: word(to), order, past: !order && from.kind !== 'bad' && to.kind !== 'bad' && last !== null && day > scopeDay(last) };
}

/** 擋下來的原因（§6）：留在畫面上，已勾的不丟。 */
export function examFailure(result: Exclude<ExamResult, { kind: 'done' }>): string {
  if (result.kind === 'failed') return '寫不進去：' + (result.error instanceof Error ? result.error.message : String(result.error));
  if (result.reason === 'special') return `「${result.lost.join('、')}」的編號寫法特殊，範圍檔寫不出來，不能只取消這一章的一部分：請留著整章，或連它一起取消`;
  return {
    loading: '還在讀取，請稍候再試',
    unread: '考試範圍暫時讀不到，等一下再試',
    changed: '範圍檔被改名、刪除或已經結束，請重新打開這個畫面',
    broken: '範圍檔的屬性區寫壞了，或不是一行一個屬性，請先修好再設定',
    dates: '別處改了日期，開始日會晚於結束日，這次沒有存；請重新打開這個畫面',
    closed: '外掛正在關閉，這次沒有存',
  }[result.reason];
}
