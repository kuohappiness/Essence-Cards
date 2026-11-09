import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { App } from 'obsidian';
import { contractCases, runContractCase } from '../src/dev/files-contract.ts';
import type { Files } from '../src/core/files.ts';
import { sha256Hex } from '../src/core/ai/index.ts';
import type { CardForm, CardJob, EmbeddedRules } from '../src/core/ai/index.ts';
import { blockIds } from '../src/core/deck/index.ts';
import { createAiCards } from '../src/obsidian/ai-cards.ts';
import { createState } from '../src/state/index.ts';

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
  const listeners = new Map<string, Set<(entry: TAbstractFile) => void>>();
  const emit = (name: string, entry: TAbstractFile): void => { for (const listener of listeners.get(name) ?? []) listener(entry); };
  return {
    folders: () => [...entries.values()].filter(entry => entry instanceof TFolder).map(entry => entry.path).sort(),
    onDisk: (path: string) => { disk.add(path); },
    texts,
    /** 別台裝置同步來的檔：上層資料夾跟著出現，清單換好才通知。 */
    sync(path: string, text: string) {
      const parts = path.split('/').slice(0, -1);
      parts.forEach((_, i) => { const folder = parts.slice(0, i + 1).join('/'); if (!entries.has(folder)) attach(new TFolder(folder)); });
      texts.set(path, text);
      const file = new TFile(path);
      attach(file);
      emit('create', file);
    },
    /** 家長連資料夾一起刪掉：folder 底下每個檔都送 delete。 */
    removeFolder(folder: string) {
      for (const [path, entry] of [...entries]) {
        if (path !== folder && !path.startsWith(folder + '/')) continue;
        entries.delete(path);
        if (entry instanceof TFile) { texts.delete(path); emit('delete', entry); }
      }
    },
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
      const file = new TFile(path);
      attach(file);
      emit('create', file);
    },
    async read(file: TFile) { await tick(); return texts.get(file.path) ?? ''; },
    async append(file: TFile, text: string) { await tick(); texts.set(file.path, (texts.get(file.path) ?? '') + text); },
    async process(file: TFile, edit: (text: string) => string) { await tick(); texts.set(file.path, edit(texts.get(file.path) ?? '')); },
    on(name: string, listener: (entry: TAbstractFile) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return { name, listener };
    },
    offref(ref: { name: string; listener: (entry: TAbstractFile) => void }) { listeners.get(ref.name)?.delete(ref.listener); },
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

/** 讓下一次 createFolder 停住（呼叫了、還沒建）：建上層資料夾的那段等待。 */
function holdFolder(app: { vault: ReturnType<typeof vault> }) {
  const real = app.vault.createFolder.bind(app.vault);
  let open = (): void => {}, arrived = (): void => {};
  const gate = new Promise<void>(resolve => { open = resolve; });
  const reached = new Promise<void>(resolve => { arrived = resolve; });
  app.vault.createFolder = (path: string) => { app.vault.createFolder = real; arrived(); return gate.then(() => real(path)); };
  return { reached, open };
}

void test('modify 要先建上層資料夾（R3-2）：edit 丟錯不動資料夾；建好之後再問一次 edit，以最後一次為準', async () => {
  // 第一次就不建（例如家長連資料夾一起刪掉，離開筆記時的補 ID）：資料夾不會冒出來。
  {
    const app = { vault: vault() };
    await assert.rejects(obsidianFiles(app).modify('刪掉的/a.md', () => { throw Error('不建'); }), /不建/);
    assert.deepEqual(app.vault.folders(), []);
  }
  // 上層資料夾都在：一次建好，edit 只問一次。
  {
    const app = { vault: vault() };
    const files = obsidianFiles(app);
    await files.modify('在/a.md', () => 'x');
    let calls = 0;
    await files.modify('在/b.md', () => { calls++; return 'y'; });
    assert.equal(calls, 1);
  }
  // 建資料夾的時候情況變了：第二次丟錯就不建檔；回傳的是第二次的內容。
  {
    const app = { vault: vault() };
    const files = obsidianFiles(app);
    const held = holdFolder(app);
    let allow = true;
    const refused = assert.rejects(files.modify('新/a.md', () => { if (!allow) throw Error('不能建了'); return 'x'; }), /不能建了/);
    await held.reached;
    allow = false;
    held.open();
    await refused;
    assert.equal(await files.read('新/a.md'), null);
    let times = 0;
    await files.modify('再/b.md', () => `第 ${String(++times)} 次`);
    assert.equal(await files.read('再/b.md'), '第 2 次');
  }
  // 建資料夾的時候檔已經出現：不蓋掉，edit 收到它的內容。
  {
    const app = { vault: vault() };
    const files = obsidianFiles(app);
    const held = holdFolder(app);
    const seen: [string, boolean][] = [];
    const work = files.modify('同步/a.md', (text, exists) => { seen.push([text, exists]); return exists ? text : 'x'; });
    await held.reached;
    app.vault.sync('同步/a.md', '別台寫的');
    held.open();
    await work;
    assert.equal(await files.read('同步/a.md'), '別台寫的');
    assert.deepEqual(seen, [['', false], ['別台寫的', true]]);
  }
  // 建資料夾的時候開始搬回系統資料夾：等搬回結束才建。
  {
    const app = { vault: vault() };
    let gate: Promise<void> | null = null, open = (): void => {};
    const files = obsidianFiles(app, { pause: () => gate });
    const held = holdFolder(app);
    let done = false;
    const work = files.modify('紀錄/a.md', () => 'x').then(() => { done = true; });
    await held.reached;
    gate = new Promise<void>(resolve => { open = resolve; });
    held.open();
    for (let i = 0; i < 20; i++) await new Promise(resolve => { setImmediate(resolve); });
    assert.equal(done, false);
    gate = null;
    open();
    await work;
    assert.equal(await files.read('紀錄/a.md'), 'x');
  }
});

