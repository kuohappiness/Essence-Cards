import { apiVersion, Component, MarkdownRenderer, Notice, Platform, type App, type Plugin, type TFile } from 'obsidian';
import { assignIds } from '../core/deck/index.ts';
import { encodeEntry, logPath, parseLine } from '../core/study/index.ts';
import type { NewEntry } from '../core/study/index.ts';
import { compareAssigned, compareLists, type ListItem, type Mismatch } from '../dev/compare.ts';
import { runFilesContract } from '../dev/files-contract.ts';
import { scopedFiles } from '../dev/wrap-files.ts';
import { createState, type State } from '../state/index.ts';
import type { IdsWiring, PluginEvent, PluginEvents } from '../main.ts';
import type { ReviewHandle } from '../ui/index.ts';
import type { Pick } from '../core/study/index.ts';
import { createObsidianFiles } from './files.ts';
import { lockTest, saveTest, t1Close, t1Prep, type DevLog, type IdsHost } from './dev-ids.ts';
import { a3Check, eventsTest, recordStart, recordStop, type EventsHost } from './dev-events.ts';
import { markdownCases } from './dev-markdown.ts';
import { awayCheck, deckHashes, openTimes, practice, reviewScript, saveExamples, uiShots, voices, W6_ROOT, watchReview } from './dev-review.ts';
import { CLOUD_ROOT, cloudLate, cloudRead, cloudState, cloudWrite, type Params } from './dev-cloud.ts';

// 只在開發版建置（tools/build.mjs --dev）；AI 在 Windows 版 Obsidian 用 URI 執行，iPhone 用命令面板（W5 說明 §4-4）。
const root = 'Essence W5';
const examples = 'Essence Cards/W5 範例/';
const limit = 20;

/** 外掛本身（main.ts）：開發命令用它正在用的 state、裝置碼、補 ID 的接線，並訂閱它的事件（技術債 A10）。 */
interface Host extends Plugin {
  device: string;
  state: State | null;
  ids: IdsWiring | null;
  lockAlso: string[];
  startReview(pick: Pick): ReviewHandle | null;
  on<K extends PluginEvent>(kind: K, listener: (value: PluginEvents[K]) => void): () => void;
}
/** 載入時記下的數字，每個結果檔都附上（T12）。 */
interface LoadInfo { loadedAt: number; onloadMs: number; beforeLayoutReady: () => number | null }

/**
 * desktop：會寫卡組筆記或只有電腦做得到的命令，只在電腦註冊、只在電腦執行（D-134：iPhone 不寫卡組；Codex 審查第二部分的 F4）。
 * root：結果寫到哪個資料夾（W6 的命令寫 Essence W6/，W6 §4）。params：URI 帶的參數（命令面板執行時是空的）。
 */
