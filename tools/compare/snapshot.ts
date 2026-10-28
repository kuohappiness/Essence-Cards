/**
 * 發布前比較的比較資料（任務說明 1-3）：兩個版本各用自己的程式讀同一份凍結的備份，輸出這個形狀，再逐項比。
 * 轉接器（adapter.ts）產生它，compare-versions.ts 比較它。
 */
interface TargetSnap {
  /** 有 ID 用 ID；沒 ID 用位置與名稱（`@<行>:<名稱>`）。 */
  key: string;
  id: string | null;
  name: string;
  line: number;
  ok: boolean;
  fingerprints: string[];
  importance: string;
  paused: boolean;
  direction: string | null;
}
export interface DeckSnap {
  path: string;
  /** 會影響排程的屬性。 */
  props: { status: string; isTranscript: boolean; term: string | null; subject: string | null; unit: string | null; categories: string[] };
  targets: TargetSnap[];
  /** 問題清單：`<行> <level> <code>`。 */
  problems: string[];
}
export interface TodaySnap {
  list: 'share' | 'more';
  lt: string;
  deck: string;
  lane: string;
  retention: number;
  /** 這次出的那一題的指紋（還沒作答時的第一題）。 */
  prompt: string | null;
  direction: string | null;
}
export interface Snapshot {
  decks: DeckSnap[];
  /** 每個學習目標的下次到期時間（毫秒）；沒有作答過是 null。 */
  due: Record<string, number | null>;
  /** 今天的份，照順序。 */
  today: TodaySnap[];
  /** 從今天起 30 天每天的到期數（到期已過的算今天）；固定現有紀錄，不模擬之後的作答。 */
  days: number[];
}
export type AdapterResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: string };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** 兩份比較資料的差異，一項一行；完全相同是空的。time 把毫秒寫成看得懂的時間。 */
export function diffSnapshots(before: Snapshot, after: Snapshot, time: (ms: number) => string): string[] {
  const out: string[] = [];
  const decksA = new Map(before.decks.map(deck => [deck.path, deck])), decksB = new Map(after.decks.map(deck => [deck.path, deck]));
  for (const path of [...new Set([...decksA.keys(), ...decksB.keys()])].sort()) {
    const a = decksA.get(path), b = decksB.get(path);
    if (!a || !b) { out.push(`卡組${a ? '不見了' : '多了'}：${path}`); continue; }
    for (const key of Object.keys(a.props) as (keyof DeckSnap['props'])[]) {
      if (!same(a.props[key], b.props[key])) out.push(`${path} 的屬性 ${key}：${JSON.stringify(a.props[key])} → ${JSON.stringify(b.props[key])}`);
    }
    const targetsA = new Map(a.targets.map(target => [target.key, target])), targetsB = new Map(b.targets.map(target => [target.key, target]));
    for (const key of [...new Set([...targetsA.keys(), ...targetsB.keys()])]) {
      const x = targetsA.get(key), y = targetsB.get(key);
      if (!x || !y) { out.push(`${path} 的學習目標${x ? '不見了' : '多了'}：${key}（${(x ?? y)!.name}）`); continue; }
      for (const field of ['name', 'line', 'ok', 'fingerprints', 'importance', 'paused', 'direction'] as const) {
        if (!same(x[field], y[field])) out.push(`${path} 的 ${key} 的 ${field}：${JSON.stringify(x[field])} → ${JSON.stringify(y[field])}`);
      }
    }
    const problemsB = new Set(b.problems), problemsA = new Set(a.problems);
    for (const problem of a.problems) if (!problemsB.has(problem)) out.push(`${path} 少了問題：${problem}`);
    for (const problem of b.problems) if (!problemsA.has(problem)) out.push(`${path} 多了問題：${problem}`);
  }
  for (const id of [...new Set([...Object.keys(before.due), ...Object.keys(after.due)])].sort()) {
    const a = before.due[id], b = after.due[id];
    if (a === b) continue;
    const show = (value: number | null | undefined): string => value === undefined ? '（沒有這個目標）' : value === null ? '（新卡）' : time(value);
    out.push(`${id} 的下次到期：${show(a)} → ${show(b)}`);
  }
  const order = (list: TodaySnap[]): string => list.map(item => item.list + ':' + item.lt).join(',');
  if (order(before.today) !== order(after.today)) {
    out.push(`今天的份的順序不同：${before.today.map(item => item.lt).join('、') || '（沒有）'} → ${after.today.map(item => item.lt).join('、') || '（沒有）'}`);
  }
  const todayA = new Map(before.today.map(item => [item.lt, item]));
  for (const item of after.today) {
    const old = todayA.get(item.lt);
    if (!old) continue;
    for (const field of ['list', 'deck', 'lane', 'retention', 'prompt', 'direction'] as const) {
      if (!same(old[field], item[field])) out.push(`今天的份裡 ${item.lt} 的 ${field}：${JSON.stringify(old[field])} → ${JSON.stringify(item[field])}`);
    }
  }
  if (!same(before.days, after.days)) out.push(`未來 30 天每天的到期數：${before.days.join(' ')} → ${after.days.join(' ')}`);
  return out;
}
