import { z } from "zod";

/**
 * DEFOLU ingest payload (Faz 5) — İndirim Kontrol → DocuFlow push.
 *
 * Program her ay (ya da tüm yıl) Mavi mağazaların defolu zarar toplamını gönderir.
 * Her satır bir (ay × mağaza) hücresi. Mağaza `store_code` (Mavi kodu 9400-9403)
 * ya da `store_name` ("Lefkoşa", "Girne"…) ile belirtilir — en az biri zorunlu.
 */

export const MAVI_STORE_CODES = ["9400", "9401", "9402", "9403"] as const;

const defoluEntrySchema = z
  .object({
    month: z.number().int().min(1).max(12),
    store_code: z.string().trim().min(1).optional(),
    store_name: z.string().trim().min(1).optional(),
    amount_try: z.number().finite().min(0),
  })
  .refine((e) => Boolean(e.store_code || e.store_name), {
    message: "store_code veya store_name gerekli",
  });

export const defoluIngestSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  entries: z.array(defoluEntrySchema).min(1).max(1000),
});

export type DefoluIngestInput = z.infer<typeof defoluIngestSchema>;
export type DefoluIngestEntry = z.infer<typeof defoluEntrySchema>;
