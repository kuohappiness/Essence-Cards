import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { App } from 'obsidian';
import { AWAY_LIMIT } from '../src/review/index.ts';
import { createState } from '../src/state/index.ts';
import type { ReviewEvent, ReviewProps } from '../src/ui/Review.tsx';
import type { OpenOptions, ReviewHandle } from '../src/ui/host.tsx';
import type { Speech } from '../src/ui/speech.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 全螢幕那一層（src/ui/host.tsx 的 openReview）的接線：Codex 第二次再審的 R1（背景重設不能靠量測的 callback）與
// R2（關閉之後不再回報已經排好的鍵盤量測）。esbuild 把 host.tsx 包成 CommonJS，Review、react-dom、obsidian 換成不畫東西的
// 替身；document、visualViewport、requestAnimationFrame 由測試控制，Date 用 node:test 的假時鐘。畫面本身在 review-ui 的替身、
// Obsidian 的開發命令與 Codex 的真實 React／DOM 驗。
const root = fileURLToPath(new URL('..', import.meta.url));
const START = Date.parse('2026-10-24T19:00:00.000+08:00');
const NATURAL = 'Essence Cards/國二上/自然/2-2（卡片）.md';
const PC = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
const naturalText = '---\n科目: 自然\n單元: 2-2 水溶液\n---\n- 能說出溶質與溶劑的意思 ^a1\n    - 糖水裡，哪一個是溶質？ :: 糖是**溶質**\n';
const HEIGHT = 844;

let code: Promise<string> | null = null;
function bundle(): Promise<string> {
  code ??= build({
    absWorkingDir: root, entryPoints: ['src/ui/host.tsx'], bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
    external: ['obsidian', 'react-dom/client', 'react/jsx-runtime'],
    plugins: [{
      name: 'review-stub',
      setup(builder) {
        builder.onResolve({ filter: /\/Review\.tsx$/ }, () => ({ path: 'review', namespace: 'stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function Review() { return null; }', loader: 'js' }));
      },
    }],
  }).then(result => result.outputFiles[0].text);
  return code;
}

/** addEventListener 的替身：dispatch 照加入的順序叫。 */
class Target {
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener); }
  dispatch(type: string): void { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(); }
}

interface Page {
  open(options: Omit<OpenOptions, 'app' | 'state'>): ReviewHandle;
  hide(): void;
  show(): void;
  /** 看得到的高度變了（鍵盤升起或收起）。 */
  viewport(height: number): void;
  /** 跑完排好的 requestAnimationFrame。 */
  frame(): void;
  /** 最近一次交給畫面（Review）的 props。 */
  review(): ReviewProps;
  /** 最近一次 createRoot 收到的選項（React root 的錯誤回呼）。 */
  rootOptions(): RootOptions | undefined;
}
interface RootOptions { onUncaughtError?: (error: unknown) => void; onRecoverableError?: (error: unknown) => void }
interface Harness { memory: MemoryFiles; speech: Speech & { stopped: number }; page: Page }

