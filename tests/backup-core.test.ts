import test from 'node:test';
import assert from 'node:assert/strict';
import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { backupName, hashBytes, lastVersions, logSource, missingLogLines, openBackup, planRestore, readBuild, readManifest, restoreLogName, writeZip } from '../src/core/backup/index.ts';
import type { BackupManifest, PlannedFile } from '../src/core/backup/index.ts';
import { isDeviceCode } from '../src/state/index.ts';
import { sameFileKey } from '../tools/vault-io.ts';
import { goal, review } from './helpers/vault.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const NOW = Date.UTC(2026, 10, 2, 12, 15, 3, 250);

function manifestOf(files: Record<string, string>, extra: Partial<BackupManifest> = {}): BackupManifest {
  return {
    format: 'essence-cards-backup', version: 1, vault: { name: 'Essence', path: 'D:/Notes/Essence', config: '.obsidian' },
    build: '0.1.0+1a2b3c4', tool: '0.1.0+1a2b3c4', by: 'backup',
    started: '2026-11-02T20:15:03.250+08:00', finished: '2026-11-02T20:15:05.004+08:00', scope: '說明',
    files: Object.entries(files).map(([path, text]) => ({ path, size: bytes(text).length, sha256: hashBytes(bytes(text)) })),
    absent: [], excluded: [], notes: [], ...extra,
  };
}
const filesOf = (files: Record<string, string>): Map<string, Uint8Array> => new Map(Object.entries(files).map(([path, text]) => [path, bytes(text)]));
const zipOf = (files: Record<string, string>, extra: Partial<BackupManifest> = {}): Uint8Array => writeZip(manifestOf(files, extra), filesOf(files), new Date(NOW));

/** 用串流的 Zip 組 zip：可以放同名的項目（zipSync 的物件做不到）。 */
function rawZip(entries: [string, string][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
  for (const [name, text] of entries) {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(strToU8(text), true);
  }
  zip.end();
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}
const opened = (zip: Uint8Array): string => { const result = openBackup(zip); return result.ok ? 'ok' : result.error; };

/** 把 zip 裡（本地標頭與中央目錄，或只有本地標頭）檔名 from 的那個位元組換成 byte，並設定或清掉 UTF-8 旗標。 */
function patchName(zip: Uint8Array, from: string, at: number, byte: number, utf8: boolean, only?: 'local'): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  const name = new TextEncoder().encode(from);
  let patched = 0;
  for (let p = 0; p + name.length <= out.length; p++) {
    if (!name.every((value, i) => out[p + i] === value)) continue;
    const flags = p >= 30 && view.getUint32(p - 30, true) === 0x04034b50 ? p - 24 : !only && p >= 46 && view.getUint32(p - 46, true) === 0x02014b50 ? p - 38 : -1;
    if (flags < 0) continue;
    out[p + at] = byte;
    view.setUint16(flags, utf8 ? view.getUint16(flags, true) | 0x800 : view.getUint16(flags, true) & ~0x800, true);
    patched++;
  }
  assert.equal(patched, only ? 1 : 2);
  return out;
}

void test('還原檔名的裝置碼和 state 的 isDeviceCode 一致；只去掉最後完整的「 還原 <日期> <裝置碼>」，衝突副本的 2 留著', () => {
  for (const platform of ['iPhone', 'iPad', 'Android', 'Windows', 'Mac', 'Linux', 'Device', 'Foo', 'iphone']) {
    const stripped = logSource(`2026-10 iPhone-7f3a 還原 2026-11-02 ${platform}-1a2b.jsonl`) === '2026-10 iPhone-7f3a';
    assert.equal(stripped, isDeviceCode(platform + '-1a2b'), platform);
  }
  assert.equal(logSource('2026-10 iPhone-7f3a.jsonl'), '2026-10 iPhone-7f3a');
  assert.equal(logSource('2026-10 iPhone-7f3a 2.jsonl'), '2026-10 iPhone-7f3a 2');
  assert.equal(logSource('2026-10 iPhone-7f3a 2 還原 2026-11-02 Windows-2c9e.jsonl'), '2026-10 iPhone-7f3a 2');
  assert.equal(logSource('2026-10 iPhone-7f3a 還原 2026-11-02-3 Windows-2c9e.jsonl'), '2026-10 iPhone-7f3a');
  assert.equal(logSource('2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2c9e 2.jsonl'), '2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2c9e 2');
  assert.equal(logSource('2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2C9E.jsonl'), '2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2C9E');
  const taken = new Set(['A 還原 2026-11-02 Windows-2c9e.jsonl', 'A 還原 2026-11-02-2 Windows-2c9e.jsonl']);
  assert.equal(restoreLogName('A', '2026-11-02', 'Windows-2c9e', name => taken.has(name)), 'A 還原 2026-11-02-3 Windows-2c9e.jsonl');
  assert.equal(restoreLogName('A', '2026-11-03', 'Windows-2c9e', name => taken.has(name)), 'A 還原 2026-11-03 Windows-2c9e.jsonl');
});

