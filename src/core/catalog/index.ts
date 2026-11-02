import { sourceLinks, termRank } from '../deck/index.ts';
import type { Deck, Target } from '../deck/index.ts';
import type { MemoryColor } from '../study/index.ts';

// 範圍與目錄（D-110、D-142 原則 1、2、5、6、8）：把 deck 認定的單元參照對到單元、算每個目標屬於哪些單元、單元與學期的排序。
// 輸入是卡組與每個目標的記憶狀態，不 import study 的程式；deck、study 不 import 這裡。

export interface CatalogDeck { path: string; deck: Deck }
type DeckStatus = Deck['props']['status'];

/** 單元裡的一個學習目標。from：別的單元來的目標，它自己的單元（「小四上 2-1」）；自己單元的是 null。 */
interface UnitTarget { id: string; name: string; path: string; line: number; from: string | null }
/** 寫錯的提示（syntax §2-10）：kind 分學習目標與屬性；path、line 是第一個問題（line 從 0 算）。 */
export interface UnitProblem { kind: 'target' | 'property'; count: number; path: string; line: number }

export interface UnitNode {
  /** 單元的身分：（年級學期、科目、單元編號），編號用原字串；「其他」組是那一篇的路徑。 */
  key: string;
  term: string | null;
  subject: string | null;
  code: string | null;
  /** 顯示的名稱：路徑第一篇的「編號 名稱」；「其他」組是檔名。 */
  name: string;
  /** 這個單元的每一篇，照路徑。 */
  decks: { path: string; name: string; status: DeckStatus }[];
  /** 有啟用的篇就是 active；都沒有時草稿優先於暫停（D-097）。 */
  status: DeckStatus;
  /** 目標集合：啟用中、沒有被停掉的目標，一個 ID 一筆；自己單元的先，照路徑與行號。 */
  targets: UnitTarget[];
  problems: UnitProblem[];
}
/** 對到單元的參照，或對不到的（這一批不建目錄節點，D-033；第二批的考試範圍要用，不能當成「沒有關係」）。 */
interface UnitRef { id: string; path: string; term: string | null; subject: string | null; code: string }

export interface CatalogIndex {
  /** 學業的單元，照學期、科目、編號排好。 */
  units: UnitNode[];
  /** 學業以外，和有年級學期與科目但沒寫單元的（不讓它從目錄消失）；一篇一列，照路徑。 */
  others: UnitNode[];
  /** 對不到單元的參照。 */
  unresolved: UnitRef[];
  /** 單元的鍵 → 單元（含「其他」組）。 */
  unit(key: string): UnitNode | null;
  /** 找單元（跨單元的出處用）：同一個年級學期、科目與編號。 */
  find(term: string, subject: string, code: string): UnitNode | null;
  /** 這一篇啟用中、沒有被停掉的目標 ID；不是啟用的卡組是空的。 */
  deckTargets(path: string): readonly string[];
}

const unitKey = (term: string, subject: string, code: string): string => JSON.stringify([term, subject, code]);
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** 自然排序：連續的數字照數值比（`L2` 在 `L10` 前），平手時比原字串（`L01` 與 `L1`），不用輸入順序。 */
function natural(a: string, b: string): number {
  const parts = (text: string): string[] => text.match(/\d+|\D+/g) ?? [];
  const left = parts(a), right = parts(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i], y = right[i];
    const numeric = /^\d/.test(x) && /^\d/.test(y);
    const order = numeric ? compareDigits(x, y) : compareText(x, y);
    if (order) return order;
  }
  return left.length - right.length || compareText(a, b);
}
function compareDigits(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, ''), y = b.replace(/^0+(?=\d)/, '');
  return x.length - y.length || compareText(x, y);
}
/** 同一學期同一科裡：數字編號 → 英文編號 → 其他（§9-2）。 */
const codeKind = (code: string): number => /^[0-9]+(?:-[0-9]+)*$/.test(code) ? 0 : /^[A-Za-z]+[0-9]+$/.test(code) ? 1 : 2;
/** 認得的學期照順序，其他文字排在認得的後面，彼此比原字串。 */
function compareTerm(a: string, b: string): number {
  const x = termRank(a), y = termRank(b);
  if (x !== null && y !== null) return x - y;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return compareText(a, b);
}
const compareCode = (a: string, b: string): number => codeKind(a) - codeKind(b) || natural(a, b);

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const usableTarget = (target: Target): target is Target & { id: string } => target.id !== null && target.ok && !target.fields.paused && target.prompts.length > 0;

