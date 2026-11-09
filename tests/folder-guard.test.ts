import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry } from '../src/core/study/index.ts';
import { createFolderGuard, type FolderGuard, type FolderRef, type GuardHost } from '../src/obsidian/folder-guard.ts';
import type { Files } from '../src/core/files.ts';
import { sha256Hex } from '../src/core/ai/index.ts';
import type { CardForm, CardJob, EmbeddedRules } from '../src/core/ai/index.ts';
import { createAiCards } from '../src/obsidian/ai-cards.ts';
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
  /** 給 guard.wrap 的 Files：drag 的時候通知先收著，防呆收完 rename 才送（和 Obsidian 一樣：清單先換，再依註冊順序通知）。 */
  files: Files;
  /** 在 Obsidian 裡搬：資料夾本身跟著走（內容、資料夾物件一起換位置）。 */
  shift: (from: string, to: string) => void;
  /** 在 Obsidian 以外搬：Obsidian 看到的是刪掉再新建，舊的資料夾物件不在了。 */
  outside: (from: string, to: string) => void;
  /** 收著通知跑 run，跑完再送。 */
  quietly: (run: () => void) => void;
  /** 磁碟上這個位置換成了別的資料夾，Obsidian 的清單卻沒跟上（W10 遇過）：清單裡的資料夾物件磁碟上對不上。 */
  swap: (path: string) => void;
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
  /** host.later 排著的（搬回的總時限）：測試自己觸發。 */
  timers: (() => void)[];
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
  const timers: (() => void)[] = [];
  let clock = 0;
  let saved = seen ?? [];
  const has = (path: string): boolean => [...memory.texts.keys()].some(p => p.startsWith(path + '/'));
  const inDisk = (path: string): boolean => [...disk].some(d => d.startsWith(path + '/'));
  const within = (path: string, folder: string): boolean => path === folder || path.startsWith(folder + '/');
  const known = (path: string): 'folder' | 'file' | null => memory.texts.has(path) ? 'file' : has(path) || visible.has(path) ? 'folder' : null;
  /** 資料夾物件（Obsidian 的 TFolder 替身）：同一個位置拿到同一個；Obsidian 以外搬走（outside）就作廢，之後同一個位置是新的。 */
  const refs: { path: string; alive: boolean }[] = [];
  const where = (ref: FolderRef): string | null => {
    const found = refs.find(each => each === ref);
    return found?.alive && known(found.path) === 'folder' ? found.path : null;
  };
  const relocate = (from: string, to: string): void => {
    for (const ref of refs) if (ref.alive && within(ref.path, from)) ref.path = to + ref.path.slice(from.length);
  };
  let queue: (() => void)[] | null = null;
  const quietly = (run: () => void): void => {
    // 已經在收著了：一起收，最外面那一層跑完再送。
    if (queue) { run(); return; }
    queue = [];
    try { run(); } finally {
      const later = queue;
      queue = null;
      for (const each of later) each();
    }
  };
  /** 磁碟上已經不是它的資料夾物件（swap）。 */
  const swapped = new Set<object>();
  // 檔案和資料夾物件一起換好，才送通知（和 Obsidian 一樣：清單整個換好才通知）。
  const shift = (from: string, to: string): void => { quietly(() => { memory.rename(from, to); relocate(from, to); }); };
  const files: Files = {
    ...memory.files,
    watch: onChange => memory.files.watch(path => { if (queue) queue.push(() => { onChange(path); }); else onChange(path); }),
  };
  const host: GuardHost = {
    files: () => [...memory.texts.keys()],
    known,
    folder(path) {
      const found = refs.find(ref => ref.alive && ref.path === path && known(path) === 'folder');
      if (found) return found;
      if (known(path) !== 'folder') return null;
      const ref = { path, alive: true };
      refs.push(ref);
      return ref;
    },
    where,
    intact: ref => Promise.resolve(!swapped.has(ref)),
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
    move(ref, to) {
      const from = where(ref);
      if (from === null) return Promise.reject(Error('找不到資料夾'));
      moves.push(from + ' → ' + to);
      const error = failMoves.shift();
      if (error) return Promise.reject(error);
      if (has(to)) return Promise.reject(Error('Destination file already exists!'));
      shift(from, to);
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
    later: (_ms, run) => { timers.push(run); return () => { timers.splice(timers.indexOf(run) >>> 0, timers.includes(run) ? 1 : 0); }; },
  };
  const run = async (): Promise<void> => { for (const each of deferred.splice(0)) each(); await drain(); };
  const outside = (from: string, to: string): void => {
    for (const ref of refs) if (within(ref.path, from)) ref.alive = false;
    memory.rename(from, to);
  };
  const swap = (path: string): void => { for (const ref of refs) if (ref.alive && ref.path === path) swapped.add(ref); };
  return { host, memory, files, shift, outside, quietly, swap, notices, failures, moves, removed, disk, visible, beforeRmdir, failMoves, residue, clock: () => clock, run, timers, saved: () => saved };
}

