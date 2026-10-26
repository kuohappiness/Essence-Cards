import type { App } from 'obsidian';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { animate } from 'motion';
import type { Rating } from '../core/study/index.ts';
import { blankCount, englishParts, fillBlank, gesture, lockAxis, RATING_LABELS, RATINGS, sourceLinks } from '../review/index.ts';
import type { Axis, CardView, DoneView, Gesture, Session, Spelling } from '../review/index.ts';
import { Markdown } from './Markdown.tsx';
import { firstMaterial, resolveSource } from './sources.ts';
import type { Speech } from './speech.ts';

// 複習畫面（W6 §3）：React＋Motion，只把 review 的狀態畫出來、把按鍵與手勢轉成動作，不自己做判斷。

/** 畫面的量測與手勢結果（開發版的自動量測訂閱；正式版沒有人聽）。 */
export type ReviewEvent =
  | { kind: 'opened'; ms: number }
  | { kind: 'next'; ms: number }
  | { kind: 'gesture'; outcome: Gesture; axis: Axis; dx: number; dy: number; ms: number; sidebarOpened: boolean }
  | { kind: 'render-failed'; lt: string; side: 'front' | 'back' }
  | { kind: 'closed' };

export interface ReviewProps {
  app: App;
  session: Session;
  close: () => void;
  /** 打開出處：關掉複習畫面，在新分頁打開那個位置（D-109）。 */
  openLink: (linktext: string, sourcePath: string) => void;
  /** 這篇卡組的「材料」（出處要在哪幾份裡找）。 */
  materials: (deckPath: string) => readonly string[];
  speech: Speech;
  autoRead: { get(): boolean; set(on: boolean): void };
  onEvent?: (event: ReviewEvent) => void;
  /** 命令按下的時間（performance.now）：第一張卡畫好時量「從命令到畫好」。 */
  openedAt: number;
}

function Icon({ type }: { type: 'book' | 'speaker' | 'check' | 'back' | 'close' | 'forward' }): React.JSX.Element {
  const paths: Record<typeof type, React.JSX.Element> = {
    book: <path d="M12 5v15M12 5C8 2 3 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Z" />,
    speaker: <path d="m11 4-6 5H2v6h3l6 5ZM15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14" />,
    check: <path d="m4 12 5 5L20 6" />,
    back: <path d="m15 5-7 7 7 7" />,
    forward: <path d="m9 5 7 7-7 7" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}

const offsetX = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41;
const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sidebars = (app: App): boolean | null => app.workspace.leftSplit?.collapsed ?? null;
const nextFrame = (): Promise<void> => new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });

/** 字母的比對：拼錯的畫刪除線（你打的）或紫色（正確拼字）。 */
function Letters({ letters, mode }: { letters: Spelling['typed']; mode: 'typed' | 'expected' }): React.JSX.Element {
  if (!letters.length) return <span className="ec-letters">—</span>;
  return <span className="ec-letters" lang="en">{letters.map((letter, index) => letter.bad
    ? (mode === 'typed' ? <s key={index}>{letter.char}</s> : <mark className="ec-mark" key={index}>{letter.char}</mark>)
    : <span key={index}>{letter.char}</span>)}</span>;
}

function Speakers({ texts, say }: { texts: readonly string[]; say: (text: string) => void }): React.JSX.Element | null {
  if (!texts.length) return null;
  return <span className="ec-speakers">{texts.map((text, index) => <button key={index} type="button" className="ec-ico ec-say" aria-label={'朗讀 ' + text} onClick={() => { say(text); }}><Icon type="speaker" /></button>)}</span>;
}

