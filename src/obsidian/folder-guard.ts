import { folderIssues, folderLabel, guardedMoves, misplacedFolders, presentFolders } from '../core/deck/index.ts';
import type { FolderIssue } from '../core/deck/index.ts';
import type { Files } from '../core/files.ts';

// 系統資料夾的防呆（tasks/system-folder-guard.md）：Obsidian 裡搬動或改名就搬回（§1），Obsidian 以外的在提醒一區寫出位置（§2）。
// 這裡不碰 obsidian 的執行期：vault 的操作經過 GuardHost（folder-host.ts 接上 Obsidian，測試用替身）。

export interface GuardHost {
  /** vault 裡所有檔的路徑。 */
  files(): string[];
  /** Obsidian 的清單裡有這個資料夾或檔（vault.getAbstractFileByPath）。 */
  known(path: string): 'folder' | 'file' | null;
  /** 磁碟上有沒有（iCloud 留下的空資料夾 Obsidian 看不到，§1-3、R5）。 */
  exists(path: string): Promise<boolean>;
  /** 磁碟上這個資料夾完全是空的（沒有檔、也沒有子資料夾）。 */
  empty(path: string): Promise<boolean>;
  /** 刪掉空的資料夾（非遞迴：有東西就失敗）。 */
  rmdir(path: string): Promise<void>;
  /** 把資料夾從 from 搬到 to（fileManager.renameFile：和檔案列拖動同一條路，連結跟著改）。 */
  move(from: string, to: string): Promise<void>;
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
   * 記著的暫時位置跟著換（Codex L2 第三輪 F1）。
   */
  renamed(path: string, oldPath: string, folder: boolean): void;
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
 * 正在搬回的一筆：原位（from）與暫時的位置（to）。搬好了或放棄了 done 才完成，等著的讀寫接著做（§1-8）。at 是資料夾現在的位置：
 * 搬回期間家長又在 Obsidian 裡改名就跟著換（第三輪 F1），放棄時記的是它。
 */
interface Hold { from: string; to: string; at: string; done: Promise<void>; finish: () => void }

function hold(from: string, to: string): Hold {
  let finish = (): void => {};
  const done = new Promise<void>(resolve => { finish = resolve; });
  return { from, to, at: to, done, finish };
}

/** 這一筆擋住 path 這個檔。 */
const onPath = (path: string) => (each: Hold): boolean => inside(path, each.from) || inside(path, each.to);
/** 這一筆擋住列 folder 底下（'' 是整個 vault）：兩邊有一邊在另一邊裡面。 */
const onFolder = (folder: string) => (each: Hold): boolean =>
  [each.from, each.to].some(at => folder === '' || inside(at, folder) || inside(folder, at));

/** 'stopped'：停用或超過總時限，這一筆已經放行，不再往下做。 */
type Result = 'done' | 'occupied' | 'gone' | 'failed' | 'stopped';

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
  /** 判斷出來搬錯位置的資料夾（§2-2）。 */
  let judged: string[] = [];
  /**
   * 沒搬回的資料夾：原位（from）與現在的位置（at）（Codex L2 第二輪 F1）。放行的那一刻就不當卡組，不等其他搬回結束才判斷；
   * 改成別的名字的（§2-2 只找同名）也照 rename 事件知道的位置。之後在 Obsidian 裡再改名、上一層改名就跟著換，拖回原位就不再記
   * （第三輪 F1，follow）；判斷時拿掉 Obsidian 已經看不到的（Obsidian 以外搬走、刪掉）。只記在記憶體。
   */
  let stranded: { from: string; at: string }[] = [];
  /** 不當卡組的資料夾：judged 加 stranded。 */
  let excluded: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  /** layout ready 之後第一次 check() 才開始：之前 vault 的清單還不完整。 */
  let started = false;

  const holding = (path: string): boolean => holds.some(onPath(path));
  /** judged 加 stranded。 */
  const unite = (): string[] => [...new Set([...judged, ...stranded.map(each => each.at)])];
  const hidden = (path: string): boolean => excluded.some(folder => inside(path, folder));
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

