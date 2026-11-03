// 第二輪候選；只供比較，沒有接到產品。設計、限制與結果見 Codex 討論稿的第二輪。
// node experiments/source-reading/readers-codex.mjs --test
// 同一份結構化讀法：連結保護、明確參照、有限的並列作用域、局部否定／更正、剩餘內容診斷。
import assert from 'node:assert/strict';

const widths = text => text.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const clean = text => widths(text).replace(/[‐‑‒–—―−﹘﹣]/g, '-').replace(/[〜～]/g, '~')
  .replace(/\s+/g, ' ').replace(/(?<=\d)\s*-\s*(?=\d)/g, '-').trim();
const key = text => clean(text).toLowerCase();
const TERM = /^(小[一二三四五六]|國[一二三]|高[一二三]|[七八九](?:年級)?)\s*([上下])(?:學期|冊)?/;
const grade = value => ({ 七: '國一', 八: '國二', 九: '國三' })[value[0]] ?? value;
const PREFIX = /^(?:(?:請)?(?:參見|參考|參看|詳見|另見|請見|請看|見|看|來自|出自)|課本|講義)\s*/;
const NEGATIVE = /(?:不是|並非|不要|不用|不必|不看|不考|不算|排除|勿|略過)|\b(?:not|except|ignore|exclude)\b/i;
const RELATIVE = /(?:前一|上一|下一|前面|上個|下個)(?:課|節|章|單元)|\b(?:previous|next)\s+(?:unit|lesson|chapter)\b/i;
const family = code => /^\d+(?:-\d+)*$/.test(code) ? 'number' : /^([A-Za-z]+)\d+$/.exec(code)?.[1].toLowerCase() ?? null;
const SEP = /^[,，/／;；、\n]$/;

// 先把連結藏成不可解析的 token，檔名、錨點與別名不正規化，也不進單元搜尋。
function protect(text) {
  const notes = [];
  const masked = text.replace(/\[\[([^\]]*)\]\]/g, (_, body) => {
    const at = notes.length;
    notes.push(body.split('|')[0].trim());
    return `\uE000${at}\uE001`;
  });
  return { masked, notes };
}

function number(text) {
  if (/^\d+$/.test(text)) return String(BigInt(text));
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000 };
  if (!/^[零〇一二兩三四五六七八九十百千]+$/.test(text)) return null;
  if (![...text].some(c => units[c])) return [...text].map(c => digits[c]).join('');
  let value = 0, pending = 0;
  for (const c of text) {
    if (units[c]) { value += (pending || 1) * units[c]; pending = 0; }
    else pending = digits[c];
  }
  return String(value + pending);
}
const N = '[0-9零〇一二兩三四五六七八九十百千]+';

function readCode(text) {
  // 完整位置詞先於單元。即使位置殘缺，也不能把「圖」「第」「p」當成另一個單元。
  if (/^(?:\uE000|(?:pp?|pg|page)\s*[.。]?\s*\d|第\s*[\d一二三四五六七八九十百]|(?:圖|表|例題|範例|fig(?:ure)?\.?|table|example)\s*\d)/i.test(text)) {
    const hierarchy = new RegExp(`^第\\s*(${N})\\s*章\\s*第\\s*(${N})\\s*節(?=$|\\s|p|圖|表|例題)(.*)$`, 'is').exec(text);
    if (hierarchy) return { code: `${number(hierarchy[1])}-${number(hierarchy[2])}`, rest: hierarchy[3].trim() };
    const chapter = new RegExp(`^第\\s*(${N}(?:-${N})*)\\s*(?:章|課|節|單元)(?=$|\\s|p|圖|表|例題)(.*)$`, 'is').exec(text);
    if (chapter) return { code: chapter[1].split('-').map(number).join('-'), rest: chapter[2].trim() };
    return null;
  }
  const label = /^(?:單元|unit|lesson|chapter)\s*/i.exec(text);
  if (label) return readCode(text.slice(label[0].length));
  const match = /^(\d+(?:-\d+)*|[A-Za-z]+\s*\d+)(?=$|\s|p\s*\.?\s*\d|第|圖|表|例題|\uE000)(.*)$/is.exec(text);
  if (match) {
    const code = match[1].replace(/\s/g, ''), rest = match[2].trim();
    // 1 3 不是單元 1；不把殘缺編號的尾數再猜成頁碼。
    if (/^\d/.test(rest)) return null;
    return { code, rest };
  }
  const other = /^([^\s\uE000,;/、:()[\]{}]+)(?:\s+(.*)|$)/s.exec(text);
  return other ? { code: other[1], rest: other[2] ?? '', other: true } : null;
}

