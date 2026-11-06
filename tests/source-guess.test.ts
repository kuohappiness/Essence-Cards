import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBlock, countedUnit, guessSource, sourceText } from '../src/core/catalog/index.ts';
import type { CatalogUnit, SourceForm } from '../src/core/catalog/index.ts';
import { sourceLinks } from '../src/core/deck/index.ts';
import type { SourceOwner } from '../src/core/deck/index.ts';

// tasks/edit-markup.md §4-1、§4-2、§6-1：先填好的內容與會寫成的字。預期值照任務說明的表與樣式稿寫死。

const OWN: SourceOwner & { unit: { code: string; name: string } } = { term: '國二上', subject: '自然', unit: { code: '2-2', name: '水溶液' } };
const UNITS: CatalogUnit[] = [
  { term: '國一下', code: '1-3', name: '細胞的構造' },
  { term: '國二上', code: '1-3', name: '物質的分類' },
  { term: '國二上', code: '2-1', name: '溶解' },
  { term: '國二上', code: '2-2', name: '水溶液' },
  { term: '小五上', code: '1', name: '天氣' },
  { term: '小五上', code: '2', name: '植物' },
];
/** 讀法給的那一項（表單從它打開）。 */
const item = (text: string, own: SourceOwner = OWN) => {
  const found = sourceLinks([text], own);
  assert.equal(found.length, 1, text);
  return found[0];
};
const unitName = (form: SourceForm): string | null => form.unit === null ? null : form.unit === 'own' ? 'own' : `${form.unit.term} ${form.unit.code}${form.unit.exists ? '' : '（還沒有卡組）'}`;
const summary = (form: SourceForm) => ({
  unit: unitName(form), unitOrigin: form.unitOrigin,
  candidates: form.candidates.map(each => `${each.term} ${each.code}${each.exists ? '' : '（還沒有卡組）'}`),
  places: form.places.map(place => place.kind + ' ' + place.value), placesOrigin: form.placesOrigin,
  // 單元的說明與一直留著的說明合在一起比。
  remark: form.remark, note: [form.unitNote, form.note].filter(Boolean).join(' / ') || null,
});

void test('§4-1 寫了年級學期與編號但看不懂：那個單元照原文，位置照原文，說明帶進多出來的字', () => {
  const found = item('國二上 1-3 和 1-8');
  assert.equal(found.problem, 'leftover');
  assert.deepEqual(summary(guessSource(found, OWN, UNITS)), {
    unit: '國二上 1-3', unitOrigin: 'original', candidates: [], places: [], placesOrigin: 'unset', remark: '和 1-8', note: null,
  });
});

void test('§4-1 編號沒寫年級學期（1-3 p.20）：沒選，候選是這一篇的學期加編號、其他學期照順序', () => {
  assert.deepEqual(summary(guessSource(item('1-3 p.20'), OWN, UNITS)), {
    unit: null, unitOrigin: 'unset', candidates: ['國二上 1-3', '國一下 1-3'], places: ['頁 20'], placesOrigin: 'original', remark: '', note: '原文沒寫年級學期，請選一個',
  });
  // 國二下的卡組、目錄只有國二上 1-3：這一篇的學期排第一（還沒有卡組），也不預選（D-170 第 9 點）。
  const later = { ...OWN, term: '國二下', unit: { code: '1-1', name: '' } };
  assert.deepEqual(summary(guessSource(item('1-3 p.20', later), later, [{ term: '國二上', code: '1-3', name: '物質的分類' }])).candidates, ['國二下 1-3（還沒有卡組）', '國二上 1-3']);
  assert.equal(guessSource(item('1-3 p.20', later), later, [{ term: '國二上', code: '1-3', name: '物質的分類' }]).unit, null);
});

void test('§4-1 L1：編號沒寫年級學期，位置沒有', () => {
  const english = { term: '國二上', subject: '英文', unit: { code: 'L3', name: '' } };
  const units = [{ term: '國一上', code: 'L1', name: 'Hello' }, { term: '國二上', code: 'L1', name: 'School' }];
  assert.deepEqual(summary(guessSource(item('L1', english), english, units)), {
    unit: null, unitOrigin: 'unset', candidates: ['國二上 L1', '國一上 L1'], places: [], placesOrigin: 'unset', remark: '', note: '原文沒寫年級學期，請選一個',
  });
});

void test('§4-1 短的學期寫法（二上 2-1 p.15）：照這一篇的學制猜，國小、沒有學期的卡組', () => {
  assert.deepEqual(summary(guessSource(item('二上 2-1 p.15'), OWN, UNITS)), {
    unit: '國二上 2-1', unitOrigin: 'guessed', candidates: [], places: ['頁 15'], placesOrigin: 'original', remark: '', note: '原文寫「二上」，猜是國二上',
  });
  const elementary = { term: '小五上', subject: '自然', unit: { code: '1', name: '天氣' } };
  assert.equal(unitName(guessSource(item('二上 2-1 p.15', elementary), elementary, UNITS)), '小二上 2-1（還沒有卡組）');
  const none = { term: null, subject: '自然', unit: null };
  const form = guessSource(item('二上 2-1 p.15', none), none, UNITS);
  assert.deepEqual(summary(form), {
    unit: null, unitOrigin: 'unset', candidates: ['國二上 2-1'], places: ['頁 15'], placesOrigin: 'original', remark: '', note: '原文寫「二上」，不知道是哪個學制，請選一個',
  });
});

