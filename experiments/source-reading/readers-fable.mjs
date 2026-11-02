// 試作（討論稿 2026-11-02-source-reading 第二輪）：Fable 的候選讀法。輸出形狀和 readers.mjs 相同：{ units, places, hint }，加 reader.key。
// 不是要合併的程式。只讀程式、不碰 vault。
//
// 原則（哪些證據能改歸屬）：
//   1. 歸屬只來自「年級學期＋編號」這個結構，而且它要在一項的開頭，或緊接在分隔符號／位置後面。前面有中文句子就不算（句子放備註，D-165 第 4 點）。
//   2. 年級學期的別名只用靜態對照（七上＝國一上、8上、第三冊、B2、二上照本篇的學制），不查索引。索引只決定要不要提示。
//   3. 同一個欄位值裡，寫過年級學期之後，單獨的編號（`國二上 1-3、1-8`）沿用那個學期；編號要是標準形狀，而且和前一個編號同一類（1-3 後面接 1-8，不接 8）。
//   4. 位置跟著同一項前面的單元走；頓號後面明寫的位置回到本篇（D-164）；單獨的數字接著前一個位置的種類與範圍。「本單元」把範圍切回本篇。
//   5. 沒用到的數字、字母編號一律提示；沒用到的中文字當說明，但「單元後面只有中文、沒有位置」與「位置前面有一句話」也提示。
//   6. 材料的標題只決定連結，不決定歸屬；連結裡的字不動。本篇自己的編號（`L3 p.30`）認得，不用查索引。

const CJK = '\\u3400-\\u9fff';
const ZH_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 中文數字 1～99 → 阿拉伯數字；認不得回傳 null。 */
function zhNumber(text) {
  if (/^[一二三四五六七八九]$/.test(text)) return ZH_DIGIT[text];
  const match = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(text);
  if (match) return (match[1] ? ZH_DIGIT[match[1]] : 1) * 10 + (match[2] ? ZH_DIGIT[match[2]] : 0);
  return null;
}
const zh = text => text.replace(/第\s*([一二三四五六七八九十]{1,3})(?=\s*[頁章節課冊單])/g, (m, n) => zhNumber(n) === null ? m : '第' + zhNumber(n));

// ── 第 1 層：去雜訊。只換語法字元；連結、網址先保護起來 ──

const PROTECT = /(!?\[\[[^\]]*\]\]|!?［［[^］]*］］|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/;
function tidy(text) {
  return text
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s 　]+/g, ' ')
    .replace(/[‐‑‒–—―−﹘﹣]/g, '-').replace(/[〜～]/g, '~')
    // 數字之間的 一、ㄧ、ー、之 是連字號打錯（圖2一14、1ㄧ3、圖2之14）。
    .replace(/(?<=\d)\s*[一ㄧー之]\s*(?=\d)/g, '-')
    .replace(/(?<=[0-9A-Za-z]) ?- ?(?=[0-9])/g, '-')
    // p 後面打成句號、逗號、冒號：p。44、p，44、p：44。
    .replace(/(?<![A-Za-z])([pP])\s*[.,:。，：]?\s*(?=\d)/g, '$1.')
    .replace(/ +([,;/、])/g, '$1');
}

// ── 年級學期與編號 ──