void test('還原檔排在來源檔正前面，衝突副本與它的還原檔又在前面；別台裝置不會插進中間（syntax §5-3 的排序論證）', () => {
  const names = ['2026-10 iPhone-7f3a.jsonl', '2026-10 iPhone-7f3a 2.jsonl', '2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2c9e.jsonl',
    '2026-10 iPhone-7f3a 還原 2026-11-02-2 Windows-2c9e.jsonl', '2026-10 iPhone-7f3a 2 還原 2026-11-02 Linux-0000.jsonl',
    '2026-10 iPhone-7f3b.jsonl', '2026-10 iPad-7f3a.jsonl', '2026-10 iPhone-7f39.jsonl', '2026-11 iPhone-7f3a.jsonl', '2026-09 iPhone-7f3a.jsonl'];
  assert.deepEqual([...names].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), [
    '2026-09 iPhone-7f3a.jsonl', '2026-10 iPad-7f3a.jsonl', '2026-10 iPhone-7f39.jsonl',
    '2026-10 iPhone-7f3a 2 還原 2026-11-02 Linux-0000.jsonl', '2026-10 iPhone-7f3a 2.jsonl',
    '2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2c9e.jsonl', '2026-10 iPhone-7f3a 還原 2026-11-02-2 Windows-2c9e.jsonl', '2026-10 iPhone-7f3a.jsonl',
    '2026-10 iPhone-7f3b.jsonl', '2026-11 iPhone-7f3a.jsonl']);
});

void test('備份檔名與 main.js 的建置版本：第一行的註解、舊建置的「版本」命令文字、讀不出來是未知', () => {
  assert.equal(backupName(NOW, 480, '0.1.0+1a2b3c4', 'a3f9'), 'Essence Cards 備份 2026-11-02 201503 0.1.0+1a2b3c4 a3f9.zip');
  assert.equal(backupName(NOW, 480, null, '0000'), 'Essence Cards 備份 2026-11-02 201503 未知 0000.zip');
  assert.equal(backupName(NOW, 480, '../x', '0000'), 'Essence Cards 備份 2026-11-02 201503 未知 0000.zip');
  assert.deepEqual(readBuild('/*! Essence Cards build=0.1.0+1a2b3c4 dev=false */\n"use strict";'), { build: '0.1.0+1a2b3c4', dev: false });
  assert.deepEqual(readBuild('/*! Essence Cards build=0.0.1+5d357fa.dirty dev=true */'), { build: '0.0.1+5d357fa.dirty', dev: true });
  assert.deepEqual(readBuild('"use strict";callback:()=>{new ui.Notice("Essence Cards\\uFF1A0.0.1+5d357fa")}'), { build: '0.0.1+5d357fa', dev: null });
  assert.deepEqual(readBuild('"use strict";'), { build: null, dev: null });
});

