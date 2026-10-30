import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWritten, filesReader, hashBytes, openBackup, takeBackup, writeZip } from '../src/core/backup/index.ts';
import type { BackupReader, TakeOptions } from '../src/core/backup/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import type { MemoryFiles } from './helpers/memory-files.ts';
import { goal, review } from './helpers/vault.ts';

// 外掛內的備份 §1-9：外掛那條路（Files 與設定資料夾的 adapter）跑和 tools/backup.ts 相同的情境（tests/backup.test.ts）。

const LOG = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
const DECK = 'Essence Cards/國二上/自然/2-3 濃度.md';
const DATA = '.obsidian/plugins/essence-cards/data.json';
// 2026-11-02 20:15:03.250 +08:00
const NOW = Date.UTC(2026, 10, 2, 12, 15, 3, 250);
const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

function options(memory: MemoryFiles, extra: Partial<TakeOptions> = {}, data: string | null = null): TakeOptions {
  return {
    reader: filesReader(memory.files, '.obsidian', () => Promise.resolve(data === null ? null : new TextEncoder().encode(data))),
    vault: { name: 'Essence', path: 'D:/Notes/Essence', config: '.obsidian' },
    build: '0.2.0+1a2b3c4', tool: '0.2.0+1a2b3c4', by: 'manual',
    now: () => NOW, offset: () => 480, ...extra,
  };
}

void test('外掛的備份：清單照 syntax §8，只列 Essence Cards/ 底下；data.json 由 adapter 讀，沒有時記在 absent', async () => {
  const memory = createMemoryFiles({ [DECK]: goal('abc123'), [LOG]: review('2026-10-16T20:15:03.250+08:00', 'abc123') + '\n', '其他筆記/不備份.md': 'x' });
  const taken = await takeBackup(options(memory));
  assert.deepEqual(taken.manifest.files.map(file => file.path), [DECK, LOG]);
  assert.deepEqual(taken.manifest.absent, [DATA]);
  assert.deepEqual([taken.manifest.build, taken.manifest.tool, taken.manifest.by, taken.manifest.started, taken.manifest.vault],
    ['0.2.0+1a2b3c4', '0.2.0+1a2b3c4', 'manual', '2026-11-02T20:15:03.250+08:00', { name: 'Essence', path: 'D:/Notes/Essence', config: '.obsidian' }]);
  assert.equal(checkWritten(taken.zip, taken), null);
  const withData = await takeBackup(options(memory, {}, '{"a":1}'));
  assert.deepEqual(withData.manifest.absent, []);
  const opened = openBackup(withData.zip);
  assert.ok(opened.ok);
  assert.equal(text(opened.value.files.get(DATA)), '{"a":1}');
});

void test('外掛的備份：同長度改字抓得到，整份重來，備份的是新的', async () => {
  const memory = createMemoryFiles({ [DECK]: goal('abc123', 'A') });
  const taken = await takeBackup(options(memory, { afterRead: attempt => { if (attempt === 1) memory.write(DECK, goal('abc123', 'B')); } }));
  assert.equal(taken.attempts, 2);
  assert.equal(text(taken.files.get(DECK)), goal('abc123', 'B'));
});

void test('外掛的備份：中途多一個檔或少一個檔就重來；一直在變時失敗', async () => {
  const memory = createMemoryFiles({ [DECK]: goal('abc123'), 'Essence Cards/舊.md': goal('old111') });
  const added = await takeBackup(options(memory, { afterRead: attempt => { if (attempt === 1) memory.write('Essence Cards/新.md', goal('new111')); } }));
  assert.equal(added.attempts, 2);
  assert.ok(added.files.has('Essence Cards/新.md'));
  const removed = await takeBackup(options(memory, { afterRead: attempt => { if (attempt === 1) memory.remove('Essence Cards/舊.md'); } }));
  assert.equal(removed.attempts, 2);
  assert.ok(!removed.files.has('Essence Cards/舊.md'));
  await assert.rejects(takeBackup(options(memory, { afterRead: attempt => { memory.write(DECK, goal('abc123', '第 ' + attempt + ' 次')); } })),
    /檔案一直在變，試了 3 次.*2-3 濃度\.md 在備份的時候改了/);
});

