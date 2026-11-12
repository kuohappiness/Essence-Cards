import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_FILE, createSettingsFile, createSettingsStore, decodeSettings, dropLegacy, encodeSettings, isSettingsPath, overlayLegacy, settingsText } from '../src/core/settings/index.ts';
import type { SettingsChange } from '../src/core/settings/index.ts';
import { guardedMoves, isDeckPath, presentFolders } from '../src/core/deck/index.ts';
import { isLogPath } from '../src/core/study/index.ts';

// 設定檔 `Essence Cards/設定.json` 的內容與疊 legacy（tasks/settings-vault-file.md §1、§2）。例子照任務說明 §6。

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * 替身：設定檔是文字（null 不存在、Error 讀不到）；data.json 照 Obsidian 的 loadData（null 不存在、undefined 讀不到）；
 * confirmed 是這台的 localStorage 那一筆（§3），missing 是「設定檔讀不到」那一列換了幾次。沒有寫 data.json 的口。
 * onData：每次讀完 data.json 之後叫（第幾次讀），用來在兩次讀之間換掉 data.json。hold：第幾次讀 data.json 要等它（卡住的讀）。
 */
function vault(init: { file?: string | null | Error; data?: unknown; confirmed?: unknown; onData?: (n: number) => void; hold?: (n: number) => Promise<void> | undefined } = {}) {
  let reads = 0;
  const state = { file: init.file ?? null, data: 'data' in init ? init.data : null, writes: 0, confirmed: (init.confirmed ?? null) as unknown, confirms: 0, missing: 0 };
  const settingsFile = createSettingsFile({
    confirmed: () => state.confirmed,
    confirm: fields => { state.confirmed = JSON.parse(JSON.stringify(fields)) as unknown; state.confirms++; },
    onMissing: () => { state.missing++; },
    readBytes: path => {
      assert.equal(path, SETTINGS_FILE);
      return state.file instanceof Error ? Promise.reject(state.file) : Promise.resolve(state.file === null ? null : bytes(state.file));
    },
    modify: (path, edit) => {
      assert.equal(path, SETTINGS_FILE);
      const exists = typeof state.file === 'string';
      const next = edit(exists ? state.file as string : '', exists);
      if (next !== state.file) { state.file = next; state.writes++; }
      return Promise.resolve();
    },
    loadData: async () => {
      const n = ++reads;
      await init.hold?.(n);
      const value: unknown = state.data === undefined ? undefined : JSON.parse(JSON.stringify(state.data));
      init.onData?.(n);
      return value;
    },
  });
  const store = createSettingsStore({ load: () => settingsFile.load(), save: (data, expect) => settingsFile.save(data, expect), seed: () => settingsFile.confirmed(), adopted: raw => { settingsFile.adopted(raw); }, today: () => '2026-11-12' });
  const json = (): unknown => typeof state.file === 'string' ? JSON.parse(state.file) : state.file;
  return { state, store, json, settingsFile };
}
const cap = (value: number | null): SettingsChange => ({ key: 'capMinutes', value });

void test('位置', () => {
  assert.equal(SETTINGS_FILE, 'Essence Cards/設定.json');
});

void test('疊：legacy 和 data.json 不同的項目換成 data.json 的，其他留設定檔的', () => {
  const file = { capMinutes: 45, retention: 0.9, legacy: { capMinutes: 30, retention: 0.8 } };
  assert.deepEqual(overlayLegacy(file, { capMinutes: 15, retention: 0.8 }), { capMinutes: 15, retention: 0.9, legacy: { capMinutes: 30, retention: 0.8 } });
});

void test('疊：data.json 拿掉一項，設定檔的那一項也拿掉（回預設）', () => {
  const file = { capMinutes: 45, legacy: { capMinutes: 30 } };
  assert.deepEqual(overlayLegacy(file, {}), { legacy: { capMinutes: 30 } });
});

void test('疊：data.json 多了一項，設定檔跟著有', () => {
  const file = { capMinutes: 45, legacy: {} };
  assert.deepEqual(overlayLegacy(file, { examCountdown: false }), { capMinutes: 45, examCountdown: false, legacy: {} });
});

