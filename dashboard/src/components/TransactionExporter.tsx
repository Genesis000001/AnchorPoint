import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';

export interface ExportableTransaction {
  id: string;
  type: string;
  asset: string;
  amount: number;
  status: string;
  date: string;
  reference: string;
}

/** Date range and status scoping applied to the export itself. */
export interface ExportFilters {
  /** Inclusive lower bound, YYYY-MM-DD. */
  from?: string;
  /** Inclusive upper bound, YYYY-MM-DD. */
  to?: string;
  /** Exact status match, case-insensitive. 'All' or empty means every status. */
  status?: string;
}

interface TransactionExporterProps {
  transactions: ExportableTransaction[];
  totalCount: number;
  filters: Record<string, string>;
}

export const CSV_COLUMNS: (keyof ExportableTransaction)[] = [
  'id',
  'type',
  'asset',
  'amount',
  'status',
  'date',
  'reference',
];

export const STATUS_OPTIONS = [
  'All',
  'Completed',
  'Pending',
  'Processing',
  'Failed',
  'Cancelled',
] as const;

/** Wraps a field in quotes only when it contains a delimiter, quote or newline. */
export const csvEscape = (value: string | number): string => {
  const str = String(value ?? '');
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

/** Transaction dates may arrive as YYYY-MM-DD or a full ISO timestamp. */
const toDayStamp = (value: string) => String(value ?? '').slice(0, 10);

const todayStamp = () => new Date().toISOString().split('T')[0];

/**
 * Narrows the export to a date range and status. Bounds are inclusive and
 * compared as YYYY-MM-DD strings, which sort chronologically.
 */
export function filterTransactions(
  transactions: ExportableTransaction[],
  { from, to, status }: ExportFilters = {},
): ExportableTransaction[] {
  const wantedStatus = status && status !== 'All' ? status.toLowerCase() : null;

  return transactions.filter((tx) => {
    const day = toDayStamp(tx.date);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (wantedStatus && String(tx.status).toLowerCase() !== wantedStatus) return false;
    return true;
  });
}

const buildMetadataLines = (
  exportedCount: number,
  totalCount: number,
  filters: Record<string, string>,
  exportedAt: string,
  prefix: string,
) => {
  const activeFilters = Object.entries(filters)
    .filter(([, value]) => value && value !== 'All')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  return [
    `${prefix}Exported: ${exportedAt}`,
    `${prefix}Records exported: ${exportedCount}`,
    `${prefix}Records available: ${totalCount}`,
    `${prefix}Filters: ${activeFilters || 'none'}`,
  ];
};

export interface ExportContext {
  totalCount: number;
  filters: Record<string, string>;
  /** Injected in tests to keep the header deterministic. */
  exportedAt?: string;
}

/** Renders the transaction list as CSV, prefixed with `#` metadata comments. */
export function toCsv(
  transactions: ExportableTransaction[],
  { totalCount, filters, exportedAt = new Date().toISOString() }: ExportContext,
): string {
  const metadata = buildMetadataLines(
    transactions.length,
    totalCount,
    filters,
    exportedAt,
    '# ',
  );
  const header = CSV_COLUMNS.join(',');
  const rows = transactions.map((tx) => CSV_COLUMNS.map((col) => csvEscape(tx[col])).join(','));

  return [...metadata, header, ...rows].join('\n');
}

/** Renders the transaction list as a JSON document with the same metadata. */
export function toJson(
  transactions: ExportableTransaction[],
  { totalCount, filters, exportedAt = new Date().toISOString() }: ExportContext,
): string {
  return JSON.stringify(
    {
      exportedAt,
      exportedCount: transactions.length,
      totalCount,
      filters,
      transactions,
    },
    null,
    2,
  );
}

export const buildFilename = (extension: string, stamp: string = todayStamp()) =>
  `AnchorPoint_Transactions_${stamp}.${extension}`;

const triggerDownload = (content: string, mimeType: string, extension: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildFilename(extension);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const CONTROL_CLASS =
  'input-field px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';
const BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition hover:border-primary/50 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50';

export const TransactionExporter = ({
  transactions,
  totalCount,
  filters,
}: TransactionExporterProps) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<string>('All');

  const selected = useMemo(
    () => filterTransactions(transactions, { from, to, status }),
    [transactions, from, to, status],
  );

  // The page's own filters plus whatever this panel narrowed further, so the
  // exported file records exactly how its rows were chosen.
  const exportFilters = useMemo(
    () => ({ ...filters, exportFrom: from, exportTo: to, exportStatus: status }),
    [filters, from, to, status],
  );

  const context: ExportContext = { totalCount, filters: exportFilters };
  const isEmpty = selected.length === 0;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label htmlFor="export-date-from" className="sr-only">
        Export from date
      </label>
      <input
        id="export-date-from"
        type="date"
        value={from}
        max={to || undefined}
        onChange={(event) => setFrom(event.target.value)}
        className={CONTROL_CLASS}
      />

      <label htmlFor="export-date-to" className="sr-only">
        Export to date
      </label>
      <input
        id="export-date-to"
        type="date"
        value={to}
        min={from || undefined}
        onChange={(event) => setTo(event.target.value)}
        className={CONTROL_CLASS}
      />

      <label htmlFor="export-status" className="sr-only">
        Export status
      </label>
      <select
        id="export-status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        className={CONTROL_CLASS}
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option === 'All' ? 'All Statuses' : option}
          </option>
        ))}
      </select>

      <span data-testid="export-count" role="status" className="text-xs text-slate-400">
        {selected.length} of {totalCount} selected
      </span>

      <button
        type="button"
        onClick={() => triggerDownload(toCsv(selected, context), 'text/csv;charset=utf-8', 'csv')}
        disabled={isEmpty}
        className={BUTTON_CLASS}
      >
        <Download size={14} aria-hidden="true" />
        CSV
      </button>
      <button
        type="button"
        onClick={() => triggerDownload(toJson(selected, context), 'application/json', 'json')}
        disabled={isEmpty}
        className={BUTTON_CLASS}
      >
        <Download size={14} aria-hidden="true" />
        JSON
      </button>
    </div>
  );
};

export default TransactionExporter;
