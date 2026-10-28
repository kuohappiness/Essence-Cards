import { isDeckPath, parseDeck } from '../deck/index.ts';
import { isLogPath, LOG_FOLDER } from '../study/index.ts';
import { missingLogLines } from './logs.ts';
import type { MissingLines } from './logs.ts';
import { PLUGIN_DATA } from './manifest.ts';
import type { BackupManifest } from './manifest.ts';
import { hashBytes } from './zip.ts';

interface FileInfo { size: number; sha256: string }
/**
 * changed：現在的和備份不同；missing：現在沒有；same：相同（只在和別的檔撞名時列出）；
 * added：備份後才有的；unmapped：寫回的位置確定不了（data.json 而現在的設定資料夾不明）。
 */
type FileKind = 'changed' | 'missing' | 'same' | 'added' | 'unmapped';
/** restore：照選擇要還原；skip：可以還原但沒選；blocked：擋住（reasons）；keep：備份後才有的，不動。 */
type FileAction = 'restore' | 'skip' | 'blocked' | 'keep';
export interface PlannedFile {
  /** 備份裡的路徑；added 是現在的路徑。 */
  path: string;
  /** 寫回 vault 的位置；unmapped 是 null。 */
  target: string | null;
  kind: FileKind;
  action: FileAction;
  reasons: string[];
  backup: FileInfo | null;
  /** 現在的檔；path 是現在的寫法（在不分大小寫的電腦上可能和 target 的大小寫不同）。 */
  current: (FileInfo & { path: string }) | null;
  /**
   * 要先寫成的還原檔（備份裡的路徑）：這一篇要加回的學習目標 ID 現在還在它們裡面，先釋放、再加入，中間才不會重複。
   * 它們有一個沒寫成，這一篇就不寫（Codex 中途查核 F1）。
   */
  after: string[];
}
export interface RestorePlan {
  files: PlannedFile[];
  /** 每個來源缺的複習紀錄（syntax §5-3）；不在勾選清單裡，一律補。 */
  logs: MissingLines[];
  /** 來源（清單的 vault.config）與目的（這個 vault 現在的設定資料夾；確定不了是 null）。 */
  config: { source: string; target: string | null };
  /** action 是 restore 的檔，照寫入的順序（每個檔的 after 都排在它前面）。 */
  order: string[];
}
interface PlanInput {
  manifest: BackupManifest;
  backup: ReadonlyMap<string, Uint8Array>;
  /** 現在 vault 裡的 `Essence Cards/` 全部，加上現在的設定資料夾裡的 data.json（有的話）。 */
  current: ReadonlyMap<string, Uint8Array>;
  /** 這個 vault 現在的設定資料夾；確定不了是 null，data.json 擋住、不推定成 .obsidian（syntax §8）。 */
  config: string | null;
  /** 目的地那台電腦的檔名規則：會寫到同一個檔的兩個路徑得到相同的值（例如 Windows 不分大小寫）。 */
  sameFile: (path: string) => string;
  /** 要還原的檔（備份裡的路徑）；沒給就是全部能還原的。 */
  selection?: ReadonlySet<string>;
}

const info = (bytes: Uint8Array): FileInfo => ({ size: bytes.length, sha256: hashBytes(bytes) });
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const byText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/**
 * 還原計畫（D-150 第 7、8 點；syntax §5-3、§8）。不寫任何檔。
 * - 非紀錄的檔：和現在不同的（改過的、不見的）可以還原，備份後才有的列出但不動；`紀錄/` 裡不是複習 JSONL 的檔只補不見的，
 *   同名不同內容列成衝突。對應到目的地之後撞名的，兩個都擋住。
 * - 全庫 ID 檢查：照選擇還原之後，`Essence Cards/` 的所有卡組有重複的學習目標 ID（同一篇裡重複也算），參與重複的還原檔
 *   擋住；擋住的不還原之後再檢查一次，直到沒有新的。
 * - 複習紀錄：每個來源缺的行。
 */
