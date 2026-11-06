import test from 'node:test';
import assert from 'node:assert/strict';
import { markNeed, parseDeck } from '../src/core/deck/index.ts';
import { BODY, NEED, NEED_FORMS as CASES } from './helpers/need-forms.ts';

// 寫入端的標記（tasks/question-type-seam.md §3〈怎麼寫〉）：先試再驗，不重新序列化。預期值是任務說明與格式查核第四輪的字面值。

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
