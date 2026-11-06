import { Component, MarkdownRenderer, type App } from 'obsidian';
import { postProcess } from '../ui/rendered.ts';
import { capturePng, keepRendering, W6_ROOT } from './dev-review.ts';

// 開發命令 md-cases（Codex 審查 F3～F5、再查 R2～R4）：用 Obsidian 真的渲染器跑 rendered.ts 的後處理，量喇叭和最後一個字在不在同一行。
// Node 的測試沒有 DOM，這些情況只能在 Obsidian 裡驗；結果檔每個情況一列，ok 是 false 的看 html 與數字。

/**
 * expect：這個情況要成立的事（結果檔的 ok）。rendered：渲染完、後處理之前接在最後的 HTML（模擬已經載入好的嵌入：
 * 寫進 Markdown 的 .internal-embed 會讓渲染器去載入那份筆記，沒有 src 時出錯）。
 */
interface Case {
  name: string; text: string; rendered?: string; mode?: 'plain' | 'cloze' | 'typed' | 'pick'; lines?: number; english?: boolean; width?: number;
  /** 翻面後（同 Markdown.tsx 的 applyState）：填空的答案出現，打字卡的線寫上 words。 */
  revealed?: boolean; words?: string[];
  /** false：沒有喇叭（中翻英的正面，答案出現前沒有）。 */
  speaker?: boolean;
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
/** 同上，喇叭也沒有單獨掉到下一行。 */
const stuckWithSpeaker = (chars = '') => (r: Row): boolean => stuck(chars)(r) && r.sameLine === true;
/** 比較句的空格在第一處 ＿＿（tasks/question-type-seam.md §3、§10）：前後緊接這些字，在連結或粗體裡時是那個標籤，其他 ＿＿ 留著。 */
const pickIn = (before: string, after: string, inside: string | null = null) => (r: Row): boolean =>
  !r.slotMissing && r.beforeSlot.endsWith(before) && r.afterSlot.startsWith(after) && r.slotIn === inside;
/** 一句中文：空格在這裡，也不在空格前換行（比較句的空格可能填中文）。 */
const pickAt = (before: string, after: string, inside: string | null = null) => (r: Row): boolean =>
  pickIn(before, after, inside)(r) && r.breaks === 0;
/** 畫面找不到空格：放在句尾，記得出錯。 */
const pickAtEnd = (r: Row): boolean => r.slotMissing && r.afterSlot === '';
/** 空格後面沒有標點：喇叭沒有單獨掉到下一行，也不超出。 */
const speakerStays = (r: Row): boolean => r.sameLine === true && !r.overflow;

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
// 最後一個是很長的答案：線排滿一行時，標點接在後面也不超出。空格、句號和喇叭連在一起比一行還寬時一定超出（Windows 約 165px 以下；iPhone 字較寬，168px 也超出，174px 起通過，2026-11-03 實測），所以「填空在結尾」從 174px 起量。
const BESIDE: [string, Omit<Case, 'name' | 'width'>, number[]][] = [
  ['填空接全形標點', { text: '水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快。', mode: 'cloze', expect: stuck() }, sweep(150, 330, 6)],
  ['填空接全形標點（背面）', { text: '水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快。', mode: 'cloze', revealed: true, expect: stuck() }, sweep(150, 330, 6)],
  ['填空在結尾', { text: '植物行光合作用時，需要的能量來自==陽光==。', mode: 'cloze', expect: stuckWithSpeaker() }, sweep(174, 330, 6)],
  ['填空在括號裡', { text: '把糖放進水裡，再「==攪拌==」一下，糖溶解得比較快。', mode: 'cloze', expect: stuck('「') }, sweep(150, 330, 6)],
  ['填空在結尾沒有標點', { text: '植物行光合作用時，需要的能量來自==陽光==', mode: 'cloze', expect: speakerStays }, sweep(168, 330, 6)],
  ['打字卡在結尾沒有標點', { text: '他昨天弄丟了鑰匙。He lost his ＿＿', mode: 'typed', lines: 1, english: true, expect: speakerStays }, sweep(150, 330, 6)],
  ['打字卡接句點', { text: '他已經下定決心要出國讀書。He has already made up his mind to study ＿＿.', mode: 'typed', lines: 1, english: true, expect: stuckWithSpeaker() }, sweep(150, 330, 6)],
  ['打字卡接全形問號', { text: '我可以借你的筆嗎？Can I borrow your ＿＿？', mode: 'typed', lines: 1, english: true, expect: stuckWithSpeaker() }, sweep(150, 330, 6)],
  ['打字卡接句點（背面）', { text: '他已經下定決心要出國讀書。He has already made up his mind to study ＿＿.', mode: 'typed', lines: 1, english: true, revealed: true, words: ['abroad'], expect: stuckWithSpeaker() }, sweep(150, 330, 6)],
  ['打字卡四個字接句點', { text: '他終於下定決心了。He finally ＿＿.', mode: 'typed', lines: 4, english: true, expect: stuckWithSpeaker() }, sweep(150, 330, 6)],
  ['打字卡四個字接句點（背面）', { text: '他終於下定決心了。He finally ＿＿.', mode: 'typed', lines: 4, english: true, revealed: true, words: ['made', 'up', 'his', 'mind'], expect: stuckWithSpeaker() }, sweep(150, 330, 6)],
  ['打字卡在括號裡', { text: 'You have to (＿＿) today.', mode: 'typed', lines: 2, english: true, expect: stuckWithSpeaker('(') }, sweep(150, 330, 6)],
  // 手機一行放得下四條線：沒有喇叭時不用為了標點或喇叭拆成兩列。
  ['打字卡四個字接句點（正面）', { text: '他終於下定決心了。He finally ＿＿.', mode: 'typed', lines: 4, english: true, speaker: false, expect: r => stuck()(r) && r.lineRows === 1 }, [338]],
  ['打字卡四個字在結尾（正面）', { text: '他終於下定決心了。He finally ＿＿', mode: 'typed', lines: 4, english: true, speaker: false, expect: r => !r.overflow && r.lineRows === 1 }, [338]],
  ['打字卡長答案在括號裡', { text: 'He has already (＿＿).', mode: 'typed', lines: 6, english: true, expect: stuckWithSpeaker('(') }, sweep(150, 330, 30)],
  ['打字卡長答案接句點', { text: '他已經下定決心要出國讀書。He has already ＿＿.', mode: 'typed', lines: 6, english: true, expect: stuckWithSpeaker() }, sweep(150, 330, 30)],
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
  // 比較句的空格（§10）：和解析一致的情況都在第一處；只有畫面才知道的（渲染器拿掉的）在句尾，Markdown 會記一行錯誤。
  { name: '比較句 句中', text: '盜匪躲在山＿＿裡。', mode: 'pick', speaker: false, expect: pickAt('山', '裡') },
  { name: '比較句 句首', text: '＿＿假快到了。', mode: 'pick', speaker: false, expect: pickAt('', '假') },
  { name: '比較句 句尾', text: '他昨天弄丟了＿＿', mode: 'pick', speaker: false, expect: pickAt('了', '') },
  { name: '比較句 一個底線', text: '盜匪躲在山＿裡。', mode: 'pick', speaker: false, expect: pickAt('山', '裡') },
  { name: '比較句 畫面有兩處在第一處', text: '山＿＿和＿＿裡。', mode: 'pick', speaker: false, expect: r => pickAt('山', '和＿＿')(r) },
  { name: '比較句 連結文字', text: '請看[山＿＿](https://example.com)的說明。', mode: 'pick', speaker: false, expect: pickAt('山', '的', 'A') },
  { name: '比較句 粗體裡', text: '盜匪躲在**山＿＿**裡。', mode: 'pick', speaker: false, expect: pickAt('山', '裡', 'STRONG') },
  { name: '比較句 字元參照', text: '山&#65343;&#65343;裡。', mode: 'pick', speaker: false, expect: pickAt('山', '裡') },
  { name: '比較句 十六進位字元參照', text: '山&#xFF3F;裡。', mode: 'pick', speaker: false, expect: pickAt('山', '裡') },
  { name: '比較句 圖片替代文字不算', text: `![底線＿](${IMAGE})山＿＿裡。`, mode: 'pick', speaker: false, expect: r => pickAt('山', '裡')(r) && r.protectedSame },
  { name: '比較句 嵌入不算', text: '![[不存在的筆記＿]]山＿＿裡。', mode: 'pick', speaker: false, expect: pickAt('山', '裡') },
  { name: '比較句 註解不算', text: '%%註解＿＿%%山＿＿裡。', mode: 'pick', speaker: false, expect: pickAt('山', '裡') },
  { name: '比較句 程式碼不算', text: '`＿＿`山＿＿裡。', mode: 'pick', speaker: false, expect: r => pickAt('山', '裡')(r) && r.protectedSame },
  { name: '比較句 中文後面的英文換行', text: '我可以借你的筆嗎？Can I ＿＿ your pen?', mode: 'pick', speaker: false, expect: r => pickIn('I ', ' your')(r) && r.breaks === 1 },
  { name: '比較句 空格是英文的第一個字', text: '我可以跟你借筆嗎？＿＿ me your pen?', mode: 'pick', speaker: false, expect: r => pickIn('？', ' me')(r) && r.breaks === 1 },
  { name: '比較句 零處在句尾', text: '這一句沒有空格。', mode: 'pick', speaker: false, expect: pickAtEnd },
  { name: '比較句 只有替代文字在句尾', text: `![底線＿](${IMAGE})這一句。`, mode: 'pick', speaker: false, expect: pickAtEnd },
  { name: '比較句 渲染器拿掉的在句尾', text: '<script>＿＿</script>這一句。', mode: 'pick', speaker: false, expect: pickAtEnd },
  ...sweep(150, 330, 6).map(width => ({ name: `比較句 接句號 ${String(width)}px`, text: '盜匪躲在高高的山上那座古老的＿＿。', mode: 'pick' as const, speaker: false, width, expect: stuck() })),
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
const frames = () => new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });

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
 * 每個空格前後緊接的字（中間有空白的不算）和緊鄰的線在不在同一列：字的中線落在那條線的上下緣之間。
 * 前面的字比第一條線，後面的字比最後一條線（打字卡的線排成好幾列時，句點要跟著最後一條，不是落在整格的範圍裡就算）。
 * 填空整個就是一條線。字照文件順序找，跳過線上的字與答案，所以標點放在 .ec-slot 裡面或外面都量得到。
 */
