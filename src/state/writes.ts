import type { Files } from '../core/files.ts';
import { isDeckPath } from '../core/deck/index.ts';
import { confirmed } from './ids.ts';
import type { Prepared } from './ids.ts';
import { completeText, incomplete } from './reads.ts';
import type { Life, Reads } from './reads.ts';

/**
 * 寫入（tasks/state-split.md §1）：Cards 改卡組的那一列、門檻、先讀完待讀、I/O 的開始與結束、核對讀取。
 * 準備（補 ID、還原、當成新的）與寫成後的採用由組合那一層（index.ts）傳進來；這裡不改卡組的資料、不重排。
 */

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

/** 不看是哪一篇的受阻原因，照門檻檢查的順序（writable）。 */
export type WriteBlock = 'phone' | 'loading' | 'closed' | 'restore' | 'backup' | 'unread';

/** Cards 改卡組的結果。 */
export type WriteResult =
  /** 核對讀取確認寫成了。added：這次新配上 ID、在核對採用的內容裡寫法沒有問題的目標數（寫錯的照樣配 ID，但不出題，技術債 D1；還原、當成新的不算）。 */
  | { kind: 'done'; added: number }
  /** 沒有要改的（含不是卡組）。 */
  | { kind: 'unchanged' }
  /**
   * 門檻沒過，沒有改字。needs-update：這一篇需要新版才讀得懂（任務說明 2-2）；backup：這台電腦還沒有一份成功的備份
   * （D-150 第 3 點，外掛內備份任務說明 §1-4）。
   */
  | { kind: 'blocked'; reason: WriteBlock | 'needs-update' }
  /** 途中換了篇、內容被改掉、問題已經不成立，或一直有新的變動：沒有採用，要再存一次。 */
  | { kind: 'stale' }
  /** 寫不進磁碟：輸出沒有採用，已配出的 ID 保留、不重用。 */
  | { kind: 'failed'; error: unknown }
  /** 已寫進磁碟，但核對時讀不到：state 自己重試，讀到後照核對採用。 */
  | { kind: 'saved' };

/**
 * 建檔前的核對（AI 製卡，tasks/ai-cards-mvp.md §5，R2-1）：check 在進入寫入回呼前與回呼裡各問一次，回傳不能建的原因（沒問題是 null）。
 * 回呼裡還有沒讀完的變動時，放棄這一次、讀完再來。
 */
export interface CreateGuard<Why extends string> {
  check: () => Why | null;
  /** 只在寫入回呼裡問、而且這個路徑沒有檔的時候（整個 vault 的檔名）；同路徑已有檔照舊回 exists。 */
  atWrite?: () => Why | null;
}

/**
 * 只建立的寫入的結果（tasks/ai-cards-mvp.md §5；和 core/ai 的 CreateResult 同一個形狀）。blocked：還沒寫。
 * unreadable：寫出去了，讀回失敗或一直沒回來（R3-5）：不算寫成也不算寫壞，之後重試時照實際的檔核對。
 */
export type CreateResult = { kind: 'done' } | { kind: 'exists' } | { kind: 'blocked'; reason: CreateBlock } | { kind: 'failed'; error: unknown } | { kind: 'unreadable'; path: string; error: unknown };
/** 只建立時不能建的原因：不看是哪一篇的，加上這個位置的系統資料夾不在原位、也沒搬回（R3-4）。 */
type CreateBlock = WriteBlock | 'displaced';

/** 建檔的回呼裡發現不能建（核對沒過，或還有沒讀完的變動）：中止 modify，不建立檔案。 */
class NotNow extends Error {}
/** fillIds 讀到空字串（不存在或空檔）時中止 modify，不建立檔案。 */
class NothingToFill extends Error {}
/**
 * 這份工作不寫了：逾時之後才輪到 modify 的回呼，或準備時關閉了。中止 modify，不改檔也不建立；回傳原文不夠，
 * 檔案不存在時那等於建立空檔。
 */
class Stopped extends Error {}

/** 先讀完待讀最多幾輪（§3 第 2 步）。 */
const DRAIN_ROUNDS = 5;