/** 在 Obsidian 裡拖動：清單先換（資料夾物件跟著走），防呆先收到 rename（它比 state 先註冊），state 才收到通知。 */
function drag(f: Fake, guard: FolderGuard, from: string, to: string): void {
  const paths = [...f.memory.texts.keys()].filter(p => p.startsWith(from + '/'));
  f.quietly(() => {
    f.shift(from, to);
    // Obsidian 對資料夾和底下每一項都各送一次 rename（〈結果〉R2）：資料夾本身先。
    guard.renamed(to, from, true);
    for (const path of paths) guard.renamed(to + path.slice(from.length), path, false);
    for (const sub of ['/錯誤', '/小考']) if (paths.some(p => p.startsWith(from + sub + '/'))) guard.renamed(to + sub, from + sub, true);
  });
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
  f.quietly(() => {
    f.shift(R, '學校/' + R);
    guard.renamed('學校/Essence Cards', R, true);
    for (const sub of ['紀錄', '紀錄/錯誤', '考試範圍']) guard.renamed(`學校/${R}/${sub}`, `${R}/${sub}`, true);
  });
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
  const inner = { ...f.files,
    modify: (path: string, edit: (text: string, exists: boolean) => string) => { modifies.push(path); return f.memory.files.modify(path, edit); },
    append: (path: string, line: string) => { appends.push(path); return f.memory.files.append(path, line); } };
  const files = guard.wrap(inner);
  const state = createState({ files, skip: path => guard.misplaced(path), device: 'PC-test', delay: 1, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  await state.flush();
  appends.length = 0;
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
  const files = guard.wrap(f.files);
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
  const state = createState({ files: guard.wrap(f.files), skip: path => guard.misplaced(path), device: 'PC-test', delay: 1, fillIds: true, random: () => 0,
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
    await state.flush();
    f.failMoves.push(...outcome.fail);
    drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
    assert.ok(state.answer({ lt: 'k3m9x2', r: 'good', v: '12345678' }));
    const flushing = state.flush();
    await settle();
    assert.equal(f.memory.texts.has(OWN_LOG), false, '搬好之前不在原位建新的紀錄');
    assert.doesNotMatch(f.memory.texts.get(`${R}/英文/紀錄/2026-10 PC-test.jsonl`) ?? '', /k3m9x2/, '搬好之前不追加');
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
  f.outside(`${R}/考試範圍`, `${R}/英文/考試範圍`);
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

// ---- Codex L2 第二輪 ----

/** syntax §3 的錯題本草稿：補強題有卡片語法，當成卡組時會被補 ID。 */
const DRAFT = '---\n年級學期: 國二上\n科目: 自然\n考試: 第一次段考\n日期: 2026-10-20\n狀態: 草稿\n---\n\n### 錯題 1：糖水的溶劑是什麼？\n- 學生答案：糖\n- 正確答案：水\n- 錯因：忘記\n- 理由：記反了。\n- 對應：[[L1#^k3m9x2|能說明 A]]\n- 補強：\n    - 糖水的溶劑是什麼？ :: 水\n';
const WRONG = `${R}/錯題本`;
const EACCES = Object.assign(Error('EACCES: permission denied, rename'), { code: 'EACCES' });
const NOTICE_WRONG = 'Essence Cards：「錯題本」是外掛用的資料夾，不能搬動或改名，已經搬回原位';

function editorOn(path: string, initial: string) {
  let text = initial;
  return { path, text: () => text, apply(before: string, after: string) { assert.equal(text, before); text = after; return true; }, persist: () => Promise.resolve() };
}

void test('第二輪 F1 兩筆搬回交錯：先放棄的那一筆，暫時位置立刻不當卡組，不等另一筆搬完', async (t: TestContext) => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  let logBack = (): void => {};
  const waiting = new Promise<void>(resolve => { logBack = resolve; });
  const move = f.host.move.bind(f.host);
  f.host.move = async (ref, to) => {
    if (to === WRONG) throw EACCES;
    await waiting;
    return move(ref, to);
  };
  drag(f, guard, WRONG, `${R}/英文/錯題本`);
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  const at = `${R}/英文/錯題本/草稿.md`;
  const reading = guard.wrap(f.files).read(at);
  await f.run();
  // 錯題本放棄了，紀錄還在搬：錯題本的暫時位置已經排除。
  assert.equal(await reading, null);
  assert.equal(guard.misplaced(at), true);
  assert.notEqual((await state.save(editorOn(at, DRAFT))).kind, 'done');
  assert.equal(await state.fillIds(at), false);
  assert.equal(f.memory.texts.get(at), DRAFT);
  logBack();
  await f.run();
  assert.equal(guard.misplaced(at), true);
  assert.deepEqual(guard.issues(), [{ kind: 'moved', folder: WRONG, at: [`${R}/英文/錯題本`] }]);
  assert.equal(f.memory.texts.get(at), DRAFT);
});

void test('第二輪 F1 在 Obsidian 裡改成別的名字、搬不回：照 rename 知道的位置不當卡組，搬回去之後恢復', async (t: TestContext) => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  const renamed = `${R}/草稿資料夾`;
  f.failMoves.push(EACCES);
  drag(f, guard, WRONG, renamed);
  await f.run();
  // §2-2 只找同名，判成找不到；改名後的位置照樣排除。
  assert.deepEqual(guard.issues(), [{ kind: 'missing', folder: WRONG }]);
  assert.equal(guard.misplaced(`${renamed}/草稿.md`), true);
  assert.equal(await state.fillIds(`${renamed}/草稿.md`), false);
  assert.equal(f.memory.texts.get(`${renamed}/草稿.md`), DRAFT);
  // 家長在 Obsidian 裡拖回去：不再記那個位置，之後在那裡新建的資料夾是家長自己的（第三輪 F1：不必等判斷）。
  drag(f, guard, renamed, WRONG);
  f.memory.write(`${renamed}/自己的.md`, '- 能說明 B\n    - QB :: AB\n');
  assert.equal(guard.misplaced(`${renamed}/自己的.md`), false);
  assert.equal(await guard.wrap(f.files).read(`${renamed}/自己的.md`), '- 能說明 B\n    - QB :: AB\n');
  assert.deepEqual(await guard.wrap(f.files).list(renamed), [`${renamed}/自己的.md`]);
  guard.check();
  assert.deepEqual(guard.issues(), []);
  assert.equal(guard.misplaced(`${renamed}/自己的.md`), false);
});

/** 錯題本搬不回、停在 at（改了名，§2-2 找不到同名）。 */
async function strandedAt(f: Fake, guard: FolderGuard, at: string): Promise<void> {
  f.failMoves.push(EACCES);
  drag(f, guard, WRONG, at);
  await f.run();
  assert.equal(guard.misplaced(`${at}/草稿.md`), true);
}

void test('第三輪 F1 搬不回之後再改一次名：新位置照樣不當卡組，不補 ID', async (t: TestContext) => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  await strandedAt(f, guard, `${R}/草稿資料夾`);
  const next = `${R}/另一個名字`;
  drag(f, guard, `${R}/草稿資料夾`, next);
  // 不等判斷：rename 事件就換了位置。
  const at = `${next}/草稿.md`;
  assert.equal(guard.misplaced(at), true);
  assert.equal(await guard.wrap(f.files).read(at), null);
  assert.notEqual((await state.save(editorOn(at, DRAFT))).kind, 'done');
  assert.equal(await state.fillIds(at), false);
  guard.check();
  assert.equal(guard.misplaced(at), true);
  assert.equal(f.memory.texts.get(at), DRAFT);
  assert.deepEqual(f.moves, [`${R}/草稿資料夾 → ${WRONG}`], '只有原位名單的改名才自動搬回');
});

void test('第三輪 F1 上一層改名帶走搬不回的資料夾：跟著換，旁邊的卡組照常', async (t: TestContext) => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  await strandedAt(f, guard, `${R}/英文/草稿資料夾`);
  drag(f, guard, `${R}/英文`, `${R}/English`);
  const at = `${R}/English/草稿資料夾/草稿.md`;
  assert.equal(guard.misplaced(at), true);
  assert.equal(await state.fillIds(at), false);
  assert.equal(guard.misplaced(`${R}/English/L1.md`), false);
  guard.check();
  assert.equal(guard.misplaced(at), true);
  assert.equal(f.memory.texts.get(at), DRAFT);
  // 再把它拖回原位：不再記。
  drag(f, guard, `${R}/English/草稿資料夾`, WRONG);
  guard.check();
  assert.deepEqual(guard.issues(), []);
  assert.equal(guard.misplaced(`${WRONG}/草稿.md`), false);
});

void test('第三輪 F1 搬回期間又被改名、之後搬不回：記的是改名後的位置', async (t: TestContext) => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  let fail: (error: Error) => void = () => {};
  f.host.move = () => new Promise<void>((_resolve, reject) => { fail = reject; });
  drag(f, guard, WRONG, `${R}/英文/錯題本`);
  await f.run();
  const next = `${R}/草稿資料夾`;
  drag(f, guard, `${R}/英文/錯題本`, next);
  assert.equal(guard.misplaced(`${next}/草稿.md`), true, '搬回期間也不當卡組');
  fail(Object.assign(Error('ENOENT: no such file or directory, rename'), { code: 'ENOENT' }));
  await drain();
  guard.check();
  assert.equal(guard.misplaced(`${next}/草稿.md`), true);
  assert.equal(await state.fillIds(`${next}/草稿.md`), false);
  assert.equal(f.memory.texts.get(`${next}/草稿.md`), DRAFT);
});

