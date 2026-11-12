import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_FILE, createSettingsFile, createSettingsStore, decodeSettings, encodeSettings, isSettingsPath, overlayLegacy } from '../src/core/settings/index.ts';
import type { SettingsChange } from '../src/core/settings/index.ts';

// 設定檔 `Essence Cards/設定.json` 的內容與疊 legacy（tasks/settings-vault-file.md §1、§2）。例子照任務說明 §6。

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * 替身：設定檔是文字（null 不存在、Error 讀不到）；data.json 照 Obsidian 的 loadData（null 不存在、undefined 讀不到）；
 * confirmed 是這台的 localStorage 那一筆（§3），missing 是「設定檔讀不到」那一列換了幾次。沒有寫 data.json 的口。
 */
function vault(init: { file?: string | null | Error; data?: unknown; confirmed?: unknown } = {}) {
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
    loadData: () => Promise.resolve(state.data === undefined ? undefined : JSON.parse(JSON.stringify(state.data))),
  });
  const store = createSettingsStore({ load: () => settingsFile.load(), save: data => settingsFile.save(data), seed: () => settingsFile.confirmed(), today: () => '2026-11-12' });
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

void test('疊：學期與設定日是一項，一起換', () => {
  const file = { semester: '國二上', semesterSetOn: '2026-09-15', legacy: { semester: '國二上', semesterSetOn: '2026-09-01' } };
  assert.deepEqual(overlayLegacy(file, { semester: '國一下' }),
    { semester: '國一下', legacy: { semester: '國二上', semesterSetOn: '2026-09-01' } });
});

void test('疊：讀不懂的值照原樣比、照原樣換', () => {
  const file = { capMinutes: 45, legacy: { capMinutes: 'x' } };
  assert.deepEqual(overlayLegacy(file, { capMinutes: 'x' }), file);
  assert.deepEqual(overlayLegacy(file, { capMinutes: 7 }), { capMinutes: 7, legacy: { capMinutes: 'x' } });
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

void test('寫入：legacy 是 data.json 的五個欄位，兩格縮排加換行', () => {
  const text = encodeSettings({ capMinutes: 45, foo: 1, legacy: { capMinutes: 1 } }, { capMinutes: 30, retention: 'x', other: true, semesterSetOn: '2026-09-01' });
  assert.equal(text, JSON.stringify({ capMinutes: 45, foo: 1, legacy: { capMinutes: 30, retention: 'x', semesterSetOn: '2026-09-01' } }, null, 2) + '\n');
});

void test('寫入：data.json 不是物件就沿用原本的 legacy，原本沒有是 null', () => {
  assert.deepEqual(JSON.parse(encodeSettings({ capMinutes: 45, legacy: { capMinutes: 30 } }, null)), { capMinutes: 45, legacy: { capMinutes: 30 } });
  assert.deepEqual(JSON.parse(encodeSettings({ capMinutes: 45 }, undefined)), { capMinutes: 45, legacy: null });
  assert.deepEqual(JSON.parse(encodeSettings({ capMinutes: 45, legacy: 'bad' }, [1])), { capMinutes: 45, legacy: null });
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

void test('這次見過、之後不見：值不變、那一列出現；回來就消失', async () => {
  const { state, store, settingsFile } = vault({ file: JSON.stringify({ capMinutes: 45, legacy: null }) });
  await store.first();
  const file = state.file;
  state.file = null;
  await store.reload();
  assert.equal(store.value().settings.capMinutes, 45);
  assert.equal(settingsFile.missing(), true);
  assert.equal(state.missing, 1);
  state.file = file;
  await store.reload();
  assert.equal(settingsFile.missing(), false);
  assert.equal(state.missing, 2);
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
