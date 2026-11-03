// 試作（討論稿 2026-11-02-source-reading，Claude 回應第三輪的收斂方向）：合併版的正式讀法。輸出形狀和 readers.mjs 相同，不是要合併的程式。
// 原則：只靠字面與本篇自己的屬性就只有一種讀法的，直接讀懂；別的單元只來自寫明的年級學期加編號；索引與材料只決定連結與提示，不改歸屬；
// 有否定字的那一段不算歸屬也不算位置，只提示（這張表只會讓結果變成「先不算」，不會新增任何歸屬）。

// ── 有限去雜訊：只換確定的語法字元，連結裡不動；不用 NFKC ──

function tidyText(text) {
  return text
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―−﹘﹣]/g, '-').replace(/〜/g, '~').replace(/﹐/g, ',').replace(/﹔/g, ';').replace(/﹑/g, '、')
    .replace(/\s+/g, ' ')
    // 數字之間的 一、ㄧ、ー、之 是連字號打錯（圖2一14、1ㄧ3、圖2之14）。
    .replace(/(?<=\d) ?[一ㄧー之] ?(?=\d)/g, '-')
    .replace(/(?<=[0-9A-Za-z]) ?- ?(?=[0-9])/g, '-')
    // p 後面打成句號、逗號、冒號：p。44、p，44、p：44、p . 44。
    .replace(/(?<![A-Za-z])([pP]) ?[.,:。] ?(?=\d)/g, '$1.')
    .replace(/ +([,;/、])/g, '$1');
}
const END = /[,/;、。.\s]+$/;
export const unitKey = text => tidyText(text).toLowerCase().replace(/\s+/g, ' ').trim();

// ── 連結與標題 ──

const LINK = /!?\[\[[^\]]*\]\]|!?［［[^］]*］］|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+/g;
const TOKEN = /(\d+)/g;
const headingFold = text => tidyText(text).toLowerCase().replace(/\s/g, '');
const findHeading = (text, list) => (list ?? []).find(each => each === text.trim() || headingFold(each) === headingFold(text)) ?? null;

/** 連結的目標；標題連結（`[[#標題]]`）回 heading。網址不是位置。 */
function linkPlace(raw, ctx) {
  const wiki = /^!?(\[\[|［［)\s*([^\]］]*?)\s*(\]\]|］］)$/.exec(raw);
  if (wiki) {
    const inner = wiki[1] === '［［' ? tidyText(wiki[2]) : wiki[2];
    const target = inner.split(/[|｜]/)[0].trim();
    if (target.startsWith('#')) {
      const hit = findHeading(target.slice(1), ctx.headings);
      return hit ? { kind: 'heading', value: hit } : { bad: true };
    }
    return { kind: 'note', value: target };
  }
  const markdown = /^\[[^\]]+\]\(([^)]+)\)$/.exec(raw);
  if (markdown) return { kind: 'note', value: decodeURIComponent(markdown[1]).replace(/\.md$/, '') };
  return null;
}

// ── 年級學期 ──

const GRADES = { 小: '一二三四五六', 國: '一二三', 高: '一二三' };
const DIGIT = '一二三四五六';
function readTerm(text) {
  const named = /^(小|國|高|國小|小學|國中|高中)\s*([一二三四五六1-6])\s*(?:年級)?\s*\(?\s*([上下])\s*\)?\s*(?:學期|冊)?/.exec(text);
  if (named) {
    const stage = { 國小: '小', 小學: '小', 國中: '國', 高中: '高' }[named[1]] ?? named[1];
    const grade = /\d/.test(named[2]) ? DIGIT[Number(named[2]) - 1] : named[2];
    if (GRADES[stage].includes(grade)) return { term: stage + grade + named[3], length: named[0].length };
    return null;
  }
  const junior = /^([七八九789])\s*(?:年級)?\s*\(?\s*([上下])\s*\)?\s*(?:學期|冊)?/.exec(text);
  if (junior) return { term: '國' + { 七: '一', 八: '二', 九: '三', 7: '一', 8: '二', 9: '三' }[junior[1]] + junior[2], length: junior[0].length };
  return null;
}

