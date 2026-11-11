import type { DueString } from '../data/types.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-date ISO string YYYY-MM-DD. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday of the week containing `d`, as YYYY-MM-DD. */
export function weekStartOf(d: Date): string {
  const day = (d.getDay() + 6) % 7; // Mon=0
  return toISODate(addDays(startOfDay(d), -day));
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export interface ParsedDue {
  /** For month-precision values this is the first day of the month (earliest possible). */
  date: Date;
  precision: 'day' | 'month';
}

export function isValidDue(s: unknown): s is DueString {
  return typeof s === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(s);
}

export function parseDue(s?: DueString): ParsedDue | null {
  if (!s || !isValidDue(s)) return null;
  const precision = s.length === 7 ? 'month' : 'day';
  return { date: parseISODate(s), precision };
}

/** Whole days from `today` to the due value (negative = past). */
export function daysUntil(s: DueString | undefined, today: Date): number | null {
  const p = parseDue(s);
  if (!p) return null;
  return Math.round((p.date.getTime() - startOfDay(today).getTime()) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDue(s?: DueString): string {
  const p = parseDue(s);
  if (!p) return '';
  const { date } = p;
  if (p.precision === 'month') return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${sameYear ? '' : `, ${date.getFullYear()}`}`;
}

/** Human relative phrasing, e.g. "today", "in 3 days", "2 days ago", "in ~3 months". */
export function relativeDue(s: DueString | undefined, today: Date): string {
  const p = parseDue(s);
  const n = daysUntil(s, today);
  if (!p || n === null) return '';
  if (p.precision === 'month') {
    const months = (p.date.getFullYear() - today.getFullYear()) * 12 + p.date.getMonth() - today.getMonth();
    if (months < 0) return 'past';
    if (months === 0) return 'this month';
    if (months === 1) return 'next month';
    return `in ${months} months`;
  }
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n} days ago`;
  if (n < 14) return `in ${n} days`;
  if (n < 60) return `in ${Math.round(n / 7)} weeks`;
  return `in ${Math.round(n / 30)} months`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function timeAgo(iso: string, now: Date): string {
  const d = new Date(iso);
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (Number.isNaN(diff)) return '';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function formatWeekRange(weekStart: string): string {
  const s = parseISODate(weekStart);
  const e = addDays(s, 6);
  const sm = MONTHS[s.getMonth()];
  const em = MONTHS[e.getMonth()];
  return sm === em ? `${sm} ${s.getDate()} – ${e.getDate()}` : `${sm} ${s.getDate()} – ${em} ${e.getDate()}`;
}

export function shiftWeek(weekStart: string, n: number): string {
  return toISODate(addDays(parseISODate(weekStart), n * 7));
}
