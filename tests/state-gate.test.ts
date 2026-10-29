import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import type { State, StateOptions } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 讀取閘門的 state 一側（任務說明 2-2、syntax.md §0-1、§2-1、§5-2）：這台是 0.1.0+1a2b3c4。外部改檔是記憶體 Files 的
// write（通知同步送出），`settle()` 用假計時器讓 delay 過去、跑完重讀。
const DELAY = 30;
const BUILD = '0.1.0+1a2b3c4';
const NEW = 'Essence Cards/新寫法（卡片）.md';
const P = 'Essence Cards/P（卡片）.md';
const LOG = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
const goal = (id: string) => `- 能說明 ${id} ^${id}\n    - 題目 ${id} :: 答案 ${id}\n`;
const marked = (need: string, body: string) => `---\n科目: 自然\n需要版本: ${need}\n---\n` + body;

const timed = new WeakSet<TestContext>();
interface Harness extends MemoryFiles {
  state: State;
  settle: () => Promise<void>;
  edit: (path: string, text: string) => Promise<void>;
  modifies: string[];
  share: () => string[];
}
async function setup(t: TestContext, vault: Record<string, string>, options: Partial<StateOptions> = {}): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles(vault);
  const modifies: string[] = [];
  const files = { ...memory.files, modify: (path: string, edit: (text: string) => string) => { modifies.push(path); return memory.files.modify(path, edit); } };
  const state = createState({ files, device: 'Windows-2c9e', build: BUILD, delay: DELAY, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480, ...options });
  t.after(() => state.close());
  await state.ready();
  const settle = async () => { t.mock.timers.tick(DELAY + 1); await new Promise<void>(resolve => setImmediate(resolve)); };
  const edit = async (path: string, text: string) => { memory.write(path, text); await settle(); };
  return { ...memory, state, settle, edit, modifies, share: () => state.today().share.map(item => item.lt).sort() };
}

void test('2-2 需要版本比這台新：整篇不出題、不在 decks()，列在 blocked()；同一 vault 的其他卡組照常', async t => {
  const h = await setup(t, { [NEW]: marked('9.0.0', goal('aaaaab')), [P]: goal('bbbbbb') });
  assert.deepEqual(h.share(), ['bbbbbb']);
  assert.deepEqual(h.state.decks().map(d => d.path), [P]);
  assert.deepEqual(h.state.blocked(), { decks: [NEW], targets: [], all: false });
  assert.deepEqual(h.state.deckStatus(NEW), { missing: 0, issues: [], needsUpdate: true });
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [] });
});

void test('2-2 需要版本讀得懂（相同或較舊）：照常；格式不對與屬性區壞掉而含「需要版本」都算讀不懂', async t => {
  const h = await setup(t, {
    'Essence Cards/a.md': marked('0.1.0', goal('aaaaaa')), 'Essence Cards/b.md': marked('0.0.9', goal('bbbbbb')),
    'Essence Cards/c.md': marked('0.1', goal('cccccc')), 'Essence Cards/d.md': marked('v0.1.0', goal('dddddd')),
    'Essence Cards/e.md': '---\n科目: [\n"需要版本": 0.0.1\n---\n' + goal('eeeeee'), 'Essence Cards/f.md': '---\n科目: [\n---\n' + goal('ffffff'),
  });
  assert.deepEqual(h.share(), ['aaaaaa', 'bbbbbb', 'ffffff']);
  assert.deepEqual(h.state.blocked().decks, ['Essence Cards/c.md', 'Essence Cards/d.md', 'Essence Cards/e.md']);
});

void test('2-2 沒傳 build（版本不明）：任何「需要版本」都讀不懂', async t => {
  const h = await setup(t, { [NEW]: marked('0.0.0', goal('aaaaab')), [P]: goal('bbbbbb') }, { build: undefined });
  assert.deepEqual([h.share(), h.state.blocked().decks], [['bbbbbb'], [NEW]]);
});

void test('2-2 需要新版的卡組，三個寫入入口都拒絕：fillText 回傳原文、fillIds 不改檔、resolveText 回傳 null', async t => {
  const text = marked('9.0.0', goal('aaaaab') + '- 新目標\n    - Q :: A\n');
  const h = await setup(t, { [NEW]: text });
  assert.equal(h.state.fillText(NEW, text), text);
  assert.equal(await h.state.fillIds(NEW), false);
  assert.deepEqual(h.modifies, []);
  assert.equal(h.texts.get(NEW), text);
  assert.equal(h.state.resolveText({ path: NEW, line: 4, name: '能說明 aaaaab', kind: 'lost', restore: 'aaaaab' }, 'new', text), null);
});

void test('2-2 寫入前看最新的文字：編輯器裡或檔案裡剛出現的需要版本也擋住', async t => {
  const h = await setup(t, { [P]: '- 新目標\n    - Q :: A\n' });
  const newer = marked('9.0.0', '- 新目標\n    - Q :: A\n');
  // 存檔：編輯器的文字已經帶標記，state 讀到的還沒有。
  assert.equal(h.state.fillText(P, newer), newer);
  // 離開筆記：檔案已經被別台裝置改成新寫法，通知還沒處理。
  h.texts.set(P, newer);
  assert.equal(await h.state.fillIds(P), false);
  assert.equal(h.texts.get(P), newer);
  // 讀得懂時照常補。
  h.texts.set(P, '- 新目標\n    - Q :: A\n');
  assert.equal(await h.state.fillIds(P), true);
  assert.equal(h.texts.get(P), '- 新目標 ^aaaaaa\n    - Q :: A\n');
});

