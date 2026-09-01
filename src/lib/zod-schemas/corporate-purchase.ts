import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/constants";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const CORPORATE_PURCHASE_TYPES = ["corporate", "management"] as const;

// Zod 4 NOT: `z.union([z.string(), z.null(), z.undefined()])` bir alanı
// optional YAPMAZ (key zorunlu kalır → "nonoptional / Invalid input"). Opsiyonel
// metin için `.optional()` + transform kullan. (Handoff Zod-4 gotcha.)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length ? v : undefined));

/**
 * FORM alanları — `store_id` ve `date` BİLEREK yok. O ikisi karta prop olarak
 * gelir ve submit anında eklenir. Forma konurlarsa RHF `defaultValues`'ı mount
 * anında okuduğu için (reactive DEĞİL) mağaza sonradan seçilince form içindeki
 * değer boş string kalır, resolver `Invalid UUID` ile patlar ve kayıt sessizce
 * reddedilir. Aynı tuzak manual-invoice kartında da yaşandı.
 */
export const corporatePurchaseFormSchema = z.object({
  type: z.enum(CORPORATE_PURCHASE_TYPES),
  // Kurumsal için şirket adı — opsiyonel (boş bırakılabilir)
  company_name: optionalText(120),
  // İsim soyisim — HER ZAMAN zorunlu
  person_name: z
    .string()
    .trim()
    .min(1, "İsim soyisim girilmeli (kim aldı)")
    .max(120),
  // coerce: input string ("1899.97") de gelse number'a çevrilir —
  // RHF valueAsNumber kırılganlığına bağımlı kalma.
  amount: z.coerce.number().positive("Tutar 0'dan büyük olmalı"),
  currency: z.enum(SUPPORTED_CURRENCIES).default("TRY"),
  is_paid: z.boolean().default(false),
  note: optionalText(300),
  // Bilgi fişi — Mavi mağazalarında ZORUNLU (sunucu markadan karar verir).
  // Fişteki "Ödenecek Tutar" girilen tutarla karşılaştırılır.
  receipt_base64: z.string().min(1).optional(),
  receipt_mime_type: z
    .enum(["image/jpeg", "image/png", "image/webp", "application/pdf"])
    .optional(),
  receipt_filename: z.string().max(200).optional(),
});

/** Sunucuya giden tam girdi = form alanları + mağaza/gün. */
export const corporatePurchaseCreateSchema = corporatePurchaseFormSchema.extend({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export const corporatePurchaseIdSchema = z.object({ id: z.string().uuid() });

export const corporatePurchaseSetPaidSchema = z.object({
  id: z.string().uuid(),
  is_paid: z.boolean(),
});

export const corporatePurchasesForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export type CorporatePurchaseCreateInput = z.infer<
  typeof corporatePurchaseCreateSchema
>;
/** Formun tuttuğu ham değerler (transform/default öncesi). */
export type CorporatePurchaseFormInput = z.input<
  typeof corporatePurchaseFormSchema
>;
