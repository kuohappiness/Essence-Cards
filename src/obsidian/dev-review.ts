import { MarkdownView, Notice, type App, type Plugin } from 'obsidian';
import { isDeckPath } from '../core/deck/index.ts';
import type { Files } from '../core/files.ts';
import { encodeEntry, type NewEntry, type Pick } from '../core/study/index.ts';
import { createSession, RATE_DELAY, type View } from '../review/index.ts';
import { createState, type State } from '../state/index.ts';
import { openReview, type ReviewEvent, type ReviewHandle } from '../ui/index.ts';
import { createSpeech } from '../ui/speech.ts';
import { createObsidianFiles } from './files.ts';

// W6 的開發命令（§4）：只在開發版建置。AI 在 Windows 版 Obsidian 用 URI 執行，結果寫到 Essence W6/結果/。
// 會作答的命令都用只看得到 W6 範例卡組的 state，寫進這台裝置真正的紀錄檔，最後把這次寫的全部取消。

export const W6_ROOT = 'Essence W6';
const EXAMPLES = 'Essence Cards/W6 範例/';

/** dev.ts 的 Host 裡這裡要用的部分。 */
export interface ReviewHost extends Plugin {
  device: string;
  state: State | null;
  startReview(pick: Pick): ReviewHandle | null;
  on(kind: 'review', listener: (value: ReviewEvent) => void): () => void;
}
/** 寫一個結果檔，回傳路徑（dev.ts 的 writeResult）。 */
type Write = (code: string, data: unknown) => Promise<string>;

const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
const frames = () => new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
async function until(check: () => boolean, ms = 5000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (check()) return true; await sleep(30); }
  return check();
}
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round = (ms: number) => Math.round(ms);

// ── 自動量測（§4 的「自動」）：每次打開複習畫面記下打開、換卡、手勢與渲染失敗，關掉時寫一個檔 ──

let opens = 0;
interface Measure { open: number; fromPickMs: number | null; next: number[]; gestures: unknown[]; failed: unknown[]; away: unknown[]; keyboard: unknown[] }
/** 一次打開的量測；ui 命令自己開的畫面也用它。 */
function measurer(): { onEvent: (event: ReviewEvent) => void; result: () => unknown } {
  let current: Measure | null = null;
  const start = (): Measure => current ??= { open: ++opens, fromPickMs: null, next: [], gestures: [], failed: [], away: [], keyboard: [] };
  return {
    onEvent(event) {
      const m = start();
      // 從選了科目到第一張卡畫好（不含選單與 state 載入，L2 自選第 22 點）。
      if (event.kind === 'opened') m.fromPickMs = event.ms;
      else if (event.kind === 'next') m.next.push(event.ms);
      else if (event.kind === 'gesture') m.gestures.push({ ...event, dx: round(event.dx), dy: round(event.dy), ms: round(event.ms) });
      else if (event.kind === 'render-failed') m.failed.push(event);
      // 切走再回來（§7 的 J8）與鍵盤（J7）。
      else if (event.kind === 'away') m.away.push(event);
      else if (event.kind === 'keyboard' && m.keyboard.length < 40) m.keyboard.push(event);
    },
    result() {
      const m = start();
      return {
        open: m.open, fromPickMs: m.fromPickMs === null ? null : round(m.fromPickMs),
        next: { count: m.next.length, median: m.next.length ? round(median(m.next) ?? 0) : null, max: m.next.length ? round(Math.max(...m.next)) : null, all: m.next.map(round) },
        gestures: m.gestures, sidebarOpened: m.gestures.filter(g => (g as { sidebarOpened: boolean }).sidebarOpened).length,
        renderFailed: m.failed, away: m.away, keyboard: m.keyboard,
      };
    },
  };
}

/** 訂閱外掛的 review 事件：每次打開一份量測，收到 closed 時寫成 Essence W6/結果/review …。 */
export function watchReview(plugin: ReviewHost, write: Write): void {
  let current: ReturnType<typeof measurer> | null = null;
  plugin.on('review', event => {
    current ??= measurer();
    current.onEvent(event);
    if (event.kind !== 'closed') return;
    const done = current;
    current = null;
    void write('review', done.result()).then(path => { new Notice('Essence 開發：複習畫面的量測已寫入\n' + path); });
  });
}

