import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { buildIndex } from '../src/core/catalog/index.ts';
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
const OWN = { term: '國二上', subject: '自然', unit: { code: '2-2' } };
const link = (text: string) => sourceLinks([text], OWN)[0].link;
const NO_UNITS: UnitDecks = () => [];

void test('§10 跨單元：第一篇沒有 ^p20、第二篇有，跳到第二篇；都沒有開第一份材料；只寫單元開第一份材料；對不到單元照文字顯示', () => {
  const { app, resolved } = appWith({ '材料/甲.md': { blocks: ['p1'] }, '材料/乙.md': { blocks: ['p20'], headings: ['溶液'] } });
  const units: UnitDecks = (term, code) => code === '1-3' && term === '國二上' ? [{ path: '卡組/課本.md', materials: ['[[沒有這份]]', '[[甲]]'] }, { path: '卡組/習作.md', materials: ['[[乙]]'] }] : [];
  const resolve = (text: string) => resolveSource(app, '卡組/本篇.md', ['[[本篇材料]]'], link(text), units);
  assert.equal(resolve('1-3 p.20'), null, '沒寫年級學期不算單元（D-169）：位置照連這一篇，這一篇的材料連不到');
  assert.equal(resolve('國二上 1-3 p.20'), '材料/乙.md#^p20');
  assert.equal(resolve('國二上 1-3 p.99'), '材料/甲.md', '全部找完才退回第一份可用的材料');
  assert.equal(resolve('國二上 1-3'), '材料/甲.md');
  assert.equal(resolve('國二上 1-3 溶液'), '材料/乙.md#溶液');
  assert.equal(resolve('國二上 1-3 沒有的標題'), '材料/甲.md');
  assert.equal(resolve('國二上 1-3 [[別的筆記|別名]]'), '別的筆記');
  assert.equal(resolve('國一上 L3'), null, '對不到單元');
  assert.equal(resolve('國二上 ２-１'), null, '對不到單元');
  assert.equal(resolve('國二上 １－３ p.20'), '材料/乙.md#^p20', '全形與破折號照讀');
  assert.ok(resolved.some(([name, from]) => name === '甲' && from === '卡組/課本.md'), '相對連結以那篇卡組的路徑解析');
  assert.ok(resolved.some(([name, from]) => name === '乙' && from === '卡組/習作.md'));
});

void test('§10 候選來自索引：單元每一篇照路徑、每篇的材料照原順序，算這一篇的科目；對不到是空的', async t => {
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
  assert.deepEqual(state.unitMaterials(from, '國二上', '1-3'), [{ path: 'Essence Cards/習作.md', materials: ['[[丙]]', '[[甲]]'], name: '' }, { path: 'Essence Cards/課本.md', materials: ['[[乙]]'], name: '' }]);
  assert.deepEqual(state.unitMaterials(from, '八上', '１－３').map(deck => deck.path), ['Essence Cards/習作.md', 'Essence Cards/課本.md'], '年級學期與編號都比鍵（D-170）');
  assert.deepEqual(state.unitMaterials(from, '國一上', 'L3'), [{ path: 'Essence Cards/別學期.md', materials: ['[[丁]]'], name: '' }]);
  assert.deepEqual(state.unitMaterials(from, '國二上', '9-9'), []);
  assert.deepEqual(state.unitMaterials('Essence Cards/沒有這篇.md', '國二上', '1-3'), []);
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
  assert.equal(resolve('1-3 p.20'), '材料/甲.md', '沒寫年級學期：這一篇的位置');
  assert.equal(resolve('溶解，擴散'), null, '材料沒有');
  assert.equal(resolve('國二上 1-3 p.20'), null, '沒有索引時照文字顯示');
  assert.equal(firstMaterial(app, '卡組/本篇.md', ['[[甲]]']), '材料/甲.md');
});