void test('清單讀得懂：缺欄位、version 不認得或不是整數、size 不是非負整數、sha256 不是 64 個小寫十六進位、路徑超出範圍都拒絕', () => {
  const good = manifestOf({ 'Essence Cards/a.md': 'a' });
  assert.ok(readManifest(JSON.stringify(good)).ok);
  const bad = (change: (data: Record<string, unknown>) => void): string => {
    const data = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    change(data);
    const result = readManifest(JSON.stringify(data));
    return result.ok ? 'ok' : result.error;
  };
  const file = (data: Record<string, unknown>): Record<string, unknown> => (data.files as Record<string, unknown>[])[0];
  for (const key of ['format', 'version', 'vault', 'build', 'tool', 'by', 'started', 'finished', 'scope', 'files', 'absent', 'excluded', 'notes']) {
    assert.notEqual(bad(data => { delete data[key]; }), 'ok', key);
  }
  assert.match(bad(data => { data.version = 2; }), /比這個程式認得的（1）新/);
  assert.notEqual(bad(data => { data.version = '1'; }), 'ok');
  assert.notEqual(bad(data => { data.version = 1.5; }), 'ok');
  assert.equal(bad(data => { data.build = null; }), 'ok');
  assert.equal(bad(data => { data.extra = '不認得的欄位忽略'; }), 'ok');
  assert.notEqual(bad(data => { delete (data.vault as Record<string, unknown>).config; }), 'ok');
  assert.notEqual(bad(data => { data.started = '2026-11-02 20:15'; }), 'ok');
  for (const size of [1.5, -1, '1', null]) assert.match(bad(data => { file(data).size = size; }), /size 不是非負整數/);
  for (const sha of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), 1]) assert.match(bad(data => { file(data).sha256 = sha; }), /sha256/);
  for (const path of ['其他/a.md', 'Essence Cards/../x.md', '/Essence Cards/a.md', 'C:/Essence Cards/a.md', 'Essence Cards\\a.md',
    'Essence Cards//a.md', 'Essence Cards/./a.md', 'Essence Cards', '.obsidian/plugins/essence-cards/main.js', '.obsidian/../.obsidian/plugins/essence-cards/data.json']) {
    assert.match(bad(data => { file(data).path = path; }), /不在備份的範圍內/, path);
  }
  assert.equal(bad(data => { file(data).path = '.obsidian/plugins/essence-cards/data.json'; }), 'ok');
  assert.match(bad(data => { data.files = [file(data), file(data)]; }), /重複/);
  assert.notEqual(bad(data => { data.absent = ['其他/data.json']; }), 'ok');
  assert.notEqual(bad(data => { data.notes = [{ path: 'a' }]; }), 'ok');
});

void test('zip 與清單一一對應：同名的項目、兩個 manifest.json、多出或少了檔、大小或雜湊不同都整份拒絕', () => {
  const files = { 'Essence Cards/a.md': 'a', 'Essence Cards/b.md': 'b' };
  assert.equal(opened(zipOf(files)), 'ok');
  const manifest = JSON.stringify(manifestOf(files));
  assert.equal(opened(rawZip([['manifest.json', manifest], ['Essence Cards/a.md', 'a'], ['Essence Cards/b.md', 'b']])), 'ok');
  assert.match(opened(rawZip([['manifest.json', manifest], ['Essence Cards/a.md', 'a'], ['Essence Cards/a.md', 'a'], ['Essence Cards/b.md', 'b']])), /重複/);
  assert.match(opened(rawZip([['manifest.json', manifest], ['manifest.json', manifest], ['Essence Cards/a.md', 'a'], ['Essence Cards/b.md', 'b']])), /manifest\.json 不是恰好一個/);
  assert.match(opened(rawZip([['manifest.json', manifest], ['Essence Cards/a.md', 'a']])), /Essence Cards\/b\.md 不在 zip 裡/);
  assert.match(opened(rawZip([['manifest.json', manifest], ['Essence Cards/a.md', 'a'], ['Essence Cards/b.md', 'b'], ['Essence Cards/c.md', 'c']])), /c\.md 不在清單的 files 裡/);
  assert.match(opened(rawZip([['manifest.json', manifest], ['Essence Cards/a.md', 'a'], ['Essence Cards/b.md', 'bb']])), /大小和清單不同/);
  assert.match(opened(rawZip([['manifest.json', manifest], ['Essence Cards/a.md', 'a'], ['Essence Cards/b.md', 'c']])), /雜湊和清單不同/);
  assert.match(opened(rawZip([['manifest.json', manifest.replace('"version":1', '"version":2')]])), /清單讀不懂/);
  assert.match(opened(bytes('not a zip')), /找不到 zip 的中央目錄/);
});

