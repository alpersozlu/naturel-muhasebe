export const TOLERANCE_TL = 5;

export const SUPPORTED_CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = "TRY";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  // xlsx (Mavi SAP / Derimod Nebim bayi gün sonu raporu)
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel", // legacy .xls — gerekirse
] as const;

export const UPLOAD_BUCKET = "uploads";
