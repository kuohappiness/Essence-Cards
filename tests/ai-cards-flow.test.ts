import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { blockIds, parseDeck } from '../src/core/deck/index.ts';
import { rawPath, sha256Hex } from '../src/core/ai/index.ts';
import type { CardForm, CardJob, EmbeddedRules } from '../src/core/ai/index.ts';
import { createState } from '../src/state/index.ts';
import { createAiCards } from '../src/obsidian/ai-cards.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// tasks/ai-cards-mvp.md §2～§5 接起來：製卡流程（src/obsidian/ai-cards.ts）＋真正的 createState＋記憶體 Files。畫面另外在 Windows 實機看。

const rules: EmbeddedRules = { english: [{ name: '通用', version: 'v0.15', text: '# 通用', sha256: sha256Hex('# 通用') }, { name: '英文', version: 'v0.14', text: '# 英文', sha256: sha256Hex('# 英文') }] };
const OLD = 'Essence Cards/學業/國二上/英文/國二上英文 L1 單字.md';
const OLD_TEXT = '---\n年級學期: 國二上\n科目: 英文\n單元: L1 Hi\n狀態: 啟用\n---\n\n## 單字\n\n- hello 英翻中 ^k3m9qa\n    - 出處：p.10\n    - hello :: 你好\n';
const reply = (extra = '') => [
  '國二上英文 L3 單字', '', '## 單字', '', '- borrow 英翻中', '    - 出處：p.40', '    - borrow :: 借入', '',
  '> [!note] 加進已有的學習目標', '> - k3m9qa hello 英翻中', '>     - 出處：p.41', '>     - hello there :: 你好啊', '',
  '國二上英文 L3 文法', '', '## 文法', '', '- 能用 be going to 說未來的計畫' + extra, '    - 出處：p.42', '    - 我明天要去游泳。I ＿＿ swim tomorrow. :: am going to', '<<<完>>>',
].join('\n');
const form: CardForm = { subject: 'english', term: '國二上', unit: 'L3 Sports', purpose: '準備段考', supplement: false, adjust: '', material: '' };
const WORD = 'Essence Cards/學業/國二上/英文/國二上英文 L3 單字.md';

/** 這台電腦的存放（localStorage 的替身）與一次載入（state＋製卡流程）；reload 是重開 Obsidian。 */
function machine() {
  const saved: { jobs: unknown; retired: string[]; last: { subject?: string; term?: string } } = { jobs: null, retired: [], last: {} };
  const store = {
    jobs: () => saved.jobs === null ? null : JSON.parse(JSON.stringify(saved.jobs)) as unknown,
    saveJobs(jobs: CardJob[]) { saved.jobs = JSON.parse(JSON.stringify(jobs)) as unknown; },
    retired: () => saved.retired,
    retire(ids: readonly string[]) { saved.retired = [...new Set([...saved.retired, ...ids])]; },
    last: () => saved.last,
    saveLast(last: { subject: string; term: string }) { saved.last = last; },
  };
  return { saved, store };
}
async function load(t: TestContext, memory: ReturnType<typeof createMemoryFiles>, box: ReturnType<typeof machine>, random = () => 0) {
  const clipboard: string[] = [];
  const errors: unknown[] = [];
  // eslint-disable-next-line prefer-const -- state 與流程互相參照
  let state: ReturnType<typeof createState>;
  const cards = createAiCards({
    rules, state: () => state, files: memory.files, store: box.store, random,
    names: () => new Set([...memory.texts.keys()].filter(path => path.endsWith('.md')).map(path => path.slice(path.lastIndexOf('/') + 1, -3).toLowerCase())),
    clipboard: text => { clipboard.push(text); return Promise.resolve(); },
    now: () => ({ ms: Date.parse('2026-11-07T10:02:11+08:00'), offset: 480 }),
    onError: error => { errors.push(error); },
  });
  state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: true, stuckAfter: 20, random, reserved: () => cards.reserved(), now: () => Date.parse('2026-11-07T10:02:11+08:00'), offset: () => 480, onError() {} });
  t.after(() => state.close());
  await state.ready();
  return { cards, state, clipboard, errors };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

