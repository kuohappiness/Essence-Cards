import { Component, MarkdownRenderer, type App } from 'obsidian';
import { postProcess } from '../ui/rendered.ts';
import { keepRendering } from './dev-review.ts';

// 開發命令 md-cases（Codex 審查 F3～F5、再查 R2～R4）：用 Obsidian 真的渲染器跑 rendered.ts 的後處理，量喇叭和最後一個字在不在同一行。
// Node 的測試沒有 DOM，這些情況只能在 Obsidian 裡驗；結果檔每個情況一列，ok 是 false 的看 html 與數字。

/**
 * expect：這個情況要成立的事（結果檔的 ok）。rendered：渲染完、後處理之前接在最後的 HTML（模擬已經載入好的嵌入：
 * 寫進 Markdown 的 .internal-embed 會讓渲染器去載入那份筆記，沒有 src 時出錯）。
 */
interface Case {
  name: string; text: string; rendered?: string; mode?: 'plain' | 'cloze' | 'typed'; lines?: number; english?: boolean; width?: number;
  /** 翻面後（同 Markdown.tsx 的 applyState）：填空的答案出現，打字卡的線寫上 words。 */
  revealed?: boolean; words?: string[];
  expect: (r: Row) => boolean;
}
type Row = Awaited<ReturnType<typeof runCase>>;

/** 喇叭和最後一個字同一行、不超出、喇叭在連結外面。 */
const together = (r: Row): boolean => r.sameLine === true && r.overflow === false && r.tailInLink === false && r.linkHasButton === false;
/** 受保護的內容（count 個）原樣不動，喇叭不在裡面。 */
const untouched = (count: number) => (r: Row): boolean => r.protectedSame && r.protectedCount === count && !r.tailInProtected;
/** 每個空格和緊接在後面的字（chars 也算前面緊接的這幾個字）在同一行，而且不超出。 */
const stuck = (chars = '') => (r: Row): boolean => r.beside.length > 0 && !r.overflow
  && r.beside.every(b => b.same || (b.side === 'before' && !chars.includes(b.char)));

