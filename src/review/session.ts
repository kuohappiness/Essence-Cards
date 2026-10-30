import { baseForm } from '../core/deck/index.ts';
import { checkTyped, typedKey } from '../core/study/index.ts';
import type { Card, Pick, Rating } from '../core/study/index.ts';
import type { State } from '../state/index.ts';
import { crumb } from './crumb.ts';
import { doneView, todayStats, type DoneView } from './done.ts';
import { englishParts, fillBlank } from './english.ts';
import { closest, copying, spelling, type Spelling } from './spelling.ts';

// 一次複習的狀態（W6 §2）：純程式，不碰 React 與 Obsidian。React 元件只把這裡的狀態畫出來、把按鍵與手勢轉成動作。

/** 自評四級，照 D-062 的順序：沒印象、差一點、記住了、太簡單。 */
export const RATINGS: readonly Rating[] = ['miss', 'near', 'good', 'easy'];
export const RATING_LABELS: Record<Rating, string> = { miss: '沒印象', near: '差一點', good: '記住了', easy: '太簡單' };
/** 翻面後多少毫秒內的自評不算（D-096）。 */
export const RATE_DELAY = 300;
/** 切到背景連續超過這麼久，回來時目前這張從頭開始（W6 §2-1、L2 的 F4；操作上的折衷，不是驗證過的記憶門檻）。 */
export const AWAY_LIMIT = 60_000;

export type StepResult = 'right' | 'wrong' | 'skip';
/** 第 2 步的結果；原形是 null 或等於某一個答案而跳過第 2 步時是 not-needed（syntax.md §5 的 retry）。 */
type RetryResult = StepResult | 'not-needed';

/** 打字卡（中翻英）的三步（D-121、W6 §2-3）。 */
export interface TypedView {
  step: 1 | 2 | 3;
  /** 第 1 步的結果；第 1 步還在進行時是 null。評分只看它。 */
  first: StepResult | null;
  /** 第 2 步的結果；跳過第 2 步是 not-needed，還沒到或第 1 步拼對是 null。 */
  second: RetryResult | null;
  /** 第 2 步標「錯誤」（打叉的圖示，D-145）：第 1 步拼錯進來才標，按「沒印象」進來不標。 */
  notice: boolean;
  /** 第 2 步的原形提示；其他步 null。 */
  hint: string | null;
  /** 寫在線上的答案：走完時是對中或照打的那一個（照打「正確拼字」那一行就寫它，D-145）；還沒走完是第一個（課本用的）。 */
  answer: string;
  /** 第 3 步：最後一次打的字和最接近的答案逐字比對（拼錯的字母標出）；其他步 null。 */
  attempt: Spelling | null;
  /** 第 3 步照打的對象：「正確拼字」那一行的答案（和最後一次打的字最接近的那個，D-145）；其他步與回看是 null。 */
  copy: string | null;
  /** 第 3 步照打：目前輸入和照打的對象照位置的即時比對（copying）；其他步 null。 */
  live: Spelling | null;
  /** 第 1 步拼錯或按「沒印象」時打的字和最接近答案的比對（回看時顯示）；拼對是 null。 */
  firstAttempt: Spelling | null;
  /** 目前輸入框的文字。 */
  input: string;
  /** 三步走完（答案出現、可以自評）。 */
  finished: boolean;
  /** 第 3 步沒有「沒印象」；第 1、2 步有。 */
  canSkip: boolean;
}

/** 這一次做過的一張（D-084：回看是「這一次」做過的）。 */
interface DoneCard {
  card: Card;
  crumb: string;
  rating: Rating;
  /** 這一筆紀錄的 t；改評分後是新的那一筆。 */
  t: string;
  typed: StepResult | null;
  retry: RetryResult | null;
  /** 打字卡：第 1 步打的字，和它與最接近答案的比對（回看時顯示）。 */
  firstInput: string | null;
  firstCompare: Spelling | null;
  /** 打字卡：寫在線上的答案。 */
  answer: string | null;
  /** 回看時能改成的評分（打字卡照第 1 步；按「沒印象」的不能改）。 */
  changeable: readonly Rating[];
}