void test('第三輪 F1 防呆自己搬回時收到的 rename：原位的檔不當成搬錯位置', async () => {
  const f = fake();
  const guard = started(f);
  let finish = (): void => {};
  // 實際的 Obsidian 搬好時，防呆也會收到自己這次搬動的 rename；底層的 Promise 晚一點才結束。
  f.host.move = (ref, to) => new Promise<void>(resolve => {
    const from = f.host.where(ref) ?? '';
    f.quietly(() => { f.shift(from, to); guard.renamed(to, from, true); });
    finish = resolve;
  });
  drag(f, guard, `${R}/考試範圍`, `${R}/英文/考試範圍`);
  await f.run();
  assert.equal(f.memory.texts.has(RANGE), true);
  assert.equal(guard.misplaced(RANGE), false);
  finish();
  await drain();
  assert.equal(guard.misplaced(RANGE), false);
  assert.match(f.notices[0], /已經搬回原位/);
});

void test('第三輪 F1 判斷出搬錯位置的上一層在 Obsidian 裡改名：下一次判斷之前也跟著換', () => {
  const f = fake();
  const guard = movedOutside(f);
  const at = `${R}/English/考試範圍`;
  drag(f, guard, `${R}/英文`, `${R}/English`);
  assert.equal(guard.misplaced(`${at}/段考.md`), true);
  assert.equal(guard.misplaced(`${R}/English/L1.md`), false);
  // 拖回原位：不等判斷就不再排除。
  drag(f, guard, at, `${R}/考試範圍`);
  assert.equal(guard.misplaced(RANGE), false);
  guard.check();
  assert.deepEqual(guard.issues(), []);
});

const OWN = '- 能說明 B\n    - QB :: AB\n';
const ENOENT = Object.assign(Error('ENOENT: no such file or directory, rename'), { code: 'ENOENT' });

void test('第四輪 F1a 重試等待時家長又改名、舊位置放了自己的卡組：搬的是錯題本本身，家長的卡組留在原地', async () => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const temp = `${R}/英文/錯題本`, next = `${R}/草稿資料夾`;
  f.failMoves.push(EPERM);
  const sleep = f.host.sleep.bind(f.host);
  let once = true;
  f.host.sleep = ms => {
    if (once) {
      once = false;
      drag(f, guard, temp, next);
      f.memory.write(`${temp}/自己的.md`, OWN);
    }
    return sleep(ms);
  };
  drag(f, guard, WRONG, temp);
  await f.run();
  // 等待中收到的改名排的工作也跑完：多排了一筆的話它會在這裡搬。
  await f.run();
  assert.deepEqual(f.moves, [`${temp} → ${WRONG}`, `${next} → ${WRONG}`]);
  assert.equal(f.memory.texts.get(`${WRONG}/草稿.md`), DRAFT);
  assert.equal(f.memory.texts.get(`${temp}/自己的.md`), OWN);
  assert.equal(f.memory.texts.has(`${WRONG}/自己的.md`), false);
  assert.equal(guard.misplaced(`${temp}/自己的.md`), false);
  assert.equal(await guard.wrap(f.files).read(`${temp}/自己的.md`), OWN);
  assert.deepEqual(f.notices, [NOTICE_WRONG]);
});

