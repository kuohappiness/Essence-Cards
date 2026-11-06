// 背面補充的名稱（syntax.md：「名稱：」開頭的子項目是背面補充，例如「例句：」「記憶錨點：」「詳解：」）。

/** 名稱是一到六個字、不含空白與 Markdown 記號，後面緊接全形冒號。 */
const LABEL = /^([^\s：:*_=`[\]<>|#!]{1,6})：(\s*)(\S[\s\S]*)$/u;

/**
 * 把「記憶錨點：go 的過去式…」拆成名稱與內容（D-145：名稱自己一行）；開頭不是名稱時 label 是 null、內容是原文。
 * 內容寫在名稱底下的子項目時（D-185），每一行拿掉第一個子項目的縮排，第二行起才不會變成第一行的下一層。
 */
export function extraLabel(text: string): { label: string | null; body: string } {
  const match = LABEL.exec(text);
  if (!match) return { label: null, body: text };
  const indent = match[2].includes('\n') ? match[2].slice(match[2].lastIndexOf('\n') + 1) : '';
  const body = indent ? match[3].split('\n').map(line => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n') : match[3];
  return { label: match[1], body };
}

/**
 * 比較卡對照裡的記憶錨點（tasks/question-type-seam.md §7）：最後一個全形冒號前面是字形的說明，後面是常用詞；沒有冒號就沒有常用詞。
 * 「記憶錨點：」已經拿掉了（Card.group.rows）。
 */
export function anchorParts(anchor: string): { why: string; words: string | null } {
  const at = anchor.lastIndexOf('：');
  return at < 0 ? { why: anchor, words: null } : { why: anchor.slice(0, at), words: anchor.slice(at + 1).trim() };
}

/**
 * 背面補充開頭是英文句子、後面緊接中文翻譯時（D-174），分成兩行顯示：「She bought a book. 她買了一本書。」。
 * 只認整段從英文開始、中文之前以句尾標點結束的：「go 的過去式」「look after 照顧」這類不是句子加翻譯，照舊一行；
 * 句尾標點和中文之間的空格可有可無，中文開頭可以有自己的格式。不是這個樣子時 translation 是 null、line 是原文。
 * 兩邊都只能是純文字加完整的簡單格式（Codex L2 三輪的 F1）：切開後格式被拆成兩半的（`**She left. 她走了。**`）、
 * 切分點可能落在裡面的（`[a](b.中文)`）、看不出範圍的（`x_y`、`\*`）都照舊一行。不解析 Markdown，判斷不了就一行，一行不會壞。
 */
const TRANSLATED = /^([*_=~`"'“(]*[A-Za-z][^\p{Script=Han}]*[.?!。？！]["'’”)*_=~`]*)\s*([*_=~`]*[\p{Script=Han}「『（][\s\S]*)$/u;
/** 切分點可能落在裡面、或看不出範圍的結構：連結、HTML、網址、跳脫、數學式、註解。 */
const STRUCTURE = /[[\]<>\\]|:\/\/|www\.|\$[\s\S]*\$|%%/;
/** 完整的簡單格式：裡面沒有別的記號，頭尾不是空白（頭尾是空白的星號不是格式）。 */
const SIMPLE = /(\*\*|\*|==|~~)(?=\S)[^*_=~`]+(?<=\S)\1|`[^`]+`/g;
/** 拿掉簡單格式之後還剩下的記號。 */
const LEFTOVER = /[*_`~]|==/;
/** 這一段只有純文字加完整的簡單格式，括號也對得上。 */
function closed(text: string): boolean {
  return !LEFTOVER.test(text.replace(SIMPLE, '')) && text.split('(').length === text.split(')').length;
}
export function splitTranslation(text: string): { line: string; translation: string | null } {
  const match = STRUCTURE.test(text) ? null : TRANSLATED.exec(text);
  return match && closed(match[1]) && closed(match[2]) ? { line: match[1], translation: match[2] } : { line: text, translation: null };
}
