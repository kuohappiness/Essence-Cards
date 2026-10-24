/** 裝置碼的平台名稱（W5 說明 §4-2）；都不是時用 Device。 */
export type DevicePlatform = 'iPhone' | 'iPad' | 'Android' | 'Windows' | 'Mac' | 'Linux' | 'Device';

/** `<平台>-<4 個 0-9a-f>`，例如 `iPhone-7f3a`；紀錄的檔名用它。 */
export function isDeviceCode(value: unknown): value is string {
  return typeof value === 'string' && /^(iPhone|iPad|Android|Windows|Mac|Linux|Device)-[0-9a-f]{4}$/.test(value);
}

/** 存著的碼有效就沿用，否則產生新的；random 回傳 0～65535 的整數。 */
export function deviceCode(saved: unknown, platform: DevicePlatform, random: () => number): string {
  if (isDeviceCode(saved)) return saved;
  return platform + '-' + (random() & 0xffff).toString(16).padStart(4, '0');
}