void test('第四輪 F1a 重試等待時家長自己拖回原位：不再搬、不通知', async () => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const temp = `${R}/英文/錯題本`;
  f.failMoves.push(EPERM);
  const sleep = f.host.sleep.bind(f.host);
  f.host.sleep = ms => { if (f.memory.texts.has(`${temp}/草稿.md`)) drag(f, guard, temp, WRONG); return sleep(ms); };
  drag(f, guard, WRONG, temp);
  await f.run();
  assert.deepEqual(f.moves, [`${temp} → ${WRONG}`]);
  assert.deepEqual(f.notices, []);
  assert.deepEqual(f.failures, []);
  assert.equal(f.memory.texts.get(`${WRONG}/草稿.md`), DRAFT);
  assert.equal(guard.misplaced(`${WRONG}/草稿.md`), false);
});

void test('第四輪 F1a 搬回還沒回來、家長已經拖回原位又重用舊位置：之後才失敗也不當成放棄，家長的卡組讀得到', async () => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const temp = `${R}/英文/錯題本`;
  let fail: (error: Error) => void = () => {};
  f.host.move = () => new Promise<void>((_resolve, reject) => { fail = reject; });
  drag(f, guard, WRONG, temp);
  await f.run();
  drag(f, guard, temp, WRONG);
  f.memory.write(`${temp}/自己的.md`, OWN);
  fail(ENOENT);
  await drain();
  assert.deepEqual(f.notices, []);
  assert.deepEqual(f.failures, []);
  assert.equal(guard.misplaced(`${temp}/自己的.md`), false);
  assert.equal(guard.misplaced(`${WRONG}/草稿.md`), false);
  guard.check();
  guard.check();
  assert.deepEqual(guard.issues(), []);
  assert.equal(await guard.wrap(f.files).read(`${temp}/自己的.md`), OWN);
  assert.ok((await guard.wrap(f.files).list(`${R}/英文`)).includes(`${temp}/自己的.md`));
});

void test('第四輪 F1b 搬回期間又改名：新位置的讀、列、通知也等搬回結束，放棄了就讀不到，不進卡組', async (t: TestContext) => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  let fail: (error: Error) => void = () => {};
  f.host.move = () => new Promise<void>((_resolve, reject) => { fail = reject; });
  drag(f, guard, WRONG, `${R}/英文/錯題本`);
  await f.run();
  const next = `${R}/草稿資料夾`, at = `${next}/草稿.md`;
  drag(f, guard, `${R}/英文/錯題本`, next);
  assert.notEqual(guard.pause(at), null);
  assert.notEqual(guard.pause(R, true), null);
  let read = undefined as string | null | undefined;
  void guard.wrap(f.files).read(at).then(text => { read = text; });
  let listed = undefined as string[] | undefined;
  void guard.wrap(f.files).list(R).then(paths => { listed = paths; });
  await drain();
  assert.equal(read, undefined, '搬回結束前不讀');
  assert.equal(listed, undefined, '搬回結束前不列');
  assert.ok(!state.decks().some(entry => entry.path === at));
  fail(EACCES);
  await drain();
  assert.equal(read, null);
  const final = listed as string[] | undefined;
  assert.ok(final && !final.includes(at));
  await drain();
  assert.ok(!state.decks().some(entry => entry.path === at));
  assert.equal(await state.fillIds(at), false);
  assert.equal(f.memory.texts.get(at), DRAFT);
});

void test('第四輪 F1c 搬不回的資料夾被拖到別的系統資料夾原位：那裡照那個資料夾的規則，同步來的紀錄讀得到', async () => {
  const f = fake({ [DECK]: VAULT[DECK], [RANGE]: VAULT[RANGE], [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  await strandedAt(f, guard, `${R}/草稿資料夾`);
  const logs = `${R}/紀錄`;
  drag(f, guard, `${R}/草稿資料夾`, logs);
  f.memory.write(LOG, VAULT[LOG]);
  const files = guard.wrap(f.files);
  assert.equal(guard.misplaced(LOG), false);
  assert.equal(await files.read(LOG), VAULT[LOG]);
  assert.ok((await files.list(logs)).includes(LOG));
  guard.check();
  assert.equal(await files.read(LOG), VAULT[LOG]);
});

void test('第四輪 F1d 搬不回之後在 Obsidian 以外搬回原位、舊位置再建自己的卡組：不是同一個資料夾，照常讀得到', async () => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const temp = `${R}/草稿資料夾`;
  await strandedAt(f, guard, temp);
  f.outside(temp, WRONG);
  f.memory.write(`${temp}/自己的.md`, OWN);
  assert.equal(guard.misplaced(`${temp}/自己的.md`), false);
  guard.check();
  guard.check();
  assert.deepEqual(guard.issues(), []);
  assert.equal(guard.misplaced(`${temp}/自己的.md`), false);
  assert.equal(await guard.wrap(f.files).read(`${temp}/自己的.md`), OWN);
  // 家長再在 Obsidian 裡改名自己的資料夾：也不會帶著排除走。
  drag(f, guard, temp, `${R}/自己的資料夾`);
  assert.equal(guard.misplaced(`${R}/自己的資料夾/自己的.md`), false);
  assert.equal(guard.misplaced(`${WRONG}/草稿.md`), false);
});

void test('第五輪 F1a 重試等待時被拖過另一個系統資料夾的空原位再改名：同一個資料夾只搬一次，不被搬到那個原位', async () => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const temp = `${R}/英文/錯題本`, anchors = `${R}/記憶錨點`, next = `${R}/另一個名字`;
  f.failMoves.push(EPERM);
  const sleep = f.host.sleep.bind(f.host);
  let once = true;
  f.host.sleep = ms => {
    if (once) {
      once = false;
      drag(f, guard, temp, anchors);
      drag(f, guard, anchors, next);
    }
    return sleep(ms);
  };
  drag(f, guard, WRONG, temp);
  await f.run();
  // 等待中收到的改名排的工作也跑完：多排了一筆的話它會在這裡搬。
  await f.run();
  assert.deepEqual(f.moves, [`${temp} → ${WRONG}`, `${next} → ${WRONG}`]);
  assert.equal(f.memory.texts.get(`${WRONG}/草稿.md`), DRAFT);
  assert.deepEqual(f.notices, [NOTICE_WRONG]);
  assert.equal(guard.misplaced(`${WRONG}/草稿.md`), false);
});

void test('第五輪 F1a 搬好之後、回報之前又被拖走：照它現在的位置再搬一次，搬好了才放行', async () => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const temp = `${R}/英文/錯題本`, again = `${R}/又一次`;
  const moves: string[] = [];
  let finish = (): void => {};
  f.host.move = (ref, to) => {
    const from = f.host.where(ref) ?? '';
    moves.push(`${from} → ${to}`);
    // 實際的 Obsidian：搬好時防呆也收到自己的 rename，底層的 Promise 晚一點才回來。
    f.quietly(() => { f.shift(from, to); guard.renamed(to, from, true); });
    return moves.length === 1 ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve();
  };
  drag(f, guard, WRONG, temp);
  await f.run();
  // 還沒回報：家長又把它從原位拖走。這次改名被正在進行的那一筆擋下。
  drag(f, guard, WRONG, again);
  assert.equal(guard.misplaced(`${again}/草稿.md`), true);
  assert.notEqual(guard.pause(`${again}/草稿.md`), null);
  finish();
  await drain();
  assert.deepEqual(moves, [`${temp} → ${WRONG}`, `${again} → ${WRONG}`]);
  assert.equal(f.memory.texts.get(`${WRONG}/草稿.md`), DRAFT);
  assert.equal(guard.pause(`${WRONG}/草稿.md`), null);
  assert.deepEqual(f.notices, [NOTICE_WRONG]);
});

