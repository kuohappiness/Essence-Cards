import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { parseDeck, sourceLabel, sourceLinks } from '../src/core/deck/index.ts';
import { createState } from '../src/state/index.ts';
import { firstMaterial, resolveSource, unreadableSources, type UnitDecks } from '../src/ui/sources.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// 跨單元的出處可以點、按鈕不露出括號、看不懂的判斷（tasks/entry-and-catalog.md §9-5、§10）：metadataCache 用替身。

interface Material { blocks?: string[]; headings?: string[] }
function appWith(materials: Record<string, Material | null>): { app: App; resolved: [string, string][] } {
  const resolved: [string, string][] = [];
  const app = {
    metadataCache: {
      getFirstLinkpathDest(link: string, from: string) {
        resolved.push([link, from]);
        const path = `材料/${link}.md`;
        return path in materials ? { path } : null;
      },
      getFileCache(file: { path: string }) {
        const entry = materials[file.path];
        return entry && { blocks: Object.fromEntries((entry.blocks ?? []).map(id => [id, {}])), headings: (entry.headings ?? []).map(heading => ({ heading })) };
      },
    },
  } as unknown as App;
  return { app, resolved };
}
const link = (text: string) => sourceLinks([text])[0].link;

void test('§10 跨單元：第一篇沒有 ^p20、第二篇有，跳到第二篇；都沒有開第一份材料；只寫單元開第一份材料；對不到單元照文字顯示', () => {
  const { app, resolved } = appWith({ '材料/甲.md': { blocks: ['p1'] }, '材料/乙.md': { blocks: ['p20'], headings: ['溶液'] } });
  const units: UnitDecks = (term, code) => code === '1-3' && (term === null || term === '國二上') ? [{ path: '卡組/課本.md', materials: ['[[沒有這份]]', '[[甲]]'] }, { path: '卡組/習作.md', materials: ['[[乙]]'] }] : [];
  const resolve = (text: string) => resolveSource(app, '卡組/本篇.md', ['[[本篇材料]]'], link(text), units);
  assert.equal(resolve('1-3 p.20'), '材料/乙.md#^p20');
  assert.equal(resolve('國二上 1-3 p.20'), '材料/乙.md#^p20');
  assert.equal(resolve('國二上 1-3 p.99'), '材料/甲.md', '全部找完才退回第一份可用的材料');
  assert.equal(resolve('1-3'), '材料/甲.md');
  assert.equal(resolve('國二上 1-3 溶液'), '材料/乙.md#溶液');
  assert.equal(resolve('國二上 1-3 沒有的標題'), '材料/甲.md');
  assert.equal(resolve('國二上 1-3 [[別的筆記|別名]]'), '別的筆記');
  assert.equal(resolve('國一上 L3'), null, '對不到單元');
  assert.equal(resolve('國二上 ２-１'), null);
  assert.ok(resolved.some(([name, from]) => name === '甲' && from === '卡組/課本.md'), '相對連結以那篇卡組的路徑解析');
  assert.ok(resolved.some(([name, from]) => name === '乙' && from === '卡組/習作.md'));
});

void test('§10 候選來自索引：單元每一篇照路徑、每篇的材料照原順序；只寫單元的算這一篇的年級學期；對不到是空的', async t => {
  const memory = createMemoryFiles({
    'Essence Cards/本篇.md': '---\n年級學期: 國二上\n科目: 自然\n單元: "1-1"\n---\n',
    'Essence Cards/習作.md': '---\n年級學期: 國二上\n科目: 自然\n單元: "1-3"\n材料:\n  - "[[丙]]"\n  - "[[甲]]"\n狀態: 草稿\n---\n',
    'Essence Cards/課本.md': '---\n年級學期: 國二上\n科目: 自然\n單元: "1-3"\n材料: "[[乙]]"\n---\n',
    'Essence Cards/別學期.md': '---\n年級學期: 國一上\n科目: 自然\n單元: L3\n材料: "[[丁]]"\n---\n',
    'Essence Cards/別科.md': '---\n年級學期: 國二上\n科目: 數學\n單元: "1-3"\n材料: "[[戊]]"\n---\n',
  });
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: false, now: () => 0, offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  const from = 'Essence Cards/本篇.md';
  assert.deepEqual(state.unitMaterials(from, null, '1-3'), [{ path: 'Essence Cards/習作.md', materials: ['[[丙]]', '[[甲]]'] }, { path: 'Essence Cards/課本.md', materials: ['[[乙]]'] }]);
  assert.deepEqual(state.unitMaterials(from, '國二上', '1-3'), state.unitMaterials(from, null, '1-3'));
  assert.deepEqual(state.unitMaterials(from, '國一上', 'L3'), [{ path: 'Essence Cards/別學期.md', materials: ['[[丁]]'] }]);
  assert.deepEqual(state.unitMaterials(from, null, '9-9'), []);
  assert.deepEqual(state.unitMaterials('Essence Cards/沒有這篇.md', null, '1-3'), []);
});