void test('外掛的備份：列出來的檔讀的時候不見了算檔案在變，重來', async () => {
  const memory = createMemoryFiles({ [DECK]: goal('abc123'), 'Essence Cards/暫時.md': goal('tmp111') });
  const inner = filesReader(memory.files, '.obsidian', () => Promise.resolve(null));
  let gone = false;
  const reader: BackupReader = {
    list: () => inner.list(),
    read: async path => {
      if (path === 'Essence Cards/暫時.md' && !gone) { gone = true; memory.remove(path); }
      return inner.read(path);
    },
  };
  const taken = await takeBackup({ ...options(memory), reader });
  assert.equal(taken.attempts, 2);
  assert.ok(!taken.files.has('Essence Cards/暫時.md'));
});

void test('外掛的備份：紀錄中途多一行可以通過，用的是舊的內容', async () => {
  const first = review('2026-10-16T20:15:03.250+08:00', 'abc123');
  const memory = createMemoryFiles({ [DECK]: goal('abc123'), [LOG]: first + '\n' });
  const taken = await takeBackup(options(memory, { afterRead: attempt => { if (attempt === 1) memory.append(LOG, review('2026-10-16T20:16:00.000+08:00', 'abc123')); } }));
  assert.equal(taken.attempts, 1);
  assert.equal(text(taken.files.get(LOG)), first + '\n');
});

void test('外掛的備份：讀不到的檔讓整份失敗，錯誤寫出是哪個檔與原本的錯誤（D-154）', async () => {
  const memory = createMemoryFiles({ [DECK]: goal('abc123'), 'Essence Cards/鎖住.md': goal('def456') });
  memory.failing.add('Essence Cards/鎖住.md');
  await assert.rejects(takeBackup(options(memory)), /^Error: 讀不到 Essence Cards\/鎖住\.md（讀不到：Essence Cards\/鎖住\.md）$/);
  const data = filesReader(memory.files, '.obsidian', () => Promise.reject(Error('EBUSY')));
  await assert.rejects(data.read(DATA), /^Error: 讀不到 \.obsidian\/plugins\/essence-cards\/data\.json（EBUSY）$/);
});

void test('外掛的備份：原本就有語法問題的卡組照樣備份並記在 notes', async () => {
  const broken = '- 能說明 abc123 ^abc123\n    - 沒有答案的題目 ::\n';
  const memory = createMemoryFiles({ [DECK]: broken });
  const taken = await takeBackup(options(memory));
  assert.equal(text(taken.files.get(DECK)), broken);
  assert.deepEqual(taken.manifest.notes.map(note => note.path), [DECK]);
  assert.match(taken.manifest.notes[0].message, /^原本就有語法問題，照原樣備份/);
});

void test('讀回檢查：寫壞（截短）、清單不同、內容不同都抓得到', async () => {
  const memory = createMemoryFiles({ [DECK]: goal('abc123') });
  const taken = await takeBackup(options(memory));
  assert.match(checkWritten(taken.zip.subarray(0, taken.zip.length - 10), taken) ?? '', /^寫好的備份讀回來不對/);
  const other = { ...taken.manifest, by: 'monthly' };
  assert.equal(checkWritten(writeZip(other, taken.files, new Date(NOW)), taken), '寫好的備份讀回來的清單不同');
  // 清單相同、zip 裡的卡組同長度改字：openBackup 先因雜湊不符擋下（清單與內容一一對應）。
  const swapped = new Map([[DECK, new TextEncoder().encode(goal('abc123', '答案 abc124'))]]);
  assert.match(checkWritten(writeZip(taken.manifest, swapped, new Date(NOW)), taken) ?? '', /雜湊和清單不同/);
  assert.equal(hashBytes(taken.zip), hashBytes(writeZip(taken.manifest, taken.files, new Date(taken.started))));
});
