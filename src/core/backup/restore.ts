import { isDeckPath } from '../deck/index.ts';
import type { Files } from '../files.ts';
import { formatTime, isLogPath, LOG_FOLDER } from '../study/index.ts';
import { ESSENCE_ROOT, PLUGIN_DATA } from './manifest.ts';
import type { BackupManifest } from './manifest.ts';
import { restoreLogName } from './names.ts';
import { deckIds, planRestore } from './plan.ts';
import type { PlanOptions, PlannedFile, RestorePlan } from './plan.ts';
import type { BackupReader } from './take.ts';
import { hashBytes } from './zip.ts';
import type { OpenedBackup } from './zip.ts';

// 外掛內的還原（tasks/plugin-restore.md §3）：先備份、再算一次計畫、逐檔寫。協調（閘門、開著的編輯器）在外層，這裡只管順序與每個檔的再確認。

type Outcome = '已還原' | '跳過' | '擋住' | '失敗';
interface FileOutcome { path: string; target: string | null; outcome: Outcome; reason: string }
interface LogOutcome { source: string; path: string | null; lines: number; outcome: Outcome; reason: string }
export interface RestoreResult {
  /** 還原前那份備份的檔名；沒做成是 null。 */
  backup: string | null;
  files: FileOutcome[];
  logs: LogOutcome[];
  /** 這一步失敗，後面都沒做（D-154：哪一步、原因）。 */
  stopped: { step: string; message: string } | null;
  /** 實際寫過的路徑（vault 相對）：外層排重讀用。 */
  written: string[];
}
/** 設定的結果（§4）：changed 是比對之後改過，跳過；unreadable 是現在讀不到；failed 是寫不進去。 */
type SettingsOutcome = 'saved' | 'changed' | 'unreadable' | 'failed';

export interface RestoreRun {
  opened: OpenedBackup;
  /** 家長勾的檔（備份裡的路徑）。 */
  chosen: ReadonlySet<string>;
  /** 畫面比對時，勾選的每個檔現在的 sha（不存在是 null）。 */
  screen: ReadonlyMap<string, string | null>;
  plan: PlanOptions;
  /** 先備份現況（by: restore）；失敗就丟錯，什麼都不寫。 */
  before: () => Promise<{ name: string; manifest: BackupManifest }>;
  /** 重新讀現況；讀不到任何一個檔就丟錯。 */
  current: () => Promise<Map<string, Uint8Array>>;
  files: Pick<Files, 'list' | 'readBytes' | 'replace'>;
  /** 寫一篇卡組：外層在 write 前後讓 state 知道這是自己的寫入（§3-3 第 6 點）。 */
  deck: (path: string, write: () => Promise<boolean>) => Promise<boolean>;
  /** 路徑上有連結就丟錯（§3-3 第 3 點）。 */
  noLinks: (path: string) => Promise<void>;
  /** 寫 data.json（§4）；expected 是畫面比對時現在的 sha（不存在是 null）。 */
  settings: (backup: Uint8Array, expected: string | null) => Promise<SettingsOutcome>;
  device: string;
  now: () => number;
  offset: (ms: number) => number;
  /** 外掛停用了：停在下一個檔之前。 */
  closed: () => boolean;
  /** 記進錯誤紀錄（syntax §9 的 where: restore）。 */
  fail: (step: string, error: unknown, path?: string) => void;
  /** 一次寫入或掃描最多等多久（毫秒），預設 30 秒：卡住時閘門不能一直關著。 */
  timeout?: number;
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const CHANGED = '比對之後改過，重新比對看新的差異';
const STOPPED = '外掛停用了，這次沒有做；重新比對可以接著做';

/** 現況：`Essence Cards/` 全部，加上 data.json（有的話）。讀不到就丟錯，寫出是哪個檔；筆記與紀錄含 NUL 也算讀不到，圖片可以有 0（D-154）。 */
export async function readCurrent(reader: BackupReader, data: string | null): Promise<Map<string, Uint8Array>> {
  const current = new Map<string, Uint8Array>();
  for (const path of [...await reader.list(), ...data === null ? [] : [data]]) {
    const bytes = await reader.read(path);
    if (bytes && (isLogPath(path) || path.toLowerCase().endsWith('.md')) && bytes.includes(0)) {
      throw Error(`${path} 的內容不完整（可能還在從 iCloud 下載）；等它下載完再比對` + (isLogPath(path) ? '' : '，一直這樣的話把這個檔刪掉，就能從備份補回'));
    }
    if (bytes) current.set(path, bytes);
    else if (path !== data) throw Error(`讀不到 ${path}（讀的時候檔案不見了）`);
  }
  return current;
}

/** 這個檔還原之後要不要算「有差異要處理」：畫面列給家長勾的檔。紀錄裡的只補不見的、不用勾。 */
export const tickable = (file: PlannedFile): boolean => file.action !== 'keep' && !(file.kind === 'missing' && file.path.startsWith(LOG_FOLDER + '/'));

export async function applyRestore(run: RestoreRun): Promise<RestoreResult> {
  const { opened, files, closed } = run;
  const result: RestoreResult = { backup: null, files: [], logs: [], stopped: null, written: [] };
  const limit = run.timeout ?? 30_000;
  const dataPath = opened.manifest.vault.config + '/' + PLUGIN_DATA;
  const plan = (current: ReadonlyMap<string, Uint8Array>, selection: ReadonlySet<string>): RestorePlan =>
    planRestore({ manifest: opened.manifest, backup: opened.files, current, ...run.plan, selection });
  const halt = (step: string, error: unknown): RestoreResult => {
    result.stopped = { step, message: message(error) };
    run.fail(step, error);
    return result;
  };
  const outcome = (file: { path: string; target: string | null }, kind: Outcome, reason: string): void => {
    result.files.push({ path: file.path, target: file.target, outcome: kind, reason });
  };
  /** 卡住的寫入或掃描不能讓閘門一直關著（§3-1 第 6 點）：逾時算失敗。 */
  function timed<T>(work: Promise<T>, what: string): Promise<T> {
    let id: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { id = setTimeout(() => { reject(Error(`${what}超過 ${String(Math.round(limit / 1000))} 秒沒有回來`)); }, limit); });
    return Promise.race([work, late]).finally(() => { clearTimeout(id); });
  }