void test('疊：學期與設定日是一項，一起換；兩欄都拿掉才算拿掉', () => {
  const file = { semester: '國二上', semesterSetOn: '2026-09-15', legacy: { semester: '國二上', semesterSetOn: '2026-09-01' } };
  assert.deepEqual(overlayLegacy(file, { semester: '國一下', semesterSetOn: '2026-11-01' }),
    { semester: '國一下', semesterSetOn: '2026-11-01', legacy: { semester: '國二上', semesterSetOn: '2026-09-01' } });
  assert.deepEqual(overlayLegacy(file, {}), { legacy: { semester: '國二上', semesterSetOn: '2026-09-01' } });
});

// 格式查核第 3 節：data.json 讀不懂的值是壞掉或手改，不是舊版設定頁存的，不能蓋掉設定檔裡讀得懂的值（之後存檔也不會把它帶進設定檔）。
void test('疊：data.json 那一項讀不懂（不是設定頁的選項、學期缺一半）就不採用，留設定檔的；比的時候照原樣', () => {
  const file = { capMinutes: 45, legacy: { capMinutes: 'x' } };
  assert.deepEqual(overlayLegacy(file, { capMinutes: 'x' }), file);
  for (const bad of [7, 31, '15', null]) assert.deepEqual(overlayLegacy(file, { capMinutes: bad }), file, JSON.stringify(bad));
  assert.deepEqual(overlayLegacy(file, { capMinutes: 15 }), { capMinutes: 15, legacy: { capMinutes: 'x' } });
  const term = { semester: '國二上', semesterSetOn: '2026-09-15', legacy: { semester: '國二上', semesterSetOn: '2026-09-01' } };
  for (const half of [{ semester: '國一下' }, { semesterSetOn: '2026-11-01' }, { semester: '國一下', semesterSetOn: '2027-02-29' }]) {
    assert.deepEqual(overlayLegacy(term, half), term, JSON.stringify(half));
  }
});

void test('不疊：data.json 不是物件、legacy 不是物件', () => {
  const file = { capMinutes: 45, legacy: { capMinutes: 30 } };
  for (const data of [null, undefined, [1], 'x']) assert.deepEqual(overlayLegacy(file, data), file);
  for (const legacy of [null, undefined, [1], 3]) {
    const other = { capMinutes: 45, legacy };
    assert.deepEqual(overlayLegacy(other, { capMinutes: 15 }), other);
  }
  assert.deepEqual(overlayLegacy({ capMinutes: 45 }, { capMinutes: 15 }), { capMinutes: 45 });
});

void test('疊不改傳進來的物件，不認得的欄位不看', () => {
  const file = { capMinutes: 45, foo: 1, legacy: { capMinutes: 30, foo: 2 } };
  const copy = JSON.parse(JSON.stringify(file)) as unknown;
  assert.deepEqual(overlayLegacy(file, { capMinutes: 30, foo: 3 }), file);
  assert.deepEqual(file, copy);
});

// 格式查核第 3 節：legacy 要和疊出底稿的那一次讀到的 data.json 同一份。讀的時候就換好（load），寫入照交來的寫；
// 交來的沒有 legacy（還原、重新建立以空的或拿掉 legacy 的內容當底）才用寫入當下的 data.json，讀不到是 null。
void test('寫入：交來的 legacy 照寫（不是物件是 null），兩格縮排加換行', () => {
  const text = encodeSettings({ capMinutes: 45, foo: 1, legacy: { capMinutes: 1 } }, { capMinutes: 30 });
  assert.equal(text, JSON.stringify({ capMinutes: 45, foo: 1, legacy: { capMinutes: 1 } }, null, 2) + '\n');
  assert.deepEqual(JSON.parse(encodeSettings({ capMinutes: 45, legacy: 'bad' }, { capMinutes: 30 })), { capMinutes: 45, legacy: null });
});

void test('寫入：交來的沒有 legacy，用 data.json 的五個欄位（照原樣），data.json 不是物件是 null', () => {
  const text = encodeSettings({ capMinutes: 45, foo: 1 }, { capMinutes: 30, retention: 'x', other: true, semesterSetOn: '2026-09-01' });
  assert.equal(text, JSON.stringify({ capMinutes: 45, foo: 1, legacy: { capMinutes: 30, retention: 'x', semesterSetOn: '2026-09-01' } }, null, 2) + '\n');
  for (const data of [null, undefined, [1]]) assert.deepEqual(JSON.parse(encodeSettings({ capMinutes: 45 }, data)), { capMinutes: 45, legacy: null });
  assert.deepEqual(dropLegacy({ capMinutes: 45, foo: 1, legacy: { capMinutes: 30 } }), { capMinutes: 45, foo: 1 });
});