export function Review(props: ReviewProps): React.JSX.Element {
  const { app, session, speech } = props;
  const view = useSyncExternalStore(listener => session.subscribe(listener), () => session.view(), () => session.view());
  const [autoOn, setAutoOn] = useState(() => props.autoRead.get());
  const [tipOpen, setTipOpen] = useState(false);
  const [animating, setAnimating] = useState(false);
  const appEl = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const inputEl = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const suppressClick = useRef(0);
  const latest = useRef(view);
  latest.current = view;
  const spoken = useRef<readonly string[] | null>(null);
  const opened = useRef(false);
  const pendingNext = useRef<number | null>(null);

  const cardKey = view.kind === 'card' ? view.card.card.lt + ':' + view.card.card.prompt.fingerprint + ':' + String(view.card.viewing?.index ?? -1) : view.kind;
  const focusApp = (): void => { appEl.current?.focus({ preventScroll: true }); };

  useEffect(() => () => { alive.current = false; }, []);
  // 焦點留在畫面裡（W6 §3-2）：按鍵由 .ec-app 處理，所以打開時、輸入框或按鈕消失時（打字卡答完、換卡、
  // 完成畫面的按鈕），焦點回到 .ec-app；不然焦點掉到 body，Space、1～4、Esc 都沒有作用（2026-10-26 在 Obsidian 實測）。
  useEffect(() => {
    const root = appEl.current;
    if (root && !root.contains(document.activeElement)) focusApp();
  });
  // 換卡、回看：捲回最上面，收起出處提示。
  useEffect(() => { if (stage.current) stage.current.scrollTop = 0; setTipOpen(false); }, [cardKey]);
  // 自動朗讀（D-116）：同一個時刻只念一次；換卡、回看、關掉開關都立刻停。
  useEffect(() => {
    if (view.kind !== 'card' || view.card.viewing) { speech.stop(); spoken.current = null; return; }
    const texts = view.card.autoRead;
    if (!texts || texts === spoken.current) return;
    spoken.current = texts;
    if (autoOn) speech.say(texts);
  }, [view, autoOn, speech]);
  useEffect(() => { if (!autoOn) speech.stop(); }, [autoOn, speech]);
  useEffect(() => { speech.stop(); }, [cardKey, speech]);
  // 打字卡：輸入框自動取得焦點。
  useEffect(() => {
    if (view.kind === 'card' && view.card.typed && !view.card.typed.finished && !view.card.viewing) inputEl.current?.focus({ preventScroll: true });
  }, [cardKey, view]);

  async function slide(direction: number, change: () => void): Promise<void> {
    if (busy.current) return;
    const el = body.current;
    if (!el || reducedMotion()) { change(); return; }
    busy.current = true; setAnimating(true);
    try {
      // 從手指放開的位置接著滑出，不先跳回原位（試作外掛的做法）。
      const from = offsetX(el);
      await animate(el, { opacity: [1, 0], x: [from, direction ? from + direction * 70 : from] }, { duration: 0.11 });
      if (!alive.current) return;
      change();
      await nextFrame();
      if (!alive.current) return;
      await animate(el, { opacity: [0, 1], x: [direction ? -direction * 35 : 0, 0] }, { duration: 0.16 });
    } finally { busy.current = false; if (alive.current) setAnimating(false); }
  }

  const reveal = (): void => { session.reveal(); focusApp(); };
  const rate = (rating: Rating): void => {
    const current = latest.current;
    if (current.kind !== 'card' || !current.card.allowed.includes(rating)) return;
    if (current.card.viewing) { session.rate(rating); return; }
    if (busy.current) return;
    // 先確定這一次自評算數（0.3 秒的規則在 review 裡），再換卡：寫紀錄在背景（D-074）。
    pendingNext.current = performance.now();
    const accepted = session.rate(rating);
    if (!accepted) { pendingNext.current = null; return; }
    // 已經換成下一張；滑出用舊畫面不可能了，所以只做滑入。
    const el = body.current;
    if (el && !reducedMotion()) void animate(el, { opacity: [0, 1], x: [-35, 0] }, { duration: 0.16 });
    focusApp();
  };
  const back = (): void => { if (latest.current.top.canBack) void slide(1, () => { session.back(); }); };
  const forward = (): void => { if (latest.current.top.viewing) void slide(-1, () => { session.forward(); }); };
  const toCurrent = (): void => { if (latest.current.top.viewing) void slide(-1, () => { session.toCurrent(); }); };

  // 手勢（D-084、D-109）：移植試作外掛；輸入框、按鈕上開始的觸控不算滑動。
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let touch: { id: number; x: number; y: number; dx: number; dy: number; time: number; axis: Axis; before: boolean | null; interactive: boolean } | null = null;
    const start = (event: TouchEvent): void => {
      if (event.touches.length !== 1) { if (touch) touch.axis = 'vertical'; return; }
      const p = event.touches[0];
      touch = { id: p.identifier, x: p.clientX, y: p.clientY, dx: 0, dy: 0, time: performance.now(), axis: 'pending', before: sidebars(app), interactive: !!(event.target as HTMLElement).closest('input,button,a,audio') };
    };
    const move = (event: TouchEvent): void => {
      if (!touch) return;
      const p = Array.from(event.touches).find(point => point.identifier === touch?.id);
      if (!p) return;
      touch.dx = p.clientX - touch.x; touch.dy = p.clientY - touch.y;
      touch.axis = touch.interactive ? 'vertical' : lockAxis(touch.axis, touch.dx, touch.dy);
      if (touch.axis === 'horizontal') {
        if (event.cancelable) event.preventDefault();
        const { canBack, viewing } = latest.current.top;
        const resist = (touch.dx > 0 && !canBack) || (touch.dx < 0 && !viewing);
        if (body.current && !reducedMotion()) body.current.style.transform = 'translateX(' + String(resist ? touch.dx * 0.18 : touch.dx) + 'px)';
      }
    };
    const finish = (event: TouchEvent): void => {
      if (!touch) return;
      const t = touch; touch = null;
      const p = Array.from(event.changedTouches).find(point => point.identifier === t.id);
      if (p) { t.dx = p.clientX - t.x; t.dy = p.clientY - t.y; }
      const ms = performance.now() - t.time;
      const { canBack, viewing } = latest.current.top;
      const outcome: Gesture = event.type === 'touchcancel' ? (t.axis === 'vertical' ? 'scroll' : 'bounce') : gesture(t.axis, t.dx, t.dy, ms, canBack, viewing);
      if (outcome !== 'tap') suppressClick.current = performance.now() + 450;
      if (outcome === 'back') back();
      else if (outcome === 'forward') forward();
      else if (body.current && t.axis === 'horizontal') {
        if (reducedMotion()) body.current.style.transform = '';
        else void animate(body.current, { x: [offsetX(body.current), 0] }, { type: 'spring', stiffness: 360, damping: 30 });
      }
      window.setTimeout(() => {
        const after = sidebars(app);
        props.onEvent?.({ kind: 'gesture', outcome, axis: t.axis, dx: t.dx, dy: t.dy, ms, sidebarOpened: t.before === true && after === false });
      }, 500);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', finish);
    el.addEventListener('touchcancel', finish);
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', finish); el.removeEventListener('touchcancel', finish); };
  }, [app, props]);

  // 鍵盤（W6 §3-5）：← 上一張、→ 往後一張、Esc 結束、Space／Enter 顯示答案、1～4 自評；輸入框裡只有 Enter；中文組字中不算。
  const onKey = (event: React.KeyboardEvent): void => {
    if (event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.matches('input')) {
      if (event.key === 'Enter') { event.preventDefault(); session.submit(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); props.close(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); back(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); forward(); }
    else if (/^[1-4]$/.test(event.key)) { event.preventDefault(); rate(RATINGS[Number(event.key) - 1]); }
    else if ((event.key === ' ' || event.key === 'Enter') && !target.closest('button')) { event.preventDefault(); reveal(); }
  };

  /** 第一張卡畫好、自評後下一張畫好：量測（§4）。 */
  const painted = (): void => {
    void nextFrame().then(() => {
      if (!alive.current) return;
      if (!opened.current) { opened.current = true; props.onEvent?.({ kind: 'opened', ms: performance.now() - props.openedAt }); }
      if (pendingNext.current !== null) { props.onEvent?.({ kind: 'next', ms: performance.now() - pendingNext.current }); pendingNext.current = null; }
    });
  };
  // 完成畫面沒有 Markdown 的 onReady：打開就是完成畫面、或自評後換成完成畫面時在這裡量。
  useLayoutEffect(() => { if (view.kind === 'done' && (!opened.current || pendingNext.current !== null)) painted(); });

  const top = view.top;
  const english = view.kind === 'card' && view.card.english;
  return <div className="ec-app" ref={appEl} tabIndex={-1} onKeyDown={onKey}>
    <div className="ec-top">
      <button type="button" className="ec-ico" aria-label="上一張" disabled={!top.canBack || animating} onClick={back}><Icon type="back" /></button>
      {top.viewing
        ? <button type="button" className="ec-return" disabled={animating} onClick={toCurrent}>回到目前 <Icon type="forward" /></button>
        : <span className="ec-count" aria-live="polite">{view.kind === 'done' ? '' : top.center}</span>}
      {english && <label className="ec-auto"><span>自動朗讀</span><input type="checkbox" role="switch" checked={autoOn} onChange={event => { const on = event.currentTarget.checked; setAutoOn(on); props.autoRead.set(on); }} /><i aria-hidden="true" /></label>}
      <button type="button" className="ec-ico" aria-label="結束複習" onClick={props.close}><Icon type="close" /></button>
    </div>
    <div className="ec-prog" aria-hidden="true"><i style={{ width: String((top.fraction ?? 0) * 100) + '%', visibility: top.fraction === null ? 'hidden' : 'visible' }} /></div>
    <div className="ec-stage" ref={stage} onClick={event => {
      if (view.kind !== 'card' || view.card.typed || view.card.revealed || view.card.viewing) return;
      if (performance.now() < suppressClick.current || (event.target as HTMLElement).closest('button,input,a,audio')) return;
      reveal();
    }}>
      <div className="ec-body" ref={body}>
        {view.kind === 'loading' && <p className="ec-loading">正在讀取卡組…</p>}
        {view.kind === 'done' && <Done done={view.done} session={session} close={props.close} />}
        {view.kind === 'card' && <Card key={cardKey} view={view.card} app={app} session={session} speech={speech} materials={props.materials} openLink={props.openLink} tipOpen={tipOpen} setTipOpen={setTipOpen} inputRef={inputEl} onPainted={painted} onFail={side => { props.onEvent?.({ kind: 'render-failed', lt: view.card.card.lt, side }); }} />}
      </div>
    </div>
    <div className="ec-actions">
      {view.kind === 'done' && <button type="button" className="ec-show" onClick={props.close}>結束複習</button>}
      {view.kind === 'card' && <Actions view={view.card} animating={animating} reveal={reveal} rate={rate} session={session} />}
    </div>
  </div>;
}