export interface CardView {
  kind: 'card';
  card: Card;
  crumb: string;
  /** 背面已經顯示（一般卡翻面了；打字卡走完三步）。 */
  revealed: boolean;
  typed: TypedView | null;
  /** 現在能按的自評；翻面前是空的。 */
  allowed: readonly Rating[];
  /** 回看時：當時按的評分（那一顆有底色）；目前這張是 null。 */
  pressed: Rating | null;
  /** 英文的目標（有喇叭與自動朗讀開關）。 */
  english: boolean;
  /** 喇叭現在可以出現：英翻中隨時；中翻英答案出現之後（D-082）。 */
  speakable: boolean;
  /** 最近一次動作讓這些文字該自動朗讀（開關打開時由畫面念一次）；下一個動作就清掉。沒有就是 null。 */
  autoRead: readonly string[] | null;
  /** 回看第幾張（0 起）與這一次做過幾張；目前這張是 null。 */
  viewing: { index: number; total: number } | null;
  /** 這一張第幾次從頭出現：切走超過 60 秒回來重新開始時加一（畫面用它換卡）；回看的卡是 0。 */
  shown: number;
}
interface TopView {
  /** 中間的文字：「還剩 N 張」或「再複習一些」。 */
  center: string;
  /** 細進度條 0～1；再複習一些時 null。 */
  fraction: number | null;
  canBack: boolean;
  /** 回看中：中間換成「回到目前 ›」。 */
  viewing: boolean;
}
export type View =
  | { kind: 'loading'; top: TopView }
  | { kind: 'card'; top: TopView; card: CardView }
  | { kind: 'done'; top: TopView; done: DoneView };

export interface Session {
  view(): View;
  /** 狀態改變時通知畫面；回傳取消的函式。 */
  subscribe(listener: () => void): () => void;
  /** state 讀完、第一張拿到。 */
  ready(): Promise<void>;
  /** 一般的卡翻面（打字卡不用）。 */
  reveal(): void;
  /** 輸入框的文字（打字卡）。 */
  input(text: string): void;
  /** 「確認」（打字卡）。 */
  submit(): void;
  /** 「沒印象」按鈕（打字卡第 1、2 步）。 */
  skip(): void;
  /** 自評；回看時是改評分。回傳有沒有真的算數（0.3 秒內、不能按的評分不算）。 */
  rate(rating: Rating): boolean;
  /**
   * 只剩一個自評可選時（打字卡第 1 步按了「沒印象」，三步走完）直接記下（D-145）：答案已經看過、打過，不受翻面後 0.3 秒的限制。
   * 其他情況（還沒走完、有兩個以上可選、回看中）不記，回傳 false。
   */
  rateOnly(): boolean;
  back(): void;
  forward(): void;
  toCurrent(): void;
  /** 完成畫面的按鈕：再複習一些或接著做某一科。 */
  continueWith(pick: Pick): void;
  /** 切到背景（visibilityState 變 hidden）：記下時間。 */
  pause(): void;
  /** 回到前景：離開超過 AWAY_LIMIT 時，目前這張未評分的卡從頭開始（不寫紀錄）；有卡但沒重設時也通知畫面一次。回傳有沒有重設。 */
  resume(): boolean;
  /** 關掉畫面：清掉這一次做過的卡，不寫任何紀錄。 */
  close(): void;
  /** 這一次做過的卡（測試與開發命令用）。 */
  history(): readonly DoneCard[];
  /** 目前的 pick（做哪一科或再複習一些）。 */
  pick(): Pick;
}

interface SessionOptions {
  state: State;
  pick: Pick;
  now?: () => number;
}

interface Current {
  card: Card;
  crumb: string;
  revealed: boolean;
  revealedAt: number | null;
  typed: TypedView | null;
  /** 英文的部分（題目）：喇叭與自動朗讀用。 */
  autoRead: readonly string[] | null;
  shown: number;
}