const IMAGE = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#ccc"/></svg>');
// 再查 R4：長連結自己可以換行，最後一個字和喇叭照樣同一行；換幾種行寬讓行尾剩下的空間不一樣（每 12px 一格，比喇叭窄，
// 行尾剩下的空間一定會有一格落在「放得下字、放不下喇叭」）。iPhone 也跑一次：WebKit 斷行的規則可能和 Chromium 不同。
// 最後一個字加喇叭比一整行還寬時，一般文字也會超出（Windows 版 photosynthesis 約 230px 以下），所以那一個從 250px 起量。
const sweep = (from: number, to: number, step: number): number[] => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const LONG_LINKS: [string, number[]][] = [
  ['Read [information about photosynthesis](https://example.com)', [250, 270, 290, 310]],
  ['Read [the story of how a tiny seed grows into a tall tree](https://example.com)', sweep(150, 330, 12)],
  ['Read [a very long link text that goes on](https://example.com)', [150, 176, 210, 250]],
  ['請看[光合作用需要陽光、水和二氧化碳的說明](https://example.com)', [150, 176, 210, 250]],
];
// 技術債（backlog）：空格後面緊接的標點不和空格分開換行（W6 畫面修改的再查：「有 攪拌 」後面的逗號被換到下一行開頭）。
// 每 6px 一格（比一個字窄），行尾剩下的空間一定會有幾格落在「放得下空格、放不下標點」；正面（空的空格）和背面（填上答案）都量。
// 最後一個是很長的答案：線排滿一行時，標點接在後面也不超出。空格、句號和喇叭連在一起比一行還寬時一定超出（約 165px 以下），所以「填空在結尾」從 168px 起量。
const BESIDE: [string, Omit<Case, 'name' | 'width'>, number[]][] = [
  ['填空接全形標點', { text: '水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快。', mode: 'cloze', expect: stuck() }, sweep(150, 330, 6)],
  ['填空接全形標點（背面）', { text: '水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快。', mode: 'cloze', revealed: true, expect: stuck() }, sweep(150, 330, 6)],
  ['填空在結尾', { text: '植物行光合作用時，需要的能量來自==陽光==。', mode: 'cloze', expect: r => stuck()(r) && r.sameLine === true }, sweep(168, 330, 6)],
  ['填空在括號裡', { text: '把糖放進水裡，再「==攪拌==」一下，糖溶解得比較快。', mode: 'cloze', expect: stuck('「') }, sweep(150, 330, 6)],
  ['打字卡接句點', { text: '他已經下定決心要出國讀書。He has already made up his mind to study ＿＿.', mode: 'typed', lines: 1, english: true, expect: stuck() }, sweep(150, 330, 6)],
  ['打字卡接全形問號', { text: '我可以借你的筆嗎？Can I borrow your ＿＿？', mode: 'typed', lines: 1, english: true, expect: stuck() }, sweep(150, 330, 6)],
  ['打字卡接句點（背面）', { text: '他已經下定決心要出國讀書。He has already made up his mind to study ＿＿.', mode: 'typed', lines: 1, english: true, revealed: true, words: ['abroad'], expect: stuck() }, sweep(150, 330, 6)],
  ['打字卡長答案接句點', { text: '他已經下定決心要出國讀書。He has already ＿＿.', mode: 'typed', lines: 6, english: true, expect: stuck() }, sweep(150, 330, 30)],
];
const CASES: Case[] = [
  // F3：圖、公式、嵌入的內容原樣不動，喇叭接在後面。
  { name: 'SVG 結尾', text: '圖中的字：\n\n<svg width="140" height="50"><text x="5" y="30">Hello</text></svg>', expect: untouched(1) },
  { name: '公式結尾', text: '速度的公式：$v = \\frac{d}{t}$', expect: r => r.protectedSame && r.protectedCount >= 1 && !r.tailInProtected },
  { name: '只有圖片', text: `![](${IMAGE})`, expect: untouched(1) },
  // 再查 R2：填空題只把題目自己的螢光筆換成空格，嵌入內容裡的不動。
  { name: '填空旁的嵌入', text: '光合作用需要==陽光==。', rendered: '<div class="internal-embed markdown-embed"><p><mark>嵌入筆記自己的螢光筆</mark></p></div>', mode: 'cloze', expect: r => r.blanks === 1 && untouched(1)(r) },
  // F4：中文句子後面的英文跨過粗體、連結也換行；英文在前的不換；冠詞連著粗體裡的字。
  { name: '粗體開頭的英文', text: '我昨天去了公園。**I** ＿＿ to the park yesterday.', mode: 'typed', lines: 1, english: true, expect: r => r.breaks === 1 && r.afterBreak[0] === '' },
  { name: '連結開頭的英文', text: '離開時請關燈。[Please](https://example.com) ＿＿ the lights.', mode: 'typed', lines: 2, english: true, expect: r => r.breaks === 1 },
  { name: '英文在前', text: 'Can I ＿＿ your pen?（借）', mode: 'typed', lines: 1, english: true, expect: r => r.breaks === 0 },
  { name: '冠詞接粗體', text: 'I want to buy a **book** for my sister.', english: true, expect: r => r.glued },
  // F5：最後一個字在連結裡，連結和喇叭一起換行，喇叭在連結外面。
  { name: '連結結尾 150px', text: 'Read [borrow](https://example.com)', width: 150, expect: r => together(r) && r.tailText === 'borrow' },
  // 再查 R3：連結裡最後是程式碼或圖片，原樣不動，喇叭照樣在連結外面。
  { name: '連結裡的程式碼結尾', text: 'Read [`borrow`](https://example.com)', expect: r => together(r) && untouched(1)(r) },
  { name: '連結裡的圖片結尾', text: `看圖：[![](${IMAGE})](https://example.com)`, expect: r => together(r) && untouched(1)(r) },
  ...LONG_LINKS.flatMap(([text, widths], index) => widths.map(width => ({ name: `長連結 ${String(index + 1)} ${String(width)}px`, text, width, expect: together }))),
  { name: '英文結尾 150px', text: 'He has already made up his mind to study abroad.', width: 150, english: true, expect: r => r.sameLine === true && !r.overflow },
  { name: '中文結尾 150px', text: '光合作用需要陽光、水和二氧化碳。', width: 150, expect: r => r.sameLine === true && !r.overflow },
  ...BESIDE.flatMap(([name, item, widths]) => widths.map(width => ({ ...item, name: `${name} ${String(width)}px`, width }))),
];

/** 和 Review.tsx 的 Speaker 一樣大小的喇叭（只量版面，不接朗讀）。 */
function speaker(): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'ec-speakers';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ec-ico ec-say';
  const icon = document.createElement('span');
  icon.style.cssText = 'display:inline-block;width:20px;height:20px';
  button.append(icon);
  wrap.append(button);
  return wrap;
}

const PROTECTED = 'svg, math, mjx-container, .math, img, .internal-embed, code';
const middle = (rect: DOMRect): number => rect.top + rect.height / 2;

/** 同 Markdown.tsx 的 applyState（翻面後）：填空的答案出現，打字卡的字照順序寫在線上。 */
function reveal(container: HTMLElement, words: readonly string[]): void {
  for (const blank of Array.from(container.querySelectorAll('.ec-blank'))) blank.classList.add('ec-filled');
  container.querySelectorAll('.ec-line').forEach((line, index) => {
    line.classList.add('ec-filled');
    const word = line.querySelector('.ec-line-word');
    if (word) word.textContent = words[index] ?? '';
  });
}

/**
 * 每個空格前後緊接的字（中間有空白的不算）和空格在不在同一行：字的中線落在空格的上下緣之間。
 * 空格是填空的 .ec-blank 或打字卡的 .ec-slot；字照文件順序找，跳過空格自己裡面的字（線上的字、答案）。
 */
