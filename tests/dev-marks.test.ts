import test from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../src/dev/marks.ts';

// 開發命令 a3check 的判斷（技術債 A3；Codex L2 的 R1）：必要的操作沒做到，後面的 ID 相符也不能算通過；做不到的子項另外列成未測。
const filled = { at: '關掉之後', deck: '甲', ids: 1, expect: 1, issues: 0 };

void test('必要的操作沒做到（例如沒切成疊放）：就算 ID 都相符也失敗', () => {
  const result = judge([{ at: '切成疊放', done: false, detail: { executed: true, stacked: false } }, filled]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ['切成疊放：沒做到']);
});

void test('做不到的子項（例如沒在畫布裡打到字）列成未測，不算通過也不算失敗；其他檢查照算', () => {
  const result = judge([{ at: '在畫布裡打字', skipped: '找不到卡片的編輯器' }, { at: '畫布開著', deck: '甲', ids: 0, expect: 0, issues: 0 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.skipped, ['在畫布裡打字：找不到卡片的編輯器']);
});

void test('只有未測與觀察、沒有任何一項真的檢查過：不算通過', () => {
  assert.equal(judge([{ at: '版面還原的未載入分頁', skipped: '做不出來' }, { at: '版面 A', note: { deferred: false } }]).ok, false);
  assert.equal(judge([]).ok, false);
});

void test('ID 數或問題數不符、按鈕不符、出錯：失敗', () => {
  assert.equal(judge([{ ...filled, ids: 0 }]).ok, false);
  assert.equal(judge([{ ...filled, issues: 1 }]).ok, false);
  assert.equal(judge([{ at: '開卡組', button: null, expectButton: 'missing' }]).ok, false);
  assert.equal(judge([filled, { at: '情境', error: '右側欄開不出分頁' }]).ok, false);
  assert.equal(judge([filled, { at: '開卡組', button: 'missing', expectButton: 'missing' }, { at: '切成疊放', done: true }]).ok, true);
});
