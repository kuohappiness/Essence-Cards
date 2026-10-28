import { BLANK, englishBreak, glueArticles, tailStart } from '../review/index.ts';

// Obsidian 渲染出來的卡片內容的後處理（D-145）：打字卡的空格、中文後面的英文換行、冠詞連著下一個字、喇叭接在最後一個字後面。
// 只改一般的 HTML 文字；圖、SVG、公式、嵌入、程式碼與填空、空格自己的內容一律不動（Codex 審查 F3）。
// 開發命令 md-cases 用 Obsidian 真的渲染器跑這些情況（Node 沒有 DOM），結果檔看 checks。

/** 不能動裡面文字的內容：喇叭接在它們後面，冠詞與換行也不處理它們裡面的字。 */
const PROTECTED = 'svg, math, mjx-container, .math, .internal-embed, img, audio, video, iframe, code, pre, .ec-slot, .ec-blank';
/** 一段文字所在的區塊（換行與冠詞只在同一個區塊裡找）。 */
const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, div';

/** root 底下照順序的文字節點，不含受保護的內容裡的。 */
function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child instanceof Text) out.push(child);
      else if (child instanceof Element && !child.matches(PROTECTED)) walk(child);
    }
  };
  walk(root);
  return out;
}

/** node 在 root 裡的受保護內容裡面（嵌入筆記自己的螢光筆不是本題的填空，Codex 再查 R2）。 */
function guarded(node: Node, root: Node): boolean {
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) if (el.matches(PROTECTED)) return true;
  return false;
}

const blockOf = (node: Node, container: HTMLElement): Element => node.parentElement?.closest(BLOCK) ?? container;

/**
 * Markdown.tsx 渲染完的全部處理（md-cases 也用它）：填空題的 <mark> 換成空格、打字卡第一處 ＿＿ 換成線、英文卡的冠詞、
 * 喇叭那一格。回傳放線的那一格（找不到 ＿＿ 或不是打字卡時是 null）與喇叭那一格。
 */
export function postProcess(container: HTMLElement, options: { mode: 'plain' | 'cloze' | 'typed'; lines: number; english: boolean }): { slot: HTMLElement | null; tail: HTMLElement } {
  if (options.mode === 'cloze') {
    for (const mark of Array.from(container.querySelectorAll('mark'))) {
      if (guarded(mark, container)) continue;
      const blank = document.createElement('span');
      blank.className = 'ec-blank';
      const answer = document.createElement('span');
      answer.className = 'ec-blank-answer';
      answer.textContent = mark.textContent;
      blank.append(answer);
      mark.replaceWith(blank);
    }
  }
  const slot = options.mode === 'typed' ? insertLines(container, options.lines) : null;
  if (options.english) glueText(container);
  return { slot, tail: attachTail(container) };
}

/** 把第一處 ＿＿ 所在的文字節點拆開，中間放幾條線；回傳放線的那一格，找不到 ＿＿ 時是 null。 */
function insertLines(container: HTMLElement, lines: number): HTMLElement | null {
  for (const node of textNodes(container)) {
    const text = node.textContent ?? '';
    const match = BLANK.exec(text);
    if (!match) continue;
    const blanks = document.createElement('span');
    blanks.className = 'ec-lines';
    for (let i = 0; i < Math.max(1, lines); i++) {
      const line = document.createElement('span');
      line.className = 'ec-line';
      const word = document.createElement('span');
      word.className = 'ec-line-word';
      line.append(word);
      blanks.append(line);
    }
    const slot = document.createElement('span');
    slot.className = 'ec-slot';
    slot.append(blanks);
    const after = node.splitText(match.index);
    after.textContent = text.slice(match.index + match[0].length);
    node.parentNode?.insertBefore(slot, after);
    breakBeforeEnglish(container, node);
    return slot;
  }
  return null;
}

/**
 * 中文句子後面接英文句子時，英文換到下一行（D-145 第 5 點）：在同一個區塊裡、空格前面的文字中，最後一個中文字或全形標點後面斷行。
 * 跨過粗體、連結也找得到（「我昨天去了公園。**I** ＿＿ …」，Codex 審查 F4）。英文在前、中文提示在後的（Can I ＿＿ your pen?（借））不斷行。
 */
function breakBeforeEnglish(container: HTMLElement, beforeBlank: Text): void {
  const block = blockOf(beforeBlank, container);
  const before = textNodes(block);
  const upto = before.indexOf(beforeBlank);
  for (let i = upto; i >= 0; i--) {
    const node = before[i];
    const at = englishBreak(node.textContent ?? '');
    if (at === null) continue;
    const english = node.splitText(at);
    english.textContent = (english.textContent ?? '').trimStart();
    const br = document.createElement('br');
    br.className = 'ec-break';
    node.parentNode?.insertBefore(br, english);
    return;
  }
}

/**
 * 冠詞和後面的字用不斷行空白連起來（glueArticles）；冠詞在一個節點的最後、下一個字在粗體或連結裡（a **book**）也連（Codex 審查 F4）。
 */
function glueText(container: HTMLElement): void {
  const nodes = textNodes(container);
  nodes.forEach((node, index) => {
    let text = glueArticles(node.textContent ?? '');
    const next = nodes[index + 1] as Text | undefined;
    if (next && /\b(?:a|an|the) +$/iu.test(text) && /^\S/u.test(next.textContent ?? '') && blockOf(next, container) === blockOf(node, container)) {
      text = text.replace(/ +$/u, ' ');
    }
    if (text !== node.textContent) node.textContent = text;
  });
}

/** 最後一個內容：一般文字的文字節點，或一整個受保護的內容（圖、公式、嵌入、空格…）。 */
function lastContent(node: Node): Text | Element | null {
  for (let child = node.lastChild; child; child = child.previousSibling) {
    if (child instanceof Text) {
      if (child.textContent?.trim()) return child;
      continue;
    }
    if (!(child instanceof Element)) continue;
    if (child.matches(PROTECTED)) return child;
    const inner = lastContent(child);
    if (inner) return inner;
  }
  return null;
}

/** 連結文字超過這個長度時，喇叭不和整個連結綁在一起（避免一長串不能換行而超出畫面）。 */
const LINK_GROUP_MAX = 24;

/**
 * 準備接在最後一個字後面的那一格（.ec-tail），喇叭放進去（D-145 第 6 點：和最後一個字一起換行，不會單獨掉到下一行）。
 * - 最後是一般文字：最後一個字（中文兩個字）和喇叭包在一起（white-space: nowrap）。
 * - 最後的字在連結裡（連結裡的程式碼、圖片也算，Codex 再查 R3）：整個連結和喇叭包在一起，喇叭在連結外面（按喇叭不會開連結，
 *   Codex 審查 F5）；連結很長時接在連結後面。
 * - 最後是圖、公式、嵌入、空格：原樣不動，喇叭接在它後面（Codex 審查 F3）。
 */
function attachTail(container: HTMLElement): HTMLElement {
  const tail = document.createElement('span');
  tail.className = 'ec-tail';
  const last = lastContent(container);
  if (last === null) { container.append(tail); return tail; }
  const link = (last instanceof Text ? last.parentElement : last)?.closest('a');
  if (link && container.contains(link)) {
    if ((link.textContent ?? '').length > LINK_GROUP_MAX) { link.after(tail); return tail; }
    link.before(tail);
    tail.append(link);
    return tail;
  }
  if (last instanceof Element) { last.after(tail); return tail; }
  const rest = last.splitText(tailStart(last.textContent ?? ''));
  rest.replaceWith(tail);
  tail.append(rest);
  return tail;
}
