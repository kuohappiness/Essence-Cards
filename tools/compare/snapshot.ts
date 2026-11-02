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
interface Problem { line: number; level: string; code: string }
// 單元與問題的欄位分開放，不接成字串：`L1 Back` ＋ `to School` 接起來和 `L1` ＋ `Back to School` 一樣，切法變了比不出來。
export interface DeckSnap {
  path: string;
  /** 會影響排程的屬性。 */
  props: { status: string; isTranscript: boolean; term: string | null; subject: string | null; unit: { code: string; name: string } | null; categories: string[] };
  targets: TargetSnap[];
  problems: Problem[];
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
/** 用了同一個學習目標 ID 的目標（D-157）；line 從 0 算。 */
interface Conflict { id: string; targets: { path: string; line: number; name: string }[] }
/** 那一版的 state 擋下來的內容（syntax.md §0-1、§2-1、§5-2，D-157）。 */
export interface Gates {
  /** 需要新版才讀得懂的卡組：不出題；那一版讀不懂，內容不進 decks。 */
  decks: string[];
  /** 讀不懂的紀錄行停掉的學習目標。 */
  held: string[];
  /** 有一行辨認不出影響範圍：全部學習目標都停。 */
  incomplete: boolean;
  /** 重複的 ID；那一版沒有這個判斷是 null。 */
  conflicts: Conflict[] | null;
}
export interface Snapshot {
  gates: Gates;
  /** 那一版讀得懂的卡組。 */
  decks: DeckSnap[];
  /** 每個學習目標的下次到期時間（毫秒）；沒有作答過是 null；那一版的 state 停掉的（不收作答）是 'stopped'。 */
  due: Record<string, number | null | 'stopped'>;
  /** 今天的份，照順序。 */
  today: TodaySnap[];
  /** 從今天起 30 天每天的到期數（到期已過的算今天）；固定現有紀錄，不模擬之後的作答。 */
  days: number[];
}
export type AdapterResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: string };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const showProblem = ({ line, level, code }: Problem): string => `${line} ${level} ${code}`;
const showConflict = ({ id, targets }: Conflict): string => `${id}（${targets.map(target => `${target.path} 第 ${target.line + 1} 行「${target.name}」`).join('、')}）`;

/** 這一版擋下來的內容，給報告看：沒有差異時也要看得到，例如舊版沒有的判斷、新版找到的重複 ID。 */
export function gateLines(gates: Gates): string[] {
  return [
    `需要新版才讀得懂的卡組：${gates.decks.length ? gates.decks.join('、') + '（內容沒有比到）' : '沒有'}`,
    `讀不懂的紀錄行停掉的學習目標：${gates.held.join('、') || '沒有'}`,
    `整份紀錄不完整（全部學習目標都停）：${gates.incomplete ? '是' : '否'}`,
    `重複的學習目標 ID（這些目標都停）：${gates.conflicts === null ? '這一版沒有這個判斷' : gates.conflicts.map(showConflict).join('；') || '沒有'}`,
  ];
}

