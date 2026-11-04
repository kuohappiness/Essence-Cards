import type { Card, Rating } from '../core/study/index.ts';
import { canSpeak, openingSpeech } from './english.ts';
import type { Flow, ReviewLine } from './flow.ts';
import { RATINGS } from './ratings.ts';

/** 翻面自評（D-062）：一進來在正面，翻面之後四級都能按。revealed 是預覽的起點（D-161）。 */
export function createFlip(card: Card, options: { now: () => number; revealed?: boolean }): Flow {
  let revealed = options.revealed ?? false;
  const line = (r: Rating): ReviewLine => ({ lt: card.lt, r, v: card.prompt.fingerprint });
  const flow: Flow = {
    autoRead: openingSpeech(card),
    revealedAt: null,
    view: () => ({ revealed, allowed: revealed ? RATINGS : [], speakable: canSpeak(card, revealed), typed: null }),
    act(action) {
      if (action.kind !== 'reveal' || revealed) return false;
      flow.autoRead = null;
      revealed = true;
      flow.revealedAt = options.now();
      return true;
    },
    settle: rating => ({ lines: [line(rating)], look: { typed: null, changeable: RATINGS, lines: changed => [line(changed)] } }),
  };
  return flow;
}
