// 背面補充的名稱（syntax.md：「名稱：」開頭的子項目是背面補充，例如「例句：」「記憶錨點：」「詳解：」）。

/** 名稱是一到六個字、不含空白與 Markdown 記號，後面緊接全形冒號。 */
const LABEL = /^([^\s：:*_=`[\]<>|#!]{1,6})：\s*(\S[\s\S]*)$/u;

/** 把「記憶錨點：go 的過去式…」拆成名稱與內容（D-145：名稱自己一行）；開頭不是名稱時 label 是 null、內容是原文。 */
export function extraLabel(text: string): { label: string | null; body: string } {
  const match = LABEL.exec(text);
  return match ? { label: match[1], body: match[2] } : { label: null, body: text };
}
