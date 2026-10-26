import { Platform, type App } from 'obsidian';
import { deviceCode, type DevicePlatform } from '../state/index.ts';

const key = 'essence-cards-device';

function platform(): DevicePlatform {
  if (Platform.isIosApp) return Platform.isTablet ? 'iPad' : 'iPhone';
  if (Platform.isAndroidApp) return 'Android';
  if (Platform.isWin) return 'Windows';
  if (Platform.isMacOS) return 'Mac';
  if (Platform.isLinux) return 'Linux';
  return 'Device';
}

/**
 * 這台裝置的碼：存在這個 vault 專用的 localStorage，不存外掛的 data.json
 * （那個資料夾跟著 iCloud 同步，會讓兩台裝置拿到同一個碼，D-110）。
 */
export function loadDeviceCode(app: App): string {
  const saved: unknown = app.loadLocalStorage(key);
  const code = deviceCode(saved, platform(), () => crypto.getRandomValues(new Uint16Array(1))[0]);
  if (code !== saved) app.saveLocalStorage(key, code);
  return code;
}
