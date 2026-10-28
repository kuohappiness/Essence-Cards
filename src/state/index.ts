import type { Files } from '../core/files.ts';
import { isDeckPath, listDeckPaths, parseDeck } from '../core/deck/index.ts';
import type { Deck } from '../core/deck/index.ts';
import { createIdTracker } from './ids.ts';
import type { IdIssue } from './ids.ts';
export type { IdIssue, IdIssueKind } from './ids.ts';
import { appendLine, createLogWriter, dayOf, dayStart, encodeEntry, isLogPath, LOG_FOLDER, logPath, mergeHistory, nextCard, parseLine, planToday, progress } from '../core/study/index.ts';
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
   * 第一次列出卡組與紀錄、能讀到的都讀完、排好今天就完成；之後每次呼叫回傳同一個 Promise。
   * 讀不到的那幾篇跳過、之後自己重試（unread()）。只有列不出來（list 失敗）才整個重試（1 秒起、每次加倍、最多 60 秒），
   * 每次失敗交給 onError。files 的讀取與列出失敗不會讓它 reject，只有 close() 會；程式本身的錯（不是讀不到）
   * 也會經過 onError(…, 'read') 並讓它 reject（Codex state-load L2 的對齊第 2 點）。
   */
  ready(): Promise<LoadTimings>;
  /**
   * 列出來或通知過、但最近一次讀不到的路徑（卡組與紀錄），照字串排序；自己隔一段時間重試，讀到或不存在了就拿掉。
   * 不是空的時候占用資訊不完整，補 ID、還原、當成新的都暫停（fillText 回傳原文、fillIds 回傳 false、resolveText
   * 回傳 null；D-134 不能把「不知道」當成「沒用過」）。代價：家長在一篇卡組還沒下載好時存檔或離開筆記，這次不補 ID，
   * 要再存一次或再離開一次（和 D-134 已列的「一直開著、忘記存檔」同一類）。
   */
  unread(): readonly string[];
  decks(): readonly DeckEntry[];
  history(): History;
  /** 目前的輸入：decks、history、settings、exam: null、呼叫當下的 now 與 offset。 */
  input(): TodayInput;
  /** 今天的份；過了清晨 4 點或 offset 變了，先重排。 */
  today(): Today;
  /** nextCard；不會回傳 'stale'。 */
  next(pick: Pick): Next;
  progress(): Progress;
  /**
   * 寫一行紀錄（背景）、併進 history，回傳 t；不重排。取消的那一筆早於今天的份的開始（例如複習到 03:59、過了 04:00 回看改評分）時，
   * 今天的份是用那一筆算的，下一次 today()、next()、progress() 重排（tasks/state-writes.md §6）；取消今天的作答不重排。
   */
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
  /** 這台電腦的編輯器裡 Undo／Redo 或貼上讓這些 ID 回來了：之後再弄丟就照常算弄丟。 */
  restoredInEditor(path: string, ids: readonly string[]): void;
}

/** fillIds 讀到空字串（不存在或空檔）時中止 modify，不建立檔案。 */
class NothingToFill extends Error {}

