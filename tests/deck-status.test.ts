import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { replay } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { DeckStatusValue, State, StateOptions, UnitView, WriteResult } from '../src/state/index.ts';
import { createMemoryEditor } from './helpers/editor.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 目錄的暫停／恢復（D-183 第 6 點、D-189 第 3 點、tasks/quiz-practice.md §5）：真正的 createState，記憶體 Files。畫面與開著的筆記另外在 entry-ui、deck-status-wiring 測。

const WORDS = 'Essence Cards/英文/L3 單字.md', REST = 'Essence Cards/英文/L3 其他.md';
const LOG = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
const head = (extra = ''): string => `---\n年級學期: 國二上\n科目: 英文\n單元: "L3"\n${extra}---\n`;
const targets = (...ids: string[]): string => ids.map(id => `- 目標 ${id} ^${id}\n    - ${id} 的題目 :: 答\n`).join('');
const DECKS = { [WORDS]: head('狀態: 啟用\n') + targets('a', 'b'), [REST]: head() + targets('c') };

const lines = (memory: MemoryFiles): string[] => (memory.texts.get(LOG) ?? '').split('\n').filter(Boolean);
interface Harness extends MemoryFiles { state: State; unit: () => UnitView; logged: () => Record<string, unknown>[] }
async function setup(t: TestContext, texts: Record<string, string> = DECKS, options: Partial<StateOptions> = {}): Promise<Harness> {
  const memory = createMemoryFiles(texts);
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: true, stuckAfter: 20, now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480, onError() {}, ...options });
  t.after(() => state.close());
  await state.ready();
  // 載入時的基準行不算：這裡看的是按下去之後多的行。
  await state.flush().catch(() => {});
  const base = lines(memory).length;
  return {
    ...memory, state,
    unit: () => state.catalog().terms[0].subjects[0].units[0],
    logged: () => lines(memory).slice(base).map(line => JSON.parse(line) as Record<string, unknown>),
  };
}
const statuses = (h: Harness): Record<string, string> => Object.fromEntries(h.unit().decks.map(deck => [deck.path, deck.status]));
/** 紀錄裡的 set: status，不看時間；還在排隊的先寫進去。 */
async function changes(h: Harness): Promise<Record<string, unknown>[]> {
  await h.state.flush();
  return h.logged().filter(each => each.set === 'status').map(({ t: _t, ...rest }) => rest);
}

void test('按暫停：筆記只改狀態那一行、紀錄多一行、目錄那一篇變成暫停、單元的全部卡少了那一篇', async t => {
  const h = await setup(t);
  assert.deepEqual([h.unit().count, h.unit().targets.map(each => each.id)], [3, ['c', 'a', 'b']]);
  assert.equal((await h.state.setDeckStatus(WORDS, '暫停', null)).kind, 'done');
  assert.equal(h.texts.get(WORDS), head('狀態: 暫停\n') + targets('a', 'b'));
  assert.equal(h.texts.get(REST), DECKS[REST], '別篇不動');
  assert.deepEqual(await changes(h), [{ set: 'status', deck: WORDS, val: '暫停' }]);
  assert.deepEqual(statuses(h), { [WORDS]: 'paused', [REST]: 'active' });
  assert.deepEqual([h.unit().count, h.unit().targets.map(each => each.id)], [1, ['c']]);
  assert.deepEqual(h.state.deckTargets(WORDS), []);
});

void test('按恢復：回到啟用，之前的作答照算：顏色、記憶和暫停前一樣', async t => {
  const h = await setup(t);
  h.state.answer({ lt: 'a', r: 'good', v: '12345678' });
  const color = (): string | undefined => h.unit().targets.find(each => each.id === 'a')?.color;
  const memory = (): string => JSON.stringify(replay(h.state.history().reviews).get('a'));
  const before = [color(), memory()];
  assert.equal(before[0], 'good');
  assert.equal((await h.state.setDeckStatus(WORDS, '暫停', null)).kind, 'done');
  assert.equal(memory(), before[1], '暫停不改記憶');
  assert.equal((await h.state.setDeckStatus(WORDS, '啟用', null)).kind, 'done');
  assert.equal(h.texts.get(WORDS), DECKS[WORDS], '回到原本的字');
  assert.deepEqual([color(), memory()], before);
  assert.deepEqual(statuses(h), { [WORDS]: 'active', [REST]: 'active' });
  assert.deepEqual((await changes(h)).map(each => each.val), ['暫停', '啟用']);
});

void test('沒有狀態那一行的篇按暫停：多一行，其他字不動', async t => {
  const h = await setup(t);
  assert.equal((await h.state.setDeckStatus(REST, '暫停', null)).kind, 'done');
  assert.equal(h.texts.get(REST), head('狀態: 暫停\n') + targets('c'));
  assert.deepEqual(statuses(h), { [WORDS]: 'active', [REST]: 'paused' });
});

