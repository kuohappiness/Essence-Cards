import { folderIssues, folderLabel, guardedMoves, isDeckPath, misplacedFolders, presentFolders } from '../core/deck/index.ts';
import type { FolderIssue } from '../core/deck/index.ts';
import type { Files } from '../core/files.ts';

// 系統資料夾的防呆（tasks/system-folder-guard.md）：Obsidian 裡搬動或改名就搬回（§1），Obsidian 以外的在提醒一區寫出位置（§2）。
// 這裡不碰 obsidian 的執行期：vault 的操作經過 GuardHost（folder-host.ts 接上 Obsidian，測試用替身）。

/** 資料夾本身（Obsidian 的 TFolder）：只有 GuardHost 認得，防呆只拿來問位置、搬動。 */
export type FolderRef = object;

export interface GuardHost {
  /** vault 裡所有檔的路徑。 */
  files(): string[];
  /** Obsidian 的清單裡有這個資料夾或檔（vault.getAbstractFileByPath）。 */
  known(path: string): 'folder' | 'file' | null;
  /**
   * 這個位置的資料夾本身；不是資料夾是 null。在 Obsidian 裡改名、搬動（含上一層）時還是同一個，位置跟著換；Obsidian 以外搬動、
   * 刪掉再建的是另一個（Codex L2 第四輪）。
   */
  folder(path: string): FolderRef | null;
  /** 資料夾現在的位置；已經不在 vault 裡（Obsidian 以外搬走、刪掉）是 null。 */
  where(folder: FolderRef): string | null;
  /** 磁碟上有沒有（iCloud 留下的空資料夾 Obsidian 看不到，§1-3、R5）。 */
  exists(path: string): Promise<boolean>;
  /** 磁碟上這個資料夾完全是空的（沒有檔、也沒有子資料夾）。 */
  empty(path: string): Promise<boolean>;
  /** 刪掉空的資料夾（非遞迴：有東西就失敗）。 */
  rmdir(path: string): Promise<void>;
  /**
   * 磁碟上那個位置還是這個資料夾：Obsidian 清單裡它底下的每一項，磁碟上都在（Codex L2 第五輪）。Obsidian 漏掉 Obsidian 以外的替換時
   * （W10 遇過），清單還指著舊的資料夾，搬動卻照路徑碰磁碟：搬之前先比對，對不上就不搬。
   */
  intact(folder: FolderRef): Promise<boolean>;
  /** 把資料夾本身搬到 to（fileManager.renameFile：和檔案列拖動同一條路，連結跟著改）。不照路徑找：同一個位置換了資料夾也不會搬錯。 */
  move(folder: FolderRef, to: string): Promise<void>;
  notify(message: string): void;
  /** 交給錯誤紀錄（D-155）。 */
  fail(error: unknown): void;
  /** 這台記住看過的系統資料夾（saveLocalStorage，§2-1）。 */
  load(): string[];
  save(folders: string[]): void;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** 這一輪事件都收齊之後再跑（setTimeout 0）。 */
  defer(run: () => void): void;
  /** ms 之後跑 run（搬回的總時限）；回傳取消的函式。 */
  later(ms: number, run: () => void): () => void;
}

export interface FolderGuard {
  /**
   * vault 的 rename 事件，要在 state 的監看之前收到（先註冊）：同一批的通知才擋得住。所有資料夾的改名都要送進來：
   * 判斷出來搬錯位置的跟著換（Codex L2 第三輪 F1）。ref 是事件帶來的資料夾本身（第五輪）；沒給時照 path 在收到的當下找。
   */
  renamed(path: string, oldPath: string, folder: boolean, ref?: FolderRef): void;
  /** vault 有新增、刪除、改名：等一下重新判斷（§2-2）。 */
  changed(): void;
  /** 重新判斷（layout ready 時呼叫一次）。 */
  check(): void;
  issues(): readonly FolderIssue[];
  /** 提醒的「搬回原位」按鈕（§5 第 1 題）：只有找到一個位置的那一種。 */
  moveBack(issue: FolderIssue): Promise<boolean>;
  /** 提醒的「不用了」：拿掉這台的記憶（§2-4）。 */
  dismiss(folder: string): void;
  /** 給 state 的檔案存取：搬回期間的通知先擋住、搬好了再送（§1-8）；搬錯位置的資料夾裡的檔不列、讀不到（§2-3）。 */
  wrap(files: Files): Files;
  /**
   * 真正碰檔案之前問（obsidian/files.ts，Codex L2 第二輪 F1）：path 正在搬回時回傳那一筆結束的 Promise，等完再問一次；
   * 沒有時回傳 null，呼叫端要在同一個同步段落裡開始 I/O，中間不能有 await。folder 是列一個資料夾底下（'' 是整個 vault）。
   */
  pause(path: string, folder?: boolean): Promise<void> | null;
  /** 這個檔在搬錯位置的資料夾裡：不當卡組（StateOptions.skip）。 */
  misplaced(path: string): boolean;
  /** 這個路徑的上層有系統資料夾已知不在原位、也沒搬回，或原位不見了又找不到：原位讀到「沒有」不代表真的沒有（AI 製卡，R3-4、R4-1）。 */
  displaced(path: string): boolean;
  /** issues() 變了。 */
  onChange(listener: () => void): () => void;
  /** 停用：不再開始新的搬回（待重試的停下、通知家長自己拖回），擋住的讀寫放行。 */
  close(): void;
}

