import type { Card } from './types.ts';

// 題型接點的第二張表（D-181）：這張卡是哪一種題型、有哪幾格。其他三張表在 core/deck/question-types.ts、review/flow.ts、ui/screens.tsx。

/** 新增題型時多一個值，TypeScript 會指出每張表（Record<QuestionType, …>）缺哪一列。 */
export type QuestionType = 'flip' | 'typed';

/** 一張卡是哪一種題型：唯一判斷的地方，Card 不多存一份。 */
export function questionType(card: Card): QuestionType {
  return card.typed ? 'typed' : 'flip';
}

/** 翻面與打字的一張卡：一格，就是自己那一題（nextCard、全部卡的一輪、預覽共用）。 */
export function cardOf(fields: Omit<Card, 'typed' | 'blanks'>): Card {
  const { lt, deck, target, prompt, isNew, early } = fields;
  return { lt, deck, target, prompt, isNew, typed: prompt.kind === 'qa' && prompt.typed !== null, early, blanks: [{ lt, target, prompt }] };
}
