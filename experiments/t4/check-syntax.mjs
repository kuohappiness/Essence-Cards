// 依 docs/syntax.md 檢查 AI 製卡交回的草稿，列出不符合的地方：
// §2-2 兩條規則、§2-3 名稱與 ID、§2-4 資料欄位、§2-5 出處、§2-6 題目、§2-9 草稿格式，加上製卡規則裡程式量得到的上限。
// 用法：node check-syntax.mjs <卡片.md>… [--transcript <轉錄稿.md>] [--unit 2-2] [--subject 自然] [--tree]
//       node check-syntax.mjs --selftest
// 分三級：錯誤＝程式會跳過那個學習目標或連結壞掉（§2-10）；不符＝程式讀得懂，但違反語法或製卡規則；提醒＝啟發式，要人看。
// 只讀檔，不改任何東西。
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { languageStats } from './report.mjs';

const FIELDS = ['出處', '類型', '重要性', '狀態', '備註', '錯題補強'];
const TYPES = { 自然: ['定義', '因果', '比較', '順序', '實驗', '公式與單位', '圖表'], 一般知識: ['定義', '因果', '比較', '步驟', '判斷與應用', '數值與標準'] };
const UNDERSTANDING = ['因果', '比較', '實驗', '判斷與應用']; // 自然預設規則 1；理解題的答案要有粗體重點（D-068）；判斷與應用是一般知識的
const ID = /^[a-hjkmnp-z2-9]{6}$/; // 6 碼，去掉 0、o、1、l、i
const NOTE_KINDS = [/說法|不一致|簡化|衝突|一般認知|矛盾/, /另外練習|練習/, /印錯|誤植|可能有誤|錯字/];

