import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate } from 'motion';
import type { App } from 'obsidian';
import { samples, type Card, SOURCE } from './samples';
import { gesture, lockAxis, ratings, spelling, type Axis, type Rating } from './logic';
import { SessionMetrics, sidebars, delay, viewport } from './metrics';
import { Markdown } from './Markdown';
export interface History { card: Card; rating: Rating; typed: string; recordTime?: string; }
export interface ReviewControl { reveal(): void; rate(rating: Rating): Promise<void>; back(): Promise<void>; forward(): Promise<void>; restart(): void; done(): boolean; }
export interface ReviewProps { app: App; metrics: SessionMetrics; close(): void; control: { current: ReviewControl | null }; onRate?: (entry: History, previous?: string) => string | undefined; notice?: string; }
function Icon({ type }: { type: 'book' | 'speaker' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type === 'book' ? <><path d="M12 5v15M12 5C8 2 3 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Z" /></> : <><path d="m11 4-6 5H2v6h3l6 5ZM15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14" /></>}</svg>;
}
export function Review(props: ReviewProps) {
  const { app, metrics, close, control } = props;
  const [index, setIndex] = useState(0), [view, setView] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false), [typed, setTyped] = useState(''), [history, setHistory] = useState<History[]>([]);
  const [animating, setAnimating] = useState(false), [ratingReady, setRatingReady] = useState(false);
  const [source, setSource] = useState(false), [warning, setWarning] = useState('');
  const stage = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const busy = useRef(false), revealedAt = useRef(0), suppressClick = useRef(0), alive = useRef(true);
  const viewing = view !== null, done = !viewing && index >= samples.length;
  const entry = viewing ? history[view] : undefined, card = entry?.card ?? samples[index];
  const open = viewing || revealed, answer = viewing ? entry!.typed : typed;
  const spell = card?.spell && open ? spelling(answer, card.spell) : null;
  const allowed = spell ? (spell.ok ? ['good', 'easy'] : ['miss', 'near']) : ratings;
  const canBack = history.length > 0 && view !== 0;
  useEffect(() => {
    setRatingReady(false);
    if (!open) return;
    const timer = setTimeout(() => setRatingReady(true), Math.max(0, 300 - (performance.now() - revealedAt.current)));
    return () => clearTimeout(timer);
  }, [open, view]);
  useLayoutEffect(() => { metrics.commitMs = performance.now() - metrics.openedAt; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (stage.current) { stage.current.scrollTop = 0; stage.current.closest<HTMLElement>('.ec-app')?.focus({ preventScroll: true }); } setSource(false); }, [index, view]);
  const runAnimation = async (kind: string, change: () => void, direction = 0) => {
    if (busy.current || !body.current) return;
    busy.current = true; setAnimating(true);
    try {
      const el = body.current;
      await metrics.track(metrics.animation(kind, async () => {
        await animate(el, { opacity: [1, 0], x: direction ? direction * 70 : 0 }, { duration: 0.11 });
        if (!alive.current) return;
        change();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        await animate(el, { opacity: [0, 1], x: [direction ? -direction * 35 : 0, 0] }, { duration: 0.16 });
      }));
    } finally { busy.current = false; if (alive.current) setAnimating(false); }
  };
  const reveal = () => {
    if (open || done || busy.current) return;
    revealedAt.current = performance.now(); setRevealed(true);
    stage.current?.closest<HTMLElement>('.ec-app')?.focus({ preventScroll: true });
    void metrics.track(metrics.animation('翻面', async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const el = body.current?.querySelector<HTMLElement>('.ec-answer');
      if (el) await animate(el, { opacity: [0, 1] }, { duration: 0.18 });
    }));
  };
  const rate = async (rating: Rating) => {
    if (busy.current || !open || !allowed.includes(rating) || performance.now() - revealedAt.current < 300) return;
    if (viewing) {
      if (entry!.rating === rating) return;
      const next = { ...entry!, rating }; next.recordTime = props.onRate?.(next, entry!.recordTime);
      setHistory(history.map((h, i) => i === view ? next : h)); return;
    }
    const next: History = { card, rating, typed }; next.recordTime = props.onRate?.(next);
    await runAnimation('自評換卡', () => { setHistory([...history, next]); setIndex(index + 1); setRevealed(false); setTyped(''); });
  };
  const back = async () => { if (!canBack) return; await runAnimation('上一張', () => setView(view === null ? history.length - 1 : view - 1), 1); };
  const forward = async () => { if (view === null) return; await runAnimation('回到目前', () => setView(null), -1); };
  const restart = () => { setIndex(0); setView(null); setHistory([]); setRevealed(false); setTyped(''); };
  control.current = { reveal, rate, back, forward, restart, done: () => done };
  useEffect(() => () => { control.current = null; }, []);
  useEffect(() => {
    const el = stage.current; if (!el) return;
    let touch: { id: number; x: number; y: number; dx: number; dy: number; time: number; axis: Axis; edges: { left: number; right: number }; before: ReturnType<typeof sidebars>; interactive: boolean } | null = null;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) { if (touch) touch.axis = 'vertical'; return; }
      const p = event.touches[0], rect = el.getBoundingClientRect();
      touch = { id: p.identifier, x: p.clientX, y: p.clientY, dx: 0, dy: 0, time: performance.now(), axis: 'pending', edges: { left: p.clientX - rect.left, right: rect.right - p.clientX }, before: sidebars(app), interactive: !!(event.target as HTMLElement).closest('input,button,a,audio') };
    };
    const move = (event: TouchEvent) => {
      if (!touch) return;
      const p = [...event.touches].find(p => p.identifier === touch!.id); if (!p) return;
      touch.dx = p.clientX - touch.x; touch.dy = p.clientY - touch.y;
      touch.axis = touch.interactive ? 'vertical' : lockAxis(touch.axis, touch.dx, touch.dy);
      if (touch.axis === 'horizontal') {
        if (event.cancelable) event.preventDefault();
        if (body.current) body.current.style.transform = 'translateX(' + (touch.dx > 0 && !canBack || touch.dx < 0 && !viewing ? touch.dx * 0.18 : touch.dx) + 'px)';
      }
    };
    const finish = (event: TouchEvent) => {
      if (!touch) return;
      const t = touch; touch = null;
      const p = [...event.changedTouches].find(p => p.identifier === t.id);
      if (p) { t.dx = p.clientX - t.x; t.dy = p.clientY - t.y; }
      const ms = performance.now() - t.time;
      const outcome = event.type === 'touchcancel' ? (t.axis === 'vertical' ? '捲動' : '彈回') : gesture(t.axis, t.dx, t.dy, ms, canBack, viewing);
      if (outcome !== '點擊') suppressClick.current = performance.now() + 450;
      if (outcome === '上一張') void back();
      else if (outcome === '回到目前') void forward();
      else if (body.current && t.axis === 'horizontal') void metrics.track(metrics.animation('彈回', async () => { await animate(body.current!, { x: 0 }, { type: 'spring', stiffness: 360, damping: 30 }); }));
      void metrics.track(delay(500).then(() => {
        const after = sidebars(app);
        metrics.gestures.push({ start: { x: t.x, y: t.y }, edgeDistance: t.edges, dx: t.dx, dy: t.dy, durationMs: ms, axis: t.axis, outcome, cancelled: event.type === 'touchcancel', before: t.before, after, sidebarOpened: { left: t.before.left === true && after.left === false, right: t.before.right === true && after.right === false } });
      }));
    };
    el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: false }); el.addEventListener('touchend', finish); el.addEventListener('touchcancel', finish);
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', finish); el.removeEventListener('touchcancel', finish); };
  }, [index, view, history, open]);
  const say = () => {
    try { const u = new SpeechSynthesisUtterance(card.say!); u.lang = 'en-US'; speechSynthesis.cancel(); u.onerror = e => setWarning('朗讀失敗：' + e.error); speechSynthesis.speak(u); }
    catch (e) { setWarning('系統語音不可用：' + String(e)); }
  };
  const key = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if ((event.target as HTMLElement).matches('input')) { if (event.key === 'Enter') { event.preventDefault(); reveal(); } return; }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); void back(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); void forward(); }
    else if (/^[1-4]$/.test(event.key)) { event.preventDefault(); void rate(ratings[Number(event.key) - 1]); }
    else if (event.key === ' ' || event.key === 'Enter') { if (!(event.target as HTMLElement).closest('button')) { event.preventDefault(); reveal(); } }
  };
  return <div className="ec-app" tabIndex={-1} lang={card?.en ? 'en' : 'zh-Hant'} onKeyDown={key}>
    <div className="ec-top"><button className="ec-ico" aria-label="上一張" disabled={!canBack || animating} onClick={() => void back()}>‹</button>{viewing ? <button className="ec-return" disabled={animating} onClick={() => void forward()}>回到目前 ›</button> : <span className="ec-count">{done ? '' : '還剩 ' + (samples.length - index) + ' 張'}</span>}<button className="ec-ico" aria-label="結束複習" onClick={close}>✕</button></div>
    <div className="ec-prog"><i style={{ width: Math.min(index / samples.length, 1) * 100 + '%' }} /></div>
    {(props.notice || warning) && <div className="ec-warning" role="status">{props.notice || warning}</div>}
    <div className="ec-stage" ref={stage} onScroll={() => metrics.scrolls++} onClick={e => { if (!card?.spell && performance.now() > suppressClick.current && !(e.target as HTMLElement).closest('button,input,a,audio')) reveal(); }}>
      <div className="ec-body" ref={body}>
      {done ? <div className="ec-done"><div className="ec-done-mark">✓</div><h2>今天的份完成了！</h2><button className="ec-again" onClick={restart}>再複習一些</button></div> :
        <article className="ec-card">
          <div className="ec-meta">{card.isNew && <span className="ec-new">新</span>}<span>{card.en ? '英文' : '自然'} › 國二上 › 自編範例</span></div>
          <div className="ec-q"><Markdown key={card.lt + '-front'} app={app} text={card.front} revealed={open} cloze card={card.lt} side="front" metrics={metrics} first={index === 0 && !viewing} />{card.say && (!card.spell || open) && <button className="ec-say" onClick={say} aria-label="朗讀"><Icon type="speaker" /></button>}</div>
          {card.spell && !open && <div className="ec-inrow"><input className="ec-input" aria-label="輸入英文單字" placeholder="輸入英文單字" value={typed} onInput={e => setTyped(e.currentTarget.value)} autoComplete="off" autoCorrect="off" autoCapitalize="off" {...{ spellCheck: false }} enterKeyHint="done" onFocus={() => { void metrics.track(delay(500).then(() => { metrics.fullscreen.push({ kind: 'keyboard', visualViewport: viewport() }); })); }} /></div>}
          {open && <div className="ec-answer">
            {spell && <div className="ec-spell">{spell.ok ? <div>✓ {card.spell}</div> : <><div className="ec-spell-row"><span className="ec-lab">你打的</span><span>{spell.typed.length ? spell.typed.map((c, i) => c.bad ? <s key={i}>{c.char}</s> : c.char) : '—'}</span></div><div className="ec-spell-row"><span className="ec-lab">正確拼字</span><span>{spell.expected.map((c, i) => c.bad ? <mark className="ec-mk" key={i}>{c.char}</mark> : c.char)}</span></div></>}</div>}
            <div className="ec-a"><Markdown key={card.lt + '-back'} app={app} text={card.back} revealed card={card.lt} side="back" metrics={metrics} /></div>
            <div className="ec-tools"><button className="ec-ico" aria-label="出處" onClick={() => { if (!source) setSource(true); else { void app.workspace.openLinkText(SOURCE, SOURCE, true); close(); } }}><Icon type="book" /></button>{source && <button className="ec-tip" onClick={() => { void app.workspace.openLinkText(SOURCE, SOURCE, true); close(); }}>出處 ↗</button>}</div>
          </div>}
        </article>}
      </div>
    </div>
    <div className="ec-actions">{done ? <button className="ec-show" onClick={close}>結束複習</button> : !open ? <button className="ec-show" disabled={animating} onClick={reveal}>{card.spell && typed.trim() ? '確認' : '顯示答案'}</button> :
      <div className="ec-rates">{ratings.filter(r => allowed.includes(r)).map((r, i) => <button key={r} className="ec-rate" disabled={!ratingReady || animating} data-k={r} aria-pressed={entry?.rating === r} onClick={() => void rate(r)}>{(card.en ? ['No idea', 'Almost', 'Got it', 'Too easy'] : ['沒印象', '差一點', '記住了', '太簡單'])[ratings.indexOf(r)]}</button>)}</div>}</div>
  </div>;
}