export interface WritesOptions {
  files: Files;
  life: Life;
  reads: Reads;
  /** 補學習目標 ID：電腦 true、手機 false（StateOptions.fillIds）。 */
  fillIds: boolean;
  /** 等一次寫進磁碟最多多久（毫秒）。 */
  writeTimeout: number;
  /** 直接讀一個檔最多等多久（毫秒）；和讀取層判定卡住的時間相同。 */
  stuckAfter: number;
  /** 離開筆記時的準備：組合那一層對最新的原文做 tracker.fill，觀察到的原文照常採用。 */
  prepare: (path: string, text: string) => Prepared;
  /** 核對讀取確認寫成了：把預期的輸出當成自己的寫回（tracker.wrote）。 */
  wrote: (path: string, text: string) => void;
  /** 這一篇（state 最近讀到的內容，或給了的這份文字）需要新版：Cards 不寫它（更新防線任務說明 2-2）。 */
  blockedText: (path: string, text?: string) => boolean;
  /** 這台電腦還沒有一份成功的備份：Cards 不改寫卡組（D-150 第 3 點）。 */
  backupPending: () => boolean;
  /** 這台讀得懂的版本（releaseOf）；不明是 null。核對標記用（tasks/question-type-seam.md §3）。 */
  version: string | null;
  /** 搬錯位置的系統資料夾裡的檔（StateOptions.skip）：不是卡組。 */
  skip?: (path: string) => boolean;
  /** 這個位置的系統資料夾不在原位、也沒搬回（StateOptions.displaced）。 */
  displaced?: (path: string) => boolean;
}

