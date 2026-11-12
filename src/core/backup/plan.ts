import { isDeckPath, parseDeck } from '../deck/index.ts';
import type { Deck } from '../deck/index.ts';
import { isErrorLogPath } from '../errors/index.ts';
import { SETTINGS_FILE, decodeSettings, overlayLegacy, parseLoadData, sameSaved } from '../settings/index.ts';
import { isLogPath, LOG_FOLDER } from '../study/index.ts';
import { missingLogLines } from './logs.ts';
import type { MissingLines } from './logs.ts';
import { PLUGIN_DATA } from './manifest.ts';
import type { BackupManifest } from './manifest.ts';
import { hashBytes } from './zip.ts';

interface FileInfo { size: number; sha256: string }
/**
 * changed：現在的和備份不同；missing：現在沒有；same：相同（只在和別的檔撞名時列出）；added：備份後才有的。
 * 「設定」那一列看的是值（RestorePlan.settings），現在有值就不是 missing。
 */
type FileKind = 'changed' | 'missing' | 'same' | 'added';
/** restore：照選擇要還原；skip：可以還原但沒選；blocked：擋住（reasons）；keep：備份後才有的，不動。 */
type FileAction = 'restore' | 'skip' | 'blocked' | 'keep';
export interface PlannedFile {
  /** 備份裡的路徑；added 是現在的路徑。 */
  path: string;
  /** 寫回 vault 的位置：「設定」那一列一律是設定檔（tasks/settings-vault-file.md §4）。 */
  target: string;
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
  /**
   * 「設定」那一列（tasks/settings-vault-file.md §4）：path 是備份裡的來源（設定檔，沒有才用 data.json）。backup、current 是兩邊的值：
   * 設定檔疊上同一邊的 data.json（§2 的疊法），沒有設定檔就是 data.json；讀不懂是 null，現在兩個都沒有也是 null。備份裡兩個都沒有是 null。
   */
  settings: { path: string; backup: Record<string, unknown> | null; current: Record<string, unknown> | null } | null;
  /** action 是 restore 的檔，照寫入的順序（每個檔的 after 都排在它前面）。 */
  order: string[];
}
/** 呼叫的一方才知道的規則（tasks/plugin-restore.md §2）。 */
export interface PlanOptions {
  /** 這個 vault 現在的設定資料夾：現在的 data.json 在這裡（「設定」現在的值、不列成備份後才有）；確定不了是 null，不推定成 .obsidian（syntax §8）。 */
  config: string | null;
  /** 目的地那台電腦的檔名規則：會寫到同一個檔的兩個路徑得到相同的值（例如 Windows 不分大小寫）。 */
  sameFile: (path: string) => string;
  /** 平台才知道的不能還原的原因（以點開頭的檔、路徑上有連結、系統資料夾不在原位）；可以還原是 null。 */
  refuse?: (file: { path: string; target: string; backup: Uint8Array }) => string | null;
  /** 這份卡組這一版讀不懂（需要版本）：擋住（D-149 第 3 點）。 */
  needsUpdate?: (deck: Deck) => boolean;
}
interface PlanInput extends PlanOptions {
  manifest: BackupManifest;
  backup: ReadonlyMap<string, Uint8Array>;
  /** 現在 vault 裡的 `Essence Cards/` 全部（含設定檔），加上現在的設定資料夾裡的 data.json（有的話）。 */
  current: ReadonlyMap<string, Uint8Array>;
  /**
   * 要還原的檔（備份裡的路徑）；沒給就是全部能還原的。`紀錄/` 裡不是複習 JSONL、現在不見的檔一律算進去（syntax §5-4、§6：只補不刪，不用勾）。
   */
  selection?: ReadonlySet<string>;
}

const info = (bytes: Uint8Array): FileInfo => ({ size: bytes.length, sha256: hashBytes(bytes) });
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const byText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
/**
 * 勾選清單裡的檔：複習紀錄另外逐行補（logs）；錯誤紀錄（`紀錄/錯誤/`）不列也不補回（D-155 第 6 點、syntax §9），
 * 家長看不懂它的衝突與「備份後才有」，舊的錯誤仍在備份 zip 裡。這個例外只寫在這裡，不擴大 isLogPath。
 */