void test('zip 的檔名要是 UTF-8：壞掉的位元組或沒有 UTF-8 旗標的非 ASCII 名稱都拒絕，不被寬鬆解碼成清單裡的名字（Codex 中途查核 F6）', () => {
  const name = 'Essence Cards/x.md', at = 'Essence Cards/'.length;
  const zipWith = (listed: string): Uint8Array => rawZip([['manifest.json', JSON.stringify(manifestOf({ [listed]: 'x' }))], [name, 'x']]);
  assert.match(opened(rawZip([['manifest.json', JSON.stringify(manifestOf({ [name]: 'x' }))], [name, 'x']])), /^ok$/);
  assert.match(opened(patchName(zipWith('Essence Cards/�.md'), name, at, 0xff, true)), /檔名不是 UTF-8/);
  assert.match(opened(patchName(zipWith('Essence Cards/é.md'), name, at, 0xe9, false)), /檔名不是 UTF-8/);
  // 只有本地標頭的名稱壞掉（中央目錄與清單都正常）也拒絕（Codex 再查 R3）。
  assert.match(opened(patchName(zipOf({ [name]: 'x' }), name, at, 0xff, true, 'local')), /本地標頭/);
  // 中文名稱照 UTF-8 寫（fflate 對非 ASCII 名稱設旗標），照常讀得到。
  assert.equal(opened(zipOf({ 'Essence Cards/國二上/水溶液.md': 'x' })), 'ok');
});

void test('缺的行：trim 後比、空行不算、原樣保留未知欄位與壞行；現在有的不補；最後一行是現在某一行的開頭時不算缺；還原檔算回來源', () => {
  const a = '{"t":"2026-10-28T10:00:00.000+08:00","lt":"abc123","r":"good","v":"12345678","retry":"right","x":1}';
  const b = '{"t":"2026-10-28T10:01:00.000+08:00","need":"9.0.0","lt":"def456","r":"miss","v":"12345678"}';
  const broken = '{"t":"unfinished","lt":"old123"{"t":"2026-10-28T10:02:00.000+08:00","lt":"ghi789","r":"good","v":"12345678"}';
  const partial = '{"t":"2026-10-28T10:03:00.000+08:00","lt":"abc1';
  const whole = '{"t":"2026-10-28T10:03:00.000+08:00","lt":"abc123","r":"good","v":"12345678"}';
  const log = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
  const restored = 'Essence Cards/紀錄/2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2c9e.jsonl';
  const c = '{"t":"2026-10-28T10:04:00.000+08:00","lt":"c00001","r":"good","v":"12345678"}';
  const backup = [
    { path: log, text: `  ${a}\r\n\n${b}\n${broken}\n${whole}\n` },
    { path: restored, text: c + '\n' },
    { path: 'Essence Cards/紀錄/2026-10 iPad-0000.jsonl', text: partial },
    { path: 'Essence Cards/紀錄/子資料夾/2026-10 iPhone-7f3a.jsonl', text: a },
  ];
  assert.deepEqual(missingLogLines(backup, [{ path: log, text: a + '\n' }, { path: 'Essence Cards/紀錄/2026-10 iPad-0000.jsonl', text: whole + '\n' }]),
    [{ source: '2026-10 iPhone-7f3a', lines: [c, b, broken, whole] }]);
  // 第二次：補過的行在還原檔裡，不再缺。
  assert.deepEqual(missingLogLines(backup, [
    { path: log, text: a + '\n' }, { path: 'Essence Cards/紀錄/2026-10 iPhone-7f3a 還原 2026-11-03 Linux-1111.jsonl', text: [c, b, broken, whole].join('\n') + '\n' },
    { path: 'Essence Cards/紀錄/2026-10 iPad-0000.jsonl', text: whole + '\n' },
  ]), []);
  // 最後一行的開頭規則只用在那個檔的最後一行。
  assert.deepEqual(missingLogLines([{ path: log, text: partial + '\n' + a }], [{ path: log, text: whole + '\n' + a }]), [{ source: '2026-10 iPhone-7f3a', lines: [partial] }]);
});

const plan = (backup: Record<string, string>, current: Record<string, string>, options: { config?: string | null; platform?: NodeJS.Platform; selection?: string[]; source?: string } = {}) => {
  const manifest = manifestOf(backup);
  if (options.source) manifest.vault.config = options.source;
  return planRestore({ manifest, backup: filesOf(backup), current: filesOf(current), config: options.config === undefined ? '.obsidian' : options.config,
    sameFile: sameFileKey(options.platform ?? 'linux'), selection: options.selection && new Set(options.selection) });
};
const summary = (files: PlannedFile[]): string[] => files.map(file => `${file.path} ${file.kind} ${file.action}${file.reasons.length ? '：' + file.reasons.join('；') : ''}`);

