import type { App } from 'obsidian';
import { ESSENCE_ROOT } from '../core/backup/index.ts';
import type { QuizResolved } from '../state/index.ts';

// 小考檔的連結指向哪一篇（tasks/quiz-mark.md §1）：用 Obsidian 的連結解析，和 src/ui/sources.ts 傳入來源檔路徑的做法一樣。

const ROOT = ESSENCE_ROOT.toLowerCase() + '/';
const folderOf = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Obsidian 拿來找的那一段（小寫）：檔名有點、vault 裡也有這個檔名時照寫的找，否則加 `.md`（1.15.0 的 getLinkpathDest）。
 * 所以 `English.MD` 找的是 English.md（L2 R7），`Topic.MD` 在只有 Topic.MD.md 時找的是 Topic.MD.md（L2 R8）：不能只看字尾猜。
 */
function lookedUp(link: string, files: readonly { path: string }[]): string {
  const lower = link.toLowerCase(), name = nameOf(lower);
  return name.includes('.') && files.some(each => nameOf(each.path.toLowerCase()) === name) ? lower : lower + '.md';
}

/**
 * 連結寫的是一個確切的位置時回那個位置（小寫）：外掛寫的完整路徑（卡組都在 Essence Cards/ 底下）、`/` 開頭、`./` 與 `../`。
 * 只寫檔名或一段路徑的回 null。Obsidian 在確切的位置沒有檔時會退回路徑尾巴相同的檔（1.15.0 的 getLinkpathDest，L2 R1），
 * 那一篇搬走或刪掉、另一層剛好有整包備份時會指到備份，所以這種連結要自己比。looked 是 lookedUp 的結果。
 */
function exactPath(looked: string, from: string): string | null {
  let written = looked;
  if (written.startsWith('/')) return written.slice(1);
  if (written.startsWith('./') || written.startsWith('../')) {
    let folder = folderOf(from).toLowerCase();
    if (written.startsWith('./')) written = written.slice(2);
    while (written.startsWith('../')) { written = written.slice(3); folder = folderOf(folder); }
    return folder ? folder + '/' + written : written;
  }
  return written.startsWith(ROOT) ? written : null;
}

/**
 * 找不到是 none。寫確切位置的連結只認那個位置。只寫檔名或一段路徑的：getFirstLinkpathDest 重名時也只回一個，所以另外看字面，
 * 同時符合好幾個檔時是 several，不靠 Obsidian 挑的那一個（D-081 檔名不重複，手動複製還是可能重名）。
 */
export function quizLinkResolver(app: App): (link: string, from: string) => QuizResolved {
  return (link, from) => {
    const file = app.metadataCache.getFirstLinkpathDest(link, from);
    if (!file) return { kind: 'none' };
    const files = app.vault.getFiles();
    const looked = lookedUp(link, files);
    const exact = exactPath(looked, from);
    if (exact !== null) return file.path.toLowerCase() === exact ? { kind: 'file', path: file.path } : { kind: 'none' };
    const tail = '/' + looked;
    const same = files.filter(each => ('/' + each.path.toLowerCase()).endsWith(tail));
    return same.length > 1 ? { kind: 'several' } : { kind: 'file', path: file.path };
  };
}
