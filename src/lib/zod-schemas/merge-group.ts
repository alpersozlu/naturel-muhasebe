import { z } from "zod";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const mergeGroupCreateSchema = z
  .object({
    store_id: z.string().uuid(),
    start_date: dateOnly,
    end_date: dateOnly,
    /**
     * Seçili (ardışık olmayan) günler — sahibi, 07.11.2026: "1-3-5 Ekim'i birleştireceğim".
     * Verilirse grup YALNIZ bu günlerden oluşur; start/end = ilk/son seçili gün. Aradaki
     * günler gruba girmez (kendi günleri olarak kalır).
     */
    dates: z.array(dateOnly).min(2, "En az 2 gün seçilmeli").max(3, "En fazla 3 gün birleştirilebilir").optional(),
  })
  .superRefine((val, ctx) => {
    const start = new Date(`${val.start_date}T00:00:00.000Z`);
    const end = new Date(`${val.end_date}T00:00:00.000Z`);
    if (end < start) {
      ctx.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "Bitiş tarihi başlangıçtan önce olamaz",
      });
      return;
    }
    if (val.dates) {
      const sorted = [...val.dates].sort();
      if (new Set(sorted).size !== sorted.length) ctx.addIssue({ code: "custom", path: ["dates"], message: "Aynı gün iki kez seçilemez" });
      if (sorted[0] !== val.start_date || sorted[sorted.length - 1] !== val.end_date)
        ctx.addIssue({ code: "custom", path: ["dates"], message: "Başlangıç ve bitiş, seçili günlerin ilki ve sonuncusu olmalı" });
      const span = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      if (span > 7) ctx.addIssue({ code: "custom", path: ["dates"], message: "Seçili günler en fazla 7 günlük bir aralıkta olmalı" });
      return;
    }
    const days =
      Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (days < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "Birleşme en az 2 gün olmalı (tek gün için normal akış)",
      });
    }
    if (days > 3) {
      ctx.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "Birleşme en fazla 3 gün olabilir",
      });
    }
  });

export const mergeGroupForStoreDateSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
});

export const mergeGroupIdSchema = z.object({ id: z.string().uuid() });

/** "Bu günü şu önceki günle birleştirirsem ne olur?" (Mavi Kasa Birleşmesi kartı) */
export const mergeProbeSchema = z.object({
  store_id: z.string().uuid(),
  date: dateOnly,
  prev_date: dateOnly,
});
