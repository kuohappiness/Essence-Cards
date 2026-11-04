import type { App } from 'obsidian';
import { createPortal } from 'react-dom';
import type { QuestionType, Rating } from '../core/study/index.ts';
import { blankCount, extraLabel, fillBlank, lineSpeech, otherAnswers, questionOf, RATING_LABELS, RATINGS, sourceLabel, sourceLinks, splitTranslation } from '../review/index.ts';
import type { CardView, SourceOwner, Spelling, TypedView } from '../review/index.ts';
import { Icon } from './Icon.tsx';
import { Markdown } from './Markdown.tsx';
import { firstMaterial, resolveSource, type MaterialDeck } from './sources.ts';
import type { Speech } from './speech.ts';

// 題型接點的第四張表（D-181）：題目區、底部那一排、點卡片做什麼。其他三張表在 core/deck/question-types.ts、core/study/compose.ts、review/flow.ts。
// 這裡都沒有 hook，狀態都在 review 的 Flow；hook 留在 Review 的根元件（tests/helpers/review-ui.ts 的替身也只讓根元件有 hook）。

interface BodyProps {
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
  onPainted: () => void;
  onFail: (side: 'front' | 'back', error: unknown, path: string) => void;
}

interface BottomProps {
  view: CardView;
  animating: boolean;
  reveal: () => void;
  rate: (rating: Rating) => void;
}

interface TapTools {
  reveal: () => void;
  focusInput: () => void;
}

interface Screen {
  /** 題目區。 */
  Body: (props: BodyProps) => React.JSX.Element;
  /**
   * 底部那一排的內容；null 是沒有這一排。是普通函式、不是元件，由 Review 直接呼叫、放進同一個 .ec-actions：這樣翻面卡與打字卡互換時，
   * 同一顆評分按鈕留在原處，焦點不掉（題型接點第一步的 Codex 查核 F1）。
   */
  bottom: (props: BottomProps) => React.ReactNode;
  /** 點卡片的空白處（回看時不會到這裡）。 */
  tap: (view: CardView, tools: TapTools) => void;
  /** 舞台多加的 class。 */
  stage: (view: CardView) => string;
}

/** 字母的比對：拼錯的畫刪除線（你拼的、照著打一次）或紫色（正確拼字）。 */
function Letters({ letters, mode }: { letters: Spelling['typed']; mode: 'typed' | 'expected' }): React.JSX.Element {
  if (!letters.length) return <span className="ec-letters">—</span>;
  return <span className="ec-letters" lang="en">{letters.map((letter, index) => letter.bad
    ? (mode === 'typed' ? <s key={index}>{letter.char}</s> : <mark className="ec-mark" key={index}>{letter.char}</mark>)
    : <span key={index}>{letter.char}</span>)}</span>;
}

/**
 * 一行最多一個喇叭（D-145）：按下去依序念這一行的英文（lineSpeech）。
 * 題目、答案、背面補充的喇叭交給 Markdown 的 tail，接在最後一個字後面、和它一起換行。
 */
function Speaker({ texts, say }: { texts: readonly string[]; say: (texts: readonly string[]) => void }): React.JSX.Element | null {
  if (!texts.length) return null;
  return <span className="ec-speakers"><button type="button" className="ec-ico ec-say" aria-label={'朗讀 ' + texts.join('、')} onClick={() => { say(texts); }}><Icon type="speaker" /></button></span>;
}

/** 拼字比對裡的答案（「正確拼字」那一行寫的字）。 */
const spelled = (letters: Spelling['expected']): string => letters.map(letter => letter.char).join('');

const sayWith = (speech: Speech) => (texts: readonly string[]): void => { speech.say(texts); };
const speakWith = (view: CardView) => (text: string): string[] => view.speakable ? lineSpeech(text) : [];

/** 翻面與打字不一樣的部分。 */
interface QaParts {
  /** 題目的 Markdown。 */
  mode: 'cloze' | 'typed' | 'plain';
  revealedQuestion: boolean;
  lines: number;
  words: readonly string[];
  /** 題目的喇叭念的文字。 */
  spoken: string;
  /** 打字卡第 3 步（照打）。 */
  copying: boolean;
  /** 題目與答案區之間。 */
  middle: React.ReactNode;
  /** 答案區最上面。 */
  head: React.ReactNode;
  /** 最後面。 */
  last: React.ReactNode;
}

