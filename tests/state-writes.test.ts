import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { planToday } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { State, StateOptions } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';
import { createMemoryEditor } from './helpers/editor.ts';

// tasks/state-writes.md §8：state 的讀寫先後與寫入協調。只透過公開介面；記憶體 Files 與假計時器（技術債 A9）；
// random 固定為 0 時第一個配出的 ID 是 aaaaaa、下一個是 aaaaab。每個觀察點都斷言沒有預期以外的待處理問題，
// 最後斷言 today() 和 planToday(input()) 相同。
const DELAY = 500;
const P = 'Essence Cards/P.md';
const C = '- 能說明 C\n    - QC :: AC\n';
const Ca = '- 能說明 C ^aaaaaa\n    - QC :: AC\n';

const timed = new WeakSet<TestContext>();
interface Harness extends MemoryFiles {
  state: State;
  /** onChange 被呼叫的次數。 */
  changed: () => number;
  /** 讓 ms（預設剛好超過 delay）過去，並跑完排好的讀檔與重排。 */
  settle: (ms?: number) => Promise<void>;
  /** 跑完已經排好的 Promise（不推進時間）。 */
  flush: () => Promise<void>;
  /** 沒有待處理的問題。 */
  clean: (path?: string) => void;
  samePlan: () => void;
}
async function setup(t: TestContext, vault: Record<string, string>, options: Partial<StateOptions> = {}): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles(vault);
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480, ...options });
  t.after(() => state.close());
  await state.ready();
  let changes = 0;
  state.onChange(() => { changes++; });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  return {
    ...memory, state, flush,
    changed: () => changes,
    settle: async (ms = DELAY + 1) => { t.mock.timers.tick(ms); await flush(); },
    clean: (path = P) => { assert.deepEqual(state.deckStatus(path).issues, [], path + ' 有預期以外的待處理問題'); },
    samePlan: () => { assert.deepEqual(state.today(), planToday(state.input())); },
  };
}

// ---- §2、§3：寫入先讀完已知的待讀；讀取不跨過 Cards I/O（離開筆記的 fillIds） ----

for (const landed of ['舊文字', 'null', 'reject'] as const) void test('M1 fillIds：讀取停在半路時離開筆記，寫入等它落地才開始，不出現 lost：' + landed, async t => {
  const h = await setup(t, { [P]: C });
  h.notify(P);
  const held = h.holdRead(P);
  t.mock.timers.tick(DELAY + 1);
  await held.started;
  const filling = h.state.fillIds(P);
  await h.flush();
  assert.equal(h.texts.get(P), C, '讀取還沒落地就寫了');
  // reject：之後的重試也讀不到，直到拿掉 failing。
  if (landed === 'reject') h.failing.add(P);
  held.release(landed === '舊文字' ? undefined : landed === 'null' ? null : Error('讀不到'));
  if (landed === 'reject') {
    assert.equal(await filling, false);
    assert.equal(h.texts.get(P), C);
    assert.deepEqual(h.state.unread(), [P]);
    h.failing.delete(P);
    await h.settle(1000);
    assert.deepEqual(h.state.unread(), []);
    assert.equal(await h.state.fillIds(P), true);
  } else assert.equal(await filling, true);
  assert.equal(h.texts.get(P), Ca);
  await h.flush();
  h.clean();
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  await h.settle();
  h.clean();
  h.samePlan();
});

void test('S20 fillIds 版：寫入有結果之前不讀這一篇；有結果之後立刻讀一次', async t => {
  const h = await setup(t, { [P]: C });
  const held = h.holdModify(P);
  const filling = h.state.fillIds(P);
  await h.flush();
  assert.equal(h.texts.get(P), Ca);
  const reads = h.reads.length;
  h.notify(P);
  await h.settle();
  assert.deepEqual(h.reads.slice(reads), [], '寫入還沒回來時讀了 P');
  held.release();
  assert.equal(await filling, true);
  await h.flush();
  assert.deepEqual(h.reads.slice(reads), [P]);
  h.clean();
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  await h.settle();
  assert.deepEqual(h.reads.slice(reads), [P]);
  h.samePlan();
});

const A = 'Essence Cards/A.md';
const B = 'Essence Cards/B.md';

