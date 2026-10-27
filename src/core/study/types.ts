import type { Deck, Prompt, Target } from '../deck/index.ts';

export type Rating = 'easy' | 'good' | 'near' | 'miss';

interface Stamp {
  t: string;
  at: number;
  offset: number;
}

export interface ReviewEntry extends Stamp {
  kind: 'review';
  lt: string;
  r: Rating;
  v: string | null;
  /** 打字卡的作答方式；沒有這一欄是 null，認不得的字串原樣保留。 */
  typed: string | null;
  src: string | null;
}

export interface UndoEntry extends Stamp {
  kind: 'undo';
  undo: string;
}

export interface ChangeEntry extends Stamp {
  kind: 'change';
  set: string;
  deck: string | null;
  lt: string | null;
  val: unknown;
}

export type LogEntry = ReviewEntry | UndoEntry | ChangeEntry;

export type NewEntry =
  // typed：打字卡第 1 步的結果；retry：第 2 步（原形提示）的結果，第 1 步 wrong／skip 時一定寫，跳過第 2 步寫 not-needed
  // （D-121、D-115、syntax.md §5）。評分只看第 1 步；retry 只是證據，parseLine 不讀它。
  | { lt: string; r: Rating; v: string; typed?: 'right' | 'wrong' | 'skip'; retry?: 'right' | 'wrong' | 'skip' | 'not-needed'; src?: 'check' }
  | { lt: string; r: 'miss'; src: 'mistake' }
  | { undo: string }
  | { set: 'cap'; val: number }
  | { set: 'retention'; val: number }
  | { set: 'semester'; val: string }
  | { set: 'filter'; val: string[] }
  | { set: 'status'; deck: string; val: '草稿' | '啟用' | '暫停' }
  | { set: 'status'; lt: string; val: '啟用' | '暫停' };

export interface History {
  reviews: ReviewEntry[];
  changes: ChangeEntry[];
  problems: { path: string; line: number; message: string }[];
  /**
   * 被取消的 t（所有 undo 行指的，不論那一筆作答在不在），照字串排序、不重複。
   * appendLine 靠它讓取消之後才加進來的同一筆作答仍然取消，和重新 mergeHistory 相同（Codex 審查 W5 的 F2）。
   */
  cancelled: string[];
  /**
   * 原始紀錄每一行出現過的 lt（作答、變更都算，被取消的也算，取消行多帶的也算），照字串排序、不重複。配新 ID 時避開（D-134）。
   * 壞掉的行（能救回的也一樣）整行寬鬆地找：救回的尾段、每一段 `{"t":` 開頭的尾段、`"lt": "…"` 的字串都算，
   * 多避開幾個不會錯配（Codex 審查 W5 第二部分的 F3、R1）。
   */
  seen: string[];
}

export interface LogWriter {
  /** 排進背景佇列即回傳，不等待寫檔。 */
  write(entry: NewEntry): string;
  /** 等到目前排隊的都寫完，並重試先前失敗的；仍失敗就 reject。 */
  flush(): Promise<void>;
}

export interface Memory {
  stability: number;
  difficulty: number;
  last: ReviewEntry;
  reps: number;
}

// ── W4 今天的佇列 ──

export interface DeckEntry {
  /** vault 裡的路徑；同時是排序與「當日卡」的鍵。 */
  path: string;
  deck: Deck;
}

export interface Settings {
  /** 每日時間上限，全部科目加起來（分鐘）。 */
  capMinutes: number;
  /** 目標保持率，例如 0.8。 */
  retention: number;
  /** 濾網：卡組的分類，或「重要性：高／中／低」。 */
  filter: readonly string[];
}

/** 目前生效的考試範圍；沒有生效的範圍時傳 null。 */
export interface ExamScope {
  contains(entry: DeckEntry, target: Target): boolean;
  /** 填了考試期間；生效就表示結束日還沒過。 */
  hasPeriod: boolean;
}

export interface TodayInput {
  decks: readonly DeckEntry[];
  /** 只用 reviews，不讀 changes。reviews 依時間排好（mergeHistory 的結果；作答後新的一筆加在最後）。 */
  history: History;
  settings: Settings;
  exam: ExamScope | null;
  now: number;
  offset: number;
}

export type Lane = 'relearn' | 'exam-due' | 'exam-new' | 'due' | 'new';

export interface QueueItem {
  lt: string;
  /** DeckEntry.path */
  deck: string;
  /** 卡組的「科目」；學業以外的卡組是 null。 */
  subject: string | null;
  lane: Lane;
  /** 估計要花的秒數。 */
  seconds: number;
}

/** planToday 時記下的單一學習目標；只給 nextCard、progress 用。 */
export interface Slot {
  target: Target;
  /** 配對的另一個方向的 ID。 */
  pair: string | null;
  /** 今天以前的記憶狀態。 */
  memory: Memory | null;
  retention: number;
  inExam: boolean;
  /** 今天以前答對過（good、easy）。 */
  correct: boolean;
  /** 今天以前每個題目指紋最後一次出現的時間。 */
  seen: Map<string, number>;
}

export interface Today {
  /** dayOf(now, offset) */
  day: number;
  /** 排這一份時的時區；換了時區 nextCard 回 stale，要重新 planToday。 */
  offset: number;
  /** 今天的份，照出卡順序。 */
  share: QueueItem[];
  /** 「再複習一些」，接在 share 後面的順序。 */
  more: QueueItem[];
  problems: { deck: string; line: number; message: string }[];
  /** 內部資料，不屬於介面；畫面與測試不讀。 */
  slots: ReadonlyMap<string, Slot>;
}

export type Pick =
  | { subject: string | null }
  | { deck: string }
  | { more: true };

export interface Card {
  lt: string;
  deck: string;
  target: Target;
  /** 這次出哪一題。 */
  prompt: Prompt;
  /** 從來沒有作答過：卡片角落標「新」。 */
  isNew: boolean;
  /** 要打字。 */
  typed: boolean;
  /** 剛答錯、還沒到時間就提早出。 */
  early: boolean;
}

export type Next =
  | { kind: 'card'; card: Card }
  | { kind: 'done' }
  | { kind: 'stale' };

export interface SubjectRow {
  subject: string | null;
  done: number;
  total: number;
  remainingSeconds: number;
  /** 這一科有學習目標在考試範圍裡。 */
  inExam: boolean;
}

export interface Progress {
  done: number;
  total: number;
  subjects: SubjectRow[];
}
