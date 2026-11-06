import type { Target } from '../deck/index.ts';
import { cardOf, pickCardOf } from './compose.ts';
import { dueAt, recall, replay } from './fsrs.ts';
import { compareText, firstAtOrAfter, retentionOf } from './plan.ts';
import { choosePrompt, joins, wrong } from './session.ts';
import { shownWith } from './shown.ts';
import { dayOf, dayStart } from './time.ts';
import type { PickMate } from './compose.ts';
import type { DeckEntry, Memory, MemoryColor, Next, ReviewEntry, Slot, TodayInput } from './types.ts';

// 全部卡的一輪（D-097、D-146、D-163 第 4 點）：依目標集合選卡（D-142 原則 5）。Today.slots 只有今天會出的目標，所以不能借 more。
// 一輪從按下去的時間 since 算：今天稍早答過的這一輪照樣出；since 之後的作答裡最後一次是記住了或太簡單的算完成；答錯照 D-062 的時間再出。

const IMPORTANCE = { high: 0, medium: 1, low: 2 } as const;
/** 間隔超過這麼多天算很熟（D-062）。 */
const WELL_KNOWN_DAYS = 21;
/** 成對的兩張之間至少答過幾個不同的其他目標（D-189 第 1 點）。試作值，用 L3 的雙向單字、短卡組與一首絕句試過再定。 */
const PAIR_SPACING = 10;

interface Item { id: string; path: string; entry: DeckEntry; target: Target }
type Partner = (item: Item) => Item | undefined;

/**
 * 給一張卡，找這一輪裡它的對方。現在只認英文的兩個方向：同一篇、pairKey 相同、方向相反，各方向取前面的。
 * 之後接句（D-185 第 8 點）在這裡加一個認法，選卡不用改。
 */
function partners(items: readonly Item[]): Partner {
  const keyOf = (item: Item, direction: string): string => JSON.stringify([item.path, item.target.pairKey, direction]);
  const sides = new Map<string, Item>();
  for (const item of items) {
    const { pairKey, direction } = item.target;
    if (pairKey === null || direction === null) continue;
    const key = keyOf(item, direction);
    if (!sides.has(key)) sides.set(key, item);
  }
  return item => {
    const { direction } = item.target;
    return direction === null ? undefined : sides.get(keyOf(item, direction === 'en-zh' ? 'zh-en' : 'en-zh'));
  };
}

/** 目標集合在卡組裡的樣子，照輸入的順序；不在卡組裡的（改掉了、刪掉了）不算。 */
function itemsOf(input: TodayInput, ids: readonly string[]): Item[] {
  const wanted = new Set(ids);
  const items: Item[] = [];
  for (const entry of input.decks) {
    for (const target of entry.deck.targets) {
      if (target.id !== null && wanted.delete(target.id)) items.push({ id: target.id, path: entry.path, entry, target });
    }
  }
  return items;
}

/** since 之後的作答，不含錯題補強，依時間排；any 是有任何紀錄（含錯題補強）的目標。 */
function roundAnswers(reviews: readonly ReviewEntry[], since: number): { valid: Map<string, ReviewEntry[]>; any: Set<string> } {
  const valid = new Map<string, ReviewEntry[]>(), any = new Set<string>();
  for (let i = firstAtOrAfter(reviews, since); i < reviews.length; i++) {
    const entry = reviews[i];
    any.add(entry.lt);
    if (entry.src === 'mistake') continue;
    const list = valid.get(entry.lt);
    if (list) list.push(entry);
    else valid.set(entry.lt, [entry]);
  }
  return { valid, any };
}

/** 這一輪每個目標最後一次作答之後，又答過幾個不同的目標；算的作答和 roundAnswers 的 valid 相同。 */
function answeredAfter(reviews: readonly ReviewEntry[], since: number): Map<string, number> {
  const after = new Map<string, number>();
  const first = firstAtOrAfter(reviews, since);
  for (let i = reviews.length - 1; i >= first; i--) {
    const { lt, src } = reviews[i];
    if (src !== 'mistake' && !after.has(lt)) after.set(lt, after.size);
  }
  return after;
}

