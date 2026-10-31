import test from 'node:test';
import assert from 'node:assert/strict';
import { movedUp } from '../src/dev/move.ts';

// 開發命令 lock 的「上下移動整行」（技術債 N1）：命令沒執行、或正文沒變，就算那一行還在也不能算通過。
const before = '- 能說明擴散 ^k3m9x2\n    - Q1 :: A1\n- 能說明溶解 ^p7q2w8\n    - Q2 :: A2\n';
const swapped = '- 能說明擴散 ^k3m9x2\n- 能說明溶解 ^p7q2w8\n    - Q1 :: A1\n    - Q2 :: A2\n';
const B = '- 能說明溶解 ^p7q2w8';

void test('命令執行了、那一行往上移、其他行都還在：做到', () => {
  assert.equal(movedUp(true, before, swapped, B), true);
});

void test('反例：命令沒執行（executeCommandById 回傳 false）、正文完全不變：沒做到', () => {
  assert.equal(movedUp(false, before, before, B), false);
});

void test('反例：命令回傳 true 但正文沒變：沒做到', () => {
  assert.equal(movedUp(true, before, before, B), false);
});

void test('反例：命令沒執行，正文卻變了（別的原因）：沒做到', () => {
  assert.equal(movedUp(false, before, swapped, B), false);
});

void test('反例：那一行往上移了，但少了一行或多了一行：沒做到；往下移也不算', () => {
  assert.equal(movedUp(true, before, '- 能說明擴散 ^k3m9x2\n- 能說明溶解 ^p7q2w8\n    - Q2 :: A2\n', B), false);
  assert.equal(movedUp(true, before, swapped + '多的一行\n', B), false);
  assert.equal(movedUp(true, before, '- 能說明擴散 ^k3m9x2\n    - Q1 :: A1\n    - Q2 :: A2\n- 能說明溶解 ^p7q2w8\n', B), false);
  assert.equal(movedUp(true, before, swapped.replace(B, '- 能說明溶解'), B), false, '那一行不見了');
});