void test('還原計畫：改過的、不見的可以還原，相同的不列，備份後才有的不動；紀錄裡的其他檔只補不見的', () => {
  const result = plan({
    'Essence Cards/改過.md': goal('aaa111'), 'Essence Cards/不見.md': goal('bbb222'), 'Essence Cards/相同.md': goal('ccc333'),
    'Essence Cards/紀錄/AI 輸出/快照.md': '舊', 'Essence Cards/紀錄/AI 輸出/不見的快照.md': '快照',
  }, {
    'Essence Cards/改過.md': goal('aaa111', '新答案'), 'Essence Cards/相同.md': goal('ccc333'), 'Essence Cards/新的.md': goal('ddd444'),
    'Essence Cards/紀錄/AI 輸出/快照.md': '新',
  });
  assert.deepEqual(summary(result.files), [
    'Essence Cards/不見.md missing restore', 'Essence Cards/改過.md changed restore',
    'Essence Cards/紀錄/AI 輸出/不見的快照.md missing restore',
    'Essence Cards/紀錄/AI 輸出/快照.md changed blocked：紀錄裡的檔只補不見的：同名但內容不同，列成衝突',
    'Essence Cards/新的.md added keep']);
  assert.deepEqual(result.config, { source: '.obsidian', target: '.obsidian' });
});

void test('還原計畫：Essence Cards/A.md 和 a.md 在 Windows 上兩個都擋住，在 Linux 上照常', () => {
  const backup = { 'Essence Cards/A.md': goal('aaa111'), 'Essence Cards/a.md': goal('bbb222') };
  assert.deepEqual(summary(plan(backup, {}, { platform: 'win32' }).files), [
    'Essence Cards/A.md missing blocked：和「Essence Cards/a.md」在這台電腦會寫到同一個檔，兩個都不還原',
    'Essence Cards/a.md missing blocked：和「Essence Cards/A.md」在這台電腦會寫到同一個檔，兩個都不還原']);
  assert.deepEqual(summary(plan(backup, {}, { platform: 'linux' }).files), ['Essence Cards/A.md missing restore', 'Essence Cards/a.md missing restore']);
  // 現在的檔只差大小寫：Windows 上寫進現在那一個，不另開一個。
  const renamed = plan({ 'Essence Cards/A.md': goal('aaa111') }, { 'Essence Cards/a.md': goal('aaa111', '改過') }, { platform: 'win32' });
  assert.deepEqual(summary(renamed.files), ['Essence Cards/A.md changed restore']);
  assert.equal(renamed.files[0].current?.path, 'Essence Cards/a.md');
});

void test('還原計畫：data.json 從清單的設定資料夾對到現在的；確定不了就擋住；對應之後撞名兩個都擋住', () => {
  const data = { '.obsidian-family/plugins/essence-cards/data.json': '{"a":1}' };
  const moved = plan(data, { '.obsidian/plugins/essence-cards/data.json': '{"a":2}' }, { source: '.obsidian-family', config: '.obsidian' });
  assert.deepEqual(moved.files.map(file => [file.path, file.target, file.kind, file.action]),
    [['.obsidian-family/plugins/essence-cards/data.json', '.obsidian/plugins/essence-cards/data.json', 'changed', 'restore']]);
  assert.deepEqual(moved.config, { source: '.obsidian-family', target: '.obsidian' });
  const unknown = plan(data, {}, { source: '.obsidian-family', config: null });
  assert.deepEqual(unknown.files.map(file => [file.target, file.kind, file.action]), [[null, 'unmapped', 'blocked']]);
  assert.match(unknown.files[0].reasons[0], /設定資料夾確定不了.*不推定成 \.obsidian/);
  const collide = plan({ ...data, 'Essence Cards/conf/plugins/essence-cards/data.json': '{}' }, {}, { source: '.obsidian-family', config: 'Essence Cards/conf' });
  assert.deepEqual(collide.files.map(file => file.action), ['blocked', 'blocked']);
});

