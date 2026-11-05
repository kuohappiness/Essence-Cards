import type { Prompt, Target } from '../deck/index.ts';
import type { Blank, Card, CardGroup, Shown } from './types.ts';

// 題型接點的第二張表（D-181）：這張卡是哪一種題型、有哪幾格。其他三張表在 core/deck/question-types.ts、review/flow.ts、ui/screens.tsx。

/** 新增題型時多一個值，TypeScript 會指出每張表（Record<QuestionType, …>）缺哪一列。 */
export type QuestionType = 'flip' | 'typed' | 'pick';

/** 一張卡是哪一種題型：唯一判斷的地方，Card 不多存一份。 */
export function questionType(card: Card): QuestionType {
  return card.group ? 'pick' : card.typed ? 'typed' : 'flip';
}

/** 翻面與打字的一張卡：一格，就是自己那一題（nextCard、全部卡的一輪、預覽共用）。 */
export function cardOf(fields: Omit<Card, 'typed' | 'blanks'>): Card {
  const { lt, deck, target, prompt, isNew, early } = fields;
  return { lt, deck, target, prompt, isNew, typed: prompt.kind === 'qa' && prompt.typed !== null, early, blanks: [{ lt, target, prompt }] };
}

// ── 比較卡（tasks/question-type-seam.md §5）：純計算，不用 Math.random，同一張卡重來不變，測試與回放才固定。 ──

/** 併進這張卡的一個目標；shown 是它的出題歷史（§4）。 */
export interface PickMate { lt: string; target: Target; shown: Shown }

const ANCHOR = /^記憶錨點[：:]\s*/;

/** 字串當種子的亂數：FNV-1a 算種子，mulberry32 出數字。 */
function seeded(seed: string): () => number {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 一組句子的種子：每格的指紋，不看格子的順序。 */
const seedOf = (cells: readonly Blank[]): string => cells.map(cell => cell.prompt.fingerprint).sort().join(' ');

/** 這個目標的句子照該出的順序（§5-2）：最久沒出的（沒出過的先）；一樣久的，次數少的先；再一樣照筆記順序。指紋相同的算一句。 */
function rotation(target: Target, shown: Shown): Prompt[] {
  const prints = new Set<string>();
  const distinct = target.prompts.filter(prompt => {
    if (prints.has(prompt.fingerprint)) return false;
    prints.add(prompt.fingerprint);
    return true;
  });
  const at = (prompt: Prompt): number => shown.get(prompt.fingerprint)?.at ?? 0;
  const count = (prompt: Prompt): number => shown.get(prompt.fingerprint)?.count ?? 0;
  return distinct.sort((a, b) => at(a) - at(b) || count(a) - count(b));
}

/** 字鍵與對照：這篇卡組裡同一組的字，不看它在不在這次的範圍裡（§5-1）。字鍵三個以上時順序一定和括號不同（§5-3）。 */
function groupOf(chosen: Target, deckTargets: readonly Target[], random: () => number): CardGroup {
  const group = chosen.group;
  if (!group) throw TypeError('不是比較卡：' + chosen.name);
  const keys = shuffled(group.members, random);
  if (keys.length >= 3 && keys.every((key, i) => key === group.members[i])) keys.push(keys.shift() as string);
  const rows = group.members.map((member, i) => {
    const target = deckTargets.find(each => each.group?.key === group.key && each.group.wordKey === group.memberKeys[i]);
    const anchor = target?.shared.find(line => ANCHOR.test(line));
    return { member, lt: target?.id ?? null, anchor: anchor === undefined ? null : anchor.replace(ANCHOR, '') };
  });
  return { title: group.title, members: group.members, keys, rows };
}

/**
 * 一張比較卡（§5-2、§5-3）。mates[0] 是選中的目標；只有兩個選項的組，出過的字出兩句；每個字鍵剛好一格時多放一句，從還有別句的字裡選。
 * deckTargets 是這篇卡組全部的目標。
 */
export function pickCardOf(fields: { deck: string; isNew: boolean; early: boolean }, mates: readonly PickMate[], deckTargets: readonly Target[]): Card {
  const chosen = mates[0];
  const group = chosen.target.group;
  if (!group) throw TypeError('不是比較卡：' + chosen.target.name);
  const answerOf = (target: Target): string => group.members[group.memberKeys.indexOf(target.group?.wordKey ?? '')];
  const cell = (mate: PickMate, prompt: Prompt): Blank => ({ lt: mate.lt, target: mate.target, prompt, answer: answerOf(mate.target) });
  const cells: Blank[] = [];
  const rest: { mate: PickMate; prompt: Prompt }[] = [];
  // 照筆記順序排，範圍怎麼排都是同一張卡。
  for (const mate of [...mates].sort((a, b) => a.target.line - b.target.line)) {
    const order = rotation(mate.target, mate.shown);
    const count = group.members.length === 2 && mate.shown.size > 0 ? 2 : 1;
    for (const prompt of order.slice(0, count)) cells.push(cell(mate, prompt));
    if (order.length > count) rest.push({ mate, prompt: order[count] });
  }
  if (rest.length && group.members.every(member => cells.filter(each => each.answer === member).length === 1)) {
    const extra = rest[Math.floor(seeded(seedOf(cells))() * rest.length)];
    cells.push(cell(extra.mate, extra.prompt));
  }
  const random = seeded(seedOf(cells));
  const blanks = shuffled(cells, random);
  const first = blanks.find(each => each.lt === chosen.lt) ?? blanks[0];
  return { lt: chosen.lt, deck: fields.deck, target: chosen.target, prompt: first.prompt, isNew: fields.isNew, typed: false, early: fields.early, blanks, group: groupOf(chosen.target, deckTargets, random) };
}
