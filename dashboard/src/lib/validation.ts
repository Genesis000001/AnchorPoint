export const PATTERNS = {
  AMOUNT: /^\d+(\.\d{1,2})?$/,
  BANK_ACCOUNT: /^\d{6,20}$/,
  STELLAR_WALLET: /^G[A-Z0-9]{55}$/,
  IBAN_FORMAT: /^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
} as const;

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** English fallback used when no translator is supplied (e.g. unit tests). */
const enTranslate: TranslateFn = (key: string, params?: Record<string, string | number>) => {
  const p = params ?? {};
  switch (key) {
    case 'validation.required':
      return `${p.label} is required.`;
    case 'validation.amountInvalid':
      return 'Enter a valid amount (e.g. 120.50).';
    case 'validation.amountPositive':
      return 'Amount must be greater than zero.';
    case 'validation.amountMax':
      return 'Amount exceeds the maximum single-transaction limit.';
    case 'validation.bankAccount':
      return 'Bank account must be 6–20 digits.';
    case 'validation.stellarInvalid':
      return 'Enter a valid Stellar wallet address starting with G (56 characters).';
    case 'validation.addressShort':
      return 'Address must be at least 5 characters.';
    case 'validation.addressLong':
      return 'Address must not exceed 200 characters.';
    case 'validation.addressLetters':
      return 'Address must contain letters.';
    case 'validation.lengthMin':
      return `Must be at least ${p.min} characters (${p.len} current).`;
    case 'validation.lengthMax':
      return `Must not exceed ${p.max} characters (${p.len} current).`;
    case 'validation.emailInvalid':
      return 'Enter a valid email address.';
    case 'validation.emailMax':
      return 'Email must not exceed 254 characters.';
    case 'validation.ibanFormat':
      return 'IBAN must start with a 2-letter country code followed by 2 check digits.';
    case 'validation.ibanCountryLength':
      return `IBAN for ${p.country} must be exactly ${p.length} characters (got ${p.len}).`;
    case 'validation.ibanRange':
      return 'IBAN must be between 8 and 34 characters.';
    case 'validation.ibanChecksum':
      return 'IBAN check digits are invalid.';
    default:
      return key;
  }
};

const IBAN_COUNTRY_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22,
  BH: 22, BR: 29, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18,
  DO: 28, EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22,
  GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23,
  IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LI: 21, LT: 20,
  LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31,
  MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, RO: 24,
  RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TL: 23, TN: 24,
  TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

function mod97(value: string): number {
  let remainder = 0;
  for (let i = 0; i < value.length; i++) {
    remainder = (remainder * 10 + parseInt(value[i], 10)) % 97;
  }
  return remainder;
}

export function validateIBAN(value: string, t: TranslateFn = enTranslate): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/\s/g, '').toUpperCase();

  if (!PATTERNS.IBAN_FORMAT.test(cleaned)) {
    return t('validation.ibanFormat');
  }

  const countryCode = cleaned.slice(0, 2);
  const expectedLength = IBAN_COUNTRY_LENGTHS[countryCode];
  if (expectedLength && cleaned.length !== expectedLength) {
    return t('validation.ibanCountryLength', {
      country: countryCode,
      length: expectedLength,
      len: cleaned.length,
    });
  }

  if (cleaned.length < 8 || cleaned.length > 34) {
    return t('validation.ibanRange');
  }

  const reordered = cleaned.slice(4) + cleaned.slice(0, 4);
  const digits = reordered.split('').map((ch) =>
    /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55),
  ).join('');

  if (mod97(digits) !== 1) {
    return t('validation.ibanChecksum');
  }

  return null;
}

export function validateAmount(value: string, t: TranslateFn = enTranslate): string | null {
  const trimmed = value.trim();

  if (!trimmed) return null;

  if (!PATTERNS.AMOUNT.test(trimmed)) {
    return t('validation.amountInvalid');
  }

  const num = parseFloat(trimmed);
  if (num <= 0) return t('validation.amountPositive');
  if (num > 1_000_000) return t('validation.amountMax');

  return null;
}

export function validateBankAccount(value: string, t: TranslateFn = enTranslate): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!PATTERNS.BANK_ACCOUNT.test(trimmed)) {
    return t('validation.bankAccount');
  }

  return null;
}

export function validateStellarAddress(value: string, t: TranslateFn = enTranslate): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!PATTERNS.STELLAR_WALLET.test(trimmed)) {
    return t('validation.stellarInvalid');
  }

  return null;
}

export function validateGenericAddress(value: string, t: TranslateFn = enTranslate): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.length < 5) {
    return t('validation.addressShort');
  }
  if (trimmed.length > 200) {
    return t('validation.addressLong');
  }
  if (/^[0-9\s]+$/.test(trimmed)) {
    return t('validation.addressLetters');
  }

  return null;
}

export function validateLength(
  value: string,
  min?: number,
  max?: number,
  t: TranslateFn = enTranslate,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const len = trimmed.length;
  if (min !== undefined && len < min) {
    return t('validation.lengthMin', { min, len });
  }
  if (max !== undefined && len > max) {
    return t('validation.lengthMax', { max, len });
  }

  return null;
}

export function validateEmail(value: string, t: TranslateFn = enTranslate): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!PATTERNS.EMAIL.test(trimmed)) {
    return t('validation.emailInvalid');
  }

  if (trimmed.length > 254) {
    return t('validation.emailMax');
  }

  return null;
}

export function validateField(
  field: { key: string; label: string; required: boolean },
  value: string,
  t: TranslateFn = enTranslate,
): string {
  const trimmed = value.trim();

  if (field.required && !trimmed) {
    return t('validation.required', { label: field.label });
  }

  if (!trimmed) return '';

  const key = field.key.toLowerCase();

  let error: string | null = null;

  if (key.includes('iban')) {
    error = validateIBAN(value, t);
  } else if (key.includes('amount')) {
    error = validateAmount(value, t);
  } else if (key.includes('bankaccount') || key.includes('bank_account') || key === 'account') {
    error = validateBankAccount(value, t);
  } else if (key.includes('wallet') || (key.includes('address') && key.includes('stellar'))) {
    error = validateStellarAddress(value, t);
  } else if (key.includes('address')) {
    error = validateGenericAddress(value, t);
  } else if (key.includes('email')) {
    error = validateEmail(value, t);
  }

  if (error) return error;

  const lengthError = validateLength(value, 1, undefined, t);
  if (lengthError) return lengthError;

  return '';
}

export function validateAll(
  fields: { key: string; label: string; required: boolean }[],
  values: Record<string, string>,
  t: TranslateFn = enTranslate,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const err = validateField(field, values[field.key] ?? '', t);
    if (err) errors[field.key] = err;
  }
  return errors;
}