void test('讀：JSON 物件才算，含 NUL、不是物件、壞掉都是讀不到', () => {
  assert.deepEqual(decodeSettings(bytes('{"capMinutes":45}')), { capMinutes: 45 });
  // 手改時記事本加的 BOM 不算壞（TextDecoder 預設拿掉）。
  assert.deepEqual(decodeSettings(bytes('﻿{"capMinutes":45}')), { capMinutes: 45 });
  for (const text of ['[1]', '3', 'null', '{', '', '{"a":1}\u0000']) assert.equal(decodeSettings(bytes(text)), undefined, text);
});

// 接線（§2）：store 的 load、save 換成設定檔，隊伍與核對照舊。

void test('改一項：寫進設定檔、帶 legacy，data.json 不動（§6-1）', async () => {
  const { state, store, json } = vault({ data: { capMinutes: 15 } });
  await store.first();
  assert.equal(await store.change(cap(45)), 'saved');
  assert.deepEqual(json(), { capMinutes: 45, legacy: { capMinutes: 15 } });
  assert.deepEqual(state.data, { capMinutes: 15 });
  assert.equal(store.value().settings.capMinutes, 45);
  assert.equal(state.file, JSON.stringify({ capMinutes: 45, legacy: { capMinutes: 15 } }, null, 2) + '\n');
});

void test('沒有設定檔：照 data.json 的值；第一次改才建立，帶上原本的三欄（§6-2）', async () => {
  const data = { capMinutes: 45, semester: '國二上', semesterSetOn: '2026-09-15' };
  const { store, json } = vault({ data });
  const first = await store.first();
  assert.equal(first.settings.capMinutes, 45);
  assert.equal(first.semester?.value, '國二上');
  assert.equal(store.semester(), '國二上');
  assert.equal(json(), null);
  assert.equal(await store.change({ key: 'retention', value: 0.85 }), 'saved');
  assert.deepEqual(json(), { ...data, retention: 0.85, legacy: data });
});

void test('疊：舊版那台在設定檔建立之後改的項目採用，新版改的不被蓋掉（§6-3）', async () => {
  const file = JSON.stringify({ capMinutes: 45, retention: 0.9, legacy: { capMinutes: 30, retention: 0.8 } });
  const one = vault({ file, data: { capMinutes: 15, retention: 0.8 } });
  await one.store.first();
  assert.equal(one.store.value().settings.capMinutes, 15);
  assert.equal(one.store.value().settings.retention, 0.9);
  const two = vault({ file, data: { retention: 0.8 } });
  await two.store.first();
  assert.equal(two.store.value().settings.capMinutes, 30);
  assert.deepEqual(two.store.saved(), ['retention']);
});

void test('疊之後再存：疊上的值寫進設定檔，legacy 換成現在的 data.json', async () => {
  const { store, json } = vault({ file: JSON.stringify({ capMinutes: 45, retention: 0.9, legacy: { capMinutes: 30, retention: 0.8 } }), data: { capMinutes: 15, retention: 0.8 } });
  await store.first();
  assert.equal(await store.change({ key: 'examCountdown', value: false }), 'saved');
  assert.deepEqual(json(), { capMinutes: 15, retention: 0.9, examCountdown: false, legacy: { capMinutes: 15, retention: 0.8 } });
  assert.equal(store.value().settings.capMinutes, 15);
});

void test('不疊：data.json 不存在、讀不到、不是物件，或 legacy 是 null（§6-4）', async () => {
  const file = JSON.stringify({ capMinutes: 45, legacy: { capMinutes: 30 } });
  for (const data of [null, undefined, [1], 'x']) {
    const { store } = vault({ file, data });
    await store.first();
    assert.equal(store.value().settings.capMinutes, 45, JSON.stringify(data));
    assert.equal(store.value().known, true);
  }
  const { store } = vault({ file: JSON.stringify({ capMinutes: 45, legacy: null }), data: { capMinutes: 15 } });
  await store.first();
  assert.equal(store.value().settings.capMinutes, 45);
});

