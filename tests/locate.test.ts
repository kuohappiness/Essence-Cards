import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from '../src/core/backup/index.ts';
import { buildPlugin } from '../tools/build.mjs';
import { locate } from '../tools/locate.ts';

// tasks/error-log.md §6（D-155 第 5 點）：錯誤紀錄的程式位置用保存的對照表對回原始碼；雜湊對不上就停。
const root = fileURLToPath(new URL('../', import.meta.url));

/** 暫存的本機紀錄：一份真的正式建置（含對照表）存成 releases/9.9.9/。 */
async function release(t: TestContext): Promise<{ local: string; folder: string; code: string }> {
  const local = await mkdtemp(join(tmpdir(), 'essence-locate-'));
  t.after(() => rm(local, { recursive: true, force: true }));
  const folder = join(local, 'releases', '9.9.9');
  await buildPlugin({ root, outdir: folder, sourcemap: join(folder, 'main.js.map') });
  const hash = async (name: string): Promise<string> => hashBytes(new Uint8Array(await readFile(join(folder, name))));
  const sha256 = { 'main.js': await hash('main.js'), 'styles.css': await hash('styles.css'), 'main.js.map': await hash('main.js.map') };
  await writeFile(join(folder, 'release.json'), JSON.stringify({ version: '9.9.9', build: '9.9.9+abc1234', commit: 'abc1234', created: '', sha256 }));
  return { local, folder, code: await readFile(join(folder, 'main.js'), 'utf8') };
}

/** 產物裡第一次出現 text 的位置，寫成 stack 的 1 起算「行:欄」。 */
function position(code: string, text: string): string {
  const at = code.indexOf(text);
  assert.ok(at >= 0, text);
  const before = code.slice(0, at).split('\n');
  return `${String(before.length)}:${String(before.at(-1)!.length + 1)}`;
}

void test('§6 locate：stack 的行:欄（1 起算）對回原始檔與行；stack 的整個 frame 也認得', async t => {
  const { local, code } = await release(t);
  // 預期值的來源：原始碼裡那一行（獨立於對照表）。
  const source = (await readFile(join(root, 'src/core/errors/log.ts'), 'utf8')).split(/\r?\n/);
  const line = source.findIndex(text => text.includes(`'"where":"limit"'`)) + 1;
  assert.ok(line > 0);
  const at = position(code, '"where":"limit"');
  const [found] = await locate('9.9.9', [at], local);
  assert.equal(found.source, 'src/core/errors/log.ts');
  assert.equal(found.line, line);
  assert.ok(found.text.includes('"where":"limit"'), found.text);
  const [frame] = await locate('9.9.9', [`at Xe (plugin:essence-cards:${at})`], local);
  assert.deepEqual(frame, { ...found, position: `at Xe (plugin:essence-cards:${at})` });
});

void test('§6 locate：main.js 或對照表的雜湊和 release.json 不同、沒有保存對照表、位置寫法不對都停下來', async t => {
  const { local, folder } = await release(t);
  await assert.rejects(locate('9.9.9', ['abc'], local), /位置/);
  await assert.rejects(locate('9.9.9', ['0:1'], local), /位置/);
  // Codex L2 的 R4：超出 main.js 的行數或那一行的長度，不沿用前一個對應，直接停。
  await assert.rejects(locate('9.9.9', ['999999:1'], local), /超出 main\.js/);
  await assert.rejects(locate('9.9.9', ['2:999999999'], local), /超出 main\.js/);
  await assert.rejects(locate('1.2.3', ['1:1'], local), /沒有 1\.2\.3 的正式產物/);
  const saved = JSON.parse(await readFile(join(folder, 'release.json'), 'utf8')) as { sha256: Record<string, string> };
  const { 'main.js.map': _map, ...withoutMap } = saved.sha256;
  await writeFile(join(folder, 'release.json'), JSON.stringify({ ...saved, sha256: withoutMap }));
  await assert.rejects(locate('9.9.9', ['1:1'], local), /沒有保存對照表/);
  await writeFile(join(folder, 'release.json'), JSON.stringify(saved));
  await writeFile(join(folder, 'main.js.map'), '{}');
  await assert.rejects(locate('9.9.9', ['1:1'], local), /main\.js\.map 和 release\.json 記的雜湊不同/);
  await writeFile(join(folder, 'main.js'), 'tampered');
  await assert.rejects(locate('9.9.9', ['1:1'], local), /main\.js 和 release\.json 記的雜湊不同/);
});
