import type { Files } from '../files.ts';
import { parseDeck } from './parse.ts';
import type { Deck } from './types.ts';

const ROOT = 'Essence Cards';
const SYSTEM_FOLDERS = new Set(['考試範圍', '錯題本', '記憶錨點', '製卡規則', '紀錄']);

export function isDeckPath(path: string): boolean {
  if (!path.startsWith(ROOT + '/') || !path.endsWith('.md')) return false;
  const parts = path.slice(ROOT.length + 1).split('/');
  return !(parts.length > 1 && SYSTEM_FOLDERS.has(parts[0]));
}

/** Essence Cards/ 底下的卡組路徑（isDeckPath），照字串排序。readDecks 與 state 都用它。 */
export async function listDeckPaths(files: Files): Promise<string[]> {
  return (await files.list(ROOT)).filter(isDeckPath).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

export async function readDecks(files: Files): Promise<{ path: string; deck: Deck }[]> {
  const paths = await listDeckPaths(files);
  const texts = await Promise.all(paths.map(path => files.read(path)));
  // 列出與讀之間被刪掉的檔案不算。
  return paths.flatMap((path, i) => {
    const text = texts[i];
    return text === null ? [] : [{ path, deck: parseDeck(text) }];
  });
}
