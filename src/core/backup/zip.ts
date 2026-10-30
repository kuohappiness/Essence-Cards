import { unzipSync, zipSync } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { BACKUP_FORMAT, checkArchive, MANIFEST_NAME, readManifest } from './manifest.ts';
import type { BackupManifest, Checked } from './manifest.ts';

/** 原始位元組的 SHA-256，小寫十六進位。 */
export const hashBytes = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));

/**
 * zip 用 fflate（純 JS、沒有相依、電腦與手機都能跑；之後外掛內的備份也用它，要能過 D-148 的建置檢查）。
 * 檔名一律 UTF-8；manifest.json 放最前面，其他照路徑的字元碼排序。mtime 只是 zip 的欄位，比對不看它。
 */
export function writeZip(manifest: BackupManifest, files: ReadonlyMap<string, Uint8Array>, mtime: Date): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = Object.create(null) as Record<string, [Uint8Array, { mtime: Date }]>;
  entries[MANIFEST_NAME] = [new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n'), { mtime }];
  for (const path of [...files.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) entries[path] = [files.get(path)!, { mtime }];
  return zipSync(entries, { level: 6 });
}

export interface OpenedBackup { manifest: BackupManifest; files: Map<string, Uint8Array> }

/**
 * 中央目錄的結尾（EOCD）的位置（技術債「讀備份時，zip 的註解裡剛好有 EOCD 簽章」）：從檔尾往前找，只採用註解長度剛好到檔尾、
 * 只有一個磁碟、兩個筆數一致、中央目錄剛好接在它前面的那一個；註解裡的簽章或偽造的 EOCD 不採用。找不到回傳錯誤訊息。
 */
function endOfDirectory(bytes: Uint8Array): number | string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = bytes.length - 22; at >= 0 && at >= bytes.length - 22 - 0xffff; at--) {
    if (view.getUint32(at, true) !== 0x06054b50 || at + 22 + view.getUint16(at + 20, true) !== bytes.length) continue;
    const count = view.getUint16(at + 10, true), size = view.getUint32(at + 12, true), offset = view.getUint32(at + 16, true);
    if (view.getUint16(at + 4, true) !== 0 || view.getUint16(at + 6, true) !== 0 || view.getUint16(at + 8, true) !== count) continue;
    if (count === 0xffff || offset === 0xffffffff) return '不支援 ZIP64';
    if (offset + size === at) return at;
  }
  return '找不到 zip 的中央目錄';
}

/**
 * zip 中央目錄裡每一項的檔名，照 syntax §8 嚴格當 UTF-8 解碼：非 ASCII 的名稱要有 UTF-8 旗標（第 11 位元）、位元組要是
 * 合法的 UTF-8；ASCII 名稱不用旗標。fflate 會先寬鬆解碼（壞位元組變成 U+FFFD、沒有旗標的照 Latin1），所以自己讀原始位元組
 * （Codex 中途查核 F6）。end 是 endOfDirectory 找到的位置。讀不懂中央目錄或檔名不合規回傳錯誤訊息。
 */
function strictNames(bytes: Uint8Array, end: number): string[] | string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return '中央目錄壞了';
    const length = view.getUint16(at + 28, true);
    const raw = bytes.subarray(at + 46, at + 46 + length);
    const ascii = !raw.some(byte => byte >= 0x80);
    if (!ascii) {
      if ((view.getUint16(at + 8, true) & 0x800) === 0) return '檔名不是 UTF-8（沒有 UTF-8 旗標）';
      try { names.push(decoder.decode(raw)); } catch { return '檔名不是 UTF-8（位元組不合法）'; }
    } else names.push(String.fromCharCode(...raw));
    // 每一項的本地標頭也要是同一個名稱（位元組相同、非 ASCII 有 UTF-8 旗標）：別的讀取端可能照本地標頭命名（Codex 再查 R3）。
    const local = view.getUint32(at + 42, true);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return '本地標頭壞了：' + names.at(-1)!;
    const localLength = view.getUint16(local + 26, true);
    const localName = bytes.subarray(local + 30, local + 30 + localLength);
    if (localLength !== length || localName.some((byte, i) => byte !== raw[i])) return '本地標頭的檔名和中央目錄不同：' + names.at(-1)!;
    if (!ascii && (view.getUint16(local + 6, true) & 0x800) === 0) return '本地標頭的檔名不是 UTF-8（沒有 UTF-8 旗標）：' + names.at(-1)!;
    at += 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return names;
}

/**
 * 讀一份備份並照 syntax §8「讀備份的一方」驗過：清單讀得懂、zip 與清單一一對應、路徑在範圍內。
 * 不過就整份不用，不出計畫、不比較。
 */
export function openBackup(bytes: Uint8Array): Checked<OpenedBackup> {
  const end = endOfDirectory(bytes);
  if (typeof end === 'string') return { ok: false, error: end };
  // 解壓與嚴格名稱檢查用同一份結構：有註解時去掉註解，fflate 從檔尾找到的就是 endOfDirectory 採用的這一個。
  let body = bytes;
  if (end + 22 !== bytes.length || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(end + 20, true) !== 0) {
    body = bytes.slice(0, end + 22);
    new DataView(body.buffer).setUint16(end + 20, 0, true);
  }
  const names: string[] = [];
  let unzipped: Record<string, Uint8Array>;
  try {
    // filter 對中央目錄的每一項都會呼叫一次，同名的項目也是；unzipSync 的結果是物件，同名的會互相蓋掉。
    unzipped = unzipSync(body, { filter: file => { names.push(file.name); return true; } });
  } catch (error) {
    return { ok: false, error: '不是讀得懂的 zip：' + (error instanceof Error ? error.message : String(error)) };
  }
  const strict = strictNames(body, end);
  if (typeof strict === 'string') return { ok: false, error: strict };
  if (strict.length !== names.length || strict.some((name, i) => name !== names[i])) return { ok: false, error: '檔名不是 UTF-8（和 zip 讀到的名稱不同）' };
  if (names.filter(name => name === MANIFEST_NAME).length !== 1) return { ok: false, error: 'zip 裡的 ' + MANIFEST_NAME + ' 不是恰好一個' };
  const raw = Object.hasOwn(unzipped, MANIFEST_NAME) ? unzipped[MANIFEST_NAME] : null;
  if (!raw) return { ok: false, error: 'zip 裡的 ' + MANIFEST_NAME + ' 讀不到' };
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { return { ok: false, error: '清單不是 UTF-8' }; }
  const manifest = readManifest(text);
  if (!manifest.ok) return { ok: false, error: '清單讀不懂：' + manifest.error };
  if (manifest.value.format !== BACKUP_FORMAT) return { ok: false, error: '不是 Essence Cards 的備份' };
  const files = new Map<string, Uint8Array>();
  for (const name of names) if (name !== MANIFEST_NAME && Object.hasOwn(unzipped, name)) files.set(name, unzipped[name]);
  const checked = checkArchive(names, files, manifest.value, hashBytes);
  if (!checked.ok) return checked;
  return { ok: true, value: { manifest: manifest.value, files } };
}
