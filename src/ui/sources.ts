import type { App, TFile } from 'obsidian';
import { headingKey, readSourceParts, splitSource } from '../review/index.ts';
import type { SourceItem, SourceLink, SourceOwner, SourcePart, SourceScope, Span, TargetLayout } from '../review/index.ts';

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
      // 去雜訊之後比（`溶解，擴散`、`CO2 的性質`），連結用材料裡的原字。只影響連結，不影響歸屬（D-170）。
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

/**
 * 看不懂的出處（§9-5、D-170）：字面上就有問題，或要對目錄、材料才知道有問題。每一段原文判斷一次（tasks/edit-markup.md §1-3），
 * 一段裡只要有一項有問題就算一段。line 從 0 算，是目標那一行；text 是那一段的原文；tip 是滑過的說明；
 * item 是那一段裡第一個有問題的項目，text 換成那一段的原文（表單猜測用）；at 是那一段在檔案的位置，卡組有 layout 而且切得出原文時才有。
 * part 是第幾段（readSourceParts 的順序，寫回用）；follows 是接在它後面、同一個單元的位置的項目（`1-3 p.20、21` 的 `21`，§4-3 第 1 點），
 * 寫回時一起換掉；whole 是那一段連同它們的原文（表單上的「原文」）；scope 是那一段跟著哪個單元（表單預選單元用，L2 第一輪 R3）。
 */
export interface UnreadableSource { line: number; name: string; text: string; tip: string; item: SourceItem; at: Span | null; part: number; follows: SourceItem[]; whole: string; scope: SourceScope }
interface SourceDeck {
  props: SourceOwner & { materials: readonly string[] };
  targets: readonly { line: number; name: string; fields: { sources: readonly string[] } }[];
  layout?: ReadonlyMap<number, Pick<TargetLayout, 'entries' | 'parts'>>;
}

/** 一段的原文；切不出來時用讀出的字。 */
const partText = (sources: readonly string[], part: SourcePart): string =>
  part.from !== null && part.to !== null ? sources[part.entry].slice(part.from, part.to) : part.items.map(item => item.text).join(' ');

/**
 * 點了看不懂的出處、用命令打開時，那一段現在是哪個目標的第幾段（L2 第一輪 R2、R6）。標示是停止打字 250 ms 後算的，之後改字時跟著平移，
 * 所以用標示現在的位置找（line、column 從 0 算，是標示開頭現在的位置），不用標示記的行號：上面多了一個出處相同的目標時，舊行號指到別的目標。
 * 有位置的段：那個位置開頭的那一段，原文要和標示時一樣；切不出原文的段（at 是 null，標示畫在那一欄出處的第一行）：那一行是哪個目標的
 * 第一個出處欄位、同一個第幾段的原文一樣。找不到（那裡的字改過）是 null。
 */
export function relocateSource(
  deck: { targets: readonly { line: number; fields: { sources: readonly string[] } }[]; layout: ReadonlyMap<number, Pick<TargetLayout, 'entries' | 'parts' | 'fields'>> },
  hit: Pick<UnreadableSource, 'at' | 'part' | 'text'>,
  line: number,
  column: number,
): { target: number; part: number } | null {
  for (const { line: target, fields } of deck.targets) {
    const layout = deck.layout.get(target);
    if (!layout) continue;
    if (hit.at === null) {
      const part = layout.parts[hit.part];
      if (layout.fields[0]?.line === line && part && partText(fields.sources, part) === hit.text) return { target, part: hit.part };
      continue;
    }
    const part = layout.parts.findIndex(each => {
      const entry = layout.entries[each.entry];
      return entry && each.from !== null && entry.line === line && entry.from + each.from === column;
    });
    if (part >= 0 && partText(fields.sources, layout.parts[part]) === hit.text) return { target, part };
  }
  return null;
}

/** 看不懂的原因，照 §1-3 的表排：同一段有好幾個時用最前面的。 */
const REASONS = {
  term: (code: string) => `沒寫年級學期，不知道是哪一個 ${code}`,
  'term-only': '寫了年級學期，沒有完整的單元編號',
  position: '頁碼或範圍寫反了，連不到',
  before: '位置前面有一句話，不確定是不是出處',
  leftover: '裡面有像單元編號的字，沒有算進去',
  negative: '有否定的字，外掛不確定意思',
  unit: '找不到這個單元',
  heading: '材料裡找不到這個標題',
  rest: '單元後面的字看不懂',
} as const;
const ORDER = ['term', 'term-only', 'position', 'before', 'leftover', 'negative', 'unit', 'heading', 'rest'] as const;
type Reason = typeof ORDER[number];

