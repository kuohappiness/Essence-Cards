import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { App } from 'obsidian';
import { contractCases, runContractCase } from '../src/dev/files-contract.ts';
import type { Files } from '../src/core/files.ts';

// tasks/error-log.md §4：Files 的 Obsidian 版（src/obsidian/files.ts）在 Node 用 vault 替身跑。替身照 Obsidian 的 API：
// 每個呼叫都先讓出一次，已經有那個資料夾或檔案時 createFolder、create 拒絕（Codex 的替身重現）。真的訊息在 Windows 版 Obsidian
// 的開發命令 files 記下（folderRace）。
const root = fileURLToPath(new URL('..', import.meta.url));
const code = (await build({
  absWorkingDir: root, entryPoints: ['src/obsidian/files.ts'], bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['obsidian'],
})).outputFiles[0].text;

class TAbstractFile { path: string; constructor(path: string) { this.path = path; } }
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile { children: TAbstractFile[] = []; }

function vault() {
  const entries = new Map<string, TAbstractFile>();
  const texts = new Map<string, string>();
  // 硬碟上有、Obsidian 的清單還沒有的資料夾（Windows 實機遇到，tasks/exam-scope.md §10）。
  const disk = new Set<string>();
  const tick = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
  const parent = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
  const attach = (entry: TAbstractFile): void => {
    entries.set(entry.path, entry);
    const up = entries.get(parent(entry.path));
    if (up instanceof TFolder) up.children.push(entry);
  };
  const needParent = (path: string): void => {
    const up = parent(path);
    if (up && !(entries.get(up) instanceof TFolder) && !disk.has(up)) throw Error('上層資料夾不存在：' + up);
  };
  return {
    folders: () => [...entries.values()].filter(entry => entry instanceof TFolder).map(entry => entry.path).sort(),
    onDisk: (path: string) => { disk.add(path); },
    adapter: {
      async stat(path: string) {
        await tick();
        if (disk.has(path) || entries.get(path) instanceof TFolder) return { type: 'folder' };
        return entries.get(path) instanceof TFile ? { type: 'file' } : null;
      },
    },
    getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
    getFiles: () => [...entries.values()].filter(entry => entry instanceof TFile),
    async createFolder(path: string) {
      await tick();
      if (entries.has(path) || disk.has(path)) throw Error('Folder already exists.');
      needParent(path);
      attach(new TFolder(path));
    },
    async create(path: string, text: string) {
      await tick();
      if (entries.has(path)) throw Error('File already exists.');
      needParent(path);
      texts.set(path, text);
      attach(new TFile(path));
    },
    async read(file: TFile) { await tick(); return texts.get(file.path) ?? ''; },
    async append(file: TFile, text: string) { await tick(); texts.set(file.path, (texts.get(file.path) ?? '') + text); },
    async process(file: TFile, edit: (text: string) => string) { await tick(); texts.set(file.path, edit(texts.get(file.path) ?? '')); },
    on: () => ({}),
    offref: () => {},
  };
}

