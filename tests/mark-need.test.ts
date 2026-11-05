import test from 'node:test';
import assert from 'node:assert/strict';
import { markNeed, parseDeck } from '../src/core/deck/index.ts';

// 寫入端的標記（tasks/question-type-seam.md §3〈怎麼寫〉）：先試再驗，不重新序列化。預期值是任務說明與格式查核第四輪的字面值。
const NEED = '0.4.0';
const BODY = '- 寨（寨、塞） 相似字 ^abc222\n    - 山＿＿ :: 寨\n';
const CRLF = BODY.replaceAll('\n', '\r\n');
const BOM = '﻿';

const CASES: Record<string, [string, string | null]> = {
  沒有屬性區: [BODY, `---\n需要版本: 0.4.0\n---\n${BODY}`],
  'BOM、開頭是標題': [`${BOM}# 標題\n${BODY}`, `${BOM}---\n需要版本: 0.4.0\n---\n# 標題\n${BODY}`],
  'CRLF、沒有屬性區': [CRLF, `---\r\n需要版本: 0.4.0\r\n---\r\n${CRLF}`],
  空的屬性區: [`---\n---\n${BODY}`, `---\n需要版本: 0.4.0\n---\n${BODY}`],
  一般屬性區: [`---\n科目: 國語\n---\n${BODY}`, `---\n科目: 國語\n需要版本: 0.4.0\n---\n${BODY}`],
  '註解、不認得的鍵': [`---\n# 註解\n科目: 國語 # 行尾\n自訂: 留著\n---\n${BODY}`, `---\n# 註解\n科目: 國語 # 行尾\n自訂: 留著\n需要版本: 0.4.0\n---\n${BODY}`],
  'CRLF 的屬性區': [`---\r\n科目: 國語\r\n---\r\n${BODY}`, `---\r\n科目: 國語\r\n需要版本: 0.4.0\r\n---\r\n${BODY}`],
  'BOM 的屬性區': [`${BOM}---\n科目: 國語\n---\n${BODY}`, `${BOM}---\n科目: 國語\n需要版本: 0.4.0\n---\n${BODY}`],
  舊值: [`---\n需要版本: 0.2.0\n科目: 國語\n---\n${BODY}`, `---\n需要版本: 0.4.0\n科目: 國語\n---\n${BODY}`],
  加引號的舊值: [`---\n需要版本: "0.2.0"\n---\n${BODY}`, `---\n需要版本: 0.4.0\n---\n${BODY}`],
  舊值帶行尾註解: [`---\n需要版本: "0.2.0" # 老裝置用完再升\n---\n${BODY}`, `---\n需要版本: 0.4.0 # 老裝置用完再升\n---\n${BODY}`],
  '引號的鍵、行尾註解': [`---\n"需要版本": 0.2.0 # 留給家長\n---\n${BODY}`, `---\n"需要版本": 0.4.0 # 留給家長\n---\n${BODY}`],
  'CRLF、舊值帶註解': [`---\r\n需要版本: 0.2.0 # 舊\r\n---\r\n${BODY}`, `---\r\n需要版本: 0.4.0 # 舊\r\n---\r\n${BODY}`],
  單行對照表: [`---\n{科目: 國語, 自訂: 留著}\n---\n${BODY}`, null],
  共享錨點: [`---\n需要版本: &v 0.2.0\n別的: *v\n---\n${BODY}`, null],
  區塊純量: [`---\n需要版本: |\n  0.2.0\n---\n${BODY}`, null],
  YAML寫壞: [`---\n科目: [\n---\n${BODY}`, null],
  最上層是清單: [`---\n- 甲\n---\n${BODY}`, null],
  沒有結束: [`---\n科目: 國語\n${BODY}`, null],
  重複的鍵: [`---\n需要版本: 0.2.0\n"需要版本": 0.3.0\n---\n${BODY}`, null],
};

for (const [label, [text, want]] of Object.entries(CASES)) {
  void test(`markNeed：${label}`, () => {
    assert.equal(markNeed(text, NEED), want);
  });
}

void test('markNeed 第二次跑一字不改', () => {
  for (const [text, want] of Object.values(CASES)) if (want !== null) assert.equal(markNeed(want, NEED), want, text);
});

void test('markNeed 寫完讀得到標記，目標與其他屬性都和原本一樣', () => {
  const text = `---\n科目: 國語\n單元: "3"\n---\n${BODY}`;
  const next = markNeed(text, NEED);
  assert.ok(next !== null);
  const before = parseDeck(text), after = parseDeck(next);
  assert.equal(after.props.need, NEED);
  assert.deepEqual({ ...after.props, need: null }, { ...before.props, need: null });
  assert.deepEqual(after.targets.map(t => [t.id, t.name, t.prompts.map(p => p.fingerprint)]), [['abc222', '寨（寨、塞） 相似字', before.targets[0].prompts.map(p => p.fingerprint)]]);
});