// 位置保留順序與材料範圍；反向範圍不偷偷縮成第一頁。沒有泛用的剩餘數字猜頁碼。
function positions(text, scope, notes) {
  let masked = text, hint = false;
  const found = [];
  const blank = (a, b) => { masked = masked.slice(0, a) + ' '.repeat(b - a) + masked.slice(b); };
  const add = (m, kind, value) => {
    found.push({ at: m.index, scope, kind, value }); blank(m.index, m.index + m[0].length);
  };
  for (const m of text.matchAll(/\uE000(\d+)\uE001/g)) add(m, 'note', notes[Number(m[1])]);
  const page = new RegExp(`(?<![A-Za-z0-9])(?:pp?|pg|page)\\s*[.。]?\\s*(${N})(?:\\s*[-~至到]\\s*(?:(?:pp?|pg|page)\\s*\\.?\\s*)?(${N}))?(?:\\s*頁)?(?![A-Za-z0-9-])|(?:第\\s*)?(${N})(?:\\s*[-~至到]\\s*(${N}))?\\s*頁`, 'gi');
  for (const m of [...masked.matchAll(page)]) {
    const first = number(m[1] ?? m[3]), last = m[2] ?? m[4];
    blank(m.index, m.index + m[0].length);
    if (last !== undefined && BigInt(number(last)) < BigInt(first)) { hint = true; continue; }
    // 無句點的 p53 加自由文字可能是名稱；保留為待確認，避免把基因等名詞默默當頁碼。
    const dotted = /^(?:pp?|pg|page)\s*[.。]/i.test(m[0]);
    if (!dotted && /^p\d/i.test(m[0]) && text.slice(m.index + m[0].length).trim() && !/^(?:圖|表|例題|\uE000)/.test(text.slice(m.index + m[0].length).trim())) { hint = true; continue; }
    found.push({ at: m.index, scope, kind: 'page', value: first });
  }
  for (const m of [...masked.matchAll(/(圖|表|例題|範例|fig(?:ure)?\.?|table|example)\s*(\d+)[-.](\d+)(?:\s*([A-Za-z])(?![A-Za-z0-9]))?/gi)]) {
    const label = m[1].toLowerCase();
    add(m, /^(?:圖|fig)/.test(label) ? 'figure' : /^(?:表|table)/.test(label) ? 'table' : 'example', `${m[2]}-${m[3]}${m[4]?.toLowerCase() ?? ''}`);
  }
  found.sort((a, b) => a.at - b.at);
  return { places: found.map(({ at, ...place }) => place), left: masked.replace(/\s+/g, ' ').trim(), hint };
}

function segments(text) {
  const result = [];
  let start = 0, preceding = '';
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && !SEP.test(text[i])) continue;
    const part = clean(text.slice(start, i)).replace(/[。.]+$/, '').trim();
    if (part) result.push({ text: part, hard: /[;；\n]/.test(preceding) });
    preceding = text[i] ?? ''; start = i + 1;
  }
  return result;
}

/**
 * 並列是一段有邊界的結構：相鄰同類編號可共用顯式學期；頁碼列舉可共用顯式單元。
 * 新學期即使寫壞也會中止繼承；分號／換行／自由文字也會中止。這是候選政策，並非已核准規格。
 * ctx.units 只用於名稱核對與鍵碰撞診斷，不用它來決定某個其他編號是不是參照。
 */
