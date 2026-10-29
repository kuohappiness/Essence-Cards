import test from 'node:test';
import assert from 'node:assert/strict';
import { canRead, releaseOf } from '../src/core/version/index.ts';

// 最低版本標記的比較（syntax.md §0-1、任務說明 2-3 的第一點）。預期值都是規格寫的例子或直接寫出的大小。

void test('§0-1 三段各自當整數比：0.10.0 比 0.9.0 新', () => {
  assert.equal(canRead('0.10.0', '0.9.0'), false);
  assert.equal(canRead('0.9.0', '0.10.0'), true);
  assert.equal(canRead('1.0.0', '0.99.99'), false);
  assert.equal(canRead('0.6.1', '0.6.0'), false);
  assert.equal(canRead('0.5.9', '0.6.0'), true);
});

void test('§0-1 相同版本讀得懂；0 本身不算前導零', () => {
  assert.equal(canRead('0.6.0', '0.6.0'), true);
  assert.equal(canRead('0.0.0', '0.0.0'), true);
  assert.equal(canRead('10.0.0', '10.0.0'), true);
});

void test('§0-1 這台的版本是 BUILD 的 + 前面：不同 commit、.dirty 的能力相同', () => {
  assert.equal(releaseOf('0.6.0+1a2b3c4'), '0.6.0');
  assert.equal(releaseOf('0.6.0+9f8e7d6.dirty'), '0.6.0');
  assert.equal(releaseOf('0.6.0'), '0.6.0');
  assert.equal(canRead('0.6.0', releaseOf('0.6.0+1a2b3c4')), true);
  assert.equal(canRead('0.6.0', releaseOf('0.6.0+9f8e7d6.dirty')), true);
  assert.equal(canRead('0.6.1', releaseOf('0.6.0+1a2b3c4')), false);
});

void test('§0-1 標記本身帶 +commit 是讀不懂', () => {
  assert.equal(canRead('0.6.0+1a2b3c4', '0.6.0'), false);
  assert.equal(canRead('0.5.0+1a2b3c4', '0.6.0'), false);
});

void test('§0-1 格式不對都是讀不懂（有標記但壞掉不等於沒有標記）', () => {
  for (const need of ['0.6', 'v0.6.0', '0.6.0-beta', '01.2.0', '0.01.0', '0.6.00', 'abc', '', ' 0.6.0', '0.6.0 ', '0.6.0.0', '０.6.0', '-1.0.0', '1e3.0.0', 0.6, 6, null, undefined, true, ['0.6.0'], { v: '0.6.0' }]) {
    assert.equal(canRead(need, '9.9.9'), false, JSON.stringify(need) ?? 'undefined');
  }
});

void test('§0-1 超過安全整數的兩個值也比得出大小', () => {
  assert.equal(canRead('9007199254740993.0.0', '9007199254740992.0.0'), false);
  assert.equal(canRead('9007199254740992.0.0', '9007199254740993.0.0'), true);
  assert.equal(canRead('0.9007199254740993.0', '0.9007199254740992.0'), false);
  assert.equal(canRead('0.0.9007199254740993', '0.0.9007199254740992'), false);
  assert.equal(canRead('0.0.9007199254740992', '0.0.9007199254740993'), true);
  assert.equal(canRead('100000000000000000000.0.0', '99999999999999999999.0.0'), false);
});

void test('這台的版本不明（BUILD 的 + 前面不是正式版號）：任何標記都讀不懂', () => {
  for (const build of ['', 'dev', '0.6+abc', 'v0.6.0+abc', '+abc']) assert.equal(releaseOf(build), null, build);
  assert.equal(canRead('0.0.0', null), false);
  assert.equal(canRead('0.6.0', releaseOf('dev')), false);
});
