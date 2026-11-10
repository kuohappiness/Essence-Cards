import type { Files } from '../core/files.ts';
import { editQuiz, isQuizFile, newQuizText, parseQuiz, QUIZ_FOLDER, quizFileName, quizInputSame, quizLine, quizLink, quizRows, scopeDate } from '../core/catalog/index.ts';
import type { QuizContext, QuizFile, QuizInput, QuizRow } from '../core/catalog/index.ts';
import { newId } from '../core/deck/index.ts';
import { createFolderFiles } from './folder-files.ts';

/**
 * 小考檔的讀與寫（tasks/quiz-mark.md §1）：讀取、等待與寫入的順序和範圍檔同一條（folder-files.ts）。不改排程，不寫紀錄行（§1「不寫紀錄行」）：改了只通知畫面。
 * 外掛寫的只有三種：新檔、改 `小考日期` 那一行、加 `取消` 那一行。手機也可以寫（不是卡組，D-142 第 4 點不管它）。
 */

/** done 是寫好了（或本來就是這樣）。special 是寫不出來的目標（連結不能用的字、讀不回來的單元）。 */
export type QuizResult =
  | { kind: 'done' }
  | { kind: 'blocked'; reason: 'loading' | 'closed' | 'unread' | 'changed' | 'broken' | 'special' }
  | { kind: 'failed'; error: unknown };
type QuizBlocked = Extract<QuizResult, { kind: 'blocked' }>;
/** 畫面打開時的那一次小考。 */
export type QuizOpened = Pick<QuizRow, 'paths' | 'id'>;

interface QuizFilesOptions {
  files: Files;
  delay: number;
  stuckAfter: number;
  writeTimeout: number;
  random?: () => number;
  onError: (error: unknown) => void;
  /** 內容變了：只通知畫面。 */
  changed: () => void;
  unreadChanged: () => void;
  /** 組合那一層讀完了。 */
  loaded: () => boolean;
  /** 寫之前最多等待讀多久（毫秒）。 */
  wait: number;
  /** 現在的日子與目錄。 */
  context: () => QuizContext;
}

/** 回呼裡擋下來的：丟錯才不會寫入。 */
class QuizStop extends Error {
  readonly result: QuizBlocked;
  constructor(result: QuizBlocked) { super('小考檔不能寫：' + result.reason); this.result = result; }
}
const blocked = (reason: QuizBlocked['reason']): QuizBlocked => ({ kind: 'blocked', reason });
const failure = (error: unknown): QuizResult => error instanceof QuizStop ? error.result : { kind: 'failed', error };

