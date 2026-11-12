import { parseData, parseLoadData, readSaved } from './saved.ts';
import type { Saved } from './saved.ts';
import { MISSING, SettingsChanged } from './store.ts';
import type { RestoreBase, SettingsStore, WriteCheck } from './store.ts';

// 設定檔 `Essence Cards/設定.json`（tasks/settings-vault-file.md §1～§3）：內容、疊 legacy、讀寫與缺檔保護。不碰 Obsidian；檔案與 localStorage 由外層交進來。

/** 設定檔的位置：vault 裡的一般檔，跟著 iCloud 同步（D-199 的修法 A）。 */
export const SETTINGS_FILE = 'Essence Cards/設定.json';

/** 設定頁管的項目；學期與設定日是一項（syntax §10）。 */
const ITEMS: readonly (readonly string[])[] = [['capMinutes'], ['retention'], ['semester', 'semesterSetOn'], ['examCountdown']];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const has = (record: Readonly<Record<string, unknown>>, key: string): boolean => Object.hasOwn(record, key);

/** data.json 裡那五個欄位（照原樣，含讀不懂的值；沒有的不列）。 */
function fieldsOf(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of ITEMS.flat()) if (has(data, key)) picked[key] = data[key];
  return picked;
}

/** data.json 的這一項是設定頁存得出來的值（readSaved 讀得懂；學期要兩欄都對）。 */
function readable(data: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const picked: Record<string, unknown> = {};
  for (const key of keys) if (has(data, key)) picked[key] = data[key];
  return readSaved(picked)[keys[0] as keyof Saved] !== null;
}

/**
 * 疊 legacy（§2）：設定檔的 legacy 是物件、data（讀到的 data.json）也是物件時，逐項比（照原樣），不同的那幾項換成 data 的：
 * 它整項都沒有就刪掉（回預設），讀得懂就換成它的值；讀不懂的（不是設定頁的選項、學期缺一半）不採用，留設定檔的
 * （格式查核第 3 節：那是壞掉或手改，不是舊版設定頁存的）。舊版那台在設定檔建立之後改的項目，新版採用。
 * 其他情況照設定檔原樣。不改傳進來的物件；legacy 不在這裡換。
 */
export function overlayLegacy(file: Readonly<Record<string, unknown>>, data: unknown): Record<string, unknown> {
  const next = { ...file };
  const legacy: unknown = file.legacy;
  if (!isObject(legacy) || !isObject(data)) return next;
  const from: Record<string, unknown> = data;
  for (const keys of ITEMS) {
    const same = keys.every(key => has(legacy, key) === has(from, key) && JSON.stringify(legacy[key]) === JSON.stringify(from[key]));
    if (same) continue;
    if (keys.some(key => has(from, key)) && !readable(from, keys)) continue;
    for (const key of keys) {
      delete next[key];
      if (has(from, key)) next[key] = from[key];
    }
  }
  return next;
}

/**
 * 讀的時候換好的 legacy（格式查核第 3 節）：和疊出這份內容的同一次 data.json，之後的存檔照寫，
 * 疊上的值與 legacy 一起落進設定檔；當底之後才變的 data.json 不算看過，下次讀還會疊。data 不是物件就沿用設定檔原本的。
 */
function seenLegacy(file: Readonly<Record<string, unknown>>, data: unknown): Record<string, unknown> | null {
  return isObject(data) ? fieldsOf(data) : isObject(file.legacy) ? file.legacy : null;
}

/** 拿掉 legacy：還原與重新建立的底稿（§4）。寫入時改用當下的 data.json，讀不到是 null，不沿用設定檔原本的。 */
export function dropLegacy(raw: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next = { ...raw };
  delete next.legacy;
  return next;
}

/**
 * 寫進設定檔的文字（§1）：交來的有 legacy 就照寫（讀時換好的，不是物件寫 null）；沒有（還原、重新建立）才用 data，
 * data 不是物件是 null。legacy 放最後，兩格縮排加換行。
 */
export function encodeSettings(next: Readonly<Record<string, unknown>>, data: unknown): string {
  const legacy = has(next, 'legacy') ? isObject(next.legacy) ? next.legacy : null : legacyOf(data);
  return JSON.stringify({ ...dropLegacy(next), legacy }, null, 2) + '\n';
}

