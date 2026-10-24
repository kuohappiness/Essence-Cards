import { expandTabs, linesOf, listTree, nameIds, questionSyntax, removeMiddle, TRAILING_ID } from './markdown.ts';
import { parseDeck, readProperties } from './parse.ts';
import type { AssignOptions, AssignResult } from './types.ts';

const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
const space = alphabet.length ** 6;

/**
 * D-135：有題目的明確目標底下第一層的項目，清單符號比目標的內容欄多 4 欄以上（Obsidian 當成目標那一行的接續文字）時，
 * 改回一層，底下的行跟著移同樣的欄數，照原本的縮排字元寫。改完任何目標的解析結果不同就不改（題目、指紋與 ID 必須相同）。
 */
function fixIndent(text: string, skip: ReadonlySet<number> | undefined): string {
  const deck = parseDeck(text);
  const lines = linesOf(text);
  const roots = new Map(listTree(lines, readProperties(lines).start).map(root => [root.line, root]));
  const output = lines.map(line => line.raw);
  let changed = false;
  for (const target of deck.targets) {
    if (target.implicit || target.idCandidates || skip?.has(target.line)) continue;
    const root = roots.get(target.line);
    if (!root) continue;
    // 有正常縮排的兄弟項目時對齊它，後面的題目才不會變成改過那一項的子項目。
    const normal = root.children.find(child => child.indent - root.contentColumn < 4);
    for (const child of root.children) {
      if (child.indent - root.contentColumn < 4) continue;
      const tabs = /^[ \t]*/.exec(lines[child.line].raw)![0].includes('\t');
      const column = normal ? normal.indent : tabs ? Math.ceil(root.contentColumn / 4) * 4 : root.contentColumn;
      const shift = child.indent - column;
      for (let i = child.line; i < child.end; i++) {
        const raw = output[i];
        if (!raw.trim()) continue;
        const indent = /^[ \t]*/.exec(raw)![0];
        const width = Math.max(0, expandTabs(indent).length - shift);
        output[i] = (indent.includes('\t') ? '\t'.repeat(Math.floor(width / 4)) + ' '.repeat(width % 4) : ' '.repeat(width)) + raw.slice(indent.length);
        changed = true;
      }
    }
  }
  if (!changed) return text;
  const fixed = output.map((raw, i) => raw + lines[i].eol).join('');
  return JSON.stringify(parseDeck(fixed).targets) === JSON.stringify(deck.targets) ? fixed : text;
}

export function assignIds(text: string, options: AssignOptions): AssignResult {
  // 縮排改正不增減行，skip 的行號照樣對得上。
  const source = fixIndent(text, options.skip);
  const deck = parseDeck(source);
  const lines = linesOf(source);
  const start = readProperties(lines).start;
  const roots = new Map(listTree(lines, start).map(root => [root.line, root]));
  const existing = lines.flatMap(line => {
    const match = TRAILING_ID.exec(line.raw);
    return match ? [match[1]] : [];
  });
  // 行中被認得的 ID 與 ambiguous-id 的候選也不能配給別的目標。
  const named = deck.targets.flatMap(target => [...(target.id ? [target.id] : []), ...(target.idCandidates ?? [])]);
  const used = new Set([...options.taken, ...existing, ...named]);
  const seen = new Set<string>();
  const random = options.random ?? Math.random;
  function nextId(): string {
    let id = '';
    for (let i = 0; i < 6; i++) {
      const value = random();
      if (!(value >= 0 && value < 1)) throw Error('random 必須回傳 0（含）到 1（不含）');
      id += alphabet[Math.floor(value * alphabet.length)];
    }
    // 固定 random 也要終止：衝突時從抽到的 ID 依字母表順序找下一個。
    for (let attempts = 0; used.has(id); attempts++) {
      if (attempts >= space) throw Error('沒有可用的學習目標 ID');
      const chars = [...id];
      for (let i = 5; i >= 0; i--) {
        const next = (alphabet.indexOf(chars[i]) + 1) % alphabet.length;
        chars[i] = alphabet[next];
        if (next) break;
      }
      id = chars.join('');
    }
    used.add(id);
    return id;
  }
  const assigned: AssignResult['assigned'] = [];
  const output = lines.map(line => ({ ...line }));
  const insertions = new Map<number, { raw: string; eol: string }>();
  // 有使用 Tab 縮排的清單或接續行時，這篇筆記沿用 Tab。
  const unit = lines.some(line => /^[ \t]*\t/.test(line.raw)) ? '\t' : '    ';
  const fallbackEol = lines.find(line => line.eol)?.eol ?? '\n';
  let added = 0, moved = false;
  for (const target of deck.targets) {
    // 待處理的目標不補、不移動；它的 ID 仍算在重複的判斷裡。ambiguous-id 不動，等家長選（D-134）。
    if (options.skip?.has(target.line)) { if (target.id) seen.add(target.id); continue; }
    if (target.idCandidates) continue;
    if (target.implicit) {
      const syntax = questionSyntax(target.name);
      if (!target.name || syntax.colon >= 0 || syntax.blanks.length) continue;
    }
    const duplicate = target.id !== null && seen.has(target.id);
    if (target.id) seen.add(target.id);
    if (target.id && !duplicate && !options.replace?.has(target.id)) {
      // 歸位：行中的 ID 移回行尾，其他字一字不動。
      const raw = output[target.line].raw;
      const found = nameIds(raw);
      if (found.middle.length) {
        output[target.line].raw = removeMiddle(raw, found.middle) + (found.trailing ? '' : ' ^' + target.id);
        moved = true;
      }
      continue;
    }
    const id = nextId();
    assigned.push({ line: target.line + added, id });
    if (target.implicit) {
      const root = roots.get(target.line)!;
      const indent = lines[target.line].raw.match(/^[ \t]*/)![0];
      // 題目裡像 ID 的字不帶進新的名稱那一行，否則它會變成 ambiguous-id。
      const name = removeMiddle(target.name, nameIds(target.name).middle).trim();
      insertions.set(target.line, { raw: indent + '- ' + name + ' ^' + id, eol: lines[target.line].eol || fallbackEol });
      for (let i = root.line; i < root.end; i++) if (output[i].raw.trim()) output[i].raw = unit + output[i].raw;
      added++;
    } else {
      const raw = removeMiddle(output[target.line].raw, nameIds(output[target.line].raw).middle);
      output[target.line].raw = TRAILING_ID.test(raw) ? raw.replace(/\^[A-Za-z0-9-]+(?=[ \t]*$)/, '^' + id) : raw + ' ^' + id;
    }
  }
  if (!assigned.length && !moved) return { text: source, assigned };
  return { text: output.map((line, index) => {
    const inserted = insertions.get(index);
    return (inserted ? inserted.raw + inserted.eol : '') + line.raw + line.eol;
  }).join(''), assigned };
}
