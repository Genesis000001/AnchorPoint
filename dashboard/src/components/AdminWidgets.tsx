import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// ---------------------------------------------------------------------------
// useAutoRefresh hook
// ---------------------------------------------------------------------------

/**
 * Calls `callback` immediately on mount, then on every `intervalMs`.
 * Polling is disabled while `intervalMs` is null (Off).
 *
 * @returns whether a poll is currently in flight.
 */
function useAutoRefresh(callback: () => void, intervalMs: number | null): boolean {
  const [polling, setPolling] = useState(false);
  const savedCallback = useRef(callback);

  // Keep the latest callback without restarting the interval.
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const fire = () => {
      setPolling(true);
      void Promise.resolve().then(() => {
        savedCallback.current();
        setPolling(false);
      });
    };

    // Always fire once on mount / interval change
    fire();

    if (intervalMs === null) return;

    const id = setInterval(fire, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);

  return polling;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RefreshInterval = 5000 | 15000 | 30000 | null;

interface IntervalOption {
  label: string;
  value: RefreshInterval;
}

const INTERVAL_OPTIONS: IntervalOption[] = [
  { label: 'Off', value: null },
  { label: '5s', value: 5000 },
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
];

interface MetricItem {
  label: string;
  value: string | number;
  unit?: string;
}

interface AdminWidgetsProps {
  /** Base URL of the backend API, e.g. "http://localhost:3002" */
  apiBaseUrl: string;
}
// ---------------------------------------------------------------------------
// AdminWidgets
// ---------------------------------------------------------------------------
const AdminWidgets: React.FC<AdminWidgetsProps> = ({ apiBaseUrl }) => {
  const [metrics, setMetrics] = useState<MetricItem[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<RefreshInterval>(null);

  const fetchMetrics = useCallback(async () => {
    setFetchError(null);
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${apiBaseUrl}/api/health`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: Record<string, unknown> = await res.json();

      // Build a flat metric list from whatever the health endpoint returns
      const items: MetricItem[] = [];
      for (const [key, val] of Object.entries(data)) {
        if (key === 'timestamp') continue;
        if (typeof val === 'object' && val !== null) {
          const sub = val as Record<string, unknown>;
          if ('status' in sub) {
            items.push({ label: key.charAt(0).toUpperCase() + key.slice(1), value: String(sub.status) });
          }
          if ('latencyMs' in sub && typeof sub.latencyMs === 'number') {
            items.push({ label: `${key} latency`, value: sub.latencyMs, unit: 'ms' });
          }
        } else if (typeof val === 'string' || typeof val === 'number') {
          items.push({ label: key, value: val });
        }
      }

      setMetrics(items);
      setLastRefresh(new Date());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load system metrics');
    }
  }, [apiBaseUrl]);

  const isPolling = useAutoRefresh(fetchMetrics, selectedInterval);

  return (
    <div className="glass-card p-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-100">System Metrics</h3>

        <div className="flex items-center gap-2">
          {/* Spinner shown while a background poll is in progress */}
          {isPolling && (
            <RefreshCw
              size={13}
              className="animate-spin text-primary"
              aria-label="Refreshing…"
            />
          )}

          {/* Auto-refresh interval selector */}
          <label htmlFor="refresh-interval" className="sr-only">
            Auto-refresh interval
          </label>
          <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 p-1">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                id={opt.value === null ? 'refresh-interval' : undefined}
                onClick={() => setSelectedInterval(opt.value)}
                aria-pressed={selectedInterval === opt.value}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  selectedInterval === opt.value
                    ? 'bg-primary text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Manual refresh */}
          <button
            type="button"
            onClick={() => void fetchMetrics()}
            disabled={isPolling}
            aria-label="Refresh metrics now"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <RefreshCw size={12} className={isPolling ? 'animate-spin' : ''} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {fetchError && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400"
        >
          {fetchError}
        </p>
      )}

      {/* Metrics grid */}
      {metrics.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="System metric values">
          {metrics.map((m) => (
            <li
              key={m.label}
              className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {m.label}
              </span>
              <span className="text-sm font-semibold text-slate-200">
                {m.value}
                {m.unit && <span className="ml-0.5 text-xs font-normal text-slate-500">{m.unit}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        !fetchError && (
          <p className="text-sm text-slate-500">No metrics available.</p>
        )
      )}

      {/* Last refresh timestamp */}
      {lastRefresh && (
        <p className="mt-3 text-right text-xs text-slate-600" aria-live="polite">
          Last refreshed: {lastRefresh.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
};

export { AdminWidgets };
export default AdminWidgets;