/** 翻面與打字共用的骨架：題目、背面補充、出處。 */
function QaCard({ props, parts }: { props: BodyProps; parts: QaParts }): React.JSX.Element {
  const { view, app, speech, materials, owner, units, openLink, tipOpen, setTipOpen, onSlot, qRef, sticky, onPainted, onFail } = props;
  const { card, revealed } = view;
  const prompt = card.prompt;
  const question = questionOf(prompt);
  const extras = [...prompt.extras, ...card.target.shared];
  const say = sayWith(speech);
  const speak = speakWith(view);
  const sources = sourceLinks(card.target.fields.sources, owner(card.deck));
  const deckMaterials = materials(card.deck);
  const links = sources.map(item => ({ ...item, label: sourceLabel(item), target: resolveSource(app, card.deck, deckMaterials, item.link, (term, code) => units(card.deck, term, code)) }));
  const fallback = sources.length ? null : firstMaterial(app, card.deck, deckMaterials);
  const hasSource = links.some(item => item.target) || fallback !== null || links.length > 0;
  return <article className={'ec-card' + (view.english ? ' is-english' : '') + (parts.copying ? ' is-copying' : '')} lang={view.english ? 'en' : 'zh-Hant'}>
    <div className="ec-meta">{card.isNew && <span className="ec-new">新</span>}<span lang="zh-Hant">{view.crumb}</span></div>
    <div className={'ec-q' + (parts.lines > 0 ? ' has-blank' : '') + (sticky ? ' is-sticky' : '')} ref={qRef}>
      {/* 在空格裡打字時，線上先不寫答案（第 3 步照著下面「正確拼字」那一行打）；三步走完才寫上去 */}
      {/* 喇叭接在最後一個字後面（D-145，iPhone 回饋），不放在第一行右邊 */}
      <Markdown app={app} text={question} sourcePath={card.deck} mode={parts.mode} revealed={parts.revealedQuestion}
        lines={parts.lines} words={parts.words} onSlot={parts.lines > 0 ? onSlot : undefined}
        english={view.english} tail={<Speaker texts={speak(parts.spoken)} say={say} />} onReady={onPainted} onFail={(error, path) => { onFail('front', error, path); }} />
    </div>
    {parts.middle}
    {revealed && <div className="ec-answer">
      {parts.head}
      {/* 背面補充開頭的「記憶錨點：」「例句：」這類名稱自己一行，內容從下一行開始（D-145，iPhone 回饋） */}
      {extras.length > 0 && <div className="ec-ex">{extras.map((extra, index) => {
        const { label, body } = extraLabel(extra);
        // 英文句子和中文翻譯各一行（D-174），喇叭留在英文那一行。
        const { line, translation } = splitTranslation(body);
        return <div key={index} className="ec-ex-item">
          {label && <div className="ec-ex-label" lang="zh-Hant">{label}</div>}
          <div className="ec-ex-row"><Markdown app={app} text={line} sourcePath={card.deck} revealed tail={<Speaker texts={speak(line)} say={say} />} onFail={(error, path) => { onFail('back', error, path); }} /></div>
          {translation && <div className="ec-ex-row" lang="zh-Hant"><Markdown app={app} text={translation} sourcePath={card.deck} revealed onFail={(error, path) => { onFail('back', error, path); }} /></div>}
        </div>;
      })}</div>}
      {hasSource && <div className="ec-tools">
        <span className={'ec-srcw' + (tipOpen ? ' is-tip' : '')}>
          <button type="button" className="ec-ico sm" aria-label="出處" onClick={() => { setTipOpen(!tipOpen); }}><Icon type="book" /></button>
          {tipOpen && (links.length ? links : [{ label: '出處', target: fallback }]).map((item, index) => item.target
            ? <button key={index} type="button" className="ec-tip" onClick={() => { openLink(item.target ?? '', card.deck); }}>{item.label} ↗</button>
            : <span key={index} className="ec-tip is-text">{item.label}</span>)}
        </span>
      </div>}
    </div>}
    {parts.last}
  </article>;
}

/** 評分那一排。 */
function Rates({ view, shown, animating, rate }: { view: CardView; shown: readonly Rating[]; animating: boolean; rate: (rating: Rating) => void }): React.JSX.Element {
  return <div className="ec-rates">
    {shown.map(rating => <button key={rating} type="button" className="ec-rate" data-k={rating} disabled={animating || (view.viewing !== null && !view.allowed.includes(rating) && view.pressed !== rating)} aria-pressed={view.pressed === rating} onClick={() => { rate(rating); }}>{RATING_LABELS[rating]}</button>)}
  </div>;
}