void test('S13 fillIds 版：別篇收到通知還沒讀，先讀完再配號，不撞號', async t => {
  const h = await setup(t, { [A]: C });
  h.write(B, Ca);
  assert.equal(await h.state.fillIds(A), true);
  assert.equal(h.texts.get(A), C.replace('能說明 C', '能說明 C ^aaaaab'));
  await h.settle();
  h.clean(A);
  h.clean(B);
  h.samePlan();
});

void test('S21 門檻在輪到時重查；前一份寫入時另一篇變成讀不到，後一份 blocked、不改字', async t => {
  const h = await setup(t, { [A]: C, [B]: C });
  const held = h.holdModify(A);
  const first = h.state.fillIds(A);
  await h.flush();
  const second = h.state.fillIds(B);
  h.failing.add(P);
  h.write(P, C);
  await h.settle();
  assert.deepEqual(h.state.unread(), [P]);
  held.release();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(h.texts.get(B), C);
  h.clean(A);
});

void test('S22 一直有新的待讀時，第 5 輪後放棄（不寫），不會一直等下去', async t => {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles({ [A]: C, [P]: C });
  const files = { ...memory.files, read: (path: string) => { const result = memory.files.read(path); if (path === P) memory.notify(P); return result; } };
  const state = createState({ files, device: 'PC-test', delay: DELAY, fillIds: true, random: () => 0 });
  t.after(() => state.close());
  await state.ready();
  memory.notify(P);
  const reads = memory.reads.length;
  assert.equal(await state.fillIds(A), false);
  assert.equal(memory.texts.get(A), C);
  assert.equal(memory.reads.slice(reads).length, 5);
});

// ---- §4 準備只預留、核對與採用（離開筆記的 fillIds） ----

const D = '- 能說明 D\n    - QD :: AD\n';

void test('§4 fillIds 核對：寫成後家長又打了別的字，預期的 ID 都在就算寫成；預期不在（ID 被拿掉）不採用、回 false', async t => {
  const h = await setup(t, { [P]: C });
  const held = h.holdModify(P);
  const filling = h.state.fillIds(P);
  await h.flush();
  assert.equal(h.texts.get(P), Ca);
  h.write(P, Ca + D);
  held.release();
  assert.equal(await filling, true);
  h.clean();
  assert.deepEqual(h.state.deckStatus(P), { missing: 1, issues: [] });

  const lost = await setup(t, { [P]: C });
  const held2 = lost.holdModify(P);
  const filling2 = lost.state.fillIds(P);
  await lost.flush();
  lost.write(P, C + D);
  held2.release();
  assert.equal(await filling2, false);
  lost.clean();
  assert.deepEqual(lost.state.deckStatus(P), { missing: 2, issues: [] });
  // 預留過的 aaaaaa 不再配出。
  assert.equal(await lost.state.fillIds(P), true);
  assert.equal(lost.texts.get(P), '- 能說明 C ^aaaaab\n    - QC :: AC\n- 能說明 D ^aaaaac\n    - QD :: AD\n');
  lost.samePlan();
});

void test('S18 fillIds 版：寫成後核對讀不到，先回 false；讀到時照核對採用，沒有問題', async t => {
  const h = await setup(t, { [P]: C, [A]: C });
  const held = h.holdModify(P);
  const filling = h.state.fillIds(P);
  await h.flush();
  h.failing.add(P);
  held.release();
  assert.equal(await filling, false);
  assert.deepEqual(h.state.unread(), [P]);
  assert.equal(await h.state.fillIds(A), false, '讀不到時門檻擋住其他寫入');
  assert.equal(h.texts.get(A), C);
  const changes = h.changed();
  h.failing.delete(P);
  await h.settle(1000);
  assert.deepEqual(h.state.unread(), []);
  assert.equal(h.changed(), changes + 1);
  h.clean();
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  h.samePlan();
});

// ---- §3、§4 開著的筆記：save（編輯器的寫入，view.save() 加核對讀取） ----

const Ba = '- 能說明 B ^aaaaaa\n    - QB :: AB\n';
const Cb = '- 能說明 C ^aaaaab\n    - QC :: AC\n';
const K = '- 能說明 K ^k3m9x2\n    - QK :: AK\n';
const Kbare = '- 能說明 K\n    - QK :: AK\n';
const Q = 'Essence Cards/Q.md';

