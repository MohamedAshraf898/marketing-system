// Client-side API types of the finance group (contracts, invoices, notifications helpers).
import type { ContractStatus, InvoiceStatus } from '@shared/enums';
import type { ClientLite, FileRow } from './types';

/** Fields marked "staff" are NOT sent to CLIENT users (whitelist DTO on the server). */
export interface ContractRow {
  id: string; clientId: string; name: string; contractNumber: string; status: ContractStatus;
  startDate: string | null; endDate: string | null; renewalDate: string | null; value: number; createdAt: string;
  notes?: string | null; visibleToClient?: boolean; createdBy?: { id: string; name: string } | null; client?: ClientLite; filesCount?: number; updatedAt?: string; // staff
  files?: FileRow[]; // detail only
}

export interface InvoiceRow {
  id: string; clientId: string; invoiceNumber: string; status: InvoiceStatus;
  issueDate: string; dueDate: string; amount: number; tax: number; total: number; description: string | null; paidAt: string | null;
  project: { id: string; name: string } | null; createdAt: string;
  notes?: string | null; visibleToClient?: boolean; createdBy?: { id: string; name: string } | null; client?: ClientLite; filesCount?: number; updatedAt?: string; // staff
  files?: FileRow[]; // detail only
}

export interface MoneyBucket { count: number; total: number }
export interface InvoiceSummary {
  byStatus: Record<InvoiceStatus, MoneyBucket>;
  outstanding: MoneyBucket;
  overdue: MoneyBucket;
  paidThisMonth: MoneyBucket;
  paid: MoneyBucket;
}
