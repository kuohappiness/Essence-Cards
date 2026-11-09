import test from 'node:test';
import assert from 'node:assert/strict';
import { changeSaved, DEFAULT_SETTINGS, readSaved, savedKeys, valueOf } from '../src/core/settings/index.ts';

// data.json 的讀與改（tasks/settings-page.md §1、§2）：讀不懂的當沒設定，改的時候只動這次的欄位。

void test('空物件：全部沒設定，值是預設', () => {
  assert.deepEqual(readSaved({}), { capMinutes: null, retention: null, semester: null, examCountdown: null });
  const value = valueOf(readSaved({}), true);
  assert.deepEqual(value.settings, DEFAULT_SETTINGS);
  assert.equal(value.settings.capMinutes, 30);
  assert.equal(value.settings.retention, 0.8);
  assert.deepEqual(value.settings.filter, []);
  assert.equal(value.semester, null);
  assert.equal(value.examCountdown, true);
  assert.equal(value.known, true);
});

void test('存過的值讀得回來，等於預設的也算存過', () => {
  const saved = readSaved({ capMinutes: 45, retention: 0.85, semester: '國二上', semesterSetOn: '2026-09-15', examCountdown: false });
  assert.deepEqual(saved, { capMinutes: 45, retention: 0.85, semester: { value: '國二上', setOn: '2026-09-15' }, examCountdown: false });
  assert.deepEqual(readSaved({ capMinutes: 30 }).capMinutes, 30);
  assert.deepEqual(savedKeys({ capMinutes: 30 }), ['capMinutes']);
});

void test('讀不懂的值當沒設定', () => {
  for (const capMinutes of [7, '45', null, 45.5]) assert.equal(readSaved({ capMinutes }).capMinutes, null, String(capMinutes));
  for (const retention of [0.8001, 80, '0.8']) assert.equal(readSaved({ retention }).retention, null, String(retention));
  assert.equal(readSaved({ examCountdown: 'no' }).examCountdown, null);
  assert.equal(readSaved({ semester: '國二', semesterSetOn: '2026-09-15' }).semester, null);
  assert.equal(readSaved({ semester: '國二上', semesterSetOn: '2026-13-40' }).semester, null);
  assert.equal(readSaved({ semester: '國二上' }).semester, null);
  assert.equal(readSaved({ semesterSetOn: '2026-09-15' }).semester, null);
  assert.equal(readSaved({ semester: '國二上', semesterSetOn: '2027-02-29' }).semester, null);
  assert.deepEqual(readSaved({ semester: '國二上', semesterSetOn: '2028-02-29' }).semester, { value: '國二上', setOn: '2028-02-29' });
});

void test('改一項：其他欄位與不認得的欄位值不變', () => {
  const base = { foo: 1, nested: { a: [1, null] }, retention: 0.85 };
  const next = changeSaved(base, { key: 'capMinutes', value: 45 });
  assert.deepEqual(next, { foo: 1, nested: { a: [1, null] }, retention: 0.85, capMinutes: 45 });
  assert.deepEqual(base, { foo: 1, nested: { a: [1, null] }, retention: 0.85 }, '不改傳進來的物件');
});

void test('改別項時，讀不懂的值留著', () => {
  const next = changeSaved({ capMinutes: 7, examCountdown: 'no' }, { key: 'retention', value: 0.9 });
  assert.deepEqual(next, { capMinutes: 7, examCountdown: 'no', retention: 0.9 });
});

void test('選的值等於預設也寫；恢復預設才刪', () => {
  assert.deepEqual(changeSaved({}, { key: 'capMinutes', value: 30 }), { capMinutes: 30 });
  assert.deepEqual(changeSaved({ capMinutes: 30, retention: 0.9 }, { key: 'capMinutes', value: null }), { retention: 0.9 });
  assert.deepEqual(changeSaved({ capMinutes: 30 }, { key: 'capMinutes', value: null }), {});
  assert.deepEqual(changeSaved({}, { key: 'examCountdown', value: false }), { examCountdown: false });
});

void test('學期的兩個欄位一起寫、一起刪，底稿只剩一個也一樣', () => {
  assert.deepEqual(changeSaved({ semester: '舊' }, { key: 'semester', value: { value: '國二上', setOn: '2026-09-15' } }), { semester: '國二上', semesterSetOn: '2026-09-15' });
  assert.deepEqual(changeSaved({ semesterSetOn: '2026-09-15', foo: 1 }, { key: 'semester', value: null }), { foo: 1 });
  assert.deepEqual(savedKeys({ semesterSetOn: '2026-09-15' }), ['semester']);
});