for (const landed of ['舊文字', 'null', 'reject'] as const) void test('S10 M1：讀取停在半路時按存檔，存檔等讀取落地才開始：' + landed, async t => {
  const h = await setup(t, { [P]: C });
  const editor = createMemoryEditor(h, P, C);
  h.notify(P);
  const held = h.holdRead(P);
  t.mock.timers.tick(DELAY + 1);
  await held.started;
  if (landed === 'reject') h.failing.add(P);
  const saving = h.state.save(editor);
  await h.flush();
  assert.equal(editor.applies, 0, '讀取還沒落地就改了編輯器');
  held.release(landed === '舊文字' ? undefined : landed === 'null' ? null : Error('讀不到'));
  if (landed === 'reject') {
    assert.deepEqual(await saving, { kind: 'blocked', reason: 'unread' });
    assert.equal(editor.value, C);
    assert.equal(h.texts.get(P), C);
    h.failing.delete(P);
    await h.settle(1000);
    assert.deepEqual(h.state.unread(), []);
    h.clean();
    assert.deepEqual(await h.state.save(editor), { kind: 'done', added: 1 });
  } else assert.deepEqual(await saving, { kind: 'done', added: 1 });
  assert.equal(editor.value, Ca);
  assert.equal(h.texts.get(P), Ca);
  h.clean();
  await h.settle();
  h.clean();
  h.samePlan();
});

void test('S11 M1 的還原版：讀取停在半路（沒有 ID 的舊文字）時選還原，放行與核對之後都沒有再出現 lost', async t => {
  const h = await setup(t, { [P]: K });
  h.write(P, Kbare);
  await h.settle();
  const [issue] = h.state.deckStatus(P).issues;
  assert.deepEqual([issue.kind, issue.restore], ['lost', 'k3m9x2']);
  h.notify(P);
  const held = h.holdRead(P);
  t.mock.timers.tick(DELAY + 1);
  await held.started;
  const resolving = h.state.resolve(issue, 'restore', createMemoryEditor(h, P, Kbare));
  await h.flush();
  held.release();
  await h.flush();
  assert.deepEqual(await resolving, { kind: 'done', added: 0 });
  assert.equal(h.texts.get(P), K);
  h.clean();
  await h.settle();
  h.clean();
  assert.ok(h.state.today().share.some(item => item.lt === 'k3m9x2'));
  h.samePlan();
});

void test('S12 N1：只送通知（磁碟沒變）就立刻存檔，存檔前後與 delay 之後都沒有問題', async t => {
  const h = await setup(t, { [P]: C });
  h.notify(P);
  h.clean();
  assert.deepEqual(await h.state.save(createMemoryEditor(h, P, C)), { kind: 'done', added: 1 });
  h.clean();
  await h.settle();
  h.clean();
  assert.equal(h.texts.get(P), Ca);
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  h.samePlan();
});

void test('S13 H4-1 別篇：外部建立的 B（含 aaaaaa）還沒讀，立刻存 A：A 配到 aaaaab', async t => {
  const h = await setup(t, { [A]: C });
  h.write(B, Ca);
  const editor = createMemoryEditor(h, A, C);
  assert.deepEqual(await h.state.save(editor), { kind: 'done', added: 1 });
  assert.equal(editor.value, Cb);
  await h.settle();
  h.clean(A);
  h.clean(B);
  h.samePlan();
});

void test('S14 本篇的兩組輸入：(a) 編輯器比磁碟新、(b) 磁碟比編輯器新，C 都配到 aaaaab，沒有假的問題', async t => {
  const a = await setup(t, { [P]: C });
  a.notify(P);
  const editorA = createMemoryEditor(a, P, Ba + C);
  assert.deepEqual(await a.state.save(editorA), { kind: 'done', added: 1 });
  assert.equal(editorA.value, Ba + Cb);
  a.clean();
  await a.settle();
  a.clean();
  a.samePlan();

  const b = await setup(t, { [P]: C });
  b.write(P, Ba + C);
  const editorB = createMemoryEditor(b, P, C);
  assert.deepEqual(await b.state.save(editorB), { kind: 'done', added: 1 });
  // 磁碟沒有 B：編輯器沒收到外部的修改、存檔時把它蓋掉，屬於 Obsidian 編輯器那一層（§9 的 V6 觀察），這裡只看 C 的 ID 與沒有假的問題。
  assert.equal(editorB.value, Cb);
  b.clean();
  await b.settle();
  b.clean();
  b.samePlan();
});