/**
 * 成對的卡隔開（D-189 第 1 點）。ready 照到期時間、fresh 照這一輪的順序。apart 是對方最後一次作答之後答過幾個不同的其他目標，對方這一輪還沒答過是 null（沒有限制）。
 * 到時間的先、再來是新的，各自只看夠隔的。新的裡面先出對方這一輪還沒答過的，一對的第二張排在每一對的第一張之後：
 * 照筆記順序一夠隔就出的話，最後幾個字沒有別張可以隔開（tasks/quiz-practice.md §2 的 40 個字）。
 * 都不夠隔時，在本來會選的那一群裡挑隔最多的，一樣多照原順序；只剩同一對也直接出，不讓學生等。
 */
function chooseSpaced(ready: readonly Item[], fresh: readonly Item[], apart: (item: Item) => number | null): Item | undefined {
  const enough = (item: Item): boolean => (apart(item) ?? PAIR_SPACING) >= PAIR_SPACING;
  const found = ready.find(enough) ?? fresh.find(item => apart(item) === null) ?? fresh.find(enough);
  if (found) return found;
  let farthest: Item | undefined, most = -1;
  for (const item of ready.length ? ready : fresh) {
    const gap = apart(item) ?? 0;
    if (gap > most) { farthest = item; most = gap; }
  }
  return farthest;
}

/** 一輪的總數與完成數；答錯再出不增加總數，答對才算完成。 */
export function practiceProgress(input: TodayInput, ids: readonly string[], since: number): { done: number; total: number } {
  const { valid } = roundAnswers(input.history.reviews, since);
  const items = itemsOf(input, ids);
  return { done: items.filter(item => { const last = valid.get(item.id)?.at(-1); return last !== undefined && !wrong(last); }).length, total: items.length };
}

/**
 * 這一輪的順序：今天到期的（relearn、再照今天的份的排法）→ 還沒到期的（現在最容易忘的先）→ 新卡（筆記順序；跨篇照路徑）→
 * 今天答過、還沒到期的（現在最容易忘的先；D-097 的補充，中途關掉再開時不會先把剛答過的再答一遍）；
 * 雙向配對的兩個方向都出，英翻中排在中翻英前面。記憶看 since 之前的紀錄，所以這一輪答過之後順序不會變。
 */
function roundOrder(items: readonly Item[], memories: ReadonlyMap<string, Memory>, input: TodayInput, since: number, partner: Partner): Item[] {
  const day = dayOf(since, input.offset);
  const start = dayStart(day, input.offset), end = dayStart(day + 1, input.offset);
  const dueOf = (item: Item, memory: Memory): number => dueAt(memory, retentionOf(input, item.entry, item.target));
  const bucket = (item: Item): number => {
    const memory = memories.get(item.id);
    if (!memory) return 3;
    if (dueOf(item, memory) >= end) return memory.last.at >= start ? 4 : 2;
    return wrong(memory.last) && memory.last.src !== 'mistake' ? 0 : 1;
  };
  const compare = (a: Item, b: Item): number => {
    const group = bucket(a);
    const order = group - bucket(b);
    if (order) return order;
    const x = memories.get(a.id), y = memories.get(b.id);
    if (group === 0 && x && y) return dueOf(a, x) - dueOf(b, y) || compareText(a.id, b.id);
    if (group === 1 && x && y) return IMPORTANCE[a.target.fields.importance] - IMPORTANCE[b.target.fields.importance] || recall(x, start) - recall(y, start) || compareText(a.id, b.id);
    if ((group === 2 || group === 4) && x && y) return recall(x, since) - recall(y, since) || compareText(a.id, b.id);
    return compareText(a.path, b.path) || a.target.line - b.target.line;
  };
  const ordered = [...items].sort(compare);
  // 同一篇裡 pairKey 相同的兩個方向：英翻中排到中翻英前面。
  for (const zh of ordered.filter(item => item.target.direction === 'zh-en')) {
    const en = partner(zh);
    if (!en || ordered.indexOf(en) < ordered.indexOf(zh)) continue;
    ordered.splice(ordered.indexOf(en), 1);
    ordered.splice(ordered.indexOf(zh), 0, en);
  }
  return ordered;
}