void test('§10 按鈕不露出括號：有別名顯示別名，有標題顯示標題，否則顯示筆記名稱；其他照原文', () => {
  const label = (text: string) => sourceLabel(sourceLinks([text], OWN)[0]);
  assert.equal(label('[[補充筆記#1-2 溶液]]'), '1-2 溶液');
  assert.equal(label('[[補充筆記]]'), '補充筆記');
  assert.equal(label('[[補充筆記|影片重點]]'), '影片重點');
  assert.equal(label('[[補充筆記#標題|影片重點]]'), '影片重點');
  assert.equal(label('[[補充筆記#^abc123]]'), '補充筆記', '區塊 ID 不是給人看的');
  assert.equal(label('p.44 知識快遞'), 'p.44 知識快遞');
  assert.equal(label('國二上 1-3 p.20'), '國二上 1-3 p.20');
});

const deckOf = (sources: string): ReturnType<typeof parseDeck> => parseDeck(`---\n年級學期: 國二上\n科目: 自然\n單元: 2-2\n材料: "[[甲]]"\n---\n- 目標 ^a\n    - 出處：${sources}\n    - 問 :: 答\n`);
const unreadable = (sources: string, materials: Record<string, Material | null>, units: UnitDecks = NO_UNITS): string[] => unreadableSources(appWith(materials).app, '卡組/本篇.md', deckOf(sources), units).map(item => item.text);

void test('§9-5 看不懂：回傳行號、目標與原文；讀懂的都不提示；材料的快取還沒建好時不知道，字面上就有問題的照提示', () => {
  const text = '---\n材料: "[[甲]]"\n---\n- 溫度影響溶解度 ^a\n    - 出處：p.44, 45、睡眠的階段、[[x]]、先備：比例、第 3 頁\n    - 問 :: 答\n- 第二個 ^b\n    - 出處：看不懂的字\n    - 問 :: 答\n- 第三個 ^c\n    - 出處：p.46-44\n    - 問 :: 答\n';
  const { app } = appWith({ '材料/甲.md': { headings: ['睡眠的階段'] } });
  assert.deepEqual(unreadableSources(app, '卡組/本篇.md', parseDeck(text), NO_UNITS).map(({ line, name, text: original }) => ({ line, name, text: original })), [
    { line: 6, name: '第二個', text: '看不懂的字' },
    { line: 9, name: '第三個', text: 'p.46-44' },
  ]);
  assert.deepEqual(unreadableSources(appWith({ '材料/甲.md': null }).app, '卡組/本篇.md', parseDeck(text), NO_UNITS).map(item => item.text), ['p.46-44'], '快取還沒建好');
  assert.deepEqual(unreadableSources(appWith({}).app, '卡組/本篇.md', parseDeck(text), NO_UNITS).map(item => item.text), ['看不懂的字', 'p.46-44'], '連不到的材料本來就找不到');
});

void test('D-169、D-170 沒寫年級學期的：材料裡有同名標題就是那個標題，沒有就提示；有位置的照連，也提示', () => {
  const named = { '材料/甲.md': { headings: ['1-2 溶液', '溶解, 擴散', 'CO₂ 的性質'] } };
  assert.deepEqual(unreadable('1-2 溶液', named), []);
  assert.deepEqual(unreadable('p.44、1-2 溶液', named), [], '同一欄有別的位置，像編號的字一樣先比標題');
  assert.deepEqual(unreadable('1-3 p.20', named), ['1-3 p.20']);
  assert.deepEqual(unreadable('2-1', named), ['2-1']);
  assert.deepEqual(unreadable('溶解, 擴散', named), []);
  assert.deepEqual(unreadable('溶解，擴散', named), [], '標題去雜訊之後比');
  assert.deepEqual(unreadable('ＣＯ２ 的性質', named), [], '上下標也算同一個標題，只影響連結');
  const { app } = appWith(named);
  assert.equal(resolveSource(app, '卡組/本篇.md', ['[[甲]]'], link('1-2 溶液')), '材料/甲.md#1-2 溶液');
  assert.equal(resolveSource(app, '卡組/本篇.md', ['[[甲]]'], link('溶解，擴散')), '材料/甲.md#溶解, 擴散', '連結用材料裡的原字');
  assert.equal(resolveSource(app, '卡組/本篇.md', ['[[甲]]'], link('CO2 的性質')), '材料/甲.md#CO₂ 的性質');
});

