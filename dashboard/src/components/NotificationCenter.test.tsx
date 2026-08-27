import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationCenter, STREAM_PATH } from './NotificationCenter';

type Handler = ((event: Event) => void) | null;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onopen: Handler = null;
  onerror: Handler = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

const historyPayload = {
  status: 'success',
  data: [
    {
      id: 'hist-1',
      userId: 'user-1',
      transactionId: null,
      type: 'EMAIL',
      status: 'SENT',
      message: 'Deposit completed',
      createdAt: new Date().toISOString(),
    },
  ],
};

describe('NotificationCenter event stream reconnect', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => historyPayload,
      }),
    );
    localStorage.setItem('authToken', 'test-token');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('reconnects with exponential backoff after a stream drop and recovers', async () => {
    render(<NotificationCenter apiBaseUrl="http://localhost:3002" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(`http://localhost:3002${STREAM_PATH}`);

    act(() => {
      MockEventSource.instances[0].onopen?.(new Event('open'));
    });
    expect(screen.queryByText('Reconnecting event stream...')).toBeNull();

    act(() => {
      MockEventSource.instances[0].onerror?.(new Event('error'));
    });
    expect(screen.getByText('Reconnecting event stream...')).toBeTruthy();
    expect(MockEventSource.instances[0].close).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(MockEventSource.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => {
      MockEventSource.instances[1].onerror?.(new Event('error'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(MockEventSource.instances).toHaveLength(3);

    act(() => {
      MockEventSource.instances[2].onopen?.(new Event('open'));
    });
    expect(screen.queryByText('Reconnecting event stream...')).toBeNull();

    act(() => {
      MockEventSource.instances[2].onerror?.(new Event('error'));
    });
    expect(screen.getByText('Reconnecting event stream...')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(MockEventSource.instances).toHaveLength(4);

    act(() => {
      MockEventSource.instances[3].onopen?.(new Event('open'));
    });
    expect(screen.queryByText('Reconnecting event stream...')).toBeNull();
  });

  it('caps reconnect delay at 30s', async () => {
    render(<NotificationCenter apiBaseUrl="http://localhost:3002" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Drive backoff: 1, 2, 4, 8, 16, 30, 30
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const current = MockEventSource.instances[MockEventSource.instances.length - 1];
      act(() => {
        current.onerror?.(new Event('error'));
      });
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    }

    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(7);

    const beforeCap = MockEventSource.instances.length;
    const last = MockEventSource.instances[beforeCap - 1];
    act(() => {
      last.onerror?.(new Event('error'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29999);
    });
    expect(MockEventSource.instances).toHaveLength(beforeCap);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(MockEventSource.instances).toHaveLength(beforeCap + 1);
  });

  it('appends live stream notifications after history loads', async () => {
    render(<NotificationCenter apiBaseUrl="http://localhost:3002" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Deposit completed')).toBeTruthy();

    act(() => {
      MockEventSource.instances[0].onopen?.(new Event('open'));
      MockEventSource.instances[0].onmessage?.({
        data: JSON.stringify({
          id: 'live-1',
          userId: 'user-1',
          transactionId: 'tx-99',
          type: 'PUSH',
          status: 'PENDING',
          message: 'Live webhook received',
          createdAt: new Date().toISOString(),
        }),
      } as MessageEvent);
    });

    expect(screen.getByText('Live webhook received')).toBeTruthy();
  });
});
