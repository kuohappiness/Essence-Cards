import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnv } from '../tools/git.ts';
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
async function oldVersion(t: TestContext, vault: Record<string, string>, path: string): Promise<OldRun> {
  const dir = await tempFolder(t, 'essence-v030-');
  git(root, 'clone', '-q', '--no-checkout', root, dir);
  git(dir, 'checkout', '-q', 'v0.3.0');
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
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

void test('v0.3.0 讀沒有標記、目標沒有 ID 的比較卡組：也不出題（ID 和標記是同一次寫入）', async t => {
  const old = await oldVersion(t, { [P]: CARD, [OTHER]: PLAIN }, OTHER);
  assert.deepEqual(old.today, ['bbb222']);
  assert.deepEqual(old.blocked.decks, []);
});