function besideBlanks(container: HTMLElement): { side: 'before' | 'after'; char: string; same: boolean }[] {
  const texts: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && node.textContent && !node.parentElement?.closest('.ec-line-word, .ec-blank-answer, .ec-mirror')) texts.push(node);
  }
  const charBeside = (node: Text | undefined, side: 'before' | 'after', line: Element) => {
    if (!node) return [];
    const text = node.textContent ?? '';
    const index = side === 'before' ? text.length - 1 : 0;
    const char = text.charAt(index);
    if (/\s/u.test(char)) return [];
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = Array.from(range.getClientRects()).find(item => item.width > 0);
    const box = line.getBoundingClientRect();
    return rect ? [{ side, char, same: middle(rect) > box.top && middle(rect) < box.bottom }] : [];
  };
  return Array.from(container.querySelectorAll<HTMLElement>('.ec-blank, .ec-slot')).flatMap(blank => {
    // 比較句的 .ec-slot 裡沒有線，整格就是空格。
    const lines = blank.querySelector('.ec-line') ? Array.from(blank.querySelectorAll('.ec-line')) : [blank];
    const first = lines[0];
    const last = lines[lines.length - 1];
    const before = texts.filter(node => (first.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0).at(-1);
    const after = texts.find(node => (last.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    return [...charBeside(before, 'before', first), ...charBeside(after, 'after', last)];
  });
}

/** slot 前面或後面所有的文字。 */
function textBeside(container: HTMLElement, slot: HTMLElement, side: 'before' | 'after'): string {
  const range = document.createRange();
  range.selectNodeContents(container);
  if (side === 'before') range.setEndBefore(slot);
  else range.setStartAfter(slot);
  return range.toString();
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
    await frames();
    if (item.rendered) container.insertAdjacentHTML('beforeend', item.rendered);
    const before =Array.from(container.querySelectorAll(PROTECTED)).map(el => el.outerHTML);
    const { tail, slot, slotMissing } = postProcess(container, { mode: item.mode ?? 'plain', lines: item.lines ?? 0, english: !!item.english });
    // 比較句的按鈕和畫面一樣大（PickCard 放進來的那顆）。
    if (item.mode === 'pick') slot?.append(Object.assign(document.createElement('button'), { type: 'button', className: 'ec-pick-slot', textContent: '　' }));
    if (item.revealed) reveal(container, item.words ?? []);
    if (item.speaker !== false) tail.append(speaker());
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
      lineRows: new Set(Array.from(container.querySelectorAll('.ec-line')).map(line => Math.round(line.getBoundingClientRect().top))).size,
      slotMissing,
      slotIn: slot?.parentElement?.closest('a, strong, em')?.tagName ?? null,
      beforeSlot: slot ? textBeside(container, slot, 'before') : '',
      afterSlot: slot ? textBeside(container, slot, 'after') : '',
      html: container.innerHTML.slice(0, 800),
    };
  } finally {
    component.unload();
  }
}

