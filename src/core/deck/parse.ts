import { isMap, isScalar, parseDocument } from 'yaml';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { splitUnit } from './sources.ts';
import { linesOf, listTree, nameIds, questionSyntax, removeMiddle, stripId } from './markdown.ts';
import type { Item, Line } from './markdown.ts';
import type { Deck, DeckProps, Fields, Problem, ProblemCode, Prompt, Target } from './types.ts';

const fieldStart = /^(出處|類型|重要性|狀態|備註|錯題補強)\s*[：:]/;
const defaultProps = (): DeckProps => ({ term: null, subject: null, unit: null, materials: [], status: 'active', categories: [], isTranscript: false, need: null, issues: [] });
const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** YAML 雙引號字串的單字元跳脫（YAML 1.2 §5.7）。 */
const ESCAPES: Record<string, string> = { '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ' };
/** 照 YAML 雙引號字串的規則解開跳脫：`需` 這類跳脫字元、行尾 `\` 接下一行（去掉下一行開頭的空白）；認不得的照原文留著。 */
function unescapeYaml(text: string): string {
  return text.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|(\n)[ \t]*|([^]))/g,
    (match, x?: string, u?: string, wide?: string, eol?: string, single?: string) => {
      const code = x ?? u ?? wide;
      if (code !== undefined) {
        const point = parseInt(code, 16);
        return point <= 0x10ffff ? String.fromCodePoint(point) : match;
      }
      if (eol !== undefined) return '';
      return single !== undefined && Object.hasOwn(ESCAPES, single) ? ESCAPES[single] : match;
    });
}
/**
 * 屬性區讀不出來時（YAML 寫壞、最上層不是對照表、沒有結束）：原文或解開跳脫之後含「需要版本」，就算有標記但讀不懂
 * （syntax.md §2-1、Codex 格式查核 F1）。縮排、引號、跳脫的鍵名、冒號前的空白都擋得到；寫在值或註解裡也算，寧可多擋。
 */
const mentionsNeed = (raw: string): boolean => raw.includes('需要版本') || unescapeYaml(raw).includes('需要版本');

export function readProperties(lines: Line[]): { props: DeckProps; start: number; problems: Problem[] } {
  const props = defaultProps();
  const problems: Problem[] = [];
  if (lines[0]?.raw.replace(/^\uFEFF/, '').trim() !== '---') return { props, start: 0, problems };
  // Obsidian 只認 `---` 當結尾；YAML 的 `...` 不算（W5 對照，2026-10-25）。
  const end = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line.raw));
  const hint = (line: number, message: string): void => { problems.push({ line, level: 'hint', code: 'unknown-property-value', message, targetLine: null }); };
  // 沒有結束的屬性區，Obsidian 當成一般文字，底下的清單照樣顯示（W5 對照）。
  if (end < 0) {
    hint(0, '屬性區塊沒有結束，Obsidian 把它當成一般文字；先使用預設值');
    // 沒有結束就看到檔尾（syntax.md §2-1）。
    if (mentionsNeed(lines.slice(1).map(line => line.raw).join('\n'))) props.need = false;
    return { props, start: 0, problems };
  }
  const start = end + 1;
  const raw = lines.slice(1, end).map(line => line.raw).join('\n');
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length) throw Error('無法解析屬性');
    const data: unknown = doc.toJS();
    if (data !== null && (typeof data !== 'object' || Array.isArray(data))) throw Error('屬性不是對照表');
    const values = (data ?? {}) as Record<string, unknown>;
    /** 這個屬性在檔案的第幾行（從 0 算）：看 YAML 解析出來的鍵，加引號、跳脫、冒號前有空白都找得到；找不到是屬性區開頭那一行。 */
    const lineOf = (key: string): number => {
      if (!isMap(doc.contents)) return 0;
      const found = doc.contents.items.find(pair => isScalar(pair.key) && pair.key.value === key)?.key;
      const at = isScalar(found) ? found.range?.[0] : undefined;
      return at === undefined ? 0 : raw.slice(0, at).split('\n').length;
    };
    props.term = string(values['年級學期']);
    props.subject = string(values['科目']);
    const unit = string(values['單元']);
    if (unit !== null) props.unit = splitUnit(unit);
    // 不一律轉成字串：`單元: 03` 的原寫法已經不見（§9-2），所以給提示、請家長加引號。
    if (unit === null && values['單元'] !== null && values['單元'] !== undefined) props.issues.push({ line: lineOf('單元'), message: '屬性「單元」要加引號，例如 單元: "3"' });
    props.materials = strings(values['材料']);
    const materials = values['材料'];
    const bad = Array.isArray(materials) ? materials.some(value => typeof value !== 'string') : materials !== null && materials !== undefined && typeof materials !== 'string';
    if (bad) props.issues.push({ line: lineOf('材料'), message: '屬性「材料」的連結要加引號，例如 材料: "[[教材]]"' });
    props.categories = strings(values['分類']);
    props.isTranscript = Object.hasOwn(values, '來源類型');
    if (Object.hasOwn(values, '需要版本')) props.need = string(values['需要版本']) ?? false;
    if (Object.hasOwn(values, '狀態')) {
      const status = values['狀態'];
      if (status === '草稿') props.status = 'draft';
      else if (status === '暫停') props.status = 'paused';
      else if (status !== '啟用') hint(lineOf('狀態'), '屬性「狀態」的值認不得，先當作啟用');
    }
  } catch {
    hint(0, '屬性區塊寫法有問題，先使用預設值');
    return { props: { ...defaultProps(), need: mentionsNeed(raw) ? false : null }, start, problems };
  }
  return { props, start, problems };
}

