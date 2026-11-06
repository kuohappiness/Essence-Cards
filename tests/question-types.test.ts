import test from 'node:test';
import assert from 'node:assert/strict';
import { questionType } from '../src/core/study/index.ts';
import type { QuestionType } from '../src/core/study/index.ts';
import { DECK, setup, view } from './helpers/pick-session.ts';

// 題型接點（tasks/question-type-seam.md §1、L2 的 R3）：作答與畫面是 Record<QuestionType, …> 的表，解析與組卡是專屬函式。
// 新增題型時這張表少一列，編譯不過；有列但解析或組卡沒接上，下面的測試不過：出來的題型不對，或根本沒有卡。
const SAMPLES: Record<QuestionType, string> = {
  flip: '- 能說明 A ^aaa111\n    - Q :: A\n',
  typed: '- borrow 中翻英 ^aaa111\n    - 借入 :: borrow\n',
  pick: '- 寨（寨、塞） 相似字 ^aaa111\n    - 山＿＿ :: 寨\n- 塞（寨、塞） 相似字 ^bbb222\n    - 大＿＿車 :: 塞\n',
};

for (const [type, text] of Object.entries(SAMPLES)) {
  void test(`${type}：從筆記的文字經過解析、組卡、作答流程，出來就是這個題型`, async t => {
    const h = await setup(t, { [DECK]: `---\n科目: 國語\n---\n${text}` });
    const s = await h.open({ subject: '國語' });
    assert.equal(questionType(view(s).card), type);
  });
}
