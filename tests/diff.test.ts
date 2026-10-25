import test from 'node:test';
import assert from 'node:assert/strict';
import { assignIds } from '../src/core/deck/index.ts';
import { applyChanges, textChanges } from '../src/obsidian/diff.ts';

// 開著的筆記寫回時只改有變的部分（W5 §8-2 第 4 點）。
void test('補 ID 只在行尾加字：每一個 ID 一個修改，不碰其他行', () => {
  const before = '- 能說明 A\n    - Q1 :: A1\n- 能說明 B ^b23456\n    - Q2 :: A2\n- 能說明 C\n    - Q3 :: A3\n';
  const after = assignIds(before, { taken: new Set(), random: () => 0 }).text;
  const changes = textChanges(before, after);
  assert.deepEqual(changes, [
    { from: before.indexOf('\n'), to: before.indexOf('\n'), insert: ' ^aaaaaa' },
    { from: before.indexOf('\n    - Q3'), to: before.indexOf('\n    - Q3'), insert: ' ^aaaaab' },
  ]);
  assert.equal(applyChanges(before, changes), after);
});

void test('implicit 補名稱是插入一行並縮排原題；歸位、縮排改正、CRLF 都只改不同的地方', () => {
  for (const before of [
    '- 目標 ^k3m9x2\n    - Q :: A\n- borrow :: 借入\n- 另一個 ^p7q2w8\n    - R :: B',
    '- 能說明擴散 ^k3m9x2 的現象\r\n    - Q :: A\r\n',
    '- 目標 ^k3m9x2\n        - Q :: A\n            - 例句：x\n- 中文😀 ^p7q2w8\n    - R :: B\n',
  ]) {
    const after = assignIds(before, { taken: new Set(), random: () => 0 }).text;
    assert.notEqual(after, before);
    const changes = textChanges(before, after);
    assert.equal(applyChanges(before, changes), after, JSON.stringify(before));
    for (let i = 1; i < changes.length; i++) assert.ok(changes[i].from >= changes[i - 1].to, '照位置排好、不重疊');
    // 沒有改到的行不在任何修改裡。
    const untouched = before.split('\n').filter(line => after.split('\n').includes(line) && line.includes('R :: B'));
    for (const line of untouched) {
      const at = before.indexOf(line);
      assert.ok(changes.every(c => c.to <= at || c.from >= at + line.length), line);
    }
  }
});

void test('相同時沒有修改；整篇不同時仍然正確', () => {
  assert.deepEqual(textChanges('abc', 'abc'), []);
  for (const [a, b] of [['', 'x'], ['x', ''], ['a\nb\nc', 'c\nb\na'], ['一\r\n二', '一\n二\n'], ['😀', '😁']]) {
    assert.equal(applyChanges(a, textChanges(a, b)), b, JSON.stringify([a, b]));
  }
});
