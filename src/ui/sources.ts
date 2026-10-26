import type { App, TFile } from 'obsidian';
import type { SourceLink } from '../review/index.ts';

// 出處的 Obsidian 層（W6 §3-8）：出處的每一項由純函式（review/sources.ts）變成連結的目標；這裡用 metadataCache 判斷
// 卡組的「材料」裡哪一份有那個區塊或標題，回傳要打開的連結文字。跨單元與認不得的回傳 null（照文字顯示）。

/** `[[筆記]]`、`[[筆記|別名]]` 或純文字的材料 → 連結路徑。 */
const linkpath = (material: string): string => material.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();

function materialFiles(app: App, deckPath: string, materials: readonly string[]): TFile[] {
  return materials.map(material => app.metadataCache.getFirstLinkpathDest(linkpath(material), deckPath)).filter((file): file is TFile => file !== null);
}

/** 只寫 `圖 2-13`、材料卻分成子圖（`^fig2-13a`、`^fig2-13b`）時的第一張子圖（D-094、syntax.md §2-5）；照字母取第一個。 */
function firstSubfigure(id: string, blocks: Record<string, unknown> | undefined): string | undefined {
  if (!/^fig\d+-\d+$/.test(id) || !blocks) return undefined;
  return Object.keys(blocks).filter(key => key.length === id.length + 1 && key.startsWith(id) && /[a-z]$/.test(key)).sort()[0];
}

/**
 * 要打開的連結（給 workspace.openLinkText）：依序用第一份有那個區塊或標題的材料；圖沒寫子圖字母、材料裡都沒有那個錨點時，
 * 依序用第一份有它的子圖的材料（Codex L2 F5）；位置都找不到時打開第一份材料；標題在材料裡都沒有時照文字顯示（null）；
 * 沒有材料也是 null。
 */
export function resolveSource(app: App, deckPath: string, materials: readonly string[], link: SourceLink): string | null {
  const files = materialFiles(app, deckPath, materials);
  if (link.kind === 'note') return link.link;
  if (link.kind === 'unit' || link.kind === 'text') return null;
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (link.kind === 'block' && cache?.blocks && Object.hasOwn(cache.blocks, link.id)) return `${file.path}#^${link.id}`;
    if (link.kind === 'heading' && cache?.headings?.some(heading => heading.heading === link.heading)) return `${file.path}#${link.heading}`;
  }
  if (link.kind !== 'block') return null;
  for (const file of files) {
    const sub = firstSubfigure(link.id, app.metadataCache.getFileCache(file)?.blocks);
    if (sub) return `${file.path}#^${sub}`;
  }
  return files.length ? files[0].path : null;
}

/** 沒寫出處時用卡組本身的單元：打開第一份材料。 */
export function firstMaterial(app: App, deckPath: string, materials: readonly string[]): string | null {
  return materialFiles(app, deckPath, materials)[0]?.path ?? null;
}
