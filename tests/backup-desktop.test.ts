import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { link, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { filesReader, openBackup, takeBackup } from '../src/core/backup/index.ts';
import type { Taken } from '../src/core/backup/index.ts';
import { checkFolder, listBackups, prepareFolder, readBackup, removeBackup, writeBackup } from '../src/desktop/backup.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import { goal, tempFolder } from './helpers/vault.ts';

// 外掛內的備份 §1-1、§1-8 第 1 列：寫進備份資料夾（外掛與過渡工具共用 src/desktop/backup.ts）。

const DECK = 'Essence Cards/國二上/自然/2-3 濃度.md';
// 2026-11-02 20:15:03.250 +08:00
const NOW = Date.UTC(2026, 10, 2, 12, 15, 3, 250);

async function taken(): Promise<Taken> {
  const memory = createMemoryFiles({ [DECK]: goal('abc123') });
  return takeBackup({
    reader: filesReader(memory.files, '.obsidian', () => Promise.resolve(null)),
    vault: { name: 'Essence', path: 'D:/Notes/Essence', config: '.obsidian' },
    build: '0.2.0+1a2b3c4', tool: '0.2.0+1a2b3c4', by: 'manual', now: () => NOW, offset: () => 480,
  });
}
const names = (...codes: string[]) => () => codes.shift() ?? 'ffff';

void test('提交不覆寫：別的程序在讀回檢查之後剛好用同一個名字提交了，那一份不動，這一份換隨機碼；不留暫存檔', async t => {
  const to = await tempFolder(t);
  const first = join(to, 'Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 aaaa.zip');
  let calls = 0;
  const path = await writeBackup(to, await taken(), {
    random: names('aaaa', 'bbbb'),
    link: async (from, target) => {
      // 第一次提交之前，另一個程序剛好寫好同名的正式檔。
      if (calls++ === 0) await writeFile(first, 'other');
      await link(from, target);
    },
  });
  assert.equal(path, join(to, 'Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 bbbb.zip'));
  assert.equal(await readFile(first, 'utf8'), 'other');
  assert.deepEqual((await readdir(to)).sort(), ['Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 aaaa.zip', 'Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 bbbb.zip']);
  assert.ok(openBackup(new Uint8Array(await readFile(path))).ok);
});

void test('提交不覆寫：檔案系統不支援硬連結（例如 exFAT 的外接硬碟）時改成獨占建立正式檔名，內容相同、不留暫存檔', async t => {
  const to = await tempFolder(t);
  const backup = await taken();
  const path = await writeBackup(to, backup, {
    random: names('cccc'),
    link: () => Promise.reject(Object.assign(Error('not supported'), { code: 'EISDIR' })),
  });
  assert.deepEqual(await readdir(to), ['Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 cccc.zip']);
  assert.deepEqual(new Uint8Array(await readFile(path)), backup.zip);
});

void test('提交不覆寫：暫存名已經有了（別的程序正在寫同一個名字）就換隨機碼，那個暫存檔不動', async t => {
  const to = await tempFolder(t);
  const busy = join(to, 'Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 dddd.zip.tmp');
  await writeFile(busy, 'writing');
  const path = await writeBackup(to, await taken(), { random: names('dddd', 'eeee') });
  assert.equal(path, join(to, 'Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 eeee.zip'));
  assert.equal(await readFile(busy, 'utf8'), 'writing');
});

// §1-1、§1-9 的「位置」：vault 裡、連到 vault 的連結、封裝 App 導走的都被拒，原因寫得出來；檢查不建任何資料夾。
void test('位置：vault 裡、連到 vault 的連結被拒，原因寫得出來，不建資料夾；vault 外照常', async t => {
  const vault = await tempFolder(t, 'essence-vault-');
  const outside = await tempFolder(t);
  const link = join(outside, '連到 vault');
  await symlink(vault, link, 'junction');
  for (const folder of [join(vault, '備份'), join(link, '備份', '子')]) {
    const { problem } = await checkFolder(folder, vault, '請換一個位置。');
    assert.match(problem ?? '', /在 vault 裡（以實際路徑判斷），不能放在 vault 裡/);
  }
  assert.deepEqual(await readdir(vault), []);
  const fine = await checkFolder(join(outside, '備份'), vault);
  assert.deepEqual(fine, { real: join(outside, '備份'), problem: null });
  assert.deepEqual(await readdir(outside), ['連到 vault']);
  await assert.rejects(prepareFolder(join(link, '備份'), vault), /在 vault 裡/);
  assert.equal(await prepareFolder(join(outside, '備份'), vault), join(outside, '備份'));
});

void test('位置：實際路徑落在封裝 App 的私有資料夾時被拒，說明怎麼換（外掛的說法）', async t => {
  const vault = await tempFolder(t, 'essence-vault-');
  const root = await tempFolder(t);
  const cache = join(root, 'AppData', 'Local', 'Packages', 'SyntheticApp', 'LocalCache');
  await mkdir(cache, { recursive: true });
  const { problem } = await checkFolder(join(cache, '備份'), vault, '請換一個位置（不能在 vault 裡，也不要選雲端同步的資料夾）。');
  assert.match(problem ?? '', /實際在 .*LocalCache.*解除安裝那個 App 時會一起刪掉。請換一個位置/);
});

void test('列出備份：只列直接底下、整份讀得懂的 .zip；壞掉的、暫存檔、子資料夾、大寫的 .ZIP 不列，壞掉的寫出原因', async t => {
  const to = await tempFolder(t);
  const good = await writeBackup(to, await taken(), { random: names('aaaa') });
  await writeFile(join(to, 'Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 bbbb.zip'), 'broken');
  await writeFile(join(to, 'Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 cccc.zip.tmp'), await readFile(good));
  await writeFile(join(to, 'Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 dddd.ZIP'), await readFile(good));
  await mkdir(join(to, '子'));
  await writeFile(join(to, '子', 'Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 eeee.zip'), await readFile(good));
  const { backups, skipped } = await listBackups(to);
  assert.deepEqual(backups.map(backup => backup.name), ['Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 aaaa.zip']);
  assert.equal(backups[0].manifest.by, 'manual');
  assert.deepEqual(skipped.map(item => item.name), ['Essence Cards 備份 2026-11-02 201503 0.2.0+1a2b3c4 bbbb.zip']);
  assert.match(skipped[0].reason, /zip/);
  assert.deepEqual(await readBackup(to, backups[0].name), new Uint8Array(await readFile(good)));
  assert.deepEqual(await listBackups(join(to, '沒有')), { backups: [], skipped: [] });
});

void test('刪舊備份：內容和剛才驗過的不同、資料夾的實際位置換了都不刪；對得上才刪', async t => {
  const to = await tempFolder(t);
  const path = await writeBackup(to, await taken(), { random: names('aaaa') });
  const [listed] = (await listBackups(to)).backups;
  await assert.rejects(removeBackup(to, to, { ...listed, sha256: '0'.repeat(64) }), /和剛才驗過的不同，不刪/);
  await assert.rejects(removeBackup(to, join(to, '別處'), listed), /實際位置換了/);
  assert.deepEqual(await readdir(to), [listed.name]);
  await removeBackup(to, to, listed);
  assert.deepEqual(await readdir(to), []);
  assert.ok(path.endsWith(listed.name));
});

void test('位置：所在的磁碟找不到（例如外接硬碟的磁碟代號不存在）時寫出是哪個位置，不露出 realpath 的原始訊息', { skip: process.platform !== 'win32' }, async t => {
  const vault = await tempFolder(t, 'essence-vault-');
  const letter = [...'QRSTUVWXYZ'].find(drive => !existsSync(drive + ':\\'));
  if (!letter) { t.skip('沒有空著的磁碟代號'); return; }
  const folder = letter + ':\\Essence 備份';
  await assert.rejects(checkFolder(folder, vault), (error: Error) => error.message === `備份位置 ${folder} 所在的磁碟找不到（ENOENT）`);
  await assert.rejects(prepareFolder(folder, vault), /所在的磁碟找不到/);
});
