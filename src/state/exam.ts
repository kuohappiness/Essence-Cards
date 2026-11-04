import type { Files } from '../core/files.ts';
import { chooseScope, editScope, EXAM_FOLDER, isExamPath, lastEnded, newScopeText, parseScope, scopeFileName } from '../core/catalog/index.ts';
import type { ScopeChange, ScopeFile, ScopeUnit } from '../core/catalog/index.ts';
import { newId } from '../core/deck/index.ts';
import type { ExamLog } from '../core/study/index.ts';
import { Closed, createReads } from './reads.ts';
import type { Life } from './reads.ts';

/**
 * 範圍檔的讀與寫（tasks/exam-scope.md §3、§2-4、§4）：自己一份讀取層，和卡組、紀錄不同一條。讀取層的 read 等整批，一個卡住的 iCloud 佔位檔
 * 會卡住同一列後面所有的讀取，寫入前的等待也跟著等；分開之後範圍檔讀不到不會擋卡組的寫入（D-134 的理由是不知道 ID 用過沒，範圍檔沒有 ID）。
 * 範圍檔之間也不互相等（alone）：一份卡住，讀到的那份先用。
 */

/** 畫面交出的變動（§2-4）：新勾的、取消的、有改的日期。 */
export type ExamChange = Pick<ScopeChange, 'add' | 'remove' | 'start' | 'end'>;
/** done 是寫好了（或本來就沒有要改的）；blocked 的原因畫面要寫出來，已勾的不丟。special 的 lost 是存了會掉出範圍的單元編號。 */
export type ExamResult =
  | { kind: 'done' }
  | { kind: 'blocked'; reason: 'loading' | 'closed' | 'unread' | 'changed' | 'broken' | 'dates' }
  | { kind: 'blocked'; reason: 'special'; lost: string[] }
  | { kind: 'failed'; error: unknown };

interface ExamFilesOptions {
  files: Files;
  delay: number;
  stuckAfter: number;
  writeTimeout: number;
  random?: () => number;
  onError: (error: unknown) => void;
  /** 內容變了（或第一次讀完）：組合那一層比選定的結果，決定重排或只通知畫面。 */
  changed: () => void;
  unreadChanged: () => void;
  /** 寫了有變動的範圍：組合那一層記一行紀錄。 */
  logged: (val: ExamLog) => void;
}

/** 回呼裡擋下來的（§2-4）：丟錯才不會建立或寫入。 */
class ScopeBlocked extends Error {
  readonly result: Extract<ExamResult, { kind: 'blocked' }>;
  constructor(result: ScopeBlocked['result']) { super('範圍檔不能寫：' + result.reason); this.result = result; }
}

/** 等寫入等到逾時（§6）：只結束等待，底層取消不了。 */
class WriteTimeout extends Error {}

/** 紀錄行的欄位（§2-5）：讀得懂的每一行，照檔案的順序，只留年級學期、科目、編號。 */
const unitsOf = (file: ScopeFile): string[] => file.lines.flatMap(line => line.kind === 'unit' ? [`${line.term} ${line.subject} ${line.code}`] : []);
/** 寫入之前的內容：沒寫的日期沒有欄位，看不懂的日期照原字，原本沒有識別碼就沒有 id（§2-5）。 */
function oldOf(file: ScopeFile): NonNullable<ExamLog['old']> {
  const date = (read: ScopeFile['start']): string | null => read.kind === 'ok' ? read.date : read.kind === 'bad' ? read.raw : null;
  const start = date(file.start), end = date(file.end);
  return { ...(file.id === null ? {} : { id: file.id }), units: unitsOf(file), ...(start === null ? {} : { start }), ...(end === null ? {} : { end }) };
}
/** 寫完之後的內容：日期只有 `YYYY-MM-DD`。 */
function logOf(file: ScopeFile, action: ExamLog['do']): ExamLog {
  const date = (read: ScopeFile['start']): string | null => read.kind === 'ok' ? read.date : null;
  const start = date(file.start), end = date(file.end);
  return { id: file.id ?? '', do: action, units: unitsOf(file), ...(start === null ? {} : { start }), ...(end === null ? {} : { end }) };
}

