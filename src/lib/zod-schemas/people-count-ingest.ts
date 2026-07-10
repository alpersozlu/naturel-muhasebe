import { z } from "zod";

/**
 * Kişi sayımı ingest payload — KisiSayimKopru (Hikvision) → DocuFlow push.
 *
 * Köprü, mağaza kamerasından okuduğu saatlik giren/çıkan sayılarını gönderir.
 * Her satır bir (mağaza × gün × saat) hücresi; date kameranın YEREL günüdür
 * (TZ kayması olmasın diye düz string). Route (store_code, date, hour)
 * üzerinden idempotent upsert eder — köprü son günleri her turda yeniden
 * gönderir, gün içi saat dilimi büyüdükçe üzerine yazılır.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Regex'e ek gerçek takvim kontrolü: "2026-02-31" gibi günler panelde
 *  Invalid Date üretip sayfayı bozar; kapıda çevrilir. */
function gecerliTakvimGunu(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const peopleCountRowSchema = z.object({
  store_code: z.string().trim().min(1).max(32),
  date: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD bekleniyor")
    .refine(gecerliTakvimGunu, "geçersiz takvim günü"),
  hour: z.number().int().min(0).max(23),
  // Üst sınır: INT4 taşmasını ve saçma değerleri kapıda çevirir
  // (bir mağazaya saatte 1M kişi girmez).
  enter: z.number().int().min(0).max(1_000_000),
  exit: z.number().int().min(0).max(1_000_000),
});

export const peopleCountIngestSchema = z.object({
  source: z.string().trim().max(64).optional(),
  rows: z.array(peopleCountRowSchema).min(1).max(20000),
});

export type PeopleCountIngestInput = z.infer<typeof peopleCountIngestSchema>;
export type PeopleCountIngestRow = z.infer<typeof peopleCountRowSchema>;
