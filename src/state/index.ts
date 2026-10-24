import type { Files } from '../core/files.ts';
import { isDeckPath, parseDeck, readDecks } from '../core/deck/index.ts';
import type { Deck } from '../core/deck/index.ts';
import { appendLine, createLogWriter, dayOf, encodeEntry, isLogPath, LOG_FOLDER, logPath, mergeHistory, nextCard, parseLine, planToday, progress } from '../core/study/index.ts';
import type { DeckEntry, History, NewEntry, Next, Pick, Progress, Settings, Today, TodayInput } from '../core/study/index.ts';

export interface StateOptions {
  files: Files;
  /** 例如 'iPhone-7f3a'；紀錄的檔名用它。 */
  device: string;
  now?: () => number;
  offset?: (ms: number) => number;
  /** 預設 { capMinutes: 30, retention: 0.8, filter: [] }（D-104、D-078）。 */
  settings?: Settings;
  /** 收到檔案變動後等多久才處理（毫秒），預設 500。 */
  delay?: number;
  /**
   * write：紀錄寫不進去（下一次作答或 flush 時重試）；read：卡組或紀錄讀不到（自己隔一段時間重試）；
   * listener：onChange 的監聽者丟出錯誤（程式的錯，不重試）。
   */
  onError?: (error: unknown, source: ErrorSource) => void;
}
export type ErrorSource = 'write' | 'read' | 'listener';
/** 毫秒。 */
export interface LoadTimings { decks: number; history: number; plan: number; total: number }

export interface State {
  /**
   * 第一次讀完卡組與紀錄、排好今天；之後每次呼叫回傳同一個 Promise。
   * 讀不到時自己重試（1 秒起、每次加倍、最多 60 秒），每次失敗交給 onError；只有 close() 會讓它 reject。
   */
  ready(): Promise<LoadTimings>;
  decks(): readonly DeckEntry[];
  history(): History;
  /** 目前的輸入：decks、history、settings、exam: null、呼叫當下的 now 與 offset。 */
  input(): TodayInput;
  /** 今天的份；過了清晨 4 點或 offset 變了，先重排。 */
  today(): Today;
  /** nextCard；不會回傳 'stale'。 */
  next(pick: Pick): Next;
  progress(): Progress;
  /** 寫一行紀錄（背景）、併進 history，回傳 t；不重排。 */
  answer(entry: NewEntry): string;
  /** 今天的份因為卡組或別台裝置的紀錄重排之後呼叫。 */
  onChange(listener: () => void): () => void;
  /** 等目前排隊的紀錄寫完。 */
  flush(): Promise<void>;
  /** 停止監看、等紀錄寫完。 */
  close(): Promise<void>;
}

