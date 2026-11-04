import type { Deck, Target } from '../core/deck/index.ts';
import { cardOf } from '../core/study/index.ts';
import type { Card } from '../core/study/index.ts';
import { crumb } from './crumb.ts';
import { createPreviewFlow } from './flow.ts';
import type { CardView, Session, View } from './session.ts';

// 預覽（D-161、D-163 第 3 點）：和複習一樣的畫面，但不走 state.answer，也不增加 Pick 的種類；這一個物件實作 Session 介面，畫面不用知道。
// 內容是編輯器目前的文字解析出來的，所以看到的就是畫面上寫的；什麼都不寫，排程也不動。逐張的狀態在 Flow（flow.ts），這裡只留換張與上方的文字。

const LABEL = '預覽，不記錄';

export interface PreviewOptions {
  path: string;
  deck: Deck;
  /** 預覽時自動展開答案：一進卡片就是背面。 */
  reveal: boolean;
}

/** 這一篇的每一題（同一個目標的整個題目池），照筆記順序；寫錯的目標跳過。還沒補 ID 的目標 lt 是空字串，畫面只拿它組鍵。 */
function cardsOf(path: string, targets: readonly Target[]): Card[] {
  return targets.filter(target => target.ok).flatMap(target => target.prompts.map(prompt => cardOf({
    lt: target.id ?? '', deck: path, target, prompt, isNew: false, early: false,
  })));
}

/** 沒有任何題目時是 null：呼叫的一方用通知說明，不開畫面。 */
export function createPreview(options: PreviewOptions): Session | null {
  const { path, deck } = options;
  const cards = cardsOf(path, deck.targets);
  const first = cards.at(0);
  if (!first) return null;
  const skipped = deck.targets.filter(target => !target.ok).length;
  const crumbText = crumb(deck.props, path);
  const listeners = new Set<() => void>();
  let index = 0;
  let cached: View | null = null;
  /** 目前這張的狀態：每次進卡片都從頭開始。 */
  let flow = createPreviewFlow(first, options.reveal);

  const notify = (): void => { cached = null; for (const listener of [...listeners]) listener(); };

  function go(to: number): void {
    index = Math.min(cards.length, Math.max(0, to));
    const card = cards.at(index);
    if (card) flow = createPreviewFlow(card, options.reveal);
    notify();
  }

  function compute(): View {
    // 開頭寫跳過了幾個，之後只留「預覽，不記錄」。
    const center = index === 0 && skipped ? `${LABEL}（跳過 ${String(skipped)} 個寫法有問題的目標）` : LABEL;
    const top = { center, fraction: Math.min(1, (index + 1) / cards.length), canBack: index > 0, viewing: false, canForward: index < cards.length, pinned: true };
    const card = cards.at(index);
    if (!card) {
      return { kind: 'done', top: { ...top, center: LABEL }, done: { title: '預覽完了', detail: `共 ${String(cards.length)} 張`, buttons: [{ kind: 'close', label: '結束預覽' }] } };
    }
    const { revealed, allowed, speakable, typed } = flow.view();
    const view: CardView = {
      kind: 'card', card, crumb: crumbText, revealed, typed, allowed, pressed: null, english: card.target.direction !== null,
      speakable, autoRead: flow.autoRead, viewing: null, shown: index, nextLabel: '下一張',
    };
    return { kind: 'card', top, card: view };
  }

  return {
    view() { cached ??= compute(); return cached; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    ready: () => Promise.resolve(),
    reveal() { if (index < cards.length && flow.act({ kind: 'reveal' })) notify(); },
    input(text) { if (flow.act({ kind: 'input', text })) notify(); },
    submit() { if (index < cards.length && flow.act({ kind: 'submit' })) notify(); },
    skip() { if (index < cards.length && flow.act({ kind: 'skip' })) notify(); },
    // 自評按鈕只換下一張，不寫任何東西。
    rate() {
      if (index >= cards.length || !flow.view().revealed) return false;
      go(index + 1);
      return true;
    },
    back() { if (index > 0) go(index - 1); },
    forward() { if (index < cards.length) go(index + 1); },
    toCurrent() {},
    continueWith() {},
    pause() {},
    resume() { notify(); return false; },
    close() { listeners.clear(); },
    history: () => [],
    pick: () => ({ deck: path }),
  };
}
