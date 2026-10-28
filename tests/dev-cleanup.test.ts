import test from 'node:test';
import assert from 'node:assert/strict';
import { removePaths, type CleanupIo } from '../src/dev/cleanup.ts';

// 開發命令的清理（Codex L2 再審的 S1）：Obsidian 的快取與磁碟分開模擬；restore 是「等的時候 iCloud 把檔放回磁碟」。
function vault(initial: { cache: string[]; disk: string[] }, restore: (disk: Set<string>, round: number) => void = () => {}) {
  const cache = new Set(initial.cache), disk = new Set(initial.disk);
  const log: string[] = [];
  let waits = 0;
  const io: CleanupIo = {
    cached: path => cache.has(path),
    exists: path => Promise.resolve(disk.has(path)),
    remove: (path, cached) => { log.push((cached ? '經 Obsidian 刪 ' : '直接刪磁碟 ') + path); cache.delete(path); disk.delete(path); return Promise.resolve(); },
    wait: () => { restore(disk, waits++); return Promise.resolve(); },
  };
  return { io, log, waits: () => waits };
}

void test('快取沒有、磁碟上有（Obsidian 還沒發現放回來的檔）：直接刪磁碟，等過一次再確認', async () => {
  const v = vault({ cache: [], disk: ['測試'] });
  assert.deepEqual(await removePaths(v.io, ['測試']), []);
  assert.deepEqual(v.log, ['直接刪磁碟 測試']);
  assert.equal(v.waits(), 1);
});

void test('刪完在等的時候磁碟又出現（快取還是沒有）：再刪一次；一直放回來就在最後回報', async () => {
  const once = vault({ cache: ['測試'], disk: ['測試'] }, (disk, round) => { if (round === 0) disk.add('測試'); });
  assert.deepEqual(await removePaths(once.io, ['測試']), []);
  assert.deepEqual(once.log, ['經 Obsidian 刪 測試', '直接刪磁碟 測試']);
  const always = vault({ cache: ['測試'], disk: ['測試'] }, disk => { disk.add('測試'); });
  assert.deepEqual(await removePaths(always.io, ['測試']), ['測試']);
  assert.equal(always.log.length, 3, '最多三輪');
});

void test('一開始兩邊都沒有：不等就回報乾淨；只刪指定的路徑', async () => {
  const empty = vault({ cache: [], disk: [] });
  assert.deepEqual(await removePaths(empty.io, ['測試']), []);
  assert.equal(empty.waits(), 0);
  const other = vault({ cache: ['測試', '別的卡組'], disk: ['測試', '別的卡組'] });
  assert.deepEqual(await removePaths(other.io, ['測試']), []);
  assert.deepEqual(other.log, ['經 Obsidian 刪 測試']);
});