void test('D-170 只有字：同一欄有讀懂別的就是說明，不提示；有否定字、像編號的字要提示', () => {
  const material = { '材料/甲.md': { headings: [] } };
  assert.deepEqual(unreadable('p.44、老師說的', material), []);
  assert.deepEqual(unreadable('老師說的', material), ['老師說的']);
  assert.deepEqual(unreadable('p.44、不是重點', material), ['不是重點']);
  assert.deepEqual(unreadable('不要算國二上 1-3', material), ['不要算國二上 1-3']);
  assert.deepEqual(unreadable('國二上1-3,8', material), ['8']);
  assert.deepEqual(unreadable('國二上 1-3, 2-5 題', material), ['2-5 題']);
  assert.deepEqual(unreadable('國二上 1-3, 2026-10', material), ['2026-10']);
  assert.deepEqual(unreadable('國二上 1-3 p.44, 溶解說明, 45', material), ['45']);
  assert.deepEqual(unreadable('老師說過 p.44', material), ['老師說過 p.44']);
  assert.deepEqual(unreadable('課本第44頁、Workbook p.12', material), []);
  assert.deepEqual(unreadable('小五上 p.15', material), ['小五上 p.15']);
});

// Codex L2 第三、四輪的字串：單元都有卡組、材料都在，直接看目標算進哪些單元、提示了什麼。
void test('D-170 從筆記到目錄與提示：目標算進哪些單元、提示哪些字', () => {
  const head = (code: string, material: string): string => `---\n年級學期: 國二上\n科目: 自然\n單元: "${code}"\n材料: "[[${material}]]"\n---\n`;
  const others = ['1-3', '1-8'].map(code => ({ path: `卡組/${code}.md`, deck: parseDeck(head(code, '乙') + '- 別的 ^b' + code.replace('-', '') + 'xyz\n    - 問 :: 答\n') }));
  const { app } = appWith({ '材料/甲.md': { headings: ['睡眠的階段'] }, '材料/乙.md': { headings: [] } });
  const cases: [string, string[], string[]][] = [
    ['https://example.test/a,國二上1-3', [], ['https://example.test/a,國二上1-3']],
    ['https://example.test/a,b', [], []],
    ['https://x.test,8上1-3', [], ['https://x.test,8上1-3']],
    ['https://x.test,8上1-3 參考', [], ['https://x.test,8上1-3 參考']],
    ['國二上 1-3 44 p.45', ['1-3'], ['國二上 1-3 44 p.45']],
    ['本篇 https://x.test,國二上1-3', [], ['本篇 https://x.test,國二上1-3']],
    ['https://example.test/a、國二上1-3', ['1-3'], []],
    ['https://example.test/a, 國二上1-3', ['1-3'], []],
    ['國二上1-3、https://example.test/a﹐國二上1-8', ['1-3', '1-8'], []],
    ['國二上 1-3、不是國二上 1-8', ['1-3'], ['不是國二上 1-8']],
    ['國二上 1-3、不是 p.46、p.45', ['1-3'], ['不是 p.46']],
    ['國二上 1-3，不算這個', [], ['國二上 1-3', '不算這個']],
    ['國二上 1-3，不算1-3', [], ['國二上 1-3', '不算1-3']],
    ['國二上 1-3 p.20，老師說不用背', ['1-3'], ['老師說不用背']],
    ['[教材](版本(甲),國二上1-3p.44)', [], []],
    ['[教材](100%.md)', [], []],
    ['「附錄,國二上 1-3 p.20」', [], ['「附錄,國二上 1-3 p.20」']],
    ['「睡眠的階段」', [], []],
    ['國二上 1-3, 第5題, 1-8', ['1-3'], ['1-8']],
    ['國二上 1-3、溶解, 1-8', ['1-3'], ['溶解, 1-8']],
    ['p.44、p.44 和 1-8', [], ['p.44 和 1-8']],
    ['國二上 1-3、1-8 p.44、國二上 1-8 p.44', ['1-3', '1-8'], []],
    ['本篇、國二上 1-3、本篇、p.44', ['1-3'], []],
    ['1-3 p.20、L1', [], ['1-3 p.20', 'L1']],
  ];
  for (const [text, counted, hinted] of cases) {
    const deck = parseDeck(head('2-2', '甲') + `- 目標 ^abc123\n    - 問 :: 答\n    - 出處：${text}\n`);
    const index = buildIndex([{ path: '卡組/本篇.md', deck }, ...others]);
    assert.deepEqual(['1-3', '1-8'].filter(code => index.find('國二上', '自然', code)?.targets.some(each => each.id === 'abc123')), counted, text);
    const units: UnitDecks = (term, code) => (index.find(term, '自然', code)?.decks ?? []).map(each => ({ path: each.path, materials: ['[[乙]]'], name: each.name }));
    assert.deepEqual(unreadableSources(app, '卡組/本篇.md', deck, units).map(each => each.text), hinted, text);
  }
});

