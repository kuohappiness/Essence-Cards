// Fable 的副本：和 compare.mjs 相同，只多掛一個候選讀法 readers-fable.mjs；評分邏輯一個字都沒改。
// 試作：用獨立出題、人工標答案的考卷比較幾種出處的讀法。評分標準寫在 README，跑之前就定好。
//   node experiments/source-reading/compare.mjs <考卷.json> [--list 讀法名稱]
import { readFileSync } from 'node:fs';
import { CONTEXTS, readCurrent, readSmall, readScan, readScanCarry, wellShaped } from './readers.mjs';
import { readFable } from './readers-fable.mjs';

const READERS = { 現在: readCurrent, 小修: readSmall, 重寫: readScan, 重寫加學期: readScanCarry, Fable: readFable };
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const listing = process.argv.includes('--list') ? process.argv[process.argv.indexOf('--list') + 1] : null;

const placeKey = (place, key) => `${place.scope === 'this' ? 'this' : key(place.scope)}|${place.kind}|${place.value}`.toLowerCase();

/** 一題對一種可接受的讀法：列出差異。 */
function diff(read, expected, key) {
  const wantUnits = expected.units.map(key), wantPlaces = expected.places.map(place => placeKey(place, key));
  const gotPlaces = read.places.map(place => placeKey(place, key));
  return {
    extra: read.units.filter(unit => !wantUnits.includes(key(unit))),
    missing: expected.units.filter(unit => !read.units.map(key).includes(key(unit))),
    lost: wantPlaces.filter(place => !gotPlaces.includes(place)),
    wrong: gotPlaces.filter(place => !wantPlaces.includes(place)),
  };
}
const size = d => d.extra.length * 100 + d.missing.length * 100 + d.lost.length + d.wrong.length;

function score(reader, one) {
  const ctx = CONTEXTS[one.context], read = reader(one.text, ctx);
  const options = [one, ...(one.alt ?? [])].map(expected => diff(read, { units: expected.units ?? [], places: expected.places ?? [] }, reader.key));
  const best = options.reduce((a, b) => size(b) < size(a) ? b : a);
  const flags = [];
  for (const unit of best.extra) {
    const code = unit.split(' ').slice(1).join(' ');
    const real = Object.keys(ctx.units).some(each => reader.key(each) === reader.key(unit)) || wellShaped(code);
    if (!real) flags.push('假單元');
    else flags.push(read.hint ? '多算但有提示' : '多算沒提示');
  }
  if (best.missing.length) flags.push(read.hint ? (one.clear ? '要家長改' : '') : '漏算沒提示');
  if (!read.hint && best.lost.length) flags.push('位置默默丟');
  if (!read.hint && best.wrong.length) flags.push('位置默默錯');
  const hasContent = (one.units?.length ?? 0) + (one.places?.length ?? 0) > 0;
  if (read.hint && one.clear && hasContent && !flags.includes('要家長改')) flags.push('要家長改');
  return { flags: flags.filter(Boolean), read };
}

const COLUMNS = ['多算沒提示', '漏算沒提示', '多算但有提示', '假單元', '位置默默丟', '位置默默錯', '要家長改', '全對'];
const groups = ['全部', ...new Set(cases.map(one => one.group))];
for (const group of groups) {
  const subset = group === '全部' ? cases : cases.filter(one => one.group === group);
  console.log(`\n== ${group}（${subset.length} 題）\n讀法`.padEnd(8) + ' ' + COLUMNS.join(' '));
  for (const [name, reader] of Object.entries(READERS)) {
    const counts = Object.fromEntries(COLUMNS.map(column => [column, 0]));
    for (const one of subset) {
      const { flags } = score(reader, one);
      if (!flags.length) counts.全對++;
      for (const flag of flags) counts[flag]++;
    }
    console.log(name.padEnd(8) + ' ' + COLUMNS.map(column => String(counts[column]).padStart(column.length * 2)).join(' '));
  }
}
if (listing) {
  console.log(`\n== ${listing} 沒全對的題目`);
  for (const one of cases) {
    const { flags, read } = score(READERS[listing], one);
    if (flags.length) console.log(`${String(one.id).padStart(3)} ${one.group} ${JSON.stringify(one.text)} ${flags.join('、')}\n     讀成 ${JSON.stringify(read)}\n     標答 ${JSON.stringify({ units: one.units, places: one.places, clear: one.clear, alt: one.alt })} ${one.note ?? ''}`);
  }
}
