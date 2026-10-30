import { MarkdownRenderer, type App } from 'obsidian';
import type { Pick } from '../core/study/index.ts';
import type { State } from '../state/index.ts';
import type { ReviewHandle } from '../ui/index.ts';
import { createObsidianFiles } from './files.ts';
import { keepRendering } from './dev-review.ts';

// tasks/error-log.md §7：正式版的錯誤紀錄在 Windows 版 Obsidian 的實測。依序製造幾種錯誤，再讀這台當月的錯誤紀錄。
// 每一種從自己的一行原始碼拋出，對照表定位（npm run locate）要對回那一行；行號寫在結果檔的 expected。

interface ProbeHost { app: App; device: string; state: State | null; startReview(pick: Pick): ReviewHandle | null }

const FOLDER = 'Essence Cards/紀錄/錯誤';
const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
async function until(check: () => boolean, ms = 5000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (check()) return true; await sleep(30); }
  return check();
}
const overlay = () => document.querySelector<HTMLElement>('.ec-fullscreen');

/** 這台裝置錯誤紀錄裡的每一行（所有月份，含衝突副本）。 */
async function errorLines(app: App, device: string): Promise<Map<string, string[]>> {
  const files = createObsidianFiles(app);
  const out = new Map<string, string[]>();
  for (const path of await files.list(FOLDER)) if (path.includes(' ' + device + ' ')) out.set(path, ((await files.read(path)) ?? '').split('\n').filter(Boolean));
  return out;
}

// 下面四個函式各自從一行拋錯；PROBE_LINES 的名稱和結果檔的 expected 對得起來。
function syncThrow(): void { throw Error('error-probe：計時器裡同步拋錯'); }
async function asyncThrow(): Promise<void> { await sleep(0); throw Error('error-probe：非同步拒絕'); }
function repeatThrow(): void { throw Error('error-probe：同一個錯誤連續 12 次'); }
/** 複習畫面的 React 錯誤：effect 裡停止朗讀時拋錯（Review 每次換卡都 speech.stop()）。 */
function speechThrow(): void { throw Error('error-probe：複習畫面的 effect 拋錯'); }

/** 打開複習畫面、等第一張卡出現（或畫面被 React 卸載），回傳 handle。 */
async function openCard(host: ProbeHost): Promise<ReviewHandle | null> {
  const handle = host.startReview({ subject: '自然' }) ?? host.startReview({ more: true });
  await until(() => !!overlay()?.querySelector('.ec-q') || !overlay()?.querySelector('.ec-app'));
  return handle;
}

export async function errorProbe(host: ProbeHost): Promise<unknown> {
  if (!host.state) throw Error('state 還沒建立');
  await host.state.ready();
  const rendering = keepRendering();
  const before = await errorLines(host.app, host.device);
  const steps: Record<string, unknown> = {};
  try {
    // 1. 計時器裡同步拋錯 → window 的 error（uncaught）。
    window.setTimeout(syncThrow, 0);
    // 2. 非同步拒絕沒人接 → unhandledrejection（uncaught）。
    window.setTimeout(() => { void asyncThrow(); }, 0);
    // 3. 同一個錯誤 12 次：只記第 1 次與 n: 10。
    for (let i = 0; i < 12; i++) window.setTimeout(repeatThrow, 0);
    await sleep(300);

    // 4. 卡片顯示不出來（render，帶卡組的路徑）：Obsidian 的渲染暫時換成失敗。
    const render = MarkdownRenderer.render.bind(MarkdownRenderer);
    MarkdownRenderer.render = () => Promise.reject(Error('error-probe：卡片顯示不出來'));
    try {
      const handle = await openCard(host);
      await until(() => !!overlay()?.querySelector('.ec-render-failed'));
      steps.render = { failedShown: overlay()?.querySelectorAll('.ec-render-failed').length ?? 0 };
      handle?.close();
    } finally { MarkdownRenderer.render = render; }

    // 5. 複習畫面的 React 錯誤（ui）：系統朗讀的 cancel 暫時換成拋錯，Review 的 effect 一跑就丟。React 沒有 error boundary，
    // 畫面被卸載（D-155 不加 fallback 畫面）。
    const synth = window.speechSynthesis as SpeechSynthesis & { cancel: () => void };
    synth.cancel = speechThrow;
    let handle: ReviewHandle | null = null;
    try {
      handle = await openCard(host);
      await sleep(300);
      steps.ui = { unmounted: !overlay()?.querySelector('.ec-app') };
    } finally {
      delete (synth as { cancel?: unknown }).cancel;
      handle?.close();
    }

    // 6. 回報（D-160）：打開複習畫面，點旗子選「其他」，記下畫面上那張卡。
    const review = await openCard(host);
    const view = review?.session.view();
    const card = view?.kind === 'card' ? { deck: view.card.card.deck, lt: view.card.card.lt, v: view.card.card.prompt.fingerprint } : null;
    const flag = overlay()?.querySelector<HTMLButtonElement>('button[aria-label="回報問題"]');
    flag?.click();
    await until(() => !!overlay()?.querySelector('.ec-report'));
    const menu = Array.from(overlay()?.querySelectorAll<HTMLButtonElement>('.ec-report-item') ?? []).map(button => button.textContent ?? '');
    overlay()?.querySelector<HTMLButtonElement>('.ec-report-item[data-kind="other"]')?.click();
    await sleep(100);
    const after = review?.session.view();
    steps.report = { card, flag: !!flag, menu, menuClosed: !overlay()?.querySelector('.ec-report'), sameCard: after?.kind === 'card' && after.card.card.lt === card?.lt };
    review?.close();
  } finally { rendering.restore(); }

  // 錯誤紀錄是盡力而為、背景寫：等一下再讀。
  await sleep(1500);
  const now = await errorLines(host.app, host.device);
  const added: Record<string, string[]> = {};
  for (const [path, lines] of now) {
    const old = before.get(path) ?? [];
    if (lines.length > old.length) added[path] = lines.slice(old.length);
  }
  const parsed = Object.values(added).flat().map(line => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return { raw: line }; } });
  const probe = parsed.filter(line => typeof line.msg !== 'string' || line.msg.startsWith('error-probe'));
  return {
    steps,
    added,
    check: {
      uncaught: probe.filter(line => line.where === 'uncaught').map(line => [line.msg, line.n ?? null, typeof line.stack === 'string' && line.stack.includes('plugin:essence-cards:')]),
      render: probe.filter(line => line.where === 'render').map(line => [line.msg, line.path ?? null, line.n ?? null]),
      ui: probe.filter(line => line.where === 'ui').map(line => [line.msg, typeof line.stack === 'string' && line.stack.includes('plugin:essence-cards:')]),
      report: parsed.filter(line => line.where === 'report').map(line => [line.kind, line.lt, line.v, line.path]),
      others: parsed.filter(line => !probe.includes(line) && line.where !== 'report'),
    },
  };
}
