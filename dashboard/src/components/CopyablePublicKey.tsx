import { useEffect, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyablePublicKeyProps {
  publicKey: string;
  label?: string;
}

/** How long the "Copied!" confirmation stays on screen. */
export const COPY_FEEDBACK_MS = 2000;

type CopyState = 'idle' | 'copied' | 'failed';

const shortenPublicKey = (publicKey: string) => {
  if (publicKey.length <= 16) return publicKey;
  return `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`;
};

export const CopyablePublicKey = ({
  publicKey,
  label = 'Public key',
}: CopyablePublicKeyProps) => {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const displayKey = useMemo(() => shortenPublicKey(publicKey), [publicKey]);

  useEffect(() => {
    if (copyState === 'idle') return undefined;

    const timeoutId = window.setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const tooltipText = copyState === 'copied' ? 'Copied!' : 'Copy failed';

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </p>
        <code className="block truncate font-mono text-xs text-slate-200" title={publicKey}>
          {displayKey}
        </code>
      </div>

      <div className="relative shrink-0">
        {/*
          A native <button> already activates on Enter and Space, so the copy
          affordance is keyboard-operable without a key handler that would
          double-fire alongside the synthesised click.
        */}
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {copyState === 'copied' ? (
            <Check size={16} className="text-emerald-400" aria-hidden="true" />
          ) : (
            <Copy size={16} aria-hidden="true" />
          )}
        </button>

        {copyState !== 'idle' && (
          <span
            data-testid="copy-tooltip"
            data-state={copyState}
            // The live region below already announces this; hiding the bubble
            // from assistive tech keeps it from being read twice.
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium shadow-lg ${
              copyState === 'copied'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/15 text-rose-200'
            }`}
          >
            {tooltipText}
          </span>
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        {copyState === 'copied' ? `${label} copied to clipboard.` : ''}
        {copyState === 'failed' ? `Unable to copy ${label.toLowerCase()}.` : ''}
      </span>
    </div>
  );
};

export default CopyablePublicKey;
