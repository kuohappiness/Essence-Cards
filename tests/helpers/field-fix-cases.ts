import { HEAD } from './source-edit-cases.ts';

// §1-4 的固定例子（tasks/edit-markup.md §1-4、§4-4、§6-1〈§1-4〉）：預期的全文與底線的位置照任務說明寫死。
// tests/field-fix.test.ts 逐一核對；tests/deck.test.ts 把輸入與成功的輸出登錄進 deckCases，受補 ID 與改縮排的往返保護。

/** 本篇是國二上自然 2-2；目標在第 5 行（從 0 算），第一個子項目在第 6 行。 */
const T = '- 目標 ^abc123\n    - Q :: A\n';
const split = (...children: string[]): string => HEAD + T + '    - 出處：\n' + children.map(child => '        - ' + child + '\n').join('');

/** 欄位名稱寫錯（rename）：那一項在第 line 行，改完的全文。 */
export interface RenameCase { name: string; text: string; line: number; want: string | { reason: string } }
export const RENAME_CASES: RenameCase[] = [
  { name: '出處 p.45：沒有出處欄位，就地改好', text: HEAD + T + '    - 出處 p.45\n', line: 7, want: HEAD + T + '    - 出處：p.45\n' },
  { name: '來源：p.45', text: HEAD + T + '    - 來源：p.45\n', line: 7, want: HEAD + T + '    - 出處：p.45\n' },
  { name: '來源:p.45', text: HEAD + T + '    - 來源:p.45\n', line: 7, want: HEAD + T + '    - 出處：p.45\n' },
  { name: '來源 p.45（全形空白）', text: HEAD + T + '    - 來源　p.45\n', line: 7, want: HEAD + T + '    - 出處：p.45\n' },
  { name: '已有出處：併進那一欄，刪掉這一項', text: HEAD + T + '    - 出處：p.44\n    - 來源：p.45\n', line: 8, want: HEAD + T + '    - 出處：p.44、p.45\n' },
  { name: '已有出處、這一項在前面：併到那一欄最後', text: HEAD + T + '    - 來源：p.45\n    - 出處：p.44\n', line: 7, want: HEAD + T + '    - 出處：p.44、p.45\n' },
  { name: '已有出處：併進去變成三個按鈕就分行', text: HEAD + T + '    - 出處：p.44、p.45\n    - 來源 p.46\n', line: 8, want: split('p.44', 'p.45', 'p.46') },
  { name: '已有別的單元：這一篇的加在前面', text: HEAD + T + '    - 出處：國二上 1-3 p.20\n    - 出處 p.45\n', line: 8, want: HEAD + T + '    - 出處：p.45、國二上 1-3 p.20\n' },
  { name: '已分行的出處：多一個子項目', text: split('p.44', 'p.45') + '    - 出處 p.46\n', line: 10, want: split('p.44', 'p.45', 'p.46') },
  // L2 第一輪 R7：併進分行的出處時一個頓號項一個子項目，插在子項目中間時從頓號那裡拆開。
  { name: 'L2 R7：併進分行出處的子項目中間', text: split('p.44、國二上 1-3 p.20') + '    - 來源：p.45、p.46\n', line: 9, want: split('p.44', 'p.45', 'p.46', '國二上 1-3 p.20') },
  // L2 第二輪 R13：分行的出處有子項目寫了接續行：不併進去（寫進接續行超出這批的範圍），就地改名。
  {
    name: 'L2 R13：分行出處的子項目有接續行，就地改名',
    text: split('p.44、') + '          p.20\n    - 來源：p.45、p.46\n',
    line: 10,
    want: split('p.44、') + '          p.20\n    - 出處：p.45、p.46\n',
  },
  // L2 第三輪 R15 的同一類：併進去之後拿掉的那一項隔著空行在檔尾、檔尾沒有換行：空行一起拿，檔尾照舊沒有換行。
  { name: 'L2 R15：拿掉的項目隔著空行在檔尾', text: HEAD + T + '    - 出處：p.44\n\n    - 來源 p.45', line: 9, want: HEAD + T + '    - 出處：p.44、p.45' },
  // 附著在這一項底下的引言：不刪這一行（引言會跑到別的項目底下），就地改名。
  { name: '底下附著引言：就地改名', text: HEAD + T + '    - 出處：p.44\n    - 來源：p.45\n        > 家長備忘\n', line: 8, want: HEAD + T + '    - 出處：p.44\n    - 出處：p.45\n        > 家長備忘\n' },
  {
    name: '已有出處但有接續行：就地改名，變成第二個出處欄位',
    text: HEAD + T + '    - 出處：p.44\n      p.45\n    - 來源 p.46\n',
    line: 9,
    want: HEAD + T + '    - 出處：p.44\n      p.45\n    - 出處：p.46\n',
  },
  {
    name: '已有兩個出處：就地改名',
    text: HEAD + T + '    - 出處：p.44\n    - 出處：p.45\n    - 來源 p.46\n',
    line: 9,
    want: HEAD + T + '    - 出處：p.44\n    - 出處：p.45\n    - 出處：p.46\n',
  },
  {
    name: '題目底下一行答案之外的 來源：p.45（extras 的一項）',
    text: HEAD + '- 目標 ^abc123\n    - Q :: A\n        - 來源：p.45\n',
    line: 7,
    want: HEAD + '- 目標 ^abc123\n    - Q :: A\n        - 出處：p.45\n',
  },
  { name: '直接寫成題目的目標底下', text: HEAD + '- Q :: A\n    - 出處 p.45\n', line: 6, want: HEAD + '- Q :: A\n    - 出處：p.45\n' },
  { name: '檔尾沒有換行、併進去之後刪掉最後一行', text: HEAD + T + '    - 出處：p.44\n    - 來源 p.45', line: 8, want: HEAD + T + '    - 出處：p.44、p.45' },
  { name: 'CRLF', text: (HEAD + T + '    - 出處：p.44\n    - 來源 p.45\n').replaceAll('\n', '\r\n'), line: 8, want: (HEAD + T + '    - 出處：p.44、p.45\n').replaceAll('\n', '\r\n') },
  {
    name: '需要新版：不改',
    text: HEAD.replace('---\n年', '---\n需要版本: "99.0.0"\n年') + T + '    - 出處 p.45\n',
    line: 8,
    want: { reason: '這篇需要新版的外掛才能改' },
  },
];

