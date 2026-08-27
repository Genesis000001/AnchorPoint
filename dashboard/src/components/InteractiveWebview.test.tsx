import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveWebview } from './InteractiveWebview';

describe('InteractiveWebview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  it('ignores messages from unexpected origins', async () => {
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
  });

  it('triggers onComplete when status is pending_user_transfer_start', async () => {
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
  });

  it('triggers onComplete when status is completed and data is JSON string', async () => {
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
  });
});