/** 給人看的那張圖的情況（結果檔的數字看不出好不好看）。 */
const SHOWN: (Omit<Case, 'name' | 'width' | 'expect'> & { label: string })[] = [
  { label: '填空 正面', text: '水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快。', mode: 'cloze' },
  { label: '填空 背面', text: '水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快。', mode: 'cloze', revealed: true },
  { label: '填空在結尾', text: '植物行光合作用時，需要的能量來自==陽光==。', mode: 'cloze' },
  { label: '填空在括號裡', text: '把糖放進水裡，再「==攪拌==」一下，糖溶解得比較快。', mode: 'cloze' },
  { label: '打字卡 一個字接句點', text: '他昨天弄丟了鑰匙。He lost his ＿＿.', mode: 'typed', lines: 1, english: true, speaker: false },
  { label: '打字卡 四個字接句點 正面', text: '他終於下定決心了。He finally ＿＿.', mode: 'typed', lines: 4, english: true, speaker: false },
  { label: '打字卡 四個字接句點 背面', text: '他終於下定決心了。He finally ＿＿.', mode: 'typed', lines: 4, english: true, revealed: true, words: ['made', 'up', 'his', 'mind'] },
  { label: '打字卡 六個字接句點', text: '他已經下定決心要出國讀書。He has already ＿＿.', mode: 'typed', lines: 6, english: true, speaker: false },
  { label: '比較句 句中', text: '盜匪躲在山＿＿裡。', mode: 'pick', speaker: false },
  { label: '比較句 粗體與連結', text: '盜匪躲在**山＿＿**裡，請看[說明](https://example.com)。', mode: 'pick', speaker: false },
];

