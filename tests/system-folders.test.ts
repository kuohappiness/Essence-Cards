import test from 'node:test';
import assert from 'node:assert/strict';
import { folderIssues, folderLabel, guardedMoves, isDeckPath, misplacedFolders, presentFolders } from '../src/core/deck/index.ts';
import type { FolderIssue } from '../src/core/deck/index.ts';
import { reminderView } from '../src/review/index.ts';

// tasks/system-folder-guard.md §1-2、§2-1～§2-3、§4 的表格測試。

const R = 'Essence Cards';
/** 一個正常的 vault：紀錄（含錯誤）、考試範圍（含小考）、錯題本、英文的卡組。 */
const NORMAL = [
  `${R}/紀錄/2026-11 PC-1a2b.jsonl`,
  `${R}/紀錄/2026-10 iPhone-7f3a.jsonl`,
  `${R}/紀錄/錯誤/2026-11 PC-1a2b 錯誤.jsonl`,
  `${R}/考試範圍/段考.md`,
  `${R}/考試範圍/小考/2026-11-10 英文.md`,
  `${R}/錯題本/數學.md`,
  `${R}/英文/L1.md`,
  `${R}/英文/L2.md`,
];
const REMEMBERED = presentFolders(NORMAL);
/** 把 from 底下的檔搬到 to。 */
const move = (files: readonly string[], from: string, to: string): string[] => files.map(p => p.startsWith(from + '/') ? to + p.slice(from.length) : p);

void test('§1-2 同一批只處理最上層', () => {
  assert.deepEqual(guardedMoves([`${R}/紀錄`, `${R}/紀錄/2026-11 PC-1a2b.jsonl`, `${R}/紀錄/錯誤`, `${R}/紀錄/錯誤/x.jsonl`]), [`${R}/紀錄`]);
  assert.deepEqual(guardedMoves([R, `${R}/紀錄`, `${R}/考試範圍`, `${R}/考試範圍/小考`, `${R}/英文`, `${R}/英文/L1.md`]), [R]);
  assert.deepEqual(guardedMoves([`${R}/紀錄/錯誤`, `${R}/紀錄/錯誤/x.jsonl`]), [`${R}/紀錄/錯誤`]);
  assert.deepEqual(guardedMoves([`${R}/考試範圍`, `${R}/錯題本`]), [`${R}/考試範圍`, `${R}/錯題本`]);
  // 卡組資料夾、單一檔案、更深處同名的資料夾都不管（§3、D-040）。
  assert.deepEqual(guardedMoves([`${R}/英文`, `${R}/考試範圍/段考.md`, `${R}/學業/錯題本`]), []);
});

void test('§2-1 記住原位有檔的系統資料夾；沒有檔的不記', () => {
  assert.deepEqual(REMEMBERED, [R, `${R}/考試範圍`, `${R}/錯題本`, `${R}/紀錄`, `${R}/紀錄/錯誤`, `${R}/考試範圍/小考`]);
});

