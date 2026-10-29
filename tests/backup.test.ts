import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat, symlink, unlink, utimes, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openBackup } from '../src/core/backup/index.ts';
import { backupVault } from '../tools/backup.ts';
import { virtualizedReason } from '../tools/vault-io.ts';
import { goal, makeVault, put, review, tempFolder } from './helpers/vault.ts';

const LOG = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
const DECK = 'Essence Cards/國二上/自然/2-3 濃度.md';
// 2026-11-02 20:15:03.250 +08:00
const NOW = Date.UTC(2026, 10, 2, 12, 15, 3, 250);
const fixed = { now: () => NOW, offset: () => 480 };

async function open(path: string) {
  const opened = openBackup(new Uint8Array(await readFile(path)));
  assert.ok(opened.ok, opened.ok ? '' : opened.error);
  return opened.value;
}
const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

void test('備份：檔名、清單與內容照 syntax §8，讀回來的雜湊相同；沒有 data.json 記在 absent', async t => {
  const line = review('2026-10-16T20:15:03.250+08:00', 'abc123');
  const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 13, 10]);
  const vault = await makeVault(t, { [DECK]: goal('abc123'), [LOG]: line + '\n', 'Essence Cards/附件/圖.png': image, '其他筆記/不備份.md': 'x' });
  await put(vault, '.obsidian/plugins/essence-cards/main.js', '/*! Essence Cards build=0.1.0+1a2b3c4 dev=false */\n"use strict";');
  const to = await tempFolder(t);
  const result = await backupVault({ vault, to, by: 'backup', ...fixed, random: () => 'a3f9' });
  assert.equal(result.path, join(to, 'Essence Cards 備份 2026-11-02 201503 0.1.0+1a2b3c4 a3f9.zip'));
  assert.deepEqual(await readdir(to), ['Essence Cards 備份 2026-11-02 201503 0.1.0+1a2b3c4 a3f9.zip']);
  const { manifest, files } = await open(result.path);
  assert.deepEqual(manifest.files.map(file => file.path), ['Essence Cards/國二上/自然/2-3 濃度.md', 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl', 'Essence Cards/附件/圖.png']);
  assert.deepEqual(manifest.absent, ['.obsidian/plugins/essence-cards/data.json']);
  assert.deepEqual([manifest.format, manifest.version, manifest.build, manifest.by, manifest.started, manifest.vault.config, manifest.excluded, manifest.notes],
    ['essence-cards-backup', 1, '0.1.0+1a2b3c4', 'backup', '2026-11-02T20:15:03.250+08:00', '.obsidian', [], []]);
  assert.match(manifest.tool, /^0\.0\.1\+[0-9a-f]{7,}(\.dirty)?$/);
  assert.equal(manifest.vault.name, 'Vault');
  assert.deepEqual(files.get('Essence Cards/附件/圖.png'), image);
  assert.equal(text(files.get(LOG)), line + '\n');
});

void test('備份：同長度改字並保留修改時間（Q :: A → Q :: B）也抓得到，整份重來，備份的是新的', async t => {
  const vault = await makeVault(t, { [DECK]: goal('abc123', 'A') });
  const file = join(vault, DECK);
  const before = await stat(file);
  const result = await backupVault({ vault, to: await tempFolder(t), by: 'backup', ...fixed, seams: {
    afterRead: async attempt => {
      if (attempt !== 1) return;
      await writeFile(file, goal('abc123', 'B'));
      await utimes(file, before.atime, before.mtime);
    },
  } });
  assert.equal(result.attempts, 2);
  assert.equal(text((await open(result.path)).files.get(DECK)), goal('abc123', 'B'));
});

void test('備份：中途多一個檔或少一個檔就重來；一直在變時失敗，不留下任何檔', async t => {
  const vault = await makeVault(t, { [DECK]: goal('abc123'), 'Essence Cards/舊.md': goal('old111') });
  const added = await backupVault({ vault, to: await tempFolder(t), by: 'backup', ...fixed, seams: {
    afterRead: async attempt => { if (attempt === 1) await put(vault, 'Essence Cards/新.md', goal('new111')); },
  } });
  assert.equal(added.attempts, 2);
  assert.ok((await open(added.path)).files.has('Essence Cards/新.md'));
  const removed = await backupVault({ vault, to: await tempFolder(t), by: 'backup', ...fixed, seams: {
    afterRead: async attempt => { if (attempt === 1) await unlink(join(vault, 'Essence Cards/舊.md')); },
  } });
  assert.equal(removed.attempts, 2);
  assert.ok(!(await open(removed.path)).files.has('Essence Cards/舊.md'));
  const to = await tempFolder(t);
  await assert.rejects(backupVault({ vault, to, by: 'backup', ...fixed, seams: {
    afterRead: async attempt => { await put(vault, DECK, goal('abc123', '第 ' + attempt + ' 次')); },
  } }), /檔案一直在變，試了 3 次.*2-3 濃度\.md 在備份的時候改了/);
  assert.deepEqual(await readdir(to), []);
});

void test('備份：紀錄中途多一行可以通過，用的是舊的內容', async t => {
  const first = review('2026-10-16T20:15:03.250+08:00', 'abc123');
  const vault = await makeVault(t, { [DECK]: goal('abc123'), [LOG]: first + '\n' });
  const result = await backupVault({ vault, to: await tempFolder(t), by: 'backup', ...fixed, seams: {
    afterRead: async attempt => { if (attempt === 1) await appendFile(join(vault, LOG), review('2026-10-16T20:16:00.000+08:00', 'abc123') + '\n'); },
  } });
  assert.equal(result.attempts, 1);
  assert.equal(text((await open(result.path)).files.get(LOG)), first + '\n');
});

