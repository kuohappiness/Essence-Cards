import { baseForm } from '../core/deck/index.ts';
import { checkTyped, typedKey } from '../core/study/index.ts';
import type { Card, Rating } from '../core/study/index.ts';
import { answerSpeech, canSpeak, openingSpeech } from './english.ts';
import type { Flow, PreviewFlow, ReviewLine } from './flow.ts';
import { chosen, RATINGS } from './ratings.ts';
import { closest, copying, spelling, type Spelling } from './spelling.ts';

type StepResult = 'right' | 'wrong' | 'skip';
/** 第 2 步的結果；原形是 null 或等於某一個答案而跳過第 2 步時是 not-needed（syntax.md §5 的 retry）。 */
type RetryResult = StepResult | 'not-needed';

/** 打字卡（中翻英）的三步（D-121、W6 §2-3）。 */
export interface TypedView {
  step: 1 | 2 | 3;
  /** 第 1 步的結果；第 1 步還在進行時是 null。評分只看它。 */
  first: StepResult | null;
  /** 第 2 步的結果；跳過第 2 步是 not-needed，還沒到或第 1 步拼對是 null。 */
  second: RetryResult | null;
  /** 第 2、3 步標「錯誤」（打叉的圖示，D-145、D-174）：拼錯進來才標，按「沒印象」進來不標。 */
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
  /** 有跳過的按鈕：第 1、2 步是「沒印象」；第 3 步一開始沒有，照打送出一次還是不對之後是「跳過」（D-158）。 */
  canSkip: boolean;
  /** 跳過的按鈕換一個字（預覽是「顯示答案」，D-161）；沒有就照上面。 */
  skipLabel?: string;
}

const answersOf = (card: Card): readonly string[] => card.prompt.kind === 'qa' && card.prompt.typed ? card.prompt.typed : [];
/** 打字卡的答案與原形：原形是 null、或和某一個答案比對起來一樣（checkTyped 的規則，D-158）時跳過第 2 步（D-121）。 */
function hintOf(card: Card): string | null {
  const answers = card.prompt.kind === 'qa' ? card.prompt.typed ?? [] : [];
  const base = baseForm(card.target);
  if (base === null || answers.some(answer => typedKey(answer) === typedKey(base))) return null;
  return base;
}
/** 學生打的字對中的那一個答案；沒對中是 undefined。 */
const matchOf = (card: Card, text: string): string | undefined => answersOf(card).find(answer => typedKey(answer) === typedKey(text));
/** 能按的自評（D-066、D-116、D-121）：拼對只能記住了／太簡單；拼錯只能差一點／沒印象；按「沒印象」只剩沒印象。 */
export function allowedFor(first: StepResult | null): readonly Rating[] {
  if (first === null) return RATINGS;
  if (first === 'right') return ['good', 'easy'];
  if (first === 'wrong') return ['miss', 'near'];
  return ['miss'];
}