async function setup(t: TestContext): Promise<Harness> {
  const source = await bundle();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
  const memory = createMemoryFiles({ [NATURAL]: naturalText });
  const state = createState({ files: memory.files, device: 'PC-test', delay: 30, fillIds: false, now: () => Date.now(), offset: () => 480 });
  t.after(() => state.close());
  await state.ready();

  const doc = Object.assign(new Target(), {
    visibilityState: 'visible', activeElement: null, body: { append() {} },
    createElement: () => Object.assign(new Target(), { className: '', tabIndex: 0, style: {}, focus() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [] }),
  });
  const viewport = Object.assign(new Target(), { height: HEIGHT, offsetTop: 0, scale: 1 });
  const frames: (() => void)[] = [];
  let rendered: ReviewProps | null = null;
  let rootOptions: RootOptions | undefined;
  const module = { exports: {} as { openReview: (options: OpenOptions) => ReviewHandle } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('require', 'module', 'exports', 'document', 'window', 'performance', 'requestAnimationFrame', 'HTMLElement', source) as (...args: unknown[]) => void;
  run((name: string) => {
    if (name === 'obsidian') return { Notice: class {} };
    if (name === 'react-dom/client') return { createRoot: (_element: unknown, options?: RootOptions) => (rootOptions = options, { render(element: { props: ReviewProps }) { rendered = element.props; }, unmount() {} }) };
    if (name === 'react/jsx-runtime') return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
    throw Error('host 替身沒有這個模組：' + name);
  }, module, module.exports, doc, { innerHeight: HEIGHT, visualViewport: viewport }, { now: () => Date.now() },
  (callback: () => void) => frames.push(callback), class {});

  // 這個替身不出聲，一直是沒在念的狀態：whenIdle 照 Speech 的約定馬上回報（D-145）。
  const speech = { stopped: 0, say() {}, stop() { speech.stopped++; }, whenIdle(callback: () => void) { callback(); return () => {}; } };
  const visibility = (to: 'hidden' | 'visible'): void => { doc.visibilityState = to; doc.dispatch('visibilitychange'); };
  return {
    memory, speech,
    page: {
      open: options => module.exports.openReview({ app: {} as App, state, ...options }),
      hide: () => { visibility('hidden'); },
      show: () => { visibility('visible'); },
      viewport(height) { viewport.height = height; viewport.dispatch('resize'); },
      frame() { for (const callback of frames.splice(0)) callback(); },
      review() { if (!rendered) throw Error('還沒畫'); return rendered; },
      rootOptions: () => rootOptions,
    },
  };
}

for (const measured of [false, true]) {
  void test(`R1 離開超過 60 秒回來，卡片從頭開始；不靠量測的 callback（${measured ? '有' : '沒有'} onEvent）`, async t => {
    const h = await setup(t);
    const events: ReviewEvent[] = [];
    const handle = h.page.open({ pick: { subject: '自然' }, speech: h.speech, ...(measured ? { onEvent: event => { events.push(event); } } : {}) });
    t.after(() => { handle.close(); });
    await handle.session.ready();
    assert.equal(h.page.review().onEvent === undefined, !measured, '沒有量測時畫面也不量');
    const card = () => {
      const view = handle.session.view();
      if (view.kind !== 'card') throw Error('不是卡片：' + view.kind);
      return { lt: view.card.card.lt, revealed: view.card.revealed, shown: view.card.shown };
    };
    const away = (ms: number): void => { h.page.hide(); t.mock.timers.tick(ms); h.page.show(); };
    handle.session.reveal();
    away(5_000);
    assert.deepEqual(card(), { lt: 'a1', revealed: true, shown: 0 }, '短暫離開不重設');
    away(AWAY_LIMIT);
    assert.deepEqual(card(), { lt: 'a1', revealed: true, shown: 0 }, '剛好 60 秒不重設');
    away(AWAY_LIMIT + 1);
    assert.deepEqual(card(), { lt: 'a1', revealed: false, shown: 1 }, '超過 60 秒從正面重來');
    assert.equal(h.speech.stopped, 3, '每次切到背景都停朗讀');
    assert.deepEqual(events.flatMap(event => event.kind === 'away' ? [event.restarted] : []), measured ? [false, false, true] : []);
    assert.equal(h.memory.texts.get(PC), undefined, '重設不寫紀錄');
  });
}

void test('R2 關閉之後不再回報已經排好的量測（鍵盤、畫面的手勢）；下一次打開只有自己的量測', async t => {
  const h = await setup(t);
  // 開發的量測收集器（dev-review 的 watchReview）是同一個事件來源，兩次打開共用。
  const events: ReviewEvent[] = [];
  const onEvent = (event: ReviewEvent): void => { events.push(event); };
  const kinds = () => events.map(event => event.kind === 'keyboard' ? `keyboard ${String(event.height)}` : event.kind);
  const first = h.page.open({ pick: { subject: '自然' }, speech: h.speech, onEvent });
  await first.session.ready();
  h.page.frame();
  h.page.viewport(500);
  h.page.frame();
  assert.deepEqual(kinds(), [`keyboard ${String(HEIGHT)}`, 'keyboard 500'], '量測照常');
  assert.deepEqual(events.map(event => event.kind === 'keyboard' && event.adjusted), [false, true], '鍵盤升起時才調整');
  // 畫面（Review）的量測走同一個出口：換卡在兩幀後、手勢在 0.5 秒後才回報。
  const late = h.page.review().onEvent;
  late?.({ kind: 'next', ms: 3 });
  assert.equal(events.at(-1)?.kind, 'next', '畫面的量測照常');
  // 同一幀裡鍵盤收起又升起（排了兩筆），還沒畫就關掉。
  h.page.viewport(HEIGHT);
  h.page.viewport(480);
  first.close();
  h.page.frame();
  late?.({ kind: 'gesture', outcome: 'bounce', axis: 'horizontal', dx: 30, dy: 0, ms: 120, sidebarOpened: false });
  assert.deepEqual(kinds(), [`keyboard ${String(HEIGHT)}`, 'keyboard 500', 'next', 'closed'], '關閉前排好的量測不回報');
  h.page.viewport(500);
  h.page.hide();
  h.page.show();
  h.page.frame();
  assert.equal(events.length, 4, '關閉後的事件也不回報');

  h.page.viewport(HEIGHT);
  const second = h.page.open({ pick: { subject: '自然' }, speech: h.speech, onEvent });
  await second.session.ready();
  h.page.frame();
  second.close();
  h.page.frame();
  assert.deepEqual(kinds().slice(4), [`keyboard ${String(HEIGHT)}`, 'closed'], '第二次打開沒有上一次的樣本');
});

// tasks/error-log.md §2-2：React root 沒接住的錯（ui）與卡片顯示不出來（render，帶卡組的路徑）交給主機；沒傳 onError 時照 React 的預設。
void test('§2-2 React root 的 onUncaughtError、onRecoverableError 與畫面的 onRenderError 交給 onError', async t => {
  const h = await setup(t);
  const got: [string, unknown, string | undefined][] = [];
  const handle = h.page.open({ pick: { subject: '自然' }, speech: h.speech, onError: (error, where, path) => { got.push([where, error, path]); } });
  t.after(() => { handle.close(); });
  const options = h.page.rootOptions();
  const crash = Error('React 壞了'), recover = Error('補救了'), render = Error('顯示不出來');
  options?.onUncaughtError?.(crash);
  options?.onRecoverableError?.(recover);
  h.page.review().onRenderError?.(render, NATURAL);
  assert.deepEqual(got, [['ui', crash, undefined], ['ui', recover, undefined], ['render', render, NATURAL]]);
  handle.close();
  // 沒傳 onError：createRoot 不帶選項，畫面也沒有 onRenderError。
  const plain = h.page.open({ pick: { subject: '自然' }, speech: h.speech });
  t.after(() => { plain.close(); });
  assert.equal(h.page.rootOptions(), undefined);
  assert.equal(h.page.review().onRenderError, undefined);
});

// tasks/error-log.md §8（D-160 第 3 點）：回報的選單開著時，離開超過 60 秒回來也不從頭開始；選單關上之後照舊。
void test('§8 選單開著時切走超過 60 秒：卡片不重設；onReport 原樣交給畫面', async t => {
  const h = await setup(t);
  const onReport = (): void => {};
  const handle = h.page.open({ pick: { subject: '自然' }, speech: h.speech, onReport });
  t.after(() => { handle.close(); });
  await handle.session.ready();
  assert.equal(h.page.review().onReport, onReport);
  const shown = (): number => { const view = handle.session.view(); return view.kind === 'card' ? view.card.shown : -1; };
  const away = (ms: number): void => { h.page.hide(); t.mock.timers.tick(ms); h.page.show(); };
  handle.session.reveal();
  h.page.review().onMenu?.(true);
  away(AWAY_LIMIT + 1);
  assert.equal(shown(), 0, '選單開著：不重設');
  h.page.review().onMenu?.(false);
  away(AWAY_LIMIT + 1);
  assert.equal(shown(), 1, '選單關上：照舊從頭開始');
});
