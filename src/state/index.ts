import type { Files } from '../core/files.ts';
import { isDeckPath, parseDeck } from '../core/deck/index.ts';
import type { Deck } from '../core/deck/index.ts';
import { createIdTracker } from './ids.ts';
import type { IdIssue } from './ids.ts';
export type { IdIssue } from './ids.ts';
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
  /** 補學習目標 ID：電腦 true、手機 false（D-134：iPhone 不寫卡組筆記）。 */
  fillIds: boolean;
  /** 傳給 assignIds，測試用。 */
  random?: () => number;
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
  /** 這一篇有幾個目標還沒有 ID（不含待處理的），以及待處理的問題。按鈕用。 */
  deckStatus(path: string): { missing: number; issues: IdIssue[] };
  /** 存檔（開著的筆記）：回傳補 ID、歸位之後的文字；沒有要改、手機、不是卡組時回傳原文。 */
  fillText(path: string, text: string): string;
  /** 離開筆記時（沒開著的檔）：讀檔、照 fillText 寫回；不存在時不建立。有改字回傳 true。 */
  fillIds(path: string): Promise<boolean>;
  /** 家長選了之後：回傳寫回後的文字；證據不再成立時回傳 null，問題保留。 */
  resolveText(issue: IdIssue, choice: 'restore' | 'new', text: string): string | null;
  /** 這台電腦的編輯器裡刪掉或剪下了整個目標：這些 ID 是刻意拿掉的，重讀時不算弄丟。 */
  removedInEditor(path: string, ids: readonly string[]): void;
}

