import type { Files } from '../core/files.ts';
import { chooseScope, editScope, EXAM_FOLDER, isExamPath, lastEnded, newScopeText, parseExamFile, parseScope, scopeFileName } from '../core/catalog/index.ts';
import type { ScopeChange, ScopeFile, ScopeUnit } from '../core/catalog/index.ts';
import { newId } from '../core/deck/index.ts';
import type { ExamLog } from '../core/study/index.ts';
import { createFolderFiles } from './folder-files.ts';

/**
 * 範圍檔的讀與寫（tasks/exam-scope.md §3、§2-4、§4）：讀取、等待與寫入的順序在 folder-files.ts，這裡是範圍檔自己的規則。
 */

/** 畫面交出的變動（§2-4）：新勾的、取消的、有改的日期。 */
export type ExamChange = Pick<ScopeChange, 'add' | 'remove' | 'start' | 'end'>;
/** done 是寫好了（或本來就沒有要改的）；blocked 的原因畫面要寫出來，已勾的不丟。special 的 lost 是存了會掉出範圍的單元編號。 */
export type ExamResult =
  | { kind: 'done' }
  | { kind: 'blocked'; reason: 'loading' | 'closed' | 'unread' | 'changed' | 'broken' | 'dates' }
  | { kind: 'blocked'; reason: 'special'; lost: string[] }
  | { kind: 'failed'; error: unknown };
export type ExamBlocked = Extract<ExamResult, { kind: 'blocked' }>;

interface ExamFilesOptions {
  files: Files;
  delay: number;
  stuckAfter: number;
  writeTimeout: number;
  random?: () => number;
  onError: (error: unknown) => void;
  /** 內容變了（或第一次讀完）：組合那一層比選定的結果，決定重排或只通知畫面。 */
  changed: () => void;
  unreadChanged: () => void;
  /** 寫了有變動的範圍：組合那一層記一行紀錄。 */
  logged: (val: ExamLog) => void;
}

/** 回呼裡擋下來的（§2-4）：丟錯才不會建立或寫入。 */
class ScopeBlocked extends Error {
  readonly result: ExamBlocked;
  constructor(result: ExamBlocked) { super('範圍檔不能寫：' + result.reason); this.result = result; }
}

/** 紀錄行的欄位（§2-5）：讀得懂的每一行，照檔案的順序，只留年級學期、科目、編號。 */
export const unitsOf = (file: ScopeFile): string[] => file.lines.flatMap(line => line.kind === 'unit' ? [`${line.term} ${line.subject} ${line.code}`] : []);
/** 寫入之前的內容：沒寫的日期沒有欄位，看不懂的日期照原字，原本沒有識別碼就沒有 id（§2-5）。 */
function oldOf(file: ScopeFile): NonNullable<ExamLog['old']> {
  const date = (read: ScopeFile['start']): string | null => read.kind === 'ok' ? read.date : read.kind === 'bad' ? read.raw : null;
  const start = date(file.start), end = date(file.end);
  return { ...(file.id === null ? {} : { id: file.id }), units: unitsOf(file), ...(start === null ? {} : { start }), ...(end === null ? {} : { end }) };
}
/** 寫完之後的內容：日期只有 `YYYY-MM-DD`。 */
function logOf(file: ScopeFile, action: ExamLog['do']): ExamLog {
  const date = (read: ScopeFile['start']): string | null => read.kind === 'ok' ? read.date : null;
  const start = date(file.start), end = date(file.end);
  return { id: file.id ?? '', do: action, units: unitsOf(file), ...(start === null ? {} : { start }), ...(end === null ? {} : { end }) };
}