void test('寫入時 data.json 讀不到：legacy 沿用原本的；原本沒有是 null（§6-5）', async () => {
  const kept = vault({ file: JSON.stringify({ capMinutes: 45, legacy: { capMinutes: 30 } }), data: undefined });
  await kept.store.first();
  assert.equal(await kept.store.change(cap(60)), 'saved');
  assert.deepEqual(kept.json(), { capMinutes: 60, legacy: { capMinutes: 30 } });
  const none = vault({ data: null });
  await none.store.first();
  assert.equal(await none.store.change(cap(60)), 'saved');
  assert.deepEqual(none.json(), { capMinutes: 60, legacy: null });
});

// 格式查核第 3 節的時序：當底的那一次讀到 data.json 上限 30，寫之前舊版那台改成 15。legacy 要記 30（當底時看到的），
// 15 才會在讀回時疊上、下一次存檔落進設定檔；記成 15 會把這次沒採用的改動當成已經看過，之後再也不採用。
void test('疊與寫入同一份 data.json：當底之後才變的 data.json 不算看過，讀回時疊上，下次存檔落進設定檔', async () => {
  const one = vault({ file: JSON.stringify({ capMinutes: 45, legacy: { capMinutes: 30 } }), data: { capMinutes: 30 }, onData: n => { if (n === 2) one.state.data = { capMinutes: 15 }; } });
  await one.store.first();
  assert.equal(one.store.value().settings.capMinutes, 45);
  assert.equal(await one.store.change({ key: 'retention', value: 0.85 }), 'saved');
  assert.deepEqual(one.json(), { capMinutes: 45, retention: 0.85, legacy: { capMinutes: 30 } });
  assert.equal(one.store.value().settings.capMinutes, 15);
  assert.equal(one.store.value().settings.retention, 0.85);
  assert.equal(await one.store.change({ key: 'examCountdown', value: false }), 'saved');
  assert.deepEqual(one.json(), { capMinutes: 15, retention: 0.85, examCountdown: false, legacy: { capMinutes: 15 } });
  // 沒有設定檔、照 data.json 讀的時候也一樣：當底的是 30，legacy 就是 30。
  const two = vault({ data: { capMinutes: 30 }, onData: n => { if (n === 2) two.state.data = { capMinutes: 15 }; } });
  await two.store.first();
  assert.equal(await two.store.change({ key: 'retention', value: 0.85 }), 'saved');
  assert.deepEqual(two.json(), { capMinutes: 30, retention: 0.85, legacy: { capMinutes: 30 } });
  assert.equal(two.store.value().settings.capMinutes, 15);
});

// 還原與重新建立是家長選的一整份值：寫入當下的 data.json 當成已經看過，讀不到是 null，不沿用設定檔原本的 legacy
// （格式查核第 4 節的例子：沿用舊的基準，data.json 之後回來就把剛還原的值蓋掉）。
void test('還原：以拿掉 legacy 的設定檔當底，legacy 是寫入當下的 data.json，讀不到是 null；之後 data.json 回來也不蓋掉還原的值', async () => {
  const restoreWith = async (data: unknown) => {
    const one = vault({ file: JSON.stringify({ capMinutes: 30, foo: 1, legacy: { capMinutes: 30 } }), data });
    await one.store.first();
    const base = () => Promise.resolve({ raw: dropLegacy(decodeSettings(bytes(one.state.file as string)) ?? {}), expect: one.state.file as string });
    assert.equal(await one.store.restore({ capMinutes: 60 }, base), 'saved');
    return one;
  };
  const seen = await restoreWith({ capMinutes: 15 });
  assert.deepEqual(seen.json(), { capMinutes: 60, foo: 1, legacy: { capMinutes: 15 } });
  assert.equal(seen.store.value().settings.capMinutes, 60);
  const unread = await restoreWith(undefined);
  assert.deepEqual(unread.json(), { capMinutes: 60, foo: 1, legacy: null });
  unread.state.data = { capMinutes: 15 };
  await unread.store.reload();
  assert.equal(unread.store.value().settings.capMinutes, 60);
});

