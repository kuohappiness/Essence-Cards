import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { buildIndex } from '../src/core/catalog/index.ts';
import { codeKey, headingKey, parseDeck, sourceLinks, splitUnit, termKey, termRank } from '../src/core/deck/index.ts';
import type { SourceItem, SourceLink, SourceOwner } from '../src/core/deck/index.ts';
import { unreadableSources } from '../src/ui/sources.ts';

// 出處的讀法（tasks/entry-and-catalog.md §9-3、§9-6，D-167）：預期值都來自那份說明的表，不用同一個正則再算一次。

const NATURE: SourceOwner = { term: '國二上', subject: '自然', unit: { code: '2-2' } };
const ENGLISH: SourceOwner = { term: '國一上', subject: '英文', unit: { code: 'L3' } };
const MATH: SourceOwner = { term: '小三下', subject: '數學', unit: { code: '5' } };
const NO_OWNER: SourceOwner = { term: null, subject: null, unit: null };

const read = (text: string, own: SourceOwner = NATURE): SourceItem[] => sourceLinks([text], own);
const links = (text: string, own: SourceOwner = NATURE): SourceLink[] => read(text, own).map(item => item.link);
const page = (n: number | string): SourceLink => ({ kind: 'block', id: 'p' + n });
const fig = (id: string): SourceLink => ({ kind: 'block', id: 'fig' + id });
const tab = (id: string): SourceLink => ({ kind: 'block', id: 'tab' + id });
const ex = (id: string): SourceLink => ({ kind: 'block', id: 'ex' + id });
const note = (link: string): SourceLink => ({ kind: 'note', link });
const heading = (text: string): SourceLink => ({ kind: 'heading', heading: text });
const unit = (term: string, code: string, rest: SourceLink | null = null): SourceLink => ({ kind: 'unit', term, unit: code, rest });
const u13 = (rest: SourceLink | null = null): SourceLink => unit('國二上', '1-3', rest);

