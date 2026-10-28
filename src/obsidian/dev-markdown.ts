import { Component, MarkdownRenderer, type App } from 'obsidian';
import { postProcess } from '../ui/rendered.ts';

// 開發命令 md-cases（Codex 審查 F3～F5、再查 R2～R4）：用 Obsidian 真的渲染器跑 rendered.ts 的後處理，量喇叭和最後一個字在不在同一行。
// Node 的測試沒有 DOM，這些情況只能在 Obsidian 裡驗；結果檔每個情況一列，ok 是 false 的看 html 與數字。

/**
 * expect：這個情況要成立的事（結果檔的 ok）。rendered：渲染完、後處理之前接在最後的 HTML（模擬已經載入好的嵌入：
 * 寫進 Markdown 的 .internal-embed 會讓渲染器去載入那份筆記，沒有 src 時出錯）。
 */
interface Case { name: string; text: string; rendered?: string; mode?: 'plain' | 'cloze' | 'typed'; lines?: number; english?: boolean; width?: number; expect: (r: Row) => boolean }
type Row = Awaited<ReturnType<typeof runCase>>;

/** 喇叭和最後一個字同一行、不超出、喇叭在連結外面。 */
const together = (r: Row): boolean => r.sameLine === true && r.overflow === false && r.tailInLink === false && r.linkHasButton === false;
/** 受保護的內容（count 個）原樣不動，喇叭不在裡面。 */
const untouched = (count: number) => (r: Row): boolean => r.protectedSame && r.protectedCount === count && !r.tailInProtected;

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
      html: container.innerHTML.slice(0, 800),
    };
  } finally {
    component.unload();
  }
}

/** md-cases：每個情況一列，ok 是那個情況的 expect 成立。 */
export async function markdownCases(app: App): Promise<unknown> {
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
  }
}
