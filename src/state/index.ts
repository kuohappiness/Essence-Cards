import type { Files } from '../core/files.ts';
import { isDeckPath, parseDeck } from '../core/deck/index.ts';
import type { Deck } from '../core/deck/index.ts';
import { createIdTracker } from './ids.ts';
import { createReads } from './reads.ts';
import type { Life, Texts } from './reads.ts';
import { createWrites } from './writes.ts';
import type { EditorHandle, WriteResult } from './writes.ts';
export type { EditorHandle, WriteResult } from './writes.ts';
import type { IdIssue, Prepared } from './ids.ts';
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
  /** 等一次寫進磁碟（編輯器的 persist、modify）最多多久（毫秒），預設 10_000；超過就當成失敗、放行後面的寫入。 */
  writeTimeout?: number;
}
export type ErrorSource = 'write' | 'read' | 'listener';
/** 毫秒。 */
export interface LoadTimings { decks: number; history: number; plan: number; total: number }

/**
 * 各方法在 ready 之前與 close() 之後的行為集中寫在這裡（技術債 A11），各方法的註解不再重複：
 * - 還沒 ready：input、today、next、progress、answer 丟錯；deckStatus 回空；save、resolve 回 blocked loading；fillIds 回 false。
 * - close() 之後：save、resolve 回 blocked closed；fillIds 回 false；不再通知 onChange 的監聽者；其他方法照常。
 */
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
   * 不是空的時候占用資訊不完整，補 ID、還原、當成新的都暫停（save、resolve 回 blocked unread，fillIds 回傳 false；
   * D-134 不能把「不知道」當成「沒用過」）。代價：家長在一篇卡組還沒下載好時存檔或離開筆記，這次不補 ID，
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
  /** 存檔（開著的筆記）：排進寫入的那一列，補 ID、歸位、改縮排，寫進磁碟並核對後才採用。 */
  save(editor: EditorHandle): Promise<WriteResult>;
  /** 家長在小視窗選了之後：同上；證據不再成立時是 stale，問題保留。 */
  resolve(issue: IdIssue, choice: 'restore' | 'new', editor: EditorHandle): Promise<WriteResult>;
  /**
   * 離開筆記時（沒開著的檔）：排進同一列，在 modify 的回呼裡補；不存在時不建立。核對後補上了（done）或已寫進檔、核對還沒讀到（saved）
   * 回傳 true；沒有要改、門檻沒過、途中變了（stale）回傳 false；寫不進去或逾時 reject（已配出的 ID 保留、不重用）。
   */
  fillIds(path: string): Promise<boolean>;
  /** 這台電腦的編輯器裡刪掉或剪下了整個目標：這些 ID 是刻意拿掉的，重讀時不算弄丟。 */
  removedInEditor(path: string, ids: readonly string[]): void;
  /** 這台電腦的編輯器裡 Undo／Redo 或貼上讓這些 ID 回來了：之後再弄丟就照常算弄丟。 */
  restoredInEditor(path: string, ids: readonly string[]): void;
}