void test('載入之後沒有任何寫入（§6-6）', async () => {
  const cases = [{}, { data: { capMinutes: 15 } }, { file: JSON.stringify({ capMinutes: 45, legacy: { capMinutes: 30 } }), data: { capMinutes: 15 } }, { file: '{', data: { capMinutes: 15 } }];
  for (const init of cases) {
    const { state, store } = vault(init);
    await store.first();
    await store.reload();
    assert.equal(state.writes, 0, JSON.stringify(init));
  }
});

void test('沒有設定檔也沒有 data.json：預設值、known 是 true（§6-8）', async () => {
  const { store, json } = vault();
  const first = await store.first();
  assert.equal(first.settings.capMinutes, 30);
  assert.equal(first.known, true);
  assert.equal(json(), null);
});

void test('設定檔讀不到、壞掉：不採用、不寫，改設定回 unreadable', async () => {
  for (const file of [Error('EPERM'), '{', '{"capMinutes":45}\u0000']) {
    const { state, store } = vault({ file, data: { capMinutes: 15 } });
    const first = await store.first();
    assert.equal(first.known, false, String(file));
    assert.equal(first.settings.capMinutes, 30);
    assert.equal(await store.change(cap(60)), 'unreadable');
    assert.equal(state.writes, 0);
  }
});

void test('別台改了設定檔：重讀就採用', async () => {
  const { state, store } = vault({ file: JSON.stringify({ capMinutes: 45, legacy: null }) });
  await store.first();
  state.file = JSON.stringify({ capMinutes: 60, legacy: null });
  await store.reload();
  assert.equal(store.value().settings.capMinutes, 60);
});

void test('重讀的路徑：設定檔（含大小寫、正規化不同），其他不算（§6-9）', () => {
  assert.equal(isSettingsPath(SETTINGS_FILE), true);
  assert.equal(isSettingsPath('essence cards/設定.JSON'), true);
  assert.equal(isSettingsPath(SETTINGS_FILE.normalize('NFD')), true);
  for (const path of ['Essence Cards/設定.json.bak', 'Essence Cards/紀錄/設定.json', '設定.json', 'Essence Cards/設定 2.json', '.obsidian/plugins/essence-cards/data.json']) assert.equal(isSettingsPath(path), false, path);
});

// 設定檔不見時（§3）：用這台上次確認的值，不回預設、不寫；家長按「重新建立」才寫。

void test('讀到設定檔就記下這台確認過的五個欄位（疊完的，不含 legacy 與不認得的）', async () => {
  const { state, store, settingsFile } = vault({ file: JSON.stringify({ capMinutes: 45, retention: 0.9, foo: 1, legacy: { capMinutes: 30, retention: 0.8 } }), data: { capMinutes: 15, retention: 0.8 } });
  await store.first();
  assert.deepEqual(state.confirmed, { capMinutes: 15, retention: 0.9 });
  assert.deepEqual(settingsFile.confirmed(), { capMinutes: 15, retention: 0.9 });
  assert.equal(settingsFile.missing(), false);
  await store.reload();
  assert.equal(state.confirms, 1, '內容沒變不再寫一次');
});

// L2 的 R4：store 不採用逾時之後才回來的讀，這台確認過的值也不能跟著它改回去；檔接著不見時，排程與重新建立用的是畫面上的值。
void test('逾時之後才回來的讀不改這台確認過的值：只記 store 採用的那一次', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => { setImmediate(resolve); }); };
  let release = (): void => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const { state, store, settingsFile } = vault({ file: JSON.stringify({ capMinutes: 45, legacy: null }), hold: n => n === 1 ? held : undefined });
  const first = store.first();
  await flush();
  t.mock.timers.tick(2000);
  await first;
  t.mock.timers.tick(3000);
  await flush();
  state.file = JSON.stringify({ capMinutes: 75, legacy: null });
  await store.reload();
  assert.equal(store.value().settings.capMinutes, 75);
  assert.deepEqual(state.confirmed, { capMinutes: 75 });
  release();
  await flush();
  assert.equal(store.value().settings.capMinutes, 75);
  assert.deepEqual(state.confirmed, { capMinutes: 75 }, '晚到的 45 沒被採用，也不記');
  state.file = null;
  await store.reload();
  assert.equal(settingsFile.missing(), true);
  assert.equal(await settingsFile.recreate(store), 'saved');
  assert.equal(store.value().settings.capMinutes, 75);
});

