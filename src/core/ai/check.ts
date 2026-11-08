// 依 docs/syntax.md 檢查 AI 製卡交回的草稿（從 experiments/t4/check-syntax.mjs 搬來，tasks/ai-cards-mvp.md §4；那邊只剩命令列）：
// §2-2 兩條規則、§2-3 名稱與 ID、§2-4 資料欄位、§2-5 出處、§2-6 題目、§2-9 草稿格式，加上製卡規則裡程式量得到的上限。
// 分三級：錯誤＝程式會跳過那個學習目標或連結壞掉（§2-10）；不符＝程式讀得懂，但違反語法或製卡規則；提醒＝啟發式，要人看。
// 只讀文字，不改任何東西。
import { parseDeck } from '../deck/index.ts';
import type { Deck, Target as DeckTarget } from '../deck/index.ts';
import { languageStats } from './language.ts';

type CheckLevel = '錯誤' | '不符' | '提醒';
/** line 從 1 算（檢查的那份文字的第幾行）。 */
interface CheckIssue { line: number; level: CheckLevel; code: string; msg: string }

const FIELDS = ['出處', '類型', '重要性', '狀態', '備註', '錯題補強'];
const TYPES: Record<string, string[] | undefined> = { 自然: ['定義', '因果', '比較', '順序', '實驗', '公式與單位', '圖表'], 一般知識: ['定義', '因果', '比較', '步驟', '判斷與應用', '數值與標準'] };
const UNDERSTANDING = ['因果', '比較', '實驗', '判斷與應用']; // 自然預設規則 1；理解題的答案要有粗體重點（D-068）；判斷與應用是一般知識的
const ID = /^[a-hjkmnp-z2-9]{6}$/; // 6 碼，去掉 0、o、1、l、i
const NOTE_KINDS = [/說法|不一致|簡化|衝突|一般認知|矛盾/, /另外練習|練習/, /印錯|誤植|可能有誤|錯字/];