const DEFAULT_SETTINGS: Settings = { capMinutes: 30, retention: 0.8, filter: [] };
const EMPTY_HISTORY: History = { reviews: [], changes: [], problems: [], cancelled: [], seen: [] };
const byPath = (a: DeckEntry, b: DeckEntry): number => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function createState(options: StateOptions): State {
  const { files, device } = options;
  const now = options.now ?? Date.now;
  const offsetOf = options.offset ?? (ms => -new Date(ms).getTimezoneOffset());
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const delay = options.delay ?? 500;
  const writeTimeout = options.writeTimeout ?? 10_000;
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
  /** 讀取層與寫入共用；只有這裡改值。 */
  const life: Life = { loaded: false, closed: false };
  const listeners = new Set<() => void>();
  const reads = createReads({
    files,
    life,
    delay,
    watched: path => isDeckPath(path) || (isLogPath(path) && !own(path)),
    onError: error => { report(error, 'read'); },
    batch,
    unreadable: path => { writes.unreadable(path); },
  });
  const unread = reads.unread;

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
    if (life.closed) return;
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
    if (!life.loaded) throw Error('state 還沒 ready');
    const at = now();
    return { decks: planList, history, settings, exam: null, now: at, offset: offsetOf(at) };
  }
  /** 換日或換時區就重排（W4 的 F3：日編號相同、時區不同也要重排）。 */
  function fresh(): { today: Today; input: TodayInput } {
    const value = input();
    if (!current || current.offset !== value.offset || current.day !== dayOf(value.now, value.offset)) current = planToday(value);
    return { today: current, input: value };
  }

  /**
   * 一批讀到的卡組與紀錄（讀取層的 read 交過來；讀不到、跨過 I/O 的已經分掉）：先合併紀錄、核對，再改名配對、比對弄丟的 ID、
   * 更新卡組。回傳的收尾由讀取層在讀不到的回報與重試之後呼叫。
   */
  function batch(texts: Texts, logs: Texts): () => void {
    let decksChanged = false, logsChanged = false;
    const revision = tracker.revision();
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
    // 核對讀取（§4 第 3 點）：等核對的寫入，照這次讀到的文字採用或回 stale，見 writes.ts 的 verified。
    for (const [path, text] of texts) writes.verified(path, text);
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
      reads.bump(old);
      reads.bump(path);
    }
    // 和上一版比對弄丟的 ID（W5 §8-5；第一次讀到的那一篇沒有上一版，不偵測）：刪掉的先忘掉，改到的同一批一起比
    // （Codex 審查第二部分的 F5）；自己剛寫回或存檔時已經比對過的同一份文字不再比。
    const changed: { path: string; text: string; deck: Deck }[] = [];
    for (const [path, text] of texts) {
      if (text === null) {
        tracker.forget(path);
        reads.bump(path);
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
    return () => {
      // 都讀到了：讀不到期間暫定的問題重新核對（§3-2）。
      if (!unread.size) tracker.confirm();
      if (tracker.revision() !== revision) decksChanged = true;
      if (decksChanged) rebuild();
      if (life.loaded && (decksChanged || logsChanged)) replan();
    };
  }

  async function load(begin: number, deckPaths: string[], logPaths: string[]): Promise<LoadTimings> {
    // 卡組一批、紀錄一批（自己的紀錄也讀），和之後的檔案變動走同一個 read。
    await reads.queue(() => reads.read(deckPaths));
    const afterDecks = performance.now();
    await reads.queue(() => reads.read(logPaths));
    const afterHistory = performance.now();
    if (life.closed) throw Error('state 已關閉，沒有讀完');
    life.loaded = true;
    current = planToday(input());
    const end = performance.now();
    reads.catchUp();
    return { decks: afterDecks - begin, history: afterHistory - afterDecks, plan: end - afterHistory, total: end - begin };
  }

  /** 對 tracker 做一件事；這篇的文字或待處理的問題因此變了，就採用（更新 deckMap、重排）。 */
  function track<T>(path: string, change: () => T): T {
    const revision = tracker.revision(), known = tracker.text(path);
    const result = change();
    if (tracker.text(path) !== known || tracker.revision() !== revision) adopt(path);
    return result;
  }
  /**
   * 存檔的準備（§4 第 1 點）：補 ID、歸位、改縮排（待處理的跳過）。輸入的文字是這一篇最新的內容，觀察到的原文照常採用；
   * 只預留 ID，寫回的文字要等核對讀取確認寫成了才採用。
   */
  const prepare = (path: string, text: string): Prepared => track(path, () => tracker.fill(path, text));
  const writes = createWrites({ files, life, reads, fillIds: options.fillIds, writeTimeout, prepare, wrote: (path, text) => { tracker.wrote(path, text); } });

  return {
    ready() {
      loading ??= reads.start(load);
      return loading;
    },
    unread: () => [...unread].sort(),
    deckStatus: path => life.loaded ? tracker.status(path) : { missing: 0, issues: [] },
    save: editor => writes.enqueue(() => writes.edit(editor, text => prepare(editor.path, text), { kind: 'unchanged' })),
    // 問題已經跟著改名搬到別的路徑：不是這個編輯器的那一篇，不準備（stale）。
    resolve: (issue, choice, editor) => writes.enqueue(() => writes.edit(editor, text => issue.path === editor.path ? track(editor.path, () => tracker.resolve(issue, choice, text)) : null, { kind: 'stale' })),
    async fillIds(path) {
      const result = await writes.enqueue(() => writes.fillFile(path));
      // 寫不進去時照舊 reject（呼叫端交給 onError）；已配出的 ID 留在 seen、不重用。
      if (result.kind === 'failed') throw result.error;
      // 寫進檔、核對還沒讀到（saved）也算改了字，和原本「有改字回傳 true」相同（2026-10-29 和環節 4 的 session 確認）。
      return result.kind === 'done' || result.kind === 'saved';
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
      if (!life.loaded) throw Error('state 還沒 ready');
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
      life.closed = true;
      reads.stop();
      // 寫成、等核對的工作回 saved（已寫進磁碟的內容下次載入照實讀回）；在寫的那一份等結果明確，最多 writeTimeout（§5）。
      writes.stop();
      await writes.idle();
      await reads.idle();
      await writer.flush();
    },
  };
}
// 裝置碼的純計算（W5 §4-2）：state 只能透過這裡使用（技術債 A7）。
export { deviceCode, isDeviceCode } from './device.ts';
export type { DevicePlatform } from './device.ts';
