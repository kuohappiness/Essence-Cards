import type { Card, Pick, Rating } from '../core/study/index.ts';
import type { State, StudyPick } from '../state/index.ts';
import { crumb } from './crumb.ts';
import { doneView, todayStats, type DoneView } from './done.ts';
import { createFlow, type Flow, type FlowAction, type LookBack } from './flow.ts';
import type { TypedView } from './typed.ts';

// 一次複習的狀態（W6 §2）：純程式，不碰 React 與 Obsidian。React 元件只把這裡的狀態畫出來、把按鍵與手勢轉成動作。
// 一張卡走到有結果的整段在 Flow（flow.ts，D-181）；這裡只留取卡、上方的進度、回看、切走重來、衝突與停用、0.3 秒、寫紀錄。

/** 翻面後多少毫秒內的自評不算（D-096）。 */
export const RATE_DELAY = 300;
/** 切到背景連續超過這麼久，回來時目前這張從頭開始（W6 §2-1、L2 的 F4；操作上的折衷，不是驗證過的記憶門檻）。 */
export const AWAY_LIMIT = 60_000;

/** 這一次做過的一張（D-084：回看是「這一次」做過的）。 */
interface DoneCard {
  card: Card;
  crumb: string;
  rating: Rating;
  /** 這張卡寫下的每一行的 t；改評分後是新的那幾行。 */
  written: readonly string[];
  look: LookBack;
  /** 回看時能改成的評分：照 look；ID 變成重複之後是空的（D-157）。 */
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
  /** 不作答也能往後的按鈕的字（預覽，D-161）；複習沒有。 */
  nextLabel?: string;
}
interface TopView {
  /** 中間的文字：「還剩 N 張」或「再複習一些」。 */
  center: string;
  /** 細進度條 0～1；再複習一些時 null。 */
  fraction: number | null;
  canBack: boolean;
  /** 回看中：中間換成「回到目前 ›」。 */
  viewing: boolean;
  /** 不是回看也能往後一張（預覽，D-161）。 */
  canForward?: boolean;
  /** 完成畫面也留著中間的文字（預覽一直標「預覽，不記錄」）。 */
  pinned?: boolean;
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
  /** 「沒印象」按鈕（打字卡第 1、2 步）；第 3 步照打錯過一次之後是「跳過」：這張走完，照平常自評，不另寫紀錄（D-158）。 */
  skip(): void;
  /** 自評；回看時是改評分。回傳有沒有真的算數（0.3 秒內、不能按的評分不算）。 */
  rate(rating: Rating): boolean;
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
  pick(): StudyPick;
}

interface SessionOptions {
  state: State;
  pick: StudyPick;
  now?: () => number;
}

interface Current {
  card: Card;
  crumb: string;
  flow: Flow;
  shown: number;
}