// ── 只看得到 W6 範例卡組的 state，與作答的取消 ──

function onlyExamples(files: Files): Files {
  const keep = (path: string) => !isDeckPath(path) || path.startsWith(EXAMPLES);
  return {
    list: async folder => (await files.list(folder)).filter(keep),
    read: path => files.read(path),
    modify: (path, edit) => files.modify(path, edit),
    append: (path, line) => files.append(path, line),
    watch: onChange => files.watch(path => { if (keep(path)) onChange(path); }),
  };
}

/** 包一層 state：記下每一筆寫進去的紀錄（取消時用）。 */
function recording(state: State): { state: State; written: { t: string; line: string; entry: NewEntry }[] } {
  const written: { t: string; line: string; entry: NewEntry }[] = [];
  return {
    written,
    state: { ...state, answer(entry) { const t = state.answer(entry); written.push({ t, line: encodeEntry(t, entry), entry }); return t; } },
  };
}

/** 這次寫進去、還沒被取消的作答全部取消。 */
async function undoAll(state: State, written: { t: string; entry: NewEntry }[]): Promise<string[]> {
  const undone = new Set(written.flatMap(w => 'undo' in w.entry ? [w.entry.undo] : []));
  const lines: string[] = [];
  for (const w of [...written]) {
    if ('undo' in w.entry || undone.has(w.t)) continue;
    const entry = { undo: w.t };
    lines.push(encodeEntry(state.answer(entry), entry));
    undone.add(w.t);
  }
  await state.flush();
  return lines;
}

/** 今天的份與進度（比對「回到原樣」用）。 */
function snapshot(state: State): string {
  const today = state.today();
  return JSON.stringify({ day: today.day, share: today.share.map(i => i.lt + ':' + i.lane), more: today.more.map(i => i.lt + ':' + i.lane), progress: state.progress() });
}
async function examplesState(host: ReviewHost): Promise<State> {
  const state = createState({ files: onlyExamples(createObsidianFiles(host.app)), device: host.device, fillIds: false });
  await state.ready();
  return state;
}
/** 新建一個 state 讀今天的份：answer 不重排，所以「回到原樣」要用新讀的比。 */
async function freshSnapshot(host: ReviewHost): Promise<string> {
  const state = await examplesState(host);
  try { return snapshot(state); } finally { await state.close(); }
}

/** 紀錄檔目前有幾行（找出這次多出來的行）。 */
async function logLines(app: App): Promise<Map<string, string[]>> {
  const files = createObsidianFiles(app);
  const out = new Map<string, string[]>();
  for (const path of await files.list('Essence Cards/紀錄')) out.set(path, ((await files.read(path)) ?? '').split('\n').filter(Boolean));
  return out;
}
function added(before: Map<string, string[]>, after: Map<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [path, lines] of after) {
    const old = before.get(path) ?? [];
    if (lines.length !== old.length || lines.some((line, i) => i < old.length && line !== old[i])) out[path] = lines.slice(old.length);
  }
  return out;
}

// ── review-script（§4）：用 Session 的動作照劇本複習一次 ──

/** 畫面現在在哪一步（結果檔用）。 */
function stage(view: View): Record<string, unknown> {
  if (view.kind !== 'card') return { kind: view.kind, top: view.top.center, ...(view.kind === 'done' ? { title: view.done.title, detail: view.done.detail } : {}) };
  const c = view.card, typed = c.typed;
  return {
    kind: 'card', target: c.card.target.name, top: view.top.center, viewing: c.viewing, revealed: c.revealed, allowed: c.allowed, pressed: c.pressed,
    ...(typed ? { step: typed.step, first: typed.first, second: typed.second, notice: typed.notice, hint: typed.hint, answer: typed.answer, finished: typed.finished, canSkip: typed.canSkip,
      attempt: typed.attempt && { typed: typed.attempt.typed.map(l => l.bad ? '[' + l.char + ']' : l.char).join(''), expected: typed.attempt.expected.map(l => l.bad ? '[' + l.char + ']' : l.char).join('') },
      live: typed.live && typed.live.typed.map(l => l.bad ? '[' + l.char + ']' : l.char).join('') } : {}),
    speakable: c.speakable, autoRead: c.autoRead,
  };
}

