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
  | { lt: string; r: Rating; v: string; src?: 'check' }
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
