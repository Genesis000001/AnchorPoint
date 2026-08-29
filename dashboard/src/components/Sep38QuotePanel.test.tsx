import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { Sep38QuotePanel, type Sep38Quote } from './Sep38QuotePanel';

describe('Sep38QuotePanel Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders initial quote panel state with input fields and quote types', () => {
    render(<Sep38QuotePanel />);

    expect(screen.getByRole('heading', { name: /SEP-38 Quote/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Fixed/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Indicative/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/You Send/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/You Receive/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Get Quote/i })).toBeInTheDocument();
  });

  it('fetches and displays quote details and countdown indicator on request', async () => {
    const mockQuote: Sep38Quote = {
      id: 'quote-test-123',
      price: '0.9985',
      sellAmount: '100.00',
      buyAmount: '99.85',
      sellAsset: 'USDC',
      buyAsset: 'USD',
      quoteType: 'fixed',
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      totalDurationSeconds: 30,
    };

    const mockFetch = vi.fn().mockResolvedValue(mockQuote);

    render(
      <Sep38QuotePanel
        onFetchQuote={mockFetch}
        initialValiditySeconds={30}
      />
    );

    const sellInput = screen.getByLabelText(/You Send/i);
    fireEvent.change(sellInput, { target: { value: '100.00' } });

    const getQuoteBtn = screen.getByRole('button', { name: /Get Quote/i });
    await act(async () => {
      fireEvent.click(getQuoteBtn);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Conversion Rate: 1 USDC = 0.9985 USD/i)).toBeInTheDocument();
    expect(screen.getByText(/quote-test-123/i)).toBeInTheDocument();

    const progressbar = screen.getByRole('progressbar', { name: /Quote validity countdown/i });
    expect(progressbar).toBeInTheDocument();
    expect(progressbar).toHaveAttribute('aria-valuenow', '30');
    expect(screen.getAllByText(/30s/i).length).toBeGreaterThan(0);
  });

  it('updates countdown timer as time advances', async () => {
    const mockQuote: Sep38Quote = {
      id: 'quote-countdown-1',
      price: '1.0000',
      sellAmount: '50.00',
      buyAmount: '50.00',
      sellAsset: 'USDC',
      buyAsset: 'USD',
      quoteType: 'fixed',
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      totalDurationSeconds: 30,
    };

    const mockFetch = vi.fn().mockResolvedValue(mockQuote);

    render(
      <Sep38QuotePanel
        onFetchQuote={mockFetch}
        initialValiditySeconds={30}
      />
    );

    fireEvent.change(screen.getByLabelText(/You Send/i), { target: { value: '50.00' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Get Quote/i }));
    });

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');

    // Advance 10 seconds
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');

    // Advance another 15 seconds
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  });

  it('automatically fetches a new quote when timer reaches zero and input is unchanged', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve({
        id: `quote-auto-${callCount}`,
        price: (1.0 + callCount * 0.001).toFixed(4),
        sellAmount: '100.00',
        buyAmount: (100.0 * (1.0 + callCount * 0.001)).toFixed(2),
        sellAsset: 'USDC',
        buyAsset: 'USD',
        quoteType: 'fixed',
        expiresAt: new Date(Date.now() + 10000).toISOString(),
        totalDurationSeconds: 10,
      });
    });

    render(
      <Sep38QuotePanel
        onFetchQuote={mockFetch}
        initialValiditySeconds={10}
        autoRefresh={true}
      />
    );

    fireEvent.change(screen.getByLabelText(/You Send/i), { target: { value: '100.00' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Get Quote/i }));
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/quote-auto-1/i)).toBeInTheDocument();

    // Advance timer to expiration (10 seconds)
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });

    // Auto-refresh should be triggered
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/quote-auto-2/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
  });

  it('disables submission button and shows "Refreshing Quote..." state during refresh', async () => {
    let resolveQuotePromise: (quote: Sep38Quote) => void;
    const pendingQuotePromise = new Promise<Sep38Quote>((resolve) => {
      resolveQuotePromise = resolve;
    });

    const initialQuote: Sep38Quote = {
      id: 'quote-init',
      price: '1.00',
      sellAmount: '200.00',
      buyAmount: '200.00',
      sellAsset: 'USDC',
      buyAsset: 'USD',
      quoteType: 'fixed',
      expiresAt: new Date(Date.now() + 10000).toISOString(),
      totalDurationSeconds: 10,
    };

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(initialQuote)
      .mockReturnValueOnce(pendingQuotePromise);

    render(
      <Sep38QuotePanel
        onFetchQuote={mockFetch}
        initialValiditySeconds={10}
      />
    );

    fireEvent.change(screen.getByLabelText(/You Send/i), { target: { value: '200.00' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Get Quote/i }));
    });

    expect(screen.getByRole('button', { name: /Accept & Submit Quote/i })).toBeEnabled();

    // Trigger refresh via "New Quote" or "Refresh Now"
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Refresh Now/i }));
    });

    // Should now display "Refreshing Quote..." and be disabled
    const refreshingBtn = screen.getByRole('button', { name: /Refreshing Quote\.\.\./i });
    expect(refreshingBtn).toBeInTheDocument();
    expect(refreshingBtn).toBeDisabled();

    // Resolve the second quote
    await act(async () => {
      resolveQuotePromise!({
        id: 'quote-refreshed',
        price: '1.005',
        sellAmount: '200.00',
        buyAmount: '201.00',
        sellAsset: 'USDC',
        buyAsset: 'USD',
        quoteType: 'fixed',
        expiresAt: new Date(Date.now() + 10000).toISOString(),
        totalDurationSeconds: 10,
      });
      await Promise.resolve();
    });

    expect(screen.getByText(/quote-refreshed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Accept & Submit Quote/i })).toBeEnabled();
  });

  it('submits accepted quote successfully', async () => {
    const mockQuote: Sep38Quote = {
      id: 'quote-submit-1',
      price: '1.00',
      sellAmount: '150.00',
      buyAmount: '150.00',
      sellAsset: 'USDC',
      buyAsset: 'USD',
      quoteType: 'fixed',
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      totalDurationSeconds: 30,
    };

    const mockFetch = vi.fn().mockResolvedValue(mockQuote);
    const mockSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <Sep38QuotePanel
        onFetchQuote={mockFetch}
        onSubmitQuote={mockSubmit}
        initialValiditySeconds={30}
      />
    );

    fireEvent.change(screen.getByLabelText(/You Send/i), { target: { value: '150.00' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Get Quote/i }));
    });

    const submitBtn = screen.getByRole('button', { name: /Accept & Submit Quote/i });
    expect(submitBtn).toBeEnabled();

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(mockSubmit).toHaveBeenCalledWith(mockQuote);
    expect(screen.getByText(/Conversion quote #quote-su accepted successfully!/i)).toBeInTheDocument();
  });
});