/**
 * 只在電腦判斷：要看 metadataCache。材料的快取還沒建好（null）時不知道，不提示，下次再看；連不到檔案的材料本來就找不到。
 * 卡照常複習，讀懂的照用，不算寫錯（syntax §2-10）。提示可以看目錄與材料，歸屬不行（D-170 第 2 點）。
 */
export function unreadableSources(app: App, deckPath: string, deck: SourceDeck, units: UnitDecks): UnreadableSource[] {
  const cachesOf = (path: string, materials: readonly string[]) => materialFiles(app, path, materials).map(file => app.metadataCache.getFileCache(file));
  const missing = (caches: ReturnType<typeof cachesOf>, heading: string): boolean =>
    !caches.some(cache => cache === null) && !caches.some(cache => cache?.headings?.some(each => headingKey(each.heading) === headingKey(heading)));
  const own = cachesOf(deckPath, deck.props.materials);
  /** 這一項為什麼看不懂；看得懂是 null。 */
  function reasonOf(item: SourceItem): Reason | null {
    const { link } = item;
    const found: Reason[] = [];
    // 原文有沒有年級學期、編號是什麼，用表單猜測的同一個函式判斷（§1-3）。
    if (item.missed) {
      const split = splitSource(item.text, deck.props);
      if (split.term === null && split.short === null && split.code !== null) found.push('term');
    }
    if (item.problem) found.push(item.problem);
    if (link.kind === 'heading' && !item.remark && missing(own, link.heading)) found.push('heading');
    if (link.kind === 'unit') {
      const decks = units(link.term, link.unit);
      if (!decks.length) { if (item.needsUnit) found.push('unit'); }
      else if (link.rest?.kind === 'heading' && !decks.some(each => each.name && headingKey(each.name) === headingKey((link.rest as { heading: string }).heading))) {
        if (missing(decks.flatMap(each => cachesOf(each.path, each.materials)), link.rest.heading)) found.push('rest');
      }
    }
    // 沒寫年級學期只決定說明哪一句，本身不算看不懂（`1-2 溶液` 在材料裡找得到就是那個標題）。
    if (!found.some(each => each !== 'term')) return null;
    return ORDER.find(each => found.includes(each)) ?? null;
  }
  return deck.targets.flatMap(({ line, name, fields }) => {
    // 有 layout 時段已經讀好了（編輯器每次重新解析都要算，不讀第二次，§1-5 的速度）。
    const layout = deck.layout?.get(line);
    const parts = layout?.parts ?? readSourceParts(fields.sources, deck.props);
    const rawOf = (part: SourcePart): string => partText(fields.sources, part);
    return parts.flatMap((part, index) => {
      const found = part.items.flatMap(item => { const reason = reasonOf(item); return reason ? [{ item, reason }] : []; });
      if (!found.length) return [];
      // 給表單的是第一個有問題的項目；說明用表上最前面的原因。
      const first = { item: found[0].item, reason: ORDER.find(each => found.some(hit => hit.reason === each)) ?? found[0].reason };
      const text = rawOf(part);
      // 接在後面、同一個單元的位置：同一項裡照原文切（分隔符號照實），跨項用頓號接。
      const chain: SourcePart[] = [];
      for (let at = index + 1; parts[at]?.follows === 'place'; at++) chain.push(parts[at]);
      const last = chain.at(-1);
      const whole = !last ? text : last.entry === part.entry && part.from !== null && last.to !== null ? fields.sources[part.entry].slice(part.from, last.to) : [part, ...chain].map(rawOf).join('、');
      const reason = first.reason === 'term' ? REASONS.term(splitSource(first.item.text, deck.props).code ?? '') : REASONS[first.reason];
      // layout 的段沒有位置時（那一項切不出原文）at 是 null。
      const entry = layout?.entries[part.entry];
      const at = entry && part.from !== null && part.to !== null ? { line: entry.line, from: entry.from + part.from, to: entry.from + part.to } : null;
      return [{ line, name, text, tip: reason + '。點一下幫你改。', item: { ...first.item, text }, at, part: index, follows: chain.flatMap(each => each.items), whole, scope: part.scope }];
    });
  });
}
