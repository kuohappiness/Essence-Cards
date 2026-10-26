// 出處（syntax.md §2-5、D-080、W6 §3-8）：每一項變成連結的目標；在哪一份材料裡找由 Obsidian 層判斷。

/** 連結的目標：block 是 `#^id`、heading 是 `#標題`、note 是筆記連結本身；unit 是跨單元（W6 先照文字顯示，範圍與目錄模組做好後要能點）；text 認不得。 */
export type SourceLink =
  | { kind: 'block'; id: string }
  | { kind: 'heading'; heading: string }
  | { kind: 'note'; link: string }
  | { kind: 'unit'; term: string | null; unit: string; rest: SourceLink | null }
  | { kind: 'text' };
export interface SourceItem { text: string; link: SourceLink }

/** 位置：頁碼、圖表例題（含子圖）、段落標題、其他筆記的連結。後面可以接說明文字（照樣顯示，不影響連結）。 */
function position(text: string): SourceLink {
  const page = /^p\.?\s*(\d+)(?:\s+.*)?$/i.exec(text);
  if (page) return { kind: 'block', id: 'p' + page[1] };
  const figure = /^(圖|表|例題)\s*(\d+-\d+)(?:\s*([A-Za-z]))?(?:\s+.*)?$/.exec(text);
  if (figure) return { kind: 'block', id: ({ 圖: 'fig', 表: 'tab', 例題: 'ex' } as const)[figure[1] as '圖' | '表' | '例題'] + figure[2] + (figure[3]?.toLowerCase() ?? '') };
  const note = /^\[\[([^\]]+)\]\]$/.exec(text);
  if (note) return { kind: 'note', link: note[1] };
  if (!text) return { kind: 'text' };
  return { kind: 'heading', heading: text };
}

/** 前面寫了單元（例如 `1-3 p.20`、`L3`）或年級學期加單元（`國一下 L5`）：跨單元。 */
const UNIT = /^(?:((?:國|小|高)[一二三四五六][上下])\s+)?((?:\d+-\d+)|[LU]\d+)(?:\s+(.*))?$/;

/** 把資料欄位「出處」的每一項變成顯示文字加連結的目標。 */
export function sourceLinks(sources: readonly string[]): SourceItem[] {
  return sources.map(text => {
    const unit = UNIT.exec(text);
    if (unit) return { text, link: { kind: 'unit', term: unit[1] ?? null, unit: unit[2], rest: unit[3] ? position(unit[3]) : null } };
    return { text, link: position(text) };
  });
}
