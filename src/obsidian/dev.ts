import { apiVersion, Component, MarkdownRenderer, Notice, Platform, type App, type Plugin, type TFile } from 'obsidian';
import { assignIds } from '../core/deck/index.ts';
import { compareAssigned, compareLists, type ListItem, type Mismatch } from '../dev/compare.ts';
import { loadDeviceCode } from './device.ts';

// 只在開發版建置（tools/build.mjs --dev）；AI 在 Windows 版 Obsidian 用 URI 執行，iPhone 用命令面板（W5 說明 §4-4）。
const root = 'Essence W5';
const limit = 20;

interface DevCommand { name: string; run: (app: App) => Promise<unknown> }
const commands: Record<string, DevCommand> = {
  compare: { name: 'Essence 開發：metadataCache 對照', run: compare },
};

export function registerDev(plugin: Plugin): void {
  const loadedAt = performance.now();
  const device = loadDeviceCode(plugin.app);
  let runs = 0;
  async function run(code: string): Promise<void> {
    const command = Object.hasOwn(commands, code) ? commands[code] : undefined;
    if (!command) { new Notice('Essence 開發：沒有「' + code + '」'); return; }
    runs++;
    const startedAt = performance.now();
    let result: unknown;
    try { result = await command.run(plugin.app); }
    catch (error) { result = { error: error instanceof Error ? error.stack ?? error.message : String(error) }; }
    const path = await writeResult(plugin.app, code, device, {
      code, device, platform: Platform.isIosApp ? 'ios' : Platform.isAndroidApp ? 'android' : 'desktop',
      obsidian: apiVersion, plugin: plugin.manifest.version,
      sinceLoadMs: Math.round(startedAt - loadedAt), run: runs, ms: Math.round(performance.now() - startedAt), result,
    });
    new Notice(command.name.replace('Essence 開發：', '') + '完成\n' + path);
  }
  for (const [code, command] of Object.entries(commands)) {
    plugin.addCommand({ id: 'dev-' + code, name: command.name, callback: () => { void run(code); } });
  }
  plugin.registerObsidianProtocolHandler('essence-cards-dev', params => {
    // reload：重新安裝開發版之後，不關 Obsidian 就換成新的 main.js（用 Obsidian 未公開的 app.plugins）。
    if (params.run === 'reload') {
      const plugins = (plugin.app as unknown as { plugins: { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<void> } }).plugins;
      const id = plugin.manifest.id;
      void plugins.disablePlugin(id).then(() => plugins.enablePlugin(id)).then(() => { new Notice('Essence 開發：已重新載入'); });
    } else void run(params.run ?? '');
  });
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  let path = '';
  for (const part of folder.split('/')) {
    path = path ? path + '/' + part : part;
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
  }
}

async function writeResult(app: App, code: string, device: string, data: unknown): Promise<string> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  await ensureFolder(app, root + '/結果');
  let path = `${root}/結果/${code} ${device} ${stamp}.json`;
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = `${root}/結果/${code} ${device} ${stamp}-${n}.json`;
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
  const detail: Record<string, { cache: ListItem[]; reading: string[] }> = {};
  for (const name of [...new Set(found.map(m => m.case))].slice(0, 10)) {
    const file = app.vault.getFileByPath(`${folder}/${name}.md`);
    if (file) detail[name] = { cache: listItems(app, file), reading: await reading(app, await app.vault.read(file), file.path) };
  }
  return {
    cases: cases.length, changedOnDisk,
    mismatches: found.length,
    before: found.filter(m => m.stage === 'before').length,
    after: found.filter(m => m.stage === 'after').length,
    byCase: found.reduce<Record<string, number>>((count, m) => ({ ...count, [m.case]: (count[m.case] ?? 0) + 1 }), {}),
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
