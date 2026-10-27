import { Notice, type App } from 'obsidian';
import { createRoot } from 'react-dom/client';
import type { Pick } from '../core/study/index.ts';
import { createSession, keyboardFit, type Session } from '../review/index.ts';
import type { State } from '../state/index.ts';
import { Review, type ReviewEvent } from './Review.tsx';
import { createSpeech, loadAutoRead, NO_ENGLISH_VOICE, saveAutoRead, type Speech } from './speech.ts';

// 全螢幕（D-109、W6 §3-2）：一層蓋滿整個視窗，直接掛在 document.body，蓋住 Obsidian 的上下欄；
// 觸控不往外傳給 Obsidian（往右滑才不會打開側欄）；鍵盤焦點留在畫面裡；✕ 或 Esc 離開。

export interface OpenOptions {
  app: App;
  state: State;
  pick: Pick;
  /** 選了科目的時間（performance.now）：量「從選了科目到第一張卡畫好」（L2 自選第 22 點）。 */
  pickedAt?: number;
  speech?: Speech;
  onEvent?: (event: ReviewEvent) => void;
  onClose?: () => void;
}
export interface ReviewHandle { session: Session; close(): void }

/** Tab 會停的元素（Obsidian 渲染的連結、音檔也算）。 */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href], audio[controls], [tabindex]:not([tabindex="-1"])';

export function openReview(options: OpenOptions): ReviewHandle {
  const { app, state } = options;
  const pickedAt = options.pickedAt ?? performance.now();
  const element = document.createElement('div');
  element.className = 'ec-fullscreen';
  element.tabIndex = -1;
  // 畫面上的觸控不往外傳；左右滑的 preventDefault 在卡片那一層做。
  element.addEventListener('touchstart', event => { event.stopPropagation(); }, { passive: true });
  element.addEventListener('touchmove', event => { event.stopPropagation(); }, { passive: false });
  element.addEventListener('touchend', event => { event.stopPropagation(); });
  // 鍵盤焦點留在畫面裡（試作外掛 main.ts 的做法，Codex L2 F6）：Tab 從最後一個、Shift+Tab 從第一個或畫面本身繞到另一端；
  // 不然焦點跑到被蓋住的 Obsidian（2026-10-27 用 Electron 送真的 Shift+Tab 實測），之後的快捷鍵都到不了複習畫面。
  element.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const items = Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(item => item.getClientRects().length > 0);
    const index = items.findIndex(item => item === document.activeElement);
    if (!items.length) { event.preventDefault(); return; }
    if (event.shiftKey ? index <= 0 : index === -1 || index === items.length - 1) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  });
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.append(element);
  const session = createSession({ state, pick: options.pick });
  const speech = options.speech ?? createSpeech(() => { new Notice(NO_ENGLISH_VOICE); });
  const root = createRoot(element);
  // 切到背景（W6 §2-1、L2 的 F4）：朗讀立刻停；連續超過 60 秒才回來，目前這張未評分的卡從頭開始（Session 判斷）。
  // 桌面的 Obsidian 被別的視窗整個遮住也算 hidden（2026-10-26 實測），所以短的切換不重設。
  let hiddenAt: number | null = null;
  let closed = false;
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      speech.stop();
      session.pause();
      hiddenAt ??= performance.now();
    } else if (hiddenAt !== null) {
      const ms = performance.now() - hiddenAt;
      hiddenAt = null;
      // 先重設再回報：沒有量測的 callback 時，可選呼叫連引數都不算，resume 會被跳過（Codex 第二次再審 R1）。
      const restarted = session.resume();
      options.onEvent?.({ kind: 'away', ms: Math.round(ms), restarted });
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  // iPhone 的鍵盤（W6 §3-2、L2 的 S2）：系統沒有自己縮小版面時，這一層改成看得到的那一塊（上緣與高度）；鍵盤收起、
  // 或系統已經縮小時復原。量測（§7 的 J7）記下兩個高度、有沒有調整、輸入框與按鈕在不在看得到的區域，只在數字變了時記。
  const viewport = window.visualViewport;
  let lastFit = '';
  const fit = (): void => {
    const area = viewport ? { height: viewport.height, offsetTop: viewport.offsetTop, scale: viewport.scale } : null;
    const target = keyboardFit(window.innerHeight, area);
    element.style.top = target ? `${String(target.top)}px` : '';
    element.style.height = target ? `${String(target.height)}px` : '';
    const key = [window.innerHeight, area?.height, area?.offsetTop, !!target].map(n => typeof n === 'number' ? Math.round(n) : String(n)).join(' ');
    if (!options.onEvent || !area || key === lastFit) return;
    lastFit = key;
    requestAnimationFrame(() => {
      // 關閉前排好的不回報：closed 之後再來一筆 keyboard，開發的量測會把它算進下一次打開（Codex 第二次再審 R2）。
      if (closed) return;
      const shown =(selector: string): boolean | null => {
        const rect = element.querySelector(selector)?.getBoundingClientRect();
        return rect ? rect.top >= area.offsetTop - 1 && rect.bottom <= area.offsetTop + area.height + 1 : null;
      };
      options.onEvent?.({ kind: 'keyboard', innerHeight: Math.round(window.innerHeight), height: Math.round(area.height), offsetTop: Math.round(area.offsetTop), adjusted: !!target, input: shown('.ec-input'), actions: shown('.ec-actions') });
    });
  };
  viewport?.addEventListener('resize', fit);
  viewport?.addEventListener('scroll', fit);
  fit();
  const handle: ReviewHandle = {
    session,
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      speech.stop();
      root.unmount();
      element.remove();
      session.close();
      previous?.focus({ preventScroll: true });
      options.onEvent?.({ kind: 'closed' });
      options.onClose?.();
    },
  };
  root.render(<Review
    app={app} session={session} speech={speech} pickedAt={pickedAt} onEvent={options.onEvent}
    close={() => { handle.close(); }}
    openLink={(linktext, sourcePath) => { handle.close(); void app.workspace.openLinkText(linktext, sourcePath, true); }}
    materials={path => state.decks().find(entry => entry.path === path)?.deck.props.materials ?? []}
    autoRead={{ get: () => loadAutoRead(app), set: on => { saveAutoRead(app, on); } }}
  />);
  element.focus({ preventScroll: true });
  return handle;
}
