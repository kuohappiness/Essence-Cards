import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createLogWriter, logPath, LOG_FOLDER, readHistory } from '../src/core/study/index.ts';
import type { NewEntry } from '../src/core/study/index.ts';
import type { Files } from '../src/core/files.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

const answer: NewEntry = { lt: 'target', r: 'good', v: '12345678' };
const at = Date.parse('2026-10-31T23:59:59.999+08:00');
function fake(append: Files['append']): Files {
  return {
    append,
    list: () => Promise.resolve([]),
    read: () => Promise.resolve(null),
    modify: () => Promise.reject(Error('沒有用到 modify')),
    watch: () => { throw Error('沒有用到 watch'); },
  };
}
function gate() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

void test('logPath 的月份照當地午夜，與清晨四點的日界不同', () => {
  assert.equal(LOG_FOLDER, 'Essence Cards/紀錄');
  assert.equal(logPath('Phone-abcd', at, 480), 'Essence Cards/紀錄/2026-10 Phone-abcd.jsonl');
  assert.equal(logPath('Phone-abcd', at + 1, 480), 'Essence Cards/紀錄/2026-11 Phone-abcd.jsonl');
  assert.equal(logPath('PC-abcd', Date.parse('2026-11-01T00:00:00Z'), -300), 'Essence Cards/紀錄/2026-10 PC-abcd.jsonl');
});

void test('write 同步回傳、時間嚴格遞增、路徑當下決定，flush 等到序列寫完', async () => {
  const gates = [gate(), gate(), gate()];
  const started: { path: string; line: string }[] = [];
  let calls = 0;
  let clock = at;
  const files = fake((path, line) => {
    started.push({ path, line });
    return gates[calls++].promise;
  });
  const writer = createLogWriter(files, { device: 'Phone-abcd', now: () => clock, offset: () => 480 });
  const t1 = writer.write(answer);
  const t2 = writer.write(answer); // 同毫秒
  clock -= 5000;
  const t3 = writer.write(answer); // 時鐘倒退
  assert.deepEqual([t1, t2, t3], ['2026-10-31T23:59:59.999+08:00', '2026-11-01T00:00:00.000+08:00', '2026-11-01T00:00:00.001+08:00']);
  await Promise.resolve();
  assert.equal(started.length, 1);
  let flushed = false;
  const done = writer.flush().then(() => { flushed = true; });
  gates[0].resolve(); await tick();
  assert.equal(started.length, 2); assert.equal(flushed, false);
  gates[1].resolve(); await tick();
  assert.equal(started.length, 3); assert.equal(flushed, false);
  gates[2].resolve(); await done;
  assert.equal(flushed, true);
  assert.deepEqual(started.map(e => e.path), ['Essence Cards/紀錄/2026-10 Phone-abcd.jsonl', 'Essence Cards/紀錄/2026-11 Phone-abcd.jsonl', 'Essence Cards/紀錄/2026-11 Phone-abcd.jsonl']);
  assert.deepEqual(started.map(e => (JSON.parse(e.line) as { t: string }).t), [t1, t2, t3]);
});

for (const trigger of ['write', 'flush'] as const) void test('append 失敗後由 ' + trigger + ' 重試，不能跳過或遺失前面的行', async () => {
  const errors: unknown[] = [];
  const attempts: string[] = [];
  const saved: string[] = [];
  const error = Error('模擬磁碟暫時失敗');
  let fail = true;
  const files = fake((_path, line) => {
    attempts.push(line);
    if (fail) return Promise.reject(error);
    saved.push(line);
    return Promise.resolve();
  });
  const writer = createLogWriter(files, { device: 'PC-abcd', now: () => at, offset: () => 480, onError: error => errors.push(error) });
  const t1 = writer.write(answer);
  const t2 = writer.write({ set: 'cap', val: 20 });
  await tick();
  assert.deepEqual(errors, [error]);
  assert.equal(saved.length, 0);
  fail = false;
  const t3 = trigger === 'write' ? writer.write(answer) : null;
  await writer.flush();
  assert.deepEqual(saved.map(e => (JSON.parse(e) as { t: string }).t), [t1, t2, ...(t3 ? [t3] : [])]);
  assert.equal(attempts[0], attempts[1]);
});

void test('flush 重試仍失敗會 reject；多個 flush 不會並行 append，onError 丟錯也保留佇列', async () => {
  const error = Error('無法寫入');
  let attempts = 0;
  let failed = true;
  const saved: string[] = [];
  const writer = createLogWriter(fake((_path, line) => {
    attempts++;
    if (failed) return Promise.reject(error);
    saved.push(line); return Promise.resolve();
  }), { device: 'PC-abcd', now: () => at, offset: () => 480, onError: () => { throw Error('通知也失敗'); } });
  writer.write(answer);
  await assert.rejects(writer.flush(), value => value === error);
  assert.equal(attempts, 2);
  failed = false;
  await Promise.all([writer.flush(), writer.flush(), writer.flush()]);
  assert.equal(saved.length, 1);
  assert.equal(attempts, 3);
});