void test('全庫 ID 檢查：照選擇還原後的所有卡組；同一篇裡重複也算；目標搬到別篇時只還原一篇會擋住、兩篇一起還原不會', () => {
  // 備份：A 有 aaa111、bbb222；之後 bbb222 搬到 B。
  const backup = { 'Essence Cards/A.md': goal('aaa111') + goal('bbb222'), 'Essence Cards/B.md': goal('ccc333') };
  const current = { 'Essence Cards/A.md': goal('aaa111', '改字'), 'Essence Cards/B.md': goal('ccc333') + goal('bbb222'), 'Essence Cards/C.md': goal('ddd444') };
  assert.deepEqual(summary(plan(backup, current).files), ['Essence Cards/A.md changed restore', 'Essence Cards/B.md changed restore', 'Essence Cards/C.md added keep']);
  assert.deepEqual(summary(plan(backup, current, { selection: ['Essence Cards/A.md'] }).files), [
    'Essence Cards/A.md changed blocked：學習目標 ID bbb222 現在在「Essence Cards/B.md」', 'Essence Cards/B.md changed skip', 'Essence Cards/C.md added keep']);
  const twice = plan({ 'Essence Cards/A.md': goal('aaa111') + goal('aaa111') }, {});
  assert.deepEqual(summary(twice.files), ['Essence Cards/A.md missing blocked：學習目標 ID aaa111 在同一篇裡重複']);
  // 擋住一篇之後，原本靠它避開重複的另一篇也要擋住：eee555 在備份之後從 B 搬到 A，A 因為別的原因擋住，B 就不能還原。
  const chain = plan({ 'Essence Cards/A.md': goal('aaa111'), 'Essence Cards/B.md': goal('bbb222') + goal('eee555') },
    { 'Essence Cards/A.md': goal('aaa111') + goal('eee555'), 'Essence Cards/B.md': goal('bbb222'), 'Essence Cards/C.md': goal('aaa111', '別篇') });
  assert.deepEqual(summary(chain.files), [
    'Essence Cards/A.md changed blocked：學習目標 ID aaa111 現在在「Essence Cards/C.md」',
    'Essence Cards/B.md changed blocked：學習目標 ID eee555 現在在「Essence Cards/A.md」',
    'Essence Cards/C.md added keep']);
  // ambiguous 目標的候選 ID 也算占用（同 state 的 targetIds；Codex 中途查核 F4），現在的與備份的都算，同一個目標只算一次。
  const ambiguous = '- 能說明 ^abc234 及其他 ^bcd345\n    - 題目 :: 答案\n';
  assert.deepEqual(summary(plan({ 'Essence Cards/A.md': goal('abc234') }, { 'Essence Cards/B.md': ambiguous }).files), [
    'Essence Cards/A.md missing blocked：學習目標 ID abc234 現在在「Essence Cards/B.md」', 'Essence Cards/B.md added keep']);
  assert.deepEqual(summary(plan({ 'Essence Cards/A.md': ambiguous }, { 'Essence Cards/B.md': goal('bcd345') }).files), [
    'Essence Cards/A.md missing blocked：學習目標 ID bcd345 現在在「Essence Cards/B.md」', 'Essence Cards/B.md added keep']);
  assert.deepEqual(summary(plan({ 'Essence Cards/A.md': ambiguous }, {}).files), ['Essence Cards/A.md missing restore']);
  // 寫入順序（Codex 中途查核 F1）：加回的 ID 現在在另一篇裡，那一篇先寫；兩篇交換了目標就排不出來，兩篇都擋住。
  const moved = plan({ 'Essence Cards/A.md': goal('aaa111') + goal('bbb222'), 'Essence Cards/B.md': goal('ccc333') },
    { 'Essence Cards/A.md': goal('aaa111'), 'Essence Cards/B.md': goal('ccc333') + goal('bbb222') });
  assert.deepEqual([moved.order, moved.files.map(file => file.after)], [['Essence Cards/B.md', 'Essence Cards/A.md'], [['Essence Cards/B.md'], []]]);
  const swapped = plan({ 'Essence Cards/A.md': goal('aaa111'), 'Essence Cards/B.md': goal('bbb222'), 'Essence Cards/C.md': goal('ccc333') },
    { 'Essence Cards/A.md': goal('bbb222'), 'Essence Cards/B.md': goal('aaa111') });
  assert.deepEqual(summary(swapped.files), [
    'Essence Cards/A.md changed blocked：要先還原「Essence Cards/B.md」，讓它們釋放這一篇加回的學習目標 ID，但彼此互相等待（例如交換了目標），不能逐檔安全還原',
    'Essence Cards/B.md changed blocked：要先還原「Essence Cards/A.md」，讓它們釋放這一篇加回的學習目標 ID，但彼此互相等待（例如交換了目標），不能逐檔安全還原',
    'Essence Cards/C.md missing restore']);
  assert.deepEqual(swapped.order, ['Essence Cards/C.md']);
  const both = plan({ 'Essence Cards/A.md': goal('aaa111'), 'Essence Cards/B.md': goal('aaa111', '另一篇') }, {});
  assert.deepEqual(summary(both.files), [
    'Essence Cards/A.md missing blocked：學習目標 ID aaa111 還原的「Essence Cards/B.md」也有',
    'Essence Cards/B.md missing blocked：學習目標 ID aaa111 還原的「Essence Cards/A.md」也有']);
});

