import type { Files } from '../files.ts';
import { formatTime } from '../study/index.ts';

/**
 * 正式版的錯誤紀錄（D-155、D-160、syntax.md §9）：這個外掛自己的錯誤與學生在複習畫面的回報，每台裝置每月一個檔。
 * 盡力而為：記錄器永遠不拋錯、不回傳 Promise；寫不進去就丟掉那一行，不重試、不上報，也不讓作答的寫入等它。
 */

export const ERROR_FOLDER = 'Essence Cards/紀錄/錯誤';

/** 哪個環節（syntax.md §9 的 `where`）；`report`、`limit` 由記錄器自己寫。 */
type ErrorWhere = 'read' | 'write' | 'listener' | 'init' | 'render' | 'ui' | 'fill' | 'close' | 'event' | 'uncaught';
/** 學生選的那一項（D-160 第 1 點）：內容有錯、顯示不完整或空白、沒反應或卡住、聲音、其他。 */
type ReportKind = 'content' | 'display' | 'stuck' | 'audio' | 'other';
/** 學生回報的那張卡：卡組、學習目標 ID 與題目指紋（D-160 第 2 點）。 */
interface Report { kind: ReportKind; path: string; lt: string; v: string }

export interface ErrorLog {
  record(where: ErrorWhere, error: unknown, context?: { path?: string }): void;
  report(report: Report): void;
}

export interface ErrorLogOptions {
  files: Files;
  /** 這台的裝置碼，和複習紀錄相同（例如 'iPhone-7f3a'）。 */
  device: string;
  /** 建置版本 `BUILD` 原樣。 */
  build: string;
  /** Obsidian 的版本（`apiVersion`）。 */
  obsidian: string;
  now?: () => number;
  offset?: (ms: number) => number;
  /** 第一次讀寫之前先等它：Obsidian 在 layout ready 之前 vault 的索引還不完整，數不到當月的行數。 */
  after?: Promise<unknown>;
}

/** 一行最多幾 bytes（UTF-8，含 JSON 的跳脫）。 */
const MAX_BYTES = 2000;
/** 每個月最多幾行，含最後一行 `limit`。 */
const MONTH_LINES = 300;
/** 去重表最多幾個鍵；之後的新鍵照第 1 次寫（月上限仍擋著）。 */
const MAX_KEYS = 500;
/** 等待中的寫入（等數行數或 append）最多幾筆，超過丟掉新的。 */
const MAX_PENDING = 50;
/** 這個外掛自己的程式位置：`plugin:essence-cards:行:欄`；`plugin:essence-cards-x:` 這種別的外掛不算。 */
const OWN_FRAME = /plugin:essence-cards:\d+:\d+/;
const UNKNOWN = '（無法轉成文字）';

export function errorLogPath(ms: number, offset: number, device: string): string {
  return `${ERROR_FOLDER}/${formatTime(ms, offset).slice(0, 7)} ${device} 錯誤.jsonl`;
}

/** `紀錄/錯誤/` 裡的檔（含 iCloud 的衝突副本）：整個資料夾都是外掛自己寫、給維修用的。 */
export function isErrorLogPath(path: string): boolean {
  return path.startsWith(ERROR_FOLDER + '/');
}

/** 呼叫看看；拋錯就是 undefined（getter、toString、Proxy 都可能拋）。 */
function attempt<T>(get: () => T): T | undefined {
  try { return get(); } catch { return undefined; }
}

/** 錯誤轉文字：Error 用 message；字串原樣；其他值盡量轉成看得懂的文字。不拋錯。 */
function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object' && typeof value !== 'function') return attempt(() => String(value as number)) ?? UNKNOWN;
  const message = attempt(() => (value as { message?: unknown }).message);
  if (typeof message === 'string' && message) return message;
  const json = attempt(() => JSON.stringify(value));
  if (typeof json === 'string' && json !== '{}') return json;
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- 物件沒有可讀的 message 與 JSON 時，toString 是剩下的線索。
  return attempt(() => String(value)) ?? attempt(() => Object.prototype.toString.call(value)) ?? UNKNOWN;
}

/** stack 裡這個外掛自己的那幾層（去掉前後空白）；沒有 stack 或讀不到時是空的。不拋錯。 */
function ownFrames(error: unknown): string[] {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return [];
  const stack = attempt(() => (error as { stack?: unknown }).stack);
  if (typeof stack !== 'string') return [];
  return stack.split('\n').map(line => line.trim()).filter(line => OWN_FRAME.test(line));
}

/** window 的 error 與 unhandledrejection 只收這個（D-155 第 2 點的補網）：stack 裡有這個外掛自己的程式位置。 */
export function hasOwnFrame(error: unknown): boolean {
  return ownFrames(error).length > 0;
}

interface Line {
  t: string; build: string; obsidian: string; where: ErrorWhere | 'report' | 'limit';
  kind?: ReportKind; msg?: string; path?: string; lt?: string; v?: string; stack?: string; n?: number;
}
type Body = Omit<Line, 't' | 'build' | 'obsidian'>;