// ── 編號 ──

const ZH = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 中文數字 1～999；寫法不對回 null（`十百` 不算）。 */
function zhNumber(text) {
  const match = /^(?:([一二兩三四五六七八九])百)?(?:(?:([一二三四五六七八九])?(十))|零)?([一二三四五六七八九])?$/.exec(text);
  if (!match || !text) return null;
  return (match[1] ? ZH[match[1]] * 100 : 0) + (match[3] ? (match[2] ? ZH[match[2]] : 1) * 10 : 0) + (match[4] ? ZH[match[4]] : 0);
}
const NUM = '(?:\\d+|[一二兩三四五六七八九十百零]+)';
const toNumber = text => /^\d+$/.test(text) ? text : (zhNumber(text) === null ? null : String(zhNumber(text)));

const AFTER_CODE = '(?=$|\\s|[(,]|[pP]\\.?\\s*\\d|第\\s*\\d|圖|表|例題|\\uE000)';
const SHAPE = /^(?:\d+(?:-\d+)*|[A-Za-z]+\d+)$/;
const PLACE_START = /^(?:(?:pp?|pg|page)\.?\s*\d|第\s*\S*?\s*頁|\d+(?:\s*[-~至到]\s*\d+)?\s*頁|(?:圖|表|例題|範例|fig(?:ure)?\.?|table|example)\s*\d|)/i;

/** 年級學期後面的編號；開頭是位置、中文字或沒寫完時 null。 */
function readCode(text) {
  const t = text.trimStart();
  if (PLACE_START.test(t)) return null;
  const chapter = new RegExp(`^第\\s*(${NUM})\\s*章\\s*第\\s*(${NUM})\\s*節\\s*(.*)$`, 's').exec(t);
  if (chapter) {
    const [a, b] = [toNumber(chapter[1]), toNumber(chapter[2])];
    return a && b ? { code: `${a}-${b}`, rest: chapter[3] } : null;
  }
  const named = /^單元\s*(.*)$/s.exec(t);
  if (named) return readCode(named[1]);
  const shape = new RegExp(`^(\\d+(?:-\\d+)*|[A-Za-z]+\\d+)${AFTER_CODE}\\s*(.*)$`, 's').exec(t);
  if (shape) return { code: shape[1], rest: shape[2] };
  const spaced = new RegExp(`^([A-Za-z]{1,2}) (\\d+)${AFTER_CODE}\\s*(.*)$`, 's').exec(t);
  if (spaced) return { code: spaced[1] + spaced[2], rest: spaced[3] };
  // 其他編號（`Starter`、`L1-2`）：半形字母開頭的一個字。不查索引，對不到才提示。範圍符號不是編號。
  const other = /^([A-Za-z][A-Za-z0-9-]*)(?:\s+(.*))?$/s.exec(t);
  if (other) return { code: other[1], rest: other[2] ?? '', other: true };
  return null;
}

// ── 位置 ──

const KIND = { 圖: 'figure', fig: 'figure', figure: 'figure', 表: 'table', table: 'table', 例題: 'example', 範例: 'example', example: 'example' };

