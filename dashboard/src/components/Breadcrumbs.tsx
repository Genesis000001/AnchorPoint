import React, { useMemo } from 'react';
import { ChevronRight, Home } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Crumb {
  /** Display label for this breadcrumb step */
  label: string;
  /** Optional href — if omitted the crumb renders as plain text (current page) */
  href?: string;
}

export interface BreadcrumbsProps {
  /**
   * Explicit list of breadcrumb entries.
   * When provided, takes precedence over automatic URL parsing.
   * The last item is treated as the active (current) step.
   *
   * Example:
   * ```tsx
   * <Breadcrumbs crumbs={[
   *   { label: 'Dashboard', href: '/' },
   *   { label: 'Transactions', href: '/transactions' },
   *   { label: 'Tx #1042' },
   * ]} />
   * ```
   */
  crumbs?: Crumb[];
  /** Class names forwarded to the <nav> wrapper */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives breadcrumb entries from `window.location.pathname`.
 *
 * e.g. `/transactions/1042` →
 *   [{ label: 'Dashboard', href: '/' }, { label: 'Transactions', href: '/transactions' }, { label: '1042' }]
 */
function parsePath(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return [{ label: 'Dashboard' }];
  }

  const crumbs: Crumb[] = [{ label: 'Dashboard', href: '/' }];

  segments.forEach((seg, idx) => {
    const label = seg
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const isLast = idx === segments.length - 1;
    crumbs.push({
      label,
      href: isLast ? undefined : `/${segments.slice(0, idx + 1).join('/')}`,
    });
  });

  return crumbs;
}

// ---------------------------------------------------------------------------
// Breadcrumbs Component
// ---------------------------------------------------------------------------

const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ crumbs: crumbsProp, className = '' }) => {
  const crumbs = useMemo<Crumb[]>(() => {
    if (crumbsProp && crumbsProp.length > 0) return crumbsProp;
    return parsePath(window.location.pathname);
  }, [crumbsProp]);

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center ${className}`}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === crumbs.length - 1;

          return (
            <React.Fragment key={`${crumb.label}-${idx}`}>
              {/* Chevron separator (not before the first item) */}
              {!isFirst && (
                <li aria-hidden="true" className="flex items-center text-slate-600">
                  <ChevronRight size={14} />
                </li>
              )}

              <li className="flex items-center">
                {isLast || !crumb.href ? (
                  /* Current / active step — no link, visually highlighted */
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={`flex items-center gap-1 font-medium ${
                      isLast
                        ? 'text-slate-100'
                        : 'text-slate-400'
                    }`}
                  >
                    {isFirst && <Home size={13} aria-hidden="true" className="shrink-0" />}
                    {crumb.label}
                  </span>
                ) : (
                  /* Ancestor step — clickable link */
                  <a
                    href={crumb.href}
                    className="flex items-center gap-1 text-slate-400 transition-colors hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                  >
                    {isFirst && <Home size={13} aria-hidden="true" className="shrink-0" />}
                    {crumb.label}
                  </a>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumbs;
