import type { App } from 'obsidian';
import type { Rating } from '../core/study/index.ts';
import { RATING_LABELS } from '../review/index.ts';
import type { CardView, FlowAction, SourceOwner } from '../review/index.ts';
import type { MaterialDeck } from './sources.ts';
import type { Speech } from './speech.ts';

// 題型接點第四個的形狀（screens.tsx 的 SCREENS）與各題型共用的評分那一排。

export interface BodyProps {
  view: CardView; app: App; speech: Speech;
  materials: (deckPath: string) => readonly string[];
  owner: (deckPath: string) => SourceOwner;
  units: (deckPath: string, term: string, code: string) => readonly MaterialDeck[];
  openLink: (linktext: string, sourcePath: string) => void;
  tipOpen: boolean; setTipOpen: (open: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** 打字卡的輸入框改了字（回報的選單開著時 Review 不交給 session）。 */
  onInput: (value: string) => void;
  /** 題目裡的空格：undefined 是題目還沒渲染好，null 是題目沒有 ＿＿（輸入框放在題目下面）。 */
  slot: HTMLElement | null | undefined;
  onSlot: (slot: HTMLElement | null) => void;
  qRef: React.RefObject<HTMLDivElement | null>;
  /** 題目固定在上方（不太高的題目）。 */
  sticky: boolean;
  animating: boolean;
  submit: () => void;
  skip: () => void;
  /** 比較卡的動作（字鍵、點句子、對答案）。 */
  act: (action: FlowAction) => void;
  onPainted: () => void;
  onFail: (side: 'front' | 'back', error: unknown, path: string) => void;
}

export interface BottomProps {
  view: CardView;
  animating: boolean;
  reveal: () => void;
  rate: (rating: Rating) => void;
  /** 比較卡的動作（字鍵、沒印象、對答案）。 */
  act: (action: FlowAction) => void;
  /** 「下一張」：比較卡有錯時。 */
  commit: () => void;
  /** 焦點回到畫面（按鍵由 .ec-app 處理）。 */
  focusApp: () => void;
}

interface TapTools {
  reveal: () => void;
  focusInput: () => void;
}

interface EnterTools {
  reveal: () => void;
  act: (action: FlowAction) => void;
  commit: () => void;
}

export interface Screen {
  /** 題目區。 */
  Body: (props: BodyProps) => React.JSX.Element;
  /**
   * 底部那一排的內容；null 是沒有這一排。是普通函式、不是元件，由 Review 直接呼叫、放進同一個 .ec-actions：這樣翻面卡與打字卡互換時，
   * 同一顆評分按鈕留在原處，焦點不掉（題型接點第一步的 Codex 查核 F1）。
   */
  bottom: (props: BottomProps) => React.ReactNode;
  /** 點卡片的空白處（回看時不會到這裡）。 */
  tap: (view: CardView, tools: TapTools) => void;
  /** Space、Enter（回看時也會到這裡，session 自己不算）。 */
  enter: (view: CardView, tools: EnterTools) => void;
  /** 舞台多加的 class。 */
  stage: (view: CardView) => string;
}

/** 評分那一排。 */
export function Rates({ view, shown, animating, rate }: { view: CardView; shown: readonly Rating[]; animating: boolean; rate: (rating: Rating) => void }): React.JSX.Element {
  return <div className="ec-rates">
    {shown.map(rating => <button key={rating} type="button" className="ec-rate" data-k={rating} disabled={animating || (view.viewing !== null && !view.allowed.includes(rating) && view.pressed !== rating)} aria-pressed={view.pressed === rating} onClick={() => { rate(rating); }}>{RATING_LABELS[rating]}</button>)}
  </div>;
}
