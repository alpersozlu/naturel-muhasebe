import { z } from "zod";

/**
 * Alt kırılım satırı: kart tipi / işlem tipi bazında adet + tutar
 * (Yapı Kredi "KART BAZINDA DETAYLAR", İş Bankası "SATIŞ / DEBİT SATIŞ",
 * Koopbank alt bölümleri). Toplamın hakemi: kırılım toplamı basılı
 * toplamlardan hangisiyle tutuyorsa o doğrudur.
 */
export const posSlipBreakdownSchema = z.object({
  label: z.string(),
  count: z.number().nullable(),
  amount: z.number().nullable(),
});

/** Tek slipteki bir bankanın gün sonu bloğu (ortak terminal slipleri). */
export const posSlipSectionSchema = z.object({
  bank_name: z.string().min(1),
  terminal_no: z.string().min(1).nullable(),
  sales_count: z.number().int().min(0).nullable(),
  sales_amount: z.number().min(0).nullable(),
  refund_count: z.number().int().min(0).nullable(),
  refund_amount: z.number().min(0).nullable(),
  net_amount: z.number().nullable(),
  breakdown: z.array(posSlipBreakdownSchema).optional(),
  /** Slipte o banka için basılı HER toplam (PEŞİN TOPLAM, GRUP KAPAMA
   *  TOPLAM, ÖZET T.TUTAR, GENEL TOPLAM…) — aynı rakam birden fazla yerde
   *  basılıysa hepsi; sunucu oylar. */
  total_candidates: z.array(z.number()).optional(),
  /** Detay işlem listesindeki tek tek satış tutarları (varsa) — toplamı
   *  üçüncü bağımsız kanıt. */
  transaction_amounts: z.array(z.number()).optional(),
  /** Bu bankanın kırılım ve toplam satırlarının bulunduğu görsel parçaları
   *  (1'den başlayan sıra) — ikinci bakış yalnız onları büyütür. */
  evidence_tiles: z.array(z.number()).optional(),
});
export type PosSlipSection = z.infer<typeof posSlipSectionSchema>;

export const posSlipOcrSchema = z.object({
  is_pos_slip: z.boolean(),
  rejection_reason: z.string().nullable(),
  bank_name: z.string().min(1).nullable(),
  terminal_no: z.string().min(1).nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Slipteki tarih harfiyen ("24/08/26") — sunucu GG-AA-YY ile çözer. */
  date_raw: z.string().max(40).nullable().optional(),
  sales_count: z.number().int().min(0).nullable(),
  sales_amount: z.number().min(0).nullable(),
  refund_count: z.number().int().min(0).nullable(),
  refund_amount: z.number().min(0).nullable(),
  net_amount: z.number().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).default("TRY"),
  /**
   * Slip birden fazla bankanın gün sonunu taşıyorsa (Koopbank Optimum +
   * Yapı Kredi ortak terminali) her banka burada AYRI bir eleman olur.
   * Tek bankalı slipte boş/eksik bırakılır; üstteki tekil alanlar geçerlidir.
   */
  sections: z.array(posSlipSectionSchema).optional(),
});

export type PosSlipOcr = z.infer<typeof posSlipOcrSchema>;

/**
 * The shape the model is constrained to emit (structured output). Same idea
 * as the store summary: `check_notes` first as the only scratchpad, no
 * regex / min / int constraints (the constrained decoder rejects them);
 * `posSlipOcrSchema` re-validates strictly afterwards.
 */
const posSlipSectionOutputSchema = z.object({
  bank_name: z.string(),
  terminal_no: z.string().nullable(),
  sales_count: z.number().nullable(),
  sales_amount: z.number().nullable(),
  refund_count: z.number().nullable(),
  refund_amount: z.number().nullable(),
  net_amount: z.number().nullable(),
  breakdown: z.array(
    z.object({ label: z.string(), count: z.number().nullable(), amount: z.number().nullable() })
  ),
  total_candidates: z.array(z.number()),
  transaction_amounts: z.array(z.number()),
  evidence_tiles: z.array(z.number()),
});

/**
 * No singular bank fields here: the constrained decoder rejects schemas with
 * more than ~16 nullable (anyOf) parameters, and the singular fields are
 * only ever a copy of `sections[0]` — the parser fills them from there.
 */
export const posSlipOutputSchema = z.object({
  check_notes: z.string(),
  is_pos_slip: z.boolean(),
  rejection_reason: z.string().nullable(),
  date: z.string().nullable(),
  date_raw: z.string().nullable(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]),
  sections: z.array(posSlipSectionOutputSchema),
});
