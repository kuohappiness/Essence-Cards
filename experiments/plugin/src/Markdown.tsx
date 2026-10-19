import { Component, MarkdownRenderer, type App } from 'obsidian';
import { useEffect, useRef } from 'react';
import { animate } from 'motion';
import { SOURCE } from './samples';
import { SessionMetrics, twoFrames } from './metrics';

export function Markdown({ app, text, revealed, cloze, card, side, metrics, first = false }: { app: App; text: string; revealed: boolean; cloze?: boolean; card: string; side: string; metrics: SessionMetrics; first?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const ready = useRef(false), show = useRef(revealed);
  show.current = revealed;
  const updateBlanks = (fade: boolean) => {
    host.current?.querySelectorAll<HTMLElement>('.ec-blank').forEach(blank => {
      const span = blank.firstElementChild as HTMLElement;
      blank.classList.toggle('ec-filled', show.current);
      blank.setAttribute('aria-label', show.current ? span.textContent || '' : '空格');
      span.setAttribute('aria-hidden', String(!show.current));
      if (fade && show.current) void metrics.track(metrics.animation('填空淡入', async () => { await animate(span, { opacity: [0, 1] }, { duration: 0.18 }); }));
      else span.style.opacity = show.current ? '1' : '0';
    });
  };
  useEffect(() => {
    const component = new Component(); component.load(); let active = true;
    const abort = new AbortController();
    const bounded = async <T,>(work: Promise<T>, ms: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stop: () => void = () => {};
      try {
        if (abort.signal.aborted) throw Error('換卡或關閉，停止量測');
        return await Promise.race([work, new Promise<T>((_, reject) => {
          stop = () => reject(Error('換卡或關閉，停止量測'));
          abort.signal.addEventListener('abort', stop, { once: true });
          timer = setTimeout(() => reject(Error('載入逾時')), ms);
        })]);
      } finally { clearTimeout(timer); abort.signal.removeEventListener('abort', stop); }
    };
    const container = document.createElement('div'); container.className = 'ec-markdown';
    host.current?.replaceChildren(container); ready.current = false;
    const started = performance.now();
    const task = async () => {
      try {
        await MarkdownRenderer.render(app, text, container, SOURCE, component);
        if (!active) { component.unload(); return; }
        const renderMs = performance.now() - started;
        if (cloze) container.querySelectorAll('mark').forEach(mark => {
          const blank = document.createElement('span'), answer = document.createElement('span');
          blank.className = 'ec-blank'; answer.className = 'ec-blank-answer'; answer.textContent = mark.textContent; blank.append(answer); mark.replaceWith(blank);
        });
        ready.current = true; updateBlanks(false);
        if (first && metrics.markdownMs === undefined) {
          metrics.markdownMs = performance.now() - metrics.openedAt;
          await twoFrames(); metrics.paintedMs = performance.now() - metrics.openedAt;
        }
        const images = await Promise.all([...container.querySelectorAll('img')].map(async img => {
          const t = performance.now();
          try {
            await bounded(img.decode(), 5000);
            return { src: img.getAttribute('src'), ok: true, width: img.naturalWidth, height: img.naturalHeight, decodeMs: performance.now() - t };
          } catch (e) { return { src: img.getAttribute('src'), ok: false, error: String(e), decodeMs: performance.now() - t }; }
        }));
        if (first) metrics.imagesMs = performance.now() - metrics.openedAt;
        const audio = !active ? [] : await Promise.all([...container.querySelectorAll('audio')].map(el => new Promise(resolve => {
          let finished = false;
          const done = (ok: boolean, error?: string) => { if (finished) return; finished = true; clearTimeout(timer); el.removeEventListener('loadedmetadata', loaded); el.removeEventListener('error', failed); resolve({ ok, duration: Number.isFinite(el.duration) ? el.duration : null, error }); };
          const loaded = () => done(true), failed = () => done(false, el.error?.message || 'media error');
          const timer = window.setTimeout(() => done(false, 'metadata timeout'), 4000);
          el.addEventListener('loadedmetadata', loaded); el.addEventListener('error', failed);
          component.register(() => done(false, '換卡或關閉，停止量測'));
          el.preload = 'metadata';
          if (el.readyState >= 1) loaded();
        })));
        metrics.markdown.push({ card, side, renderMs, images, expectedImages: (text.match(/!\[\[[^\]]+\.png\]\]/g) || []).length, expectedAudio: text.includes('.wav]]'), formulaExpected: text.includes('$'), formulaRendered: !!container.querySelector('mjx-container'), audio });
      } catch (error) {
        metrics.markdown.push({ card, side, error: String(error) });
        if (active) container.textContent = '內容渲染失敗：' + String(error);
      }
    };
    void metrics.track(task());
    return () => { active = false; ready.current = false; abort.abort(); component.unload(); container.querySelectorAll('audio').forEach(el => el.pause()); container.remove(); };
  }, [app, text, card, side]);
  useEffect(() => { if (ready.current) updateBlanks(true); }, [revealed]);
  return <div className="ec-markdown-host" ref={host} />;
}


