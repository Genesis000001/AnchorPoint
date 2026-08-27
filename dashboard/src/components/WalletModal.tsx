import { AnimatePresence, motion } from 'framer-motion';
import { Check, X, Wallet2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { WalletManager, WalletOption } from '../lib/wallet';

type WalletModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (walletId: string) => void;
  children?: ReactNode;
};

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
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Connect wallet"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 shadow-2xl shadow-black/40"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Connect a wallet</p>
                <h2 className="mt-1 font-display text-2xl font-bold">Choose your provider</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-900 hover:text-slate-200"
                aria-label="Close wallet dialog"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

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
                    className={`relative flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-gradient-to-r p-4 text-left transition hover:border-primary/40 hover:bg-slate-900 disabled:opacity-50 disabled:hover:border-slate-800 disabled:hover:bg-slate-950 ${option.accent}`}
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

            {children ? <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-400">{children}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

export default WalletModal;
