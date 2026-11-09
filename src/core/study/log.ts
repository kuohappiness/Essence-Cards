import type { Files } from '../files.ts';
import { encodeNew } from './entries.ts';
import { formatTime } from './time.ts';
import type { LogWriter, NewEntry, QueuedLine } from './types.ts';

export const LOG_FOLDER = 'Essence Cards/紀錄';

export function logPath(device: string, ms: number, offset: number): string {
  return `${LOG_FOLDER}/${formatTime(ms, offset).slice(0, 7)} ${device}.jsonl`;
}

export function createLogWriter(files: Files, options: {
  device: string;
  now?: () => number;
  offset?: (ms: number) => number;
  onError?: (error: unknown) => void;
  /** 這個 t 字串已經有紀錄用來認人（作答、變更、被取消的）：undo 用 t 認人，新的一行要避開（tasks/record-gaps.md §4）。 */
  taken?: (t: string) => boolean;
  /** 這個檔已知的內容最後沒有換行：新行先補一個換行，舊版（0.3.0）遇到黏在一起的兩筆只救得回最後一段（L2 的 R1）。 */
  unterminated?: (path: string) => boolean;
}): LogWriter {
  const now = options.now ?? Date.now;
  const offsetOf = options.offset ?? (ms => -new Date(ms).getTimezoneOffset());
  const pending: { path: string; line: string }[] = [];
  let last = -Infinity;
  let running: Promise<void> | null = null;
  let writeVersion = 0;
  let failedVersion = 0;

  async function drain(): Promise<void> {
    while (pending.length) {
      const job = pending[0];
      const version = writeVersion;
      try { await files.append(job.path, job.line); }
      catch (error) {
        failedVersion = version;
        // 通知回呼失敗也不能讓背景 Promise 無人接手，或丟失原始的寫檔錯誤。
        try { options.onError?.(error); } catch { /* 保留原始錯誤給 flush。 */ }
        throw error;
      }
      pending.shift();
    }
  }

  function start(): Promise<void> {
    if (!running) {
      running = Promise.resolve().then(drain).then(() => {
        running = null;
        // drain 已回傳、這個收尾尚未執行時，也可能收到新的 write。
        if (pending.length) return start();
      }, (error: unknown) => {
        running = null;
        // 每輪 append 記住當時的 write 版本，失敗前後的新 write 只觸發下一輪。
        if (writeVersion !== failedVersion) return start();
        throw error;
      });
      // write 同步回傳；失敗留在佇列，由下一次 write / flush 重試。
      void running.catch(() => {});
    }
    return running;
  }

  return {
    write(entry: NewEntry, near?: number): QueuedLine {
      let at = near ?? Math.max(Math.trunc(now()), last + 1);
      let offset = offsetOf(at);
      let t = formatTime(at, offset);
      // 只避開完全相同的時間，不用舊紀錄的最大時間當下限：曾經把時鐘調到未來的裝置，之後每一行都會被推到未來（§4）。
      while (options.taken?.(t)) {
        at++;
        offset = offsetOf(at);
        t = formatTime(at, offset);
      }
      const line = encodeNew(t, entry);
      const path = logPath(options.device, at, offset);
      last = Math.max(last, at);
      pending.push({ path, line: options.unterminated?.(path) ? '\n' + line : line });
      writeVersion++;
      // 失敗已經交給 onError（呼叫端記下），那一行留在佇列，下一次 write／flush 重試。
      void start().catch(() => {});
      return { t, line, path };
    },
    async flush(): Promise<void> {
      if (running) {
        try { await running; } catch { /* 這次 flush 重試先前的背景失敗。 */ }
      }
      if (pending.length) await start();
    },
  };
}
