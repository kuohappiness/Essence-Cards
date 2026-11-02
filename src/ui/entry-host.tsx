import type { App } from 'obsidian';
import { createRoot } from 'react-dom/client';
import type { State, StudyPick } from '../state/index.ts';
import { Entry, type EntryScreen } from './Entry.tsx';
import { openFullscreen } from './fullscreen.ts';
import { loadTerms, saveTerms } from './prefs.ts';

// 入口與目錄的全螢幕（D-163 第 2 點）。資料的刷新（任務說明 §11）：以「變成看得到時重新取」為起點，開著的時候再訂 state.onChange 與 onUnread；
// state 不為了這件事多通知，存檔按鈕等既有監聽者不受影響。

export interface EntryOptions {
  app: App;
  state: () => State | null;
  screen?: EntryScreen;
  start: (pick: StudyPick) => void;
  openNote: (path: string, line?: number) => void;
  openSettings: () => void;
  reminders: boolean;
  covered: () => boolean;
  onError?: (error: unknown) => void;
  onClose?: () => void;
}
export interface EntryHandle {
  /** 重新取資料：複習關掉、state 建好時。 */
  refresh(): void;
  show(screen: EntryScreen): void;
  close(): void;
}

export function openEntry(options: EntryOptions): EntryHandle {
  const shell = openFullscreen();
  const { onError } = options;
  const root = createRoot(shell.element, onError && {
    onUncaughtError: error => { onError(error); },
    onRecoverableError: error => { onError(error); },
  });
  const listeners = new Set<() => void>();
  let version = 0;
  let screen: EntryScreen = options.screen ?? 'entry';
  let closed = false;
  const refresh = (): void => {
    version++;
    for (const listener of [...listeners]) listener();
  };
  /** state 可能在入口打開之後才建好：建好時才訂，讀完時自動換掉「正在讀取」。 */
  let attached: State | null = null;
  let detach: (() => void) | null = null;
  function attach(): void {
    const state = options.state();
    if (!state || state === attached) return;
    attached = state;
    const stops = [state.onChange(refresh), state.onUnread(refresh)];
    detach = () => { for (const stop of stops) stop(); };
    // ready() 拒絕已經經過 onError 記下（tasks/error-log.md §2-3），或是停用外掛；畫面維持「正在讀取」。
    state.ready().then(() => { if (!closed) refresh(); }, () => {});
  }
  // 切到背景跨過清晨 4 點回來，要是新一天的份（§11）。
  const onVisibility = (): void => { if (document.visibilityState === 'visible') refresh(); };
  document.addEventListener('visibilitychange', onVisibility);
  const handle: EntryHandle = {
    refresh() { attach(); refresh(); },
    show(next) { screen = next; refresh(); },
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      detach?.();
      root.unmount();
      shell.close();
      options.onClose?.();
    },
  };
  attach();
  root.render(<Entry
    store={{
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      version: () => version,
      screen: () => screen,
      go(next) { screen = next; refresh(); },
    }}
    state={options.state} start={options.start} openNote={options.openNote} openSettings={options.openSettings}
    close={() => { handle.close(); }} reminders={options.reminders} covered={options.covered}
    terms={{ get: () => loadTerms(options.app), set: terms => { saveTerms(options.app, terms); } }}
  />);
  shell.element.focus({ preventScroll: true });
  return handle;
}