/** 這一篇有沒有問題要提示：寫錯的目標、屬性寫法有問題的。 */
function problemsOf(entries: readonly CatalogDeck[]): UnitProblem[] {
  const list: UnitProblem[] = [];
  const add = (kind: UnitProblem['kind'], found: { path: string; line: number }[]): void => {
    if (found.length) list.push({ kind, count: found.length, path: found[0].path, line: found[0].line });
  };
  add('target', entries.flatMap(({ path, deck }) => deck.targets.filter(target => !target.ok).map(target => ({ path, line: target.line }))));
  add('property', entries.flatMap(({ path, deck }) => deck.props.issues.map(issue => ({ path, line: issue.line }))));
  return list;
}
const statusOf = (entries: readonly CatalogDeck[]): DeckStatus => {
  const statuses = entries.map(({ deck }) => deck.props.status);
  return statuses.includes('active') ? 'active' : statuses.includes('draft') ? 'draft' : 'paused';
};
const ownName = (code: string, name: string): string => (code + ' ' + name).trim();

/**
 * 建索引：decks 是讀得懂、可以出題的卡組（state 已經拿掉待處理與重複 ID 的目標）；stopped 是讀不懂的紀錄行停掉的目標（syntax §5-2）。
 * 只看內容，所以輸入順序打亂結果相同。
 */
export function buildIndex(decks: readonly CatalogDeck[], stopped: (id: string) => boolean = () => false): CatalogIndex {
  const sorted = [...decks].filter(entry => !entry.deck.props.isTranscript).sort((a, b) => compareText(a.path, b.path));
  const groups = new Map<string, { term: string; subject: string; code: string; entries: CatalogDeck[] }>();
  const loose: CatalogDeck[] = [];
  for (const entry of sorted) {
    const { term, subject, unit } = entry.deck.props;
    if (term === null || subject === null || unit === null) {
      // 一般筆記不是卡組：沒有目標也沒有屬性問題的不列。
      if (entry.deck.targets.length || entry.deck.props.issues.length) loose.push(entry);
      continue;
    }
    const key = unitKey(term, subject, unit.code);
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { term, subject, code: unit.code, entries: [entry] });
  }
  const nodes = new Map<string, UnitNode>();
  const deckIds = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();
  const node = (key: string, base: Omit<UnitNode, 'key' | 'status' | 'targets' | 'problems' | 'decks'>, entries: readonly CatalogDeck[]): void => {
    nodes.set(key, {
      ...base, key, status: statusOf(entries), targets: [], problems: problemsOf(entries),
      decks: entries.map(({ path, deck }) => ({ path, name: fileName(path), status: deck.props.status })),
    });
    seen.set(key, new Set());
  };
  for (const [key, { term, subject, code, entries }] of groups) {
    const unit = entries[0].deck.props.unit;
    node(key, { term, subject, code, name: ownName(code, unit?.name ?? '') }, entries);
  }
  for (const entry of loose) {
    const { term, subject } = entry.deck.props;
    node(entry.path, { term, subject, code: null, name: fileName(entry.path) }, [entry]);
  }
  const add = (key: string, target: UnitTarget): void => {
    const unit = nodes.get(key), ids = seen.get(key);
    if (!unit || !ids || ids.has(target.id)) return;
    ids.add(target.id);
    unit.targets.push(target);
  };
  const unresolved: UnitRef[] = [];
  // 兩輪：先放每一篇自己的目標，別的單元來的才會排在後面，也才標「來自」。
  const owned: { entry: CatalogDeck; target: Target & { id: string }; own: string; label: string | null }[] = [];
  for (const entry of sorted) {
    const { props, targets } = entry.deck;
    const own = props.term !== null && props.subject !== null && props.unit !== null ? unitKey(props.term, props.subject, props.unit.code) : entry.path;
    const label = props.term !== null && props.unit !== null ? props.term + ' ' + props.unit.code : fileName(entry.path);
    // 真正擁有者的狀態（D-142）：草稿、暫停的卡組，目標哪一個單元都不算。
    if (props.status !== 'active') continue;
    const ids: string[] = [];
    for (const target of targets) {
      if (!usableTarget(target) || stopped(target.id)) continue;
      ids.push(target.id);
      owned.push({ entry, target, own, label });
      add(own, { id: target.id, name: target.name, path: entry.path, line: target.line, from: null });
    }
    deckIds.set(entry.path, ids);
  }
  for (const { entry, target, own, label } of owned) {
    const { term, subject } = entry.deck.props;
    for (const { link } of sourceLinks(target.fields.sources)) {
      if (link.kind !== 'unit') continue;
      const refTerm = link.term ?? term;
      const key = refTerm !== null && subject !== null ? unitKey(refTerm, subject, link.unit) : null;
      if (key === own) continue;
      if (key !== null && nodes.has(key)) add(key, { id: target.id, name: target.name, path: entry.path, line: target.line, from: label });
      else unresolved.push({ id: target.id, path: entry.path, term: refTerm, subject, code: link.unit });
    }
  }
  const compareUnit = (a: UnitNode, b: UnitNode): number =>
    compareTerm(a.term ?? '', b.term ?? '') || compareText(a.subject ?? '', b.subject ?? '') || compareCode(a.code ?? '', b.code ?? '');
  const units = [...nodes.values()].filter(unit => unit.code !== null).sort(compareUnit);
  const others = [...nodes.values()].filter(unit => unit.code === null).sort((a, b) => compareText(a.key, b.key));
  return {
    units, others, unresolved,
    unit: key => nodes.get(key) ?? null,
    find: (term, subject, code) => nodes.get(unitKey(term, subject, code)) ?? null,
    deckTargets: path => deckIds.get(path) ?? [],
  };
}

