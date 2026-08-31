import { useEffect, useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { FieldRequirement } from '../types';
import type { DepositError } from './DepositErrorAlert';
import { DepositErrorAlert } from './DepositErrorAlert';

export interface FormValues {
  [key: string]: string;
}

/** Per-asset deposit bounds. Amounts outside these never reach the backend. */
export interface AssetLimits {
  min: number;
  max: number;
  /** Maximum fractional digits the asset accepts. */
  decimals: number;
}

interface DepositFormProps {
  /** Field definitions driven by the backend UiConfig */
  fields: FieldRequirement[];
  /** Asset code being deposited (e.g., 'USDC') */
  assetCode: string;
  /** Overrides the limits looked up from `assetCode`. */
  assetLimits?: AssetLimits;
  /** Called with validated form values when the user submits */
  onSubmit: (values: FormValues) => void;
}

/** SEP-24 alphanumeric asset codes are 1–12 uppercase alphanumeric characters. */
export const ASSET_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WALLET_PATTERN = /^G[A-Z0-9]{55}$/;

export const DEFAULT_ASSET_LIMITS: AssetLimits = { min: 10, max: 100_000, decimals: 2 };

/**
 * Bounds per asset. Minimums differ by an order of magnitude across corridors,
 * so a single hardcoded floor either blocks valid ARST deposits or lets
 * dust-sized USDC deposits through.
 */
export const ASSET_LIMITS: Record<string, AssetLimits> = {
  USDC: { min: 10, max: 100_000, decimals: 2 },
  EURT: { min: 10, max: 100_000, decimals: 2 },
  ARST: { min: 5_000, max: 50_000_000, decimals: 2 },
};

export function isValidAssetCode(assetCode: string): boolean {
  return ASSET_CODE_PATTERN.test(assetCode);
}

export function getAssetLimits(assetCode: string): AssetLimits {
  return ASSET_LIMITS[assetCode] ?? DEFAULT_ASSET_LIMITS;
}

const getFieldType = (key: string): React.HTMLInputTypeAttribute => {
  if (key.toLowerCase().includes('amount')) return 'number';
  if (key.toLowerCase().includes('email')) return 'email';
  return 'text';
};

const formatAmount = (value: number, decimals: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });

/** Builds the decimal-digit pattern for an asset, e.g. 2 → /^\d+(\.\d{1,2})?$/ */
export function amountPattern(decimals: number): RegExp {
  return decimals > 0 ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/;
}

/**
 * Single source of truth for field rules, shared by the Zod schema and by
 * tests. Returns an empty string when the value is acceptable.
 */
export function validateField(
  field: FieldRequirement,
  value: string,
  assetCode: string,
  limits: AssetLimits,
): string {
  const trimmed = value.trim();

  if (field.required && !trimmed) {
    return `${field.label} is required.`;
  }

  if (!trimmed) return '';

  const key = field.key.toLowerCase();

  if (key.includes('amount')) {
    if (!amountPattern(limits.decimals).test(trimmed)) {
      return limits.decimals > 0
        ? `Enter a valid amount with up to ${limits.decimals} decimal place${
            limits.decimals === 1 ? '' : 's'
          }.`
        : 'Enter a whole number amount.';
    }

    const amount = Number.parseFloat(trimmed);
    if (amount <= 0) return 'Deposit amount must be greater than zero.';
    if (amount < limits.min) {
      return `Minimum ${assetCode} deposit is ${formatAmount(limits.min, limits.decimals)}.`;
    }
    if (amount > limits.max) {
      return `Maximum ${assetCode} deposit is ${formatAmount(limits.max, limits.decimals)}.`;
    }
  }

  if (key.includes('email') && !EMAIL_PATTERN.test(trimmed)) {
    return 'Enter a valid email address.';
  }

  if ((key.includes('wallet') || key.includes('address')) && !WALLET_PATTERN.test(trimmed)) {
    return 'Enter a valid Stellar wallet address starting with G.';
  }

  if (key.includes('asset') && !isValidAssetCode(trimmed)) {
    return 'Enter a valid asset code (1-12 uppercase letters or digits).';
  }

  return '';
}

/**
 * Zod schema for one deposit form. Rebuilt whenever the field set, asset or
 * limits change so the bounds enforced always match the asset on screen.
 */
export function buildDepositSchema(
  fields: FieldRequirement[],
  assetCode: string,
  limits: AssetLimits,
) {
  const shape = Object.fromEntries(
    fields.map((field) => [
      field.key,
      z.string().superRefine((value, ctx) => {
        const message = validateField(field, value ?? '', assetCode, limits);
        if (message) {
          ctx.addIssue({ code: 'custom', message });
        }
      }),
    ]),
  );

  return z.object(shape);
}

