import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceCode, isDeviceCode } from '../src/state/index.ts';

void test('W5 裝置碼：平台加 4 個 0-9a-f，存著的有效碼沿用，無效的重新產生', () => {
  assert.equal(deviceCode(null, 'Windows', () => 0x7f3a), 'Windows-7f3a');
  assert.equal(deviceCode(undefined, 'iPhone', () => 0x0a), 'iPhone-000a');
  assert.equal(deviceCode(null, 'Device', () => 0x1ffff), 'Device-ffff');
  assert.equal(deviceCode('iPhone-7f3a', 'Windows', () => 0), 'iPhone-7f3a');
  for (const bad of ['iPhone-7F3A', 'iPhone-7f3', 'Phone-7f3a', 'iPhone-7f3a ', 42, {}]) {
    assert.equal(isDeviceCode(bad), false, JSON.stringify(bad));
    assert.equal(deviceCode(bad, 'Mac', () => 1), 'Mac-0001');
  }
});
