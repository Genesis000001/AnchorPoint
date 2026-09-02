import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const connectMock = vi.fn();
const disconnectMock = vi.fn();

vi.mock('./lib/wallet/FreighterAdapter', () => {
  class MockFreighterAdapter {
    connect = connectMock;
    disconnect = disconnectMock;
  }

  return { FreighterAdapter: MockFreighterAdapter };
});

vi.mock('./components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

vi.mock('./components/CopyablePublicKey', () => ({
  CopyablePublicKey: ({ publicKey }: { publicKey: string }) => <div>Connected wallet: {publicKey}</div>,
}));

vi.mock('./components/UserAvatarDropdown', () => ({
  UserAvatarDropdown: ({ onSignOut }: { onSignOut?: () => void }) => (
    <button type="button" onClick={onSignOut}>
      Sign Out
    </button>
  ),
}));

vi.mock('./components/DashboardOverview', () => ({ default: () => <div>Dashboard Overview</div> }));
vi.mock('./components/TransactionHistory', () => ({ default: () => <div>Transaction History</div> }));
vi.mock('./components/SEP24Flow', () => ({ default: () => <div>SEP24</div> }));
vi.mock('./components/KycStatusView', () => ({ default: () => <div>KYC</div> }));
vi.mock('./components/NotificationCenter', () => ({ default: () => <div>Notifications</div> }));
vi.mock('./components/NotificationPreferences', () => ({ default: () => <div>Notification Preferences</div> }));
vi.mock('./components/Sep38QuotePanel', () => ({ default: () => <div>Sep38 Quote</div> }));
vi.mock('./components/ServiceStatusPanel', () => ({ default: () => <div>Service Status</div> }));
vi.mock('./components/SettingsView', () => ({ default: () => <div>Settings</div> }));

describe('App wallet disconnect handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue({ publicKey: 'GTESTPUBLICKEY123', network: 'testnet' });
    disconnectMock.mockResolvedValue(undefined);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: null }),
      }),
    );

    localStorage.clear();
    sessionStorage.clear();
  });

  it('resets wallet/session state and clears token/cache stores on sign out', async () => {
    localStorage.setItem('authToken', 'token-123');
    localStorage.setItem('transactionCache', 'cached-transactions');
    localStorage.setItem('balanceStore', 'cached-balance');
    localStorage.setItem('themePreference', 'dark');
    sessionStorage.setItem('sessionToken', 'session-token');
    sessionStorage.setItem('miscData', 'should-stay');

    render(<App />);

    // The header button opens the provider picker; Freighter drives the adapter.
    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Freighter/ }));
    await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1));
    await screen.findByText(/Connected wallet:/i);

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(disconnectMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /connect wallet/i })).toBeTruthy());

    expect(screen.queryByText(/Connected wallet:/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy();

    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('transactionCache')).toBeNull();
    expect(localStorage.getItem('balanceStore')).toBeNull();
    expect(localStorage.getItem('themePreference')).toEqual('dark');
    expect(sessionStorage.getItem('sessionToken')).toBeNull();
    expect(sessionStorage.getItem('miscData')).toEqual('should-stay');
  });
});