void test('S15 連續兩份寫入與舊成功回報：fillIds 的 modify 延遲回傳時存檔，第二份等第一份結束；decks() 不會退回只有 A', async t => {
  const A0 = '- 能說明 A\n    - QA :: AA\n', Aa = '- 能說明 A ^aaaaaa\n    - QA :: AA\n';
  const Bt = '- 能說明 B\n    - QB :: AB\n', Bb = '- 能說明 B ^aaaaab\n    - QB :: AB\n';
  const h = await setup(t, { [P]: A0 });
  const ids = () => (h.state.decks().find(entry => entry.path === P)?.deck.targets ?? []).map(target => target.id);
  const seen: (string | null)[][] = [];
  h.state.onChange(() => { seen.push(ids()); });
  const held = h.holdModify(P);
  const filling = h.state.fillIds(P);
  await h.flush();
  assert.equal(h.texts.get(P), Aa);
  const editor = createMemoryEditor(h, P, Aa + Bt);
  const saving = h.state.save(editor);
  await h.flush();
  assert.equal(editor.applies, 0, '第一份還沒結束就開始了第二份');
  held.release();
  assert.equal(await filling, true);
  assert.deepEqual(await saving, { kind: 'done', added: 1 });
  assert.equal(h.texts.get(P), Aa + Bb);
  assert.deepEqual(ids(), ['aaaaaa', 'aaaaab']);
  assert.deepEqual(seen, [['aaaaaa'], ['aaaaaa', null], ['aaaaaa', 'aaaaab']]);
  h.clean();
  h.samePlan();
});

void test('S16 寫入失敗：persist reject 是 failed，state 不改回編輯器、不採用；下一次存檔配到 aaaaab；modify 失敗同樣不重用', async t => {
  const h = await setup(t, { [P]: C });
  const editor = createMemoryEditor(h, P, C);
  editor.fail = true;
  const result = await h.state.save(editor);
  assert.equal(result.kind, 'failed');
  assert.equal(editor.value, Ca, 'state 不把編輯器改回去');
  assert.equal(h.texts.get(P), C);
  await h.flush();
  assert.deepEqual(h.state.deckStatus(P), { missing: 1, issues: [] });
  // 家長按 Undo 之後再存一次。
  editor.value = C;
  editor.fail = false;
  assert.deepEqual(await h.state.save(editor), { kind: 'done', added: 1 });
  assert.equal(h.texts.get(P), Cb);
  h.clean();

  const m = await setup(t, { [P]: C });
  m.control.failModify = true;
  await assert.rejects(m.state.fillIds(P));
  assert.deepEqual(m.state.deckStatus(P), { missing: 1, issues: [] });
  m.control.failModify = false;
  assert.equal(await m.state.fillIds(P), true);
  assert.equal(m.texts.get(P), Cb);
  m.clean();
  m.samePlan();
});

void test('S17 no-op：沒有要改的是 unchanged，仍 persist 並核對；編輯器比磁碟新但沒有要補的也一樣，之後磁碟和 state 一致', async t => {
  const h = await setup(t, { [P]: Ca });
  const editor = createMemoryEditor(h, P, Ca);
  const reads = h.reads.length;
  assert.deepEqual(await h.state.save(editor), { kind: 'unchanged' });
  assert.equal(editor.persists, 1);
  assert.deepEqual(h.reads.slice(reads), [P]);
  h.clean();

  const D2 = '- 能說明 D ^d23456\n    - QD :: AD\n';
  const newer = await setup(t, { [P]: Ca });
  const editor2 = createMemoryEditor(newer, P, Ca + D2);
  const reads2 = newer.reads.length;
  assert.deepEqual(await newer.state.save(editor2), { kind: 'unchanged' });
  assert.equal(editor2.persists, 1);
  assert.deepEqual(newer.reads.slice(reads2), [P]);
  assert.equal(newer.texts.get(P), Ca + D2);
  assert.deepEqual(newer.state.decks().find(entry => entry.path === P)?.deck.targets.map(target => target.id), ['aaaaaa', 'd23456']);
  newer.clean();
  await newer.settle();
  newer.clean();
  newer.samePlan();
});

