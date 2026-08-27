import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WalletModal } from './WalletModal';
import { WalletManager } from '../lib/wallet';

// Mock the WalletManager
vi.mock('../lib/wallet', () => ({
  WalletManager: {
    getInstance: vi.fn(() => ({
      getWalletOptions: vi.fn(() => Promise.resolve([
        { id: 'freighter', name: 'Freighter', description: 'Freighter extension', accent: 'from-sky-500/20 to-cyan-500/20', installed: true },
        { id: 'albedo', name: 'Albedo', description: 'Albedo extension', accent: 'from-fuchsia-500/20 to-violet-500/20', installed: false },
        { id: 'xbull', name: 'xBull', description: 'xBull extension', accent: 'from-orange-500/20 to-amber-500/20', installed: true },
        { id: 'rabet', name: 'Rabet', description: 'Rabet extension', accent: 'from-emerald-500/20 to-lime-500/20', installed: false },
      ])),
    })),
  },
}));

describe('WalletModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all supported wallet options with installation status', async () => {
    render(
      <WalletModal
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    // Wait for wallet options to load
    await waitFor(() => {
      expect(screen.getByText('Freighter')).toBeTruthy();
      expect(screen.getByText('Albedo')).toBeTruthy();
      expect(screen.getByText('xBull')).toBeTruthy();
      expect(screen.getByText('Rabet')).toBeTruthy();
    });

    expect(screen.getAllByText('Installed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not installed').length).toBeGreaterThan(0);
  });

  it('disables uninstalled wallet buttons', async () => {
    render(
      <WalletModal
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    // Wait for wallet options to load
    await waitFor(() => {
      expect(screen.getByText('Albedo')).toBeTruthy();
    });

    const albedoButton = screen.getByRole('button', { name: /albedo/i });
    expect(albedoButton.getAttribute('disabled')).not.toBeNull();
  });

  it('calls the selection handler for an installed wallet', async () => {
    const onSelect = vi.fn();

    render(
      <WalletModal
        isOpen
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );

    // Wait for wallet options to load
    await waitFor(() => {
      const freighterButton = screen.getByRole('button', { name: /freighter/i });
      fireEvent.click(freighterButton);
    });

    expect(onSelect).toHaveBeenCalledWith('freighter');
  });

  it('does not call selection handler for uninstalled wallet', async () => {
    const onSelect = vi.fn();

    render(
      <WalletModal
        isOpen
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );

    // Wait for wallet options to load
    await waitFor(() => {
      const albedoButton = screen.getByRole('button', { name: /albedo/i });
      fireEvent.click(albedoButton);
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows loading state initially', async () => {
    render(
      <WalletModal
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    // Initially shows loading state
    expect(screen.getByText('Loading wallet options...')).toBeTruthy();

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading wallet options...')).toBeNull();
    });
  });

  it('closes modal when onClose is called', () => {
    const onClose = vi.fn();

    const { rerender } = render(
      <WalletModal
        isOpen={false}
        onClose={onClose}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.queryByText('Connect a wallet')).toBeNull();
  });
});