export function createExamFiles(options: ExamFilesOptions) {
  const folder = createFolderFiles<ScopeFile>({
    ...options,
    folder: EXAM_FOLDER,
    isFile: isExamPath,
    // 搬出 小考/ 的小考檔（D-189）當成沒有。
    parse: parseExamFile,
  });
  const freshId = (): string => newId(options.random ?? Math.random, new Set(folder.entries().flatMap(each => each.file.id ?? [])), { letterFirst: true });
  const failure = (error: unknown): ExamResult => error instanceof ScopeBlocked ? error.result : { kind: 'failed', error };

  return {
    start: folder.start,
    settle: folder.settle,
    drain: folder.drain,
    settled: folder.settled,
    revision: folder.revision,
    unread: folder.unread,
    missing: folder.missing,
    text: folder.text,
    choose: (day: number) => chooseScope(folder.entries(), day),
    /** 上一份範圍的結束日（§6 的預先勾選）。 */
    previousEnd: (day: number): string | null => lastEnded(folder.entries(), day),
    /** 改一份舊檔（§2-4）：回呼裡改最新的內容；有變動才記（§2-5）。id 是畫面打開時的識別碼；admit 是真正寫之前再問一次這次寫入還算不算數。 */
    async update(path: string, id: string | null, change: ExamChange | Pick<ScopeChange, 'ended'>, units: readonly ScopeUnit[], admit: () => ExamBlocked | null): Promise<ExamResult> {
      let before: ScopeFile | null = null;
      const record = (text: string): void => {
        const after = parseScope(text), was = before;
        if (was && 'ended' in change) options.logged({ ...logOf(after, '提前結束'), ended: change.ended });
        else if (was && JSON.stringify(oldOf(was)) !== JSON.stringify(oldOf(after))) options.logged({ ...logOf(after, '改'), old: oldOf(was) });
      };
      try {
        const text = await folder.modify(path, latest => {
          // 真正寫之前最後一個同步區段：開始寫之後才到的別份，還在讀、讀完換了選定、讀不到，都還來得及不寫（Codex L2 的 R17、R21）。同一份不用等，這裡拿到的就是最新的。
          if (folder.waiting(path)) throw new ScopeBlocked({ kind: 'blocked', reason: 'unread' });
          const stale = admit();
          if (stale) throw new ScopeBlocked(stale);
          // 同一個路徑換成小考檔，state 還沒讀到（D-189）：段考不讀，也不寫。
          if (parseExamFile(latest) === null) throw new ScopeBlocked({ kind: 'blocked', reason: 'changed' });
          const done = editScope(latest, { ...change, id: freshId() }, units);
          if (done.kind === 'blocked') throw new ScopeBlocked(done);
          const was = parseScope(latest);
          // 同一個路徑換成另一次考試（同步把別的檔換過來，state 還沒讀到）：別人改的別的行留著，但不是這次考試就不寫。
          if (was.id !== id) throw new ScopeBlocked({ kind: 'blocked', reason: 'changed' });
          before = was;
          return done.text;
        }, record);
        record(text);
        folder.adopt(path, text);
        return { kind: 'done' };
      } catch (error) { return failure(error); }
    },
    /** 新檔（§2-4）：撞名不蓋掉，換下一個後綴。沒有要加的就不建。 */
    async create(change: ExamChange): Promise<ExamResult> {
      const add = change.add ?? [];
      if (!add.length) return { kind: 'done' };
      const text = newScopeText({ id: freshId(), start: change.start, end: change.end, add });
      const name = EXAM_FOLDER + '/' + scopeFileName(change.start ?? null, add);
      try {
        for (let suffix = 1; ; suffix++) {
          const path = (suffix === 1 ? name : `${name} ${String(suffix)}`) + '.md';
          let taken = false;
          const record = (): void => { if (!taken) options.logged(logOf(parseScope(text), '建立')); };
          await folder.modify(path, latest => { taken = latest !== ''; return taken ? latest : text; }, record);
          if (taken) continue;
          record();
          folder.adopt(path, text);
          return { kind: 'done' };
        }
      } catch (error) { return failure(error); }
    },
    stop: (): void => { folder.stop(); },
  };
}