export function readCodex(text, ctx) {
  const result = { units: [], places: [], hint: false };
  const protectedText = protect(text);
  // 舊標題含逗號時仍可整體查找，但不能搶在明確參照之前改變語義。
  const whole = clean(protectedText.masked);
  const structured = /(?:小[一二三四五六]|國[一二三]|高[一二三]|[七八九](?:年級)?)[上下]|\uE000|\b(?:pp?|pg|page)\s*[.。]?\s*\d|(?:圖|表|例題|範例)\s*\d|\d\s*頁/i.test(whole);
  const headings = ctx.headings.filter(h => h === text || clean(h) === whole);
  if (!structured && headings.length === 1) return { units: [], places: [{ scope: 'this', kind: 'heading', value: headings[0] }], hint: false };
  if (!structured && headings.length > 1) return { units: [], places: [], hint: true };
  let scope = 'this', frame = null, last = null, afterNegative = false;
  const put = place => {
    if (!result.places.some(p => p.scope === place.scope && p.kind === place.kind && p.value === place.value)) result.places.push(place);
  };
  for (const part of segments(protectedText.masked)) {
    if (part.hard) { scope = 'this'; frame = null; last = null; }
    let body = part.text, unit = null, name = null;
    if (/^先備\s*[:：]/.test(body)) { scope = 'this'; frame = null; last = null; continue; }
    const correction = /(?:而是|改成|更正為|應為)\s*/.exec(body);
    if (correction) body = body.slice(correction.index + correction[0].length);
    if (NEGATIVE.test(body)) { afterNegative = true; scope = 'this'; frame = null; last = null; continue; }
    if (afterNegative) { body = body.replace(/^是\s*/, ''); afterNegative = false; }
    if (RELATIVE.test(body)) { result.hint = true; scope = null; frame = null; last = null; continue; }
    body = body.replace(new RegExp(`^${ctx.subject}\\s*`), '').replace(PREFIX, '').replace(new RegExp(`^${ctx.subject}\\s*`), '');
    // 明確肯定句才允許前置說明，不全文找所有學期；無法判定語氣時留下診斷。
    const affirmation = /^(?:這題|本題|這個目標|這張卡)\s*(?:在)?\s*(.+?)\s*(?:也有教|有教|也講過|講過|也提過|提到)(.*)$/s.exec(body);
    if (affirmation) body = affirmation[1] + ' ' + affirmation[2];
    const term = TERM.exec(body);
    if (term) {
      scope = null; frame = null; last = null;
      const after = body.slice(term[0].length);
      if (!/^(?:$|\s|[0-9A-Za-z第]|單元)/.test(after)) { result.hint = true; continue; }
      const code = readCode(after.trim().replace(new RegExp(`^${ctx.subject}\\s*`), ''));
      if (!code) { result.hint = true; continue; }
      unit = `${grade(term[1])}${term[2]} ${code.code}`;
      body = code.rest;
      frame = { term: grade(term[1]) + term[2], family: family(code.code) };
    } else if (frame && frame.family && !(last?.kind === 'page' && /^\d+$/.test(body))) {
      const code = readCode(body);
      if (code && !code.other && family(code.code) === frame.family) {
        unit = `${frame.term} ${code.code}`; body = code.rest;
      } else if (code && !code.other && family(code.code) !== frame.family) {
        result.hint = true; scope = null; frame = null; last = null; continue;
      }
    }
    if (unit) {
      const matches = Object.keys(ctx.units).filter(k => key(k) === key(unit));
      if (matches.length > 1) { result.hint = true; scope = null; frame = null; last = null; continue; }
      const exact = matches[0];
      name = exact ? ctx.units[exact] : null;
      scope = key(unit) === key(ctx.self) ? 'this' : unit;
      if (scope !== 'this' && !result.units.some(u => key(u) === key(unit))) result.units.push(unit);
    }
    // 縮寫只承接緊鄰且明確的同類位置，不能越過說明或殘缺的單元。
    if (!unit && last && /^\d+$/.test(body) && last.kind === 'page' && scope !== null) {
      last = { scope, kind: 'page', value: String(BigInt(body)) }; put(last); continue;
    }
    if (!unit && last && /^\d+-\d+$/.test(body) && ['figure', 'table', 'example'].includes(last.kind) && scope !== null) {
      last = { scope, kind: last.kind, value: body }; put(last); continue;
    }
    if (scope === null) { result.hint = true; continue; }
    // 有明確外單元時，標題位置也留在外單元；本篇標題不能反過來抹掉單元關係。
    const exactHeading = scope === 'this' ? ctx.headings.find(h => h === body || clean(h) === body) : null;
    if (exactHeading && !unit) { put({ scope, kind: 'heading', value: exactHeading }); frame = null; last = null; continue; }
    const parsed = positions(body, scope, protectedText.notes);
    result.hint ||= parsed.hint;
    for (const place of parsed.places) { put(place); last = place; }
    const left = parsed.left.replace(/^[\s:：()]+|[\s:：()]+$/g, '');
    if (!left || left === name) continue;
    if (unit && !parsed.places.length && !/[\d]|(?:小[一二三四五六]|國[一二三]|高[一二三])[上下]/.test(left)) {
      put({ scope, kind: 'heading', value: left }); last = null; continue;
    }
    if (!parsed.places.length || /\d|(?:小[一二三四五六]|國[一二三]|高[一二三])[上下]/.test(left)) result.hint = true;
    // 無結構的插話打斷並列，不延續上一個頁碼或學期。
    if (!unit) { frame = null; last = null; scope = 'this'; }
  }
  return result;
}
readCodex.key = key;