void test('§4-1 寫了年級學期沒寫編號（小五上 p.15）：沒選，候選列出那一學期的單元', () => {
  assert.deepEqual(summary(guessSource(item('小五上 p.15'), OWN, UNITS)), {
    unit: null, unitOrigin: 'unset', candidates: ['小五上 1', '小五上 2'], places: ['頁 15'], placesOrigin: 'original', remark: '', note: '原文沒寫單元編號，請選一個',
  });
});

void test('§4-1 位置前面有一句話（老師說過 p.44）：這一篇，位置照原文，說明帶進那句話', () => {
  const found = item('老師說過 p.44');
  assert.equal(found.problem, 'before');
  assert.deepEqual(summary(guessSource(found, OWN, UNITS)), {
    unit: 'own', unitOrigin: 'original', candidates: [], places: ['頁 44'], placesOrigin: 'original', remark: '老師說過', note: null,
  });
});

void test('§4-1 範圍寫反（p.46-44）、p53 後面接字：位置沒填，說明頁碼看不懂', () => {
  for (const text of ['p.46-44', 'p53 溶解']) {
    const form = guessSource(item(text), OWN, UNITS);
    assert.deepEqual([unitName(form), form.places, form.note], ['own', [], '頁碼看不懂，請重新填'], text);
  }
});

void test('§4-1 有否定字、猜不出來的：這一篇，都不填，照 D-169 第 4 點當場教', () => {
  const teach = '可以這樣寫：p.44、圖 2-14、國二上 1-3 p.20、[[筆記#標題]]；只想記一句話，請寫在「備註」';
  for (const text of ['不是 p.46', '溶解的那一段']) {
    assert.deepEqual(summary(guessSource(item(text), OWN, UNITS)), {
      unit: 'own', unitOrigin: 'original', candidates: [], places: [], placesOrigin: 'unset', remark: '', note: teach,
    }, text);
  }
});

void test('§4-1 空白的表單：這一篇，不算猜，都不填', () => {
  assert.deepEqual(summary(guessSource(null, OWN, UNITS)), {
    unit: 'own', unitOrigin: 'original', candidates: [], places: [], placesOrigin: 'unset', remark: '', note: null,
  });
});

const form = (unit: SourceForm['unit'], places: SourceForm['places'], remark = ''): SourceForm => ({ unit, unitOrigin: 'original', candidates: [], places, placesOrigin: 'original', remark, remarkOrigin: 'unset', note: null, unitNote: null });
const unit13 = { term: '國二上', code: '1-3', name: '物質的分類', exists: true };

void test('§4-2 會寫成：單元、位置、說明照順序，中間一個半形空白；這一篇不寫單元', () => {
  assert.equal(sourceText(form(unit13, [{ kind: '頁', value: '20' }, { kind: '頁', value: '21' }])), '國二上 1-3 p.20 p.21');
  assert.equal(sourceText(form('own', [{ kind: '圖', value: '2-14' }, { kind: '表', value: '2-1' }, { kind: '例題', value: '2-3' }])), '圖 2-14 表 2-1 例題 2-3');
  assert.equal(sourceText(form('own', [{ kind: '筆記連結', value: '筆記#標題' }])), '[[筆記#標題]]');
  assert.equal(sourceText(form('own', [{ kind: '筆記連結', value: '[[筆記#標題]]' }])), '[[筆記#標題]]');
  assert.equal(sourceText(form('own', [{ kind: '頁', value: '44' }], '老師畫重點')), 'p.44 老師畫重點');
  assert.equal(countedUnit(form(unit13, []), OWN), '國二上 1-3 物質的分類');
  assert.equal(countedUnit(form('own', []), OWN), '國二上 2-2 水溶液');
});

void test('§4-2 能套用：選了單元、字不是空的、讀回來和表單一樣', () => {
  assert.equal(applyBlock(form(unit13, [{ kind: '頁', value: '20' }]), OWN), null);
  assert.equal(applyBlock(form('own', [{ kind: '頁', value: '44' }, { kind: '圖', value: '2-14a' }]), OWN), null);
  assert.equal(applyBlock(form(unit13, []), OWN), null);
  assert.equal(applyBlock(form(null, [{ kind: '頁', value: '20' }]), OWN), '請先選單元');
  assert.equal(applyBlock(form('own', []), OWN), '還沒有要寫的字');
  // 位置格式不對：那一格標紅，不能套用。
  assert.equal(applyBlock(form('own', [{ kind: '頁', value: '4a' }]), OWN), '位置的格式不對');
  assert.equal(applyBlock(form('own', [{ kind: '表', value: '2-1a' }]), OWN), '位置的格式不對');
  // 說明裡有像編號或頁碼的字。
  assert.equal(applyBlock(form('own', [{ kind: '頁', value: '44' }], '和 1-8'), OWN), '說明裡有像單元或頁碼的字，請改寫，或寫在「備註」');
  // 只有說明：會被當成標題。
  assert.equal(applyBlock(form('own', [], '老師說過'), OWN), '只有說明會被當成標題，請加位置，或寫在「備註」');
});
