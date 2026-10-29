import type { Files } from '../core/files.ts';
import { isDeckPath, listDeckPaths, parseDeck } from '../core/deck/index.ts';
import type { Deck, Target } from '../core/deck/index.ts';
import { confirms, createIdTracker } from './ids.ts';
import type { IdIssue, Prepared } from './ids.ts';
export type { IdIssue, IdIssueKind } from './ids.ts';
import { appendLine, createLogWriter, dayOf, dayStart, encodeEntry, isLogPath, LOG_FOLDER, logPath, mergeHistory, nextCard, parseLine, parseTime, planToday, progress } from '../core/study/index.ts';
import type { DeckEntry, History, NewEntry, Next, Pick, Progress, Settings, Today, TodayInput } from '../core/study/index.ts';
import { canRead, releaseOf } from '../core/version/index.ts';
import { lastVersions } from '../core/backup/index.ts';
import type { VersionReport } from '../core/backup/index.ts';

/** 開著的筆記的編輯器（tasks/state-writes.md §1）。由 Obsidian 層實作，state 不 import Obsidian。 */
export interface EditorHandle {
  /** 這次寫入的對象。建立時就固定：之後換篇、改名，都照這個路徑處理，不跟著畫面走。 */
  readonly path: string;
  /** 編輯器現在的全文；這個編輯器已經不是 path 那一篇（換篇、改名、關掉）時回傳 null。 */
  text(): string | null;
  /** 一次同步的 Editor 交易，把 before 改成 after（只改有變的部分）；內容已經不是 before 時不改，回傳 false。 */
  apply(before: string, after: string): boolean;
  /** 等編輯器把目前的內容寫進磁碟（TextFileView.save）；寫不進去就 reject。 */
  persist(): Promise<void>;
}

/** Cards 改卡組的結果。 */
export type WriteResult =
  /** 核對讀取確認寫成了。added：這次新配上 ID 的目標數（還原、當成新的不算）。 */
  | { kind: 'done'; added: number }
  /** 沒有要改的（含不是卡組）。 */
  | { kind: 'unchanged' }
  /** 門檻沒過，沒有改字。needs-update：這一篇需要新版才讀得懂（任務說明 2-2）。 */
  | { kind: 'blocked'; reason: 'phone' | 'loading' | 'unread' | 'closed' | 'needs-update' }
  /** 途中換了篇、內容被改掉、問題已經不成立，或一直有新的變動：沒有採用，要再存一次。 */
  | { kind: 'stale' }
  /** 寫不進磁碟：輸出沒有採用，已配出的 ID 保留、不重用。 */
  | { kind: 'failed'; error: unknown }
  /** 已寫進磁碟，但核對時讀不到：state 自己重試，讀到後照核對採用。 */
  | { kind: 'saved' };