export function createExamFiles(options: ExamFilesOptions) {
  const { files, onError } = options;
  const life: Life = { loaded: false, closed: false };
  /** 讀過的每一份；讀不到的那一份留著上一次的內容（§4），讀到 null 才拿掉。 */
  const known = new Map<string, { text: string; file: ScopeFile }>();
  /** 第一次列出來了、都有結果了。還沒的話是「不知道」：不當成沒有範圍，不能寫（§4）。 */
  let settled = false;
  let revision = 0;
  /** 第一次列出來、還沒有結果的（讀到、確定沒有、讀失敗都算結果）；還沒列出來是 null。 */
  let first: Set<string> | null = null;
  let firstDone = (): void => { /* 列出來時才換成真的。 */ };
  /** 第一次的結果都到了：只回傳 true 一次。 */
  function checkSettled(): boolean {
    if (settled || first?.size !== 0) return false;
    settled = true;
    revision++;
    firstDone();
    return true;
  }
  /**
   * 內容變了還沒通知：別份還在讀時先不通知，最多再等一次 delay。改名的舊路徑與新路徑是分開讀的，舊的先讀到 null，中間那一下不算沒有範圍（§4）；
   * 真的有一份卡住時，讀到的等這一下就用。
   */
  let unsent = false;
  let unsentTimer: ReturnType<typeof setTimeout> | null = null;
  function sendChanged(): void {
    if (unsentTimer !== null) clearTimeout(unsentTimer);
    unsentTimer = null;
    if (!unsent || life.closed) return;
    unsent = false;
    try { options.changed(); } catch (error) { onError(error); }
  }
  function changedSoon(): void {
    unsent = true;
    unsentTimer ??= setTimeout(sendChanged, options.delay);
  }
  let wakeDrain: (() => void) | null = null;
  const reads = createReads({
    files,
    life,
    delay: options.delay,
    watched: isExamPath,
    onError,
    alone: true,
    quiet() {
      sendChanged();
      wakeDrain?.();
    },
    list: async () => [(await files.list(EXAM_FOLDER)).filter(isExamPath), []],
    // 讀取層把卡組以外的放在第二份。
    batch(_decks, texts) {
      let changed = false;
      for (const [path, text] of texts) {
        first?.delete(path);
        if (text === null) changed = known.delete(path) || changed;
        else if (known.get(path)?.text !== text) { known.set(path, { text, file: parseScope(text) }); changed = true; }
      }
      if (changed) revision++;
      return () => { if (checkSettled() || changed) changedSoon(); };
    },
    // 範圍檔沒有等核對的寫入；這裡只是第一次的結果到了。
    unreadable(path) { first?.delete(path); },
    stuckAfter: options.stuckAfter,
    unreadChanged: options.unreadChanged,
  });

  let started: Promise<void> | null = null;
  /** 開始讀。錯誤都已經（或在這裡）交給 onError，ready() 不跟著失敗（§4）；close() 就是結束。 */
  function start(): Promise<void> {
    started ??= reads.start(async (_begin, paths) => {
      // 列出來之後各讀各的：讀到的先用，之後的通知照常處理（§4）；全部有結果才算知道了。
      first = new Set(paths);
      life.loaded = true;
      const done = new Promise<void>(resolve => { firstDone = resolve; });
      if (checkSettled()) options.changed();
      reads.reread(...paths);
      reads.catchUp();
      await done;
      if (life.closed) throw new Closed();
    }).catch((error: unknown) => {
      // read 的錯在 queue 已經報過；這裡只剩讀取那一列以外的。多報一次比漏掉好，所以不分。
      if (!(error instanceof Closed)) onError(error);
    });
    return started;
  }
  /** 第一次讀完，或等了 ms 毫秒（§4）：沒回來就當成還不知道。 */
  function settle(ms: number): Promise<void> {
    return new Promise(resolve => {
      const id = setTimeout(resolve, ms);
      void start().then(() => { clearTimeout(id); resolve(); });
    });
  }

  /**
   * 寫入前先讀完已知的待讀（§4，Codex L2 的 R13；和卡組的 admit 同一個規則）：通知到了、還在排或正在讀的那一份可能是更早的考試。
   * 一份一份讀，所以等的是「都讀完了」的那一聲。最多等 ms。
   * decide 收到 true 是都有結果了（讀不到的在 unread）；它和最後一次查待讀在同一個同步區段，中間不會再插進通知（Codex L2 的 R17）。
   */
  async function drain<T>(ms: number, decide: (known: boolean) => T | Promise<T>): Promise<T> {
    let late = false;
    const id = setTimeout(() => { late = true; wakeDrain?.(); }, ms);
    const going = (): boolean => !late && !life.closed && reads.waiting();
    while (going()) {
      await reads.readNow();
      if (going()) await new Promise<void>(resolve => { wakeDrain = resolve; });
    }
    clearTimeout(id);
    wakeDrain = null;
    return decide(!reads.waiting());
  }

  function timed(work: Promise<void>): Promise<void> {
    let id: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      id = setTimeout(() => { reject(new WriteTimeout()); }, options.writeTimeout);
    });
    return Promise.race([work, timeout]).finally(() => { clearTimeout(id); });
  }
  /**
   * 一次寫一個路徑：讀取不跨過這次 I/O（reads 的 hold），寫完立刻重讀一次。回傳寫下去的文字。
   * 逾時取消不了底層（Codex L2 的 R5）：回呼還沒進入的，之後進入時丟錯，不會寫；已經進入的可能等一下才寫成，真的寫成了才交給 late（記紀錄），關閉之後不記。
   */
  async function modify(path: string, edit: (text: string) => string, late: (text: string) => void): Promise<string> {
    let written = '', entered = false, gaveUp = false;
    reads.hold(path);
    const work = files.modify(path, text => {
      if (gaveUp) throw Error('等這次寫入已經逾時，不寫了');
      entered = true;
      written = edit(text);
      return written;
    });
    try {
      await timed(work);
      return written;
    } catch (error) {
      if (!(error instanceof WriteTimeout)) throw error;
      gaveUp = true;
      const waited = `寫進磁碟超過 ${String(options.writeTimeout)} ms 沒有回來（逾時），`;
      if (!entered) throw Error(waited + '這次沒有存', { cause: error });
      work.then(() => {
        if (!life.closed) late(written);
        reads.reread(path);
      }, () => { /* 寫不進去：畫面已經寫了原因。 */ });
      throw Error(waited + '可能等一下才寫好；請重新打開這個畫面確認', { cause: error });
    } finally {
      reads.unhold(path);
      reads.reread(path);
    }
  }
  /** 把這份文字當成現在的內容、重排；之後檔案通知讀到同一份不再通知（§2-4）。 */
  function adopt(path: string, text: string): void {
    if (known.get(path)?.text === text) return;
    known.set(path, { text, file: parseScope(text) });
    revision++;
    options.changed();
  }
  const freshId = (): string => newId(options.random ?? Math.random, new Set([...known.values()].flatMap(each => each.file.id ?? [])), { letterFirst: true });
  const failure = (error: unknown): ExamResult => error instanceof ScopeBlocked ? error.result : { kind: 'failed', error };

  return {
    start,
    settle,
    drain,
    settled: (): boolean => settled,
    revision: (): number => revision,
    unread: reads.unread,
    /** 列出來或通知過、從來沒讀到的份數（§4）。 */
    missing: (): number => [...reads.unread].filter(path => !known.has(path)).length,
    text: (path: string): string | null => known.get(path)?.text ?? null,
    choose: (day: number) => chooseScope([...known].map(([path, { file }]) => ({ path, file })), day),
    /** 上一份範圍的結束日（§6 的預先勾選）。 */
    previousEnd: (day: number): string | null => lastEnded([...known].map(([path, { file }]) => ({ path, file })), day),
    /** 改一份舊檔（§2-4）：回呼裡改最新的內容；有變動才記（§2-5）。id 是畫面打開時的識別碼。 */
    async update(path: string, id: string | null, change: ExamChange | Pick<ScopeChange, 'ended'>, units: readonly ScopeUnit[]): Promise<ExamResult> {
      let before: ScopeFile | null = null;
      const record = (text: string): void => {
        const after = parseScope(text), was = before;
        if (was && 'ended' in change) options.logged({ ...logOf(after, '提前結束'), ended: change.ended });
        else if (was && JSON.stringify(oldOf(was)) !== JSON.stringify(oldOf(after))) options.logged({ ...logOf(after, '改'), old: oldOf(was) });
      };
      try {
        const text = await modify(path, latest => {
          // 真正寫之前最後一個同步區段：開始寫之後才到的通知（別份）還來得及不寫，別份可能是更早的考試（Codex L2 的 R17）。同一份不用看，這裡拿到的就是最新的。
          if (reads.waiting(path)) throw new ScopeBlocked({ kind: 'blocked', reason: 'unread' });
          const done = editScope(latest, { ...change, id: freshId() }, units);
          if (done.kind === 'blocked') throw new ScopeBlocked(done);
          const was = parseScope(latest);
          // 同一個路徑換成另一次考試（同步把別的檔換過來，state 還沒讀到）：別人改的別的行留著，但不是這次考試就不寫。
          if (was.id !== id) throw new ScopeBlocked({ kind: 'blocked', reason: 'changed' });
          before = was;
          return done.text;
        }, record);
        record(text);
        adopt(path, text);
        return { kind: 'done' };
      } catch (error) { return failure(error); }
    },
    /** 新檔（§2-4）：撞名不蓋掉，換下一個後綴。沒有要加的就不建。 */
    async create(change: ExamChange): Promise<ExamResult> {
      const add = change.add ?? [];
      if (!add.length) return { kind: 'done' };
      const text = newScopeText({ id: freshId(), start: change.start, end: change.end, add });
      const name = EXAM_FOLDER + '/' + scopeFileName(change.start ?? null, add);
      try {
        for (let suffix = 1; ; suffix++) {
          const path = (suffix === 1 ? name : `${name} ${String(suffix)}`) + '.md';
          let taken = false;
          const record = (): void => { if (!taken) options.logged(logOf(parseScope(text), '建立')); };
          await modify(path, latest => { taken = latest !== ''; return taken ? latest : text; }, record);
          if (taken) continue;
          record();
          adopt(path, text);
          return { kind: 'done' };
        }
      } catch (error) { return failure(error); }
    },
    /** 關閉：不等卡住的讀取（只讀不寫，closed 擋掉晚到的結果，§3）。 */
    stop(): void {
      life.closed = true;
      reads.stop();
      sendChanged();
      firstDone();
      wakeDrain?.();
    },
  };
}
