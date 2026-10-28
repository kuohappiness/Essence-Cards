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
 * 讀一份備份並照 syntax §8「讀備份的一方」驗過：清單讀得懂、zip 與清單一一對應、路徑在範圍內。
 * 不過就整份不用，不出計畫、不比較。
 */
export function openBackup(bytes: Uint8Array): Checked<OpenedBackup> {
  const names: string[] = [];
  let unzipped: Record<string, Uint8Array>;
  try {
    // filter 對中央目錄的每一項都會呼叫一次，同名的項目也是；unzipSync 的結果是物件，同名的會互相蓋掉。
    unzipped = unzipSync(bytes, { filter: file => { names.push(file.name); return true; } });
  } catch (error) {
    return { ok: false, error: '不是讀得懂的 zip：' + (error instanceof Error ? error.message : String(error)) };
  }
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
