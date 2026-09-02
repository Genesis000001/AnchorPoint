import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveWebview } from './InteractiveWebview';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className} {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('InteractiveWebview', () => {
  const defaultProps = {
    anchorName: 'Test Anchor',
    onComplete: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders idle state initially', () => {
    render(<InteractiveWebview {...defaultProps} />);
    expect(screen.getByText('Test Anchor Secure Portal')).toBeInTheDocument();
    expect(screen.getByText('Launch KYC Portal')).toBeInTheDocument();
  });

  it('can launch the webview and show active state', async () => {
    render(<InteractiveWebview {...defaultProps} />);

    fireEvent.click(screen.getByText('Launch KYC Portal'));

    await waitFor(() => {
      expect(screen.getByText('Establishing secure channel…')).toBeInTheDocument();
    }, { timeout: 3000 });

    await waitFor(() => {
      expect(screen.getByText('Identity Verification')).toBeInTheDocument();
      expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('toggles fullscreen mode correctly', async () => {
    render(<InteractiveWebview {...defaultProps} />);

    fireEvent.click(screen.getByText('Launch KYC Portal'));

    await waitFor(() => {
      expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
    }, { timeout: 5000 });

    const fullscreenButton = screen.getByLabelText('Enter fullscreen');
    fireEvent.click(fullscreenButton);

    await waitFor(() => {
      expect(screen.getByLabelText('Exit fullscreen')).toBeInTheDocument();
    });

    const webviewContainer = screen.getByRole('region', { name: /Anchor Interactive Flow interactive panel/ });
    expect(webviewContainer.className).toContain('fixed inset-4 z-50');

    fireEvent.click(screen.getByLabelText('Exit fullscreen'));

    await waitFor(() => {
      expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
    });
    expect(webviewContainer.className).toContain('aspect-video');
  });

  it('handles close button correctly', async () => {
    const onDismiss = vi.fn();
    render(<InteractiveWebview {...defaultProps} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText('Launch KYC Portal'));

    await waitFor(() => {
      expect(screen.getByLabelText('Close webview')).toBeInTheDocument();
    }, { timeout: 5000 });

    fireEvent.click(screen.getByLabelText('Close webview'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('maintains iframe state when resizing (no re-render issues)', async () => {
    render(<InteractiveWebview {...defaultProps} />);

    fireEvent.click(screen.getByText('Launch KYC Portal'));

    await waitFor(() => {
      expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
    }, { timeout: 5000 });

    window.dispatchEvent(new Event('resize'));

    const fullscreenButton = screen.getByLabelText('Enter fullscreen');
    for (let i = 0; i < 3; i++) {
      fireEvent.click(fullscreenButton);
      const fullnameInput = screen.queryByLabelText('Full Name');
      expect(fullnameInput).toBeInTheDocument();
    }
  });

  it('ignores messages from unexpected origins', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(
      <InteractiveWebview
        anchorName="Test Anchor"
        interactiveUrl="https://kyc.testanchor.example/sep24"
        onComplete={onComplete}
      />
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://malicious.example',
          data: { transaction: { status: 'completed' } },
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onComplete).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('triggers onComplete when status is pending_user_transfer_start', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(
      <InteractiveWebview
        anchorName="Test Anchor"
        interactiveUrl="https://kyc.testanchor.example/sep24"
        onComplete={onComplete}
      />
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://kyc.testanchor.example',
          data: { transaction: { status: 'pending_user_transfer_start' } },
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onComplete).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('triggers onComplete when status is completed and data is JSON string', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(
      <InteractiveWebview
        anchorName="Test Anchor"
        interactiveUrl="https://kyc.testanchor.example/sep24"
        onComplete={onComplete}
      />
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://kyc.testanchor.example',
          data: JSON.stringify({ transaction: { status: 'completed' } }),
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onComplete).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
