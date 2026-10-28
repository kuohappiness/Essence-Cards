import { Component, MarkdownRenderer, type App } from 'obsidian';
import { postProcess } from '../ui/rendered.ts';

// 開發命令 md-cases（Codex 審查 F3～F5）：用 Obsidian 真的渲染器跑 rendered.ts 的後處理，量喇叭和最後一個字在不在同一行。
// Node 的測試沒有 DOM，這些情況只能在 Obsidian 裡驗；結果檔每個情況一列，ok 是 false 的看 html 與數字。

interface Case { name: string; text: string; mode?: 'plain' | 'typed'; lines?: number; english?: boolean; width?: number }

const IMAGE = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#ccc"/></svg>');
const CASES: Case[] = [
  // F3：圖、公式、嵌入的內容原樣不動，喇叭接在後面。
  { name: 'SVG 結尾', text: '圖中的字：\n\n<svg width="140" height="50"><text x="5" y="30">Hello</text></svg>' },
  { name: '公式結尾', text: '速度的公式：$v = \\frac{d}{t}$' },
  { name: '只有圖片', text: `![](${IMAGE})` },
  // F4：中文句子後面的英文跨過粗體、連結也換行；英文在前的不換；冠詞連著粗體裡的字。
  { name: '粗體開頭的英文', text: '我昨天去了公園。**I** ＿＿ to the park yesterday.', mode: 'typed', lines: 1, english: true },
  { name: '連結開頭的英文', text: '離開時請關燈。[Please](https://example.com) ＿＿ the lights.', mode: 'typed', lines: 2, english: true },
  { name: '英文在前', text: 'Can I ＿＿ your pen?（借）', mode: 'typed', lines: 1, english: true },
  { name: '冠詞接粗體', text: 'I want to buy a **book** for my sister.', english: true },
  // F5：最後一個字在連結裡，連結和喇叭一起換行；很長的連結不綁、不超出。
  { name: '連結結尾 150px', text: 'Read [borrow](https://example.com)', width: 150 },
  { name: '長連結結尾 150px', text: 'Read [a very long link text that goes on](https://example.com)', width: 150 },
  { name: '英文結尾 150px', text: 'He has already made up his mind to study abroad.', width: 150, english: true },
  { name: '中文結尾 150px', text: '光合作用需要陽光、水和二氧化碳。', width: 150 },
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

const PROTECTED = 'svg, math, mjx-container, .math, img, .internal-embed';
const middle = (rect: DOMRect): number => rect.top + rect.height / 2;

async function runCase(app: App, root: HTMLElement, item: Case): Promise<unknown> {
  const card = document.createElement('article');
  card.className = 'ec-card' + (item.english ? ' is-english' : '');
  const question = document.createElement('div');
  question.className = 'ec-q' + (item.lines ? ' has-blank' : '');
  question.style.width = `${String(item.width ?? 300)}px`;
  const container = document.createElement('div');
  container.className = 'ec-markdown';
  question.append(container);
  card.append(question);
  root.replaceChildren(card);
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, item.text, container, '', component);
    await new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
    const before = Array.from(container.querySelectorAll(PROTECTED)).map(el => el.outerHTML);
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
    const result = {
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
      breaks: breaks.length,
      afterBreak: breaks.map(br => (br.nextSibling?.textContent ?? '').slice(0, 12)),
      glued: (container.textContent ?? '').includes('a '),
      html: container.innerHTML.slice(0, 800),
    };
    return result;
  } finally {
    component.unload();
  }
}

/** md-cases：每個情況一列；expect 寫的是這個情況要成立的事，ok 是它們都成立。 */
export async function markdownCases(app: App): Promise<unknown> {
  const root = document.createElement('div');
  root.className = 'ec-app';
  root.style.cssText = 'position:fixed;left:0;top:0;width:auto;height:auto;visibility:hidden;pointer-events:none;z-index:-1';
  document.body.append(root);
  try {
    const results: Record<string, unknown>[] = [];
    for (const item of CASES) results.push(await runCase(app, root, item) as Record<string, unknown>);
    const expect: Record<string, (r: Record<string, unknown>) => boolean> = {
      'SVG 結尾': r => r.protectedSame === true && r.protectedCount === 1 && r.tailInProtected === false,
      '公式結尾': r => r.protectedSame === true && (r.protectedCount as number) >= 1 && r.tailInProtected === false,
      '只有圖片': r => r.protectedSame === true && r.protectedCount === 1 && r.tailInProtected === false,
      '粗體開頭的英文': r => r.breaks === 1 && (r.afterBreak as string[])[0] === '',
      '連結開頭的英文': r => r.breaks === 1,
      '英文在前': r => r.breaks === 0,
      '冠詞接粗體': r => r.glued === true,
      '連結結尾 150px': r => r.sameLine === true && r.tailInLink === false && r.linkHasButton === false && r.tailText === 'borrow',
      '長連結結尾 150px': r => r.overflow === false && r.linkHasButton === false && r.tailInLink === false,
      '英文結尾 150px': r => r.sameLine === true && r.overflow === false,
      '中文結尾 150px': r => r.sameLine === true && r.overflow === false,
    };
    const rows = results.map(r => ({ ok: expect[r.name as string]?.(r) ?? null, ...r }));
    return { allOk: rows.every(r => r.ok === true), rows };
  } finally {
    root.remove();
  }
}