function besideBlanks(container: HTMLElement): { side: 'before' | 'after'; char: string; same: boolean }[] {
  const texts: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node instanceof Text && node.textContent) texts.push(node);
  return Array.from(container.querySelectorAll<HTMLElement>('.ec-blank, .ec-slot')).flatMap(blank => {
    const outside = texts.filter(node => !blank.contains(node));
    const after = outside.findIndex(node => (blank.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    const box = blank.getBoundingClientRect();
    const sides: ['before' | 'after', Text | undefined, number][] = [
      ['before', after === -1 ? outside.at(-1) : outside[after - 1], -1],
      ['after', after === -1 ? undefined : outside[after], 0],
    ];
    return sides.flatMap(([side, node, at]) => {
      if (!node) return [];
      const text = node.textContent ?? '';
      const index = at < 0 ? text.length - 1 : 0;
      const char = text.charAt(index);
      if (/\s/u.test(char)) return [];
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = Array.from(range.getClientRects()).find(item => item.width > 0);
      return rect ? [{ side, char, same: middle(rect) > box.top && middle(rect) < box.bottom }] : [];
    });
  });
}

async function runCase(app: App, root: HTMLElement, item: Omit<Case, 'expect'>) {
  const card = document.createElement('article');
  card.className = 'ec-card' + (item.english ? ' is-english' : '');
  const question = document.createElement('div');
  question.className = 'ec-q' + (item.lines ? ' has-blank' : '');
  question.style.width = `${String(item.width ?? 300)}px`;
  const container = document.createElement('div');
  container.className = 'ec-markdown';
  question.append(container);
  card.append(question);
  // 和複習畫面一樣包在 .ec-body 裡（換行規則 overflow-wrap 在那一層）。
  const body = document.createElement('div');
  body.className = 'ec-body';
  body.append(card);
  root.replaceChildren(body);
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, item.text, container, '', component);
    await new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
    if (item.rendered) container.insertAdjacentHTML('beforeend', item.rendered);
    const before =Array.from(container.querySelectorAll(PROTECTED)).map(el => el.outerHTML);
    const { tail } = postProcess(container, { mode: item.mode ?? 'plain', lines: item.lines ?? 0, english: !!item.english });
    if (item.revealed) reveal(container, item.words ?? []);
    tail.append(speaker());
    const after = Array.from(container.querySelectorAll(PROTECTED)).map(el => el.outerHTML);
    const button = tail.querySelector('button');
    // 最後一個字：喇叭那一格裡的文字（連結也算）；沒有文字時是喇叭前面那個內容。
    const words = Array.from(tail.childNodes).filter(node => node !== button?.parentElement);
    const range = document.createRange();
    let lastRect: DOMRect | null = null;
    if (words.length) {
      range.setStartBefore(words[0]);
      range.setEndAfter(words[words.length - 1]);
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0);
      lastRect = rects.at(-1) ?? null;
    } else lastRect = Array.from(tail.previousElementSibling?.getClientRects() ?? []).at(-1) ?? null;
    const speakerRect = button?.getBoundingClientRect() ?? null;
    const sameLine = lastRect && speakerRect ? Math.abs(middle(lastRect) - middle(speakerRect)) < lastRect.height / 2 + 4 : null;
    const breaks = Array.from(container.querySelectorAll('.ec-break'));
    return {
      name: item.name,
      protectedSame: JSON.stringify(before) === JSON.stringify(after),
      protectedCount: before.length,
      tailInProtected: !!tail.parentElement?.closest(PROTECTED),
      tailInLink: !!tail.parentElement?.closest('a'),
      linkHasButton: Array.from(container.querySelectorAll('a')).some(a => !!a.querySelector('button')),
      tailText: (tail.textContent ?? '').trim(),
      sameLine,
      speakerTop: speakerRect ? Math.round(speakerRect.top) : null,
      lastTop: lastRect ? Math.round(lastRect.top) : null,
      overflow: question.scrollWidth > question.clientWidth + 1,
      blanks: container.querySelectorAll('.ec-blank').length,
      breaks: breaks.length,
      afterBreak: breaks.map(br => (br.nextSibling?.textContent ?? '').slice(0, 12)),
      glued: (container.textContent ?? '').includes('a '),
      beside: besideBlanks(container),
      html: container.innerHTML.slice(0, 800),
    };
  } finally {
    component.unload();
  }
}

/** md-cases：每個情況一列，ok 是那個情況的 expect 成立。 */
export async function markdownCases(app: App): Promise<unknown> {
  // 每個情況都等 requestAnimationFrame：視窗被遮住時它不跑，命令會一直等、沒有結果檔（2026-11-02）。
  const rendering = keepRendering();
  const root = document.createElement('div');
  root.className = 'ec-app';
  root.style.cssText = 'position:fixed;left:0;top:0;width:auto;height:auto;visibility:hidden;pointer-events:none;z-index:-1';
  document.body.append(root);
  try {
    const rows: ({ ok: boolean } & Row)[] = [];
    for (const item of CASES) {
      const row = await runCase(app, root, item);
      rows.push({ ok: item.expect(row), ...row });
    }
    return { allOk: rows.every(r => r.ok), failed: rows.filter(r => !r.ok).map(r => r.name), rows };
  } finally {
    root.remove();
    rendering.restore();
  }
}
