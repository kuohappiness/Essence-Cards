// 試作（討論稿 2026-11-02-source-reading）：三種出處的讀法，輸出同一種形狀，給 compare.mjs 評分。不是要合併的程式。
//   readCurrent 現在的讀法｜readSmall 小修版（有限去雜訊＋現有文法＋補提示）｜readScan 重寫版（切段、認單元、掃位置）
// 輸出：{ units: 本篇以外的單元, places: [{ scope, kind, value }], hint: 要不要提示家長 }。
import { sourceLinks } from '../../src/core/deck/index.ts';

export const CONTEXTS = {
  nature: { subject: '自然', self: '國二上 2-2', units: { '國二上 1-3': '', '國二上 1-8': '', '國二上 2-1': '水溶液', '國二上 2-2': '', '國一下 3-1': '' }, headings: ['溶解, 擴散', '睡眠的階段', 'CO₂ 的性質', '水溶液的濃度'] },
  english: { subject: '英文', self: '國一上 L3', units: { '國一上 L1': '', '國一上 L2': '', '國一上 L3': '', '國一上 Starter': '', '國一下 L1': '' }, headings: ['Unit Review'] },
};

// ── 有限去雜訊：只換確定的語法字元，連結裡不動；不用 NFKC（CO₂、①、² 不是打字雜訊）──

export function tidyText(text) {
  return text
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―−﹘﹣]/g, '-').replace(/〜/g, '~').replace(/﹐/g, ',').replace(/﹔/g, ';').replace(/﹑/g, '、')
    .replace(/\s+/g, ' ')
    .replace(/(?<=[0-9A-Za-z]) ?- ?(?=[0-9])/g, '-')
    .replace(/ +([,/;、])/g, '$1');
}
function tidyField(value) {
  const parts = value.split(/(\[\[[^\]]*\]\])/);
  return parts.map((part, at) => at % 2 ? part : tidyText(part)).join('').replace(/[,/;、。.\s]+$/, '').trim();
}
const splitOutside = (text, marks) => text.split(new RegExp(`(?![^[]*\\]\\])[${marks}]`)).map(part => part.trim()).filter(Boolean);

const canon = text => tidyText(text).toLowerCase();
const headingKey = text => tidyText(text).replace(/\s/g, '');
const headingHit = (text, ctx) => ctx.headings.find(each => each === text || headingKey(each) === headingKey(text));
/** 索引裡的單元（不分大小寫、全半形）；沒有回傳 null。 */
const indexed = (key, ctx) => Object.keys(ctx.units).find(each => canon(each) === canon(key)) ?? null;
const SHAPE = /^(?:[0-9]+(?:-[0-9]+)*|[A-Za-z]+[0-9]+)$/;
export const wellShaped = code => SHAPE.test(code);

function blockPlace(id, scope) {
  const match = /^(p|fig|tab|ex)(.+)$/.exec(id);
  return { scope, kind: { p: 'page', fig: 'figure', tab: 'table', ex: 'example' }[match[1]], value: match[2] };
}
const linkPlace = (link, scope) => link.kind === 'block' ? blockPlace(link.id, scope) : link.kind === 'note' ? { scope, kind: 'note', value: link.link } : null;

// ── 現在的讀法 ──

export function readCurrent(text, ctx) {
  const result = { units: [], places: [], hint: false };
  for (const { link } of sourceLinks(text.split('、').map(each => each.trim()).filter(Boolean))) {
    if (link.kind === 'heading') {
      if (ctx.headings.includes(link.heading)) result.places.push({ scope: 'this', kind: 'heading', value: link.heading });
      else result.hint = true;
    } else if (link.kind === 'unit') {
      const key = `${link.term} ${link.unit}`, own = key === ctx.self;
      if (!own) result.units.push(key);
      const place = link.rest && linkPlace(link.rest, own ? 'this' : key);
      if (place) result.places.push(place);
    } else if (link.kind !== 'text') result.places.push(linkPlace(link, 'this'));
  }
  return result;
}
readCurrent.key = text => text;

// ── 小修版：現有文法，前面去雜訊，後面補兩種提示 ──