function FlipBody(props: BodyProps): React.JSX.Element {
  const { view, app, speech, onFail } = props;
  const { card, revealed } = view;
  const prompt = card.prompt;
  const answer = prompt.kind === 'qa' ? prompt.answer : null;
  return <QaCard props={props} parts={{
    mode: prompt.kind === 'cloze' ? 'cloze' : 'plain', revealedQuestion: revealed, lines: 0, words: [], spoken: questionOf(prompt), copying: false, middle: null, last: null,
    head: answer !== null && <div className="ec-a"><Markdown app={app} text={answer} sourcePath={card.deck} revealed tail={<Speaker texts={speakWith(view)(answer)} say={sayWith(speech)} />} onFail={(error, path) => { onFail('back', error, path); }} /></div>,
  }} />;
}

const flip: Screen = {
  Body: FlipBody,
  bottom: ({ view, animating, reveal, rate }) => !view.viewing && !view.revealed
    ? <button type="button" className="ec-show" disabled={animating} onClick={reveal}>顯示答案</button>
    : <Rates view={view} shown={view.viewing ? RATINGS : view.allowed} animating={animating} rate={rate} />,
  tap(view, { reveal }) { if (!view.revealed) reveal(); },
  stage: () => '',
};

/** 三步還沒走完（不是回看）；打字中沒有底部那一排。 */
const typingOf = (view: CardView): TypedView | null => view.typed && !view.typed.finished && !view.viewing ? view.typed : null;

/**
 * 打字中的「沒印象」與「確認」（D-145，iPhone 回饋）：放在題目正下方，不放在畫面最底下。照打錯過一次之後「沒印象」的位置是「跳過」（D-158）。
 * iPhone 的 Obsidian 開鍵盤時不縮畫面（W6 的 J7），最底下那一排會被鍵盤蓋住。
 */
function TypedActions({ typed, animating, submit, skip }: { typed: TypedView; animating: boolean; submit: () => void; skip: () => void }): React.JSX.Element {
  return <div className="ec-typed-actions">
    {typed.canSkip && <button type="button" className="ec-show ec-skip" disabled={animating} onClick={skip}>{typed.skipLabel ?? (typed.step === 3 ? '跳過' : RATING_LABELS.miss)}</button>}
    <button type="button" className="ec-show ec-confirm" disabled={animating || !typed.input.trim()} onClick={submit}>確認</button>
  </div>;
}