export interface StateOptions {
  files: Files;
  /** 例如 'iPhone-7f3a'；紀錄的檔名用它。 */
  device: string;
  /**
   * 這次建置的版本 `BUILD`（例如 `0.1.0+1a2b3c4`），由外層傳進來，核心不讀全域（任務說明 2-1）。`+` 前面的正式版號決定
   * 讀得懂哪些「需要版本」與 need（syntax.md §0-1）；沒傳時版本不明，任何標記都讀不懂。
   */
  build?: string;
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
  /** 讀得懂的卡組；需要新版的（blocked().decks）不在裡面。 */
  decks(): readonly DeckEntry[];
  history(): History;
  /**
   * 需要新版才讀得懂的內容（D-149 第 3 點、syntax.md §0-1）：decks 是「需要版本」讀不懂的卡組（不出題，Cards 也不寫它）；
   * targets 是讀不懂的紀錄行停掉的學習目標；all 是有一行辨認不出影響範圍，全部學習目標都停。每次重讀都重新判斷。
   */
  blocked(): { decks: readonly string[]; targets: readonly string[]; all: boolean };
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
   * 牽涉的學習目標不能作答（canAnswer）時什麼都不寫、回傳 null（任務說明 2-2）：作答與學習目標的狀態看它的 lt，取消看它指的作答；
   * 找不到那一筆的取消照舊寫。卡組的狀態變更，那一篇需要新版時也不寫。
   */
  answer(entry: NewEntry): string | null;
  /** 這個學習目標現在能不能寫紀錄：讀不懂的紀錄行停掉的（或整份紀錄不完整）、需要新版的卡組裡的 ID 都不能。 */
  canAnswer(lt: string): boolean;
  /**
   * 「版本」命令用（任務說明 2-1、syntax.md §5-1）。build：這次的 BUILD，沒傳是 null。own：這台的版本行；waiting 是自己的
   * 紀錄還沒都讀到（本機歷史待讀取，讀到才比），same 是最後一行已經是這個 BUILD，queued 是排進寫入、還沒有 flush 確認寫成，
   * written 是 flush 確認寫成，沒傳 build 是 null。devices：每台裝置「最後回報」的版本，從帶來源路徑的原始紀錄算
   * （包括這台剛排進寫入的那一行），不是即時狀態。
   */
  version(): { build: string | null; own: 'waiting' | 'same' | 'queued' | 'written' | null; devices: VersionReport[] };
  /** 今天的份因為卡組或別台裝置的紀錄重排之後呼叫。 */
  onChange(listener: () => void): () => void;
  /** 等目前排隊的紀錄寫完。 */
  flush(): Promise<void>;
  /** 停止監看、等紀錄寫完。 */
  close(): Promise<void>;
  /**
   * 這一篇有幾個目標還沒有 ID（不含待處理的），以及待處理的問題。按鈕用。需要新版的卡組只回 needsUpdate（沒有要補的、
   * 沒有可以處理的問題：Cards 不寫它）。
   */
  deckStatus(path: string): { missing: number; issues: IdIssue[]; needsUpdate?: true };
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

/** fillIds 讀到空字串（不存在或空檔）時中止 modify，不建立檔案。 */
class NothingToFill extends Error {}
/**
 * 這份工作不寫了：逾時之後才輪到 modify 的回呼，或準備時關閉了。中止 modify，不改檔也不建立；回傳原文不夠，
 * 檔案不存在時那等於建立空檔。
 */
class Stopped extends Error {}

/** 先讀完待讀最多幾輪（§3 第 2 步）。 */
const DRAIN_ROUNDS = 5;

const DEFAULT_SETTINGS: Settings = { capMinutes: 30, retention: 0.8, filter: [] };
const EMPTY_HISTORY: History = { reviews: [], changes: [], problems: [], cancelled: [], seen: [], held: [], incomplete: false };
const byPath = (a: DeckEntry, b: DeckEntry): number => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function createState(options: StateOptions): State {
  const { files, device } = options;
  /** 這台的正式版號（syntax.md §0-1）；null 是版本不明。 */
  const version = options.build === undefined ? null : releaseOf(options.build);
  /** 「需要版本」讀不懂（§2-1）：整篇不出題，Cards 也不寫它。 */
  const needsUpdate = (deck: Deck): boolean => deck.props.need !== null && !canRead(deck.props.need, version);
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
  /** 正在讀的批數（0 或 1：一次只讀一批）。 */
  let reading = 0;
  /**
   * 寫成、等核對讀取的工作（§4 第 3 點），照路徑。output 是 null 時沒有改字（沒有要補的、或準備時問題已不成立），
   * 只等這次讀取、回傳 fallback。讀不到時先回 saved，核對留著，之後第一次讀到時照同一套規則採用（不重新配號、不重做交易）。
   */
  const checks = new Map<string, { output: string | null; prepared: Prepared | null; fallback: WriteResult; settle: (result: WriteResult) => void }>();
  /** Cards 改卡組的那一列（§3）：一次只做一份；卡住的寫入只擋後面的寫入，不擋讀檔與複習。 */
  let writes: Promise<unknown> = Promise.resolve();
  /**
   * 正在 I/O 的那一份工作，從 begin 到 end：close() 等它結束（§5）。從 begin 就開始算，不是從呼叫 persist 才算：
   * editor.apply()、editor.persist() 裡可能同步 close()（Codex L2 再審的 R2 續）。中間只有寫進磁碟那一步會等，那一步有 writeTimeout。
   */
  let active: Promise<void> | null = null;
  let finish: (() => void) | null = null;
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

  /** 寫一行紀錄到這台當月的檔、併進 history；作答與版本行共用同一個有序寫入（syntax.md §5-1）。 */
  function record(entry: NewEntry): string {
    const t = writer.write(entry);
    const line = encodeEntry(t, entry);
    const stamp = parseLine(line);
    if (!stamp) throw Error('寫出的紀錄無法解析：' + line);
    // 和 writer 寫檔的路徑相同：t 已經帶著寫入當下的時間與時區。
    const path = logPath(device, stamp.at, stamp.offset);
    sources.set(path, (sources.get(path) ?? '') + line + '\n');
    history = appendLine(history, line);
    return t;
  }
  /** 這台的版本行（version().own）。 */
  let appState: 'waiting' | 'same' | 'queued' | 'written' | null = options.build === undefined ? null : 'waiting';
  /**
   * 版本行（任務說明 2-1、syntax.md §5-1）：自己的紀錄檔（檔名正好是 logPath 的格式）都讀到之後比一次，時間最晚的那一行
   * `app` 不是這個 BUILD（或沒有、或同一個時間有不同的值）就排一行，一次啟動最多一行。讀到時已經 ready 的話，這一行排在
   * 那段期間的作答後面（Codex 格式查核 R2）。
   */
  function checkApp(): void {
    if (appState !== 'waiting' || options.build === undefined || closed || [...unread].some(own)) return;
    const reports = lastVersions([...sources].filter(([path]) => own(path)).map(([path, text]) => ({ path, text })), version);
    const at = (report: VersionReport): number => parseTime(report.t)?.at ?? -Infinity;
    const last = reports.reduce<VersionReport | null>((best, report) => best === null || at(report) > at(best) ? report : best, null);
    if (last?.build === options.build) { appState = 'same'; return; }
    record({ set: 'app', val: options.build });
    appState = 'queued';
  }
  /** 給 planToday 的卡組：拿掉待處理的目標（W5 §8-5：不出題）。 */
  let planList: DeckEntry[] = [];
  /** 需要新版的卡組（路徑照字串排序）與它們的 ID（候選也算）。 */
  let gated: string[] = [];
  let gatedIds = new Set<string>();
  function rebuild(): void {
    const all = [...deckMap].map(([path, deck]) => ({ path, deck })).sort(byPath);
    const newer = new Set(all.filter(entry => needsUpdate(entry.deck)));
    deckList = all.filter(entry => !newer.has(entry));
    gated = [...newer].map(entry => entry.path);
    gatedIds = new Set([...newer].flatMap(entry => entry.deck.targets.flatMap(t => [...(t.id ? [t.id] : []), ...(t.idCandidates ?? [])])));
    // 讀得懂的卡組裡和需要新版的卡組同一個 ID 的目標也不出：舊版分不出那個 ID 現在屬於哪一篇、是什麼意思。
    planList = deckList.map(entry => {
      const skip = tracker.lines(entry.path);
      const drop = (t: Target): boolean => skip.has(t.line) || (t.id !== null && gatedIds.has(t.id));
      return entry.deck.targets.some(drop) ? { path: entry.path, deck: { ...entry.deck, targets: entry.deck.targets.filter(t => !drop(t)) } } : entry;
    });
  }
  /** 能寫這個目標的紀錄：不是讀不懂的紀錄行停掉的、紀錄不是不完整、不在需要新版的卡組裡（§5-2、§2-1）。 */
  const answerable = (lt: string): boolean => !history.incomplete && !history.held.includes(lt) && !gatedIds.has(lt);
  /**
   * answer 能不能寫這一行。分類和 encodeEntry 同一個順序（Codex L2 的 F2）：有 undo 就是取消，看它指到的每一筆作答（多帶的欄位
   * 不寫出、也不看；找不到那一筆照舊寫）；有 set 是變更，學習目標看 lt，卡組的狀態是從卡組的內容得出的，需要新版的卡組不寫（§2-1）；
   * 其他是作答，看 lt。
   */
  function permits(entry: NewEntry): boolean {
    if ('undo' in entry) return history.reviews.every(review => review.t !== entry.undo || answerable(review.lt));
    if ('set' in entry) return 'deck' in entry ? !gated.includes(entry.deck) : 'lt' in entry ? answerable(entry.lt) : true;
    return answerable(entry.lt);
  }
  /** 這一篇（state 最近讀到的內容，或給了的這份文字）需要新版：Cards 不寫它（§2-1）。 */
  const blockedText = (path: string, text?: string): boolean => gated.includes(path) || (text !== undefined && needsUpdate(parseDeck(text)));
  function replan(): void {
    current = planToday(input());
    if (closed) return;
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
    reading++;
    try { await read(paths); } finally { reading--; }
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
        const check = checks.get(path);
        check?.settle(check.output === null ? check.fallback : { kind: 'saved' });
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
    if (logsChanged) history = mergeHistory([...sources].map(([path, text]) => ({ path, text })), version);
    // 核對讀取（§4 第 3 點）：讀到的和預期的輸出一字不差，或預期的變更都在（家長在這段時間又打了別的字），先套用延後的記錄、
    // 把預期的輸出當成自己的寫回，讀到的文字再照下面一般的重讀比對；預期不成立、讀到 null（不見了或改名，不跟著 A2 的改名配對寫到別篇）
    // 都照一般的重讀處理，回 stale。
    for (const [path, text] of texts) {
      const check = checks.get(path);
      if (!check) continue;
      checks.delete(path);
      if (text === null) check.settle({ kind: 'stale' });
      else if (check.output === null || !check.prepared) check.settle(check.fallback);
      else if (text === check.output || confirms(text, check.prepared.expect)) {
        check.prepared.record?.();
        tracker.wrote(path, check.output);
        check.settle({ kind: 'done', added: check.prepared.added });
      } else check.settle({ kind: 'stale' });
    }
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
    // 第一次載入時由 load() 在紀錄那一批之後比；之後是讀不到的自己的紀錄終於讀到了。
    if (loaded) checkApp();
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
    // 自己的紀錄都讀到時，版本行排在這次第一筆作答前：answer 要等 loaded 才能寫。
    checkApp();
    loaded = true;
    current = planToday(input());
    const end = performance.now();
    if (noticed) schedule();
    return { decks: afterDecks - begin, history: afterHistory - afterDecks, plan: end - afterHistory, total: end - begin };
  }

  /**
   * 寫入的門檻（§3 第 3 步）：可以時回傳 null，不行時回傳原因。只在電腦（D-134）、讀完之後、還沒關閉，而且沒有讀不到的
   * 卡組或紀錄（state-load §3：占用資訊不完整時，不能把「不知道」當成「沒用過」）；不是卡組就沒有要改的；需要新版的卡組
   * 不寫（任務說明 2-2，給了 text 時也看這份最新的文字）。之後要加的原因（D-150 的備份沒成功、多檔工作的預留還沒載入）
   * 都加在這裡，不分散到各個入口。
   */
  function writable(path: string, text?: string): WriteResult | null {
    if (!options.fillIds) return { kind: 'blocked', reason: 'phone' };
    if (!loaded) return { kind: 'blocked', reason: 'loading' };
    if (closed) return { kind: 'blocked', reason: 'closed' };
    if (unread.size) return { kind: 'blocked', reason: 'unread' };
    if (!isDeckPath(path)) return { kind: 'unchanged' };
    // 需要新版的卡組（任務說明 2-2、syntax.md §2-1）：state 最近讀到的，或這次要寫的最新文字，任何一邊讀不懂都不寫。
    if (blockedText(path, text)) return { kind: 'blocked', reason: 'needs-update' };
    return null;
  }
  /** 有已知還沒讀完的變動：一批讀取正在進行，或 pending 裡有不在 unread 的路徑（except 那一篇除外）。 */
  const waiting = (except?: string): boolean => reading > 0 || [...pending].some(path => path !== except && !unread.has(path));
  /** 排進寫入的那一列；排隊時就記下對象，輪到時才取最新的文字。 */
  function enqueue(job: () => Promise<WriteResult>): Promise<WriteResult> {
    const next = writes.then(job);
    writes = next.catch(() => {});
    return next;
  }
  /**
   * 第 1～3 步：已關閉、先讀完已知的待讀（包括這一篇；最多 DRAIN_ROUNDS 輪，rounds 跨過 fillIds 的重來累計）、門檻。
   * 回傳 null 時可以開始 I/O；呼叫端接著同步開始，中間不能有 await。
   */
  async function admit(path: string, rounds: { count: number }): Promise<WriteResult | null> {
    if (closed) return { kind: 'blocked', reason: 'closed' };
    // 手機、還沒 ready、不是卡組：不用先讀。讀不到、需要新版要看讀到的內容：先讀完待讀再判斷（待讀裡可能就是改回來的那一篇）。
    const early = writable(path);
    if (early && !(early.kind === 'blocked' && (early.reason === 'unread' || early.reason === 'needs-update'))) return early;
    while (waiting()) {
      if (closed) return { kind: 'blocked', reason: 'closed' };
      if (rounds.count >= DRAIN_ROUNDS) return { kind: 'stale' };
      rounds.count++;
      // 已經排好的 delay 計時不用取消：到時 pending 是空的就什麼都不做。
      await readNow();
    }
    return writable(path);
  }
  /** 第 4 步：這篇的 I/O 開始（§2 第 1 點）。 */
  function begin(path: string): void {
    busy.add(path);
    bump(path);
    active = new Promise(resolve => { finish = resolve; });
  }
  /**
   * 第 5 步等一次寫進磁碟（§3 最後一段）：最多等 writeTimeout，超過就當成失敗（錯誤寫明逾時），照第 6 步結束 I/O、放行後面的寫入。
   * 它之後才完成，也不採用這份工作的輸出；寫進磁碟的內容會送通知，照一般的讀取處理（配出的 ID 已在 seen，不會被當成換了 ID）。
   * 代價：還原或當成新的在逾時之後才寫成時，可能多出一個待處理問題，要家長再選一次。
   */
  function persist(work: Promise<void>): Promise<void> {
    let id: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      id = setTimeout(() => { reject(Error(`寫進磁碟超過 ${String(writeTimeout)} ms 沒有回來（逾時），當成失敗`)); }, writeTimeout);
    });
    return Promise.race([work, timeout]).finally(() => { clearTimeout(id); });
  }
  /** 第 6 步（finally，不論結果）：I/O 結束，序號前進，把這篇放進 pending、立刻讀（不等 delay）。 */
  function end(path: string): void {
    busy.delete(path);
    bump(path);
    finish?.();
    finish = null;
    active = null;
    pending.add(path);
    void readNow();
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
  /** 第 6、7 步：登記這份寫入的核對，等核對讀取（end 已經排好）。 */
  function verify(path: string, original: string, prepared: Prepared | null, fallback: WriteResult): Promise<WriteResult> | WriteResult {
    const output = prepared && prepared.text !== original ? prepared.text : null;
    // 關閉時在寫的：等到結果明確了，不登記核對、不採用（§5）；有改字是 saved。
    if (closed) return output === null ? fallback : { kind: 'saved' };
    return new Promise(settle => { checks.set(path, { output, prepared, fallback, settle }); });
  }
  /** 離開筆記（沒開著的檔）：在 modify 的回呼裡對最新的原文準備（W5 §8-2 第 4 點）。 */
  async function fillFile(path: string): Promise<WriteResult> {
    const rounds = { count: 0 };
    for (;;) {
      const stop = await admit(path, rounds);
      if (stop) return stop;
      begin(path);
      let prepared: Prepared | null = null, original = '', again = false, gate: WriteResult | null = null, live = true;
      let outcome: WriteResult | Promise<WriteResult> | null;
      try {
        await persist(files.modify(path, text => {
          // 逾時之後才輪到回呼：這份工作已經結束，中止 modify（Codex L2 的 R1：檔案刪掉或改名後 text 是空字串，回傳它會建立空檔）。
          if (!live) throw new Stopped();
          if (text === '') throw new NothingToFill();
          original = text;
          // 回呼拿到的是最新的原文：重查門檻（含這份原文需不需要新版）與待讀（這一篇自己除外，它最新的內容就是這份原文）；
          // 有新的待讀就不改，回到第 2 步。
          gate = writable(path, text);
          if (gate) return text;
          if (waiting(path)) { again = true; return text; }
          prepared = prepare(path, text);
          // 準備時監聽者可能 close()（見 edit）：不寫。
          if (closed) throw new Stopped();
          return prepared.text;
        }));
        outcome = gate ?? (again ? null : verify(path, original, prepared, { kind: 'unchanged' }));
      } catch (error) {
        // 寫不進去：不登記核對；已配出的 ID 留在 seen、不重用。
        outcome = error instanceof NothingToFill ? { kind: 'unchanged' } : error instanceof Stopped ? { kind: 'blocked', reason: 'closed' } : { kind: 'failed', error };
      } finally {
        live = false;
        end(path);
      }
      if (outcome) return outcome;
      rounds.count++;
    }
  }
  /**
   * 開著的筆記（save、resolve）：第 4、5 步從最後一次檢查（await admit 之後同步重查）到 apply 之間沒有 await。plan 對編輯器最新的文字準備
   * （先把它當成新版本比對、觀察到的原文照常採用）；回傳 null 時沒有要寫的，照樣 persist、等核對讀取，回 fallback。
   */
  async function edit(editor: EditorHandle, plan: (text: string) => Prepared | null, fallback: WriteResult): Promise<WriteResult> {
    const path = editor.path;
    const rounds = { count: 0 };
    for (;;) {
      const stop = await admit(path, rounds);
      if (stop) return stop;
      // admit 的最後一次檢查到這裡隔了一次 await：其間送來的通知或門檻的變化，回到 admit 重查（輪數照算）。
      if (!waiting() && !writable(path)) break;
    }
    begin(path);
    let outcome: WriteResult | Promise<WriteResult>;
    try {
      const text = editor.text();
      if (text === null) return { kind: 'stale' };
      // 編輯器最新的文字也過一次門檻：需要新版（state 還沒讀到）就不寫（§2-1）。
      const gate = writable(path, text);
      if (gate) return gate;
      const prepared = plan(text);
      // plan 觀察到新的原文時會同步通知監聽者（adopt → replan），監聽者或 onError 可能在裡面 close()（Codex L2 的 R2）：
      // 這時還沒改編輯器、還沒寫，停下來；close() 不用等這一份。
      if (closed) return { kind: 'blocked', reason: 'closed' };
      if (prepared && prepared.text !== text && !editor.apply(text, prepared.text)) return { kind: 'stale' };
      // 沒有改字也要 persist：觀察過的編輯器文字可能比磁碟新，要讓磁碟追上，核對讀取才有依據。
      await persist(editor.persist());
      outcome = verify(path, text, prepared, fallback);
    } catch (error) {
      // 寫不進去：不登記核對，不把 Editor 改回去，已配出的 ID 留在 seen、不重用。這時磁碟可能比觀察過的編輯器文字舊，
      // 接著的那次讀取可能出現和 N1 一樣的假問題，等下一次存檔成功或 Obsidian 的自動存檔追上後消失（保存失敗時的代價）。
      outcome = { kind: 'failed', error };
    } finally {
      end(path);
    }
    return outcome;
  }

  return {
    ready() {
      loading ??= start();
      return loading;
    },
    unread: () => [...unread].sort(),
    deckStatus: path => !loaded ? { missing: 0, issues: [] } : gated.includes(path) ? { missing: 0, issues: [], needsUpdate: true } : tracker.status(path),
    save: editor => enqueue(() => edit(editor, text => prepare(editor.path, text), { kind: 'unchanged' })),
    // 問題已經跟著改名搬到別的路徑：不是這個編輯器的那一篇，不準備（stale）。
    resolve: (issue, choice, editor) => enqueue(() => edit(editor, text => issue.path === editor.path ? track(editor.path, () => tracker.resolve(issue, choice, text)) : null, { kind: 'stale' })),
    async fillIds(path) {
      const result = await enqueue(() => fillFile(path));
      // 寫不進去時照舊 reject（呼叫端交給 onError）；已配出的 ID 留在 seen、不重用。
      if (result.kind === 'failed') throw result.error;
      // 寫進檔、核對還沒讀到（saved）也算改了字，和原本「有改字回傳 true」相同（2026-10-29 和環節 4 的 session 確認）。
      return result.kind === 'done' || result.kind === 'saved';
    },
    removedInEditor(_path, ids) { tracker.removed(ids); },
    restoredInEditor(_path, ids) { tracker.restored(ids); },
    decks: () => deckList,
    blocked: () => ({ decks: gated, targets: history.held, all: history.incomplete }),
    canAnswer: answerable,
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
      if (!permits(entry)) return null;
      const t = record(entry);
      if ('undo' in entry && current && Date.parse(entry.undo) < dayStart(current.day, current.offset)) current = null;
      return t;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async flush() {
      // 版本行在這次 flush 開始前就排好了，flush 成功就是寫成了（寫入成功以 flush 為準）。
      const queued = appState === 'queued';
      await writer.flush();
      if (queued && appState === 'queued') appState = 'written';
    },
    version: () => ({ build: options.build ?? null, own: appState, devices: lastVersions([...sources].map(([path, text]) => ({ path, text })), version) }),
    async close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      wake?.();
      unwatch?.();
      unwatch = null;
      // 寫成、等核對的工作回 saved（已寫進磁碟的內容下次載入照實讀回）；在寫的那一份等結果明確，最多 writeTimeout（§5）。
      for (const check of checks.values()) check.settle(check.output === null ? check.fallback : { kind: 'saved' });
      checks.clear();
      await active;
      await processing;
      await writer.flush();
    },
  };
}
// 裝置碼的純計算（W5 §4-2）：state 只能透過這裡使用（技術債 A7）。
export { deviceCode, isDeviceCode } from './device.ts';
export type { DevicePlatform } from './device.ts';
