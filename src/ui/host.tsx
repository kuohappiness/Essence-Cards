import { Notice, type App } from 'obsidian';
import { createRoot } from 'react-dom/client';
import type { Pick } from '../core/study/index.ts';
import { createSession, type Session } from '../review/index.ts';
import type { State } from '../state/index.ts';
import { Review, type ReviewEvent } from './Review.tsx';
import { createSpeech, loadAutoRead, NO_ENGLISH_VOICE, saveAutoRead, type Speech } from './speech.ts';

// 全螢幕（D-109、W6 §3-2）：一層蓋滿整個視窗，直接掛在 document.body，蓋住 Obsidian 的上下欄；
// 觸控不往外傳給 Obsidian（往右滑才不會打開側欄）；鍵盤焦點留在畫面裡；✕ 或 Esc 離開。

export interface OpenOptions {
  app: App;
  state: State;
  pick: Pick;
  /** 命令按下的時間（performance.now）。 */
  openedAt?: number;
  speech?: Speech;
  onEvent?: (event: ReviewEvent) => void;
  onClose?: () => void;
}
export interface ReviewHandle { session: Session; close(): void }

/** Tab 會停的元素（Obsidian 渲染的連結、音檔也算）。 */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href], audio[controls], [tabindex]:not([tabindex="-1"])';

export function openReview(options: OpenOptions): ReviewHandle {
  const { app, state } = options;
  const openedAt = options.openedAt ?? performance.now();
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
  let closed = false;
  const handle: ReviewHandle = {
    session,
    close() {
      if (closed) return;
      closed = true;
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
    app={app} session={session} speech={speech} openedAt={openedAt} onEvent={options.onEvent}
    close={() => { handle.close(); }}
    openLink={(linktext, sourcePath) => { handle.close(); void app.workspace.openLinkText(linktext, sourcePath, true); }}
    materials={path => state.decks().find(entry => entry.path === path)?.deck.props.materials ?? []}
    autoRead={{ get: () => loadAutoRead(app), set: on => { saveAutoRead(app, on); } }}
  />);
  element.focus({ preventScroll: true });
  return handle;
}
