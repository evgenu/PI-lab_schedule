/**
 * Slots are one hour long, from 08:00 to 20:00, on calendar days in Sofia.
 * Dates travel as plain YYYY-MM-DD strings so that no time zone can shift them.
 */
export const FIRST_HOUR = 8;
export const LAST_HOUR = 19;
export const MAX_DAYS_AHEAD = 30;
export const TIME_ZONE = 'Europe/Sofia';

export const HOURS: readonly number[] = Array.from(
  { length: LAST_HOUR - FIRST_HOUR + 1 },
  (_, i) => FIRST_HOUR + i,
);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  // 2026-02-31 parses, but rolls over into March: reject it.
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidHour(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= FIRST_HOUR && (value as number) <= LAST_HOUR;
}

/** The current date and hour on the wall clock in Sofia. */
export function localNow(now: Date, timeZone: string = TIME_ZONE): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** A slot whose hour has already started counts as past: nobody can book or cancel it. */
export function isSlotInPast(date: string, hour: number, now: Date): boolean {
  const current = localNow(now);
  return date < current.date || (date === current.date && hour <= current.hour);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}
