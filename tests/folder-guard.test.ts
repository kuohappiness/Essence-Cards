import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry } from '../src/core/study/index.ts';
import { createFolderGuard, type FolderGuard, type GuardHost } from '../src/obsidian/folder-guard.ts';
import { createState } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// tasks/system-folder-guard.md §1、§2-3、§2-4 的按鈕、§4：vault 用記憶體 Files 加一層資料夾的替身，不是 Obsidian 實機（實機見任務說明〈結果〉）。

const R = 'Essence Cards';
const LOG = `${R}/紀錄/2026-10 iPhone-test.jsonl`;  // 別台的紀錄：state 有在監看（自己的不看）
const DECK = `${R}/英文/L1.md`;
const RANGE = `${R}/考試範圍/段考.md`;
const VAULT = {
  [LOG]: encodeEntry('2026-10-23T19:00:00.000+08:00', { lt: 'k3m9x2', r: 'good', v: '12345678' }) + '\n',
  [`${R}/紀錄/錯誤/2026-10 PC-test 錯誤.jsonl`]: '',
  [DECK]: '- 能說明 A ^k3m9x2\n    - QA :: AA\n- 能說明 C\n    - QC :: AC\n',
  [RANGE]: '---\n考試日期: 2026-11-20\n---\n',
};
const EPERM = Object.assign(Error("EPERM: operation not permitted, rename"), { code: 'EPERM' });
const tick = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
const drain = async (): Promise<void> => { for (let i = 0; i < 20; i++) await tick(); };

interface Fake {
  host: GuardHost;
  memory: MemoryFiles;
  notices: string[];
  failures: unknown[];
  moves: string[];
  removed: string[];
  /** 磁碟上有、Obsidian 看不到的資料夾或檔（rmdir 看得到它們：有東西就失敗）。 */
  disk: Set<string>;
  /** Obsidian 看得到的空資料夾（家長新建的，F4）。 */
  visible: Set<string>;
  /** rmdir 真正刪之前（最後一次確認是空的之後）跑：同步程序這時放進東西（F2）。 */
  beforeRmdir: { run: (path: string) => void };
  /** 接下來幾次 move 依序丟出的錯。 */
  failMoves: Error[];
  /** 搬好之後在舊位置留下空資料夾（R5）。 */
  residue: { on: boolean };
  clock: () => number;
  /** 跑 defer 排的工作，等非同步做完。 */
  run: () => Promise<void>;
  saved: () => string[];
}

function fake(initial: Record<string, string> = VAULT, seen?: string[]): Fake {
  const memory = createMemoryFiles(initial);
  const notices: string[] = [], failures: unknown[] = [], moves: string[] = [], removed: string[] = [];
  const disk = new Set<string>();
  const visible = new Set<string>();
  const beforeRmdir: Fake['beforeRmdir'] = { run: () => {} };
  const failMoves: Error[] = [];
  const residue = { on: false };
  const deferred: (() => void)[] = [];
  let clock = 0;
  let saved = seen ?? [];
  const has = (path: string): boolean => [...memory.texts.keys()].some(p => p.startsWith(path + '/'));
  const inDisk = (path: string): boolean => [...disk].some(d => d.startsWith(path + '/'));
  const host: GuardHost = {
    files: () => [...memory.texts.keys()],
    known: path => memory.texts.has(path) ? 'file' : has(path) || visible.has(path) ? 'folder' : null,
    exists: path => Promise.resolve(memory.texts.has(path) || has(path) || disk.has(path) || visible.has(path)),
    empty: path => Promise.resolve(!has(path) && !inDisk(path)),
    rmdir(path) {
      beforeRmdir.run(path);
      // 非遞迴：有東西就失敗（系統的 ENOTEMPTY）。
      if (has(path) || inDisk(path)) return Promise.reject(Object.assign(Error('ENOTEMPTY: directory not empty, rmdir ' + path), { code: 'ENOTEMPTY' }));
      disk.delete(path);
      visible.delete(path);
      removed.push(path);
      return Promise.resolve();
    },
    move(from, to) {
      moves.push(from + ' → ' + to);
      const error = failMoves.shift();
      if (error) return Promise.reject(error);
      if (has(to)) return Promise.reject(Error('Destination file already exists!'));
      memory.rename(from, to);
      if (residue.on) disk.add(from);
      return Promise.resolve();
    },
    notify: message => { notices.push(message); },
    fail: error => { failures.push(error); },
    load: () => saved,
    save: folders => { saved = folders; },
    sleep: ms => { clock += ms; return Promise.resolve(); },
    now: () => clock,
    defer: run => { deferred.push(run); },
  };
  const run = async (): Promise<void> => { for (const each of deferred.splice(0)) each(); await drain(); };
  return { host, memory, notices, failures, moves, removed, disk, visible, beforeRmdir, failMoves, residue, clock: () => clock, run, saved: () => saved };
}

