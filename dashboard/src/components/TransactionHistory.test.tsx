import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransactionHistory } from './TransactionHistory';

/**
 * The component seeds itself with a 5000-row fixture and flips out of its
 * loading state after a 1s timer, so every case waits for the first real row
 * before asserting.
 */
const renderTable = async (props: Parameters<typeof TransactionHistory>[0] = {}) => {
  const view = render(<TransactionHistory {...props} />);
  await waitFor(() => expect(screen.getByLabelText('Transaction pagination')).toBeTruthy(), {
    timeout: 3000,
  });
  await waitFor(() => expect(dataRows().length).toBeGreaterThan(0), { timeout: 3000 });
  return view;
};

/** Body rows only — excludes the header row and the skeleton placeholders. */
const dataRows = () => {
  const body = document.querySelector('tbody');
  if (!body) return [];
  return Array.from(body.querySelectorAll('tr')).filter(
    (row) => !row.querySelector('.animate-pulse') && !row.textContent?.includes('No transactions'),
  );
};

const summary = () => screen.getByLabelText('Transaction pagination').textContent ?? '';

describe('TransactionHistory pagination', () => {
  it('renders only the first page of rows rather than the whole set', async () => {
    await renderTable();

    expect(dataRows().length).toBe(10);
    expect(summary()).toContain('Showing 1-10 of 5000 transactions');
  });

  it('advances to the next page and reports the new range', async () => {
    await renderTable();
    const firstRowBefore = dataRows()[0].textContent;

    fireEvent.click(screen.getByLabelText('Next page'));

    await waitFor(() => expect(summary()).toContain('Showing 11-20 of 5000'));
    expect(dataRows()[0].textContent).not.toBe(firstRowBefore);
    expect(dataRows().length).toBe(10);
  });

  it('steps back to the previous page', async () => {
    await renderTable();

    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => expect(summary()).toContain('Showing 11-20'));

    fireEvent.click(screen.getByLabelText('Previous page'));
    await waitFor(() => expect(summary()).toContain('Showing 1-10 of 5000'));
  });

  it('disables Previous on the first page and Next on the last', async () => {
    await renderTable();

    const previous = screen.getByLabelText('Previous page') as HTMLButtonElement;
    expect(previous.disabled).toBe(true);

    // 5000 rows / 10 per page = 500 pages.
    fireEvent.click(screen.getByLabelText('Page 500'));

    await waitFor(() => expect(summary()).toContain('Showing 4991-5000 of 5000'));
    expect((screen.getByLabelText('Next page') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Previous page') as HTMLButtonElement).disabled).toBe(false);
  });

  it('jumps directly to a numbered page and marks it current', async () => {
    await renderTable();

    fireEvent.click(screen.getByLabelText('Page 3'));

    await waitFor(() => expect(summary()).toContain('Showing 21-30 of 5000'));
    expect(screen.getByLabelText('Page 3').getAttribute('aria-current')).toBe('page');
    expect(screen.getByLabelText('Page 1').getAttribute('aria-current')).toBeNull();
  });

  it('elides long page runs but keeps the first and last reachable', async () => {
    await renderTable();

    fireEvent.click(screen.getByLabelText('Page 500'));
    await waitFor(() => expect(summary()).toContain('Showing 4991-5000'));

    expect(screen.getByLabelText('Page 1')).toBeTruthy();
    expect(screen.getByLabelText('Page 500')).toBeTruthy();
    const nav = screen.getByLabelText('Transaction pagination');
    expect(within(nav).getAllByRole('listitem').length).toBeLessThan(12);
  });
});

describe('TransactionHistory page size selector', () => {
  it('offers 10, 25 and 50 rows per page', async () => {
    await renderTable();

    const select = screen.getByLabelText('Rows per page') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['10', '25', '50']);
    expect(select.value).toBe('10');
  });

  it('renders the requested number of rows when the size changes', async () => {
    await renderTable();

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });

    await waitFor(() => expect(dataRows().length).toBe(25));
    expect(summary()).toContain('Showing 1-25 of 5000');
  });

  it('returns to page 1 when the size changes, since row 1 moves', async () => {
    await renderTable();

    fireEvent.click(screen.getByLabelText('Page 3'));
    await waitFor(() => expect(summary()).toContain('Showing 21-30'));

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });

    await waitFor(() => expect(summary()).toContain('Showing 1-50 of 5000'));
  });
});

describe('TransactionHistory pagination and filters', () => {
  it('resets to page 1 so a filtered set never opens on an out-of-range page', async () => {
    await renderTable();

    fireEvent.click(screen.getByLabelText('Page 3'));
    await waitFor(() => expect(summary()).toContain('Showing 21-30'));

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'tx-001' },
    });

    await waitFor(() => expect(summary()).toContain('Showing 1-1 of 1 transaction'));
    expect(dataRows().length).toBe(1);
  });

  it('reports an empty set without offering rows', async () => {
    await renderTable();

    fireEvent.change(screen.getByLabelText('Search transactions'), {
      target: { value: 'no-such-transaction' },
    });

    await waitFor(() => expect(summary()).toContain('No transactions'));
    expect(screen.getByText('No transactions match your filters.')).toBeTruthy();
  });
});

describe('TransactionHistory API query params', () => {
  it('reports limit and offset for the initial page', async () => {
    const onPageChange = vi.fn();
    await renderTable({ onPageChange });

    expect(onPageChange).toHaveBeenCalledWith({ limit: 10, offset: 0 });
  });

  it('reports the new offset when the page advances', async () => {
    const onPageChange = vi.fn();
    await renderTable({ onPageChange });
    onPageChange.mockClear();

    fireEvent.click(screen.getByLabelText('Next page'));

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith({ limit: 10, offset: 10 }));
  });

  it('reports the new limit when the page size changes', async () => {
    const onPageChange = vi.fn();
    await renderTable({ onPageChange });
    onPageChange.mockClear();

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith({ limit: 50, offset: 0 }));
  });
});