/** 打字卡的答案與原形：原形是 null、或和某一個答案比對起來一樣（checkTyped 的規則，D-158）時跳過第 2 步（D-121）。 */
function hintOf(card: Card): string | null {
  const answers = card.prompt.kind === 'qa' ? card.prompt.typed ?? [] : [];
  const base = baseForm(card.target);
  if (base === null || answers.some(answer => typedKey(answer) === typedKey(base))) return null;
  return base;
}
const answersOf = (card: Card): readonly string[] => card.prompt.kind === 'qa' && card.prompt.typed ? card.prompt.typed : [];
/** 學生打的字對中的那一個答案；沒對中是 undefined。 */
const matchOf = (card: Card, text: string): string | undefined => answersOf(card).find(answer => typedKey(answer) === typedKey(text));
/** 能按的自評（D-066、D-116、D-121）：拼對只能記住了／太簡單；拼錯只能差一點／沒印象；按「沒印象」只剩沒印象。 */
export function allowedFor(first: StepResult | null): readonly Rating[] {
  if (first === null) return RATINGS;
  if (first === 'right') return ['good', 'easy'];
  if (first === 'wrong') return ['miss', 'near'];
  return ['miss'];
}

export function createSession(options: SessionOptions): Session {
  const { state } = options;
  const now = options.now ?? Date.now;
  let pick = options.pick;
  const listeners = new Set<() => void>();
  const done: DoneCard[] = [];
  let current: Current | null = null;
  let viewing: number | null = null;
  let loaded = false;
  let closed = false;
  let pausedAt: number | null = null;
  /** view() 的快取：同一個狀態回傳同一個物件（React 的 useSyncExternalStore 靠它判斷有沒有變）。 */
  let cached: View | null = null;

  function notify(): void {
    cached = null;
    for (const listener of [...listeners]) listener();
  }

  function crumbOf(card: Card): string {
    const entry = state.decks().find(d => d.path === card.deck);
    return entry ? crumb(entry.deck.props, card.deck) : card.deck;
  }

  /** 從 state 拿下一張；done 就是完成畫面（文字在 compute 照當下的 progress 算，不留舊的）。 */
  function load(): void {
    const next = state.next(pick);
    current = next.kind === 'card' ? present(next.card, 0) : null;
  }
  /** 一張卡從題目開始：一般卡在正面，打字卡在第 1 步。 */
  function present(card: Card, shown: number): Current {
    const english = card.target.direction !== null;
    const typed: TypedView | null = card.typed ? {
      step: 1, first: null, second: null, notice: false, hint: null, answer: answersOf(card)[0] ?? '', attempt: null, copy: null, live: null, firstAttempt: null, input: '', finished: false, canSkip: true,
    } : null;
    // 英翻中的題目一出現就念英文（D-116）。
    const question = card.prompt.kind === 'qa' ? card.prompt.question : card.prompt.text;
    const autoRead = english && card.target.direction === 'en-zh' ? englishParts(question) : null;
    return { card, crumb: crumbOf(card), revealed: false, revealedAt: null, typed, autoRead: autoRead?.length ? autoRead : null, shown };
  }

  const readyPromise = state.ready().then(() => {
    if (closed) return;
    loaded = true;
    load();
    notify();
  });
  // 卡組或別台裝置的紀錄改變：目前這一張不換，上方的「還剩幾張」照新的 progress 重算（W6 §2-1）。
  // 在完成畫面（沒有目前這張）時重新問 next：別台裝置可能做完了別科，也可能又有卡（Codex L2 F2）。
  const unsubscribe = state.onChange(() => {
    if (!loaded) return;
    if (!current) load();
    notify();
  });

  function top(): TopView {
    const canBack = done.length > 0 && viewing !== 0;
    if (!loaded) return { center: '', fraction: null, canBack: false, viewing: false };
    if ('more' in pick) return { center: '再複習一些', fraction: null, canBack, viewing: viewing !== null };
    const progress = state.progress();
    const subject = 'subject' in pick ? pick.subject : undefined;
    const row = subject === undefined ? null : progress.subjects.find(r => r.subject === subject);
    const total = row ? row.total : progress.total, finishedCount = row ? row.done : progress.done;
    return { center: `還剩 ${String(Math.max(0, total - finishedCount))} 張`, fraction: total ? finishedCount / total : 1, canBack, viewing: viewing !== null };
  }

  function cardView(): CardView | null {
    if (viewing !== null) {
      const entry = done[viewing];
      const typedView: TypedView | null = entry.answer !== null ? {
        step: 3, first: entry.typed, second: entry.retry, notice: false, hint: null, answer: entry.answer ?? '', attempt: entry.firstCompare, copy: null, live: null, firstAttempt: entry.firstCompare, input: entry.firstInput ?? '', finished: true, canSkip: false,
      } : null;
      // 回看的那張後來被停掉（需要新版，任務說明 2-2）：不能改評分。
      return {
        kind: 'card', card: entry.card, crumb: entry.crumb, revealed: true, typed: typedView, allowed: state.canAnswer(entry.card.lt) ? entry.changeable : [], pressed: entry.rating,
        english: entry.card.target.direction !== null, speakable: entry.card.target.direction !== null, autoRead: null, viewing: { index: viewing, total: done.length }, shown: 0,
      };
    }
    if (!current) return null;
    const { card, typed } = current;
    // 打字卡：第 3 步就看得到答案與背面；能自評要等三步走完。
    const revealed = typed ? typed.finished || typed.step === 3 : current.revealed;
    const canRate = typed ? typed.finished : current.revealed;
    const english = card.target.direction !== null;
    return {
      kind: 'card', card, crumb: current.crumb, revealed, typed, allowed: canRate ? allowedFor(typed ? typed.first : null) : [],
      pressed: null, english, speakable: english && (card.target.direction === 'en-zh' || revealed), autoRead: current.autoRead, viewing: null, shown: current.shown,
    };
  }

  function compute(): View {
    const header = top();
    if (!loaded) return { kind: 'loading', top: header };
    const card = cardView();
    if (card) return { kind: 'card', top: header, card };
    return { kind: 'done', top: header, done: doneView(pick, state.progress(), todayStats(state.history(), state.today())) };
  }
  function view(): View {
    cached ??= compute();
    return cached;
  }

  /** 翻面或答案出現：記下時間，0.3 秒內的自評不算。 */
  function revealNow(): void {
    if (!current) return;
    current.revealed = true;
    current.revealedAt = now();
  }

  /** 每個動作開頭：上一個動作要念的已經念過了。 */
  function spoken(): void { if (current) current.autoRead = null; }

  function reveal(): void {
    if (!current || current.typed || current.revealed || viewing !== null) return;
    spoken();
    revealNow();
    notify();
  }

  function input(text: string): void {
    if (!current?.typed || current.typed.finished || viewing !== null) return;
    spoken();
    const typed = current.typed;
    typed.input = text;
    if (typed.step === 3) typed.live = copying(text, typed.copy ?? typed.answer);
    notify();
  }

  /** 進入第 3 步：答案與背面出現、顯示最後一次打的字和最接近答案的比對；自動朗讀在這時念（D-121）。 */
  function enterStep3(typed: TypedView, card: Card, lastInput: string): void {
    const answers = answersOf(card);
    typed.step = 3;
    typed.hint = null;
    typed.notice = false;
    typed.answer = answers[0] ?? '';
    typed.copy = closest(lastInput, answers);
    typed.attempt = spelling(lastInput, typed.copy);
    typed.live = copying('', typed.copy);
    typed.input = '';
    typed.canSkip = false;
    revealNow();
    announceAnswer(card, typed.answer);
  }
  /** 中翻英的答案出現在畫面上：先念答案，再念把 ＿＿ 換成答案的例句（D-116、D-121）。 */
  function announceAnswer(card: Card, answer: string): void {
    if (!current || card.target.direction !== 'zh-en') return;
    const question = card.prompt.kind === 'qa' ? card.prompt.question : card.prompt.text;
    const sentence = fillBlank(question, answer);
    current.autoRead = sentence ? [answer, sentence] : [answer];
  }
  function finish(typed: TypedView, card: Card, matched: string, announce: boolean): void {
    typed.finished = true;
    typed.answer = matched;
    typed.hint = null;
    typed.notice = false;
    typed.live = null;
    typed.canSkip = false;
    revealNow();
    if (announce) announceAnswer(card, matched);
  }

  function submit(): void {
    if (!current?.typed || current.typed.finished || viewing !== null) return;
    spoken();
    const { card, typed } = current;
    const answers = answersOf(card);
    const text = typed.input;
    if (typed.step === 3) {
      if (!text.trim()) return;
      typed.live = copying(text, typed.copy ?? typed.answer);
      // 照打任何一個答案都能結束；線上寫學生照打的那一個（拼對時寫對中的那一個，W6 §3-4）。
      if (checkTyped(card.prompt, text)) finish(typed, card, matchOf(card, text) ?? typed.answer, false);
      notify();
      return;
    }
    if (!text.trim()) return;
    const ok = checkTyped(card.prompt, text);
    const matched = matchOf(card, text) ?? answers[0] ?? '';
    if (typed.step === 1) {
      if (ok) { typed.first = 'right'; finish(typed, card, matched, false); }
      else {
        typed.first = 'wrong';
        typed.firstAttempt = spelling(text, closest(text, answers));
        const hint = hintOf(card);
        if (hint !== null) { typed.step = 2; typed.hint = hint; typed.notice = true; typed.input = ''; }
        else { typed.second = 'not-needed'; enterStep3(typed, card, text); }
      }
    } else {
      if (ok) { typed.second = 'right'; finish(typed, card, matched, true); }
      else { typed.second = 'wrong'; enterStep3(typed, card, text); }
    }
    notify();
  }

  function skip(): void {
    if (!current?.typed || current.typed.finished || viewing !== null) return;
    const { card, typed } = current;
    if (typed.step === 3) return;
    spoken();
    const text = typed.input;
    if (typed.step === 1) {
      typed.first = 'skip';
      typed.firstAttempt = spelling(text, closest(text, answersOf(card)));
      const hint = hintOf(card);
      if (hint !== null) { typed.step = 2; typed.hint = hint; typed.notice = false; typed.input = ''; }
      else { typed.second = 'not-needed'; enterStep3(typed, card, text); }
    } else {
      typed.second = 'skip';
      enterStep3(typed, card, text);
    }
    notify();
  }

  function rate(rating: Rating): boolean {
    if (!loaded) return false;
    if (viewing !== null) return change(done[viewing], rating);
    if (!current) return false;
    const { card, typed } = current;
    const revealed = typed ? typed.finished : current.revealed;
    if (!revealed || !allowedFor(typed ? typed.first : null).includes(rating)) return false;
    if (current.revealedAt !== null && now() - current.revealedAt < RATE_DELAY) return false;
    spoken();
    const first = typed?.first ?? null, second = typed?.second ?? null;
    // 寫紀錄只經過 state.answer（W6 限制第 4 點）；寫不進去由 W5 的提示處理，畫面照常換下一張。
    const t = state.answer({ lt: card.lt, r: rating, v: card.prompt.fingerprint, ...(first ? { typed: first } : {}), ...(second ? { retry: second } : {}) });
    // 這張在作答前被停掉（需要新版，任務說明 2-2）：沒有寫紀錄，不算做過、不進回看，換下一張。
    if (t === null) {
      load();
      notify();
      return true;
    }
    // 回看時要顯示第 1 步打的字與比對：拼對的就是答案本身；拼錯或按「沒印象」的是 attempt（對最接近答案的比對）。
    const firstCompare = typed ? (typed.firstAttempt ?? spelling(typed.answer, typed.answer)) : null;
    done.push({
      card, crumb: current.crumb, rating, t, typed: first, retry: second,
      firstInput: firstCompare ? firstCompare.typed.map(l => l.char).join('') : null,
      firstCompare,
      answer: typed ? typed.answer : null,
      changeable: typed ? (first === 'skip' ? [] : allowedFor(first)) : RATINGS,
    });
    load();
    notify();
    return true;
  }

  function rateOnly(): boolean {
    if (!current?.typed?.finished || viewing !== null) return false;
    const allowed = allowedFor(current.typed.first);
    if (allowed.length !== 1) return false;
    current.revealedAt = null;
    return rate(allowed[0]);
  }

  /**
   * 回看時改評分（D-084）：取消原本那一筆，再寫同樣的 lt、v、typed、retry 加新的評分。目前有一張還沒作答的卡時不換它；
   * 在完成畫面時重新問 next，改成沒印象或差一點的那張回到目前時就出（Codex L2 F2）。
   */
  function change(entry: DoneCard, rating: Rating): boolean {
    // 取消與新的評分一起寫或一起不寫：那張後來被停掉（需要新版）就不能改，先問；取消涵蓋同一個 t 的所有作答，別台裝置同一刻的
    // 作答被停時取消會被拒（Codex L2 的 F1），這時新的評分也不寫。
    if (entry.rating === rating || !entry.changeable.includes(rating) || !state.canAnswer(entry.card.lt)) return false;
    if (state.answer({ undo: entry.t }) === null) return false;
    const t = state.answer({ lt: entry.card.lt, r: rating, v: entry.card.prompt.fingerprint, ...(entry.typed ? { typed: entry.typed } : {}), ...(entry.retry ? { retry: entry.retry } : {}) });
    // 同一個目標剛問過可以寫、取消也寫了，不會是 null；型別上仍要處理。
    if (t === null) return false;
    entry.t = t;
    entry.rating = rating;
    if (!current) load();
    notify();
    return true;
  }

  // 回看、離開回看都不播放自動朗讀（D-084）：回看時 autoRead 是 null，回到目前這張也不補播。
  function back(): void {
    if (!done.length) return;
    if (viewing === null) viewing = done.length - 1;
    else if (viewing > 0) viewing--;
    else return;
    spoken();
    notify();
  }
  function forward(): void {
    if (viewing === null) return;
    viewing = viewing < done.length - 1 ? viewing + 1 : null;
    notify();
  }
  function toCurrent(): void {
    if (viewing === null) return;
    viewing = null;
    notify();
  }

  // 切走再回來（W6 §2-1、L2 的 F4）：連續超過 60 秒，目前這張未評分的卡從頭開始；剛好 60 秒不動。回看的位置與已評分的
  // 快照不動；回看中重設的，回到目前時不補播自動朗讀（D-084）。
  function pause(): void { pausedAt ??= now(); }
  function resume(): boolean {
    if (pausedAt === null) return false;
    const away = now() - pausedAt;
    pausedAt = null;
    if (!current) return false;
    // 沒超過 60 秒也通知一次：畫面重新判斷（例如只剩一個自評、切走前已走完的那張要自動換下一張，D-145）。
    if (away <= AWAY_LIMIT) { notify(); return false; }
    current = present(current.card, current.shown + 1);
    if (viewing !== null) current.autoRead = null;
    notify();
    return true;
  }

  function continueWith(next: Pick): void {
    if (!loaded || current) return;
    pick = next;
    load();
    notify();
  }

  return {
    view, ready: () => readyPromise,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reveal, input, submit, skip, rate, rateOnly, back, forward, toCurrent, continueWith, pause, resume,
    close() { closed = true; unsubscribe(); done.length = 0; current = null; listeners.clear(); },
    history: () => done,
    pick: () => pick,
  };
}