void test('Files 契約 C5、C18、C19 在 Obsidian 版（要先建上層資料夾）也成立', async () => {
  for (const code of ['C5', 'C18', 'C19']) {
    const item = contractCases.find(each => each.code === code);
    assert.ok(item);
    assert.deepEqual(await runContractCase(item, obsidianFiles({ vault: vault() }), noOps, 'Essence W5/暫存', { notice: 200, quiet: 50 }), { code, ok: true });
  }
});

const rules: EmbeddedRules = { english: [{ name: '通用', version: 'v0.15', text: '# 通用', sha256: sha256Hex('# 通用') }, { name: '英文', version: 'v0.14', text: '# 英文', sha256: sha256Hex('# 英文') }] };
const form: CardForm = { subject: 'english', term: '國二上', unit: 'L3 Sports', purpose: '準備段考', supplement: false, adjust: '', material: '' };
const REPLY = ['國二上英文 L3 單字', '', '## 單字', '', '- borrow 英翻中', '    - 出處：p.40', '    - borrow :: 借入', '<<<完>>>'].join('\n');
const FOLDER = 'Essence Cards/學業/國二上/英文';
const WORD = `${FOLDER}/國二上英文 L3 單字.md`;
const SYNCED = 'Essence Cards/同步來的/單字.md';

/** 真的 state 與製卡流程接 Obsidian 版 Files：卡組寫成、快照寫不進去之後，整個資料夾被刪掉，繼續得到「找不到」，畫面停在可以選重建的地方。 */
async function waitingForRebuild(t: TestContext) {
  const app = { vault: vault() };
  let jobs: unknown = null, retired: string[] = [];
  // eslint-disable-next-line prefer-const -- state 與流程互相參照
  let state: ReturnType<typeof createState>;
  const files = obsidianFiles(app);
  const cards = createAiCards({
    rules, state: () => state,
    names: () => new Set(app.vault.getFiles().filter(file => file.path.endsWith('.md')).map(file => file.path.slice(file.path.lastIndexOf('/') + 1, -3).toLowerCase())),
    store: { jobs: () => jobs, saveJobs(next: CardJob[]) { jobs = JSON.parse(JSON.stringify(next)) as unknown; }, retired: () => retired, retire(ids) { retired = [...retired, ...ids]; }, last: () => ({}), saveLast() {} },
    clipboard: () => Promise.resolve(),
    now: () => ({ ms: Date.parse('2026-11-07T10:02:11+08:00'), offset: 480 }),
    onError() {},
  });
  state = createState({ files, device: 'PC-test', delay: 1, fillIds: true, stuckAfter: 2000, reserved: () => cards.reserved(), now: () => Date.parse('2026-11-07T10:02:11+08:00'), offset: () => 480, onError() {} });
  t.after(() => state.close());
  await state.ready();
  const copied = await cards.copy(form);
  assert.ok('job' in copied);
  const create = app.vault.create.bind(app.vault);
  app.vault.create = (path: string, text: string) => path.includes('紀錄/AI 輸出/2026') ? Promise.reject(Error('磁碟滿了')) : create(path, text);
  assert.equal((await cards.save(copied.job, REPLY, null)).kind, 'stop');
  app.vault.create = create;
  await new Promise(resolve => setTimeout(resolve, 20));
  const text = app.vault.texts.get(WORD)!;
  const id = [...blockIds(text)][0];
  app.vault.removeFolder('Essence Cards/學業');
  await new Promise(resolve => setTimeout(resolve, 20));
  const stop = await cards.resume(cards.jobs()[0]);
  assert.equal(stop.kind === 'stop' && stop.deck?.situation, 'missing', JSON.stringify(stop));
  return { app, cards, state, job: cards.jobs()[0], text, id };
}

void test('§5 重建要先建上層資料夾（R3-2）：等資料夾的時候同步送來原草稿或同名檔，都不會多出一份', async t => {
  // 原草稿同步到別的位置：跟過去，原路徑沒有副本。
  {
    const { app, cards, state, job, text, id } = await waitingForRebuild(t);
    const held = holdFolder(app);
    const rebuilding = cards.choose(job, 0, 'rebuild');
    await held.reached;
    app.vault.sync(SYNCED, text);
    while (!state.decks().some(each => each.path === SYNCED)) await new Promise(resolve => setTimeout(resolve, 1));
    held.open();
    const result = await rebuilding;
    assert.deepEqual(result.kind === 'done' && result.decks, [SYNCED], JSON.stringify(result));
    assert.equal(app.vault.texts.has(WORD), false);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual([...(await state.aiWhere([id]))!], [[id, [SYNCED]]]);
  }
  // 別的資料夾出現同名檔：往後加，不重名。
  {
    const { app, cards, job } = await waitingForRebuild(t);
    const held = holdFolder(app);
    const rebuilding = cards.choose(job, 0, 'rebuild');
    await held.reached;
    app.vault.sync('別的資料夾/國二上英文 L3 單字.md', '別人的筆記');
    held.open();
    const result = await rebuilding;
    assert.deepEqual(result.kind === 'done' && result.decks, [`${FOLDER}/國二上英文 L3 單字 2.md`], JSON.stringify(result));
    assert.equal(app.vault.texts.has(WORD), false);
  }
});
