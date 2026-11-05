import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createState } from '../src/state/index.ts';
import type { IdIssue, State, StateOptions } from '../src/state/index.ts';
import { canRead, PICK_NEEDS, releaseOf } from '../src/core/version/index.ts';
import { encodeEntry } from '../src/core/study/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';
import { createMemoryEditor } from './helpers/editor.ts';

// 卡組的標記（tasks/question-type-seam.md §3、D-191）：state 準備寫入的最後一步，對最終文字判斷。外部改檔是記憶體 Files 的 write。
const DELAY = 30;
const BUILD = `${PICK_NEEDS}+1a2b3c4`;
const P = 'Essence Cards/相似字（卡片）.md';
const LOG = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
const FRESH = '- 寨（寨、塞） 相似字\n    - 山＿＿ :: 寨\n';
const WITH_ID = '- 寨（寨、塞） 相似字 ^abc222\n    - 山＿＿ :: 寨\n';
const FILLED = '- 寨（寨、塞） 相似字 ^aaaaaa\n    - 山＿＿ :: 寨\n';
const WRONG_ANSWER = '- 寨（寨、塞） 相似字\n    - 大＿＿車 :: 塞\n';
const PLAIN = '- 能說明 A\n    - Q :: A\n';
const MARK = `---\n需要版本: ${PICK_NEEDS}\n---\n`;
const FLOW = '---\n{科目: 國語}\n---\n';

const timed = new WeakSet<TestContext>();
interface Harness extends MemoryFiles {
  state: State;
  edit: (path: string, text: string) => Promise<void>;
  read: (path?: string) => string | undefined;
  issues: () => IdIssue[];
}
async function setup(t: TestContext, vault: Record<string, string>, options: Partial<StateOptions> = {}, memory = createMemoryFiles(vault)): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const state = createState({ files: memory.files, device: 'Windows-2c9e', build: BUILD, delay: DELAY, fillIds: true, random: () => 0,
    now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480, ...options });
  t.after(() => state.close());
  await state.ready();
  const settle = async () => { t.mock.timers.tick(DELAY + 1); await new Promise<void>(resolve => setImmediate(resolve)); };
  return { ...memory, state, read: (path = P) => memory.texts.get(path), issues: () => state.deckStatus(P).issues,
    edit: async (path, text) => { memory.write(path, text); await settle(); } };
}
/** 存檔；磁碟上最後是 stored（預設就是編輯器的文字），用來重現寫後被改掉。 */
async function save(h: Harness, text: string, stored?: (written: string) => string) {
  const editor = createMemoryEditor(h, P, text);
  if (stored) editor.persist = () => { h.write(P, stored(editor.value)); return Promise.resolve(); };
  return { result: await h.state.save(editor), value: editor.value };
}

void test('沒有比較卡：不寫標記，deckStatus 沒有 mark', async t => {
  const h = await setup(t, { [P]: PLAIN });
  assert.deepEqual(h.state.deckStatus(P), { missing: 1, issues: [], malformed: [] });
  const { value } = await save(h, PLAIN);
  assert.equal(value, PLAIN.replace('能說明 A', '能說明 A ^aaaaaa'));
});

void test('補 ID 加標記：存檔與離開筆記都同一份寫入', async t => {
  const h = await setup(t, { [P]: FRESH });
  assert.deepEqual(h.state.deckStatus(P), { missing: 1, issues: [], malformed: [], mark: 'missing' });
  const saved = await save(h, FRESH);
  assert.deepEqual(saved, { result: { kind: 'done', added: 1 }, value: MARK + FILLED });
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [], malformed: [] });
  const other = await setup(t, { [P]: FRESH });
  assert.equal(await other.state.fillIds(P), true);
  assert.equal(other.read(), MARK + FILLED);
  assert.equal(await other.state.fillIds(P), false);
});

void test('只有 pick-answer-invalid 的目標也寫：舊版會把它當翻面卡', async t => {
  const h = await setup(t, { [P]: WRONG_ANSWER });
  assert.equal(await h.state.fillIds(P), true);
  assert.equal(h.read(), MARK + WRONG_ANSWER.replace('相似字', '相似字 ^aaaaaa'));
});