/** 在 Obsidian 裡拖動：防呆先收到 rename（它比 state 先註冊），檔案才換位置、送通知。 */
function drag(f: Fake, guard: FolderGuard, from: string, to: string): void {
  // Obsidian 對資料夾和底下每一項都各送一次 rename（〈結果〉R2）：資料夾本身先。
  guard.renamed(to, from, true);
  for (const path of [...f.memory.texts.keys()].filter(p => p.startsWith(from + '/'))) guard.renamed(to + path.slice(from.length), path, false);
  for (const sub of ['/錯誤', '/小考']) if ([...f.memory.texts.keys()].some(p => p.startsWith(from + sub + '/'))) guard.renamed(to + sub, from + sub, true);
  f.memory.rename(from, to);
}

function started(f: Fake): FolderGuard {
  const guard = createFolderGuard(f.host);
  guard.check();
  return guard;
}

void test('§1 拖走紀錄：搬回原位、跳一次通知', async () => {
  const f = fake();
  const guard = started(f);
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  await f.run();
  assert.deepEqual(f.moves, [`${R}/英文/紀錄 → ${R}/紀錄`]);
  assert.deepEqual([...f.memory.texts.keys()].sort(), Object.keys(VAULT).sort());
  assert.deepEqual(f.notices, ['Essence Cards：「紀錄」是外掛用的資料夾，不能搬動或改名，已經搬回原位']);
  assert.deepEqual(f.failures, []);
});

void test('§1-2 整個 Essence Cards 拖走：同一批只搬最上層', async () => {
  const f = fake();
  const guard = started(f);
  guard.renamed('學校/Essence Cards', R, true);
  for (const sub of ['紀錄', '紀錄/錯誤', '考試範圍']) guard.renamed(`學校/${R}/${sub}`, `${R}/${sub}`, true);
  f.memory.rename(R, '學校/' + R);
  await f.run();
  assert.deepEqual(f.moves, [`學校/${R} → ${R}`]);
  assert.deepEqual([...f.memory.texts.keys()].sort(), Object.keys(VAULT).sort());
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /「Essence Cards」/);
});

void test('§1-2 卡組資料夾、單一檔案、更深處同名的資料夾不管', async () => {
  const f = fake({ ...VAULT, [`${R}/學業/錯題本/x.md`]: '' });
  const guard = started(f);
  guard.renamed(`${R}/英語`, `${R}/英文`, true);
  guard.renamed(`${R}/英文/段考.md`, RANGE, false);
  guard.renamed(`${R}/學業/錯題本2`, `${R}/學業/錯題本`, true);
  await f.run();
  assert.deepEqual(f.moves, []);
});

void test('§1-3 上一層不在：不搬', async () => {
  const f = fake();
  const guard = started(f);
  // 只收到子資料夾的改名，上一層卻已經不在（例如 Essence Cards 改了名，只收到裡面那一次）。
  guard.renamed(`EC/紀錄/錯誤`, `${R}/紀錄/錯誤`, true);
  f.memory.rename(R, 'EC');
  await f.run();
  assert.deepEqual(f.moves, []);
  assert.deepEqual(f.notices, []);
});