void test('已經是這個值：不寫、不記；草稿不改；檔不見了不建立', async t => {
  const draft = 'Essence Cards/英文/L3 草稿.md';
  const h = await setup(t, { ...DECKS, [draft]: head('狀態: 草稿\n') + targets('d') });
  assert.equal((await h.state.setDeckStatus(WORDS, '啟用', null)).kind, 'unchanged');
  assert.equal((await h.state.setDeckStatus(draft, '暫停', null)).kind, 'unchanged');
  assert.equal(h.texts.get(draft), head('狀態: 草稿\n') + targets('d'));
  const gone = 'Essence Cards/英文/沒有這篇.md';
  assert.equal((await h.state.setDeckStatus(gone, '暫停', null)).kind, 'unchanged');
  assert.equal(h.texts.has(gone), false);
  assert.deepEqual(await changes(h), []);
});

void test('屬性區讀不懂：不寫、不記，回 unwritable', async t => {
  const broken = '---\n狀態: 啟用\n狀態: 暫停\n---\n' + targets('a');
  const h = await setup(t, { [WORDS]: broken });
  assert.deepEqual(await h.state.setDeckStatus(WORDS, '暫停', null), { kind: 'unwritable' });
  assert.equal(h.texts.get(WORDS), broken);
  assert.deepEqual(await changes(h), []);
});

void test('手機：呼叫寫入的函式也擋，不寫、不記', async t => {
  const h = await setup(t, DECKS, { fillIds: false });
  assert.deepEqual(await h.state.setDeckStatus(WORDS, '暫停', null), { kind: 'blocked', reason: 'phone' });
  assert.equal(h.texts.get(WORDS), DECKS[WORDS]);
  assert.deepEqual(await changes(h), []);
});

void test('照存檔的門檻：有檔讀不到、備份還沒成功、這篇要新版：不寫、不記', async t => {
  const unread = await setup(t, { ...DECKS, 'Essence Cards/讀不到.md': targets('z') }, { fillIds: true });
  unread.failing.add('Essence Cards/讀不到.md');
  unread.notify('Essence Cards/讀不到.md');
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(await unread.state.setDeckStatus(WORDS, '暫停', null), { kind: 'blocked', reason: 'unread' });
  assert.equal(unread.texts.get(WORDS), DECKS[WORDS]);

  const backup = await setup(t, DECKS, { backup: true });
  assert.deepEqual(await backup.state.setDeckStatus(WORDS, '暫停', null), { kind: 'blocked', reason: 'backup' });
  assert.equal(backup.texts.get(WORDS), DECKS[WORDS]);

  const newer = head('需要版本: 99.0.0\n') + targets('a');
  const gated = await setup(t, { [WORDS]: newer });
  assert.deepEqual(await gated.state.setDeckStatus(WORDS, '暫停', null), { kind: 'blocked', reason: 'needs-update' });
  assert.equal(gated.texts.get(WORDS), newer);
  for (const each of [unread, backup, gated]) assert.deepEqual(await changes(each), []);
});

void test('寫不進去：回 failed，不記，目錄照舊', async t => {
  const h = await setup(t);
  h.control.failModify = true;
  assert.equal((await h.state.setDeckStatus(WORDS, '暫停', null)).kind, 'failed');
  assert.equal(h.texts.get(WORDS), DECKS[WORDS]);
  assert.deepEqual(statuses(h), { [WORDS]: 'active', [REST]: 'active' });
  assert.deepEqual(await changes(h), []);
});

void test('開著的筆記：改在編輯器裡、存進磁碟；編輯器裡比磁碟新的字留著，不被蓋掉', async t => {
  const h = await setup(t);
  const typed = DECKS[WORDS] + '- 剛打的 ^newone\n    - 問 :: 答\n';
  const editor = createMemoryEditor(h, WORDS, typed);
  assert.equal((await h.state.setDeckStatus(WORDS, '暫停', editor)).kind, 'done');
  const wanted = typed.replace('狀態: 啟用', '狀態: 暫停');
  assert.equal(editor.value, wanted);
  assert.equal(h.texts.get(WORDS), wanted);
  assert.deepEqual([editor.applies, editor.persists], [1, 1]);
  assert.deepEqual(await changes(h), [{ set: 'status', deck: WORDS, val: '暫停' }]);
  // 已經換到別篇：不改、不記。
  const other = createMemoryEditor(h, REST, DECKS[REST]);
  other.open = 'Essence Cards/別篇.md';
  assert.equal((await h.state.setDeckStatus(REST, '暫停', other)).kind, 'stale');
  assert.equal(h.texts.get(REST), DECKS[REST]);
});