// 固定預期值在看 exam-1 前寫；這是候選的自編規格，不宣稱等於現行 D-164／D-165。
if (import.meta.main && process.argv.includes('--test')) {
  const ctx = { subject: '自然', self: '國二上 2-2', units: { '國二上 1-3': '', '國二上 2-1': '水溶液' }, headings: ['溶解, 擴散'] };
  const page = (scope, value) => ({ scope, kind: 'page', value });
  const cases = [
    ['國二上 第1章第3節 p.20', ['國二上 1-3'], [page('國二上 1-3', '20')], false],
    ['國二上 1 - 3 p.20', ['國二上 1-3'], [page('國二上 1-3', '20')], false],
    ['國二上 1 3 p.20', [], [], true],
    ['國二上 1-3 p.44, p.45', ['國二上 1-3'], [page('國二上 1-3', '44'), page('國二上 1-3', '45')], false],
    ['國二上 1-3 p.44, 45', ['國二上 1-3'], [page('國二上 1-3', '44'), page('國二上 1-3', '45')], false],
    ['國二上 1-3 p.44；p.45', ['國二上 1-3'], [page('國二上 1-3', '44'), page('this', '45')], false],
    ['國二上 1-3 p.44, 國一下 p.15', ['國二上 1-3'], [page('國二上 1-3', '44')], true],
    ['國二上 L1, L2 p.20', ['國二上 L1', '國二上 L2'], [page('國二上 L2', '20')], false],
    ['國二上 L1, 國三下, L2 p.20', ['國二上 L1'], [], true],
    ['國二上 L1, A1 p.20', ['國二上 L1'], [], true],
    ['不是 p.44，是 p.46', [], [page('this', '46')], false],
    ['國二上 1-3 不考', [], [], false],
    ['國二上 1-3 改成 國一下 3-1 p.20', ['國一下 3-1'], [page('國一下 3-1', '20')], false],
    ['前一課 p.20', [], [], true],
    ['p.999-1', [], [], true],
    ['[[Ａ卷#２-１]]', [], [{ scope: 'this', kind: 'note', value: 'Ａ卷#２-１' }], false],
    ['國二上 1-3 [[筆記]]', ['國二上 1-3'], [{ scope: '國二上 1-3', kind: 'note', value: '筆記' }], false],
    ['國二上 圖 2-14', [], [], true],
    ['第四十四頁', [], [page('this', '44')], false],
    ['溶解, 擴散', [], [{ scope: 'this', kind: 'heading', value: '溶解, 擴散' }], false],
  ];
  for (const [text, units, places, hint] of cases) assert.deepEqual(readCodex(text, ctx), { units, places, hint }, text);
  const text = '國二上 1-3 p.20';
  assert.deepEqual(readCodex(text, ctx), readCodex(text, { ...ctx, headings: [...ctx.headings, text] }));
  const unknown = '國二上 Extension p.20';
  assert.deepEqual(readCodex(unknown, ctx).units, readCodex(unknown, { ...ctx, units: { ...ctx.units, '國二上 Extension': '' } }).units);
  const collision = { ...ctx, units: { '國二上 L1': '', '國二上 l1': '' } };
  const reversed = { ...collision, units: Object.fromEntries(Object.entries(collision.units).reverse()) };
  assert.deepEqual(readCodex('國二上 Ｌ１ p.20', collision), { units: [], places: [], hint: true });
  assert.deepEqual(readCodex('國二上 Ｌ１ p.20', collision), readCodex('國二上 Ｌ１ p.20', reversed));
  console.log(`Codex 候選：${cases.length} 個字面預期＋4 個材料／索引與碰撞斷言通過`);
}
