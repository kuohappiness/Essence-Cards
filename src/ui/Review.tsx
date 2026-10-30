import type { App } from 'obsidian';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { animate } from 'motion';
import type { ReportKind } from '../core/errors/index.ts';
import type { Rating } from '../core/study/index.ts';
import { blankCount, extraLabel, fillBlank, gesture, lineSpeech, lockAxis, otherAnswers, RATING_LABELS, RATINGS, sourceLinks } from '../review/index.ts';
import type { Axis, CardView, DoneView, Gesture, Session, Spelling, TypedView } from '../review/index.ts';
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
  | { kind: 'away'; ms: number; restarted: boolean }
  | { kind: 'keyboard'; innerHeight: number; height: number; offsetTop: number; adjusted: boolean; input: boolean | null; actions: boolean | null }
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
  /** 卡片顯示不出來（D-155 的 render）：錯誤與卡組的路徑交給主機記下。 */
  onRenderError?: (error: unknown, path: string) => void;
  /**
   * 學生在旗子的選單選了一項（D-160）：畫面上那張卡（回看時是回看的那張）的卡組、學習目標 ID 與題目指紋。
   * 沒傳就沒有旗子。畫面不拿 Files：由主機記進錯誤紀錄、出提示。
   */
  onReport?: (kind: ReportKind, card: { deck: string; lt: string; v: string }) => void;
  /** 回報的選單打開、關上：開著時主機不做「離開超過 60 秒回來從頭開始」（D-160 第 3 點）。 */
  onMenu?: (open: boolean) => void;
  /** 選了科目的時間（performance.now）：第一張卡畫好時量「從選了科目到畫好」，不含選單與 state 載入（L2 自選第 22 點）。 */
  pickedAt: number;
}