void test('§2～§5 複製 → 貼回 → 存成草稿：提示照存下的、卡組是草稿、加進已有的轉成連結、快照與原文都在；工作清掉', async t => {
  const memory = createMemoryFiles({ [OLD]: OLD_TEXT });
  const box = machine();
  const { cards, state, clipboard } = await load(t, memory, box, Math.random);
  assert.equal(cards.existing(form), 1);
  assert.deepEqual(cards.terms('english').slice(0, 2), ['國二上', '小一上']);
  const copied = await cards.copy(form);
  assert.ok('job' in copied);
  assert.equal(clipboard[0], copied.job.parts.map(part => part.text).join('\n\n'));
  assert.ok(clipboard[0].includes('  - k3m9qa hello 英翻中｜國二上 L1 p.10'));
  assert.deepEqual(box.saved.last, { subject: 'english', term: '國二上' });
  assert.equal(cards.jobs().length, 1);
  const inspection = cards.inspect(copied.job, reply());
  assert.ok(!('error' in inspection));
  assert.deepEqual(inspection.errors, []);
  const result = await cards.save(copied.job, reply(), 'Claude');
  assert.equal(result.kind, 'done', JSON.stringify(result));
  assert.equal(result.kind === 'done' && result.targets, 2);
  const word = memory.texts.get('Essence Cards/學業/國二上/英文/國二上英文 L3 單字.md')!;
  assert.equal(parseDeck(word).props.status, 'draft');
  assert.ok(word.includes('> - [[國二上英文 L1 單字#^k3m9qa|hello 英翻中]]\n'));
  assert.ok(memory.texts.has('Essence Cards/學業/國二上/英文/國二上英文 L3 文法.md'));
  assert.ok(memory.texts.get('Essence Cards/紀錄/AI 輸出/2026-11-07 國二上英文 L3 Sports.md')!.includes('服務: Claude\n'));
  for (const part of copied.job.parts) assert.equal(memory.texts.get(rawPath(part.sha256)), part.text);
  assert.equal(memory.texts.get(rawPath(sha256Hex(reply()))), reply());
  assert.deepEqual(cards.jobs(), []);
  await settle();
  // 草稿不出題；按啟用之後才出。
  assert.deepEqual(state.deckTargets('Essence Cards/學業/國二上/英文/國二上英文 L3 單字.md'), []);
  assert.equal((await state.activateDraft('Essence Cards/學業/國二上/英文/國二上英文 L3 單字.md', null)).kind, 'done');
  assert.equal(state.deckTargets('Essence Cards/學業/國二上/英文/國二上英文 L3 單字.md').length, 1);
});

void test('§5 同一個工作同時只有一個操作（L2-1）：存到一半關掉重開，繼續、放棄、選擇都不動它；存完之後舊視窗也叫不回來', async t => {
  const memory = createMemoryFiles({ [OLD]: OLD_TEXT });
  const box = machine();
  const { cards } = await load(t, memory, box, Math.random);
  const copied = await cards.copy(form);
  assert.ok('job' in copied);
  const held = memory.holdModify(WORD);
  const saving = cards.save(copied.job, reply(), null);
  while (!memory.texts.has(WORD)) await new Promise(resolve => setTimeout(resolve, 1));
  // 工作已經記成開始建了：重開視窗看到的是同一個工作，四個操作都要回「還在存」，工作不能被清掉。
  const stale = cards.jobs()[0];
  assert.equal(stale.save!.decks[0].stage, 'started');
  for (const again of [cards.resume(stale), cards.abandon(stale), cards.choose(stale, 0, 'skip'), cards.save(stale, reply(), null)]) assert.match((await again as { message: string }).message, /還在存/);
  assert.deepEqual(box.saved.retired, []);
  assert.equal(cards.jobs().length, 1);
  held.release();
  const result = await saving;
  assert.equal(result.kind, 'done', JSON.stringify(result));
  assert.deepEqual(cards.jobs(), []);
  // 舊視窗還留著那個工作：不能讓它復活，也不能再寫。
  const before = new Map(memory.texts);
  for (const late of [() => cards.resume(stale), () => cards.abandon(stale), () => cards.choose(stale, 0, 'rebuild'), () => cards.save(stale, reply(), null)]) assert.match((await late() as { message: string }).message, /已經結束|找不到/);
  assert.deepEqual(cards.jobs(), []);
  assert.deepEqual(box.saved.retired, []);
  assert.deepEqual(memory.texts, before);
});

