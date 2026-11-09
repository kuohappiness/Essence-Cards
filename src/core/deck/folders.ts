// 系統資料夾（D-088）與它們的防呆（tasks/system-folder-guard.md）：名單只維護這一份，判斷都是純函式，不碰 Obsidian。

export const DECK_ROOT = 'Essence Cards';
/** Essence Cards/ 第一層的系統資料夾：底下的 .md 不是卡組（isDeckPath）。 */
export const SYSTEM_FOLDERS: readonly string[] = ['考試範圍', '錯題本', '記憶錨點', '製卡規則', '紀錄'];
/** 外掛用的子資料夾。 */
const SUB_FOLDERS: readonly string[] = ['紀錄/錯誤', '紀錄/AI 輸出', '紀錄/考試切面', '考試範圍/小考'];
/** 不能搬、不能改名的資料夾（vault 路徑，D-048 補充）：根資料夾本身、五個系統資料夾與外掛用的子資料夾；上層在前。 */
const GUARDED: readonly string[] = [DECK_ROOT, ...[...SYSTEM_FOLDERS, ...SUB_FOLDERS].map(name => DECK_ROOT + '/' + name)];

/** 紀錄與錯誤紀錄的檔名（`YYYY-MM 裝置.jsonl`、`YYYY-MM 裝置 錯誤.jsonl`）：家長自己的資料夾不會有。 */
const LOG_NAME = /^\d{4}-\d{2} .+\.jsonl$/;

const parentOf = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const inside = (path: string, folder: string): boolean => path.startsWith(folder + '/');
/** 畫面上的名字：根資料夾寫 Essence Cards，其他寫根資料夾底下的相對路徑（「紀錄/錯誤」）。 */
export const folderLabel = (folder: string): string => folder === DECK_ROOT ? DECK_ROOT : folder.slice(DECK_ROOT.length + 1);

/**
 * 同一批改名裡要搬回的（§1-2）：舊路徑剛好是名單裡的一個，而且上一層沒有也在這一批（同一批只處理最上層）。
 * 搬一個資料夾時底下每一項都各有一次改名，所以 `Essence Cards` 整個搬走時只回 `Essence Cards`。
 */
export function guardedMoves(oldPaths: readonly string[]): string[] {
  const hits = [...new Set(oldPaths.filter(path => GUARDED.includes(path)))];
  return hits.filter(path => !hits.some(other => inside(path, other)));
}

/** 原位有檔的系統資料夾（§2-1）：這台記住看過它們。files 是 vault 裡所有檔的路徑。 */
export function presentFolders(files: readonly string[]): string[] {
  return GUARDED.filter(folder => files.some(path => inside(path, folder)));
}

export type FolderIssue =
  /** 原位沒有檔，在別處找到同名的資料夾（at 至少一個）。 */
  | { kind: 'moved'; folder: string; at: string[] }
  /** 原位沒有檔，也找不到。 */
  | { kind: 'missing'; folder: string }
  /** 原位有檔，別處也有一個看起來是它的（檔名重疊，或是外掛寫的紀錄檔名）。 */
  | { kind: 'both'; folder: string; at: string[] };

/**
 * 搬錯位置的系統資料夾（§2-2、§2-4）。files 是 vault 裡所有檔的路徑；remembered 是這台看過原位有檔的（presentFolders 累積的）。
 * 只有記住的才算，避免新的 vault 把家長自己同名的卡組資料夾當成搬走的系統資料夾。上層已經列了的，下層不再列。照 GUARDED 的順序。
 */
export function folderIssues(files: readonly string[], remembered: readonly string[]): FolderIssue[] {
  const folders = new Set(files.flatMap(path => {
    const out: string[] = [];
    for (let at = parentOf(path); at; at = parentOf(at)) out.push(at);
    return out;
  }));
  const filesIn = (folder: string): string[] => files.filter(path => inside(path, folder)).map(path => path.slice(folder.length + 1));
  const issues: FolderIssue[] = [];
  /** 已經列了的：底下的不再列。 */
  const flagged = new Set<string>();
  for (const folder of GUARDED) {
    if (!remembered.includes(folder) || [...flagged].some(up => inside(folder, up))) continue;
    const here = filesIn(folder);
    if (folder === DECK_ROOT) {
      if (here.length) continue;
      flagged.add(folder);
      // 根資料夾整個不見：在整個 vault 找名叫 Essence Cards、裡面有記住的系統資料夾的。
      const kids = remembered.filter(path => path !== DECK_ROOT).map(path => path.slice(DECK_ROOT.length));
      const at = [...folders].filter(f => f !== DECK_ROOT && nameOf(f) === DECK_ROOT && kids.some(kid => filesIn(f + kid).length > 0)).sort();
      issues.push(at.length ? { kind: 'moved', folder, at } : { kind: 'missing', folder });
      continue;
    }
    const name = nameOf(folder);
    const others = [...folders].filter(f => f !== folder && inside(f, DECK_ROOT) && !inside(f, folder) && nameOf(f) === name && filesIn(f).length > 0).sort();
    if (!here.length) {
      flagged.add(folder);
      issues.push(others.length ? { kind: 'moved', folder, at: others } : { kind: 'missing', folder });
      continue;
    }
    const logs = folder === DECK_ROOT + '/紀錄' || inside(folder, DECK_ROOT + '/紀錄');
    const known = new Set(here);
    const twins = others.filter(f => filesIn(f).some(rel => known.has(rel) || (logs && !rel.includes('/') && LOG_NAME.test(rel))));
    if (!twins.length) continue;
    flagged.add(folder);
    issues.push({ kind: 'both', folder, at: twins });
  }
  return issues;
}

/** 搬錯位置的那幾個資料夾（§2-3）：找到的位置（at）裡面的 .md 不當卡組讀；from 是它的原位。 */
export function misplacedFolders(issues: readonly FolderIssue[]): { from: string; at: string }[] {
  return issues.flatMap(issue => issue.kind === 'missing' ? [] : issue.at.map(at => ({ from: issue.folder, at })));
}