const STAGE = { 小: '小', 國: '國', 高: '高' };
const GRADE = '零一二三四五六七八九';
/** 本篇的學制（小／國／高）；認不得當國中。 */
const ownStage = ctx => STAGE[ctx.self?.[0]] ?? '國';
/** 冊 → 年級學期：國中、高中 6 冊，國小 12 冊。 */
function bookTerm(stage, book) {
  const n = Number(book);
  const max = stage === '小' ? 12 : 6;
  if (!(n >= 1 && n <= max)) return null;
  return stage + GRADE[Math.ceil(n / 2)] + (n % 2 ? '上' : '下');
}
/** 段落開頭的年級學期（含別名），回傳 { term, length }；沒有是 null。 */
function readTerm(text, ctx) {
  const explicit = /^(小|國|高)\s*([一二三四五六1-6])\s*(?:年級)?\s*[(（]?\s*([上下])\s*[)）]?\s*(?:學期|冊)?/.exec(text);
  if (explicit) return { term: explicit[1] + GRADE[zhNumber(explicit[2]) ?? Number(explicit[2])] + explicit[3], length: explicit[0].length };
  const alias = /^([七八九])\s*(?:年級)?\s*([上下])\s*(?:學期)?/.exec(text);
  if (alias) return { term: '國' + GRADE[ZH_DIGIT[alias[1]] - 6] + alias[2], length: alias[0].length };
  // 沒寫國小高的 `二上`：照本篇的學制，年級要在那個學制的範圍內（國中、高中 1～3，國小 1～6），不然不是年級學期。
  const bare = /^([一二三四五六1-9])\s*([上下])\s*(?:學期)?(?=\s|\d|[A-Za-z]|$)/.exec(text);
  if (bare) {
    const n = zhNumber(bare[1]) ?? Number(bare[1]);
    const stage = n >= 7 ? '國' : ownStage(ctx);
    const grade = n >= 7 ? n - 6 : n;
    if (grade <= (stage === '小' ? 6 : 3)) return { term: stage + GRADE[grade] + bare[2], length: bare[0].length };
  }
  // 冊數（第三冊、B2）：後面要接本篇那種字母的編號或數字編號，`B6 A1` 這種不算。
  const book = /^(?:第\s*(\d+)\s*冊|[Bb](?:ook)?\s*(\d+)(?=\s*[A-Za-z]|\s|$))\s*/.exec(text);
  if (book) {
    const term = bookTerm(ownStage(ctx), book[1] ?? book[2]);
    const next = text.slice(book[0].length);
    if (term && (/^\d/.test(next) || next.toUpperCase().startsWith(letterOf(ctx).toUpperCase()) || /^(?:第|Lesson|Unit)/i.test(next))) return { term, length: book[0].length };
  }
  return null;
}
const SHAPE = /^(?:\d+(?:-\d+)*|[A-Za-z]+\d+)$/;
/** 編號的類別：有連字號的數字、純數字、字母加數字、其他字。沿用學期時前後要同一類。 */
const shapeClass = code => /^\d+(?:-\d+)+$/.test(code) ? 'dash' + code.split('-').length : /^\d+$/.test(code) ? 'num' : /^[A-Za-z]+\d+$/.test(code) ? 'alpha' : 'word';
/** 本篇編號用的字母（L、U…）；本篇不是字母編號時用 L。 */
const ownCode = ctx => ctx.self?.split(' ').slice(1).join(' ') ?? '';
const letterOf = ctx => /^[A-Za-z]+/.exec(ownCode(ctx))?.[0] ?? 'L';
/**
 * 年級學期後面的編號：標準形狀（可以黏著位置）、第N章第M節、第N課／Lesson N／Unit N（照本篇的字母）、範圍、其他半形字母開頭的字（Starter）。
 * 回傳 { codes, rest }；codes 可能是範圍展開後的好幾個。開頭是位置、中文字或沒寫完的編號（`1-`）時 null。
 */
