import type { App, TFile } from 'obsidian';
import { headingKey, sourceLinks } from '../review/index.ts';
import type { SourceLink, SourceOwner } from '../review/index.ts';

// 出處的 Obsidian 層（W6 §3-8）：出處的每一項由純函式（core/deck）變成連結的目標；這裡用 metadataCache 判斷
// 卡組的「材料」裡哪一份有那個區塊或標題，回傳要打開的連結文字。跨單元的候選由索引提供（§10），這裡只管找錨點。

/** 一篇卡組與它的材料；相對連結以那篇的路徑解析。name 是單元的名稱，只有看不懂的判斷要用。 */
export interface MaterialDeck { path: string; materials: readonly string[]; name?: string }
/** 跨單元的出處的候選：那個單元的每一篇，照路徑；對不到單元是空的（照文字顯示）。 */
export type UnitDecks = (term: string, code: string) => readonly MaterialDeck[];

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

/** 這幾份材料裡第一個有那個區塊或標題的；圖沒寫子圖字母、都沒有那個錨點時，第一份有它的子圖的（Codex L2 F5）。 */
function findAnchor(app: App, files: readonly TFile[], link: { kind: 'block'; id: string } | { kind: 'heading'; heading: string }): string | null {
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    if (link.kind === 'block' && cache?.blocks && Object.hasOwn(cache.blocks, link.id)) return `${file.path}#^${link.id}`;
    if (link.kind === 'heading') {
      // 去雜訊之後比（`溶解，擴散`、`CO2 的性質`），連結用材料裡的原字。只影響連結，不影響歸屬（D-167）。
      const found = cache?.headings?.find(heading => heading.heading === link.heading) ?? cache?.headings?.find(heading => headingKey(heading.heading) === headingKey(link.heading));
      if (found) return `${file.path}#${found.heading}`;
    }
  }
  if (link.kind !== 'block') return null;
  for (const file of files) {
    const sub = firstSubfigure(link.id, app.metadataCache.getFileCache(file)?.blocks);
    if (sub) return `${file.path}#^${sub}`;
  }
  return null;
}

/**
 * 要打開的連結（給 workspace.openLinkText）：依序用第一份有那個區塊或標題的材料；位置都找不到時打開第一份材料；標題在材料裡都沒有時
 * 照文字顯示（null）；沒有材料也是 null。跨單元（§10）：每一篇照路徑、每篇的材料照原順序，全部找完才退回第一份可用的材料；只寫單元的開第一份材料；對不到單元是 null。
 */
export function resolveSource(app: App, deckPath: string, materials: readonly string[], link: SourceLink, units?: UnitDecks): string | null {
  if (link.kind === 'note') return link.link;
  if (link.kind === 'text') return null;
  if (link.kind === 'unit') {
    const files = (units?.(link.term, link.unit) ?? []).flatMap(deck => materialFiles(app, deck.path, deck.materials));
    if (link.rest?.kind === 'note') return files.length || units?.(link.term, link.unit).length ? link.rest.link : null;
    const anchor = link.rest?.kind === 'block' || link.rest?.kind === 'heading' ? findAnchor(app, files, link.rest) : null;
    return anchor ?? files[0]?.path ?? null;
  }
  const files = materialFiles(app, deckPath, materials);
  const anchor = findAnchor(app, files, link);
  if (anchor) return anchor;
  return link.kind === 'block' && files.length ? files[0].path : null;
}

/** 沒寫出處時用卡組本身的單元：打開第一份材料。 */
export function firstMaterial(app: App, deckPath: string, materials: readonly string[]): string | null {
  return materialFiles(app, deckPath, materials)[0]?.path ?? null;
}

/** 看不懂的出處（§9-5、D-167）：字面上就有問題，或要對目錄、材料才知道有問題。line 從 0 算，是目標那一行。 */
export interface UnreadableSource { line: number; name: string; text: string }
interface SourceDeck { props: SourceOwner & { materials: readonly string[] }; targets: readonly { line: number; name: string; fields: { sources: readonly string[] } }[] }

/**
 * 只在電腦判斷：要看 metadataCache。材料的快取還沒建好（null）時不知道，不提示，下次再看；連不到檔案的材料本來就找不到。
 * 卡照常複習，讀懂的照用，不算寫錯（syntax §2-10）。提示可以看目錄與材料，歸屬不行（D-167 第 2 點）。
 */
export function unreadableSources(app: App, deckPath: string, deck: SourceDeck, units: UnitDecks): UnreadableSource[] {
  const cachesOf = (path: string, materials: readonly string[]) => materialFiles(app, path, materials).map(file => app.metadataCache.getFileCache(file));
  const missing = (caches: ReturnType<typeof cachesOf>, heading: string): boolean =>
    !caches.some(cache => cache === null) && !caches.some(cache => cache?.headings?.some(each => headingKey(each.heading) === headingKey(heading)));
  const own = cachesOf(deckPath, deck.props.materials);
  return deck.targets.flatMap(({ line, name, fields }) => sourceLinks(fields.sources, deck.props).flatMap(item => {
    const { link } = item;
    let unreadable = item.problem !== undefined;
    if (link.kind === 'heading' && !item.remark) unreadable ||= missing(own, link.heading);
    if (link.kind === 'unit') {
      const decks = units(link.term, link.unit);
      if (!decks.length) unreadable ||= item.needsUnit === true;
      else if (link.rest?.kind === 'heading' && !decks.some(each => each.name && headingKey(each.name) === headingKey((link.rest as { heading: string }).heading))) {
        unreadable ||= missing(decks.flatMap(each => cachesOf(each.path, each.materials)), link.rest.heading);
      }
    }
    return unreadable ? [{ line, name, text: item.text }] : [];
  }));
}
