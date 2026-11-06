import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom.ts';

// 比較句的空格放在哪（tasks/question-type-seam.md §7、§11）：渲染器的輸出用手寫的 HTML。
// 真的渲染器在開發命令 md-cases 比對（§10，Obsidian 和 markdown-it 不同）；這裡擋的是 rendered.ts 的判斷，每次都跑。
const window = installDom();
Object.assign(globalThis, { Text: window.Text });
const { postProcess } = await import('../src/ui/rendered.ts');

function place(html: string): { before: string; after: string; inside: string | null; breaks: number; missing: boolean } {
  const container = document.createElement('div');
  container.innerHTML = html;
  const { slot, slotMissing } = postProcess(container, { mode: 'pick', lines: 1, english: false });
  assert.ok(slot, html);
  assert.equal(container.querySelectorAll('.ec-slot').length, 1, html);
  const breaks = container.querySelectorAll('.ec-break').length;
  const inside = slot.closest('a, strong')?.tagName ?? null;
  slot.textContent = '|';
  const [before, after] = (container.textContent ?? '').split('|');
  return { before, after, inside, breaks, missing: slotMissing };
}
const at = (html: string, before: string, after: string, inside: string | null = null): void => {
  assert.deepEqual(place(html), { before, after, inside, breaks: 0, missing: false }, html);
};

void test('空格在句中、句首、句尾、一個底線：都在那裡，中文句子不換行', () => {
  at('<p>盜匪躲在山＿＿裡。</p>', '盜匪躲在山', '裡。');
  at('<p>＿＿假快到了。</p>', '', '假快到了。');
  at('<p>他昨天弄丟了＿＿</p>', '他昨天弄丟了', '');
  at('<p>盜匪躲在山＿裡。</p>', '盜匪躲在山', '裡。');
});

void test('連結文字、粗體裡的空格：還在那個元素裡', () => {
  at('<p>請看<a href="https://example.com">山＿＿</a>的說明。</p>', '請看山', '的說明。', 'A');
  at('<p>盜匪躲在<strong>山＿＿</strong>裡。</p>', '盜匪躲在山', '裡。', 'STRONG');
});

void test('畫面有兩處：在第一處，第二處留著', () => {
  at('<p>山＿＿和＿＿裡。</p>', '山', '和＿＿裡。');
});

void test('程式碼裡的不算', () => {
  at('<p><code>＿＿</code>山＿＿裡。</p>', '＿＿山', '裡。');
});

void test('找不到：放在句尾，回報找不到', () => {
  assert.deepEqual(place('<p>這一句沒有空格。</p>'), { before: '這一句沒有空格。', after: '', inside: null, breaks: 0, missing: true });
  assert.deepEqual(place('<p>第一段。</p><p>第二段。</p>'), { before: '第一段。第二段。', after: '', inside: null, breaks: 0, missing: true });
});

void test('只有空格旁邊是英文才在英文前換行（D-145）', () => {
  assert.equal(place('<p>我可以借你的筆嗎？Can I ＿＿ your pen?</p>').breaks, 1);
  assert.equal(place('<p>我可以跟你借筆嗎？＿＿ me your pen?</p>').breaks, 1);
  assert.equal(place('<p>水管＿＿住了。</p>').breaks, 0);
  assert.equal(place('<p>今年 3 ＿＿ 月。</p>').breaks, 0);
});
