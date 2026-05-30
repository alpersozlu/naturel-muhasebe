import { z } from "zod";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalı");

export const mergeGroupCreateSchema = z
  .object({
    store_id: z.string().uuid(),
    start_date: dateOnly,
    end_date: dateOnly,
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
