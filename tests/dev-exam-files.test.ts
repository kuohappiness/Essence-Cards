import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { clearTrial, makeTrial, newTrial, noteFolder } from '../src/obsidian/dev-exam-files.ts';

// 開發命令只清有建立證據的檔（Codex L2 的 R1）：共用的測試 vault 裡別人的檔，拒跑、建到一半失敗、清理時都不能少。

interface Disk { app: App; files: Map<string, string>; folders: Set<string>; refuse: Set<string> }
function disk(files: Record<string, string> = {}, folders: string[] = []): Disk {
  const map = new Map(Object.entries(files)), dirs = new Set(folders), refuse = new Set<string>();
  const inside = (folder: string): string[] => [...map.keys(), ...dirs].filter(path => path.startsWith(folder + '/'));
  const vault = {
    adapter: {
      exists: (path: string) => Promise.resolve(map.has(path) || dirs.has(path)),
      rmdir(path: string) {
        if (inside(path).length) return Promise.reject(Error('資料夾不是空的'));
        dirs.delete(path);
        return Promise.resolve();
      },
    },
    createFolder(path: string) { dirs.add(path); return Promise.resolve(); },
    create(path: string, text: string) {
      if (refuse.has(path)) return Promise.reject(Error('建不起來：' + path));
      map.set(path, text);
      return Promise.resolve();
    },
    getFileByPath: (path: string) => map.has(path) ? { path } : null,
    getFolderByPath: (path: string) => dirs.has(path) ? { path, children: inside(path) } : null,
    delete(entry: { path: string }) { map.delete(entry.path); dirs.delete(entry.path); return Promise.resolve(); },
  };
  return { app: { vault } as unknown as App, files: map, folders: dirs, refuse };
}

const WANTED = { 'T/甲.md': '甲', 'T/乙.md': '乙', 'T/丙.md': '丙' };

void test('清理只刪這次建的：別的分支或同步途中放進來的檔留著，資料夾也跟著留、回報出來', async () => {
  const d = disk();
  const trial = newTrial();
  await makeTrial(d.app, trial, 'T', WANTED);
  d.files.set('T/別人的.md', '別人的');
  assert.deepEqual(await clearTrial(d.app, trial, 0), ['T']);
  assert.deepEqual([...d.files.keys()], ['T/別人的.md']);
});

void test('沒有建立證據就什麼都不動：拒跑之後的範圍檔與測試資料夾都在', async () => {
  const d = disk({ '範圍/舊.md': '舊', 'T/甲.md': '甲' }, ['範圍', 'T']);
  assert.equal(await clearTrial(d.app, newTrial(), 0), true);
  assert.deepEqual([...d.files.keys()], ['範圍/舊.md', 'T/甲.md']);
  assert.deepEqual([...d.folders], ['範圍', 'T']);
});

void test('已經有的檔不覆寫、不記；建到一半失敗，清掉的只有建好的那幾個', async () => {
  const d = disk({ 'T/乙.md': '別人的乙' }, ['T']);
  const trial = newTrial();
  await assert.rejects(makeTrial(d.app, trial, 'T', WANTED), /已經有這個檔/);
  assert.deepEqual(trial, { files: ['T/甲.md'], folders: [] }, 'T 原本就在，不算這次建的');
  assert.equal(await clearTrial(d.app, trial, 0), true);
  assert.equal(d.files.get('T/乙.md'), '別人的乙');
  assert.deepEqual([...d.folders], ['T']);

  const half = disk();
  half.refuse.add('T/乙.md');
  const partial = newTrial();
  await assert.rejects(makeTrial(half.app, partial, 'T', WANTED), /建不起來/);
  assert.equal(await clearTrial(half.app, partial, 0), true);
  assert.deepEqual([...half.files.keys()], []);
  assert.deepEqual([...half.folders], [], '這次建的資料夾空了就刪');
});

void test('分段跑：證據寫成 JSON 再讀回來，一樣只清記著的', async () => {
  const d = disk();
  const trial = newTrial();
  await makeTrial(d.app, trial, 'T', { 'T/甲.md': '甲' });
  assert.equal(await noteFolder(d.app, trial, '範圍'), true);
  d.folders.add('範圍');
  d.files.set('範圍/這次的.md', '這次的');
  trial.files.push('範圍/這次的.md');
  d.files.set('範圍/同步來的.md', '同步來的');
  assert.deepEqual(await clearTrial(d.app, JSON.parse(JSON.stringify(trial)) as typeof trial, 0), ['範圍']);
  assert.deepEqual([...d.files.keys()], ['範圍/同步來的.md']);
  assert.equal(await noteFolder(d.app, newTrial(), '範圍'), false, '已經在的不算這次建的');
});
