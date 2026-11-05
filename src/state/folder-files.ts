import type { Files } from '../core/files.ts';
import { Closed, createReads } from './reads.ts';
import type { Life } from './reads.ts';

/**
 * 一個資料夾的檔的讀與寫：段考的範圍檔（tasks/exam-scope.md §3、§2-4、§4）與小考檔（tasks/quiz-mark.md §1）共用。自己一份讀取層，和卡組、紀錄不同一條。
 * 讀取層的 read 等整批，一個卡住的 iCloud 佔位檔會卡住同一列後面所有的讀取，寫入前的等待也跟著等；分開之後這裡的檔讀不到不會擋卡組的寫入（D-134 的理由是不知道 ID 用過沒，這裡的檔沒有 ID）。
 * 檔案之間也不互相等（alone）：一份卡住，讀到的那份先用。
 */

export interface FolderFilesOptions<F> {
  files: Files;
  delay: number;
  stuckAfter: number;
  writeTimeout: number;
  onError: (error: unknown) => void;
  /** 內容變了（或第一次讀完）：組合那一層決定怎麼通知。 */
  changed: () => void;
  unreadChanged: () => void;
  folder: string;
  /** 這個路徑是不是這個資料夾要讀的檔。 */
  isFile: (path: string) => boolean;
  /** 讀一份的內容；null 是這份不算（當成沒有）。 */
  parse: (text: string) => F | null;
}

/** 等寫入等到逾時（§6）：只結束等待，底層取消不了。 */
class WriteTimeout extends Error {}

export function createFolderFiles<F>(options: FolderFilesOptions<F>) {
  const { files, onError } = options;
  const life: Life = { loaded: false, closed: false };
  /** 讀過的每一份；讀不到的那一份留著上一次的內容（§4），讀到 null 才拿掉。 */
  const known = new Map<string, { text: string; file: F }>();
  /** 第一次列出來了、都有結果了。還沒的話是「不知道」：不當成沒有，不能寫（§4）。 */
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
   * 內容變了還沒通知：別份還在讀時先不通知，最多再等一次 delay。改名的舊路徑與新路徑是分開讀的，舊的先讀到 null，中間那一下不算沒有（§4）；
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
    watched: options.isFile,
    onError,
    alone: true,
    quiet() {
      sendChanged();
      wakeDrain?.();
    },
    list: async () => [(await files.list(options.folder)).filter(options.isFile), []],
    // 讀取層把卡組以外的放在第二份。
    batch(_decks, texts) {
      let changed = false;
      for (const [path, text] of texts) {
        first?.delete(path);
        if (known.get(path)?.text === text) continue;
        const file = text === null ? null : options.parse(text);
        if (text === null || file === null) changed = known.delete(path) || changed;
        else { known.set(path, { text, file }); changed = true; }
      }
      if (changed) revision++;
      return () => { if (checkSettled() || changed) changedSoon(); };
    },
    // 這裡沒有等核對的寫入；這裡只是第一次的結果到了。
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

  function timed<T>(work: Promise<T>): Promise<T> {
    let id: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      id = setTimeout(() => { reject(new WriteTimeout(`等了 ${String(options.writeTimeout)} ms 沒有回來（逾時），這次沒有存`)); }, options.writeTimeout);
    });
    return Promise.race([work, timeout]).finally(() => { clearTimeout(id); });
  }
  /**
   * 一次寫一個路徑：讀取不跨過這次 I/O（reads 的 hold），寫完立刻重讀一次。回傳寫下去的文字。
   * 逾時取消不了底層（Codex L2 的 R5）：回呼還沒進入的，之後進入時丟錯，不會寫；已經進入的可能等一下才寫成，真的寫成了才交給 late，關閉之後不交。
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
  /** 把這份文字當成現在的內容；之後檔案通知讀到同一份不再通知（§2-4）。 */
  function adopt(path: string, text: string): void {
    if (known.get(path)?.text === text) return;
    const file = options.parse(text);
    if (file === null) known.delete(path);
    else known.set(path, { text, file });
    revision++;
    options.changed();
  }

  return {
    start,
    settle,
    drain,
    timed,
    modify,
    adopt,
    closed: (): boolean => life.closed,
    settled: (): boolean => settled,
    revision: (): number => revision,
    unread: reads.unread,
    /** 除了 except 那一份，還有已知還沒讀完的變動。 */
    waiting: reads.waiting,
    /** 列出來或通知過、從來沒讀到的份數（§4）。 */
    missing: (): number => [...reads.unread].filter(path => !known.has(path)).length,
    text: (path: string): string | null => known.get(path)?.text ?? null,
    entries: (): { path: string; file: F }[] => [...known].map(([path, { file }]) => ({ path, file })),
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
