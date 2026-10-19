import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ItemView, Notice, Plugin, PluginSettingTab, Setting, type WorkspaceLeaf, type App } from 'obsidian';
import { Review, type ReviewControl, type History } from './Review';
import { createData, ensureFolder } from './data';
import { delay, device, fullscreenCheck, readRecords, Reporter, SessionMetrics, twoFrames, type Settings } from './metrics';
import { ratings, reviewLine, undoLine, uniqueClock, type RecordLine } from './logic';
import { samples } from './samples';
declare const __EC_FRAMEWORK__: string;
declare const __ecT0: number;

class ReviewSession {
  host: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
  control: { current: ReviewControl | null } = { current: null };
  metrics: SessionMetrics;
  closed = false;
  notice = '';
  // 自動量測與連續複習把每次開啟的數字併進自己的結果檔，不另外寫「開啟」「手勢」檔。
  private quiet: boolean;
  private previousFocus: HTMLElement | null;
  private cleanup: (() => void)[] = [];
  private closing?: Promise<void>;
  constructor(public plugin: Prototype, public container: HTMLElement, public leaf?: WorkspaceLeaf, public onRate?: (entry: History, previous?: string) => string | undefined) {
    this.metrics = new SessionMetrics(!plugin.hasOpened, { ...plugin.settings }); plugin.hasOpened = true;
    // 命令起點由 open() 在建立分頁之前記下。
    this.metrics.openedAt = plugin.commandAt;
    this.quiet = !!plugin.run;
    this.previousFocus = document.activeElement as HTMLElement | null;
    this.host = document.createElement('div'); this.host.className = 'ec-host' + (leaf ? '' : ' ec-fullscreen'); this.host.tabIndex = -1;
    this.host.setAttribute('role', leaf ? 'region' : 'dialog'); this.host.setAttribute('aria-label', plugin.label + ' 複習');
    if (!leaf) this.host.setAttribute('aria-modal', 'true');
    container.append(this.host);
    const stop = (e: TouchEvent) => { if (this.metrics.settings.intercept) e.stopPropagation(); };
    if (!leaf) {
      this.host.addEventListener('touchstart', stop, { passive: true }); this.host.addEventListener('touchmove', stop, { passive: true });
      this.cleanup.push(() => { this.host.removeEventListener('touchstart', stop); this.host.removeEventListener('touchmove', stop); });
      const trap = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        const items = [...this.host.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href]')];
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === this.host.querySelector('.ec-app'))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      };
      this.host.addEventListener('keydown', trap); this.cleanup.push(() => this.host.removeEventListener('keydown', trap));
    }
    this.root = createRoot(this.host); this.render();
  }
  render() { this.root.render(createElement(Review, { app: this.plugin.app, metrics: this.metrics, close: () => { this.plugin.cancelRun(); void this.close().catch(() => {}); }, control: this.control, onRate: this.onRate, notice: this.notice })); }
  async ready() {
    const start = performance.now();
    while (!this.closed && (this.metrics.paintedMs === undefined || !this.control.current)) {
      if (performance.now() - start > 12000) throw Error('複習畫面 12 秒內未完成渲染');
      await delay(16);
    }
    if (this.closed) throw Error('複習已關閉');
    this.host.querySelector<HTMLElement>('.ec-app')?.focus();
    if (!this.leaf) this.metrics.fullscreen.push({ kind: 'open', ...fullscreenCheck(this.host) });
  }
  close(detach = true) {
    if (this.closing) return this.closing;
    this.closed = true;
    this.root.unmount(); this.cleanup.forEach(fn => fn()); this.host.remove();
    this.previousFocus?.isConnected && this.previousFocus.focus();
    if (this.plugin.session === this) this.plugin.session = undefined;
    if (detach) this.leaf?.detach();
    this.closing = this.finish();
    return this.closing;
  }
  private async finish() {
    await this.metrics.settle();
    if (this.quiet) return;
    try {
      await this.plugin.reporter.write('開啟', { opening: this.metrics.opening(), animations: this.metrics.animations, markdown: this.metrics.markdown }, this.metrics.settings);
      await this.plugin.reporter.write('手勢', { touches: this.metrics.gestures, scrolls: this.metrics.scrolls }, this.metrics.settings);
    } catch (error) { new Notice('量測結果寫入失敗：' + String(error)); throw error; }
  }
}
class ReviewView extends ItemView {
  session?: ReviewSession;
  constructor(leaf: WorkspaceLeaf, private plugin: Prototype) { super(leaf); }
  getViewType() { return this.plugin.viewType; }
  getDisplayText() { return this.plugin.label + ' 複習'; }
  getIcon() { return 'layers'; }
  async onOpen() { this.contentEl.replaceChildren(); this.contentEl.style.padding = '0'; this.session = this.plugin.mount(this.contentEl, this.leaf); }
  async onClose() { if (this.session && !this.session.closed) this.plugin.cancelRun(); await this.session?.close(false); }
}
class SettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: Prototype) { super(app, plugin); }
  display() {
    const { containerEl } = this; containerEl.empty();
    new Setting(containerEl).setName(this.plugin.label + ' 顯示方式').addDropdown(d => d.addOption('fullscreen', '全螢幕').addOption('tab', '分頁').setValue(this.plugin.settings.mode).onChange(async v => { this.plugin.settings.mode = v as Settings['mode']; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName('攔截觸控事件').setDesc('全螢幕時阻止 touchstart／touchmove 傳給 Obsidian；下次開啟生效。').addToggle(t => t.setValue(this.plugin.settings.intercept).onChange(async v => { this.plugin.settings.intercept = v; await this.plugin.saveData(this.plugin.settings); }));
    new Setting(containerEl).setName('連續複習分鐘數').setDesc('預設 15；電腦短測可用 0.5。').addText(t => t.setValue(String(this.plugin.settings.minutes)).onChange(async v => { const n = Number(v); if (Number.isFinite(n) && n >= 0.2 && n <= 120) { this.plugin.settings.minutes = n; await this.plugin.saveData(this.plugin.settings); } }));
  }
}
export default class Prototype extends Plugin {
  settings: Settings = { mode: 'fullscreen', intercept: true, minutes: 15, deviceCode: '' };
  reporter!: Reporter; session?: ReviewSession; hasOpened = false; commandAt = 0;
  pendingRate?: (entry: History, previous?: string) => string | undefined;
  run?: AbortController;
  get label() { return __EC_FRAMEWORK__ === 'react' ? '(React)' : '(Preact)'; }
  get viewType() { return this.manifest.id + '-review'; }
  async onload() {
    this.settings = { ...this.settings, ...await this.loadData() };
    if (!this.settings.deviceCode) { this.settings.deviceCode = crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, '0'); await this.saveData(this.settings); }
    this.reporter = new Reporter(this.app, this.manifest.id, this.manifest.version, __EC_FRAMEWORK__, () => this.settings);
    this.registerView(this.viewType, leaf => new ReviewView(leaf, this)); this.addSettingTab(new SettingsTab(this.app, this));
    const command = (id: string, name: string, action: () => Promise<unknown>) => this.addCommand({ id, name: this.label + ' ' + name, callback: () => { if (this.run) { new Notice('正在量測；請先用 ✕ 停止。'); return; } void action().catch(e => new Notice('試作外掛：' + String(e))); } });
    command('create-data', '建立測試資料', async () => { await createData(this.app); new Notice('測試資料已建立（保留既有檔案）。'); });
    command('review', '開始複習', async () => { const session = await this.open(); await session.ready(); });
    command('auto', '自動量測', () => this.automate());
    command('continuous', '連續複習 15 分鐘', () => this.continuous());
    command('read-records', '讀全部紀錄', async () => { const path = await this.reporter.write('紀錄', await readRecords(this.app)); new Notice('紀錄量測完成：' + path); });
    const onloadMs = performance.now() - __ecT0;
    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        const dir = this.manifest.dir ?? this.app.vault.configDir + '/plugins/' + this.manifest.id;
        const bytes = (await this.app.vault.adapter.readBinary(dir + '/main.js')).byteLength;
        await this.reporter.write('載入', { executionStartMs: __ecT0, onloadMs, mainBytes: bytes });
      })().catch(e => new Notice('載入量測失敗：' + String(e)));
    });
  }
  cancelRun() { this.run?.abort(); }
  mount(container: HTMLElement, leaf?: WorkspaceLeaf) { return this.session = new ReviewSession(this, container, leaf, this.pendingRate); }
  async open(onRate?: (entry: History, previous?: string) => string | undefined) {
    this.commandAt = performance.now();
    if (this.session) await this.session.close();
    this.pendingRate = onRate;
    if (this.settings.mode === 'fullscreen') this.mount(document.body);
    else { const leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: this.viewType, active: true }); await this.app.workspace.revealLeaf(leaf); }
    this.pendingRate = undefined;
    if (!this.session) throw Error('無法建立複習畫面');
    return this.session;
  }
  async wait(ms: number, signal: AbortSignal) {
    if (signal.aborted) throw Error('已停止');
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(Error('已停止')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  async automate() {
    const run = this.run = new AbortController(), openings = [], sessions: SessionMetrics[] = [];
    let error: string | undefined;
    try {
      await createData(this.app);
      for (let i = 0; i < 10; i++) {
        if (run.signal.aborted) throw Error('已停止');
        const s = await this.open(); sessions.push(s.metrics); await s.ready(); await this.wait(100, run.signal); await s.close(); openings.push(s.metrics.opening());
      }
      const s = await this.open(); sessions.push(s.metrics); await s.ready();
      for (let i = 0; i < samples.length; i++) {
        await this.wait(800, run.signal); s.control.current!.reveal(); await this.wait(800, run.signal);
        await s.control.current!.rate(samples[i].spell ? 'miss' : 'good');
        if (i < 5) { await s.control.current!.back(); await this.wait(800, run.signal); await s.control.current!.forward(); }
      }
      await this.wait(800, run.signal); await s.close();
    } catch (e) { error = String(e); }
    finally {
      try { await this.session?.close(); } catch (e) { error = String(e); } this.run = undefined;
      const path = await this.reporter.write('自動', { completed: !error, error, openings, sessions: sessions.map(m => ({ opening: m.opening(), animations: m.animations, markdown: m.markdown })), simulatedNavigationPairs: sessions.at(-1)?.animations.filter((a: any) => a.kind === '上一張').length ?? 0 });
      new Notice((error ? '自動量測停止：' : '自動量測完成：') + path);
    }
  }
  async continuous() {
    const run = this.run = new AbortController(), clock = uniqueClock();
    const started = performance.now(), deadline = started + this.settings.minutes * 60000;
    const expected = new Map<string, { before: string; lines: string[] }>(), appends: unknown[] = [], errors: string[] = [];
    let queue = Promise.resolve(), count = 0, s: ReviewSession | undefined;
    let wake: WakeLockSentinel | undefined;
    const wakeResult: { supported: boolean; acquired: boolean; error?: string; releasedAt?: string } = { supported: 'wakeLock' in navigator, acquired: false };
    const append = (line: RecordLine) => {
      const path = 'Essence-T2/紀錄/' + line.t.slice(0, 7) + ' ' + device() + '-' + this.settings.deviceCode + '.jsonl', text = JSON.stringify(line) + '\n';
      const enqueuedAt = performance.now();
      queue = queue.then(async () => {
        if (!expected.has(path)) {
          const exists = await this.app.vault.adapter.exists(path);
          const before = exists ? await this.app.vault.adapter.read(path) : '';
          if (!exists) await this.app.vault.adapter.write(path, '');
          expected.set(path, { before, lines: [] });
        }
        expected.get(path)!.lines.push(text);
        const t = performance.now();
        try { await this.app.vault.adapter.append(path, text); appends.push({ path, t: line.t, ms: performance.now() - t, queuedMs: t - enqueuedAt, ok: true }); }
        catch (e) { errors.push(String(e)); appends.push({ path, t: line.t, ms: performance.now() - t, ok: false, error: String(e) }); }
      }).catch(e => { errors.push(String(e)); });
    };
    const onRate = (entry: History, previous?: string) => {
      if (previous) append(undoLine(clock(), previous));
      const t = clock(); append(reviewLine(t, entry.card.lt, entry.rating, entry.card.v)); return t;
    };
    let error: string | undefined;
    try {
      await createData(this.app); await ensureFolder(this.app, 'Essence-T2/紀錄');
      s = await this.open(onRate); await s.ready();
      try {
        if (!wakeResult.supported) throw Error('此環境沒有 Wake Lock API');
        wake = await navigator.wakeLock.request('screen'); wakeResult.acquired = true;
        wake.addEventListener('release', () => { wakeResult.releasedAt = new Date().toISOString(); if (s && !s.closed) { s.notice = '螢幕保持喚醒已解除，請手動關閉自動鎖定。'; s.render(); } });
      } catch (e) { wakeResult.error = String(e); s.notice = '無法防止螢幕變暗，請先手動關閉自動鎖定。'; s.render(); }
      let nextReveal = performance.now() + 10000;
      while (performance.now() < deadline) {
        await this.wait(Math.max(0, Math.min(nextReveal, deadline) - performance.now()), run.signal);
        if (performance.now() >= deadline) break;
        if (s.control.current!.done()) { s.control.current!.restart(); await twoFrames(); }
        s.control.current!.reveal(); await this.wait(1000, run.signal);
        if (performance.now() >= deadline) break;
        const card = samples[count % samples.length], choices = card.spell ? ['miss', 'near'] as const : ratings;
        const rating = choices[Math.floor(Math.random() * choices.length)];
        await s.control.current!.rate(rating); count++;
        if (count % 10 === 0) {
          await s.control.current!.back(); await this.wait(350, run.signal);
          await s.control.current!.rate(rating === 'miss' ? 'near' : 'miss');
          await s.control.current!.forward();
        }
        nextReveal += 10000;
      }
    } catch (e) { error = String(e); }
    finally {
      try { await s?.close(); } catch (e) { error = String(e); }
      try { if (wake && !wake.released) await wake.release(); } catch (e) { errors.push('Wake Lock release: ' + String(e)); }
      await queue;
      const verification = [];
      for (const [path, expect] of expected) {
        try { const actual = await this.app.vault.adapter.read(path), desired = expect.before + expect.lines.join(''); verification.push({ path, expectedNewLines: expect.lines.length, actualNewLines: actual.slice(expect.before.length).split('\n').filter(Boolean).length, matches: actual === desired }); }
        catch (e) { verification.push({ path, matches: false, error: String(e) }); }
      }
      this.run = undefined;
      const path = await this.reporter.write('連續', { completed: !error && errors.length === 0 && verification.every(v => v.matches), error, errors, requestedMinutes: this.settings.minutes, elapsedMs: performance.now() - started, ratings: count, wakeLock: wakeResult, appends, verification, animations: s?.metrics.animations, markdown: s?.metrics.markdown });
      new Notice((error ? '連續量測停止：' : '連續量測完成：') + path);
    }
  }
  onunload() { this.cancelRun(); void this.session?.close().catch(() => {}); this.app.workspace.getLeavesOfType(this.viewType).forEach(leaf => leaf.detach()); }
}