void test('沒有設定檔時照 data.json 讀，不記確認', async () => {
  const { state, store, settingsFile } = vault({ data: { capMinutes: 45 } });
  await store.first();
  assert.equal(state.confirmed, null);
  assert.equal(settingsFile.missing(), false);
});

void test('確認過、設定檔不見：用確認過的值、known 是 false；改設定不寫（§6-7）', async () => {
  const { state, store, settingsFile } = vault({ data: { capMinutes: 15 }, confirmed: { capMinutes: 45, semester: '國二上', semesterSetOn: '2026-09-15' } });
  const first = await store.first();
  assert.equal(first.settings.capMinutes, 45);
  assert.equal(first.semester?.value, '國二上');
  assert.equal(first.known, false);
  assert.equal(settingsFile.missing(), true);
  assert.equal(state.missing, 1);
  assert.equal(await store.change(cap(60)), 'unreadable');
  assert.equal(state.file, null);
  assert.equal(state.writes, 0);
});

void test('重新建立：寫出確認過的值加 legacy，之後 known 是 true、那一列消失（§6-7）', async () => {
  const { state, store, json, settingsFile } = vault({ data: { capMinutes: 15 }, confirmed: { capMinutes: 45, retention: 0.9 } });
  await store.first();
  assert.equal(await settingsFile.recreate(store), 'saved');
  assert.deepEqual(json(), { capMinutes: 45, retention: 0.9, legacy: { capMinutes: 15 } });
  assert.equal(store.value().known, true);
  assert.equal(store.value().settings.capMinutes, 45);
  assert.equal(settingsFile.missing(), false);
  assert.equal(state.missing, 2);
  assert.equal(await store.change(cap(60)), 'saved');
});

void test('重新建立時設定檔已經回來：不寫，回 changed（§6-7）', async () => {
  const { state, store, settingsFile } = vault({ confirmed: { capMinutes: 45 } });
  await store.first();
  state.file = JSON.stringify({ capMinutes: 75, legacy: null });
  assert.equal(await settingsFile.recreate(store), 'changed');
  assert.equal(state.writes, 0);
  await store.reload();
  assert.equal(store.value().settings.capMinutes, 75);
  assert.equal(settingsFile.missing(), false);
});

// L2 的 R1：用到一半不見和開啟時就不在一樣，known 是 false（不寫設定的觀察行），回來才變回 true。
// L2 的 R2：比對（再讀一次還是不存在）之後、真的寫入之前，同步把檔送回來，寫入那一刻要再比一次，不蓋掉它。
void test('重新建立：比對之後、寫入之前設定檔才回來：不寫，回 changed', async () => {
  const back = JSON.stringify({ capMinutes: 75, foo: 1, legacy: null });
  const one = vault({ data: { capMinutes: 15 }, confirmed: { capMinutes: 45 }, onData: () => { one.state.file = back; } });
  const { state, store, settingsFile } = one;
  await store.first();
  assert.equal(await settingsFile.recreate(store), 'changed');
  assert.equal(state.file, back);
  assert.equal(state.writes, 0);
  await store.reload();
  assert.equal(store.value().settings.capMinutes, 75);
});

void test('還原：比對之後、寫入之前設定檔被改：不寫，回 changed；開頭有 BOM 的檔照樣比得到相同', async () => {
  for (const bom of ['', '﻿']) {
    const seen = bom + JSON.stringify({ capMinutes: 30, legacy: null });
    const other = JSON.stringify({ capMinutes: 75, foo: 1, legacy: null });
    let swap = false;
    const one = vault({ file: seen, onData: () => { if (swap) one.state.file = other; } });
    const { state, store } = one;
    await store.first();
    const base = () => Promise.resolve({ raw: dropLegacy(decodeSettings(bytes(seen)) ?? {}), expect: settingsText(bytes(seen)) });
    swap = true;
    assert.equal(await store.restore({ capMinutes: 60 }, base), 'changed', JSON.stringify(bom));
    assert.equal(state.file, other);
    swap = false;
    state.file = seen;
    assert.equal(await store.restore({ capMinutes: 60 }, base), 'saved', JSON.stringify(bom));
    assert.deepEqual(one.json(), { capMinutes: 60, legacy: null });
  }
});