const PLACE_START = /^(?:(?:pp?|pg|page)\.?\s*\d|(?:第\s*)?\d+(?:\s*[-~至到]\s*\d+)?\s*頁|(?:圖|表|例題|範例|fig)\.?\s*\d|\[\[|\u0001)/i;
function readCode(text, ctx) {
  const t = text.trimStart();
  // 年級學期後面直接是位置（`小五上 p.15`、`國二上 20頁`）：沒寫單元，不猜。
  if (PLACE_START.test(t)) return null;
  const chapter = /^第\s*(\d+)\s*章\s*第\s*(\d+)\s*節\s*(.*)$/s.exec(t);
  if (chapter) return { codes: [`${chapter[1]}-${chapter[2]}`], rest: chapter[3] };
  const lesson = /^(?:第\s*(\d+)\s*課|(?:Lesson|Unit|U|L)\s+(\d+))(?![0-9])\s*(.*)$/is.exec(t);
  if (lesson) return { codes: [letterOf(ctx) + (lesson[1] ?? lesson[2])], rest: lesson[3] };
  const range = /^([A-Za-z]*)(\d+(?:-\d+)*)\s*(?:~|到|至|-)\s*(?:\1)?(\d+(?:-\d+)*)(?![0-9A-Za-z])\s*(.*)$/s.exec(t);
  if (range && (range[1] || /-/.test(range[2]) || /-/.test(range[3]))) {
    const codes = expandRange(range[1], range[2], range[3]);
    if (codes) return { codes, rest: range[4] };
  }
  const shape = /^(\d+(?:-\d+)*|[A-Za-z]+\d+)(?![0-9A-Za-z-])\s*(.*)$/s.exec(t) ?? /^(\d+(?:-\d+)*|[A-Za-z]+\d+)(?=[pP]\.?\s*\d|第\s*\d|圖|表|例題|\[\[)\s*(.*)$/s.exec(t);
  if (shape) return { codes: [shape[1]], rest: shape[2] };
  const other = /^([A-Za-z][A-Za-z0-9-]*)(?:\s+(.*))?$/s.exec(t);
  if (other) return { codes: [other[1]], rest: other[2] ?? '' };
  return null;
}
/** L1~L3 → L1、L2、L3；1-3~1-8 → 1-3…1-8（只展開最後一段）；展不開回傳 null。 */
function expandRange(letters, from, to) {
  const a = from.split('-'), b = to.split('-');
  if (a.length !== b.length || a.slice(0, -1).join() !== b.slice(0, -1).join()) return null;
  const lo = Number(a.at(-1)), hi = Number(b.at(-1));
  if (!(hi > lo && hi - lo <= 20)) return null;
  const head = a.slice(0, -1);
  return Array.from({ length: hi - lo + 1 }, (_, i) => letters + [...head, String(lo + i)].join('-'));
}

// ── 位置：連結、標題、頁碼、圖表例題 ──

const KIND = { 圖: 'figure', fig: 'figure', 表: 'table', 例題: 'example', 範例: 'example' };
const fold = text => tidy(text).toLowerCase().replace(/\s+/g, '').replace(/[₀-₉]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x2080 + 48)).replace(/[²³¹]/g, c => ({ '²': '2', '³': '3', '¹': '1' })[c]);
/** 材料裡的標題：原文相同，或去掉寬度、大小寫、空白、上下標後相同。 */
const headingHit = (text, ctx) => ctx.headings.find(each => each === text.trim() || fold(each) === fold(text));
/** 標題出現在文字裡的位置（fold 之後比，回到原文的位置）；沒有是 null。 */
function findHeading(text, heading) {
  const target = fold(heading);
  if (!fold(text).includes(target)) return null;
  for (let start = 0; start < text.length; start++) {
    for (let end = start + 1; end <= text.length; end++) {
      const f = fold(text.slice(start, end));
      if (f === target) return { start, end };
      if (f.length > target.length) break;
    }
  }
  return null;
}

/** 一段文字裡所有的位置，照原文順序；left 是沒用到的字。 */
function scan(text, ctx) {
  const found = [];
  let masked = text, bad = false;
  const take = (match, item) => { found.push({ at: match.index, ...item }); masked = masked.slice(0, match.index) + ' '.repeat(match[0].length) + masked.slice(match.index + match[0].length); };
  for (const match of [...masked.matchAll(/「([^」]+)」/g)]) {
    const hit = headingHit(match[1], ctx);
    if (hit) take(match, { kind: 'heading', value: hit });
  }
  for (const match of [...masked.matchAll(/#([^\s#,、;/]+)/g)]) {
    const hit = headingHit(match[1], ctx);
    if (hit) take(match, { kind: 'heading', value: hit });
  }
  for (const match of [...masked.matchAll(/(圖|表|例題|範例|fig)\.?\s*(\d+)-(\d+)\s*(?:[(（]?\s*([A-Za-z])\s*[)）]?(?![A-Za-z0-9]))?/gi)]) take(match, { kind: KIND[match[1].toLowerCase()], value: `${match[2]}-${match[3]}${match[4]?.toLowerCase() ?? ''}` });
  for (const match of [...masked.matchAll(/(?<![A-Za-z0-9])(\d+)-(\d+)\s*(圖|表|例題)/g)]) take(match, { kind: KIND[match[3]], value: `${match[1]}-${match[2]}` });
  const page = (match, first, last) => {
    if (last !== undefined) {
      const lo = Number(first), hi = last.length < first.length ? Number(first.slice(0, first.length - last.length) + last) : Number(last);
      if (hi < lo) { bad = true; take(match, { kind: 'page', value: String(Math.min(lo, hi)) }); return; }
    }
    take(match, { kind: 'page', value: first });
  };
  for (const match of [...masked.matchAll(/(?<![A-Za-z0-9])(?:pp?|pg|page)\.?\s*(\d+)(?:\s*(?:~|-|至|到)\s*(?:p\.?\s*)?(\d+))?(?:\s*頁)?(?![A-Za-z0-9-])/gi)]) page(match, match[1], match[2]);
  for (const match of [...masked.matchAll(/(?<![0-9A-Za-z-])(?:第\s*)?(\d+)(?:\s*(?:~|-|至|到)\s*(\d+))?\s*頁/g)]) page(match, match[1], match[2]);
  // 第 N 題是說明，不是位置，也不用提示。
  masked = masked.replace(/第\s*\d+\s*題/g, m => ' '.repeat(m.length));
  found.sort((a, b) => a.at - b.at);
  return { found, left: masked.replace(/\s+/g, ' ').trim(), bad, leftBefore: found.length ? masked.slice(0, found[0].at).replace(/\s+/g, ' ').trim() : '' };
}

// ── 讀一整個欄位值 ──

const BOUNDARY = { '、': 'hard', ';': 'hard', '/': 'hard', ',': 'soft' };
const SELF = /^(?:本單元|本篇|本課|本節|這一節|這一課|這個單元)\s*/;

export function readFable(text, ctx) {
  const result = { units: [], places: [], hint: false };
  const hint = () => { result.hint = true; };
  // 連結、網址、材料裡的標題先抽出來，用佔位字元代替；裡面的字不動，標題裡的逗號也不會被切開。
  const tokens = [];
  const hold = (kind, value) => { tokens.push({ kind, value }); return `\u0001${tokens.length - 1}\u0001`; };
  let guarded = text.replace(new RegExp(PROTECT, 'g'), m => hold('link', m));
  // 材料的標題只決定連結：開頭已經是「年級學期＋編號」的結構時，就算材料裡有同名標題也不當標題（歸屬不看材料）。
  const structured = (() => { const t = readTerm(tidy(guarded).trim(), ctx); return !!t && !!readCode(tidy(guarded).trim().slice(t.length), ctx); })();
  const whole = structured ? null : headingHit(text, ctx) ?? headingHit(tidy(guarded).replace(/[,;/、。.\s]+$/, ''), ctx);
  if (whole) { result.places.push({ scope: 'this', kind: 'heading', value: whole }); return result; }
  // 材料的標題只決定連結，所以標題的子字串比對排在單元結構解析之後、只比剩下的字；長得像編號或數字的標題（`1-3`、`L1`、`44`）
  // 完全不比，它們在出處裡幾乎都是編號或頁碼，真的要連這種標題請寫連結（D-164 第 3 點）。只有本身含分隔符號的標題（`溶解, 擴散`）
  // 要在切段之前先保護起來，不然會被切開。
  const linkable = [...ctx.headings].filter(h => !SHAPE.test(fold(h)) && !/^\d+$/.test(fold(h))).sort((a, b) => b.length - a.length);
  const maskHeadings = (text, only) => {
    for (const heading of linkable.filter(only)) {
      const at = findHeading(text, heading);
      if (at) text = text.slice(0, at.start) + hold('heading', heading) + text.slice(at.end);
    }
    return text;
  };
  guarded = maskHeadings(guarded, h => /[,、;/，]/.test(h));
  const clean = zh(tidy(guarded)).replace(/[,;/、。.\s]+$/, '').trim();
  if (/^先備\s*[:：]/.test(clean)) return result;

  const ownTerm = ctx.self?.split(' ')[0] ?? null;
  const own = ownCode(ctx);
  let scope = 'this', lastKind = null, lastScope = 'this', lastTerm = null, lastClass = null, pendingTerm = null;
  const addUnit = key => {
    if (readFable.key(key) === readFable.key(ctx.self ?? '')) { scope = 'this'; return; }
    if (!result.units.includes(key)) result.units.push(key);
    scope = key;
    const code = key.split(' ').slice(1).join(' ');
    const indexed = Object.keys(ctx.units).some(each => readFable.key(each) === readFable.key(key));
    if (!indexed && !SHAPE.test(code)) hint();
  };
  const place = (kind, value, at = scope) => { result.places.push({ scope: at, kind, value }); lastKind = kind; lastScope = at; };
  const useTerm = (term, code) => {
    const keys = code.codes.map(c => `${term} ${c}`);
    for (const key of keys) addUnit(key);
    lastTerm = term; lastClass = shapeClass(code.codes[0]);
    const name = keys.length === 1 ? Object.entries(ctx.units).find(([k]) => readFable.key(k) === readFable.key(keys[0]))?.[1] ?? null : null;
    return { keys, name };
  };

  // 切段：頓號、分號、斜線是硬邊界（範圍回到本篇）；逗號是軟邊界（沿用範圍）。
  const pieces = clean.split(/([、;/,])/);
  const segments = [];
  for (let i = 0; i < pieces.length; i += 2) segments.push({ text: pieces[i].trim(), boundary: i ? BOUNDARY[pieces[i - 1]] : 'start' });

  for (const seg of segments) {
    if (!seg.text) continue;
    if (seg.boundary === 'hard') scope = 'this';
    // 一段裡，位置後面又出現年級學期加編號：從那裡切成新的一段（`p.44 國二上 1-3 p.20`）。
    const parts = splitBeforeTerm(seg.text, ctx);
    for (const part of parts) {
      let rest = part, unit = null, selfRef = false;
      const term = readTerm(part, ctx);
      if (SELF.test(part)) { scope = 'this'; selfRef = true; rest = part.replace(SELF, ''); }
      else if (term) {
        const after = part.slice(term.length);
        const code = readCode(after, ctx);
        if (code) { unit = useTerm(term.term, code); rest = code.rest; }
        else if (!after.trim() && seg.boundary !== 'hard' && segments.indexOf(seg) < segments.length - 1) { pendingTerm = term.term; continue; } // `國二上,1-3`
        else {
          // 只有年級學期（`小五上`、`國一下 p.30`）：不猜單元；別冊的位置不連到本篇。
          hint();
          rest = after.trim();
          if (term.term !== ownTerm) { const { found } = scan(rest, ctx); if (found.length) continue; }
        }
      } else {
        // 寫過年級學期之後，單獨的標準編號沿用它（`國二上 1-3、1-8`、`國二上,1-3`）；本篇自己的編號（`L3 p.30`）是本篇。
        const bare = /^([A-Za-z]*\d+(?:-\d+)*(?:\s*(?:~|到|至)\s*[A-Za-z]*\d+(?:-\d+)*)?)(?![0-9A-Za-z-])\s*(.*)$/s.exec(part);
        // 後面接著圖、表、頁的數字是位置（`2-14圖`、`20頁`），不是編號。
        const code = bare && !/^(?:圖|表|例題|頁)/.test(bare[2]) ? readCode(bare[1], ctx) : null;
        const continuation = bare && !bare[2] && ((lastKind === 'page' && /^\d+$/.test(bare[1])) || (['figure', 'table', 'example'].includes(lastKind) && /^\d+-\d+$/.test(bare[1])));
        const lesson = /^(?:第\s*(\d+)\s*課|(?:Lesson|Unit)\s+(\d+))(?![0-9])\s*(.*)$/is.exec(part);
        if (lesson && readFable.key(letterOf(ctx) + (lesson[1] ?? lesson[2])) === readFable.key(own)) { scope = 'this'; selfRef = true; rest = lesson[3]; }
        else if (code && !continuation && code.codes.length === 1 && readFable.key(code.codes[0]) === readFable.key(own)) { scope = 'this'; selfRef = true; rest = bare[2]; }
        // 沿用學期的編號要是「只有編號」或「編號加位置」：後面接著別的字（`10-15 上課筆記`、`1-8 都有`）就不沿用，提示。
        else if (code && !continuation && pendingTerm && code.codes.every(c => SHAPE.test(c))) { unit = useTerm(pendingTerm, code); rest = bare[2]; hint(); }
        else if (code && !continuation && lastTerm && seg.boundary !== 'start' && code.codes.every(c => SHAPE.test(c) && shapeClass(c) === lastClass) && (!bare[2] || scan(bare[2], ctx).left === '')) { unit = useTerm(lastTerm, code); rest = bare[2]; }
      }
      pendingTerm = null;
      // 單獨的數字接著前一個位置：p.44, 45 → p.45；圖 2-14、2-15；圖 2-13a、b。範圍跟著前一個位置。
      const r = rest.trim();
      if (!unit && !selfRef) {
        if (lastKind === 'page' && /^\d+$/.test(r)) { place('page', r, lastScope); continue; }
        if (['figure', 'table', 'example'].includes(lastKind) && /^\d+-\d+$/.test(r)) { place(lastKind, r, lastScope); continue; }
        if (lastKind === 'figure' && /^[A-Za-z]$/.test(r)) { const prev = result.places.at(-1); place('figure', prev.value.replace(/[a-z]$/, '') + r.toLowerCase(), lastScope); continue; }
      }
      // 佔位：連結與標題。標題只在單元結構解析完之後、剩下的字裡找。
      let working = maskHeadings(r, () => true);
      let held = 0, headingInText = false;
      for (const match of [...working.matchAll(/\u0001(\d+)\u0001/g)]) {
        const token = tokens[Number(match[1])];
        const link = token.kind === 'heading' ? { kind: 'heading', value: token.value } : readLink(token.value, ctx);
        // 標題跟著前面的單元走（`國一上 L1 Unit Review` 是 L1 的材料裡的標題）。
        if (link === 'hint') hint(); else if (link) { place(link.kind, link.value, scope); held++; if (token.kind === 'heading') headingInText = true; }
        working = working.replace(match[0], ' ');
      }
      const { found, left, bad, leftBefore } = scan(working, ctx);
      if (bad) hint();
      for (const each of found) place(each.kind, each.value, scope);
      const places = found.length + held;
      // 位置前面有一句話（4 個字以上的中文）、標題夾在一句話裡：可能是在講別的事，提示但位置照留。
      if (found.length && !unit && !selfRef && new RegExp(`^[${CJK}，]{4,}`).test(leftBefore)) hint();
      if (headingInText && new RegExp(`[${CJK}]{4,}`).test(left)) hint();
      if (!left) continue;
      if (unit?.name && fold(left) === fold(unit.name)) continue;
      if (/\d|^[A-Za-z]+\d|\u0001/.test(left)) hint();
      else if (unit && !places) hint();
      else if (!unit && !selfRef && !places && !result.units.length && !result.places.length) hint();
    }
  }
  if (pendingTerm) hint();
  return result;
}
readFable.key = text => tidy(text).toLowerCase().replace(/\s+/g, ' ').trim();

/** 位置後面又出現年級學期加編號時切開；前面是中文句子時不切（句子裡的學期不算）。 */
function splitBeforeTerm(text, ctx) {
  const parts = [];
  let start = 0;
  for (let i = 1; i < text.length; i++) {
    if (!/[\s)）]/.test(text[i - 1])) continue;
    const term = readTerm(text.slice(i), ctx);
    if (!term || !readCode(text.slice(i + term.length), ctx)) continue;
    const before = text.slice(start, i).trim();
    const { found, left } = scan(before.replace(/\u0001\d+\u0001/g, ' '), ctx);
    if ((found.length || /\u0001/.test(before)) && !left) { parts.push(before); start = i; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** 一個連結：筆記、本篇的標題（`[[#標題]]`），或沒關好的連結（提示）。網址當說明。 */
function readLink(raw, ctx) {
  const wiki = /^!?[\[［]{2}\s*([^\]］]*?)\s*[\]］]{2}$/.exec(raw);
  if (wiki) {
    const target = wiki[1].split(/[|｜]/)[0].trim().replace(/^＃/, '#');
    if (target.startsWith('#')) { const hit = headingHit(target.slice(1), ctx); return hit ? { kind: 'heading', value: hit } : 'hint'; }
    return { kind: 'note', value: target };
  }
  const md = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);
  if (md) return { kind: 'note', value: decodeURIComponent(md[2]).replace(/\.md$/, '') };
  return null;
}
