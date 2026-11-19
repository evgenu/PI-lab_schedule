import type { BookingStatus, SlotState } from './types.js';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatSlot(hour: number): string {
  return `${pad(hour)}:00–${pad(hour + 1)}:00`;
}

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('bg-BG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Today's date in Sofia, whatever the device's own time zone is. */
export function todayInSofia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Чака одобрение',
  approved: 'Одобрена',
  rejected: 'Отхвърлена',
  cancelled: 'Анулирана',
};

export const SLOT_LABELS: Record<SlotState, string> = {
  free: 'Свободно',
  pending: 'Чака одобрение',
  approved: 'Заето',
  past: 'Минало',
};

export const ROLE_LABELS = { student: 'студент', teacher: 'преподавател', admin: 'администратор' } as const;
