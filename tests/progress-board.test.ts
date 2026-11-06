import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAP, MapError, count, parseMap, percent, renderBoard } from '../tools/progress-board.ts';

const SAMPLE = `# 標題

說明段落，不算進任何一段。

## 製卡

把教材變成卡組。

### 手寫

| | 功能 | 現況 |
|:-:|---|---|
| 🟢 | 直接編輯 | 見 [syntax](syntax.md#2-卡組) |
| 🟡 | 標示結構 | \`第四批\` |
| ⚪ | Bases 清單 | |
| 🔵 | 卡片管理 | 外部 <https://example.com> |
`;

void test('progress-map.md 照格式寫，每一段都有模組與功能', () => {
  const stages = parseMap(readFileSync(MAP, 'utf8'));
  assert.ok(stages.length >= 1);
  for (const stage of stages) {
    assert.ok(stage.description, `${stage.name} 沒有說明`);
    for (const module of stage.modules) assert.ok(module.items.length, `${stage.name}／${module.name} 沒有功能`);
  }
});

void test('讀出段、說明、模組與每一列；第一個 ## 之前的說明不讀', () => {
  const [stage, ...rest] = parseMap(SAMPLE);
  assert.equal(rest.length, 0);
  assert.equal(stage.name, '製卡');
  assert.equal(stage.description, '把教材變成卡組。');
  assert.deepEqual(stage.modules.map(m => m.name), ['手寫']);
  assert.deepEqual(stage.modules[0].items.map(i => i.status), ['done', 'part', 'todo', 'later']);
  assert.equal(stage.modules[0].items[2].note, '');
  assert.equal(stage.modules[0].items[1].note, '<code>第四批</code>');
});

void test('相對連結改成 GitHub 上 docs/ 的網址，外部網址不動', () => {
  const items = parseMap(SAMPLE)[0].modules[0].items;
  assert.match(items[0].note, /href="https:\/\/github\.com\/kuohappiness\/Essence-Cards\/blob\/main\/docs\/syntax\.md#2-%E5%8D%A1%E7%B5%84"/);
  assert.match(items[3].note, /href="https:\/\/example\.com"/);
});

void test('不認得的符號報出行號', () => {
  const source = SAMPLE.replace('| ⚪ | Bases', '| ✅ | Bases');
  assert.throws(() => parseMap(source), (error: unknown) => error instanceof MapError && error.line === 15 && error.message.includes('✅'));
});

void test('表格不在模組底下、沒有模組的段、沒有功能的模組都擋下', () => {
  assert.throws(() => parseMap(SAMPLE.replace('### 手寫\n', '')), /模組（###）底下/);
  assert.throws(() => parseMap('## 空的段\n\n說明。\n'), /沒有模組/);
  assert.throws(() => parseMap('## 段\n\n說明。\n\n### 空模組\n\n文字。\n'), /沒有功能/);
  assert.throws(() => parseMap('# 只有標題\n'), /找不到任何一段/);
});

void test('完成度：做完算 1、一部分算一半、v1 之後不算', () => {
  assert.equal(percent({ done: 1, part: 1, todo: 2, later: 5 }), 38);
  assert.equal(percent({ done: 0, part: 0, todo: 0, later: 3 }), null);
  assert.deepEqual(count(parseMap(SAMPLE)[0].modules[0].items), { done: 1, part: 1, todo: 1, later: 1 });
});

void test('網頁帶出總完成度與段名，段名會跳脫', () => {
  const html = renderBoard(parseMap(SAMPLE.replace('## 製卡', '## 製卡<b>')), { updated: '2026/11/6 13:00', commit: '0123456789abcdef' });
  assert.match(html, /<span class="big">50<small>%<\/small><\/span>/);
  assert.match(html, /製卡&#60;b&#62;/);
  assert.match(html, /commit\/0123456789abcdef">0123456/);
});