void test('S18 已保存、核對讀不到：saved，門檻擋住別篇；恢復後照核對採用，onChange 一次、沒有問題', async t => {
  const h = await setup(t, { [P]: C, [A]: C });
  const editor = createMemoryEditor(h, P, C);
  const held = editor.hold();
  const saving = h.state.save(editor);
  await held.started;
  h.failing.add(P);
  held.release();
  assert.deepEqual(await saving, { kind: 'saved' });
  assert.deepEqual(h.state.unread(), [P]);
  assert.deepEqual(await h.state.save(createMemoryEditor(h, A, C)), { kind: 'blocked', reason: 'unread' });
  assert.equal(h.texts.get(A), C);
  const changes = h.changed();
  h.failing.delete(P);
  await h.settle(1000);
  assert.deepEqual(h.state.unread(), []);
  assert.equal(h.changed(), changes + 1);
  h.clean();
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  h.samePlan();
});

void test('S18 還原版：延後的記錄在讀到時才套用，被換掉的 ID 不造成 lost', async t => {
  const h = await setup(t, { [P]: K });
  const swapped = K.replace('^k3m9x2', '^zzzzz9');
  h.write(P, swapped);
  await h.settle();
  const [issue] = h.state.deckStatus(P).issues;
  assert.deepEqual([issue.kind, issue.restore], ['changed', 'k3m9x2']);
  const editor = createMemoryEditor(h, P, swapped);
  const held = editor.hold();
  const resolving = h.state.resolve(issue, 'restore', editor);
  await held.started;
  h.failing.add(P);
  held.release();
  assert.deepEqual(await resolving, { kind: 'saved' });
  assert.deepEqual(h.state.deckStatus(P).issues, [issue], '還沒核對，問題還在');
  h.failing.delete(P);
  await h.settle(1000);
  assert.equal(h.texts.get(P), K);
  h.clean();
  await h.settle();
  h.clean();
  h.samePlan();
});

void test('S19 等待中換篇、改名、刪除後重建：舊的工作不寫到別篇，結果不是 done', async t => {
  const h = await setup(t, { [P]: C });
  const away = createMemoryEditor(h, P, C);
  away.open = A;
  assert.deepEqual(await h.state.save(away), { kind: 'stale' });
  assert.deepEqual([away.applies, away.persists], [0, 0]);

  const editor = createMemoryEditor(h, P, C);
  const held = editor.hold();
  const saving = h.state.save(editor);
  await held.started;
  // persist 還沒寫：P 改名成 Q（編輯器跟著開在 Q），再建一個內容不同的新 P。
  h.rename(P, Q);
  editor.open = Q;
  h.write(P, D);
  held.release();
  const result = await saving;
  assert.notEqual(result.kind, 'done');
  await h.settle();
  assert.equal(h.texts.get(P), D, '新的 P 被 Cards 寫入');
  assert.equal(h.texts.get(Q), Ca);
  h.clean(P);
  h.clean(Q);
  h.samePlan();
});

void test('S20 讀取不能跨過 I/O：persist 延遲時通知 P、推進 delay，期間沒有讀 P；放行後讀一次', async t => {
  const h = await setup(t, { [P]: C });
  const editor = createMemoryEditor(h, P, C);
  const held = editor.hold();
  const saving = h.state.save(editor);
  await held.started;
  const reads = h.reads.length;
  h.notify(P);
  await h.settle();
  assert.deepEqual(h.reads.slice(reads), []);
  held.release();
  assert.deepEqual(await saving, { kind: 'done', added: 1 });
  await h.settle();
  assert.deepEqual(h.reads.slice(reads), [P]);
  h.clean();
  h.samePlan();
});

void test('S23 連按：同一個編輯器連續兩次 save，第一份 done、第二份 unchanged，只配一組 ID', async t => {
  const h = await setup(t, { [P]: C });
  const editor = createMemoryEditor(h, P, C);
  const first = h.state.save(editor), second = h.state.save(editor);
  assert.deepEqual(await first, { kind: 'done', added: 1 });
  assert.deepEqual(await second, { kind: 'unchanged' });
  assert.equal(h.texts.get(P), Ca);
  h.clean();
  h.samePlan();
});

