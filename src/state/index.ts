import type { Files } from '../core/files.ts';
import { isDeckPath, parseDeck, setDeckStatus as setStatusLine } from '../core/deck/index.ts';
import type { Deck, Target } from '../core/deck/index.ts';
import { buildIndex, deckInScope, editScope, newScopeText, paintCatalog, parseScope, scopeCheck, scopeDate, scopeDay, scopePeriod, scopeUnitKeys, targetsInScope } from '../core/catalog/index.ts';
import type { Catalog, CatalogIndex, QuizInput, QuizResolved, QuizRow, ScopeCheck, ScopeFile, ScopePeriod, ScopeUnit } from '../core/catalog/index.ts';
export type { Catalog, QuizInput, QuizProblem, QuizRef, QuizResolved, QuizRow, ScopeCheck, ScopeFile, ScopePeriod, ScopeUnit, TermView, UnitProblem, UnitView } from '../core/catalog/index.ts';
export type { DuplicateId, DuplicateTarget } from '../core/study/index.ts';
import { createExamFiles, unitsOf } from './exam.ts';
import type { ExamBlocked, ExamChange, ExamResult } from './exam.ts';
export type { ExamChange, ExamResult } from './exam.ts';
import { createQuizFiles } from './quiz.ts';
import type { QuizOpened, QuizResult } from './quiz.ts';
export type { QuizOpened, QuizResult } from './quiz.ts';
import { createIdTracker } from './ids.ts';
import { Closed, createReads, refuseIncomplete } from './reads.ts';
import type { Life, Texts } from './reads.ts';
import { createWrites } from './writes.ts';
import type { CreateResult, EditorHandle, WriteBlock, WriteResult } from './writes.ts';
export type { CreateResult, EditorHandle, WriteBlock, WriteResult } from './writes.ts';
import { existingTargets } from '../core/ai/index.ts';
import type { ExistingNow, ExistingTarget } from '../core/ai/index.ts';
import type { IdIssue, Malformed, Prepared } from './ids.ts';
import { markOf, withNeed } from './need.ts';
import { createObserver } from './observe.ts';
import { createSnapshots } from './snapshots.ts';
import type { SnapshotPlan } from './snapshots.ts';
import type { Observation } from './observe.ts';
export type { IdIssue, IdIssueKind, Malformed } from './ids.ts';
import { appendLine, createLogWriter, dayOf, dayStart, formatTime, isLogPath, LOG_FOLDER, memoryColors, mergeHistory, nextCard, parseTime, planToday, progress, scopeCount, todayLeft } from '../core/study/index.ts';
import type { DeckEntry, DuplicateId, ExamScope, History, NewEntry, Next, Pick, Progress, QueuedLine, ScopeCount, Settings, Today, TodayInput } from '../core/study/index.ts';
import { DEFAULT_SETTINGS, semesterOn } from '../core/settings/index.ts';
import type { SemesterPick, SettingsValue } from '../core/settings/index.ts';
export type { SettingsValue } from '../core/settings/index.ts';
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
  /** 預設 { capMinutes: 30, retention: 0.8, filter: [] }（D-104、D-078）；有傳 settingsFirst 時用不到。 */
  settings?: Settings;
  /** data.json 第一次讀到的設定（tasks/settings-page.md §3）：第一次載入等它，和範圍檔同一段等待；一定會完成，讀不到時是 known 為 false 的預設值。 */
  settingsFirst?: Promise<SettingsValue>;
  /** 收到檔案變動後等多久才處理（毫秒），預設 500。 */
  delay?: number;
  /** 讀取一直沒回來多久算讀不到（毫秒），預設 30 秒（任務說明〈小選擇〉第 5 項）。 */
  stuckAfter?: number;
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
  /**
   * 小考檔的連結指向哪一篇（tasks/quiz-mark.md §1）：真的解析在 Obsidian，由外層傳進來，state 不碰 Obsidian。沒傳時只認完整路徑。
   * from 是那份小考檔的路徑（相對路徑要用）。
   */
  resolveLink?: (link: string, from: string) => QuizResolved;
  /**
   * 這台電腦預留、不能配出的 ID（tasks/ai-cards-mvp.md §5〈ID 的預留〉）：AI 製卡沒完成的工作配好的，加上不再配出的清單。補 ID 與 aiIds 都避開。
   * 每次配號時才問，外層在建立 state 之前就讀好這台電腦的工作，所以第一次配號時預留一定已經載入。
   */
  reserved?: () => Iterable<string>;
  /** 這個檔在搬錯位置的系統資料夾裡（tasks/system-folder-guard.md §2-3）：不當卡組，不補 ID、不改狀態。files 那一邊也不列、讀不到它。 */
  skip?: (path: string) => boolean;
  /** 這個路徑的上層有系統資料夾已知不在原位、也沒搬回（FolderGuard.displaced）：AI 製卡不在原位另建，讀到「沒有」也不算沒有（R3-4）。 */
  displaced?: (path: string) => boolean;
}
export type ErrorSource = 'write' | 'read' | 'listener' | 'init';
/**
 * 一次複習的範圍：study 的 Pick，加上要經過單元索引才知道目標集合的（D-142 原則 5）。unit 是單元的鍵（Catalog 的 key）；
 * 沒有 since 是單元的當日卡，有 since 是單元的全部卡；deck 加 since 是卡組筆記的全部卡（D-146）。目標集合每次都照 state 現在讀到的內容算。
 */
export type StudyPick = Pick | { unit: string } | { unit: string; since: number } | { deck: string; since: number };
/** 目錄的暫停／恢復寫進卡組屬性 `狀態` 的值。 */
export type DeckStatusValue = '啟用' | '暫停';
/** 考試範圍現在的樣子（tasks/exam-scope.md §3、§4）：入口、目錄與設定畫面都看這一份。 */
/** 畫面打開時選定的是哪一份。 */
interface ExamTarget { path: string | null; id: string | null }
export interface ExamView {
  /** 第一次的讀取有結果了。false 是「不知道」：寫「暫時讀不到」，不寫「還沒設定」（§4）。 */
  settled: boolean;
  /** 列出來或通知過、從來沒讀到的份數。 */
  missing: number;
  /** 選定的那一份；沒有是 null。 */
  path: string | null;
  file: ScopeFile | null;
  /** 有讀得懂的行：排程當成有範圍。false 時畫面寫行數（§2-3 第 6 點）。 */
  usable: boolean;
  /** 其他也生效的那幾份（設定畫面寫「還有另一份也生效」）。 */
  others: readonly string[];
  period: ScopePeriod;
  /** 今天的日編號（清晨 4 點換日），算倒數用。 */
  day: number;
  /** 上一份範圍的結束日（§6 的預先勾選）；沒有上一份是 null。 */
  previousEnd: string | null;
}
/** 毫秒。 */
export interface LoadTimings { decks: number; history: number; plan: number; total: number }

