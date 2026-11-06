import type { Card, Rating } from '../core/study/index.ts';
import type { Flow, ReviewLine } from './flow.ts';

// 點選填空的作答流程（tasks/question-type-seam.md §6）：純程式，時間由 now 給。第一次的選擇與評分的對應（§4）只寫在這裡。

/** 同一個字連點，這麼久之內不算（規畫〈畫面與防點錯〉）。 */
const SAME_KEY = 300;
/** 最後一次填字之後，這麼久之內的「對答案」不算：手順勢多按一下。 */
const AFTER_FILL = 350;

type PickCellState = 'open' | 'filled' | 'skipped' | 'right' | 'retry' | 'near' | 'miss' | 'shown';
interface PickCellView {
  /** 這一格畫面上的字；還沒填是空字串。retry 是剛才選錯的字（劃掉）。 */
  text: string;
  state: PickCellState;
}
export interface PickView {
  stage: 'answer' | 'retry' | 'result';
  /** 待答的那一格；null 是沒有。 */
  cursor: number | null;
  cells: readonly PickCellView[];
  /** 再選時不能按的字：剛才選的。 */
  spent: string | null;
  /** 每一格都填了（「對答案」不再變淡）。 */
  filled: boolean;
  /** 結果階段才有：每個字這張卡的結果；這次沒出句子的字沒有。 */
  results: Readonly<Record<string, Rating>>;
  /** 結果階段有錯：只有「下一張」。 */
  committable: boolean;
}

interface Cell {
  lt: string;
  v: string;
  answer: string;
  /** 目前這格填的字；對答案之後是最後一次選的字。 */
  filled: string | null;
  /** 這格記成跳過：明確的狀態，不比字串（`？` 可以是組員）。 */
  skipped: boolean;
  /** 對答案時這格的字；第一次按沒印象是 null。 */
  first: string | null;
  /** 對答案之前是 open。 */
  status: 'open' | 'right' | 'retry' | 'near' | 'miss';
  /** 第一次選錯時，再選的結果。 */
  retry?: 'right' | 'wrong' | 'skip';
}

const RANK: Record<Rating, number> = { miss: 0, near: 1, good: 2, easy: 3 };
const ALL_RIGHT: readonly Rating[] = ['good', 'easy'];
const NONE: readonly Rating[] = [];

/** 回看能改成的評分（§8 💡）：孩子自己選的才能改，程式判的不能改。要換做法只改這裡。 */
const changeable = (allRight: boolean): readonly Rating[] => allRight ? ALL_RIGHT : NONE;