export async function reviewScript(host: ReviewHost): Promise<unknown> {
  const base = await examplesState(host);
  const { state, written } = recording(base);
  const logBefore = await logLines(host.app);
  const before = snapshot(base), freshBefore = await freshSnapshot(host);
  // 0.3 秒的規則：session 的時間由這裡推進，不用真的等。
  let skew = 0;
  const session = createSession({ state, pick: { subject: '英文' }, now: () => Date.now() + skew });
  const steps: { action: string; result?: unknown; view: Record<string, unknown> }[] = [];
  const log = (action: string, result?: unknown) => { steps.push({ action, ...(result === undefined ? {} : { result }), view: stage(session.view()) }); };
  const name = () => { const v = session.view(); return v.kind === 'card' ? v.card.card.target.name : null; };
  const later = () => { skew += RATE_DELAY; };
  const type = (text: string) => { session.input(text); session.submit(); log('打 ' + text + ' 確認'); };
  try {
    await session.ready();
    log('開始');
    const expect = (target: string) => { if (name() !== target) throw Error('預期 ' + target + '，實際是 ' + String(name())); };
    // 1. 英翻中：翻面前、翻面後 0.3 秒內按都不算；之後「記住了」。
    expect('borrow 英翻中');
    log('翻面前按記住了', session.rate('good'));
    session.reveal(); log('顯示答案');
    log('0.3 秒內按記住了', session.rate('good'));
    later(); log('記住了', session.rate('good'));
    // 2. 打字卡：第 1 步拼錯 → 第 2 步拼錯 → 第 3 步照打（先打錯一次）→ 差一點。
    expect("make up one's mind 中翻英");
    type('make up my mind');
    type('make up your mand');
    type('make up your mnd');
    type('make up your mind');
    log('0.3 秒內按差一點', session.rate('near'));
    later(); log('記住了（不能按）', session.rate('good'));
    log('差一點', session.rate('near'));
    // 3. 原形等於答案的打字卡（light（輕的） → light）：第 1 步拼錯直接第 3 步照打 → 差一點，紀錄 retry: not-needed。
    expect('light（輕的） 中翻英');
    type('lihgt');
    type('light');
    later(); log('差一點', session.rate('near'));
    // 4. 另一張打字卡：第 1 步「沒印象」→ 第 2 步拼對 → 沒印象。
    expect('go 中翻英');
    session.skip(); log('沒印象');
    type('went');
    later(); log('差一點（不能按）', session.rate('near'));
    log('沒印象', session.rate('miss'));
    // 5. 回看第一張改成「太簡單」；第 1 步按「沒印象」的那張改不了；回到目前這張不換。
    const current = name();
    session.back(); log('往前一張');
    log('改成記住了（第 1 步按沒印象，不能改）', session.rate('good'));
    session.back(); session.back(); log('往前兩張');
    session.back(); log('第一張再往前（彈回）');
    log('改成太簡單', session.rate('easy'));
    session.toCurrent(); log('回到目前');
    if (name() !== current) throw Error('回到目前換了一張：' + String(name()));
    await state.flush();
    const wrote = written.map(w => w.line);
    const undo = await undoAll(state, written);
    const freshAfter = await freshSnapshot(host);
    const logAfter = await logLines(host.app);
    // 每一行對照劇本的預期（W6 §4、syntax.md §5）。
    const lines = written.map(w => JSON.parse(w.line) as Record<string, unknown>).filter(line => 'r' in line);
    const expected = [['good', undefined, undefined], ['near', 'wrong', 'wrong'], ['near', 'wrong', 'not-needed'], ['miss', 'skip', 'right'], ['easy', undefined, undefined]];
    return {
      steps, wrote, undo,
      linesAsExpected: JSON.stringify(lines.map(line => [line.r, line.typed, line.retry])) === JSON.stringify(expected),
      logAdded: added(logBefore, logAfter),
      todaySame: freshAfter === freshBefore,
      progressSame: snapshot(base) === before,
    };
  } catch (error) {
    // 劇本中途出錯也要把寫進去的取消。
    const undo = await undoAll(state, written);
    return { error: error instanceof Error ? error.stack ?? error.message : String(error), steps, wrote: written.map(w => w.line), undo };
  } finally {
    session.close();
    await base.close();
  }
}

