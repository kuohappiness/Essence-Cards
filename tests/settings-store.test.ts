import test from 'node:test';
import type { TestContext } from 'node:test';
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

void test('layout ready 之前的重讀與存檔都不做', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const store = createSettingsStore(options);
  await store.reload();
  assert.equal(await store.change(cap(60)), 'unreadable');
  assert.equal(state.log.length, 0);
});

void test('只有寫前讀到過檔、核對時回 null：失敗；下一筆遇到 null 不寫（L2 F1）', async () => {
  for (const change of [cap(60), cap(null)]) {
    const { state, options } = disk(null);
    state.content = undefined;
    const store = await started({ ...options, save: data => { state.saves.push(data); state.content = null; return Promise.resolve(); } });
    assert.equal(store.value().known, false, '第一次讀不到');
    state.content = { capMinutes: 45, retention: 0.9, future: { x: 1 } };
    assert.equal(await store.change(change), 'failed', '寫前讀到物件、核對時回 null');
    assert.equal(store.value().known, false, '不把 null 當成空物件採用');
    assert.equal(await store.change({ key: 'examCountdown', value: false }), 'unreadable', '下一筆遇到 null 不寫');
    assert.equal(state.saves.length, 1);
  }
});

void test('停用：還沒開始的存檔不做，回 failed；已經開始的做完；之後重讀不做（L2 F3）', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const slow = deferred<undefined>();
  let hold = true;
  const store = await started({ ...options, save: data => {
    if (hold) { hold = false; return slow.promise.then(() => options.save(data)); }
    return options.save(data);
  } });
  const first = store.change(cap(60));
  const second = store.change(cap(75));
  await new Promise<void>(resolve => { setImmediate(resolve); });
  store.close();
  slow.resolve(undefined);
  assert.equal(await first, 'failed', '停用後不核對，不能說存好了');
  assert.equal(await second, 'failed');
  assert.deepEqual(state.content, { capMinutes: 60 });
  state.log.length = 0;
  await store.reload();
  assert.equal(state.log.length, 0);
});

void test('第一次讀 5 秒後才回來：沒人存過就採用；存過就不採用（L2 F4）', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => { setImmediate(resolve); }); };
  const pending = deferred<unknown>();
  const { options } = disk(null);
  const store = createSettingsStore({ ...options, load: () => pending.promise });
  const changes: boolean[] = [];
  store.onChange(value => { changes.push(value.known); });
  const first = store.first();
  await flush();
  t.mock.timers.tick(2000);
  assert.equal((await first).known, false);
  t.mock.timers.tick(3000);
  await flush();
  pending.resolve({ capMinutes: 60 });
  await flush();
  assert.equal(store.value().settings.capMinutes, 60);
  assert.deepEqual(changes, [true]);

  const early = deferred<unknown>();
  const other = disk({ capMinutes: 45 });
  let calls = 0;
  const writer = createSettingsStore({ ...other.options, load: () => ++calls === 1 ? early.promise : other.options.load() });
  const firstRead = writer.first();
  await flush();
  t.mock.timers.tick(2000);
  await firstRead;
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(await writer.change(cap(75)), 'saved');
  early.resolve({ capMinutes: 60 });
  await flush();
  assert.equal(writer.value().settings.capMinutes, 75, '晚到的舊內容不蓋掉存檔的結果');
});

const flushAll = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => { setImmediate(resolve); }); };
/** 第一次讀逾時：load 由 script 逐次決定。 */
async function timedOut(t: TestContext, script: (call: number) => Promise<unknown>, extra: Partial<SettingsStoreOptions> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { state, options } = disk(null);
  let calls = 0;
  const store = createSettingsStore({ ...options, ...extra, load: () => script(++calls) });
  const first = store.first();
  await flushAll();
  t.mock.timers.tick(2000);
  await first;
  t.mock.timers.tick(3000);
  await flushAll();
  return { store, state, calls: () => calls };
}

void test('寫前底稿是「沒有檔」，等待中晚到的讀取見過檔：不寫（L2 第二輪 F1）', async t => {
  // 晚到的讀取落在「底稿分類完」到「送出 saveData」之間的哪一步都要擋：逐步挪開兩者的間隔。
  const blind: unknown[] = [];
  for (let gap = 0; gap < 12; gap++) {
    const a = deferred<unknown>(), b = deferred<unknown>();
    let lateSeen = false;
    const { store } = await timedOut(t, call => call === 1 ? a.promise : call === 2 ? b.promise : Promise.resolve({ capMinutes: 45 }), { save: data => { if (lateSeen) blind.push(data); return Promise.resolve(); } });
    void a.promise.then(() => undefined).then(() => { lateSeen = true; });
    const saving = store.change({ key: 'examCountdown', value: false });
    await flushAll();
    b.resolve(null);
    for (let i = 0; i < gap; i++) await Promise.resolve();
    a.resolve({ capMinutes: 45, retention: 0.9, future: { x: 1 } });
    await flushAll();
    t.mock.timers.tick(10_000);
    await saving;
    t.mock.timers.reset();
  }
  assert.deepEqual(blind, []);
});

