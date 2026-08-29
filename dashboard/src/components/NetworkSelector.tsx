import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';
import { useNetwork } from '../contexts/NetworkContext';
import { NETWORK_TYPES } from '../lib/stellar/networks';
import type { NetworkType } from '../lib/stellar/networks';

const networkColor = (net: NetworkType) => {
  switch (net) {
    case 'PUBLIC':
      return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    case 'FUTURENET':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    default:
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  }
};

/**
 * Network switch wired to the global {@link useNetwork} context, so confirming
 * a change repoints the Horizon and Soroban RPC endpoints for the whole app
 * rather than only this component's local state.
 */
export const NetworkSelector: React.FC = () => {
  const { network, status, error, switchNetwork } = useNetwork();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetNetwork, setTargetNetwork] = useState<NetworkType>(network);

  const loading = status === 'loading';

  const handleNetworkChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as NetworkType;
    if (value !== network) {
      setTargetNetwork(value);
      setIsModalOpen(true);
    }
  };

  const handleNetworkChangeConfirm = async () => {
    setIsModalOpen(false);
    await switchNetwork(targetNetwork);
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className={`hidden rounded-full border px-2.5 py-1 text-xs font-semibold md:inline ${networkColor(network)}`}
      >
        {network}
      </span>

      {network === 'PUBLIC' && (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-400">
          <AlertTriangle size={12} aria-hidden="true" />
          Mainnet
        </span>
      )}

      <label htmlFor="network-selector" className="sr-only">
        Select Stellar Network
      </label>
      <select
        id="network-selector"
        value={network}
        onChange={handleNetworkChange}
        disabled={loading}
        className="input-field text-sm font-medium pr-8"
      >
        {NETWORK_TYPES.map((type) => (
          <option key={type} value={type}>
            {type === 'PUBLIC' ? 'PUBLIC (Mainnet)' : type}
          </option>
        ))}
      </select>

      {error && (
        <span role="alert" className="hidden max-w-48 truncate text-xs text-rose-300 md:inline">
          {error}
        </span>
      )}

      <ConfirmModal
        isOpen={isModalOpen}
        title="Switch Stellar Network?"
        message={`Are you sure you want to switch the Stellar network to ${targetNetwork}? This will alter system configurations, clear session indexes, and disconnect active client configurations.`}
        confirmText={`Switch to ${targetNetwork}`}
        requireTypingConfirm={true}
        onConfirm={handleNetworkChangeConfirm}
        onCancel={() => setIsModalOpen(false)}
      />
    </div>
  );
};

/**
 * Full-width strip naming the network every request is currently hitting.
 * Mainnet is styled as a warning because operations there move real value.
 */
export const NetworkBanner: React.FC = () => {
  const { network, endpoints } = useNetwork();
  const { isMainnet, label, horizonUrl } = endpoints;

  return (
    <div
      data-testid="network-banner"
      data-network={network}
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs sm:px-6 lg:px-8 ${
        isMainnet
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          : 'border-slate-800 bg-slate-900/60 text-slate-400'
      }`}
    >
      {isMainnet && <AlertTriangle size={12} aria-hidden="true" className="shrink-0" />}
      <span className="font-semibold">
        {isMainnet ? `Live on ${label}` : `Connected to ${label}`}
      </span>
      <span className="truncate font-mono text-[11px] opacity-80">{horizonUrl}</span>
    </div>
  );
};

export default NetworkSelector;
