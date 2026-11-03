// 試作（討論稿 2026-11-02-source-reading）：家長平常的打字雜訊會不會改變出處的讀法。
// 比較兩種讀法：現在的 sourceLinks（整串比對）與這裡的 tokenRead（先去雜訊、再拆成詞）。只讀程式、不碰 vault。
//   node experiments/source-reading/noise-check.mjs        結果摘要
//   node experiments/source-reading/noise-check.mjs --list 列出每一個讀法改變的例子
import { sourceLinks } from '../../src/core/deck/index.ts';

// ── 另一種讀法的試作 ──

/** 第 1 層：去雜訊。全形轉半形（NFKC）、各種破折號與波浪號、連續空白；只看比對用的字，顯示仍用原文。 */
function normalize(text) {
  return text.normalize('NFKC').replace(/[‐-―−ー]/g, '-').replace(/\s+/g, ' ').replace(/\s*-\s*(?=\d)/g, '-').trim();
}
const TERM = /(小[一二三四五六]|國[一二三]|高[一二三]) ?([上下])/;
const FIGURE = /(圖|表|例題) ?(\d+-\d+)(?: ?([A-Za-z])(?![A-Za-z0-9]))?/;
const PAGE = /(?<![A-Za-z0-9])[pP]\.? ?(\d+)(?:[-~](\d+))?(?![A-Za-z0-9-])|第 ?(\d+) ?頁|(?<![0-9-])(\d+) ?頁/;

/** 一段裡找位置：連結、圖表例題、頁碼；後面的字是說明。 */
function findPlace(text) {
  const note = /\[\[([^\]]+)\]\]/.exec(text);
  if (note) return { kind: 'note', link: note[1].split('|')[0].trim() };
  const figure = FIGURE.exec(text);
  if (figure) return { kind: 'block', id: ({ 圖: 'fig', 表: 'tab', 例題: 'ex' })[figure[1]] + figure[2] + (figure[3]?.toLowerCase() ?? '') };
  const page = PAGE.exec(text);
  if (page) return { kind: 'block', id: 'p' + (page[1] ?? page[3] ?? page[4]) };
  return null;
}

/** 一段：開頭的年級學期＋緊接的編號是單元；其他認得的是位置；認不得的字是說明，不拖累認得的部分。 */
function readChunk(text, context) {
  if (/^先備 ?:/.test(text)) return { unit: null, place: null, text: true };
  const term = TERM.exec(text);
  if (term) {
    const after = text.slice(term.index + term[0].length);
    const attached = /^[A-Za-z0-9]/.test(after);
    const code = attached || after.startsWith(' ') ? after.trim().split(' ')[0] : '';
    const place = findPlace(after);
    // 年級學期後面第一段就是位置（小五上 p.15）或什麼都沒有：不算單元。
    if (code && !findPlace(code)) {
      context.term = term[1] + term[2];
      return { unit: context.term + ' ' + code, place };
    }
    return { unit: null, place, plain: !place };
  }
  // 同一項裡，前面寫過年級學期、這一段是編號（國二上 L1, L2）：同一個年級學期。
  const carried = context.term && /^(\d+(?:-\d+)+|[A-Za-z]+\d+)(?: (.*))?$/.exec(text);
  if (carried && !findPlace(carried[1])) return { unit: context.term + ' ' + carried[1], place: findPlace(carried[2] ?? '') };
  const place = findPlace(text);
  // 前一段是頁碼，這一段只有數字（p.44, 45）：下一個頁碼，同一個單元。
  if (!place && /^\d+$/.test(text) && context.page) return { unit: context.unit, place: { kind: 'block', id: 'p' + text } };
  return { unit: null, place, plain: !place };
}

/** 第 2 層：拆成段（連結裡的不算），一段一段認。 */
function tokenRead(value) {
  const context = { term: null, page: false, unit: null };
  const clean = normalize(value);
  if (/^先備 ?:/.test(clean)) return [{ unit: null, place: null, text: true }];
  const chunks = clean.split(/(?![^[]*\]\])[,/;、]/).map(each => each.trim()).filter(Boolean);
  return chunks.map(chunk => {
    const read = readChunk(chunk, context);
    context.page = read.place?.kind === 'block' && read.place.id.startsWith('p');
    context.unit = read.unit;
    return read;
  });
}

// ── 只比意思：屬於哪個單元、連到哪裡；不比顯示的字 ──

function currentMeaning(value) {
  return sourceLinks([value.trim()]).map(({ link }) => {
    if (link.kind === 'unit') return { unit: link.term + ' ' + link.unit, place: placeOf(link.rest) };
    if (link.kind === 'heading') return { unit: null, place: null, plain: true };
    if (link.kind === 'text') return { unit: null, place: null, text: true };
    return { unit: null, place: placeOf(link) };
  });
}
const placeOf = link => !link || link.kind === 'heading' ? null : link.kind === 'note' ? { kind: 'note', link: link.link } : { kind: 'block', id: link.id };
const key = (reads, loose) => JSON.stringify(reads.filter(read => !read.plain || !loose).map(read => [read.unit?.toLowerCase() ?? null, read.place ?? null, read.text ?? false]));

// ── 家長平常的打字雜訊 ──