// 行內程式碼與公式裡的 `::`、`==` 不算（D-089 第 2 條）：換成等長的占位字元，位置不變。
const mask = s => s.replace(/`[^`]*`|\$\$.*?\$\$|\$[^$\n]+\$/g, m => '\u0001'.repeat(m.length));
const isQuestion = s => mask(s).includes('::') || /==[^=\n]+==/.test(mask(s));
const expand = s => { let out = '', col = 0; for (const ch of s) { if (ch === '\t') { const n = 4 - (col % 4); out += ' '.repeat(n); col += n; } else { out += ch; col++; } } return out; };
const images = s => [...s.matchAll(/!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)].map(m => m[1].trim());
const bolds = s => [...s.matchAll(/\*\*([^*\n]+)\*\*/g)].map(m => m[1]);

// 把幾行文字切成區塊：標題、引言框、程式碼、清單項目、接續行、段落、空行。lines 是 [{ no, raw }]。
function blocksOf(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const { no, raw } = lines[i];
    if (/^\s{0,3}(```|~~~)/.test(raw)) {
      while (i + 1 < lines.length && !/^\s{0,3}(```|~~~)/.test(lines[i + 1].raw)) i++;
      i++; blocks.push({ kind: 'code', line: no }); continue;
    }
    if (/^\s{0,3}>/.test(raw)) {
      const body = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i].raw)) body.push(lines[i++]);
      i--; blocks.push({ kind: 'callout', line: no, body }); continue;
    }
    if (!raw.trim()) { blocks.push({ kind: 'blank', line: no }); continue; }
    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) { blocks.push({ kind: 'heading', line: no, level: heading[1].length, text: heading[2] }); continue; }
    const line = expand(raw), item = line.match(/^( *)([-*+]|\d+[.)])( +|$)(.*)$/);
    if (item) {
      const gap = item[3].length >= 1 && item[3].length <= 4 ? item[3].length : 1;
      blocks.push({ kind: 'item', line: no, col: item[1].length, contentCol: item[1].length + item[2].length + gap, marker: item[2], text: item[4].trimEnd() });
      continue;
    }
    const previous = blocks.findLast(b => b.kind !== 'blank'), lastItem = blocks.findLast(b => b.kind === 'item');
    const directlyAfter = blocks.at(-1) && ['item', 'cont'].includes(blocks.at(-1).kind);
    const indentedUnder = lastItem && previous && ['item', 'cont'].includes(previous.kind) && line.match(/^ */)[0].length >= lastItem.contentCol;
    blocks.push({ kind: directlyAfter || indentedUnder ? 'cont' : 'para', line: no, text: raw.trim() });
  }
  return blocks;
}

// 清單的上下層：子項目要縮排到上一層文字開始的位置（CommonMark，Obsidian 也照這個解析，D-089 第 6 條）。
function treeOf(blocks) {
  const roots = [], stack = [];
  for (const block of blocks) {
    if (block.kind === 'item') {
      while (stack.length && stack.at(-1).contentCol > block.col) stack.pop();
      const node = { ...block, children: [], cont: [] };
      (stack.length ? stack.at(-1).children : roots).push(node);
      stack.push(node);
    } else if (block.kind === 'cont') { if (stack.length) stack.at(-1).cont.push(block); }
    else if (block.kind !== 'blank') stack.length = 0;
  }
  return roots;
}

export function check(text, options = {}) {
  const subject = options.subject ?? '自然', unit = options.unit ?? null, transcript = options.transcript ?? null;
  const issues = [], issue = (line, level, code, msg) => issues.push({ line, level, code, msg });
  const all = text.replace(/^﻿/, '').split(/\r?\n/).map((raw, i) => ({ no: i + 1, raw }));
  const source = transcript ? {
    anchors: new Set([...transcript.matchAll(/\^([A-Za-z0-9-]+)\s*$/gm)].map(m => m[1])),
    headings: [...transcript.matchAll(/^#{1,6}\s+(.*?)\s*$/gm)].map(m => m[1]),
    images: new Set(images(transcript)),
    captions: [...transcript.matchAll(/^\*(.+)\*\s+\^[A-Za-z0-9-]+\s*$/gm)].map(m => m[1].trim()),
    pages: [...transcript.matchAll(/^p\.\d+ \^p\d+\s*$/gm)].length
  } : null;
  const result = { targets: [], candidates: [], existing: [], notes: [], headings: [] };

  let start = 0;
  if (all[0]?.raw.trim() === '---') {
    issue(1, '不符', 'yaml', 'AI 不寫卡組屬性，外掛會補上（§2-9）');
    start = all.findIndex((l, i) => i > 0 && l.raw.trim() === '---') + 1 || all.length;
  }

  function checkSource(value, line) {
    if (value.includes('|')) issue(line, '不符', 'half-pipe', '欄位之間用全形「｜」分隔（§0）');
    for (const piece of value.split('、')) {
      const item = piece.trim();
      if (!item) { issue(line, '不符', 'source-empty', '出處有空的項目'); continue; }
      if (/第.{1,3}段/.test(item)) issue(line, '不符', 'source-paragraph', `出處不寫「第幾段」（§2-5）：${item}`);
      const unitMatch = item.match(/^((?:國[一二三][上下]\s*)?(?:\d+-\d+|L\d+))(?:\s+|$)(.*)$/);
      const rest = unitMatch ? unitMatch[2] : item;
      if (unitMatch && unit && unitMatch[1] !== unit) { issue(line, '提醒', 'source-cross-unit', `跨單元的出處，要人確認：${item}`); continue; }
      if (!rest) continue; // 只寫單元
      let anchor = null, m;
      if ((m = rest.match(/^p\.\s?(\d+)/))) anchor = `p${m[1]}`;
      else if ((m = rest.match(/^(圖|表|例題)\s?(\d+-\d+)(?:\s?([A-Za-z])(?![A-Za-z0-9-]))?/))) anchor = { 圖: 'fig', 表: 'tab', 例題: 'ex' }[m[1]] + m[2] + (m[3] ?? '').toLowerCase();
      else if (/^\[\[[^\]]+\]\]/.test(rest) || /^先備\s*[：:]/.test(rest)) continue;
      else if (source && !source.headings.some(h => h === rest || h.endsWith(' ' + rest))) { issue(line, '不符', 'source-unknown', `出處認不得，程式只會照文字顯示：${item}`); continue; }
      if (!anchor || !source || source.anchors.has(anchor)) continue;
      // 只寫「圖 2-13」、轉錄稿卻分成子圖時，連到第一張子圖（§2-5、D-094）。
      if (anchor.startsWith('fig') && [...source.anchors].some(a => a.startsWith(anchor) && /^[a-z]$/.test(a.slice(anchor.length)))) continue;
      issue(line, '不符', 'source-unresolved', `出處找不到錨點 ^${anchor}：${item}`);
    }
  }

  function parseData(node, target) {
    for (const segment of node.text.split('｜')) {
      const m = segment.match(/^\s*([^：:]+?)\s*([：:])\s*(.*?)\s*$/);
      if (!m) { issue(node.line, '不符', 'data-segment', `資料裡的「${segment.trim()}」不是「欄位：值」`); continue; }
      const [, name, colon, value] = m;
      if (colon === ':') issue(node.line, '不符', 'half-colon', `「${name}:」用了半形冒號；AI 寫全形「：」（§0）`);
      if (!FIELDS.includes(name)) { issue(node.line, '不符', 'field-unknown', `「${name}」不是資料欄位，程式只認 6 個（§2-4）`); continue; }
      if (target.data[name] !== undefined) issue(node.line, '提醒', 'field-twice', `「${name}」寫了兩次（§2-4）`);
      target.data[name] = value;
      if (name === '出處') checkSource(value, node.line);
      else if (name === '類型' && TYPES[subject] && !TYPES[subject].includes(value)) issue(node.line, '不符', 'type-unknown', `類型「${value}」不在${subject}預設的知識類型裡`);
      else if (name === '重要性' && value === '中') issue(node.line, '不符', 'default-written', '重要性的預設值「中」不寫出來（§2-4）');
      else if (name === '重要性' && !['高', '低'].includes(value)) issue(node.line, '不符', 'value-unknown', `重要性「${value}」認不得（§2-4）`);
      else if (name === '狀態') issue(node.line, '不符', 'ai-field', '狀態由家長決定，AI 不寫');
      else if (name === '備註') issue(node.line, '不符', 'ai-field', '備註是家長寫的（D-063），AI 不寫');
      else if (name === '錯題補強') issue(node.line, '不符', 'ai-field', '錯題補強是採用錯題本時外掛加的，製卡不寫');
    }
  }

  function checkImageLines(node, where) {
    for (const name of images(node.text)) if (source && !source.images.has(name)) issue(node.line, '錯誤', 'image-missing', `轉錄稿沒有這張圖，連結會壞掉：${name}`);
    if (where === 'answer' && images(node.text).length) issue(node.line, '不符', 'image-in-answer', '幫助記憶的圖放在題目底下，不放在答案那一行（§2-6）');
    if (where === 'shared' && images(node.text).length) issue(node.line, '提醒', 'image-shared', '圖放在學習目標底下，每一題都會顯示；要確認不是某一題專用');
    for (const child of node.children ?? []) checkImageLines(child, where === 'answer' ? 'support' : where);
  }

  function analyzeQuestion(node) {
    const q = { line: node.line, raw: node.text, supplements: [] };
    const masked = mask(node.text), at = masked.indexOf('::');
    if (at >= 0) {
      q.kind = 'qa';
      const before = node.text.slice(0, at), after = node.text.slice(at + 2);
      q.front = before.trim(); q.back = after.trim();
      if (masked.indexOf('::', at + 2) >= 0) issue(node.line, '不符', 'double-colon', '一行有兩個 `::`');
      if (!(before.endsWith(' ') && !before.endsWith('  ') && (after === '' || (after.startsWith(' ') && !after.startsWith('  ')))))
        issue(node.line, '不符', 'colon-space', 'AI 一律寫成「 :: 」（§2-6、D-089 第 1 條）');
      if (!q.front) issue(node.line, '錯誤', 'no-front', '`::` 左邊沒有題目，程式會跳過這個學習目標（§2-10）');
      if (/==[^=\n]+==/.test(mask(node.text))) issue(node.line, '提醒', 'highlight', '同一行有 `::` 又有 `==`：`==` 只是螢光筆，不是填空（D-089 第 3 條）');
      if (!q.back) {
        const answers = node.children.filter(c => classify(c.text) !== 'data');
        if (!answers.length) issue(node.line, '錯誤', 'no-answer', '`題目 ::` 底下沒有答案，程式會跳過這個學習目標（§2-10）');
        q.multi = true; q.back = answers.map(c => c.text).join('\n');
        for (const answer of answers) checkImageLines(answer, 'answer');
      } else {
        q.supplements = node.children;
        checkImageLines({ line: node.line, text: q.back }, 'answer');
        for (const child of node.children) checkImageLines(child, 'support');
      }
      for (const name of images(q.front)) if (source && !source.images.has(name)) issue(node.line, '錯誤', 'image-missing', `轉錄稿沒有這張圖，連結會壞掉：${name}`);
      if (images(q.front).length) issue(node.line, '提醒', 'image-front', '圖放在題目那一行，作答前就看得到：確認題目問的就是這張圖，而且圖上的字不會透露答案（§2-6）');
    } else {
      q.kind = 'cloze';
      const blanks = [...masked.matchAll(/==([^=\n]*)==/g)];
      if (blanks.some(b => !b[1].trim())) issue(node.line, '錯誤', 'empty-blank', '填空的 `====` 裡沒有字');
      q.front = node.text.replace(/==[^=\n]*==/g, '［＿］'); q.back = blanks.map(b => b[1]).join('、');
      q.supplements = node.children;
      checkImageLines(node, 'support');
    }
    if (/嗎[？?]\s*$|對不對|是不是|是否/.test(q.front)) issue(node.line, '提醒', 'yes-no', '可能是是非題（通用規則 10）');
    // 「哪一杯加入較多黑糖，濃度比較大？」沒有「就」、或條件寫在前面（「一杯溶的糖比較多，哪一杯濃度比較大？」）也一樣洩漏（T4 第七、八輪）。
    if (/哪一[^，,；;？?]*[，,；;][^？?]*就[^？?]*[？?]|哪一[^，,；;？?]*(較|多|少)[^，,；;？?]*[，,；;][^？?]*(比較|較)[^？?]*[？?]|(較|比較)(多|少)[^？?]*[，,；;][^？?]*哪一[^？?]*(比較|較)[^？?]*[？?]/.test(q.front)) issue(node.line, '提醒', 'leak-pattern', '「哪一個……，……就比較……？」常把答案寫進題目（通用規則 10）');
    // 「……？為什麼？」是一題理解題；其他一行問兩個問題的，要拆開（通用規則 8）。
    if ((q.front.match(/[？?]/g) ?? []).length >= 2 && !/[？?]\s*為什麼[？?]\s*$/.test(q.front)) issue(node.line, '提醒', 'two-questions', '一題問了兩件事（通用規則 8）');
    if (/下列/.test(q.front)) issue(node.line, '提醒', 'which-of', '「下列何者」題需要選項才能作答（通用規則 10）');
    if (/如上|上述|上圖|下圖/.test(q.front) && !images(q.front).length) issue(node.line, '提醒', 'context', '題目依賴上下文（通用規則 9）');
    return q;
  }

  function classify(text) {
    if (isQuestion(text)) return 'question';
    const m = text.match(/^([^\s：:｜]+)\s*[：:]/);
    return m && FIELDS.includes(m[1]) ? 'data' : 'supplement';
  }

  function analyzeTarget(node, where) {
    const target = { line: node.line, name: node.text, data: {}, questions: [], shared: [], where };
    let children = node.children;
    if (where === 'candidate') {
      if (!children[0] || !/^理由\s*[：:]/.test(children[0].text)) issue(node.line, '不符', 'candidate-reason', '候選卡片的第一行要是一句「理由：」（§2-9）');
      else { target.reason = children[0].text.replace(/^理由\s*[：:]\s*/, ''); children = children.slice(1); }
    }
    if (where === 'existing') {
      const m = node.text.match(/^(\S+)\s+(.*)$/);
      if (!m || !ID.test(m[1])) issue(node.line, '不符', 'existing-id', '「加進已有的學習目標」每一項以已有的 6 碼 ID 開頭（§2-9）');
      else { target.id = m[1]; target.name = m[2]; }
    } else if (/\s\^[A-Za-z0-9-]+\s*$/.test(node.text)) issue(node.line, '不符', 'target-id', 'AI 不寫學習目標 ID（§2-9）');
    if (isQuestion(node.text)) issue(node.line, '不符', 'top-question', '最上層直接寫了題目，程式會自己補一個學習目標；AI 要先寫名稱（§2-3）');
    else if (where !== 'existing' && !target.name.startsWith('能')) issue(node.line, '不符', 'target-name', '學業的學習目標名稱寫成「能……」（§2-3）');
    for (const c of node.cont) issue(c.line, '提醒', 'continuation', '這一行沒有清單符號，會接在上一項的文字後面');
    let dataLines = 0;
    children.forEach((child, index) => {
      for (const c of child.cont) issue(c.line, '提醒', 'continuation', '這一行沒有清單符號，會接在上一項的文字後面');
      const kind = classify(child.text);
      if (kind === 'question') target.questions.push(analyzeQuestion(child));
      else if (kind === 'data') {
        if (index !== 0 || ++dataLines > 1) issue(child.line, '不符', 'data-position', 'AI 把資料寫成一行，緊接在學習目標下面（§2-4）');
        parseData(child, target);
      } else {
        target.shared.push(child);
        const name = child.text.match(/^([^\s：:]{1,6})[：:]/)?.[1];
        if (name && !['記憶錨點', '例句'].includes(name)) issue(child.line, '提醒', 'shared-label', `「${name}：」不是資料欄位，會當成每一題共用的背面補充（§2-4）`);
        checkImageLines(child, 'shared');
      }
    });
    if (!target.questions.length) issue(node.line, '不符', 'no-question', '學習目標底下沒有題目，程式會當成一般筆記（§2-2）');
    if (where !== 'existing' && target.questions.length > 3) issue(node.line, '不符', 'too-many-questions', `${target.questions.length} 題；初次製卡基本題之外最多 2 題（通用規則 6）`);
    if (where !== 'existing' && !target.data['出處']) issue(node.line, '不符', 'no-source', '沒有出處（通用規則 13）');
    if (UNDERSTANDING.includes(target.data['類型'])) for (const q of target.questions.filter(q => q.kind === 'qa')) {
      // 只有一個詞的短答案（例如「飽和溶液」）整個就是重點，不要求粗體。
      const n = bolds(q.back).length, short = q.back.length <= 10 && !/[，；、,;]/.test(q.back);
      if (n === 0 && !short) issue(q.line, '不符', 'no-bold', `理解題（${target.data['類型']}）的答案沒有粗體重點（D-068）`);
      if (n > 3) issue(q.line, '不符', 'bold-count', `理解題的答案有 ${n} 個粗體重點，上限 3 個（D-068）`);
    }
    return target;
  }

  // 最上層的區塊依序走一遍，順便檢查順序：備註 → 學習目標 → 加進已有 → 候選。
  const blocks = blocksOf(all.slice(start));
  const order = [];
  for (const block of blocks) {
    if (block.kind === 'callout') {
      const head = block.body[0].raw.match(/^\s{0,3}>\s?\[!([^\]]+)\]([-+]?)\s*(.*?)\s*$/);
      for (const l of block.body) if (!/^\s{0,3}>( |$)/.test(l.raw)) issue(l.no, '不符', 'callout-prefix', '引言框裡的每一行以「> 」開頭');
      const inner = block.body.slice(1).map(l => ({ no: l.no, raw: l.raw.replace(/^\s{0,3}> ?/, '') }));
      const title = head?.[3] ?? '';
      const roots = treeOf(blocksOf(inner));
      if (/^給(家長|學習者)的備註$/.test(title)) {
        order.push({ kind: 'note', line: block.line });
        if (head[2] === '-') issue(block.line, '不符', 'note-folded', '給家長的備註不摺起');
        for (const item of roots) {
          result.notes.push(item.text);
          if (!NOTE_KINDS.some(k => k.test(item.text))) issue(item.line, '不符', 'note-kind', `給家長的備註只寫三種事：說法不一致、建議另外練習的計算題、課本可能印錯（§2-9）：${item.text.slice(0, 40)}`);
          if (/圖/.test(item.text) && /附|放/.test(item.text)) issue(item.line, '不符', 'note-image', '能直接做好的事（附圖）不寫進備註');
        }
        if (!roots.length) issue(block.line, '不符', 'note-empty', '沒有備註時整段省略');
      } else if (title === '加進已有的學習目標') {
        order.push({ kind: 'existing', line: block.line });
        for (const node of roots) result.existing.push(analyzeTarget(node, 'existing'));
        issue(block.line, '提醒', 'existing-present', `「加進已有的學習目標」有 ${roots.length} 項：確認輸入真的給了這些已有的學習目標`);
      } else if (title === '候選卡片') {
        order.push({ kind: 'candidate', line: block.line });
        if (head[2] !== '-') issue(block.line, '不符', 'candidate-folded', '候選卡片預設摺起，寫成 `> [!note]- 候選卡片`（§2-9）');
        for (const node of roots) result.candidates.push(analyzeTarget(node, 'candidate'));
        if (roots.length > 5) issue(block.line, '不符', 'candidate-count', `候選卡片 ${roots.length} 個，最多 5 個（§2-9）`);
        if (!roots.length) issue(block.line, '不符', 'candidate-empty', '沒有候選時整段省略');
      } else { order.push({ kind: 'other', line: block.line }); issue(block.line, '不符', 'callout-unknown', `不認得的引言框「${title || block.body[0].raw.trim()}」；不要加其他段落`); }
    } else if (block.kind === 'heading') {
      order.push({ kind: 'body', line: block.line });
      result.headings.push(block.text);
      if (block.level !== 2 && block.level !== 3) issue(block.line, '提醒', 'heading-level', `標題用了 ${'#'.repeat(block.level)}；照課本的層級，最上層用 ##（D-094）`);
      if (source && !source.headings.some(h => h === block.text || h.includes(block.text) || block.text.includes(h))) issue(block.line, '提醒', 'heading-unknown', `轉錄稿沒有這個小標題：${block.text}`);
    } else if (block.kind === 'item') order.push({ kind: 'body', line: block.line });
    else if (block.kind === 'para') { order.push({ kind: 'para', line: block.line }); issue(block.line, '不符', 'para', `多出的段落（開場白、結語或說明）：${block.text.slice(0, 30)}`); }
    else if (block.kind === 'code') issue(block.line, '不符', 'code', '不要用程式碼區塊包住輸出');
  }
  const kinds = order.filter(o => o.kind !== 'para').map(o => o.kind);
  const at = (k, f) => order.filter(o => o.kind === k).map(o => o.line).forEach(f);
  at('note', line => { if (kinds[0] !== 'note' || kinds.filter(k => k === 'note').length > 1 || order.find(o => o.kind === 'note').line !== line) issue(line, '不符', 'note-position', '給家長的備註只有一段，放在最上面（§2-9）'); });
  at('candidate', line => { if (kinds.at(-1) !== 'candidate' || kinds.filter(k => k === 'candidate').length > 1) issue(line, '不符', 'candidate-position', '候選卡片只有一段，放在最後（§2-9）'); });
  at('existing', line => { const i = order.findIndex(o => o.line === line); if (order.slice(i + 1).some(o => o.kind === 'body' || o.kind === 'note')) issue(line, '不符', 'existing-position', '「加進已有的學習目標」放在學習目標之後、候選卡片之前（§2-9）'); });

  // 本文的學習目標
  for (const node of treeOf(blocks)) {
    const target = analyzeTarget(node, 'body');
    target.heading = blocks.findLast(b => b.kind === 'heading' && b.line < node.line)?.text ?? null;
    if (!target.heading) issue(node.line, '提醒', 'no-heading', '學習目標前面沒有小標題（用課本的小標題 ## 分組）');
    result.targets.push(target);
  }

  // 圖說：只放圖檔，不放圖說（§2-6）
  for (const { no, raw } of all.slice(start)) {
    const body = raw.replace(/^\s{0,3}>\s?/, '').trim().replace(/^([-*+]|\d+[.)])\s+/, '');
    if (/^\*[^*].*[^*]\*$/.test(body) || /^_[^_].*_$/.test(body)) issue(no, '不符', 'caption', '只放圖檔，不放圖說（§2-6）');
    else if (source) for (const caption of source.captions) if (caption.length > 8 && raw.includes(caption)) issue(no, '不符', 'caption', '只放圖檔，不放圖說（§2-6）');
  }

  // 數量與比例
  const n = result.targets.length;
  if (source?.pages && n > source.pages * 6) issue(1, '不符', 'too-many-targets', `學習目標 ${n} 個，超過每頁約 6 個（${source.pages} 頁）（通用規則 5）`);
  const understanding = result.targets.filter(t => UNDERSTANDING.includes(t.data['類型'])).length;
  if (subject === '自然' && n && understanding * 3 < n) issue(1, '不符', 'understanding-ratio', `理解型目標 ${understanding}/${n}，少於三分之一（自然預設規則 1）`);
  const language = languageStats(text);
  if (language.simplified) issue(1, '不符', 'simplified', `有 ${language.simplified} 個常見簡體字形`);
  for (const [term, count] of Object.entries(language.terms)) if (count) issue(1, '不符', 'mainland-term', `大陸用語「${term}」${count} 次`);

  result.issues = issues.sort((a, b) => a.line - b.line);
  result.stats = {
    targets: n, understanding,
    questions: result.targets.reduce((s, t) => s + t.questions.length, 0),
    images: result.targets.reduce((s, t) => s + images(JSON.stringify(t.questions.map(q => [q.raw, q.supplements.map(x => x.text)]))).length, 0),
    candidates: result.candidates.length, notes: result.notes.length, existing: result.existing.length
  };
  return result;
}