  let before: Awaited<ReturnType<RestoreRun['before']>>;
  try { before = await run.before(); } catch (error) { return halt('先備份現況', error); }
  result.backup = before.name;
  if (closed()) return halt('先備份現況', Error(STOPPED));
  let current: Map<string, Uint8Array>;
  try { current = await run.current(); } catch (error) { return halt('讀 vault', error); }

  // 再算一次（§3-1 第 4 步）：sha 和畫面不同的、要蓋掉的內容不在剛才那份備份裡的，都跳過。
  const inBefore = new Map(before.manifest.files.map(file => [file.path, file.sha256]));
  const changed = new Set<string>();
  for (const file of plan(current, run.chosen).files) {
    if (!run.chosen.has(file.path)) continue;
    const now = file.current?.sha256 ?? null;
    if ((run.screen.get(file.path) ?? null) !== now || (file.current !== null && inBefore.get(file.current.path) !== now)) changed.add(file.path);
  }
  const fresh = plan(current, new Set([...run.chosen].filter(path => !changed.has(path))));
  const byPath = new Map(fresh.files.map(file => [file.path, file]));
  for (const path of run.chosen) {
    const file = byPath.get(path);
    if (!file) outcome({ path, target: null }, '跳過', '現在和備份相同');
    else if (changed.has(path)) outcome(file, '跳過', CHANGED);
    else if (file.action === 'blocked') outcome(file, '擋住', file.reasons.join('；'));
  }

  // 卡組要加回的 ID 現在有沒有在別篇（§3-3 第 2 點）：重新讀現在全部的卡組；讀不到也算確定不了。
  async function occupied(rel: string, bytes: Uint8Array): Promise<string | null> {
    const mine = new Set(deckIds(bytes));
    if (mine.size === 0) return null;
    const same = run.plan.sameFile;
    for (const path of (await files.list(ESSENCE_ROOT)).filter(isDeckPath)) {
      if (same(path) === same(rel)) continue;
      const unknown = `讀不到「${path}」，確定不了學習目標 ID 有沒有重複；重新比對`;
      let other: Uint8Array | null;
      try { other = await files.readBytes(path); } catch { return unknown; }
      // 清單列得出來卻讀不到、內容不完整：都可能占著 ID（R3）。
      if (other === null || other.includes(0)) return unknown;
      for (const id of deckIds(other)) if (mine.has(id)) return `學習目標 ID ${id} 現在在「${path}」（比對之後才出現的）；重新比對`;
    }
    return null;
  }

