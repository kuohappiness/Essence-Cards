import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStore } from '../src/core/settings/index.ts';
import type { SettingsChange, SettingsStoreOptions } from '../src/core/settings/index.ts';

// 讀與存的順序（tasks/settings-page.md §2、§7）。load、save 是替身，照 Obsidian 1.15 的行為：null 是沒有檔，undefined 是讀不到；saveData 吞掉寫入錯誤。

function disk(initial: unknown = null) {
  const state = {
    content: initial,
    saves: [] as unknown[],
    log: [] as string[],
  };
  const options: Pick<SettingsStoreOptions, 'load' | 'save' | 'today'> = {
    load: () => { state.log.push('load'); return Promise.resolve(state.content === undefined ? undefined : JSON.parse(JSON.stringify(state.content))); },
    save: data => { state.log.push('save'); state.saves.push(data); state.content = data; return Promise.resolve(); },
    today: () => '2026-11-09',
  };
  return { state, options };
}
const started = async (options: SettingsStoreOptions) => {
  const store = createSettingsStore(options);
  await store.first();
  return store;
};
const cap = (value: number | null): SettingsChange => ({ key: 'capMinutes', value });
const never = <T>(): Promise<T> => new Promise<T>(() => {});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

void test('沒有檔：預設值、known，載入時不建立', async () => {
  const { state, options } = disk(null);
  const store = await started(options);
  assert.equal(store.value().settings.capMinutes, 30);
  assert.equal(store.value().settings.retention, 0.8);
  assert.equal(store.value().semester, null);
  assert.equal(store.value().known, true);
  assert.equal(state.saves.length, 0);
});

void test('存一項：以磁碟的內容為底，保留不認得的欄位', async () => {
  const { state, options } = disk({ foo: 1, retention: 0.85 });
  const store = await started(options);
  assert.equal(await store.change(cap(45)), 'saved');
  assert.deepEqual(state.content, { foo: 1, retention: 0.85, capMinutes: 45 });
  assert.equal(store.value().settings.capMinutes, 45);
});

void test('手上是舊的、磁碟被別台改了：存別項不蓋掉，手上也更新', async () => {
  const { state, options } = disk({ retention: 0.85 });
  const store = await started(options);
  state.content = { retention: 0.9 };
  assert.equal(await store.change(cap(45)), 'saved');
  assert.deepEqual(state.content, { retention: 0.9, capMinutes: 45 });
  assert.equal(store.value().settings.retention, 0.9);
});

void test('選的等於預設也存；恢復預設刪欄位，留下空物件的檔', async () => {
  const { state, options } = disk(null);
  const store = await started(options);
  assert.equal(await store.change(cap(30)), 'saved');
  assert.deepEqual(state.content, { capMinutes: 30 });
  assert.deepEqual(store.saved(), ['capMinutes']);
  assert.equal(await store.change(cap(null)), 'saved');
  assert.deepEqual(state.content, {});
  assert.deepEqual(store.saved(), []);
});

void test('寫前讀不到、不是物件：不寫，手上的值不變', async () => {
  for (const bad of [undefined, [1], 3, 'x']) {
    const { state, options } = disk({ capMinutes: 45 });
    const store = await started(options);
    state.content = bad;
    assert.equal(await store.change(cap(60)), 'unreadable', String(bad));
    assert.equal(state.saves.length, 0);
    assert.equal(store.value().settings.capMinutes, 45);
  }
});

void test('load 丟錯當成讀不到', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const store = await started({ ...options, load: () => state.log.length > 0 ? Promise.reject(Error('讀不到')) : (state.log.push('x'), Promise.resolve({ capMinutes: 45 })) });
  assert.equal(await store.change(cap(60)), 'unreadable');
  assert.equal(state.saves.length, 0);
});

void test('寫前 5 秒沒回來：不寫', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { state, options } = disk({ capMinutes: 45 });
  let hang = false;
  const store = createSettingsStore({ ...options, load: () => hang ? never() : options.load() });
  const first = store.first();
  await new Promise<void>(resolve => { setImmediate(resolve); });
  await first;
  hang = true;
  const result = store.change(cap(60));
  await new Promise<void>(resolve => { setImmediate(resolve); });
  t.mock.timers.tick(5000);
  assert.equal(await result, 'unreadable');
  assert.equal(state.saves.length, 0);
});

void test('這次讀到過檔、現在回 null：不寫；沒讀到過檔的 null 當空物件', async () => {
  const seen = disk({ capMinutes: 45 });
  const store = await started(seen.options);
  seen.state.content = null;
  assert.equal(await store.change(cap(60)), 'unreadable');
  assert.equal(seen.state.saves.length, 0);
  assert.equal(store.value().settings.capMinutes, 45);

  const fresh = disk(null);
  const second = await started(fresh.options);
  assert.equal(await second.change(cap(60)), 'saved');
  assert.equal(await second.change(cap(75)), 'saved');
  assert.deepEqual(fresh.state.content, { capMinutes: 75 });
});

void test('saveData 吞掉錯誤、讀回的不是新值：失敗，手上是讀回的值', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const store = await started({ ...options, save: data => { state.saves.push(data); return Promise.resolve(); } });
  assert.equal(await store.change(cap(60)), 'failed');
  assert.equal(store.value().settings.capMinutes, 45);
});

void test('恢復預設讀回欄位還在：失敗', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const store = await started({ ...options, save: () => { state.log.push('nosave'); return Promise.resolve(); } });
  assert.equal(await store.change(cap(null)), 'failed');
});

