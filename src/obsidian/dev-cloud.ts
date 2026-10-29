import { MarkdownView, type App } from 'obsidian';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Files } from '../core/files.ts';
import { createLogWriter, encodeEntry, logPath } from '../core/study/index.ts';
import type { LogWriter, NewEntry } from '../core/study/index.ts';
import { scopedFiles } from '../dev/wrap-files.ts';
import { createState, type State } from '../state/index.ts';
import { createObsidianFiles } from './files.ts';
import type { Saver } from './save.ts';

// D-154 第 3 點的 Windows 分段實測（tasks/icloud-placeholders.md §1）。佔位狀態由 PowerShell 做出並確認（attrib -P +U、
// RecallOnDataAccess），這裡每次只做一個動作：記結果、花了多久與錯誤的欄位。只碰 Essence 佔位檔/。
export const CLOUD_ROOT = 'Essence 佔位檔';
const WRITE_ROOT = CLOUD_ROOT + '/寫入';
const STATE_ROOT = CLOUD_ROOT + '/state';
/** 觀察期限（毫秒）：到期還沒回來記「未完成」，不當成已取消；之後才回來的記在 late（cloud-late 讀）。 */
const LIMIT = 120_000;

export type Params = Record<string, string | undefined>;
interface ErrorFields { name?: string; message: string; code?: unknown; errno?: unknown; syscall?: unknown }
type Observed<T> = { outcome: 'resolved'; ms: number; value: T } | { outcome: 'rejected'; ms: number; error: ErrorFields } | { outcome: 'pending'; ms: number };

const late: { label: string; at: string; outcome: 'resolved' | 'rejected'; ms: number; detail: unknown }[] = [];

function fields(error: unknown): ErrorFields {
  if (!(error instanceof Error)) return { message: String(error) };
  const { code, errno, syscall } = error as Error & { code?: unknown; errno?: unknown; syscall?: unknown };
  return { name: error.name, message: error.message, code, errno, syscall };
}

/** 等 work 到 limit 為止；沒回來就記 pending，之後回來時記進 late（summary 把結果縮成能寫進 JSON 的樣子）。 */
async function observe<T>(label: string, work: () => Promise<T>, limit: number, summary: (value: T) => unknown = value => value): Promise<Observed<T>> {
  const start = performance.now();
  const ms = () => Math.round(performance.now() - start);
  const task: Promise<Observed<T>> = Promise.resolve().then(work)
    .then(value => ({ outcome: 'resolved' as const, ms: ms(), value }), (error: unknown) => ({ outcome: 'rejected' as const, ms: ms(), error: fields(error) }));
  let timer = 0;
  const deadline = new Promise<Observed<T>>(resolve => { timer = window.setTimeout(() => { resolve({ outcome: 'pending', ms: ms() }); }, limit); });
  const first = await Promise.race([task, deadline]);
  window.clearTimeout(timer);
  if (first.outcome === 'pending') {
    void task.then(done => {
      if (done.outcome === 'pending') return;
      late.push({ label, at: new Date().toISOString(), outcome: done.outcome, ms: done.ms, detail: done.outcome === 'resolved' ? summary(done.value) : done.error });
    });
  }
  return first;
}

/** 讀到的內容：位元組數、SHA-256、文字（UTF-8）；小於 4 KB 附 base64，讀成空白或少一截時看得到原樣。 */
function content(bytes: Uint8Array): { bytes: number; sha256: string; text: string; base64?: string } {
  const text = new TextDecoder().decode(bytes);
  return { bytes: bytes.length, sha256: bytesToHex(sha256(bytes)), text, ...(bytes.length <= 4096 ? { base64: btoa(String.fromCharCode(...bytes)) } : {}) };
}

const limitOf = (params: Params): number => params.limit ? Number(params.limit) : LIMIT;
function node(app: App): { full: (path: string) => string; stat: (full: string) => Promise<Record<string, number>> } {
  const load = (window as unknown as { require?: (name: string) => unknown }).require;
  if (!load) throw Error('這裡沒有 require（不是電腦版）');
  const fs = load('fs') as { promises: { stat(path: string): Promise<Record<string, number>> } };
  return { full: path => (app.vault.adapter as unknown as { getFullPath(path: string): string }).getFullPath(path), stat: full => fs.promises.stat(full) };
}

/**
 * E2、E3、E7：用一種方法讀一個檔（params.target，vault 內的路徑；不能叫 path：Obsidian 用 URI 的 path 參數找 vault，
 * 找不到就跳出 Vault not found，命令不會執行）。api：files（Files.read，即 vault.read）、
 * binary（vault.adapter.readBinary）、stat（Node 的 fs.promises.stat；只記 size、blocks，不當成判斷方法）。
 */