/**
 * 各方法在 ready 之前與 close() 之後的行為集中寫在這裡（技術債 A11），各方法的註解不再重複：
 * - 還沒 ready：input、today、next、progress、answer 丟錯；deckStatus、conflicts 回空；save、resolve 回 blocked loading；fillIds 回 false。
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
   * 列出來或通知過、但最近一次讀不到的路徑（卡組、紀錄、範圍檔與小考檔），以及讀取一直沒回來（stuckAfter）的路徑，照字串排序；自己隔一段時間重試，讀到或不存在了就拿掉。
   * 卡組與紀錄有讀不到的時候占用資訊不完整，補 ID、還原、當成新的都暫停（save、resolve 回 blocked unread，fillIds 回傳 false；
   * D-134 不能把「不知道」當成「沒用過」）；只有範圍檔與小考檔讀不到不擋（tasks/exam-scope.md §4）。代價：家長在一篇卡組還沒下載好時存檔或離開筆記，這次不補 ID，
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
  /** 目前的輸入：decks、history、settings、選定的考試範圍（沒有或讀不懂是 null）、呼叫當下的 now 與 offset。 */
  input(): TodayInput;
  /** 今天的份；過了清晨 4 點或 offset 變了，先重排。 */
  today(): Today;
  /** nextCard；不會回傳 'stale'。 */
  next(pick: StudyPick): Next;
  progress(): Progress;
  /** 這個範圍現在的總數與完成數；再複習一些是 null。選卡、上方的「還剩 N 張」、完成畫面都照這一份。 */
  scope(pick: StudyPick): ScopeCount | null;
  /** 目錄的資料（D-097、D-142）：索引加上每個目標現在的記憶顏色與今天的份。 */
  catalog(): Catalog;
  /** 卡組筆記的全部卡的目標（D-146）：這一篇啟用中、可以出的目標 ID；草稿、暫停、轉錄稿、還沒讀完是空的。 */
  deckTargets(path: string): readonly string[];
  /** 跨單元的出處要在哪裡找（§10）：那個單元的每一篇，照路徑，各自的材料照原順序；對不到單元是空的。科目算 path 這一篇的。 */
  unitMaterials(path: string, term: string, code: string): readonly { path: string; materials: readonly string[]; name: string }[];
  /**
   * 寫一行紀錄（背景）、併進 history，回傳 t；不重排。取消的那一筆早於今天的份的開始（例如複習到 03:59、過了 04:00 回看改評分）時，
   * 今天的份是用那一筆算的，下一次 today()、next()、progress() 重排（tasks/state-writes.md §6）；取消今天的作答不重排。
   * 牽涉的學習目標不能作答（canAnswer）時什麼都不寫、回傳 null（任務說明 2-2）：作答與學習目標的狀態看它的 lt，取消看它指的作答；
   * 找不到那一筆的取消照舊寫，ID 重複時的取消也照寫（D-157）。卡組的狀態變更，那一篇需要新版時也不寫。
   * 值不合那一種的契約（空白的 lt、不是有限的數字……）是程式的錯：丟錯，不寫、不併進 history。
   */
  answer(entry: NewEntry): string | null;
  /** answer 現在會不會寫這一行（回看改比較卡的評分時先問過每一行，tasks/question-type-seam.md §8）。 */
  permits(entry: NewEntry): boolean;
  /** 和 answer 相同，回傳排進寫入的那一行與路徑：開發命令要和檔案比對時用它，不各自重新編碼。 */
  answerLine(entry: NewEntry): QueuedLine | null;
  /** 這個學習目標現在能不能寫紀錄：讀不懂的紀錄行停掉的（或整份紀錄不完整）、需要新版的卡組裡的、重複的（conflicts()）ID 都不能。 */
  canAnswer(lt: string): boolean;
  /**
   * 用了同一個學習目標 ID 的目標（D-157、syntax.md §2-3）：範圍是讀得懂的卡組（decks()），依 state 最近讀到的內容（讀不到的那一篇用上一次的）；
   * 每次讀到新內容照目前的內容重算，不看讀到的先後。待處理的目標照樣占著它的 ID，需要新版的卡組不算在內。這些目標都不出題、不收新的作答。
   */
  conflicts(): readonly DuplicateId[];
  /**
   * 「版本」命令用（任務說明 2-1、syntax.md §5-1）。build：這次的 BUILD，沒傳是 null。own：這台的版本行；waiting 是自己的
   * 紀錄還沒都讀到（本機歷史待讀取，讀到才比），same 是最後一行已經是這個 BUILD，queued 是排進寫入、還沒有 flush 確認寫成，
   * written 是 flush 確認寫成，沒傳 build 是 null。devices：每台裝置「最後回報」的版本，從帶來源路徑的原始紀錄算
   * （包括這台剛排進寫入的那一行），不是即時狀態。
   */
  version(): { build: string | null; own: 'waiting' | 'same' | 'queued' | 'written' | null; devices: VersionReport[] };
  /** 考試範圍現在的樣子；還沒 ready 也能問（settled 是 false）。 */
  exam(): ExamView;
  /** 範圍那一列與設定畫面用的目錄（§6、§7）：只有單元的結構，不重播紀錄（顏色與當日卡是空的），所以入口每次刷新都能問；還沒 ready 是 null。 */
  examCatalog(): Catalog | null;
  /** 照這些變動存檔之後會有哪些要留意的（§8）：不寫檔，勾選改變時畫面再問一次；還沒 ready 是 null。 */
  examCheck(change: ExamChange): ScopeCheck | null;
  /**
   * 建立或改範圍檔（§2-4）：畫面只交出變動，在 modify 的回呼裡改最新的內容；新檔撞名不蓋掉。有變動才記紀錄（§2-5）。
   * 寫好後立刻當成現在的內容重排，onChange 只通知一次。closed、loading；範圍檔還不知道或有讀不到的是 unread；回呼看到檔不見或已經結束是 changed；屬性區壞了是 broken。
   */
  setExam(change: ExamChange, opened: ExamTarget): Promise<ExamResult>;
  /** 結束這次考試（§2-2）：選定的那一份多一行 `提前結束`，立刻失效；還有另一份生效就換它接手。擋下來的原因同 setExam。 */
  endExam(opened: ExamTarget): Promise<ExamResult>;
  /** 現在要顯示的小考（tasks/quiz-mark.md §1、§4），照日期、科目、名稱排；還沒 ready 是空的。不改排程：今天的份不看這裡。 */
  quizzes(): readonly QuizRow[];
  /** 設定小考或改日期（§1）：opened 是 null 時建新檔，否則改那一次小考每一份的 `小考日期`。擋下來的原因：closed、loading；小考檔還不知道或有讀不到的是 unread；檔不見、已經取消、換成另一次小考是 changed；屬性區壞了是 broken；special 是寫不出來的目標。 */
  setQuiz(input: QuizInput, date: string, opened: QuizOpened | null): Promise<QuizResult>;
  /** 取消這次小考（§1）：多一行 `取消`，檔案留著。擋下來的原因同 setQuiz。 */
  cancelQuiz(opened: QuizOpened): Promise<QuizResult>;
  /** 設定頁或別台裝置改了設定（tasks/settings-page.md §3）：上限、保持率、濾網真的變了才重排並通知，只有學期或考試倒數變了只通知，相同什麼都不做。 */
  applySettings(value: SettingsValue): void;
  /** 現在生效的設定；semester 是今天算出來的學期，沒設定是 null；known 是 false 時 data.json 還沒讀到，不能當成使用者的設定。 */
  currentSettings(): { settings: Settings; semester: string | null; examCountdown: boolean; known: boolean };
  /** 今天的份因為卡組或別台裝置的紀錄重排之後呼叫；考試範圍只改了看不懂的行數這類只影響畫面的，也會呼叫但不重排。 */
  onChange(listener: () => void): () => void;
  /** unread() 的內容變了（多了或少了）；另外一條，不經 onChange，所以存檔按鈕不多更新一次（任務說明 §8、§11）。 */
  onUnread(listener: () => void): () => void;
  /** 等目前排隊的紀錄寫完。 */
  flush(): Promise<void>;
  /** 停止監看、等紀錄寫完。 */
  close(): Promise<void>;
  /**
   * 這一篇有幾個目標還沒有 ID（不含待處理的）、待處理的問題（含用了重複 ID 的目標，D-157），以及寫法有問題、暫時不會出題的目標（技術債 D1），都依 state 最近讀到的內容。
   * 存檔按鈕用。malformed 只涵蓋寫法的問題，不代表其餘的目標都會出題（還沒到期、別篇需要新版、草稿、暫停等）。
   * 需要新版的卡組只回 needsUpdate（沒有要補的、沒有可以處理的問題：Cards 不寫它）。
   */
  deckStatus(path: string): { missing: number; issues: IdIssue[]; malformed: Malformed[]; needsUpdate?: true; /** 這篇有比較卡（tasks/question-type-seam.md §3）：標記還沒寫（missing，按鈕不是「沒有要做的」），或屬性區加不上（refused，要家長改）。 */ mark?: 'missing' | 'refused' };
  /** 存檔（開著的筆記）：排進寫入的那一列，補 ID、歸位、改縮排，寫進磁碟並核對後才採用。 */
  save(editor: EditorHandle): Promise<WriteResult>;
  /**
   * 家長在小視窗選了之後：同上；證據不再成立時是 stale，問題保留。duplicate 只能選 new：只換那一行的 ID，同一篇其他衝突的目標與別篇都不動；
   * 選 restore 回 stale（D-157）。
   */
  resolve(issue: IdIssue, choice: 'restore' | 'new', editor: EditorHandle): Promise<WriteResult>;
  /**
   * 離開筆記時（沒開著的檔）：排進同一列，在 modify 的回呼裡補；不存在時不建立。核對後補上了（done）或已寫進檔、核對還沒讀到（saved）
   * 回傳 true；沒有要改、門檻沒過、途中變了（stale）回傳 false；寫不進去或逾時 reject（已配出的 ID 保留、不重用）。
   */
  fillIds(path: string): Promise<boolean>;
  /**
   * 目錄的暫停／恢復（D-183 第 6 點、tasks/quiz-practice.md §5）：只改屬性區的 `狀態`，和補 ID 走同一條寫入（同一列、同樣的門檻，手機回 blocked phone）；editor 是開著那篇的編輯器，沒開著是 null。
   * `set: status` 由偵測的出口在讀回來採用之後記，一次變更一行（tasks/record-gaps.md §1），saved 要等之後讀到；已經是這個值、草稿、檔不見了是 unchanged；屬性區讀不懂、只改一行讀不回來是 unwritable，都不寫。寫不進去回 failed，不丟錯。
   */
  setDeckStatus(path: string, value: DeckStatusValue, editor: EditorHandle | null): Promise<WriteResult | { kind: 'unwritable' }>;
  /**
   * 草稿 → 啟用（tasks/ai-cards-mvp.md §7）：和 setDeckStatus 同一條寫入、同樣的門檻，只改這一篇的 `狀態: 啟用`；寫成後一樣由偵測的出口記一行 `set: status`（`val: 啟用`）。
   * 不是草稿（啟用、暫停）是 unchanged；需要新版、屬性區讀不懂的照 setDeckStatus。
   */
  activateDraft(path: string, editor: EditorHandle | null): Promise<WriteResult | { kind: 'unwritable' }>;
  /** AI 製卡（tasks/ai-cards-mvp.md §2）：會一起送出的已有學習目標，照 core/ai 的 existingTargets；ID 重複的不送。還沒 ready 是空的。 */
  aiExisting(subject: string | null, term: string): readonly ExistingTarget[];
  /** 這個學習目標 ID 現在的樣子（§5 加進已有的學習目標轉成連結）：剛好一個讀得懂的目標才是 one；重複、需要新版、寫法有問題是 unusable。 */
  aiTarget(id: string): ExistingNow;
  /** 這一篇的目標會不會被正式排程停出（§7 啟用確認的計數，R2-8）：待處理的行、重複的 ID、和需要新版的卡組同 ID、紀錄讀不懂或不完整。 */
  aiStopped(path: string): (target: { id: string; line: number }) => boolean;
  /** 配 count 個新的 ID（§5 第 1 步）：門檻和寫入相同（writeBlock），沒過回原因；避開所有占用、這台電腦的預留與 avoid（將一起存入的區塊 ID），配出的之後都不再配。 */
  aiIds(count: number, avoid?: Iterable<string>): string[] | WriteBlock;
  /** 建快照（§5 第 6 步）：同 aiCreate，但先讀完已知的變動，寫入的當下每一篇都還要在原位置（ID 都在），整個 vault 也沒有同名檔；不符合回 refused、不建（R2-3、R2-4）。 */
  aiCreateSnapshot(path: string, text: string, decks: readonly { path: string; ids: readonly string[] }[], nameFree: () => boolean): Promise<CreateResult | { kind: 'refused'; why: 'decks' | 'name' }>;
  /** 這些 ID 現在在哪幾篇卡組（含引言框的行尾 ID，§5〈中斷與重試〉）：先讀完已知的變動（L2-2）；還沒讀完或有讀不到的卡組、紀錄是 null（不知道不當成沒有）。 */
  aiWhere(ids: readonly string[]): Promise<ReadonlyMap<string, readonly string[]> | null>;
  /** 只建立新檔（§5）：排進同一列寫入、同樣的門檻；寫好讀回核對。 */
  aiCreate(path: string, text: string): Promise<CreateResult>;
  /** 直接讀一個檔（§5 第 3～6 步的原文、快照與目的地）：不存在是 null；讀不到或超過 stuckAfter 沒回來就丟錯，不當成不存在（R3-5）。 */
  aiRead(path: string): Promise<string | null>;
  /** 這個路徑的上層有系統資料夾不在原位、也沒搬回（R3-4）：aiRead 回 null 也不代表真的沒有。 */
  aiDisplaced(path: string): boolean;
  /** 建卡組（§5 第 4 步）：同 aiCreate，但先讀完已知的變動，這些 ID 已經在某一篇或複習紀錄裡就回 refused、不建；寫入回呼裡再核對一次，並確認整個 vault 沒有同名檔（nameFree，R2-4）。 */
  aiCreateDeck(path: string, text: string, ids: readonly string[], nameFree: () => boolean): Promise<CreateResult | { kind: 'refused'; why: 'ids' | 'name' }>;
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

