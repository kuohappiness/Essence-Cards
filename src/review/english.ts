// 英文的部分（D-082、D-116）：朗讀只念英文，不念中文翻譯；中翻英的例句把 ＿＿ 換成答案再念。

/** 一個以上的全形底線：打字卡題目裡的空格（D-122）。 */
export const BLANK = /＿+/;

/** 只有詞性縮寫的一段（v.、n.、adj.…）不算英文。 */
const POS = /^(?:v|vt|vi|n|adj|adv|prep|conj|pron|aux|art|int|interj|num|pl|abbr)\.$/i;
/** 英文的一段可以含的字：拉丁字母、數字、空白、英文標點、全形底線。 */
const ENGLISH_RUN = /[A-Za-z0-9＿][A-Za-z0-9＿ '’\-.,?!;:"()/]*/g;

/** 拿掉 Markdown 的格式與連結記號，只留文字（朗讀用）。 */
function plain(text: string): string {
  return text
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
    .replace(/\*\*|==|__|\*|`/g, '');
}

/**
 * 文字裡的英文段落，照出現的順序。一段是連續的英文字母、數字、英文標點與空白（含 ＿＿），前後空白去掉，
 * 尾端沒有英文字的標點不算；只有詞性縮寫（例如 `v.`）或沒有兩個字母以上的字，不算一段英文。
 */
export function englishParts(text: string): string[] {
  const parts: string[] = [];
  for (const match of plain(text).matchAll(ENGLISH_RUN)) {
    const segment = match[0].trim().replace(/^[.,?!;:"()/'’\-]+/, '');
    const words = segment.split(/\s+/).filter(Boolean);
    const real = words.filter(word => !POS.test(word) && /[A-Za-z]{2,}/.test(word));
    if (real.length) parts.push(segment);
  }
  return parts;
}

/** 題目裡英文那一段把第一處 ＿＿ 換成答案；題目沒有 ＿＿ 時回傳 null（只念答案）。 */
export function fillBlank(question: string, answer: string): string | null {
  const part = englishParts(question).find(segment => BLANK.test(segment));
  return part ? part.replace(BLANK, answer) : null;
}

/** 打字卡要畫幾條線：題目裡有 ＿＿ 時是第一個答案的字數（照空白切，D-122）；沒有 ＿＿ 時 0 條。 */
export function blankCount(question: string, typed: readonly string[] | null): number {
  if (!typed?.length || !BLANK.test(question)) return 0;
  return typed[0].split(/\s+/).filter(Boolean).length;
}