void test('這次見過、之後不見：值不變、known 變 false、那一列出現；回來就消失、known 變回 true', async () => {
  const { state, store, settingsFile } = vault({ file: JSON.stringify({ capMinutes: 45, legacy: null }) });
  const told: boolean[] = [];
  store.onChange(value => { told.push(value.known); });
  await store.first();
  assert.equal(store.value().known, true);
  const file = state.file;
  state.file = null;
  await store.reload();
  assert.equal(store.value().settings.capMinutes, 45);
  assert.equal(store.value().known, false);
  assert.equal(settingsFile.missing(), true);
  assert.equal(state.missing, 1);
  assert.equal(await store.change(cap(60)), 'unreadable');
  assert.equal(state.writes, 0);
  state.file = file;
  await store.reload();
  assert.equal(store.value().known, true);
  assert.equal(settingsFile.missing(), false);
  assert.equal(state.missing, 2);
  assert.deepEqual(told, [true, false, true]);
});

void test('改設定時才發現不見：回 unreadable，known 也變 false', async () => {
  const { state, store, settingsFile } = vault({ file: JSON.stringify({ capMinutes: 45, legacy: null }) });
  await store.first();
  state.file = null;
  assert.equal(await store.change(cap(60)), 'unreadable');
  assert.equal(store.value().known, false);
  assert.equal(settingsFile.missing(), true);
  assert.equal(state.writes, 0);
});

// 不見和讀不懂分開（D-201 第 5 點與〈代價〉）：檔還在、內容讀不懂照讀不到的規則，手上的值與 known 不變，不出現那一列，重新建立不蓋掉它。
void test('用到一半讀不懂（壞掉、含 NUL）：手上的值與 known 不變、那一列不出現；重新建立不寫', async () => {
  for (const bad of ['{', '{"capMinutes":60}\u0000']) {
    const { state, store, settingsFile } = vault({ file: JSON.stringify({ capMinutes: 45, legacy: null }) });
    await store.first();
    state.file = bad;
    await store.reload();
    assert.equal(store.value().settings.capMinutes, 45, JSON.stringify(bad));
    assert.equal(store.value().known, true);
    assert.equal(settingsFile.missing(), false);
    assert.equal(await settingsFile.recreate(store), 'changed');
    assert.equal(state.file, bad);
  }
});

void test('設定檔讀不到（丟錯）：那一列不變', async () => {
  const { state, store, settingsFile } = vault({ file: Error('EPERM'), confirmed: { capMinutes: 45 } });
  await store.first();
  assert.equal(settingsFile.missing(), false);
  assert.equal(state.missing, 0);
  assert.equal(store.value().settings.capMinutes, 45, '還是用確認過的值');
});

void test('確認過的那一筆讀不懂：當成沒確認過', async () => {
  for (const confirmed of ['x', [1], 3]) {
    const { store, settingsFile } = vault({ data: { capMinutes: 15 }, confirmed });
    await store.first();
    assert.equal(settingsFile.confirmed(), null);
    assert.equal(settingsFile.missing(), false);
    assert.equal(store.value().settings.capMinutes, 15);
    assert.equal(store.value().known, true);
  }
});

// §6-12：這三個判斷從 v0.4.0 到這一版都沒改（git diff v0.4.0 -- src/core/deck/read.ts src/core/deck/folders.ts src/core/study/history.ts 是空的），
// 所以這裡測到的就是舊版的行為：舊版讀不到設定檔，也不會把它當卡組或紀錄。
void test('舊版不認設定檔（§6-12）：不是卡組、不是紀錄；系統資料夾的防呆照常，設定檔本身不算資料夾', () => {
  assert.equal(isDeckPath(SETTINGS_FILE), false);
  assert.equal(isLogPath(SETTINGS_FILE), false);
  assert.deepEqual(guardedMoves([SETTINGS_FILE]), []);
  assert.deepEqual(guardedMoves(['Essence Cards', SETTINGS_FILE]), ['Essence Cards']);
  assert.deepEqual(presentFolders([SETTINGS_FILE]), ['Essence Cards']);
});
