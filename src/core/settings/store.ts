import { changeSaved, hasChange, readSaved, savedKeys, semesterOn, valueOf } from './saved.ts';
import type { Saved, SettingsChange, SettingsKey, SettingsValue } from './saved.ts';

// 讀與存的順序（tasks/settings-page.md §2）。load、save 由外層傳入：Obsidian 的 loadData 讀不到時吞掉錯誤、回 undefined，saveData 寫不進去也照常完成。

export type SaveResult = 'saved' | 'unreadable' | 'failed';
export interface SettingsStoreOptions {
  /** 沒有檔回 null，讀不到回 undefined。 */
  load: () => Promise<unknown>;
  save: (data: unknown) => Promise<void>;
  /** 今天（`YYYY-MM-DD`，清晨 4 點換日）。 */
  today: () => string;
  /** onChange 的監聽者丟出錯誤（程式的錯）：不能讓隊伍卡住，交給外層記下。 */
  onError?: (error: unknown) => void;
}
export interface SettingsStore {
  /** layout ready 之後呼叫一次。一定會完成：2 秒內沒讀到時交出 known 是 false 的預設值，之後讀到再經過 onChange。 */
  first(): Promise<SettingsValue>;
  value(): SettingsValue;
  /** 今天的學期；沒設定是 null。 */
  semester(): string | null;
  /** 存過的項目（讀不懂的值也算）：有存過才能恢復預設。 */
  saved(): SettingsKey[];
  /** 重讀 data.json；讀不到維持手上的值。first() 之前什麼都不做。 */
  reload(): Promise<void>;
  /** first() 之前不讀不寫，回 unreadable。 */
  change(change: SettingsChange): Promise<SaveResult>;
  /** 外掛停用：還沒開始的讀寫不做，已經送出的寫入做完但不核對；存檔都回 failed，也不再通知。 */
  close(): void;
  /** 值或存過的項目變了（包括 known 由 false 變 true）。 */
  onChange(listener: (value: SettingsValue) => void): () => void;
}

const FIRST_WAIT = 2000;
const READ_WAIT = 5000;
const WRITE_WAIT = 10_000;