void test('ID 都有、只缺標記：不是沒有要做的，fillIds 寫得進去，第二次不改字', async t => {
  const h = await setup(t, { [P]: WITH_ID });
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [], malformed: [], mark: 'missing' });
  assert.equal(await h.state.fillIds(P), true);
  assert.equal(h.read(), MARK + WITH_ID);
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [], malformed: [] });
  assert.equal(await h.state.fillIds(P), false);
});

void test('存檔只加標記：done，沒有新增', async t => {
  const h = await setup(t, { [P]: WITH_ID });
  assert.deepEqual(await save(h, WITH_ID), { result: { kind: 'done', added: 0 }, value: MARK + WITH_ID });
});

void test('已有不低於 PICK_NEEDS、這台讀得懂的值：不動；較低的值換成 PICK_NEEDS', async t => {
  const higher = '---\n需要版本: 50.0.0\n---\n' + WITH_ID;
  const h = await setup(t, { [P]: higher }, { build: '99.0.0+1a2b3c4' });
  assert.deepEqual(h.state.deckStatus(P), { missing: 0, issues: [], malformed: [] });
  assert.equal(await h.state.fillIds(P), false);
  const lower = await setup(t, { [P]: '---\n需要版本: 0.0.1 # 舊\n---\n' + WITH_ID });
  assert.equal(await lower.state.fillIds(P), true);
  assert.equal(lower.read(), `---\n需要版本: ${PICK_NEEDS} # 舊\n---\n` + WITH_ID);
});

void test('寫後只失去標記：stale，不算寫成', async t => {
  const h = await setup(t, { [P]: FRESH });
  const { result } = await save(h, FRESH, written => written.replace(`需要版本: ${PICK_NEEDS}\n`, ''));
  assert.deepEqual(result, { kind: 'stale' });
});

void test('寫後標記低於要的、寫壞、這台讀不懂：stale；相同或更高、這台讀得懂的算成立', async t => {
  const fresh = '---\n需要版本: 50.0.0\n---\n' + FRESH;
  const lowered = await setup(t, { [P]: fresh }, { build: '99.0.0+1a2b3c4' });
  assert.deepEqual((await save(lowered, fresh, written => written.replace('50.0.0', PICK_NEEDS))).result, { kind: 'stale' });
  const broken = await setup(t, { [P]: fresh }, { build: '99.0.0+1a2b3c4' });
  assert.deepEqual((await save(broken, fresh, written => written.replace('50.0.0', 'v50'))).result, { kind: 'stale' });
  const newer = await setup(t, { [P]: fresh }, { build: '99.0.0+1a2b3c4' });
  assert.deepEqual((await save(newer, fresh, written => written.replace('50.0.0', '100.0.0'))).result, { kind: 'stale' });
  const raised = await setup(t, { [P]: fresh }, { build: '99.0.0+1a2b3c4' });
  assert.deepEqual((await save(raised, fresh, written => written.replace('50.0.0', '60.0.0'))).result, { kind: 'done', added: 1 });
  const kept = await setup(t, { [P]: fresh }, { build: '99.0.0+1a2b3c4' });
  assert.deepEqual((await save(kept, fresh)).result, { kind: 'done', added: 1 });
});

void test('還原、當成新的都帶標記', async t => {
  const restored = await setup(t, { [P]: WITH_ID });
  await restored.edit(P, FRESH);
  assert.deepEqual(restored.issues().map(issue => [issue.kind, issue.restore]), [['lost', 'abc222']]);
  const editor = createMemoryEditor(restored, P, FRESH);
  assert.deepEqual(await restored.state.resolve(restored.issues()[0], 'restore', editor), { kind: 'done', added: 0 });
  assert.equal(editor.value, MARK + WITH_ID);
  assert.deepEqual(restored.issues(), []);

  const fresh = await setup(t, { [P]: WITH_ID });
  await fresh.edit(P, FRESH);
  const other = createMemoryEditor(fresh, P, FRESH);
  assert.deepEqual(await fresh.state.resolve(fresh.issues()[0], 'new', other), { kind: 'done', added: 0 });
  assert.equal(other.value, MARK + FILLED);
});

