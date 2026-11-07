// AI 製卡的規則組（tasks/ai-cards-mvp.md §0、§1，D-151 第 1、5、6 點）：每一科照順序接哪幾份規則檔、名稱與版號。
// 建置時 tools/build.mjs 照這張表讀檔、嵌進 main.js、記 SHA-256；家長在製卡畫面看得到這一科用哪些規則與版號。
// 「重整製卡規則」做完時只改這張表、版號與標記（§0〈相鄰的工作〉）。

/** 一份規則檔：repo 根目錄算的路徑、給家長看的名稱與版號（手寫）。marker：只送標記以下（docs/card-rules/ 的檔）；false 是整份送（凍結的 R3）。 */
export interface RuleFile { path: string; name: string; version: string; marker: boolean }

/** 製卡畫面列的一科（§0 的表）。subject 是卡組屬性 `科目` 的值；一般知識不是學業卡組，是 null（syntax §2-1）。 */
export interface RuleSubject {
  key: string;
  /** 下拉選單的字。 */
  label: string;
  subject: string | null;
  /** 照 R3 交三段（`<<<全貌>>>`、`<<<架構>>>`、`<<<卡組>>>`）。 */
  r3: boolean;
  /** 允許 AI 補充的預設：R3 的科目勾，其他不勾（第二輪 README）。 */
  supplement: boolean;
  files: readonly RuleFile[];
}

/** 送給 AI 的部分從這一行之後開始（§1〈送出範圍〉）。 */
export const RULE_MARKER = '<!-- 以下送給 AI -->';
/** R3 的五步最後一行是試用時填任務資料的位置；任務資料改在任務段，嵌入時拿掉這一行。 */
const TASK_SLOT = '{{任務資料}}';

const R3_VERSION = 'R3 第二輪';
const R3: readonly RuleFile[] = [
  { path: 'experiments/t4/arch/第二輪/格式.md', name: '格式', version: R3_VERSION, marker: false },
  { path: 'experiments/t4/arch/短規則.md', name: '短規則', version: R3_VERSION, marker: false },
  { path: 'experiments/t4/arch/第二輪/判斷邊界.md', name: '判斷邊界', version: R3_VERSION, marker: false },
  { path: 'experiments/t4/arch/第二輪/五步.md', name: '五步', version: R3_VERSION, marker: false },
];
const COMMON: RuleFile = { path: 'docs/card-rules/common.md', name: '通用', version: 'v0.15', marker: true };

export const RULE_SUBJECTS: readonly RuleSubject[] = [
  { key: 'chinese', label: '國語（國小）', subject: '國語', r3: true, supplement: true, files: [...R3, { path: 'docs/card-rules/elementary-chinese.md', name: '國小國語', version: 'v0.7', marker: true }] },
  { key: 'english', label: '英文（國中）', subject: '英文', r3: false, supplement: false, files: [COMMON, { path: 'docs/card-rules/english.md', name: '英文', version: 'v0.14', marker: true }] },
  { key: 'science', label: '自然', subject: '自然', r3: true, supplement: true, files: R3 },
  { key: 'general', label: '一般知識', subject: null, r3: false, supplement: false, files: [COMMON, { path: 'docs/card-rules/general.md', name: '一般知識', version: 'v0.4', marker: true }] },
  { key: 'social', label: '社會（國小）', subject: '社會', r3: true, supplement: true, files: [...R3, { path: 'docs/card-rules/elementary-social.md', name: '國小社會', version: 'v0.7', marker: true }] },
];

/**
 * 嵌進外掛的文字（§1〈建置〉、〈送出範圍〉）：換行統一成 `\n`、拿掉 BOM；marker 的檔只留標記以下（去掉前後的空行），找不到標記丟錯；
 * 拿掉單獨一行的 `{{任務資料}}`；還有 `{{` 的變數沒填就丟錯（和試用時的檢查相同）。結尾不留空行。
 */
export function ruleText(raw: string, file: Pick<RuleFile, 'path' | 'marker'>): string {
  let text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (file.marker) {
    const lines = text.split('\n');
    const at = lines.findIndex(line => line.trim() === RULE_MARKER);
    if (at < 0) throw Error(`${file.path} 找不到標記 ${RULE_MARKER}`);
    text = lines.slice(at + 1).join('\n');
  }
  text = text.split('\n').filter(line => line.trim() !== TASK_SLOT).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  if (text.includes('{{')) throw Error(`${file.path} 還有沒填的變數（{{）`);
  if (!text) throw Error(`${file.path} 送出的部分是空的`);
  return text;
}

/** 建置嵌進外掛的一份規則：名稱、版號、文字與文字的 SHA-256（UTF-8）。 */
export interface EmbeddedRule { name: string; version: string; text: string; sha256: string }
/** 每一科（key）的規則，照表的順序。 */
export type EmbeddedRules = Readonly<Record<string, readonly EmbeddedRule[]>>;
