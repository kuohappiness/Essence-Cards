import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, type Mark } from '../src/dev/marks.ts';

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

void test('一筆紀錄混了兩種欄位（Codex L2 再審的 S3）：失敗，不讓 skipped 或 done 蓋掉另一種的結果；型別也不接受', () => {
  // 型別不接受混合的紀錄，這裡繞過型別，模擬沒照型別寫的呼叫端。
  const mixed = (value: object) => value as unknown as Mark;
  assert.equal(judge([mixed({ at: '混合', skipped: '未做', done: false }), filled]).ok, false);
  assert.equal(judge([mixed({ at: '混合', done: true, deck: 'P', ids: 0, expect: 1, issues: 0 })]).ok, false);
  assert.equal(judge([mixed({ at: '只有 detail', detail: 1 }), filled]).ok, false);
  // @ts-expect-error 型別擋得住混合的紀錄。
  const typed: Mark = { at: '混合', skipped: '未做', done: false };
  assert.ok(typed);
});

void test('C8、C11 的必要操作（Codex L2 再審的 S2）：版面裡少開了共同的卡組、丙沒有開成閱讀模式，就算 ID 都對也失敗', () => {
  assert.equal(judge([{ at: '版面 A 開著共同、只在A、A的背景', done: false }, { at: '換成版面 B', deck: '共同', ids: 0, expect: 0, issues: 0 }]).ok, false);
  assert.equal(judge([{ at: '丙、丁都開成閱讀模式', done: false, detail: { 丙: 'source', 丁: 'preview' } }, filled]).ok, false);
});
