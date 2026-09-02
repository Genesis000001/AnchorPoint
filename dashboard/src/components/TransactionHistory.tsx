import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
  Printer,
} from 'lucide-react';
import { TransactionStatusBadge } from './TransactionStatusBadge';
import type { TransactionStatus } from './TransactionStatusBadge';
import { CopyButton } from './Common/CopyButton';
import { TransactionExporter } from './TransactionExporter';
import { TransactionReceipt } from './TransactionReceipt';

type TransactionType = 'Deposit' | 'Withdrawal';
type SortKey = 'type' | 'asset' | 'amount' | 'status' | 'date';
type SortDir = 'asc' | 'desc';
type ColumnAlign = 'left' | 'right';

const PAGE_SIZES = [10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];
const DEFAULT_PAGE_SIZE: PageSize = 10;

interface Transaction {
  id: string;
  type: TransactionType;
  asset: string;
  amount: number;
  status: TransactionStatus;
  date: string;
  reference: string;
  fees?: number;
  anchorSignature?: string;
}

const ALL_TRANSACTIONS: Transaction[] = Array.from({ length: 5000 }, (_, i) => {
  const isDeposit = i % 3 === 0;
  const statusList: TransactionStatus[] = ['Completed', 'Pending', 'Processing', 'Failed', 'Cancelled'];
  const status = statusList[i % statusList.length];
  const assets = ['USDC', 'EURT', 'ARST'];
  const asset = assets[i % assets.length];
  const amount = 50 + i * 25.5;
  const dateObj = new Date('2024-03-21');
  dateObj.setDate(dateObj.getDate() - Math.floor(i / 3));

  return {
    id: `tx-${String(i + 1).padStart(3, '0')}`,
    type: isDeposit ? 'Deposit' : 'Withdrawal',
    asset,
    amount,
    status,
    date: dateObj.toISOString().split('T')[0],
    reference: `REF-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
    fees: status === 'Completed' ? parseFloat((amount * 0.01).toFixed(2)) : undefined,
    anchorSignature: status === 'Completed' ? `SIG-${Math.random().toString(36).substring(2, 10).toUpperCase()}` : undefined,
  };
});

type TransactionUpdatePayload = {
  id: string;
  status?: string;
  ledger?: number;
  amount?: number;
  [key: string]: unknown;
};

const fmtAmount = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Page numbers to render, with 'gap' marking elided runs. Always keeps the
 * first and last page reachable plus a window around the current one, so a
 * 5000-row result set never paints hundreds of buttons.
 */
const getPageRange = (current: number, pageCount: number): (number | 'gap')[] => {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, pageCount, current]);
  if (current - 1 > 1) pages.add(current - 1);
  if (current + 1 < pageCount) pages.add(current + 1);

  // Keep the strip a stable width when the cursor sits against either end.
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= pageCount - 2) {
    [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p));
  }

  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

  return sorted.reduce<(number | 'gap')[]>((acc, page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) acc.push('gap');
    acc.push(page);
    return acc;
  }, []);
};

const SortIcon = ({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) => {
  if (col !== sortKey) return <ChevronsUpDown size={13} className="text-slate-600" aria-hidden="true" />;
  return dir === 'asc' ? (
    <ChevronUp size={13} className="text-primary-text" aria-hidden="true" />
  ) : (
    <ChevronDown size={13} className="text-primary-text" aria-hidden="true" />
  );
};

interface TransactionHistoryProps {
  socketUpdate?: TransactionUpdatePayload | null;
  /**
   * Notified with the API query params whenever the page or page size changes.
   * Rows are still sliced locally from the in-memory set; wiring this to a
   * fetch is what turns the controls into server-side pagination.
   */
  onPageChange?: (params: { limit: number; offset: number }) => void;
}

export const TransactionHistory = ({ socketUpdate, onPageChange }: TransactionHistoryProps) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | 'All'>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>(ALL_TRANSACTIONS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!socketUpdate) {
      return;
    }

    setTransactions((current) => {
      const index = current.findIndex((tx) => tx.id === socketUpdate.id);
      if (index === -1) {
        return [
          {
            id: socketUpdate.id,
            type: 'Deposit',
            asset: 'USDC',
            amount: typeof socketUpdate.amount === 'number' ? socketUpdate.amount : 0,
            status: (socketUpdate.status as TransactionStatus) ?? 'Completed',
            date: new Date().toISOString().split('T')[0],
            reference: `REF-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
          },
          ...current,
        ];
      }

      const updatedTransaction = {
        ...current[index],
        ...socketUpdate,
        status: (socketUpdate.status as TransactionStatus) ?? current[index].status,
      };

      return [...current.slice(0, index), updatedTransaction, ...current.slice(index + 1)];
    });
  }, [socketUpdate]);

  const handleSort = useCallback(
    (key: SortKey) => {
      setSortDir((prev) => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
      setSortKey(key);
    },
    [sortKey],
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return transactions.filter((tx) => {
      const matchesQuery =
        !q ||
        tx.id.toLowerCase().includes(q) ||
        tx.type.toLowerCase().includes(q) ||
        tx.asset.toLowerCase().includes(q) ||
        tx.reference.toLowerCase().includes(q) ||
        tx.status.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'All' || tx.status === statusFilter;
      const matchesFrom = !dateFrom || tx.date >= dateFrom;
      const matchesTo = !dateTo || tx.date <= dateTo;
      return matchesQuery && matchesStatus && matchesFrom && matchesTo;
    });
  }, [transactions, query, statusFilter, dateFrom, dateTo]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'amount') {
        cmp = a.amount - b.amount;
      } else {
        cmp = a[sortKey].localeCompare(b[sortKey]);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // A filter change can leave the cursor past the end; clamp rather than
  // showing an empty page for a non-empty result set.
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * pageSize;

  const paginated = useMemo(
    () => sorted.slice(offset, offset + pageSize),
    [sorted, offset, pageSize],
  );

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + pageSize, total);

  useEffect(() => {
    onPageChange?.({ limit: pageSize, offset });
  }, [onPageChange, pageSize, offset]);

  const HEADERS: { key: SortKey; label: string; align: ColumnAlign }[] = [
    { key: 'type', label: 'Type', align: 'left' },
    { key: 'asset', label: 'Asset', align: 'left' },
    { key: 'amount', label: 'Amount', align: 'right' },
    { key: 'status', label: 'Status', align: 'left' },
    { key: 'date', label: 'Date', align: 'left' },
  ];

  const statusOptions: Array<TransactionStatus | 'All'> = ['All', 'Completed', 'Pending', 'Processing', 'Failed', 'Cancelled'];

  const handlePrintReceipt = useCallback((tx: Transaction) => {
    setSelectedTransaction(tx);
    setTimeout(() => window.print(), 100);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by ID, type, asset, reference…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            aria-label="Search transactions"
            className="input-field w-full pl-9 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="date-from" className="sr-only">
            From date
          </label>
          <input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            aria-label="Filter from date"
            className="input-field text-sm"
          />
          <label htmlFor="date-to" className="sr-only">
            To date
          </label>
          <input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            aria-label="Filter to date"
            className="input-field text-sm"
          />

          <label htmlFor="status-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as TransactionStatus | 'All');
              setPage(1);
            }}
            className="input-field text-sm"
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s === 'All' ? 'All Statuses' : s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end">
        <TransactionExporter
          transactions={sorted}
          totalCount={sorted.length}
          filters={{ query, status: statusFilter, dateFrom, dateTo }}
        />
      </div>
      {selectedTransaction && (
        <TransactionReceipt
          transaction={selectedTransaction}
          onPrint={() => window.print()}
        />
      )}

      <div className="glass-card overflow-x-auto">
        <table className="responsive-table w-full text-left" aria-label="Transaction history">
          <caption className="sr-only">
            Transaction history — {total} result{total !== 1 ? 's' : ''}
          </caption>
          <thead>
            <tr className="border-b border-slate-600 text-sm text-slate-400">
              {HEADERS.map(({ key, label, align }) => (
                <th
                  key={key}
                  scope="col"
                  className={`p-4 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  <button
                    onClick={() => handleSort(key)}
                    className={`inline-flex items-center gap-1 rounded hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                      align === 'right' ? 'justify-end' : 'justify-start'
                    }`}
                    aria-label={`Sort by ${label}${sortKey === key ? `, currently ${sortDir}ending` : ''}`}
                  >
                    {label}
                    <SortIcon col={key} sortKey={sortKey} dir={sortDir} />
                  </button>
                </th>
              ))}
              <th scope="col" className="p-4 font-medium text-slate-400">
                Reference
              </th>
              <th scope="col" className="p-4 font-medium text-slate-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: pageSize }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="transition-colors hover:bg-slate-900/50">
                  <td className="p-4">
                    <div className="h-4 w-20 animate-pulse rounded bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-12 animate-pulse rounded bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-16 animate-pulse rounded bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-6 w-20 animate-pulse rounded-full bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-8 w-20 animate-pulse rounded bg-slate-800" />
                  </td>
                </tr>
              ))
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-400">
                  No transactions match your filters.
                </td>
              </tr>
            ) : (
              paginated.map((tx) => (
                <tr key={tx.id} className="transition-colors hover:bg-slate-900/50">
                  <td className="flex items-center gap-2 p-4" data-label="Type">
                    {tx.type === 'Deposit' ? (
                      <ArrowDownLeft size={16} className="text-emerald-400" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight size={16} className="text-rose-400" aria-hidden="true" />
                    )}
                    {tx.type}
                  </td>
                  <td className="p-4" data-label="Asset">{tx.asset}</td>
                  <td className="p-4 font-mono" data-label="Amount">${fmtAmount(tx.amount)}</td>
                  <td className="p-4" data-label="Status">
                    <TransactionStatusBadge status={tx.status} />
                  </td>
                  <td className="p-4 text-sm text-slate-400" data-label="Date">
                    <time dateTime={tx.date}>{tx.date}</time>
                  </td>
                  <td className="p-4 font-mono text-xs text-slate-500" data-label="Reference">
                    <span className="inline-flex items-center gap-1.5">
                      {tx.reference}
                      <CopyButton value={tx.reference} label="Transaction reference" />
                    </span>
                  </td>
                  <td className="p-4" data-label="Actions">
                    {tx.status === 'Completed' && (
                      <button
                        type="button"
                        onClick={() => handlePrintReceipt(tx)}
                        className="action-button inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
                        aria-label={`Print receipt for transaction ${tx.id}`}
                      >
                        <Printer size={14} aria-hidden="true" />
                        Receipt
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <nav
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        aria-label="Transaction pagination"
      >
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span aria-live="polite" aria-atomic="true">
            {total === 0
              ? 'No transactions'
              : `Showing ${rangeStart}-${rangeEnd} of ${total} transaction${total !== 1 ? 's' : ''}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="page-size" className="text-sm text-slate-400">
            Rows per page
          </label>
          <select
            id="page-size"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as PageSize);
              // Row 1 of the old page is rarely row 1 of the new one; restart.
              setPage(1);
            }}
            className="input-field text-sm"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            aria-label="Previous page"
            className="action-button inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Previous
          </button>

          <ul className="flex items-center gap-1">
            {getPageRange(currentPage, pageCount).map((entry, index) =>
              entry === 'gap' ? (
                <li
                  key={`gap-${index}`}
                  className="px-1.5 text-sm text-slate-500"
                  aria-hidden="true"
                >
                  …
                </li>
              ) : (
                <li key={entry}>
                  <button
                    type="button"
                    onClick={() => setPage(entry)}
                    aria-label={`Page ${entry}`}
                    aria-current={entry === currentPage ? 'page' : undefined}
                    className={`min-w-8 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                      entry === currentPage
                        ? 'border border-primary/30 bg-primary/20 text-primary-text'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {entry}
                  </button>
                </li>
              ),
            )}
          </ul>

          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={currentPage >= pageCount}
            aria-label="Next page"
            className="action-button inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
          >
            Next
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </nav>
    </div>
  );
};

export default TransactionHistory;
