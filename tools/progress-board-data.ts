// 開發進度畫板的資料：讀 docs/progress-map.md（唯一來源），算完成度；清單頁與畫布頁共用這裡的資料、流程位置與配色。
import MarkdownIt, { type Token } from 'markdown-it';

export const MAP = 'docs/progress-map.md';
// 發布到 GitHub Pages 的檔名；根網址 index.html 轉到清單頁。
export const LIST_PAGE = 'progress-map-list.html';
export const BOARD_PAGE = 'progress-map-board.html';
const REPO = 'https://github.com/kuohappiness/Essence-Cards';
const DOCS_URL = `${REPO}/blob/main/docs/`;

export type Status = 'done' | 'part' | 'todo' | 'later';
const ICONS: Record<string, Status> = { '🟢': 'done', '🟡': 'part', '⚪': 'todo', '🔵': 'later' };

/** name、note 是轉好的 HTML 片段（行內 Markdown，相對連結改成 GitHub 上的網址）。 */
export interface Item { status: Status; name: string; note: string }
export interface Module { name: string; items: Item[] }
export interface Stage { name: string; description: string; modules: Module[] }
export interface Counts { done: number; part: number; todo: number; later: number }

const markdown = new MarkdownIt({ html: false, linkify: true });

/** 相對連結以 docs/ 為基準，改成 GitHub 上 main 的網址；站內錨點與絕對網址不動。 */
function fixLinks(tokens: Token[]): void {
  for (const token of tokens) {
    if (token.type !== 'link_open') continue;
    const href = token.attrGet('href') ?? '';
    if (!/^[a-z][a-z0-9+.-]*:|^#|^\//i.test(href)) token.attrSet('href', DOCS_URL + href);
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener');
  }
}

function inline(token: Token | undefined): string {
  const children = token?.children ?? [];
  fixLinks(children);
  return markdown.renderer.renderInline(children, markdown.options, {}).trim();
}

const plain = (token: Token | undefined) => (token?.children ?? []).map(child => child.content).join('').trim();

export class MapError extends Error {
  readonly line: number;
  constructor(line: number, reason: string) { super(reason); this.line = line; }
}

/** 讀 progress-map.md：第一個 `##` 之前是說明，不讀。 */
export function parseMap(source: string): Stage[] {
  const tokens = markdown.parse(source, {});
  const stages: Stage[] = [];
  let stage: Stage | undefined;
  let module: Module | undefined;
  const line = (token: Token) => (token.map?.[0] ?? 0) + 1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'heading_open' && token.tag === 'h2') {
      stage = { name: plain(tokens[i + 1]), description: '', modules: [] };
      stages.push(stage);
      module = undefined;
    } else if (token.type === 'heading_open' && token.tag === 'h3') {
      if (!stage) throw new MapError(line(token), '模組（###）要寫在某一段（##）底下');
      module = { name: plain(tokens[i + 1]), items: [] };
      stage.modules.push(module);
    } else if (token.type === 'paragraph_open' && stage && !module && !stage.description) {
      stage.description = inline(tokens[i + 1]);
    } else if (token.type === 'tr_open' && stage) {
      const cells: Token[] = [];
      let header = false;
      for (let j = i + 1; tokens[j].type !== 'tr_close'; j++) {
        if (tokens[j].type === 'th_open') header = true;
        if (tokens[j].type === 'inline') cells.push(tokens[j]);
      }
      if (header) continue;
      if (!module) throw new MapError(line(token), '功能的表格要寫在某個模組（###）底下');
      const icon = plain(cells[0]);
      const status = ICONS[icon];
      if (!status) throw new MapError(line(token), `不認得的符號「${icon}」，只能用 ${Object.keys(ICONS).join(' ')}`);
      if (!plain(cells[1])) throw new MapError(line(token), '功能名稱是空的');
      module.items.push({ status, name: inline(cells[1]), note: inline(cells[2]) });
    }
  }
  if (!stages.length) throw new MapError(1, '找不到任何一段（##）');
  for (const each of stages) {
    if (!each.modules.length) throw new MapError(0, `「${each.name}」這一段沒有模組`);
    const empty = each.modules.find(m => !m.items.length);
    if (empty) throw new MapError(0, `「${each.name}」的模組「${empty.name}」沒有功能`);
  }
  return stages;
}