/** 卡組都寫成、快照寫不進去：工作停在準備發布前後，卡組已經在 vault。 */
async function snapshotFailed(t: TestContext) {
  const memory = createMemoryFiles({ [OLD]: OLD_TEXT });
  const box = machine();
  const loaded = await load(t, memory, box, Math.random);
  const copied = await loaded.cards.copy(form);
  assert.ok('job' in copied);
  const original = memory.files.modify.bind(memory.files);
  memory.files.modify = (path, edit) => path.includes('紀錄/AI 輸出/2026') ? Promise.reject(Error('磁碟滿了')) : original(path, edit);
  assert.equal((await loaded.cards.save(copied.job, reply(), null)).kind, 'stop');
  memory.files.modify = original;
  await settle();
  return { memory, box, ...loaded, job: loaded.cards.jobs()[0] };
}
const MOVED = 'Essence Cards/學業/國二上/英文/單字 改名.md';

void test('§5 卡組剛搬走、還沒讀完（L2-2）：等讀完再判斷，不會回報找不到、不會在舊位置再建一份', async t => {
  // 新路徑讀到了：跟到新位置。
  {
    const { memory, cards, state, job } = await snapshotFailed(t);
    const held = memory.holdRead(MOVED);
    memory.rename(WORD, MOVED);
    await held.started;
    let finished = false;
    const resuming = cards.resume(job).then(result => { finished = true; return result; });
    await settle();
    assert.equal(finished, false, '讀完之前不能下結論');
    held.release();
    const result = await resuming;
    assert.deepEqual(result.kind === 'done' && result.decks.map(path => path.slice(path.lastIndexOf('/') + 1)), ['單字 改名.md', '國二上英文 L3 文法.md'], JSON.stringify(result));
    assert.ok(!memory.texts.has(WORD));
    await settle();
    assert.deepEqual(state.conflicts(), []);
  }
  // 讀完發現有兩份：停下，不重建。
  {
    const { memory, cards, job } = await snapshotFailed(t);
    const text = memory.texts.get(WORD)!;
    const held = memory.holdRead(MOVED);
    memory.rename(WORD, MOVED);
    memory.write('Essence Cards/學業/國二上/英文/單字 副本.md', text);
    await held.started;
    const resuming = cards.resume(job);
    held.release();
    const result = await resuming;
    assert.equal(result.kind === 'stop' && result.deck?.situation, 'split', JSON.stringify(result));
    assert.ok(!memory.texts.has(WORD));
  }
  // 新路徑讀不到：不知道就不下結論。
  {
    const { memory, cards, job } = await snapshotFailed(t);
    const held = memory.holdRead(MOVED);
    memory.rename(WORD, MOVED);
    await held.started;
    memory.failing.add(MOVED);
    const resuming = cards.resume(job);
    held.release(Error('iCloud 還沒下載'));
    const result = await resuming;
    assert.equal(result.kind, 'stop');
    assert.equal(result.kind === 'stop' && result.deck, undefined, JSON.stringify(result));
    assert.ok(!memory.texts.has(WORD));
    memory.failing.delete(MOVED);
  }
  // 家長按重建的當下才冒出來（同步把它送回來）：照現在的位置，不多建一份。
  {
    const { memory, cards, job } = await snapshotFailed(t);
    const text = memory.texts.get(WORD)!;
    memory.remove(WORD);
    await settle();
    const stop = await cards.resume(job);
    assert.equal(stop.kind === 'stop' && stop.deck?.situation, 'missing', JSON.stringify(stop));
    const held = memory.holdRead(MOVED);
    memory.write(MOVED, text);
    await held.started;
    const rebuilding = cards.choose(job, 0, 'rebuild');
    held.release();
    const result = await rebuilding;
    assert.equal(result.kind, 'done', JSON.stringify(result));
    assert.ok(!memory.texts.has(WORD));
  }
  // 受保護的建檔：檢查與建立之間，這些 ID 已經在某一篇，就不建。
  {
    const { memory, state, job } = await snapshotFailed(t);
    const deck = job.save!.decks[0];
    assert.deepEqual(await state.aiCreateDeck(MOVED, deck.text, deck.ids), { kind: 'elsewhere' });
    assert.ok(!memory.texts.has(MOVED));
  }
});

