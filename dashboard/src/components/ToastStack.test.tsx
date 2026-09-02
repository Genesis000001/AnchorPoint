import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, beforeEach, expect, it, vi } from 'vitest';
import { MotionGlobalConfig } from 'framer-motion';
import {
  MAX_VISIBLE_TOASTS,
  TOAST_DURATION_MS,
  ToastContainer,
  statusToSeverity,
  useToastQueue,
} from './NotificationCenter';
import type { Toast } from './NotificationCenter';

// Resolve presence enter/exit synchronously so the DOM matches the queue.
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});

const toast = (id: string, severity: Toast['severity'] = 'info'): Toast => ({
  id,
  message: `Message ${id}`,
  severity,
});

describe('statusToSeverity', () => {
  it('maps notification statuses onto toast severities', () => {
    expect(statusToSeverity('SENT')).toBe('success');
    expect(statusToSeverity('FAILED')).toBe('error');
    expect(statusToSeverity('PENDING')).toBe('warning');
  });
});

describe('useToastQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty and appends pushed toasts newest-last', () => {
    const { result } = renderHook(() => useToastQueue());
    expect(result.current.toasts).toEqual([]);

    act(() => {
      result.current.push(toast('a'));
      result.current.push(toast('b'));
    });

    expect(result.current.toasts.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('ignores a duplicate id already in the queue', () => {
    const { result } = renderHook(() => useToastQueue());

    act(() => {
      result.current.push(toast('a'));
      result.current.push(toast('a'));
    });

    expect(result.current.toasts).toHaveLength(1);
  });

  it('drops the oldest toast once the visible cap is exceeded', () => {
    const { result } = renderHook(() => useToastQueue());

    act(() => {
      for (let index = 0; index < MAX_VISIBLE_TOASTS + 2; index += 1) {
        result.current.push(toast(`t${index}`));
      }
    });

    expect(result.current.toasts).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(result.current.toasts[0].id).toBe('t2');
  });

  it('auto-dismisses a toast after the default 5s duration', () => {
    const { result } = renderHook(() => useToastQueue());

    act(() => {
      result.current.push(toast('a'));
    });

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('expires staggered toasts independently', () => {
    const { result } = renderHook(() => useToastQueue());

    act(() => {
      result.current.push(toast('first'));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
      result.current.push(toast('second'));
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.toasts.map((item) => item.id)).toEqual(['second']);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('pauses auto-dismiss and resumes with the remaining time only', () => {
    const { result } = renderHook(() => useToastQueue());

    act(() => {
      result.current.push(toast('a'));
    });

    act(() => {
      vi.advanceTimersByTime(4000);
      result.current.pause();
    });
    expect(result.current.paused).toBe(true);

    // Far longer than the full duration — a paused toast must survive it.
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 4);
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      result.current.resume();
    });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('holds a toast pushed while paused until the stack resumes', () => {
    const { result } = renderHook(() => useToastQueue());

    act(() => {
      result.current.pause();
      result.current.push(toast('late'));
    });

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      result.current.resume();
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('dismisses a single toast on demand without touching the rest', () => {
    const { result } = renderHook(() => useToastQueue());

    act(() => {
      result.current.push(toast('a'));
      result.current.push(toast('b'));
    });
    act(() => {
      result.current.dismiss('a');
    });

    expect(result.current.toasts.map((item) => item.id)).toEqual(['b']);
  });

  it('honours a custom duration', () => {
    const { result } = renderHook(() => useToastQueue(1000));

    act(() => {
      result.current.push(toast('a'));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.toasts).toHaveLength(0);
  });
});

describe('<ToastContainer />', () => {
  it('renders one card per toast with its severity', () => {
    render(
      <ToastContainer
        toasts={[toast('a', 'success'), toast('b', 'error')]}
        onDismiss={() => {}}
      />,
    );

    const container = screen.getByTestId('toast-container');
    const cards = container.querySelectorAll('[data-severity]');
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute('data-severity')).toBe('success');
    expect(cards[1].getAttribute('data-severity')).toBe('error');
  });

  it('announces errors assertively and everything else politely', () => {
    render(
      <ToastContainer
        toasts={[toast('ok', 'success'), toast('warn', 'warning'), toast('bad', 'error')]}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('dismisses via the close button', () => {
    const onDismiss = vi.fn();
    render(<ToastContainer toasts={[toast('a')]} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification: Message a' }));
    expect(onDismiss).toHaveBeenCalledWith('a');
  });

  it('pauses on hover and resumes when the pointer leaves', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    render(
      <ToastContainer
        toasts={[toast('a')]}
        onDismiss={() => {}}
        onPause={onPause}
        onResume={onResume}
      />,
    );

    const container = screen.getByTestId('toast-container');
    fireEvent.mouseEnter(container);
    expect(onPause).toHaveBeenCalledTimes(1);

    fireEvent.mouseLeave(container);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('renders nothing but the container when the queue is empty', () => {
    render(<ToastContainer toasts={[]} onDismiss={() => {}} />);
    expect(screen.getByTestId('toast-container').querySelectorAll('[data-severity]')).toHaveLength(0);
  });
});