function Icon({ type }: { type: 'book' | 'speaker' | 'check' | 'back' | 'close' | 'forward' | 'flag' }): React.JSX.Element {
  const paths: Record<typeof type, React.JSX.Element> = {
    flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
    book: <path d="M12 5v15M12 5C8 2 3 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Z" />,
    speaker: <path d="m11 4-6 5H2v6h3l6 5ZM15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14" />,
    check: <path d="m4 12 5 5L20 6" />,
    back: <path d="m15 5-7 7 7 7" />,
    forward: <path d="m9 5 7 7-7 7" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}

/** 回報的選項（D-160 第 1 點的文字）；沒有文字輸入。 */
const REPORT_ITEMS: readonly (readonly [ReportKind, string])[] = [
  ['content', '這張卡的內容有錯（題目或答案不對）'],
  ['display', '卡片顯示不完整或空白'],
  ['stuck', '按了沒反應、卡住'],
  ['audio', '聲音不對或沒有聲音'],
  ['other', '其他（可以另外截圖給家長）'],
];

const offsetX = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41;
const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sidebars = (app: App): boolean | null => app.workspace.leftSplit?.collapsed ?? null;
const nextFrame = (): Promise<void> => new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });

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
  // 打字卡題目裡的空格（D-145）：題目渲染好後由 Markdown 交回；換了一張就不算（undefined 是還沒渲染好，null 是題目沒有 ＿＿）。
  const [slot, setSlot] = useState<{ key: string; el: HTMLElement | null } | null>(null);
  // 題目固定在上方、只捲答案（D-145，iPhone 回饋）；題目比畫面的三分之一高（例如有圖）時不固定，免得答案只剩一小塊。
  const questionEl = useRef<HTMLDivElement>(null);
  const [stickyQuestion, setStickyQuestion] = useState(false);
  // 回報的選單（D-160）：開著時按鍵、滑動、點卡片與自動換卡都不作用（ref 給事件處理讀，state 給畫面）。
  const [reporting, setReporting] = useState(false);
  const reportingRef = useRef(false);
  reportingRef.current = reporting;
  const menuEl = useRef<HTMLDivElement>(null);

  // 換卡、回看、切走超過 60 秒回來從頭開始（shown 加一，L2 的 F4）都算換了一張。
  const cardKey = view.kind === 'card' ? [view.card.card.lt, view.card.card.prompt.fingerprint, view.card.viewing?.index ?? -1, view.card.shown].join(':') : view.kind;
  const cardSlot = slot?.key === cardKey ? slot.el : undefined;
  const onSlot = (el: HTMLElement | null): void => { setSlot(old => old?.key === cardKey && old.el === el ? old : { key: cardKey, el }); };
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
  // 題目的高度（圖片載入、換行）或畫面大小變了就重新判斷要不要固定。
  useEffect(() => {
    const question = questionEl.current, area = stage.current;
    if (!question || !area || typeof ResizeObserver !== 'function') return;
    const check = (): void => { setStickyQuestion(question.offsetHeight <= area.clientHeight / 3); };
    const observer = new ResizeObserver(check);
    observer.observe(question);
    observer.observe(area);
    return () => { observer.disconnect(); };
  }, [cardKey]);
  // 自動朗讀（D-116）：同一個時刻只念一次；換卡、回看、關掉開關都立刻停。換卡的停止要排在念新題目之前（effect 照宣告順序跑），
  // 不然英翻中的題目剛念就被停掉（Codex L2 F3）。
  useEffect(() => { speech.stop(); }, [cardKey, speech]);
  useEffect(() => {
    if (view.kind !== 'card' || view.card.viewing) { speech.stop(); spoken.current = null; return; }
    const texts = view.card.autoRead;
    if (!texts || texts === spoken.current) return;
    spoken.current = texts;
    if (autoOn) speech.say(texts);
  }, [view, autoOn, speech]);
  useEffect(() => { if (!autoOn) speech.stop(); }, [autoOn, speech]);
  // 只剩一個自評時（打字卡第 1 步按了「沒印象」），三步走完就自動記下、換下一張（D-145，iPhone 回饋）。
  // 正在念答案與例句時等念完（答錯後的回饋，D-116）；語音沒回報念完時，底下那一顆「沒印象」照樣能按。
  // 每次畫面更新都重新等（同一題重出、回看後回來、切走再回來都會再自動，Codex 審查 F2），條件不成立或卸載時取消；
  // 關掉畫面、切到背景時 Speech.stop 取消等待、不算念完，所以中斷不會被記成作答（Codex 審查 F1）。切到背景時不等。
  // 換卡動畫期間不等，動畫結束才等：回到目前那張時沒在念，whenIdle 馬上回報，那時動畫還沒結束（Codex 再查 R1）。
  // 回報的選單開著時也不等（D-160 第 3 點），關上才等。
  useEffect(() => {
    if (reporting || animating || view.kind !== 'card' || view.card.viewing || !view.card.typed?.finished || view.card.allowed.length !== 1) return;
    if (document.visibilityState === 'hidden') return;
    return speech.whenIdle(() => { if (alive.current && !busy.current) commit(() => session.rateOnly()); });
  }, [view, autoOn, animating, reporting, speech, session]);
  // 打字卡：輸入框自動取得焦點（在空格裡打字時，題目渲染好、輸入框放進空格之後；回報的選單關上之後）。
  useEffect(() => {
    if (!reporting && view.kind === 'card' && view.card.typed && !view.card.typed.finished && !view.card.viewing) inputEl.current?.focus({ preventScroll: true });
  }, [cardKey, view, cardSlot, reporting]);
  // 選單打開時焦點移到選單上（鍵盤也點得到）；開、關都告訴主機。
  useEffect(() => {
    if (reporting) menuEl.current?.focus({ preventScroll: true });
    props.onMenu?.(reporting);
  }, [reporting]);

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

  // 換卡動畫期間（busy）的按鍵與點擊不算：回看的改評分、翻面、確認、沒印象都一樣，不然會改到滑走那張或還沒滑進來那張（Codex L2 F1）。
  // 回報的選單開著時也一樣（D-160 第 3 點）。
  const held = (): boolean => busy.current || reportingRef.current;
  const reveal = (): void => { if (held()) return; session.reveal(); focusApp(); };
  const submit = (): void => { if (!held()) session.submit(); };
  const skip = (): void => { if (!held()) session.skip(); };
  const rate = (rating: Rating): void => {
    if (held()) return;
    const current = latest.current;
    if (current.kind !== 'card' || !current.card.allowed.includes(rating)) return;
    if (current.card.viewing) { session.rate(rating); return; }
    commit(() => session.rate(rating));
  };
  /** 記下這一張、換下一張（手按的自評與只剩一個時的自動記下共用）。 */
  function commit(accept: () => boolean): void {
    // 先確定這一次自評算數（0.3 秒的規則在 review 裡），再換卡：寫紀錄在背景（D-074）。
    pendingNext.current = performance.now();
    const accepted = accept();
    if (!accepted) { pendingNext.current = null; return; }
    // 已經換成下一張：評分後只做滑入，回看的換卡才有滑出（§3-4、L2 自選第 10 點）。
    const el = body.current;
    if (el && !reducedMotion()) void animate(el, { opacity: [0, 1], x: [-35, 0] }, { duration: 0.16 });
    focusApp();
  }
  const back = (): void => { if (!reportingRef.current && latest.current.top.canBack) void slide(1, () => { session.back(); }); };
  const forward = (): void => { if (!reportingRef.current && latest.current.top.viewing) void slide(-1, () => { session.forward(); }); };
  const toCurrent = (): void => { if (!reportingRef.current && latest.current.top.viewing) void slide(-1, () => { session.toCurrent(); }); };
  /** 打開回報的選單（動畫期間不開）。 */
  const openMenu = (): void => { if (!busy.current) setReporting(true); };
  const closeMenu = (): void => { setReporting(false); };
  /** 選了一項：交出畫面上那張卡（回看時是回看的那張），關掉選單；卡片的狀態不動（D-160 第 2、3 點）。 */
  const choose = (kind: ReportKind): void => {
    const current = latest.current;
    if (current.kind === 'card') props.onReport?.(kind, { deck: current.card.card.deck, lt: current.card.card.lt, v: current.card.card.prompt.fingerprint });
    closeMenu();
  };

  // 手勢（D-084、D-109）：移植試作外掛；輸入框、按鈕上開始的觸控不算滑動。
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let touch: { id: number; x: number; y: number; dx: number; dy: number; time: number; axis: Axis; before: boolean | null; interactive: boolean } | null = null;
    const start = (event: TouchEvent): void => {
      // 回報的選單開著時不算滑動（選單蓋在上面，這是保險）。
      if (reportingRef.current) { touch = null; return; }
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
  // 回報的選單開著時只有 Esc（關掉選單）；選單的按鈕照瀏覽器的方式用 Enter、空白鍵按。
  const onKey = (event: React.KeyboardEvent): void => {
    if (event.nativeEvent.isComposing) return;
    if (reportingRef.current) {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
      return;
    }
    const target = event.target as HTMLElement;
    if (target.matches('input')) {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
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
      if (!opened.current) { opened.current = true; props.onEvent?.({ kind: 'opened', ms: performance.now() - props.pickedAt }); }
      if (pendingNext.current !== null) { props.onEvent?.({ kind: 'next', ms: performance.now() - pendingNext.current }); pendingNext.current = null; }
    });
  };
  // 完成畫面沒有 Markdown 的 onReady：打開就是完成畫面、或自評後換成完成畫面時在這裡量。
  useLayoutEffect(() => { if (view.kind === 'done' && (!opened.current || pendingNext.current !== null)) painted(); });

  const top = view.top;
  const english = view.kind === 'card' && view.card.english;
  const typing = view.kind === 'card' && view.card.typed && !view.card.typed.finished && !view.card.viewing ? view.card.typed : null;
  return <div className="ec-app" ref={appEl} tabIndex={-1} onKeyDown={onKey}>
    {/* 回報的選單開著時，背後的東西不能取得焦點也不能操作（inert，Codex L2 的 R1）：Tab 只在選單裡走 */}
    <div className="ec-top" inert={reporting}>
      <button type="button" className="ec-ico" aria-label="上一張" disabled={!top.canBack || animating} onClick={back}><Icon type="back" /></button>
      {top.viewing
        ? <button type="button" className="ec-return" disabled={animating} onClick={toCurrent}>回到目前 <Icon type="forward" /></button>
        : <span className="ec-count" aria-live="polite">{view.kind === 'done' ? '' : top.center}</span>}
      {/* 沒有開關時留一格空的，✕ 才會和英文卡一樣貼在右邊 */}
      {english ? <label className="ec-auto"><span>自動朗讀</span><input type="checkbox" role="switch" checked={autoOn} onChange={event => { const on = event.currentTarget.checked; setAutoOn(on); props.autoRead.set(on); }} /><i aria-hidden="true" /></label> : <span aria-hidden="true" />}
      {/* 回報（D-160）：畫面上有卡才有，在 ✕ 左邊；沒有時也留一格空的 */}
      {props.onReport && view.kind === 'card'
        ? <button type="button" className="ec-ico ec-flag" aria-label="回報問題" aria-haspopup="dialog" disabled={animating} onClick={openMenu}><Icon type="flag" /></button>
        : <span aria-hidden="true" />}
      <button type="button" className="ec-ico" aria-label="結束複習" onClick={props.close}><Icon type="close" /></button>
    </div>
    <div className="ec-prog" aria-hidden="true" inert={reporting}><i style={{ width: String((top.fraction ?? 0) * 100) + '%', visibility: top.fraction === null ? 'hidden' : 'visible' }} /></div>
    <div className={'ec-stage' + (typing ? ' is-typing' : '')} ref={stage} inert={reporting} onClick={event => {
      if (reporting || view.kind !== 'card' || view.card.viewing || performance.now() < suppressClick.current || (event.target as HTMLElement).closest('button,input,a,audio')) return;
      // 打字卡：點卡片任何地方都叫出鍵盤（D-145：輸入框在空格裡，點得到的範圍比原本那一整行小）。
      if (view.card.typed) { if (!view.card.typed.finished) inputEl.current?.focus({ preventScroll: true }); return; }
      if (!view.card.revealed) reveal();
    }}>
      <div className="ec-body" ref={body}>
        {view.kind === 'loading' && <p className="ec-loading">正在讀取卡組…</p>}
        {view.kind === 'done' && <Done done={view.done} session={session} close={props.close} />}
        {view.kind === 'card' && <Card key={cardKey} view={view.card} app={app} speech={speech} materials={props.materials} openLink={props.openLink} tipOpen={tipOpen} setTipOpen={setTipOpen} inputRef={inputEl} slot={cardSlot} onSlot={onSlot} onInput={value => { if (!reportingRef.current) session.input(value); }}
          qRef={questionEl} sticky={stickyQuestion} actions={typing && <TypedActions typed={typing} animating={animating} submit={submit} skip={skip} />}
          onPainted={painted} onFail={(side, error, path) => { props.onEvent?.({ kind: 'render-failed', lt: view.card.card.lt, side }); props.onRenderError?.(error, path); }} />}
      </div>
    </div>
    {/* 打字中沒有底部那一排：「沒印象」「確認」在題目正下方（TypedActions） */}
    {!typing && <div className="ec-actions" inert={reporting}>
      {view.kind === 'done' && <button type="button" className="ec-show" onClick={props.close}>結束複習</button>}
      {view.kind === 'card' && <Actions view={view.card} animating={animating} reveal={reveal} rate={rate} />}
    </div>}
    {reporting && view.kind === 'card' && <ReportMenu menuRef={menuEl} choose={choose} cancel={closeMenu} />}
  </div>;
}

