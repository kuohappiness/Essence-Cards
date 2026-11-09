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
  /** 外掛停用：還沒開始的讀寫不做，存檔回 failed，也不再通知。 */
  close(): void;
  /** 值或存過的項目變了（包括 known 由 false 變 true）。 */
  onChange(listener: (value: SettingsValue) => void): () => void;
}

const FIRST_WAIT = 2000;
const READ_WAIT = 5000;
const WRITE_WAIT = 10_000;

type Read = { ok: true; raw: Record<string, unknown> } | { ok: false };

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  let raw: Record<string, unknown> = {};
  let saved: Saved = readSaved(raw);
  let known = false, seenFile = false, started = false, closed = false;
  /** 開始過幾次存檔：逾時後才回來的第一次讀，只有這段期間沒人存過才能採用。 */
  let writes = 0;
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
    // 外掛自己不會刪這個檔：這次讀到過，現在卻說沒有，當成讀不到（例如 iPhone 的佔位檔），不覆寫（§2-2）。
    if (content === null) return seenFile ? { ok: false } : { ok: true, raw: {} };
    if (typeof content !== 'object' || Array.isArray(content)) return { ok: false };
    seenFile = true;
    return { ok: true, raw: content as Record<string, unknown> };
  }
  /** 讀一次；逾時後才回來的結果原則上不採用，可能比之後的存檔舊。 */
  async function read(): Promise<Read> {
    const writesAtStart = writes;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => { resolve('timeout'); }, READ_WAIT); });
    // load 拒絕和讀到 undefined 一樣當成讀不到：呼叫端回報 unreadable，不是程式的錯。
    const loading = options.load().catch(() => undefined);
    const content = await Promise.race([loading, timeout]);
    clearTimeout(timer);
    if (content !== 'timeout') return classify(content);
    // 一次都還沒讀到、這段期間也沒人存過：晚到的結果沒有東西會被它蓋掉，採用，否則這次開啟可能一直用預設值（§2-5）。
    void loading.then(late => {
      const result = classify(late);
      if (result.ok && !known && !closed && writes === writesAtStart) adopt(result);
    });
    return { ok: false };
  }
  function adopt(result: Extract<Read, { ok: true }>): void {
    raw = result.raw;
    saved = readSaved(raw);
    known = true;
    const now = fingerprint();
    if (now === notified) return;
    notified = now;
    const current = value();
    for (const listener of [...listeners]) {
      try { listener(current); } catch (error) { options.onError?.(error); }
    }
  }
  const reread = (): Promise<void> => queued(async () => {
    if (closed) return;
    const result = await read();
    if (result.ok && !closed) adopt(result);
  });

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
          writes++;
          const base = await read();
          if (closed) { report('failed'); return; }
          if (!base.ok) { report('unreadable'); return; }
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
          const back = await read();
          if (!back.ok) { report('failed'); return; }
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