void test('第五輪 F1a 重試時磁碟上已經換成別的資料夾、Obsidian 的清單沒跟上：不搬，請家長自己拖回', async () => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const temp = `${R}/英文/錯題本`;
  f.failMoves.push(EPERM);
  const sleep = f.host.sleep.bind(f.host);
  let once = true;
  f.host.sleep = ms => { if (once) { once = false; f.swap(temp); } return sleep(ms); };
  drag(f, guard, WRONG, temp);
  await f.run();
  assert.deepEqual(f.moves, [`${temp} → ${WRONG}`]);
  assert.match(f.notices[0], /沒能搬回原位/);
  assert.equal(f.failures.length, 1);
  assert.match(String(f.failures[0]), /對不上/);
});

void test('第五輪 F1a 收到 rename 時找不到資料夾本身：之後不照路徑重找，不搬', async () => {
  const f = fake({ ...VAULT, [`${WRONG}/草稿.md`]: DRAFT });
  const guard = started(f);
  const temp = `${R}/草稿資料夾`, own = `${temp}/自己的.md`;
  // 事件沒帶資料夾、當下照路徑也找不到；之後那個路徑上的是別的資料夾：錯題本在 Obsidian 以外搬走，家長在原處建了自己的卡組。
  guard.renamed(temp, WRONG, true);
  f.shift(WRONG, temp);
  f.outside(temp, `${R}/另一個名字`);
  f.memory.write(own, '- 家長的卡組\n    - Q :: A\n');
  await f.run();
  assert.deepEqual(f.moves, []);
  // 也不照路徑記成沒搬回：家長的卡組照常讀。
  assert.equal(guard.misplaced(own), false);
  assert.notEqual(await guard.wrap(f.files).read(own), null);
});

// 根資料夾不算「原位例外」之後（第五輪 F1c），它回到原位時要靠「回到原位就不排除」這一條（其他系統資料夾兩條都成立）。
void test('第五輪 F1c 整個 Essence Cards 搬不回、之後家長拖回原位：卡組照常讀，不等判斷', async () => {
  const f = fake();
  const guard = started(f);
  const away = `學校/${R}`;
  f.failMoves.push(EACCES);
  drag(f, guard, R, away);
  await f.run();
  assert.equal(guard.misplaced(`學校/${DECK}`), true);
  drag(f, guard, away, R);
  assert.equal(guard.misplaced(DECK), false);
  assert.notEqual(await guard.wrap(f.files).read(DECK), null);
});

void test('第五輪 F1c 整個 Essence Cards 搬回期間家長自己拖回原位：等的時候卡組就不算搬錯，不搬、不通知', async () => {
  const f = fake();
  const guard = started(f);
  const away = `學校/${R}`;
  f.failMoves.push(EPERM);
  const sleep = f.host.sleep.bind(f.host);
  let during: boolean | null = null;
  f.host.sleep = ms => {
    if (during === null) {
      drag(f, guard, away, R);
      during = guard.misplaced(DECK);
    }
    return sleep(ms);
  };
  drag(f, guard, R, away);
  await f.run();
  assert.equal(during, false);
  assert.deepEqual(f.moves, [`${away} → ${R}`]);
  assert.deepEqual(f.notices, []);
});

void test('第五輪 F1c 搬不回的資料夾被改名成空出來的 Essence Cards 根資料夾：根層的 .md 是卡組，照樣排除、不補 ID', async (t: TestContext) => {
  const f = fake({ [`${WRONG}/草稿.md`]: DRAFT, '其他/筆記.md': 'x' });
  const guard = started(f);
  // 這個情境要根資料夾空著：這台的紀錄不落地，否則基準行會建出紀錄資料夾。
  const state = study({ ...f, files: { ...f.files, append: () => Promise.resolve() } }, guard, t);
  await state.ready();
  await strandedAt(f, guard, '其他/草稿資料夾');
  assert.equal(f.host.known(R), null, '根資料夾空出來了');
  drag(f, guard, '其他/草稿資料夾', R);
  const at = `${R}/草稿.md`;
  assert.equal(guard.misplaced(at), true);
  assert.equal(await guard.wrap(f.files).read(at), null);
  assert.equal(await state.fillIds(at), false);
  assert.notEqual((await state.save(editorOn(at, DRAFT))).kind, 'done');
  assert.equal(f.memory.texts.get(at), DRAFT);
});