/** 手機一行的寬度（iPhone 390px 扣掉左右留白）把 SHOWN 排在一起，整個視窗截一張圖；回傳路徑（拿不到 webContents 時是 null）。 */
async function shownCases(app: App): Promise<string | null> {
  const page = document.createElement('div');
  page.className = 'ec-app';
  page.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;grid-template-columns:repeat(2,360px);align-content:start;gap:4px 24px;padding:12px;background:var(--ec-page);color:var(--ec-ink)';
  document.body.append(page);
  try {
    for (const { label, ...item } of SHOWN) {
      const cell = page.appendChild(document.createElement('div'));
      cell.appendChild(document.createElement('div')).textContent = label;
      await runCase(app, cell.appendChild(document.createElement('div')), { ...item, name: label, width: 338 });
    }
    await frames();
    return await capturePng(app, `${W6_ROOT}/結果/內容後處理 ${String(Date.now())}.png`);
  } finally {
    page.remove();
  }
}

/** md-cases：每個情況一列，ok 是那個情況的 expect 成立；shot 是給人看的那張圖。 */
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
    return { allOk: rows.every(r => r.ok), failed: rows.filter(r => !r.ok).map(r => r.name), shot: await shownCases(app), rows };
  } finally {
    root.remove();
    rendering.restore();
  }
}