export async function cloudRead(app: App, params: Params): Promise<unknown> {
  const path = params.target, api = params.api ?? 'files';
  if (!path?.startsWith(CLOUD_ROOT + '/')) throw Error('target 要在 ' + CLOUD_ROOT + '/ 底下');
  const label = `${api} ${path}`;
  if (api === 'files') {
    const read = await observe(label, () => createObsidianFiles(app).read(path), limitOf(params), text => text === null ? null : content(new TextEncoder().encode(text)));
    return { path, api, ...read, ...(read.outcome === 'resolved' ? { value: read.value === null ? null : content(new TextEncoder().encode(read.value)) } : {}) };
  }
  if (api === 'binary') {
    const read = await observe(label, () => app.vault.adapter.readBinary(path), limitOf(params), buffer => content(new Uint8Array(buffer)));
    return { path, api, ...read, ...(read.outcome === 'resolved' ? { value: content(new Uint8Array(read.value)) } : {}) };
  }
  if (api === 'stat') {
    const { full, stat } = node(app);
    const pick = (s: Record<string, number>) => ({ size: s.size, blocks: s.blocks, blksize: s.blksize, mtimeMs: s.mtimeMs });
    const read = await observe(label, () => stat(full(path)), limitOf(params), pick);
    return { path, api, ...read, ...(read.outcome === 'resolved' ? { value: pick(read.value) } : {}) };
  }
  throw Error('api 只能是 files、binary、stat：' + api);
}

/** 之後才回來的讀取與寫入（到期時記成 pending 的）。 */
export const cloudLate = (): Promise<unknown> => Promise.resolve({ late });

interface Log { writer: LogWriter; device: string; lines: string[]; errors: { at: string; error: ErrorFields }[] }
/** 同時可以寫幾份（params.slot，預設 a）：同一次停掉 iCloud 裡比較停著時寫入之後的不同做法。 */
const logs = new Map<string, Log>();

/**
 * W1：在 Essence 佔位檔/寫入/ 用 scopedFiles 建一個 createLogWriter（和外掛寫紀錄同一條路：vault.append）。
 * step：seed（新的裝置碼、寫兩行、flush）、append（寫一行、flush）、flush（只 flush；寫失敗後恢復時用）。
 * 回傳應該在檔案裡的全部內容（expected），由呼叫端和實際讀到的比對。
 */
export async function cloudWrite(app: App, params: Params): Promise<unknown> {
  const step = params.step ?? 'append', slot = params.slot ?? 'a';
  if (step === 'seed') {
    // 每次 seed 換一個裝置碼，檔案一定是新的。
    const device = 'W1-' + Date.now().toString(36).slice(-5);
    const errors: Log['errors'] = [];
    logs.set(slot, { writer: createLogWriter(scopedFiles(createObsidianFiles(app), WRITE_ROOT), { device, onError: error => { errors.push({ at: new Date().toISOString(), error: fields(error) }); } }), device, lines: [], errors });
  }
  const current = logs.get(slot);
  if (!current) throw Error('先執行 step=seed（slot=' + slot + '）');
  const add = (): void => {
    const n = current.lines.length + 1;
    // 中英混合、有 emoji：比對位元組時能看出編碼或截斷。
    const entry: NewEntry = { lt: 'k3m9x2', r: 'good', v: `第${n}行 line ${n} 🙂` };
    current.lines.push(encodeEntry(current.writer.write(entry), entry));
  };
  if (step === 'seed') { add(); add(); }
  else if (step === 'append') add();
  else if (step !== 'flush') throw Error('step 只能是 seed、append、flush：' + step);
  const flush = await observe(`flush ${current.device}`, () => current.writer.flush(), limitOf(params), () => 'flushed');
  const expected = content(new TextEncoder().encode(current.lines.map(line => line + '\n').join('')));
  const at = Date.now(), offset = -new Date(at).getTimezoneOffset();
  return { step, slot, device: current.device, path: WRITE_ROOT + '/' + logPath(current.device, at, offset), lines: current.lines.length, flush, expected, errors: current.errors };
}

interface Trial { state: State; poke: (path: string) => void; opened: number; ready: 'pending' | { ms: number } | { error: ErrorFields }; changes: { at: string; unread: readonly string[] }[]; errors: { at: string; source: string; error: ErrorFields }[] }
/** 同時可以開幾份（params.slot，預設 a）：同一次停掉 iCloud 裡，一份載入後才讀不到、一份第一次載入就讀不到。 */
const trials = new Map<string, Trial>();

/** 測試 state 的 Files：另外記下 watch 的回呼，poke 可以送一個「這個檔變了」的通知（載入後才讀不到的情況）。 */
function pokeable(files: Files): { files: Files; poke: (path: string) => void } {
  const listeners = new Set<(path: string) => void>();
  return {
    files: { ...files, watch: onChange => { listeners.add(onChange); const stop = files.watch(onChange); return () => { listeners.delete(onChange); stop(); }; } },
    poke: path => { for (const listener of listeners) listener(path); },
  };
}

