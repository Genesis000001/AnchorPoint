export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_KYC_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

export type FileValidationResult = {
  valid: boolean;
  error?: string;
};

const isAcceptedMimeType = (type: string): boolean =>
  ACCEPTED_KYC_MIME_TYPES.includes(type as (typeof ACCEPTED_KYC_MIME_TYPES)[number]);

export const validateKycFile = (file: File): FileValidationResult => {
  if (!isAcceptedMimeType(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Accepted formats: JPEG, PNG, or PDF.',
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: 'File exceeds the 10MB size limit.',
    };
  }

  return { valid: true };
};

export const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