  const written = new Set<string>();
  for (const path of fresh.order) {
    const file = byPath.get(path)!;
    if (path === dataPath) continue;
    if (closed()) { outcome(file, '跳過', STOPPED); continue; }
    const waiting = file.after.filter(other => !written.has(other));
    if (waiting.length) { outcome(file, '跳過', `要先還原「${waiting.join('」、「')}」才不會讓學習目標 ID 重複，它這次沒有還原成`); continue; }
    const rel = file.current?.path ?? file.target!;
    const bytes = opened.files.get(path)!;
    const deck = isDeckPath(rel);
    try {
      if (deck) {
        const taken = await timed(occupied(rel, bytes), '掃描卡組');
        if (taken) { outcome(file, '跳過', taken); continue; }
      }
      await run.noLinks(rel);
      const expected = file.current?.sha256 ?? null;
      let live = true;
      const write = async (): Promise<boolean> => {
        // 最後一次確認在 replace 的回呼裡，和寫入只隔一次讀（§3-2）；逾時之後才輪到它就不寫。
        const done = await files.replace(rel, now => live && (now === null ? null : hashBytes(now)) === expected, bytes);
        if (!done) return false;
        const back = await files.readBytes(rel);
        if (back === null || hashBytes(back) !== file.backup!.sha256) throw Error('寫進去之後讀回來的內容不同');
        return true;
      };
      const work = deck ? run.deck(rel, write) : write();
      let done: boolean;
      try { done = await timed(work, '寫入'); } finally { live = false; }
      if (!done) { outcome(file, '跳過', CHANGED); continue; }
      written.add(path);
      result.written.push(rel);
      outcome(file, '已還原', '');
    } catch (error) {
      outcome(file, '失敗', message(error));
      run.fail('寫 ' + rel, error, rel);
    }
  }

  const at = Math.trunc(run.now());
  const date = formatTime(at, run.offset(at)).slice(0, 10);
  const names = new Set([...current.keys()].map(path => run.plan.sameFile(path)));
  for (const log of fresh.logs) {
    const lines = log.lines.length;
    if (closed()) { result.logs.push({ source: log.source, path: null, lines, outcome: '跳過', reason: STOPPED }); continue; }
    const refused = run.plan.refuse?.({ path: LOG_FOLDER + '/x.jsonl', target: LOG_FOLDER + '/x.jsonl', backup: new Uint8Array() });
    if (refused) { result.logs.push({ source: log.source, path: null, lines, outcome: '擋住', reason: refused }); continue; }
    const bytes = new TextEncoder().encode(log.lines.join('\n') + '\n');
    try {
      await run.noLinks(LOG_FOLDER);
      let path: string | null = null;
      // 只建新檔：撞到別的程序剛建的就換下一個編號，不動它（§3-4）。
      for (let i = 0; i < 20 && path === null; i++) {
        const candidate = LOG_FOLDER + '/' + restoreLogName(log.source, date, run.device, name => names.has(run.plan.sameFile(LOG_FOLDER + '/' + name)));
        names.add(run.plan.sameFile(candidate));
        if (await timed(files.replace(candidate, now => now === null, bytes), '補紀錄')) path = candidate;
      }
      if (path === null) throw Error('找不到沒用過的還原檔名');
      const back = await files.readBytes(path);
      if (back === null || hashBytes(back) !== hashBytes(bytes)) throw Error('寫進去之後讀回來的內容不同');
      result.written.push(path);
      result.logs.push({ source: log.source, path, lines, outcome: '已還原', reason: '' });
    } catch (error) {
      result.logs.push({ source: log.source, path: null, lines, outcome: '失敗', reason: message(error) });
      run.fail('補紀錄', error);
    }
  }

  const data = byPath.get(dataPath);
  if (data?.action === 'restore') {
    if (closed()) outcome(data, '跳過', STOPPED);
    else {
      try {
        const saved = await run.settings(opened.files.get(dataPath)!, run.screen.get(dataPath) ?? null);
        if (saved === 'saved') outcome(data, '已還原', '');
        else if (saved === 'changed') outcome(data, '跳過', CHANGED);
        else outcome(data, '失敗', saved === 'unreadable' ? '設定暫時讀不到，這次沒有寫' : '設定寫不進去');
      } catch (error) {
        outcome(data, '失敗', message(error));
        run.fail('寫設定', error);
      }
    }
  }
  result.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return result;
}
