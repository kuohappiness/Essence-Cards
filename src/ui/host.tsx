import { Notice, type App } from 'obsidian';
import { createRoot } from 'react-dom/client';
import { createSession, keyboardFit, type Session } from '../review/index.ts';
import type { State, StudyPick } from '../state/index.ts';
import { Review, type ReviewEvent, type ReviewProps } from './Review.tsx';
import { openFullscreen } from './fullscreen.ts';
import { createSpeech, loadAutoRead, NO_ENGLISH_VOICE, saveAutoRead, type Speech } from './speech.ts';

// 全螢幕的複習畫面（D-109、W6 §3-2）：外殼在 fullscreen.ts；✕ 或 Esc 離開。

export interface OpenOptions {
  app: App;
  state: State;
  pick: StudyPick;
  /** 選了科目的時間（performance.now）：量「從選了科目到第一張卡畫好」（L2 自選第 22 點）。 */
  pickedAt?: number;
  speech?: Speech;
  onEvent?: (event: ReviewEvent) => void;
  /** 畫面的錯（D-155）：render 是卡片顯示不出來（path 是卡組），ui 是 React 沒接住的錯。主機印在 console 並記進錯誤紀錄。 */
  onError?: (error: unknown, where: 'render' | 'ui', path?: string) => void;
  /** 學生在旗子的選單選了一項（D-160）；沒傳就沒有旗子。 */
  onReport?: ReviewProps['onReport'];
  onClose?: () => void;
}
export interface ReviewHandle { session: Session; close(): void }

export function openReview(options: OpenOptions): ReviewHandle {
  const { app, state } = options;
  const pickedAt = options.pickedAt ?? performance.now();
  const shell = openFullscreen();
  const { element } = shell;
  const session = createSession({ state, pick: options.pick });
  const speech = options.speech ?? createSpeech(() => { new Notice(NO_ENGLISH_VOICE); });
  // 複習畫面沒有 error boundary，也不加 fallback 畫面：React 沒接住的錯交給主機（D-155 第 2 點）。有傳 onError 才接，
  // 不然照 React 的預設印在 console。
  const onError = options.onError;
  const root = createRoot(element, onError && {
    onUncaughtError: error => { onError(error, 'ui'); },
    onRecoverableError: error => { onError(error, 'ui'); },
  });
  // 量測（開發版的 onEvent）只回報到關閉為止（Codex 第二次再審 R2）：鍵盤量測排在下一幀、畫面的手勢 0.5 秒後才回報，
  // 關閉後才到的一筆，開發的量測會把它算進下一次打開。沒有 onEvent 就是 undefined，畫面也不量。
  let closed = false;
  const onEvent = options.onEvent;
  const report = onEvent && ((event: ReviewEvent): void => { if (!closed) onEvent(event); });
  // 切到背景（W6 §2-1、L2 的 F4）：朗讀立刻停；連續超過 60 秒才回來，目前這張未評分的卡從頭開始（Session 判斷）。
  // 桌面的 Obsidian 被別的視窗整個遮住也算 hidden（2026-10-26 實測），所以短的切換不重設。
  // 回報的選單開著時不重設（D-160 第 3 點）：不 pause，回來時 resume 就不會從頭開始，選單與卡片照舊。
  let hiddenAt: number | null = null;
  let menuOpen = false;
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      speech.stop();
      if (!menuOpen) session.pause();
      hiddenAt ??= performance.now();
    } else if (hiddenAt !== null) {
      const ms = performance.now() - hiddenAt;
      hiddenAt = null;
      // 先重設再回報：沒有量測的 callback 時，可選呼叫連引數都不算，resume 會被跳過（Codex 第二次再審 R1）。
      const restarted = session.resume();
      report?.({ kind: 'away', ms: Math.round(ms), restarted });
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
    if (!report || !area || key === lastFit) return;
    lastFit = key;
    requestAnimationFrame(() => {
      const shown = (selector: string): boolean | null => {
        const rect = element.querySelector(selector)?.getBoundingClientRect();
        return rect ? rect.top >= area.offsetTop - 1 && rect.bottom <= area.offsetTop + area.height + 1 : null;
      };
      report({ kind: 'keyboard', innerHeight: Math.round(window.innerHeight), height: Math.round(area.height), offsetTop: Math.round(area.offsetTop), adjusted: !!target, input: shown('.ec-input'), actions: shown('.ec-actions') });
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
      session.close();
      shell.close();
      onEvent?.({ kind: 'closed' });
      options.onClose?.();
    },
  };
  root.render(<Review
    app={app} session={session} speech={speech} pickedAt={pickedAt} onEvent={report}
    onRenderError={onError && ((error, path) => { onError(error, 'render', path); })}
    onReport={options.onReport} onMenu={open => { menuOpen = open; }}
    close={() => { handle.close(); }}
    openLink={(linktext, sourcePath) => { handle.close(); void app.workspace.openLinkText(linktext, sourcePath, true); }}
    materials={path => state.decks().find(entry => entry.path === path)?.deck.props.materials ?? []}
    autoRead={{ get: () => loadAutoRead(app), set: on => { saveAutoRead(app, on); } }}
  />);
  element.focus({ preventScroll: true });
  return handle;
}