/** 搬回的重試（§1-4）：iCloud 改名後約 1 秒內鎖住。 */
const RETRY_EVERY = 200;
const RETRY_FOR = 10_000;
/**
 * 一次搬回最多擋多久（Codex L2 第二輪 F5）：重試的 10 秒加上搬之前的檢查；某一步一直沒回來也照這個時間放行、請家長自己拖回。
 * 放行不等於底層的搬動取消了：之後才搬好的，照 rename 事件重新判斷。
 */
const HOLD_LIMIT = 12_000;
/** 搬回後看幾次 iCloud 留下的空資料夾（§1-5，搬回後幾毫秒）。 */
const CLEANUP_AT = [3000, 6000, 10_000];
/** 收到檔案變動後等多久才重新判斷。 */
const CHECK_DELAY = 500;

const NOTICE = (folder: string): string => `Essence Cards：「${folderLabel(folder)}」是外掛用的資料夾，不能搬動或改名，已經搬回原位`;
const OCCUPIED = (folder: string, at: string): string => `Essence Cards：「${folderLabel(folder)}」是外掛用的資料夾，原位已經有一個同名的，沒有搬回。請把「${at}」裡的檔搬進「${folder}」`;
const GAVE_UP = (folder: string): string => `Essence Cards：「${folderLabel(folder)}」是外掛用的資料夾，沒能搬回原位，請把它拖回「${folder}」`;

/** iCloud 鎖住時的錯誤（R4 是 EPERM）；其他錯誤（已經有同名的……）不重試。 */
function locked(error: unknown): boolean {
  // 查欄位就拋錯的值（不准查原型的 Proxy）當成不是鎖住。
  try {
    const code = (error as { code?: unknown } | null)?.code;
    const message = error instanceof Error ? error.message : '';
    return (typeof code === 'string' && /^E(PERM|BUSY)$/.test(code)) || /\bE(PERM|BUSY)\b/.test(message);
  } catch { return false; }
}

const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(folder + '/');
const parentOf = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
/**
 * 系統資料夾的原位，而且底下的筆記本來就不是卡組（isDeckPath）：落在這裡的照那個資料夾的規則，不必排除（第四輪 F1c）。
 * Essence Cards 根資料夾也在名單裡，但根層的 .md 是卡組，不算（第五輪）。
 */
const ownRules = (path: string): boolean => guardedMoves([path]).length > 0 && !isDeckPath(path + '/_.md');

/**
 * 正在搬回的一筆：原位（from）、收到 rename 時的暫時位置（to）與資料夾本身（ref）。搬好了或放棄了 done 才完成，等著的讀寫接著做
 * （§1-8）。資料夾現在在哪裡問 ref（Codex L2 第四輪）：搬回期間家長又改名、拖回原位，都照它現在的位置。
 */
interface Hold { from: string; to: string; ref: FolderRef | null; done: Promise<void>; finish: () => void }

function hold(from: string, to: string, ref: FolderRef | null): Hold {
  let finish = (): void => {};
  const done = new Promise<void>(resolve => { finish = resolve; });
  return { from, to, ref, done, finish };
}

/** 沒搬回的資料夾：原位（from）與資料夾本身（ref）。 */
interface Stray { from: string; ref: FolderRef }

/**
 * 'stopped'：停用或超過總時限，這一筆已經放行，不再往下做。'back'：家長已經把它拖回原位（第四輪 F1a），不搬、不通知、不記。
 * 'gone'：上一層不在，或資料夾已經不在 vault 裡（Obsidian 以外搬走、刪掉），交給 §2-2 的判斷。
 */