  /** 換掉不當卡組的資料夾；變了的那幾個資料夾裡的檔讓 state 重讀一次（讀不到就拿掉，回來了就讀進來）。 */
  function exclude(next: string[], files: string[]): void {
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
    stranded = stranded.filter(each => host.known(each.at) === 'folder');
    exclude(unite(), files);
    if (JSON.stringify(issues) === JSON.stringify(current)) return;
    current = issues;
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { host.fail(error); }
    }
  }

  /**
   * 搬回 from（現在的位置）→ to（原位）。原位有東西、上一層不在就不搬（§1-3）。不會拒絕：途中任何一步失敗都記進錯誤紀錄、
   * 通知家長自己拖回去，回 'failed'（Codex L2 F3）。live() 不成立（停用、超過總時限）就不再開始下一步，回 'stopped'。
   */
  async function restore(from: string, to: string, live: () => boolean): Promise<Result> {
    try {
      const up = parentOf(to);
      if (up && host.known(up) !== 'folder') return 'gone';
      if (host.known(to) || await host.exists(to)) {
        // 原位只剩 Obsidian 看不到、磁碟上完全是空的資料夾（iCloud 留下的，或 Obsidian 以外搬走後剩的）：刪掉再搬。
        // Obsidian 看得到的（家長建的空資料夾也算）和有東西的一樣，不刪、不合併、不覆蓋（F4）；等磁碟的時候 Obsidian
        // 可能已經看到了，所以刪之前再問一次（第二輪 F4）。
        if (host.known(to) || !await host.empty(to) || host.known(to)) {
          host.notify(OCCUPIED(to, from));
          return 'occupied';
        }
        if (!live()) return 'stopped';
        await host.rmdir(to);
      }
      const start = host.now();
      for (;;) {
        if (!live()) return 'stopped';
        try {
          await host.move(from, to);
          break;
        } catch (error) {
          if (!locked(error) || host.now() - start >= RETRY_FOR) throw error;
          await host.sleep(RETRY_EVERY);
        }
      }
    } catch (error) {
      if (!live()) return 'stopped';
      host.fail(error);
      host.notify(GAVE_UP(to));
      return 'failed';
    }
    void cleanup(from);
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
    const work = restore(move.to, move.from, () => !closed && !late);
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

  /**
   * 資料夾在 Obsidian 裡從 oldPath 改名成 path（第三輪 F1）：在它裡面（含它自己）的記錄跟著換。沒搬回的拖回原位就不再記：之後在
   * 舊位置新建的資料夾是家長自己的。判斷出來的（judged）也跟著換，補上下一次判斷之前的空檔；換到某個系統資料夾的原位就拿掉。
   * 搬回中的那一筆換 at；搬回自己的改名（換回 from）不算。
   */
  function follow(oldPath: string, path: string): void {
    const moved = (at: string): string | null => inside(at, oldPath) ? path + at.slice(oldPath.length) : null;
    for (const move of holds) {
      const at = moved(move.at);
      if (at !== null && at !== move.from) move.at = at;
    }
    let changed = false;
    stranded = stranded.flatMap(each => {
      const at = moved(each.at);
      if (at === null) return [each];
      changed = true;
      return at === each.from ? [] : [{ from: each.from, at }];
    });
    judged = judged.flatMap(folder => {
      const at = moved(folder);
      if (at === null) return [folder];
      changed = true;
      return guardedMoves([at]).length ? [] : [at];
    });
    if (changed) exclude(unite(), host.files());
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
   * 搬好了或放棄了：沒搬回的暫時位置先排除（第二輪 F1），送出擋住的通知、重新判斷（其他搬回還在進行時不判斷），最後才讓
   * 等著的讀寫接著做。可以呼叫兩次（停用時先放行，搬回結束時再一次）。
   */
  function release(move: Hold, result: Result): void {
    const at = holds.indexOf(move);
    if (at >= 0) holds.splice(at, 1);
    if (result !== 'done' && !closed && !stranded.some(each => each.at === move.at)) {
      stranded = [...stranded, { from: move.from, at: move.at }];
      try { exclude(unite(), host.files()); } catch (error) { host.fail(error); }
    }
    const ready = held.filter(path => !holding(path));
    held.splice(0, held.length, ...held.filter(holding));
    for (const path of ready) emit(path);
    check();
    move.finish();
  }

  return {
    renamed(path, oldPath, folder) {
      if (closed || !folder) return;
      try { follow(oldPath, path); } catch (error) { host.fail(error); }
      if (!guardedMoves([oldPath]).length || holding(oldPath)) return;
      const move = hold(oldPath, path);
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
      const move = hold(issue.folder, issue.at[0]);
      holds.push(move);
      let result: Result = 'failed';
      // 不拒絕（按鈕不必再接）：失敗的原因 restore 自己通知、記進錯誤紀錄；通知本身拋錯也記下。
      try {
        result = await attempt(move);
        if (result === 'done') host.notify(`Essence Cards：已經把「${folderLabel(issue.folder)}」搬回原位`);
        return result === 'done';
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
    // 搬回期間暫時位置裡的檔也不當卡組：開在編輯器裡的範圍檔存檔、離開筆記都不補 ID（F1）。
    misplaced: path => hidden(path) || holds.some(each => inside(path, each.to) || inside(path, each.at)),
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
