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

/** 一行要念的英文（D-145：一行最多一個喇叭，按下去依序念完）：englishParts 照順序，重複的（不分大小寫）只留第一次。 */
export function lineSpeech(text: string): string[] {
  const seen = new Set<string>();
  return englishParts(text).filter(part => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 「也可以：」要列的答案（D-145）：答案格裡、結果那一行沒寫的其他答案，照答案格的順序；大小寫與前後空白不算（同 checkTyped）。 */
export function otherAnswers(answers: readonly string[], shown: string): string[] {
  const key = (text: string): string => text.trim().toLowerCase();
  return answers.filter(answer => key(answer) !== key(shown));
}

/** 題目裡英文那一段把第一處 ＿＿ 換成答案；題目沒有 ＿＿ 時回傳 null（只念答案）。 */
export function fillBlank(question: string, answer: string): string | null {
  const part = englishParts(question).find(segment => BLANK.test(segment));
  return part ? part.replace(BLANK, answer) : null;
}

/** 中文字與全形標點。 */
const CJK = /[\p{Script=Han}　-〿＀-￯]/u;
/**
 * 空格前面那段文字裡，英文句子從哪裡換行（D-145：中文句子後面接英文句子時，英文換到下一行）：
 * 最後一個中文字或全形標點的後面（UTF-16 位置）；沒有中文時 null（英文在前、中文提示在後的不換行）。
 */
export function englishBreak(text: string): number | null {
  let end: number | null = null;
  let index = 0;
  for (const char of text) {
    index += char.length;
    if (CJK.test(char)) end = index;
  }
  return end;
}

/** 冠詞（a、an、the）和後面的字用不斷行空白連起來，換行時冠詞不會留在行尾（D-145：the 和 park 不拆開）。 */
export function glueArticles(text: string): string {
  return text.replace(/\b(a|an|the) +(?=\S)/giu, '$1 ');
}

/**
 * 接在文字後面的喇叭和哪一段綁在一起換行（D-145：喇叭不單獨掉到下一行）：最後一個英文字（連同標點），
 * 或最後兩個中文字與全形標點；回傳那一段開始的位置（UTF-16），結尾的空白算在那一段裡。
 */
export function tailStart(text: string): number {
  const trimmed = text.replace(/\s+$/u, '');
  const chars = [...trimmed];
  const last = chars.at(-1);
  if (last === undefined) return 0;
  if (CJK.test(last)) return trimmed.length - chars.slice(-2).join('').replace(/^\s+/u, '').length;
  return /\S+$/u.exec(trimmed)?.index ?? trimmed.length;
}

/** 打字卡要畫幾條線：題目裡有 ＿＿ 時是第一個答案的字數（照空白切，D-122）；沒有 ＿＿ 時 0 條。 */
export function blankCount(question: string, typed: readonly string[] | null): number {
  if (!typed?.length || !BLANK.test(question)) return 0;
  return typed[0].split(/\s+/).filter(Boolean).length;
}
