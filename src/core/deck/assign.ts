import { linesOf, listTree } from './markdown.ts';
import { parseDeck, readProperties } from './parse.ts';
import type { AssignOptions, AssignResult } from './types.ts';

const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
const space = alphabet.length ** 6;

export function assignIds(text: string, options: AssignOptions): AssignResult {
  const deck = parseDeck(text);
  const lines = linesOf(text);
  const start = readProperties(lines).start;
  const roots = new Map(listTree(lines, start).map(root => [root.line, root]));
  const existing = lines.flatMap(line => {
    const match = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/.exec(line.raw);
    return match ? [match[1]] : [];
  });
  const used = new Set([...options.taken, ...existing]);
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
  let added = 0;
  for (const target of deck.targets) {
    const duplicate = target.id !== null && seen.has(target.id);
    if (target.id) seen.add(target.id);
    if (target.id && !duplicate && !options.replace?.has(target.id)) continue;
    const id = nextId();
    assigned.push({ line: target.line + added, id });
    if (target.implicit) {
      const root = roots.get(target.line)!;
      const indent = lines[target.line].raw.match(/^[ \t]*/)![0];
      insertions.set(target.line, { raw: indent + '- ' + target.name + ' ^' + id, eol: lines[target.line].eol || fallbackEol });
      for (let i = root.line; i < root.end; i++) if (output[i].raw.trim()) output[i].raw = unit + output[i].raw;
      added++;
    } else {
      const raw = output[target.line].raw;
      output[target.line].raw = target.id ? raw.replace(/\^[A-Za-z0-9-]+(?=[ \t]*$)/, '^' + id) : raw + ' ^' + id;
    }
  }
  if (!assigned.length) return { text, assigned };
  return { text: output.map((line, index) => {
    const inserted = insertions.get(index);
    return (inserted ? inserted.raw + inserted.eol : '') + line.raw + line.eol;
  }).join(''), assigned };
}
