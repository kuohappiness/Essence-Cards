import type { Files } from '../core/files.ts';
import { isDeckPath, parseDeck } from '../core/deck/index.ts';
import type { Deck, Target } from '../core/deck/index.ts';
import { createIdTracker } from './ids.ts';
import { createReads } from './reads.ts';
import type { Life, Texts } from './reads.ts';
import { createWrites } from './writes.ts';
import type { EditorHandle, WriteBlock, WriteResult } from './writes.ts';
export type { EditorHandle, WriteBlock, WriteResult } from './writes.ts';
import type { IdIssue, Prepared } from './ids.ts';
export type { IdIssue, IdIssueKind } from './ids.ts';
import { appendLine, createLogWriter, dayOf, dayStart, encodeEntry, isLogPath, LOG_FOLDER, logPath, mergeHistory, nextCard, parseLine, parseTime, planToday, progress } from '../core/study/index.ts';
import type { DeckEntry, History, NewEntry, Next, Pick, Progress, Settings, Today, TodayInput } from '../core/study/index.ts';
import { canRead, releaseOf } from '../core/version/index.ts';
import { lastVersions } from '../core/backup/index.ts';
import type { VersionReport } from '../core/backup/index.ts';

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
   * listener：onChange 的監聽者丟出錯誤（程式的錯，不重試）；init：第一次載入時讀取那一列以外的錯（例如監看、首次排程），
   * ready() 跟著拒絕（tasks/error-log.md §2-3）。
   */
  onError?: (error: unknown, source: ErrorSource) => void;
  /** 補學習目標 ID：電腦 true、手機 false（D-134：iPhone 不寫卡組筆記）。 */
  fillIds: boolean;
  /**
   * 改寫卡組之前要先有一份成功的備份（D-150 第 3 點）：電腦上外掛內的備份接上時是 true，寫入的閘門一開始關著
   * （save、resolve 回 blocked backup，fillIds 回傳 false），backupReady(true) 才打開。沒傳或 false 時不擋（手機、測試）。
   */
  backup?: boolean;
  /** 傳給 assignIds，測試用。 */
  random?: () => number;
  /** 等一次寫進磁碟（編輯器的 persist、modify）最多多久（毫秒），預設 10_000；超過就當成失敗、放行後面的寫入。 */
  writeTimeout?: number;
}
export type ErrorSource = 'write' | 'read' | 'listener' | 'init';
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
   * 也會經過 onError(…, 'read') 並讓它 reject（Codex state-load L2 的對齊第 2 點）；讀取那一列以外的（監看、首次排程）經過
   * onError(…, 'init')。除了 close() 之外，每次 reject 都恰好報過一次。
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
  /**
   * 不看是哪一篇的受阻原因，依 state 目前所知、和寫入的門檻同一個順序：phone、loading、closed、backup、unread；沒有是 null。
   * 存檔按鈕的說明用它（技術債「存檔按鈕的受阻原因各自判斷」）；null 不是寫入許可，按下時 save 照樣重查，需要新版看 deckStatus。
   */
  writeBlock(): WriteBlock | null;
  /** 外掛內的備份（StateOptions.backup）：有一份成功的備份時 true，失敗或還沒有時 false。沒傳 backup 時不作用。 */
  backupReady(ready: boolean): void;
  /** 這台電腦的編輯器裡刪掉或剪下了整個目標：這些 ID 是刻意拿掉的，重讀時不算弄丟。 */
  removedInEditor(path: string, ids: readonly string[]): void;
  /** 這台電腦的編輯器裡 Undo／Redo 或貼上讓這些 ID 回來了：之後再弄丟就照常算弄丟。 */
  restoredInEditor(path: string, ids: readonly string[]): void;
}

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
    if (appState !== 'waiting' || options.build === undefined || life.closed || [...unread].some(own)) return;
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
    if (logsChanged) history = mergeHistory([...sources].map(([path, text]) => ({ path, text })), version);
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
      // 第一次載入時由 load() 在紀錄那一批之後比；之後是讀不到的自己的紀錄終於讀到了。
      if (life.loaded) checkApp();
      if (life.loaded && (decksChanged || logsChanged)) replan();
    };
  }

  /** 第一次載入時讀取那一列已經把錯誤交給 onError（read）：ready() 拒絕時不再報一次 init。 */
  let queueFailed = false;
  const loadQueue = (paths: string[]): Promise<void> => reads.queue(() => reads.read(paths)).catch((error: unknown) => { queueFailed = true; throw error; });
  async function load(begin: number, deckPaths: string[], logPaths: string[]): Promise<LoadTimings> {
    // 卡組一批、紀錄一批（自己的紀錄也讀），和之後的檔案變動走同一個 read。
    await loadQueue(deckPaths);
    const afterDecks = performance.now();
    await loadQueue(logPaths);
    const afterHistory = performance.now();
    if (life.closed) throw Error('state 已關閉，沒有讀完');
    // 自己的紀錄都讀到時，版本行排在這次第一筆作答前：answer 要等 loaded 才能寫。
    checkApp();
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
  /** 備份的閘門（D-150 第 3 點）：要等備份的（電腦）一開始關著，backupReady(true) 才打開。 */
  let backupPending = options.backup === true;
  const writes = createWrites({ files, life, reads, fillIds: options.fillIds, writeTimeout, prepare, wrote: (path, text) => { tracker.wrote(path, text); }, blockedText, backupPending: () => backupPending });

  return {
    ready() {
      // 除了 close() 之外，讓 ready() 拒絕的每一條路都恰好經過一次 onError（tasks/error-log.md §2-3）：監看拋錯、首次排程
      // 這類讀取那一列以外的錯在這裡補報 init；讀取那一列已經報過的不再報；停用不是故障。
      loading ??= reads.start(load).catch((error: unknown) => {
        if (!life.closed && !queueFailed) report(error, 'init');
        throw error;
      });
      return loading;
    },
    unread: () => [...unread].sort(),
    deckStatus: path => !life.loaded ? { missing: 0, issues: [] } : gated.includes(path) ? { missing: 0, issues: [], needsUpdate: true } : tracker.status(path),
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
    writeBlock: () => writes.blockedNow(),
    backupReady(ready) { if (options.backup) backupPending = !ready; },
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
      if (!life.loaded) throw Error('state 還沒 ready');
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
