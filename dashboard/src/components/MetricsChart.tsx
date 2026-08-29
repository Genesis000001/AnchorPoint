import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartSkeleton } from './Skeletons';

export type VolumePoint = {
  /** ISO date (YYYY-MM-DD) for the trading day. */
  date: string;
  /** Total deposit volume for the day, in USD. */
  deposits: number;
  /** Total withdrawal volume for the day, in USD. */
  withdrawals: number;
};

export type TimeWindow = '7d' | '30d' | '90d';

const TIME_WINDOWS: { id: TimeWindow; label: string; days: number }[] = [
  { id: '7d', label: '7D', days: 7 },
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
];

/**
 * Categorical pair validated for CVD separation and contrast against the dark
 * dashboard surface (#0f172a) in both light and dark modes. Assigned by entity,
 * never by rank — filtering a series must not repaint the other.
 */
const SERIES = [
  { key: 'deposits' as const, label: 'Deposits', color: '#6366f1' },
  { key: 'withdrawals' as const, label: 'Withdrawals', color: '#d97706' },
];

const MARKS = [
  { id: 'line' as const, label: 'Line' },
  { id: 'bar' as const, label: 'Bar' },
];

const AXIS_INK = '#94a3b8';
const GRID_INK = 'rgba(148,163,184,0.14)';

const usdFull = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

/** Compact axis form — full precision is reserved for the tooltip. */
const formatAxisUsd = (value: number): string => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
};

const formatDayLabel = (iso: string): string => {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/**
 * Deterministic sample series used until the metrics endpoint is wired up.
 * Seeded so the chart does not reshuffle on every render.
 */
const buildSampleData = (days: number): VolumePoint[] => {
  const today = Date.UTC(2026, 0, 31);
  return Array.from({ length: days }, (_, index) => {
    const offset = days - 1 - index;
    const date = new Date(today - offset * 86_400_000);
    const wave = Math.sin(index / 4.5);
    const weekly = Math.cos(index / 3.1);
    return {
      date: date.toISOString().slice(0, 10),
      deposits: Math.round(24_000 + wave * 9_500 + weekly * 4_200 + (index % 7) * 900),
      withdrawals: Math.round(17_500 + weekly * 7_800 + wave * 3_100 + (index % 5) * 750),
    };
  });
};

/** Keeps legend text in the muted ink token rather than the series color. */
const legendLabel = (value: string) => <span style={{ color: AXIS_INK }}>{value}</span>;

type TooltipEntry = { dataKey?: string | number; value?: number | string };

const VolumeTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) => {
  if (!active || !payload?.length || !label) return null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-xs font-semibold text-slate-200">{formatDayLabel(label)}</p>
      <div className="mt-1.5 space-y-1">
        {SERIES.map((series) => {
          const entry = payload.find((item) => item.dataKey === series.key);
          if (!entry) return null;
          return (
            <div key={series.key} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: series.color }}
                aria-hidden="true"
              />
              <span className="text-slate-400">{series.label}</span>
              <span className="ml-auto font-mono font-medium text-slate-100">
                {usdFull.format(Number(entry.value ?? 0))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface MetricsChartProps {
  /** Daily volume points, newest last. Falls back to sample data when omitted. */
  data?: VolumePoint[];
  /** Time window selected on first render. */
  defaultWindow?: TimeWindow;
  /** Renders the placeholder instead of the plot while the fetch is in flight. */
  isLoading?: boolean;
}

/**
 * Interactive daily volume chart: deposit vs withdrawal totals over a 7d/30d/90d
 * window, switchable between line and bar marks, with USD-formatted hover
 * tooltips. Both series share one y-axis so their magnitudes stay comparable.
 */
export const MetricsChart = ({ data, defaultWindow = '7d', isLoading = false }: MetricsChartProps) => {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(defaultWindow);
  const [mark, setMark] = useState<'line' | 'bar'>('line');

  const days = TIME_WINDOWS.find((w) => w.id === timeWindow)?.days ?? 7;

  const series = useMemo(() => {
    const source = data ?? buildSampleData(90);
    return source.slice(-days);
  }, [data, days]);

  const totals = useMemo(
    () =>
      series.reduce(
        (acc, point) => ({
          deposits: acc.deposits + point.deposits,
          withdrawals: acc.withdrawals + point.withdrawals,
        }),
        { deposits: 0, withdrawals: 0 },
      ),
    [series],
  );

  // Placed after the hooks above so the hook order stays stable across loads.
  if (isLoading) {
    return <ChartSkeleton label="Loading daily volume chart" />;
  }

  // Thin x-axis labels on longer windows so day ticks never collide.
  const tickInterval = Math.max(0, Math.ceil(series.length / 7) - 1);

  const axisProps = {
    stroke: AXIS_INK,
    tick: { fill: AXIS_INK, fontSize: 11 },
    tickLine: false,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-bold text-slate-100">Daily Volume</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Deposits {usdFull.format(totals.deposits)} · Withdrawals{' '}
            {usdFull.format(totals.withdrawals)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1"
            role="group"
            aria-label="Select time window"
          >
            {TIME_WINDOWS.map((window) => (
              <button
                key={window.id}
                type="button"
                onClick={() => setTimeWindow(window.id)}
                aria-pressed={timeWindow === window.id}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                  timeWindow === window.id
                    ? 'border border-primary/30 bg-primary/20 text-primary-text'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {window.label}
              </button>
            ))}
          </div>

          <div
            className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1"
            role="group"
            aria-label="Select chart type"
          >
            {MARKS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setMark(option.id)}
                aria-pressed={mark === option.id}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                  mark === option.id
                    ? 'border border-primary/30 bg-primary/20 text-primary-text'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className="min-h-64 flex-1 animate-fade-in"
        data-testid="metrics-chart-plot"
        role="img"
        aria-label={`Daily deposit and withdrawal volume over the last ${days} days. Deposits total ${usdFull.format(totals.deposits)}, withdrawals total ${usdFull.format(totals.withdrawals)}.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {mark === 'line' ? (
            <LineChart data={series} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID_INK} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                interval={tickInterval}
                tickFormatter={formatDayLabel}
                {...axisProps}
              />
              <YAxis width={56} tickFormatter={formatAxisUsd} {...axisProps} />
              <Tooltip content={<VolumeTooltip />} cursor={{ stroke: GRID_INK, strokeWidth: 1 }} />
              <Legend
                iconType="plainline"
                formatter={legendLabel}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              />
              {SERIES.map((item) => (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.label}
                  stroke={item.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#0f172a' }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={series} margin={{ top: 8, right: 24, bottom: 0, left: 0 }} barGap={2}>
              <CartesianGrid stroke={GRID_INK} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                interval={tickInterval}
                tickFormatter={formatDayLabel}
                {...axisProps}
              />
              <YAxis width={56} tickFormatter={formatAxisUsd} {...axisProps} />
              <Tooltip
                content={<VolumeTooltip />}
                cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              />
              <Legend
                iconType="square"
                formatter={legendLabel}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              />
              {SERIES.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.label}
                  fill={item.color}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={18}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default MetricsChart;