const listed = (path: string): boolean => !isLogPath(path) && !isErrorLogPath(path);
/** 這個檔還原時算不算卡組：備份的路徑或現在實際會寫的路徑，任何一邊是卡組就算（只差副檔名大小寫時兩邊不同，L2 的 R5）。 */
const isDeckWrite = (target: string, found: string | null | undefined): boolean => isDeckPath(target) || (found != null && isDeckPath(found));
/**
 * 一邊的設定值（tasks/settings-vault-file.md §4）：設定檔疊上同一邊的 data.json（和外掛讀的時候一樣，§2）；沒有設定檔就是 data.json。
 * data.json 照電腦上 Obsidian 的 loadData 讀：開頭有 BOM 就是讀不懂（L2 的 R5）。
 * 讀不懂是 null；兩個都沒有是 undefined。
 */
function settingsValue(file: Uint8Array | undefined, data: Uint8Array | undefined): Record<string, unknown> | null | undefined {
  if (file !== undefined) {
    const raw = decodeSettings(file);
    return raw ? overlayLegacy(raw, data === undefined ? undefined : parseLoadData(data) ?? undefined) : null;
  }
  return data === undefined ? undefined : parseLoadData(data);
}

/**
 * 「設定」現在的值，和計畫的 RestorePlan.settings.current 同一種算法（tasks/settings-vault-file.md §4）：設定檔疊上 data.json，
 * 沒有設定檔是 data.json；讀不懂、兩個都沒有是 null。寫之前拿它和比對時的比（格式查核第 4 節）。
 */
export function settingsNow(file: Uint8Array | null | undefined, data: Uint8Array | null | undefined): Record<string, unknown> | null {
  return settingsValue(file ?? undefined, data ?? undefined) ?? null;
}

/** 兩個「現在的值」相同：五個欄位相同（sameSaved），或兩個都是 null。 */
export function sameSettingsNow(a: Readonly<Record<string, unknown>> | null, b: Readonly<Record<string, unknown>> | null): boolean {
  return a === null || b === null ? a === b : sameSaved(a, b);
}

/**
 * 還原計畫（D-150 第 7、8 點；syntax §5-3、§8）。不寫任何檔。
 * - 「設定」那一列（tasks/settings-vault-file.md §4）：備份裡有設定檔就用它，沒有才用備份的 data.json（兩個都有時 data.json 不列）；
 *   目的地一律是設定檔，比的是值（五個欄位，不看 legacy 與不認得的），不套用一般檔案的規則。現在的 data.json 不列。
 * - 非紀錄的檔：和現在不同的（改過的、不見的）可以還原，備份後才有的列出但不動；`紀錄/` 裡不是複習 JSONL 的檔只補不見的，
 *   同名不同內容列成衝突；錯誤紀錄不列（listed）。對應到目的地之後撞名的，兩個都擋住。
 * - 全庫 ID 檢查：照選擇還原之後，`Essence Cards/` 的所有卡組有重複的學習目標 ID（同一篇裡重複也算），參與重複的還原檔
 *   擋住；擋住的不還原之後再檢查一次，直到沒有新的。
 * - 複習紀錄：每個來源缺的行。
 */
