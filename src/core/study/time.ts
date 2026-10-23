const DAY = 86_400_000;
const FOUR_HOURS = 14_400_000;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function formatTime(ms: number, offset: number): string {
  if (!Number.isInteger(offset) || Math.abs(offset) > 1439) throw RangeError('offset 必須是 -1439～1439 的整數分鐘');
  const local = new Date(ms + offset * 60_000).toISOString().slice(0, -1);
  const absolute = Math.abs(offset);
  return local + (offset < 0 ? '-' : '+') + String(Math.floor(absolute / 60)).padStart(2, '0') + ':' + String(absolute % 60).padStart(2, '0');
}

export function dayOf(ms: number, offset: number): number {
  return Math.floor((ms + offset * 60_000 - FOUR_HOURS) / DAY);
}

export function dayStart(day: number, offset: number): number {
  return day * DAY + FOUR_HOURS - offset * 60_000;
}

/** 只接受規格的帶時區時間，拒絕 Date.parse 自動進位的壞日期。 */
export function parseTime(t: string): { at: number; offset: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(t);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 && leap ? 29 : MONTH_DAYS[month - 1];
  if (month < 1 || month > 12 || day < 1 || day > days || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) return null;
  let offset = 0;
  if (m[7] !== 'Z') {
    const hours = Number(m[9]), minutes = Number(m[10]);
    if (hours > 23 || minutes > 59) return null;
    const total = hours * 60 + minutes;
    offset = total === 0 ? 0 : (m[8] === '-' ? -total : total);
  }
  const at = Date.parse(t);
  return Number.isFinite(at) ? { at, offset } : null;
}