void test('停用時寫入還在進行：完成後不核對、不通知（L2 第二輪 F3）', async () => {
  const { state, options } = disk({ capMinutes: 45 });
  const slow = deferred<undefined>();
  const store = await started({ ...options, save: data => slow.promise.then(() => options.save(data)) });
  let count = 0;
  store.onChange(() => { count++; });
  const saving = store.change(cap(60));
  await new Promise<void>(resolve => { setImmediate(resolve); });
  store.close();
  state.log.length = 0;
  slow.resolve(undefined);
  await saving;
  assert.deepEqual(state.content, { capMinutes: 60 }, '已經送出的寫入做完');
  assert.deepEqual(state.log, ['save']);
  assert.equal(count, 0);
});

void test('停用時核對還在進行：回來也不採用、不通知（L2 第二輪 F3）', async () => {
  const { options } = disk({ capMinutes: 45 });
  const back = deferred<unknown>();
  let saved = false;
  const store = await started({ ...options, load: () => saved ? back.promise : options.load(), save: data => { saved = true; return options.save(data); } });
  let count = 0;
  store.onChange(() => { count++; });
  const saving = store.change(cap(60));
  await new Promise<void>(resolve => { setImmediate(resolve); });
  store.close();
  back.resolve({ capMinutes: 60 });
  await saving;
  assert.equal(count, 0);
  assert.equal(store.value().settings.capMinutes, 45);
});

void test('兩次都逾時，舊的先回 null：補讀拿到最新的內容（L2 第二輪 F4）', async t => {
  const a = deferred<unknown>(), b = deferred<unknown>();
  const { store } = await timedOut(t, call => call === 1 ? a.promise : call === 2 ? b.promise : Promise.resolve({ capMinutes: 75 }));
  const reload = store.reload();
  await flushAll();
  t.mock.timers.tick(5000);
  await reload;
  a.resolve(null);
  await flushAll();
  b.resolve({ capMinutes: 75 });
  await flushAll();
  assert.equal(store.value().known, true);
  assert.equal(store.value().settings.capMinutes, 75);
});

void test('存檔沒有送出（寫前讀不到）：晚到的第一次讀照樣補讀（L2 第二輪 F4）', async t => {
  const a = deferred<unknown>();
  const { store, state } = await timedOut(t, call => call === 1 ? a.promise : call === 2 ? Promise.resolve(undefined) : Promise.resolve({ capMinutes: 45 }));
  assert.equal(await store.change(cap(60)), 'unreadable');
  assert.equal(state.saves.length, 0);
  a.resolve({ capMinutes: 45 });
  await flushAll();
  assert.equal(store.value().known, true);
  assert.equal(store.value().settings.capMinutes, 45);
});

void test('檔案一直很慢：補讀逾時不再排下一次', async t => {
  const answers: ReturnType<typeof deferred<unknown>>[] = [];
  const { store, calls } = await timedOut(t, () => { const d = deferred<unknown>(); answers.push(d); return d.promise; });
  answers[0].resolve({ capMinutes: 45 });
  await flushAll();
  assert.equal(calls(), 2, '補讀一次');
  t.mock.timers.tick(5000);
  await flushAll();
  answers[1].resolve({ capMinutes: 45 });
  await flushAll();
  assert.equal(calls(), 2, '補讀逾時後不再排');
  assert.equal(store.value().known, false);
});

void test('內容相同的重讀跨過 2/1：通知一次，學期是新的；不寫檔（L2 F6）', async () => {
  const { state, options } = disk({ semester: '國二上', semesterSetOn: '2026-09-15' });
  let today = '2027-01-31';
  const store = await started({ ...options, today: () => today });
  let count = 0;
  store.onChange(() => { count++; });
  await store.reload();
  assert.equal(count, 0);
  today = '2027-02-01';
  await store.reload();
  assert.equal(count, 1);
  assert.equal(store.semester(), '國二下');
  await store.reload();
  assert.equal(count, 1);
  assert.equal(state.saves.length, 0);
});

void test('重讀讀不到但跨過 2/1：照手上的值通知，學期是新的（L2 第二輪 F6）', async () => {
  const { state, options } = disk({ semester: '國二上', semesterSetOn: '2026-09-15' });
  let today = '2027-01-31';
  const store = await started({ ...options, today: () => today });
  let count = 0;
  store.onChange(() => { count++; });
  today = '2027-02-01';
  state.content = undefined;
  await store.reload();
  assert.equal(count, 1);
  assert.equal(store.semester(), '國二下');
});

void test('過了 2/1 不寫檔，畫面看到的是今天的學期', async () => {
  const { state, options } = disk({ semester: '國二上', semesterSetOn: '2026-09-15' });
  const store = await started({ ...options, today: () => '2027-02-01' });
  assert.equal(store.semester(), '國二下');
  assert.equal(state.saves.length, 0);
});
