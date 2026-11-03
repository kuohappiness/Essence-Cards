import type { Deck, Target } from '../core/deck/index.ts';
import type { Card } from '../core/study/index.ts';
import { crumb } from './crumb.ts';
import { englishParts, fillBlank } from './english.ts';
import { RATINGS, type CardView, type Session, type TypedView, type View } from './session.ts';
import { closest, spelling } from './spelling.ts';

// 預覽（D-161、D-163 第 3 點）：和複習一樣的畫面，但不走 state.answer，也不增加 Pick 的種類；這一個物件實作 Session 介面，畫面不用知道。
// 內容是編輯器目前的文字解析出來的，所以看到的就是畫面上寫的；什麼都不寫，排程也不動。

const LABEL = '預覽，不記錄';

export interface PreviewOptions {
  path: string;
  deck: Deck;
  /** 預覽時自動展開答案：一進卡片就是背面。 */
  reveal: boolean;
}

/** 這一篇的每一題（同一個目標的整個題目池），照筆記順序；寫錯的目標跳過。還沒補 ID 的目標 lt 是空字串，畫面只拿它組鍵。 */
function cardsOf(path: string, targets: readonly Target[]): Card[] {
  return targets.filter(target => target.ok).flatMap(target => target.prompts.map(prompt => ({
    lt: target.id ?? '', deck: path, target, prompt, isNew: false, typed: prompt.kind === 'qa' && prompt.typed !== null, early: false,
  })));
}

/** 沒有任何題目時是 null：呼叫的一方用通知說明，不開畫面。 */
export function createPreview(options: PreviewOptions): Session | null {
  const { path, deck } = options;
  const cards = cardsOf(path, deck.targets);
  if (!cards.length) return null;
  const skipped = deck.targets.filter(target => !target.ok).length;
  const crumbText = crumb(deck.props, path);
  const listeners = new Set<() => void>();
  let index = 0;
  let cached: View | null = null;
  /** 目前這張的狀態：每次進卡片都從頭開始。 */
  let revealed = false;
  let typed: TypedView | null = null;
  let autoRead: readonly string[] | null = null;

  const notify = (): void => { cached = null; for (const listener of [...listeners]) listener(); };
  const answers = (card: Card): readonly string[] => card.prompt.kind === 'qa' && card.prompt.typed ? card.prompt.typed : [];
  const question = (card: Card): string => card.prompt.kind === 'qa' ? card.prompt.question : card.prompt.text;

  /** 中翻英的答案出現：先念答案，再念把 ＿＿ 換成答案的例句，和複習一樣。 */
  function announce(card: Card, answer: string): void {
    if (card.target.direction !== 'zh-en') return;
    const sentence = fillBlank(question(card), answer);
    autoRead = sentence ? [answer, sentence] : [answer];
  }
  /** 打字卡走完：不用打字也能看答案；打了字就照複習的樣子比對。 */
  function finishTyped(card: Card, text: string): void {
    if (!typed) return;
    const match = text.trim() ? closest(text, answers(card)) : answers(card)[0] ?? '';
    const attempt = spelling(text, match);
    typed = { ...typed, step: 3, first: !text.trim() ? 'skip' : attempt.ok ? 'right' : 'wrong', answer: match, attempt, finished: true, canSkip: false, input: text };
    announce(card, match);
  }
  function enter(): void {
    const card = cards.at(index);
    if (!card || index >= cards.length) return;
    revealed = options.reveal;
    const english = card.target.direction === 'en-zh' ? englishParts(question(card)) : [];
    autoRead = english.length ? english : null;
    typed = card.typed ? {
      step: 1, first: null, second: null, notice: false, hint: null, answer: answers(card)[0] ?? '', attempt: null, copy: null, live: null, firstAttempt: null, input: '', finished: false, canSkip: true, skipLabel: '顯示答案',
    } : null;
    if (options.reveal && card.typed) finishTyped(card, '');
  }
  function go(to: number): void {
    index = Math.min(cards.length, Math.max(0, to));
    enter();
    notify();
  }
  /** 目前這張的打字卡還沒走完：翻面或確認。 */
  function open(text: string): void {
    const card = cards.at(index);
    if (!card || index >= cards.length || !typed || typed.finished) return;
    revealed = true;
    autoRead = null;
    finishTyped(card, text);
    notify();
  }

  function compute(): View {
    // 開頭寫跳過了幾個，之後只留「預覽，不記錄」。
    const center = index === 0 && skipped ? `${LABEL}（跳過 ${String(skipped)} 個寫法有問題的目標）` : LABEL;
    const top = { center, fraction: Math.min(1, (index + 1) / cards.length), canBack: index > 0, viewing: false, canForward: index < cards.length, pinned: true };
    const card = cards.at(index);
    if (index >= cards.length || !card) {
      return { kind: 'done', top: { ...top, center: LABEL }, done: { title: '預覽完了', detail: `共 ${String(cards.length)} 張`, buttons: [{ kind: 'close', label: '結束預覽' }] } };
    }
    const shown = typed ? typed.finished : revealed;
    const english = card.target.direction !== null;
    const view: CardView = {
      kind: 'card', card, crumb: crumbText, revealed: shown, typed, allowed: shown ? RATINGS : [], pressed: null, english,
      speakable: english && (card.target.direction === 'en-zh' || shown), autoRead, viewing: null, shown: index, nextLabel: '下一張',
    };
    return { kind: 'card', top, card: view };
  }

  enter();
  return {
    view() { cached ??= compute(); return cached; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    ready: () => Promise.resolve(),
    reveal() {
      const card = cards.at(index);
      if (!card || index >= cards.length || revealed || card.typed) return;
      autoRead = null;
      revealed = true;
      notify();
    },
    input(text) {
      if (!typed || typed.finished) return;
      autoRead = null;
      typed = { ...typed, input: text };
      notify();
    },
    submit() { if (typed?.input.trim()) open(typed.input); },
    skip() { open(''); },
    // 自評按鈕只換下一張，不寫任何東西。
    rate() {
      if (index >= cards.length || !(typed ? typed.finished : revealed)) return false;
      go(index + 1);
      return true;
    },
    rateOnly: () => false,
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