void test('D-170 否定字只提示：材料裡有同名標題也不連；像編號的字併回舊標題時還是要提示', () => {
  const { app } = appWith({ '材料/甲.md': { headings: ['不是 p.44', '不算這個'] } });
  const hints = (text: string): string[] => unreadableSources(app, '卡組/本篇.md', parseDeck(`---\n年級學期: 國二上\n科目: 自然\n單元: "2-2"\n材料: "[[甲]]"\n---\n- 目標 ^abc123\n    - 問 :: 答\n    - 出處：${text}\n`), NO_UNITS).map(each => each.text);
  assert.deepEqual(hints('不是 p.44'), ['不是 p.44']);
  assert.equal(resolveSource(app, '卡組/本篇.md', ['[[甲]]'], link('不是 p.44')), null);
  assert.deepEqual(hints('國二上 1-3，不算這個'), ['國二上 1-3', '不算這個']);
  assert.deepEqual(hints('國二上 1-3、溶解, 1-8'), ['溶解, 1-8']);
});

// tasks/edit-markup.md §1-3：每一段原文判斷一次；說明照表上最前面的原因，最後都加「點一下幫你改。」
void test('§1-3 看不懂的出處的說明：每一種原因一句', () => {
  const material = { '材料/甲.md': { headings: [] } };
  const units: UnitDecks = (term, code) => term === '國二上' && code === '2-1' ? [{ path: '卡組/2-1.md', materials: ['[[甲]]'], name: '水溶液' }] : [];
  const tips = (sources: string): string[] => unreadableSources(appWith(material).app, '卡組/本篇.md', deckOf(sources), units).map(each => each.tip);
  const tail = '。點一下幫你改。';
  assert.deepEqual(tips('1-3 p.20'), ['沒寫年級學期，不知道是哪一個 1-3' + tail], '沒寫年級學期排在 before 前面');
  assert.deepEqual(tips('L1'), ['沒寫年級學期，不知道是哪一個 L1' + tail], '用原文的編號');
  assert.deepEqual(tips('小五上 p.15'), ['寫了年級學期，沒有完整的單元編號' + tail]);
  assert.deepEqual(tips('p.46-44'), ['頁碼或範圍寫反了，連不到' + tail]);
  assert.deepEqual(tips('老師說過 p.44'), ['位置前面有一句話，不確定是不是出處' + tail]);
  assert.deepEqual(tips('p.44 和 1-8'), ['裡面有像單元編號的字，沒有算進去' + tail]);
  assert.deepEqual(tips('p.44、不是重點'), ['有否定的字，外掛不確定意思' + tail]);
  assert.deepEqual(tips('國二上 2-1、10-15'), ['找不到這個單元' + tail]);
  assert.deepEqual(tips('老師說的'), ['材料裡找不到這個標題' + tail]);
  assert.deepEqual(tips('國二上 2-1 那次考不好'), ['單元後面的字看不懂' + tail]);
});