// ── voices（§4）：系統的英文語音 ──

export async function voices(): Promise<unknown> {
  const synth = window.speechSynthesis;
  let list = synth.getVoices();
  if (!list.length) {
    await new Promise<void>(resolve => { synth.addEventListener('voiceschanged', () => { resolve(); }, { once: true }); window.setTimeout(resolve, 3000); });
    list = synth.getVoices();
  }
  const english = list.filter(voice => voice.lang.toLowerCase().startsWith('en'));
  // 沒有英文語音時：say 提示一次、不用中文語音念；念兩次只提示一次。有英文語音時不真的念出聲。
  let missing = 0;
  let speaking: boolean | null = null;
  if (!english.length && list.length) {
    const speech = createSpeech(() => { missing++; });
    speech.say(['test']); speech.say(['test again']);
    speaking = synth.speaking || synth.pending;
    speech.stop();
  }
  return {
    voices: list.length, english: english.length,
    names: english.map(voice => voice.name + '（' + voice.lang + (voice.localService ? '' : '，線上') + '）'),
    others: [...new Set(list.map(voice => voice.lang))],
    sayUsable: english.length > 0 || list.length === 0,
    ...(speaking === null ? {} : { missingNotices: missing, spokeWithOtherVoice: speaking }),
  };
}

// ── 準備：W6 範例的卡組按「存檔」補 ID；卡組內容的雜湊 ──

/** 每篇 W6 範例卡組在新分頁打開、按存檔按鈕（和家長按的是同一顆）、存回檔案、關掉分頁。 */
export async function saveExamples(host: ReviewHost): Promise<unknown> {
  const state = host.state;
  if (!state) throw Error('state 還沒建立');
  await state.ready();
  const out: Record<string, unknown> = {};
  for (const file of host.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(EXAMPLES)).sort((a, b) => a.path < b.path ? -1 : 1)) {
    const missing = state.deckStatus(file.path).missing;
    const leaf = host.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw Error('不是 Markdown 分頁');
    await until(() => !!view.containerEl.querySelector('.essence-cards-save'));
    const button = view.containerEl.querySelector<HTMLElement>('.essence-cards-save');
    button?.click();
    await view.save();
    await until(() => state.deckStatus(file.path).missing === 0);
    out[file.path] = { button: !!button, missingBefore: missing, missingAfter: state.deckStatus(file.path).missing, issues: state.deckStatus(file.path).issues.length };
    leaf.detach();
  }
  return out;
}

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}
/** Essence Cards/ 裡每篇卡組的長度與雜湊（W6 §6 的 W6、§7 的 J4：測試前後比對）。 */
export async function deckHashes(host: ReviewHost): Promise<unknown> {
  const files = createObsidianFiles(host.app);
  const out: Record<string, string> = {};
  for (const path of (await files.list('Essence Cards')).filter(isDeckPath)) {
    const text = (await files.read(path)) ?? '';
    out[path] = text.length + ' ' + await sha(text);
  }
  return { decks: out, logs: Object.fromEntries([...(await logLines(host.app))].map(([path, lines]) => [path, lines.length])) };
}

// ── 打開三次（W6 §6 的 W4）：從選了科目到第一張卡畫好 ──

export async function openTimes(host: ReviewHost): Promise<unknown> {
  const results: { open: number; fromPickMs: number | null }[] = [];
  const rendering = keepRendering();
  await sleep(300);
  try { for (let i = 0; i < 3; i++) {
    let ms: number | null = null;
    const off = host.on('review', event => { if (event.kind === 'opened') ms = event.ms; });
    const handle = host.startReview({ subject: '自然' });
    if (!handle) { off(); throw Error('state 還沒建立'); }
    await until(() => ms !== null);
    off();
    handle.close();
    results.push({ open: opens, fromPickMs: ms === null ? null : round(ms) });
    await sleep(500);
  } } finally { rendering.restore(); }
  const [first, ...rest] = results;
  return { visibilityBefore: rendering.before, results, firstOk: first.open !== 1 ? '這次載入不是第一次打開' : (first.fromPickMs ?? Infinity) <= 1000, laterOk: rest.every(r => (r.fromPickMs ?? Infinity) <= 400) };
}