/** absent：這次的底稿是「沒有檔」，不是讀到的內容。 */
type Found = { ok: true; raw: Record<string, unknown>; absent: boolean };
type Read = Found | { ok: false };

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  let raw: Record<string, unknown> = {};
  let saved: Saved = readSaved(raw);
  let known = false, seenFile = false, started = false, closed = false;
  /** 已經開始、還沒回來的讀，包括逾時後還在路上的。 */
  let reading = 0;
  let retryQueued = false;
  const listeners = new Set<(value: SettingsValue) => void>();
  /** 存檔與重讀一次一件：較早開始的讀不會蓋掉較新的結果，舊的寫入不會晚到蓋掉新的（§2-1）。 */
  let tail: Promise<unknown> = Promise.resolve();
  function queued<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work);
    // 工作自己把錯誤變成結果，這裡只是不讓隊伍斷掉。
    tail = run.catch(() => {});
    return run;
  }
  const value = (): SettingsValue => valueOf(saved, known);
  const semesterNow = (): string | null => saved.semester ? semesterOn(saved.semester, options.today()) : null;
  /** 算進今天的學期：內容沒變、但過了 2/1 或 8/1，開著的設定頁也要換（§5）。 */
  const fingerprint = (): string => JSON.stringify([saved, savedKeys(raw), known, semesterNow()]);
  let notified = fingerprint();

  /** load 交回的內容怎麼算。只要是物件就記下「這次見過檔」，不管這次有沒有採用（寫前的讀也算，§2-2）。 */
  function classify(content: unknown): Read {
    if (content === undefined) return { ok: false };
    if (content === null) return { ok: true, raw: {}, absent: true };
    if (typeof content !== 'object' || Array.isArray(content)) return { ok: false };
    seenFile = true;
    return { ok: true, raw: content as Record<string, unknown>, absent: false };
  }
  /**
   * 「沒有檔」要用的時候才判斷，而且要所有的讀都回來、從沒見過檔才算數（§2-2）。
   * 回來的先後不代表新舊：還在路上的讀可能正要帶回內容（iPhone 的佔位檔會回報成不存在），外掛自己也不會刪這個檔。
   */
  const usable = (result: Read): result is Found => result.ok && !(result.absent && (seenFile || reading > 0));
  /** 讀一次。補讀（followUp）逾時後不再排下一次，檔案一直很慢時不會不停重試。 */
  async function read(followUp = false): Promise<Read> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => { resolve('timeout'); }, READ_WAIT); });
    // load 拒絕和讀到 undefined 一樣當成讀不到：呼叫端回報 unreadable，不是程式的錯。
    reading++;
    // 少算一筆和見過檔要在同一步：中間不能讓別的工作看到「都回來了、卻還沒見過檔」。
    const loading = new Promise<unknown>(resolve => { resolve(options.load()); }).catch(() => undefined).then(content => { reading--; return classify(content); });
    const result = await Promise.race([loading, timeout]);
    clearTimeout(timer);
    if (result !== 'timeout') return result;
    // 晚到的內容可能比之後的存檔舊，不採用，只記下有沒有見過檔。一次都還沒讀到時，它回來表示現在讀得到了：
    // 排一次重讀，走同一條隊伍拿最新的內容，否則這次開啟可能一直用預設值（§2-5）。
    void loading.then(late => { if (!followUp && late.ok && !known) retry(); });
    return { ok: false };
  }
  /** 手上的值或今天的學期變了才通知；讀不到時也要看，學期是用手上的值算的（§5）。 */
  function announce(): void {
    if (closed) return;
    const now = fingerprint();
    if (now === notified) return;
    notified = now;
    const current = value();
    for (const listener of [...listeners]) {
      try { listener(current); } catch (error) { options.onError?.(error); }
    }
  }
  function adopt(result: Found): void {
    if (closed) return;
    raw = result.raw;
    saved = readSaved(raw);
    known = true;
    announce();
  }
  async function refresh(followUp = false): Promise<void> {
    const result = await read(followUp);
    if (usable(result)) adopt(result); else announce();
  }
  const reread = (): Promise<void> => queued(async () => { if (!closed) await refresh(); });
  /** 排隊中的補讀只留一筆；輪到時已經知道就直接放行，不卡在後面的存檔前面（§2-5）。 */
  function retry(): void {
    if (retryQueued) return;
    retryQueued = true;
    void queued(async () => {
      retryQueued = false;
      if (!known && !closed) await refresh(true);
    });
  }

  return {
    value,
    semester: semesterNow,
    saved: () => savedKeys(raw),
    close() { closed = true; },
    async first() {
      started = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = new Promise<void>(resolve => { timer = setTimeout(resolve, FIRST_WAIT); });
      await Promise.race([reread(), wait]);
      clearTimeout(timer);
      return value();
    },
    reload: () => started ? reread() : Promise.resolve(),
    change(change) {
      // layout ready 之前不碰 data.json（T12）：設定頁在那之前就註冊好了，所有存檔都從這裡擋。
      if (!started) return Promise.resolve('unreadable');
      return new Promise<SaveResult>(report => {
        // 工作結束才放行隊伍：寫入逾時時畫面先知道失敗，下一筆仍等這一筆真的結束（§2-1）。
        void queued(async () => {
          // 外掛停用之後，還沒開始的不再讀寫；已經交給 saveData 的讓它做完。
          if (closed) { report('failed'); return; }
          const base = await read();
          if (closed) { report('failed'); return; }
          if (!usable(base)) { report('unreadable'); return; }
          const timer = setTimeout(() => { report('failed'); }, WRITE_WAIT);
          try {
            await options.save(changeSaved(base.raw, change));
          } catch {
            // 寫不進去：回報給呼叫端，由它提示與記錄。
            clearTimeout(timer);
            report('failed');
            return;
          }
          clearTimeout(timer);
          // 停用時已經送出的寫入到此為止：舊的實例不再讀、不再通知。
          if (closed) { report('failed'); return; }
          const back = await read();
          // 寫進去了檔就該在，核對卻說沒有：這筆沒有落地。停用之後也不下結論。
          if (closed || !back.ok || back.absent) { report('failed'); return; }
          adopt(back);
          report(hasChange(back.raw, change) ? 'saved' : 'failed');
        });
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
