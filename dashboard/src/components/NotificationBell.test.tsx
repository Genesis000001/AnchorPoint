import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

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
      readAt: new Date().toISOString(),
    },
  ],
};

describe('NotificationBell badge counter', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('AudioContext', class {
      createOscillator = () => ({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: { value: 0 },
        type: '',
      });
      createGain = () => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      });
    });
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

  it('initializes with correct unread count from history', async () => {
    render(<NotificationBell apiBaseUrl="http://localhost:3002" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Open the dropdown to trigger fetchNotifications
    const bellButton = screen.getByRole('button', { name: /Notifications/ });
    act(() => bellButton.click());

    await act(async () => {
      await Promise.resolve();
    });

    // The historical notification is already read, so badge should not show
    expect(screen.queryByText('1')).toBeNull();
  });

  it('increments badge counter when new unread notification arrives via SSE', async () => {
    render(<NotificationBell apiBaseUrl="http://localhost:3002" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Open the dropdown to fetch initial notifications
    const bellButton = screen.getByRole('button', { name: /Notifications/ });
    act(() => bellButton.click());

    await act(async () => {
      await Promise.resolve();
    });

    // Send a new PENDING (unread) notification via the mock SSE stream
    act(() => {
      MockEventSource.instances[0].onmessage?.({
        data: JSON.stringify({
          id: 'live-1',
          userId: 'user-1',
          transactionId: 'tx-99',
          type: 'PUSH',
          status: 'PENDING',
          message: 'New transaction pending',
          createdAt: new Date().toISOString(),
        }),
      } as MessageEvent);
    });

    // Badge should now show 1 unread notification
    expect(screen.getByText('1')).toBeTruthy();

    // Send another unread notification
    act(() => {
      MockEventSource.instances[0].onmessage?.({
        data: JSON.stringify({
          id: 'live-2',
          userId: 'user-1',
          transactionId: 'tx-100',
          type: 'EMAIL',
          status: 'PENDING',
          message: 'Another transaction pending',
          createdAt: new Date().toISOString(),
        }),
      } as MessageEvent);
    });

    // Badge should now show 2 unread notifications
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows 9+ when unread count exceeds 9', async () => {
    render(<NotificationBell apiBaseUrl="http://localhost:3002" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Open dropdown
    const bellButton = screen.getByRole('button', { name: /Notifications/ });
    act(() => bellButton.click());

    await act(async () => {
      await Promise.resolve();
    });

    // Send 10 unread notifications
    for (let i = 1; i <= 10; i++) {
      act(() => {
        MockEventSource.instances[0].onmessage?.({
          data: JSON.stringify({
            id: `live-${i}`,
            userId: 'user-1',
            transactionId: `tx-${i}`,
            type: 'PUSH',
            status: 'PENDING',
            message: `Notification ${i}`,
            createdAt: new Date().toISOString(),
          }),
        } as MessageEvent);
      });
    }

    // Badge should show 9+
    expect(screen.getByText('9+')).toBeTruthy();
  });

  it('triggers high-severity effects for FAILED status notifications', async () => {
    render(<NotificationBell apiBaseUrl="http://localhost:3002" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Send a FAILED (high-severity) notification
    act(() => {
      MockEventSource.instances[0].onmessage?.({
        data: JSON.stringify({
          id: 'live-failed-1',
          userId: 'user-1',
          transactionId: 'tx-failed',
          type: 'SMS',
          status: 'FAILED',
          message: 'Transaction failed',
          createdAt: new Date().toISOString(),
        }),
      } as MessageEvent);
    });

    // Badge should still count it as unread
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('does not increment badge for duplicate notifications', async () => {
    render(<NotificationBell apiBaseUrl="http://localhost:3002" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Send the same notification twice
    for (let i = 0; i < 2; i++) {
      act(() => {
        MockEventSource.instances[0].onmessage?.({
          data: JSON.stringify({
            id: 'live-duplicate-1',
            userId: 'user-1',
            transactionId: 'tx-duplicate',
            type: 'PUSH',
            status: 'PENDING',
            message: 'Duplicate notification',
            createdAt: new Date().toISOString(),
          }),
        } as MessageEvent);
      });
    }

    // Badge should only show 1, not 2
    expect(screen.getByText('1')).toBeTruthy();
  });
});