import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY_FEEDBACK_MS, CopyablePublicKey } from './CopyablePublicKey';

const PUBLIC_KEY = 'GBRPYHIL2DZA7B2TNNK3H53ZLMFTN7ZSG6EVM4RGICXKWRB3YAMPLE';

describe('CopyablePublicKey', () => {
  const writeText = vi.fn();

  // defineProperty rather than assignment: userEvent.setup() installs its own
  // getter-only navigator.clipboard stub that a plain assignment cannot replace.
  const installClipboard = () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  };

  /** userEvent stubs the clipboard on setup, so reinstate the spy afterwards. */
  const setupUser = () => {
    const user = userEvent.setup();
    installClipboard();
    return user;
  };

  beforeEach(() => {
    installClipboard();
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('copies the full public key while displaying a shortened value', async () => {
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} />);

    expect(screen.getByText('GBRPYHIL...B3YAMPLE')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /copy public key/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PUBLIC_KEY));

    expect(screen.getByText('Public key copied to clipboard.')).toBeTruthy();
  });

  it('shows a "Copied!" tooltip and a checkmark after a successful copy', async () => {
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} />);

    expect(screen.queryByTestId('copy-tooltip')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /copy public key/i }));

    const tooltip = await screen.findByTestId('copy-tooltip');
    expect(tooltip.textContent).toBe('Copied!');
    expect(tooltip.getAttribute('data-state')).toBe('copied');
    // The bubble is decorative; the live region carries the announcement.
    expect(tooltip.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.lucide-check')).toBeTruthy();
  });

  it('clears the copied state after 2 seconds', async () => {
    vi.useFakeTimers();
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} />);

    fireEvent.click(screen.getByRole('button', { name: /copy public key/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('copy-tooltip')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS - 1);
    });
    expect(screen.queryByTestId('copy-tooltip')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('copy-tooltip')).toBeNull();
    expect(screen.queryByText('Public key copied to clipboard.')).toBeNull();
  });

  it('announces the copied state through a polite live region', async () => {
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} />);

    fireEvent.click(screen.getByRole('button', { name: /copy public key/i }));

    const announcement = await screen.findByText('Public key copied to clipboard.');
    expect(announcement.getAttribute('aria-live')).toBe('polite');
    expect(announcement.className).toContain('sr-only');
  });

  it('copies when the focused button is activated with Enter', async () => {
    const user = setupUser();
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /copy public key/i }));

    await user.keyboard('{Enter}');

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PUBLIC_KEY));
    expect((await screen.findByTestId('copy-tooltip')).textContent).toBe('Copied!');
  });

  it('copies when the focused button is activated with Space', async () => {
    const user = setupUser();
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} />);

    await user.tab();
    await user.keyboard(' ');

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PUBLIC_KEY));
  });

  it('announces clipboard failures without throwing', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} />);

    fireEvent.click(screen.getByRole('button', { name: /copy public key/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PUBLIC_KEY));

    expect(screen.getByText('Unable to copy public key.')).toBeTruthy();
    const tooltip = screen.getByTestId('copy-tooltip');
    expect(tooltip.textContent).toBe('Copy failed');
    expect(tooltip.getAttribute('data-state')).toBe('failed');
  });

  it('uses the custom label in the button, tooltip region and announcement', async () => {
    render(<CopyablePublicKey publicKey={PUBLIC_KEY} label="Testnet public key" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy testnet public key' }));

    expect(await screen.findByText('Testnet public key copied to clipboard.')).toBeTruthy();
  });
});
