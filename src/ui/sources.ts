import type { App, TFile } from 'obsidian';
import type { SourceLink } from '../review/index.ts';

// 出處的 Obsidian 層（W6 §3-8）：出處的每一項由純函式（review/sources.ts）變成連結的目標；這裡用 metadataCache 判斷
// 卡組的「材料」裡哪一份有那個區塊或標題，回傳要打開的連結文字。跨單元與認不得的回傳 null（照文字顯示）。

/** `[[筆記]]`、`[[筆記|別名]]` 或純文字的材料 → 連結路徑。 */
const linkpath = (material: string): string => material.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();

function materialFiles(app: App, deckPath: string, materials: readonly string[]): TFile[] {
  return materials.map(material => app.metadataCache.getFirstLinkpathDest(linkpath(material), deckPath)).filter((file): file is TFile => file !== null);
}

/**
 * 要打開的連結（給 workspace.openLinkText）：依序用第一份有那個區塊或標題的材料；位置都找不到時打開第一份材料；
 * 標題在材料裡都沒有時照文字顯示（null）；沒有材料也是 null。
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
  if (link.kind === 'block' && files.length) return files[0].path;
  return null;
}

/** 沒寫出處時用卡組本身的單元：打開第一份材料。 */
export function firstMaterial(app: App, deckPath: string, materials: readonly string[]): string | null {
  return materialFiles(app, deckPath, materials)[0]?.path ?? null;
}
