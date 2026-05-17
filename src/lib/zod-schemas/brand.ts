import { z } from "zod";

export const brandCreateSchema = z.object({
  name: z.string().trim().min(2, "En az 2 karakter").max(80, "En fazla 80 karakter"),
  logo_url: z.string().url("Geçerli bir URL girin").optional().or(z.literal("")),
});

export const brandUpdateSchema = brandCreateSchema.extend({
  id: z.string().uuid(),
});

export const brandIdSchema = z.object({
  id: z.string().uuid(),
});

export type BrandCreateInput = z.infer<typeof brandCreateSchema>;
export type BrandUpdateInput = z.infer<typeof brandUpdateSchema>;
