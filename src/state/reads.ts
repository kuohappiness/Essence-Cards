import type { Files } from '../core/files.ts';
import { isDeckPath, listDeckPaths } from '../core/deck/index.ts';
import { isLogPath, LOG_FOLDER } from '../core/study/index.ts';

/**
 * 讀取層（tasks/state-split.md §1）：監看、列出、讀、重試、待讀與讀不到、每篇卡組的失效序號。
 * 只分出讀到了什麼，不碰 tracker、不解析卡組、不合併紀錄：那些在組合那一層（index.ts）。
 */

/**
 * close() 讓第一次載入放棄時的拒絕原因（tasks/error-log.md §2-3、Codex L2 的 R2）：ready() 拒絕時用它分辨「停用造成的」與
 * 「程式的錯」，不看拒絕當下關閉了沒有（程式的錯之後同一輪又 close() 時，錯誤照樣要報）。
 */
export class Closed extends Error {
  constructor(options?: { cause?: unknown }) { super('state 已關閉，沒有讀完', options); }
}

/** 第一次載入完成了沒有、關閉了沒有。由 index.ts 建立並改值，讀取層與寫入只讀。 */
export interface Life { loaded: boolean; closed: boolean }
/** 一批讀到的結果：路徑 → 文字；null 是不存在。 */
export type Texts = Map<string, string | null>;

export interface ReadsOptions {
  files: Files;
  life: Life;
  /** 收到檔案變動後等多久才處理（毫秒）。 */
  delay: number;
  /** 要不要理這個通知：卡組，或別台裝置的紀錄。 */
  watched: (path: string) => boolean;
  /** 讀不到、列不出來，或處理一批時程式的錯（都算 read）。 */
  onError: (error: unknown) => void;
  /** 一批讀到的卡組與紀錄交給組合那一層；回傳的收尾在讀不到的回報與重試之後呼叫。 */
  batch: (texts: Texts, logs: Texts) => () => void;
  /** 這一篇這次讀不到：等核對的寫入先回覆。 */
  unreadable: (path: string) => void;
  /** 讀取一直沒回來多久算讀不到（毫秒）。 */
  stuckAfter: number;
  /** unread 的內容變了（多了或少了）：只有入口與狀態列的提醒聽，不經 onChange，存檔按鈕等既有的監聽者不受影響。 */
  unreadChanged: () => void;
  /** 第一次載入要列哪些檔；預設是卡組與紀錄（範圍檔自己一份，tasks/exam-scope.md §3）。 */
  list?: () => Promise<[string[], string[]]>;
  /**
   * 一份一份讀、讀到就交付（範圍檔，tasks/exam-scope.md §4）：卡住的那份不擋別份，也不擋之後的通知。
   * 卡組與紀錄不用：一批要一起才排得對，讀不到也由寫入門檻擋著（D-134）。
   */
  alone?: boolean;
  /** alone：這一刻沒有正在讀的了。 */
  quiet?: () => void;
}

export type Reads = ReturnType<typeof createReads>;

