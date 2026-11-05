import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { clearTrial, makeTrial, newTrial, noteFolder, noteScope, provenScopePath, scopeFiles } from '../src/obsidian/dev-exam-files.ts';

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
    getFiles: () => [...map.keys()].map(path => ({ path })),
    read(file: { path: string }) {
      return refuse.has(file.path) ? Promise.reject(Error('讀不到：' + file.path)) : Promise.resolve(map.get(file.path) ?? '');
    },
    getFolderByPath: (path: string) => dirs.has(path) ? { path, children: inside(path) } : null,
    delete(entry: { path: string }) { map.delete(entry.path); dirs.delete(entry.path); return Promise.resolve(); },
  };
  return { app: { vault } as unknown as App, files: map, folders: dirs, refuse };
}

const MARK = '試跑: abc';
const WANTED = { 'T/甲.md': MARK + ' 甲', 'T/乙.md': MARK + ' 乙', 'T/丙.md': MARK + ' 丙' };

void test('清理只刪這次建的：別的分支或同步途中放進來的檔留著，資料夾也跟著留、回報出來', async () => {
  const d = disk();
  const trial = newTrial();
  await makeTrial(d.app, trial, 'T', WANTED, MARK);
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
  await assert.rejects(makeTrial(d.app, trial, 'T', WANTED, MARK), /已經有這個檔/);
  assert.deepEqual(trial, { files: [{ path: 'T/甲.md', mark: MARK }], folders: [] }, 'T 原本就在，不算這次建的');
  assert.equal(await clearTrial(d.app, trial, 0), true);
  assert.equal(d.files.get('T/乙.md'), '別人的乙');
  assert.deepEqual([...d.folders], ['T']);

  const half = disk();
  half.refuse.add('T/乙.md');
  const partial = newTrial();
  await assert.rejects(makeTrial(half.app, partial, 'T', WANTED, MARK), /建不起來/);
  assert.equal(await clearTrial(half.app, partial, 0), true);
  assert.deepEqual([...half.files.keys()], []);
  assert.deepEqual([...half.folders], [], '這次建的資料夾空了就刪');
});

void test('分段跑：證據寫成 JSON 再讀回來，一樣只清記著的', async () => {
  const d = disk();
  const trial = newTrial();
  await makeTrial(d.app, trial, 'T', { 'T/甲.md': MARK }, MARK);
  assert.equal(await noteFolder(d.app, trial, '範圍'), true);
  d.folders.add('範圍');
  d.files.set('範圍/這次的.md', '識別碼: zzzzzz');
  trial.files.push({ path: '範圍/這次的.md', mark: '識別碼: zzzzzz' });
  d.files.set('範圍/同步來的.md', '同步來的');
  assert.deepEqual(await clearTrial(d.app, JSON.parse(JSON.stringify(trial)) as typeof trial, 0), ['範圍']);
  assert.deepEqual([...d.files.keys()], ['範圍/同步來的.md']);
  assert.equal(await noteFolder(d.app, newTrial(), '範圍'), false, '已經在的不算這次建的');
});

void test('記下這次存的範圍檔：認這次才有的科目；別次試跑同步進來的不記，清理也不會刪（R19）', async () => {
  const other = '---\n識別碼: other2\n---\n- 高三下 考試測試zzz 1-1\n';
  const mine = '---\n識別碼: mine22\n---\n- 高三下 考試測試abc 1-1\n';
  const d = disk({ '範圍/別次的.md': other, '範圍/這次的.md': mine, 'T/卡組.md': '科目: 考試測試abc' });
  const trial = newTrial();
  const file = await noteScope(d.app, trial, '範圍', '考試測試abc');
  assert.equal(file.path, '範圍/這次的.md');
  assert.deepEqual(trial.files, [{ path: '範圍/這次的.md', mark: '識別碼: mine22' }]);
  d.files.set('範圍/這次的.md', mine + '- 流程改過\n');
  assert.equal(await clearTrial(d.app, trial, 0), true);
  assert.deepEqual([...d.files.keys()], ['範圍/別次的.md', 'T/卡組.md']);
});

void test('認不出這次存的範圍檔（沒有、不只一份、沒有識別碼）：丟錯，什麼都不記', async () => {
  const cases: Record<string, string>[] = [
    { '範圍/別次的.md': '---\n識別碼: other2\n---\n- 高三下 考試測試zzz 1-1\n' },
    { '範圍/甲.md': '---\n識別碼: aaaaaa\n---\n- 高三下 考試測試abc 1-1\n', '範圍/乙.md': '---\n識別碼: bbbbbb\n---\n- 高三下 考試測試abc 1-1\n' },
    { '範圍/甲.md': '- 高三下 考試測試abc 1-1\n' },
  ];
  for (const files of cases) {
    const trial = newTrial();
    await assert.rejects(noteScope(disk(files).app, trial, '範圍', '考試測試abc'), /認不出這次存的範圍檔/);
    assert.deepEqual(trial.files, []);
  }
});

void test('同一個路徑被同步換成別的檔：路徑對、內容不是這次的，留著、回報出來；分段跑也一樣', async () => {
  for (const reload of [false, true]) {
    const d = disk();
    const trial = newTrial();
    await makeTrial(d.app, trial, 'T', WANTED, MARK);
    d.files.set('T/甲.md', '識別碼: 別人的');
    const left = await clearTrial(d.app, reload ? JSON.parse(JSON.stringify(trial)) as typeof trial : trial, 0);
    assert.deepEqual(left, ['T/甲.md', 'T']);
    assert.deepEqual([...d.files], [['T/甲.md', '識別碼: 別人的']]);
  }
});

void test('流程改過的檔：記號還在就是同一份，照刪；讀不到的不猜，留著、回報', async () => {
  const d = disk();
  const trial = newTrial();
  await makeTrial(d.app, trial, 'T', WANTED, MARK);
  d.files.set('T/甲.md', MARK + ' 甲，存檔補上了 ID ^abc123');
  d.refuse.add('T/乙.md');
  assert.deepEqual(await clearTrial(d.app, trial, 0), ['T/乙.md', 'T']);
  assert.deepEqual([...d.files.keys()], ['T/乙.md']);
});

void test('開發命令認範圍檔的兩處和外掛相同：考試範圍/小考/ 不算（D-189）', () => {
  const folder = 'Essence Cards/考試範圍/';
  const d = disk({ [folder + 'a.md']: '', [folder + '舊的/b.md']: '', [folder + '小考備份/c.md']: '', [folder + '小考/d.md']: '', [folder + '小考/2026/e.md']: '', [folder + '附件.png']: '', 'T/甲.md': '' });
  assert.deepEqual(scopeFiles(d.app).map(file => file.path), [folder + 'a.md', folder + '舊的/b.md', folder + '小考備份/c.md']);
  const trial = { files: [{ path: 'T/甲.md', mark: MARK }, { path: folder + '小考/d.md', mark: MARK }, { path: folder + 'a.md', mark: MARK }], folders: [] };
  assert.equal(provenScopePath(trial), folder + 'a.md');
  assert.equal(provenScopePath({ files: [{ path: folder + '小考/d.md', mark: MARK }], folders: [] }), undefined);
});
