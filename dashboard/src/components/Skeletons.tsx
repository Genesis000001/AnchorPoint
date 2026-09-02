import type { CSSProperties, ReactNode } from 'react';

/**
 * Pulsing placeholder block. Purely decorative — screen readers are informed by
 * the `role="status"` wrapper on the composed skeletons below, so individual
 * bars stay hidden from the accessibility tree.
 */
export const Skeleton = ({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) => (
  <div
    className={`animate-pulse rounded-md bg-slate-700/50 ${className}`}
    style={style}
    aria-hidden="true"
  />
);

/** Wraps a skeleton group so assistive tech announces the loading state once. */
const LoadingRegion = ({ label, children }: { label: string; children: ReactNode }) => (
  <div role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">{label}</span>
    {children}
  </div>
);

/** Placeholder for a single headline stat tile. */
export const SkeletonStatCard = () => (
  <div className="glass-card p-6">
    <Skeleton className="h-4 w-24" />
    <div className="mt-4 flex items-end justify-between">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-10" />
    </div>
  </div>
);

/** Placeholder for a chart panel, including faux bars of varying height. */
export const SkeletonChartCard = ({ className = '' }: { className?: string }) => (
  <div className={`glass-card p-6 ${className}`}>
    <div className="flex items-start justify-between">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-8 w-32 rounded-lg" />
    </div>
    {/* Staggered heights read as a chart rather than a solid block. */}
    <div className="mt-8 flex h-40 items-end gap-3">
      {[45, 70, 35, 85, 60, 50, 75].map((height, index) => (
        <Skeleton key={index} className="flex-1" style={{ height: `${height}%` }} />
      ))}
    </div>
  </div>
);

/**
 * Placeholder that fills its container rather than a fixed height, so swapping
 * it for the rendered chart canvas shifts nothing on screen (CLS).
 *
 * The header/legend flags mirror whichever chrome the host chart draws above
 * its plot area; turning one off collapses that row.
 */
export const ChartSkeleton = ({
  title = true,
  subtitle = true,
  controls = true,
  legend = false,
  bars = [45, 70, 35, 85, 60, 50, 75],
  className = '',
  label = 'Loading chart',
}: {
  title?: boolean;
  subtitle?: boolean;
  controls?: boolean;
  legend?: boolean;
  bars?: number[];
  className?: string;
  label?: string;
}) => (
  <LoadingRegion label={label}>
    <div className={`flex h-full flex-col ${className}`} data-testid="chart-skeleton">
      {(title || subtitle || controls) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            {title && <Skeleton className="h-5 w-40" />}
            {subtitle && <Skeleton className="h-3 w-28" />}
          </div>
          {controls && <Skeleton className="h-8 w-32 rounded-lg" />}
        </div>
      )}

      {legend && (
        <div className="mb-2 flex gap-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      )}

      {/* Staggered heights read as a chart rather than a solid block. */}
      <div className="flex min-h-64 flex-1 items-end gap-3">
        {bars.map((height, index) => (
          <Skeleton key={index} className="flex-1" style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  </LoadingRegion>
);

/** Placeholder for a text-heavy panel such as the branding card. */
export const SkeletonPanel = ({ rows = 3 }: { rows?: number }) => (
  <div className="glass-card space-y-4 p-6">
    <Skeleton className="h-5 w-44" />
    <div className="flex items-center gap-4">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
    </div>
    <div className="space-y-2 pt-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-3 w-full" />
      ))}
    </div>
  </div>
);

/** Placeholder for a list or table of records. */
export const SkeletonList = ({ rows = 5 }: { rows?: number }) => (
  <LoadingRegion label="Loading records">
    <div className="glass-card divide-y divide-slate-800">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 p-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  </LoadingRegion>
);

/**
 * Full-page placeholder mirroring the Overview layout, so the transition to real
 * content shifts nothing on screen once the stats request resolves.
 */
export const DashboardOverviewSkeleton = () => (
  <LoadingRegion label="Loading dashboard statistics">
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <SkeletonStatCard key={index} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <SkeletonChartCard />
        <SkeletonPanel />
      </div>
    </div>
  </LoadingRegion>
);

export default DashboardOverviewSkeleton;