function tree(result) {
  const lines = [];
  const show = (t, mark) => {
    const data = Object.entries(t.data).map(([k, v]) => k === '出處' ? v : v).join('｜');
    lines.push(`${mark} ${t.name}${data ? `　〔${data}〕` : ''}${t.reason ? `\n   理由：${t.reason}` : ''}`);
    t.questions.forEach((q, i) => {
      lines.push(`   ${i === 0 ? '基本' : '進階'}｜正面：${q.front}`, `       背面：${q.back.replace(/\n/g, ' ／ ')}`);
      for (const s of q.supplements) lines.push(`       補充：${s.text}`);
    });
    for (const s of t.shared) lines.push(`   共用補充：${s.text}`);
  };
  if (result.notes.length) lines.push('【給家長的備註】', ...result.notes.map(n => `・${n}`), '');
  let heading;
  for (const t of result.targets) { if (t.heading !== heading) { heading = t.heading; lines.push(`## ${heading ?? '（沒有小標題）'}`); } show(t, '◆'); }
  if (result.existing.length) { lines.push('', '【加進已有的學習目標】'); for (const t of result.existing) show(t, '＋'); }
  if (result.candidates.length) { lines.push('', '【候選卡片】'); for (const t of result.candidates) show(t, '◇'); }
  return lines.join('\n');
}