void test('每台裝置最後回報的版本：從帶來源的原始行算，兩台時間與值相同也各列一台；同來源同時間不同值是不確定；衝突副本與還原檔另標', () => {
  const app = (t: string, val: string): string => JSON.stringify({ t, set: 'app', val });
  const L = 'Essence Cards/紀錄/';
  const T1 = '2026-10-28T10:00:00.000+08:00', T2 = '2026-11-02T09:00:00.000+08:00';
  const rows = lastVersions([
    // Codex 第一次回應的探針：兩台裝置同一刻回報同一個版本，合併後的 changes 只剩一筆，這裡要有兩台。
    { path: L + '2026-10 iPhone-7f3a.jsonl', text: app(T1, '0.1.0+1a2b3c4') + '\n' + review(T1, 'abc123') + '\n' },
    { path: L + '2026-10 Windows-2c9e.jsonl', text: app(T1, '0.1.0+1a2b3c4') + '\n{"t":"壞掉\n' },
    // 下個月的檔更新：取最晚的。
    { path: L + '2026-11 Windows-2c9e.jsonl', text: app(T2, '0.1.1+9f8e7d6') + '\n' },
    { path: L + '2026-10 iPad-0000.jsonl', text: app(T1, '0.1.0+1a2b3c4') + '\n' + app(T1, '0.0.1+5d357fa') + '\n' },
    { path: L + '2026-10 iPhone-7f3a 2.jsonl', text: app(T2, '0.1.1+9f8e7d6') + '\n' },
    { path: L + '2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2c9e.jsonl', text: app(T2, '0.0.1+0000000') + '\n' },
    { path: L + '子資料夾/2026-10 Mac-1111.jsonl', text: app(T1, '9.9.9') + '\n' },
  ]);
  assert.deepEqual(rows.map(row => [row.device, row.build, row.t, row.note]), [
    ['Windows-2c9e', '0.1.1+9f8e7d6', T2, null],
    ['iPad-0000', null, T1, '不確定'],
    ['iPhone-7f3a', '0.1.0+1a2b3c4', T1, null],
    ['iPhone-7f3a', '0.1.1+9f8e7d6', T2, '衝突副本'],
    ['iPhone-7f3a', '0.0.1+0000000', T2, '還原檔'],
  ]);
  assert.equal(rows[0].source, L + '2026-11 Windows-2c9e.jsonl');
  assert.equal(rows[4].source, L + '2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2c9e.jsonl');
  // 還原檔的衝突副本也是還原檔，不算目前版本，歸原來的裝置（Codex 第二輪 L4）。
  const copy = L + '2026-10 iPhone-7f3a 還原 2026-11-02 Windows-2c9e 2.jsonl';
  assert.deepEqual(lastVersions([{ path: copy, text: app(T2, '0.0.1+0000000') + '\n' }]).map(row => [row.device, row.note, row.source]),
    [['iPhone-7f3a', '還原檔', copy]]);
});

