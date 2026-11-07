import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { blockIds } from '../src/core/deck/index.ts';
import { createState } from '../src/state/index.ts';
import type { State, StateOptions } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// tasks/ai-cards-mvp.md 在 state 的部分：§5 配號、ID 在哪、只建立的寫入、ID 的預留（R2-3），§6 引言框裡的 ID 算占用，§7 草稿 → 啟用。真正的 createState，記憶體 Files。

const LOG = 'Essence Cards/紀錄/2026-11 PC-test.jsonl';
const DECK = 'Essence Cards/學業/國二上/自然/2-1.md';
const head = (status: string): string => `---\n年級學期: 國二上\n科目: 自然\n單元: 2-1 密度\n狀態: ${status}\n---\n\n`;
/** 固定亂數：每次都一樣，配號的結果才比得出來會不會撞。 */
const fixed = (): (() => number) => () => 0;

interface Harness extends MemoryFiles { state: State; logged: () => Record<string, unknown>[] }
async function setup(t: TestContext, texts: Record<string, string>, options: Partial<StateOptions> = {}): Promise<Harness> {
  const memory = createMemoryFiles(texts);
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: true, stuckAfter: 20, random: fixed(), now: () => Date.parse('2026-11-07T10:00:00.000+08:00'), offset: () => 480, onError() {}, ...options });
  t.after(() => state.close());
  await state.ready();
  return { ...memory, state, logged: () => (memory.texts.get(LOG) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>) };
}

void test('§5 配號避開卡組（含引言框的行尾 ID）、紀錄的 lt、這台電腦的預留與同一次已配的；配出的之後補 ID 也避開', async t => {
  // 固定亂數第一個會抽到 aaaaaa：讓它被各種占用擋掉，往後找。
  const reserved = ['aaaaac'];
  const h = await setup(t, {
    [DECK]: head('啟用') + '- 能說出密度 ^aaaaaa\n    - 密度？ :: 質量除以體積\n\n> [!note]- 候選卡片\n> - 能說出浮力 ^aaaaab\n>     - 浮力？ :: 向上的力\n',
    [LOG]: JSON.stringify({ t: '2026-11-01T10:00:00+08:00', lt: 'aaaaad', r: 'good', v: '12345678' }) + '\n',
  }, { reserved: () => reserved });
  const ids = h.state.aiIds(2);
  assert.deepEqual(ids, ['aaaaae', 'aaaaaf']);
  // 再配一次、或替別篇補 ID，都不會再配出它們。
  assert.deepEqual(h.state.aiIds(1), ['aaaaag']);
  h.write('Essence Cards/新的.md', '- 能說出重量\n    - 重量？ :: 受到的重力\n');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await h.state.fillIds('Essence Cards/新的.md'), true);
  assert.deepEqual([...blockIds(h.texts.get('Essence Cards/新的.md')!)], ['aaaaah']);
});

void test('§5 預留（R2-3）：沒完成的工作 A 的 ID，重新載入之後替一般卡組補 ID、做 B 工作都避開；放棄後拿掉預留就可以再配', async t => {
  const reserved = new Set(['aaaaaa', 'aaaaab']);
  const h = await setup(t, { 'Essence Cards/一般.md': '- 能說出 A\n    - A？ :: 是\n' }, { reserved: () => reserved });
  assert.equal(await h.state.fillIds('Essence Cards/一般.md'), true);
  assert.deepEqual([...blockIds(h.texts.get('Essence Cards/一般.md')!)], ['aaaaac']);
  assert.deepEqual(h.state.aiIds(1), ['aaaaad']);
  // 另一個 state（重新載入）且 A 已放棄：預留拿掉之後 aaaaaa 可以配。
  const again = await setup(t, {}, { reserved: () => [] });
  assert.deepEqual(again.state.aiIds(1), ['aaaaaa']);
});