void test('§1-3 原位已經有東西：不合併、不覆蓋，跳通知（R7）', async () => {
  const f = fake();
  const guard = started(f);
  drag(f, guard, `${R}/考試範圍`, `${R}/英文/考試範圍`);
  f.memory.texts.set(`${R}/考試範圍/新的.md`, '');
  await f.run();
  assert.deepEqual(f.moves, []);
  assert.deepEqual(f.notices, [`Essence Cards：「考試範圍」是外掛用的資料夾，原位已經有一個同名的，沒有搬回。請把「${R}/英文/考試範圍」裡的檔搬進「${R}/考試範圍」`]);
});

void test('§1-3 原位只剩磁碟上的空資料夾：刪掉再搬', async () => {
  const f = fake();
  const guard = started(f);
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  f.disk.add(`${R}/紀錄`);
  await f.run();
  assert.deepEqual(f.removed, [`${R}/紀錄`]);
  assert.deepEqual(f.moves, [`${R}/英文/紀錄 → ${R}/紀錄`]);
});

void test('§1-4 EPERM 每 200 ms 重試，搬好了照常通知（R4）', async () => {
  const f = fake();
  const guard = started(f);
  f.failMoves.push(EPERM, EPERM, EPERM, EPERM, EPERM);
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  await f.run();
  assert.equal(f.moves.length, 6);
  assert.ok(f.clock() >= 1000);
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /已經搬回原位/);
  assert.deepEqual(f.failures, []);
});

void test('§1-4 EBUSY 也重試；其他錯誤不重試，請家長自己拖回、記進錯誤紀錄', async () => {
  const busy = fake();
  const guard1 = started(busy);
  busy.failMoves.push(Object.assign(Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }));
  drag(busy, guard1, `${R}/紀錄`, `${R}/英文/紀錄`);
  await busy.run();
  assert.equal(busy.moves.length, 2);

  const f = fake();
  const guard = started(f);
  const other = Error('something else');
  f.failMoves.push(other);
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  await f.run();
  assert.equal(f.moves.length, 1);
  assert.deepEqual(f.failures, [other]);
  assert.deepEqual(f.notices, [`Essence Cards：「紀錄」是外掛用的資料夾，沒能搬回原位，請把它拖回「${R}/紀錄」`]);
});

void test('§1-4 一直 EPERM：10 秒後放棄', async () => {
  const f = fake();
  const guard = started(f);
  f.failMoves.push(...Array<Error>(100).fill(EPERM));
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  await f.run();
  assert.equal(f.moves.length, 51);
  assert.equal(f.failures.length, 1);
  assert.match(f.notices[0], /沒能搬回原位/);
  // 放棄之後照常放行通知、照常判斷：提醒一區列出它在哪裡。
  assert.deepEqual(guard.issues(), [{ kind: 'moved', folder: `${R}/紀錄`, at: [`${R}/英文/紀錄`] }]);
});

void test('§1-5 暫時的位置冒出空資料夾：完全是空的才刪（R5）', async () => {
  const f = fake();
  const guard = started(f);
  f.residue.on = true;
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  await f.run();
  assert.deepEqual(f.removed, [`${R}/英文/紀錄`]);

  const g = fake();
  const guard2 = started(g);
  g.residue.on = true;
  drag(g, guard2, `${R}/紀錄`, `${R}/英文/紀錄`);
  // 搬回之後，有人在那個位置放了檔：不刪。
  g.disk.add(`${R}/英文/紀錄/別人的.md`);
  await g.run();
  assert.deepEqual(g.removed, []);
});