type Pause = (path: string, folder?: boolean) => Promise<void> | null;
function obsidianFiles(app: { vault: ReturnType<typeof vault> }, options: { pause?: Pause } = {}): Files {
  const module = { exports: {} as { createObsidianFiles: (app: App, options: { pause?: Pause }) => Files } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('require', 'module', 'exports', code) as (require: (name: string) => unknown, module: unknown, exports: unknown) => void;
  run(name => { if (name !== 'obsidian') throw Error(name); return { TFile, TFolder, TAbstractFile }; }, module, module.exports);
  return module.exports.createObsidianFiles(app as unknown as App, options);
}

const case17 = contractCases.find(item => item.code === 'C17');
const noOps = { rename: () => Promise.reject(Error('不用')), remove: () => Promise.reject(Error('不用')) };

void test('§4 Obsidian 版 Files：不存在的資料夾裡同時 append 兩個不同的檔，兩個都成功（C17）', async () => {
  assert.ok(case17);
  const app = { vault: vault() };
  const result = await runContractCase(case17, obsidianFiles(app), noOps, 'Essence W5/暫存', { notice: 200, quiet: 50 });
  assert.deepEqual(result, { code: 'C17', ok: true });
  assert.deepEqual(app.vault.folders(), ['Essence W5', 'Essence W5/暫存', 'Essence W5/暫存/C17', 'Essence W5/暫存/C17/new']);
});

void test('§4 建資料夾失敗、而那個路徑不是資料夾（例如是檔案）時照原樣拋出', async () => {
  const app = { vault: vault() };
  const files = obsidianFiles(app);
  await files.append('a', 'x');
  await assert.rejects(files.append('a/b.jsonl', 'y'));
  // 別的原因（例如沒有權限）建不了，再查一次也不是資料夾：照原樣拋出。
  const denied = { vault: { ...vault(), createFolder: () => Promise.reject(Error('沒有權限')) } };
  await assert.rejects(obsidianFiles(denied).append('x/y.jsonl', 'z'), /沒有權限/);
  // 硬碟上那個路徑是檔案：也不是資料夾。
  const blocked = { vault: { ...vault(), createFolder: () => Promise.reject(Error('Folder already exists.')), adapter: { stat: () => Promise.resolve({ type: 'file' }) } } };
  await assert.rejects(obsidianFiles(blocked).append('x/y.jsonl', 'z'), /already exists/);
  // 連查都查不了：交出原本的錯，不是查詢的錯。
  const unknown = { vault: { ...vault(), createFolder: () => Promise.reject(Error('沒有權限')), adapter: { stat: () => Promise.reject(Error('查不了')) } } };
  await assert.rejects(obsidianFiles(unknown).append('x/y.jsonl', 'z'), /沒有權限/);
});

void test('§6 資料夾在硬碟上、Obsidian 的清單還沒有（iCloud 剛同步來）：照常寫進去，不報 Folder already exists', async () => {
  const app = { vault: vault() };
  app.vault.onDisk('考試範圍');
  const files = obsidianFiles(app);
  await files.modify('考試範圍/a.md', () => 'x');
  assert.equal(await files.read('考試範圍/a.md'), 'x');
  await files.append('考試範圍/b.jsonl', 'y');
  assert.equal(await files.read('考試範圍/b.jsonl'), 'y\n');
});

void test('系統資料夾的防呆：呼叫之後、真正找檔之前才開始搬回，讀寫照樣等搬回結束（Codex L2 第二輪 F1）', async () => {
  const app = { vault: vault() };
  let gate: Promise<void> | null = null;
  let open = (): void => {};
  // 替身：「紀錄」正在搬回時，碰它底下的檔、列它或它的上層（'' 是整個 vault）都擋住。
  const pause: Pause = (path, folder) => (folder ? path === '' || path === '紀錄' || path.startsWith('紀錄/') : path.startsWith('紀錄/')) ? gate : null;
  const files = obsidianFiles(app, { pause });
  await files.append('紀錄/a.jsonl', 'old');
  const done: string[] = [];
  // 呼叫的那一刻沒有擋住；同一輪的下一個微任務（排隊之後、找檔之前）才收到 rename。
  const calls = [
    files.append('紀錄/a.jsonl', 'new').then(() => { done.push('append'); }),
    files.modify('紀錄/b.md', () => 'b').then(() => { done.push('modify'); }),
    files.list('').then(paths => { done.push('list ' + paths.join(',')); }),
    files.list('別的').then(() => { done.push('list 別的'); }),
  ];
  gate = new Promise<void>(resolve => { open = resolve; });
  // read 在呼叫的那一刻就開始找檔（沒有空檔）；搬回已經開始之後才呼叫的，等。
  calls.push(files.read('紀錄/a.jsonl').then(text => { done.push('read ' + String(text)); }));
  for (let i = 0; i < 20; i++) await new Promise(resolve => { setImmediate(resolve); });
  assert.deepEqual(done, ['list 別的']);
  gate = null;
  open();
  await Promise.all(calls);
  // 放行之後幾個等著的誰先誰後不一定，只看都做了、寫進原位。
  assert.deepEqual(done.slice(1).map(each => each.split(' ')[0]).sort(), ['append', 'list', 'modify', 'read']);
  assert.equal(await files.read('紀錄/a.jsonl'), 'old\nnew\n');
  assert.equal(await files.read('紀錄/b.md'), 'b');
});