/** 一張打字卡從第 1 步開始（D-121）。 */
export function createTyped(card: Card, options: { now: () => number }): Flow {
  const typed: TypedView = {
    step: 1, first: null, second: null, notice: false, hint: null, answer: answersOf(card)[0] ?? '', attempt: null, copy: null, live: null, firstAttempt: null, input: '', finished: false, canSkip: true,
  };

  /** 中翻英的答案出現在畫面上：先念答案，再念把 ＿＿ 換成答案的例句（D-116、D-121）。 */
  function announceAnswer(answer: string): void {
    const speech = answerSpeech(card, answer);
    if (speech) flow.autoRead = speech;
  }
  /** 進入第 3 步：答案與背面出現、顯示最後一次打的字和最接近答案的比對；自動朗讀在這時念（D-121）。 */
  function enterStep3(lastInput: string, misspelled: boolean): void {
    const answers = answersOf(card);
    typed.step = 3;
    typed.hint = null;
    typed.notice = misspelled;
    typed.answer = answers[0] ?? '';
    typed.copy = closest(lastInput, answers);
    typed.attempt = spelling(lastInput, typed.copy);
    typed.live = copying('', typed.copy);
    typed.input = '';
    typed.canSkip = false;
    flow.revealedAt = options.now();
    announceAnswer(typed.answer);
  }
  function finish(matched: string, announce: boolean): void {
    typed.finished = true;
    typed.answer = matched;
    typed.hint = null;
    typed.notice = false;
    typed.live = null;
    typed.canSkip = false;
    flow.revealedAt = options.now();
    if (announce) announceAnswer(matched);
  }

  function input(text: string): boolean {
    flow.autoRead = null;
    typed.input = text;
    if (typed.step === 3) typed.live = copying(text, typed.copy ?? typed.answer);
    return true;
  }

  function submit(): boolean {
    flow.autoRead = null;
    const answers = answersOf(card);
    const text = typed.input;
    if (typed.step === 3) {
      if (!text.trim()) return false;
      typed.live = copying(text, typed.copy ?? typed.answer);
      // 照打任何一個答案都能結束；線上寫學生照打的那一個（拼對時寫對中的那一個，W6 §3-4）。還是不對就可以跳過（D-158）。
      if (checkTyped(card.prompt, text)) finish(matchOf(card, text) ?? typed.answer, false);
      else typed.canSkip = true;
      return true;
    }
    if (!text.trim()) return false;
    const ok = checkTyped(card.prompt, text);
    const matched = matchOf(card, text) ?? answers[0] ?? '';
    if (typed.step === 1) {
      if (ok) { typed.first = 'right'; finish(matched, false); }
      else {
        typed.first = 'wrong';
        typed.firstAttempt = spelling(text, closest(text, answers));
        const hint = hintOf(card);
        if (hint !== null) { typed.step = 2; typed.hint = hint; typed.notice = true; typed.input = ''; }
        else { typed.second = 'not-needed'; enterStep3(text, true); }
      }
    } else {
      if (ok) { typed.second = 'right'; finish(matched, true); }
      else { typed.second = 'wrong'; enterStep3(text, true); }
    }
    return true;
  }

  function skip(): boolean {
    if (typed.step === 3) {
      // 跳過照打（D-158）：線上寫照打的那一個；答案進第 3 步時已經念過，不再念。
      if (!typed.canSkip) return false;
      flow.autoRead = null;
      finish(typed.copy ?? typed.answer, false);
      return true;
    }
    flow.autoRead = null;
    const text = typed.input;
    if (typed.step === 1) {
      typed.first = 'skip';
      typed.firstAttempt = spelling(text, closest(text, answersOf(card)));
      const hint = hintOf(card);
      if (hint !== null) { typed.step = 2; typed.hint = hint; typed.notice = false; typed.input = ''; }
      else { typed.second = 'not-needed'; enterStep3(text, false); }
    } else {
      typed.second = 'skip';
      // 第 1 步拼錯過的，打叉一路標到走完（D-174）；一路按「沒印象」、沒拼過的不標。
      enterStep3(text, typed.first === 'wrong');
    }
    return true;
  }

  const flow: Flow = {
    autoRead: openingSpeech(card),
    revealedAt: null,
    view() {
      // 第 3 步就看得到答案與背面；能自評要等三步走完。
      const revealed = typed.finished || typed.step === 3;
      return { revealed, allowed: typed.finished ? allowedFor(typed.first) : [], speakable: canSpeak(card, revealed), typed, pick: null };
    },
    act(action) {
      if (typed.finished) return false;
      if (action.kind === 'input') return input(action.text);
      if (action.kind === 'submit') return submit();
      if (action.kind === 'skip') return skip();
      return false;
    },
    settle(rating) {
      const first = typed.first, second = typed.second;
      const line = (r: Rating): ReviewLine => ({ lt: card.lt, r, v: card.prompt.fingerprint, ...(first ? { typed: first } : {}), ...(second ? { retry: second } : {}) });
      // 回看時要顯示第 1 步打的字與比對：拼對的就是答案本身；拼錯或按「沒印象」的是 attempt（對最接近答案的比對）。
      const firstCompare = typed.firstAttempt ?? spelling(typed.answer, typed.answer);
      return {
        lines: [line(chosen(rating))],
        look: {
          typed: {
            step: 3, first, second, notice: false, hint: null, answer: typed.answer, attempt: firstCompare, copy: null, live: null, firstAttempt: firstCompare, input: firstCompare.typed.map(l => l.char).join(''), finished: true, canSkip: false,
          },
          pick: null,
          changeable: first === 'skip' ? [] : allowedFor(first),
          lines: changed => [line(changed)],
        },
      };
    },
  };
  return flow;
}

/** 預覽的打字卡（D-161）：不走三步，不用打字也能看答案；打了字就照複習的樣子比對。 */
export function createPreviewTyped(card: Card, reveal: boolean): PreviewFlow {
  let typed: TypedView = {
    step: 1, first: null, second: null, notice: false, hint: null, answer: answersOf(card)[0] ?? '', attempt: null, copy: null, live: null, firstAttempt: null, input: '', finished: false, canSkip: true, skipLabel: '顯示答案',
  };
  function finish(text: string): void {
    const match = text.trim() ? closest(text, answersOf(card)) : answersOf(card)[0] ?? '';
    const attempt = spelling(text, match);
    typed = { ...typed, step: 3, first: !text.trim() ? 'skip' : attempt.ok ? 'right' : 'wrong', answer: match, attempt, finished: true, canSkip: false, input: text };
    const speech = answerSpeech(card, match);
    if (speech) flow.autoRead = speech;
  }
  const flow: PreviewFlow = {
    autoRead: openingSpeech(card),
    view: () => ({ revealed: typed.finished, allowed: typed.finished ? RATINGS : [], speakable: canSpeak(card, typed.finished), typed, pick: null }),
    act(action) {
      if (typed.finished) return false;
      if (action.kind === 'input') { flow.autoRead = null; typed = { ...typed, input: action.text }; return true; }
      if (action.kind === 'submit' && typed.input.trim()) { flow.autoRead = null; finish(typed.input); return true; }
      if (action.kind === 'skip') { flow.autoRead = null; finish(''); return true; }
      return false;
    },
  };
  if (reveal) finish('');
  return flow;
}