const DECK_ROOT = 'Essence Cards';
/** 紀錄行裡的 lt（作答、變更都算），取消不影響：配新 ID 時避開（W5 §8-5、I3）。 */
function ltsOf(text: string): Set<string> {
  const ids = new Set<string>();
  for (const match of text.matchAll(/"lt":"((?:[^"\\]|\\.)*)"/g)) {
    try { ids.add(JSON.parse('"' + match[1] + '"') as string); } catch { /* 壞掉的行不算 */ }
  }
  return ids;
}
/** fillIds 讀到空字串（不存在或空檔）時中止 modify，不建立檔案。 */
class NothingToFill extends Error {}

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

  // 原始紀錄每一行的 lt：只在配新 ID 或判斷「沒見過的 ID」時才算，照來源的文字快取。
  const ltCache = new Map<string, { text: string; ids: Set<string> }>();
  function logIds(): Set<string> {
    const all = new Set<string>();
    for (const [path, text] of sources) {
      let cached = ltCache.get(path);
      if (cached?.text !== text) { cached = { text, ids: ltsOf(text) }; ltCache.set(path, cached); }
      for (const id of cached.ids) all.add(id);
    }
    for (const path of ltCache.keys()) if (!sources.has(path)) ltCache.delete(path);
    return all;
  }
  let tracker = createIdTracker({ random: options.random, logIds });
  /** 給 planToday 的卡組：拿掉待處理的目標（W5 §8-5：不出題）。 */
  let planList: DeckEntry[] = [];
  function rebuild(): void {
    deckList = [...deckMap].map(([path, deck]) => ({ path, deck })).sort(byPath);
    planList = deckList.map(entry => {
      const skip = tracker.lines(entry.path);
      return skip.size ? { path: entry.path, deck: { ...entry.deck, targets: entry.deck.targets.filter(t => !skip.has(t.line)) } } : entry;
    });
  }
  function replan(): void {
    current = planToday(input());
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { report(error, 'listener'); }
    }
  }
  /** 存檔或家長選了之後，state 把這份文字當成這篇卡組現在的內容（tracker 已經比對過），立刻重排。 */
  function adopt(path: string): void {
    const text = tracker.text(path);
    if (text === undefined) return;
    deckMap.set(path, parseDeck(text));
    rebuild();
    replan();
  }

  function input(): TodayInput {
    if (!loaded) throw Error('state 還沒 ready');
    const at = now();
    return { decks: planList, history, settings, exam: null, now: at, offset: offsetOf(at) };
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
    const revision = tracker.revision();
    // 改名：同一批裡消失的卡組與第一次出現的配對（內容相同優先，再來是檔名相同），上一版與待處理的問題跟著新路徑。
    const texts = new Map(paths.flatMap((path, i) => {
      const result = results[i];
      return result.status === 'fulfilled' && isDeckPath(path) ? [[path, result.value] as const] : [];
    }));
    const gone = [...texts].filter(([path, text]) => text === null && tracker.text(path) !== undefined).map(([path]) => path);
    const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
    for (const [path, text] of texts) {
      if (text === null || tracker.text(path) !== undefined || !gone.length) continue;
      const same = gone.findIndex(old => tracker.text(old) === text);
      const from = same >= 0 ? same : gone.findIndex(old => name(old) === name(path));
      if (from >= 0) tracker.move(gone.splice(from, 1)[0], path);
    }
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
          tracker.forget(path);
          if (deckMap.delete(path)) decksChanged = true;
          continue;
        }
        const deck = parseDeck(text);
        // 和上一版比對弄丟的 ID（W5 §8-5）；自己剛寫回或存檔時已經比對過的同一份文字不再比。
        if (tracker.text(path) !== text) tracker.observe(path, text, deck, true);
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
    if (tracker.revision() !== revision) decksChanged = true;
    if (!decksChanged && !logsChanged) return;
    if (decksChanged) rebuild();
    // 別台裝置的紀錄一律整份重新 merge，不直接追加（Codex 審查 W4 第 10 點）。
    if (logsChanged) history = mergeHistory([...sources].map(([path, text]) => ({ path, text })));
    replan();
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
    tracker = createIdTracker({ random: options.random, logIds });
    // 和 readDecks 相同（照路徑的字串順序、讀到 null 的不算），另外把文字交給 tracker 當第一版（不偵測）。
    const deckPaths = (await files.list(DECK_ROOT)).filter(isDeckPath).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const deckTexts = await Promise.all(deckPaths.map(path => files.read(path)));
    deckPaths.forEach((path, i) => {
      const text = deckTexts[i];
      if (text === null) return;
      const deck = parseDeck(text);
      deckMap.set(path, deck);
      tracker.observe(path, text, deck, false);
    });
    rebuild();
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

  /** 存檔：補 ID、歸位、改縮排（待處理的跳過）；只在電腦、只對卡組（D-134）。 */
  function fillText(path: string, text: string): string {
    if (!options.fillIds || !loaded || closed || !isDeckPath(path)) return text;
    const revision = tracker.revision(), known = tracker.text(path);
    const next = tracker.fill(path, text);
    if (next !== known || tracker.revision() !== revision) adopt(path);
    return next;
  }

  return {
    ready() {
      loading ??= start();
      return loading;
    },
    deckStatus: path => loaded ? tracker.status(path) : { missing: 0, issues: [] },
    fillText,
    async fillIds(path) {
      if (!options.fillIds || !loaded || closed || !isDeckPath(path)) return false;
      let changed = false;
      try {
        // 在 modify 的回呼裡對最新的文字重新計算（W5 §8-2 第 4 點）。
        await files.modify(path, text => {
          if (text === '') throw new NothingToFill();
          const next = fillText(path, text);
          changed = next !== text;
          return next;
        });
      } catch (error) {
        if (error instanceof NothingToFill) return false;
        throw error;
      }
      return changed;
    },
    resolveText(issue, choice, text) {
      if (!options.fillIds || !loaded || closed) return null;
      const revision = tracker.revision(), known = tracker.text(issue.path);
      const next = tracker.resolve(issue, choice, text);
      if (tracker.text(issue.path) !== known || tracker.revision() !== revision) adopt(issue.path);
      return next;
    },
    removedInEditor(_path, ids) { tracker.removed(ids); },
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
