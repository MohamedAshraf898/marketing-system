import type { Response } from 'express';

/** Hard cap on exported rows (protects memory and the browser). */
export const CSV_MAX_ROWS = 50_000;

export type CsvCell = string | number | boolean | Date | null | undefined;

/**
 * Text cells that a spreadsheet could interpret as a formula (=, +, -, @, tab, carriage return) get a leading
 * apostrophe so Excel / Sheets show them as plain text (CSV / formula injection). Numbers are written as-is.
 */
export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (v instanceof Date) s = v.toISOString().slice(0, 10);
  else {
    s = v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 with BOM (Excel opens Arabic correctly), CRLF line endings. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Sends a CSV as a download. `filename` must be ASCII-safe. */
export function sendCsv(res: Response, filename: string, body: string, truncated = false): void {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (truncated) res.setHeader('X-Export-Truncated', 'true');
  res.send(body);
}