/**
 * 回報的選單（D-160 第 1 點）：從下方升起、蓋住整個畫面，五項加「取消」，每一項一整列、一隻手點得到。
 * 點選單外面的暗處也是取消。
 */
function ReportMenu({ menuRef, choose, cancel }: { menuRef: React.RefObject<HTMLDivElement | null>; choose: (kind: ReportKind) => void; cancel: () => void }): React.JSX.Element {
  return <div className="ec-report" onClick={event => { if (event.target === event.currentTarget) cancel(); }}>
    <div className="ec-report-sheet" role="dialog" aria-modal="true" aria-label="回報問題" tabIndex={-1} ref={menuRef}>
      {REPORT_ITEMS.map(([kind, label]) => <button key={kind} type="button" className="ec-report-item" data-kind={kind} onClick={() => { choose(kind); }}>{label}</button>)}
      <button type="button" className="ec-report-item ec-report-cancel" onClick={cancel}>取消</button>
    </div>
  </div>;
}

/**
 * 打字中的「沒印象」與「確認」（D-145，iPhone 回饋）：放在題目正下方，不放在畫面最底下。
 * iPhone 的 Obsidian 開鍵盤時不縮畫面（W6 的 J7），最底下那一排會被鍵盤蓋住。
 */
function TypedActions({ typed, animating, submit, skip }: { typed: TypedView; animating: boolean; submit: () => void; skip: () => void }): React.JSX.Element {
  return <div className="ec-typed-actions">
    {typed.canSkip && <button type="button" className="ec-show ec-skip" disabled={animating} onClick={skip}>{RATING_LABELS.miss}</button>}
    <button type="button" className="ec-show ec-confirm" disabled={animating || !typed.input.trim()} onClick={submit}>確認</button>
  </div>;
}