/** 每個例子：原文、讀成什麼、要不要提示（字面上就知道的）、情境。登錄在這裡的例子自動受下面的性質保護。 */
const EXAMPLES: [string, SourceLink[], boolean?, SourceOwner?][] = [
  // 頁碼
  ['p.44', [page(44)]], ['p44', [page(44)]], ['P.44', [page(44)]], ['p 44', [page(44)]], ['p. 44', [page(44)]], ['pp.44-46', [page(44)]], ['page 44', [page(44)]], ['pg.44', [page(44)]],
  ['p.44-46', [page(44)]], ['p，44', [page(44)]], ['p , 44', [page(44)]], ['ｐ　，　４４', [page(44)]], ['p.44~46', [page(44)]], ['p.44～46', [page(44)]], ['p.44-p.46', [page(44)]], ['第 44 頁', [page(44)]], ['第44頁', [page(44)]], ['44頁', [page(44)]], ['44 頁', [page(44)]], ['p44頁', [page(44)]],
  ['第四十四頁', [page(44)]], ['第44-46頁', [page(44)]], ['第 44 至 46 頁', [page(44)]], ['（p.44）', [page(44)]], ['課本第44頁', [page(44)]], ['講義p.12', [page(12)]], ['Workbook p.12', [page(12)]], ['p.44 知識快遞', [page(44)]],
  // 圖表例題
  ['圖 2-14', [fig('2-14')]], ['圖2-14', [fig('2-14')]], ['圖 2-13 A', [fig('2-13a')]], ['圖2-13(a)', [fig('2-13a')]], ['圖2-14圖說', [fig('2-14')]], ['表 2-1', [tab('2-1')]], ['例題 2-3', [ex('2-3')]], ['範例2-3', [ex('2-3')]], ['Fig. 2-14', [fig('2-14')]], ['2-14圖', [fig('2-14')]], ['第2-14圖', [fig('2-14')]], ['圖2.14', [fig('2-14')]],
  // 好幾個
  ['p.44, p.45', [page(44), page(45)]], ['p.44/p.45', [page(44), page(45)]], ['p.44;p.45', [page(44), page(45)]], ['p.44 p.45', [page(44), page(45)]], ['p.44, 45', [page(44), page(45)]], ['p.44 45', [page(44), page(45)]], ['p.44、46、48', [page(44), page(46), page(48)]], ['44、46頁', [page(44), page(46)]], ['第44頁和第46頁', [page(44), page(46)]],
  ['圖2-14、2-15', [fig('2-14'), fig('2-15')]], ['圖2-13a、b', [fig('2-13a'), fig('2-13b')]], ['圖2-14表2-1', [fig('2-14'), tab('2-1')]], ['p.20 圖 2-14', [page(20), fig('2-14')]],
  // 單元
  ['國二上 1-3', [u13()]], ['國二上 1-3 p.20', [u13(page(20))]], ['國二上1-3 p.20', [u13(page(20))]], ['國二 上 1-3', [u13()]], ['國 二 上 1-3', [u13()]], ['國二上1-3p.20', [u13(page(20))]], ['國二上 1-3 第20頁', [u13(page(20))]], ['國二上 1-3 20頁', [u13(page(20))]],
  ['八上 1-3', [u13()]], ['8上1-3', [u13()]], ['八年級上學期 1-3', [u13()]], ['國二上學期 1-3 第20頁', [u13(page(20))]], ['國二（上）1-3', [u13()]], ['國中二年級上 1-3', [u13()]], ['自然 國二上 1-3', [u13()]], ['國二上 自然 1-3', [u13()]], ['（國二上 1-3）', [u13()]],
  ['國二上 第1章第3節 p.20', [u13(page(20))]], ['國二上 第一章第三節', [u13()]], ['國二上 單元 1-3', [u13()]], ['國二上 1-2-3 p.20', [unit('國二上', '1-2-3', page(20))]], ['國二上 20-1', [unit('國二上', '20-1')]], ['高三下 L10 圖 2-13 A', [unit('高三下', 'L10', fig('2-13a'))]],
  ['小五上 3 p.15', [unit('小五上', '3', page(15))]], ['小五上 A1', [unit('小五上', 'A1')]], ['國二上 L 1 p.20', [unit('國二上', 'L1', page(20))]], ['國一上 l1', [unit('國一上', 'l1')], false, ENGLISH],
  ['國二上 2-1 水溶液 p.15', [unit('國二上', '2-1', page(15))]], ['國二上 2-1 水溶液', [unit('國二上', '2-1', heading('水溶液'))]], ['國二上 1-3 [[別的筆記]]', [u13(note('別的筆記'))]],
  ['p.44 國二上 1-3 p.20', [page(44), u13(page(20))]], ['p.44、國二上 1-3 p.20', [page(44), u13(page(20))]],
  // 位置跟著前面的單元（D-167 第 6 點）
  ['國二上 1-3 p.44, p.45', [u13(page(44)), u13(page(45))]], ['國二上 1-3 p.44、p.45', [u13(page(44)), u13(page(45))]], ['國二上 1-3 p.44；p.45', [u13(page(44)), u13(page(45))]], ['國二上 1-3 p.44, 45', [u13(page(44)), u13(page(45))]], ['國二上 1-3, p.44', [u13(), u13(page(44))]],
  ['國二上 1-3 p.20，本單元 p.44', [u13(page(20)), page(44)]], ['國二上 1-3 p.20，本篇 p.44', [u13(page(20)), page(44)]],
  // 乾淨的列表
  ['國二上 1-3、1-8', [u13(), unit('國二上', '1-8')]], ['國二上 1-3, 1-8 p.5', [u13(), unit('國二上', '1-8', page(5))]], ['國一上 L1、L2', [unit('國一上', 'L1'), unit('國一上', 'L2')], false, ENGLISH], ['國一上 L1, L2 p.20', [unit('國一上', 'L1'), unit('國一上', 'L2', page(20))], false, ENGLISH],
  // 本篇自己的編號
  ['L3 p.30', [page(30)], false, ENGLISH], ['2-2 p.30', [page(30)]], ['5', [{ kind: 'text' }], false, MATH], ['本單元 p.44', [page(44)]],
  // 連結
  ['[[筆記#標題]]', [note('筆記#標題')]], ['[[筆記]]', [note('筆記')]], ['[[a,b]]', [note('a,b')]], ['[[國二上 L1]]', [note('國二上 L1')]], ['[[Ａ卷#２-１]]', [note('Ａ卷#２-１')]], ['[[ノート]]', [note('ノート')]], ['［［Ａ卷＃２－１］］', [note('Ａ卷#２－１')]], ['[[Ａ｜卷]]', [note('Ａ｜卷')]], ['［［筆記｜別名］］', [{ kind: 'note', link: '筆記', alias: '別名' }]], ['[[a]], [[b/c]]', [note('a'), note('b/c')]], ['[補充筆記](補充筆記.md)', [note('補充筆記')]], ['[教材](%E6%95%99.md)', [note('教')]], ['[教材](100%.md)', [note('100%')]], ['[教材](版本(甲),國二上1-3p.44)', [note('版本(甲),國二上1-3p.44')]], ['[教材](%E4%.md)', [note('%E4%')]], ['[[#睡眠的階段]]', [heading('睡眠的階段')]], ['#睡眠的階段', [heading('睡眠的階段')]], ['「睡眠的階段」', [heading('睡眠的階段')]], ['「附錄,國二上 1-3 p.20」', [heading('附錄,國二上 1-3 p.20')]], ['「不是這個」', [heading('不是這個')]], ['國二上 1-3 「標題」', [u13(heading('標題'))]], ['p.44, 「溶解, 擴散」', [page(44), heading('溶解, 擴散')]],
  // 先備、網址、題號
  ['先備：國一數學 比例式', [{ kind: 'text' }]], ['先備:比例', [{ kind: 'text' }]], ['先備：A, B', [{ kind: 'text' }]], ['https://example.com/p.44', [{ kind: 'text' }]], ['第5題', [{ kind: 'text' }]], ['https://zh.wikipedia.org/wiki/水溶液', [{ kind: 'text' }]],
  ['國二上 1-3、https://x.test、國二上1-8', [u13(), { kind: 'text' }, unit('國二上', '1-8')]], ['https://x.test，國二上1-8', [{ kind: 'text' }, unit('國二上', '1-8')]],
  // 舊標題：連結由 Obsidian 層找
  ['睡眠的階段', [heading('睡眠的階段')]], ['溶解, 擴散', [heading('溶解, 擴散')]], ['CO2 的性質', [heading('CO2 的性質')]], ['2 擴散現象', [heading('2 擴散現象')]], ['1-2 溶液', [heading('1-2 溶液')]], ['課本第三章', [heading('課本第三章')]], ['老師上課說的', [heading('老師上課說的')]], ['先備知識', [heading('先備知識')]],
  // 不算單元（D-166 第 2 點）
  ['2-1', [heading('2-1')]], ['L1', [heading('L1')]], ['U1', [heading('U1')]], ['1-2-3', [heading('1-2-3')]], ['44', [heading('44')]], ['1-3, 1-8', [heading('1-3, 1-8')]], ['國二上的回顧', [heading('國二上的回顧')]], ['高六上 L1', [heading('高六上 L1')]], ['國四上 1-3', [heading('國四上 1-3')]], ['六上 2-1', [heading('六上 2-1')]], ['二上 1-3', [heading('二上 1-3')]], ['第三冊 1-3', [heading('第三冊 1-3')]], ['B2 1-3', [heading('B2 1-3')]], ['看國二上 1-3', [heading('看國二上 1-3')]], ['數學 國二上 1-3', [heading('數學 國二上 1-3')]], ['國二上 數學 1-3', [heading('國二上 數學 1-3')], true],
  ['小五上', [heading('小五上')], true], ['小五上 p.15', [heading('小五上 p.15')], true], ['小五上 P20', [heading('小五上 P20')], true], ['小五上 圖 2-14', [heading('小五上 圖 2-14')], true], ['小五上 [[x]]', [heading('小五上 [[x]]')], true], ['小五上 第 44 頁', [heading('小五上 第 44 頁')], true], ['小五上 20頁', [heading('小五上 20頁')], true],
  ['國二上 1 3 p.20', [heading('國二上 1 3 p.20')], true], ['國二上 1-', [heading('國二上 1-')], true], ['國二上 第3節 p.20', [page(20)], true], ['國二上 第三課 p.5', [page(5)], true], ['國二上 水溶液 p.30', [page(30)], true], ['國一上 L1~L3', [heading('國一上 L1~L3')], true, ENGLISH],
  // 自己的學期沒寫單元：還是這本書
  ['國二上 p.15', [page(15)], true], ['國二上 圖2-14', [fig('2-14')], true], ['國二上 第44頁', [page(44)], true],
  // 本篇的屬性也比鍵：學期寫 八上、編號寫全形
  ['國二上 p.15', [page(15)], true, { term: '八上', subject: '自然', unit: { code: '2-2' } }], ['八上 p.15', [page(15)], true], ['L3 p.30', [page(30)], false, { term: '國一上', subject: '英文', unit: { code: 'Ｌ３' } }], ['2-2 p.30', [page(30)], false, { term: '國二上', subject: '自然', unit: { code: '２－２' } }], ['Ｅｎｇｌｉｓｈ 國一上 L1', [unit('國一上', 'L1')], false, { term: '國一上', subject: 'English', unit: { code: 'L3' } }], ['English 國一上 L1', [unit('國一上', 'L1')], false, { term: '國一上', subject: 'Ｅｎｇｌｉｓｈ', unit: { code: 'L3' } }],
  // 位置照連，但要提示
  ['1-3 p.20', [page(20)], true], ['3 p.44', [page(44)], true], ['L2 p.12', [page(12)], true, ENGLISH], ['老師說過 p.44', [page(44)], true], ['上一節 p.40', [page(40)], true], ['pH7 p.20', [page(20)], true],
  // 字裡有像編號的
  ['國二上 1-3 和 1-8', [u13(heading('和 1-8'))], true], ['p.12 of L1', [page(12)], true, ENGLISH], ['p.30, 也算 L1', [page(30), heading('也算 L1')], false, ENGLISH],
  ['國二上1-3,8', [u13(), heading('8')]], ['國一上 L1, A1 p.20', [unit('國一上', 'L1'), unit('國一上', 'L1', page(20))], true, ENGLISH], ['國二上 1-3, 2-5 題', [u13(), heading('2-5 題')]], ['國二上 1-3, 10-15 上課筆記', [u13(), heading('10-15 上課筆記')]], ['國二上 1-3, 2026-10', [u13(), heading('2026-10')]], ['國二上 1-3 p.44, 溶解說明, 45', [u13(page(44)), heading('溶解說明'), heading('45')]],
  // 只顯示的字也中斷沿用與接續（D-167 第 6 點）
  ['國二上 1-3, 第5題, 1-8', [u13(), { kind: 'text' }, heading('1-8')]], ['國二上 1-3 p.44, 第5題, 45', [u13(page(44)), { kind: 'text' }, heading('45')]], ['國二上 1-3、https://x.test、1-8', [u13(), { kind: 'text' }, heading('1-8')]], ['國二上 1-3、先備：比例、1-8', [u13(), { kind: 'text' }, heading('1-8')]], ['p.44, 本篇, 45', [page(44), { kind: 'text' }, heading('45')]], ['p.44, 2-2, 45', [page(44), { kind: 'text' }, heading('45')]],
  // 否定字：不算單元、不算位置
  ['不要算國二上 1-3', [{ kind: 'text' }], true], ['國二上 1-3 不要算這個目標', [{ kind: 'text' }], true], ['國二上 1-3 不考這個', [{ kind: 'text' }], true], ['不是國二上 1-3，是國三上 2-1', [{ kind: 'text' }, heading('是國三上 2-1')], true], ['老師說不用看 p.44', [{ kind: 'text' }], true], ['圖 2-14 不用看', [{ kind: 'text' }], true], ['不是 p.44', [{ kind: 'text' }], true],
  // 否定字緊接在沒有位置的單元後面：說的就是那個單元；有位置的是實際的出處，照連
  ['國二上 1-3，不算這個', [{ kind: 'text' }, { kind: 'text' }], true], ['國二上 1-3 水溶液，不算這個', [{ kind: 'text' }, { kind: 'text' }], true], ['國二上 1-3，不算這個，p.44', [{ kind: 'text' }, { kind: 'text' }, page(44)], true], ['國二上 1-3 p.20，老師說不用背', [u13(page(20)), { kind: 'text' }], true],
  // 否定段點名的就是前面那個單元：一樣先不算
  ['國二上 L1，不用考 L1', [{ kind: 'text' }, { kind: 'text' }], true], ['國二上 1-3，不算1-3', [{ kind: 'text' }, { kind: 'text' }], true], ['國二上 1-3，不算國二上 1-3', [{ kind: 'text' }, { kind: 'text' }], true], ['國二上 1-3，不算八上 1-3', [{ kind: 'text' }, { kind: 'text' }], true],
  // 否定段自己點名了別的東西：說的不是前面的單元
  ['國二上 1-3，不算國二下 1-3', [u13(), { kind: 'text' }], true], ['國二上 1-3，不是 1-8', [u13(), { kind: 'text' }], true], ['國二上 1-3，不算 1-3 p.20', [u13(), { kind: 'text' }], true],
  ['國二上 1-3、不是國二上 1-8', [u13(), { kind: 'text' }], true], ['國二上 1-3、不是 p.46、p.45', [u13(), { kind: 'text' }, u13(page(45))], true], ['國二上 1-3，不算 L2', [u13(), { kind: 'text' }], true], ['國二上 1-3，不是第四十四頁', [u13(), { kind: 'text' }], true], ['國二上 1-3，不是國二下', [u13(), { kind: 'text' }], true], ['國二上 1-3，不是 [[筆記]]', [u13(), { kind: 'text' }], true],
  // 範圍寫反、不確定：不連
  ['p.46-44', [heading('p.46-44')], true], ['p.44-5', [heading('p.44-5')], true], ['p.44-44', [heading('p.44-44')], true], ['第46-44頁', [heading('第46-44頁')], true], ['p53 基因', [heading('p53 基因')], true], ['第十百頁', [heading('第十百頁')]], ['pp.44', [page(44)]],
];