void test('§5 配號與只建立的寫入受同一組門檻：手機、還沒讀完、備份還沒成功都不配、不寫', async t => {
  const phone = await setup(t, {}, { fillIds: false });
  assert.equal(phone.state.aiIds(1), 'phone');
  assert.deepEqual(await phone.state.aiCreate('Essence Cards/紀錄/AI 輸出/x.md', 'x'), { kind: 'blocked', reason: 'phone' });
  const backup = await setup(t, {}, { backup: true });
  assert.equal(backup.state.aiIds(1), 'backup');
  assert.deepEqual(await backup.state.aiCreate('Essence Cards/紀錄/AI 輸出/x.md', 'x'), { kind: 'blocked', reason: 'backup' });
  assert.equal(backup.texts.has('Essence Cards/紀錄/AI 輸出/x.md'), false);
  backup.state.backupReady(true);
  assert.deepEqual(await backup.state.aiCreate('Essence Cards/紀錄/AI 輸出/x.md', 'x'), { kind: 'done' });
});

void test('§5 只建立：寫好讀回核對；已經有檔（含空檔）不動、回 exists；新建的卡組由 state 讀到，ID 在哪問得到', async t => {
  const h = await setup(t, { 'Essence Cards/紀錄/AI 輸出/空.md': '' });
  assert.deepEqual(await h.state.aiCreate('Essence Cards/紀錄/AI 輸出/空.md', '內容'), { kind: 'exists' });
  assert.equal(h.texts.get('Essence Cards/紀錄/AI 輸出/空.md'), '');
  const text = head('草稿') + '- 能說出密度 ^k3m9qa\n    - 密度？ :: 質量除以體積\n';
  assert.deepEqual(await h.state.aiCreate(DECK, text), { kind: 'done' });
  assert.equal(h.texts.get(DECK), text);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual([...h.state.aiWhere(['k3m9qa', 'zzzzzz'])!], [['k3m9qa', [DECK]]]);
  assert.equal(h.state.decks().find(each => each.path === DECK)?.deck.props.status, 'draft');
});

void test('§5 已有目標：同科、之前或相同的年級學期、不是草稿；aiTarget 剛好一個讀得懂的才是 one，重複的是 unusable', async t => {
  const h = await setup(t, {
    [DECK]: head('啟用') + '- 能說出密度 ^k3m9qa\n    - 密度？ :: 質量除以體積\n- 能說出浮力 ^p7q2w8\n    - 浮力？ :: 向上的力\n',
    'Essence Cards/學業/國二上/自然/2-2.md': head('草稿') + '- 能說出溶解 ^h2m8qd\n    - 溶解？ :: 散開\n',
    'Essence Cards/學業/國二上/自然/2-3.md': head('啟用').replace('2-1 密度', '2-3 複製') + '- 能說出浮力 ^p7q2w8\n    - 浮力？ :: 向上的力\n',
  });
  assert.deepEqual(h.state.aiExisting('自然', '國二上').map(each => `${each.id} ${each.name}`), ['k3m9qa 能說出密度']);
  assert.deepEqual(h.state.aiTarget('k3m9qa'), { kind: 'one', path: DECK, name: '能說出密度' });
  assert.deepEqual(h.state.aiTarget('p7q2w8'), { kind: 'unusable' });
  assert.deepEqual(h.state.aiTarget('zzzzzz'), { kind: 'none' });
});