void test('第二輪 F4 等磁碟的時候 Obsidian 才看到的空資料夾：原位當成有東西，清理也不刪', async () => {
  const f = fake();
  const guard = movedOutside(f);
  f.disk.add(`${R}/考試範圍`);
  const exists = f.host.exists.bind(f.host);
  f.host.exists = async path => { const found = await exists(path); if (path === `${R}/考試範圍`) f.visible.add(path); return found; };
  assert.equal(await guard.moveBack(guard.issues()[0]), false);
  assert.deepEqual(f.removed, []);
  assert.match(f.notices[0], /原位已經有一個同名的/);

  const g = fake();
  const guard2 = movedOutside(g);
  g.disk.add(`${R}/考試範圍`);
  const empty = g.host.empty.bind(g.host);
  g.host.empty = async path => { const result = await empty(path); g.visible.add(path); return result; };
  assert.equal(await guard2.moveBack(guard2.issues()[0]), false);
  assert.deepEqual(g.removed, []);

  const h = fake();
  const guard3 = started(h);
  h.residue.on = true;
  const empty3 = h.host.empty.bind(h.host);
  h.host.empty = async path => { const result = await empty3(path); h.visible.add(path); return result; };
  drag(h, guard3, `${R}/紀錄`, `${R}/英文/紀錄`);
  await h.run();
  assert.deepEqual(h.removed, []);
});

void test('第二輪 F5 停用時正在等重試：不再搬，請家長自己拖回；等著的作答放行，寫出去不丟', async (t: TestContext) => {
  const f = fake();
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  let wake = (): void => {};
  f.host.sleep = ms => ms === 200 ? new Promise<void>(resolve => { wake = resolve; }) : Promise.resolve();
  f.failMoves.push(EPERM);
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  assert.ok(state.answer({ lt: 'k3m9x2', r: 'good', v: '12345678' }));
  const flushing = state.flush();
  await f.run();
  assert.equal(f.moves.length, 1);
  guard.close();
  await flushing;
  assert.match(f.memory.texts.get(OWN_LOG) ?? '', /"lt":"k3m9x2"/);
  wake();
  await drain();
  assert.equal(f.moves.length, 1);
  assert.deepEqual(f.notices, [`Essence Cards：「紀錄」是外掛用的資料夾，沒能搬回原位，請把它拖回「${R}/紀錄」`]);
  assert.deepEqual(f.failures, []);
  assert.equal(f.memory.texts.get(`${R}/英文/紀錄/2026-10 iPhone-test.jsonl`), VAULT[LOG]);
});

void test('第二輪 F5 某一步一直沒回來：到總時限就記下、請家長自己拖回、放行；之後才搬好的補一個通知', async (t: TestContext) => {
  const f = fake();
  const guard = started(f);
  const state = study(f, guard, t);
  await state.ready();
  let finish = (): void => {};
  f.host.move = (ref, to) => new Promise<void>(resolve => { finish = () => { f.shift(f.host.where(ref) ?? '', to); resolve(); }; });
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  let read = false;
  const reading = guard.wrap(f.files).read(LOG).then(text => { read = true; return text; });
  await f.run();
  assert.equal(read, false);
  assert.equal(f.timers.length, 1);
  f.timers[0]();
  // 放行：原位還沒有檔，讀到 null（之後 rename 的通知會讓 state 再讀）。
  assert.equal(await reading, null);
  assert.equal(f.failures.length, 1);
  assert.match(String(f.failures[0]), /超過 12 秒沒有結束/);
  assert.deepEqual(f.notices, [`Essence Cards：「紀錄」是外掛用的資料夾，沒能搬回原位，請把它拖回「${R}/紀錄」`]);
  assert.equal(guard.misplaced(`${R}/英文/紀錄/2026-10 iPhone-test.jsonl`), true);
  finish();
  await drain();
  assert.equal(f.notices.at(-1), 'Essence Cards：「紀錄」是外掛用的資料夾，不能搬動或改名，已經搬回原位');
  guard.check();
  assert.deepEqual(guard.issues(), []);
  assert.equal(guard.misplaced(LOG), false);
  assert.equal(f.memory.texts.get(LOG), VAULT[LOG]);
});

void test('第二輪 F5 正常結束時取消總時限', async () => {
  const f = fake();
  const guard = started(f);
  drag(f, guard, `${R}/紀錄`, `${R}/英文/紀錄`);
  await f.run();
  assert.deepEqual(f.timers, []);
});

// ---- AI 製卡與防呆（tasks/ai-cards-mvp.md §5，Codex L2 第三輪 R3-4）----

const AI_RULES: EmbeddedRules = { english: [{ name: '通用', version: 'v0.15', text: '# 通用', sha256: sha256Hex('# 通用') }, { name: '英文', version: 'v0.14', text: '# 英文', sha256: sha256Hex('# 英文') }] };
const AI_FORM: CardForm = { subject: 'english', term: '國二上', unit: 'L3 Sports', purpose: '準備段考', supplement: false, adjust: '', material: '' };
const AI_REPLY = ['國二上英文 L3 單字', '', '## 單字', '', '- borrow 英翻中', '    - 出處：p.40', '    - borrow :: 借入', '<<<完>>>'].join('\n');
const AI_SNAP = `${R}/紀錄/AI 輸出/2026-11-07 國二上英文 L3 Sports.md`;
const STRAY = `${R}/英文/紀錄`;