void test('同名目標與前方有隱式題：當成新的挑到的 ID 和不寫標記時相同', async t => {
  const twins = (first: string): string => `- 隱式 :: 答案\n- 寨（寨、塞） 相似字${first}\n    - 山＿＿ :: 寨\n- 寨（寨、塞） 相似字 ^zzz222\n    - 水＿＿ :: 寨\n`;
  const run = async (options: Partial<StateOptions>): Promise<string> => {
    const h = await setup(t, { [P]: twins(' ^abc222') }, options);
    await h.edit(P, twins(''));
    const issue = h.issues().find(each => each.kind === 'lost');
    assert.ok(issue);
    const editor = createMemoryEditor(h, P, twins(''));
    assert.equal((await h.state.resolve(issue, 'new', editor)).kind, 'done');
    return editor.value;
  };
  const plain = await run({ build: undefined });
  assert.equal(await run({}), MARK + plain);
});

void test('markNeed 回 null：這篇一字不改，新目標沒有 ID，deckStatus 是 refused，重建 state 之後還是', async t => {
  const text = FLOW + FRESH + PLAIN;
  const h = await setup(t, { [P]: text });
  assert.deepEqual(h.state.deckStatus(P), { missing: 2, issues: [], malformed: [], mark: 'refused' });
  assert.deepEqual(await save(h, text), { result: { kind: 'unchanged' }, value: text });
  assert.equal(await h.state.fillIds(P), false);
  assert.equal(h.read(), text);
  assert.deepEqual(h.state.today().share, []);
  const again = await setup(t, { [P]: text });
  assert.equal(again.state.deckStatus(P).mark, 'refused');
});

void test('markNeed 回 null：還原、當成新的也一字不改，問題留著', async t => {
  const lost = FLOW + FRESH;
  for (const choice of ['restore', 'new'] as const) {
    const h = await setup(t, { [P]: FLOW + WITH_ID });
    await h.edit(P, lost);
    assert.equal(h.state.deckStatus(P).mark, 'refused');
    const editor = createMemoryEditor(h, P, lost);
    assert.deepEqual(await h.state.resolve(h.issues()[0], choice, editor), { kind: 'stale' });
    assert.equal(editor.value, lost);
    assert.equal(h.read(), lost);
    assert.deepEqual(h.issues().map(issue => issue.kind), ['lost']);
  }
});

void test('已有 ID、屬性區加不上：照舊出題、refused，文字不動', async t => {
  const text = FLOW + WITH_ID;
  const h = await setup(t, { [P]: text });
  assert.deepEqual(h.state.today().share.map(item => item.lt), ['abc222']);
  assert.equal(h.state.deckStatus(P).mark, 'refused');
  assert.equal(await h.state.fillIds(P), false);
  assert.equal(h.read(), text);
});

void test('手機不寫、備份閘門關著不寫', async t => {
  const phone = await setup(t, { [P]: WITH_ID }, { fillIds: false });
  assert.equal(await phone.state.fillIds(P), false);
  assert.equal(phone.read(), WITH_ID);
  assert.equal(phone.state.deckStatus(P).mark, undefined);
  const backup = await setup(t, { [P]: WITH_ID }, { backup: true });
  assert.equal(await backup.state.fillIds(P), false);
  assert.deepEqual((await save(backup, WITH_ID)).result, { kind: 'blocked', reason: 'backup' });
  assert.equal(backup.read(), WITH_ID);
});

void test('build 不明（測試預設）不寫：不知道這台讀不讀得懂自己寫的標記', async t => {
  const h = await setup(t, { [P]: FRESH }, { build: undefined });
  assert.deepEqual(h.state.deckStatus(P), { missing: 1, issues: [], malformed: [] });
  assert.deepEqual(await save(h, FRESH), { result: { kind: 'done', added: 1 }, value: FILLED });
});

void test('這個建置讀得懂自己寫的標記：manifest 的版號不低於 PICK_NEEDS', async t => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as { version: string };
  assert.ok(canRead(PICK_NEEDS, releaseOf(manifest.version)));
  const h = await setup(t, { [P]: MARK + WITH_ID, [LOG]: encodeEntry('2026-10-01T19:00:00.000+08:00', { lt: 'abc222', r: 'good', v: '12345678' }) + '\n' }, { build: manifest.version + '+1a2b3c4' });
  assert.deepEqual(h.state.blocked(), { decks: [], targets: [], all: false });
  assert.deepEqual(h.state.today().share.map(item => item.lt), ['abc222']);
});