export function createReads(options: ReadsOptions) {
  const { files, life, delay, onError } = options;
  /** 收到通知還沒讀的路徑；讀不到的也留在這裡等重試。 */
  const pending = new Set<string>();
  /** 列出來或通知過、但最近一次讀不到的路徑（unread()）；一定也在 pending 裡。 */
  const unread = new Set<string>();
  /** 第一次載入完成之前收到過通知：完成後照檔案變動處理一次。 */
  let noticed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let processing: Promise<void> = Promise.resolve();
  /**
   * 讀寫的先後（tasks/state-writes.md §2）：每篇卡組一個失效序號，取自全域遞增的計數，紀錄不刪（刪掉、改名後重建的路徑不會撞回舊的號碼）。
   * 這篇的 Cards I/O 開始與結束、讀到它被刪掉、改名配對的兩邊都讓它前進；一份讀取開始與落地時序號不同，那篇的結果整份不用。
   */
  let sequence = 0;
  const marks = new Map<string, number>();
  const bump = (path: string): void => { marks.set(path, ++sequence); };
  /** 正在做 Cards I/O 的卡組（寫進磁碟還沒有結果）：不開始讀，留在 pending，I/O 結束時立刻讀。 */
  const busy = new Set<string>();
  /** 正在讀的批數（0 或 1：一次只讀一批）。 */
  let reading = 0;
  /** alone 正在讀的路徑：同一份一次讀一個，晚到的舊內容才不會蓋掉新的。 */
  const flying = new Set<string>();
  let unwatch: (() => void) | null = null;
  /** 判定讀取卡住的計時（一批一個）；read 結束或關閉時清掉。 */
  const stuckTimers = new Set<ReturnType<typeof setTimeout>>();
  let lastUnread = '';
  /** unread 變了才通知：一批可能連續加減好幾次。 */
  function unreadCheck(): void {
    const now = [...unread].sort().join('\n');
    if (now === lastUnread) return;
    lastUnread = now;
    options.unreadChanged();
  }
  // 連續讀不到的次數；決定下一次重試要等多久（Codex 審查 W5 的 F3：不能只等下一次通知）。
  let failures = 0;
  const retryDelay = (): number => Math.min(60_000, 1000 * 2 ** Math.max(0, failures - 1));
  /** 列不出來時重試前的等待；close() 會提早叫醒它。 */
  let wake: (() => void) | null = null;
  function pause(ms: number): Promise<void> {
    return new Promise(resolve => {
      const id = setTimeout(done, ms);
      function done(): void { clearTimeout(id); wake = null; resolve(); }
      wake = done;
    });
  }

  function notify(path: string): void {
    if (life.closed) return;
    if (!options.watched(path)) return;
    pending.add(path);
    // 第一次載入完成之前收到的，完成後一起處理。
    if (life.loaded) schedule();
    else noticed = true;
  }
  function schedule(wait = delay): void {
    // onError 的監聽者可能在回呼裡 close()（Codex state-load L2 的 F2）：關閉之後不再排。
    if (life.closed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void queue(apply);
    }, wait);
  }
  /** 一次只讀一批（第一次載入的兩批、之後每次檔案變動）：重試的計時到了，也等前一批處理完才讀。錯誤交給 onError。 */
  function queue(work: () => Promise<void>): Promise<void> {
    const next = processing.then(work);
    processing = next.catch((error: unknown) => { onError(error); });
    return next;
  }
  async function apply(): Promise<void> {
    if (life.closed) return;
    // 正在 I/O 的那一篇不讀，留在 pending（§2 第 2 點）；讀取開始後才到的通知留著等下一批（第 4 點）。
    const paths = [...pending].filter(path => !busy.has(path) && !flying.has(path));
    if (!paths.length) return;
    for (const path of paths) pending.delete(path);
    if (options.alone) {
      for (const path of paths) readAlone(path);
      return;
    }
    reading++;
    try { await read(paths); } finally { reading--; }
  }
  function readAlone(path: string): void {
    flying.add(path);
    void read([path]).finally(() => {
      flying.delete(path);
      // 讀的期間又有通知或寫入：讀完再讀一次。讀不到的重試在 read 裡已經排好了（timer 不是 null）。
      if (pending.has(path) && timer === null) schedule(unread.has(path) ? retryDelay() : 0);
      if (!flying.size) options.quiet?.();
    }).catch(onError);
  }
  /** 不等 delay，排一批讀取（I/O 結束後、寫入前先讀完待讀）；錯誤已經在 queue 交給 onError。 */
  const readNow = (): Promise<void> => queue(apply).catch(() => {});

  /**
   * 讀一批路徑（§2-2）：第一次載入的卡組、紀錄各一批，之後每次檔案變動一批，成功與失敗都只在這裡處理。
   * 讀不到的留在 pending、放進 unread，上一次讀到的內容保留，隔一段時間自己重試；讀到 null 的拿掉。
   * 代價：有紀錄還沒讀到時，today() 是照不完整的紀錄排的，那幾張卡的間隔可能偏短、剛在別台裝置複習過的卡可能再出一次；
   * 紀錄讀到後會重排。這比整個外掛打不開好（使用者 2026-10-24：先讓讀到的卡組可以複習）。
   */
  async function read(paths: readonly string[]): Promise<void> {
    if (life.closed) return;
    const at = paths.map(path => marks.get(path));
    // 一直沒回來的讀取也算讀不到（D-154、任務說明 §8）：iCloud 的佔位檔可能讓 read 一直不回來，unread() 不能只看讀失敗的。
    const settled = new Set<string>();
    const stuck = setTimeout(() => {
      stuckTimers.delete(stuck);
      for (const path of paths) if (!settled.has(path)) unread.add(path);
      unreadCheck();
    }, options.stuckAfter);
    stuckTimers.add(stuck);
    const reading = paths.map(path => files.read(path));
    // 另外接，不串在讀取上：讀完之後的先後不能因為多了這個計時而改變。
    reading.forEach((each, i) => { const done = (): void => { settled.add(paths[i]); }; each.then(done, done); });
    const results = await Promise.allSettled(reading);
    clearTimeout(stuck);
    stuckTimers.delete(stuck);
    if (life.closed) return;
    let failure: { error: unknown } | null = null;
    const texts: Texts = new Map(), logs: Texts = new Map();
    for (const [i, path] of paths.entries()) {
      const result = results[i];
      // 跨過這篇的 I/O（§2 第 3 點）：文字、null、reject 都不用，放回 pending；I/O 結束時已經（或會）排一批讀取。
      if (marks.get(path) !== at[i] || busy.has(path)) {
        pending.add(path);
        if (result.status === 'fulfilled') unread.delete(path);
        continue;
      }
      if (result.status === 'rejected') {
        // 讀不到的留著等重試；讀得到的照常處理，不被它擋住。
        pending.add(path);
        unread.add(path);
        options.unreadable(path);
        failure ??= { error: result.reason };
        continue;
      }
      unread.delete(path);
      (isDeckPath(path) ? texts : logs).set(path, result.value);
    }
    const finish = options.batch(texts, logs);
    if (failure) {
      failures++;
      onError(failure.error);
      // 等待中已經有新的通知排好時，就跟著那一次重讀。
      if (timer === null) schedule(retryDelay());
    } else if (!unread.size) failures = 0;
    finish();
    unreadCheck();
  }

  /** 第一次載入（§2-1）：先監看；只有列不出來才整個重試，close() 之後放棄。列出來之後交給 load。 */
  async function start<T>(load: (begin: number, deckPaths: string[], logPaths: string[]) => Promise<T>): Promise<T> {
    // 先監看再讀：讀的期間改到的檔不會漏掉。
    if (!life.closed) unwatch = files.watch(notify);
    for (;;) {
      const begin = performance.now();
      let lists: [string[], string[]];
      try {
        lists = await (options.list ? options.list() : Promise.all([listDeckPaths(files), files.list(LOG_FOLDER).then(paths => paths.filter(isLogPath))]));
      } catch (error) {
        // 已經關閉時列不出來，是停用中途的結果，不是故障：不報、不重試。
        if (life.closed) throw new Closed({ cause: error });
        failures++;
        onError(error);
        // 回呼裡 close() 了就不等（Codex state-load L2 的 F2）；等的期間 close() 會提早叫醒。
        if (!life.closed) await pause(retryDelay());
        if (life.closed) throw new Closed();
        continue;
      }
      failures = 0;
      return load(begin, ...lists);
    }
  }

  return {
    start,
    queue,
    read,
    readNow,
    /** 讀不到的路徑（unread()）。 */
    unread: unread as ReadonlySet<string>,
    bump,
    /** 第一次載入完成之前收到過通知：照檔案變動處理一次。 */
    catchUp(): void { if (noticed) schedule(); },
    /** 有已知還沒讀完的變動：一批讀取正在進行，或 pending 裡有不在 unread 的路徑（except 那一篇除外）。 */
    waiting: (except?: string): boolean => reading > 0 || [...pending].some(path => path !== except && !unread.has(path)),
    /** 這篇的 Cards I/O 開始（§2 第 1 點）：不開始讀，序號前進。 */
    hold(path: string): void {
      busy.add(path);
      bump(path);
    },
    /** 這篇的 I/O 結束：序號前進。 */
    unhold(path: string): void {
      busy.delete(path);
      bump(path);
    },
    /** 把這幾篇放進 pending、立刻讀（不等 delay）。 */
    reread(...paths: string[]): void {
      for (const path of paths) pending.add(path);
      void readNow();
    },
    /** 關閉：清掉排好的讀取、叫醒列不出來時的等待、停止監看。 */
    stop(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const stuck of stuckTimers) clearTimeout(stuck);
      stuckTimers.clear();
      wake?.();
      unwatch?.();
      unwatch = null;
    },
    /** 讀取的那一列；close() 等它。 */
    idle: (): Promise<void> => processing,
  };
}