void test('序列化在 write 當下完成，呼叫端後續修改 val 不影響紀錄', async () => {
  const values = ['攝影'];
  const saved: string[] = [];
  const writer = createLogWriter(fake((_path, line) => { saved.push(line); return Promise.resolve(); }), { device: 'PC-abcd', now: () => at, offset: () => 480 });
  writer.write({ set: 'filter', val: values });
  values.push('重要性：低');
  await writer.flush();
  assert.deepEqual((JSON.parse(saved[0]) as { val: unknown }).val, ['攝影']);
});

void test('前一輪 drain 完成與背景 Promise 收尾之間 write，仍會自動寫入', async () => {
  const saved: string[] = [];
  const writer = createLogWriter(fake((_path, line) => { saved.push(line); return Promise.resolve(); }), { device: 'PC-abcd', now: () => at, offset: () => 480 });
  const first = writer.write(answer);
  await Promise.resolve();
  await Promise.resolve();
  const second = writer.write(answer);
  await tick();
  assert.deepEqual(saved.map(e => (JSON.parse(e) as { t: string }).t), [first, second]);
});

void test('寫檔後 readHistory 讀回；不存在回空，子資料夾與非 jsonl 都不讀', async () => {
  const memory = createMemoryFiles();
  const { files } = memory;
  assert.deepEqual(await readHistory(files), { reviews: [], changes: [], problems: [], cancelled: [], seen: [] });
  const writer = createLogWriter(files, { device: 'Phone-abcd', now: () => at, offset: () => 480 });
  const t1 = writer.write(answer);
  const t2 = writer.write(answer);
  await writer.flush();
  memory.write(LOG_FOLDER + '/AI 輸出/nested.jsonl', '壞資料');
  memory.write(LOG_FOLDER + '/notes.md', '壞資料');
  memory.write(LOG_FOLDER + '/notes.jsonl.bak', '壞資料');
  memory.write(LOG_FOLDER + '/2026-10 conflict.jsonl', (await files.read(logPath('Phone-abcd', at, 480)))!);
  const history = await readHistory(files);
  assert.deepEqual(history.reviews.map(e => e.t), [t1, t2]);
  assert.deepEqual(history.problems, []);
  assert.equal(await files.read(logPath('Phone-abcd', at, 480)), '{"t":"2026-10-31T23:59:59.999+08:00","lt":"target","r":"good","v":"12345678"}\n');
});

void test('readHistory 不吞真正的 I/O 失敗', async () => {
  const files = fake(() => Promise.resolve());
  files.list = () => Promise.reject(Error('list 失敗'));
  await assert.rejects(readHistory(files), /list 失敗/);
  files.list = () => Promise.resolve([LOG_FOLDER + '/broken.jsonl']);
  files.read = () => Promise.reject(Error('read 失敗'));
  await assert.rejects(readHistory(files), /read 失敗/);
});

for (const when of ['同步', '收尾前的微任務'] as const) void test('L2-1 onError ' + when + ' write 不需 flush 就依序重試', async () => {
  const saved: string[] = [];
  const attempts: string[] = [];
  let second = '';
  const writer = createLogWriter(fake((_path, line) => {
    attempts.push(line);
    if (attempts.length === 1) return Promise.reject(Error('只失敗一次'));
    saved.push(line);
    return Promise.resolve();
  }), {
    device: 'PC-abcd', now: () => at, offset: () => 480,
    onError: () => {
      const writeNext = () => { second = writer.write({ ...answer, lt: 'second' }); };
      if (when === '同步') writeNext();
      else queueMicrotask(writeNext);
    },
  });
  const first = writer.write(answer);
  await tick();
  assert.deepEqual(saved.map(line => (JSON.parse(line) as { t: string }).t), [first, second]);
  assert.equal(attempts.length, 3);
  assert.equal(attempts[0], attempts[1]);
});

void test('L2-1 重入 write 的重試仍失敗時只重試一輪，之後仍可 flush', async () => {
  let attempts = 0;
  let fail = true;
  const saved: string[] = [];
  const error = Error('持續失敗');
  const writer = createLogWriter(fake((_path, line) => {
    attempts++;
    if (fail) return Promise.reject(error);
    saved.push(line);
    return Promise.resolve();
  }), {
    device: 'PC-abcd', now: () => at, offset: () => 480,
    onError: () => { if (attempts === 1) writer.write({ ...answer, lt: 'second' }); },
  });
  writer.write(answer);
  await tick();
  assert.equal(attempts, 2);
  await tick();
  assert.equal(attempts, 2);
  fail = false;
  await writer.flush();
  assert.deepEqual(saved.map(line => (JSON.parse(line) as { lt: string }).lt), ['target', 'second']);
});

void test('L2-1 append 已 reject 但 catch 尚未執行前的 write 也會重試', async () => {
  let rejectFirst: (error: unknown) => void = () => { throw Error('尚未建立 append'); };
  const firstAppend = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
  const saved: string[] = [];
  let attempts = 0;
  const writer = createLogWriter(fake((_path, line) => {
    attempts++;
    if (attempts === 1) return firstAppend;
    saved.push(line);
    return Promise.resolve();
  }), { device: 'PC-abcd', now: () => at, offset: () => 480 });
  const first = writer.write(answer);
  await Promise.resolve();
  rejectFirst(Error('append 已失敗'));
  const second = writer.write({ ...answer, lt: 'second' });
  await tick();
  assert.deepEqual(saved.map(line => (JSON.parse(line) as { t: string }).t), [first, second]);
  assert.equal(attempts, 3);
});