interface DevCommand { name: string; run: (host: Host, ids: IdsHost, params: Params) => Promise<unknown>; desktop?: true; root?: string }
/** 事件記錄用的：存檔備援的接線、外掛的 state 與它發出的紀錄（dev-events.ts）。 */
const events = (host: Host): EventsHost => ({ app: host.app, saver: host.ids?.saver ?? null, state: () => host.state, log: listener => host.on('event', listener) });
const commands: Record<string, DevCommand> = {
  compare: { name: 'Essence 開發：metadataCache 對照', run: host => compare(host.app) },
  files: { name: 'Essence 開發：檔案存取', run: host => filesContract(host.app) },
  open: { name: 'Essence 開發：量測第一次打開', run: open },
  today: { name: 'Essence 開發：今天的份', run: today },
  answer: { name: 'Essence 開發：寫一筆再取消', run: answer },
  watch: { name: 'Essence 開發：記錄檔案通知', run: watch },
  // 第二部分（W5 §8-7 的 I7、I8）。
  lock: { name: 'Essence 開發：鎖住 ID', run: (_host, ids) => lockTest(ids), desktop: true },
  save: { name: 'Essence 開發：存檔按鈕與備援', run: (_host, ids) => saveTest(ids), desktop: true },
  t1prep: { name: 'Essence 開發：重新啟用前開兩篇卡組', run: (_host, ids) => t1Prep(ids), desktop: true },
  t1close: { name: 'Essence 開發：重新啟用後關掉那兩篇', run: (_host, ids) => t1Close(ids), desktop: true },
  't1close-cold': { name: 'Essence 開發：冷啟動後關掉那兩篇', run: (_host, ids) => t1Close(ids, true), desktop: true },
  // W6 §4、§6。
  'review-script': { name: 'Essence 開發：自動複習', run: reviewScript, root: W6_ROOT },
  voices: { name: 'Essence 開發：系統語音', run: () => voices(), root: W6_ROOT },
  'w6-save': { name: 'Essence 開發：W6 範例存檔', run: saveExamples, desktop: true, root: W6_ROOT },
  decks: { name: 'Essence 開發：卡組內容', run: deckHashes, root: W6_ROOT },
  'open-times': { name: 'Essence 開發：打開三次', run: openTimes, root: W6_ROOT },
  ui: { name: 'Essence 開發：畫面與鍵盤', run: host => uiShots(host, `${W6_ROOT}/結果/畫面 ${stampOf(new Date())}`), desktop: true, root: W6_ROOT },
  'ui-phone': { name: 'Essence 開發：畫面與鍵盤（手機寬度）', run: host => uiShots(host, `${W6_ROOT}/結果/畫面 手機寬度 ${stampOf(new Date())}`, true), desktop: true, root: W6_ROOT },
  away: { name: 'Essence 開發：切走再回來', run: awayCheck, desktop: true, root: W6_ROOT },
  // D-145 的 iPhone 實測：iPhone 也能用。
  practice: { name: 'Essence 開發：範例從頭練（不記紀錄）', run: practice, root: W6_ROOT },
  // Codex 審查 F3～F5：卡片內容的後處理在 Obsidian 真的渲染結果上（圖、公式、粗體、連結）。
  'md-cases': { name: 'Essence 開發：卡片內容的後處理', run: host => markdownCases(host.app), root: W6_ROOT },
  errors: { name: 'Essence 開發：錯誤紀錄', run: () => Promise.resolve({ visibility: document.visibilityState, errors: errors.slice(-50) }), root: W6_ROOT },
  // 卡組讀不到就跳過那一篇的收尾（state-load §6、§9）：現在有哪些讀不到、自己隔一段時間重試。不等 ready()：列不出來時它不會完成。
  unread: { name: 'Essence 開發：讀不到的卡組與紀錄', run: host => Promise.resolve(host.state ? { unread: host.state.unread(), decks: host.state.decks().length } : { state: null }) },
  // 第一個里程碑報告 R5（技術債 A3、T3）：直接訂閱 workspace 與 vault 的事件。
  events: { name: 'Essence 開發：記錄 workspace 與 vault 事件', run: host => eventsTest(events(host)), desktop: true },
  'record-start': { name: 'Essence 開發：開始記錄事件（之後在檔案總管操作）', run: host => recordStart(events(host)), desktop: true },
  'record-stop': { name: 'Essence 開發：停止記錄事件', run: host => recordStop(events(host)), desktop: true },
  // A3 設計稿〈Codex 回應〉要的實測：快速開關、側欄、分割、疊放、setViewState、版面切換、按鈕、Canvas。
  a3check: { name: 'Essence 開發：開著的卡組（A3 實測）', run: host => a3Check(events(host)), desktop: true },
  // 重新載入整個 Obsidian 視窗（Obsidian 的「重新載入」命令）：冷啟動，背景分頁還原成未載入（t1prep → app-reload → t1close-cold）。
  // 結果檔只表示已經排定重新載入；有沒有冷啟動，看 t1close-cold 的 deferred。t1prep 之後至少等 10 秒再執行，讓 Obsidian 先存好版面
  // （2026-10-28 只等 5 秒時有一次重新載入後沒有還原那兩個分頁）。
  'app-reload': { name: 'Essence 開發：重新載入 Obsidian 視窗', run: host => { window.setTimeout(() => { (host.app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById('app:reload'); }, 1000); return Promise.resolve({ reloading: true }); }, desktop: true },
  // D-154 第 3 點的 Windows 分段實測（tasks/icloud-placeholders.md §1）：URI 帶參數，佔位狀態由 PowerShell 做出並確認。
  'cloud-read': { name: 'Essence 開發：讀一個佔位檔', run: (host, _ids, params) => cloudRead(host.app, params), desktop: true, root: CLOUD_ROOT },
  'cloud-write': { name: 'Essence 開發：佔位檔的追加寫入', run: (host, _ids, params) => cloudWrite(host.app, params), desktop: true, root: CLOUD_ROOT },
  'cloud-state': { name: 'Essence 開發：佔位檔的測試 state', run: (host, _ids, params) => cloudState(host.app, params), desktop: true, root: CLOUD_ROOT },
  'cloud-late': { name: 'Essence 開發：佔位檔晚回來的讀寫', run: () => cloudLate(), desktop: true, root: CLOUD_ROOT },
};

/** 開發版收集 console.error 與沒接住的錯誤（errors 命令寫出來；AI 看不到 Obsidian 的 console）。 */
const errors: string[] = [];
function collectErrors(plugin: Plugin): void {
  const original = console.error;
  const text = (value: unknown): string => value instanceof Error ? value.stack ?? value.message : typeof value === 'string' ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  const push = (line: string) => { errors.push(new Date().toISOString().slice(11, 19) + ' ' + line.slice(0, 2000)); if (errors.length > 200) errors.shift(); };
  console.error = (...args: unknown[]) => { push(args.map(text).join(' ')); original.apply(console, args); };
  plugin.register(() => { console.error = original; });
  plugin.registerDomEvent(window, 'error', event => { push('error: ' + text(event.error ?? event.message)); });
  plugin.registerDomEvent(window, 'unhandledrejection', event => { push('unhandledrejection: ' + text(event.reason)); });
}

export function registerDev(plugin: Host, load: LoadInfo): void {
  collectErrors(plugin);
  // 開發命令 lock 在 Essence W5/暫存/ 的卡組副本上測各種編輯，那裡也要鎖 ID。
  plugin.lockAlso.push('Essence W5/暫存/');
  // 存檔按鈕、提示與編輯器鎖定的紀錄：訂閱外掛的事件，自己記（main.ts 不再有開發用的欄位）。
  const devLog: DevLog = { notices: [], events: [], removed: [], tokens: plugin.ids?.tokens ?? null, save: plugin.ids?.saver ?? null };
  plugin.on('notice', message => { devLog.notices.push(message); });
  plugin.on('event', event => { devLog.events.push(event); });
  plugin.on('removed', removed => { devLog.removed.push(removed); });
  // W6 §4 的自動量測：每次打開複習畫面記下來，關掉時寫一個檔。
  watchReview(plugin, (code, data) => writeResult(plugin.app, code, plugin.device, data, W6_ROOT));
  const ids: IdsHost = { app: plugin.app, get state() { return plugin.state; }, devLog };
  let runs = 0;
  async function run(code: string, params: Params = {}): Promise<void> {
    const command = Object.hasOwn(commands, code) ? commands[code] : undefined;
    if (!command) { new Notice('Essence 開發：沒有「' + code + '」'); return; }
    // 命令面板與 URI 都經過這裡：手機上不執行會寫卡組的命令。
    if (command.desktop && !Platform.isDesktopApp) { new Notice('Essence 開發：「' + code + '」只在電腦上執行'); return; }
    runs++;
    const startedAt = performance.now();
    let result: unknown;
    try { result = await command.run(plugin, ids, params); }
    catch (error) { result = { error: error instanceof Error ? error.stack ?? error.message : String(error) }; }
    const path = await writeResult(plugin.app, code, plugin.device, {
      code, device: plugin.device, platform: Platform.isIosApp ? 'ios' : Platform.isAndroidApp ? 'android' : 'desktop',
      obsidian: apiVersion, plugin: plugin.manifest.version,
      onloadMs: Math.round(load.onloadMs * 10) / 10, filesCallsBeforeLayoutReady: load.beforeLayoutReady(),
      sinceLoadMs: Math.round(startedAt - load.loadedAt), run: runs, ms: Math.round(performance.now() - startedAt), result,
    }, command.root);
    new Notice(command.name.replace('Essence 開發：', '') + '完成\n' + path);
  }
  for (const [code, command] of Object.entries(commands)) {
    if (command.desktop && !Platform.isDesktopApp) continue;
    plugin.addCommand({ id: 'dev-' + code, name: command.name, callback: () => { void run(code); } });
  }
  plugin.registerObsidianProtocolHandler('essence-cards-dev', params => {
    // reload：重新安裝開發版之後，不關 Obsidian 就換成新的 main.js（用 Obsidian 未公開的 app.plugins）。
    if (params.run === 'reload') {
      const plugins = (plugin.app as unknown as { plugins: { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<void> } }).plugins;
      const id = plugin.manifest.id;
      void plugins.disablePlugin(id).then(() => plugins.enablePlugin(id)).then(() => { new Notice('Essence 開發：已重新載入'); });
    } else void run(params.run ?? '', params);
  });
}

async function ready(host: Host): Promise<State> {
  if (!host.state) throw Error('state 還沒建立（layout 還沒 ready）');
  await host.state.ready();
  return host.state;
}

const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });

