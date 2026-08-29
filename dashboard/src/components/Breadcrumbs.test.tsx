import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Breadcrumbs, { buildDocumentTitle, parsePathname, segmentToLabel } from './Breadcrumbs';

const setPathname = (pathname: string) => {
  window.history.pushState({}, '', pathname);
};

describe('parsePathname', () => {
  it('returns a single root crumb for "/"', () => {
    expect(parsePathname('/')).toEqual([{ label: 'Home' }]);
  });

  it('links every ancestor and leaves the current step unlinked', () => {
    expect(parsePathname('/transactions/TX-9842')).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Transactions', href: '/transactions' },
      { label: 'TX-9842', href: undefined },
    ]);
  });

  it('accumulates nested ancestor hrefs', () => {
    expect(parsePathname('/settings/notifications/email')).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Settings', href: '/settings' },
      { label: 'Notifications', href: '/settings/notifications' },
      { label: 'Email', href: undefined },
    ]);
  });

  it('honours a custom root label', () => {
    expect(parsePathname('/kyc', 'Dashboard')[0]).toEqual({ label: 'Dashboard', href: '/' });
  });

  it('ignores duplicate and trailing slashes', () => {
    expect(parsePathname('//history//')).toEqual([
      { label: 'Home', href: '/' },
      { label: 'History', href: undefined },
    ]);
  });
});

describe('segmentToLabel', () => {
  it('title-cases static segments', () => {
    expect(segmentToLabel('transaction-history')).toBe('Transaction History');
    expect(segmentToLabel('notification_preferences')).toBe('Notification Preferences');
  });

  it('preserves route parameters verbatim', () => {
    expect(segmentToLabel('TX-9842')).toBe('TX-9842');
    expect(segmentToLabel('1042')).toBe('1042');
  });

  it('decodes percent-encoded segments', () => {
    expect(segmentToLabel('service%20status')).toBe('Service Status');
  });
});

describe('buildDocumentTitle', () => {
  it('joins labels with a chevron', () => {
    expect(buildDocumentTitle([{ label: 'Home' }, { label: 'Transactions' }])).toBe(
      'Home > Transactions',
    );
  });

  it('appends the suffix when provided', () => {
    expect(buildDocumentTitle([{ label: 'Home' }], 'AnchorPoint')).toBe('Home · AnchorPoint');
  });
});

describe('<Breadcrumbs />', () => {
  const originalTitle = document.title;

  beforeEach(() => {
    setPathname('/');
  });

  afterEach(() => {
    document.title = originalTitle;
    setPathname('/');
  });

  it('renders a trail derived from the current URL', () => {
    setPathname('/transactions/TX-9842');
    render(<Breadcrumbs />);

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Transactions' }).getAttribute('href')).toBe(
      '/transactions',
    );
    expect(screen.queryByRole('link', { name: 'TX-9842' })).toBeNull();
  });

  it('marks only the current step with aria-current="page"', () => {
    setPathname('/transactions/TX-9842');
    const { container } = render(<Breadcrumbs />);

    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe('TX-9842');
  });

  it('updates document.title on render', () => {
    setPathname('/transactions/TX-9842');
    render(<Breadcrumbs titleSuffix="AnchorPoint" />);

    expect(document.title).toBe('Home > Transactions > TX-9842 · AnchorPoint');
  });

  it('re-derives the trail and title on popstate navigation', () => {
    setPathname('/transactions');
    render(<Breadcrumbs titleSuffix="AnchorPoint" />);
    expect(document.title).toBe('Home > Transactions · AnchorPoint');

    act(() => {
      setPathname('/settings/notifications');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(document.title).toBe('Home > Settings > Notifications · AnchorPoint');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
    expect(screen.getByText('Notifications').getAttribute('aria-current')).toBe('page');
  });

  it('leaves document.title alone when updateDocumentTitle is false', () => {
    document.title = 'Untouched';
    setPathname('/settings');
    render(<Breadcrumbs updateDocumentTitle={false} />);

    expect(document.title).toBe('Untouched');
  });

  it('prefers explicit crumbs over URL parsing', () => {
    setPathname('/ignored');
    render(
      <Breadcrumbs
        crumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Tx #1042' }]}
        titleSuffix="AnchorPoint"
      />,
    );

    expect(screen.queryByText('Ignored')).toBeNull();
    expect(document.title).toBe('Dashboard > Tx #1042 · AnchorPoint');
  });

  it('renders callback crumbs as buttons for SPA navigation', () => {
    const onClick = vi.fn();
    render(<Breadcrumbs crumbs={[{ label: 'Dashboard', onClick }, { label: 'History' }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