void test('§5 寫到一半失敗 → 重新載入：預留的 ID 補 ID 與另一次製卡都避開（R2-3）；同一個工作貼不同的回覆停下；繼續不用再貼；放棄後 ID 不再配出', async t => {
  const memory = createMemoryFiles({ [OLD]: OLD_TEXT, 'Essence Cards/一般.md': '- 能說出 A\n    - A？ :: 是\n' });
  const box = machine();
  const first = await load(t, memory, box);
  const a = await first.cards.copy(form);
  assert.ok('job' in a);
  // 原文寫完、建卡組時寫不進去。
  const original = memory.files.modify.bind(memory.files);
  memory.files.modify = (path, edit) => path.includes('/學業/') ? Promise.reject(Error('磁碟滿了')) : original(path, edit);
  const stopped = await first.cards.save(a.job, reply(), null);
  assert.equal(stopped.kind, 'stop');
  assert.equal(first.errors.length, 1);
  memory.files.modify = original;
  const reserved = first.cards.reserved();
  assert.equal(reserved.length, 2);
  // 重新載入：固定亂數讓配號一定從同一個地方開始，看得出有沒有避開。
  const second = await load(t, memory, box);
  assert.deepEqual(second.cards.reserved(), reserved);
  assert.equal(await second.state.fillIds('Essence Cards/一般.md'), true);
  const filled = [...blockIds(memory.texts.get('Essence Cards/一般.md')!)];
  assert.ok(!reserved.includes(filled[0]));
  const b = await second.cards.copy({ ...form, unit: 'L4 Food' });
  assert.ok('job' in b);
  const otherReply = reply().replaceAll('L3', 'L4');
  assert.equal((await second.cards.save(b.job, otherReply, null)).kind, 'done');
  const bIds = [...blockIds(memory.texts.get('Essence Cards/學業/國二上/英文/國二上英文 L4 單字.md')!), ...blockIds(memory.texts.get('Essence Cards/學業/國二上/英文/國二上英文 L4 文法.md')!)];
  assert.deepEqual(bIds.filter(id => reserved.includes(id) || filled.includes(id)), []);
  // A：貼不同的回覆停下；同一份照樣接著做。
  const job = second.cards.jobs().find(each => each.id === a.job.id)!;
  assert.match((await second.cards.save(job, reply(' 不同'), null) as { message: string }).message, /已經用另一份回覆存過一部分/);
  // 放棄：開始建了的那一篇（寫不進去，但記成開始建了）的 ID 進不再配出的清單。
  const left = await second.cards.abandon(job);
  assert.deepEqual(left, { left: [] });
  assert.ok(box.saved.retired.length > 0 && box.saved.retired.every(id => reserved.includes(id)));
  assert.deepEqual(second.cards.jobs(), []);
  // 不再配出：清單裡的 ID 照樣是預留。
  assert.deepEqual(second.cards.reserved(), box.saved.retired);
});