// ── 畫面與鍵盤（W6 §6 的 W2、W3、W4）：真的打開複習畫面，用鍵盤與點擊操作、截圖 ──

interface Contents {
  capturePage(): Promise<{ toPNG(): Uint8Array }>;
  setBackgroundThrottling?(allowed: boolean): void;
  sendInputEvent?(event: { type: 'keyDown' | 'keyUp'; keyCode: string; modifiers?: string[] }): void;
}
function webContents(): Contents | null {
  const load = (window as unknown as { require?: (name: string) => unknown }).require;
  const electron = load?.('electron') as { remote?: { getCurrentWebContents(): Contents } } | undefined;
  return electron?.remote?.getCurrentWebContents() ?? null;
}
/**
 * 量測與截圖的期間照常繪製：Windows 判斷視窗被遮住時（例如 computer-use 的提示框蓋在上面，2026-10-26 實測），
 * Chromium 停止繪製、requestAnimationFrame 不跑、計時器被放慢。回傳恢復原狀的函式。
 */
function keepRendering(): { before: string; restore: () => void } {
  const contents = webContents();
  const before = document.visibilityState;
  contents?.setBackgroundThrottling?.(false);
  return { before, restore: () => { contents?.setBackgroundThrottling?.(true); } };
}

const overlay = () => document.querySelector<HTMLElement>('.ec-fullscreen');
const inOverlay = <T extends Element>(selector: string): T[] => Array.from(overlay()?.querySelectorAll<T>(selector) ?? []);
const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** 畫面上看得到的文字（截圖之外的對照）。 */
function screen(): Record<string, unknown> {
  const root = overlay();
  if (!root) return { open: false };
  const active = document.activeElement;
  const focus = !active || active === document.body ? 'body' : root.contains(active) ? (active.className || active.tagName) : '畫面外：' + (active.className || active.tagName);
  return {
    top: text(root.querySelector('.ec-count')) || text(root.querySelector('.ec-return')),
    auto: root.querySelector('.ec-auto') ? (root.querySelector<HTMLInputElement>('.ec-auto input')?.checked ? '開' : '關') : null,
    meta: text(root.querySelector('.ec-meta')), q: text(root.querySelector('.ec-q')).slice(0, 120),
    lines: inOverlay('.ec-line').length, linesFilled: inOverlay('.ec-line.ec-filled').map(text),
    blanks: inOverlay('.ec-blank').length, blanksFilled: inOverlay('.ec-blank.ec-filled').map(text),
    hint: text(root.querySelector('.ec-hint')) || null,
    input: root.querySelector<HTMLInputElement>('.ec-input')?.placeholder ?? null,
    live: text(root.querySelector('.ec-live')) || null,
    spell: inOverlay('.ec-spell-row').map(text),
    answer: text(root.querySelector('.ec-a')).slice(0, 120) || null,
    extras: inOverlay('.ec-ex-item').map(el => text(el).slice(0, 60)),
    images: inOverlay<HTMLImageElement>('.ec-markdown img').map(img => img.complete && img.naturalWidth > 0 ? 'ok' : 'broken'),
    math: inOverlay('.ec-markdown mjx-container, .ec-markdown .math').length,
    speakers: inOverlay('.ec-say').length, source: !!root.querySelector('.ec-srcw'), tips: inOverlay('.ec-tip').map(text),
    done: text(root.querySelector('.ec-done h2')) || null, doneSub: text(root.querySelector('.ec-done-sub')) || null,
    buttons: inOverlay<HTMLButtonElement>('.ec-actions button, .ec-done button').map(b => text(b) + (b.disabled ? '（不能按）' : '') + (b.getAttribute('aria-pressed') === 'true' ? '（當時按的）' : '')),
    focus, failed: inOverlay('.ec-render-failed').length,
  };
}