// 行內程式碼與公式裡的 `::`、`==` 不算（D-089 第 2 條）：換成等長的占位字元，位置不變。
const mask = (s: string): string => s.replace(/`[^`]*`|\$\$.*?\$\$|\$[^$\n]+\$/g, m => '\u0001'.repeat(m.length));
const isQuestion = (s: string): boolean => mask(s).includes('::') || /==[^=\n]+==/.test(mask(s));
const expand = (s: string): string => { let out = '', col = 0; for (const ch of s) { if (ch === '\t') { const n = 4 - (col % 4); out += ' '.repeat(n); col += n; } else { out += ch; col++; } } return out; };
const images = (s: string): string[] => [...s.matchAll(/!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)].map(m => m[1].trim());
const bolds = (s: string): string[] => [...s.matchAll(/\*\*([^*\n]+)\*\*/g)].map(m => m[1]);

interface Line { no: number; raw: string }
/** 最後一個符合的（tsconfig 的 lib 還沒有 Array.prototype.findLast）。 */
function findLast<T, S extends T>(list: readonly T[], match: (item: T) => item is S): S | undefined;
function findLast<T>(list: readonly T[], match: (item: T) => boolean): T | undefined;
function findLast<T>(list: readonly T[], match: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (match(list[i])) return list[i];
  return undefined;
}
/** 一行文字切成的區塊：標題、引言框、程式碼、清單項目、接續行、段落、空行。line 從 1 算。 */
type Block =
  | { kind: 'code' | 'blank'; line: number }
  | { kind: 'callout'; line: number; body: Line[] }
  | { kind: 'heading'; line: number; level: number; text: string }
  | { kind: 'item'; line: number; col: number; contentCol: number; marker: string; text: string }
  | { kind: 'cont' | 'para'; line: number; text: string };
type Item = Extract<Block, { kind: 'item' }>;
type Cont = Extract<Block, { kind: 'cont' | 'para' }>;
interface TreeNode extends Item { children: TreeNode[]; cont: Cont[] }

/** 把幾行文字切成區塊（清單項目照 CommonMark 的欄位算）。 */
export function blocksOf(lines: readonly Line[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const { no, raw } = lines[i];
    if (/^\s{0,3}(```|~~~)/.test(raw)) {
      while (i + 1 < lines.length && !/^\s{0,3}(```|~~~)/.test(lines[i + 1].raw)) i++;
      i++; blocks.push({ kind: 'code', line: no }); continue;
    }
    if (/^\s{0,3}>/.test(raw)) {
      const body: Line[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i].raw)) body.push(lines[i++]);
      i--; blocks.push({ kind: 'callout', line: no, body }); continue;
    }
    if (!raw.trim()) { blocks.push({ kind: 'blank', line: no }); continue; }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (heading) { blocks.push({ kind: 'heading', line: no, level: heading[1].length, text: heading[2] }); continue; }
    const line = expand(raw), item = /^( *)([-*+]|\d+[.)])( +|$)(.*)$/.exec(line);
    if (item) {
      const gap = item[3].length >= 1 && item[3].length <= 4 ? item[3].length : 1;
      blocks.push({ kind: 'item', line: no, col: item[1].length, contentCol: item[1].length + item[2].length + gap, marker: item[2], text: item[4].trimEnd() });
      continue;
    }
    const previous = findLast(blocks, b => b.kind !== 'blank'), lastItem = findLast(blocks, (b): b is Item => b.kind === 'item');
    const last = blocks.at(-1);
    const directlyAfter = !!last && (last.kind === 'item' || last.kind === 'cont');
    const indentedUnder = !!lastItem && !!previous && (previous.kind === 'item' || previous.kind === 'cont') && /^ */.exec(line)![0].length >= lastItem.contentCol;
    blocks.push({ kind: directlyAfter || indentedUnder ? 'cont' : 'para', line: no, text: raw.trim() });
  }
  return blocks;
}

// 清單的上下層：子項目要縮排到上一層文字開始的位置（CommonMark，Obsidian 也照這個解析，D-089 第 6 條）。
function treeOf(blocks: readonly Block[]): TreeNode[] {
  const roots: TreeNode[] = [], stack: TreeNode[] = [];
  for (const block of blocks) {
    if (block.kind === 'item') {
      while (stack.length && stack[stack.length - 1].contentCol > block.col) stack.pop();
      const node: TreeNode = { ...block, children: [], cont: [] };
      (stack.length ? stack[stack.length - 1].children : roots).push(node);
      stack.push(node);
    } else if (block.kind === 'cont') { if (stack.length) stack[stack.length - 1].cont.push(block); }
    else if (block.kind !== 'blank') stack.length = 0;
  }
  return roots;
}

// ── 比較卡（點選填空，tasks/question-type-seam.md §10）──
// 認不認得出是 parseDeck 的結果（解析與檢查共用一份，產品照它出題）；這裡決定等級，再加上製卡規則量得到的幾條。
const PICK_ENDING = /[\s）)](相似字|比較)$/; // 結尾整段是這兩個詞才算（§3〈結尾〉）：「質量比較」「這兩個字的比較」不算
const PICK_ANCHOR = /^記憶錨點\s*[：:]/;
const foldPick = (s: string): string => s.replace(/\*\*|==/g, '').replace(/[！-～]/g, c => String.fromCodePoint(c.codePointAt(0)! - 0xFEE0)).replace(/[\s　]+/g, ' ').trim().toLowerCase();
/** 整個答案出現在題目裡：英文看詞界（lend 在 blend 不算），片語要整段；中文要整個詞，單一漢字照預設〈相似字〉出現就算（喵喵叫）。 */
function answerShown(question: string, answer: string): boolean {
  const a = foldPick(answer);
  if (!a) return false;
  const pattern = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{Script=Latin}\\d])${pattern}(?![\\p{Script=Latin}\\d])`, 'u').test(foldPick(question.replace(/＿+/g, ' ')));
}
/** 有頓號或逗號的括號裡，項目中間有漢字夾空白：可能少打一個頓號（`寒 賽` 會變成一個字鍵）。 */
const spacedItem = (name: string): string | undefined => [...name.matchAll(/[（(]([^（）()]*)[）)]/g)].map(m => m[1]).find(inner => /[、,，]/.test(inner) && inner.split(/[、,，]/).some(item => /\p{Script=Han}\s+\p{Script=Han}/u.test(item.trim())));

type Report = (line: number, level: CheckLevel, code: string, msg: string) => void;

function checkPick(text: string, deck: Deck, issue: Report): void {
  const lines = text.split(/\r?\n/);
  const targetAt = (line: number): DeckTarget | undefined => deck.targets.find(t => t.line === line || t.prompts.some(p => p.line === line));
  const unrecognized = new Set<DeckTarget | undefined>();
  for (const p of deck.problems) {
    const line = p.line + 1;
    if (p.code === 'pick-answer-invalid') issue(line, '錯誤', p.code, p.message);
    else if (p.code === 'pick-not-recognized') { issue(line, '錯誤', p.code, p.message); unrecognized.add(targetAt(p.line)); }
    else if (p.code === 'pick-mixed') issue(line, PICK_ENDING.test(targetAt(p.line)?.name ?? '') ? '錯誤' : '提醒', p.code, p.message);
  }
  const groups = new Map<string, DeckTarget[]>();
  for (const t of deck.targets) {
    const line = t.line + 1;
    // 最上層的題目或名稱有 ==、＿：解析照原題型（隱式題、補 ID 留下來的），結尾又寫了相似字、比較，八成是想做比較卡（§3 判斷順序第 1 點）。
    if (PICK_ENDING.test(t.name) && /==|＿/.test(lines[t.line].split('::')[0])) issue(line, '錯誤', 'pick-name-cloze', '比較卡的名稱不能有 == 或 ＿，這一行不會變成比較卡；名稱寫成「寨（寨、塞） 相似字」，句子放在底下');
    const spaced = spacedItem(t.name);
    if ((t.group || unrecognized.has(t)) && spaced) issue(line, '提醒', 'pick-member-space', `括號裡的項目中間有空白，可能少打一個頓號：${spaced}`);
    const group = t.group;
    if (!group) continue;
    groups.set(group.key, [...(groups.get(group.key) ?? []), t]);
    if (group.title !== '相似字' && group.title !== '比較') issue(line, '提醒', 'pick-title', `比較卡的結尾寫「相似字」或「比較」（現在是「${group.title}」），孩子才看得懂標題`);
    const least = group.members.length === 2 ? 3 : 2;
    if (t.prompts.length < least) issue(line, '不符', 'pick-few-sentences', `每個字至少兩句，只有兩個選項的組至少三句：這裡 ${String(t.prompts.length)} 句（D-182）`);
    for (const p of t.prompts) if (p.kind === 'qa' && answerShown(p.question, p.answer)) issue(p.line + 1, '不符', 'pick-answer-in-question', `答案「${p.answer}」出現在題目裡，不用想就答得出來`);
    const anchor = t.shared.find(s => PICK_ANCHOR.test(s));
    if (anchor === undefined) { issue(line, '不符', 'pick-no-anchor', '沒有記憶錨點：對答案後的對照這個字只有字（預設〈相似字〉）'); continue; }
    const body = anchor.replace(PICK_ANCHOR, '').trim();
    if (!/\*\*[^*]+\*\*/.test(body)) issue(line, '不符', 'pick-anchor-no-bold', '記憶錨點沒有粗體：差別在哪個部件要寫粗體（預設〈相似字〉）');
    const at = body.lastIndexOf('：');
    const why = (at < 0 ? body : body.slice(0, at)).replaceAll('**', '');
    if ([...why].length > 15) issue(line, '提醒', 'pick-anchor-long', `記憶錨點冒號前面 ${String([...why].length)} 字，約 15 字以內手機上才一行讀完`);
  }
  for (const members of groups.values()) {
    const { group, line } = members[0];
    const words = new Set(members.map(t => t.group?.wordKey));
    group?.members.forEach((member, i) => { if (!words.has(group.memberKeys[i])) issue(line + 1, '不符', 'pick-member-no-target', `組裡的「${member}」沒有自己的目標：字鍵還在，但不會出這個字的句子，對照也只有字`); });
  }
}

interface Question { line: number; raw: string; kind: 'qa' | 'cloze'; front: string; back: string; multi?: boolean; supplements: TreeNode[] }
type Where = 'body' | 'candidate' | 'existing';
/** 檢查時認出的一個學習目標（本文、候選卡片、加進已有的學習目標）。 */
interface CheckedTarget { line: number; name: string; id?: string; reason?: string; data: Record<string, string>; questions: Question[]; shared: TreeNode[]; where: Where; heading?: string | null }

export interface CheckOptions {
  /** 預設自然（試用時的預設）；類型的清單照它挑。 */
  subject?: string;
  /** 這次的單元編號；跨單元的出處是提醒。 */
  unit?: string | null;
  /** 轉錄稿：有時才檢查出處的錨點、圖與小標題。 */
  transcript?: string | null;
}
export interface CheckResult {
  targets: CheckedTarget[];
  candidates: CheckedTarget[];
  existing: CheckedTarget[];
  notes: string[];
  headings: string[];
  issues: CheckIssue[];
  stats: { targets: number; understanding: number; questions: number; images: number; candidates: number; notes: number; existing: number };
}

/** 檢查一篇草稿。issues 照行號排；line 從 1 算，算的是 text 的行（開頭的 BOM 不算一行）。 */
export function check(text: string, options: CheckOptions = {}): CheckResult {
  const subject = options.subject ?? '自然', unit = options.unit ?? null, transcript = options.transcript ?? null;
  const issues: CheckIssue[] = [];
  const issue: Report = (line, level, code, msg) => { issues.push({ line, level, code, msg }); };
  const all: Line[] = text.replace(/^﻿/, '').split(/\r?\n/).map((raw, i) => ({ no: i + 1, raw }));
  const source = transcript ? {
    anchors: new Set([...transcript.matchAll(/\^([A-Za-z0-9-]+)\s*$/gm)].map(m => m[1])),
    headings: [...transcript.matchAll(/^#{1,6}\s+(.*?)\s*$/gm)].map(m => m[1]),
    images: new Set(images(transcript)),
    captions: [...transcript.matchAll(/^\*(.+)\*\s+\^[A-Za-z0-9-]+\s*$/gm)].map(m => m[1].trim()),
  } : null;
  const targets: CheckedTarget[] = [], candidates: CheckedTarget[] = [], existing: CheckedTarget[] = [], notes: string[] = [], headings: string[] = [];
  const deck = parseDeck(text);
  // 比較卡的名稱是「寨（寨、塞） 相似字」，不是「能……」；結尾寫了這兩個詞的、認不得的也一樣，它們另外有比較卡的診斷。
  const pickNames = new Set(deck.targets.filter(t => t.group || PICK_ENDING.test(t.name)).map(t => t.line + 1));

  let start = 0;
  if (all[0]?.raw.trim() === '---') {
    issue(1, '不符', 'yaml', 'AI 不寫卡組屬性，外掛會補上（§2-9）');
    start = all.findIndex((l, i) => i > 0 && l.raw.trim() === '---') + 1 || all.length;
  }

  function checkSource(value: string, line: number): void {
    if (value.includes('|')) issue(line, '不符', 'half-pipe', '欄位之間用全形「｜」分隔（§0）');
    for (const piece of value.split('、')) {
      const item = piece.trim();
      if (!item) { issue(line, '不符', 'source-empty', '出處有空的項目'); continue; }
      if (/第.{1,3}段/.test(item)) issue(line, '不符', 'source-paragraph', `出處不寫「第幾段」（§2-5）：${item}`);
      const unitMatch = /^((?:國[一二三][上下]\s*)?(?:\d+-\d+|L\d+))(?:\s+|$)(.*)$/.exec(item);
      const rest = unitMatch ? unitMatch[2] : item;
      if (unitMatch && unit && unitMatch[1] !== unit) { issue(line, '提醒', 'source-cross-unit', `跨單元的出處，要人確認：${item}`); continue; }
      if (!rest) continue; // 只寫單元
      let anchor: string | null = null, m: RegExpExecArray | null;
      if ((m = /^p\.\s?(\d+)/.exec(rest))) anchor = `p${m[1]}`;
      else if ((m = /^(圖|表|例題)\s?(\d+-\d+)(?:\s?([A-Za-z])(?![A-Za-z0-9-]))?/.exec(rest))) anchor = ({ 圖: 'fig', 表: 'tab', 例題: 'ex' } as Record<string, string>)[m[1]] + m[2] + (m[3] ?? '').toLowerCase();
      else if (/^\[\[[^\]]+\]\]/.test(rest) || /^先備\s*[：:]/.test(rest)) continue;
      else if (source && !source.headings.some(h => h === rest || h.endsWith(' ' + rest))) { issue(line, '不符', 'source-unknown', `出處認不得，程式只會照文字顯示：${item}`); continue; }
      if (!anchor || !source || source.anchors.has(anchor)) continue;
      // 只寫「圖 2-13」、轉錄稿卻分成子圖時，連到第一張子圖（§2-5、D-094）。
      const prefix = anchor;
      if (prefix.startsWith('fig') && [...source.anchors].some(a => a.startsWith(prefix) && /^[a-z]$/.test(a.slice(prefix.length)))) continue;
      issue(line, '不符', 'source-unresolved', `出處找不到錨點 ^${anchor}：${item}`);
    }
  }

  function parseData(node: TreeNode, target: CheckedTarget): void {
    for (const segment of node.text.split('｜')) {
      const m = /^\s*([^：:]+?)\s*([：:])\s*(.*?)\s*$/.exec(segment);
      if (!m) { issue(node.line, '不符', 'data-segment', `資料裡的「${segment.trim()}」不是「欄位：值」`); continue; }
      const [, name, colon, value] = m;
      if (colon === ':') issue(node.line, '不符', 'half-colon', `「${name}:」用了半形冒號；AI 寫全形「：」（§0）`);
      if (!FIELDS.includes(name)) { issue(node.line, '不符', 'field-unknown', `「${name}」不是資料欄位，程式只認 6 個（§2-4）`); continue; }
      if (target.data[name] !== undefined) issue(node.line, '提醒', 'field-twice', `「${name}」寫了兩次（§2-4）`);
      target.data[name] = value;
      const types = TYPES[subject];
      if (name === '出處') checkSource(value, node.line);
      else if (name === '類型' && types && !types.includes(value)) issue(node.line, '不符', 'type-unknown', `類型「${value}」不在${subject}預設的知識類型裡`);
      else if (name === '重要性' && value === '中') issue(node.line, '不符', 'default-written', '重要性的預設值「中」不寫出來（§2-4）');
      else if (name === '重要性' && !['高', '低'].includes(value)) issue(node.line, '不符', 'value-unknown', `重要性「${value}」認不得（§2-4）`);
      else if (name === '狀態') issue(node.line, '不符', 'ai-field', '狀態由家長決定，AI 不寫');
      else if (name === '備註') issue(node.line, '不符', 'ai-field', '備註是家長寫的（D-063），AI 不寫');
      else if (name === '錯題補強') issue(node.line, '不符', 'ai-field', '錯題補強是採用錯題本時外掛加的，製卡不寫');
    }
  }

  function checkImageLines(node: { line: number; text: string; children?: TreeNode[] }, where: 'answer' | 'support' | 'shared'): void {
    for (const name of images(node.text)) if (source && !source.images.has(name)) issue(node.line, '錯誤', 'image-missing', `轉錄稿沒有這張圖，連結會壞掉：${name}`);
    if (where === 'answer' && images(node.text).length) issue(node.line, '不符', 'image-in-answer', '幫助記憶的圖放在題目底下，不放在答案那一行（§2-6）');
    if (where === 'shared' && images(node.text).length) issue(node.line, '提醒', 'image-shared', '圖放在學習目標底下，每一題都會顯示；要確認不是某一題專用');
    for (const child of node.children ?? []) checkImageLines(child, where === 'answer' ? 'support' : where);
  }

  function analyzeQuestion(node: TreeNode): Question {
    const masked = mask(node.text), at = masked.indexOf('::');
    let q: Question;
    if (at >= 0) {
      const before = node.text.slice(0, at), after = node.text.slice(at + 2);
      q = { line: node.line, raw: node.text, kind: 'qa', front: before.trim(), back: after.trim(), supplements: [] };
      if (masked.includes('::', at + 2)) issue(node.line, '不符', 'double-colon', '一行有兩個 `::`');
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
      const blanks = [...masked.matchAll(/==([^=\n]*)==/g)];
      if (blanks.some(b => !b[1].trim())) issue(node.line, '錯誤', 'empty-blank', '填空的 `====` 裡沒有字');
      q = { line: node.line, raw: node.text, kind: 'cloze', front: node.text.replace(/==[^=\n]*==/g, '［＿］'), back: blanks.map(b => b[1]).join('、'), supplements: node.children };
      checkImageLines(node, 'support');
    }
    if (/嗎[？?]\s*$|對不對|是不是|是否/.test(q.front)) issue(node.line, '提醒', 'yes-no', '可能是是非題（通用規則 10）');
    // 「哪一杯加入較多黑糖，濃度比較大？」沒有「就」、或條件寫在前面（「一杯溶的糖比較多，哪一杯濃度比較大？」）也一樣洩漏（T4 第七、八輪）。
    if (/哪一[^，,；;？?]*[，,；;][^？?]*就[^？?]*[？?]|哪一[^，,；;？?]*(較|多|少)[^，,；;？?]*[，,；;][^？?]*(比較|較)[^？?]*[？?]|(較|比較)(多|少)[^？?]*[，,；;][^？?]*哪一[^？?]*(比較|較)[^？?]*[？?]/.test(q.front)) issue(node.line, '提醒', 'leak-pattern', '「哪一個……，……就比較……？」常把答案寫進題目（通用規則 10）');
    // 「……？為什麼？」是一題理解題；其他一行問兩個問題的，要拆開（通用規則 8）。
    if ((q.front.match(/[？?]/g) ?? []).length >= 2 && !/[？?]\s*為什麼[？?]\s*$/.test(q.front)) issue(node.line, '提醒', 'two-questions', '一題問了兩件事（通用規則 8）');
    if (q.front.includes('下列')) issue(node.line, '提醒', 'which-of', '「下列何者」題需要選項才能作答（通用規則 10）');
    if (/如上|上述|上圖|下圖/.test(q.front) && !images(q.front).length) issue(node.line, '提醒', 'context', '題目依賴上下文（通用規則 9）');
    return q;
  }

  function classify(text: string): 'data' | 'question' | 'supplement' {
    const m = /^([^\s：:｜]+)\s*[：:]/.exec(text);
    if (m && FIELDS.includes(m[1])) return 'data';
    return isQuestion(text) ? 'question' : 'supplement';
  }

  function analyzeTarget(node: TreeNode, where: Where): CheckedTarget {
    const target: CheckedTarget = { line: node.line, name: node.text, data: {}, questions: [], shared: [], where };
    let children = node.children;
    if (where === 'candidate') {
      if (!children.length || !/^理由\s*[：:]/.test(children[0].text)) issue(node.line, '不符', 'candidate-reason', '候選卡片的第一行要是一句「理由：」（§2-9）');
      else { target.reason = children[0].text.replace(/^理由\s*[：:]\s*/, ''); children = children.slice(1); }
    }
    if (where === 'existing') {
      const m = /^(\S+)\s+(.*)$/.exec(node.text);
      if (!m || !ID.test(m[1])) issue(node.line, '不符', 'existing-id', '「加進已有的學習目標」每一項以已有的 6 碼 ID 開頭（§2-9）');
      else { target.id = m[1]; target.name = m[2]; }
    } else if (/\s\^[A-Za-z0-9-]+\s*$/.test(node.text)) issue(node.line, '不符', 'target-id', 'AI 不寫學習目標 ID（§2-9）');
    if (isQuestion(node.text)) issue(node.line, '不符', 'top-question', '最上層直接寫了題目，程式會自己補一個學習目標；AI 要先寫名稱（§2-3）');
    else if (where !== 'existing' && !target.name.startsWith('能') && !pickNames.has(node.line)) issue(node.line, '不符', 'target-name', '學業的學習目標名稱寫成「能……」（§2-3）');
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
        const name = /^([^\s：:]{1,6})[：:]/.exec(child.text)?.[1];
        if (name && !['記憶錨點', '例句'].includes(name)) issue(child.line, '提醒', 'shared-label', `「${name}：」不是資料欄位，會當成每一題共用的背面補充（§2-4）`);
        checkImageLines(child, 'shared');
      }
    });
    if (!target.questions.length) issue(node.line, '不符', 'no-question', '學習目標底下沒有題目，程式會當成一般筆記（§2-2）');
    if (where !== 'existing' && target.questions.length > 3) issue(node.line, '不符', 'too-many-questions', `${String(target.questions.length)} 題；初次製卡基本題之外最多 2 題（通用規則 6）`);
    if (where !== 'existing' && !target.data['出處']) issue(node.line, '不符', 'no-source', '沒有出處（通用規則 13）');
    if (UNDERSTANDING.includes(target.data['類型'])) for (const q of target.questions.filter(each => each.kind === 'qa')) {
      // 只有一個詞的短答案（例如「飽和溶液」）整個就是重點，不要求粗體。
      const n = bolds(q.back).length, short = q.back.length <= 10 && !/[，；、,;]/.test(q.back);
      if (n === 0 && !short) issue(q.line, '不符', 'no-bold', `理解題（${target.data['類型']}）的答案沒有粗體重點（D-068）`);
      if (n > 3) issue(q.line, '不符', 'bold-count', `理解題的答案有 ${String(n)} 個粗體重點，上限 3 個（D-068）`);
    }
    return target;
  }

  // 最上層的區塊依序走一遍，順便檢查順序：備註 → 學習目標 → 加進已有 → 候選。
  const blocks = blocksOf(all.slice(start));
  /** 引言框裡之後會搬出去出題的（候選、加進已有）：解析器判成錯誤的那幾行（行號已換回 text 的行）。本文的直接看 deck.problems。 */
  const boxProblems: { line: number; code: string; message: string }[] = [];
  const parseBox = (inner: readonly Line[]): void => {
    for (const p of parseDeck(inner.map(l => l.raw).join('\n')).problems) if (p.level === 'error') boxProblems.push({ line: inner[p.line].no, code: p.code, message: p.message });
  };
  const order: { kind: 'note' | 'existing' | 'candidate' | 'other' | 'body' | 'para'; line: number }[] = [];
  for (const block of blocks) {
    if (block.kind === 'callout') {
      const head = /^\s{0,3}>\s?\[!([^\]]+)\]([-+]?)\s*(.*?)\s*$/.exec(block.body[0].raw);
      for (const l of block.body) if (!/^\s{0,3}>( |$)/.test(l.raw)) issue(l.no, '不符', 'callout-prefix', '引言框裡的每一行以「> 」開頭');
      const inner = block.body.slice(1).map(l => ({ no: l.no, raw: l.raw.replace(/^\s{0,3}> ?/, '') }));
      const title = head?.[3] ?? '';
      const roots = treeOf(blocksOf(inner));
      if (/^給(家長|學習者)的備註$/.test(title)) {
        order.push({ kind: 'note', line: block.line });
        if (head?.[2] === '-') issue(block.line, '不符', 'note-folded', '給家長的備註不摺起');
        for (const item of roots) {
          notes.push(item.text);
          if (!NOTE_KINDS.some(k => k.test(item.text))) issue(item.line, '不符', 'note-kind', `給家長的備註只寫三種事：說法不一致、建議另外練習的計算題、課本可能印錯（§2-9）：${item.text.slice(0, 40)}`);
          if (item.text.includes('圖') && /附|放/.test(item.text)) issue(item.line, '不符', 'note-image', '能直接做好的事（附圖）不寫進備註');
        }
        if (!roots.length) issue(block.line, '不符', 'note-empty', '沒有備註時整段省略');
      } else if (title === '加進已有的學習目標') {
        order.push({ kind: 'existing', line: block.line });
        parseBox(inner);
        for (const node of roots) existing.push(analyzeTarget(node, 'existing'));
        issue(block.line, '提醒', 'existing-present', `「加進已有的學習目標」有 ${String(roots.length)} 項：確認輸入真的給了這些已有的學習目標`);
      } else if (title === '候選卡片') {
        order.push({ kind: 'candidate', line: block.line });
        parseBox(inner);
        if (head?.[2] !== '-') issue(block.line, '不符', 'candidate-folded', '候選卡片預設摺起，寫成 `> [!note]- 候選卡片`（§2-9）');
        for (const node of roots) candidates.push(analyzeTarget(node, 'candidate'));
        if (roots.length > 5) issue(block.line, '不符', 'candidate-count', `候選卡片 ${String(roots.length)} 個，最多 5 個（§2-9）`);
        if (!roots.length) issue(block.line, '不符', 'candidate-empty', '沒有候選時整段省略');
      } else { order.push({ kind: 'other', line: block.line }); issue(block.line, '不符', 'callout-unknown', `不認得的引言框「${title || block.body[0].raw.trim()}」；不要加其他段落`); }
    } else if (block.kind === 'heading') {
      order.push({ kind: 'body', line: block.line });
      headings.push(block.text);
      if (block.level !== 2 && block.level !== 3) issue(block.line, '提醒', 'heading-level', `標題用了 ${'#'.repeat(block.level)}；照課本的層級，最上層用 ##（D-094）`);
      if (source && !source.headings.some(h => h === block.text || h.includes(block.text) || block.text.includes(h))) issue(block.line, '提醒', 'heading-unknown', `轉錄稿沒有這個小標題：${block.text}`);
    } else if (block.kind === 'item') order.push({ kind: 'body', line: block.line });
    else if (block.kind === 'para') { order.push({ kind: 'para', line: block.line }); issue(block.line, '不符', 'para', `多出的段落（開場白、結語或說明）：${block.text.slice(0, 30)}`); }
    else if (block.kind === 'code') issue(block.line, '不符', 'code', '不要用程式碼區塊包住輸出');
  }
  const kinds = order.filter(o => o.kind !== 'para').map(o => o.kind);
  const at = (k: (typeof order)[number]['kind'], f: (line: number) => void): void => { order.filter(o => o.kind === k).map(o => o.line).forEach(f); };
  at('note', line => { if (kinds[0] !== 'note' || kinds.filter(k => k === 'note').length > 1 || order.find(o => o.kind === 'note')?.line !== line) issue(line, '不符', 'note-position', '給家長的備註只有一段，放在最上面（§2-9）'); });
  at('candidate', line => { if (kinds[kinds.length - 1] !== 'candidate' || kinds.filter(k => k === 'candidate').length > 1) issue(line, '不符', 'candidate-position', '候選卡片只有一段，放在最後（§2-9）'); });
  at('existing', line => { const i = order.findIndex(o => o.line === line); if (order.slice(i + 1).some(o => o.kind === 'body' || o.kind === 'note')) issue(line, '不符', 'existing-position', '「加進已有的學習目標」放在學習目標之後、候選卡片之前（§2-9）'); });

  // 本文的學習目標
  for (const node of treeOf(blocks)) {
    const target = analyzeTarget(node, 'body');
    target.heading = findLast(blocks, (b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading' && b.line < node.line)?.text ?? null;
    if (!target.heading) issue(node.line, '提醒', 'no-heading', '學習目標前面沒有小標題（用課本的小標題 ## 分組）');
    targets.push(target);
  }

  // 圖說：只放圖檔，不放圖說（§2-6）
  for (const { no, raw } of all.slice(start)) {
    const body = raw.replace(/^\s{0,3}>\s?/, '').trim().replace(/^([-*+]|\d+[.)])\s+/, '');
    if (/^\*[^*].*[^*]\*$/.test(body) || /^_[^_].*_$/.test(body)) issue(no, '不符', 'caption', '只放圖檔，不放圖說（§2-6）');
    else if (source) for (const caption of source.captions) if (caption.length > 8 && raw.includes(caption)) issue(no, '不符', 'caption', '只放圖檔，不放圖說（§2-6）');
  }

  // 數量與比例
  const n = targets.length;
  const understanding = targets.filter(t => UNDERSTANDING.includes(t.data['類型'])).length;
  if (subject === '自然' && n && understanding * 3 < n) issue(1, '不符', 'understanding-ratio', `理解型目標 ${String(understanding)}/${String(n)}，少於三分之一（自然預設規則 1）`);
  checkPick(text, deck, issue);
  // 正式解析器判成 error 的目標（ok: false）複習時不會出：一律算錯誤，不靠這裡各讀各的（L2-3，例如中翻英的答案不是單行英文）。同一行這裡已經報過的不重複。
  const reported = new Set(issues.filter(each => each.level === '錯誤').map(each => each.line));
  for (const p of [...deck.problems.filter(each => each.level === 'error').map(each => ({ line: each.line + 1, code: each.code, message: each.message })), ...boxProblems]) {
    if (!reported.has(p.line)) issue(p.line, '錯誤', p.code, p.message);
  }
  const language = languageStats(text);
  if (language.simplified) issue(1, '不符', 'simplified', `有 ${String(language.simplified)} 個常見簡體字形`);
  for (const [term, count] of Object.entries(language.terms)) if (count) issue(1, '不符', 'mainland-term', `大陸用語「${term}」${String(count)} 次`);

  return {
    targets, candidates, existing, notes, headings,
    issues: issues.sort((a, b) => a.line - b.line),
    stats: {
      targets: n, understanding,
      questions: targets.reduce((s, t) => s + t.questions.length, 0),
      images: targets.reduce((s, t) => s + images(JSON.stringify(t.questions.map(q => [q.raw, q.supplements.map(x => x.text)]))).length, 0),
      candidates: candidates.length, notes: notes.length, existing: existing.length,
    },
  };
}