function Actions({ view, animating, reveal, rate, session }: { view: CardView; animating: boolean; reveal: () => void; rate: (r: Rating) => void; session: Session }): React.JSX.Element {
  const typed = view.typed;
  if (!view.viewing && typed && !typed.finished) {
    return <div className="ec-typed-actions">
      {typed.canSkip && <button type="button" className="ec-show ec-skip" onClick={() => { session.skip(); }}>{RATING_LABELS.miss}</button>}
      <button type="button" className="ec-show ec-confirm" disabled={!typed.input.trim()} onClick={() => { session.submit(); }}>確認</button>
    </div>;
  }
  if (!view.viewing && !view.revealed) return <button type="button" className="ec-show" disabled={animating} onClick={reveal}>顯示答案</button>;
  const shown = view.viewing ? (view.typed && view.allowed.length === 0 ? [view.pressed].filter((r): r is Rating => r !== null) : (view.typed ? view.allowed : RATINGS)) : view.allowed;
  return <div className="ec-rates">
    {shown.map(rating => <button key={rating} type="button" className="ec-rate" data-k={rating} disabled={animating || (view.viewing !== null && !view.allowed.includes(rating) && view.pressed !== rating)} aria-pressed={view.pressed === rating} onClick={() => { rate(rating); }}>{RATING_LABELS[rating]}</button>)}
  </div>;
}