void test('§1-8 搬走到搬回之間 state 收不到通知、不寫檔；搬回後今天的份不變', async (t: TestContext) => {
  const f = fake();
  const guard = started(f);
  const modifies: string[] = [];
  const appends: string[] = [];
  const inner = { ...f.memory.files,
    modify: (path: string, edit: (text: string, exists: boolean) => string) => { modifies.push(path); return f.memory.files.modify(path, edit); },
    append: (path: string, line: string) => { appends.push(path); return f.memory.files.append(path, line); } };
  const files = guard.wrap(inner);
  const state = createState({ files, skip: path => guard.misplaced(path), device: 'PC-test', delay: 1, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  const before = JSON.stringify(state.progress());
  const reads = f.memory.reads.length;
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  await new Promise(resolve => { setTimeout(resolve, 20); });
  // 還沒跑 defer：搬走的通知全擋住，state 沒有重讀。
  assert.equal(f.memory.reads.length, reads);
  assert.equal(JSON.stringify(state.progress()), before);
  await f.run();
  await new Promise(resolve => { setTimeout(resolve, 20); });
  await state.flush();
  assert.deepEqual(modifies, []);
  assert.deepEqual(appends, []);
  assert.equal(JSON.stringify(state.progress()), before);
  // 離開筆記的補 ID 照常（搬回後沒有被擋住）。
  assert.equal(await state.fillIds(DECK), true);
});

void test('§2-3 範圍檔被搬進卡組資料夾：不列、讀不到、不補 ID；搬回原位後恢復', async (t: TestContext) => {
  const f = fake();
  const guard = started(f);
  const files = guard.wrap(f.memory.files);
  const state = createState({ files, skip: path => guard.misplaced(path), device: 'PC-test', delay: 1, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  // Obsidian 以外搬的：只有新增、刪除，防呆不搬（§2）。
  const range = `${R}/英文/考試範圍/段考.md`;
  f.memory.write(range, '- 能說明 X\n    - QX :: AX\n');
  f.memory.remove(RANGE);
  f.memory.remove(`${R}/考試範圍`);
  guard.check();
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(guard.issues(), [{ kind: 'moved', folder: `${R}/考試範圍`, at: [`${R}/英文/考試範圍`] }]);
  assert.equal(guard.misplaced(range), true);
  assert.deepEqual(await files.list(R + '/英文'), [DECK]);
  assert.equal(await files.read(range), null);
  assert.ok(!state.decks().some(entry => entry.path === range));
  assert.equal(await state.fillIds(range), false);
  assert.equal(f.memory.texts.get(range), '- 能說明 X\n    - QX :: AX\n');

  // 提醒的「搬回原位」。
  assert.equal(await guard.moveBack(guard.issues()[0]), true);
  assert.equal(f.memory.texts.get(`${R}/考試範圍/段考.md`), '- 能說明 X\n    - QX :: AX\n');
  assert.deepEqual(guard.issues(), []);
  assert.match(f.notices.at(-1) ?? '', /已經把「考試範圍」搬回原位/);
});

void test('§2-4 「不用了」拿掉這台的記憶', () => {
  const f = fake();
  const guard = started(f);
  f.memory.remove(`${R}/紀錄/錯誤/2026-10 PC-test 錯誤.jsonl`);
  guard.check();
  assert.deepEqual(guard.issues(), [{ kind: 'missing', folder: `${R}/紀錄/錯誤` }]);
  let changed = 0;
  guard.onChange(() => { changed++; });
  guard.dismiss(`${R}/紀錄/錯誤`);
  assert.deepEqual(guard.issues(), []);
  assert.equal(changed, 1);
  assert.ok(!f.saved().includes(`${R}/紀錄/錯誤`));
});

void test('§2-1 layout ready 之前不判斷；記住的名字存在這台', () => {
  const f = fake();
  const guard = createFolderGuard(f.host);
  guard.changed();
  assert.deepEqual(f.saved(), []);
  guard.check();
  assert.deepEqual(f.saved(), [R, `${R}/考試範圍`, `${R}/紀錄`, `${R}/紀錄/錯誤`]);
  guard.close();
});

void test('§2-4 按鈕只給找到一個位置的那一種', async () => {
  const f = fake();
  const guard = started(f);
  assert.equal(await guard.moveBack({ kind: 'missing', folder: `${R}/紀錄` }), false);
  assert.equal(await guard.moveBack({ kind: 'moved', folder: `${R}/紀錄`, at: ['a', 'b'] }), false);
  assert.deepEqual(f.moves, []);
});

// ---- Codex L2 第一輪（Claude Codex Discussion/2026-11-07-system-folder-guard-review.md）的回歸 ----

const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 20); });

function study(f: Fake, guard: FolderGuard, t: TestContext) {
  const state = createState({ files: guard.wrap(f.memory.files), skip: path => guard.misplaced(path), device: 'PC-test', delay: 1, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480 });
  t.after(() => state.close());
  return state;
}

const OWN_LOG = `${R}/紀錄/2026-10 PC-test.jsonl`;
const OUTCOMES = [
  { name: '搬回成功', fail: [] as Error[] },
  { name: '重試後成功', fail: [EPERM, EPERM, EPERM] },
  { name: '放棄', fail: Array<Error>(100).fill(EPERM) },
];

for (const outcome of OUTCOMES) {
  void test(`F1 搬回期間作答：先不追加，${outcome.name}之後才寫，作答不丟`, async (t: TestContext) => {
    const f = fake();
    const guard = started(f);
    const state = study(f, guard, t);
    await state.ready();
    f.failMoves.push(...outcome.fail);
    drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
    assert.ok(state.answer({ lt: 'k3m9x2', r: 'good', v: '12345678' }));
    const flushing = state.flush();
    await settle();
    assert.ok(![...f.memory.texts.keys()].some(path => path.endsWith('2026-10 PC-test.jsonl')), '搬好之前不追加（不在原位建新的紀錄）');
    await f.run();
    await flushing;
    assert.match(f.memory.texts.get(OWN_LOG) ?? '', /"lt":"k3m9x2","r":"good"/);
    if (outcome.name === '放棄') {
      // 原有的紀錄留在暫時的位置，新的寫在原位：兩份都在，提醒一區列成兩邊都有，請家長合併（§2）。
      assert.equal(f.memory.texts.get(`${R}/英文/紀錄/2026-10 iPhone-test.jsonl`), VAULT[LOG]);
      guard.check();
      assert.equal(guard.issues()[0]?.kind, 'both');
    } else {
      assert.equal(f.memory.texts.get(LOG), VAULT[LOG]);
      assert.deepEqual(guard.issues(), []);
      assert.deepEqual(f.notices, ['Essence Cards：「紀錄」是外掛用的資料夾，不能搬動或改名，已經搬回原位']);
    }
  });
}

void test('F1 搬回期間存檔、離開筆記：暫時位置裡的範圍檔不補 ID，搬回後內容不變', async (t: TestContext) => {
  const content = '- 範圍目標\n    - Q :: A\n';
  const f = fake({ ...VAULT, [RANGE]: content });
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  const at = `${R}/英文/考試範圍/段考.md`;
  drag(f, guard, `${R}/考試範圍`, `${R}/英文/考試範圍`);
  assert.equal(guard.misplaced(at), true);
  let text = content;
  const editor = { path: at, text: () => text, apply(before: string, after: string) { assert.equal(text, before); text = after; return true; }, persist: () => f.memory.files.modify(at, () => text) };
  assert.notEqual((await state.save(editor)).kind, 'done');
  assert.equal(await state.fillIds(at), false);
  assert.equal(text, content);
  await f.run();
  assert.equal(f.memory.texts.get(RANGE), content);
  assert.equal(guard.misplaced(RANGE), false);
});

void test('F1 搬動前已排好的重讀：等搬回之後才讀，原有的紀錄不會從進度裡消失', async (t: TestContext) => {
  const f = fake();
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  const history = JSON.stringify(state.history());
  f.memory.notify(LOG);
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  await settle();
  assert.equal(JSON.stringify(state.history()), history);
  await f.run();
  await settle();
  assert.equal(JSON.stringify(state.history()), history);
  assert.ok(f.memory.reads.includes(LOG));
});

/** Obsidian 以外搬走考試範圍（§2）：提醒一區列出「搬回原位」。 */
function movedOutside(f: Fake): FolderGuard {
  const guard = started(f);
  f.memory.rename(`${R}/考試範圍`, `${R}/英文/考試範圍`);
  guard.check();
  assert.deepEqual(guard.issues(), [{ kind: 'moved', folder: `${R}/考試範圍`, at: [`${R}/英文/考試範圍`] }]);
  return guard;
}

for (const step of ['exists', 'empty', 'rmdir', 'move'] as const) {
  void test(`F3 「搬回原位」的 ${step} 失敗：不拒絕，記一次錯誤紀錄、通知家長`, async () => {
    const f = fake();
    const guard = movedOutside(f);
    // empty、rmdir 只在原位剩下磁碟上的空資料夾時才會用到。
    if (step === 'empty' || step === 'rmdir') f.disk.add(`${R}/考試範圍`);
    const error = Object.assign(Error(`EACCES: ${step}`), { code: 'EACCES' });
    if (step === 'move') f.failMoves.push(error);
    else if (step === 'rmdir') f.host.rmdir = () => Promise.reject(error);
    else f.host[step] = () => Promise.reject(error);
    assert.equal(await guard.moveBack(guard.issues()[0]), false);
    assert.deepEqual(f.failures, [error]);
    assert.deepEqual(f.notices, [`Essence Cards：「考試範圍」是外掛用的資料夾，沒能搬回原位，請把它拖回「${R}/考試範圍」`]);
    // 放行了：之後照常判斷。
    assert.equal(guard.issues()[0]?.kind, 'moved');
  });
}

void test('F4 原位有 Obsidian 看得到的空資料夾：當成有東西，不刪；看不到的磁碟殘留才刪', async () => {
  const f = fake();
  const guard = movedOutside(f);
  f.visible.add(`${R}/考試範圍`);
  assert.equal(await guard.moveBack(guard.issues()[0]), false);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.moves, []);
  assert.match(f.notices[0], /原位已經有一個同名的，沒有搬回/);

  const g = fake();
  const guard2 = movedOutside(g);
  g.disk.add(`${R}/考試範圍`);
  assert.equal(await guard2.moveBack(guard2.issues()[0]), true);
  assert.deepEqual(g.removed, [`${R}/考試範圍`]);
});

void test('F2 最後一次確認是空的之後才同步進來的內容：刪不掉就留著，記下、請家長自己拖回', async () => {
  const f = fake();
  const guard = movedOutside(f);
  f.disk.add(`${R}/考試範圍`);
  const arrived = `${R}/考試範圍/同步剛到的.md`;
  f.beforeRmdir.run = () => { f.disk.add(arrived); };
  assert.equal(await guard.moveBack(guard.issues()[0]), false);
  assert.ok(f.disk.has(arrived));
  assert.deepEqual(f.removed, []);
  assert.equal(f.failures.length, 1);
  assert.match(f.notices[0], /沒能搬回原位/);

  // 搬回後的清理也一樣：確認是空的之後才放進來的，不刪。
  const g = fake();
  const guard2 = started(g);
  g.residue.on = true;
  g.beforeRmdir.run = path => { g.disk.add(path + '/同步剛到的.md'); };
  drag(g, guard2, `${R}/紀錄`, `${R}/英文/紀錄`);
  await g.run();
  assert.ok(g.disk.has(`${R}/英文/紀錄/同步剛到的.md`));
  assert.deepEqual(g.removed, []);
});