export function readSmall(text, ctx) {
  const result = { units: [], places: [], hint: false };
  const items = splitOutside(tidyField(text), '、').map(each => each.replace(/;(?![^[]*\]\])/g, ','));
  for (const { link } of sourceLinks(items)) {
    if (link.kind === 'heading') {
      const hit = headingHit(link.heading, ctx);
      if (hit) result.places.push({ scope: 'this', kind: 'heading', value: hit });
      else result.hint = true;
    } else if (link.kind === 'unit') {
      const written = `${link.term} ${link.unit}`, hit = indexed(written, ctx), key = hit ?? written, own = key === ctx.self;
      if (!hit && !wellShaped(link.unit)) result.hint = true;
      if (!own) result.units.push(key);
      if (link.rest?.kind === 'heading') {
        if (!headingHit(link.rest.heading, ctx) && link.rest.heading !== (hit ? ctx.units[hit] : undefined)) result.hint = true;
      } else if (link.rest) result.places.push(linkPlace(link.rest, own ? 'this' : key));
    } else if (link.kind !== 'text') result.places.push(linkPlace(link, 'this'));
  }
  return result;
}
readSmall.key = canon;

// ── 重寫版：切段；每段開頭認單元，歸屬只從這裡來；其他地方掃位置；沒用到的字留著 ──

const LEAD = /^(?:看|見|參見|參考|參看|詳見|請見|請看|另見|來自|出自|課本|講義)\s*/;
const TERM = /^(小[一二三四五六]|國[一二三]|高[一二三]|[七八九](?:年級)?)\s*([上下])(?:學期|冊)?/;
const TERM_ALIAS = { 七: '國一', 八: '國二', 九: '國三' };
const AFTER_CODE = '(?=$|\\s|[(,]|p\\.?\\s*\\d|第\\s*\\d|圖|表|例題)';
const PLACE_START = /^(?:(?:pp?|pg|page)\.?\s*\d|第\s*\d+(?:\s*[-~至到]\s*\d+)?\s*頁|\d+(?:\s*[-~至到]\s*\d+)?\s*頁|(?:圖|表|例題)\s*\d|\[\[)/i;

/** 年級學期後面的編號：標準形狀（可以和位置黏著）、第 X 節、L 1；其他字串是 other，索引裡有才算。 */
function readCode(after) {
  if (PLACE_START.test(after)) return null;
  const chapter = /^第\s*(\d+(?:-\d+)*)\s*(?:節|課|章|單元)\s*(.*)$/s.exec(after);
  if (chapter) return { code: chapter[1], rest: chapter[2] };
  const named = /^單元\s*(.*)$/s.exec(after);
  if (named) return readCode(named[1]);
  const shape = new RegExp(`^(\\d+(?:-\\d+)*|[A-Za-z]+\\d+)${AFTER_CODE}\\s*(.*)$`, 's').exec(after);
  if (shape) return { code: shape[1], rest: shape[2] };
  const spaced = new RegExp(`^([A-Za-z]{1,2}) (\\d+)${AFTER_CODE}\\s*(.*)$`, 's').exec(after);
  if (spaced) return { code: spaced[1] + spaced[2], rest: spaced[3] };
  const other = /^(\S+)\s*(.*)$/s.exec(after);
  return other ? { code: other[1], rest: other[2], other: true } : null;
}

/** 一段裡所有的位置，照原文順序；left 是沒用到的字。bad：範圍寫反。 */
function scan(text) {
  const found = [];
  const blank = (start, end) => { masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end); };
  let masked = text, bad = false;
  for (const match of text.matchAll(/\[\[([^\]]*)\]\]/g)) {
    found.push({ at: match.index, end: match.index + match[0].length, kind: 'note', value: match[1].split('|')[0].trim() });
    blank(match.index, match.index + match[0].length);
  }
  const page = (match, first, last) => {
    const end = match.index + match[0].length;
    blank(match.index, end);
    if (last !== undefined && Number(last) < Number(first) && last.length === first.length) { bad = true; return; }
    found.push({ at: match.index, end, kind: 'page', value: first });
  };
  for (const match of [...masked.matchAll(/(?<![A-Za-z0-9])(?:pp?|pg|page)\.?\s*(\d+)(?:\s*[-~至到]\s*(?:(?:pp?|pg)\.?\s*)?(\d+))?(?:\s*頁)?(?![A-Za-z0-9-])/gi)]) page(match, match[1], match[2]);
  for (const match of [...masked.matchAll(/(?<![0-9-])(?:第\s*)?(\d+)(?:\s*[-~至到]\s*(\d+))?\s*頁/g)]) page(match, match[1], match[2]);
  for (const match of [...masked.matchAll(/(圖|表|例題)\s*(\d+)[-.](\d+)(?:\s*([A-Za-z])(?![A-Za-z0-9]))?/g)]) {
    const end = match.index + match[0].length;
    found.push({ at: match.index, end, kind: { 圖: 'figure', 表: 'table', 例題: 'example' }[match[1]], value: `${match[2]}-${match[3]}${match[4]?.toLowerCase() ?? ''}` });
    blank(match.index, end);
  }
  found.sort((a, b) => a.at - b.at);
  return { found, left: masked.replace(/\s+/g, ' ').trim(), bad };
}