function Done({ done, session, close }: { done: DoneView; session: Session; close: () => void }): React.JSX.Element {
  const primary = done.buttons.find(button => button.kind !== 'close');
  return <div className="ec-done">
    <div className="ec-done-mark"><Icon type="check" /></div>
    <h2>{done.title}</h2>
    <p className="ec-done-sub">{done.detail}</p>
    {primary?.pick && <button type="button" className="ec-start" onClick={() => { session.continueWith(primary.pick ?? { more: true }); }}>{primary.label}</button>}
    {!primary && <span className="ec-done-hint" onClick={close} />}
  </div>;
}

interface CardProps {
  view: CardView; app: App; session: Session; speech: Speech;
  materials: (deckPath: string) => readonly string[];
  openLink: (linktext: string, sourcePath: string) => void;
  tipOpen: boolean; setTipOpen: (open: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPainted: () => void;
  onFail: (side: 'front' | 'back') => void;
}
function Card({ view, app, session, speech, materials, openLink, tipOpen, setTipOpen, inputRef, onPainted, onFail }: CardProps): React.JSX.Element {
  const { card, typed, revealed } = view;
  const prompt = card.prompt;
  const question = prompt.kind === 'qa' ? prompt.question : prompt.text;
  const answer = prompt.kind === 'qa' ? prompt.answer : null;
  const extras = [...prompt.extras, ...card.target.shared];
  const say = (text: string): void => { speech.say([text]); };
  const spokenQuestion = typed && revealed ? fillBlank(question, typed.answer) ?? question : question;
  const questionParts = view.speakable ? englishParts(spokenQuestion) : [];
  const sources = sourceLinks(card.target.fields.sources);
  const deckMaterials = materials(card.deck);
  const links = sources.map(item => ({ ...item, target: resolveSource(app, card.deck, deckMaterials, item.link) }));
  const fallback = sources.length ? null : firstMaterial(app, card.deck, deckMaterials);
  const hasSource = links.some(item => item.target) || fallback !== null || links.length > 0;
  const stepText = typed && !typed.finished && typed.step === 2 ? <div className="ec-hint">{typed.notice && <span className="ec-wrong">不對</span>}<span>提示：<span lang="en">{typed.hint}</span></span></div> : null;
  return <article className={'ec-card' + (view.english ? ' is-english' : '')} lang={view.english ? 'en' : 'zh-Hant'}>
    <div className="ec-meta">{card.isNew && <span className="ec-new">新</span>}<span lang="zh-Hant">{view.crumb}</span></div>
    <div className="ec-q">
      <Markdown app={app} text={question} sourcePath={card.deck} mode={prompt.kind === 'cloze' ? 'cloze' : typed ? 'typed' : 'plain'} revealed={revealed}
        lines={typed ? blankCount(question, prompt.kind === 'qa' ? prompt.typed : null) : 0} words={typed && revealed ? typed.answer.split(/\s+/) : []}
        onReady={onPainted} onFail={() => { onFail('front'); }} />
      <Speakers texts={questionParts} say={say} />
    </div>
    {stepText}
    {typed && !typed.finished && !view.viewing && <div className="ec-inrow">
      <input ref={inputRef} className="ec-input" type="text" lang="en" value={typed.input} onChange={event => { session.input(event.currentTarget.value); }}
        placeholder={typed.step === 3 ? '照著打一次' : '輸入英文'} aria-label={typed.step === 3 ? '照著打一次' : '輸入英文'}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" />
    </div>}
    {typed && typed.step === 3 && !typed.finished && typed.live && <div className="ec-live"><Letters letters={typed.live.typed} mode="typed" /></div>}
    {revealed && <div className="ec-answer">
      {typed && (typed.first === 'right' || (view.viewing && !typed.attempt)
        ? <div className="ec-spell"><div className="ec-spell-row"><span className="ec-ok"><Icon type="check" /></span><span className="ec-word" lang="en">{typed.answer}</span></div></div>
        : typed.attempt && <div className="ec-spell">
          <div className="ec-spell-row"><span className="ec-lab">你打的</span><Letters letters={typed.attempt.typed} mode="typed" /></div>
          <div className="ec-spell-row"><span className="ec-lab">正確拼字</span><Letters letters={typed.attempt.expected} mode="expected" /></div>
        </div>)}
      {answer !== null && <div className="ec-a"><Markdown app={app} text={answer} sourcePath={card.deck} revealed onFail={() => { onFail('back'); }} /><Speakers texts={view.speakable ? englishParts(answer) : []} say={say} /></div>}
      {extras.length > 0 && <div className="ec-ex">{extras.map((extra, index) => <div key={index} className="ec-ex-item"><Markdown app={app} text={extra} sourcePath={card.deck} revealed /><Speakers texts={view.speakable ? englishParts(extra) : []} say={say} /></div>)}</div>}
      {hasSource && <div className="ec-tools">
        <span className={'ec-srcw' + (tipOpen ? ' is-tip' : '')}>
          <button type="button" className="ec-ico sm" aria-label="出處" onClick={() => { setTipOpen(!tipOpen); }}><Icon type="book" /></button>
          {tipOpen && (links.length ? links : [{ text: '出處', link: { kind: 'text' as const }, target: fallback }]).map((item, index) => item.target
            ? <button key={index} type="button" className="ec-tip" onClick={() => { openLink(item.target ?? '', card.deck); }}>{item.text} ↗</button>
            : <span key={index} className="ec-tip is-text">{item.text}</span>)}
        </span>
      </div>}
    </div>}
  </article>;
}

