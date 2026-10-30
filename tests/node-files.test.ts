import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, stat, utimes, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createNodeFiles } from '../tools/node-files.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'essence-files-'));
  const files = createNodeFiles(root);
  // t.after 照登錄順序執行；先停掉這次開的監看再刪資料夾。
  const stops: (() => void)[] = [];
  t.after(async () => {
    for (const stop of stops) stop();
    await rm(root, { recursive: true, force: true });
  });
  const watch: typeof files.watch = onChange => { const stop = files.watch(onChange); stops.push(stop); return stop; };
  return { root, files: { ...files, watch } };
}

void test('Files.list 遞迴只列檔案，vault 相對 / 路徑，依字串排序，缺資料夾回 []', async t => {
  const { root, files } = await fixture(t);
  await mkdir(join(root, 'folder', 'deep'), { recursive: true });
  for (const path of ['folder/z.md', 'folder/A.md', 'folder/deep/中文.md', 'outside.md']) await writeFile(join(root, path), '');
  assert.deepEqual(await files.list('folder'), ['folder/A.md', 'folder/deep/中文.md', 'folder/z.md']);
  assert.deepEqual(await files.list('missing'), []);
  assert.deepEqual(await files.list(''), ['folder/A.md', 'folder/deep/中文.md', 'folder/z.md', 'outside.md']);
});
void test('Files.read 不存在回 null，既有檔案完整保留 UTF-8 與換行', async t => {
  const { root, files } = await fixture(t);
  assert.equal(await files.read('missing/file'), null);
  await writeFile(join(root, 'a.md'), '中文\r\n文字\n');
  assert.equal(await files.read('a.md'), '中文\r\n文字\n');
});
void test('Files.modify 建立上層、以空文字呼叫 edit，一次讀改寫，沒變不寫', async t => {
  const { root, files } = await fixture(t);
  let calls = 0;
  await files.modify('deep/a.md', old => { calls++; assert.equal(old, ''); return 'A'; });
  await files.modify('deep/a.md', old => { calls++; assert.equal(old, 'A'); return old + 'B'; });
  assert.equal(calls, 2); assert.equal(await files.read('deep/a.md'), 'AB');
  const file = join(root, 'deep/a.md');
  await utimes(file, new Date(0), new Date(0));
  const previous = await stat(file);
  await files.modify('deep/a.md', old => old);
  assert.equal((await stat(file)).mtimeMs, previous.mtimeMs);
  await files.modify('empty/a.md', old => old);
  assert.equal(await files.read('empty/a.md'), '');
});
void test('Files.modify 同檔並行的讀改寫串接，append 也不互蓋', async t => {
  const { files } = await fixture(t);
  await Promise.all(Array.from({ length: 40 }, () => files.modify('counter', old => String(Number(old) + 1))));
  assert.equal(await files.read('counter'), '40');
  await Promise.all([files.modify('a', () => 'start\n'), files.append('a', 'second'), files.modify('a', old => old + 'end')]);
  assert.equal(await files.read('a'), 'start\nsecond\nend');
});