/** 一段裡所有的位置，照原文順序；left 是沒用到的字。bad：範圍寫反或省略不確定。 */
function scan(text, tokens, ctx) {
  const found = [];
  let masked = text, bad = false;
  const take = (match, item) => { if (item) found.push({ at: match.index, ...item }); masked = masked.slice(0, match.index) + ' '.repeat(match[0].length) + masked.slice(match.index + match[0].length); };
  for (const match of [...masked.matchAll(TOKEN)]) {
    const token = tokens[Number(match[1])];
    if (token.heading) { take(match, { kind: 'heading', value: token.heading, fixed: true }); continue; }
    const place = linkPlace(token, ctx);
    if (place?.bad) bad = true;
    take(match, place?.bad ? null : place);
  }
  for (const match of [...masked.matchAll(/「([^」]+)」/g)]) { const hit = findHeading(match[1], ctx.headings); if (hit) take(match, { kind: 'heading', value: hit, fixed: true }); }
  for (const match of [...masked.matchAll(/#([^\s#,、;/]+)/g)]) { const hit = findHeading(match[1], ctx.headings); if (hit) take(match, { kind: 'heading', value: hit, fixed: true }); }
  for (const match of [...masked.matchAll(/(圖|表|例題|範例|figure|fig|table|example)\.?\s*(\d+)[-.](\d+)\s*(?:\(?\s*([A-Za-z])\s*\)?(?![A-Za-z0-9]))?/gi)]) take(match, { kind: KIND[match[1].toLowerCase()], value: `${match[2]}-${match[3]}${match[4]?.toLowerCase() ?? ''}` });
  for (const match of [...masked.matchAll(/(?<![A-Za-z0-9-])(\d+)-(\d+)\s*(圖|表|例題)/g)]) take(match, { kind: KIND[match[3]], value: `${match[1]}-${match[2]}` });
  const page = (match, first, last, dotted) => {
    const start = toNumber(first);
    if (start === null) return;
    if (last !== undefined) {
      const end = toNumber(last);
      // 反向、位數較少都不確定：`p.46-44`、`p.44-6`。不偷偷截成第一頁。
      if (end === null || Number(end) <= Number(start)) { bad = true; take(match, null); return; }
    }
    // 沒有句點的 p53 後面又接字（`p53 基因`）可能是名稱，不連。
    if (dotted === false && /^\s*[^\s圖表例第pP頁,]/.test(masked.slice(match.index + match[0].length))) { bad = true; take(match, null); return; }
    take(match, { kind: 'page', value: start });
  };
  for (const match of [...masked.matchAll(/(?<![A-Za-z0-9])(pp?|pg|page)(\.?)\s*(\d+)(?:\s*[-~至到]\s*(?:(?:pp?|pg|page)\.?\s*)?(\d+))?(\s*頁)?(?![A-Za-z0-9-])/gi)]) page(match, match[3], match[4], Boolean(match[2]) || Boolean(match[5]) || match[1].length > 1);
  for (const match of [...masked.matchAll(new RegExp(`(?<![0-9A-Za-z-])(?:第\\s*)?(${NUM})(?:\\s*[-~至到]\\s*(${NUM}))?\\s*頁`, 'g'))]) page(match, match[1], match[2]);
  // 第 N 題、第 N 段是說明，不用提示。
  masked = masked.replace(/第\s*\d+\s*[題段行]/g, m => ' '.repeat(m.length));
  found.sort((a, b) => a.at - b.at);
  const before = found.length ? masked.slice(0, found[0].at).replace(/\s+/g, ' ').trim() : '';
  return { found, left: masked.replace(/\s+/g, ' ').trim(), before, bad };
}

// ── 讀一整個欄位 ──

// 有這些字的那一段不算歸屬、不算位置，只提示。表只會讓結果變成「先不算」，所以缺字不會多算，只是少一次保護。
const NEGATIVE = /不是|不要|不用|不必|不算|不考|不看|不含|不包括|除外|以外|排除|並非|而非|而是|別算|勿|略過|改成|改為|更正|應為|不對/;
const SELF = /^(?:本單元|本篇|本課|本節|這一篇|這一課|這一節|這一單元|這個單元)\s*/;
const MATERIAL = /^(?:課本|講義|習作|筆記|教材|學習單|補充)(?:的)?$/;
// 沒用到的字裡，有編號或年級學期：可能是沒寫完的參照。
const SUSPECT = /(?<![A-Za-z0-9.-])\d+(?:-\d+)+(?![A-Za-z0-9-])|(?:小[一二三四五六]|國[一二三]|高[一二三]|[七八九])\s*[上下]/;
const WRAP = /^[([「《【]\s*(.*?)\s*[)\]」》】]$/s;

function parseField(clean, tokens, ctx) {
  const out = { units: [], places: [], hint: false };
  const hint = () => { out.hint = true; };
  const ownTerm = ctx.self?.split(' ')[0] ?? null, ownCode = ctx.self?.split(' ').slice(1).join(' ') ?? '';
  const subject = ctx.subject ? new RegExp(`^${ctx.subject}\\s*`) : /^$/;
  const isOwn = key => unitKey(key) === unitKey(ctx.self ?? '');
  const indexed = key => Object.keys(ctx.units).find(each => unitKey(each) === unitKey(key)) ?? null;
  let scope = 'this', last = null, carry = null;
  const addPlace = item => {
    const at = item.kind === 'note' || item.fixed ? 'this' : scope;
    if (at === null) { hint(); return; }
    last = { scope: at, kind: item.kind, value: item.value };
    if (!out.places.some(p => p.scope === at && p.kind === item.kind && p.value === item.value)) out.places.push(last);
  };

  const segments = clean.split(/[,/;、]/).map(each => each.trim()).filter(Boolean).flatMap(segment => {
    // 位置後面直接接年級學期加編號：從那裡切開（`p.44 國二上 1-3 p.20`）。
    for (let at = 1; at < segment.length; at++) {
      if (segment[at - 1] !== ' ' || !readTerm(segment.slice(at))) continue;
      const head = scan(segment.slice(0, at).trim(), tokens, ctx);
      if (head.found.length && !head.left) return [segment.slice(0, at).trim(), segment.slice(at).trim()];
    }
    return [segment];
  });

  segments.forEach((raw, index) => {
    const segment = raw.replace(WRAP, '$1');
    if (NEGATIVE.test(segment)) { hint(); last = null; carry = null; return; }
    let rest = segment, unit = null, selfRef = false;
    const body = segment.replace(subject, '');
    const term = readTerm(body);
    const after = term ? body.slice(term.length).replace(subject, '') : '';
    if (term && /^(?:$|\s|[0-9A-Za-z第]|單元|)/.test(after)) {
      const code = readCode(after);
      const unsure = code && (code.other || /^\d+$/.test(code.code)) && /^\d+(?![0-9-]*\s*頁)/.test(code.rest);
      if (!code || unsure) {
        // 只有年級學期、編號沒寫完（`小五上 p.15`、`國二上 1 3`）：不猜單元。自己的學期還算這本書；別的學期的位置不知道在哪裡。
        hint(); carry = null; last = null;
        const { found } = scan(after.trim(), tokens, ctx);
        if (term.term === ownTerm) { scope = 'this'; found.forEach(addPlace); } else scope = null;
        return;
      }
      unit = `${term.term} ${code.code}`;
      rest = code.rest;
      if (code.other && !indexed(unit)) hint();
      carry = { term: term.term, code: code.code };
    } else if (SELF.test(segment)) {
      scope = 'this'; selfRef = true; rest = segment.replace(SELF, ''); carry = null;
    } else {
      const own = ownCode && new RegExp(`^${ownCode}(?![0-9A-Za-z-])\\s*(.*)$`, 'is').exec(segment);
      if (own) { scope = 'this'; selfRef = true; rest = own[1]; carry = null; }
      else {
        // 接著前一個位置：p.44, 45；圖 2-14、2-15；圖 2-13a、b；44、46頁。
        if (last?.kind === 'page' && /^\d+$/.test(segment)) { addPlace({ kind: 'page', value: segment }); return; }
        if (last && ['figure', 'table', 'example'].includes(last.kind) && /^\d+-\d+$/.test(segment)) { addPlace({ kind: last.kind, value: segment }); return; }
        if (last?.kind === 'figure' && /^[A-Za-z]$/.test(segment)) { addPlace({ kind: 'figure', value: last.value.replace(/[a-z]$/, '') + segment.toLowerCase() }); return; }
        if (/^\d+$/.test(segment) && /^\d+\s*頁/.test(segments[index + 1] ?? '')) { addPlace({ kind: 'page', value: segment }); return; }
        // 乾淨的列表：寫過年級學期的下一段只有編號（可以加位置），和前一個同一類，沿用學期（`國二上 1-3、1-8`）。
        const bare = /^(\d{1,2}(?:-\d{1,2})*|[A-Za-z]+\d+)(?![0-9A-Za-z-])\s*(.*)$/s.exec(segment);
        const sameKind = bare && carry && (/^\d/.test(carry.code)
          ? /^\d/.test(bare[1]) && bare[1].split('-').length === carry.code.split('-').length
          : /^[A-Za-z]+/.exec(carry.code)?.[0].toLowerCase() === /^[A-Za-z]+/.exec(bare[1])?.[0].toLowerCase());
        if (sameKind && (!bare[2] || scan(bare[2], tokens, ctx).found.length && !scan(bare[2], tokens, ctx).left)) {
          unit = `${carry.term} ${bare[1]}`;
          rest = bare[2];
          if (!indexed(unit)) hint();
        }
      }
    }

    let unitName = null;
    if (unit) {
      const hit = indexed(unit);
      const key = hit ?? unit;
      unitName = hit ? ctx.units[hit] : null;
      if (isOwn(key)) scope = 'this';
      else { if (!out.units.some(each => unitKey(each) === unitKey(key))) out.units.push(key); scope = key; }
    }

    const { found, left, before, bad } = scan(rest, tokens, ctx);
    if (bad) hint();
    found.forEach(addPlace);
    if (left && found.some(each => each.kind === 'page') && /^\d+$/.test(left)) { addPlace({ kind: 'page', value: left }); return; }
    if (!left) return;
    if (!unit && !selfRef) { last = found.length ? last : null; carry = found.length ? carry : null; }
    if (unitName && headingFold(left) === headingFold(unitName)) return;
    // 單元後面的字是那個單元材料的標題：連過去。
    const heading = unit && !found.length ? findHeading(left, scope === 'this' ? ctx.headings : ctx.unitHeadings?.[scope]) : (!found.length && !unit ? findHeading(left, ctx.headings) : null);
    if (heading) { addPlace({ kind: 'heading', value: heading }); return; }
    // 一整段只有數字或編號（`國二上1-3,8`、`國二上 1-3, L2`）：沒辦法接到任何東西，不能默默丟掉。
    if (SUSPECT.test(left) || /^(?:\d+|[A-Za-z]+\d+)$/.test(left)) hint();
    else if (unit && !found.length) hint();
    // 單元和位置之間的字是說明（`國二上 2-1 水溶液 p.15`）；沒寫單元時，位置前面有一句話才提示（`老師說過 p.44`）。
    else if (!unit && !selfRef && found.length && before && !MATERIAL.test(before)) hint();
  });
  if (!out.units.length && !out.places.length) hint();
  return out;
}

export function readMerged(text, ctx) {
  const tokens = [];
  const masked = text.replace(LINK, match => { tokens.push(match); return `${tokens.length - 1}`; });
  const clean = tidyText(masked).replace(END, '').trim();
  if (/^先備\s*:/.test(clean)) return { units: [], places: [], hint: false };
  const first = parseField(clean, tokens, ctx);
  // 沒有單元也沒有位置時，整句可能是舊標題。
  if (!first.units.length && !first.places.length) {
    const whole = findHeading(text.trim(), ctx.headings) ?? findHeading(clean, ctx.headings);
    if (whole) return { units: [], places: [{ scope: 'this', kind: 'heading', value: whole }], hint: false };
  }
  // 含分隔符號的舊標題（`溶解, 擴散 p.44`）：藏起來再讀一次；歸屬一定要和第一次一樣，材料不能改歸屬。
  for (const heading of ctx.headings.filter(each => /[,/;、，]/.test(each))) {
    const plain = tidyText(heading);
    if (!clean.includes(plain)) continue;
    tokens.push({ heading });
    const second = parseField(clean.replace(plain, `${tokens.length - 1}`), tokens, ctx);
    if (JSON.stringify(second.units) === JSON.stringify(first.units)) return second;
  }
  return first;
}
readMerged.key = unitKey;
