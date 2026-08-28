import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Home } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Crumb {
  /** Display label for this step. */
  label: string;
  /**
   * Optional navigation target.
   * - A string renders an `<a href>`.
   * - `onClick` renders a `<button>` for SPA state navigation.
   * - Omit both on the last (current) step.
   */
  href?: string;
  onClick?: (event: React.MouseEvent) => void;
}

export interface BreadcrumbsProps {
  /**
   * Explicit trail. When provided it takes precedence over URL parsing.
   * The last entry is always treated as the current page.
   */
  crumbs?: Crumb[];
  /** Root crumb label used when the trail is derived from the URL. */
  rootLabel?: string;
  /** Suffix appended to `document.title`, e.g. "Home > Transactions · AnchorPoint". */
  titleSuffix?: string;
  /** Set to false to leave `document.title` untouched. */
  updateDocumentTitle?: boolean;
  /** Show the home icon on the first crumb (default: true). */
  showHomeIcon?: boolean;
  /** Class names forwarded to the `<nav>` wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Path parsing
// ---------------------------------------------------------------------------

/**
 * Route parameters (ids, hashes, reference codes) must survive verbatim —
 * title-casing "TX-9842" into "Tx 9842" would misrepresent the record the
 * crumb points at. Anything containing a digit is treated as a parameter.
 */
function isRouteParam(segment: string): boolean {
  return /\d/.test(segment);
}

/**
 * Converts a static pathname segment into a human-readable label.
 * e.g. "transaction-history" → "Transaction History"
 */
export function segmentToLabel(segment: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();

  if (isRouteParam(decoded)) {
    return decoded;
  }

  return decoded.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Derives a breadcrumb trail from a URL pathname.
 *
 * e.g. `/transactions/TX-9842` with rootLabel "Home" →
 *   Home (/) › Transactions (/transactions) › TX-9842 (current)
 */
export function parsePathname(pathname: string, rootLabel = 'Home'): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return [{ label: rootLabel }];
  }

  const crumbs: Crumb[] = [{ label: rootLabel, href: '/' }];

  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    crumbs.push({
      label: segmentToLabel(segment),
      href: isLast ? undefined : `/${segments.slice(0, index + 1).join('/')}`,
    });
  });

  return crumbs;
}

/** Builds the `document.title` string for a trail. */
export function buildDocumentTitle(crumbs: Crumb[], suffix?: string): string {
  const trail = crumbs.map((crumb) => crumb.label).join(' > ');
  return suffix ? `${trail} · ${suffix}` : trail;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LINK_CLASS =
  'flex items-center gap-1 rounded text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text';

/**
 * Renders a breadcrumb trail and keeps the browser tab title in sync with it.
 *
 * When `crumbs` is omitted the trail is derived from `window.location.pathname`
 * and re-derived on `popstate`/`hashchange`, so client-side navigation updates
 * both the trail and `document.title`.
 */
const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  crumbs: crumbsProp,
  rootLabel = 'Home',
  titleSuffix,
  updateDocumentTitle = true,
  showHomeIcon = true,
  className = '',
}) => {
  const readPathname = useCallback(
    () => (typeof window === 'undefined' ? '/' : window.location.pathname),
    [],
  );
  const [pathname, setPathname] = useState(readPathname);

  // Re-derive the trail when the SPA navigates without a full page load.
  useEffect(() => {
    if (crumbsProp && crumbsProp.length > 0) return;

    const sync = () => setPathname(readPathname());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    sync();

    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, [crumbsProp, readPathname]);

  const crumbs = useMemo<Crumb[]>(() => {
    if (crumbsProp && crumbsProp.length > 0) return crumbsProp;
    return parsePathname(pathname, rootLabel);
  }, [crumbsProp, pathname, rootLabel]);

  useEffect(() => {
    if (!updateDocumentTitle || crumbs.length === 0) return;
    document.title = buildDocumentTitle(crumbs, titleSuffix);
  }, [crumbs, titleSuffix, updateDocumentTitle]);

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center ${className}`}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const isFirst = index === 0;
          const isLast = index === crumbs.length - 1;
          const icon = isFirst && showHomeIcon
            ? <Home size={13} aria-hidden="true" className="shrink-0" />
            : null;

          return (
            <React.Fragment key={`${crumb.label}-${index}`}>
              {!isFirst && (
                <li aria-hidden="true" className="flex items-center text-slate-500">
                  <ChevronRight size={14} />
                </li>
              )}

              <li className="flex items-center">
                {isLast ? (
                  <span
                    aria-current="page"
                    className="flex items-center gap-1 font-medium text-slate-100"
                  >
                    {icon}
                    {crumb.label}
                  </span>
                ) : crumb.onClick ? (
                  <button type="button" onClick={crumb.onClick} className={LINK_CLASS}>
                    {icon}
                    {crumb.label}
                  </button>
                ) : (
                  <a href={crumb.href ?? '#'} className={LINK_CLASS}>
                    {icon}
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
export { Breadcrumbs };