void test('F4 不分大小寫的檔案系統：同檔大小寫別名的 40 次 modify 不遺失', async t => {
  const { files } = await fixture(t);
  await files.modify('counter.txt', () => '0');
  if (await files.read('COUNTER.txt') === null) {
    t.skip('暫存資料夾區分大小寫，counter.txt 與 COUNTER.txt 不是同一個檔案');
    return;
  }
  await Promise.all(Array.from({ length: 40 }, (_, i) => files.modify(i % 2 ? 'counter.txt' : 'COUNTER.txt', old => String(Number(old) + 1))));
  assert.equal(await files.read('counter.txt'), '40');
  assert.equal(await files.read('COUNTER.txt'), '40');
});
void test('Files.modify edit 丟錯不會寫檔，也不堵住後續修改', async t => {
  const { files } = await fixture(t);
  await files.modify('a', () => 'before');
  await assert.rejects(files.modify('a', () => { throw Error('停止'); }), /停止/);
  assert.equal(await files.read('a'), 'before');
  await files.modify('a', old => old + ' after');
  assert.equal(await files.read('a'), 'before after');
});
void test('Files.append 追加 line 加換行，建立上層、不擅自補原檔的換行', async t => {
  const { files } = await fixture(t);
  await files.append('deep/a', '第一行'); await files.append('deep/a', '第二行');
  assert.equal(await files.read('deep/a'), '第一行\n第二行\n');
  await files.modify('a', () => 'no newline'); await files.append('a', 'appended');
  assert.equal(await files.read('a'), 'no newlineappended\n');
});
void test('Files 只吞不存在的錯誤，其他讀寫失敗仍回報', async t => {
  const { root, files } = await fixture(t);
  await mkdir(join(root, 'dir'));
  await assert.rejects(files.read('dir'));
  await assert.rejects(files.modify('dir', () => 'x'));
});
void test('Files 拒絕絕對路徑與向上越過 vault 的路徑', async t => {
  const { root, files } = await fixture(t);
  assert.throws(() => files.read('../outside'), /vault/);
  assert.throws(() => files.append(join(root, 'a'), 'x'), /vault/);
  await assert.rejects(files.list('../outside'), /vault/);
});