export function createWrites(options: WritesOptions) {
  const { files, life, reads, writeTimeout, stuckAfter, prepare, blockedText } = options;
  /**
   * 寫成、等核對讀取的工作（§4 第 3 點），照路徑。output 是 null 時沒有改字（沒有要補的、或準備時問題已不成立），
   * 只等這次讀取、回傳 fallback。讀不到時先回 saved，核對留著，之後第一次讀到時照同一套規則採用（不重新配號、不重做交易）。
   */
  const checks = new Map<string, { output: string | null; prepared: Prepared | null; fallback: WriteResult; settle: (result: WriteResult) => void }>();
  /** Cards 改卡組的那一列（§3）：一次只做一份；卡住的寫入只擋後面的寫入，不擋讀檔與複習。 */
  let writes: Promise<unknown> = Promise.resolve();
  /** 外掛內的還原正在做（tasks/plugin-restore.md §3-2）：這段時間排到的寫入都回受阻。 */
  let restoring = false;
  /**
   * 正在 I/O 的那一份工作，從 begin 到 end：close() 等它結束（§5）。從 begin 就開始算，不是從呼叫 persist 才算：
   * editor.apply()、editor.persist() 裡可能同步 close()（Codex L2 再審的 R2 續）。中間只有寫進磁碟那一步會等，那一步有 writeTimeout。
   */
  let active: Promise<void> | null = null;
  let finish: (() => void) | null = null;

  /**
   * 門檻裡不看是哪一篇的部分，依 state 目前所知（State.writeBlock 也用這一份，存檔按鈕的說明和按下的結果照同一個順序）：
   * 只在電腦（D-134）、讀完之後、還沒關閉、這台電腦有一份成功的備份（D-150 第 3 點），而且沒有讀不到的卡組或紀錄
   * （state-load §3：占用資訊不完整時，不能把「不知道」當成「沒用過」）。
   */
  function blockedNow(): WriteBlock | null {
    if (!options.fillIds) return 'phone';
    if (!life.loaded) return 'loading';
    if (life.closed) return 'closed';
    if (restoring) return 'restore';
    if (options.backupPending()) return 'backup';
    if (reads.unread.size) return 'unread';
    return null;
  }
  /**
   * 寫入的門檻（§3 第 3 步）：可以時回傳 null，不行時回傳原因。先看 blockedNow；不是卡組就沒有要改的；需要新版的卡組
   * 不寫（任務說明 2-2，給了 text 時也看這份最新的文字）。之後要加的原因（多檔工作的預留還沒載入）都加在這裡，不分散到各個入口。
   */
  function writable(path: string, text?: string): WriteResult | null {
    const reason = blockedNow();
    if (reason) return { kind: 'blocked', reason };
    if (!isDeckPath(path) || options.skip?.(path)) return { kind: 'unchanged' };
    // 需要新版的卡組（任務說明 2-2、syntax.md §2-1）：state 最近讀到的，或這次要寫的最新文字，任何一邊讀不懂都不寫。
    if (blockedText(path, text)) return { kind: 'blocked', reason: 'needs-update' };
    return null;
  }
  /** 有已知還沒讀完的變動：一批讀取正在進行，或 pending 裡有不在 unread 的路徑（except 那一篇除外）。 */
  const waiting = reads.waiting;
  /** 排進寫入的那一列；排隊時就記下對象，輪到時才取最新的文字。 */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = writes.then(job);
    // 失敗由 next 交回排這份工作的呼叫端；這一列只是接著排下一份。
    writes = next.catch(() => {});
    return next;
  }
  /**
   * 先讀完已知的待讀（最多 DRAIN_ROUNDS 輪，rounds 由呼叫端累計）：讀完是 null；關閉了或讀不完回傳原因。
   * giveUp（AI 製卡）：讀取被判定卡住就停，回受阻的原因，放開寫入的那一列（R2-5，iCloud 佔位檔的讀取可能一直不回來）。
   * relevant：只等這些路徑（考試切面不等月檔）。讀取在同一列排隊，卡住的那一批沒結束前後面的讀不了，所以「判定卡住就停」仍看全部的 unread。
   */
  async function drain(rounds: { count: number }, giveUp = false, relevant?: (path: string) => boolean): Promise<WriteResult | null> {
    while (relevant ? reads.waitingFor(relevant) : waiting()) {
      if (life.closed) return { kind: 'blocked', reason: 'closed' };
      if (giveUp && reads.unread.size) return { kind: 'blocked', reason: 'unread' };
      if (rounds.count >= DRAIN_ROUNDS) return { kind: 'stale' };
      rounds.count++;
      // 已經排好的 delay 計時不用取消：到時 pending 是空的就什麼都不做。
      await (giveUp ? reads.readOrStuck() : reads.readNow());
    }
    return null;
  }
  /**
   * 第 1～3 步：已關閉、先讀完已知的待讀（包括這一篇；最多 DRAIN_ROUNDS 輪，rounds 跨過 fillIds 的重來累計）、門檻。
   * 回傳 null 時可以開始 I/O；呼叫端接著同步開始，中間不能有 await。
   */
  async function admit(path: string, rounds: { count: number }): Promise<WriteResult | null> {
    if (life.closed) return { kind: 'blocked', reason: 'closed' };
    // 手機、還沒 ready、不是卡組：不用先讀。讀不到、需要新版要看讀到的內容：先讀完待讀再判斷（待讀裡可能就是改回來的那一篇）。
    const early = writable(path);
    if (early && !(early.kind === 'blocked' && (early.reason === 'unread' || early.reason === 'needs-update'))) return early;
    return await drain(rounds) ?? writable(path);
  }
  /** 第 4 步：這篇的 I/O 開始（§2 第 1 點）。卡組以外的檔（AI 製卡的原文與快照）不經過讀取層，只記正在 I/O。 */
  function begin(path: string): void {
    if (isDeckPath(path)) reads.hold(path);
    active = new Promise(resolve => { finish = resolve; });
  }
  /**
   * 第 5 步等一次寫進磁碟（§3 最後一段）：最多等 writeTimeout，超過就當成失敗（錯誤寫明逾時），照第 6 步結束 I/O、放行後面的寫入。
   * 它之後才完成，也不採用這份工作的輸出；寫進磁碟的內容會送通知，照一般的讀取處理（配出的 ID 已在 seen，不會被當成換了 ID）。
   * 代價：還原或當成新的在逾時之後才寫成時，可能多出一個待處理問題，要家長再選一次。
   */
  function persist(work: Promise<void>): Promise<void> {
    return within(work, writeTimeout, `寫進磁碟超過 ${String(writeTimeout)} ms 沒有回來（逾時），當成失敗`);
  }
  function within<T>(work: Promise<T>, ms: number, late: string): Promise<T> {
    let id: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { id = setTimeout(() => { reject(Error(late)); }, ms); });
    return Promise.race([work, timeout]).finally(() => { clearTimeout(id); });
  }
  /**
   * 直接讀一個檔（AI 製卡的原文、快照、寫好之後的讀回），最多等 stuckAfter（R3-5）：這些檔不在 state 的監看裡，沒有別的地方會判定它卡住。
   * 沒回來就丟錯，呼叫端當成讀不到，放開工作與寫入的那一列；底層的讀取取消不了，晚回來的結果沒有人用。
   */
  function readTimed(path: string): Promise<string | null> {
    return within(files.read(path), stuckAfter, `讀 ${path} 超過 ${String(stuckAfter)} ms 沒有回來`).then(text => completeText(path, text));
  }
  /**
   * 還原的獨占時段（§3-2）：呼叫的當下就關閘門，正在跑的那一份做完才輪到 work。還沒開始的、還原期間才排進來的，輪到時都回受阻；
   * 放開排在它們後面，不論成敗。
   */
  /** 等 work，最多等 stuckAfter（L2 的 R6）：底層的讀取可能一直不回來，等不到的之後照一般的讀取處理。 */
  function atMost(work: Promise<void>): Promise<void> {
    let id: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>(resolve => { id = setTimeout(resolve, stuckAfter); });
    return Promise.race([work, late]).finally(() => { clearTimeout(id); });
  }
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (restoring) throw Error('已經在還原');
    restoring = true;
    try { return await enqueue(work); } finally { await enqueue(() => { restoring = false; return Promise.resolve(); }); }
  }
  /**
   * 還原寫一篇卡組（§3-3 第 6 點）：I/O 期間讀取不跨過，寫成之後把讀回的文字當成自己的寫回（tracker.wrote），
   * 舊版本有、備份沒有的 ID 不算弄丟，不多出待處理的問題。
   */
  async function restoreDeck(path: string, write: () => Promise<boolean>): Promise<boolean> {
    begin(path);
    const mine = finish;
    try {
      const done = await write();
      if (done) {
        const text = await readTimed(path);
        if (text !== null) options.wrote(path, text);
      }
      return done;
    } finally {
      // 逾時之後才回來時別的工作可能已經開始（L2 的 R2）：只收自己的，不清掉別人的 active。
      if (finish === mine) end(path);
      else { mine?.(); reads.unhold(path); reads.reread(path); }
    }
  }
  /** 第 6 步（finally，不論結果）：I/O 結束，序號前進，把這篇放進 pending、立刻讀（不等 delay）。 */
  function end(path: string): void {
    const deck = isDeckPath(path);
    if (deck) reads.unhold(path);
    finish?.();
    finish = null;
    active = null;
    if (deck) reads.reread(path);
  }
  /**
   * 只建立新檔（AI 製卡的原文、卡組與快照，tasks/ai-cards-mvp.md §5）：同一列、同樣不看是哪一篇的門檻（電腦、讀完、沒關閉、備份成功、沒有讀不到的）；
   * 已經有檔（含零位元組的空檔）不動、回 exists。寫好再讀一次，一字不差才是 done；讀回來不同回 failed，讀不到或一直沒回來回 unreadable（之後重試時照實際的檔核對）。
   * guard（建卡組與快照時給）：先讀完已知的變動再核對，寫入回呼裡再核對一次（L2-2、R2-1：改名、搬移、同步都是先有事件才讀檔，排隊與等回呼的期間都可能再來）。
   * 核對沒過回 refused、不建；回呼裡還有沒讀完的變動就放棄這一次、讀完再來，最多 DRAIN_ROUNDS 輪。門檻在回呼裡也再問一次（R3-1）：blocked 一定是還沒寫。
   */
  function create(path: string, text: string): Promise<CreateResult>;
  function create<Why extends string>(path: string, text: string, guard: CreateGuard<Why>): Promise<CreateResult | { kind: 'refused'; why: Why }>;
  async function create<Why extends string>(path: string, text: string, guard?: CreateGuard<Why>): Promise<CreateResult | { kind: 'refused'; why: Why }> {
    const rounds = { count: 0 };
    const blocked = (): CreateBlock | null => blockedNow() ?? (options.displaced?.(path) ? 'displaced' : null);
    for (;;) {
      if (life.closed) return { kind: 'blocked', reason: 'closed' };
      if (guard && await drain(rounds, true)) return { kind: 'blocked', reason: life.closed ? 'closed' : 'unread' };
      const reason = blocked();
      if (reason) return { kind: 'blocked', reason };
      let why = guard?.check() ?? null;
      if (why !== null) return { kind: 'refused', why };
      begin(path);
      let exists = false, live = true, again = false, gate: CreateBlock | null = null;
      try {
        await persist(files.modify(path, (current, has) => {
          // 逾時之後才輪到回呼：中止，不建立（同 fillFile 的 Stopped）。
          if (!live || life.closed) throw new Stopped();
          if (has) { exists = true; return current; }
          // 等回呼的期間門檻也可能變了（R3-1）：剛讀失敗的卡組或紀錄不在 waiting 裡，占用的索引卻可能還缺著它，不能當成沒有人用。
          gate = blocked();
          if (gate) throw new NotNow();
          if (guard) {
            if (waiting(path)) { again = true; throw new NotNow(); }
            why = guard.check() ?? guard.atWrite?.() ?? null;
            if (why !== null) throw new NotNow();
          }
          return text;
        }));
      } catch (error) {
        if (!(error instanceof NotNow)) return error instanceof Stopped ? { kind: 'blocked', reason: 'closed' } : { kind: 'failed', error };
      } finally {
        live = false;
        end(path);
      }
      if (gate) return { kind: 'blocked', reason: gate };
      if (why !== null) return { kind: 'refused', why };
      if (again) {
        if (rounds.count >= DRAIN_ROUNDS) return { kind: 'blocked', reason: 'unread' };
        rounds.count++;
        continue;
      }
      if (exists) return { kind: 'exists' };
      try {
        const back = await readTimed(path);
        return back === text ? { kind: 'done' } : { kind: 'failed', error: Error(`讀回來和寫的不同：${path}`) };
      } catch (error) {
        // 讀不到或一直沒回來：不算寫成，交回呼叫端；之後重試時照實際的檔核對（tasks/ai-cards-mvp.md §5〈中斷與重試〉）。
        return { kind: 'unreadable', path, error };
      }
    }
  }
  /** 第 6、7 步：登記這份寫入的核對，等核對讀取（end 已經排好）。 */
  function verify(path: string, original: string, prepared: Prepared | null, fallback: WriteResult): Promise<WriteResult> | WriteResult {
    const output = prepared && prepared.text !== original ? prepared.text : null;
    // 關閉時在寫的：等到結果明確了，不登記核對、不採用（§5）；有改字是 saved。
    if (life.closed) return output === null ? fallback : { kind: 'saved' };
    return new Promise(settle => { checks.set(path, { output, prepared, fallback, settle }); });
  }
  /** 沒開著的檔（離開筆記補 ID、目錄的暫停／恢復）：在 modify 的回呼裡對最新的原文準備（W5 §8-2 第 4 點）；plan 回傳 null 是沒有要改的。 */
  async function fillFile(path: string, plan: (text: string) => Prepared | null = text => prepare(path, text)): Promise<WriteResult> {
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
          prepared = plan(text);
          // 準備時監聽者可能 close()（見 edit）：不寫。
          if (life.closed) throw new Stopped();
          return prepared ? prepared.text : text;
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
      // 編輯器開著讀到不完整的檔時，文字不經過 Files（L2 待釐清的第一項）：和讀到的一樣不採用、不寫回。
      if (incomplete(text)) return { kind: 'blocked', reason: 'unread' };
      // 編輯器最新的文字也過一次門檻：需要新版（state 還沒讀到）就不寫（§2-1）。
      const gate = writable(path, text);
      if (gate) return gate;
      const prepared = plan(text);
      // plan 觀察到新的原文時會同步通知監聽者（adopt → replan），監聽者或 onError 可能在裡面 close()（Codex L2 的 R2）：
      // 這時還沒改編輯器、還沒寫，停下來；close() 不用等這一份。
      if (life.closed) return { kind: 'blocked', reason: 'closed' };
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
    enqueue,
    drain,
    edit,
    fillFile,
    create,
    readTimed,
    blockedNow,
    exclusive,
    restoreDeck,
    /**
     * 核對讀取（§4 第 3 點）：讀到的和預期的輸出一字不差，或預期的變更都在（家長在這段時間又打了別的字），先套用延後的記錄、
     * 把預期的輸出當成自己的寫回，讀到的文字再照組合那一層一般的重讀比對；預期不成立、讀到 null（不見了或改名，不跟著 A2 的改名配對寫到別篇）
     * 都照一般的重讀處理，回 stale。
     */
    verified(path: string, text: string | null): void {
      const check = checks.get(path);
      if (!check) return;
      checks.delete(path);
      if (text === null) check.settle({ kind: 'stale' });
      else if (check.output === null || !check.prepared) check.settle(check.fallback);
      else {
        // 一字不差時預期的變更當然都在；新增的數照讀到的這份算，不照準備時的（技術債 D1，Codex L2 的 F1）。
        const added = confirmed(text, check.prepared, options.version);
        if (added === null) { check.settle({ kind: 'stale' }); return; }
        check.prepared.record?.();
        options.wrote(path, check.output);
        check.settle({ kind: 'done', added });
      }
    },
    /** 這篇這次讀不到：等核對的先回 saved（沒改字的回原本的結果），核對留著，之後第一次讀到時照同一套規則採用。 */
    unreadable(path: string): void {
      const check = checks.get(path);
      check?.settle(check.output === null ? check.fallback : { kind: 'saved' });
    },
    /** 關閉（§5）：寫成、等核對的工作回 saved（已寫進磁碟的內容下次載入照實讀回），沒改字的回原本的結果。 */
    stop(): void {
      for (const check of checks.values()) check.settle(check.output === null ? check.fallback : { kind: 'saved' });
      checks.clear();
    },
    /** 正在 I/O 的那一份工作；close() 等它結束，最多 writeTimeout（§5）。 */
    idle: (): Promise<void> | null => active,
    atMost,
  };
}