function format(file, result) {
  const s = result.stats, count = level => result.issues.filter(i => i.level === level).length;
  const out = [`# 語法檢查：${path.basename(file)}`, '',
    `- 學習目標 ${s.targets}（理解型 ${s.understanding}）｜題目 ${s.questions}｜附圖 ${s.images}｜候選卡片 ${s.candidates}｜給家長的備註 ${s.notes} 項｜加進已有 ${s.existing}`,
    `- 錯誤 ${count('錯誤')}｜不符 ${count('不符')}｜提醒 ${count('提醒')}`];
  for (const level of ['錯誤', '不符', '提醒']) {
    const list = result.issues.filter(i => i.level === level);
    if (list.length) out.push('', `## ${level}`, ...list.map(i => `- 第 ${i.line} 行〔${i.code}〕${i.msg}`));
  }
  return out.join('\n');
}

async function selftest() {
  const transcript = 'p.44 ^p44\n\n## 2 擴散現象\n\n![[國二上自然 2-2 圖2-14.png]]\n*圖 2-14 黑糖在水中慢慢散開* ^fig2-14\n\np.45 ^p45\n\n**例題 2-3** ^ex2-3\n';
  const good = `> [!note] 給家長的備註
> - 例題 2-3 的濃度計算不適合做成卡，建議讓孩子做習作練習

## 2 擴散現象

- 能用粒子運動說明擴散現象
    - 出處：p.44、圖 2-14｜類型：因果｜重要性：高
    - 黑糖放進水裡，不攪拌也會慢慢變甜，為什麼？ :: 粒子**不停運動**，糖從**濃度高**的地方散到**濃度低**的地方
        - ![[國二上自然 2-2 圖2-14.png]]
- 能說出影響溶解快慢的因素
	- 出處：p.45｜類型：因果
	- 水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快

> [!note]- 候選卡片
> - 能說明溫度對溶解度的影響
>     - 理由：知識快遞的內容，段考不一定考
>     - 出處：p.45 知識快遞｜類型：因果
>     - 水溫升高時，糖在水中的溶解度會怎麼變？ :: 變**大**
`;
  const bad = `---
狀態: 草稿
---
以下是卡片：

> [!note]- 候選卡片
> - 能說明 A
>     - 出處：p.45｜類型：定義
>     - A 是什麼？ :: B
>     - 哪一杯糖較多，濃度就比較大？ :: 糖較多的那杯

## 2 擴散現象

- 能用粒子運動說明擴散現象 ^k3m9x2
    - 類型：因果｜難度：高｜重要性：中
    - 出處：第二段
    - 黑糖為什麼會散開？::粒子不停運動，從濃度高的地方散到濃度低的地方
    - 擴散是什麼？ ::
    - 這是是非題嗎？ :: 是
    - 第四題？第五題？ :: 太多
        - ![[不存在.png]]
        - *圖 2-14 黑糖在水中慢慢散開*
- 黑糖 :: 糖
- 能說出溶劑
    - 出處：圖 2-13｜類型：分類
    -  :: 水

> [!note] 給家長的備註
> - 圖 2-14 可以附上
`;
  const failures = [];
  const g = check(good, { transcript, unit: '2-2' });
  const serious = g.issues.filter(i => i.level !== '提醒');
  if (serious.length) failures.push('範例被誤判：' + serious.map(i => `${i.line} ${i.code}`).join('、'));
  if (g.stats.targets !== 2 || g.stats.questions !== 2 || g.stats.candidates !== 1 || g.stats.images !== 1) failures.push('範例的統計不對：' + JSON.stringify(g.stats));
  const b = check(bad, { transcript, unit: '2-2' }), codes = new Set(b.issues.map(i => i.code));
  const expected = ['yaml', 'para', 'candidate-position', 'candidate-reason', 'target-id', 'field-unknown', 'default-written', 'data-position', 'source-paragraph',
    'colon-space', 'no-bold', 'no-answer', 'yes-no', 'too-many-questions', 'image-missing', 'caption', 'top-question', 'type-unknown', 'no-front', 'note-position', 'note-kind', 'note-image', 'source-unresolved', 'leak-pattern', 'two-questions'];
  const missed = expected.filter(c => !codes.has(c));
  if (missed.length) failures.push('沒抓到：' + missed.join('、'));
  console.log(failures.length ? 'FAIL\n' + failures.join('\n') : `selftest：範例 0 個不符；錯誤範例抓到 ${expected.length}/${expected.length} 種`);
  if (failures.length) process.exitCode = 1;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    transcript: { type: 'string' }, unit: { type: 'string' }, subject: { type: 'string' }, tree: { type: 'boolean' }, selftest: { type: 'boolean' }
  } });
  if (values.selftest) return selftest();
  if (!positionals.length) { console.log('用法：node check-syntax.mjs <卡片.md>… [--transcript <轉錄稿.md>] [--unit 2-2] [--subject 自然] [--tree]\n      node check-syntax.mjs --selftest'); return; }
  const transcript = values.transcript ? await fs.readFile(values.transcript, 'utf8') : null;
  let errors = 0;
  for (const file of positionals) {
    const result = check(await fs.readFile(file, 'utf8'), { transcript, unit: values.unit, subject: values.subject });
    console.log(format(file, result) + (values.tree ? '\n\n```\n' + tree(result) + '\n```' : '') + '\n');
    errors += result.issues.filter(i => i.level === '錯誤').length;
  }
  if (errors) process.exitCode = 1;
}
// 被 judge.mjs 匯入時不執行。
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