export const DepositForm = ({
  fields,
  assetCode,
  assetLimits,
  onSubmit,
}: DepositFormProps) => {
  const formId = useId();
  const [formError, setFormError] = useState<DepositError | null>(null);

  const limits = useMemo(
    () => assetLimits ?? getAssetLimits(assetCode),
    [assetLimits, assetCode],
  );
  const schema = useMemo(
    () => buildDepositSchema(fields, assetCode, limits),
    [fields, assetCode, limits],
  );
  const defaultValues = useMemo(
    () => Object.fromEntries(fields.map((field) => [field.key, ''])) as FormValues,
    [fields],
  );

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, touchedFields, isSubmitted },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues,
  });

  // A different asset means different bounds, so previous entries are no
  // longer known-good and the form starts clean.
  useEffect(() => {
    reset(defaultValues);
    setFormError(null);
  }, [defaultValues, reset]);

  const values = watch();
  const errorCount = Object.keys(errors).length;
  const hasErrors = errorCount > 0;

  const handleValid = (submitted: FormValues) => {
    setFormError(null);
    onSubmit(submitted);
  };

  // RHF hands the fresh error map to this callback; the `errors` captured from
  // formState is still the previous render's and would undercount.
  const handleInvalid = (submitErrors: FieldErrors<FormValues>) => {
    const count = Object.keys(submitErrors).length || 1;
    setFormError({
      type: 'validation',
      title: 'Unable to Process Deposit',
      message: `Please fix ${count} validation error${count !== 1 ? 's' : ''} before continuing.`,
      details: 'Review the highlighted fields below for specific issues.',
      retryable: false,
    });
  };

  return (
    <form
      onSubmit={handleSubmit(handleValid, handleInvalid)}
      noValidate
      aria-label={`Deposit ${assetCode} details form`}
      className="space-y-5"
    >
      {/* Form-level error alert from submission or network failures */}
      <DepositErrorAlert error={formError} onDismiss={() => setFormError(null)} dismissible />

      {/* Summary error alert shown after first submit attempt with field errors */}
      {isSubmitted && hasErrors && !formError && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="text-sm text-amber-300">
            Please fix {errorCount} error{errorCount !== 1 ? 's' : ''} in the form before continuing.
          </p>
        </div>
      )}

      {fields.map((field) => {
        const inputId = `${formId}-${field.key}`;
        const errorId = `${formId}-${field.key}-error`;
        const hintId = field.helpText ? `${formId}-${field.key}-hint` : undefined;
        const message = errors[field.key]?.message as string | undefined;
        const isInvalid = Boolean(message);
        const isTouched = Boolean(touchedFields[field.key]);

        return (
          <div key={field.key} className="space-y-1.5">
            <label
              htmlFor={inputId}
              className="flex items-center gap-2 text-sm font-medium text-slate-300"
            >
              {field.label}
              {field.required ? (
                <span className="text-xs font-normal text-amber-400" aria-hidden="true">
                  Required
                </span>
              ) : (
                <span className="text-xs font-normal text-slate-400" aria-hidden="true">
                  Optional
                </span>
              )}
            </label>

            {field.helpText && (
              <p id={hintId} className="text-xs text-slate-400">
                {field.helpText}
              </p>
            )}

            <div className="relative">
              <input
                id={inputId}
                type={getFieldType(field.key)}
                placeholder={field.placeholder}
                aria-required={field.required}
                aria-invalid={isInvalid}
                aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
                {...register(field.key)}
                className={`input-field w-full pr-9 text-sm transition-all ${
                  isInvalid
                    ? 'border-rose-500/60 focus:ring-rose-500/40'
                    : isTouched
                    ? 'border-emerald-500/40 focus:ring-emerald-500/30'
                    : ''
                }`}
              />
              {isTouched && !isInvalid && values[field.key] && (
                <CheckCircle2
                  size={15}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400"
                  aria-hidden="true"
                />
              )}
              {isInvalid && (
                <AlertCircle
                  size={15}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-rose-400"
                  aria-hidden="true"
                />
              )}
            </div>

            {isInvalid && (
              <p
                id={errorId}
                role="alert"
                className="flex items-center gap-1.5 text-xs text-rose-400"
              >
                <AlertCircle size={11} aria-hidden="true" />
                {message}
              </p>
            )}
          </div>
        );
      })}

      <button
        type="submit"
        className="btn-primary w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
      >
        Continue to Verification
      </button>
    </form>
  );
};

export default DepositForm;