void test('寫完讀回讀不到：失敗，手上維持最後確認的值', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const store = await started({ ...options, save: data => { state.content = undefined; state.saves.push(data); return Promise.resolve(); } });
  assert.equal(await store.change(cap(60)), 'failed');
  assert.equal(store.value().settings.capMinutes, 45);
});

void test('連按三次排隊：依序不重疊，每次以前一次為底', async () => {
  const { state, options } = disk({ retention: 0.9 });
  const store = await started(options);
  state.log.length = 0;
  const results = await Promise.all([store.change(cap(45)), store.change(cap(60)), store.change(cap(75))]);
  assert.deepEqual(results, ['saved', 'saved', 'saved']);
  assert.deepEqual(state.content, { retention: 0.9, capMinutes: 75 });
  assert.deepEqual(state.log, ['load', 'save', 'load', 'load', 'save', 'load', 'load', 'save', 'load']);
});

void test('第一筆失敗後第二筆照常', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  let fail = true;
  const store = await started({ ...options, save: data => { if (fail) { fail = false; return Promise.reject(Error('寫不進去')); } return options.save(data); } });
  assert.equal(await store.change(cap(60)), 'failed');
  assert.equal(await store.change(cap(75)), 'saved');
  assert.deepEqual(state.content, { capMinutes: 75 });
});

void test('寫入逾時先回報失敗，第二筆等它結束才開始', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { state, options } = disk({ capMinutes: 45 });
  const slow = deferred<undefined>();
  let first = true;
  const store = createSettingsStore({ ...options, save: data => {
    if (first) { first = false; return slow.promise.then(() => options.save({ ...data as object, late: true })); }
    return options.save(data);
  } });
  const load = store.first();
  await new Promise<void>(resolve => { setImmediate(resolve); });
  await load;
  const a = store.change(cap(60));
  await new Promise<void>(resolve => { setImmediate(resolve); });
  t.mock.timers.tick(10_000);
  assert.equal(await a, 'failed');
  const b = store.change(cap(75));
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(state.saves.length, 0, '第一筆還沒結束，第二筆不開始');
  slow.resolve(undefined);
  assert.equal(await b, 'saved');
  assert.equal((state.content as { capMinutes: number }).capMinutes, 75);
});

void test('重讀還在等時存檔：照隊伍順序，最後是存檔的值，舊的讀不蓋新值', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const pending = deferred<unknown>();
  let hold = false;
  const store = await started({ ...options, load: () => { if (hold) { hold = false; return pending.promise; } return options.load(); } });
  hold = true;
  const reload = store.reload();
  const saving = store.change(cap(60));
  pending.resolve({ capMinutes: 45 });
  await reload;
  assert.equal(await saving, 'saved');
  assert.equal(store.value().settings.capMinutes, 60);
  assert.deepEqual(state.content, { capMinutes: 60 });
});

void test('第一次讀不到或 2 秒內沒回來：預設值、known 是 false；之後重讀成功就更新', async t => {
  const bad = disk(null);
  bad.state.content = undefined;
  const store = await started(bad.options);
  assert.equal(store.value().known, false);
  assert.equal(store.value().settings.capMinutes, 30);
  bad.state.content = { capMinutes: 45 };
  await store.reload();
  assert.equal(store.value().known, true);
  assert.equal(store.value().settings.capMinutes, 45);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred<unknown>();
  const slow = createSettingsStore({ ...bad.options, load: () => pending.promise });
  const changes: boolean[] = [];
  slow.onChange(value => { changes.push(value.known); });
  const first = slow.first();
  await new Promise<void>(resolve => { setImmediate(resolve); });
  t.mock.timers.tick(2000);
  assert.equal((await first).known, false);
  pending.resolve({ capMinutes: 60 });
  await new Promise<void>(resolve => { setImmediate(resolve); });
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(slow.value().known, true);
  assert.equal(slow.value().settings.capMinutes, 60);
  assert.deepEqual(changes, [true]);
});

void test('重讀：內容相同不通知；值變了通知；只補上等於預設的欄位也通知（恢復預設要出現）', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const store = await started(options);
  let count = 0;
  store.onChange(() => { count++; });
  await store.reload();
  assert.equal(count, 0);
  state.content = { capMinutes: 60 };
  await store.reload();
  assert.equal(count, 1);
  state.content = { capMinutes: 60, retention: 0.8 };
  await store.reload();
  assert.equal(count, 2);
  assert.deepEqual(store.saved(), ['capMinutes', 'retention']);
});

void test('監聽者丟錯：交給 onError，存檔照常回報、隊伍不卡住', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const errors: unknown[] = [];
  const store = await started({ ...options, onError: error => { errors.push(error); } });
  store.onChange(() => { throw Error('畫面壞了'); });
  assert.equal(await store.change(cap(60)), 'saved');
  assert.equal(await store.change(cap(75)), 'saved');
  assert.equal(errors.length, 2);
  assert.deepEqual(state.content, { capMinutes: 75 });
});

void test('layout ready 之前的重讀不做', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const store = createSettingsStore(options);
  await store.reload();
  assert.equal(state.log.length, 0);
});

void test('過了 2/1 不寫檔，畫面看到的是今天的學期', async () => {
  const { state, options } = disk({ semester: '國二上', semesterSetOn: '2026-09-15' });
  const store = await started({ ...options, today: () => '2027-02-01' });
  assert.equal(store.semester(), '國二下');
  assert.equal(state.saves.length, 0);
});