const DEFAULT_SETTINGS: Settings = { capMinutes: 30, retention: 0.8, filter: [] };
const EMPTY_HISTORY: History = { reviews: [], changes: [], problems: [], cancelled: [] };
const byPath = (a: DeckEntry, b: DeckEntry): number => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function createState(options: StateOptions): State {
  const { files, device } = options;
  const now = options.now ?? Date.now;
  const offsetOf = options.offset ?? (ms => -new Date(ms).getTimezoneOffset());
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const delay = options.delay ?? 500;
  const report = (error: unknown, source: ErrorSource): void => {
    try { options.onError?.(error, source); } catch { /* 回呼的錯誤不影響狀態。 */ }
  };
  const writer = createLogWriter(files, { device, now, offset: offsetOf, onError: error => { report(error, 'write'); } });
  // 自己的紀錄：`YYYY-MM <device>.jsonl`；衝突副本（例如 `… 2.jsonl`）算別台裝置的。
  const ownName = new RegExp('^\\d{4}-\\d{2} ' + device.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.jsonl$');
  const own = (path: string): boolean => path.startsWith(LOG_FOLDER + '/') && ownName.test(path.slice(LOG_FOLDER.length + 1));

  const deckMap = new Map<string, Deck>();
  let deckList: DeckEntry[] = [];
  const sources = new Map<string, string>();
  let history: History = EMPTY_HISTORY;
  let current: Today | null = null;
  let loading: Promise<LoadTimings> | null = null;
  let loaded = false;
  let closed = false;
  const listeners = new Set<() => void>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let processing: Promise<void> = Promise.resolve();
  let unwatch: (() => void) | null = null;
  // 連續讀不到的次數；決定下一次重試要等多久（Codex 審查 W5 的 F3：不能只等下一次通知）。
  let failures = 0;
  const retryDelay = (): number => Math.min(60_000, 1000 * 2 ** Math.max(0, failures - 1));
  /** ready() 重試前的等待；close() 會提早叫醒它。 */
  let wake: (() => void) | null = null;
  function pause(ms: number): Promise<void> {
    return new Promise(resolve => {
      const id = setTimeout(done, ms);
      function done(): void { clearTimeout(id); wake = null; resolve(); }
      wake = done;
    });
  }

  function input(): TodayInput {
    if (!loaded) throw Error('state 還沒 ready');
    const at = now();
    return { decks: deckList, history, settings, exam: null, now: at, offset: offsetOf(at) };
  }
  /** 換日或換時區就重排（W4 的 F3：日編號相同、時區不同也要重排）。 */
  function fresh(): { today: Today; input: TodayInput } {
    const value = input();
    if (!current || current.offset !== value.offset || current.day !== dayOf(value.now, value.offset)) current = planToday(value);
    return { today: current, input: value };
  }

  function notify(path: string): void {
    if (closed) return;
    if (!isDeckPath(path) && !(isLogPath(path) && !own(path))) return;
    pending.add(path);
    // 讀完之前收到的，讀完後一起處理。
    if (loaded) schedule();
  }
  function schedule(wait = delay): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      processing = processing.then(apply).catch((error: unknown) => { report(error, 'read'); });
    }, wait);
  }
  async function apply(): Promise<void> {
    if (closed || !pending.size) return;
    const paths = [...pending];
    pending.clear();
    const results = await Promise.allSettled(paths.map(path => files.read(path)));
    if (closed) return;
    let decksChanged = false, logsChanged = false;
    let failure: { error: unknown } | null = null;
    for (const [i, path] of paths.entries()) {
      const result = results[i];
      if (result.status === 'rejected') {
        // 讀不到的留著等重試；讀得到的照常處理，不被它擋住。
        pending.add(path);
        failure ??= { error: result.reason };
        continue;
      }
      const text = result.value;
      if (isDeckPath(path)) {
        const before = deckMap.get(path);
        if (text === null) {
          if (deckMap.delete(path)) decksChanged = true;
          continue;
        }
        const deck = parseDeck(text);
        // 通知了但解析結果相同（例如內容沒變）就不重排。
        if (before && JSON.stringify(before) === JSON.stringify(deck)) continue;
        deckMap.set(path, deck);
        decksChanged = true;
      } else {
        const before = sources.get(path);
        if (text === null) {
          if (sources.delete(path)) logsChanged = true;
        } else if (before !== text) {
          sources.set(path, text);
          logsChanged = true;
        }
      }
    }
    if (failure) {
      failures++;
      report(failure.error, 'read');
      // 等待中已經有新的通知排好時，就跟著那一次重讀。
      if (timer === null) schedule(retryDelay());
    } else failures = 0;
    if (!decksChanged && !logsChanged) return;
    if (decksChanged) deckList = [...deckMap].map(([path, deck]) => ({ path, deck })).sort(byPath);
    // 別台裝置的紀錄一律整份重新 merge，不直接追加（Codex 審查 W4 第 10 點）。
    if (logsChanged) history = mergeHistory([...sources].map(([path, text]) => ({ path, text })));
    current = planToday(input());
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { report(error, 'listener'); }
    }
  }

  /** 讀不到就整個重讀：先監看，失敗時等一段時間再試，close() 之後才放棄。 */
  async function start(): Promise<LoadTimings> {
    // 先監看再讀：讀的期間改到的檔不會漏掉。
    if (!closed) unwatch = files.watch(notify);
    for (;;) {
      try {
        const timings = await load();
        failures = 0;
        return timings;
      } catch (error) {
        if (closed) throw error;
        failures++;
        report(error, 'read');
        await pause(retryDelay());
        if (closed) throw Error('state 已關閉，沒有讀完');
      }
    }
  }

  async function load(): Promise<LoadTimings> {
    const start = performance.now();
    deckMap.clear();
    sources.clear();
    const entries = await readDecks(files);
    for (const { path, deck } of entries) deckMap.set(path, deck);
    deckList = entries.map(({ path, deck }) => ({ path, deck })).sort(byPath);
    const afterDecks = performance.now();
    const paths = (await files.list(LOG_FOLDER)).filter(isLogPath);
    const texts = await Promise.all(paths.map(path => files.read(path)));
    paths.forEach((path, i) => { const text = texts[i]; if (text !== null) sources.set(path, text); });
    history = mergeHistory([...sources].map(([path, text]) => ({ path, text })));
    const afterHistory = performance.now();
    loaded = true;
    current = planToday(input());
    const end = performance.now();
    if (pending.size && !closed) schedule();
    return { decks: afterDecks - start, history: afterHistory - afterDecks, plan: end - afterHistory, total: end - start };
  }

  return {
    ready() {
      loading ??= start();
      return loading;
    },
    decks: () => deckList,
    history: () => history,
    input,
    today: () => fresh().today,
    next(pick) {
      const { today, input: value } = fresh();
      const next = nextCard(today, value, pick);
      if (next.kind !== 'stale') return next;
      current = planToday(value);
      return nextCard(current, value, pick);
    },
    progress() {
      const { today, input: value } = fresh();
      return progress(today, value);
    },
    answer(entry) {
      if (!loaded) throw Error('state 還沒 ready');
      const t = writer.write(entry);
      const line = encodeEntry(t, entry);
      const stamp = parseLine(line);
      if (!stamp) throw Error('寫出的紀錄無法解析：' + line);
      // 和 writer 寫檔的路徑相同：t 已經帶著寫入當下的時間與時區。
      const path = logPath(device, stamp.at, stamp.offset);
      sources.set(path, (sources.get(path) ?? '') + line + '\n');
      history = appendLine(history, line);
      return t;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    flush: () => writer.flush(),
    async close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      wake?.();
      unwatch?.();
      unwatch = null;
      await processing;
      await writer.flush();
    },
  };
}