/** 單元的顏色（D-097），由上往下判斷：灰（超過一半未複習）→ 藍（全部記得或很熟）→ 綠（記得加很熟 ≥ 80%）→ 橙。目標 0 個也是灰。 */
export function unitColor(colors: readonly MemoryColor[]): MemoryColor {
  if (!colors.length) return 'new';
  const count = (color: MemoryColor): number => colors.filter(each => each === color).length;
  if (count('new') > colors.length / 2) return 'new';
  const known = count('good') + count('easy');
  if (known === colors.length) return 'easy';
  return known * 5 >= colors.length * 4 ? 'good' : 'near';
}

interface TargetView extends UnitTarget { color: MemoryColor }
export interface UnitView extends Omit<UnitNode, 'targets'> {
  targets: TargetView[];
  /** 右邊的數字：單元的學習目標數；全部是草稿時 null（不顯示），全部暫停時 0。 */
  count: number | null;
  color: MemoryColor;
  /** 當日卡的 N：今天的份裡還沒完成的。 */
  today: number;
}
export interface TermView { term: string; subjects: { subject: string; units: UnitView[] }[] }
export interface Catalog {
  /** 學期，照順序；「學業以外」在 others。 */
  terms: TermView[];
  others: UnitView[];
  /** 預設展開的學期（D-163 小選擇 2）；沒有認得的學期時是第一個，沒有學期是 null。 */
  latest: string | null;
}

/**
 * 學期預設展開哪一個：設定頁的「目前學期」還沒做（D-111），先用年級學期最新的那一組；讀法集中在這個函式，設定頁做好時改這裡。
 */
function latestTerm(terms: readonly string[]): string | null {
  const known = terms.filter(term => termRank(term) !== null);
  return known.at(-1) ?? terms[0] ?? null;
}

/** 畫面要的資料：索引加上每個目標現在的記憶顏色、今天的份裡還沒完成的目標。畫面不自己算。 */
export function paintCatalog(index: CatalogIndex, colors: ReadonlyMap<string, MemoryColor>, today: ReadonlySet<string>): Catalog {
  const view = (unit: UnitNode): UnitView => {
    // 全部暫停：標「暫停」、數字 0；全部是草稿：不顯示數字（§3）。兩種都沒有可以練的目標。
    const targets = unit.status === 'active' ? unit.targets.map(target => ({ ...target, color: colors.get(target.id) ?? 'new' })) : [];
    return {
      ...unit, targets, color: unitColor(targets.map(target => target.color)),
      count: unit.status === 'draft' ? null : targets.length,
      today: targets.filter(target => today.has(target.id)).length,
    };
  };
  const terms: TermView[] = [];
  for (const unit of index.units) {
    const term = unit.term ?? '', subject = unit.subject ?? '';
    let group = terms.find(each => each.term === term);
    if (!group) terms.push(group = { term, subjects: [] });
    let row = group.subjects.find(each => each.subject === subject);
    if (!row) group.subjects.push(row = { subject, units: [] });
    row.units.push(view(unit));
  }
  return { terms, others: index.others.map(view), latest: latestTerm(terms.map(each => each.term)) };
}