function diffGates(before: Gates, after: Gates): string[] {
  const out: string[] = [];
  if (before.incomplete !== after.incomplete) out.push(`整份紀錄不完整：${before.incomplete ? '是' : '否'} → ${after.incomplete ? '是' : '否'}`);
  for (const id of before.held) if (!after.held.includes(id)) out.push(`紀錄行不再停掉：${id}`);
  for (const id of after.held) if (!before.held.includes(id)) out.push(`紀錄行停掉：${id}`);
  // 一邊沒有這個判斷時不是「沒有重複」：另一邊找到的每一個都要報（舊版不跑新版的規則）。
  if (before.conflicts === null || after.conflicts === null) {
    for (const each of before.conflicts ?? []) out.push(`重複的學習目標 ID（新版沒有這個判斷）：${showConflict(each)}`);
    for (const each of after.conflicts ?? []) out.push(`重複的學習目標 ID（舊版沒有這個判斷）：${showConflict(each)}`);
    return out;
  }
  const conflictsA = new Map(before.conflicts.map(each => [each.id, each])), conflictsB = new Map(after.conflicts.map(each => [each.id, each]));
  for (const id of [...new Set([...conflictsA.keys(), ...conflictsB.keys()])].sort()) {
    const a = conflictsA.get(id), b = conflictsB.get(id);
    if (!a) out.push(`重複的學習目標 ID 多了：${showConflict(b!)}`);
    else if (!b) out.push(`重複的學習目標 ID 少了：${showConflict(a)}`);
    else if (!same(a, b)) out.push(`重複的學習目標 ID 的目標：${showConflict(a)} → ${showConflict(b)}`);
  }
  return out;
}
/** 照 key 分組，保留每一個與原本的順序。 */
function groupBy<T>(list: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of list) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/** 兩份比較資料的差異，一項一行；完全相同是空的。time 把毫秒寫成看得懂的時間。 */
export function diffSnapshots(before: Snapshot, after: Snapshot, time: (ms: number) => string): string[] {
  const out = diffGates(before.gates, after.gates);
  const decksA = new Map(before.decks.map(deck => [deck.path, deck])), decksB = new Map(after.decks.map(deck => [deck.path, deck]));
  const gatedA = new Set(before.gates.decks), gatedB = new Set(after.gates.decks);
  for (const path of [...new Set([...decksA.keys(), ...decksB.keys(), ...gatedA, ...gatedB])].sort()) {
    // 讀不懂的那一邊沒有內容可比：只報讀不讀得懂變了。
    if (gatedA.has(path) || gatedB.has(path)) {
      if (gatedA.has(path) !== gatedB.has(path)) out.push(`${path}：${gatedA.has(path) ? '需要新版才讀得懂 → 讀得懂' : '讀得懂 → 需要新版才讀得懂'}`);
      continue;
    }
    const a = decksA.get(path), b = decksB.get(path);
    if (!a || !b) { out.push(`卡組${a ? '不見了' : '多了'}：${path}`); continue; }
    for (const key of Object.keys(a.props) as (keyof DeckSnap['props'])[]) {
      if (!same(a.props[key], b.props[key])) out.push(`${path} 的屬性 ${key}：${JSON.stringify(a.props[key])} → ${JSON.stringify(b.props[key])}`);
    }
    // 同一個 key 可能出現好幾次（備份照原樣收有重複 ID 的卡組）：每一個照順序比，次數也比，不能用 Map 蓋掉（Codex 第二輪 L2）。
    const targetsA = groupBy(a.targets, target => target.key), targetsB = groupBy(b.targets, target => target.key);
    for (const key of [...new Set([...targetsA.keys(), ...targetsB.keys()])]) {
      const xs = targetsA.get(key) ?? [], ys = targetsB.get(key) ?? [];
      if (!xs.length || !ys.length) { out.push(`${path} 的學習目標${xs.length ? '不見了' : '多了'}：${key}（${[...xs, ...ys].map(target => target.name).join('、')}）`); continue; }
      if (xs.length !== ys.length) out.push(`${path} 的 ${key} 出現次數：${xs.length} → ${ys.length}`);
      for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
        const label = xs.length > 1 || ys.length > 1 ? `${key} 第 ${i + 1} 個` : key + ' ';
        // id 也要比：沒有 ID 的目標用 `@<行>:<名稱>` 當 key，可能和別的目標的 ID 相同（Codex 第五次審查 F7）。
        for (const field of ['id', 'name', 'line', 'ok', 'fingerprints', 'importance', 'paused', 'direction'] as const) {
          if (!same(xs[i][field], ys[i][field])) out.push(`${path} 的 ${label}的 ${field}：${JSON.stringify(xs[i][field])} → ${JSON.stringify(ys[i][field])}`);
        }
      }
    }
    const problemsA = groupBy(a.problems, problem => JSON.stringify(problem)), problemsB = groupBy(b.problems, problem => JSON.stringify(problem));
    for (const [key, list] of problemsA) for (let i = problemsB.get(key)?.length ?? 0; i < list.length; i++) out.push(`${path} 少了問題：${showProblem(list[0])}`);
    for (const [key, list] of problemsB) for (let i = problemsA.get(key)?.length ?? 0; i < list.length; i++) out.push(`${path} 多了問題：${showProblem(list[0])}`);
  }
  for (const id of [...new Set([...Object.keys(before.due), ...Object.keys(after.due)])].sort()) {
    // 只在一邊的 ID 可能叫 constructor：另一邊取到的是每個物件都有的函式，不是沒有這個目標。
    const a = Object.hasOwn(before.due, id) ? before.due[id] : undefined, b = Object.hasOwn(after.due, id) ? after.due[id] : undefined;
    if (a === b) continue;
    const show = (value: number | null | 'stopped' | undefined): string => value === undefined ? '（沒有這個目標）' : value === null ? '（新卡）' : value === 'stopped' ? '（停掉了）' : time(value);
    out.push(`${id} 的下次到期：${show(a)} → ${show(b)}`);
  }
  // 比結構，不用分隔符接起來：ID 只查是字串，`a,share:a` 接起來會和別的順序一樣（Codex 第五次審查 F6）。
  const order = (list: TodaySnap[]): string[][] => list.map(item => [item.list, item.lt]);
  if (!same(order(before.today), order(after.today))) {
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
