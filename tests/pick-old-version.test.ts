import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnv } from '../tools/git.ts';
import { parseDeck } from '../src/core/deck/index.ts';
import { encodeEntry } from '../src/core/study/index.ts';
import { PICK_NEEDS } from '../src/core/version/index.ts';
import { createState } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import { tempFolder } from './helpers/vault.ts';

// 舊版讀寫入端的成果（tasks/question-type-seam.md §3、D-191）：用真的 v0.3.0 標籤的程式，不是用現在的程式假裝舊版。
const root = fileURLToPath(new URL('../', import.meta.url));
const env = gitEnv();
const git = (dir: string, ...args: string[]): string => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
const P = 'Essence Cards/相似字（卡片）.md';
const OTHER = 'Essence Cards/別篇（卡片）.md';
const CARD = '- 寨（寨、塞） 相似字\n    - 山＿＿ :: 寨\n';
const PLAIN = '- 能說明 A ^bbb222\n    - Q :: A\n';

/** 在 v0.3.0 的 clone 裡跑一次：另一個 process，載入的都是那個標籤的程式。 */
const SCRIPT = `
import { createState } from './src/state/index.ts';
import { createMemoryFiles } from './tests/helpers/memory-files.ts';
import { createMemoryEditor } from './tests/helpers/editor.ts';
const [vault, path] = JSON.parse(process.argv[1]);
const memory = createMemoryFiles(vault);
const state = createState({ files: memory.files, device: 'Windows-2c9e', build: '0.3.0+0000000', delay: 1, fillIds: true, random: () => 0, now: () => Date.parse('2026-11-05T19:00:00.000+08:00'), offset: () => 480 });
await state.ready();
const today = state.today().share.map(item => item.lt), decks = state.decks().map(deck => deck.path), blocked = state.blocked();
const fill = await state.fillIds(path);
const save = await state.save(createMemoryEditor(memory, path, vault[path]));
console.log(JSON.stringify({ today, decks, blocked, fill, save, text: memory.texts.get(path) }));
await state.close();
`;
interface OldRun { today: string[]; decks: string[]; blocked: { decks: string[]; targets: string[]; all: boolean }; fill: boolean; save: { kind: string; reason?: string }; text: string }
async function oldClone(t: TestContext): Promise<string> {
  const dir = await tempFolder(t, 'essence-v030-');
  git(root, 'clone', '-q', '--no-checkout', root, dir);
  git(dir, 'checkout', '-q', 'v0.3.0');
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
  return dir;
}
async function oldVersion(t: TestContext, vault: Record<string, string>, path: string): Promise<OldRun> {
  const dir = await oldClone(t);
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', SCRIPT, JSON.stringify([vault, path])], { cwd: dir, env, encoding: 'utf8' });
  return JSON.parse(out) as OldRun;
}

void test('v0.3.0 讀新版寫回的比較卡組：不出題、blocked 有它、不再改寫；別篇照常', async t => {
  const memory = createMemoryFiles({ [P]: CARD });
  const writer = createState({ files: memory.files, device: 'Windows-2c9e', build: `${PICK_NEEDS}+1a2b3c4`, delay: 1, fillIds: true, random: () => 0 });
  t.after(() => writer.close());
  await writer.ready();
  assert.equal(await writer.fillIds(P), true);
  const written = memory.texts.get(P) as string;
  assert.ok(written.startsWith(`---\n需要版本: ${PICK_NEEDS}\n---\n`), written);

  const old = await oldVersion(t, { [P]: written, [OTHER]: PLAIN }, P);
  assert.deepEqual(old, { today: ['bbb222'], decks: [OTHER], blocked: { decks: [P], targets: [], all: false }, fill: false, save: { kind: 'blocked', reason: 'needs-update' }, text: written });
});

void test('v0.3.0 讀屬性區開頭有打字雜訊、寫回標記的卡組：一樣擋住（L2 的 R1）', async t => {
  const memory = createMemoryFiles({ [P]: ` ---\n科目: 國語\n---\n${CARD}` });
  const writer = createState({ files: memory.files, device: 'Windows-2c9e', build: `${PICK_NEEDS}+1a2b3c4`, delay: 1, fillIds: true, random: () => 0 });
  t.after(() => writer.close());
  await writer.ready();
  assert.equal(await writer.fillIds(P), true);
  const old = await oldVersion(t, { [P]: memory.texts.get(P) as string, [OTHER]: PLAIN }, OTHER);
  assert.deepEqual([old.today, old.decks, old.blocked.decks], [['bbb222'], [OTHER], [P]]);
});

