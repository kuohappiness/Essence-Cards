import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/core/deck/index.ts';
import { createPreview } from '../src/review/index.ts';
import type { Session, View } from '../src/review/index.ts';
import { createState } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// 預覽（tasks/entry-and-catalog.md §7、D-161）：一個實作 Session 介面的物件，畫面不用知道。

const PATH = 'Essence Cards/自然.md';
const PROPS = '---\n年級學期: 國二上\n科目: 自然\n單元: 2-1 水溶液\n狀態: 草稿\n---\n';
const THREE_PROMPTS = PROPS + '- 目標一 ^a\n    - 第一題 :: 一\n    - 第二題 :: 二\n    - 第三題 :: 三\n- 還沒補 ID\n    - 第四題 :: 四\n';
const open = (text: string, reveal = false): Session => {
  const session = createPreview({ path: PATH, deck: parseDeck(text), reveal });
  assert.ok(session);
  return session;
};
const card = (view: View) => {
  assert.equal(view.kind, 'card');
  if (view.kind !== 'card') throw Error();
  return view.card;
};
const question = (view: View): string => {
  const { prompt } = card(view).card;
  return prompt.kind === 'qa' ? prompt.question : prompt.text;
};

void test('同一個目標 3 題出 3 張，照筆記順序；草稿、還沒補 ID 的也可以；上方一直標「預覽，不記錄」', () => {
  const s = open(THREE_PROMPTS);
  const seen: string[] = [];
  while (s.view().kind === 'card') {
    assert.equal(s.view().top.center, '預覽，不記錄');
    seen.push(question(s.view()));
    s.forward();
  }
  assert.deepEqual(seen, ['第一題', '第二題', '第三題', '第四題']);
  assert.equal(s.view().top.center, '預覽，不記錄');
  assert.equal(s.view().top.pinned, true);
  const done = s.view();
  assert.equal(done.kind === 'done' && done.done.title, '預覽完了');
});

void test('自評按鈕或「下一張」都只換下一張；上一張、下一張到頭不出錯', () => {
  const s = open(THREE_PROMPTS);
  assert.equal(s.view().top.canBack, false);
  s.back();
  assert.equal(question(s.view()), '第一題', '到頭不動');
  assert.equal(s.rate('good'), false, '還沒翻面不算');
  assert.equal(card(s.view()).nextLabel, '下一張');
  s.reveal();
  assert.deepEqual(card(s.view()).allowed, ['miss', 'near', 'good', 'easy'], '自評按鈕照樣顯示');
  assert.equal(s.rate('miss'), true);
  assert.equal(question(s.view()), '第二題');
  assert.equal(card(s.view()).revealed, false, '每張從正面開始');
  s.back();
  assert.equal(question(s.view()), '第一題');
  for (let i = 0; i < 10; i++) s.forward();
  assert.equal(s.view().kind, 'done');
  assert.equal(s.view().top.canForward, false);
  assert.equal(s.view().top.canBack, true);
  s.back();
  assert.equal(question(s.view()), '第四題', '結束畫面也能回上一張');
});

void test('預覽時自動展開答案：一進卡片就是背面', () => {
  const s = open(THREE_PROMPTS, true);
  assert.equal(card(s.view()).revealed, true);
  s.forward();
  assert.equal(card(s.view()).revealed, true);
});

void test('寫錯的目標跳過，開頭寫跳過幾個；只有寫錯或沒有題目時是 null', () => {
  const s = open('- 壞的\n    - 問 ::\n- 也壞的\n    - :: 答\n- 好的 ^b\n    - Q :: A\n');
  assert.equal(s.view().top.center, '預覽，不記錄（跳過 2 個寫法有問題的目標）');
  assert.equal(question(s.view()), 'Q');
  assert.equal(createPreview({ path: PATH, deck: parseDeck('一般筆記\n'), reveal: false }), null);
  assert.equal(createPreview({ path: PATH, deck: parseDeck('- 壞的\n    - 問 ::\n'), reveal: false }), null);
});

const TYPED = '- borrow 中翻英 ^z\n    - Can I ＿＿ your pen? :: borrow | lend\n';

void test('打字卡不用打字也能看答案：按鈕寫「顯示答案」；打了字照樣比對', () => {
  const s = open(TYPED);
  const typed = card(s.view()).typed;
  assert.equal(typed?.step, 1);
  assert.equal(typed?.canSkip, true);
  assert.equal(typed?.skipLabel, '顯示答案');
  assert.deepEqual(card(s.view()).allowed, []);
  s.skip();
  const shown = card(s.view());
  assert.equal(shown.revealed, true);
  assert.equal(shown.typed?.finished, true);
  assert.deepEqual(shown.allowed, ['miss', 'near', 'good', 'easy']);
  assert.deepEqual(shown.typed?.attempt?.typed, [], '沒打字不畫「你拼的」');
  assert.deepEqual(shown.autoRead, ['borrow', 'Can I borrow your pen?'], '答案出現時照複習一樣念');
  s.back();

  const right = open(TYPED);
  right.submit();
  assert.equal(card(right.view()).typed?.finished, false, '沒打字按確認不算');
  right.input('Borrow');
  right.submit();
  assert.equal(card(right.view()).typed?.first, 'right');
  const wrong = open(TYPED);
  wrong.input('borow');
  wrong.submit();
  assert.equal(card(wrong.view()).typed?.first, 'wrong');
  assert.equal(card(wrong.view()).typed?.answer, 'borrow');
  assert.equal(wrong.rate('good'), true);
});

void test('打字卡自動展開時一進卡片就是答案', () => {
  const s = open(TYPED, true);
  assert.equal(card(s.view()).typed?.finished, true);
  assert.equal(card(s.view()).revealed, true);
});

void test('預覽完一輪，複習紀錄檔的內容逐位元組不變，state.progress() 不變；沒有任何讀寫的入口', async t => {
  const log = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
  const memory = createMemoryFiles({ [PATH]: THREE_PROMPTS.replace('狀態: 草稿\n', ''), [log]: '{"t":"2026-10-01T08:00:00.000+08:00","lt":"a","r":"good","v":"12345678"}\n' });
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: false, now: () => Date.parse('2026-10-24T19:00:00.000+08:00'), offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  await state.flush();
  const before = memory.texts.get(log), progress = JSON.stringify(state.progress());
  const s = open(memory.texts.get(PATH) ?? '');
  while (s.view().kind === 'card') {
    s.reveal();
    s.rate('miss');
  }
  s.close();
  await state.flush();
  assert.equal(memory.texts.get(log), before);
  assert.equal(JSON.stringify(state.progress()), progress);
  assert.deepEqual(s.history(), []);
});

void test('通知畫面：換卡與翻面都通知；同一個狀態回傳同一個物件（useSyncExternalStore 靠它）；關掉之後不再通知', () => {
  const s = open(THREE_PROMPTS);
  let calls = 0;
  s.subscribe(() => { calls++; });
  assert.equal(s.view(), s.view());
  s.reveal();
  s.forward();
  assert.equal(calls, 2);
  s.close();
  s.forward();
  assert.equal(calls, 2);
});
