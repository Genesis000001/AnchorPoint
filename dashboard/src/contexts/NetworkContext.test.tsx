import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkProvider, useNetwork } from './NetworkContext';
import { NetworkBanner, NetworkSelector } from '../components/NetworkSelector';
import {
  DEFAULT_NETWORK,
  NETWORK_ENDPOINTS,
  getEndpoints,
  isNetworkType,
  toNetworkType,
} from '../lib/stellar/networks';
import type { NetworkEndpoints, NetworkType } from '../lib/stellar/networks';
import type { StellarServers } from '../lib/stellar/servers';

const API = 'http://localhost:3002';

/**
 * Stand-in for the SDK server pair. Every call is recorded so a test can
 * assert the servers were genuinely rebuilt against the new endpoints.
 */
const makeFactory = () => {
  const calls: NetworkEndpoints[] = [];
  const factory = vi.fn((endpoints: NetworkEndpoints) => {
    calls.push(endpoints);
    return {
      horizon: { serverURL: endpoints.horizonUrl },
      soroban: { serverURL: endpoints.sorobanRpcUrl },
      endpoints,
    } as unknown as StellarServers;
  });
  return { factory, calls };
};

const wrapper =
  (props: { initialNetwork?: NetworkType; createServers?: ReturnType<typeof makeFactory>['factory'] }) =>
  ({ children }: { children: React.ReactNode }) => (
    <NetworkProvider apiBaseUrl={API} {...props}>
      {children}
    </NetworkProvider>
  );

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('network endpoint table', () => {
  it('gives every network a distinct Horizon, RPC and passphrase', () => {
    const horizons = new Set<string>();
    const rpcs = new Set<string>();
    const passphrases = new Set<string>();

    (Object.keys(NETWORK_ENDPOINTS) as NetworkType[]).forEach((type) => {
      const endpoints = NETWORK_ENDPOINTS[type];
      expect(endpoints.network).toBe(type);
      horizons.add(endpoints.horizonUrl);
      rpcs.add(endpoints.sorobanRpcUrl);
      passphrases.add(endpoints.networkPassphrase);
    });

    expect(horizons.size).toBe(3);
    expect(rpcs.size).toBe(3);
    expect(passphrases.size).toBe(3);
  });

  it('flags only PUBLIC as mainnet', () => {
    expect(getEndpoints('PUBLIC').isMainnet).toBe(true);
    expect(getEndpoints('TESTNET').isMainnet).toBe(false);
    expect(getEndpoints('FUTURENET').isMainnet).toBe(false);
  });

  it('narrows and coerces unknown network values', () => {
    expect(isNetworkType('TESTNET')).toBe(true);
    expect(isNetworkType('LOCALNET')).toBe(false);
    expect(toNetworkType('PUBLIC')).toBe('PUBLIC');
    expect(toNetworkType(undefined)).toBe(DEFAULT_NETWORK);
  });
});