const encoder = new TextEncoder();
const fits = (line: Line): boolean => encoder.encode(JSON.stringify(line)).length <= MAX_BYTES;

/**
 * 一行 JSON，欄位照 syntax.md §9 的表排；超過 MAX_BYTES 時依序截短 stack、path、msg（照字截，中文字不會切成半個，
 * 截過的結尾加「…」），截到放得下。三個都截完還放不下時是 null。
 */
function encode(line: Line): string | null {
  const ordered: Line = { t: line.t, build: line.build, obsidian: line.obsidian, where: line.where, kind: line.kind, msg: line.msg, path: line.path, lt: line.lt, v: line.v, stack: line.stack, n: line.n };
  for (const key of ['stack', 'path', 'msg'] as const) {
    if (fits(ordered)) break;
    const value = ordered[key];
    if (value === undefined) continue;
    const chars = Array.from(value);
    const cut = (k: number): string => chars.slice(0, k).join('') + '…';
    // 找放得下的最長前綴；連一個字都放不下，stack 與 path 整欄拿掉、msg 只留「…」，換下一欄。
    let lo = 0, hi = chars.length - 1;
    if (!fits({ ...ordered, [key]: cut(0) })) { ordered[key] = key === 'msg' ? cut(0) : undefined; continue; }
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits({ ...ordered, [key]: cut(mid) })) lo = mid; else hi = mid - 1;
    }
    ordered[key] = cut(lo);
  }
  return fits(ordered) ? JSON.stringify(ordered) : null;
}

/** 第 1、10、100、1,000……次才寫。 */
function sampled(n: number): boolean {
  if (n === 1) return true;
  for (let power = 10; power <= n; power *= 10) if (power === n) return true;
  return false;
}

/** 已經寫了幾行：數不是空白的行；有 `limit` 那一行就是滿了（這個月不再寫）。 */
function counted(text: string | null): number {
  const written = (text ?? '').split('\n').filter(line => line.trim() !== '');
  return written.some(line => line.includes('"where":"limit"')) ? MONTH_LINES : written.length;
}

export function createErrorLog(options: ErrorLogOptions): ErrorLog {
  const { files, device, build, obsidian } = options;
  const now = options.now ?? Date.now;
  const offsetOf = options.offset ?? (ms => -new Date(ms).getTimezoneOffset());
  const after = options.after ?? Promise.resolve();
  /** 這次載入每個去重鍵的累計次數（syntax.md §9 的 `n`）。 */
  const counts = new Map<string, number>();
  /** 每個月的檔已經用了幾行；這次載入只讀一次、共用結果。讀不到是 null：這次載入不寫那個月。 */
  const months = new Map<string, Promise<{ used: number } | null>>();
  let pending = 0;

  /** 這個鍵這一次要寫的 n（1 是第 1 次，不帶 n）；不用寫是 null。 */
  function sample(key: string): number | null {
    const known = counts.get(key);
    if (known === undefined && counts.size >= MAX_KEYS) return 1;
    const n = (known ?? 0) + 1;
    counts.set(key, n);
    return sampled(n) ? n : null;
  }

  function month(path: string): Promise<{ used: number } | null> {
    let quota = months.get(path);
    if (!quota) {
      quota = after.then(() => files.read(path)).then(text => ({ used: counted(text) }), () => null);
      months.set(path, quota);
    }
    return quota;
  }

  /** 排一行：先等當月的行數，預留名額，再 append。第 300 行固定是 limit。 */
  function write(key: string, body: Body): void {
    const n = sample(key);
    if (n === null || pending >= MAX_PENDING) return;
    const at = Math.trunc(now());
    const offset = offsetOf(at);
    const head = { t: formatTime(at, offset), build, obsidian };
    const path = errorLogPath(at, offset, device);
    pending++;
    void month(path).then(quota => {
      if (!quota || quota.used >= MONTH_LINES) return;
      const text = quota.used === MONTH_LINES - 1 ? encode({ ...head, where: 'limit' }) : encode({ ...head, ...body, n: n > 1 ? n : undefined });
      if (text === null) return;
      quota.used++;
      return files.append(path, text);
    }).catch(() => {
      // 寫不進去就丟掉這一行（D-155 第 4 點）：不重試、不上報、不 console.error，所以不會遞迴。
    }).finally(() => { pending--; });
  }

  return {
    record(where, error, context) {
      try {
        const msg = describe(error);
        const frames = ownFrames(error);
        const path = context?.path;
        write(JSON.stringify([where, path ?? null, frames[0] ?? msg]), { where, msg, path, stack: frames.length ? frames.join('\n') : undefined });
      } catch {
        // 記錄器永遠不拋錯（D-155 第 4 點）：例如時區不合法時 formatTime 拋錯，這一行就不記。
      }
    },
    report({ kind, path, lt, v }) {
      try {
        write(JSON.stringify(['report', lt, v, kind]), { where: 'report', kind, path, lt, v });
      } catch {
        // 同 record：回報記不下來也不影響複習畫面。
      }
    },
  };
}
