import { Networks } from '@stellar/stellar-sdk';

export type NetworkType = 'TESTNET' | 'PUBLIC' | 'FUTURENET';

export interface NetworkEndpoints {
  network: NetworkType;
  /** Human-readable name for banners and confirmation copy. */
  label: string;
  horizonUrl: string;
  /** Soroban JSON-RPC endpoint for this network. */
  sorobanRpcUrl: string;
  networkPassphrase: string;
  /** True only for PUBLIC, where operations move real value. */
  isMainnet: boolean;
}

/**
 * Endpoint set per network. Switching networks must swap every entry
 * together — a Horizon URL paired with the wrong passphrase silently
 * produces transactions the target network will reject.
 */
export const NETWORK_ENDPOINTS: Record<NetworkType, NetworkEndpoints> = {
  TESTNET: {
    network: 'TESTNET',
    label: 'Testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
    isMainnet: false,
  },
  PUBLIC: {
    network: 'PUBLIC',
    label: 'Public (Mainnet)',
    horizonUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://mainnet.sorobanrpc.com',
    networkPassphrase: Networks.PUBLIC,
    isMainnet: true,
  },
  FUTURENET: {
    network: 'FUTURENET',
    label: 'Futurenet',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    sorobanRpcUrl: 'https://rpc-futurenet.stellar.org',
    networkPassphrase: Networks.FUTURENET,
    isMainnet: false,
  },
};

export const NETWORK_TYPES = Object.keys(NETWORK_ENDPOINTS) as NetworkType[];

export const DEFAULT_NETWORK: NetworkType = 'TESTNET';

export function isNetworkType(value: unknown): value is NetworkType {
  return typeof value === 'string' && value in NETWORK_ENDPOINTS;
}

/** Resolves any input to a known network, falling back to the default. */
export function toNetworkType(value: unknown): NetworkType {
  return isNetworkType(value) ? value : DEFAULT_NETWORK;
}

export function getEndpoints(network: NetworkType): NetworkEndpoints {
  return NETWORK_ENDPOINTS[network];
}