export function count(items: readonly Item[]): Counts {
  const counts: Counts = { done: 0, part: 0, todo: 0, later: 0 };
  for (const item of items) counts[item.status]++;
  return counts;
}

/** v1 的完成度：做完算 1、做了一部分算一半；v1 之後不算。沒有 v1 項目時是 null。 */
export function percent(counts: Counts): number | null {
  const v1 = counts.done + counts.part + counts.todo;
  return v1 ? Math.round((100 * (counts.done + counts.part / 2)) / v1) : null;
}

export const itemsOf = (stage: Stage) => stage.modules.flatMap(m => m.items);
export const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// 流程上的位置（清單頁電腦版的格子、畫布的欄列）：名稱對不到的段照順序排在後面，沒有連線。
export const PLACES: Record<string, string> = { 教材: 'a', 規則: 'b', 製卡: 'c', 複習: 'd', 內層循環: 'e', 外層循環: 'f', 底座: 'g' };
// [起點, 終點, 起點的邊, 終點的邊, 說明, 虛線]
export const LINKS: [string, string, string, string, string, boolean][] = [
  ['教材', '製卡', 'r', 'l', '', false],
  ['規則', '製卡', 'r', 'l', '', false],
  ['製卡', '複習', 'r', 'l', '', false],
  ['複習', '內層循環', 'r', 'l', '', false],
  ['內層循環', '製卡', 't', 't', '補強、加深', true],
  ['複習', '外層循環', 'b', 't', '紀錄', true],
  ['外層循環', '規則', 'l', 'r', '改規則', true],
];
export const BACK: Record<string, string> = { 內層循環: '↩ 回到製卡：補強、加深', 外層循環: '↩ 回到規則：改規則' };

export const LEGEND: [Status, string][] = [['done', '做完'], ['part', '做了一部分'], ['todo', '還沒開工'], ['later', 'v1 之後']];

export function bar(value: number | null): string {
  return `<span class="bar" role="img" aria-label="${value ?? 0}%"><span style="width:${value ?? 0}%"></span></span>`;
}

export function tally(counts: Counts): string {
  return LEGEND.map(([status]) => `<span class="tally s-${status}"><i></i>${counts[status]}</span>`).join('');
}

export interface Meta { updated: string; commit?: string; deferred?: number }

/** D-195：v1 結案前要清空的補測與補做，數字從 backlog 技術債表算。 */
export function debtNote(meta: Meta): string {
  if (meta.deferred === undefined) return '';
  return `<a class="debt" href="${DOCS_URL}backlog.md#${encodeURIComponent('技術債')}">v1 結案前待補測 ${meta.deferred} 列</a>`;
}

/** 兩頁共用的顏色（含深色模式）。 */
export const TOKENS = `
:root{--bg:#f6f7f4;--dot:#d9ddd5;--card:#fff;--ink:#2f3b36;--muted:#6f7b75;--line:#e4e8e2;--wire:#c3cbc6;
--done:#7cbf8e;--done-bg:#e3f2e7;--part:#e8c547;--part-bg:#fbf1c9;--todo:#c9cfd3;--todo-bg:#f0f2f3;--later:#8fb3dd;--later-bg:#e7f0fa;
--shadow:0 1px 2px #1f2b2610,0 6px 18px #1f2b260d}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161a19;--dot:#2a302e;--card:#1f2523;--ink:#e3e8e5;--muted:#98a39e;--line:#2f3734;--wire:#4a5551;
--done:#6fae80;--done-bg:#22352a;--part:#d4b13f;--part-bg:#3a3420;--todo:#5d666a;--todo-bg:#2a3033;--later:#7aa0cb;--later-bg:#22303f;--shadow:0 1px 2px #0006}}
`;

/** 頁尾：來源與更新時間。 */
export function footer(meta: Meta): string {
  const commit = meta.commit ? ` · <a href="${REPO}/commit/${escape(meta.commit)}">${escape(meta.commit.slice(0, 7))}</a>` : '';
  return `進度用項目數算，不是工作量。由 <a href="${DOCS_URL}progress-map.md">docs/progress-map.md</a> 自動產生 · 更新：${escape(meta.updated)}${commit}`;
}