const cases: { name: string; files: string[]; remembered?: string[]; issues: FolderIssue[] }[] = [
  { name: '正常', files: NORMAL, issues: [] },
  { name: '紀錄搬進卡組資料夾', files: move(NORMAL, `${R}/紀錄`, `${R}/英文/紀錄`), issues: [{ kind: 'moved', folder: `${R}/紀錄`, at: [`${R}/英文/紀錄`] }] },
  { name: '考試範圍搬到 Essence Cards 外面', files: move(NORMAL, `${R}/考試範圍`, '其他/考試範圍'), issues: [{ kind: 'missing', folder: `${R}/考試範圍` }] },
  { name: '改名', files: move(NORMAL, `${R}/錯題本`, `${R}/錯題`), issues: [{ kind: 'missing', folder: `${R}/錯題本` }] },
  { name: '子資料夾搬走：寫子資料夾', files: move(NORMAL, `${R}/紀錄/錯誤`, `${R}/英文/錯誤`), issues: [{ kind: 'moved', folder: `${R}/紀錄/錯誤`, at: [`${R}/英文/錯誤`] }] },
  {
    name: '兩個同名都列出來',
    files: [...move(NORMAL, `${R}/錯題本`, `${R}/英文/錯題本`), `${R}/學業/錯題本/自己的.md`],
    issues: [{ kind: 'moved', folder: `${R}/錯題本`, at: [`${R}/學業/錯題本`, `${R}/英文/錯題本`] }],
  },
  {
    name: '根資料夾整個搬走',
    files: move(NORMAL, R, '學校/Essence Cards'),
    issues: [{ kind: 'moved', folder: R, at: ['學校/Essence Cards'] }],
  },
  { name: '根資料夾改名：找不到，下層不再列', files: move(NORMAL, R, 'EC'), issues: [{ kind: 'missing', folder: R }] },
  {
    name: '新 vault 還沒有錯題本，更深處有家長的錯題本卡組：不提醒',
    files: [`${R}/英文/L1.md`, `${R}/學業/國二上/英文/錯題本/L1.md`],
    remembered: presentFolders([`${R}/英文/L1.md`]),
    issues: [],
  },
  {
    name: '原位與別處都有：外掛在原位寫了新的紀錄',
    files: [...move(NORMAL, `${R}/紀錄`, `${R}/英文/紀錄`), `${R}/紀錄/2026-11 PC-1a2b.jsonl`],
    issues: [{ kind: 'both', folder: `${R}/紀錄`, at: [`${R}/英文/紀錄`] }],
  },
  {
    name: '原位與別處都有：範圍檔同名',
    files: [...NORMAL, `${R}/英文/考試範圍/段考.md`],
    issues: [{ kind: 'both', folder: `${R}/考試範圍`, at: [`${R}/英文/考試範圍`] }],
  },
  {
    name: '家長自己的同名卡組資料夾、檔名不重疊：不算',
    files: [...NORMAL, `${R}/學業/錯題本/英文.md`, `${R}/學業/紀錄/讀書心得.md`],
    issues: [],
  },
];

for (const each of cases) {
  void test('§2-2 ' + each.name, () => {
    assert.deepEqual(folderIssues(each.files, each.remembered ?? REMEMBERED), each.issues);
  });
}

void test('§2-3 只排除判定出來的資料夾', () => {
  const files = [...move(NORMAL, `${R}/考試範圍`, `${R}/英文/考試範圍`), `${R}/學業/考試範圍2/x.md`];
  const issues = folderIssues(files, REMEMBERED);
  assert.deepEqual(misplacedFolders(issues), [`${R}/英文/考試範圍`]);
  // 搬進卡組資料夾的範圍檔，isDeckPath 本身仍會當成卡組，所以要靠 misplacedFolders 排除。
  assert.equal(isDeckPath(`${R}/英文/考試範圍/段考.md`), true);
  assert.deepEqual(misplacedFolders([{ kind: 'missing', folder: `${R}/紀錄` }]), []);
});

void test('畫面上的名字', () => {
  assert.equal(folderLabel(R), 'Essence Cards');
  assert.equal(folderLabel(`${R}/紀錄/錯誤`), '紀錄/錯誤');
});

void test('§2-4 提醒一區的文字與按鈕', () => {
  const view = reminderView(null, [
    { kind: 'moved', folder: `${R}/紀錄`, at: [`${R}/英文/紀錄`] },
    { kind: 'moved', folder: `${R}/錯題本`, at: [`${R}/學業/錯題本`, `${R}/英文/錯題本`] },
    { kind: 'missing', folder: `${R}/紀錄/錯誤` },
    { kind: 'missing', folder: R },
    { kind: 'both', folder: `${R}/考試範圍`, at: [`${R}/英文/考試範圍`] },
  ]);
  assert.equal(view.count, 5);
  assert.deepEqual(view.folders.map(item => [item.text, item.action]), [
    ['「紀錄」不在原位，現在在「Essence Cards/英文/紀錄」。搬回「Essence Cards」底下，複習進度就會回來', 'move'],
    ['「錯題本」不在原位，有好幾個同名的資料夾：「Essence Cards/學業/錯題本」、「Essence Cards/英文/錯題本」。把對的那一個搬回「Essence Cards」底下，外掛就讀得到', null],
    ['找不到「紀錄/錯誤」。如果改了名或搬到別處，請改回「錯誤」、放回「Essence Cards/紀錄」底下', 'dismiss'],
    ['找不到「Essence Cards」。如果改了名或搬到別處，請改回「Essence Cards」、放回 vault 最上層', 'dismiss'],
    ['有兩個「考試範圍」：「Essence Cards/考試範圍」、「Essence Cards/英文/考試範圍」。請把別處那個裡面的檔搬進「Essence Cards/考試範圍」，再刪掉空的資料夾', null],
  ]);
});