export function planRestore(input: PlanInput): RestorePlan {
  const { manifest, backup, current, config, sameFile } = input;
  const dataSource = manifest.vault.config + '/' + PLUGIN_DATA;
  const dataNow = config === null ? null : config + '/' + PLUGIN_DATA;
  const settingsKey = sameFile(SETTINGS_FILE);
  const fileInBackup = [...backup.keys()].sort(byText).find(path => sameFile(path) === settingsKey);
  const settingsSource = fileInBackup ?? (backup.has(dataSource) ? dataSource : null);
  const fileNow = [...current.keys()].sort(byText).find(path => sameFile(path) === settingsKey);
  const nowValue = settingsValue(fileNow === undefined ? undefined : current.get(fileNow), dataNow === null ? undefined : current.get(dataNow));
  const settings: RestorePlan['settings'] = settingsSource === null ? null : {
    path: settingsSource,
    backup: settingsValue(fileInBackup === undefined ? undefined : backup.get(fileInBackup), backup.get(dataSource)) ?? null,
    current: nowValue ?? null,
  };
  const targetOf = (path: string): string => path === settingsSource ? SETTINGS_FILE : path;
  const currentPath = new Map<string, string>();
  for (const path of current.keys()) if (listed(path) && path !== dataNow) currentPath.set(sameFile(path), path);
  const restorable = [...backup.keys()].filter(path => listed(path) && (path !== dataSource || path === settingsSource)).sort(byText);
  const writers = new Map<string, string[]>();
  for (const path of restorable) {
    const target = targetOf(path);
    writers.set(sameFile(target), [...writers.get(sameFile(target)) ?? [], path]);
  }

  const files: PlannedFile[] = [];
  const matched = new Set<string>();
  for (const path of restorable) {
    const bytes = backup.get(path)!;
    const target = targetOf(path);
    const key = sameFile(target);
    const found = currentPath.get(key);
    if (found !== undefined) matched.add(found);
    const now = found === undefined ? null : { path: found, ...info(current.get(found)!) };
    const mine = info(bytes);
    const others = writers.get(key)!.filter(other => other !== path);
    const isSettings = path === settingsSource;
    // 「設定」看值：現在有值就不是 missing；五個欄位相同就是 same（不看 legacy 與不認得的欄位）。
    const kind: FileKind = isSettings
      ? nowValue === undefined ? 'missing' : settings?.backup && nowValue && sameSaved(settings.backup, nowValue) ? 'same' : 'changed'
      : now === null ? 'missing' : now.sha256 === mine.sha256 ? 'same' : 'changed';
    if (kind === 'same' && others.length === 0) continue;
    const reasons: string[] = [];
    if (isSettings && !settings?.backup) reasons.push('備份裡的設定讀不懂');
    const refused = input.refuse?.({ path, target, backup: bytes });
    if (refused) reasons.push(refused);
    if (isDeckWrite(target, found)) {
      // 含 NUL 的卡組還原了也讀不回來（D-154 第 4 點）；需要新版的 Cards 不寫（備份那份或現在那份讀不懂都一樣）。
      if (bytes.includes(0)) reasons.push('備份裡這一篇的內容不完整（有 NUL）');
      else if (input.needsUpdate?.(parseDeck(text(bytes))) || (found !== undefined && input.needsUpdate?.(parseDeck(text(current.get(found)!))))) reasons.push('需要新版的外掛才讀得懂，這一版不寫它');
    }
    if (others.length) reasons.push('和「' + others.join('」、「') + '」在這台電腦會寫到同一個檔，兩個都不還原');
    if (kind === 'changed' && path.startsWith(LOG_FOLDER + '/')) reasons.push('紀錄裡的檔只補不見的：同名但內容不同，列成衝突');
    files.push({ path, target, kind, action: reasons.length ? 'blocked' : 'restore', reasons, backup: mine, current: now, after: [] });
  }
  for (const path of [...current.keys()].sort(byText)) {
    if (!listed(path) || matched.has(path) || path === dataNow) continue;
    files.push({ path, target: path, kind: 'added', action: 'keep', reasons: [], backup: null, current: { path, ...info(current.get(path)!) }, after: [] });
  }
  for (const file of files) {
    const always = file.kind === 'missing' && file.path.startsWith(LOG_FOLDER + '/');
    if (file.action === 'restore' && input.selection && !input.selection.has(file.path) && !always) file.action = 'skip';
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
  return { files, logs: missingLogLines(logs(backup), logs(current)), config: { source: manifest.vault.config, target: config }, settings, order };
}

/**
 * 寫入順序（Codex 中途查核 F1）：還原卡組 f 要加回的 ID（備份有、f 現在沒有）現在在另一篇要還原的卡組 g 裡，g 就排在 f 前面，
 * 記在 f.after。排不出來的（互相等待）回傳在 stuck。
 */
function orderWrites(files: PlannedFile[], { backup, current }: PlanInput): { order: string[]; stuck: { file: PlannedFile; waits: string[] }[] } {
  for (const file of files) file.after = [];
  const restoring = files.filter(file => file.action === 'restore');
  const decks = restoring.filter(file => isDeckWrite(file.target, file.current?.path));
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
export function deckIds(bytes: Uint8Array): string[] {
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
      if (file.action !== 'restore' || !isDeckWrite(file.target, file.current?.path)) continue;
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
