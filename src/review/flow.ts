import { questionType } from '../core/study/index.ts';
import type { Card, PickCell, QuestionType, Rating } from '../core/study/index.ts';
import { createFlip } from './flip.ts';
import { createPick } from './pick.ts';
import type { PickView } from './pick.ts';
import { createPreviewTyped, createTyped } from './typed.ts';
import type { TypedView } from './typed.ts';

// 題型接點的第三個（D-181）：一張卡從題目走到有結果的整段狀態。Session 與預覽都只透過 Flow，不判斷是哪一種題型。
// 其他三個在 core/deck/question-types.ts、core/study/compose.ts、ui/screens.tsx。

/** 一行作答紀錄（syntax.md §5）；一個目標一行。 */
export interface ReviewLine {
  lt: string;
  r: Rating;
  v: string;
  typed?: 'right' | 'wrong' | 'skip';
  retry?: 'right' | 'wrong' | 'skip' | 'not-needed';
  /** 比較卡（tasks/question-type-seam.md §4）：對答案時那一格的字、同一個目標的其他格。with 由 Session 寫入時加。 */
  pick?: string | null;
  also?: readonly PickCell[];
  with?: string;
}

/** 畫面要的：題型自己決定的部分。 */
interface FlowView {
  /** 背面已經顯示（翻面了；打字卡第 3 步與走完）。 */
  revealed: boolean;
  /** 現在能按的自評。 */
  allowed: readonly Rating[];
  /** 喇叭現在可以出現：英翻中隨時；中翻英答案出現之後（D-082）。 */
  speakable: boolean;
  typed: TypedView | null;
  pick: PickView | null;
}

export type FlowAction =
  | { kind: 'reveal' } | { kind: 'input'; text: string } | { kind: 'submit' } | { kind: 'skip' }
  // 比較卡：點字鍵、點那一句、對答案（§6）。
  | { kind: 'key'; key: string } | { kind: 'row'; index: number } | { kind: 'check' };

/** 回看要的（D-084）。 */
export interface LookBack {
  typed: TypedView | null;
  pick: PickView | null;
  /** 能改成的評分。 */
  changeable: readonly Rating[];
  /** 改成這個評分時要寫的行（取消原本那幾行之後）。 */
  lines(rating: Rating): readonly ReviewLine[];
}

interface Settled {
  /** 一個目標一行。 */
  lines: readonly ReviewLine[];
  look: LookBack;
}

export interface Flow {
  view(): FlowView;
  /** 這一刻該念的；每個有效動作開頭清掉（D-116）。Session 回看時也會清（D-084）。 */
  autoRead: readonly string[] | null;
  /** 答案出現的時間，0.3 秒內的自評不算（D-096）；還沒出現是 null。 */
  revealedAt: number | null;
  /** 一個動作；回傳算不算數（不算就不通知畫面）。 */
  act(action: FlowAction): boolean;
  /** 記下來：要寫哪幾行、回看要的東西。null 是比較卡有錯時的「下一張」（PickView.committable）。 */
  settle(rating: Rating | null): Settled;
}

/** 預覽（D-161）什麼都不寫，自評也不等 0.3 秒，所以沒有這兩項。 */
export type PreviewFlow = Omit<Flow, 'revealedAt' | 'settle'>;

const FLOWS: Record<QuestionType, (card: Card, options: { now: () => number }) => Flow> = { flip: createFlip, typed: createTyped, pick: createPick };
const PREVIEWS: Record<QuestionType, (card: Card, reveal: boolean) => PreviewFlow> = {
  flip: (card, reveal) => createFlip(card, { now: Date.now, revealed: reveal }),
  typed: createPreviewTyped,
  pick: (card, reveal) => createPick(card, { now: Date.now, revealed: reveal }),
};

export function createFlow(card: Card, options: { now: () => number }): Flow {
  return FLOWS[questionType(card)](card, options);
}
/** reveal：預覽時自動展開答案，一進卡片就是背面。 */
export function createPreviewFlow(card: Card, reveal: boolean): PreviewFlow {
  return PREVIEWS[questionType(card)](card, reveal);
}