type Result = 'done' | 'back' | 'occupied' | 'gone' | 'failed' | 'stopped';

export function createFolderGuard(host: GuardHost): FolderGuard {
  /** 正在搬回的。 */
  const holds: Hold[] = [];
  /** 這一輪收到的系統資料夾改名（還沒處理）。 */
  let batch: Hold[] = [];
  /** 擋住的通知，搬好了照順序送。 */
  const held: string[] = [];
  const watchers = new Set<(path: string) => void>();
  const listeners = new Set<() => void>();
  let remembered = host.load();
  let current: FolderIssue[] = [];
  /** 判斷出來搬錯位置的資料夾（§2-2）：找到的位置（at）與原位（from）。 */
  let judged: { from: string; at: string }[] = [];
  /**
   * 沒搬回的資料夾（Codex L2 第二輪 F1、第四輪）：放行的那一刻就不當卡組，不等其他搬回結束才判斷；改成別的名字的（§2-2 只找同名）
   * 也算。位置每次問資料夾本身，所以之後在 Obsidian 裡再改名、上一層改名都跟著走，拖回原位、Obsidian 以外搬走就不再排除，舊位置
   * 再建的資料夾是另一個，不會被當成它。判斷時拿掉已經不在、或回到原位的。只記在記憶體。
   */
  let stranded: Stray[] = [];
  /** 上一次算出來不當卡組的資料夾：只用來找出變了的，讓 state 重讀（判斷本身每次重算，hidden）。 */
  let excluded: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  /** layout ready 之後第一次 check() 才開始：之前 vault 的清單還不完整。 */
  let started = false;

  /** 資料夾現在的位置；認不得資料夾本身時（收到 rename 時還找不到）是收到時的位置。 */
  const placeOf = (move: Hold): string | null => move.ref ? host.where(move.ref) : move.to;
  /** 這一筆會碰到的位置：原位、收到時的暫時位置、資料夾現在的位置（第四輪 F1b：搬回期間又改名的新位置也等）。 */
  const spots = (move: Hold): string[] => {
    const at = placeOf(move);
    return at === null ? [move.from, move.to] : [move.from, move.to, at];
  };
  /** 這一筆擋住 path 這個檔。 */
  const onPath = (path: string) => (each: Hold): boolean => spots(each).some(at => inside(path, at));
  /** 這一筆擋住列 folder 底下（'' 是整個 vault）：兩邊有一邊在另一邊裡面。 */
  const onFolder = (folder: string) => (each: Hold): boolean =>
    spots(each).some(at => folder === '' || inside(at, folder) || inside(folder, at));
  const holding = (path: string): boolean => holds.some(onPath(path));
  /** 沒搬回的資料夾現在的位置；不在 vault 裡是 null。 */
  const strayAt = (each: Stray): string | null => host.where(each.ref);
  /**
   * 不當卡組的位置：判斷出來的，加上沒搬回、還在 vault 裡的。落在某個系統資料夾原位的不算：那裡的檔照那個資料夾的規則（系統資料夾
   * 裡的 .md 本來就不是卡組），別台同步來的紀錄照樣讀得到（第四輪 F1c）；它之後再搬出去又會排除。
   */
  const unite = (): string[] => [...new Set([...judged.map(each => each.at), ...stranded.flatMap(each => {
    const at = strayAt(each);
    return at === null || at === each.from || ownRules(at) ? [] : [at];
  })])];
  const hidden = (path: string): boolean => unite().some(folder => inside(path, folder));
  /**
   * 擋住的搬回都結束了才做 run（§1-8）：state 的讀寫不管是搬動前就排好的、作答或存檔才開始的，都在搬好之後照原位做；放棄了就照
   * 搬錯位置的規則（release 先排除才放行）。最後一次確認沒有擋住和 run 在同一個同步段落：中間不會又開始一筆（第二輪 F1）。
   */
  async function when<T>(covers: (each: Hold) => boolean, run: () => Promise<T>): Promise<T> {
    for (let found = holds.find(covers); found; found = holds.find(covers)) await found.done;
    return run();
  }
  const emit = (path: string): void => {
    for (const watcher of [...watchers]) {
      try { watcher(path); } catch (error) { host.fail(error); }
    }
  };

  /** 重算不當卡組的資料夾；變了的那幾個資料夾裡的檔讓 state 重讀一次（讀不到就拿掉，回來了就讀進來）。 */
  function refresh(files: string[] = host.files()): void {
    const next = unite();
    const flipped = [...excluded.filter(f => !next.includes(f)), ...next.filter(f => !excluded.includes(f))];
    excluded = next;
    for (const path of files) if (flipped.some(folder => inside(path, folder))) emit(path);
  }

  /** 不會拋錯（計時器、release、按鈕都會呼叫）：讀不到清單、存不了記憶時交給錯誤紀錄。 */
  function check(): void {
    try { judge(); } catch (error) { host.fail(error); }
  }

  function judge(): void {
    if (closed || !started || holds.length) return;
    const files = host.files();
    const seen = presentFolders(files);
    const added = seen.filter(folder => !remembered.includes(folder));
    if (added.length) { remembered = [...remembered, ...added]; host.save(remembered); }
    const issues = folderIssues(files, remembered);
    judged = misplacedFolders(issues);
    stranded = stranded.filter(each => {
      const at = strayAt(each);
      return at !== null && at !== each.from;
    });
    refresh(files);
    if (JSON.stringify(issues) === JSON.stringify(current)) return;
    current = issues;
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { host.fail(error); }
    }
  }

  /**
   * 搬回一筆：資料夾本身（move.ref）→ 原位（move.from）。原位有東西、上一層不在就不搬（§1-3）。每次搬之前都問資料夾現在在哪裡
   * （Codex L2 第四輪 F1a）：家長已經拖回原位就不搬，不在 vault 裡就交給判斷；搬的是資料夾本身，舊位置再建的家長資料夾不會被搬走。
   * 不會拒絕：途中任何一步失敗都記進錯誤紀錄、通知家長自己拖回去，回 'failed'（Codex L2 F3）。live() 不成立（停用、超過總時限）
   * 就不再開始下一步，回 'stopped'。
   */
  async function restore(move: Hold, live: () => boolean): Promise<Result> {
    const to = move.from;
    /** 已經不用搬了：回到原位，或不在 vault 裡。 */
    const settled = (): 'back' | 'gone' | null => {
      const at = placeOf(move);
      return at === to ? 'back' : at === null || !move.ref ? 'gone' : null;
    };
    let left = move.to;
    try {
      const up = parentOf(to);
      if (up && host.known(up) !== 'folder') return 'gone';
      if (host.known(to) || await host.exists(to)) {
        // 原位只剩 Obsidian 看不到、磁碟上完全是空的資料夾（iCloud 留下的，或 Obsidian 以外搬走後剩的）：刪掉再搬。
        // Obsidian 看得到的（家長建的空資料夾也算）和有東西的一樣，不刪、不合併、不覆蓋（F4）；等磁碟的時候 Obsidian
        // 可能已經看到了，所以刪之前再問一次（第二輪 F4）。等的時候家長可能已經拖回原位：那就不是被占住。
        if (host.known(to) || !await host.empty(to) || host.known(to)) {
          const now = settled();
          if (now) return now;
          host.notify(OCCUPIED(to, placeOf(move) ?? move.to));
          return 'occupied';
        }
        if (!live()) return 'stopped';
        await host.rmdir(to);
      }
      const start = host.now();
      for (;;) {
        if (!live()) return 'stopped';
        let now = settled();
        if (now) return now;
        const ref = move.ref;
        if (!ref) return 'gone';
        // 磁碟上不是這個資料夾了（第五輪）：不搬，請家長自己拖回。
        if (!await host.intact(ref)) throw Error(`磁碟上「${placeOf(move) ?? move.to}」和 Obsidian 的清單對不上，沒有搬`);
        if (!live()) return 'stopped';
        now = settled();
        if (now) return now;
        left = placeOf(move) ?? left;
        try {
          await host.move(ref, to);
        } catch (error) {
          if (!locked(error) || host.now() - start >= RETRY_FOR) throw error;
          await host.sleep(RETRY_EVERY);
          continue;
        }
        // 搬好之後、回報之前家長又把它搬走（第五輪）：那次改名被這一筆擋下了，所以照資料夾現在的位置再搬一次。
        if (settled() === 'back') break;
        if (host.now() - start >= RETRY_FOR) throw Error(`「${to}」搬回之後又被搬走`);
        await host.sleep(RETRY_EVERY);
      }
    } catch (error) {
      if (!live()) return 'stopped';
      // 搬的時候家長已經拖回原位（第四輪 F1a）：不是失敗，不通知。
      if (settled() === 'back') return 'back';
      host.fail(error);
      host.notify(GAVE_UP(to));
      return 'failed';
    }
    void cleanup(left);
    return 'done';
  }

  /** 暫時的位置過一下會冒出 iCloud 留下的空資料夾（R5）：Obsidian 看不到、完全是空的才刪。 */
  async function cleanup(path: string): Promise<void> {
    let waited = 0;
    for (const at of CLEANUP_AT) {
      await host.sleep(at - waited);
      waited = at;
      if (closed) return;
      try {
        // 等磁碟的時候 Obsidian 可能已經看到了：刪之前再問一次（第二輪 F4）。
        if (!host.known(path) && await host.exists(path) && await host.empty(path) && !host.known(path) && !closed) await host.rmdir(path);
      } catch (error) { host.fail(error); }
    }
  }

  /**
   * 搬回一筆，最多擋 HOLD_LIMIT（第二輪 F5）：到時還沒結束就記下、請家長自己拖回、放行；restore 照 live() 不再開始下一步，
   * 已經送出去的那一步之後才搬好的，補一個搬好的通知。停用時待重試的也停下，請家長自己拖回。
   */
  function attempt(move: Hold): Promise<Result> {
    let late = false;
    const work = restore(move, () => !closed && !late);
    return new Promise<Result>(resolve => {
      const cancel = host.later(HOLD_LIMIT, () => {
        late = true;
        host.fail(Error(`搬回「${move.from}」超過 ${String(HOLD_LIMIT / 1000)} 秒沒有結束，先放行；這一步之後才結束的照 rename 事件重新判斷`));
        host.notify(GAVE_UP(move.from));
        resolve('stopped');
      });
      void work.then(result => {
        cancel();
        if (late) {
          if (result === 'done') host.notify(NOTICE(move.from));
          return;
        }
        // 停用時停下的：資料夾還在暫時的位置。
        if (result === 'stopped') host.notify(GAVE_UP(move.from));
        resolve(result);
      }).catch((error: unknown) => { host.fail(error); resolve('failed'); });
    });
  }

  function flush(): void {
    const moves = batch;
    batch = [];
    if (closed) return;
    const top = guardedMoves(moves.map(move => move.from));
    for (const move of moves) {
      if (top.includes(move.from)) continue;
      // 上層也在這一批：上層搬回時它跟著回來。等這一筆的讀寫接著等上層那一筆（when 每次重看）。
      const at = holds.indexOf(move);
      if (at >= 0) holds.splice(at, 1);
      move.finish();
    }
    for (const move of moves.filter(m => top.includes(m.from))) {
      // attempt 不會拒絕；notify 拋錯時交給錯誤紀錄。
      void attempt(move).then(result => {
        if (result === 'done') host.notify(NOTICE(move.from));
        release(move, result);
      }).catch((error: unknown) => { host.fail(error); release(move, 'failed'); });
    }
  }

  /**
   * 判斷出來搬錯位置的資料夾在 Obsidian 裡從 oldPath 改名成 path（第三輪 F1）：在它裡面（含它自己）的跟著換，補上下一次判斷之前
   * 的空檔；回到自己的原位、換到某個系統資料夾的原位（ownRules，根資料夾除外）就拿掉。沒搬回的不用換：位置每次問資料夾本身。
   */
  function follow(oldPath: string, path: string): void {
    judged = judged.flatMap(each => {
      if (!inside(each.at, oldPath)) return [each];
      const at = path + each.at.slice(oldPath.length);
      // 回到自己的原位也拿掉：Essence Cards 根資料夾不算 ownRules（第五輪），拖回原位要靠這一條。
      return at === each.from || ownRules(at) ? [] : [{ from: each.from, at }];
    });
    refresh();
  }

  /**
   * 搬好了或放棄了：沒搬回的資料夾先排除（第二輪 F1），送出擋住的通知、重新判斷（其他搬回還在進行時不判斷），最後才讓
   * 等著的讀寫接著做。可以呼叫兩次（停用時先放行，搬回結束時再一次）。
   */
  function release(move: Hold, result: Result): void {
    const at = holds.indexOf(move);
    if (at >= 0) holds.splice(at, 1);
    // 認不得資料夾本身的（收到 rename 時、按下按鈕時清單裡已經找不到）不記（第五輪）：照路徑記會把之後在那裡的家長資料夾當成它，
    // 交給 §2-2 照名字判斷。
    const ref = move.ref;
    if (ref && result !== 'done' && result !== 'back' && !closed && !stranded.some(each => each.ref === ref)) {
      stranded = [...stranded, { from: move.from, ref }];
      try { refresh(); } catch (error) { host.fail(error); }
    }
    const ready = held.filter(path => !holding(path));
    held.splice(0, held.length, ...held.filter(holding));
    for (const path of ready) emit(path);
    check();
    move.finish();
  }

  return {
    renamed(path, oldPath, folder, ref) {
      if (closed || !folder) return;
      try { follow(oldPath, path); } catch (error) { host.fail(error); }
      if (!guardedMoves([oldPath]).length || holding(oldPath)) return;
      // 同一個資料夾一次只由一筆搬回（第五輪）：搬回期間它被拖過某個系統資料夾的原位，不另排一筆。
      const folderRef = ref ?? host.folder(path);
      if (folderRef && holds.some(each => each.ref === folderRef)) return;
      const move = hold(oldPath, path, folderRef);
      holds.push(move);
      if (!batch.length) host.defer(flush);
      batch.push(move);
    },
    changed() {
      if (closed || !started) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; check(); }, CHECK_DELAY);
    },
    check() { started = true; check(); },
    issues: () => current,
    async moveBack(issue) {
      if (closed || issue.kind !== 'moved' || issue.at.length !== 1) return false;
      const move = hold(issue.folder, issue.at[0], host.folder(issue.at[0]));
      holds.push(move);
      let result: Result = 'failed';
      // 不拒絕（按鈕不必再接）：失敗的原因 restore 自己通知、記進錯誤紀錄；通知本身拋錯也記下。
      try {
        result = await attempt(move);
        if (result === 'done') host.notify(`Essence Cards：已經把「${folderLabel(issue.folder)}」搬回原位`);
        return result === 'done' || result === 'back';
      } catch (error) {
        host.fail(error);
        return false;
      } finally { release(move, result); }
    },
    dismiss(folder) {
      remembered = remembered.filter(each => each !== folder);
      host.save(remembered);
      check();
    },
    pause(path, folder = false) {
      return holds.find(folder ? onFolder(path) : onPath(path))?.done ?? null;
    },
    // 搬回期間資料夾所在的暫時位置裡的檔也不當卡組：開在編輯器裡的範圍檔存檔、離開筆記都不補 ID（F1）。回到原位、落在系統資料夾
    // 原位的不算。
    misplaced: path => hidden(path) || holds.some(each => {
      const at = placeOf(each);
      return at !== null && at !== each.from && !ownRules(at) && inside(path, at);
    }),
    // 沒搬回的先記下（release 在放行之前），所以等完搬回的讀寫問這裡一定問得到。沒搬回的只記在記憶體：重開之後搬到 Essence Cards 外面的
    // 找不到位置，判斷是 missing，也算不在原位（R4-1），家長放回去或按「不用了」就解除。
    displaced: path => current.some(issue => issue.kind === 'missing' && inside(path, issue.folder)) || judged.some(each => inside(path, each.from)) || stranded.some(each => {
      const at = strayAt(each);
      return at !== null && at !== each.from && inside(path, each.from);
    }),
    wrap(files) {
      // 搬回期間原位與暫時位置的讀寫都先等（when），寫入的門檻在 modify 的回呼裡會再看一次（writes.ts）。
      // 這一層之下的 obsidian/files.ts 排隊之後、真正碰檔案之前，再用 pause 問一次。
      return {
        list: folder => when(onFolder(folder), async () => (await files.list(folder)).filter(path => !hidden(path))),
        read: path => when(onPath(path), () => hidden(path) ? Promise.resolve(null) : files.read(path)),
        readBytes: path => when(onPath(path), () => hidden(path) ? Promise.resolve(null) : files.readBytes(path)),
        modify: (path, edit) => when(onPath(path), () => files.modify(path, edit)),
        append: (path, line) => when(onPath(path), () => files.append(path, line)),
        watch(onChange) {
          watchers.add(onChange);
          const stop = files.watch(path => { if (holding(path)) held.push(path); else onChange(path); });
          return () => { watchers.delete(onChange); stop(); };
        },
      };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      // 擋住的讀寫放行（停用時 state 也在關，作答照樣寫出去，不丟）；正在搬回的照 live() 停在下一步之前。
      for (const move of [...holds]) release(move, 'stopped');
    },
  };
}