void test('備份：讀不到的檔案讓整份失敗並寫出原因，沒有留下正式檔名或暫存檔', async t => {
  const vault = await makeVault(t, { [DECK]: goal('abc123'), 'Essence Cards/鎖住.md': goal('def456') });
  const to = await tempFolder(t);
  const read = async (path: string): Promise<Uint8Array> => {
    if (path.endsWith('鎖住.md')) throw Object.assign(Error('denied'), { code: 'EACCES' });
    return new Uint8Array(await readFile(path));
  };
  await assert.rejects(backupVault({ vault, to, by: 'backup', ...fixed, seams: { read } }), /Essence Cards\/鎖住\.md：沒有讀取權限（EACCES）/);
  assert.deepEqual(await readdir(to), []);
});

void test('備份：zip 寫壞或寫不進去時失敗，暫存檔刪掉、沒有正式檔名', async t => {
  const vault = await makeVault(t, { [DECK]: goal('abc123') });
  const broken = await tempFolder(t);
  await assert.rejects(backupVault({ vault, to: broken, by: 'backup', ...fixed, seams: {
    write: (path, bytes) => writeFile(path, bytes.subarray(0, bytes.length - 10)),
  } }), /讀回來不對/);
  assert.deepEqual(await readdir(broken), []);
  const full = await tempFolder(t);
  await assert.rejects(backupVault({ vault, to: full, by: 'backup', ...fixed, seams: {
    write: async path => { await writeFile(path, 'x'); throw Object.assign(Error('no space'), { code: 'ENOSPC' }); },
  } }), /no space/);
  assert.deepEqual(await readdir(full), []);
});

void test('備份：原本就有語法問題的卡組照樣備份並記在 notes，不算失敗', async t => {
  const broken = '- 能說明 abc123 ^abc123\n    - 沒有答案的題目 ::\n';
  const vault = await makeVault(t, { [DECK]: broken });
  const result = await backupVault({ vault, to: await tempFolder(t), by: 'backup', ...fixed });
  const { manifest, files } = await open(result.path);
  assert.equal(text(files.get(DECK)), broken);
  assert.deepEqual(manifest.notes.map(note => note.path), [DECK]);
  assert.match(manifest.notes[0].message, /^原本就有語法問題，照原樣備份/);
});

void test('備份：檔名撞到已有的檔就換隨機碼，不覆寫', async t => {
  const vault = await makeVault(t, { [DECK]: goal('abc123') });
  const to = await tempFolder(t);
  const taken = join(to, 'Essence Cards 備份 2026-11-02 201503 未知 aaaa.zip');
  await writeFile(taken, 'old');
  const codes = ['aaaa', 'bbbb'];
  const result = await backupVault({ vault, to, by: 'backup', ...fixed, random: () => codes.shift() ?? 'cccc' });
  assert.equal(result.path, join(to, 'Essence Cards 備份 2026-11-02 201503 未知 bbbb.zip'));
  assert.equal(await readFile(taken, 'utf8'), 'old');
});

void test('備份：--to 在 vault 裡（含連到 vault 的 junction 或符號連結）被拒絕', async t => {
  const vault = await makeVault(t, { [DECK]: goal('abc123') });
  await assert.rejects(backupVault({ vault, to: join(vault, '備份'), by: 'backup', ...fixed }), /在 vault 裡/);
  const outside = await tempFolder(t);
  const link = join(outside, '連到 vault');
  await symlink(vault, link, 'junction');
  await assert.rejects(backupVault({ vault, to: join(link, '備份'), by: 'backup', ...fixed }), /在 vault 裡/);
  assert.deepEqual(await readdir(vault), ['.obsidian', 'Essence Cards']);
});

void test('備份：設定資料夾照 --config；沒有外掛資料夾時整份失敗，不把 data.json 記成不存在', async t => {
  const vault = await makeVault(t, { [DECK]: goal('abc123'), '.obsidian-family/plugins/essence-cards/data.json': '{"a":1}' }, { config: '.obsidian-family' });
  const result = await backupVault({ vault, to: await tempFolder(t), config: '.obsidian-family', by: 'backup', ...fixed });
  const { manifest, files } = await open(result.path);
  assert.equal(manifest.vault.config, '.obsidian-family');
  assert.deepEqual(manifest.absent, []);
  assert.equal(text(files.get('.obsidian-family/plugins/essence-cards/data.json')), '{"a":1}');
  await assert.rejects(backupVault({ vault, to: await tempFolder(t), by: 'backup', ...fixed }), /\.obsidian\/plugins\/essence-cards\/manifest\.json 不存在/);
});

void test('備份位置的實際路徑落在封裝 App 的私有資料夾（MSIX 把 %LOCALAPPDATA% 導過去）時拒絕，要用 --to 指定別處（使用者 2026-10-29）', () => {
  assert.match(virtualizedReason('預設位置', String.raw`C:\Users\kuo\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Essence Cards\備份\V`) ?? '',
    /實際在 .*Packages.*解除安裝那個 App 時會一起刪掉。用 --to 指定 App 以外的資料夾/);
  assert.notEqual(virtualizedReason('x', String.raw`C:\Users\kuo\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache`), null);
  assert.equal(virtualizedReason('x', String.raw`C:\Users\kuo\AppData\Local\Essence Cards\備份\V`), null);
  // %TEMP% 不會被導走（2026-10-29 實測），測試的暫存資料夾照常。
  assert.equal(virtualizedReason('x', String.raw`C:\Users\kuo\AppData\Local\Temp\essence-abc`), null);
  assert.equal(virtualizedReason('x', '/home/kuo/.local/share/Essence Cards/備份/V'), null);
});