export function planRestore(input: PlanInput): RestorePlan {
  const { manifest, backup, current, config, sameFile } = input;
  const dataSource = manifest.vault.config + '/' + PLUGIN_DATA;
  const targetOf = (path: string): string | null => path !== dataSource ? path : config === null ? null : config + '/' + PLUGIN_DATA;
  const currentPath = new Map<string, string>();
  for (const path of current.keys()) if (!isLogPath(path)) currentPath.set(sameFile(path), path);
  const restorable = [...backup.keys()].filter(path => !isLogPath(path)).sort(byText);
  const writers = new Map<string, string[]>();
  for (const path of restorable) {
    const target = targetOf(path);
    if (target !== null) writers.set(sameFile(target), [...writers.get(sameFile(target)) ?? [], path]);
  }

  const files: PlannedFile[] = [];
  const matched = new Set<string>();
  for (const path of restorable) {
    const bytes = backup.get(path)!;
    const target = targetOf(path);
    if (target === null) {
      files.push({ path, target, kind: 'unmapped', action: 'blocked', backup: info(bytes), current: null, after: [],
        reasons: ['這個 vault 現在的設定資料夾確定不了（裡面要有 plugins/essence-cards/manifest.json），不推定成 .obsidian'] });
      continue;
    }
    const key = sameFile(target);
    const found = currentPath.get(key);
    if (found !== undefined) matched.add(found);
    const now = found === undefined ? null : { path: found, ...info(current.get(found)!) };
    const mine = info(bytes);
    const others = writers.get(key)!.filter(other => other !== path);
    const kind: FileKind = now === null ? 'missing' : now.sha256 === mine.sha256 ? 'same' : 'changed';
    if (kind === 'same' && others.length === 0) continue;
    const reasons: string[] = [];
    if (others.length) reasons.push('和「' + others.join('」、「') + '」在這台電腦會寫到同一個檔，兩個都不還原');
    if (kind === 'changed' && path.startsWith(LOG_FOLDER + '/')) reasons.push('紀錄裡的檔只補不見的：同名但內容不同，列成衝突');
    files.push({ path, target, kind, action: reasons.length ? 'blocked' : 'restore', reasons, backup: mine, current: now, after: [] });
  }
  for (const path of [...current.keys()].sort(byText)) {
    if (isLogPath(path) || matched.has(path)) continue;
    files.push({ path, target: path, kind: 'added', action: 'keep', reasons: [], backup: null, current: { path, ...info(current.get(path)!) }, after: [] });
  }
  for (const file of files) {
    if (file.action === 'restore' && input.selection && !input.selection.has(file.path)) file.action = 'skip';
  }
  // 擋住交換 ID 這類排不出順序的檔之後，還原的集合變了，ID 要再查一次。
  let order: string[];
  for (;;) {
    checkIds(files, input);
    const ordered = orderWrites(files, input);
    order = ordered.order;
    if (ordered.stuck.length === 0) break;
    for (const { file, waits } of ordered.stuck) {
      file.action = 'blocked';
      file.reasons.push('要先還原「' + waits.join('」、「') + '」，讓它們釋放這一篇加回的學習目標 ID，但彼此互相等待（例如交換了目標），不能逐檔安全還原');
    }
  }

  const logs = (map: ReadonlyMap<string, Uint8Array>): { path: string; text: string }[] =>
    [...map].filter(([path]) => isLogPath(path)).map(([path, bytes]) => ({ path, text: text(bytes) }));
  return { files, logs: missingLogLines(logs(backup), logs(current)), config: { source: manifest.vault.config, target: config }, order };
}

/**
 * 寫入順序（Codex 中途查核 F1）：還原卡組 f 要加回的 ID（備份有、f 現在沒有）現在在另一篇要還原的卡組 g 裡，g 就排在 f 前面，
 * 記在 f.after。排不出來的（互相等待）回傳在 stuck。
 */
function orderWrites(files: PlannedFile[], { backup, current }: PlanInput): { order: string[]; stuck: { file: PlannedFile; waits: string[] }[] } {
  for (const file of files) file.after = [];
  const restoring = files.filter(file => file.action === 'restore');
  const decks = restoring.filter(file => file.target !== null && isDeckPath(file.target));
  const now = new Map(decks.map(file => [file, new Set(file.current ? deckIds(current.get(file.current.path)!) : [])]));
  for (const file of restoring) {
    const mine = now.get(file);
    if (!mine) continue;
    const adds = deckIds(backup.get(file.path)!).filter(id => !mine.has(id));
    file.after = decks.filter(other => other !== file && adds.some(id => now.get(other)!.has(id))).map(other => other.path);
  }
  const done = new Set<string>();
  const order: string[] = [];
  for (let moved = true; moved;) {
    moved = false;
    for (const file of restoring) {
      if (done.has(file.path) || file.after.some(path => !done.has(path))) continue;
      done.add(file.path);
      order.push(file.path);
      moved = true;
    }
  }
  return { order, stuck: restoring.filter(file => !done.has(file.path)).map(file => ({ file, waits: file.after.filter(path => !done.has(path)) })) };
}

interface Occurrence { shown: string; restored: PlannedFile | null }

/** 一篇卡組占用的學習目標 ID：每個目標的 ID，ambiguous 的目標是它的候選（同 state 的 targetIds、D-134），同一個目標只算一次。 */
function deckIds(bytes: Uint8Array): string[] {
  return parseDeck(text(bytes)).targets.flatMap(target => [...new Set([...target.id === null ? [] : [target.id], ...target.idCandidates ?? []])]);
}

function checkIds(files: PlannedFile[], { backup, current, sameFile }: PlanInput): void {
  const ids = new Map<string, string[]>();
  const idsOf = (key: string, bytes: Uint8Array): string[] => {
    let found = ids.get(key);
    if (!found) ids.set(key, found = deckIds(bytes));
    return found;
  };
  for (;;) {
    // 還原之後的卡組：現在的，被選的還原檔蓋過去（同一個目的地）。
    const decks = new Map<string, { shown: string; ids: string[]; restored: PlannedFile | null }>();
    for (const [path, bytes] of current) if (isDeckPath(path)) decks.set(sameFile(path), { shown: path, ids: idsOf('now:' + path, bytes), restored: null });
    for (const file of files) {
      if (file.action !== 'restore' || file.target === null || !isDeckPath(file.target)) continue;
      decks.set(sameFile(file.target), { shown: file.current?.path ?? file.target, ids: idsOf('backup:' + file.path, backup.get(file.path)!), restored: file });
    }
    const where = new Map<string, Occurrence[]>();
    for (const deck of decks.values()) for (const id of deck.ids) where.set(id, [...where.get(id) ?? [], deck]);
    const blocked = new Set<PlannedFile>();
    for (const [id, list] of where) {
      if (list.length < 2) continue;
      for (const occurrence of new Set(list)) {
        if (!occurrence.restored) continue;
        const same = list.filter(other => other === occurrence).length > 1;
        const elsewhere = [...new Set(list.filter(other => other !== occurrence)
          .map(other => other.restored ? '還原的「' + other.shown + '」也有' : '現在在「' + other.shown + '」'))];
        occurrence.restored.reasons.push('學習目標 ID ' + id + ' ' + [...same ? ['在同一篇裡重複'] : [], ...elsewhere].join('、'));
        blocked.add(occurrence.restored);
      }
    }
    if (blocked.size === 0) return;
    for (const file of blocked) file.action = 'blocked';
  }
}