const fullDigits = text => text.replace(/[0-9A-Za-z]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
const NOISE = {
  '尾端多空白': text => text + ' ',
  '開頭多空白': text => ' ' + text,
  '連續兩個空白': text => text.replace(/ /g, '  '),
  '空白換全形': text => text.replace(/ /g, '　'),
  '逗號前多空白': text => text.replace(/([,，])/g, ' $1'),
  '逗號後沒空白': text => text.replace(/([,，]) /g, '$1'),
  '尾端多逗號': text => text + ',',
  '尾端多全形逗號': text => text + '，',
  '逗號換全形': text => text.replace(/,/g, '，'),
  '數字英文換全形': fullDigits,
  '句點換全形': text => text.replace(/\./g, '．'),
  '連字號換全形': text => text.replace(/-/g, '－'),
  '連字號換破折號': text => text.replace(/-/g, '–'),
  '大寫換小寫': text => text.replace(/[A-Z]/g, c => c.toLowerCase()),
  '小寫換大寫': text => text.replace(/[a-z]/g, c => c.toUpperCase()),
};
/** 家長會寫的基本寫法；第一欄是原文，第二欄是有沒有單元（給歸屬錯誤的統計）。 */
const BASE = ['p.44', 'p.44, p.45', 'p.44-46', '第 44 頁', '44頁', '圖 2-14', '圖 2-13 A', '表 2-1', '例題 2-3', 'p.45 知識快遞', '國二上 1-3', '國二上 1-3 p.20', '國二上 L1', '國二上 L1 p.20', '國二上 1-3 圖 2-14', '國二上 1-3 p.45 知識快遞', '國一上 Starter', '[[筆記#標題]]', '[[筆記]]', '先備：比例'];

function compare(name, read, loose) {
  let total = 0, flips = 0, unitFlips = 0;
  const list = [];
  for (const base of BASE) {
    const expected = read(base);
    for (const [noise, apply] of Object.entries(NOISE)) {
      const text = apply(base);
      if (text === base) continue;
      // 連結裡面的字是筆記的名字，不是雜訊的對象。
      if (base.includes('[[') && noise.includes('全形')) continue;
      total++;
      const actual = read(text);
      if (key(actual, loose) === key(expected, loose)) continue;
      flips++;
      const unit = reads => reads.map(each => each.unit).filter(Boolean).join();
      if (unit(actual) !== unit(expected)) unitFlips++;
      list.push({ noise, text, was: key(expected, loose), now: key(actual, loose) });
    }
  }
  console.log(`${name}：${total} 個變化裡，讀法改變 ${flips} 個（${(100 * flips / total).toFixed(0)}%），其中單元歸屬改變 ${unitFlips} 個`);
  return list;
}

/** 更小的做法：現在的讀法前面只加一步去雜訊（全形、空白、逗號前的空白、尾端的分隔符號），其他不動。 */
const tidy = value => normalize(value).replace(/ +([,/;])/g, '$1').replace(/[,/;、 ]+$/, '');
const current = compare('現在的讀法（整串比對）', currentMeaning, false);
const small = compare('現在的讀法前面只加去雜訊', value => currentMeaning(tidy(value)), false);
const token = compare('試作的讀法（先去雜訊、再拆成詞）', tokenRead, true);
if (process.argv.includes('--list')) {
  for (const [name, list] of [['現在', current], ['只加去雜訊', small], ['試作', token]]) {
    console.log('\n== ' + name);
    for (const each of list) console.log(`${each.noise.padEnd(10)} ${JSON.stringify(each.text).padEnd(34)} ${each.was} → ${each.now}`);
  }
}

// ── 這幾輪討論過的例子 ──

const unitOf = reads => reads.map(read => read.unit).filter(Boolean).join('、') || '—';
console.log('\n只加去雜訊時，這幾輪討論過的例子：');
for (const text of ['國二上 1-3 , p.44', '國二上 L1 ， L2', '國二上 1-3 p.44, 45', '國二上 2-1 水溶液', 'p.44, 45']) console.log('  ' + text.padEnd(26) + JSON.stringify(sourceLinks([tidy(text)]).map(item => item.link)).slice(0, 90));
console.log('\n各種手寫（試作的讀法）：');
for (const text of ['國二上 1-3, p.44', '國二上 1-3 , p.44', '國二上 1-3， p.44', '國二上 1-3 ／ p.44', '國二上 L1, L2', '國二上 L1 ， L2', '國二上 1-3 p.44, 45', '國二上 1-3 p.46-44', '國二上 ２-１', '國二上 2-1 水溶液', '小五上 2-1 水溶液 p.15', '看國二上 1-3 p.20', 'p.44, 45', 'p44', 'p.46-44', '44', '1-3 p.20', '2-1', 'L1', '1-2 溶液', 'CO2 的性質', '2 擴散現象', '小五上', '小五上 p.15', '國二上的回顧', '高六上 L1', '課本第三章', '老師上課說的', '溶解, 擴散', '[[a,b]]', '先備：A, B', 'A1 p.20', 'Starter p.20']) {
  const reads = tokenRead(text);
  const shown = reads.map(read => read.text ? '文字' : read.plain ? '看不懂或標題' : [read.unit && '單元 ' + read.unit, read.place && (read.place.id ?? read.place.link)].filter(Boolean).join(' + '));
  console.log('  ' + text.padEnd(26) + shown.join('　｜　') + (unitOf(reads) === '—' ? '' : ''));
}
