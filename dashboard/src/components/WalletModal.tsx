import { Wallet2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';

type WalletOption = {
  id: 'freighter' | 'albedo' | 'rango';
  name: string;
  description: string;
  accent: string;
};

type WalletModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (walletId: WalletOption['id']) => void;
  children?: ReactNode;
};

const walletOptions: WalletOption[] = [
  {
    id: 'freighter',
    name: 'Freighter',
    description: 'Connect your Stellar account with the Freighter browser extension.',
    accent: 'from-sky-500/20 to-cyan-500/20',
  },
  {
    id: 'albedo',
    name: 'Albedo',
    description: 'Use the Albedo wallet for a quick sign-in flow.',
    accent: 'from-fuchsia-500/20 to-violet-500/20',
  },
  {
    id: 'rango',
    name: 'Rango',
    description: 'Open the Rango wallet experience for cross-chain access.',
    accent: 'from-emerald-500/20 to-lime-500/20',
  },
];

/**
 * Wallet provider picker. Built on {@link Modal} so it inherits the shared
 * focus trap, Escape handling and `role="dialog"` / `aria-modal` wiring rather
 * than re-implementing them.
 */
export const WalletModal = ({ isOpen, onClose, onSelect, children }: WalletModalProps) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Choose your provider"
    description="Connect a wallet to sign transactions from this dashboard."
    size="lg"
  >
    <div className="space-y-3">
      {walletOptions.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onSelect(option.id)}
          className={`flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-gradient-to-r p-4 text-left transition hover:border-primary/40 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${option.accent}`}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950/70">
            <Wallet2 size={18} aria-hidden="true" />
          </div>
          <div>
            <p className="font-semibold text-slate-100">{option.name}</p>
            <p className="text-sm text-slate-400">{option.description}</p>
          </div>
        </button>
      ))}
    </div>

    {children ? (
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400">
        {children}
      </div>
    ) : null}
  </Modal>
);

export default WalletModal;