function TypedBody(props: BodyProps): React.JSX.Element {
  const { view, speech, inputRef, onInput, slot, animating, submit, skip } = props;
  const { card, revealed } = view;
  const typed = view.typed;
  if (!typed) throw Error('打字卡沒有打字的狀態');
  const prompt = card.prompt;
  const question = questionOf(prompt);
  const say = sayWith(speech);
  const speak = speakWith(view);
  const answers = prompt.kind === 'qa' ? prompt.typed : null;
  const lines = blankCount(question, answers);
  // 三步還沒走完（不是回看）：題目有 ＿＿ 時在空格裡打（D-145），渲染後找不到空格才放在題目下面。
  const typing = typingOf(view);
  const inline = typing !== null && lines > 0 && slot !== null;
  // 拼錯：和拼對的打勾成對，用圓形的打叉（D-145，使用者 2026-10-28），不寫「不對」兩個字；讀螢幕的軟體念「錯誤」（使用者 2026-10-28）。
  // 不經提示直接照打的卡也一樣（D-174）。
  // 照打：「照著打一次」後面接即時比對，打了字就顯示現在打的字（打對的照常顯示、打錯的字母畫刪除線，D-145，使用者 2026-10-28）；
  // 放在同一行，打字時不多冒出一行把下面往鍵盤後推。
  const live = typing?.step === 3 && typing.live?.typed.length ? typing.live : null;
  const wrong = typing?.notice && <span className="ec-ok is-no" role="img" aria-label="錯誤"><Icon type="close" /></span>;
  const stepText = typing?.step === 2 ? <div className="ec-hint">{wrong}<span>提示：<span lang="en">{typing.hint}</span></span></div>
    : typing?.step === 3 ? <div className="ec-hint">{wrong}<span>照著打一次</span>{live && <span className="ec-live"><Letters letters={live.typed} mode="typed" /></span>}</div> : null;
  const input = typing && <input ref={inputRef} className={'ec-input' + (inline ? ' ec-blank-input' : '')} type="text" lang="en" value={typing.input} onChange={event => { onInput(event.currentTarget.value); }}
    placeholder={inline ? ' ' : typing.step === 3 ? '照著打一次' : '輸入英文'} aria-label={typing.step === 3 ? '照著打一次' : '輸入英文'} size={inline ? 1 : undefined}
    autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" />;
  // 拼對（第 1 步，或目前這張的第 2 步，Codex L2 F7）：打勾加答案。回看時照第 1 步（§2-5），第 1 步拼錯的顯示當時的比對。
  const right = typed.first === 'right' || (!view.viewing && typed.second === 'right') || (view.viewing && !typed.attempt);
  const shown = !right && typed.attempt ? spelled(typed.attempt.expected) : typed.answer;
  const others = answers ? otherAnswers(answers, shown) : [];
  const copying = typing?.step === 3;
  const actions = typing && <TypedActions typed={typing} animating={animating} submit={submit} skip={skip} />;
  return <QaCard props={props} parts={{
    mode: 'typed', revealedQuestion: revealed && !inline, lines, words: revealed ? typed.answer.split(/\s+/) : [], spoken: revealed ? fillBlank(question, typed.answer) ?? question : question, copying,
    middle: <>
      {/* 輸入框和撐開空格寬度的隱形文字一起放進空格（同一格疊在線上，見 Review.css 的 .ec-slot） */}
      {inline && slot && typing && createPortal(<><span className="ec-mirror" aria-hidden="true">{typing.input}</span>{input}</>, slot)}
      {stepText}
      {!inline && input && <div className="ec-inrow">{input}</div>}
      {!copying && actions}
    </>,
    head: <>
      {right
        ? <div className="ec-spell"><div className="ec-spell-row"><span className="ec-ok"><Icon type="check" /></span><span className="ec-word" lang="en">{typed.answer}</span><Speaker texts={speak(typed.answer)} say={say} /></div></div>
        : typed.attempt && <div className="ec-spell">
          {/* 沒打字直接按「沒印象」：不畫「你拼的」那一行（D-145，iPhone 回饋）；「你拼的」是進入照打前拼錯的那一次 */}
          {typed.attempt.typed.length > 0 && <div className="ec-spell-row"><span className="ec-lab">你拼的</span><Letters letters={typed.attempt.typed} mode="typed" /></div>}
          <div className="ec-spell-row"><span className="ec-lab">正確拼字</span><Letters letters={typed.attempt.expected} mode="expected" /><Speaker texts={speak(shown)} say={say} /></div>
        </div>}
      {/* 其他正確答案（D-145）：一個時和「也可以：」同一行，兩個以上每個一行。打字卡的答案已經寫在線上與上面那一行，不再畫答案格（D-145） */}
      {others.length > 0 && <div className="ec-also">
        {others.length === 1
          ? <div className="ec-also-row"><span lang="zh-Hant">也可以：</span><span className="ec-also-word" lang="en">{others[0]}</span><Speaker texts={speak(others[0])} say={say} /></div>
          : <><div className="ec-also-row" lang="zh-Hant">也可以：</div>{others.map(other => <div key={other} className="ec-also-row"><span className="ec-also-word" lang="en">{other}</span><Speaker texts={speak(other)} say={say} /></div>)}</>}
      </div>}
    </>,
    // 照打時「確認」排在最後（鍵盤的 ✓ 也是確認），正確拼字、也可以、記憶錨點往上排，不被鍵盤蓋住（D-145，iPhone 回饋）
    last: copying && actions,
  }} />;
}

const typedScreen: Screen = {
  Body: TypedBody,
  bottom({ view, animating, rate }) {
    // 打字中沒有底部那一排：「沒印象」「確認」在題目正下方（TypedActions）。
    if (typingOf(view)) return null;
    const shown = view.viewing && view.allowed.length === 0 ? [view.pressed].filter((r): r is Rating => r !== null) : view.allowed;
    return <Rates view={view} shown={shown} animating={animating} rate={rate} />;
  },
  // 點卡片任何地方都叫出鍵盤（D-145：輸入框在空格裡，點得到的範圍比原本那一整行小）。
  tap(view, { focusInput }) { if (view.typed && !view.typed.finished) focusInput(); },
  stage: view => typingOf(view) ? ' is-typing' : '',
};

export const SCREENS: Record<QuestionType, Screen> = { flip, typed: typedScreen };
