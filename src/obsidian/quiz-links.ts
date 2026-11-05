import type { App } from 'obsidian';
import type { QuizResolved } from '../state/index.ts';

// 小考檔的連結指向哪一篇（tasks/quiz-mark.md §1）：用 Obsidian 的連結解析，和 src/ui/sources.ts 傳入來源檔路徑的做法一樣。

/**
 * 找不到是 none。getFirstLinkpathDest 重名時也只回一個，所以另外看字面：完整路徑只有一個答案；檔名或部分路徑同時符合好幾個檔時是 several，不靠 Obsidian 挑的那一個（D-081 檔名不重複，手動複製還是可能重名）。
 */
export function quizLinkResolver(app: App): (link: string, from: string) => QuizResolved {
  return (link, from) => {
    const file = app.metadataCache.getFirstLinkpathDest(link, from);
    if (!file) return { kind: 'none' };
    const written = (link.endsWith('.md') ? link : link + '.md').toLowerCase();
    if (file.path.toLowerCase() === written) return { kind: 'file', path: file.path };
    const tail = '/' + written;
    const same = app.vault.getFiles().filter(each => ('/' + each.path.toLowerCase()).endsWith(tail));
    return same.length > 1 ? { kind: 'several' } : { kind: 'file', path: file.path };
  };
}