/** §4-4 open：對 Essence W5/量測/ 建一個新的 state，記下 ready() 的時間與資料量，量完就關。 */
async function open(host: Host): Promise<unknown> {
  const state = createState({ files: scopedFiles(createObsidianFiles(host.app), root + '/量測'), device: host.device, fillIds: false });
  try {
    const timings = await state.ready();
    const value = state.today();
    const { reviews, changes, problems } = state.history();
    return {
      timings: { decks: Math.round(timings.decks), history: Math.round(timings.history), plan: Math.round(timings.plan), total: Math.round(timings.total) },
      historyPlusPlan: Math.round(timings.history + timings.plan),
      lines: { reviews: reviews.length, changes: changes.length, problems: problems.length },
      decks: state.decks().length, targets: state.decks().reduce((n, d) => n + d.deck.targets.length, 0),
      share: value.share.length, more: value.more.length,
    };
  } finally { await state.close(); }
}

/** §4-4 today：外掛正在用的 state 的今天的份；lt 清單只在測試 vault 的 W5 範例（三篇）上產生。 */
async function today(host: Host): Promise<unknown> {
  const state = await ready(host);
  const value = state.today();
  return {
    decks: state.decks().map(d => d.path),
    day: value.day, offset: value.offset,
    share: value.share.map(item => item.lt), more: value.more.map(item => item.lt),
    problems: value.problems.slice(0, limit),
    progress: state.progress(),
  };
}