describe('NetworkProvider', () => {
  it('builds the SDK servers for the initial network', () => {
    const { factory, calls } = makeFactory();
    const { result } = renderHook(() => useNetwork(), {
      wrapper: wrapper({ initialNetwork: 'TESTNET', createServers: factory }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(result.current.endpoints.networkPassphrase).toBe(
      NETWORK_ENDPOINTS.TESTNET.networkPassphrase,
    );
  });

  it('re-initialises Horizon and Soroban RPC when the network switches', async () => {
    const { factory, calls } = makeFactory();
    const { result } = renderHook(() => useNetwork(), {
      wrapper: wrapper({ initialNetwork: 'TESTNET', createServers: factory }),
    });

    const before = result.current.servers;

    await act(async () => {
      await result.current.switchNetwork('PUBLIC');
    });

    expect(result.current.network).toBe('PUBLIC');
    expect(calls).toHaveLength(2);
    expect(calls[1].horizonUrl).toBe('https://horizon.stellar.org');
    expect(calls[1].sorobanRpcUrl).toBe('https://mainnet.sorobanrpc.com');
    expect(calls[1].networkPassphrase).toBe(NETWORK_ENDPOINTS.PUBLIC.networkPassphrase);
    // A brand new pair, not a mutated one.
    expect(result.current.servers).not.toBe(before);
  });

  it('persists the switch to the backend before repointing', async () => {
    const { factory } = makeFactory();
    const { result } = renderHook(() => useNetwork(), {
      wrapper: wrapper({ initialNetwork: 'TESTNET', createServers: factory }),
    });

    await act(async () => {
      await result.current.switchNetwork('FUTURENET');
    });

    expect(fetch).toHaveBeenCalledWith(
      `${API}/api/admin/network`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ network: 'FUTURENET' }),
      }),
    );
  });

  it('keeps the previous endpoints when the backend rejects the switch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const { factory, calls } = makeFactory();
    const { result } = renderHook(() => useNetwork(), {
      wrapper: wrapper({ initialNetwork: 'TESTNET', createServers: factory }),
    });

    await act(async () => {
      await result.current.switchNetwork('PUBLIC');
    });

    expect(result.current.network).toBe('TESTNET');
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Failed to switch network');
    expect(calls).toHaveLength(1);
    expect(result.current.endpoints.horizonUrl).toBe('https://horizon-testnet.stellar.org');
  });

  it('does no work when switching to the network already active', async () => {
    const { factory, calls } = makeFactory();
    const { result } = renderHook(() => useNetwork(), {
      wrapper: wrapper({ initialNetwork: 'PUBLIC', createServers: factory }),
    });

    await act(async () => {
      await result.current.switchNetwork('PUBLIC');
    });

    expect(fetch).not.toHaveBeenCalledWith(`${API}/api/admin/network`, expect.anything());
    expect(calls).toHaveLength(1);
  });

  it('adopts the network the backend reports as active on mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ network: 'FUTURENET' }) }),
    );
    const { factory, calls } = makeFactory();
    const { result } = renderHook(() => useNetwork(), {
      wrapper: wrapper({ createServers: factory }),
    });

    await waitFor(() => expect(result.current.network).toBe('FUTURENET'));
    expect(calls[calls.length - 1].horizonUrl).toBe('https://horizon-futurenet.stellar.org');
  });

  it('ignores an unrecognised network reported by the backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ network: 'LOCALNET' }) }),
    );
    const { factory } = makeFactory();
    const { result } = renderHook(() => useNetwork(), {
      wrapper: wrapper({ createServers: factory }),
    });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.network).toBe(DEFAULT_NETWORK);
  });

  it('throws when useNetwork is used outside a provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useNetwork())).toThrow(/within a NetworkProvider/);
    consoleError.mockRestore();
  });
});

describe('NetworkSelector', () => {
  const renderSelector = (initialNetwork: NetworkType = 'TESTNET') => {
    const { factory, calls } = makeFactory();
    render(
      <NetworkProvider apiBaseUrl={API} initialNetwork={initialNetwork} createServers={factory}>
        <NetworkSelector />
        <NetworkBanner />
      </NetworkProvider>,
    );
    return { calls };
  };

  it('reflects the active network from context', () => {
    renderSelector('FUTURENET');
    expect(screen.getByLabelText('Select Stellar Network')).toHaveProperty('value', 'FUTURENET');
  });

  it('requires typed confirmation before switching the global endpoints', async () => {
    const { calls } = renderSelector('TESTNET');

    fireEvent.change(screen.getByLabelText('Select Stellar Network'), {
      target: { value: 'PUBLIC' },
    });

    const confirm = await screen.findByRole('button', { name: 'Switch to PUBLIC' });
    // Blocked until CONFIRM is typed, so the endpoints must not have moved.
    expect(confirm).toHaveProperty('disabled', true);
    expect(calls).toHaveLength(1);

    fireEvent.change(screen.getByPlaceholderText('CONFIRM'), { target: { value: 'CONFIRM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to PUBLIC' }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].horizonUrl).toBe('https://horizon.stellar.org');
  });

  it('leaves the endpoints alone when the confirmation is cancelled', async () => {
    const { calls } = renderSelector('TESTNET');

    fireEvent.change(screen.getByLabelText('Select Stellar Network'), {
      target: { value: 'PUBLIC' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(calls).toHaveLength(1);
    expect(screen.getByLabelText('Select Stellar Network')).toHaveProperty('value', 'TESTNET');
  });
});

describe('NetworkBanner', () => {
  const renderBanner = (initialNetwork: NetworkType) => {
    const { factory } = makeFactory();
    render(
      <NetworkProvider apiBaseUrl={API} initialNetwork={initialNetwork} createServers={factory}>
        <NetworkBanner />
      </NetworkProvider>,
    );
  };

  it('names the active environment and its Horizon endpoint', () => {
    renderBanner('TESTNET');

    const banner = screen.getByTestId('network-banner');
    expect(banner.getAttribute('data-network')).toBe('TESTNET');
    expect(banner.textContent).toContain('Connected to Testnet');
    expect(banner.textContent).toContain('https://horizon-testnet.stellar.org');
  });

  it('warns when live on mainnet', () => {
    renderBanner('PUBLIC');

    const banner = screen.getByTestId('network-banner');
    expect(banner.textContent).toContain('Live on Public (Mainnet)');
    expect(banner.className).toContain('rose');
  });
});
