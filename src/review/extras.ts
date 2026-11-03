// 背面補充的名稱（syntax.md：「名稱：」開頭的子項目是背面補充，例如「例句：」「記憶錨點：」「詳解：」）。

/** 名稱是一到六個字、不含空白與 Markdown 記號，後面緊接全形冒號。 */
const LABEL = /^([^\s：:*_=`[\]<>|#!]{1,6})：\s*(\S[\s\S]*)$/u;

/** 把「記憶錨點：go 的過去式…」拆成名稱與內容（D-145：名稱自己一行）；開頭不是名稱時 label 是 null、內容是原文。 */
export function extraLabel(text: string): { label: string | null; body: string } {
  const match = LABEL.exec(text);
  return match ? { label: match[1], body: match[2] } : { label: null, body: text };
}

/**
 * 背面補充開頭是英文句子、後面緊接中文翻譯時（D-172），分成兩行顯示：「She bought a book. 她買了一本書。」。
 * 只認整段從英文開始、中文之前以句尾標點結束的：「go 的過去式」「look after 照顧」這類不是句子加翻譯，照舊一行；
 * 句尾標點和中文之間的空格可有可無。不是這個樣子時 translation 是 null、line 是原文。
 */
const TRANSLATED = /^([*_=~"'“(]*[A-Za-z][^\p{Script=Han}]*[.?!。？！]["'’”)*_=~]*)\s*([\p{Script=Han}「『（][\s\S]*)$/u;
export function splitTranslation(text: string): { line: string; translation: string | null } {
  const match = TRANSLATED.exec(text);
  return match ? { line: match[1], translation: match[2] } : { line: text, translation: null };
}
