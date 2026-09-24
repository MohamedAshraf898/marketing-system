// Wall-clock helpers for IANA time zones (no dependencies: Intl only).
// Attendance is decided in the zone of a person's work schedule ("late" means late in Cairo, not late in UTC).

const DAY_MS = 86_400_000;
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** The wall-clock reading of instant `d` in `tz`. */
export function zonedParts(d: Date, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(d)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour === 24 ? 0 : out.hour, minute: out.minute, second: out.second };
}

/** Minutes `tz` is ahead of UTC at instant `t`. */
export function offsetMinutes(t: number, tz: string): number {
  const p = zonedParts(new Date(t), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60_000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** yyyy-mm-dd of instant `d` in `tz`. */
export function localDateKey(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight of instant `d` in `tz`. */
export function localMinuteOfDay(d: Date, tz: string): number {
  const p = zonedParts(d, tz);
  return p.hour * 60 + p.minute;
}

/** "HH:MM" -> minutes since midnight (null when malformed). */
export function parseHm(hm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The instant at which the wall clock in `tz` shows `dateKey` + `minutes` after midnight (DST-safe). */
export function zonedToUtc(dateKey: string, minutes: number, tz: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0) + minutes * 60_000;
  let t = guess - offsetMinutes(guess, tz) * 60_000;
  const second = guess - offsetMinutes(t, tz) * 60_000; // re-check once across a DST change
  if (second !== t) t = second;
  return new Date(t);
}

/** Date-only value (UTC midnight) for a yyyy-mm-dd key - the storage convention for every date column. */
export const dateOnly = (key: string) => new Date(`${key}T00:00:00.000Z`);
export const keyOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDaysKey = (key: string, n: number) => keyOf(new Date(dateOnly(key).getTime() + n * DAY_MS));
/** 0 = Sunday ... 6 = Saturday of a yyyy-mm-dd key (the weekday of that calendar date, zone independent). */
export const weekdayOfKey = (key: string) => dateOnly(key).getUTCDay();

/** Every yyyy-mm-dd key from `from` to `to` inclusive (capped for safety). */
export function eachDayKey(from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  for (let k = from; k <= to && out.length < max; k = addDaysKey(k, 1)) out.push(k);
  return out;
}