/** 按下去、寫進磁碟之後、核對讀取之前，外部（同步）把筆記改成 overwrite 的結果。沒開著的筆記停在 modify 回來之前，開著的停在 persist 回來之前。 */
async function pressThenOverwrite(h: Harness, path: string, value: DeckStatusValue, editing: boolean, overwrite: (written: string) => string): Promise<WriteResult | { kind: 'unwritable' }> {
  const original = h.texts.get(path) ?? '';
  if (editing) {
    const editor = createMemoryEditor(h, path, original);
    const persist = editor.persist.bind(editor);
    editor.persist = async () => { await persist(); h.write(path, overwrite(h.texts.get(path) ?? '')); };
    return h.state.setDeckStatus(path, value, editor);
  }
  const held = h.holdModify(path);
  const writing = h.state.setDeckStatus(path, value, null);
  while (h.texts.get(path) === original) await new Promise(resolve => setImmediate(resolve));
  h.write(path, overwrite(h.texts.get(path) ?? ''));
  held.release();
  return writing;
}

for (const [how, editing] of [['沒開著的筆記', false], ['開著的筆記', true]] as const) {
  void test(`${how}：寫進去之後、核對之前被同步蓋回原本的狀態：回 stale，不記；目錄照讀到的；再按一次就好`, async t => {
    const h = await setup(t);
    const result = await pressThenOverwrite(h, WORDS, '暫停', editing, () => DECKS[WORDS]);
    assert.equal(result.kind, 'stale');
    assert.deepEqual(await changes(h), []);
    assert.deepEqual(statuses(h), { [WORDS]: 'active', [REST]: 'active' });
    assert.deepEqual(h.state.deckStatus(WORDS).issues, [], '沒有多出假的待處理問題');
    assert.equal((await h.state.setDeckStatus(WORDS, '暫停', editing ? createMemoryEditor(h, WORDS, DECKS[WORDS]) : null)).kind, 'done');
    assert.deepEqual(await changes(h), [{ set: 'status', deck: WORDS, val: '暫停' }]);
    assert.deepEqual(statuses(h), { [WORDS]: 'paused', [REST]: 'active' });
  });

  void test(`${how}：恢復時被蓋回暫停、暫停時被換成草稿也一樣：讀回來不是要的狀態就不算`, async t => {
    const paused = head('狀態: 暫停\n') + targets('a', 'b');
    const h = await setup(t, { ...DECKS, [WORDS]: paused });
    assert.equal((await pressThenOverwrite(h, WORDS, '啟用', editing, () => paused)).kind, 'stale');
    assert.deepEqual(await changes(h), []);
    assert.deepEqual(statuses(h), { [WORDS]: 'paused', [REST]: 'active' });
    // 換成草稿：不是暫停也不是啟用。
    const h2 = await setup(t);
    assert.equal((await pressThenOverwrite(h2, WORDS, '暫停', editing, () => head('狀態: 草稿\n') + targets('a', 'b'))).kind, 'stale');
    // 這篇現在真的是草稿：按鈕的值不記，採用讀到的值記一行（tasks/record-gaps.md §1）。
    assert.deepEqual(await changes(h2), [{ set: 'status', deck: WORDS, val: '草稿' }]);
  });

  void test(`${how}：核對時多了別的字、換了寫法，狀態還是要的：採用，記一行`, async t => {
    const extra = '- 別的目標 ^other1\n    - 問 :: 答\n';
    const h = await setup(t);
    const result = await pressThenOverwrite(h, WORDS, '暫停', editing, written => written.replace('狀態: 暫停', '狀態: "暫停"') + extra);
    assert.equal(result.kind, 'done');
    assert.equal(h.texts.get(WORDS), head('狀態: "暫停"\n') + targets('a', 'b') + extra);
    assert.deepEqual(await changes(h), [{ set: 'status', deck: WORDS, val: '暫停' }]);
    assert.deepEqual(statuses(h), { [WORDS]: 'paused', [REST]: 'active' });
  });
}

void test('寫進去、核對讀不到：回 saved，先不記；之後讀到了記一行，目錄跟上', async t => {
  const h = await setup(t);
  h.failing.add(WORDS);
  assert.equal((await h.state.setDeckStatus(WORDS, '暫停', null)).kind, 'saved');
  assert.equal(h.texts.get(WORDS), head('狀態: 暫停\n') + targets('a', 'b'));
  assert.deepEqual(await changes(h), []);
  h.failing.delete(WORDS);
  h.notify(WORDS);
  while (statuses(h)[WORDS] !== 'paused') await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await changes(h), [{ set: 'status', deck: WORDS, val: '暫停' }]);
});

void test('狀態和補 ID 不混在一起：還沒有 ID 的目標不補，其他字元不動', async t => {
  const plain = head('狀態: 啟用\n') + '- 沒有編號\n    - 問 :: 答\n';
  const h = await setup(t, { [WORDS]: plain });
  assert.equal((await h.state.setDeckStatus(WORDS, '暫停', null)).kind, 'done');
  assert.equal(h.texts.get(WORDS), plain.replace('狀態: 啟用', '狀態: 暫停'));
});
