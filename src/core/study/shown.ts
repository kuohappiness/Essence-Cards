import type { ReviewEntry, Shown } from './types.ts';

// 出題歷史（tasks/question-type-seam.md §4）：和評分分開。最上層和 also 的句子都算，不看 r；plan（今天以前）、session（當天）、practice（本輪以前）共用。

/** 這一行出的每一句記進 shown，回傳同一個 shown。呼叫端照時間順序餵；取消的行不要餵。 */
export function addShown(shown: Shown, entry: ReviewEntry): Shown {
  for (const print of new Set([entry.v, ...entry.also ?? []])) {
    if (print !== null) shown.set(print, { at: entry.at, count: (shown.get(print)?.count ?? 0) + 1 });
  }
  return shown;
}

/** base 的複本加上這些行。 */
export function shownWith(base: Shown, entries: readonly ReviewEntry[]): Shown {
  const shown: Shown = new Map(base);
  for (const entry of entries) addShown(shown, entry);
  return shown;
}