/** 真的防呆、state 與製卡流程，加上這台電腦的存放；failDrop 時工作清不掉（快照寫成、清理前中斷）。 */
async function aiCards(f: Fake, guard: FolderGuard, t: TestContext, box = { jobs: null as unknown, failDrop: false, beforeNamed: null as (() => void) | null }) {
  // eslint-disable-next-line prefer-const -- state 與流程互相參照
  let state: ReturnType<typeof createState>;
  const cards = createAiCards({
    rules: AI_RULES, state: () => state,
    names: () => new Set([...f.memory.texts.keys()].filter(path => path.endsWith('.md')).map(path => path.slice(path.lastIndexOf('/') + 1, -3).toLowerCase())),
    named: name => { box.beforeNamed?.(); return [...f.memory.texts.keys()].filter(path => path.endsWith('.md') && path.slice(path.lastIndexOf('/') + 1, -3).toLowerCase() === name); },
    store: {
      jobs: () => box.jobs,
      saveJobs(next: CardJob[]) { if (box.failDrop && !next.some(each => each.save)) throw Error('存不進去'); box.jobs = JSON.parse(JSON.stringify(next)) as unknown; },
      retired: () => [], retire() {}, last: () => ({}), saveLast() {},
    },
    clipboard: () => Promise.resolve(),
    now: () => ({ ms: Date.parse('2026-11-07T10:02:11+08:00'), offset: 480 }),
    onError() {},
  });
  state = createState({ files: guard.wrap(f.files), skip: path => guard.misplaced(path), displaced: path => guard.displaced(path), device: 'PC-test', delay: 1, fillIds: true, stuckAfter: 2000, reserved: () => cards.reserved(), now: () => Date.parse('2026-11-07T10:02:11+08:00'), offset: () => 480, onError() {} });
  t.after(() => state.close());
  await state.ready();
  const copied = await cards.copy(AI_FORM);
  assert.ok('job' in copied);
  return { box, cards, state, job: copied.job };
}
/** 快照寫成、只有清理這台電腦的工作失敗：工作留著，已經發布了。 */
async function published(f: Fake, guard: FolderGuard, t: TestContext) {
  const loaded = await aiCards(f, guard, t);
  loaded.box.failDrop = true;
  assert.equal((await loaded.cards.save(loaded.job, AI_REPLY, null)).kind, 'stop');
  loaded.box.failDrop = false;
  assert.ok(f.memory.texts.has(AI_SNAP));
  await settle();
  return { ...loaded, job: loaded.cards.jobs()[0] };
}
const snapshots = (f: Fake): string[] => [...f.memory.texts.keys()].filter(path => path.includes('/AI 輸出/2026')).sort();

void test('R3-4 紀錄資料夾搬回失敗：原位讀到沒有不算沒有，已發布的不另建一份快照、不放棄；家長拖回去之後只清理', async t => {
  const f = fake();
  const guard = started(f);
  const { cards, job } = await published(f, guard, t);
  f.failMoves.push(Error('沒有權限'));
  drag(f, guard, `${R}/紀錄`, STRAY);
  const resuming = cards.resume(job);
  await f.run();
  assert.match((await resuming as { message: string }).message, /不在原位/);
  assert.deepEqual(snapshots(f), [`${STRAY}/AI 輸出/2026-11-07 國二上英文 L3 Sports.md`]);
  assert.equal(cards.jobs().length, 1);
  // 不知道是不是已經存好了：不放棄。
  assert.match((await cards.abandon(job) as { message: string }).message, /不在原位/);
  assert.equal(cards.jobs().length, 1);
  // 家長拖回原位：只清理，還是一份。
  drag(f, guard, STRAY, `${R}/紀錄`);
  await f.run();
  assert.equal((await cards.resume(job)).kind, 'done');
  assert.deepEqual(snapshots(f), [AI_SNAP]);
  assert.deepEqual(cards.jobs(), []);
});

void test('R4-1 搬回失敗後重開：搬到 Essence Cards 外面、原位又長出新的紀錄，都不再發布一份、不放棄；放回原位之後只清理', async t => {
  const OUT = '紀錄';
  for (const regrown of [false, true]) {
    const f = fake();
    const first = started(f);
    const before = await published(f, first, t);
    // 看過 AI 輸出：下一次判斷記住它（搬走之前 vault 有變動）。
    first.check();
    f.failMoves.push(Error('沒有權限'));
    drag(f, first, `${R}/紀錄`, OUT);
    await f.run();
    assert.match((await before.cards.resume(before.job) as { message: string }).message, /不在原位/);
    // 重開：防呆、state、製卡都重建，防呆只剩這台記住的名字；恢復資料還在。沒搬回的記憶體已經沒了。
    first.close();
    if (regrown) f.memory.write(`${R}/紀錄/2026-11 PC-test.jsonl`, '');
    const guard = started(f);
    const after = await aiCards(f, guard, t, before.box);
    const job = after.cards.jobs().find(each => each.save)!;
    assert.match((await after.cards.resume(job) as { message: string }).message, /不在原位/);
    assert.deepEqual(snapshots(f), [`${OUT}/AI 輸出/2026-11-07 國二上英文 L3 Sports.md`]);
    assert.match((await after.cards.abandon(job) as { message: string }).message, /不在原位/);
    assert.ok(after.cards.jobs().some(each => each.id === job.id));
    if (regrown) continue;
    // 家長放回原位：只清理，還是一份。
    drag(f, guard, OUT, `${R}/紀錄`);
    guard.check();
    assert.equal((await after.cards.resume(job)).kind, 'done');
    assert.deepEqual(snapshots(f), [AI_SNAP]);
  }
});

