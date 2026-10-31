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
  const tick = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
  const parent = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
  const attach = (entry: TAbstractFile): void => {
    entries.set(entry.path, entry);
    const up = entries.get(parent(entry.path));
    if (up instanceof TFolder) up.children.push(entry);
  };
  const needParent = (path: string): void => {
    const up = parent(path);
    if (up && !(entries.get(up) instanceof TFolder)) throw Error('上層資料夾不存在：' + up);
  };
  return {
    folders: () => [...entries.values()].filter(entry => entry instanceof TFolder).map(entry => entry.path).sort(),
    getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
    getFiles: () => [...entries.values()].filter(entry => entry instanceof TFile),
    async createFolder(path: string) {
      await tick();
      if (entries.has(path)) throw Error('Folder already exists.');
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

function obsidianFiles(app: { vault: ReturnType<typeof vault> }): Files {
  const module = { exports: {} as { createObsidianFiles: (app: App) => Files } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('require', 'module', 'exports', code) as (require: (name: string) => unknown, module: unknown, exports: unknown) => void;
  run(name => { if (name !== 'obsidian') throw Error(name); return { TFile, TFolder, TAbstractFile }; }, module, module.exports);
  return module.exports.createObsidianFiles(app as unknown as App);
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
});
