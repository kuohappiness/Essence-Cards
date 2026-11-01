import type { Deck } from '../deck/index.ts';

/** 用了重複 ID 的一個學習目標；line 從 0 算。 */
export interface DuplicateTarget { path: string; line: number; name: string }
export interface DuplicateId { id: string; targets: DuplicateTarget[] }

/**
 * 同一個學習目標 ID 有兩個以上的目標（D-157、syntax.md §2-3）：同一篇或不同篇都算，草稿、暫停、寫錯的目標也算。
 * 只看 target.id，所以 ambiguous-id 的候選、隱含目標、一般筆記、題目行的區塊 ID 都不算。不看位置決定誰保留：
 * 每個 ID 的目標都列出來，照路徑、行號排；ID 照它第一個目標的位置排。
 */
export function findDuplicateIds(decks: readonly { path: string; deck: Deck }[]): DuplicateId[] {
  const byId = new Map<string, DuplicateTarget[]>();
  for (const { path, deck } of [...decks].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    for (const target of deck.targets) {
      if (target.id === null) continue;
      const entry = { path, line: target.line, name: target.name };
      const list = byId.get(target.id);
      if (list) list.push(entry);
      else byId.set(target.id, [entry]);
    }
  }
  return [...byId].filter(([, targets]) => targets.length > 1).map(([id, targets]) => ({ id, targets }));
}