/** §4-4 answer：W5 範例路徑排第一的卡組的第一個目標寫一筆 good，讀回檔案，再取消它。 */
async function answer(host: Host): Promise<unknown> {
  const state = await ready(host);
  const deck = state.decks().find(d => d.path.startsWith(examples));
  const target = deck?.deck.targets[0];
  if (!deck || !target?.id || !target.prompts.length) throw Error('找不到 ' + examples + ' 的卡組，或第一個目標沒有 ID 或題目');
  const snapshot = () => {
    const value = state.today();
    return JSON.stringify({ day: value.day, share: value.share, more: value.more });
  };
  const todayBefore = snapshot();
  const before = { reviews: state.history().reviews.length, progress: state.progress() };
  // 寫一筆、等寫完，回傳 encodeEntry 的結果與它的檔案（和 state 寫檔的路徑相同）。
  async function write(entry: NewEntry) {
    const t = state.answer(entry);
    const line = encodeEntry(t, entry);
    const stamp = parseLine(line);
    if (!stamp) throw Error('寫出的紀錄無法解析：' + line);
    await state.flush();
    return { t, line, path: logPath(host.device, stamp.at, stamp.offset) };
  }
  const good = await write({ lt: target.id, r: 'good', v: target.prompts[0].fingerprint });
  const afterGood = { reviews: state.history().reviews.length, progress: state.progress() };
  const undo = await write({ undo: good.t });
  const lines = (await createObsidianFiles(host.app).read(good.path) ?? '').split('\n').filter(Boolean);
  return {
    deck: deck.path, lt: target.id, path: good.path, samePath: good.path === undo.path,
    wrote: [good.line, undo.line], readBack: lines.slice(-2),
    readBackMatches: lines.at(-2) === good.line && lines.at(-1) === undo.line,
    reviews: { before: before.reviews, afterGood: afterGood.reviews, afterUndo: state.history().reviews.length },
    goodGone: !state.history().reviews.some(r => r.t === good.t),
    progress: { before: before.progress, afterGood: afterGood.progress, afterUndo: state.progress() },
    todaySame: snapshot() === todayBefore,
  };
}

