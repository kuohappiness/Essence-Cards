import type { SourceEditAction } from '../../src/core/deck/index.ts';

// 出處寫回的固定例子（tasks/edit-markup.md §4-3、§6-1〈寫回〉）：預期的全文照任務說明與格式查核回報寫死。
// tests/source-edit.test.ts 逐一核對；tests/deck.test.ts 把輸入與成功的輸出登錄進 deckCases，受補 ID 與改縮排的往返保護。

/** 本篇是國二上自然 2-2；目標在第 5 行（從 0 算）。 */
export const HEAD = '---\n年級學期: 國二上\n科目: 自然\n單元: "2-2 水溶液"\n---\n';
export const TARGET = 5;
const T = '- 目標 ^abc123\n    - Q :: A\n';

export interface EditCase {
  name: string;
  text: string;
  /** 目標那一行；沒寫是 TARGET。 */
  target?: number;
  action: SourceEditAction;
  /** 成功時改完的全文；不寫時是表單上那一句原因。 */
  want: string | { reason: string };
}
const replace = (part: number, text: string, own: boolean): SourceEditAction => ({ kind: 'replace', part, text, own });
const add = (text: string, own: boolean): SourceEditAction => ({ kind: 'add', text, own });
const field = (value: string): string => HEAD + T + '    - 出處：' + value + '\n';
const split = (...children: string[]): string => HEAD + T + '    - 出處：\n' + children.map(child => '        - ' + child + '\n').join('');
const SPLIT_LINE = { reason: '這一項分在兩行，請直接改字' };

