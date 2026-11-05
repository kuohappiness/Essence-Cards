import type { App } from 'obsidian';
import { ESSENCE_ROOT } from '../core/backup/index.ts';
import type { QuizResolved } from '../state/index.ts';

// 小考檔的連結指向哪一篇（tasks/quiz-mark.md §1）：用 Obsidian 的連結解析，和 src/ui/sources.ts 傳入來源檔路徑的做法一樣。

const ROOT = ESSENCE_ROOT.toLowerCase() + '/';
const folderOf = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const withMd = (link: string): string => (link.endsWith('.md') ? link : link + '.md').toLowerCase();

/**
 * 連結寫的是一個確切的位置時回那個位置（小寫）：外掛寫的完整路徑（卡組都在 Essence Cards/ 底下）、`/` 開頭、`./` 與 `../`。
 * 只寫檔名或一段路徑的回 null。Obsidian 在確切的位置沒有檔時會退回路徑尾巴相同的檔（1.15.0 的 getLinkpathDest，L2 R1），
 * 那一篇搬走或刪掉、另一層剛好有整包備份時會指到備份，所以這種連結要自己比。
 */
function exactPath(link: string, from: string): string | null {
  let written = withMd(link);
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
    const exact = exactPath(link, from);
    if (exact !== null) return file.path.toLowerCase() === exact ? { kind: 'file', path: file.path } : { kind: 'none' };
    const tail = '/' + withMd(link);
    const same = app.vault.getFiles().filter(each => ('/' + each.path.toLowerCase()).endsWith(tail));
    return same.length > 1 ? { kind: 'several' } : { kind: 'file', path: file.path };
  };
}
