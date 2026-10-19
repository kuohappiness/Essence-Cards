import { apiVersion, Platform, type App } from 'obsidian';
import { frameStats, timestamp } from './logic';
import { ensureFolder } from './data';
export interface Settings { mode: 'fullscreen' | 'tab'; intercept: boolean; minutes: number; deviceCode: string; }
export const device = () => Platform.isIosApp ? 'iPhone' : Platform.isAndroidApp ? 'Android' : /Win/i.test(navigator.platform) ? 'Windows' : /Mac/i.test(navigator.platform) ? 'macOS' : 'Linux';
export const twoFrames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export class SessionMetrics {
  openedAt = performance.now();
  commitMs?: number; markdownMs?: number; paintedMs?: number; imagesMs?: number;
  animations: unknown[] = []; markdown: unknown[] = []; gestures: unknown[] = []; fullscreen: unknown[] = [];
  scrolls = 0; pending = new Set<Promise<unknown>>();
  constructor(public first: boolean, public settings: Settings) {}
  track<T>(promise: Promise<T>): Promise<T> { this.pending.add(promise); void promise.finally(() => this.pending.delete(promise)).catch(() => {}); return promise; }
  async settle() { while (this.pending.size) await Promise.allSettled([...this.pending]); }
  async animation(kind: string, action: () => PromiseLike<unknown>) {
    let frame = 0, last = performance.now(), active = true;
    const gaps: number[] = [];
    const tick = (t: number) => { gaps.push(t - last); last = t; if (active) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    try { await action(); } finally { active = false; cancelAnimationFrame(frame); this.animations.push({ kind, ...frameStats(gaps) }); }
  }
  opening() { return { first: this.first, commandAt: this.openedAt, commitMs: this.commitMs, markdownMs: this.markdownMs, paintedMs: this.paintedMs, imagesMs: this.imagesMs, fullscreen: this.fullscreen, settings: this.settings }; }
}
export function viewport() {
  const v = window.visualViewport;
  return v ? { width: v.width, height: v.height, offsetTop: v.offsetTop, offsetLeft: v.offsetLeft, scale: v.scale } : null;
}
export function fullscreenCheck(layer: HTMLElement) {
  const probe = document.createElement('div');
  probe.className = 'ec-safe-probe'; layer.append(probe);
  const style = getComputedStyle(probe), safeArea = { top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft };
  probe.remove();
  const rect = layer.getBoundingClientRect(), w = window.innerWidth, h = window.innerHeight;
  const points = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2], [w / 2, h / 2]].map(([x, y]) => ({ x, y, inside: layer.contains(document.elementFromPoint(x, y)) }));
  return { rect: rect.toJSON(), innerHeight: h, innerWidth: w, visualViewport: viewport(), safeArea, points };
}
export function sidebars(app: App) {
  return { left: app.workspace.leftSplit?.collapsed ?? null, right: app.workspace.rightSplit?.collapsed ?? null };
}
export class Reporter {
  constructor(public app: App, public id: string, public version: string, public framework: string, public settings: () => Settings) {}
  async write(kind: string, data: unknown, settings = this.settings()) {
    await ensureFolder(this.app, 'Essence-T2/結果');
    const date = timestamp(new Date()), base = 'Essence-T2/結果/' + date.slice(0, 10) + ' ' + date.slice(11, 19).replaceAll(':', '') + ' ' + device() + ' ' + this.framework + ' ' + kind;
    let path = base + '.json', suffix = 1;
    while (await this.app.vault.adapter.exists(path)) path = base + '-' + suffix++ + '.json';
    await this.app.vault.create(path, JSON.stringify({ pluginId: this.id, version: this.version, platform: device(), isIosApp: Platform.isIosApp, isAndroidApp: Platform.isAndroidApp, isMobileApp: Platform.isMobileApp, obsidianVersion: apiVersion, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, mode: settings.mode, interceptTouch: settings.intercept, measuredAt: date, data }, null, 2));
    return path;
  }
}
export async function readRecords(app: App) {
  const folder = 'Essence-T2/紀錄-三年', passes = [];
  for (let pass = 0; pass < 3; pass++) {
    const start = performance.now();
    const listing = await app.vault.adapter.list(folder);
    const files = listing.files.filter(p => p.endsWith('.jsonl')).sort();
    if (!files.length) throw Error('紀錄-三年沒有 .jsonl；先用 gen-records 產生資料。');
    const read = async (paths: string[]) => {
      const start = performance.now(); let readMs = 0, parseMs = 0, lines = 0;
      const errors: { file: string; error: string }[] = [], timings: { file: string; ms: number }[] = [];
      for (const file of paths) {
        const t = performance.now();
        try {
          const content = await app.vault.adapter.read(file); const loaded = performance.now(); readMs += loaded - t;
          let lineNumber = 0;
          for (const line of content.split(/\r?\n/)) { lineNumber++; if (!line.trim()) continue; try { JSON.parse(line); lines++; } catch (e) { errors.push({ file, error: '第 ' + lineNumber + ' 行：' + String(e) }); } }
          parseMs += performance.now() - loaded;
        } catch (e) { readMs += performance.now() - t; errors.push({ file, error: String(e) }); }
        timings.push({ file, ms: performance.now() - t });
      }
      return { totalMs: performance.now() - start, readMs, parseMs, lines, files: paths.length, slowest: timings.sort((a, b) => b.ms - a.ms)[0], errors };
    };
    const all = await read(files), latest = files.map(p => p.split('/').pop()!.slice(0, 7)).sort().at(-1)!;
    const current = await read(files.filter(p => p.split('/').pop()!.startsWith(latest)));
    passes.push({ pass: pass + 1, cache: pass === 0 ? '外掛未快取；無法清除 OS／iCloud 快取' : '重讀（可能有 OS 快取）', totalMs: performance.now() - start, all, latestMonth: latest, current });
  }
  return passes;
}
