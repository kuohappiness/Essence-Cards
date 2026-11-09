import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/core/deck/index.ts';

// tasks/record-gaps.md §1〈分得出「沒寫」和「讀壞」〉：顯示與排程的預設值不動，紀錄端照這幾個欄位判斷，不從提示文字猜。
const body = '- 目標 ^aaaaaa\n    - Q :: A\n';

void test('卡組的狀態：沒寫、合法、無效分得出來，status 的預設值不變', () => {
  const cases: [string, string, 'missing' | 'valid' | 'invalid', 'active' | 'draft' | 'paused'][] = [
    ['沒有屬性區', body, 'missing', 'active'],
    ['有屬性區、沒有狀態', '---\n科目: 自然\n---\n' + body, 'missing', 'active'],
    ['明寫啟用', '---\n狀態: 啟用\n---\n' + body, 'valid', 'active'],
    ['草稿', '---\n狀態: 草稿\n---\n' + body, 'valid', 'draft'],
    ['暫停', '---\n狀態: 暫停\n---\n' + body, 'valid', 'paused'],
    ['打到一半', '---\n狀態: 暫\n---\n' + body, 'invalid', 'active'],
    ['空值', '---\n狀態:\n---\n' + body, 'invalid', 'active'],
    ['不是文字', '---\n狀態: [暫停]\n---\n' + body, 'invalid', 'active'],
    ['屬性區寫壞', '---\n狀態: [\n---\n' + body, 'invalid', 'active'],
    ['屬性區沒有結束', '---\n狀態: 暫停\n' + body, 'invalid', 'active'],
    // toJS 是 null，但不是空的屬性區（L2 的 R7）。
    ['屬性區只有 null', '---\nnull\n---\n' + body, 'invalid', 'active'],
    ['屬性區只有 ~', '---\n~\n---\n' + body, 'invalid', 'active'],
    ['屬性區只有 NULL', '---\nNULL\n---\n' + body, 'invalid', 'active'],
    ['空的屬性區', '---\n---\n' + body, 'missing', 'active'],
    ['只有空白行的屬性區', '---\n\n---\n' + body, 'missing', 'active'],
    ['只有註解的屬性區', '---\n# 備註\n---\n' + body, 'missing', 'active'],
  ];
  for (const [name, text, read, status] of cases) {
    const { props } = parseDeck(text);
    assert.equal(props.statusRead, read, name);
    assert.equal(props.status, status, name);
  }
});

const target = (lines: string): ReturnType<typeof parseDeck>['targets'][number] => parseDeck(`- 目標 ^aaaaaa\n${lines}    - Q :: A\n`).targets[0];

void test('目標的狀態：只有第一個值認不得才是 statusInvalid，paused 的預設值不變', () => {
  const cases: [string, string, boolean, boolean][] = [
    ['沒有欄位', '', false, false],
    ['啟用', '    - 狀態：啟用\n', false, false],
    ['暫停', '    - 狀態：暫停\n', true, false],
    ['打到一半', '    - 狀態：暫\n', false, true],
    ['空值', '    - 狀態：\n', false, true],
    ['重複：第一個合法', '    - 狀態：暫停\n    - 狀態：暫\n', true, false],
    ['重複：第一個認不得', '    - 狀態：暫\n    - 狀態：暫停\n', false, true],
  ];
  for (const [name, lines, paused, invalid] of cases) {
    const { fields } = target(lines);
    assert.equal(fields.paused, paused, name);
    assert.equal(fields.statusInvalid === true, invalid, name);
  }
});