// ---- §5 關閉、§3 最後一段寫入卡住 ----

void test('S24 關閉：排隊中的回 blocked closed；persist 延遲中 close() 等它結束，之後不採用、不通知；新的 state 讀到寫進去的 ID', async t => {
  const h = await setup(t, { [P]: C, [A]: C });
  const editor = createMemoryEditor(h, P, C);
  const held = editor.hold();
  const first = h.state.save(editor);
  await held.started;
  const queued = h.state.save(createMemoryEditor(h, A, C));
  const changes = h.changed();
  let closed = false;
  const closing = h.state.close().then(() => { closed = true; });
  await h.flush();
  assert.equal(closed, false, 'persist 還沒結束 close() 就完成了');
  held.release();
  await closing;
  assert.deepEqual(await first, { kind: 'saved' });
  assert.deepEqual(await queued, { kind: 'blocked', reason: 'closed' });
  assert.equal(h.texts.get(A), C);
  assert.equal(h.texts.get(P), Ca);
  await h.settle();
  assert.equal(h.changed(), changes, '關閉之後通知了監聽者');
  const again = createState({ files: h.files, device: 'PC-test', delay: DELAY, fillIds: true, random: () => 0 });
  t.after(() => again.close());
  await again.ready();
  assert.deepEqual(again.deckStatus(P), { missing: 0, issues: [] });
  assert.deepEqual(again.decks().find(entry => entry.path === P)?.deck.targets.map(target => target.id), ['aaaaaa']);
});

void test('S24 還沒 ready 與關閉之後：save、resolve 回 blocked loading／closed，fillIds 回 false，不讀不寫', async t => {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles({ [P]: C });
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: true, random: () => 0 });
  const issue = { path: P, line: 0, name: '能說明 C', kind: 'lost' as const, restore: null };
  const editor = createMemoryEditor(memory, P, C);
  assert.deepEqual(await state.save(editor), { kind: 'blocked', reason: 'loading' });
  assert.deepEqual(await state.resolve(issue, 'new', editor), { kind: 'blocked', reason: 'loading' });
  assert.equal(await state.fillIds(P), false);
  assert.throws(() => state.today());
  assert.deepEqual(state.deckStatus(P), { missing: 0, issues: [] });
  await state.ready();
  await state.close();
  assert.deepEqual(await state.save(editor), { kind: 'blocked', reason: 'closed' });
  assert.deepEqual(await state.resolve(issue, 'new', editor), { kind: 'blocked', reason: 'closed' });
  assert.equal(await state.fillIds(P), false);
  assert.deepEqual([editor.applies, editor.persists], [0, 0]);
  assert.equal(memory.texts.get(P), C);
});

void test('S28 寫入卡住：persist 一直不回來，逾時後 failed、放行另一篇；之後才完成也不採用、不通知，照一般讀取沒有假的 lost', async t => {
  const h = await setup(t, { [P]: C, [A]: C });
  const editor = createMemoryEditor(h, P, C);
  const held = editor.hold();
  const stuck = h.state.save(editor);
  await held.started;
  const next = h.state.save(createMemoryEditor(h, A, C));
  await h.flush();
  t.mock.timers.tick(10_000);
  const result = await stuck;
  assert.equal(result.kind, 'failed');
  assert.match(String((result as { error: unknown }).error), /逾時/);
  assert.deepEqual(await next, { kind: 'done', added: 1 });
  assert.equal(h.texts.get(A), C.replace('能說明 C', '能說明 C ^aaaaab'));
  await h.flush();
  const changes = h.changed();
  held.release();
  await h.flush();
  assert.equal(h.texts.get(P), Ca);
  assert.equal(h.changed(), changes, '逾時的那一份完成時呼叫了監聽者');
  await h.settle();
  h.clean();
  h.clean(A);
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
  h.samePlan();
});

void test('S28 卡住時 close()：逾時之後完成', async t => {
  const h = await setup(t, { [P]: C });
  const editor = createMemoryEditor(h, P, C);
  editor.hold();
  const stuck = h.state.save(editor);
  await h.flush();
  let closed = false;
  const closing = h.state.close().then(() => { closed = true; });
  await h.flush();
  assert.equal(closed, false);
  t.mock.timers.tick(10_000);
  await closing;
  assert.equal((await stuck).kind, 'failed');
});
