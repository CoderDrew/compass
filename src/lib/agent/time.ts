// Time-zone aware date helpers for code that runs on a server (UTC) on behalf of a user
// whose weeks and "today" are defined in their own time zone.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Strict Compass due value: a real calendar date (YYYY-MM-DD) or a real month (YYYY-MM). */
export function isStrictDue(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (/^\d{4}-\d{2}$/.test(s)) {
    const m = Number(s.slice(5));
    return m >= 1 && m <= 12;
  }
  return isIsoDate(s);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date (YYYY-MM-DD) at instant `now` in `timeZone`. */
export function localDateIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const toUTC = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday on or before the given date. */
export function mondayOf(iso: string): string {
  const ms = toUTC(iso);
  const dow = (new Date(ms).getUTCDay() + 6) % 7; // Mon = 0
  return fromUTC(ms - dow * 86_400_000);
}

export const isMonday = (iso: string) => isIsoDate(iso) && mondayOf(iso) === iso;

/** Monday of the current week in the user's time zone. */
export const currentWeekStart = (timeZone: string, now: Date) => mondayOf(localDateIn(timeZone, now));

/** Whole days from `fromIso` to `toIso` (calendar dates). */
export const daysBetween = (fromIso: string, toIso: string) => Math.round((toUTC(toIso) - toUTC(fromIso)) / 86_400_000);

/**
 * A Date whose *local* calendar date equals the user's date. Compass selectors compare
 * calendar dates using local time, so this keeps them correct on a UTC server.
 */
export function userToday(timeZone: string, now: Date): Date {
  const [y, m, d] = localDateIn(timeZone, now).split('-').map(Number);
  return new Date(y, m - 1, d);
}