/** 一張比較卡從作答開始。revealed：預覽時自動展開答案（D-161）：直接到結果階段，空格是答案，沒有對錯記號與結果。 */
export function createPick(card: Card, options: { now: () => number; revealed?: boolean }): Flow {
  const cells: Cell[] = card.blanks.map(blank => ({ lt: blank.lt, v: blank.prompt.fingerprint, answer: blank.answer ?? '', filled: null, skipped: false, first: null, status: 'open' }));
  const shown = options.revealed === true;
  let stage: PickView['stage'] = shown ? 'result' : 'answer';
  let cursor: number | null = shown ? null : 0;
  let lastKey = { key: '', at: -Infinity };
  let lastFill = -Infinity;

  const empty = (cell: Cell): boolean => cell.filled === null && !cell.skipped;
  /** 下一個空格，往後繞一圈。 */
  function nextEmpty(from: number): number | null {
    for (let step = 1; step <= cells.length; step++) {
      const index = (from + step) % cells.length;
      if (empty(cells[index])) return index;
    }
    return null;
  }
  function nextRetry(): void {
    const index = cells.findIndex(cell => cell.status === 'retry');
    if (index >= 0) { cursor = index; return; }
    cursor = null;
    stage = 'result';
    flow.revealedAt = options.now();
  }

  function key(value: string): boolean {
    if (stage === 'result') return false;
    const at = options.now();
    const repeated = value === lastKey.key && at - lastKey.at < SAME_KEY;
    lastKey = { key: value, at };
    if (repeated || cursor === null) return false;
    const cell = cells[cursor];
    if (stage === 'answer') {
      cell.filled = value;
      cell.skipped = false;
      lastFill = at;
      cursor = nextEmpty(cursor);
      return true;
    }
    if (value === cell.first) return false;
    cell.filled = value;
    cell.retry = value === cell.answer ? 'right' : 'wrong';
    cell.status = value === cell.answer ? 'near' : 'miss';
    nextRetry();
    return true;
  }

  function skip(): boolean {
    if (stage === 'result' || cursor === null) return false;
    const cell = cells[cursor];
    if (stage === 'answer') {
      cell.filled = null;
      cell.skipped = true;
      lastFill = options.now();
      cursor = nextEmpty(cursor);
      return true;
    }
    cell.retry = 'skip';
    cell.status = 'miss';
    nextRetry();
    return true;
  }

  function row(index: number): boolean {
    const cell = cells.at(index);
    if (index < 0 || !cell || index === cursor) return false;
    if (stage === 'result' || (stage === 'retry' && cell.status !== 'retry')) return false;
    cursor = index;
    return true;
  }

  function check(): boolean {
    if (stage !== 'answer') return false;
    const open = cells.findIndex(empty);
    if (open >= 0) { cursor = open; return true; }
    if (options.now() - lastFill < AFTER_FILL) return false;
    for (const cell of cells) {
      cell.first = cell.filled;
      cell.status = cell.skipped ? 'miss' : cell.filled === cell.answer ? 'right' : 'retry';
    }
    stage = 'retry';
    nextRetry();
    return true;
  }

  const allRight = (): boolean => stage === 'result' && !shown && cells.every(cell => cell.status === 'right');
  /** 程式判的評分；全對時由孩子選記住了或太簡單（rating）。 */
  const ratingOf = (cell: Cell, rating: Rating | null): Rating => cell.status === 'right' ? (rating === 'easy' ? 'easy' : 'good') : cell.status === 'near' ? 'near' : 'miss';

  function resultsOf(): Record<string, Rating> {
    const results: Record<string, Rating> = {};
    if (stage !== 'result' || shown) return results;
    for (const cell of cells) {
      const rating = ratingOf(cell, null);
      const old = Object.hasOwn(results, cell.answer) ? results[cell.answer] : undefined;
      if (old === undefined || RANK[rating] < RANK[old]) results[cell.answer] = rating;
    }
    return results;
  }

  function cellView(cell: Cell): PickCellView {
    if (shown) return { text: cell.answer, state: 'shown' };
    if (stage === 'result') return { text: cell.answer, state: cell.status };
    switch (cell.status) {
      case 'open': return cell.skipped ? { text: '？', state: 'skipped' } : { text: cell.filled ?? '', state: cell.filled === null ? 'open' : 'filled' };
      case 'retry': return { text: cell.first ?? '', state: 'retry' };
      // 再選也錯的格先不給答案：其他要再選的格還在（示意頁的 slotContent）。
      case 'miss': return { text: '？', state: 'miss' };
      default: return { text: cell.filled ?? '', state: cell.status };
    }
  }
  function pickView(): PickView {
    return {
      stage, cursor, cells: cells.map(cellView),
      spent: stage === 'retry' && cursor !== null ? cells[cursor].first : null,
      filled: !cells.some(empty), results: resultsOf(),
      committable: stage === 'result' && !allRight(),
    };
  }

  /** 一個目標一行（§4）：照畫面上第一次出現的順序；最差的格放最上層，一樣差取前面那格，其他格放 also。 */
  function linesOf(rating: Rating | null): ReviewLine[] {
    const byTarget = new Map<string, Cell[]>();
    for (const cell of cells) {
      const list = byTarget.get(cell.lt);
      if (list) list.push(cell);
      else byTarget.set(cell.lt, [cell]);
    }
    return [...byTarget].map(([lt, list]) => {
      const worst = list.reduce((best, cell) => RANK[ratingOf(cell, rating)] < RANK[ratingOf(best, rating)] ? cell : best);
      const also = list.filter(cell => cell !== worst).map(cell => ({ v: cell.v, r: ratingOf(cell, rating), pick: cell.first, ...(cell.retry ? { retry: cell.retry } : {}) }));
      return { lt, r: ratingOf(worst, rating), v: worst.v, pick: worst.first, ...(worst.retry ? { retry: worst.retry } : {}), ...(also.length ? { also } : {}) };
    });
  }

  const flow: Flow = {
    autoRead: null,
    revealedAt: null,
    view: () => ({ revealed: stage === 'result', allowed: allRight() ? ALL_RIGHT : NONE, speakable: false, typed: null, pick: pickView() }),
    act(action) {
      switch (action.kind) {
        case 'key': return key(action.key);
        case 'skip': return skip();
        case 'row': return row(action.index);
        case 'check': return check();
        default: return false;
      }
    },
    settle: rating => ({ lines: linesOf(rating), look: { typed: null, pick: pickView(), changeable: changeable(allRight()), lines: linesOf } }),
  };
  return flow;
}
