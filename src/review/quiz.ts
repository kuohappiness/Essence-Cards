import { readDate, scopeDate, scopeDay } from '../core/catalog/index.ts';
import type { QuizProblem, QuizRef, QuizResult, QuizRow, State } from '../state/index.ts';
import { checkDates, normalDate } from './exam-form.ts';

// 入口那一列與目錄按鈕的字（tasks/quiz-mark.md §1、§3、§4）：純程式，規則在 core/catalog/quiz.ts，這裡只決定畫面寫什麼。

const WORDS: Record<QuizProblem, string> = {
  date: '小考日期有問題',
  body: '小考檔寫法有問題',
  unmatched: '對不到卡組',
  missing: '找不到這一篇',
  several: '認不出是哪一篇',
  copies: '這個小考有兩份不一樣的檔',
};
/** 連結壞掉時的修法（§1）：點開之前就要看得到，不要點斷掉的連結。 */
const LINK_REPAIR = '打開小考檔，在編輯模式把舊連結整段刪掉，輸入 [[ 從建議清單選那一篇。那一篇已經刪掉時按取消或另選一篇；不要點斷掉的連結，會建一篇空白筆記。';
export const COPIES_NOTE = '兩份看不出哪一份是改過的，請留下對的那一份、刪掉另一份。';

export interface QuizRowView extends QuizRow {
  /** 今天小考、明天小考、`11/7 小考`（和段考的「今天考試」同樣是哪天＋考什麼）；沒有讀得懂的日期是 null。 */
  when: string | null;
  /** 待修正的字；正常的是 null。 */
  word: string | null;
  repair: string | null;
  /** 目錄沒有按鈕可以取消（單元對不到、連結壞掉、那一篇或整個單元都暫停了），要在這裡給一個取消的地方。 */
  cancellable: boolean;
}

const monthDay = (date: string): string => { const [, month, day] = date.split('-'); return `${String(Number(month))}/${String(Number(day))}`; };
function when(date: string, day: number): string {
  const at = scopeDay(date);
  return at === day ? '今天小考' : at === day + 1 ? '明天小考' : `${monthDay(date)} 小考`;
}

/** 入口最上面的每一列（§4）；還在讀是空的。 */
export function quizViews(state: State | null): QuizRowView[] {
  if (!state) return [];
  const { day } = state.exam();
  return state.quizzes().map(row => ({
    ...row,
    when: row.date === null ? null : when(row.date, day),
    word: row.problem === null ? null : WORDS[row.problem],
    repair: row.problem === 'missing' || row.problem === 'several' ? LINK_REPAIR : null,
    cancellable: row.problem === 'missing' || row.problem === 'several' || row.problem === 'unmatched' || (row.problem === null && row.count === 0),
  }));
}

/** 目錄的小考按鈕（§3）。none 還沒設；set 設好了（others 是同一個目標另外壞掉的檔）；problem 只有待修正的：寫出來，點了去修。 */
export type QuizButtonView =
  | { kind: 'none'; label: string; row: null; others: readonly QuizRow[] }
  | { kind: 'set'; label: string; row: QuizRow; others: readonly QuizRow[] }
  | { kind: 'problem'; label: string; row: QuizRow; others: readonly QuizRow[] };

export function quizButton(state: State | null, at: QuizRef): QuizButtonView {
  const blank: QuizButtonView = { kind: 'none', label: '小考', row: null, others: [] };
  if (!state) return blank;
  const wanted = JSON.stringify(at);
  const rows = state.quizzes().filter(row => row.refs.some(ref => JSON.stringify(ref) === wanted));
  const good = rows.find(row => row.problem === null);
  const others = rows.filter(row => row !== good);
  if (good?.date) return { kind: 'set', label: scopeDay(good.date) === state.exam().day ? '今天小考' : `小考 ${monthDay(good.date)}`, row: good, others };
  return others.length ? { kind: 'problem', label: others[0].problem ? WORDS[others[0].problem] : '小考', row: others[0], others: others.slice(1) } : blank;
}

/** 目錄選單裡同一個目標的另一份（L2 R5）：照它自己的問題寫，不假設都是日期有問題。同一個目標兩份正常的只留早的（§1），所以另一份都是待修正的。 */
export function quizOtherLabel(row: QuizRow): string {
  return row.problem === null ? '另一份小考' : '另一份小考：' + WORDS[row.problem];
}

/** 按下去的選項（§3）：今天、明天、後天。 */
export function quizChoices(day: number): { label: string; date: string }[] {
  return ['今天', '明天', '後天'].map((label, at) => ({ label, date: scopeDate(day + at) }));
}

/** 其他日期：讀得懂而且還沒過才能設（過了的日期設下去就是立刻消失）。date 是要存的標準寫法；word 是紅字。 */
export function checkQuizDate(text: string, day: number): { date: string | null; word: string | null } {
  const check = checkDates(text, '', day);
  const word = check.start ?? (check.past ? '這個日期已經過了' : null);
  return { date: word === null && readDate(text).kind === 'ok' ? normalDate(text) : null, word };
}

/** 擋下來的原因：留在按鈕底下。 */
export function quizFailure(result: Exclude<QuizResult, { kind: 'done' }>): string {
  if (result.kind === 'failed') return '寫不進去：' + (result.error instanceof Error ? result.error.message : String(result.error));
  return {
    loading: '還在讀取，請稍候再試',
    closed: '外掛正在關閉，這次沒有存',
    unread: '小考檔暫時讀不到，等一下再試',
    changed: '這個小考剛被別處改過，請再看一次',
    broken: '小考檔的屬性區寫壞了，或不是一行一個屬性，請先修好再設定',
    special: '這一篇的名稱或單元的寫法，小考檔寫不出來',
  }[result.reason];
}