// syntax.md §0-1：先看標記，讀不懂的那一行其他內容都不拿來用，版本行也一樣。version 是讀的那一方的正式版號，不傳是版本不明。
void test('每台裝置最後回報的版本：need 讀不懂的版本行不算，讀得懂的照算', () => {
  const T1 = '2026-10-28T10:00:00.000+08:00', T2 = '2026-11-02T09:00:00.000+08:00';
  const text = JSON.stringify({ t: T1, set: 'app', val: '0.1.0+1a2b3c4' }) + '\n' + JSON.stringify({ t: T2, need: '0.2.0', set: 'app', val: '0.2.0+9f8e7d6' }) + '\n';
  const rows = (version?: string | null) => lastVersions([{ path: 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl', text }], version).map(row => row.build);
  assert.deepEqual(rows('0.1.0'), ['0.1.0+1a2b3c4']);
  assert.deepEqual(rows('0.2.0'), ['0.2.0+9f8e7d6']);
  assert.deepEqual(rows(), ['0.1.0+1a2b3c4']);
  assert.deepEqual(rows(null), ['0.1.0+1a2b3c4']);
});

// 技術債「讀備份時，zip 的註解裡剛好有 EOCD 簽章」：先依檔尾與長度辨認有效的 EOCD，嚴格名稱檢查與解壓用同一份結構。
/** 在 zip 的 EOCD 後面接上註解（改註解長度欄位）。 */
function withComment(zip: Uint8Array, comment: Uint8Array): Uint8Array {
  const out = new Uint8Array(zip.length + comment.length);
  out.set(zip);
  out.set(comment, zip.length);
  new DataView(out.buffer).setUint16(zip.length - 22 + 20, comment.length, true);
  return out;
}
/** 一個 EOCD 的 22 個位元組：筆數、中央目錄的大小與位置、註解長度。 */
function eocd(count: number, size: number, offset: number, comment: number): Uint8Array {
  const out = new Uint8Array(22);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true); view.setUint16(10, count, true);
  view.setUint32(12, size, true); view.setUint32(16, offset, true); view.setUint16(20, comment, true);
  return out;
}

void test('EOCD：一般註解、註解裡剛好有 EOCD 簽章、註解裡偽造一個長度剛好到檔尾的 EOCD，合法的 zip 都讀得到', () => {
  const zip = zipOf({ 'Essence Cards/a.md': 'A' });
  assert.equal(opened(withComment(zip, bytes('一般的註解'))), 'ok');
  assert.equal(opened(withComment(zip, new Uint8Array([0x50, 0x4b, 0x05, 0x06, 1, 2, 3]))), 'ok');
  // 偽造的 EOCD 放在註解最後：它的註解長度 0 剛好到檔尾，但中央目錄不在它前面，不採用。
  assert.equal(opened(withComment(zip, eocd(0, 0, 0, 0))), 'ok');
  // Codex L2 B4：偽造的候選帶 ZIP64 的標記（筆數 0xffff），也要略過、繼續往前找真正的 EOCD。
  assert.equal(opened(withComment(zip, eocd(0xffff, 0, 0, 0))), 'ok');
});

void test('EOCD：唯一的 EOCD 帶 ZIP64 的標記時照舊拒絕（不支援 ZIP64）', () => {
  const zip = zipOf({ 'Essence Cards/a.md': 'A' }).slice();
  const view = new DataView(zip.buffer);
  const end = zip.length - 22;
  view.setUint16(end + 8, 0xffff, true);
  view.setUint16(end + 10, 0xffff, true);
  view.setUint32(end + 16, 0xffffffff, true);
  assert.equal(opened(zip), '不支援 ZIP64');
});

void test('EOCD：中央目錄越界、筆數不一致、註解長度對不到檔尾、截短，都被拒絕', () => {
  const zip = zipOf({ 'Essence Cards/a.md': 'A' });
  const end = zip.length - 22;
  const broken = (patch: (view: DataView) => void): string => {
    const copy = zip.slice();
    patch(new DataView(copy.buffer));
    return opened(copy);
  };
  assert.equal(broken(view => { view.setUint32(end + 16, view.getUint32(end + 16, true) + 1, true); }), '找不到 zip 的中央目錄');
  assert.equal(broken(view => { view.setUint16(end + 8, 9, true); }), '找不到 zip 的中央目錄');
  assert.equal(broken(view => { view.setUint16(end + 20, 5, true); }), '找不到 zip 的中央目錄');
  assert.equal(opened(zip.subarray(0, zip.length - 1)), '找不到 zip 的中央目錄');
});