void test('Files.watch recursive 通知新增、修改、刪除、改名的舊新路徑，取消後停止', async t => {
  const { root, files } = await fixture(t);
  const events: string[] = [];
  const stop = files.watch(path => events.push(path));
  t.after(() => stop());
  async function waitFor(paths: string[]) {
    const deadline = performance.now() + 3000;
    while (!paths.every(path => events.includes(path))) {
      assert.ok(performance.now() < deadline, '未收到通知：' + String(paths) + '，收到：' + String(events));
      await setTimeout(10);
    }
  }
  await files.append('deep/a.md', 'new'); await waitFor(['deep/a.md']);
  events.length = 0;
  await files.modify('deep/a.md', old => old + 'changed'); await waitFor(['deep/a.md']);
  events.length = 0;
  await rename(join(root, 'deep/a.md'), join(root, 'deep/b.md')); await waitFor(['deep/a.md', 'deep/b.md']);
  events.length = 0;
  await rename(join(root, 'deep'), join(root, 'renamed')); await waitFor(['deep/b.md', 'renamed/b.md']);
  events.length = 0;
  await rm(join(root, 'renamed/b.md')); await waitFor(['renamed/b.md']);
  assert.ok(events.every(path => !path.includes('\\') && !path.startsWith('/')));
  stop(); const count = events.length;
  await files.append('later/a.md', 'later'); await setTimeout(80);
  assert.equal(events.length, count);
});
void test('Files.watch 監看中的資料夾被刪掉時不丟出未攔截的錯誤（Windows 刪除中回 EPERM）', async t => {
  for (let round = 0; round < 10; round++) {
    const root = await mkdtemp(join(tmpdir(), 'essence-files-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (let i = 0; i < 20; i++) {
      await mkdir(join(root, 'd' + String(i)), { recursive: true });
      await writeFile(join(root, 'd' + String(i), 'x.md'), 'x');
    }
    const stop = createNodeFiles(root).watch(() => {});
    await rm(root, { recursive: true, force: true });
    await setTimeout(30);
    stop();
  }
});
/** 監看用的列資料夾替身：failing 時回 EPERM，模擬 Windows 刪除中的資料夾。只交給 createNodeFiles，不改全域的 node:fs。 */
function flakyList() {
  const list = {
    failing: false, calls: 0,
    readdirSync: ((...args: Parameters<typeof fs.readdirSync>) => {
      list.calls++;
      if (list.failing) throw Object.assign(Error('EPERM: operation not permitted, scandir'), { code: 'EPERM' });
      return fs.readdirSync(...args);
    }) as typeof fs.readdirSync,
  };
  return list;
}
// Codex 審查 W5 的 F4：列資料夾暫時失敗後，不能等下一次通知；恢復後要補送刪除。
void test('Files.watch 列資料夾暫時回 EPERM：恢復後自己重新比對，補送刪除的路徑；停止監看就不再重試', async t => {
  const { root, files } = await fixture(t);
  await files.append('folder/a.md', 'a');
  await files.append('folder/b.md', 'b');
  const list = flakyList();
  const events: string[] = [];
  const stopFirst = createNodeFiles(root, list).watch(path => { events.push(path); });
  t.after(() => stopFirst());
  list.failing = true;
  await rm(join(root, 'folder/a.md'));
  // 檔案系統的通知都送完了（這段期間每次比對都失敗），之後不會再有新的通知。
  await setTimeout(300);
  assert.deepEqual<string[]>(events, []);
  list.failing = false;
  const deadline = performance.now() + 3000;
  while (!events.includes('folder/a.md') && performance.now() < deadline) await setTimeout(10);
  assert.deepEqual(events, ['folder/a.md']);
  stopFirst();

  // 停止監看之後，排好的重試也取消。
  const seen: string[] = [];
  const stop = createNodeFiles(root, list).watch(path => { seen.push(path); });
  t.after(() => stop());
  list.failing = true;
  await rm(join(root, 'folder/b.md'));
  await setTimeout(300);
  stop();
  list.failing = false;
  const before = list.calls;
  await setTimeout(1500);
  assert.equal(list.calls, before);
  assert.deepEqual(seen, []);
});
// 外掛架構檢查環節 1 的 T2：fs.watch 有時不給檔名。用假的 watch 送出 filename 是 null 的事件。
void test('T2 Files.watch 收到沒有檔名的事件：既有檔改了內容、新檔出現都通知；比對暫時失敗時保留，恢復後補送；停止後不再通知', async t => {
  const { root, files } = await fixture(t);
  await files.append('a.md', 'a');
  await files.append('deep/b.md', 'b');
  const list = flakyList();
  const fake = { emit: (() => {}) as (event: string, filename: string | null) => void, closed: false };
  const watch = ((_path: string, _options: unknown, listener: typeof fake.emit) => {
    fake.emit = listener;
    return { close() { fake.closed = true; } };
  }) as unknown as typeof fs.watch;
  const events: string[] = [];
  const stop = createNodeFiles(root, { readdirSync: list.readdirSync, watch }).watch(path => { events.push(path); });
  t.after(() => stop());

  // 既有檔改了內容：檔名集合沒變，不知道是哪一篇，已知的全部通知。
  await files.modify('deep/b.md', old => old + '!');
  fake.emit('change', null);
  assert.deepEqual(events.sort(), ['a.md', 'deep/b.md']);
  events.length = 0;
  await files.append('c.md', 'c');
  fake.emit('change', null);
  assert.deepEqual(events.sort(), ['a.md', 'c.md', 'deep/b.md']);
  events.length = 0;

  // 比對暫時失敗：這次的重讀需求留著，恢復後自己補送。
  list.failing = true;
  await files.modify('a.md', old => old + '!');
  fake.emit('change', null);
  assert.deepEqual(events, []);
  list.failing = false;
  const deadline = performance.now() + 3000;
  while (events.length === 0 && performance.now() < deadline) await setTimeout(10);
  assert.deepEqual(events.sort(), ['a.md', 'c.md', 'deep/b.md']);
  events.length = 0;

  // 停止監看：排好的重試取消，之後不再通知。
  list.failing = true;
  fake.emit('change', null);
  stop();
  assert.ok(fake.closed);
  list.failing = false;
  const before = list.calls;
  await setTimeout(300);
  assert.equal(list.calls, before);
  assert.deepEqual(events, []);
});
void test('Files.watch 能監看既有深層檔案', async t => {
  const { files } = await fixture(t);
  await files.append('deep/old.md', 'before');
  const events: string[] = [];
  const stop = files.watch(path => events.push(path)); t.after(() => stop());
  await files.append('deep/old.md', 'after');
  const deadline = performance.now() + 3000;
  while (!events.includes('deep/old.md') && performance.now() < deadline) await setTimeout(10);
  assert.ok(events.includes('deep/old.md'));
});