const DEFAULT_SETTINGS: Settings = { capMinutes: 30, retention: 0.8, filter: [] };
const EMPTY_HISTORY: History = { reviews: [], changes: [], problems: [], cancelled: [], seen: [] };
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
  let unwatch: (() => void) | null = null;
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

  // 原始紀錄每一行的 lt 由紀錄模組算（history.seen，技術債 A1）；tracker 要 Set，照 history 物件的身分快取一個。
  let seenIds: { of: History; ids: Set<string> } | null = null;
  function logIds(): Set<string> {
    if (seenIds?.of !== history) seenIds = { of: history, ids: new Set(history.seen) };
    return seenIds.ids;
  }
  const tracker = createIdTracker({ random: options.random, logIds, partial: () => unread.size > 0 });
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
    // 第一次載入完成之前收到的，完成後一起處理。
    if (loaded) schedule();
    else noticed = true;
  }
  function schedule(wait = delay): void {
    // onError 的監聽者可能在回呼裡 close()（Codex state-load L2 的 F2）：關閉之後不再排。
    if (closed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void queue(apply);
    }, wait);
  }
  /** 一次只讀一批（第一次載入的兩批、之後每次檔案變動）：重試的計時到了，也等前一批處理完才讀。錯誤交給 onError。 */
  function queue(work: () => Promise<void>): Promise<void> {
    const next = processing.then(work);
    processing = next.catch((error: unknown) => { report(error, 'read'); });
    return next;
  }
  async function apply(): Promise<void> {
    if (closed) return;
    // 正在 I/O 的那一篇不讀，留在 pending（§2 第 2 點）；讀取開始後才到的通知留著等下一批（第 4 點）。
    const paths = [...pending].filter(path => !busy.has(path));
    if (!paths.length) return;
    for (const path of paths) pending.delete(path);
    await read(paths);
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
    if (closed) return;
    const at = paths.map(path => marks.get(path));
    const results = await Promise.allSettled(paths.map(path => files.read(path)));
    if (closed) return;
    let decksChanged = false, logsChanged = false;
    let failure: { error: unknown } | null = null;
    const revision = tracker.revision();
    const texts = new Map<string, string | null>(), logs = new Map<string, string | null>();
    for (const [i, path] of paths.entries()) {
      const result = results[i];
      // 跨過這篇的 I/O（§2 第 3 點）：文字、null、reject 都不用，放回 pending；I/O 結束時已經（或會）排一批讀取。
      if (marks.get(path) !== at[i] || busy.has(path)) {
        pending.add(path);
        continue;
      }
      if (result.status === 'rejected') {
        // 讀不到的留著等重試；讀得到的照常處理，不被它擋住。
        pending.add(path);
        unread.add(path);
        failure ??= { error: result.reason };
        continue;
      }
      unread.delete(path);
      (isDeckPath(path) ? texts : logs).set(path, result.value);
    }
    // 同一批讀到的紀錄先放進來源、先合併，下面比對卡組時「紀錄裡出現過的 ID」才包括它們（Codex 再審的 R2）。
    for (const [path, text] of logs) {
      const before = sources.get(path), file = text ?? '';
      // 自己的紀錄只有第一次讀不到時才會再讀（通知不理，W5 §3-3）：讀到之前作答的行只在記憶裡（可能還沒寫進檔），
      // 接在讀到的內容後面；已經寫進檔的會重複，mergeHistory 會去掉。
      const next = before !== undefined && own(path) ? file + (file && !file.endsWith('\n') ? '\n' : '') + before : text;
      if (next === null) {
        if (sources.delete(path)) logsChanged = true;
      } else if (before !== next) {
        sources.set(path, next);
        logsChanged = true;
      }
    }
    // 別台裝置的紀錄一律整份重新 merge，不直接追加（Codex 審查 W4 第 10 點）。
    if (logsChanged) history = mergeHistory([...sources].map(([path, text]) => ({ path, text })));
    // 改名：同一批裡消失的卡組與第一次出現的配對（內容相同優先，再來是檔名相同），上一版與待處理的問題跟著新路徑。
    const gone = [...texts].filter(([path, text]) => text === null && tracker.text(path) !== undefined).map(([path]) => path);
    const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
    for (const [path, text] of texts) {
      if (text === null || tracker.text(path) !== undefined || !gone.length) continue;
      const same = gone.findIndex(old => tracker.text(old) === text);
      const from = same >= 0 ? same : gone.findIndex(old => name(old) === name(path));
      if (from < 0) continue;
      const old = gone.splice(from, 1)[0];
      tracker.move(old, path);
      bump(old);
      bump(path);
    }
    // 和上一版比對弄丟的 ID（W5 §8-5；第一次讀到的那一篇沒有上一版，不偵測）：刪掉的先忘掉，改到的同一批一起比
    // （Codex 審查第二部分的 F5）；自己剛寫回或存檔時已經比對過的同一份文字不再比。
    const changed: { path: string; text: string; deck: Deck }[] = [];
    for (const [path, text] of texts) {
      if (text === null) {
        tracker.forget(path);
        bump(path);
      }
      else if (tracker.text(path) !== text) changed.push({ path, text, deck: parseDeck(text) });
    }
    tracker.observe(changed, true);
    const parsed = new Map(changed.map(entry => [entry.path, entry.deck]));
    for (const [path, text] of texts) {
      const before = deckMap.get(path);
      if (text === null) {
        if (deckMap.delete(path)) decksChanged = true;
        continue;
      }
      const deck = parsed.get(path) ?? parseDeck(text);
      // 通知了但解析結果相同（例如內容沒變）就不重排。
      if (before && JSON.stringify(before) === JSON.stringify(deck)) continue;
      deckMap.set(path, deck);
      decksChanged = true;
    }
    if (failure) {
      failures++;
      report(failure.error, 'read');
      // 等待中已經有新的通知排好時，就跟著那一次重讀。
      if (timer === null) schedule(retryDelay());
    } else if (!unread.size) failures = 0;
    // 都讀到了：讀不到期間暫定的問題重新核對（§3-2）。
    if (!unread.size) tracker.confirm();
    if (tracker.revision() !== revision) decksChanged = true;
    if (decksChanged) rebuild();
    if (loaded && (decksChanged || logsChanged)) replan();
  }

  /** 第一次載入（§2-1）：先監看；只有列不出來才整個重試，close() 之後放棄。 */
  async function start(): Promise<LoadTimings> {
    // 先監看再讀：讀的期間改到的檔不會漏掉。
    if (!closed) unwatch = files.watch(notify);
    for (;;) {
      const begin = performance.now();
      let lists: [string[], string[]];
      try {
        lists = await Promise.all([listDeckPaths(files), files.list(LOG_FOLDER).then(paths => paths.filter(isLogPath))]);
      } catch (error) {
        if (closed) throw error;
        failures++;
        report(error, 'read');
        // 回呼裡 close() 了就不等（Codex state-load L2 的 F2）；等的期間 close() 會提早叫醒。
        if (!closed) await pause(retryDelay());
        if (closed) throw Error('state 已關閉，沒有讀完');
        continue;
      }
      failures = 0;
      return load(begin, ...lists);
    }
  }

  async function load(begin: number, deckPaths: string[], logPaths: string[]): Promise<LoadTimings> {
    // 卡組一批、紀錄一批（自己的紀錄也讀），和之後的檔案變動走同一個 read。
    await queue(() => read(deckPaths));
    const afterDecks = performance.now();
    await queue(() => read(logPaths));
    const afterHistory = performance.now();
    if (closed) throw Error('state 已關閉，沒有讀完');
    loaded = true;
    current = planToday(input());
    const end = performance.now();
    if (noticed) schedule();
    return { decks: afterDecks - begin, history: afterHistory - afterDecks, plan: end - afterHistory, total: end - begin };
  }

  /**
   * 能不能配 ID 或還原：只在電腦（D-134）、讀完之後、還沒關閉，而且沒有讀不到的卡組或紀錄（§3：占用資訊不完整時，
   * 不能把「不知道」當成「沒用過」）。
   */
  const writable = (): boolean => options.fillIds && loaded && !closed && !unread.size;
  /**
   * 存檔的準備：補 ID、歸位、改縮排（待處理的跳過）；只對卡組。輸入的文字是這一篇最新的內容，
   * 比對出的問題立刻採用；寫回的文字要等 commit（寫成之後）才採用。
   */
  function prepare(path: string, text: string): { text: string; commit: () => void } | null {
    if (!writable() || !isDeckPath(path)) return null;
    const revision = tracker.revision(), known = tracker.text(path);
    const fill = tracker.fill(path, text);
    if (tracker.text(path) !== known || tracker.revision() !== revision) adopt(path);
    return { text: fill.text, commit() {
      const before = tracker.text(path);
      fill.commit();
      if (tracker.text(path) !== before) adopt(path);
    } };
  }
  /** 開著的筆記：呼叫端馬上用 Editor 的交易寫回，所以直接採用。 */
  function fillText(path: string, text: string): string {
    const fill = prepare(path, text);
    if (!fill) return text;
    fill.commit();
    return fill.text;
  }

  return {
    ready() {
      loading ??= start();
      return loading;
    },
    unread: () => [...unread].sort(),
    deckStatus: path => loaded ? tracker.status(path) : { missing: 0, issues: [] },
    fillText,
    async fillIds(path) {
      if (!writable() || !isDeckPath(path)) return false;
      let fill: ReturnType<typeof prepare> = null, changed = false;
      // 這篇的 I/O 開始（§2 第 1 點）：寫進磁碟有結果之前不讀它，之前開始的讀取結果不用。
      busy.add(path);
      bump(path);
      try {
        // 在 modify 的回呼裡對最新的文字重新計算（W5 §8-2 第 4 點）。
        await files.modify(path, text => {
          if (text === '') throw new NothingToFill();
          fill = prepare(path, text);
          changed = !!fill && fill.text !== text;
          return fill?.text ?? text;
        });
      } catch (error) {
        if (error instanceof NothingToFill) return false;
        throw error;
      } finally {
        busy.delete(path);
        bump(path);
        pending.add(path);
        void readNow();
      }
      // 寫成了才採用（Codex 審查第二部分第 14 點）。
      (fill as ReturnType<typeof prepare>)?.commit();
      return changed;
    },
    resolveText(issue, choice, text) {
      if (!writable()) return null;
      const revision = tracker.revision(), known = tracker.text(issue.path);
      const next = tracker.resolve(issue, choice, text);
      if (tracker.text(issue.path) !== known || tracker.revision() !== revision) adopt(issue.path);
      return next;
    },
    removedInEditor(_path, ids) { tracker.removed(ids); },
    restoredInEditor(_path, ids) { tracker.restored(ids); },
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
      if (stamp.kind === 'undo' && current && Date.parse(stamp.undo) < dayStart(current.day, current.offset)) current = null;
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
// 裝置碼的純計算（W5 §4-2）：state 只能透過這裡使用（技術債 A7）。
export { deviceCode, isDeviceCode } from './device.ts';
export type { DevicePlatform } from './device.ts';