void test('v0.3.0 讀沒有標記、目標沒有 ID 的比較卡組：也不出題（ID 和標記是同一次寫入）', async t => {
  const old = await oldVersion(t, { [P]: CARD, [OTHER]: PLAIN }, OTHER);
  assert.deepEqual(old.today, ['bbb222']);
  assert.deepEqual(old.blocked.decks, []);
});

void test('v0.3.0 的 parseDeck 讀比較卡組當問答卡：每一題的指紋相同、題型是翻面', async t => {
  const text = [
    '---', '科目: 國語', '---',
    '- 寨（寨、塞） 相似字 ^abc222', '    - 盜匪躲在山＿＿裡。 :: 寨', '    - 山＿＿的路 **很難** 走。 :: 寨', '    - 記憶錨點：下面是**木**',
    '- 塞（寨、塞） 相似字 ^def333', '    - 水管＿＿住了。 :: 塞', '    - 大＿＿車。 :: 塞', '',
  ].join('\n');
  const dir = await oldClone(t);
  const script = "import { parseDeck } from './src/core/deck/index.ts'; console.log(JSON.stringify(parseDeck(JSON.parse(process.argv[1])).targets.map(target => [target.id, target.prompts.map(prompt => [prompt.kind, prompt.kind === 'qa' ? prompt.typed : null, prompt.fingerprint])])));";
  const old = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(text)], { cwd: dir, env, encoding: 'utf8' })) as unknown;
  const now = parseDeck(text).targets;
  assert.ok(now.every(target => target.group), '這個版本讀到的是比較卡');
  const expected = now.map(target => [target.id, target.prompts.map(prompt => ['qa', null, prompt.fingerprint])]);
  assert.deepEqual(old, expected);
  assert.equal(now.flatMap(target => target.prompts).length, 4);
});

void test('v0.3.0 讀加不上標記的那一篇：文字沒變，佇列前後相同，新目標沒有 ID 不出題', async t => {
  const text = '---\n{科目: 國語}\n---\n- 寨（寨、塞） 比較 ^aaa111\n    - 山＿＿ :: 寨\n- 塞（寨、塞） 比較\n    - 水＿＿ :: 塞\n' + PLAIN;
  const before = await oldVersion(t, { [P]: text }, OTHER);
  assert.deepEqual([...before.today].sort(), ['aaa111', 'bbb222']);
  const memory = createMemoryFiles({ [P]: text });
  const writer = createState({ files: memory.files, device: 'Windows-2c9e', build: `${PICK_NEEDS}+1a2b3c4`, delay: 1, fillIds: true, random: () => 0 });
  t.after(() => writer.close());
  await writer.ready();
  assert.equal(await writer.fillIds(P), false);
  // 還原、當成新的在 tests/state-need.test.ts 驗一字不改：同樣的文字，舊版讀到的佇列就同樣。
  assert.equal(memory.texts.get(P), text);
  assert.deepEqual((await oldVersion(t, { [P]: memory.texts.get(P) as string }, OTHER)).today, before.today);
});

void test('v0.3.0 的 parseLine 讀比較卡的行：每一行都是合法的作答，新欄位都忽略（不用 need）', async t => {
  const dir = await oldClone(t);
  const T = '2026-11-05T20:15:03.250+08:00';
  const lines = [
    encodeEntry(T, { lt: 'a', r: 'near', v: 'v1', pick: '塞', retry: 'right' }),
    encodeEntry(T, { lt: 'b', r: 'miss', v: 'v2', pick: null, with: T }),
    encodeEntry(T, { lt: 'c', r: 'near', v: 'v3', pick: 'lend', retry: 'right', also: [{ v: 'v4', r: 'good', pick: 'borrow' }], with: T }),
  ];
  const script = "import { parseLine } from './src/core/study/index.ts'; console.log(JSON.stringify(JSON.parse(process.argv[1]).map(line => parseLine(line))));";
  const read = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(lines)], { cwd: dir, env, encoding: 'utf8' })) as unknown[];
  const common = { kind: 'review', t: T, at: Date.parse(T), offset: 480, typed: null, src: null };
  assert.deepEqual(read, [{ ...common, lt: 'a', r: 'near', v: 'v1' }, { ...common, lt: 'b', r: 'miss', v: 'v2' }, { ...common, lt: 'c', r: 'near', v: 'v3' }]);
});