interface ActionsProps { view: CardView; animating: boolean; reveal: () => void; rate: (r: Rating) => void }
function Actions({ view, animating, reveal, rate }: ActionsProps): React.JSX.Element {
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
  view: CardView; app: App; speech: Speech;
  materials: (deckPath: string) => readonly string[];
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
  /** 打字中的「沒印象」「確認」：排在題目、提示與比對下面。 */
  actions: React.ReactNode;
  onPainted: () => void;
  onFail: (side: 'front' | 'back', error: unknown, path: string) => void;
}
function Card({ view, app, speech, materials, openLink, tipOpen, setTipOpen, inputRef, onInput, slot, onSlot, qRef, sticky, actions, onPainted, onFail }: CardProps): React.JSX.Element {
  const { card, typed, revealed } = view;
  const prompt = card.prompt;
  const question = prompt.kind === 'qa' ? prompt.question : prompt.text;
  const answer = prompt.kind === 'qa' ? prompt.answer : null;
  const extras = [...prompt.extras, ...card.target.shared];
  const say = (texts: readonly string[]): void => { speech.say(texts); };
  const speak = (text: string): string[] => view.speakable ? lineSpeech(text) : [];
  const spokenQuestion = typed && revealed ? fillBlank(question, typed.answer) ?? question : question;
  const lines = typed ? blankCount(question, prompt.kind === 'qa' ? prompt.typed : null) : 0;
  // 三步還沒走完（不是回看）：題目有 ＿＿ 時在空格裡打（D-145），渲染後找不到空格才放在題目下面。
  const typing = typed !== null && !typed.finished && !view.viewing ? typed : null;
  const inline = typing !== null && lines > 0 && slot !== null;
  const sources = sourceLinks(card.target.fields.sources);
  const deckMaterials = materials(card.deck);
  const links = sources.map(item => ({ ...item, target: resolveSource(app, card.deck, deckMaterials, item.link) }));
  const fallback = sources.length ? null : firstMaterial(app, card.deck, deckMaterials);
  const hasSource = links.some(item => item.target) || fallback !== null || links.length > 0;
  // 第 1 步拼錯：和拼對的打勾成對，用圓形的打叉（D-145，使用者 2026-10-28），不寫「不對」兩個字；讀螢幕的軟體念「錯誤」（使用者 2026-10-28）。
  // 照打：「照著打一次」後面接即時比對，打了字就顯示現在打的字（打對的照常顯示、打錯的字母畫刪除線，D-145，使用者 2026-10-28）；
  // 放在同一行，打字時不多冒出一行把下面往鍵盤後推。
  const live = typing?.step === 3 && typing.live?.typed.length ? typing.live : null;
  const stepText = typing?.step === 2 ? <div className="ec-hint">{typing.notice && <span className="ec-ok is-no" role="img" aria-label="錯誤"><Icon type="close" /></span>}<span>提示：<span lang="en">{typing.hint}</span></span></div>
    : typing?.step === 3 ? <div className="ec-hint"><span>照著打一次</span>{live && <span className="ec-live"><Letters letters={live.typed} mode="typed" /></span>}</div> : null;
  const input = typing && <input ref={inputRef} className={'ec-input' + (inline ? ' ec-blank-input' : '')} type="text" lang="en" value={typing.input} onChange={event => { onInput(event.currentTarget.value); }}
    placeholder={inline ? ' ' : typing.step === 3 ? '照著打一次' : '輸入英文'} aria-label={typing.step === 3 ? '照著打一次' : '輸入英文'} size={inline ? 1 : undefined}
    autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" />;
  // 拼對（第 1 步，或目前這張的第 2 步，Codex L2 F7）：打勾加答案。回看時照第 1 步（§2-5），第 1 步拼錯的顯示當時的比對。
  const right = typed !== null && (typed.first === 'right' || (!view.viewing && typed.second === 'right') || (view.viewing && !typed.attempt));
  const shown = typed && !right && typed.attempt ? spelled(typed.attempt.expected) : typed?.answer ?? '';
  const others = typed && prompt.kind === 'qa' && prompt.typed ? otherAnswers(prompt.typed, shown) : [];
  const copying = typing?.step === 3;
  return <article className={'ec-card' + (view.english ? ' is-english' : '') + (copying ? ' is-copying' : '')} lang={view.english ? 'en' : 'zh-Hant'}>
    <div className="ec-meta">{card.isNew && <span className="ec-new">新</span>}<span lang="zh-Hant">{view.crumb}</span></div>
    <div className={'ec-q' + (lines > 0 ? ' has-blank' : '') + (sticky ? ' is-sticky' : '')} ref={qRef}>
      {/* 在空格裡打字時，線上先不寫答案（第 3 步照著下面「正確拼字」那一行打）；三步走完才寫上去 */}
      {/* 喇叭接在最後一個字後面（D-145，iPhone 回饋），不放在第一行右邊 */}
      <Markdown app={app} text={question} sourcePath={card.deck} mode={prompt.kind === 'cloze' ? 'cloze' : typed ? 'typed' : 'plain'} revealed={revealed && !inline}
        lines={lines} words={typed && revealed ? typed.answer.split(/\s+/) : []} onSlot={lines > 0 ? onSlot : undefined}
        english={view.english} tail={<Speaker texts={speak(spokenQuestion)} say={say} />} onReady={onPainted} onFail={(error, path) => { onFail('front', error, path); }} />
    </div>
    {/* 輸入框和撐開空格寬度的隱形文字一起放進空格（同一格疊在線上，見 Review.css 的 .ec-slot） */}
    {inline && slot && typing && createPortal(<><span className="ec-mirror" aria-hidden="true">{typing.input}</span>{input}</>, slot)}
    {stepText}
    {!inline && input && <div className="ec-inrow">{input}</div>}
    {!copying && actions}
    {revealed && <div className="ec-answer">
      {typed && (right
        ? <div className="ec-spell"><div className="ec-spell-row"><span className="ec-ok"><Icon type="check" /></span><span className="ec-word" lang="en">{typed.answer}</span><Speaker texts={speak(typed.answer)} say={say} /></div></div>
        : typed.attempt && <div className="ec-spell">
          {/* 沒打字直接按「沒印象」：不畫「你拼的」那一行（D-145，iPhone 回饋）；「你拼的」是進入照打前拼錯的那一次 */}
          {typed.attempt.typed.length > 0 && <div className="ec-spell-row"><span className="ec-lab">你拼的</span><Letters letters={typed.attempt.typed} mode="typed" /></div>}
          <div className="ec-spell-row"><span className="ec-lab">正確拼字</span><Letters letters={typed.attempt.expected} mode="expected" /><Speaker texts={speak(shown)} say={say} /></div>
        </div>)}
      {/* 其他正確答案（D-145）：一個時和「也可以：」同一行，兩個以上每個一行 */}
      {others.length > 0 && <div className="ec-also">
        {others.length === 1
          ? <div className="ec-also-row"><span lang="zh-Hant">也可以：</span><span className="ec-also-word" lang="en">{others[0]}</span><Speaker texts={speak(others[0])} say={say} /></div>
          : <><div className="ec-also-row" lang="zh-Hant">也可以：</div>{others.map(other => <div key={other} className="ec-also-row"><span className="ec-also-word" lang="en">{other}</span><Speaker texts={speak(other)} say={say} /></div>)}</>}
      </div>}
      {/* 打字卡的答案已經寫在線上與上面那一行，不再畫答案格（D-145） */}
      {answer !== null && !typed && <div className="ec-a"><Markdown app={app} text={answer} sourcePath={card.deck} revealed tail={<Speaker texts={speak(answer)} say={say} />} onFail={(error, path) => { onFail('back', error, path); }} /></div>}
      {/* 背面補充開頭的「記憶錨點：」「例句：」這類名稱自己一行，內容從下一行開始（D-145，iPhone 回饋） */}
      {extras.length > 0 && <div className="ec-ex">{extras.map((extra, index) => {
        const { label, body } = extraLabel(extra);
        return <div key={index} className="ec-ex-item">
          {label && <div className="ec-ex-label" lang="zh-Hant">{label}</div>}
          <div className="ec-ex-row"><Markdown app={app} text={body} sourcePath={card.deck} revealed tail={<Speaker texts={speak(body)} say={say} />} onFail={(error, path) => { onFail('back', error, path); }} /></div>
        </div>;
      })}</div>}
      {hasSource && <div className="ec-tools">
        <span className={'ec-srcw' + (tipOpen ? ' is-tip' : '')}>
          <button type="button" className="ec-ico sm" aria-label="出處" onClick={() => { setTipOpen(!tipOpen); }}><Icon type="book" /></button>
          {tipOpen && (links.length ? links : [{ text: '出處', link: { kind: 'text' as const }, target: fallback }]).map((item, index) => item.target
            ? <button key={index} type="button" className="ec-tip" onClick={() => { openLink(item.target ?? '', card.deck); }}>{item.text} ↗</button>
            : <span key={index} className="ec-tip is-text">{item.text}</span>)}
        </span>
      </div>}
    </div>}
    {/* 照打時「確認」排在最後（鍵盤的 ✓ 也是確認），正確拼字、也可以、記憶錨點往上排，不被鍵盤蓋住（D-145，iPhone 回饋） */}
    {copying && actions}
  </article>;
}

