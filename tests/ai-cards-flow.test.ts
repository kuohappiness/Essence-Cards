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
