import { z } from "zod";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

/** İndirim oranı bantları (Analiz dağılımıyla aynı). */
export const discountBandSchema = z.enum([
  "all",
  "discounted",
  "none",
  "b1",
  "b2",
  "b3",
  "b4",
  "b5",
]);
export type DiscountBand = z.infer<typeof discountBandSchema>;

/** Sıralanabilir sütunlar. */
export const sortBySchema = z.enum(["date", "amount", "discount", "net"]);
export type SortBy = z.infer<typeof sortBySchema>;

export const nebimSalesFilterSchema = z.object({
  store_id: z.string().uuid().optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  only_returns: z.boolean().optional(),
  discount_band: discountBandSchema.optional(),
  sort_by: sortBySchema.optional(),
  sort_dir: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

export type NebimSalesFilter = z.infer<typeof nebimSalesFilterSchema>;

/** Satış analizi (personel/müşteri/mağaza özeti) — sayfalama yok, tüm filtre. */
export const nebimAnalizSchema = z.object({
  store_id: z.string().uuid().optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  only_returns: z.boolean().optional(),
});

/** Bir müşterinin aldığı ürünler (drill-down). */
export const nebimCustomerProductsSchema = nebimAnalizSchema.extend({
  customer_name: z.string().min(1),
});

/** Müşteri detay kartı — kod varsa kodla, yoksa adla eşleşir (tüm zaman). */
export const nebimCustomerDetailSchema = z.object({
  customer_code: z.string().nullable(),
  customer_name: z.string().min(1),
});