function fingerprint(question: string, answer: string): string {
  const normalize = (text: string): string => text.split('\n')
    .map(line => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
    .join('\n').replace(/\s+/g, ' ').trim();
  // 正反面各自整理，分隔的換行保留（任務的三個 SHA-256 驗算值）。
  const normalized = normalize(question) + '\n' + normalize(answer);
  return bytesToHex(sha256(new TextEncoder().encode(normalized))).slice(0, 8);
}

export function parseDeck(text: string): Deck {
  const lines = linesOf(text);
  const { props, start, problems } = readProperties(lines);
  const targets: Target[] = [];
  if (props.isTranscript) return { props, targets, problems };
  const seenIds = new Set<string>();
  for (const root of listTree(lines, start)) {
    const head = stripId(root.text);
    const syntax = questionSyntax(head.text);
    const implicit = syntax.colon >= 0 || syntax.blanks.length > 0;
    let name = implicit ? (syntax.colon >= 0 ? head.text.slice(0, syntax.colon) : head.text) : head.text.split('\n')[0];
    if (implicit) {
      // 只移除程式碼與公式外、成對的記號；由後往前改，保留原本的位置。
      for (const { start, end } of questionSyntax(name).blanks.reverse()) {
        name = name.slice(0, start) + name.slice(start + 2, end - 2) + name.slice(end);
      }
      name = name.trim().replaceAll('\n', ' ');
    }
    // 明確目標的名稱那一行：行中只有一個程式格式的 ID 時照樣認得；兩個以上或和行尾的不同是身分衝突（D-134）。
    let id = implicit ? null : head.id;
    let idProblem: 'misplaced-id' | 'ambiguous-id' | null = null;
    let idCandidates: string[] | undefined;
    if (!implicit) {
      const firstLine = root.text.split('\n')[0];
      const found = nameIds(firstLine);
      if (found.middle.length) {
        const distinct = [...new Set([...found.middle.map(m => m.id), ...(found.trailing ? [found.trailing.id] : [])])];
        name = removeMiddle(found.trailing ? firstLine.slice(0, found.trailing.start) : firstLine, found.middle).trim();
        if (distinct.length === 1) { id = distinct[0]; idProblem = 'misplaced-id'; } else { id = null; idProblem = 'ambiguous-id'; idCandidates = distinct; }
      }
    }
    const directionMatch = / (英翻中|中翻英)$/.exec(name);
    const fields: Fields = { sources: [], type: null, importance: 'medium', paused: false, remarks: [], mistakes: [] };
    const target: Target = { id, name, line: root.line, implicit, section: root.section,
      fields, prompts: [], shared: [], direction: directionMatch ? directionMatch[1] === '英翻中' ? 'en-zh' : 'zh-en' : null,
      pairKey: directionMatch ? name.slice(0, directionMatch.index) : null, ok: true, ...(idCandidates ? { idCandidates } : {}) };
    const addProblem = (node: Item, code: ProblemCode, message: string, level: 'error' | 'hint' = 'hint'): void => {
      problems.push({ line: node.line, targetLine: root.line, level, code, message });
      if (level === 'error') target.ok = false;
    };
    if (idProblem === 'misplaced-id') addProblem(root, idProblem, '學習目標 ID 跑到名稱中間；照樣認得，存檔時移回行尾');
    if (idProblem === 'ambiguous-id') addProblem(root, idProblem, '學習目標那一行有兩個以上的 ID，先不出題，等家長選要用哪一個', 'error');
    const seenFields = new Set<string>();
    function collectFields(node: Item): void {
      let values: string[] | null = null;
      if (fieldStart.test(node.text)) {
        // 半形的 `|` 後面接欄位名稱加冒號也是分隔（D-167 第 12 點）；連結裡的不算（`[[筆記|類型：x]]`）。
        const segments = node.text.split(/｜|\|(?=\s*(?:出處|類型|重要性|狀態|備註|錯題補強)\s*[：:])(?![^[]*\]\])/);
        for (const segment of segments) {
          const match = /^\s*([^：:]+?)\s*[：:]\s*([\s\S]*?)\s*$/.exec(segment);
          const key = match?.[1] ?? '', value = match?.[2] ?? '';
          if (!['出處', '類型', '重要性', '狀態', '備註', '錯題補強'].includes(key)) {
            addProblem(node, 'unknown-field', '資料中有不認得的欄位，已忽略這一段');
            continue;
          }
          if (key === '出處' || key === '備註' || key === '錯題補強') {
            addValues(key === '出處' ? fields.sources : key === '備註' ? fields.remarks : fields.mistakes, value);
          } else {
            if (seenFields.has(key)) { addProblem(node, 'duplicate-field', '「' + key + '」寫了兩次，使用第一個'); continue; }
            seenFields.add(key);
            if (key === '類型') fields.type = value || null;
            if (key === '重要性') {
              const importance = ({ 高: 'high', 中: 'medium', 低: 'low' } as const)[value as '高' | '中' | '低'];
              if (importance) fields.importance = importance;
              else addProblem(node, 'unknown-field-value', '重要性的值認不得，先當作中');
            }
            if (key === '狀態') {
              if (value === '暫停') fields.paused = true;
              else if (value !== '啟用') addProblem(node, 'unknown-field-value', '狀態的值認不得，先當作啟用');
            }
          }
        }
        values = fieldChildren(node, segments.length > 1);
      }
      // 一項一項走，普通的子項目和帶欄位名稱的子項目混著寫時，順序照筆記（D-164 第 5 點）。
      for (const child of node.children) {
        if (values && !fieldStart.test(child.text)) addValues(values, child.text);
        collectFields(child);
      }
    }
    /** 頓號分隔的值，照順序加進去，重複的只留第一個。 */
    function addValues(destination: string[], text: string): void {
      for (const entry of text.split('、').map(v => v.trim()).filter(Boolean)) if (!destination.includes(entry)) destination.push(entry);
    }
    /**
     * 資料欄位分行（§9-4、D-164 第 4 點）：出處、備註、錯題補強底下的子項目和寫在同一行相同，回傳要加到哪裡；開頭是欄位名稱的子項目是別的欄位（collectFields 的遞迴）。
     * 其他欄位帶子項目、同一行有｜又帶子項目、子項目底下還有子項目：忽略並提示，不默默不見。一個欄位提示一次。
     */
    function fieldChildren(node: Item, joined: boolean): string[] | null {
      const values = node.children.filter(child => !fieldStart.test(child.text));
      if (!values.length) return null;
      const key = /^\s*([^：:]+?)\s*[：:]/.exec(node.text)?.[1] ?? '';
      const destination = key === '出處' ? fields.sources : key === '備註' ? fields.remarks : key === '錯題補強' ? fields.mistakes : null;
      if (joined || !destination) {
        addProblem(values[0], 'field-children', joined ? '同一行有「｜」的資料，底下的子項目已忽略' : '「' + key + '」底下的子項目已忽略；這個欄位寫在同一行');
        return null;
      }
      const deeper = values.find(child => child.children.some(each => !fieldStart.test(each.text)));
      if (deeper) addProblem(deeper, 'field-children', '「' + key + '」的子項目底下再分層的部分已忽略');
      return destination;
    }
    // 補充或多行答案裡的資料也屬於整個目標。
    for (const child of root.children) collectFields(child);
    function markdown(node: Item, base = node.indent, nested = false): string {
      if (fieldStart.test(node.text)) return '';
      const prefix = nested ? ' '.repeat(node.indent - base) + lines[node.line].raw.trimStart().match(/^(?:[-*+]|\d+[.)])\s*/)?.[0] : '';
      const body = (prefix ?? '') + node.text;
      return [body, ...node.children.map(child => markdown(child, base, true)).filter(Boolean)].join('\n');
    }
    function prompt(node: Item): Prompt {
      const body = stripId(node.text).text;
      const { colon, blanks } = questionSyntax(body);
      const children = node.children.filter(child => !fieldStart.test(child.text));
      if (colon >= 0) {
        const question = body.slice(0, colon).trim();
        let answer = body.slice(colon + 2).trim();
        const multiline = !answer;
        if (multiline) answer = children.map(child => markdown(child)).filter(Boolean).join('\n');
        const extras = multiline ? [] : children.map(child => markdown(child));
        if (!question) addProblem(node, 'empty-question', '這一題 :: 的左邊沒有題目', 'error');
        if (!answer.trim()) addProblem(node, 'missing-answer', '這一題 :: 的底下沒有答案', 'error');
        let typed: readonly string[] | null = null;
        if (target.direction === 'zh-en') {
          // 好幾個正確答案用 | 分開（D-122）：每一段各自去掉格式與前後空白；`a|b` 也認得。指紋仍用整個答案格。
          // 先看整格（W6 §0-1、syntax.md §2-3）：換行、跳脫的管線、行內程式碼、公式；ASCII 的 [ ] < >（Obsidian 與 Markdown
          // 的連結或嵌入、角括號與參照式連結，字面的括號也一起不收）；任何位置不分大小寫的 http(s)://；全形的｜。
          // 都不能當打字答案，不拆開、typed 是 null（換行要在 trim 之前看；Codex 格式查核 F1、F2，L2 的 S1 與它的格式查核）。
          const invalid = (): void => { addProblem(node, 'typed-answer-invalid', '中翻英的答案只能是單行英文單字或片語，好幾個答案用 | 分開；不能有換行、連結、程式碼或公式', 'error'); };
          if (/[\r\n`$[\]<>｜]|\\\||https?:\/\//i.test(answer)) invalid();
          else {
            typed = answer.split('|').map(part => part.replace(/\*\*|\*|_|==/g, '').trim());
            if (typed.some(part => !part || /\p{Script=Han}/u.test(part))) invalid();
            else if (new Set(typed.map(part => part.split(/\s+/).length)).size > 1) {
              addProblem(node, 'typed-answer-words', '好幾個答案的字數不一樣，畫線照第一個');
            }
          }
        }
        return { kind: 'qa', line: node.line, question, answer, extras, typed, fingerprint: fingerprint(question, answer) };
      }
      if (target.direction === 'zh-en') addProblem(node, 'cloze-not-typed', '中翻英的填空題照一般翻面，不要求打字');
      return { kind: 'cloze', line: node.line, text: body, blanks, extras: children.map(child => markdown(child)), fingerprint: fingerprint(body, '') };
    }
    if (implicit) target.prompts.push(prompt(root));
    else for (const child of root.children) {
      if (fieldStart.test(child.text)) continue;
      const syntax = questionSyntax(stripId(child.text).text);
      if (syntax.colon >= 0 || syntax.blanks.length) target.prompts.push(prompt(child));
      else target.shared.push(markdown(child));
    }
    if (!target.prompts.length) {
      // 一般筆記不是目標，不回報它的欄位提示。
      for (let i = problems.length - 1; i >= 0 && problems[i].targetLine === root.line; i--) problems.pop();
      continue;
    }
    if (target.id) {
      if (seenIds.has(target.id)) addProblem(root, 'duplicate-id', '這個學習目標 ID 和同一篇前面的重複；用了同一個 ID 的目標先都不出題，等家長選哪一個是新加的');
      seenIds.add(target.id);
    }
    targets.push(target);
  }
  problems.sort((a, b) => a.line - b.line);
  return { props, targets, problems };
}
