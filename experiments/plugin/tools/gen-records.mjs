import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export function generate({ months = 36, daily = 150, startYear = 2024, startMonth = 0, seed = 20261019 } = {}) {
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const files = new Map();
  for (let m = 0; m < months; m++) {
    const first = new Date(Date.UTC(startYear, startMonth + m, 1));
    const year = first.getUTCFullYear(), month = first.getUTCMonth();
    const ym = first.toISOString().slice(0, 7);
    const buckets = [[], []];
    const stamp = (day, ms) => ym + '-' + String(day).padStart(2, '0') + 'T' + new Date(Date.UTC(2000, 0, 1, 19, 0, 0, ms)).toISOString().slice(11, 23) + '+08:00';
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      for (let i = 0; i < daily; i++) {
        const device = random() < 0.8 ? 0 : 1, ms = i * Math.floor(10800000 / Math.max(daily, 1));
        const lt = Math.floor(random() * 3000).toString(36).padStart(6, '0');
        const row = { t: stamp(day, ms), lt, r: ['miss', 'near', 'good', 'easy'][Math.floor(random() * 4)], v: Math.floor(random() * 0xffffffff).toString(16).padStart(8, '0') };
        buckets[device].push(row);
        if (random() < 0.01) {
          buckets[device].push({ t: stamp(day, ms + 1), undo: row.t });
          buckets[device].push({ ...row, t: stamp(day, ms + 2), r: row.r === 'good' ? 'near' : 'good' });
        }
      }
    }
    for (let device = 0; device < 2; device++) {
      buckets[device].push({ t: ym + '-01T18:00:00.000+08:00', set: 'cap', val: 30 });
      buckets[device].push({ t: ym + '-02T18:00:00.000+08:00', set: 'status', deck: 'Essence-T2/範例卡組.md', val: '啟用' });
      buckets[device].push({ t: ym + '-03T18:00:00.000+08:00', set: 'filter', val: [] });
      buckets[device].sort((a, b) => a.t.localeCompare(b.t));
      files.set(ym + ' ' + ['iPhone-7f3a', 'Windows-2c9e'][device] + '.jsonl', buckets[device].map(x => JSON.stringify(x)).join('\n') + '\n');
    }
  }
  return files;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('用法：npm run gen-records -- <輸出資料夾>');
  const dest = resolve(process.argv[2]);
  await mkdir(dest, { recursive: true });
  const files = generate(); let lines = 0, bytes = 0;
  for (const [name, content] of files) { await writeFile(join(dest, name), content); lines += content.trimEnd().split('\n').length; bytes += Buffer.byteLength(content); }
  console.log(JSON.stringify({ files: files.size, lines, bytes }));
}