void test('§6 候選框裡的 ID 不再配出；剪下貼成目標後照舊出題、不重複；複製出兩個真正的目標時兩個一起停出（D-157）；跨檔搬移、重新載入之後一樣', async t => {
  const candidate = '> [!note]- 候選卡片\n> - 能說出浮力 ^aaaaaa\n>     - 理由：x\n>     - 浮力？ :: 向上的力\n';
  const h = await setup(t, { [DECK]: head('啟用') + '- 能說出密度\n    - 密度？ :: 質量除以體積\n\n' + candidate });
  assert.equal(await h.state.fillIds(DECK), true);
  // 固定亂數第一個抽到 aaaaaa，被候選框占著，往後找。
  assert.ok(h.texts.get(DECK)!.includes('- 能說出密度 ^aaaaab\n'));
  assert.deepEqual(h.state.deckTargets(DECK), ['aaaaab']);
  // 剪下候選貼成目標：照舊出題、不算重複。
  h.write(DECK, head('啟用') + '- 能說出密度 ^aaaaab\n    - 密度？ :: 質量除以體積\n- 能說出浮力 ^aaaaaa\n    - 浮力？ :: 向上的力\n');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual([...h.state.deckTargets(DECK)].sort(), ['aaaaaa', 'aaaaab']);
  assert.deepEqual(h.state.conflicts(), []);
  // 複製到另一篇成為真正的目標：兩個一起停出。
  const other = 'Essence Cards/學業/國二上/自然/2-9.md';
  h.write(other, head('啟用').replace('2-1 密度', '2-9 複製') + '- 能說出浮力 ^aaaaaa\n    - 浮力？ :: 向上的力\n');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(h.state.conflicts().map(each => each.id), ['aaaaaa']);
  assert.deepEqual(h.state.deckTargets(DECK), ['aaaaab']);
  // 跨檔搬移候選框、重新載入：照樣占著，不再配出。
  const moved = await setup(t, { [DECK]: head('啟用') + '- 能說出密度\n    - 密度？ :: 質量除以體積\n', [other]: candidate });
  assert.equal(await moved.state.fillIds(DECK), true);
  assert.ok(moved.texts.get(DECK)!.includes('- 能說出密度 ^aaaaab\n'));
  assert.deepEqual([...moved.state.aiWhere(['aaaaaa'])!], [['aaaaaa', [other]]]);
});

void test('§7 草稿 → 啟用：只改這一篇的狀態、記一行 set: status；暫停、啟用的不動；需要新版的擋下；手機不寫；屬性區讀不懂的不寫', async t => {
  const draft = head('草稿') + '- 能說出密度 ^k3m9qa\n    - 密度？ :: 質量除以體積\n';
  const paused = 'Essence Cards/學業/國二上/自然/2-2.md';
  const broken = 'Essence Cards/學業/國二上/自然/2-3.md';
  const h = await setup(t, { [DECK]: draft, [paused]: head('暫停') + '- 能說出浮力 ^p7q2w8\n    - 浮力？ :: 向上的力\n', [broken]: '---\n狀態: [草稿\n---\n- 能說出 A ^h2m8qd\n    - A？ :: 是\n' });
  assert.deepEqual(h.state.deckTargets(DECK), []);
  assert.equal((await h.state.activateDraft(DECK, null)).kind, 'done');
  assert.equal(h.texts.get(DECK), draft.replace('狀態: 草稿', '狀態: 啟用'));
  assert.deepEqual(h.state.deckTargets(DECK), ['k3m9qa']);
  await h.state.flush();
  assert.deepEqual(h.logged().filter(each => each.set === 'status').map(({ t: _t, ...rest }) => rest), [{ set: 'status', deck: DECK, val: '啟用' }]);
  assert.equal((await h.state.activateDraft(DECK, null)).kind, 'unchanged');
  assert.equal((await h.state.activateDraft(paused, null)).kind, 'unchanged');
  assert.ok(h.texts.get(paused)!.includes('狀態: 暫停'));
  assert.equal((await h.state.activateDraft(broken, null)).kind, 'unchanged');
  // 需要新版的草稿：和目錄的暫停同一道門檻（needs-update），不改字、不記。
  const newer = draft.replace('狀態: 草稿', '狀態: 草稿\n需要版本: 99.0.0');
  const gated = await setup(t, { [DECK]: newer });
  assert.deepEqual(await gated.state.activateDraft(DECK, null), { kind: 'blocked', reason: 'needs-update' });
  assert.equal(gated.texts.get(DECK), newer);
  await gated.state.flush();
  assert.deepEqual(gated.logged().filter(each => each.set === 'status'), []);
  // 目錄的暫停不能把草稿改成暫停（照舊）。
  const again = await setup(t, { [DECK]: draft });
  assert.equal((await again.state.setDeckStatus(DECK, '暫停', null)).kind, 'unchanged');
  const phone = await setup(t, { [DECK]: draft }, { fillIds: false });
  assert.deepEqual(await phone.state.activateDraft(DECK, null), { kind: 'blocked', reason: 'phone' });
  assert.equal(phone.texts.get(DECK), draft);
});
