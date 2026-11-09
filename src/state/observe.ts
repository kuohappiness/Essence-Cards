import { changesInOrder } from '../core/study/index.ts';
import type { NewEntry } from '../core/study/index.ts';

/**
 * 狀態與設定的變更紀錄（tasks/record-gaps.md §1）：每一行的意思是「這台在 t 看到這個值」。
 * 只和這台自己的紀錄比：別台時鐘偏快或別台的行先同步到，都不會讓這台多寫。不存「已觀察」的狀態到磁碟。
 */

type Observed = Extract<NewEntry, { set: 'status' | 'cap' | 'retention' | 'filter' | 'semester' }>;
export interface Observation {
  entry: Observed;
  /** 這台沒有舊行時也要寫（基準）：沒暫停的目標不寫，一篇幾十個目標不寫一堆行。 */
  baseline: boolean;
}

const keyOf = (set: string, deck: string | null, lt: string | null): string => JSON.stringify([set, deck, lt]);
const entryKey = (entry: Observed): string => keyOf(entry.set, 'deck' in entry ? entry.deck : null, 'lt' in entry ? entry.lt : null);

export function createObserver(options: {
  version: string | null;
  /** 這台自己的紀錄（檔名正好是 logPath 的格式，衝突副本與還原檔不算）。 */
  own: () => readonly (readonly [string, string])[];
  write: (entry: Observed) => void;
}) {
  /**
   * 這次執行寫過的值，含還在佇列的。時鐘回撥或換時區時，新的一行會寫進較舊的月份檔，只照月份排會一直以為最後一行是舊值；
   * 重開後在回撥期間最多多一行，是一筆多餘的觀察，不影響排程。
   */
  const written = new Map<string, string>();
  /** 每個檔解析過的變更：內容沒變不重新解析。 */
  const parsed = new Map<string, { text: string; changes: ReturnType<typeof changesInOrder> }>();
  function lastOwn(): Map<string, string> {
    const last = new Map<string, string>();
    for (const [path, text] of [...options.own()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      let known = parsed.get(path);
      if (known?.text !== text) {
        known = { text, changes: changesInOrder(text, options.version) };
        parsed.set(path, known);
      }
      for (const change of known.changes) last.set(keyOf(change.set, change.deck, change.lt), JSON.stringify(change.val));
    }
    return last;
  }
  return {
    compare(observations: readonly Observation[]): void {
      const last = lastOwn();
      for (const { entry, baseline } of observations) {
        const key = entryKey(entry), value = JSON.stringify(entry.val);
        const known = written.get(key) ?? last.get(key);
        if (known === undefined ? !baseline : known === value) continue;
        written.set(key, value);
        options.write(entry);
      }
    },
  };
}