export const EDIT_CASES: EditCase[] = [
  // ── 換掉一段 ──
  { name: '同一行換掉看不懂的一段', text: field('老師說過 p.44'), action: replace(0, 'p.44 老師說過', true), want: field('p.44 老師說過') },
  { name: '連同接續段（1-3 p.20、21）', text: field('1-3 p.20、21'), action: replace(0, '國二上 1-3 p.20 p.21', false), want: field('國二上 1-3 p.20 p.21') },
  { name: '換成別的單元、後面還有這一篇的位置 → 搬到最後', text: field('1-3 p.20、p.44'), action: replace(0, '國二上 1-3 p.20', false), want: field('p.44、國二上 1-3 p.20') },
  { name: '跟著別的單元的段改成這一篇：寫本單元', text: field('國二上 1-3 p.20、老師說過 p.21'), action: replace(1, 'p.21', true), want: field('國二上 1-3 p.20、本單元 p.21') },
  { name: 'R3：p.44、45 換第一段，45 一起換', text: field('p.44、45'), action: replace(0, '國二上 1-3 p.20', false), want: field('國二上 1-3 p.20') },
  { name: 'R3：國二上 1-3 p.20、p.21 換成本篇的 p.44，p.21 會變成本篇 → 不寫', text: field('國二上 1-3 p.20、p.21'), action: replace(0, 'p.44', true), want: { reason: '改完之後，後面的「p.21」會跟著改，請直接改字' } },
  { name: 'R3：學期列表國二上 1-3、1-8 換第一段，1-8 失去學期 → 不寫', text: field('國二上 1-3、1-8'), action: replace(0, 'p.44', true), want: { reason: '改完之後，後面的「1-8」會跟著改，請直接改字' } },
  { name: 'R3：子圖接續圖2-13a、b，b 一起換', text: field('圖2-13a、b'), action: replace(0, '圖 2-14', true), want: field('圖 2-14') },
  { name: 'R8：國二上 1-3 和 1-8、1-9 p.21 只換第一段，1-9 照舊', text: field('國二上 1-3 和 1-8、1-9 p.21'), action: replace(0, '國二上 1-3 p.20', false), want: field('國二上 1-3 p.20、1-9 p.21') },
  { name: 'R8：改成本篇的位置會讓 1-9 p.21 失去學期 → 不寫', text: field('國二上 1-3 和 1-8、1-9 p.21'), action: replace(0, 'p.20', true), want: { reason: '改完之後，後面的「1-9 p.21」會跟著改，請直接改字' } },
  { name: '逗號接著的段只換那一段', text: field('p.44, 老師說過 p.45'), action: replace(1, 'p.45 老師說過', true), want: field('p.44, p.45 老師說過') },

  // ── 加一段 ──
  { name: '整欄都是別的單元：這一篇的加在最前面', text: field('國二上 1-3 p.20'), action: add('p.44', true), want: field('p.44、國二上 1-3 p.20') },
  { name: '這一篇的加在第一個別的單元前面（變成三個按鈕 → 分行）', text: field('p.44、國二上 1-3 p.20'), action: add('p.50', true), want: split('p.44', 'p.50', '國二上 1-3 p.20') },
  { name: '別的單元加在最後', text: field('p.44'), action: add('國二上 1-3 p.20', false), want: field('p.44、國二上 1-3 p.20') },
  { name: '空的出處：寫進那一欄', text: field(''), action: add('p.44', true), want: field('p.44') },
  { name: '沒有出處欄位：在第一個子項目前面加一行', text: HEAD + T, action: add('p.44', true), want: HEAD + '- 目標 ^abc123\n    - 出處：p.44\n    - Q :: A\n' },
  { name: '沒有出處欄位、加的是連結：新的一行也分行', text: HEAD + T, action: add('[[筆記#標題]]', true), want: HEAD + '- 目標 ^abc123\n    - 出處：\n        - [[筆記#標題]]\n    - Q :: A\n' },
  { name: '直接寫成題目的目標沒有子項目：加在它底下', text: HEAD + '- Q :: A\n', action: add('p.44', true), want: HEAD + '- Q :: A\n    - 出處：p.44\n' },

  // ── 分行 ──
  { name: '有連結就分行', text: field('p.44'), action: add('[[筆記#標題]]', true), want: split('p.44', '[[筆記#標題]]') },
  { name: 'R4：溶解, 擴散 留在同一行', text: field('溶解, 擴散、p.44'), action: add('p.45', true), want: split('溶解, 擴散', 'p.44', 'p.45') },
  { name: 'R4：p，44 留在同一行', text: field('p，44、p.45'), action: add('p.46', true), want: split('p，44', 'p.45', 'p.46') },
  { name: '斜線與「標題」不拆', text: field('p.44/45、「溶解的定義」'), action: add('p.50', true), want: split('p.44/45', '「溶解的定義」', 'p.50') },
  { name: 'Markdown 連結與網址', text: field('[講義](https://x.test/a)、https://x.test/b'), action: add('p.50', true), want: split('[講義](https://x.test/a)', 'https://x.test/b', 'p.50') },
  { name: '｜接別的欄位、出處在最前', text: HEAD + T + '    - 出處：p.44、p.45｜類型：定義\n', action: add('p.46', true), want: split('p.44', 'p.45', 'p.46') + '    - 類型：定義\n' },
  { name: '｜接別的欄位、出處在中間', text: HEAD + T + '    - 類型：定義｜出處：p.44、p.45｜重要性：高\n', action: add('p.46', true), want: split('p.44', 'p.45', 'p.46') + '    - 類型：定義｜重要性：高\n' },
  { name: '半形 | 接別的欄位、出處在最後', text: HEAD + T + '    - 類型：定義 | 出處：p.44、p.45\n', action: add('p.46', true), want: split('p.44', 'p.45', 'p.46') + '    - 類型：定義\n' },
  {
    name: '｜那一行底下有別的欄位：子項目不動',
    text: HEAD + T + '    - 類型：定義｜出處：p.44、p.45\n        - 重要性：高\n        - 錯題補強：單位\n',
    action: add('p.46', true),
    want: split('p.44', 'p.45', 'p.46') + '    - 類型：定義\n        - 重要性：高\n        - 錯題補強：單位\n',
  },
  { name: '已經分行的：加這一篇的是新的子項目', text: split('p.44', '國二上 1-3 p.20'), action: add('p.50', true), want: split('p.44', 'p.50', '國二上 1-3 p.20') },
  { name: '已經分行的：加別的單元在最後', text: split('p.44', 'p.45'), action: add('國二上 1-3 p.20', false), want: split('p.44', 'p.45', '國二上 1-3 p.20') },
  { name: '已經分行的：換掉一段', text: split('老師說過 p.44', 'p.45'), action: replace(0, 'p.44 老師說過', true), want: split('p.44 老師說過', 'p.45') },
  { name: '已經分行、接續段在下一行：一起換，按鈕變少不改回', text: split('p.44', '45', 'p.50'), action: replace(0, 'p.46', true), want: split('p.46', 'p.50') },
  // L2 第一輪 R1：拿掉接續段那一行時，只拿那一行；底下附著的引言、程式碼區塊留著，檔尾沒有換行照舊。
  {
    name: 'L2 R1：接續段底下有引言，引言留著',
    text: split('老師說過 p.20', '21') + '            > 家長備忘\n',
    action: replace(0, 'p.20 p.21', true),
    want: split('p.20 p.21') + '            > 家長備忘\n',
  },
  {
    name: 'L2 R1：接續段底下有程式碼區塊，區塊留著',
    text: split('老師說過 p.20', '21') + '            ```\n            code\n            ```\n',
    action: replace(0, 'p.20 p.21', true),
    want: split('p.20 p.21') + '            ```\n            code\n            ```\n',
  },
  { name: 'L2 R1：接續段在最後一行、檔尾沒有換行', text: split('老師說過 p.20', '21').slice(0, -1), action: replace(0, 'p.20 p.21', true), want: split('p.20 p.21').slice(0, -1) },
  // L2 第二輪 R12：連續拿掉好幾個接續段的子項目、最後一行沒有換行：檔尾照舊沒有換行（LF、CRLF）。
  { name: 'L2 R12：拿掉兩個接續段、檔尾沒有換行', text: split('老師說過 p.20', '21', '22').slice(0, -1), action: replace(0, 'p.20 p.21 p.22', true), want: split('p.20 p.21 p.22').slice(0, -1) },
  { name: 'L2 R12：拿掉兩個接續段、CRLF 檔尾沒有換行', text: split('老師說過 p.20', '21', '22').slice(0, -1).replaceAll('\n', '\r\n'), action: replace(0, 'p.20 p.21 p.22', true), want: split('p.20 p.21 p.22').slice(0, -1).replaceAll('\n', '\r\n') },
  { name: 'L2 R12：拿掉中間兩個接續段，後面的子項目留著', text: split('老師說過 p.20', '21', '22', 'p.30'), action: replace(0, 'p.20 p.21 p.22', true), want: split('p.20 p.21 p.22', 'p.30') },
  // L2 第三輪 R15：拿掉的接續段隔著空行到檔尾、檔尾沒有換行：拿完之後檔尾的空行一起拿，檔尾照舊沒有換行；附著的引言留著。
  { name: 'L2 R15：接續段隔著空行到檔尾、檔尾沒有換行', text: split('老師說過 p.20', '21') + '\n        - 22', action: replace(0, 'p.20 p.21 p.22', true), want: split('p.20 p.21 p.22').slice(0, -1) },
  { name: 'L2 R15：接續段隔著空行到檔尾、CRLF', text: (split('老師說過 p.20', '21') + '\n        - 22').replaceAll('\n', '\r\n'), action: replace(0, 'p.20 p.21 p.22', true), want: split('p.20 p.21 p.22').slice(0, -1).replaceAll('\n', '\r\n') },
  { name: 'L2 R15：空行前有附著的引言，引言留著、檔尾沒有換行', text: split('老師說過 p.20', '21') + '            > 家長備忘\n\n        - 22', action: replace(0, 'p.20 p.21 p.22', true), want: split('p.20 p.21 p.22') + '            > 家長備忘' },
  { name: 'L2 R15：檔尾有換行時空行照舊', text: split('老師說過 p.20', '21') + '\n        - 22\n', action: replace(0, 'p.20 p.21 p.22', true), want: split('p.20 p.21 p.22') + '\n' },
  // L2 第二輪 R13：分行的子項目有接續行，和那一欄有接續行一樣不寫（§4-3 第 4 點、§8）。
  { name: 'L2 R13：分行的子項目有接續行，加一段不寫', text: split('p.44、') + '          國二上 1-3 p.20\n', action: add('p.50', true), want: SPLIT_LINE },
  { name: 'L2 R13：分行的子項目有接續行，換一段也不寫', text: split('p.44', '老師說過 p.45') + '          p.46\n', action: replace(0, 'p.43', true), want: SPLIT_LINE },
  // L2 第一輪 R7：已經分行、要加的位置在一個子項目的中間（那一行用頓號寫了好幾項）：從頓號那裡拆開，新的一項自己一行。
  { name: 'L2 R7：分行的子項目中間加一段', text: split('p.44、國二上 1-3 p.20'), action: add('p.50', true), want: split('p.44', 'p.50', '國二上 1-3 p.20') },

  // ── 版面 ──
  { name: '2 格縮排', text: HEAD + '- 目標\n  - Q :: A\n  - 出處：p.44、p.45\n', action: add('p.46', true), want: HEAD + '- 目標\n  - Q :: A\n  - 出處：\n      - p.44\n      - p.45\n      - p.46\n' },
  { name: 'Tab 縮排', text: HEAD + '- 目標\n\t- Q :: A\n\t- 出處：p.44、p.45\n', action: add('p.46', true), want: HEAD + '- 目標\n\t- Q :: A\n\t- 出處：\n\t\t- p.44\n\t\t- p.45\n\t\t- p.46\n' },
  { name: '* 清單照它的內容位置', text: HEAD + '- 目標\n    * Q :: A\n    * 出處：p.44、p.45\n', action: add('p.46', true), want: HEAD + '- 目標\n    * Q :: A\n    * 出處：\n      * p.44\n      * p.45\n      * p.46\n' },
  { name: '數字清單照它的內容位置', text: HEAD + '- 目標\n    1. Q :: A\n    2. 出處：p.44、p.45\n', action: add('p.46', true), want: HEAD + '- 目標\n    1. Q :: A\n    2. 出處：\n       - p.44\n       - p.45\n       - p.46\n' },
  {
    name: 'BOM、CRLF、檔尾沒有換行',
    text: '\uFEFF' + HEAD.replaceAll('\n', '\r\n') + '- 目標 ^abc123\r\n    - Q :: A',
    action: add('p.44', true),
    want: '\uFEFF' + HEAD.replaceAll('\n', '\r\n') + '- 目標 ^abc123\r\n    - 出處：p.44\r\n    - Q :: A',
  },
  {
    name: '檔尾沒有換行、加在最後一個子項目後面',
    text: HEAD + T + '    - 出處：\n        - p.44\n        - p.45',
    action: add('國二上 1-3 p.20', false),
    want: HEAD + T + '    - 出處：\n        - p.44\n        - p.45\n        - 國二上 1-3 p.20',
  },

  // ── 位置 ──
  { name: '欄位在題目底下', text: HEAD + '- 目標\n    - Q :: A\n        - 出處：老師說過 p.44\n', action: replace(0, 'p.44', true), want: HEAD + '- 目標\n    - Q :: A\n        - 出處：p.44\n' },
  { name: '欄位在共用補充底下', text: HEAD + '- 目標\n    - Q :: A\n    - 補充說明\n        - 出處：老師說過 p.44\n', action: replace(0, 'p.44', true), want: HEAD + '- 目標\n    - Q :: A\n    - 補充說明\n        - 出處：p.44\n' },
  { name: '欄位在題下補充底下', text: HEAD + '- 目標\n    - Q :: A\n        - 題下補充\n            - 出處：老師說過 p.44\n', action: replace(0, 'p.44', true), want: HEAD + '- 目標\n    - Q :: A\n        - 題下補充\n            - 出處：p.44\n' },
  { name: '欄位在多行答案的題目底下', text: HEAD + '- 目標\n    - Q ::\n        - 答案\n        - 出處：老師說過 p.44\n', action: replace(0, 'p.44', true), want: HEAD + '- 目標\n    - Q ::\n        - 答案\n        - 出處：p.44\n' },
  {
    name: '第二個目標',
    text: HEAD + T + '    - 出處：老師說過 p.44\n- 目標二\n    - Q2 :: A2\n    - 出處：老師說過 p.44\n',
    target: 8,
    action: replace(0, 'p.44', true),
    want: HEAD + T + '    - 出處：老師說過 p.44\n- 目標二\n    - Q2 :: A2\n    - 出處：p.44\n',
  },

  // ── 不寫 ──
  { name: '兩個出處欄位', text: HEAD + T + '    - 出處：p.44\n    - 出處：p.45\n', action: add('p.46', true), want: { reason: '這個目標寫了兩處「出處」，先合併成一處' } },
  { name: '同一行兩個出處', text: HEAD + T + '    - 出處：p.44｜出處：p.45\n', action: add('p.46', true), want: { reason: '這個目標寫了兩處「出處」，先合併成一處' } },
  { name: '出處有接續行', text: HEAD + T + '    - 出處：老師說過 p.44\n      p.45\n', action: replace(0, 'p.44', true), want: SPLIT_LINE },
  { name: '需要新版', text: HEAD.replace('---\n年', '---\n需要版本: "99.0.0"\n年') + T + '    - 出處：p.44\n', target: TARGET + 1, action: add('p.45', true), want: { reason: '這篇需要新版的外掛才能改' } },
  { name: '需要版本讀不懂', text: HEAD.replace('---\n年', '---\n需要版本: 3\n年') + T + '    - 出處：p.44\n', target: TARGET + 1, action: add('p.45', true), want: { reason: '這篇需要新版的外掛才能改' } },
  { name: '要改的段切不出原文', text: HEAD + T + '    - 出處：老師說過 p\uE000.44\n', action: replace(0, 'p.44', true), want: SPLIT_LINE },
];
