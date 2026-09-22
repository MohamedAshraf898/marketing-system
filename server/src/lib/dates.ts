/** Date-only strings (YYYY-MM-DD) are stored as UTC midnight so reports group cleanly by day. */
export function parseDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function endOfDayUtc(s: string): Date {
  return new Date(`${s}T23:59:59.999Z`);
}

export const isDateOnly = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
