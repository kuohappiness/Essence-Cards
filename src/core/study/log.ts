import type { Files } from '../files.ts';
import { encodeEntry } from './entries.ts';
import { formatTime } from './time.ts';
import type { LogWriter, NewEntry } from './types.ts';

export const LOG_FOLDER = 'Essence Cards/紀錄';

export function logPath(device: string, ms: number, offset: number): string {
  return `${LOG_FOLDER}/${formatTime(ms, offset).slice(0, 7)} ${device}.jsonl`;
}

export function createLogWriter(files: Files, options: {
  device: string;
  now?: () => number;
  offset?: (ms: number) => number;
  onError?: (error: unknown) => void;
}): LogWriter {
  const now = options.now ?? Date.now;
  const offsetOf = options.offset ?? (ms => -new Date(ms).getTimezoneOffset());
  const pending: { path: string; line: string }[] = [];
  let last = -Infinity;
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (pending.length) {
      const job = pending[0];
      try { await files.append(job.path, job.line); }
      catch (error) {
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
      }, (error: unknown) => { running = null; throw error; });
      // write 同步回傳；失敗留在佇列，由下一次 write / flush 重試。
      void running.catch(() => {});
    }
    return running;
  }

  return {
    write(entry: NewEntry): string {
      const at = Math.max(Math.trunc(now()), last + 1);
      const offset = offsetOf(at);
      const t = formatTime(at, offset);
      const line = encodeEntry(t, entry);
      const path = logPath(options.device, at, offset);
      last = at;
      pending.push({ path, line });
      void start().catch(() => {});
      return t;
    },
    async flush(): Promise<void> {
      if (running) {
        try { await running; } catch { /* 這次 flush 重試先前的背景失敗。 */ }
      }
      if (pending.length) await start();
    },
  };
}