void test('§1-3 改成數段：同一個位置寫兩次標有問題的那一段；同一段兩個有問題的按鈕算一段，用最前面的原因', () => {
  const material = { '材料/甲.md': { headings: [] } };
  const found = (sources: string) => unreadableSources(appWith(material).app, '卡組/本篇.md', deckOf(sources), NO_UNITS).map(each => [each.text, each.tip]);
  assert.deepEqual(found('p.44、p.45、老師說過 p.44'), [['老師說過 p.44', '位置前面有一句話，不確定是不是出處。點一下幫你改。']]);
  assert.deepEqual(found('老師說過 p.44 和 1-3 p.45'), [['老師說過 p.44 和 1-3 p.45', '位置前面有一句話，不確定是不是出處。點一下幫你改。']], '原本是兩個按鈕、兩個提示');
  assert.deepEqual(found('老師說過 p.44、老師說過 p.44').length, 2, '同一個位置寫兩次都有問題：兩段');
  const [first] = unreadableSources(appWith(material).app, '卡組/本篇.md', deckOf('老師說過 p.44 和 1-3 p.45'), NO_UNITS);
  assert.deepEqual([first.item.text, first.item.problem], ['老師說過 p.44 和 1-3 p.45', 'before'], '給表單猜的那一項：那一段的原文、第一個有問題的項目');
});

void test('§1-3 卡組有 layout 時回傳那一段在檔案的位置；切不出原文的是 null', () => {
  const material = { '材料/甲.md': { headings: [] } };
  const head = '---\n年級學期: 國二上\n科目: 自然\n單元: 2-2\n材料: "[[甲]]"\n---\n- 目標 ^a\n    - 問 :: 答\n';
  const text = head + '    - 出處：p.44、老師說過 p.45\n';
  const [hit] = unreadableSources(appWith(material).app, '卡組/本篇.md', parseDeck(text, { layout: true }), NO_UNITS);
  const line = text.split('\n')[hit.at?.line ?? 0];
  assert.deepEqual([hit.at?.line, line.slice(hit.at?.from, hit.at?.to)], [8, '老師說過 p.45']);
  assert.equal(unreadableSources(appWith(material).app, '卡組/本篇.md', parseDeck(text), NO_UNITS)[0].at, null, '沒有 layout');
  const crossing = head + '    - 出處：老師說過\n      p.45\n';
  assert.equal(unreadableSources(appWith(material).app, '卡組/本篇.md', parseDeck(crossing, { layout: true }), NO_UNITS)[0].at, null, '跨了接續行');
});

void test('D-170 單元：標準的編號沒有卡組不提示；其他編號、列表沿用學期的對不到才提示；單元後面的字比名稱與那個單元的材料', () => {
  const material = { '材料/甲.md': { headings: [] }, '材料/乙.md': { headings: ['水溶液的濃度'] } };
  const units: UnitDecks = (term, code) => term === '國二上' && code === '2-1' ? [{ path: '卡組/2-1.md', materials: ['[[乙]]'], name: '水溶液' }] : term === '國一上' && code === 'Starter' ? [{ path: '卡組/s.md', materials: [], name: '' }] : [];
  assert.deepEqual(unreadable('國二上 1-9 p.3', material, units), [], '寫法沒錯，家長也改不了；第二批設範圍時列出來');
  assert.deepEqual(unreadable('國二上 Extension', material, units), ['國二上 Extension']);
  assert.deepEqual(unreadable('國一上 Starter', material, units), []);
  assert.deepEqual(unreadable('國二上 2-1、10-15', material, units), ['10-15']);
  assert.deepEqual(unreadable('國二上 2-1、1-9 p.3', material, units), ['1-9 p.3']);
  assert.deepEqual(unreadable('國二上 2-1 水溶液', material, units), [], '單元的名稱');
  assert.deepEqual(unreadable('國二上 2-1 水溶液的濃度', material, units), [], '那個單元材料的標題');
  assert.deepEqual(unreadable('國二上 2-1 那次考不好', material, units), ['國二上 2-1 那次考不好']);
  assert.deepEqual(unreadable('國二上 2-1 水溶液 p.15', material, units), [], '單元與位置之間的字是說明');
});
