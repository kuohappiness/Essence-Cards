import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_FILE, decodeSettings, encodeSettings, overlayLegacy } from '../src/core/settings/index.ts';

// 設定檔 `Essence Cards/設定.json` 的內容與疊 legacy（tasks/settings-vault-file.md §1、§2）。例子照任務說明 §6 第 3～5 點。

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

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
