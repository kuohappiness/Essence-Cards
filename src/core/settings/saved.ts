import type { Settings } from '../study/index.ts';

// data.json 裡的設定（tasks/settings-page.md §1、§2）：選項、預設值、讀與改。不碰 Obsidian；讀寫檔由外層傳進來（store.ts）。

/** 每日時間上限的選項（分鐘，D-104）。 */
export const CAP_MINUTES: readonly number[] = [5, 10, 15, 20, 30, 45, 60, 75, 90];
/** 目標保持率的選項（D-078）。 */
export const RETENTIONS: readonly number[] = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
export const DEFAULT_SETTINGS: Settings = { capMinutes: 30, retention: 0.8, filter: [] };

const GRADES = ['小一', '小二', '小三', '小四', '小五', '小六', '國一', '國二', '國三', '高一', '高二', '高三'];
/** 目前學期的選項，照順序（D-104）。 */
export const SEMESTERS: readonly string[] = GRADES.flatMap(grade => [grade + '上', grade + '下']);

/** 使用者選的學期與選的那一天；現在的學期由 semesterOn 算，不寫回檔案（§4）。 */
export interface SemesterPick { value: string; setOn: string }
/** 檔案裡讀得懂的值；沒存或讀不懂是 null。 */
export interface Saved { capMinutes: number | null; retention: number | null; semester: SemesterPick | null; examCountdown: boolean | null }
/** 現在生效的設定（交給 state）。known 是 false：data.json 還沒讀到，這裡是預設值。 */
export interface SettingsValue { settings: Settings; semester: SemesterPick | null; examCountdown: boolean; known: boolean }
/** 這次要改的一項；value 是 null 就是恢復預設（刪掉）。 */
export type SettingsChange =
  | { key: 'capMinutes'; value: number | null }
  | { key: 'retention'; value: number | null }
  | { key: 'semester'; value: SemesterPick | null }
  | { key: 'examCountdown'; value: boolean | null };
export type SettingsKey = SettingsChange['key'];

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 真的有這一天（`2027-02-29` 不算）；曆法的算術，不靠本機時區。 */
function isDate(text: string): boolean {
  const match = DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number | undefined;
  return days !== undefined && day >= 1 && day <= days;
}

export function readSaved(raw: Record<string, unknown>): Saved {
  const { capMinutes, retention, semester, semesterSetOn, examCountdown } = raw;
  return {
    capMinutes: typeof capMinutes === 'number' && CAP_MINUTES.includes(capMinutes) ? capMinutes : null,
    retention: typeof retention === 'number' && RETENTIONS.includes(retention) ? retention : null,
    semester: typeof semester === 'string' && SEMESTERS.includes(semester) && typeof semesterSetOn === 'string' && isDate(semesterSetOn) ? { value: semester, setOn: semesterSetOn } : null,
    examCountdown: typeof examCountdown === 'boolean' ? examCountdown : null,
  };
}

export function valueOf(saved: Saved, known: boolean): SettingsValue {
  return {
    settings: { capMinutes: saved.capMinutes ?? DEFAULT_SETTINGS.capMinutes, retention: saved.retention ?? DEFAULT_SETTINGS.retention, filter: DEFAULT_SETTINGS.filter },
    semester: saved.semester,
    examCountdown: saved.examCountdown ?? true,
    known,
  };
}

/** 檔案裡有這一項（讀不懂的值也算）：恢復預設看它，有存過才顯示。 */
export function savedKeys(raw: Record<string, unknown>): SettingsKey[] {
  const keys: SettingsKey[] = [];
  for (const key of ['capMinutes', 'retention', 'examCountdown'] as const) if (key in raw) keys.push(key);
  if ('semester' in raw || 'semesterSetOn' in raw) keys.push('semester');
  return keys;
}

/** 以 raw 為底，只改這一項（D-149 第 7 點）；不改傳進來的物件。 */
export function changeSaved(raw: Readonly<Record<string, unknown>>, change: SettingsChange): Record<string, unknown> {
  const next = { ...raw };
  if (change.key === 'semester') {
    delete next.semester;
    delete next.semesterSetOn;
    if (change.value) { next.semester = change.value.value; next.semesterSetOn = change.value.setOn; }
  } else if (change.value === null) delete next[change.key];
  else next[change.key] = change.value;
  return next;
}

/** raw 裡這一項是不是這次要存的樣子（存完讀回來核對）。 */
export function hasChange(raw: Readonly<Record<string, unknown>>, change: SettingsChange): boolean {
  if (change.key !== 'semester') return change.value === null ? !(change.key in raw) : raw[change.key] === change.value;
  if (change.value === null) return !('semester' in raw) && !('semesterSetOn' in raw);
  return raw.semester === change.value.value && raw.semesterSetOn === change.value.setOn;
}

/**
 * 今天（`YYYY-MM-DD`，清晨 4 點換日）是哪個學期（§4）：從選的那天之後走過每個 2/1 與 8/1。
 * 2/1 換成同年級的下學期；8/1 下學期換成下一個年級的上學期，已經是上學期就不動；高三下不動。
 */
export function semesterOn(pick: SemesterPick, today: string): string {
  let at = SEMESTERS.indexOf(pick.value);
  if (at < 0) return pick.value;
  const from = Number(pick.setOn.slice(0, 4)), to = Number(today.slice(0, 4));
  for (let year = from; year <= to; year++) {
    for (const [month, half] of [['02-01', 1], ['08-01', 0]] as const) {
      const date = `${String(year)}-${month}`;
      if (date <= pick.setOn || date > today) continue;
      // 雙數是上學期、單數是下學期。
      if (half === 1 && at % 2 === 0) at += 1;
      else if (half === 0 && at % 2 === 1 && at < SEMESTERS.length - 1) at += 1;
    }
  }
  return SEMESTERS[at];
}
