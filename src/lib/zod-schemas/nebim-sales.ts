import { z } from "zod";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const nebimSalesFilterSchema = z.object({
  store_id: z.string().uuid().optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  only_returns: z.boolean().optional(),
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