/** §4-4 watch：60 秒內 onChange 與 history().reviews 長度的變化（測別台裝置的紀錄進來）。 */
async function watch(host: Host): Promise<unknown> {
  const state = await ready(host);
  const start = performance.now();
  const at = () => Math.round(performance.now() - start);
  const events: { ms: number; kind: 'onChange' | 'reviews'; reviews: number }[] = [];
  const initial = state.history().reviews.length;
  let reviews = initial;
  const stop = state.onChange(() => { events.push({ ms: at(), kind: 'onChange', reviews: state.history().reviews.length }); });
  try {
    while (performance.now() - start < 60_000) {
      await sleep(250);
      const count = state.history().reviews.length;
      if (count !== reviews) { reviews = count; events.push({ ms: at(), kind: 'reviews', reviews: count }); }
    }
  } finally { stop(); }
  return {
    initial, final: reviews,
    onChange: events.filter(e => e.kind === 'onChange').length,
    events: events.slice(0, limit), more: Math.max(0, events.length - limit),
  };
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  let path = '';
  for (const part of folder.split('/')) {
    path = path ? path + '/' + part : part;
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
  }
}

function stampOf(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function writeResult(app: App, code: string, device: string, data: unknown, folder = root): Promise<string> {
  const stamp = stampOf(new Date());
  await ensureFolder(app, folder + '/結果');
  let path = `${folder}/結果/${code} ${device} ${stamp}.json`;
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = `${folder}/結果/${code} ${device} ${stamp}-${n}.json`;
  await app.vault.create(path, JSON.stringify(data, null, 2));
  return path;
}

/** 寫入（內容不同時）並等 metadataCache 重新解析這一篇。 */
async function writeIndexed(app: App, path: string, text: string): Promise<TFile> {
  await ensureFolder(app, path.slice(0, path.lastIndexOf('/')));
  const existing = app.vault.getFileByPath(path);
  if (existing && await app.vault.read(existing) === text && app.metadataCache.getFileCache(existing)) return existing;
  const indexed = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { app.metadataCache.offref(ref); reject(Error('metadataCache 沒有更新：' + path)); }, 10000);
    const ref = app.metadataCache.on('changed', file => {
      if (file.path !== path) return;
      window.clearTimeout(timer); app.metadataCache.offref(ref); resolve();
    });
  });
  let file = existing;
  if (file) await app.vault.modify(file, text);
  else file = await app.vault.create(path, text);
  await indexed;
  return file;
}

function listItems(app: App, file: TFile): ListItem[] {
  return (app.metadataCache.getFileCache(file)?.listItems ?? []).map(item => ({
    line: item.position.start.line, end: item.position.end.line, parent: item.parent, ...(item.id ? { id: item.id } : {}),
  }));
}