/** 讀到的 data.json 寫成 legacy 的樣子：物件取那五個欄位（照原樣），不是物件（不存在、讀不懂）是 null。 */
function legacyOf(data: unknown): Record<string, unknown> | null {
  return isObject(data) ? fieldsOf(data) : null;
}

/** 設定檔的內容：含 NUL（iCloud 還沒下載完，D-154）、不是 JSON 物件都算讀不到（undefined）。 */
export function decodeSettings(bytes: Uint8Array): Record<string, unknown> | undefined {
  if (bytes.includes(0)) return undefined;
  return parseData(bytes) ?? undefined;
}

/**
 * 比對時讀到的設定檔原文（L2 的 R2）：寫入那一刻拿它和 Files.modify 交來的內容比。開頭的 BOM 留著，
 * 和電腦上 vault.process 讀到的一樣（Node 以 utf8 讀檔不拿掉 BOM）；不存在是 null。
 */
export function settingsText(bytes: Uint8Array | null): string | null {
  return bytes === null ? null : new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

/**
 * 外掛還原「設定」的底（tasks/settings-vault-file.md §4）：比對時讀到的設定檔（file）與 data.json（data）的位元組，不存在是 null。
 * 當底是拿掉 legacy 的設定檔（沒有或讀不懂是空的）；寫入那一刻比設定檔的原文（L2 的 R2），寫之前比 data.json 的五個欄位，
 * data.json 照 Obsidian 的 loadData 讀（第二輪的 R7）。
 */
export function restoreBase(file: Uint8Array | null, data: Uint8Array | null): RestoreBase {
  return {
    raw: dropLegacy((file === null ? null : decodeSettings(file)) ?? {}),
    expect: settingsText(file),
    legacy: legacyOf(data === null ? null : parseLoadData(data)),
  };
}

/** Files.watch 通知的路徑是不是設定檔（含改名的舊路徑）：大小寫與 Unicode 正規化不同也算，和 Files 同路徑排隊的比法相同。 */
export function isSettingsPath(path: string): boolean {
  const key = (text: string): string => text.normalize('NFC').toLowerCase();
  return key(path) === key(SETTINGS_FILE);
}

export interface SettingsFileIo {
  /** Files.readBytes：不存在回 null，讀不到丟錯。 */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Files.modify：原地寫，不存在時建立含上層資料夾。edit 拿到的是寫入那一刻的內容，丟錯就不寫。 */
  modify(path: string, edit: (text: string, exists: boolean) => string): Promise<void>;
  /** 舊版的 data.json（Obsidian 的 loadData）：沒有回 null，讀不到回 undefined。新版只讀不寫（§1）。 */
  loadData(): Promise<unknown>;
  /** 這台上次確認的設定（vault 專用的 localStorage，§3）：原樣交回，沒有是 null。 */
  confirmed(): unknown;
  confirm(fields: Record<string, unknown>): void;
  /** 「設定檔讀不到」那一列該出現或消失（§3）。 */
  onMissing?(): void;
  /** 記確認或通知時丟錯：不影響讀，交給外層記下。 */
  onError?(error: unknown): void;
}
export interface SettingsFile {
  /**
   * 給 store 的 load（§2、§3）：設定檔疊完 legacy、換好 legacy 的內容（store 採用了才記確認，adopted）；設定檔不存在時，確認過回 MISSING（不見），
   * 沒確認過照舊交出 data.json（物件時加上它自己的五個欄位當 legacy；null、undefined 照原樣）；設定檔讀不到回 undefined。
   */
  load(): Promise<unknown>;
  /**
   * 給 store 的 save（§2）：照 encodeSettings 寫進設定檔，不碰 data.json；交來的沒有 legacy 才讀 data.json。
   * check（還原、重新建立）：寫入那一刻設定檔不是 expect 這段原文（null 是要不存在，L2 的 R2），或寫 legacy 讀到的 data.json
   * 五個欄位和 check.legacy 不同（第二輪的 R7），就丟 SettingsChanged、不寫。
   */
  save(data: unknown, check?: WriteCheck): Promise<void>;
  /** 這台上次確認的五個欄位；沒有或讀不懂是 null。給 store 的 seed（§3）。 */
  confirmed(): Record<string, unknown> | null;
  /**
   * 給 store 的 adopted（§3）：store 採用的是 load 從設定檔讀出來的內容，才記下這台確認過的五個欄位（疊完的）。
   * 照 data.json 讀的不算；load 回來了但沒被採用的（逾時之後才到、寫前當底）不記，本機的值和畫面上的一致（L2 的 R4）。
   */
  adopted(raw: Readonly<Record<string, unknown>>): void;
  /** 這台確認過設定檔、最近一次讀時它不存在：設定頁顯示「重新建立」（§3）。 */
  missing(): boolean;
  /** 重新建立（§3）：走 store 的隊伍，再讀一次還是不存在才寫，內容是確認過的五個欄位加 legacy；檔已經回來回 changed、不寫。 */
  recreate(store: Pick<SettingsStore, 'restore'>): ReturnType<SettingsStore['restore']>;
}

/** 設定檔的讀寫（tasks/settings-vault-file.md §2、§3）：store 的隊伍、核對、known 的規則不變，只換讀寫的對象。 */
export function createSettingsFile(io: SettingsFileIo): SettingsFile {
  /** loadData 拒絕和讀不到一樣（Obsidian 自己會吞掉錯誤，這裡只是不讓它變成程式的錯）。 */
  const data = (): Promise<unknown> => new Promise<unknown>(resolve => { resolve(io.loadData()); }).catch(() => undefined);
  let missing = false;
  /** load 從設定檔讀出來交給 store 的內容（照 data.json 讀的不在裡面）：store 採用了才記確認。 */
  const fromFile = new WeakSet<object>();
  /** localStorage 丟錯當成沒確認過：這台照舊讀 data.json，和這一版之前一樣。 */
  function confirmed(): Record<string, unknown> | null {
    let value: unknown;
    try { value = io.confirmed(); } catch (error) { io.onError?.(error); return null; }
    return isObject(value) ? fieldsOf(value) : null;
  }
  function remember(fields: Record<string, unknown>): void {
    if (JSON.stringify(confirmed()) === JSON.stringify(fields)) return;
    try { io.confirm(fields); } catch (error) { io.onError?.(error); }
  }
  function setMissing(next: boolean): void {
    if (missing === next) return;
    missing = next;
    try { io.onMissing?.(); } catch (error) { io.onError?.(error); }
  }
  return {
    confirmed,
    missing: () => missing,
    async load() {
      let bytes: Uint8Array | null;
      try { bytes = await io.readBytes(SETTINGS_FILE); } catch { return undefined; }
      if (bytes === null) {
        // 確認過：不回到 data.json 的舊值，也不當成「沒有檔」的預設值；手上的值不變、known 變 false，等家長重新建立或檔回來（§3）。
        if (confirmed() === null) {
          const content = await data();
          return isObject(content) ? { ...content, legacy: fieldsOf(content) } : content;
        }
        setMissing(true);
        return MISSING;
      }
      setMissing(false);
      const file = decodeSettings(bytes);
      if (!file) return undefined;
      const seen = await data();
      const merged = { ...overlayLegacy(file, seen), legacy: seenLegacy(file, seen) };
      fromFile.add(merged);
      return merged;
    },
    adopted(raw) {
      if (fromFile.has(raw)) remember(fieldsOf(raw));
    },
    recreate(store) {
      const fields = confirmed();
      if (fields === null) return Promise.resolve('unreadable');
      // 比對時不存在就以空的當底（只寫確認過的五個欄位）；回來了就不寫，寫入那一刻才回來也一樣（L2 的 R2）。讀不到丟錯，store 回 unreadable。
      return store.restore(fields, async () => await io.readBytes(SETTINGS_FILE) === null ? { raw: {}, expect: null } : null);
    },
    async save(next, check) {
      if (!isObject(next)) throw Error('設定要是 JSON 物件');
      const seen = has(next, 'legacy') ? undefined : await data();
      // 比對時算現在的值用的 data.json 和寫 legacy 的這一次不同：舊版那台在中間改了設定，現在的值已經不是比對時那一份（第二輪的 R7）。
      if (check?.legacy !== undefined && !has(next, 'legacy') && JSON.stringify(legacyOf(seen)) !== JSON.stringify(check.legacy)) throw new SettingsChanged();
      const text = encodeSettings(next, seen);
      await io.modify(SETTINGS_FILE, (now, exists) => {
        // 比對之後、這一刻之前同步來的檔不蓋掉（L2 的 R2）：讀 data.json 的等待裡也可能到。
        if (check && (check.expect === null ? exists : !exists || now !== check.expect)) throw new SettingsChanged();
        return text;
      });
    },
  };
}