export function createSession(options: SessionOptions): Session {
  const { state } = options;
  const now = options.now ?? Date.now;
  let pick: StudyPick = options.pick;
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
  /** 一張卡從題目開始。 */
  function present(card: Card, shown: number): Current {
    return { card, crumb: crumbOf(card), flow: createFlow(card, { now }), shown };
  }
  /** 這張卡牽涉的每一個目標都還能寫（需要新版時會被停掉，任務說明 2-2）。 */
  const canAnswer = (card: Card): boolean => card.blanks.every(blank => state.canAnswer(blank.lt));
  const touches = (card: Card, ids: ReadonlySet<string>): boolean => card.blanks.some(blank => ids.has(blank.lt));

  const readyPromise = state.ready().then(() => {
    if (closed) return;
    loaded = true;
    load();
    notify();
  });
  // 卡組或別台裝置的紀錄改變：目前這一張不換，上方的「還剩幾張」照新的 progress 重算（W6 §2-1）。
  // 在完成畫面（沒有目前這張）時重新問 next：別台裝置可能做完了別科，也可能又有卡（Codex L2 F2）。
  // 例外是 ID 變成重複的（D-157）：作答只帶 lt 與指紋，衝突解除後分不出這張是哪一個目標的。目前這張丟掉、重新取卡，什麼都不寫
  // （回看中換掉的，回到目前時不補播自動朗讀，D-084）；回看裡這個 ID 的卡之後都不能改評分，衝突解除後也一樣。
  const unsubscribe = state.onChange(() => {
    if (!loaded) return;
    const conflicted = new Set(state.conflicts().map(each => each.id));
    for (const entry of done) if (touches(entry.card, conflicted)) entry.changeable = [];
    if (current && touches(current.card, conflicted)) {
      load();
      if (viewing !== null) spoken();
    } else if (!current) load();
    notify();
  });

  function top(): TopView {
    const canBack = done.length > 0 && viewing !== 0;
    if (!loaded) return { center: '', fraction: null, canBack: false, viewing: false };
    // 目標集合、已完成數、剩餘數和選卡同一份（state.scope，技術債「一次複習的範圍」）。
    const count = state.scope(pick);
    if (!count) return { center: '再複習一些', fraction: null, canBack, viewing: viewing !== null };
    return { center: `還剩 ${String(Math.max(0, count.total - count.done))} 張`, fraction: count.total ? count.done / count.total : 1, canBack, viewing: viewing !== null };
  }

  function cardView(): CardView | null {
    if (viewing !== null) {
      const entry = done[viewing];
      // 回看的那張後來被停掉（需要新版，任務說明 2-2）：不能改評分。
      return {
        kind: 'card', card: entry.card, crumb: entry.crumb, revealed: true, typed: entry.look.typed, allowed: canAnswer(entry.card) ? entry.changeable : [], pressed: entry.rating,
        english: entry.card.target.direction !== null, speakable: entry.card.target.direction !== null, autoRead: null, viewing: { index: viewing, total: done.length }, shown: 0,
      };
    }
    if (!current) return null;
    const { card, flow } = current;
    const { revealed, allowed, speakable, typed } = flow.view();
    return {
      kind: 'card', card, crumb: current.crumb, revealed, typed, allowed,
      pressed: null, english: card.target.direction !== null, speakable, autoRead: flow.autoRead, viewing: null, shown: current.shown,
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

  /** 每個動作開頭：上一個動作要念的已經念過了。 */
  function spoken(): void { if (current) current.flow.autoRead = null; }

  /** 一個作答動作交給這張卡的流程；回看時不算。 */
  function act(action: FlowAction): void {
    if (!current || viewing !== null) return;
    if (current.flow.act(action)) notify();
  }

  function rate(rating: Rating): boolean {
    if (!loaded) return false;
    if (viewing !== null) return change(done[viewing], rating);
    if (!current) return false;
    const { card, flow } = current;
    if (!flow.view().allowed.includes(rating)) return false;
    if (flow.revealedAt !== null && now() - flow.revealedAt < RATE_DELAY) return false;
    spoken();
    const { lines, look } = flow.settle(rating);
    // 寫紀錄只經過 state.answer（W6 限制第 4 點）；寫不進去由 W5 的提示處理，畫面照常換下一張。
    const written = lines.flatMap(line => state.answer(line) ?? []);
    // 這張在作答前被停掉（需要新版，任務說明 2-2）：沒有寫紀錄，不算做過、不進回看，換下一張。
    if (!written.length) {
      load();
      notify();
      return true;
    }
    done.push({ card, crumb: current.crumb, rating, written, look, changeable: look.changeable });
    load();
    notify();
    return true;
  }

  /**
   * 回看時改評分（D-084）：取消原本那一筆，再寫同樣的 lt、v、typed、retry 加新的評分。目前有一張還沒作答的卡時不換它；
   * 在完成畫面時重新問 next，改成沒印象或差一點的那張回到目前時就出（Codex L2 F2）。
   */
  function change(entry: DoneCard, rating: Rating): boolean {
    // 取消與新的評分一起寫或一起不寫：那張後來被停掉（需要新版）就不能改，先問；取消涵蓋同一個 t 的所有作答，別台裝置同一刻的
    // 作答被停時取消會被拒（Codex L2 的 F1），這時新的評分也不寫。
    if (entry.rating === rating || !entry.changeable.includes(rating) || !canAnswer(entry.card)) return false;
    for (const t of entry.written) if (state.answer({ undo: t }) === null) return false;
    const written: string[] = [];
    for (const line of entry.look.lines(rating)) {
      const t = state.answer(line);
      // 同一個目標剛問過可以寫、取消也寫了，不會是 null；型別上仍要處理。
      if (t === null) return false;
      written.push(t);
    }
    entry.written = written;
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
    // 停在完成畫面、跨過清晨 4 點回來：照新的一天重新判斷（技術債「完成畫面跨過 4 點」）。
    // 沒有變就不通知，畫面留著同一個物件（同一天回來時什麼都沒換）。
    if (!current) {
      if (!loaded) return false;
      const before = view();
      load();
      cached = null;
      if (current || JSON.stringify(view()) !== JSON.stringify(before)) notify();
      else cached = before;
      return false;
    }
    // 沒超過 60 秒也通知一次：畫面重新判斷（例如只剩一個自評、切走前已走完的那張要自動換下一張，D-145）。
    if (away <= AWAY_LIMIT) { notify(); return false; }
    current = present(current.card, current.shown + 1);
    if (viewing !== null) current.flow.autoRead = null;
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
    reveal() { act({ kind: 'reveal' }); },
    input(text) { act({ kind: 'input', text }); },
    submit() { act({ kind: 'submit' }); },
    skip() { act({ kind: 'skip' }); },
    rate, back, forward, toCurrent, continueWith, pause, resume,
    close() { closed = true; unsubscribe(); done.length = 0; current = null; listeners.clear(); },
    history: () => done,
    pick: () => pick,
  };
}

