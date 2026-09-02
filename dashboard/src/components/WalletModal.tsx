import { Check, Wallet2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { WalletManager, WalletOption } from '../lib/wallet';
import { Modal } from './Modal';

type WalletModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (walletId: string) => void;
  children?: ReactNode;
};

/**
 * Wallet provider picker. Built on {@link Modal} so it inherits the shared
 * focus trap, Escape handling and `role="dialog"` / `aria-modal` wiring.
 * Options are loaded from WalletManager so Freighter, Albedo, Rabet, and xBull
 * all appear with live installed/unavailable state.
 */
export const WalletModal = ({ isOpen, onClose, onSelect, children }: WalletModalProps) => {
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      const walletManager = WalletManager.getInstance();
      walletManager.getWalletOptions().then((options) => {
        setWalletOptions(options);
        setIsLoading(false);
      });
    }
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Choose your provider"
      description="Connect a wallet to sign transactions from this dashboard."
      size="lg"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-slate-400">Loading wallet options...</div>
        </div>
      ) : (
        <div className="space-y-3">
          {walletOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              disabled={!option.installed}
              className={`relative flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-gradient-to-r p-4 text-left transition hover:border-primary/40 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text disabled:opacity-50 disabled:hover:border-slate-800 disabled:hover:bg-slate-950 ${option.accent}`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950/70">
                <Wallet2 size={18} aria-hidden="true" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-100">{option.name}</p>
                <p className="text-sm text-slate-400">{option.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {option.installed ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                    <Check size={12} aria-hidden="true" />
                    Installed
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                    <X size={12} aria-hidden="true" />
                    Not installed
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {children ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400">
          {children}
        </div>
      ) : null}
    </Modal>
  );
};

export default WalletModal;