/** 第一次載入最多等範圍檔多久（毫秒，tasks/exam-scope.md §4）。 */
const EXAM_WAIT = 2000;
const EMPTY_HISTORY: History = { reviews: [], changes: [], problems: [], cancelled: [], seen: [], held: [], incomplete: false };
const byPath = (a: DeckEntry, b: DeckEntry): number => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function createState(options: StateOptions): State {
  const { device } = options;
  /** 卡組、紀錄、範圍檔與小考檔都經過它（tasks/record-gaps.md §3）。 */
  const files = refuseIncomplete(options.files);
  /** 這台的正式版號（syntax.md §0-1）；null 是版本不明。 */
  const version = options.build === undefined ? null : releaseOf(options.build);
  /** 「需要版本」讀不懂（§2-1）：整篇不出題，Cards 也不寫它。 */
  const needsUpdate = (deck: Deck): boolean => deck.props.need !== null && !canRead(deck.props.need, version);
  const now = options.now ?? Date.now;
  const offsetOf = options.offset ?? (ms => -new Date(ms).getTimezoneOffset());
  let settings = options.settings ?? DEFAULT_SETTINGS;
  let semester: SemesterPick | null = null, examCountdown = true;
  /** 有傳 settingsFirst 時，第一次讀到之前都是不知道（補紀錄缺口不把預設值寫成基準）。 */
  let settingsKnown = options.settingsFirst === undefined;
  /** applySettings 比 settingsFirst 先到：那份比較新，settingsFirst 不採用。 */
  let settingsApplied = false;
  function takeSettings(value: SettingsValue): void {
    settings = value.settings;
    semester = value.semester;
    examCountdown = value.examCountdown;
    settingsKnown = value.known;
  }
  /** 今天的學期（清晨 4 點換日，tasks/settings-page.md §4）；沒設定是 null。 */
  function currentTerm(): string | null {
    const at = now();
    return semester ? semesterOn(semester, scopeDate(dayOf(at, offsetOf(at)))) : null;
  }
  const delay = options.delay ?? 500;
  const writeTimeout = options.writeTimeout ?? 10_000;
  const report = (error: unknown, source: ErrorSource): void => {
    try { options.onError?.(error, source); } catch { /* 回呼的錯誤不影響狀態。 */ }
  };
  /** 舊紀錄裡用來認人的 t（tasks/record-gaps.md §4）：reviews 已濾掉被取消的，所以 cancelled 要另外看；取消行自己的 t 沒有東西用它認人。 */
  const taken = (t: string): boolean => history.cancelled.includes(t) || history.reviews.some(review => review.t === t) || history.changes.some(change => change.t === t);
  const unterminated = (path: string): boolean => { const text = sources.get(path); return !!text && !text.endsWith('\n'); };
  const writer = createLogWriter(files, { device, now, offset: offsetOf, onError: error => { report(error, 'write'); }, taken, unterminated });
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
  const unreadListeners = new Set<() => void>();
  const stuckAfter = options.stuckAfter ?? 30_000;
  function unreadChanged(): void {
    if (life.closed) return;
    if (life.loaded) snapshots.check();
    for (const listener of [...unreadListeners]) {
      try { listener(); } catch (error) { report(error, 'listener'); }
    }
  }
  const reads = createReads({
    files,
    life,
    delay,
    watched: path => isDeckPath(path) || (isLogPath(path) && !own(path)),
    onError: error => { report(error, 'read'); },
    batch,
    unreadable: path => { writes.unreadable(path); },
    stuckAfter,
    unreadChanged,
  });
  const unread = reads.unread;
  const exam = createExamFiles({
    files, delay, stuckAfter, writeTimeout, random: options.random,
    onError: error => { report(error, 'read'); },
    changed: examChanged,
    unreadChanged,
    logged: val => { record({ set: 'exam', val }); },
  });
  const quiz = createQuizFiles({
    files, delay, stuckAfter, writeTimeout, random: options.random, wait: EXAM_WAIT,
    onError: error => { report(error, 'read'); },
    changed: () => { if (life.loaded) notifyChange(); },
    unreadChanged,
    loaded: () => life.loaded,
    context() {
      const at = now();
      return {
        day: dayOf(at, offsetOf(at)),
        index: catalogIndex(),
        known(path) {
          const deck = deckMap.get(path);
          return deck && !deck.props.isTranscript ? { subject: deck.props.subject } : null;
        },
        resolve: options.resolveLink ?? (link => deckMap.has(link + '.md') ? { kind: 'file', path: link + '.md' } : { kind: 'none' }),
      };
    },
  });

  // 原始紀錄每一行的 lt 由紀錄模組算（history.seen，技術債 A1）；tracker 要 Set，照 history 物件的身分快取一個。
  let seenIds: { of: History; ids: Set<string> } | null = null;
  function logIds(): Set<string> {
    if (seenIds?.of !== history) seenIds = { of: history, ids: new Set(history.seen) };
    return seenIds.ids;
  }
  const tracker = createIdTracker({ random: options.random, logIds, partial: () => unread.size > 0, readable: deck => !needsUpdate(deck), reserved: options.reserved });

  /** 寫一行紀錄到這台當月的檔、併進 history；作答與版本行共用同一個有序寫入（syntax.md §5-1）。 */
  function record(entry: NewEntry): QueuedLine {
    const queued = writer.write(entry);
    sources.set(queued.path, (sources.get(queued.path) ?? '') + (unterminated(queued.path) ? '\n' : '') + queued.line + '\n');
    history = appendLine(history, queued.line);
    return queued;
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
  const observer = createObserver({ version, own: () => [...sources].filter(([path]) => own(path)), write: entry => { record(entry); } });
  const STATUS_TEXT = { draft: '草稿', active: '啟用', paused: '暫停' } as const;
  /** 這台現在看到的狀態與設定（tasks/record-gaps.md §1 的表）；無效的、不確定身分的不在裡面，上次的值不動。 */
  function observations(): Observation[] {
    const list: Observation[] = [];
    // deckList 已經不含需要新版的卡組；裡面和需要新版的卡組同 ID 的目標由 permits 擋。
    for (const { path, deck } of deckList) {
      const { props, targets } = deck;
      if (!props.isTranscript && props.statusRead !== 'invalid' && (props.statusRead === 'valid' || targets.length)) {
        list.push({ entry: { set: 'status', deck: path, val: STATUS_TEXT[props.status] }, baseline: true });
      }
      const skip = tracker.lines(path);
      for (const target of targets) {
        if (target.id === null || skip.has(target.line) || target.fields.statusInvalid) continue;
        const entry = { set: 'status', lt: target.id, val: target.fields.paused ? '暫停' : '啟用' } as const;
        if (permits(entry)) list.push({ entry, baseline: target.fields.paused });
      }
    }
    // data.json 還沒讀到時手上是預設值，不是使用者的設定：不比（tasks/settings-page.md §3）。
    if (settingsKnown) {
      list.push({ entry: { set: 'cap', val: settings.capMinutes }, baseline: true });
      list.push({ entry: { set: 'retention', val: settings.retention }, baseline: true });
      list.push({ entry: { set: 'filter', val: [...settings.filter] }, baseline: true });
      const term = currentTerm();
      if (term !== null) list.push({ entry: { set: 'semester', val: term }, baseline: true });
    }
    return list;
  }
  /** 偵測的唯一出口（§1）：第一次載入、每一批讀完的收尾、自己寫回被採用時都比一次。有讀不到的、紀錄不完整時不比，補齊後一定再比。 */
  function observe(): void {
    if (life.closed || unread.size || history.incomplete) return;
    observer.compare(observations());
  }
  /** 給 planToday 的卡組：拿掉待處理與用了重複 ID 的目標（W5 §8-5、D-157：不出題）。 */
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
      return entry.deck.targets.some(drop) ? { path: entry.path, deck: { ...entry.deck, targets: entry.deck.targets.filter(t => !drop(t)) }, whole: entry.deck.targets } : entry;
    });
  }
  /** 這個目標的紀錄讀得懂：不是讀不懂的紀錄行停掉的、紀錄不是不完整、不在需要新版的卡組裡（§5-2、§2-1）。 */
  const readableLog = (lt: string): boolean => !history.incomplete && !history.held.includes(lt) && !gatedIds.has(lt);
  /** 能寫這個目標新的作答與狀態變更：上面的門檻，加上它的 ID 沒有重複（D-157）。 */
  const answerable = (lt: string): boolean => readableLog(lt) && !tracker.isDuplicate(lt);
  /**
   * answer 能不能寫這一行。分類和 encodeEntry 同一個順序（Codex L2 的 F2）：有 undo 就是取消，看它指到的每一筆作答的紀錄門檻（多帶的欄位
   * 不寫出、也不看；找不到那一筆照舊寫；不因 ID 重複擋：不能只因重複就禁止撤銷先前的誤記，D-157）；有 set 是變更，學習目標看 lt，卡組的狀態是從卡組的內容得出的，需要新版的卡組不寫（§2-1）；
   * 其他是作答，看 lt。
   */
  function permits(entry: NewEntry): boolean {
    if ('undo' in entry) return history.reviews.every(review => review.t !== entry.undo || readableLog(review.lt));
    if ('set' in entry) return 'deck' in entry ? !gated.includes(entry.deck) : 'lt' in entry ? answerable(entry.lt) : true;
    return answerable(entry.lt);
  }
  /** 這一篇（state 最近讀到的內容，或給了的這份文字）需要新版：Cards 不寫它（§2-1）。 */
  const blockedText = (path: string, text?: string): boolean => gated.includes(path) || (text !== undefined && needsUpdate(parseDeck(text)));
  function notifyChange(): void {
    if (life.closed) return;
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { report(error, 'listener'); }
    }
  }
  /** 排今天的份，記下用的是哪一種考試範圍：之後比這個決定要不要重排（§4）。 */
  function plan(value: TodayInput): Today {
    const day = dayOf(value.now, value.offset);
    plannedKey = examPlanKey(day);
    viewedKey = examViewKey(day);
    const today = planToday(value);
    snapshots.check();
    return today;
  }
  function replan(): void {
    current = plan(input());
    notifyChange();
  }
  /** 存檔或家長選了之後，state 把這份文字當成這篇卡組現在的內容（tracker 已經比對過），立刻重排。 */
  function adopt(path: string): void {
    const text = tracker.text(path);
    if (text === undefined) return;
    deckMap.set(path, parseDeck(text));
    rebuild();
    // 先排入紀錄，再通知會讀新排程的畫面。
    observe();
    replan();
  }

  /** 單元索引：卡組或停掉的目標變了才重建；讀不懂的紀錄行停掉的目標看 history（syntax §5-2）。 */
  let indexed: { decks: DeckEntry[]; held: string; index: CatalogIndex } | null = null;
  function catalogIndex(): CatalogIndex {
    const held = history.incomplete ? '*' : history.held.join('\n');
    if (indexed?.decks !== planList || indexed.held !== held) indexed = { decks: planList, held, index: buildIndex(planList, id => history.incomplete || history.held.includes(id)) };
    return indexed.index;
  }
  /** 範圍換成 study 的 Pick：目標集合照現在的索引算，所以中途改暫停時總數跟著變。 */
  function studyPick(pick: StudyPick): Pick {
    if ('unit' in pick) {
      const targets = catalogIndex().unitTargets(pick.unit);
      return 'since' in pick ? { targets, since: pick.since } : { targets };
    }
    if ('deck' in pick && 'since' in pick) return { targets: catalogIndex().deckTargets(pick.deck), since: pick.since };
    return pick;
  }

  // ── 考試範圍（tasks/exam-scope.md §3、§4）──

  /** 選定的結果：內容或日子變了才重選。 */
  let selected: { day: number; revision: number; value: ReturnType<typeof exam.choose> } | null = null;
  function selection(day: number): ReturnType<typeof exam.choose> {
    if (selected?.day !== day || selected.revision !== exam.revision()) selected = { day, revision: exam.revision(), value: exam.choose(day) };
    return selected.value;
  }
  /** 範圍換成排程要的樣子：範圍或索引變了才重算，不新建物件。讀不懂的當成沒有範圍。 */
  let scoped: { file: ScopeFile; index: CatalogIndex; scope: ExamScope } | null = null;
  function examScope(day: number): ExamScope | null {
    const { chosen, usable } = selection(day);
    if (!chosen || !usable) return null;
    const index = catalogIndex();
    if (scoped?.file !== chosen.file || scoped.index !== index) {
      const ids = targetsInScope(chosen.file, index);
      scoped = { file: chosen.file, index, scope: { contains: (_entry, target) => target.id !== null && ids.has(target.id), hasPeriod: scopePeriod(chosen.file).kind === 'ok' } };
    }
    return scoped.scope;
  }
  /** 上一次排今天的份時的範圍（身分、單元、期間；不看路徑與字形：改名選到同一份、`L1` 改成 `l1` 不重排）與畫面看到的樣子。 */
  let plannedKey = '', viewedKey = '';
  function examPlanKey(day: number): string {
    const { chosen, usable } = selection(day);
    if (!chosen || !usable) return '';
    return JSON.stringify([chosen.file.id, scopeUnitKeys(chosen.file), scopePeriod(chosen.file)]);
  }
  function examViewKey(day: number): string {
    const { chosen, usable, others } = selection(day);
    const file = chosen?.file;
    return JSON.stringify([exam.settled(), usable, others, file ? [file.id, file.start, file.end, file.lines.map(line => [line.kind, line.raw])] : null]);
  }
  /** 範圍檔變了（§4）：單元、期間、生效變了才重排一次；只有看不懂的行數或另一份的路徑變了，只通知畫面；讀到同一份不會到這裡。 */
  function examChanged(): void {
    if (!life.loaded || life.closed) return;
    const at = now(), day = dayOf(at, offsetOf(at));
    if (examPlanKey(day) !== plannedKey) replan();
    else if (examViewKey(day) !== viewedKey) {
      viewedKey = examViewKey(day);
      notifyChange();
    }
    // 內容一樣的兩份範圍，換了選定不用重排，切面還是另一份（§2）。
    snapshots.check();
  }
  const unitList = (): ScopeUnit[] => catalogIndex().units.map(({ term, subject, code }) => ({ term: term ?? '', subject: subject ?? '', code: code ?? '' }));
  /** 這一刻該留下的考試切面（tasks/record-gaps.md §2）；條件都在這裡，等待之後再算一次，結果不同就不寫。紀錄檔讀不到不擋，切面用不到紀錄。 */
  function snapshotPlan(): SnapshotPlan | null {
    if (!life.loaded || life.closed || !exam.settled() || exam.unread.size || [...unread].some(path => !isLogPath(path))) return null;
    const at = now(), day = dayOf(at, offsetOf(at));
    const { chosen, usable } = selection(day);
    if (!chosen || !usable) return null;
    const period = scopePeriod(chosen.file);
    if (period.kind !== 'ok' || day < scopeDay(period.start) || day > scopeDay(period.end)) return null;
    const decks = [...deckMap].filter(([, deck]) => deckInScope(chosen.file, deck)).flatMap(([path]) => {
      const text = tracker.text(path);
      return text === undefined ? [] : [{ path, text }];
    }).sort((a, b) => a.path < b.path ? -1 : 1);
    if (!decks.length) return null;
    return { day, exam: chosen.file.id, scope: chosen.path, start: period.start, end: period.end, units: unitsOf(chosen.file), decks };
  }
  const snapshots = createSnapshots({
    files, device,
    closed: () => life.closed,
    plan: snapshotPlan,
    settle: async () => await writes.enqueue(() => writes.drain({ count: 0 }, true)) === null,
    drain: decide => exam.drain(EXAM_WAIT, decide),
    waiting: () => reads.waiting(),
    stamp: () => { const at = now(); return formatTime(at, offsetOf(at)); },
    onError: error => { report(error, 'write'); },
  });
  /** 範圍檔一次寫一件；還在讀、讀不到時不寫（§4）。輪到它時選定的已經不是畫面打開的那一份（前一筆結束了、被刪、改名、換了另一次考試）：不套上去（§6）。 */
  let examWrites: Promise<unknown> = Promise.resolve();
  function examWrite(opened: ExamTarget, work: (chosen: ReturnType<typeof exam.choose>['chosen'], day: number, admit: () => ExamBlocked | null) => Promise<ExamResult>): Promise<ExamResult> {
    // 選定的還是畫面上那份、也沒有讀不到的：決定要寫時問一次，真正寫之前再問一次（Codex L2 的 R17、R21）。關閉不在這裡問：已經開始寫的讓它寫完（R14）。
    const stale = (day: number): ExamBlocked | null => {
      if (exam.unread.size) return { kind: 'blocked', reason: 'unread' };
      const { chosen } = selection(day);
      return (chosen?.path ?? null) !== opened.path || (chosen?.file.id ?? null) !== opened.id ? { kind: 'blocked', reason: 'changed' } : null;
    };
    const today = (): number => { const at = now(); return dayOf(at, offsetOf(at)); };
    const run = examWrites.then((): ExamResult | Promise<ExamResult> => {
      if (life.closed) return { kind: 'blocked', reason: 'closed' };
      if (!life.loaded) return { kind: 'blocked', reason: 'loading' };
      if (!exam.settled() || exam.unread.size) return { kind: 'blocked', reason: 'unread' };
      return exam.drain<ExamResult>(EXAM_WAIT, known => {
        if (life.closed) return { kind: 'blocked', reason: 'closed' };
        if (!known) return { kind: 'blocked', reason: 'unread' };
        const day = today();
        return stale(day) ?? work(selection(day).chosen, day, () => stale(today()));
      });
    });
    examWrites = run.catch(() => {});
    return run;
  }

  function input(): TodayInput {
    if (!life.loaded) throw Error('state 還沒 ready');
    const at = now(), offset = offsetOf(at);
    return { decks: planList, history, settings, exam: examScope(dayOf(at, offset)), now: at, offset };
  }
  /** 換日或換時區就重排（W4 的 F3：日編號相同、時區不同也要重排）。 */
  function fresh(): { today: Today; input: TodayInput } {
    const value = input();
    if (!current || current.offset !== value.offset || current.day !== dayOf(value.now, value.offset)) {
      // 過了 2/1、8/1 學期自己變，data.json 沒變也不會有 applySettings（tasks/settings-page.md §3）。
      observe();
      current = plan(value);
    }
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
      if (life.loaded) {
        checkApp();
        // 內容和快取相同也要比：這一批可能正好補齊了讀不到的。
        observe();
      }
      if (life.loaded && (decksChanged || logsChanged)) replan();
      // 內容和快取相同也要查：這一批可能正好補齊了讀不到的。
      if (life.loaded) snapshots.check();
    };
  }

  /** 第一次載入時讀取那一列已經把錯誤交給 onError（read）：ready() 拒絕時不再報一次 init。 */
  let queueFailed = false;
  /**
   * 這個拒絕是 close() 造成的（Closed）。判斷本身也不能拋錯（Codex 再審的 F3）：拒絕的值可能是查原型就拋錯的 Proxy。
   * 拋錯時當成不是：照樣用原值報 init，原值照樣拒絕。
   */
  const closedBy = (error: unknown): boolean => {
    try { return error instanceof Closed; } catch { return false; }
  };
  const loadQueue = (paths: string[]): Promise<void> => reads.queue(() => reads.read(paths)).catch((error: unknown) => { queueFailed = true; throw error; });
  async function load(begin: number, deckPaths: string[], logPaths: string[]): Promise<LoadTimings> {
    // 範圍檔同時開始讀，正常情況第一次就排對；一直沒回來也不卡住 ready()（§4）。
    // 設定併進同一段等待，不串接第二段逾時（tasks/settings-page.md §3）。
    const firstSettings = options.settingsFirst?.then(value => { if (!settingsApplied && !life.closed) takeSettings(value); });
    const examRead = Promise.all([exam.settle(EXAM_WAIT), quiz.settle(EXAM_WAIT), firstSettings]);
    // 卡組一批、紀錄一批（自己的紀錄也讀），和之後的檔案變動走同一個 read。
    await loadQueue(deckPaths);
    const afterDecks = performance.now();
    await loadQueue(logPaths);
    const afterHistory = performance.now();
    if (life.closed) throw new Closed();
    await examRead;
    if (life.closed) throw new Closed();
    // 自己的紀錄都讀到時，版本行排在這次第一筆作答前：answer 要等 loaded 才能寫。
    checkApp();
    observe();
    life.loaded = true;
    current = plan(input());
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
  const prepare = (path: string, text: string): Prepared => withNeed(track(path, () => tracker.fill(path, text)), text, version);
  /** 備份的閘門（D-150 第 3 點）：要等備份的（電腦）一開始關著，backupReady(true) 才打開。 */
  let backupPending = options.backup === true;
  const writes = createWrites({ files, life, reads, fillIds: options.fillIds, writeTimeout, stuckAfter, prepare, wrote: (path, text) => { tracker.wrote(path, text); }, blockedText, backupPending: () => backupPending, version, skip: options.skip, displaced: options.displaced });
  function answerLine(entry: NewEntry): QueuedLine | null {
    if (!life.loaded) throw Error('state 還沒 ready');
    if (!permits(entry)) return null;
    const queued = record(entry);
    if ('undo' in entry && current && Date.parse(entry.undo) < dayStart(current.day, current.offset)) current = null;
    return queued;
  }

  /** 目錄的暫停／恢復與草稿的啟用（§7）：只改屬性區的 `狀態`，和補 ID 走同一條寫入。activate：只有草稿能改（改成啟用）；否則草稿不動。 */
  async function changeStatus(path: string, value: DeckStatusValue, editor: EditorHandle | null, activate: boolean): Promise<WriteResult | { kind: 'unwritable' }> {
    let unwritable = false;
    const plan = (text: string): Prepared | null => {
      // 這份文字可能比讀到的新：先當成新版本比對（和存檔的準備相同），不配新的 ID。
      track(path, () => { if (tracker.text(path) !== text) tracker.observe([{ path, text, deck: parseDeck(text) }], true); });
      if ((parseDeck(text).props.status === 'draft') !== activate) return null;
      const next = setStatusLine(text, value);
      if (next === null) unwritable = true;
      return next === null ? null : { text: next, expect: [], fresh: [], record: null, need: null, status: parseDeck(next).props.status };
    };
    const result = await writes.enqueue(() => editor ? writes.edit(editor, plan, { kind: 'unchanged' }) : writes.fillFile(path, plan));
    if (unwritable) return { kind: 'unwritable' };
    return result;
  }

  return {
    ready() {
      // 除了 close() 之外，讓 ready() 拒絕的每一條路都恰好經過一次 onError（tasks/error-log.md §2-3）：監看拋錯、首次排程
      // 這類讀取那一列以外的錯在這裡補報 init；讀取那一列已經報過的不再報；停用不是故障。停用看拒絕的原因（Closed），
      // 不看拒絕當下關閉了沒有：程式的錯之後同一輪又 close() 時照樣要報（Codex L2 的 R2）。
      loading ??= reads.start(load).catch((error: unknown) => {
        if (!closedBy(error) && !queueFailed) report(error, 'init');
        throw error;
      });
      return loading;
    },
    unread: () => [...new Set([...unread, ...exam.unread, ...quiz.unread])].sort(),
    deckStatus(path) {
      if (!life.loaded) return { missing: 0, issues: [], malformed: [] };
      if (gated.includes(path)) return { missing: 0, issues: [], malformed: [], needsUpdate: true };
      const status = tracker.status(path);
      // 手機不寫卡組（D-134），不用算。
      const mark = options.fillIds ? markOf(tracker.text(path), version) : null;
      return mark ? { ...status, mark } : status;
    },
    save: editor => writes.enqueue(() => writes.edit(editor, text => prepare(editor.path, text), { kind: 'unchanged' })),
    // 問題已經跟著改名搬到別的路徑：不是這個編輯器的那一篇，不準備（stale）。
    resolve: (issue, choice, editor) => writes.enqueue(() => writes.edit(editor, text => {
      if (issue.path !== editor.path) return null;
      const prepared = track(editor.path, () => tracker.resolve(issue, choice, text));
      return prepared && withNeed(prepared, text, version);
    }, { kind: 'stale' })),
    async fillIds(path) {
      const result = await writes.enqueue(() => writes.fillFile(path));
      // 寫不進去時照舊 reject（呼叫端交給 onError）；已配出的 ID 留在 seen、不重用。
      if (result.kind === 'failed') throw result.error;
      // 寫進檔、核對還沒讀到（saved）也算改了字，和原本「有改字回傳 true」相同（2026-10-29 和環節 4 的 session 確認）。
      return result.kind === 'done' || result.kind === 'saved';
    },
    setDeckStatus: (path, value, editor) => changeStatus(path, value, editor, false),
    activateDraft: (path, editor) => changeStatus(path, '啟用', editor, true),
    aiExisting(subject, term) {
      if (!life.loaded) return [];
      return existingTargets(deckList, subject, term, new Set([...tracker.duplicates().map(each => each.id), ...gatedIds]));
    },
    aiTarget(id) {
      if (!life.loaded || tracker.isDuplicate(id) || gatedIds.has(id)) return { kind: 'unusable' };
      const found = deckList.flatMap(entry => entry.deck.targets.filter(t => t.id === id).map(t => ({ path: entry.path, target: t })));
      if (!found.length) return { kind: 'none' };
      return found.length === 1 && found[0].target.ok ? { kind: 'one', path: found[0].path, name: found[0].target.name } : { kind: 'unusable' };
    },
    aiStopped(path) {
      const skip = life.loaded ? tracker.lines(path) : new Set<number>();
      return target => skip.has(target.line) || tracker.isDuplicate(target.id) || gatedIds.has(target.id) || history.incomplete || history.held.includes(target.id);
    },
    aiIds(count, avoid = []) {
      return writes.blockedNow() ?? tracker.allocate(count, avoid);
    },
    async aiWhere(ids) {
      const stopped = await writes.enqueue(() => writes.drain({ count: 0 }, true));
      if (stopped || !life.loaded || unread.size) return null;
      return tracker.where(ids);
    },
    aiRead: path => writes.readTimed(path),
    aiDisplaced: path => options.displaced?.(path) ?? false,
    aiCreate: (path, text) => writes.enqueue(() => writes.create(path, text)),
    aiCreateDeck: (path, text, ids, nameFree) => writes.enqueue(() => writes.create<'ids' | 'name'>(path, text, { check: () => tracker.where(ids).size || ids.some(id => logIds().has(id)) ? 'ids' : null, atWrite: () => nameFree() ? null : 'name' })),
    aiCreateSnapshot: (path, text, decks, nameFree) => writes.enqueue(() => writes.create<'decks' | 'name'>(path, text, {
      check: () => decks.some(deck => { const found = tracker.where(deck.ids); return deck.ids.some(id => !found.get(id)?.includes(deck.path)); }) ? 'decks' : null,
      atWrite: () => nameFree() ? null : 'name',
    })),
    writeBlock: () => writes.blockedNow(),
    backupReady(ready) { if (options.backup) backupPending = !ready; },
    removedInEditor(path, ids) { tracker.removed(path, ids); },
    restoredInEditor(_path, ids) { tracker.restored(ids); },
    decks: () => deckList,
    blocked: () => ({ decks: gated, targets: history.held, all: history.incomplete }),
    canAnswer: answerable,
    conflicts: () => life.loaded ? tracker.duplicates() : [],
    history: () => history,
    input,
    today: () => fresh().today,
    next(pick) {
      const { today, input: value } = fresh();
      const chosen = studyPick(pick);
      const next = nextCard(today, value, chosen);
      if (next.kind !== 'stale') return next;
      current = plan(value);
      return nextCard(current, value, chosen);
    },
    scope(pick) {
      const { today, input: value } = fresh();
      return scopeCount(today, value, studyPick(pick));
    },
    catalog() {
      const { today, input: value } = fresh();
      const { chosen, usable } = selection(dayOf(value.now, value.offset));
      return paintCatalog(catalogIndex(), memoryColors(value), todayLeft(today, value), usable ? chosen?.file : null, currentTerm());
    },
    deckTargets: path => life.loaded ? catalogIndex().deckTargets(path) : [],
    unitMaterials(path, term, code) {
      const subject = deckMap.get(path)?.props.subject ?? null;
      if (subject === null) return [];
      const unit = catalogIndex().find(term, subject, code);
      return (unit?.decks ?? []).map(deck => {
        const { materials = [], unit: own = null } = deckMap.get(deck.path)?.props ?? {};
        return { path: deck.path, materials, name: own?.name ?? '' };
      });
    },
    progress() {
      const { today, input: value } = fresh();
      return progress(today, value);
    },
    permits,
    answer: entry => answerLine(entry)?.t ?? null,
    answerLine,
    exam() {
      const at = now(), day = dayOf(at, offsetOf(at));
      const { chosen, usable, others } = selection(day);
      return { settled: exam.settled(), missing: exam.missing(), path: chosen?.path ?? null, file: chosen?.file ?? null, usable, others, period: chosen ? scopePeriod(chosen.file) : { kind: 'none' }, day, previousEnd: exam.previousEnd(day) };
    },
    examCatalog: () => life.loaded ? paintCatalog(catalogIndex(), new Map(), new Set(), null, currentTerm()) : null,
    examCheck(change) {
      if (!life.loaded) return null;
      const at = now();
      const { chosen } = selection(dayOf(at, offsetOf(at)));
      if (!chosen) return scopeCheck(parseScope(newScopeText({ id: 'x', add: change.add ?? [] })), catalogIndex());
      const edited = editScope(exam.text(chosen.path) ?? '', change, unitList());
      return scopeCheck(edited.kind === 'ok' ? parseScope(edited.text) : chosen.file, catalogIndex());
    },
    setExam(change, opened) {
      return examWrite(opened, (chosen, _day, admit) => chosen ? exam.update(chosen.path, opened.id, change, unitList(), admit) : exam.create(change));
    },
    endExam(opened) {
      return examWrite(opened, (chosen, day, admit) => chosen ? exam.update(chosen.path, opened.id, { ended: scopeDate(day) }, [], admit) : Promise.resolve({ kind: 'blocked', reason: 'changed' }));
    },
    quizzes: () => life.loaded ? quiz.rows() : [],
    setQuiz: (input, date, opened) => quiz.set(input, date, opened),
    cancelQuiz: opened => quiz.cancel(opened),
    applySettings(value) {
      if (life.closed) return;
      settingsApplied = true;
      const replans = JSON.stringify([settings.capMinutes, settings.retention, settings.filter]) !== JSON.stringify([value.settings.capMinutes, value.settings.retention, value.settings.filter]);
      const shows = JSON.stringify([semester, examCountdown]) !== JSON.stringify([value.semester, value.examCountdown]);
      takeSettings(value);
      if (!life.loaded) return;
      // 先採用、排入紀錄，再通知會讀新排程的畫面（tasks/record-gaps.md §1）；值變了或 known 由 false 變 true 都會走到。
      observe();
      if (replans) replan();
      else if (shows) notifyChange();
    },
    currentSettings: () => ({ settings, semester: currentTerm(), examCountdown, known: settingsKnown }),
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onUnread(listener) {
      unreadListeners.add(listener);
      return () => { unreadListeners.delete(listener); };
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
      exam.stop();
      quiz.stop();
      // 寫成、等核對的工作回 saved（已寫進磁碟的內容下次載入照實讀回）；在寫的那一份等結果明確，最多 writeTimeout（§5）。
      writes.stop();
      await writes.idle();
      // 範圍檔也一樣（Codex L2 的 R14）：寫成了紀錄要跟著寫進去；每次寫最多 writeTimeout，之後才寫成的不記。
      await examWrites;
      await quiz.idle();
      await reads.idle();
      await writer.flush();
    },
  };
}
// 裝置碼的純計算（W5 §4-2）：state 只能透過這裡使用（技術債 A7）。
export { deviceCode, isDeviceCode } from './device.ts';
export type { DevicePlatform } from './device.ts';