void test('2-2 每次重讀都重新檢查：卡組變成需要新版就停，拿掉標記（或換成讀得懂的版本）就恢復', async t => {
  const h = await setup(t, { [P]: goal('aaaaaa'), [NEW]: goal('bbbbbb') });
  assert.deepEqual(h.share(), ['aaaaaa', 'bbbbbb']);
  await h.edit(NEW, marked('9.0.0', goal('bbbbbb')));
  assert.deepEqual([h.share(), h.state.blocked().decks], [['aaaaaa'], [NEW]]);
  await h.edit(NEW, marked('0.1.0', goal('bbbbbb')));
  assert.deepEqual([h.share(), h.state.blocked().decks], [['aaaaaa', 'bbbbbb'], []]);
});

void test('2-2 需要新版的卡組裡的 ID 照樣算用過：別篇配新 ID 時避開；讀得懂的卡組裡同一個 ID 也不出', async t => {
  const h = await setup(t, { [NEW]: marked('9.0.0', goal('aaaaaa')), [P]: '- 新目標\n    - Q :: A\n', 'Essence Cards/重複.md': goal('aaaaaa') + goal('cccccc') });
  assert.equal(h.state.fillText(P, '- 新目標\n    - Q :: A\n'), '- 新目標 ^aaaaab\n    - Q :: A\n');
  assert.deepEqual(h.share(), ['aaaaab', 'cccccc']);
});

void test('2-2 需要新版的卡組不影響紀錄：別台裝置對它的作答照樣讀進來，換成讀得懂的版本後照常排程', async t => {
  const h = await setup(t, { [NEW]: marked('9.0.0', goal('aaaaab')), [LOG]: encodeEntry('2026-10-20T19:00:00.000+08:00', { lt: 'aaaaab', r: 'good', v: '12345678' }) + '\n' });
  assert.deepEqual([h.share(), h.state.history().reviews.map(r => r.lt)], [[], ['aaaaab']]);
});

// 停掉的目標不寫作答（syntax.md §5-2、任務說明 2-2）：answer 回傳 null、什麼都不寫；取消看它指的作答。
void test('2-2 answer 拒絕停掉的目標：讀不懂的紀錄行停掉的、需要新版的卡組裡的；其他照常', async t => {
  const h = await setup(t, {
    [NEW]: marked('9.0.0', goal('gggggg')), [P]: goal('aaaaaa') + goal('bbbbbb') + goal('cccccc'),
    [LOG]: JSON.stringify({ t: '2026-10-20T19:00:00.000+08:00', need: '9.0.0', lt: 'bbbbbb', r: 'miss', v: '12345678' }) + '\n',
  });
  const own = 'Essence Cards/紀錄/2026-10 Windows-2c9e.jsonl';
  assert.deepEqual([h.state.canAnswer('aaaaaa'), h.state.canAnswer('bbbbbb'), h.state.canAnswer('gggggg')], [true, false, false]);
  assert.equal(h.state.answer({ lt: 'bbbbbb', r: 'good', v: '12345678' }), null);
  assert.equal(h.state.answer({ lt: 'gggggg', r: 'good', v: '12345678' }), null);
  assert.equal(h.state.answer({ lt: 'bbbbbb', r: 'miss', src: 'mistake' }), null);
  assert.equal(h.state.answer({ set: 'status', lt: 'gggggg', val: '暫停' }), null);
  const kept = h.state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' });
  assert.equal(typeof kept, 'string');
  assert.equal(typeof h.state.answer({ set: 'cap', val: 20 }), 'string');
  await h.state.flush();
  const written = (h.texts.get(own) ?? '').trim().split('\n').map(line => JSON.parse(line) as { lt?: string; set?: string }).filter(line => line.set !== 'app');
  assert.deepEqual(written.map(line => line.lt ?? line.set), ['aaaaaa', 'cap']);
  assert.deepEqual(h.state.history().reviews.map(r => r.lt), ['aaaaaa']);
});

void test('2-2 取消看它指的作答：那一筆的目標後來被停掉，取消也不寫；整份紀錄不完整時全部都不寫', async t => {
  const h = await setup(t, { [P]: goal('aaaaaa') + goal('bbbbbb') });
  const t1 = h.state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' });
  assert.ok(t1);
  await h.edit(LOG, JSON.stringify({ t: '2026-10-20T19:00:00.000+08:00', need: '9.0.0', lt: 'aaaaaa' }) + '\n');
  assert.equal(h.state.answer({ undo: t1 }), null);
  assert.equal(h.state.history().reviews.some(r => r.t === t1), true);
  // 取消找不到對象（例如很久以前的）照舊寫。
  assert.equal(typeof h.state.answer({ undo: '2026-10-01T19:00:00.000+08:00' }), 'string');
  await h.edit(LOG, JSON.stringify({ t: '2026-10-20T19:00:00.000+08:00', need: '9.0.0' }) + '\n');
  assert.deepEqual([h.state.blocked().all, h.state.canAnswer('bbbbbb'), h.share()], [true, false, []]);
  assert.equal(h.state.answer({ lt: 'bbbbbb', r: 'good', v: '12345678' }), null);
});
