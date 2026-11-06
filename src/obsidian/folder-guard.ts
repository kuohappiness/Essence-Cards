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
}

export interface FolderGuard {
  /** vault 的 rename 事件，要在 state 的監看之前收到（先註冊）：同一批的通知才擋得住。 */
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
  /** 這個檔在搬錯位置的資料夾裡：不當卡組（StateOptions.skip）。 */
  misplaced(path: string): boolean;
  /** issues() 變了。 */
  onChange(listener: () => void): () => void;
  close(): void;
}

/** 搬回的重試（§1-4）：iCloud 改名後約 1 秒內鎖住。 */
const RETRY_EVERY = 200;
const RETRY_FOR = 10_000;
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

export function createFolderGuard(host: GuardHost): FolderGuard {
  /** 正在搬回的：原位與暫時的位置。 */
  const holds: { from: string; to: string }[] = [];
  /** 這一輪收到的系統資料夾改名（還沒處理）。 */
  let batch: { from: string; to: string }[] = [];
  /** 擋住的通知，搬好了照順序送。 */
  const held: string[] = [];
  const watchers = new Set<(path: string) => void>();
  const listeners = new Set<() => void>();
  let remembered = host.load();
  let current: FolderIssue[] = [];
  let excluded: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  /** layout ready 之後第一次 check() 才開始：之前 vault 的清單還不完整。 */
  let started = false;

  const holding = (path: string): boolean => holds.some(hold => inside(path, hold.from) || inside(path, hold.to));
  const emit = (path: string): void => {
    for (const watcher of [...watchers]) {
      try { watcher(path); } catch (error) { host.fail(error); }
    }
  };

  function check(): void {
    if (closed || !started || holds.length) return;
    const files = host.files();
    const seen = presentFolders(files);
    const added = seen.filter(folder => !remembered.includes(folder));
    if (added.length) { remembered = [...remembered, ...added]; host.save(remembered); }
    const issues = folderIssues(files, remembered);
    const next = misplacedFolders(issues);
    const flipped = [...excluded.filter(f => !next.includes(f)), ...next.filter(f => !excluded.includes(f))];
    excluded = next;
    // 不當卡組的資料夾變了：裡面的檔讓 state 重讀一次（讀不到就拿掉，回來了就讀進來）。
    for (const path of files) if (flipped.some(folder => inside(path, folder))) emit(path);
    if (JSON.stringify(issues) === JSON.stringify(current)) return;
    current = issues;
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { host.fail(error); }
    }
  }

  /** 搬回 from（現在的位置）→ to（原位）。原位有東西、上一層不在就不搬（§1-3）。 */
  async function restore(from: string, to: string): Promise<'done' | 'occupied' | 'gone' | 'failed'> {
    const up = parentOf(to);
    if (up && host.known(up) !== 'folder') return 'gone';
    if (host.known(to) || await host.exists(to)) {
      // 原位只剩空的資料夾（iCloud 留下的，或 Obsidian 以外搬走後剩的）：刪掉再搬；有東西時不合併、不覆蓋。
      const leftover = host.known(to) !== 'file' && !host.files().some(path => inside(path, to)) && await host.empty(to).catch(() => false);
      if (!leftover) {
        host.notify(OCCUPIED(to, from));
        return 'occupied';
      }
      await host.rmdir(to);
    }
    const start = host.now();
    for (;;) {
      try {
        await host.move(from, to);
        break;
      } catch (error) {
        if (!locked(error) || host.now() - start >= RETRY_FOR) {
          host.fail(error);
          host.notify(GAVE_UP(to));
          return 'failed';
        }
        await host.sleep(RETRY_EVERY);
      }
    }
    void cleanup(from);
    return 'done';
  }

  /** 暫時的位置過一下會冒出 iCloud 留下的空資料夾（R5）：完全是空的才刪。 */
  async function cleanup(path: string): Promise<void> {
    let waited = 0;
    for (const at of CLEANUP_AT) {
      await host.sleep(at - waited);
      waited = at;
      if (closed) return;
      try {
        if (!host.known(path) && await host.exists(path) && await host.empty(path)) await host.rmdir(path);
      } catch (error) { host.fail(error); }
    }
  }

  function flush(): void {
    const moves = batch;
    batch = [];
    const top = guardedMoves(moves.map(move => move.from));
    for (const move of moves) {
      if (top.includes(move.from)) continue;
      // 上層也在這一批：上層搬回時它跟著回來。
      const at = holds.indexOf(move);
      if (at >= 0) holds.splice(at, 1);
    }
    for (const move of moves.filter(m => top.includes(m.from))) {
      void restore(move.to, move.from).then(result => {
        if (result === 'done') host.notify(NOTICE(move.from));
      }, (error: unknown) => { host.fail(error); }).finally(() => { release(move); });
    }
  }

  function release(move: { from: string; to: string }): void {
    const at = holds.indexOf(move);
    if (at >= 0) holds.splice(at, 1);
    const ready = held.filter(path => !holding(path));
    held.splice(0, held.length, ...held.filter(holding));
    for (const path of ready) emit(path);
    check();
  }

  return {
    renamed(path, oldPath, folder) {
      if (closed || !folder || !guardedMoves([oldPath]).length || holding(oldPath)) return;
      const move = { from: oldPath, to: path };
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
      if (issue.kind !== 'moved' || issue.at.length !== 1) return false;
      const move = { from: issue.folder, to: issue.at[0] };
      holds.push(move);
      try {
        const result = await restore(move.to, move.from);
        if (result === 'done') host.notify(`Essence Cards：已經把「${folderLabel(issue.folder)}」搬回原位`);
        return result === 'done';
      } finally { release(move); }
    },
    dismiss(folder) {
      remembered = remembered.filter(each => each !== folder);
      host.save(remembered);
      check();
    },
    misplaced: path => excluded.some(folder => inside(path, folder)),
    wrap(files) {
      const hidden = (path: string): boolean => excluded.some(folder => inside(path, folder));
      return {
        list: async folder => (await files.list(folder)).filter(path => !hidden(path)),
        read: path => hidden(path) ? Promise.resolve(null) : files.read(path),
        readBytes: path => hidden(path) ? Promise.resolve(null) : files.readBytes(path),
        modify: (path, edit) => files.modify(path, edit),
        append: (path, line) => files.append(path, line),
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
    },
  };
}