export function createQuizFiles(options: QuizFilesOptions) {
  const { context } = options;
  const folder = createFolderFiles<QuizFile>({ ...options, folder: QUIZ_FOLDER, isFile: isQuizFile, parse: parseQuiz });
  const freshId = (): string => newId(options.random ?? Math.random, new Set(folder.entries().flatMap(each => each.file.id ?? [])), { letterFirst: true });
  const rows = (): QuizRow[] => quizRows(folder.entries(), context());

  /** 小考檔一次寫一件；還在讀、讀不到時不寫（和範圍檔相同）。 */
  let writes: Promise<unknown> = Promise.resolve();
  function gate(work: () => Promise<QuizResult>): Promise<QuizResult> {
    const run = writes.then((): QuizResult | Promise<QuizResult> => {
      if (folder.closed()) return blocked('closed');
      if (!options.loaded()) return blocked('loading');
      if (!folder.settled() || folder.unread.size) return blocked('unread');
      return folder.drain<QuizResult>(options.wait, known => {
        if (folder.closed()) return blocked('closed');
        return known && !folder.unread.size ? work() : blocked('unread');
      });
    });
    // run 的失敗交回呼叫端；這裡只是不讓它擋住下一件。
    writes = run.catch(() => {});
    return run;
  }

  /** 新檔：撞名不蓋掉，換下一個後綴；已有的檔（含空檔）一個字都不動（§1）。 */
  async function create(input: QuizInput, date: string): Promise<QuizResult> {
    const line = quizLine(input);
    if (line === null) return blocked('special');
    const name = QUIZ_FOLDER + '/' + quizFileName(date);
    // 連結要真的指回這一篇（檔名裡有 Obsidian 另外解讀的字時不會）。
    if ('deck' in input) {
      const resolved = context().resolve(quizLink(input.deck), name + '.md');
      if (resolved.kind !== 'file' || resolved.path !== input.deck) return blocked('special');
    }
    // 打開畫面之後別台裝置已經設了同一個目標：這一份不算數，請畫面重看。
    const same = quizInputSame(input);
    if (rows().some(row => row.same === same && row.date !== null && (row.problem === null || row.problem === 'unmatched'))) return blocked('changed');
    const text = newQuizText({ id: freshId(), date, line });
    try {
      for (let suffix = 1; ; suffix++) {
        const path = (suffix === 1 ? name : `${name} ${String(suffix)}`) + '.md';
        // 已經有這個檔（含零位元組的空檔）就換下一個後綴。在回呼裡判斷：讀與寫之間才出現的檔也算（L2 R2）。
        let taken = false;
        await folder.modify(path, (latest, exists) => { taken = exists; return exists ? latest : text; }, () => { /* 沒有紀錄行要補：之後重讀就看得到。 */ });
        if (taken) continue;
        folder.adopt(path, text);
        return { kind: 'done' };
      }
    } catch (error) { return failure(error); }
  }

  /** 改舊檔：回呼裡改最新的內容。id 是畫面打開時的識別碼；同一個路徑換成另一次小考時不寫（§1）。 */
  async function edit(path: string, id: string | null, change: { date: string } | { cancelled: string }): Promise<void> {
    const text = await folder.modify(path, latest => {
      if (folder.waiting(path)) throw new QuizStop(blocked('unread'));
      const done = editQuiz(latest, { ...change, id: freshId() });
      if (done.kind === 'blocked') throw new QuizStop(blocked(done.reason));
      if (parseQuiz(latest).id !== id) throw new QuizStop(blocked('changed'));
      return done.text;
    }, () => { /* 同上。 */ });
    folder.adopt(path, text);
  }
  /** 這次小考現在的每一份：畫面打開之後又同步來的副本也要算進去。 */
  function copies(opened: QuizOpened): string[] {
    if (opened.id === null) return folder.text(opened.paths[0]) === null ? [] : [opened.paths[0]];
    return folder.entries().filter(each => each.file.id === opened.id).map(each => each.path).sort();
  }

  return {
    start: folder.start,
    settle: folder.settle,
    unread: folder.unread,
    rows,
    /** 設定或改日期（§1）：opened 是 null 時建新檔。改日期要改每一份副本，只改一份會變成「兩份不一樣」。 */
    set(input: QuizInput, date: string, opened: QuizOpened | null): Promise<QuizResult> {
      return gate(async () => {
        if (!opened) return create(input, date);
        const paths = copies(opened);
        if (!paths.length) return blocked('changed');
        try {
          for (const path of paths) await edit(path, opened.id, { date });
          return { kind: 'done' };
        } catch (error) { return failure(error); }
      });
    },
    /** 取消（§1）：一份有 `取消`，整組都取消。日期是清晨 4 點換日的那一天。 */
    cancel(opened: QuizOpened): Promise<QuizResult> {
      return gate(async () => {
        const [path] = copies(opened);
        if (path === undefined) return blocked('changed');
        try {
          await edit(path, opened.id, { cancelled: scopeDate(context().day) });
          return { kind: 'done' };
        } catch (error) { return failure(error); }
      });
    },
    drain: folder.drain,
    reread: folder.reread,
    /** 還原期間（tasks/plugin-restore.md §3-2）：後面的寫入排在 gate 之後；回傳的 Promise 等排在前面的寫完。 */
    after(gate: Promise<void>): Promise<unknown> {
      const before = writes;
      writes = writes.then(() => gate);
      return before;
    },
    /** 等已經排隊的寫入（close 用）。 */
    idle: (): Promise<unknown> => writes,
    stop: (): void => { folder.stop(); },
  };
}