void test('D-167 每個例子：讀成預期的位置與單元，字面上就有問題的才標出來', () => {
  const wrong = EXAMPLES.flatMap(([text, expected, problem = false, own = NATURE]) => {
    const items = read(text, own);
    const same = JSON.stringify(items.map(item => item.link)) === JSON.stringify(expected) && items.some(item => item.problem !== undefined) === problem;
    return same ? [] : [{ text, expected, problem, got: items }];
  });
  assert.deepEqual(wrong, []);
});

// ── 性質：同一個意思套上打字雜訊，歸屬、位置與提示都不變（D-167 第 3 點）；連結與「標題」裡的字不動，雜訊只加在外面 ──

const wide = (text: string): string => text.replace(/[0-9A-Za-z.,\-]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
type Change = (text: string) => string;
const INSIDE: Record<string, Change> = {
  連續空白: t => t.replace(/ /g, '  '), 全形空白: t => t.replace(/ /g, '　'), Tab: t => t.replace(/ /g, '\t'), 全形字: wide,
  短破折號: t => t.replace(/-/g, '–'), 長破折號: t => t.replace(/-/g, '—'), 減號: t => t.replace(/-/g, '−'), 全形連字號: t => t.replace(/-/g, '－'), 全形波浪號: t => t.replace(/~/g, '～'),
  逗號前空白: t => t.replace(/,/g, ' ,'), 逗號換全形: t => t.replace(/,/g, '，'), 逗號後沒空白: t => t.replace(/, /g, ','), 零寬夾在中間: t => t.split('').join(String.fromCharCode(0x200b)),
};
const AROUND: Record<string, [string, string]> = {
  尾端空白: ['', ' '], 開頭空白: [' ', ''], 尾端逗號: ['', ','], 尾端全形逗號: ['', '，'], 尾端句號: ['', '。'], 尾端頓號: ['', '、'], 零寬字元: ['', String.fromCharCode(0x200b)], 逗號加空白: ['', ' ,'],
};
const PROTECTED = /［［[^］]*］］|\[\[[^\]]*\]\]|\[[^\]]+\]\((?:[^()]|\([^()]*\))+\)|「[^」]+」|https?:\/\/[^\s、，,]+/g;
function outside(text: string, change: Change): string {
  let out = '', last = 0;
  for (const match of text.matchAll(PROTECTED)) {
    out += change(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + change(text.slice(last));
}
/** 意思：單元比鍵；舊標題由 Obsidian 層去雜訊之後才比材料，所以也比鍵。要不要提示、算不算說明也是意思的一部分。 */
const meaning = (items: readonly SourceItem[]): string => JSON.stringify(items.map(({ link, problem, needsUnit, remark }) => ({ link, problem, needsUnit, remark })), (key, value: unknown) => {
  if (key === 'unit') return codeKey(value as string);
  if (key === 'heading') return headingKey(value as string);
  return value;
});
const NO_MATERIALS = { metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null } } as unknown as App;
/** 整條路：筆記 → parseDeck → 讀法、目錄對不到的參照、存檔的提示。 */
function throughDeck(text: string, own: SourceOwner): string {
  const deck = parseDeck(`---\n年級學期: ${own.term ?? ''}\n科目: ${own.subject ?? ''}\n單元: "${own.unit?.code ?? ''}"\n---\n- 目標 ^abc123\n    - 問 :: 答\n    - 出處：${text}\n`);
  const refs = buildIndex([{ path: 'o.md', deck }]).unresolved.map(ref => [termKey(ref.term), codeKey(ref.code)]);
  return JSON.stringify([meaning(sourceLinks(deck.targets[0].fields.sources, deck.props)), refs, unreadableSources(NO_MATERIALS, 'o.md', deck, () => []).length]);
}

void test('D-167 性質：登錄的例子套上任何一種打字雜訊，從筆記到提示與目錄，意思都不變', () => {
  for (const [text, , , own = NATURE] of EXAMPLES) {
    const base = throughDeck(text, own);
    for (const [name, change] of Object.entries(INSIDE)) {
      const changed = outside(text, change);
      assert.equal(throughDeck(changed, own), base, `${name}：${JSON.stringify(changed)}`);
    }
    for (const [name, [start, end]] of Object.entries(AROUND)) {
      const changed = start + text + end;
      assert.equal(throughDeck(changed, own), base, `${name}：${JSON.stringify(changed)}`);
    }
  }
});

void test('D-167 性質：兩種雜訊疊在一起，讀法與提示也不變', () => {
  for (const [text, , , own = NATURE] of EXAMPLES) {
    const base = meaning(read(text, own));
    for (const [first, one] of Object.entries(INSIDE)) {
      for (const [second, other] of Object.entries(INSIDE)) {
        const changed = outside(text, t => other(one(t)));
        assert.equal(meaning(read(changed, own)), base, `${first}＋${second}：${JSON.stringify(changed)}`);
      }
    }
  }
});

void test('D-167 網址的分界：半形逗號、分號後面緊接著字是網址的一部分，不算別的單元；像編號就提示。全形標點與逗號後的空白一定是分界', () => {
  assert.deepEqual(links('https://example.test/a,b'), [{ kind: 'text' }]);
  assert.equal(read('https://example.test/a,b')[0].problem, undefined, '網址裡的逗號本來就有');
  for (const text of ['https://example.test/a,國二上1-3', 'https://example.test/a;國二上1-3', 'https://example.test/a,1-8', '國二上 2-1 https://example.test/a,國二上1-3']) {
    assert.ok(read(text).every(item => item.link.kind !== 'unit' || item.link.unit !== '1-3'), text);
    assert.ok(read(text).some(item => item.problem === 'leftover'), text);
  }
  assert.equal(read('https://example.test/a,國二上1-3 p.5').at(-1)?.problem, 'leftover', '後面還有位置也要提示');
  for (const text of ['https://x.test,8上L1', 'https://x.test,八上L1', 'https://x.test,國中二年級上L1', 'https://x.test,國二上學期L1', '本篇 https://x.test,國二上1-3', '2-2 https://x.test,8上L1']) assert.ok(read(text).some(item => item.problem === 'leftover'), text);
  assert.equal(read('p.44 和 8上L1')[0].problem, 'leftover', '說明裡有認得的學期寫法也要提示');
  for (const separator of ['、', '﹑', '，', '﹐', '；', '﹔', ', ', '; ']) assert.deepEqual(links('https://example.test/a' + separator + '國二上 1-3'), [{ kind: 'text' }, u13()], separator);
  assert.deepEqual(read('https://example.test/a,').map(item => item.text), ['https://example.test/a'], '尾端的逗號不是網址的一部分');
});

void test('D-167 Markdown 連結的路徑可以有成對的括號，裡面的字不算單元', () => {
  assert.deepEqual(links('[教材](a(b(c)),國二上1-3p.44)'), [note('a(b(c)),國二上1-3p.44')]);
  assert.deepEqual(links('[教材](a\\)國二上1-3.md)'), [note('a\\)國二上1-3')]);
  assert.deepEqual(links('[教材](a(b)、國二上 1-3'), [heading('[教材](a(b)'), u13()], '括號沒有配對就不是連結');
});

void test('D-167 零寬字元夾在任何地方都不改意思；連結裡的不動', () => {
  const zero = String.fromCharCode(0x200b);
  assert.deepEqual(links('國二上 1-3 ｐ' + zero + '，４４'), [u13(page(44))]);
  assert.deepEqual(links('國' + zero + '二上 1' + zero + '-3'), [u13()]);
  assert.deepEqual(links('[[a' + zero + 'b]]'), [note('a' + zero + 'b')]);
});

void test('出處裡的私用區字元不會變成遮罩；組合的表情符號不被拆開', () => {
  const [open, close, zero] = [0xe000, 0xe001, 0x200b].map(code => String.fromCharCode(code));
  assert.doesNotThrow(() => sourceLinks([open + '0' + zero + close], NATURE));
  assert.deepEqual(links(open + '0' + close + ' p.44'), [page(44)]);
  const teacher = '👩' + String.fromCharCode(0x200d) + '🏫';
  assert.deepEqual(read('p.44 ' + teacher + ' 圖 2-14').map(item => item.text), ['p.44 ' + teacher, '圖 2-14']);
});

void test('D-167 不是雜訊的字不合併：連結裡不動，CO₂、①、L01 都保留', () => {
  assert.deepEqual(links('[[Ａ卷#２-１]]'), [note('Ａ卷#２-１')], '連結裡的全形字是檔名');
  assert.deepEqual(links('CO₂ 的性質'), [heading('CO₂ 的性質')]);
  assert.deepEqual(links('國二上 ① p.20'), [page(20)], '① 不是單元 1；自己的學期還是這本書');
  assert.deepEqual(links('國二上 2⁻¹ p.20'), [page(20)], '2⁻¹ 不是單元 2-1');
  assert.deepEqual(links('小五上 ① p.20'), [heading('小五上 ① p.20')], '別的學期不知道在哪裡');
  assert.notEqual(codeKey('L01'), codeKey('L1'));
  assert.notEqual(codeKey('2-01'), codeKey('2-1'));
  assert.equal(codeKey('Ｌ１'), codeKey('L1'));
  assert.equal(codeKey('l1'), codeKey('L1'));
  assert.equal(codeKey('２－１'), codeKey('2-1'));
  assert.equal(termKey('八上'), '國二上');
  assert.equal(termKey('國二上學期'), '國二上');
  assert.equal(termKey('暑假'), '暑假', '認不得的照原字');
});

void test('D-167 注音打出來的連字號：ㄦ、ㄧ、一、ー、之，數字之間才算', () => {
  for (const text of ['國二上 1ㄦ3', '國二上 1ㄧ3', '國二上 1一3', '國二上 1ー3', '國二上 1之3', '國二上 1─3']) assert.deepEqual(links(text), [u13()], text);
  assert.deepEqual(links('圖2一14'), [fig('2-14')]);
  assert.deepEqual(links('一下 p.5'), [page(5)].map(() => page(5)), '不是數字之間的「一」不動');
  assert.deepEqual(links('p。44'), [page(44)]);
  assert.deepEqual(links('p，44'), [page(44)]);
  assert.deepEqual(links('p：44'), [page(44)]);
  assert.deepEqual(links('p . 44'), [page(44)]);
});

void test('D-167 顯示原文：一個位置就是整段；一段好幾個位置時一個位置一個按鈕，接著前一個的寫完整', () => {
  const texts = (text: string, own: SourceOwner = NATURE): string[] => read(text, own).map(item => item.text);
  assert.deepEqual(texts('ｐ．４４'), ['ｐ．４４']);
  assert.deepEqual(texts('p.44, p.45'), ['p.44', 'p.45']);
  assert.deepEqual(texts('p.44 知識快遞'), ['p.44 知識快遞']);
  assert.deepEqual(texts('國二上 1-3 p.20'), ['國二上 1-3 p.20']);
  assert.deepEqual(texts('p.44 p.45'), ['p.44', 'p.45']);
  assert.deepEqual(texts('國二上 1-3 p.20 圖 2-14 重點'), ['國二上 1-3 p.20', '圖 2-14 重點']);
  assert.deepEqual(texts('p.44, 45'), ['p.44', 'p.45'], '只有數字的按鈕看不懂');
  assert.deepEqual(texts('圖2-14、2-15'), ['圖2-14', '圖 2-15']);
  assert.deepEqual(texts('圖2-13a、b'), ['圖2-13a', '圖 2-13b']);
  assert.deepEqual(texts('[[a]], [[b/c]]'), ['[[a]]', '[[b/c]]']);
  assert.deepEqual(texts('溶解, 擴散'), ['溶解, 擴散']);
  assert.deepEqual(texts('ｐ．４４　圖２－１４'), ['ｐ．４４', '圖２－１４'], '好幾個位置也顯示原文');
  assert.deepEqual(texts('國二上　１－３　ｐ．２０　圖２－１４　重點'), ['國二上　１－３　ｐ．２０', '圖２－１４　重點']);
  assert.deepEqual(texts('1 - 3 p.20 圖 2-14'), ['1 - 3 p.20', '圖 2-14']);
  assert.deepEqual(texts('ｐ．４４　國二上　１－３　ｐ．２０'), ['ｐ．４４', '國二上　１－３　ｐ．２０'], '位置後面接年級學期也照原文切');
  assert.deepEqual(texts('（ｐ．４４　ｐ．４５）'), ['p.44', 'p.45'], '外面有括號時不切原文，括號不會只剩一半');
  assert.deepEqual(texts('國二上 p.15 p.16'), ['國二上 p.15', 'p.16'], '自己的學期沒寫單元：一樣一個位置一個按鈕');
  const many = Array.from({ length: 100 }, (_, at) => 'ｐ．' + String(at + 1));
  assert.deepEqual(texts(many.join('　')), many, '一行很多個位置也照原文切');
  const long = Array.from({ length: 1000 }, (_, at) => 'ｐ．' + String(at + 1)).join('　');
  assert.equal(read(long).length, 1000, '長到不切原文時，位置一樣都讀到');
});

void test('D-167 同一欄不分頓號、逗號、分行：parse 拆好的每一項照順序讀，範圍接著走', () => {
  const inline = parseDeck('- 目標 ^abc123\n    - 問 :: 答\n    - 出處：小五上 2-1 p.15、p.44\n').targets[0].fields.sources;
  const nested = parseDeck('- 目標 ^abc123\n    - 問 :: 答\n    - 出處：\n        - 小五上 2-1 p.15\n        - p.44\n').targets[0].fields.sources;
  const expected = [unit('小五上', '2-1', page(15)), unit('小五上', '2-1', page(44))];
  assert.deepEqual(sourceLinks(inline, NATURE).map(item => item.link), expected);
  assert.deepEqual(sourceLinks(nested, NATURE).map(item => item.link), expected);
  assert.deepEqual(sourceLinks(['p.44', '國二上 1-3 p.20'], NATURE).map(item => item.link), [page(44), u13(page(20))]);
});

void test('D-167 讀完才去重：本篇這種字會影響後面的意思；一樣的位置只留第一個按鈕', () => {
  const fieldOf = (text: string): readonly string[] => parseDeck(`- 目標 ^abc123\n    - 問 :: 答\n    - 出處：${text}\n`).targets[0].fields.sources;
  assert.deepEqual(sourceLinks(fieldOf('本篇、國二上 1-3、本篇、p.44'), NATURE).map(item => item.link), [{ kind: 'text' }, u13(), page(44)]);
  assert.deepEqual(sourceLinks(fieldOf('國二上 1-3 p.20、本篇 p.5、國二上 1-3 p.20、p.44'), NATURE).map(item => item.link), [u13(page(20)), page(5), u13(page(44))]);
  assert.deepEqual(links('p.44、p.44'), [page(44)]);
  assert.deepEqual(read('p.44 知識快遞、ｐ．４４').map(item => item.text), ['p.44 知識快遞']);
  assert.deepEqual(read('第5題、第6題').map(item => item.text), ['第5題', '第6題'], '只顯示的項目照文字比');
  assert.deepEqual(read('p.44、p.44 和 1-8').map(item => [item.text, item.problem]), [['p.44 和 1-8', 'leftover']], '按鈕留一個，後面那項的診斷不丟');
  assert.deepEqual(read('p.44 老師說過 1-8、p.44').map(item => item.problem), ['leftover'], '前面那項的診斷也留著');
  assert.deepEqual(read('國二上 1-3、1-8 p.44、國二上 1-8 p.44').map(item => item.needsUnit), [undefined, undefined], '後面明寫了學期，就不算沿用');
  assert.deepEqual(read('國二上 1-8 p.44、1-3、1-8 p.44').map(item => item.needsUnit), [undefined, true], '前面明寫的也不會被後面的沿用蓋掉');
  assert.deepEqual(read('國二上 L1、L2 p.44、p.44').map(item => item.needsUnit), [undefined, true], '接著寫的位置沒有明寫學期，沿用的標記留著');
  assert.deepEqual(read('國二上 L1、L2 p.44、44').map(item => item.needsUnit), [undefined, true]);
  assert.deepEqual(read('國一上 Starter p.12、國一上 Starter p.12').map(item => item.needsUnit), [true], '其他編號寫兩次還是要對目錄');
});

void test('D-167 項目的邊界：不同行的字不會接成一個連結', () => {
  assert.deepEqual(sourceLinks(['[[a', 'p.44', 'b]]'], NATURE).map(item => item.link), [heading('[[a'), page(44), heading('b]]')]);
  assert.deepEqual(sourceLinks(['「a', '國二上 1-3', 'b」'], NATURE).map(item => item.link), [heading('「a'), u13(), heading('b」')]);
});

void test('D-167 別的學期沒寫單元：範圍停掉，後面的位置不知道屬於哪裡', () => {
  assert.deepEqual(links('國二上 1-3 p.44，國一下 p.15'), [u13(page(44)), heading('國一下 p.15')]);
  assert.deepEqual(links('國二上 1-3 p.44，國一下 p.15，p.16'), [u13(page(44)), heading('國一下 p.15'), heading('p.16')]);
  assert.deepEqual(links('國一上 L1, 國一下, L2 p.20', ENGLISH), [unit('國一上', 'L1'), heading('國一下'), heading('L2 p.20')]);
  assert.deepEqual(links('國二上 1-3 p.44，國一下 p.15，本篇 p.16'), [u13(page(44)), heading('國一下 p.15'), page(16)]);
});

void test('D-167 整段只有字：同一欄有讀懂別的就是說明（remark），沒有就是舊標題；否定字一定提示', () => {
  const remark = (text: string): boolean[] => read(text).map(item => item.remark === true);
  assert.deepEqual(remark('p.44, 老師說的'), [false, true]);
  assert.deepEqual(remark('老師說的'), [false]);
  assert.deepEqual(remark('p.44、睡眠的階段'), [false, true]);
  assert.deepEqual(remark('p.44, 不是重點'), [false, false], '否定字不當說明');
  assert.deepEqual(read('國二上 1-3、溶解, 1-8').map(item => [item.text, item.remark === true]), [['國二上 1-3', false], ['溶解, 1-8', false]], '併回一個舊標題時，像編號的字還是不當說明');
  assert.deepEqual(read('p.44, 45').map(item => item.remark), [undefined, undefined]);
});

void test('D-167 對不到目錄才算有問題的（needsUnit）：其他編號、沿用學期的', () => {
  const needs = (text: string, own: SourceOwner = ENGLISH): boolean[] => read(text, own).map(item => item.needsUnit === true);
  assert.deepEqual(needs('國一上 Starter'), [true]);
  assert.deepEqual(needs('國一上 L1-2'), [true]);
  assert.deepEqual(needs('國一上 L1'), [false], '標準的編號沒有卡組不提示（D-033 邊用邊長）');
  assert.deepEqual(needs('國一上 L1、L2'), [false, true]);
  assert.deepEqual(needs('國二上 1-3, 10-15', NATURE), [false, true]);
});

void test('不看別篇：沒有 own 的卡組（學業以外）一樣讀；本篇的科目與編號只在有寫時用', () => {
  assert.deepEqual(sourceLinks(['國二上 1-3 p.20'], NO_OWNER).map(item => item.link), [u13(page(20))]);
  assert.deepEqual(sourceLinks(['p.44'], NO_OWNER).map(item => item.link), [page(44)]);
  assert.deepEqual(sourceLinks(['自然 國二上 1-3'], NO_OWNER).map(item => item.link), [heading('自然 國二上 1-3')]);
});

void test('編號與名稱的切法：半形空白、全形空白、Tab 都算', () => {
  assert.deepEqual(splitUnit('2-1 水溶液'), { code: '2-1', name: '水溶液' });
  assert.deepEqual(splitUnit('2-1　水溶液'), { code: '2-1', name: '水溶液' });
  assert.deepEqual(splitUnit('2-1\t水溶液'), { code: '2-1', name: '水溶液' });
  assert.deepEqual(splitUnit('L1 Back to School'), { code: 'L1', name: 'Back to School' });
  assert.deepEqual(splitUnit('Starter'), { code: 'Starter', name: '' });
});

void test('年級學期的順序：小 → 國 → 高、年級、上 → 下；認不得的是 null', () => {
  const order = ['小一上', '小一下', '小六下', '國一上', '國三下', '高一上', '高三下'].map(termRank);
  assert.ok(order.every(rank => rank !== null));
  assert.deepEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)), order);
  for (const text of ['高六上', '國四上', '一小上', '國二', '暑假', '']) assert.equal(termRank(text), null, text);
});
