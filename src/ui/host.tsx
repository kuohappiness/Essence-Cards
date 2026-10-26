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