/** §0-3：每個例子寫成筆記，和 metadataCache 比 (a)～(d)；補 ID 後存到「補ID後/」再比一次，加上 (e)。 */
async function compare(app: App): Promise<unknown> {
  const folder = root + '/對照';
  const source = app.vault.getFileByPath(folder + '/cases.json');
  if (!source) throw Error('找不到 ' + folder + '/cases.json；先在電腦執行 npm run export-compare');
  const cases = JSON.parse(await app.vault.read(source)) as { name: string; text: string }[];
  const found: (Mismatch & { case: string; stage: 'before' | 'after' })[] = [];
  let changedOnDisk = 0;
  for (const { name, text } of cases) {
    const file = await writeIndexed(app, `${folder}/${name}.md`, text);
    const written = await app.vault.read(file);
    if (written !== text) changedOnDisk++;
    for (const m of compareLists(written, listItems(app, file))) found.push({ case: name, stage: 'before', ...m });
    const assigned = assignIds(written, { taken: new Set() }).text;
    const after = await writeIndexed(app, `${folder}/補ID後/${name}.md`, assigned);
    for (const m of compareAssigned(await app.vault.read(after), listItems(app, after))) found.push({ case: name, stage: 'after', ...m });
  }
  // 有不一致的前幾篇，附上 metadataCache 的原始 listItems 與閱讀模式畫出來的清單（每篇只有幾項），判斷原因用。
  // 補 ID 之後還不一致的排前面（存檔之後家長看到的），再來是補 ID 之前的。
  const detail: Record<string, { cache: ListItem[]; reading: string[]; after?: ListItem[]; afterReading?: string[] }> = {};
  const order = [...new Set([...found.filter(m => m.stage === 'after' && (m.rule === 'd' || m.rule === 'e')), ...found].map(m => m.case))];
  for (const name of order.slice(0, 10)) {
    const file = app.vault.getFileByPath(`${folder}/${name}.md`);
    const after = app.vault.getFileByPath(`${folder}/補ID後/${name}.md`);
    if (file) detail[name] = { cache: listItems(app, file), reading: await reading(app, await app.vault.read(file), file.path), ...(after ? { after: listItems(app, after), afterReading: await reading(app, await app.vault.read(after), after.path) } : {}) };
  }
  // 第二部分 I2：M1（縮排多一層）補 ID 後縮排改回一層，metadataCache 與閱讀模式都把題目當成目標的子項目（D-135）。
  const m1 = app.vault.getFileByPath(folder + '/補ID後/M1.md');
  const m1Text = m1 ? await app.vault.read(m1) : null;
  const m1Check = m1 && m1Text !== null ? { text: m1Text, cache: listItems(app, m1), reading: await reading(app, m1Text, m1.path) } : null;
  return {
    m1: m1Check,
    cases: cases.length, changedOnDisk,
    mismatches: found.length,
    before: found.filter(m => m.stage === 'before').length,
    after: found.filter(m => m.stage === 'after').length,
    byCase: found.reduce<Record<string, string[]>>((all, m) => ({ ...all, [m.case]: [...all[m.case] ?? [], m.stage + ':' + m.rule] }), {}),
    first: found.slice(0, limit),
    detail,
  };
}

/** 閱讀模式畫出來的清單：每個項目一行「層數:自己的文字」（不含子清單），看家長實際看到的結構。 */
async function reading(app: App, text: string, path: string): Promise<string[]> {
  const el = document.createElement('div');
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, text, el, path, component);
    return Array.from(el.querySelectorAll('li')).map(li => {
      let depth = 0;
      for (let p = li.parentElement; p && p !== el; p = p.parentElement) if (p.tagName === 'LI') depth++;
      const own = Array.from(li.childNodes).filter(node => !(node instanceof HTMLElement && /^(UL|OL)$/.test(node.tagName)))
        .map(node => node.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
      return depth + ':' + own.slice(0, 40);
    });
  } finally { component.unload(); }
}

/** §2：在 Essence W5/暫存/ 跑 C1～C15；先清掉上一次留下的暫存檔（只有這個命令會寫那裡）。 */
async function filesContract(app: App): Promise<unknown> {
  const dir = root + '/暫存';
  const old = app.vault.getAbstractFileByPath(dir);
  if (old) await app.vault.delete(old, true);
  const entry = (path: string) => {
    const found = app.vault.getAbstractFileByPath(path);
    if (!found) throw Error('找不到 ' + path);
    return found;
  };
  const results = await runFilesContract(createObsidianFiles(app), {
    rename: (from, to) => app.vault.rename(entry(from), to),
    remove: path => app.vault.delete(entry(path), true),
  }, dir, { notice: 3000, quiet: 500 });
  return { passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
}