function status(current: Trial): Record<string, unknown> {
  const { state } = current;
  const loaded = typeof current.ready === 'object' && 'ms' in current.ready;
  return {
    sinceOpenMs: Math.round(performance.now() - current.opened), ready: current.ready, unread: state.unread(),
    decks: loaded ? state.decks().map(d => ({ path: d.path, targets: d.deck.targets.map(t => t.name) })) : null,
    reviews: loaded ? state.history().reviews.length : null, seen: loaded ? state.history().seen : null,
    onChange: current.changes.length, changes: current.changes, errors: current.errors,
  };
}

/**
 * E5：對 Essence 佔位檔/state/ 底下的測試卡組與紀錄建一個 state（不是外掛正在用的那一個；fillIds 關掉，不寫卡組）。
 * step：open（建新的、等 ready 到 limit）、poke（送 params.target 的變動通知，等 wait 毫秒）、status、close。
 */
export async function cloudState(app: App, params: Params): Promise<unknown> {
  const step = params.step ?? 'status', name = params.slot ?? 'a';
  if (step === 'open') {
    await trials.get(name)?.state.close();
    const { files, poke } = pokeable(scopedFiles(createObsidianFiles(app), STATE_ROOT));
    const errors: Trial['errors'] = [];
    const state = createState({ files, device: 'cloud-test', fillIds: false, delay: 200, onError: (error, source) => { errors.push({ at: new Date().toISOString(), source, error: fields(error) }); } });
    const current: Trial = { state, poke, opened: performance.now(), ready: 'pending', changes: [], errors };
    trials.set(name, current);
    state.onChange(() => { current.changes.push({ at: new Date().toISOString(), unread: state.unread() }); });
    const start = performance.now();
    state.ready().then(() => { current.ready = { ms: Math.round(performance.now() - start) }; }, (error: unknown) => { current.ready = { error: fields(error) }; });
    await observe('state ready', () => state.ready(), limitOf(params));
    return { name, ...status(current) };
  }
  const trial = trials.get(name);
  if (!trial) throw Error('先執行 step=open（slot=' + name + '）');
  if (step === 'poke') {
    if (!params.target) throw Error('poke 要帶 target（state 底下的路徑，例如 Essence Cards/測試.md）');
    trial.poke(params.target);
    await new Promise<void>(resolve => { window.setTimeout(resolve, Number(params.wait ?? 2000)); });
    return { name, ...status(trial) };
  }
  if (step === 'status') return { name, ...status(trial) };
  if (step === 'close') {
    const { state } = trial;
    const done = await observe('state close', () => state.close(), limitOf(params), () => 'closed');
    trials.delete(name);
    return { name, close: done };
  }
  throw Error('step 只能是 open、poke、status、close：' + step);
}

/** saveBlocked 用的：外掛的 app、state、存檔按鈕的接線與提示的訂閱（dev.ts 從外掛本身接過來）。 */
export interface SaveHost { app: App; state: State | null; saver: Saver | null; notices: (listener: (message: string) => void) => () => void }

/**
 * D-154 第 2 點的 Windows 對照（tasks/icloud-placeholders.md §2）：在分頁打開 params.target 這篇卡組（已經開著就用那一個），
 * 記下存檔按鈕的說明，按一次存檔（和按鈕同一個 saver.save），記下提示、存檔後的說明、編輯器的文字與 state.unread()。
 * params.close=1：做完關掉那個分頁。
 */
export async function saveBlocked(host: SaveHost, params: Params): Promise<unknown> {
  const { app, state, saver } = host;
  if (!state || !saver) throw Error('state 或存檔按鈕還沒接好（只在電腦）');
  const path = params.target, file = path ? app.vault.getFileByPath(path) : null;
  if (!path || !file) throw Error('找不到 target：' + String(path));
  const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
  let leaf = app.workspace.getLeavesOfType('markdown').find(l => l.view instanceof MarkdownView && l.view.file?.path === path);
  if (!leaf) { leaf = app.workspace.getLeaf('tab'); await leaf.openFile(file); await sleep(500); }
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) throw Error('打開的不是 Markdown 編輯器');
  const label = () => { saver.refresh(); return view.containerEl.querySelector('.essence-cards-save')?.getAttribute('aria-label') ?? null; };
  const before = { tip: label(), unread: state.unread(), text: view.editor.getValue() };
  const notices: string[] = [];
  const stop = host.notices(message => { notices.push(message); });
  try { await saver.save(view); await sleep(300); } finally { stop(); }
  const after = { tip: label(), unread: state.unread(), text: view.editor.getValue() };
  if (params.close === '1') leaf.detach();
  return { path, before, notices, after };
}