/** 不標的（§1-4、回報 R10）：整篇都沒有欄位名稱寫錯的標示。 */
export const NOT_RENAMED: { name: string; text: string }[] = [
  { name: '來源：植物的光合作用（讀不出位置）', text: HEAD + T + '    - 來源：植物的光合作用\n' },
  { name: '出處不明', text: HEAD + T + '    - 出處不明\n' },
  { name: '位置前面有一句話（§1-3 的問題）', text: HEAD + T + '    - 來源：老師說過 p.45\n' },
  { name: '底下有子項目', text: HEAD + T + '    - 出處 p.45\n        - 細節\n' },
  { name: '有接續行', text: HEAD + T + '    - 出處 p.45\n      還有\n' },
  { name: '多行答案', text: HEAD + '- 目標 ^abc123\n    - Q ::\n        - 來源：p.45\n' },
  { name: '備註底下的子項目', text: HEAD + T + '    - 備註：\n        - 出處 p.45\n' },
  { name: '出處底下的子項目', text: HEAD + T + '    - 出處：\n        - 來源：p.45\n' },
  { name: '題目本身', text: HEAD + '- 目標 ^abc123\n    - 出處 p.45 :: 答案\n' },
  { name: '後面接別的欄位', text: HEAD + T + '    - 來源：p.45｜類型：定義\n' },
  { name: '後面用半形 | 接別的欄位', text: HEAD + T + '    - 來源：p.45 | 類型：定義\n' },
  { name: '補充底下更深一層', text: HEAD + T + '    - 補充\n        - 出處 p.45\n' },
  { name: '不是目標的一般筆記', text: HEAD + '- 老師說的話\n    - 出處 p.45\n' },
  // 改名之後行尾的 ID 會變成出處的值，讀法就變了；這種家長自己改。
  { name: '行尾有區塊 ID', text: HEAD + T + '    - 來源：p.45 ^blk001\n' },
];

/** 半形冒號（colon）：底線的位置（每一處一段或兩段）、一次改完整篇的全文。 */
export interface ColonCase { name: string; text: string; spans: { line: number; from: number; to: number }[][]; want: string }
export const COLON_CASES: ColonCase[] = [
  {
    name: '出處:p.45｜類型:定義 標兩處、一次改完',
    text: HEAD + T + '    - 出處:p.45｜類型:定義\n',
    spans: [[{ line: 7, from: 6, to: 9 }], [{ line: 7, from: 14, to: 17 }]],
    want: HEAD + T + '    - 出處：p.45｜類型：定義\n',
  },
  {
    name: '冒號前後的空白留著',
    text: HEAD + T + '    - 重要性 : 高\n',
    spans: [[{ line: 7, from: 6, to: 11 }]],
    want: HEAD + T + '    - 重要性 ： 高\n',
  },
  {
    name: '全形半形混著寫只改半形的，含別的目標',
    text: HEAD + T + '    - 出處：p.45｜類型:定義\n    - 重要性：高\n- 目標二\n    - Q2 :: A2\n    - 備註:老師說\n',
    spans: [[{ line: 7, from: 14, to: 17 }], [{ line: 11, from: 6, to: 9 }]],
    want: HEAD + T + '    - 出處：p.45｜類型：定義\n    - 重要性：高\n- 目標二\n    - Q2 :: A2\n    - 備註：老師說\n',
  },
  {
    name: '名稱與冒號跨行：各畫一段，只換冒號',
    text: HEAD + T + '    - 出處\n      :p.44\n',
    spans: [[{ line: 7, from: 6, to: 8 }, { line: 8, from: 6, to: 7 }]],
    want: HEAD + T + '    - 出處\n      ：p.44\n',
  },
  {
    name: '分行的子項目裡的欄位、半形 | 接的欄位',
    text: HEAD + T + '    - 出處：p.44 | 類型:定義\n    - 錯題補強:\n        - 單位\n',
    spans: [[{ line: 7, from: 16, to: 19 }], [{ line: 8, from: 6, to: 11 }]],
    want: HEAD + T + '    - 出處：p.44 | 類型：定義\n    - 錯題補強：\n        - 單位\n',
  },
];
/** 半形冒號不標也不改的。 */
export const NOT_COLONS: { name: string; text: string }[] = [
  { name: '連結裡的 |類型:x', text: HEAD + T + '    - 備註：[[筆記|類型:x]]\n' },
  { name: '行內程式碼裡的冒號', text: HEAD + T + '    - 備註：`a|類型:b`\n' },
  { name: '全形的', text: HEAD + T + '    - 出處：p.45｜類型：定義\n' },
  { name: '不是目標的一般筆記', text: HEAD + '- 老師說的話\n    - 類型:定義\n' },
];