/** 沒用到的字裡，有像沒寫完的單元或單獨的數字（第 3 段的 3 不算）。 */
const SUSPECT = /(?<![A-Za-z0-9.-])(?<!第\s*)\d+(?:-\d+)*(?![A-Za-z0-9-])|(?:小[一二三四五六]|國[一二三]|高[一二三])\s*[上下]/;

export function readScan(text, ctx, { carry = false } = {}) {
  const result = { units: [], places: [], hint: false };
  const field = tidyField(text);
  if (/^先備\s*:/.test(field)) return result;
  const whole = headingHit(text.trim(), ctx) ?? headingHit(field, ctx);
  if (whole) { result.places.push({ scope: 'this', kind: 'heading', value: whole }); return result; }
  const subject = new RegExp(`^${ctx.subject}\\s*`);
  let scope = 'this', last = null, carried = null;

  for (const segment of splitOutside(field, ',/;、')) {
    let rest = segment, unitName = null, isUnit = false;
    const body = segment.replace(subject, '').replace(LEAD, '').replace(subject, '');
    const term = TERM.exec(body);
    const after = term ? body.slice(term[0].length).replace(subject, '') : '';
    const addUnit = (written, code) => {
      const hit = indexed(written, ctx), key = hit ?? written;
      if (code.other && !hit) { result.hint = true; carried = null; return; }
      isUnit = true;
      unitName = hit ? ctx.units[hit] : null;
      if (key === ctx.self) scope = 'this';
      else { if (!result.units.includes(key)) result.units.push(key); scope = key; }
    };
    if (term && /^(?:$|\s|[0-9A-Za-z第]|單元)/.test(after)) {
      const name = (TERM_ALIAS[term[1][0]] ?? term[1]) + term[2];
      const code = readCode(after.trim());
      if (!code) { result.hint = true; carried = null; rest = after.trim(); }
      else if (/^\d+$/.test(code.code) && /^\d+(?![0-9-]*\s*頁)/.test(code.rest)) { result.hint = true; carried = null; rest = code.rest; }
      else { addUnit(`${name} ${code.code}`, code); carried = isUnit ? name : null; rest = code.rest; }
    } else if (carry && carried) {
      const code = new RegExp(`^(\\d+(?:-\\d+)+|[A-Za-z]+\\d+)${AFTER_CODE}\\s*(.*)$`, 's').exec(segment);
      if (code) { addUnit(`${carried} ${code[1]}`, { code: code[1] }); rest = code[2]; }
    }

    // 只有數字或編號的一段，接著前一段的位置：`p.44, 45`、`圖 2-14, 2-15`。
    if (!isUnit && /^\d+$/.test(rest) && last?.kind === 'page') { result.places.push(last = { scope, kind: 'page', value: rest }); continue; }
    if (!isUnit && /^\d+-\d+$/.test(rest) && last && ['figure', 'table', 'example'].includes(last.kind)) { result.places.push(last = { scope, kind: last.kind, value: rest }); continue; }

    const { found, left, bad } = scan(rest);
    if (bad) result.hint = true;
    for (const each of found) result.places.push(last = { scope: each.kind === 'note' ? 'this' : scope, kind: each.kind, value: each.value });
    if (!left) continue;
    if (found.some(each => each.kind === 'page') && /^\d+$/.test(left)) { result.places.push(last = { scope, kind: 'page', value: left }); continue; }
    const hit = headingHit(left, ctx);
    if (hit) { result.places.push(last = { scope: 'this', kind: 'heading', value: hit }); continue; }
    if (left === unitName) continue;
    if (SUSPECT.test(left) || /^[A-Za-z]+\d+$/.test(left)) result.hint = true;
    else if (isUnit && !found.length) result.hint = true;
  }
  if (!result.units.length && !result.places.length) result.hint = true;
  return result;
}
readScan.key = canon;
export const readScanCarry = (text, ctx) => readScan(text, ctx, { carry: true });
readScanCarry.key = canon;