/** 按鍵：送到現在有焦點的元素（和真的鍵盤一樣），沒有焦點時送到 body。 */
function press(key: string, init: KeyboardEventInit = {}): string {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  return target === document.body ? 'body' : target.className || target.tagName;
}
function click(label: string): boolean {
  const button = inOverlay<HTMLButtonElement>('button').find(b => text(b) === label || b.getAttribute('aria-label') === label);
  button?.click();
  return !!button;
}
/** 在輸入框打字（React 的受控輸入框：用原生 setter 再發 input 事件）。 */
function typeText(value: string): boolean {
  const input = overlay()?.querySelector<HTMLInputElement>('.ec-input');
  if (!input) return false;
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export async function uiShots(host: ReviewHost, folder: string): Promise<unknown> {
  const contents = webContents();
  const rendering = keepRendering();
  const base = await examplesState(host);
  const { state, written } = recording(base);
  const freshBefore = await freshSnapshot(host);
  const logBefore = await logLines(host.app);
  const measure = measurer();
  const steps: { step: string; result?: unknown; screen: Record<string, unknown>; shots?: string[] }[] = [];
  const dark = document.body.classList.contains('theme-dark');
  let shotCount = 0;
  // 滑動換卡約 0.27 秒（滑出 0.11＋滑入 0.16），動畫中的按鍵不算：每一步等動畫做完。
  const settle = async (ms = 450) => { await frames(); await sleep(ms); };
  async function capture(name: string): Promise<string | null> {
    if (!contents) return null;
    const png = (await contents.capturePage()).toPNG();
    const path = `${folder}/${String(++shotCount).padStart(2, '0')} ${name}.png`;
    await host.app.vault.adapter.writeBinary(path, png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer);
    return path;
  }
  /** 淺色與深色各截一張（用 body 的 class 切換，不改設定），再換回原本的。 */
  async function shots(name: string): Promise<string[]> {
    await settle(420);
    const out: string[] = [];
    for (const theme of dark ? ['dark', 'light'] : ['light', 'dark']) {
      document.body.classList.toggle('theme-dark', theme === 'dark');
      document.body.classList.toggle('theme-light', theme === 'light');
      await settle(200);
      const path = await capture(name + ' ' + (theme === 'dark' ? '深色' : '淺色'));
      if (path) out.push(path);
    }
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    return out;
  }
  const record = async (step: string, result?: unknown, shot?: string) => {
    await settle();
    steps.push({ step, ...(result === undefined ? {} : { result }), screen: screen(), ...(shot ? { shots: await shots(shot) } : {}) });
  };
  const name = () => { const v = handle?.session.view(); return v?.kind === 'card' ? v.card.card.target.name : v?.kind ?? null; };
  let handle: ReviewHandle | null = null;
  try {
    let path = '';
    for (const part of folder.split('/')) {
      path = path ? path + '/' + part : part;
      if (!host.app.vault.getAbstractFileByPath(path)) await host.app.vault.createFolder(path);
    }
    // 暫時的開始方式：命令打開選單（外掛真正的 state），截圖後關掉。
    const commands = (host.app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands;
    commands.executeCommandById(host.manifest.id + ':start-review');
    await until(() => !!document.querySelector('.prompt'));
    await record('開始複習的選單', { rows: Array.from(document.querySelectorAll('.prompt .suggestion-item'), text), ribbon: !!document.querySelector('.side-dock-ribbon-action[aria-label="Essence Cards：開始複習"]') }, '選單');
    document.querySelector<HTMLElement>('.prompt input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    if (document.querySelector('.prompt')) document.querySelector('.modal-container')?.remove();

    // 自然：打開時的焦點、Space 翻面、0.3 秒、數字鍵自評。
    handle = openReview({ app: host.app, state, pick: { subject: '自然' }, onEvent: measure.onEvent });
    await until(() => !!overlay()?.querySelector('.ec-q .ec-markdown'));
    const rect = overlay()?.getBoundingClientRect();
    await record('打開（自然第一張）', { covers: rect ? { width: round(rect.width), height: round(rect.height), window: [window.innerWidth, window.innerHeight] } : null, corners: [[1, 1], [window.innerWidth - 2, window.innerHeight - 2]].map(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.ec-fullscreen')) }, '自然 正面');
    // 打開後直接按鍵（焦點要已經在畫面裡）；Space 翻面後馬上按 3：0.3 秒內不算，還是同一張。
    const space = press(' '), quick = press('3');
    await record('Space 後馬上按 3', { space, quick, still: name() });
    // Tab／Shift+Tab 不離開全螢幕（W6 §3-2、Codex L2 F6）：DOM 的 KeyboardEvent 不會移動焦點，所以用 Electron 送真的按鍵。
    // 從畫面本身 Shift+Tab、從最後一個 Tab、再 Tab 一次；之後的數字鍵從按鈕上按（焦點不在 .ec-app 也要有作用）。
    const tab = async (shift: boolean): Promise<string | null> => {
      if (!contents?.sendInputEvent) return null;
      const modifiers = shift ? ['shift'] : [];
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers });
      await settle(150);
      return String(screen().focus);
    };
    overlay()?.querySelector<HTMLElement>('.ec-app')?.focus();
    await record('Shift+Tab（從畫面本身）', { focus: await tab(true) });
    await record('Tab（從最後一個）', { focus: await tab(false) });
    await record('Tab', { focus: await tab(false) });
    await sleep(RATE_DELAY);
    await record('過了 0.3 秒按 3', { before: name(), key: press('3') });
    await record('第二張：點卡片翻面', overlay()?.querySelector<HTMLElement>('.ec-stage')?.click());
    await sleep(RATE_DELAY);
    await record('按「記住了」', click('記住了'));
    // 圖與詳解的分隔線。
    await record('Enter 翻面', press('Enter'), '自然 圖 背面');
    await sleep(RATE_DELAY);
    await record('4', press('4'));
    // 填空：一行三個空格；翻面後答案在線上、線變紫色。
    await record('填空題正面', name(), '自然 填空 正面');
    await record('顯示答案', click('顯示答案'), '自然 填空 背面');
    await sleep(RATE_DELAY);
    await record('記住了', click('記住了'));
    // 多行答案、出處（標題）。
    await record('多行答案', click('顯示答案'));
    await record('出處圖示', click('出處'), '自然 多行答案 出處');
    await sleep(RATE_DELAY);
    await record('記住了', click('記住了'));
    // 公式；出處：p.46 能點、跨單元照文字。
    await record('公式', click('顯示答案'));
    await record('出處圖示', click('出處'), '自然 公式 出處');
    await sleep(RATE_DELAY);
    await record('記住了', click('記住了'));
    // 長答案：捲到最底。
    await record('長答案', click('顯示答案'), '自然 長答案 上');
    const stageEl = overlay()?.querySelector<HTMLElement>('.ec-stage');
    if (stageEl) stageEl.scrollTop = stageEl.scrollHeight;
    await record('捲到最底', stageEl ? { scrollHeight: stageEl.scrollHeight, clientHeight: stageEl.clientHeight } : null, '自然 長答案 下');
    // 回看：← 兩次、第一張再 ← 彈回、改評分、→ 回到目前。
    await record('←', press('ArrowLeft'), '自然 回看');
    for (let i = 0; i < 5; i++) await record('← 再往前', press('ArrowLeft'));
    await record('第一張再 ←（彈回）', press('ArrowLeft'));
    await record('回看時改成太簡單', click('太簡單'));
    await record('→', press('ArrowRight'));
    await record('回到目前', click('回到目前'));
    await sleep(RATE_DELAY);
    await record('記住了', click('記住了'), '自然 完成');

    // 接著做英文：英翻中有喇叭；打字卡三步。
    await record('接著做英文', click('接著做英文'), '英文 英翻中 正面');
    await record('顯示答案', press(' '), '英文 英翻中 背面');
    await sleep(RATE_DELAY);
    await record('記住了', press('3'));
    await record('打字卡第 1 步', name(), '英文 打字 第1步');
    typeText('make up my mind');
    await record('組字中的 Enter', press('Enter', { isComposing: true }));
    await record('Enter 確認（拼錯）', press('Enter'), '英文 打字 第2步');
    typeText('make up your mand');
    await record('第 2 步拼錯', press('Enter'), '英文 打字 第3步');
    typeText('make up your mnd');
    await record('第 3 步打錯', press('Enter'), '英文 打字 第3步 打錯');
    typeText('make up your mind');
    await record('第 3 步照打對', press('Enter'), '英文 打字 結束');
    await sleep(RATE_DELAY);
    await record('鍵盤 2（差一點）', press('2'));
    await record('light：沒印象', click('沒印象'), '英文 打字 原形等於答案');
    typeText('light');
    await record('照打', press('Enter'));
    await sleep(RATE_DELAY);
    await record('鍵盤 1（沒印象）', press('1'));
    typeText('went');
    await record('go 第 1 步拼對', press('Enter'), '英文 打字 拼對');
    await sleep(RATE_DELAY);
    await record('鍵盤 3（記住了）', press('3'));
    typeText('switch off');
    await record('turn off 打第二個答案', press('Enter'), '英文 打字 第二個答案');
    await sleep(RATE_DELAY);
    await record('鍵盤 4（太簡單）', press('4'));
    // 剛答錯的提早再出（make up 差一點、light 沒印象）：這次都答對，做到今天的份完成。
    for (let i = 0; i < 4 && handle.session.view().kind === 'card'; i++) {
      const target = name();
      const answers: Record<string, string> = { "make up one's mind 中翻英": 'make up your mind', 'light（輕的） 中翻英': 'light' };
      typeText(answers[target ?? ''] ?? '');
      press('Enter');
      await settle();
      await sleep(RATE_DELAY);
      await record('再出：' + String(target), press('3'));
    }
    await record('今天的份完成', name(), '完成 今天的份');
    await record('再複習一些', click('再複習一些'), '完成 再複習一些');
    await record('Esc', press('Escape'));
    await record('Esc 之後', { closed: !overlay() });
  } catch (error) {
    steps.push({ step: '出錯', result: error instanceof Error ? error.stack ?? error.message : String(error), screen: screen() });
  }
  // 出錯也一樣：關掉畫面、把這次寫進去的全部取消。
  handle?.close();
  rendering.restore();
  await state.flush();
  const wrote = written.map(w => w.line);
  const undo = await undoAll(state, written);
  await base.close();
  const freshAfter = await freshSnapshot(host);
  return { capture: !!contents, visibilityBefore: rendering.before, steps, measure: measure.result(), wrote, undo, logAdded: added(logBefore, await logLines(host.app)), todaySame: freshAfter === freshBefore };
}

// ── 切走再回來（L2 的 F4，W6 §2-1）：送 visibilitychange，5 秒與 61 秒後回來 ──
// 這台 Windows 上 Obsidian 被別的視窗擋住也算 hidden，最小化再還原不一定變回 visible（2026-10-27 實測，命令卡在等畫面），
// 所以這裡把 visibilityState 換成假的值再送事件：測的是外掛的接線（停朗讀、Session 的 pause／resume、量測）。
// 真的切換：同一天卡住的那一次在約 120 秒的 hidden 之後回到 visible，卡回到正面、沒有新紀錄；iPhone 的 J8 再驗。

export async function awayCheck(host: ReviewHost): Promise<unknown> {
  const rendering = keepRendering();
  const state = await examplesState(host);
  const logBefore = await logLines(host.app);
  const events: ReviewEvent[] = [];
  const steps: { step: string; result?: unknown }[] = [];
  let handle: ReviewHandle | null = null;
  let fake: DocumentVisibilityState | null = null;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => fake ?? 'visible' });
  const revealed = () => { const v = handle?.session.view(); return v?.kind === 'card' ? v.card.revealed : null; };
  const away = async (ms: number) => {
    fake = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
    await sleep(ms);
    fake = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    await sleep(300);
    return { revealed: revealed(), event: events.filter(e => e.kind === 'away').at(-1) ?? null };
  };
  try {
    handle = openReview({ app: host.app, state, pick: { subject: '自然' }, onEvent: event => { events.push(event); } });
    await until(() => !!overlay()?.querySelector('.ec-q .ec-markdown'));
    press(' ');
    await sleep(100);
    steps.push({ step: '翻面', result: { revealed: revealed() } });
    steps.push({ step: '切走 5 秒', result: await away(5_000) });
    steps.push({ step: '切走 61 秒', result: await away(61_000) });
  } catch (error) {
    steps.push({ step: '出錯', result: error instanceof Error ? error.stack ?? error.message : String(error) });
  } finally {
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    rendering.restore();
  }
  handle?.close();
  await state.flush();
  await state.close();
  return { steps, visibilityAfter: document.visibilityState, logAdded: added(logBefore, await logLines(host.app)) };
}