void test('舊讀法逐項保留：頁碼、圖表例題、子圖、標題、筆記連結，別名不送去開', () => {
  const { app } = appWith({ '材料/甲.md': { blocks: ['p44', 'fig2-13a'], headings: ['睡眠的階段'] } });
  const resolve = (text: string) => resolveSource(app, '卡組/本篇.md', ['[[甲]]'], link(text));
  assert.equal(resolve('p.44'), '材料/甲.md#^p44');
  assert.equal(resolve('第 44 頁'), '材料/甲.md#^p44');
  assert.equal(resolve('p.44-46'), '材料/甲.md#^p44');
  assert.equal(resolve('p.99'), '材料/甲.md', '找不到開第一份材料');
  assert.equal(resolve('圖 2-13'), '材料/甲.md#^fig2-13a');
  assert.equal(resolve('睡眠的階段'), '材料/甲.md#睡眠的階段');
  assert.equal(resolve('沒有的標題'), null);
  assert.equal(resolve('[[補充筆記#1-2 溶液]]'), '補充筆記#1-2 溶液');
  assert.equal(resolve('[[補充筆記|影片重點]]'), '補充筆記', '別名不送去開');
  assert.equal(resolve('[[補充筆記#標題|別名]]'), '補充筆記#標題');
  assert.equal(resolve('先備：比例'), null);
  assert.equal(resolve('1-3 p.20'), null, '沒有索引時照文字顯示');
  assert.equal(firstMaterial(app, '卡組/本篇.md', ['[[甲]]']), '材料/甲.md');
});

void test('§10 按鈕不露出括號：有別名顯示別名，有標題顯示標題，否則顯示筆記名稱；其他照原文', () => {
  const label = (text: string) => sourceLabel(sourceLinks([text])[0]);
  assert.equal(label('[[補充筆記#1-2 溶液]]'), '1-2 溶液');
  assert.equal(label('[[補充筆記]]'), '補充筆記');
  assert.equal(label('[[補充筆記|影片重點]]'), '影片重點');
  assert.equal(label('[[補充筆記#標題|影片重點]]'), '影片重點');
  assert.equal(label('[[補充筆記#^abc123]]'), '補充筆記', '區塊 ID 不是給人看的');
  assert.equal(label('p.44 知識快遞'), 'p.44 知識快遞');
  assert.equal(label('國二上 1-3 p.20'), '國二上 1-3 p.20');
});

void test('§9-5 看不懂：第 6 種而且材料裡找不到同名標題；材料裡有同名標題的舊出處不提示；其他讀法都不提示', () => {
  const text = '---\n材料: "[[甲]]"\n---\n- 溫度影響溶解度 ^a\n    - 出處：p.44, 45、睡眠的階段、2 擴散現象\n    - 問 :: 答\n- 第二個 ^b\n    - 出處：p.44、國二上 1-9 p.3、L1、[[x]]、先備：比例、第 3 頁\n    - 問 :: 答\n';
  const { app } = appWith({ '材料/甲.md': { headings: ['睡眠的階段'] } });
  assert.deepEqual(unreadableSources(app, '卡組/本篇.md', parseDeck(text)), [
    { line: 3, name: '溫度影響溶解度', text: 'p.44, 45' },
    { line: 3, name: '溫度影響溶解度', text: '2 擴散現象' },
  ]);
  // 材料的快取還沒建好：不知道，不提示。
  assert.deepEqual(unreadableSources(appWith({ '材料/甲.md': null }).app, '卡組/本篇.md', parseDeck(text)), []);
  // 連不到的材料本來就找不到：照提示。
  assert.equal(unreadableSources(appWith({}).app, '卡組/本篇.md', parseDeck(text)).length, 3);
});