/** 這一輪下一張：規則和今天的份一樣：到時間的先，再來是新的，沒有別張時提早出（early）；成對的卡隔開（chooseSpaced）。全部答對是 done。 */
export function practiceNext(input: TodayInput, ids: readonly string[], since: number): Next {
  const reviews = input.history.reviews;
  const items = itemsOf(input, ids);
  const wanted = new Set(items.map(item => item.id));
  const before = reviews.slice(0, firstAtOrAfter(reviews, since)).filter(entry => wanted.has(entry.lt));
  const memories = replay(before);
  const { valid, any } = roundAnswers(reviews, since);
  // 再出的時間看到現在為止全部的作答（含這一輪），和今天的份相同。
  const latest = replay(reviews.filter(entry => wanted.has(entry.lt)));
  const partner = partners(items);
  const ready: { item: Item; at: number }[] = [];
  let waiting: { item: Item; at: number } | null = null;
  const fresh: Item[] = [];
  for (const item of roundOrder(items, memories, input, since, partner)) {
    const entries = valid.get(item.id);
    if (!entries) { fresh.push(item); continue; }
    if (!wrong(entries.at(-1))) continue;
    const memory = latest.get(item.id);
    const at = memory ? dueAt(memory, retentionOf(input, item.entry, item.target)) : input.now;
    if (at <= input.now) ready.push({ item, at });
    else if (!waiting || at < waiting.at) waiting = { item, at };
  }
  const after = answeredAfter(reviews, since);
  const apart = (item: Item): number | null => {
    const other = partner(item);
    const gap = other && after.get(other.id);
    if (gap === undefined) return null;
    // 自己不算「其他」：對方之後又答過這一張時少算一個。
    const own = after.get(item.id);
    return own !== undefined && own < gap ? gap - 1 : gap;
  };
  const item = chooseSpaced(ready.sort((a, b) => a.at - b.at).map(each => each.item), fresh, apart) ?? waiting?.item;
  if (!item) return { kind: 'done' };
  const priorOf = (id: string): ReviewEntry[] => before.filter(entry => entry.lt === id && entry.src !== 'mistake');
  if (item.target.group) {
    // 同一組的目標照今天的份的規則併（tasks/question-type-seam.md §5-1）；出題歷史是本輪以前加上這一輪。
    const mateOf = (each: Item): PickMate => ({ lt: each.id, target: each.target, shown: shownWith(shownWith(new Map(), priorOf(each.id)), valid.get(each.id) ?? []) });
    const dueBy = (each: Item): boolean => {
      const memory = latest.get(each.id);
      return !memory || dueAt(memory, retentionOf(input, each.entry, each.target)) <= input.now;
    };
    const early = !ready.length && !fresh.length;
    const others = items.filter(other => other !== item && other.path === item.path && other.target.group?.key === item.target.group?.key
      && joins(valid.get(other.id), early, () => dueBy(other)));
    return { kind: 'card', card: pickCardOf({ deck: item.path, isNew: !memories.has(item.id) && !any.has(item.id), early }, [mateOf(item), ...others.map(mateOf)], item.entry.whole ?? item.entry.deck.targets) };
  }
  const prior = priorOf(item.id);
  const seen = shownWith(new Map(), prior);
  const slot: Slot = {
    target: item.target, pair: null, memory: memories.get(item.id) ?? null, retention: retentionOf(input, item.entry, item.target), inExam: input.exam?.contains(item.entry, item.target) ?? false,
    correct: prior.some(entry => entry.r === 'good' || entry.r === 'easy'), seen,
  };
  const prompt = choosePrompt(slot, valid.get(item.id) ?? []);
  return { kind: 'card', card: cardOf({
    lt: item.id, deck: item.path, target: item.target, prompt,
    isNew: slot.memory === null && !any.has(item.id),
    early: !ready.length && !fresh.length,
  }) };
}

/** 卡組裡這些目標現在的記憶顏色（D-062）：灰未複習、橙到期或剛答錯、綠還沒到期、藍間隔超過 21 天。 */
export function memoryColors(input: TodayInput): Map<string, MemoryColor> {
  // 同一個 ID 只算第一次出現的（重複的 ID 不出題，D-157）。
  const owners = new Map<string, { entry: DeckEntry; target: Target }>();
  for (const entry of input.decks) for (const target of entry.deck.targets) if (target.id !== null && !owners.has(target.id)) owners.set(target.id, { entry, target });
  const memories = replay(input.history.reviews.filter(entry => owners.has(entry.lt)));
  const colors = new Map<string, MemoryColor>();
  for (const [id, { entry, target }] of owners) {
    const memory = memories.get(id);
    if (!memory) { colors.set(id, 'new'); continue; }
    const due = dueAt(memory, retentionOf(input, entry, target));
    if (wrong(memory.last) || due <= input.now) colors.set(id, 'near');
    else colors.set(id, (due - memory.last.at) / 86_400_000 > WELL_KNOWN_DAYS ? 'easy' : 'good');
  }
  return colors;
}