void test('R5-1 搬回失敗後原位長出新檔：防呆不再報不在原位，同一份快照還在 vault 裡就只清理，繼續和放棄都不再發布一份', async t => {
  const OUT = '紀錄';
  const MOVED = `${OUT}/AI 輸出/2026-11-07 國二上英文 L3 Sports.md`;
  // 兩種都讓防呆認不出：還沒記住 AI 輸出時，紀錄長出新檔；已經記住時，AI 輸出長出新檔。
  for (const { remembered, regrown } of [{ remembered: false, regrown: `${R}/紀錄/2026-11 PC-test.jsonl` }, { remembered: true, regrown: `${R}/紀錄/AI 輸出/原文/別的.md` }]) {
    for (const action of ['resume', 'abandon'] as const) {
      const f = fake();
      const first = started(f);
      const before = await published(f, first, t);
      if (remembered) first.check();
      f.failMoves.push(Error('沒有權限'));
      drag(f, first, `${R}/紀錄`, OUT);
      await f.run();
      first.close();
      f.memory.write(regrown, '');
      const guard = started(f);
      const after = await aiCards(f, guard, t, before.box);
      guard.check();
      assert.equal(guard.displaced(AI_SNAP), false);
      const job = after.cards.jobs().find(each => each.save)!;
      const result = await after.cards[action](job);
      assert.equal('kind' in result ? result.kind : 'left', 'done');
      assert.deepEqual(snapshots(f), [MOVED]);
      assert.equal(after.cards.jobs().some(each => each.id === job.id), false);
    }
  }
});

void test('R6-3 放棄找到同一份快照就只清理：之後看不到也不重新發布；原位內容不同、別處相同也算已發布；清不掉就停下、工作留著', async t => {
  const OUT = '紀錄';
  const MOVED = `${OUT}/AI 輸出/2026-11-07 國二上英文 L3 Sports.md`;
  /** 快照寫成、清理前中斷，紀錄資料夾搬到外面沒搬回；重開時原位長出新檔。 */
  const prepare = async () => {
    const f = fake();
    const first = started(f);
    const before = await published(f, first, t);
    f.failMoves.push(Error('沒有權限'));
    drag(f, first, `${R}/紀錄`, OUT);
    await f.run();
    first.close();
    f.memory.write(`${R}/紀錄/2026-11 PC-test.jsonl`, '');
    const guard = started(f);
    const after = await aiCards(f, guard, t, before.box);
    guard.check();
    return { f, ...after, job: after.cards.jobs().find(each => each.save)! };
  };
  // 查到同一份之後，同步讓它暫時看不到：放棄不再走一次發布。
  {
    const { f, box, cards, job } = await prepare();
    let looked = 0;
    box.beforeNamed = () => { if (++looked === 2) f.memory.texts.delete(MOVED); };
    const result = await cards.abandon(job);
    assert.deepEqual('kind' in result && result.kind === 'done' ? result.targets : null, 1);
    assert.deepEqual(snapshots(f), [MOVED]);
    assert.equal(cards.jobs().some(each => each.id === job.id), false);
  }
  // 原位被不同內容占用、別處還有相同的快照：繼續和放棄都算已發布，原位的檔不動。
  for (const action of ['resume', 'abandon'] as const) {
    const { f, cards, job } = await prepare();
    f.memory.write(AI_SNAP, '別人寫的不同內容');
    const result = await cards[action](job);
    assert.equal('kind' in result ? result.kind : 'left', 'done');
    assert.equal(f.memory.texts.get(AI_SNAP), '別人寫的不同內容');
    assert.equal(cards.jobs().some(each => each.id === job.id), false);
  }
  // 這台電腦存不進去：沒有清理成功，工作留著，不說成完成。
  {
    const { f, box, cards, job } = await prepare();
    box.failDrop = true;
    assert.match((await cards.abandon(job) as { message: string }).message, /存不進這台電腦/);
    assert.deepEqual(snapshots(f), [MOVED]);
    assert.equal(cards.jobs().some(each => each.id === job.id), true);
  }
});

void test('R3-4 對照：搬回成功時等回原位再讀，只有一份快照', async t => {
  const f = fake();
  const guard = started(f);
  const { cards, job } = await published(f, guard, t);
  drag(f, guard, `${R}/紀錄`, STRAY);
  const resuming = cards.resume(job);
  await f.run();
  assert.equal((await resuming).kind, 'done');
  assert.deepEqual(snapshots(f), [AI_SNAP]);
});

void test('R3-4 還沒發布時紀錄資料夾沒搬回：不在原位另建一套原文；已經排到建檔的也擋下', async t => {
  const f = fake();
  const guard = started(f);
  const { cards, state, job } = await aiCards(f, guard, t);
  f.failMoves.push(Error('沒有權限'));
  drag(f, guard, `${R}/紀錄`, STRAY);
  await f.run();
  assert.ok(guard.displaced(`${R}/紀錄/AI 輸出/x.md`));
  assert.equal(guard.displaced(DECK), false);
  const stop = await cards.save(job, AI_REPLY, null);
  assert.match((stop as { message: string }).message, /不在原位/);
  assert.deepEqual([...f.memory.texts.keys()].filter(path => path.startsWith(`${R}/紀錄/AI 輸出`)), []);
  assert.deepEqual(await state.aiCreate(`${R}/紀錄/AI 輸出/x.md`, 'x'), { kind: 'blocked', reason: 'displaced' });
  assert.equal(f.memory.texts.has(`${R}/紀錄/AI 輸出/x.md`), false);
  // 別的位置照常。
  assert.deepEqual(await state.aiCreate(`${R}/考試範圍/x.md`, 'x'), { kind: 'done' });
});

void test('紀錄/考試切面 搬動或改名會搬回（tasks/record-gaps.md §2）', async () => {
  const path = `${R}/紀錄/考試切面/2026-10-28 3fa9c1d2e4b7 PC-test.jsonl`;
  const f = fake({ ...VAULT, [path]: 'x\n' });
  const guard = started(f);
  drag(f, guard, `${R}/紀錄/考試切面`, `${R}/英文/切面`);
  await f.run();
  assert.equal(f.memory.texts.get(path), 'x\n');
  assert.deepEqual(f.moves, [`${R}/英文/切面 → ${R}/紀錄/考試切面`]);
});
